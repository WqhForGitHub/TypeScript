#!/usr/bin/env node

/**
 * 遗传算法示例 (Genetic Algorithm Demo)
 * 一个使用纯 TypeScript 编写的通用遗传算法框架与多种演示。
 * 支持：二进制/字符串/数组三种编码、轮盘赌+锦标赛+精英选择、
 * 单点/两点/均匀交叉、位翻/交换/乱序变异、多种终止条件。
 * 内置演示：单词匹配、背包、TSP、函数最大化、自定义问题。
 * 仅使用 Node.js 内置模块（fs, path）。
 */

import * as fs from "fs";
import * as path from "path";

/** 染色体编码类型 */
type Encoding = "binary" | "string" | "array";
type SelectionMethod = "roulette" | "tournament" | "elitism";
type CrossoverMethod = "single" | "two" | "uniform";
type MutationMethod = "flip" | "swap" | "scramble";

interface GAConfig {
    encoding: Encoding;
    geneLength: number;
    populationSize: number;
    generations: number;
    crossoverRate: number;
    mutationRate: number;
    selection: SelectionMethod;
    crossover: CrossoverMethod;
    mutation: MutationMethod;
    elitismCount: number;
    tournamentSize: number;
    // 字符串编码使用的字符表
    alphabet?: string;
    // 数组编码每个基因的取值范围
    geneMin?: number;
    geneMax?: number;
    // 二进制编码的基因字节范围
    binaryRange?: number;
}

interface Individual {
    genes: number[];      // 通用：字符串用 charCode，数组用数值，二进制用 0/1
    fitness: number;
}

/** 适配度函数：返回越大越优 */
type FitnessFn = (genes: number[], ctx: ProblemContext) => number;

interface ProblemContext {
    target?: string;
    items?: Array<{ weight: number; value: number }>;
    capacity?: number;
    cities?: Array<[number, number]>;
    custom?: unknown;
}

/** 随机整数 [min, max] */
function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 随机浮点 [0,1) */
function rand(): number { return Math.random(); }

class GeneticAlgorithm {
    config: GAConfig;
    fitnessFn: FitnessFn;
    ctx: ProblemContext;

    constructor(config: GAConfig, fitnessFn: FitnessFn, ctx: ProblemContext = {}) {
        this.config = config;
        this.fitnessFn = fitnessFn;
        this.ctx = ctx;
    }

    /** 随机生成一个个体 */
    randomIndividual(): Individual {
        const genes: number[] = [];
        const cfg = this.config;
        for (let i = 0; i < cfg.geneLength; i++) {
            if (cfg.encoding === "binary") genes.push(randInt(0, 1));
            else if (cfg.encoding === "string") {
                const alpha = cfg.alphabet ?? "abcdefghijklmnopqrstuvwxyz ";
                genes.push(alpha.charCodeAt(randInt(0, alpha.length - 1)));
            } else {
                const lo = cfg.geneMin ?? 0;
                const hi = cfg.geneMax ?? 100;
                genes.push(randInt(lo, hi));
            }
        }
        return { genes, fitness: 0 };
    }

    /** 初始化种群 */
    initPopulation(): Individual[] {
        const pop: Individual[] = [];
        for (let i = 0; i < this.config.populationSize; i++) pop.push(this.randomIndividual());
        this.evaluate(pop);
        return pop;
    }

    /** 评估种群适应度 */
    evaluate(pop: Individual[]): void {
        for (const ind of pop) ind.fitness = this.fitnessFn(ind.genes, this.ctx);
    }

    /** 轮盘赌选择 */
    selectRoulette(pop: Individual[]): Individual {
        let total = 0;
        for (const ind of pop) total += Math.max(0, ind.fitness);
        if (total <= 0) return pop[randInt(0, pop.length - 1)];
        let r = rand() * total;
        for (const ind of pop) {
            r -= Math.max(0, ind.fitness);
            if (r <= 0) return ind;
        }
        return pop[pop.length - 1];
    }

    /** 锦标赛选择 */
    selectTournament(pop: Individual[]): Individual {
        let best: Individual | null = null;
        const k = this.config.tournamentSize ?? 3;
        for (let i = 0; i < k; i++) {
            const cand = pop[randInt(0, pop.length - 1)];
            if (best === null || cand.fitness > best.fitness) best = cand;
        }
        return best!;
    }

    select(pop: Individual[]): Individual {
        if (this.config.selection === "tournament") return this.selectTournament(pop);
        return this.selectRoulette(pop);
    }

