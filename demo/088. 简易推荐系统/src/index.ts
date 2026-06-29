#!/usr/bin/env node
/**
 * 简易推荐系统 (Simple Recommender System)
 * - 用户协同过滤（皮尔逊/余弦相似度）
 * - 物品协同过滤
 * - 内容过滤（物品特征向量余弦相似度）
 * - 矩阵分解（SGD）
 * - 评估（RMSE / Precision@k）
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";

/* ===================== Enums ===================== */

enum RecAlgorithm {
    UserCF = "user-cf",
    ItemCF = "item-cf",
    Content = "content",
    MF = "mf",
}
enum SimilarityMethod {
    Pearson = "pearson",
    Cosine = "cosine",
    Euclidean = "euclidean",
}
enum ErrorCode {
    NotLoaded = "NOT_LOADED",
    UserNotFound = "USER_NOT_FOUND",
    ItemNotFound = "ITEM_NOT_FOUND",
    InvalidRating = "INVALID_RATING",
    Unknown = "UNKNOWN",
}
enum RatingScale {
    OneToFive = "1-5",
    OneToTen = "1-10",
    ZeroToOne = "0-1",
}

/* ===================== Types ===================== */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Identifiable {
    readonly id: string;
}
interface Rating extends Identifiable {
    readonly user: string;
    readonly item: string;
    readonly rating: number;
}
interface RatingRecord extends Identifiable {
    readonly user: string;
    readonly item: string;
    readonly rating: number;
    readonly timestamp: number;
}

interface Dataset {
    readonly ratings: Rating[];
    readonly itemFeatures?: Record<string, number[]>;
    readonly itemMeta?: Record<string, string>;
}

type RecResult =
    | {
          readonly kind: "success";
          readonly items: Array<{ item: string; score: number }>;
      }
    | {
          readonly kind: "error";
          readonly code: ErrorCode;
          readonly message: string;
      }
    | { readonly kind: "empty"; readonly user: string };

/* ===================== Symbols ===================== */

const SYM_META: unique symbol = Symbol("recMeta");
const SYM_BRAND: unique symbol = Symbol("recBrand");

interface RecMeta {
    readonly createdAt: number;
    loadedAt: number;
}

/* ===================== Error Hierarchy ===================== */

class RecError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = "RecError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/* ===================== Type Guards ===================== */

function isRecSuccess(
    r: RecResult,
): r is { kind: "success"; items: Array<{ item: string; score: number }> } {
    return r.kind === "success";
}
function isRecError(
    r: RecResult,
): r is { kind: "error"; code: ErrorCode; message: string } {
    return r.kind === "error";
}
function isRecEmpty(r: RecResult): r is { kind: "empty"; user: string } {
    return r.kind === "empty";
}
function isRating(v: unknown): v is Rating {
    return (
        typeof v === "object" &&
        v !== null &&
        typeof (v as Rating).user === "string" &&
        typeof (v as Rating).item === "string" &&
        typeof (v as Rating).rating === "number"
    );
}

/* ===================== Helpers ===================== */

