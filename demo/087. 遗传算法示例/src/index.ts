#!/usr/bin/env node
/**
 * 遗传算法示例 (Genetic Algorithm Demo)
 * 支持：二进制/字符串/数组编码、轮盘赌+锦标赛+精英选择、
 * 单点/两点/均匀交叉、位翻/交换/乱序变异、多种终止条件。
 * 内置演示：单词匹配、背包、TSP、函数最大化。
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";

/* ===================== Enums ===================== */

enum SelectionMethod {
  Roulette = "roulette",
  Tournament = "tournament",
  Elitism = "elitism",
}
enum CrossoverMethod {
  Single = "single",
  Two = "two",
  Uniform = "uniform",
}
enum MutationMethod {
  Flip = "flip",
  Swap = "swap",
  Scramble = "scramble",
}
enum ErrorCode {
  InvalidConfig = "INVALID_CONFIG",
  InvalidEncoding = "INVALID_ENCODING",
  Converged = "CONVERGED",
  Stagnant = "STAGNANT",
  Unknown = "UNKNOWN",
}
enum AlgorithmState {
  Initialized = "initialized",
  Running = "running",
  Converged = "converged",
  Stagnant = "stagnant",
}
enum Encoding {
  Binary = "binary",
  String = "string",
  Array = "array",
}

/* ===================== Types ===================== */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Chromosome {
  readonly genes: number[];
  fitness: number;
}
interface Identifiable {
  readonly id: string;
}
interface GARecord extends Identifiable {
  readonly generation: number;
  readonly bestFitness: number;
  readonly avgFitness: number;
}

interface GAConfig {
  readonly encoding: Encoding;
  readonly geneLength: number;
  readonly populationSize: number;
  readonly generations: number;
  readonly crossoverRate: number;
  readonly mutationRate: number;
  readonly selection: SelectionMethod;
  readonly crossover: CrossoverMethod;
  readonly mutation: MutationMethod;
  readonly elitismCount: number;
  readonly tournamentSize: number;
  readonly alphabet?: string;
  readonly geneMin?: number;
  readonly geneMax?: number;
}

interface ProblemContext {
  target?: string;
  items?: Array<{ weight: number; value: number }>;
  capacity?: number;
  cities?: Array<[number, number]>;
}

type FitnessFn = (genes: number[], ctx: ProblemContext) => number;

type EvolutionResult =
  | {
      readonly kind: "success";
      readonly best: Chromosome;
      readonly generations: number;
      readonly history: number[];
    }
  | {
      readonly kind: "error";
      readonly code: ErrorCode;
      readonly message: string;
    }
  | {
      readonly kind: "stagnant";
      readonly best: Chromosome;
      readonly generations: number;
    };

const DEFAULT_ALPHABET = "abcdefghijklmnopqrstuvwxyz " as const;

/* ===================== Symbols ===================== */

const SYM_META: unique symbol = Symbol("gaMeta");
const SYM_BRAND: unique symbol = Symbol("gaBrand");

interface GAMeta {
  readonly createdAt: number;
  evolvedAt: number;
}

/* ===================== Error Hierarchy ===================== */

class GAError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "GAError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/* ===================== Type Guards ===================== */

function isEvolutionSuccess(r: EvolutionResult): r is {
  kind: "success";
  best: Chromosome;
  generations: number;
  history: number[];
} {
  return r.kind === "success";
}
function isEvolutionError(
  r: EvolutionResult,
): r is { kind: "error"; code: ErrorCode; message: string } {
  return r.kind === "error";
}
function isEvolutionStagnant(
  r: EvolutionResult,
): r is { kind: "stagnant"; best: Chromosome; generations: number } {
  return r.kind === "stagnant";
}
function isChromosome(v: unknown): v is Chromosome {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as Chromosome).genes) &&
    typeof (v as Chromosome).fitness === "number"
  );
}

/* ===================== Helpers ===================== */

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function rand(): number {
  return Math.random();
}
function genesToString(genes: number[]): string {
  return genes.map((g) => String.fromCharCode(g)).join("");
}

/* ===================== Generic Population Store ===================== */

