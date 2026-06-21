#!/usr/bin/env node

/**
 * 简易推荐系统 (Simple Recommender System)
 * 一个使用纯 TypeScript 编写的推荐系统，实现：
 *  - 用户协同过滤（皮尔逊/余弦相似度）
 *  - 物品协同过滤
 *  - 内容过滤（物品特征向量余弦相似度）
 *  - 矩阵分解（SGD）
 *  - 评估（RMSE / Precision@k）
 * 内置电影评分演示数据集。仅使用 Node.js 内置模块（fs, path）。
 */

import * as fs from "fs";
import * as path from "path";

type AlgoName = "user-cf" | "item-cf" | "content" | "mf";

interface Rating {
    user: string;
    item: string;
    rating: number;
}

interface Dataset {
    ratings: Rating[];
    itemFeatures?: Record<string, number[]>;
    itemMeta?: Record<string, string>;
}

/** 推荐系统主类 */
class Recommender {
    ratings: Rating[] = [];
    users: string[] = [];
    items: string[] = [];
    userIndex: Map<string, number> = new Map();
    itemIndex: Map<string, number> = new Map();
    matrix: Float64Array; // users * items, 0 表示未评分
    itemFeatures: Map<string, number[]> = new Map();
    itemMeta: Map<string, string> = new Map();
    // 矩阵分解参数
    mfUserFactors: Float64Array | null = null;
    mfItemFactors: Float64Array | null = null;
    mfBiasUser: Float64Array | null = null;
    mfBiasItem: Float64Array | null = null;
    mfGlobalAvg = 0;
    mfK = 8;
    numUsers = 0;
    numItems = 0;

    constructor() {
        this.matrix = new Float64Array(0);
    }

    loadData(data: Dataset): void {
        this.ratings = data.ratings;
        this.itemFeatures = new Map(Object.entries(data.itemFeatures ?? {}));
        this.itemMeta = new Map(Object.entries(data.itemMeta ?? {}));
        // 收集 user/item
        const us = new Set<string>(), is = new Set<string>();
        for (const r of this.ratings) { us.add(r.user); is.add(r.item); }
        this.users = [...us];
        this.items = [...is];
        this.users.forEach((u, i) => this.userIndex.set(u, i));
        this.items.forEach((it, i) => this.itemIndex.set(it, i));
        this.numUsers = this.users.length;
        this.numItems = this.items.length;
        this.matrix = new Float64Array(this.numUsers * this.numItems);
        for (const r of this.ratings) {
            const ui = this.userIndex.get(r.user)!;
            const ii = this.itemIndex.get(r.item)!;
            this.matrix[ui * this.numItems + ii] = r.rating;
        }
    }

    addRating(user: string, item: string, rating: number): void {
        if (!this.userIndex.has(user)) {
            this.userIndex.set(user, this.numUsers);
            this.users.push(user);
            this.numUsers++;
            const newMat = new Float64Array(this.numUsers * this.numItems);
            newMat.set(this.matrix);
            this.matrix = newMat;
        }
        if (!this.itemIndex.has(item)) {
            this.itemIndex.set(item, this.numItems);
            this.items.push(item);
            this.numItems++;
            // 扩展列：每行追加一个 0
            const newMat = new Float64Array(this.numUsers * this.numItems);
            for (let u = 0; u < this.numUsers; u++) {
                for (let i = 0; i < this.numItems - 1; i++) {
                    newMat[u * this.numItems + i] = this.matrix[u * (this.numItems - 1) + i];
                }
            }
            this.matrix = newMat;
            this.mfUserFactors = null; // 失效缓存
        }
        const ui = this.userIndex.get(user)!;
        const ii = this.itemIndex.get(item)!;
        this.matrix[ui * this.numItems + ii] = rating;
        this.ratings.push({ user, item, rating });
    }