    /** 交叉 */
    crossover(a: Individual, b: Individual): [Individual, Individual] {
        if (rand() > this.config.crossoverRate) {
            return [{ genes: [...a.genes], fitness: 0 }, { genes: [...b.genes], fitness: 0 }];
        }
        const len = a.genes.length;
        const c1 = new Array<number>(len);
        const c2 = new Array<number>(len);
        if (this.config.crossover === "single") {
            const pt = randInt(1, len - 1);
            for (let i = 0; i < len; i++) {
                c1[i] = i < pt ? a.genes[i] : b.genes[i];
                c2[i] = i < pt ? b.genes[i] : a.genes[i];
            }
        } else if (this.config.crossover === "two") {
            const p1 = randInt(1, len - 2);
            const p2 = randInt(p1 + 1, len - 1);
            for (let i = 0; i < len; i++) {
                const inMid = i >= p1 && i < p2;
                c1[i] = inMid ? b.genes[i] : a.genes[i];
                c2[i] = inMid ? a.genes[i] : b.genes[i];
            }
        } else {
            // uniform
            for (let i = 0; i < len; i++) {
                if (rand() < 0.5) { c1[i] = a.genes[i]; c2[i] = b.genes[i]; }
                else { c1[i] = b.genes[i]; c2[i] = a.genes[i]; }
            }
        }
        return [{ genes: c1, fitness: 0 }, { genes: c2, fitness: 0 }];
    }

    /** 变异 */
    mutate(ind: Individual): void {
        const cfg = this.config;
        for (let i = 0; i < ind.genes.length; i++) {
            if (rand() > cfg.mutationRate) continue;
            if (cfg.mutation === "flip") {
                if (cfg.encoding === "binary") ind.genes[i] = ind.genes[i] === 0 ? 1 : 0;
                else {
                    const lo = cfg.geneMin ?? 0, hi = cfg.geneMax ?? 100;
                    ind.genes[i] = randInt(lo, hi);
                }
            } else if (cfg.mutation === "swap") {
                const j = randInt(0, ind.genes.length - 1);
                const tmp = ind.genes[i]; ind.genes[i] = ind.genes[j]; ind.genes[j] = tmp;
            } else {
                // scramble 一段
                const j = randInt(0, ind.genes.length - 1);
                const lo = Math.min(i, j), hi = Math.max(i, j);
                for (let k = lo; k <= hi; k++) {
                    const r = randInt(lo, hi);
                    const tmp = ind.genes[k]; ind.genes[k] = ind.genes[r]; ind.genes[r] = tmp;
                }
            }
        }
    }

    /** 进化一代 */
    evolve(pop: Individual[]): Individual[] {
        // 按适应度降序
        pop.sort((a, b) => b.fitness - a.fitness);
        const next: Individual[] = [];
        // 精英保留
        const elite = Math.min(this.config.elitismCount, pop.length);
        for (let i = 0; i < elite; i++) next.push({ genes: [...pop[i].genes], fitness: pop[i].fitness });
        // 生成后代
        while (next.length < this.config.populationSize) {
            const p1 = this.select(pop);
            const p2 = this.select(pop);
            const [c1, c2] = this.crossover(p1, p2);
            this.mutate(c1);
            this.mutate(c2);
            next.push(c1);
            if (next.length < this.config.populationSize) next.push(c2);
        }
        this.evaluate(next);
        return next;
    }

    /** 运行 GA */
    run(onGen?: (gen: number, best: Individual, avg: number) => boolean): { best: Individual; history: number[] } {
        let pop = this.initPopulation();
        const history: number[] = [];
        for (let g = 0; g < this.config.generations; g++) {
            pop.sort((a, b) => b.fitness - a.fitness);
            const best = pop[0];
            const avg = pop.reduce((s, ind) => s + ind.fitness, 0) / pop.length;
            history.push(best.fitness);
            if (onGen) {
                const stop = onGen(g, best, avg);
                if (stop) return { best, history };
            }
            pop = this.evolve(pop);
        }
        pop.sort((a, b) => b.fitness - a.fitness);
        return { best: pop[0], history };
    }
}

// ===================== 演示问题 =====================