class Population<T extends Chromosome> implements Iterable<T> {
  private items: T[] = [];
  private readonly [SYM_META]: GAMeta = {
    createdAt: Date.now(),
    evolvedAt: Date.now(),
  };
  private generation = 0;
  get size(): number {
    return this.items.length;
  }
  get gen(): number {
    return this.generation;
  }
  set gen(v: number) {
    this.generation = v;
    this[SYM_META].evolvedAt = Date.now();
  }
  add(item: T): void {
    this.items.push(item);
  }
  get(index: number): T | undefined {
    return this.items[index];
  }
  sort(): void {
    this.items.sort((a, b) => b.fitness - a.fitness);
  }
  clear(): void {
    this.items = [];
  }
  *[Symbol.iterator](): Iterator<T> {
    for (const item of this.items) yield item;
  }
  *entries(): IterableIterator<[number, T]> {
    for (let i = 0; i < this.items.length; i++) yield [i, this.items[i]];
  }
  toArray(): T[] {
    return [...this.items];
  }
  best(): T | undefined {
    return this.items[0];
  }
  avgFitness(): number {
    if (this.items.length === 0) return 0;
    return (
      this.items.reduce((s, ind) => s + ind.fitness, 0) / this.items.length
    );
  }
}

/* ===================== Abstract Selection ===================== */

abstract class AbstractSelection {
  abstract select(pop: Chromosome[]): Chromosome;
  get name(): string {
    return this.constructor.name;
  }
}

class TournamentSelection extends AbstractSelection {
  constructor(private size = 3) {
    super();
  }
  select(pop: Chromosome[]): Chromosome {
    let best: Chromosome | null = null;
    for (let i = 0; i < this.size; i++) {
      const cand = pop[randInt(0, pop.length - 1)];
      if (!best || cand.fitness > best.fitness) best = cand;
    }
    return best!;
  }
}

class RouletteSelection extends AbstractSelection {
  select(pop: Chromosome[]): Chromosome {
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
}

/* ===================== Genetic Algorithm ===================== */

class GeneticAlgorithm {
  readonly config: GAConfig;
  readonly fitnessFn: FitnessFn;
  readonly ctx: ProblemContext;
  private selector: AbstractSelection;
  private readonly [SYM_BRAND] = true;
  state: AlgorithmState = AlgorithmState.Initialized;

  constructor(
    config: GAConfig,
    fitnessFn: FitnessFn,
    ctx: ProblemContext = {},
  ) {
    this.config = config;
    this.fitnessFn = fitnessFn;
    this.ctx = ctx;
    this.selector =
      config.selection === SelectionMethod.Tournament
        ? new TournamentSelection(config.tournamentSize)
        : new RouletteSelection();
  }

  get selectorName(): string {
    return this.selector.name;
  }

  private randomIndividual(): Chromosome {
    const genes: number[] = [];
    const cfg = this.config;
    for (let i = 0; i < cfg.geneLength; i++) {
      if (cfg.encoding === Encoding.Binary) genes.push(randInt(0, 1));
      else if (cfg.encoding === Encoding.String) {
        const alpha = cfg.alphabet ?? DEFAULT_ALPHABET;
        genes.push(alpha.charCodeAt(randInt(0, alpha.length - 1)));
      } else {
        const lo = cfg.geneMin ?? 0,
          hi = cfg.geneMax ?? 100;
        genes.push(randInt(lo, hi));
      }
    }
    return { genes, fitness: 0 };
  }

  private evaluate(pop: Chromosome[]): void {
    for (const ind of pop) ind.fitness = this.fitnessFn(ind.genes, this.ctx);
  }

  private crossover(a: Chromosome, b: Chromosome): [Chromosome, Chromosome] {
    if (rand() > this.config.crossoverRate)
      return [
        { genes: [...a.genes], fitness: 0 },
        { genes: [...b.genes], fitness: 0 },
      ];
    const len = a.genes.length;
    const c1 = new Array<number>(len),
      c2 = new Array<number>(len);
    if (this.config.crossover === CrossoverMethod.Single) {
      const pt = randInt(1, len - 1);
      for (let i = 0; i < len; i++) {
        c1[i] = i < pt ? a.genes[i] : b.genes[i];
        c2[i] = i < pt ? b.genes[i] : a.genes[i];
      }
    } else if (this.config.crossover === CrossoverMethod.Two) {
      const p1 = randInt(1, len - 2),
        p2 = randInt(p1 + 1, len - 1);
      for (let i = 0; i < len; i++) {
        const mid = i >= p1 && i < p2;
        c1[i] = mid ? b.genes[i] : a.genes[i];
        c2[i] = mid ? a.genes[i] : b.genes[i];
      }
    } else {
      for (let i = 0; i < len; i++) {
        if (rand() < 0.5) {
          c1[i] = a.genes[i];
          c2[i] = b.genes[i];
        } else {
          c1[i] = b.genes[i];
          c2[i] = a.genes[i];
        }
      }
    }
    return [
      { genes: c1, fitness: 0 },
      { genes: c2, fitness: 0 },
    ];
  }