    /** 余弦相似度（两个评分向量，仅看共同评分项） */
    private cosineSparse(a: Float64Array, b: Float64Array, n: number): number {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < n; i++) {
            if (a[i] > 0 && b[i] > 0) {
                dot += a[i] * b[i];
                na += a[i] * a[i];
                nb += b[i] * b[i];
            }
        }
        if (na === 0 || nb === 0) return 0;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    /** 皮尔逊相关系数（用户向量） */
    private pearson(a: Float64Array, b: Float64Array, n: number): number {
        let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0, cnt = 0;
        for (let i = 0; i < n; i++) {
            if (a[i] > 0 && b[i] > 0) {
                sumA += a[i]; sumB += b[i];
                sumAB += a[i] * b[i];
                sumA2 += a[i] * a[i];
                sumB2 += b[i] * b[i];
                cnt++;
            }
        }
        if (cnt < 2) return 0;
        const meanA = sumA / cnt, meanB = sumB / cnt;
        let num = 0, dA = 0, dB = 0;
        for (let i = 0; i < n; i++) {
            if (a[i] > 0 && b[i] > 0) {
                const da = a[i] - meanA, db = b[i] - meanB;
                num += da * db; dA += da * da; dB += db * db;
            }
        }
        if (dA === 0 || dB === 0) return 0;
        return num / (Math.sqrt(dA) * Math.sqrt(dB));
    }

    /** 用户协同过滤预测评分 */
    predictUserCF(user: string, item: string): number {
        const ui = this.userIndex.get(user);
        const ii = this.itemIndex.get(item);
        if (ui === undefined || ii === undefined) return this.globalAvg();
        const targetVec = this.matrix.subarray(ui * this.numItems, (ui + 1) * this.numItems);
        let num = 0, den = 0;
        const targetMean = this.userMean(ui);
        for (let u = 0; u < this.numUsers; u++) {
            if (u === ui) continue;
            const r = this.matrix[u * this.numItems + ii];
            if (r === 0) continue;
            const vec = this.matrix.subarray(u * this.numItems, (u + 1) * this.numItems);
            const sim = this.pearson(targetVec, vec, this.numItems);
            if (sim <= 0) continue;
            const uMean = this.userMean(u);
            num += sim * (r - uMean);
            den += Math.abs(sim);
        }
        if (den === 0) return targetMean;
        return targetMean + num / den;
    }

    /** 物品协同过滤预测评分 */
    predictItemCF(user: string, item: string): number {
        const ui = this.userIndex.get(user);
        const ii = this.itemIndex.get(item);
        if (ui === undefined || ii === undefined) return this.globalAvg();
        const targetVec = new Float64Array(this.numUsers);
        for (let u = 0; u < this.numUsers; u++) targetVec[u] = this.matrix[u * this.numItems + ii];
        let num = 0, den = 0;
        for (let i = 0; i < this.numItems; i++) {
            if (i === ii) continue;
            const r = this.matrix[ui * this.numItems + i];
            if (r === 0) continue;
            const vec = new Float64Array(this.numUsers);
            for (let u = 0; u < this.numUsers; u++) vec[u] = this.matrix[u * this.numItems + i];
            const sim = this.cosineSparse(targetVec, vec, this.numUsers);
            if (sim <= 0) continue;
            num += sim * r;
            den += sim;
        }
        if (den === 0) return this.userMean(ui);
        return num / den;
    }

    /** 内容过滤预测：基于物品特征向量的余弦相似度 */
    predictContent(user: string, item: string): number {
        const ui = this.userIndex.get(user);
        const targetFeat = this.itemFeatures.get(item);
        if (ui === undefined || !targetFeat) return this.globalAvg();
        let num = 0, den = 0;
        for (let i = 0; i < this.numItems; i++) {
            const r = this.matrix[ui * this.numItems + i];
            if (r === 0) continue;
            const feat = this.itemFeatures.get(this.items[i]);
            if (!feat) continue;
            const sim = cosineDense(targetFeat, feat);
            if (sim <= 0) continue;
            num += sim * r;
            den += sim;
        }
        if (den === 0) return this.userMean(ui);
        return num / den;
    }