function wordMatchDemo(target: string): void {
    console.log(`=== 单词匹配演示 ===\n目标: "${target}"`);
    const ga = new GeneticAlgorithm(
        {
            encoding: "string", geneLength: target.length, populationSize: 200,
            generations: 500, crossoverRate: 0.8, mutationRate: 0.02,
            selection: "tournament", crossover: "uniform", mutation: "flip",
            elitismCount: 2, tournamentSize: 4, alphabet: "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        },
        (genes) => {
            let match = 0;
            for (let i = 0; i < genes.length; i++) {
                if (String.fromCharCode(genes[i]) === target[i]) match++;
            }
            return match;
        },
        { target }
    );
    const { best, history } = ga.run((g, b) => {
        if (g % 50 === 0 || b.fitness === target.length) {
            console.log(`  gen ${g}: best="${genesToString(b.genes)}" fit=${b.fitness}/${target.length}`);
        }
        return b.fitness >= target.length;
    });
    console.log(`\n结果: "${genesToString(best.genes)}"  适应度: ${best.fitness}  代数: ${history.length}`);
}

function genesToString(genes: number[]): string {
    return genes.map((g) => String.fromCharCode(g)).join("");
}

interface KnapsackItem { weight: number; value: number; }

function knapsackDemo(itemsFile: string, capacity: number): void {
    if (!fs.existsSync(itemsFile)) { console.error(`错误：物品文件不存在 ${itemsFile}`); process.exit(1); }
    const items = JSON.parse(fs.readFileSync(itemsFile, "utf-8")) as KnapsackItem[];
    console.log(`=== 背包问题演示 ===\n物品数: ${items.length}  容量: ${capacity}`);
    const ga = new GeneticAlgorithm(
        {
            encoding: "binary", geneLength: items.length, populationSize: 150,
            generations: 300, crossoverRate: 0.8, mutationRate: 0.02,
            selection: "roulette", crossover: "single", mutation: "flip",
            elitismCount: 2, tournamentSize: 3,
        },
        (genes) => {
            let w = 0, v = 0;
            for (let i = 0; i < genes.length; i++) {
                if (genes[i] === 1) { w += items[i].weight; v += items[i].value; }
            }
            if (w > capacity) return 0; // 超重惩罚
            return v;
        },
        { items, capacity }
    );
    const { best } = ga.run((g, b) => {
        if (g % 50 === 0) console.log(`  gen ${g}: 价值=${b.fitness}`);
        return false;
    });
    let w = 0, v = 0;
    const chosen: number[] = [];
    for (let i = 0; i < best.genes.length; i++) {
        if (best.genes[i] === 1) { w += items[i].weight; v += items[i].value; chosen.push(i); }
    }
    console.log(`\n最优价值: ${v}  总重量: ${w}/${capacity}`);
    console.log(`选中物品索引: [${chosen.join(", ")}]`);
}

function tspDemo(citiesFile: string): void {
    if (!fs.existsSync(citiesFile)) { console.error(`错误：城市文件不存在 ${citiesFile}`); process.exit(1); }
    const cities = JSON.parse(fs.readFileSync(citiesFile, "utf-8")) as Array<[number, number]>;
    console.log(`=== 旅行商问题演示 ===\n城市数: ${cities.length}`);
    const ga = new GeneticAlgorithm(
        {
            encoding: "array", geneLength: cities.length, populationSize: 200,
            generations: 500, crossoverRate: 0.8, mutationRate: 0.05,
            selection: "tournament", crossover: "single", mutation: "swap",
            elitismCount: 2, tournamentSize: 5,
            geneMin: 0, geneMax: cities.length - 1,
        },
        (genes) => {
            // 适应度 = 1 / 路径长度（路径需为排列，否则惩罚）
            const seen = new Set<number>();
            for (const g of genes) seen.add(g);
            if (seen.size !== cities.length) return 0.0001;
            let dist = 0;
            for (let i = 0; i < genes.length; i++) {
                const a = cities[genes[i]];
                const b = cities[genes[(i + 1) % genes.length]];
                dist += Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
            }
            return 1 / (dist + 1);
        },
        { cities }
    );
    const { best } = ga.run((g, b) => {
        if (g % 50 === 0) console.log(`  gen ${g}: 路径长度=${(1 / b.fitness - 1).toFixed(3)}`);
        return false;
    });
    const route = best.genes.map((g) => g);
    let dist = 0;
    for (let i = 0; i < route.length; i++) {
        const a = cities[route[i]];
        const b = cities[route[(i + 1) % route.length]];
        dist += Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
    }
    console.log(`\n最优路径长度: ${dist.toFixed(3)}`);
    console.log(`路径: ${route.join(" -> ")} -> ${route[0]}`);
}

function functionMaxDemo(): void {
    // 最大化 f(x) = x * sin(10πx) + 1，x ∈ [0, 1]
    // 用 16 位二进制表示 x
    console.log("=== 函数最大化演示 ===");
    console.log("目标: 最大化 f(x) = x*sin(10πx)+1, x∈[0,1]");
    const bits = 16;
    const ga = new GeneticAlgorithm(
        {
            encoding: "binary", geneLength: bits, populationSize: 100,
            generations: 200, crossoverRate: 0.7, mutationRate: 0.01,
            selection: "roulette", crossover: "single", mutation: "flip",
            elitismCount: 2, tournamentSize: 3,
        },
        (genes) => {
            let x = 0;
            for (let i = 0; i < genes.length; i++) x = x * 2 + genes[i];
            const xReal = x / (2 ** bits - 1);
            return xReal * Math.sin(10 * Math.PI * xReal) + 1;
        },
        {}
    );
    const { best } = ga.run((g, b) => {
        if (g % 40 === 0) console.log(`  gen ${g}: f=${b.fitness.toFixed(5)}`);
        return false;
    });
    let x = 0;
    for (let i = 0; i < best.genes.length; i++) x = x * 2 + best.genes[i];
    const xReal = x / (2 ** bits - 1);
    console.log(`\n最优 x = ${xReal.toFixed(6)}, f(x) = ${best.fitness.toFixed(6)}`);
    console.log(`(理论最优约 1.9505 @ x≈0.9510)`);
}

function customDemo(configFile: string): void {
    if (!fs.existsSync(configFile)) { console.error(`错误：配置文件不存在 ${configFile}`); process.exit(1); }
    const raw = JSON.parse(fs.readFileSync(configFile, "utf-8")) as { config: GAConfig; problem: string; ctx?: ProblemContext };
    console.log(`=== 自定义问题演示: ${raw.problem} ===`);
    const ga = new GeneticAlgorithm(raw.config, (genes, ctx) => {
        // 简单默认：最大化基因之和（用户可扩展）
        if (raw.problem === "sum") return genes.reduce((s, g) => s + g, 0);
        if (raw.problem === "ones") return genes.filter((g) => g === 1).length;
        return genes.reduce((s, g) => s + g, 0);
    }, raw.ctx ?? {});
    const { best } = ga.run((g, b) => {
        if (g % 50 === 0) console.log(`  gen ${g}: best fit=${b.fitness}`);
        return false;
    });
    console.log(`\n最优适应度: ${best.fitness}`);
    console.log(`基因: [${best.genes.join(", ")}]`);
}

interface ParsedArgs {
    command: string;
    target: string;
    itemsFile: string;
    capacity: number;
    citiesFile: string;
    configFile: string;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let target = "hello world", itemsFile = "", citiesFile = "", configFile = "";
    let capacity = 50;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (!a.startsWith("-")) {
            if (command === "word") target = a;
            else if (command === "knapsack" && itemsFile === "") itemsFile = a;
            else if (command === "knapsack") capacity = parseInt(a, 10) || capacity;
            else if (command === "tsp") citiesFile = a;
            else if (command === "custom") configFile = a;
        }
    }
    return { command, target, itemsFile, capacity, citiesFile, configFile };
}