  private mutate(ind: Chromosome): void {
    const cfg = this.config;
    for (let i = 0; i < ind.genes.length; i++) {
      if (rand() > cfg.mutationRate) continue;
      if (cfg.mutation === MutationMethod.Flip) {
        if (cfg.encoding === Encoding.Binary)
          ind.genes[i] = ind.genes[i] === 0 ? 1 : 0;
        else {
          const lo = cfg.geneMin ?? 0,
            hi = cfg.geneMax ?? 100;
          ind.genes[i] = randInt(lo, hi);
        }
      } else if (cfg.mutation === MutationMethod.Swap) {
        const j = randInt(0, ind.genes.length - 1);
        [ind.genes[i], ind.genes[j]] = [ind.genes[j], ind.genes[i]];
      } else {
        const j = randInt(0, ind.genes.length - 1);
        const lo = Math.min(i, j),
          hi = Math.max(i, j);
        for (let k = lo; k <= hi; k++) {
          const r = randInt(lo, hi);
          [ind.genes[k], ind.genes[r]] = [ind.genes[r], ind.genes[k]];
        }
      }
    }
  }

  private evolve(pop: Chromosome[]): Chromosome[] {
    pop.sort((a, b) => b.fitness - a.fitness);
    const next: Chromosome[] = [];
    const elite = Math.min(this.config.elitismCount, pop.length);
    for (let i = 0; i < elite; i++)
      next.push({ genes: [...pop[i].genes], fitness: pop[i].fitness });
    while (next.length < this.config.populationSize) {
      const p1 = this.selector.select(pop),
        p2 = this.selector.select(pop);
      const [c1, c2] = this.crossover(p1, p2);
      this.mutate(c1);
      this.mutate(c2);
      next.push(c1);
      if (next.length < this.config.populationSize) next.push(c2);
    }
    this.evaluate(next);
    return next;
  }