    /** 矩阵分解（SGD）训练 */
    trainMF(epochs = 100, lr = 0.01, reg = 0.1, k = 8): void {
        this.mfK = k;
        this.mfGlobalAvg = this.globalAvg();
        this.mfUserFactors = new Float64Array(this.numUsers * k).map(() => (Math.random() - 0.5) * 0.1);
        this.mfItemFactors = new Float64Array(this.numItems * k).map(() => (Math.random() - 0.5) * 0.1);
        this.mfBiasUser = new Float64Array(this.numUsers);
        this.mfBiasItem = new Float64Array(this.numItems);
        for (let e = 0; e < epochs; e++) {
            for (const r of this.ratings) {
                const u = this.userIndex.get(r.user)!;
                const i = this.itemIndex.get(r.item)!;
                let pred = this.mfGlobalAvg + this.mfBiasUser[u] + this.mfBiasItem[i];
                for (let f = 0; f < k; f++) pred += this.mfUserFactors[u * k + f] * this.mfItemFactors[i * k + f];
                const err = r.rating - pred;
                this.mfBiasUser[u] += lr * (err - reg * this.mfBiasUser[u]);
                this.mfBiasItem[i] += lr * (err - reg * this.mfBiasItem[i]);
                for (let f = 0; f < k; f++) {
                    const uf = this.mfUserFactors[u * k + f];
                    const vf = this.mfItemFactors[i * k + f];
                    this.mfUserFactors[u * k + f] += lr * (err * vf - reg * uf);
                    this.mfItemFactors[i * k + f] += lr * (err * uf - reg * vf);
                }
            }
        }
    }

    predictMF(user: string, item: string): number {
        const ui = this.userIndex.get(user);
        const ii = this.itemIndex.get(item);
        const uf = this.mfUserFactors;
        const vf = this.mfItemFactors;
        const bu = this.mfBiasUser;
        const bi = this.mfBiasItem;
        if (ui === undefined || ii === undefined || !uf || !vf || !bu || !bi) return this.globalAvg();
        let pred = this.mfGlobalAvg + bu[ui] + bi[ii];
        for (let f = 0; f < this.mfK; f++) {
            pred += uf[ui * this.mfK + f] * vf[ii * this.mfK + f];
        }
        return pred;
    }

    predict(user: string, item: string, algo: AlgoName): number {
        if (algo === "user-cf") return this.predictUserCF(user, item);
        if (algo === "item-cf") return this.predictItemCF(user, item);
        if (algo === "content") return this.predictContent(user, item);
        return this.predictMF(user, item);
    }

    /** 为用户推荐 Top-N（排除已评分） */
    recommend(user: string, n: number, algo: AlgoName): Array<{ item: string; score: number }> {
        const scored: Array<{ item: string; score: number }> = [];
        const ui = this.userIndex.get(user);
        for (const item of this.items) {
            const ii = this.itemIndex.get(item)!;
            if (ui !== undefined && this.matrix[ui * this.numItems + ii] > 0) continue;
            scored.push({ item, score: this.predict(user, item, algo) });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, n);
    }

    /** 与指定物品最相似的 N 个物品 */
    similarItems(item: string, n: number): Array<{ item: string; sim: number }> {
        const ii = this.itemIndex.get(item);
        if (ii === undefined) return [];
        const targetFeat = this.itemFeatures.get(item);
        const out: Array<{ item: string; sim: number }> = [];
        for (let i = 0; i < this.numItems; i++) {
            if (i === ii) continue;
            let sim = 0;
            if (targetFeat) {
                const f = this.itemFeatures.get(this.items[i]);
                if (f) sim = cosineDense(targetFeat, f);
            } else {
                const a = new Float64Array(this.numUsers);
                const b = new Float64Array(this.numUsers);
                for (let u = 0; u < this.numUsers; u++) {
                    a[u] = this.matrix[u * this.numItems + ii];
                    b[u] = this.matrix[u * this.numItems + i];
                }
                sim = this.cosineSparse(a, b, this.numUsers);
            }
            out.push({ item: this.items[i], sim });
        }
        out.sort((a, b) => b.sim - a.sim);
        return out.slice(0, n);
    }

    /** RMSE 评估（留一法或全部训练集） */
    evaluateRMSE(algo: AlgoName): number {
        if (algo === "mf" && !this.mfUserFactors) this.trainMF();
        let sum = 0, cnt = 0;
        for (const r of this.ratings) {
            const p = this.predict(r.user, r.item, algo);
            sum += (r.rating - p) ** 2;
            cnt++;
        }
        return Math.sqrt(sum / cnt);
    }

    /** Precision@K 评估：将高分(>=阈值)视为相关，推荐 Top-K 中相关比例 */
    evaluatePrecisionAtK(algo: AlgoName, k: number, threshold: number): number {
        if (algo === "mf" && !this.mfUserFactors) this.trainMF();
        let totalPrec = 0, userCnt = 0;
        for (const user of this.users) {
            const ui = this.userIndex.get(user)!;
            // 该用户的高分相关物品
            const relevant = new Set<string>();
            for (let i = 0; i < this.numItems; i++) {
                if (this.matrix[ui * this.numItems + i] >= threshold) relevant.add(this.items[i]);
            }
            if (relevant.size === 0) continue;
            const recs = this.recommend(user, k, algo);
            const hits = recs.filter((r) => relevant.has(r.item)).length;
            totalPrec += hits / k;
            userCnt++;
        }
        return userCnt > 0 ? totalPrec / userCnt : 0;
    }