function printHelp(): void {
    console.log(`
遗传算法示例 (Genetic Algorithm Demo)

用法:
  word [target]                       演化匹配目标字符串 (默认 "hello world")
  knapsack <items.json> <capacity>    0/1 背包问题
  tsp <cities.json>                   旅行商问题
  function                            最大化 x*sin(10πx)+1
  custom <config.json>                自定义问题

物品文件格式(items.json): [{"weight":2,"value":3}, ...]
城市文件格式(cities.json): [[x,y], ...]

示例:
  node dist/index.js word "genetic algorithm"
  node dist/index.js function
`);
}

function main(): void {
    const opts = parseArgs(process.argv);
    switch (opts.command) {
        case "word": wordMatchDemo(opts.target); break;
        case "knapsack":
            if (!opts.itemsFile) { console.error("错误：缺少物品文件"); process.exit(1); }
            knapsackDemo(opts.itemsFile, opts.capacity); break;
        case "tsp":
            if (!opts.citiesFile) { console.error("错误：缺少城市文件"); process.exit(1); }
            tspDemo(opts.citiesFile); break;
        case "function": functionMaxDemo(); break;
        case "custom":
            if (!opts.configFile) { console.error("错误：缺少配置文件"); process.exit(1); }
            customDemo(opts.configFile); break;
        default: console.error(`未知命令: ${opts.command}`); printHelp(); process.exit(1);
    }
}

main();