  run(
    onGen?: (gen: number, best: Chromosome, avg: number) => boolean,
  ): EvolutionResult {
    this.state = AlgorithmState.Running;
    let pop: Chromosome[] = [];
    for (let i = 0; i < this.config.populationSize; i++)
      pop.push(this.randomIndividual());
    this.evaluate(pop);
    const history: number[] = [];
    let stagnantCount = 0;
    let prevBest = -Infinity;
    for (let g = 0; g < this.config.generations; g++) {
      pop.sort((a, b) => b.fitness - a.fitness);
      const best = pop[0];
      const avg = pop.reduce((s, ind) => s + ind.fitness, 0) / pop.length;
      history.push(best.fitness);
      if (Math.abs(best.fitness - prevBest) < 1e-10) stagnantCount++;
      else stagnantCount = 0;
      prevBest = best.fitness;
      if (onGen) {
        const stop = onGen(g, best, avg);
        if (stop) {
          this.state = AlgorithmState.Converged;
          return { kind: "success", best, generations: g + 1, history };
        }
      }
      if (stagnantCount >= 100) {
        this.state = AlgorithmState.Stagnant;
        return { kind: "stagnant", best, generations: g + 1 };
      }
      pop = this.evolve(pop);
    }
    pop.sort((a, b) => b.fitness - a.fitness);
    this.state = AlgorithmState.Converged;
    return {
      kind: "success",
      best: pop[0],
      generations: this.config.generations,
      history,
    };
  }
}

/* ===================== Demos ===================== */

function wordMatchDemo(target: string): void {
  console.log(`=== 单词匹配演示 ===\n目标: "${target}"`);
  const ga = new GeneticAlgorithm(
    {
      encoding: Encoding.String,
      geneLength: target.length,
      populationSize: 200,
      generations: 500,
      crossoverRate: 0.8,
      mutationRate: 0.02,
      selection: SelectionMethod.Tournament,
      crossover: CrossoverMethod.Uniform,
      mutation: MutationMethod.Flip,
      elitismCount: 2,
      tournamentSize: 4,
      alphabet: "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    },
    (genes) => {
      let match = 0;
      for (let i = 0; i < genes.length; i++)
        if (String.fromCharCode(genes[i]) === target[i]) match++;
      return match;
    },
    { target },
  );
  const result = ga.run((g, b) => {
    if (g % 50 === 0 || b.fitness === target.length)
      console.log(
        `  gen ${g}: best="${genesToString(b.genes)}" fit=${b.fitness}/${target.length}`,
      );
    return b.fitness >= target.length;
  });
  if (isEvolutionSuccess(result))
    console.log(
      `\n结果: "${genesToString(result.best.genes)}"  适应度: ${result.best.fitness}  代数: ${result.generations}`,
    );
}

interface KnapsackItem {
  weight: number;
  value: number;
}

function knapsackDemo(itemsFile: string, capacity: number): void {
  if (!fs.existsSync(itemsFile)) {
    console.error(`错误：物品文件不存在 ${itemsFile}`);
    process.exit(1);
  }
  const items = JSON.parse(
    fs.readFileSync(itemsFile, "utf-8"),
  ) as KnapsackItem[];
  console.log(
    `=== 背包问题演示 ===\n物品数: ${items.length}  容量: ${capacity}`,
  );
  const ga = new GeneticAlgorithm(
    {
      encoding: Encoding.Binary,
      geneLength: items.length,
      populationSize: 150,
      generations: 300,
      crossoverRate: 0.8,
      mutationRate: 0.02,
      selection: SelectionMethod.Roulette,
      crossover: CrossoverMethod.Single,
      mutation: MutationMethod.Flip,
      elitismCount: 2,
      tournamentSize: 3,
    },
    (genes) => {
      let w = 0,
        v = 0;
      for (let i = 0; i < genes.length; i++)
        if (genes[i] === 1) {
          w += items[i].weight;
          v += items[i].value;
        }
      return w > capacity ? 0 : v;
    },
    { items, capacity },
  );
  const result = ga.run((g, b) => {
    if (g % 50 === 0) console.log(`  gen ${g}: 价值=${b.fitness}`);
    return false;
  });
  if (isEvolutionSuccess(result)) {
    let w = 0,
      v = 0;
    const chosen: number[] = [];
    for (let i = 0; i < result.best.genes.length; i++)
      if (result.best.genes[i] === 1) {
        w += items[i].weight;
        v += items[i].value;
        chosen.push(i);
      }
    console.log(`\n最优价值: ${v}  总重量: ${w}/${capacity}`);
    console.log(`选中物品索引: [${chosen.join(", ")}]`);
  }
}

function tspDemo(citiesFile: string): void {
  if (!fs.existsSync(citiesFile)) {
    console.error(`错误：城市文件不存在 ${citiesFile}`);
    process.exit(1);
  }
  const cities = JSON.parse(fs.readFileSync(citiesFile, "utf-8")) as Array<
    [number, number]
  >;
  console.log(`=== 旅行商问题演示 ===\n城市数: ${cities.length}`);
  const ga = new GeneticAlgorithm(
    {
      encoding: Encoding.Array,
      geneLength: cities.length,
      populationSize: 200,
      generations: 500,
      crossoverRate: 0.8,
      mutationRate: 0.05,
      selection: SelectionMethod.Tournament,
      crossover: CrossoverMethod.Single,
      mutation: MutationMethod.Swap,
      elitismCount: 2,
      tournamentSize: 5,
      geneMin: 0,
      geneMax: cities.length - 1,
    },
    (genes) => {
      const seen = new Set<number>();
      for (const g of genes) seen.add(g);
      if (seen.size !== cities.length) return 0.0001;
      let dist = 0;
      for (let i = 0; i < genes.length; i++) {
        const a = cities[genes[i]],
          b = cities[genes[(i + 1) % genes.length]];
        dist += Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
      }
      return 1 / (dist + 1);
    },
    { cities },
  );
  const result = ga.run((g, b) => {
    if (g % 50 === 0)
      console.log(`  gen ${g}: 路径长度=${(1 / b.fitness - 1).toFixed(3)}`);
    return false;
  });
  if (isEvolutionSuccess(result)) {
    const route = result.best.genes;
    let dist = 0;
    for (let i = 0; i < route.length; i++) {
      const a = cities[route[i]],
        b = cities[route[(i + 1) % route.length]];
      dist += Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
    }
    console.log(`\n最优路径长度: ${dist.toFixed(3)}`);
    console.log(`路径: ${route.join(" -> ")} -> ${route[0]}`);
  }
}

function functionMaxDemo(): void {
  console.log(
    "=== 函数最大化演示 ===\n目标: 最大化 f(x) = x*sin(10πx)+1, x∈[0,1]",
  );
  const bits = 16;
  const ga = new GeneticAlgorithm(
    {
      encoding: Encoding.Binary,
      geneLength: bits,
      populationSize: 100,
      generations: 200,
      crossoverRate: 0.7,
      mutationRate: 0.01,
      selection: SelectionMethod.Roulette,
      crossover: CrossoverMethod.Single,
      mutation: MutationMethod.Flip,
      elitismCount: 2,
      tournamentSize: 3,
    },
    (genes) => {
      let x = 0;
      for (let i = 0; i < genes.length; i++) x = x * 2 + genes[i];
      const xReal = x / (2 ** bits - 1);
      return xReal * Math.sin(10 * Math.PI * xReal) + 1;
    },
    {},
  );
  const result = ga.run((g, b) => {
    if (g % 40 === 0) console.log(`  gen ${g}: f=${b.fitness.toFixed(5)}`);
    return false;
  });
  if (isEvolutionSuccess(result)) {
    let x = 0;
    for (let i = 0; i < result.best.genes.length; i++)
      x = x * 2 + result.best.genes[i];
    const xReal = x / (2 ** bits - 1);
    console.log(
      `\n最优 x = ${xReal.toFixed(6)}, f(x) = ${result.best.fitness.toFixed(6)}`,
    );
    console.log(`(理论最优约 1.9505 @ x≈0.9510)`);
  }
}

function customDemo(configFile: string): void {
  if (!fs.existsSync(configFile)) {
    console.error(`错误：配置文件不存在 ${configFile}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
    config: GAConfig;
    problem: string;
    ctx?: ProblemContext;
  };
  console.log(`=== 自定义问题演示: ${raw.problem} ===`);
  const ga = new GeneticAlgorithm(
    raw.config,
    (genes) => {
      if (raw.problem === "sum") return genes.reduce((s, g) => s + g, 0);
      if (raw.problem === "ones") return genes.filter((g) => g === 1).length;
      return genes.reduce((s, g) => s + g, 0);
    },
    raw.ctx ?? {},
  );
  const result = ga.run((g, b) => {
    if (g % 50 === 0) console.log(`  gen ${g}: best fit=${b.fitness}`);
    return false;
  });
  if (isEvolutionSuccess(result)) {
    console.log(`\n最优适应度: ${result.best.fitness}`);
    console.log(`基因: [${result.best.genes.join(", ")}]`);
  }
}

/* ===================== CLI ===================== */

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
  let target = "hello world",
    itemsFile = "",
    citiesFile = "",
    configFile = "",
    capacity = 50;
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

示例:
  node dist/index.js word "genetic algorithm"
  node dist/index.js function
`);
}

function main(): void {
  const opts = parseArgs(process.argv);
  switch (opts.command) {
    case "word":
      wordMatchDemo(opts.target);
      break;
    case "knapsack":
      if (!opts.itemsFile) {
        console.error("错误：缺少物品文件");
        process.exit(1);
      }
      knapsackDemo(opts.itemsFile, opts.capacity);
      break;
    case "tsp":
      if (!opts.citiesFile) {
        console.error("错误：缺少城市文件");
        process.exit(1);
      }
      tspDemo(opts.citiesFile);
      break;
    case "function":
      functionMaxDemo();
      break;
    case "custom":
      if (!opts.configFile) {
        console.error("错误：缺少配置文件");
        process.exit(1);
      }
      customDemo(opts.configFile);
      break;
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main();