    private userMean(ui: number): number {
        let sum = 0, cnt = 0;
        for (let i = 0; i < this.numItems; i++) {
            const v = this.matrix[ui * this.numItems + i];
            if (v > 0) { sum += v; cnt++; }
        }
        return cnt > 0 ? sum / cnt : this.globalAvg();
    }

    globalAvg(): number {
        let sum = 0, cnt = 0;
        for (const v of this.matrix) if (v > 0) { sum += v; cnt++; }
        return cnt > 0 ? sum / cnt : 0;
    }
}

function cosineDense(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 内置电影评分演示数据 */
function builtinMovieDataset(): Dataset {
    const ratings: Rating[] = [
        { user: "U1", item: "动作片A", rating: 5 }, { user: "U1", item: "动作片B", rating: 4 },
        { user: "U1", item: "喜剧A", rating: 2 }, { user: "U1", item: "爱情A", rating: 1 },
        { user: "U2", item: "动作片A", rating: 4 }, { user: "U2", item: "动作片B", rating: 5 },
        { user: "U2", item: "科幻A", rating: 4 }, { user: "U2", item: "喜剧A", rating: 1 },
        { user: "U3", item: "喜剧A", rating: 5 }, { user: "U3", item: "爱情A", rating: 4 },
        { user: "U3", item: "喜剧B", rating: 5 }, { user: "U3", item: "动作片A", rating: 1 },
        { user: "U4", item: "喜剧A", rating: 4 }, { user: "U4", item: "爱情A", rating: 5 },
        { user: "U4", item: "喜剧B", rating: 4 }, { user: "U4", item: "爱情B", rating: 5 },
        { user: "U5", item: "科幻A", rating: 5 }, { user: "U5", item: "科幻B", rating: 5 },
        { user: "U5", item: "动作片A", rating: 3 }, { user: "U5", item: "动作片B", rating: 4 },
        { user: "U6", item: "科幻A", rating: 4 }, { user: "U6", item: "科幻B", rating: 4 },
        { user: "U6", item: "喜剧B", rating: 3 }, { user: "U6", item: "爱情B", rating: 2 },
    ];
    // 物品特征：[动作, 喜剧, 爱情, 科幻]
    const itemFeatures: Record<string, number[]> = {
        "动作片A": [1, 0, 0, 0], "动作片B": [1, 0, 0, 0],
        "喜剧A": [0, 1, 0, 0], "喜剧B": [0, 1, 0, 0],
        "爱情A": [0, 0, 1, 0], "爱情B": [0, 0, 1, 0],
        "科幻A": [0, 0, 0, 1], "科幻B": [0, 0, 0, 1],
    };
    return { ratings, itemFeatures };
}

interface ParsedArgs {
    command: string;
    dataFile: string;
    userId: string;
    itemId: string;
    rating: number;
    n: number;
    algo: AlgoName;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let dataFile = "", userId = "", itemId = "", rating = 0;
    let n = 5, algo: AlgoName = "user-cf";
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-n": { const v = parseInt(rest[++i] ?? "", 10); if (!isNaN(v) && v > 0) n = v; break; }
            case "-a": case "--algo": {
                const v = rest[++i] as AlgoName;
                if (v === "user-cf" || v === "item-cf" || v === "content" || v === "mf") algo = v;
                break;
            }
            default:
                if (!a.startsWith("-")) {
                    if (command === "train" && dataFile === "") dataFile = a;
                    else if (command === "recommend" && userId === "") userId = a;
                    else if (command === "similar" && itemId === "") itemId = a;
                    else if (command === "add") {
                        if (userId === "") userId = a;
                        else if (itemId === "") itemId = a;
                        else { const v = parseFloat(a); if (!isNaN(v)) rating = v; }
                    }
                }
        }
    }
    return { command, dataFile, userId, itemId, rating, n, algo };
}