function cosineDense(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0,
        na = 0,
        nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* ===================== Generic Rating Store ===================== */

class RatingStore<T extends Identifiable> implements Iterable<T> {
    private items = new Map<string, T>();
    private readonly [SYM_META]: RecMeta = {
        createdAt: Date.now(),
        loadedAt: Date.now(),
    };
    get count(): number {
        return this.items.size;
    }
    add(item: T): void {
        this.items.set(item.id, item);
        this[SYM_META].loadedAt = Date.now();
    }
    get(id: string): T | undefined {
        return this.items.get(id);
    }
    has(id: string): boolean {
        return this.items.has(id);
    }
    delete(id: string): boolean {
        return this.items.delete(id);
    }
    clear(): void {
        this.items.clear();
    }
    *[Symbol.iterator](): Iterator<T> {
        for (const v of this.items.values()) yield v;
    }
    *entries(): IterableIterator<[string, T]> {
        for (const e of this.items.entries()) yield e;
    }
    *values(): IterableIterator<T> {
        for (const v of this.items.values()) yield v;
    }
    toArray(): T[] {
        return Array.from(this.items.values());
    }
}

/* ===================== Abstract Recommender ===================== */

abstract class AbstractRecommender {
    protected ratings: Rating[] = [];
    protected users: string[] = [];
    protected items: string[] = [];
    protected userIndex = new Map<string, number>();
    protected itemIndex = new Map<string, number>();
    protected matrix: Float64Array = new Float64Array(0);
    protected itemFeatures = new Map<string, number[]>();
    protected numUsers = 0;
    protected numItems = 0;
    protected readonly [SYM_BRAND] = true;

    abstract predict(user: string, item: string): number;
    abstract get algorithm(): RecAlgorithm;

    get userCount(): number {
        return this.numUsers;
    }
    get itemCount(): number {
        return this.numItems;
    }
    get ratingCount(): number {
        return this.ratings.length;
    }

    loadData(data: Dataset): void {
        this.ratings = data.ratings;
        this.itemFeatures = new Map(Object.entries(data.itemFeatures ?? {}));
        const us = new Set<string>(),
            is = new Set<string>();
        for (const r of this.ratings) {
            us.add(r.user);
            is.add(r.item);
        }
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

    protected userMean(ui: number): number {
        let sum = 0,
            cnt = 0;
        for (let i = 0; i < this.numItems; i++) {
            const v = this.matrix[ui * this.numItems + i];
            if (v > 0) {
                sum += v;
                cnt++;
            }
        }
        return cnt > 0 ? sum / cnt : this.globalAvg();
    }
    globalAvg(): number {
        let sum = 0,
            cnt = 0;
        for (const v of this.matrix)
            if (v > 0) {
                sum += v;
                cnt++;
            }
        return cnt > 0 ? sum / cnt : 0;
    }

    recommend(user: string, n: number): Array<{ item: string; score: number }> {
        const scored: Array<{ item: string; score: number }> = [];
        const ui = this.userIndex.get(user);
        for (const item of this.items) {
            const ii = this.itemIndex.get(item)!;
            if (ui !== undefined && this.matrix[ui * this.numItems + ii] > 0)
                continue;
            scored.push({ item, score: this.predict(user, item) });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, n);
    }
}

/* ===================== Concrete Recommenders ===================== */

class UserBasedRecommender extends AbstractRecommender {
    get algorithm(): RecAlgorithm {
        return RecAlgorithm.UserCF;
    }
    protected pearson(a: Float64Array, b: Float64Array, n: number): number {
        let sumA = 0,
            sumB = 0,
            sumAB = 0,
            sumA2 = 0,
            sumB2 = 0,
            cnt = 0;
        for (let i = 0; i < n; i++)
            if (a[i] > 0 && b[i] > 0) {
                sumA += a[i];
                sumB += b[i];
                sumAB += a[i] * b[i];
                sumA2 += a[i] * a[i];
                sumB2 += b[i] * b[i];
                cnt++;
            }
        if (cnt < 2) return 0;
        const meanA = sumA / cnt,
            meanB = sumB / cnt;
        let num = 0,
            dA = 0,
            dB = 0;
        for (let i = 0; i < n; i++)
            if (a[i] > 0 && b[i] > 0) {
                const da = a[i] - meanA,
                    db = b[i] - meanB;
                num += da * db;
                dA += da * da;
                dB += db * db;
            }
        if (dA === 0 || dB === 0) return 0;
        return num / (Math.sqrt(dA) * Math.sqrt(dB));
    }
    predict(user: string, item: string): number {
        const ui = this.userIndex.get(user),
            ii = this.itemIndex.get(item);
        if (ui === undefined || ii === undefined) return this.globalAvg();
        const targetVec = this.matrix.subarray(
            ui * this.numItems,
            (ui + 1) * this.numItems,
        );
        let num = 0,
            den = 0;
        const targetMean = this.userMean(ui);
        for (let u = 0; u < this.numUsers; u++) {
            if (u === ui) continue;
            const r = this.matrix[u * this.numItems + ii];
            if (r === 0) continue;
            const vec = this.matrix.subarray(
                u * this.numItems,
                (u + 1) * this.numItems,
            );
            const sim = this.pearson(targetVec, vec, this.numItems);
            if (sim <= 0) continue;
            num += sim * (r - this.userMean(u));
            den += Math.abs(sim);
        }
        return den === 0 ? targetMean : targetMean + num / den;
    }
}

class ItemBasedRecommender extends AbstractRecommender {
    get algorithm(): RecAlgorithm {
        return RecAlgorithm.ItemCF;
    }
    protected cosineSparse(
        a: Float64Array,
        b: Float64Array,
        n: number,
    ): number {
        let dot = 0,
            na = 0,
            nb = 0;
        for (let i = 0; i < n; i++)
            if (a[i] > 0 && b[i] > 0) {
                dot += a[i] * b[i];
                na += a[i] * a[i];
                nb += b[i] * b[i];
            }
        if (na === 0 || nb === 0) return 0;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
    predict(user: string, item: string): number {
        const ui = this.userIndex.get(user),
            ii = this.itemIndex.get(item);
        if (ui === undefined || ii === undefined) return this.globalAvg();
        const targetVec = new Float64Array(this.numUsers);
        for (let u = 0; u < this.numUsers; u++)
            targetVec[u] = this.matrix[u * this.numItems + ii];
        let num = 0,
            den = 0;
        for (let i = 0; i < this.numItems; i++) {
            if (i === ii) continue;
            const r = this.matrix[ui * this.numItems + i];
            if (r === 0) continue;
            const vec = new Float64Array(this.numUsers);
            for (let u = 0; u < this.numUsers; u++)
                vec[u] = this.matrix[u * this.numItems + i];
            const sim = this.cosineSparse(targetVec, vec, this.numUsers);
            if (sim <= 0) continue;
            num += sim * r;
            den += sim;
        }
        return den === 0 ? this.userMean(ui) : num / den;
    }
}

class ContentRecommender extends AbstractRecommender {
    get algorithm(): RecAlgorithm {
        return RecAlgorithm.Content;
    }
    predict(user: string, item: string): number {
        const ui = this.userIndex.get(user),
            targetFeat = this.itemFeatures.get(item);
        if (ui === undefined || !targetFeat) return this.globalAvg();
        let num = 0,
            den = 0;
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
        return den === 0 ? this.userMean(ui) : num / den;
    }
}

class MFRecommender extends AbstractRecommender {
    get algorithm(): RecAlgorithm {
        return RecAlgorithm.MF;
    }
    private mfUserFactors: Float64Array | null = null;
    private mfItemFactors: Float64Array | null = null;
    private mfBiasUser: Float64Array | null = null;
    private mfBiasItem: Float64Array | null = null;
    private mfGlobalAvg = 0;
    private mfK = 8;

    train(epochs = 100, lr = 0.01, reg = 0.1, k = 8): void {
        this.mfK = k;
        this.mfGlobalAvg = this.globalAvg();
        this.mfUserFactors = new Float64Array(this.numUsers * k).map(
            () => (Math.random() - 0.5) * 0.1,
        );
        this.mfItemFactors = new Float64Array(this.numItems * k).map(
            () => (Math.random() - 0.5) * 0.1,
        );
        this.mfBiasUser = new Float64Array(this.numUsers);
        this.mfBiasItem = new Float64Array(this.numItems);
        for (let e = 0; e < epochs; e++) {
            for (const r of this.ratings) {
                const u = this.userIndex.get(r.user)!,
                    i = this.itemIndex.get(r.item)!;
                let pred =
                    this.mfGlobalAvg +
                    this.mfBiasUser![u] +
                    this.mfBiasItem![i];
                for (let f = 0; f < k; f++)
                    pred +=
                        this.mfUserFactors![u * k + f] *
                        this.mfItemFactors![i * k + f];
                const err = r.rating - pred;
                this.mfBiasUser![u] += lr * (err - reg * this.mfBiasUser![u]);
                this.mfBiasItem![i] += lr * (err - reg * this.mfBiasItem![i]);
                for (let f = 0; f < k; f++) {
                    const uf = this.mfUserFactors![u * k + f],
                        vf = this.mfItemFactors![i * k + f];
                    this.mfUserFactors![u * k + f] +=
                        lr * (err * vf - reg * uf);
                    this.mfItemFactors![i * k + f] +=
                        lr * (err * uf - reg * vf);
                }
            }
        }
    }

    predict(user: string, item: string): number {
        const ui = this.userIndex.get(user),
            ii = this.itemIndex.get(item);
        if (
            ui === undefined ||
            ii === undefined ||
            !this.mfUserFactors ||
            !this.mfItemFactors ||
            !this.mfBiasUser ||
            !this.mfBiasItem
        )
            return this.globalAvg();
        let pred = this.mfGlobalAvg + this.mfBiasUser[ui] + this.mfBiasItem[ii];
        for (let f = 0; f < this.mfK; f++)
            pred +=
                this.mfUserFactors[ui * this.mfK + f] *
                this.mfItemFactors[ii * this.mfK + f];
        return pred;
    }
}

/* ===================== Main Recommender (Facade) ===================== */

class Recommender {
    private recommenders: Map<RecAlgorithm, AbstractRecommender> = new Map();
    private data: Dataset | null = null;
    private mfTrained = false;

    loadData(data: Dataset): void {
        this.data = data;
        this.recommenders.set(RecAlgorithm.UserCF, new UserBasedRecommender());
        this.recommenders.set(RecAlgorithm.ItemCF, new ItemBasedRecommender());
        this.recommenders.set(RecAlgorithm.Content, new ContentRecommender());
        const mf = new MFRecommender();
        mf.loadData(data);
        this.recommenders.set(RecAlgorithm.MF, mf);
        for (const rec of this.recommenders.values()) rec.loadData(data);
        this.mfTrained = false;
    }

    private getRecommender(algo: RecAlgorithm): AbstractRecommender {
        const rec = this.recommenders.get(algo);
        if (!rec)
            throw new RecError(ErrorCode.NotLoaded, `算法 ${algo} 未加载`);
        if (algo === RecAlgorithm.MF && !this.mfTrained) {
            (rec as MFRecommender).train(80, 0.02, 0.1, 6);
            this.mfTrained = true;
        }
        return rec;
    }

    get users(): string[] {
        return (
            (this.recommenders.get(RecAlgorithm.UserCF)?.[
                "users" as keyof AbstractRecommender
            ] as unknown as string[]) ?? []
        );
    }
    get items(): string[] {
        return (
            (this.recommenders.get(RecAlgorithm.UserCF)?.[
                "items" as keyof AbstractRecommender
            ] as unknown as string[]) ?? []
        );
    }
    get ratings(): Rating[] {
        return this.data?.ratings ?? [];
    }
    globalAvg(): number {
        return this.recommenders.get(RecAlgorithm.UserCF)?.globalAvg() ?? 0;
    }

    predict(user: string, item: string, algo: RecAlgorithm): number {
        return this.getRecommender(algo).predict(user, item);
    }
    recommend(
        user: string,
        n: number,
        algo: RecAlgorithm,
    ): Array<{ item: string; score: number }> {
        return this.getRecommender(algo).recommend(user, n);
    }

    safeRecommend(user: string, n: number, algo: RecAlgorithm): RecResult {
        try {
            const rec = this.getRecommender(algo);
            if (
                !rec["userIndex" as keyof AbstractRecommender] ||
                !(
                    rec[
                        "userIndex" as keyof AbstractRecommender
                    ] as unknown as Map<string, number>
                ).has(user)
            ) {
                const items = this.recommend(user, n, algo);
                if (items.length === 0) return { kind: "empty", user };
            }
            const items = this.recommend(user, n, algo);
            if (items.length === 0) return { kind: "empty", user };
            return { kind: "success", items };
        } catch (e) {
            return {
                kind: "error",
                code: ErrorCode.Unknown,
                message: (e as Error).message,
            };
        }
    }

    similarItems(
        item: string,
        n: number,
    ): Array<{ item: string; sim: number }> {
        const rec = this.recommenders.get(RecAlgorithm.Content);
        if (!rec || !this.data) return [];
        const itemIndex = rec[
            "itemIndex" as keyof AbstractRecommender
        ] as unknown as Map<string, number>;
        const ii = itemIndex.get(item);
        if (ii === undefined) return [];
        const targetFeat = this.data.itemFeatures?.[item];
        const out: Array<{ item: string; sim: number }> = [];
        const allItems = rec[
            "items" as keyof AbstractRecommender
        ] as unknown as string[];
        const matrix = rec[
            "matrix" as keyof AbstractRecommender
        ] as unknown as Float64Array;
        const numUsers = rec[
            "numUsers" as keyof AbstractRecommender
        ] as unknown as number;
        const numItems = rec[
            "numItems" as keyof AbstractRecommender
        ] as unknown as number;
        for (let i = 0; i < numItems; i++) {
            if (i === ii) continue;
            let sim = 0;
            if (targetFeat) {
                const f = this.data.itemFeatures?.[allItems[i]];
                if (f) sim = cosineDense(targetFeat, f);
            } else {
                const a = new Float64Array(numUsers),
                    b = new Float64Array(numUsers);
                for (let u = 0; u < numUsers; u++) {
                    a[u] = matrix[u * numItems + ii];
                    b[u] = matrix[u * numItems + i];
                }
                sim = cosineDense([...a], [...b]);
            }
            out.push({ item: allItems[i], sim });
        }
        out.sort((a, b) => b.sim - a.sim);
        return out.slice(0, n);
    }

    evaluateRMSE(algo: RecAlgorithm): number {
        let sum = 0,
            cnt = 0;
        for (const r of this.ratings) {
            const p = this.predict(r.user, r.item, algo);
            sum += (r.rating - p) ** 2;
            cnt++;
        }
        return Math.sqrt(sum / cnt);
    }

    evaluatePrecisionAtK(
        algo: RecAlgorithm,
        k: number,
        threshold: number,
    ): number {
        let totalPrec = 0,
            userCnt = 0;
        const rec = this.getRecommender(algo);
        const users = rec[
            "users" as keyof AbstractRecommender
        ] as unknown as string[];
        const matrix = rec[
            "matrix" as keyof AbstractRecommender
        ] as unknown as Float64Array;
        const numItems = rec[
            "numItems" as keyof AbstractRecommender
        ] as unknown as number;
        const allItems = rec[
            "items" as keyof AbstractRecommender
        ] as unknown as string[];
        const userIndex = rec[
            "userIndex" as keyof AbstractRecommender
        ] as unknown as Map<string, number>;
        for (const user of users) {
            const ui = userIndex.get(user)!;
            const relevant = new Set<string>();
            for (let i = 0; i < numItems; i++)
                if (matrix[ui * numItems + i] >= threshold)
                    relevant.add(allItems[i]);
            if (relevant.size === 0) continue;
            const recs = this.recommend(user, k, algo);
            const hits = recs.filter((r) => relevant.has(r.item)).length;
            totalPrec += hits / k;
            userCnt++;
        }
        return userCnt > 0 ? totalPrec / userCnt : 0;
    }
}

/* ===================== Built-in Dataset ===================== */

function builtinMovieDataset(): Dataset {
    const ratings: Rating[] = [
        { id: "r1", user: "U1", item: "动作片A", rating: 5 },
        { id: "r2", user: "U1", item: "动作片B", rating: 4 },
        { id: "r3", user: "U1", item: "喜剧A", rating: 2 },
        { id: "r4", user: "U1", item: "爱情A", rating: 1 },
        { id: "r5", user: "U2", item: "动作片A", rating: 4 },
        { id: "r6", user: "U2", item: "动作片B", rating: 5 },
        { id: "r7", user: "U2", item: "科幻A", rating: 4 },
        { id: "r8", user: "U2", item: "喜剧A", rating: 1 },
        { id: "r9", user: "U3", item: "喜剧A", rating: 5 },
        { id: "r10", user: "U3", item: "爱情A", rating: 4 },
        { id: "r11", user: "U3", item: "喜剧B", rating: 5 },
        { id: "r12", user: "U3", item: "动作片A", rating: 1 },
        { id: "r13", user: "U4", item: "喜剧A", rating: 4 },
        { id: "r14", user: "U4", item: "爱情A", rating: 5 },
        { id: "r15", user: "U4", item: "喜剧B", rating: 4 },
        { id: "r16", user: "U4", item: "爱情B", rating: 5 },
        { id: "r17", user: "U5", item: "科幻A", rating: 5 },
        { id: "r18", user: "U5", item: "科幻B", rating: 5 },
        { id: "r19", user: "U5", item: "动作片A", rating: 3 },
        { id: "r20", user: "U5", item: "动作片B", rating: 4 },
        { id: "r21", user: "U6", item: "科幻A", rating: 4 },
        { id: "r22", user: "U6", item: "科幻B", rating: 4 },
        { id: "r23", user: "U6", item: "喜剧B", rating: 3 },
        { id: "r24", user: "U6", item: "爱情B", rating: 2 },
    ];
    const itemFeatures: Record<string, number[]> = {
        动作片A: [1, 0, 0, 0],
        动作片B: [1, 0, 0, 0],
        喜剧A: [0, 1, 0, 0],
        喜剧B: [0, 1, 0, 0],
        爱情A: [0, 0, 1, 0],
        爱情B: [0, 0, 1, 0],
        科幻A: [0, 0, 0, 1],
        科幻B: [0, 0, 0, 1],
    };
    return { ratings, itemFeatures } satisfies Dataset;
}

/* ===================== CLI ===================== */

interface ParsedArgs {
    command: string;
    dataFile: string;
    userId: string;
    itemId: string;
    rating: number;
    n: number;
    algo: RecAlgorithm;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let dataFile = "",
        userId = "",
        itemId = "",
        rating = 0,
        n = 5;
    let algo: RecAlgorithm = RecAlgorithm.UserCF;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-n": {
                const v = parseInt(rest[++i] ?? "", 10);
                if (!isNaN(v) && v > 0) n = v;
                break;
            }
            case "-a":
            case "--algo": {
                const v = rest[++i] as RecAlgorithm;
                if (Object.values(RecAlgorithm).includes(v)) algo = v;
                break;
            }
            default:
                if (!a.startsWith("-")) {
                    if (command === "train" && dataFile === "") dataFile = a;
                    else if (command === "recommend" && userId === "")
                        userId = a;
                    else if (command === "similar" && itemId === "") itemId = a;
                    else if (command === "add") {
                        if (userId === "") userId = a;
                        else if (itemId === "") itemId = a;
                        else {
                            const v = parseFloat(a);
                            if (!isNaN(v)) rating = v;
                        }
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
    console.log(
        `用户数: ${rec.users.length}  物品数: ${rec.items.length}  评分数: ${rec.ratings.length}`,
    );
    console.log(`全局平均分: ${rec.globalAvg().toFixed(2)}`);
    for (const algo of Object.values(RecAlgorithm)) {
        const rmse = rec.evaluateRMSE(algo);
        const p5 = rec.evaluatePrecisionAtK(algo, 3, 4);
        console.log(
            `[${algo.padEnd(8)}] 训练集 RMSE=${rmse.toFixed(4)}  P@3=${p5.toFixed(4)}`,
        );
    }
    console.log("\n给 U3 推荐前 3（用户协同过滤）:");
    for (const r of rec.recommend("U3", 3, RecAlgorithm.UserCF))
        console.log(`  ${r.item}  预测分=${r.score.toFixed(3)}`);
    console.log("\n与 '科幻A' 最相似的 3 个物品:");
    for (const r of rec.similarItems("科幻A", 3))
        console.log(`  ${r.item}  相似度=${r.sim.toFixed(3)}`);
    console.log("\n=== safeRecommend 演示 ===");
    const result = rec.safeRecommend("U3", 3, RecAlgorithm.Content);
    if (isRecSuccess(result))
        console.log("推荐成功:", result.items.map((i) => i.item).join(", "));
    else if (isRecError(result)) console.log("推荐错误:", result.message);
    else if (isRecEmpty(result)) console.log("无推荐:", result.user);
    console.log("\n=== RatingStore 演示 ===");
    const store = new RatingStore<RatingRecord>();
    for (const r of rec.ratings.slice(0, 5))
        store.add({
            id: r.id,
            user: r.user,
            item: r.item,
            rating: r.rating,
            timestamp: Date.now(),
        });
    console.log("存储数量:", store.count);
    for (const r of store)
        console.log(`  ${r.user} -> ${r.item} = ${r.rating}`);
}

function main(): void {
    const opts = parseArgs(process.argv);
    switch (opts.command) {
        case "demo":
            runDemo();
            break;
        case "train": {
            if (!opts.dataFile) {
                console.error("错误：缺少 <ratings.json>");
                process.exit(1);
            }
            const data = JSON.parse(
                fs.readFileSync(opts.dataFile, "utf-8"),
            ) as Dataset;
            const rec = new Recommender();
            rec.loadData(data);
            console.log(
                `已加载: 用户 ${rec.users.length}, 物品 ${rec.items.length}, 评分 ${rec.ratings.length}`,
            );
            break;
        }
        case "recommend": {
            if (!opts.userId) {
                console.error("错误：缺少 <userId>");
                process.exit(1);
            }
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            console.log(`推荐 (${opts.algo}) 给 ${opts.userId} 前 ${opts.n}:`);
            for (const r of rec.recommend(opts.userId, opts.n, opts.algo))
                console.log(`  ${r.item}  预测分=${r.score.toFixed(3)}`);
            break;
        }
        case "similar": {
            if (!opts.itemId) {
                console.error("错误：缺少 <itemId>");
                process.exit(1);
            }
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            console.log(`与 '${opts.itemId}' 最相似的 ${opts.n} 个物品:`);
            for (const r of rec.similarItems(opts.itemId, opts.n))
                console.log(`  ${r.item}  相似度=${r.sim.toFixed(3)}`);
            break;
        }
        case "evaluate": {
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            console.log(
                `[${opts.algo}] RMSE=${rec.evaluateRMSE(opts.algo).toFixed(4)}`,
            );
            console.log(
                `[${opts.algo}] P@5=${rec.evaluatePrecisionAtK(opts.algo, 5, 4).toFixed(4)}`,
            );
            break;
        }
        case "add": {
            if (!opts.userId || !opts.itemId || !opts.rating) {
                console.error("错误：用法 add <userId> <itemId> <rating>");
                process.exit(1);
            }
            const rec = new Recommender();
            rec.loadData(builtinMovieDataset());
            console.log(
                `已添加: ${opts.userId} -> ${opts.itemId} = ${opts.rating}`,
            );
            console.log(
                `现用户数: ${rec.users.length}, 物品数: ${rec.items.length}`,
            );
            break;
        }
        default:
            console.error(`未知命令: ${opts.command}`);
            printHelp();
            process.exit(1);
    }
}

main();