function printHelp(): void {
    console.log(`
简易推荐系统 (Simple Recommender)

用法:
  demo                                      使用内置电影评分数据集演示
  train <ratings.json>                      从 JSON 加载评分数据
  recommend <userId> [-n count] [-a algo]   为用户推荐 Top-N
  similar <itemId> [-n count]               找最相似的物品
  evaluate [-a algo]                        评估 RMSE 与 Precision@5
  add <userId> <itemId> <rating>            添加一条评分

算法 (-a): user-cf(默认) | item-cf | content | mf

示例:
  node dist/index.js demo
  node dist/index.js recommend U1 -n 3 -a item-cf
  node dist/index.js similar 科幻A -n 3
`);
}

function runDemo(): void {
    console.log("=== 内置电影评分数据集演示 ===");
    const rec = new Recommender();
    rec.loadData(builtinMovieDataset());
    console.log(`用户数: ${rec.users.length}  物品数: ${rec.items.length}  评分数: ${rec.ratings.length}`);
    console.log(`全局平均分: ${rec.globalAvg().toFixed(2)}`);
    rec.trainMF(80, 0.02, 0.1, 6);
    for (const algo of ["user-cf", "item-cf", "content", "mf"] as AlgoName[]) {
        const rmse = rec.evaluateRMSE(algo);
        const p5 = rec.evaluatePrecisionAtK(algo, 3, 4);
        console.log(`[${algo.padEnd(8)}] 训练集 RMSE=${rmse.toFixed(4)}  P@3=${p5.toFixed(4)}`);
    }
    console.log("\n给 U3 推荐前 3（用户协同过滤）:");
    for (const r of rec.recommend("U3", 3, "user-cf")) {
        console.log(`  ${r.item}  预测分=${r.score.toFixed(3)}`);
    }
    console.log("\n与 '科幻A' 最相似的 3 个物品:");
    for (const r of rec.similarItems("科幻A", 3)) {
        console.log(`  ${r.item}  相似度=${r.sim.toFixed(3)}`);
    }
}

function main(): void {
    const opts = parseArgs(process.argv);
    switch (opts.command) {
        case "demo": runDemo(); break;
        case "train": {
            if (!opts.dataFile) { console.error("错误：缺少 <ratings.json>"); process.exit(1); }
            const data = JSON.parse(fs.readFileSync(opts.dataFile, "utf-8")) as Dataset;
            const rec = new Recommender();
            rec.loadData(data);
            console.log(`已加载: 用户 ${rec.users.length}, 物品 ${rec.items.length}, 评分 ${rec.ratings.length}`);
            break;
        }
        case "recommend": {
            if (!opts.userId) { console.error("错误：缺少 <userId>"); process.exit(1); }
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            if (opts.algo === "mf") rec.trainMF();
            console.log(`推荐 (${opts.algo}) 给 ${opts.userId} 前 ${opts.n}:`);
            for (const r of rec.recommend(opts.userId, opts.n, opts.algo)) {
                console.log(`  ${r.item}  预测分=${r.score.toFixed(3)}`);
            }
            break;
        }
        case "similar": {
            if (!opts.itemId) { console.error("错误：缺少 <itemId>"); process.exit(1); }
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            console.log(`与 '${opts.itemId}' 最相似的 ${opts.n} 个物品:`);
            for (const r of rec.similarItems(opts.itemId, opts.n)) {
                console.log(`  ${r.item}  相似度=${r.sim.toFixed(3)}`);
            }
            break;
        }
        case "evaluate": {
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            if (opts.algo === "mf") rec.trainMF();
            console.log(`[${opts.algo}] RMSE=${rec.evaluateRMSE(opts.algo).toFixed(4)}`);
            console.log(`[${opts.algo}] P@5=${rec.evaluatePrecisionAtK(opts.algo, 5, 4).toFixed(4)}`);
            break;
        }
        case "add": {
            if (!opts.userId || !opts.itemId || !opts.rating) {
                console.error("错误：用法 add <userId> <itemId> <rating>"); process.exit(1);
            }
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            rec.addRating(opts.userId, opts.itemId, opts.rating);
            console.log(`已添加: ${opts.userId} -> ${opts.itemId} = ${opts.rating}`);
            console.log(`现用户数: ${rec.users.length}, 物品数: ${rec.items.length}`);
            break;
        }
        default: console.error(`未知命令: ${opts.command}`); printHelp(); process.exit(1);
    }
}

main();
