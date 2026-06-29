#!/usr/bin/env node

/**
 * 猜数字 AI 玩家 (Number Guessing AI)
 * 二分 / 随机 / 自适应贝叶斯 / 频率学习等策略的猜数字 AI。
 * 仅使用 Node.js 内置模块（readline / fs / path / os）。
 * 刻意演示大量 TypeScript 高级特性：字符串枚举、判别联合、泛型类、
 * 抽象类与继承、映射类型、自定义错误层级、索引签名、satisfies、
 * getter/setter、生成器迭代、Symbol 唯一键、as const、类型守卫、函数重载。
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// --- 1. 字符串枚举 ---

enum FeedbackType {
  Higher = "higher",
  Lower = "lower",
  Correct = "correct",
}

enum GuessStrategy {
  BinarySearch = "BINARY_SEARCH",
  Random = "RANDOM",
  Adaptive = "ADAPTIVE",
  Frequency = "FREQUENCY",
}

enum ErrorCode {
  InvalidRange = "INVALID_RANGE",
  MaxAttemptsExceeded = "MAX_ATTEMPTS",
  InvalidFeedback = "INVALID_FEEDBACK",
  InvalidGuess = "INVALID_GUESS",
  NoStrategy = "NO_STRATEGY",
  InvalidSecret = "INVALID_SECRET",
}

enum GamePhase {
  Init = "INIT",
  Guessing = "GUESSING",
  Finished = "FINISHED",
  Error = "ERROR",
}

enum Difficulty {
  Easy = "EASY",
  Medium = "MEDIUM",
  Hard = "HARD",
}

// --- 2. 接口（可选 / 只读 / 索引签名） ---

interface GuessStep {
  readonly guess: number;
  readonly feedback: FeedbackType;
  readonly turn: number;
}

interface GuessRecord {
  readonly round: number;
  readonly secret: number;
  guesses: number;
  readonly history: ReadonlyArray<GuessStep>;
  readonly strategyName: string;
}

interface StrategyStats {
  readonly name: string;
  rounds: number;
  totalGuesses: number;
  wins: number;
  bestGuesses: number;
  worstGuesses: number;
  notes?: string;
  [key: string]: string | number | undefined;
}

interface GameConfig {
  readonly maxGuesses: number;
  readonly learningRounds: number;
  readonly poolSize: number;
  readonly difficulty: Difficulty;
  readonly label: string;
  [key: string]: number | string;
}

interface ParsedArgs {
  readonly command: string;
  rounds: number;
  rangeMin: number;
  rangeMax: number;
  verbose: boolean;
  difficulty: Difficulty;
}

// --- 3. 判别联合 GuessResult ---

interface GuessCorrect {
  readonly kind: "correct";
  readonly guess: number;
  readonly turn: number;
}
interface GuessTooHigh {
  readonly kind: "tooHigh";
  readonly guess: number;
  readonly turn: number;
  readonly feedback: FeedbackType.Lower;
}
interface GuessTooLow {
  readonly kind: "tooLow";
  readonly guess: number;
  readonly turn: number;
  readonly feedback: FeedbackType.Higher;
}
interface GuessError {
  readonly kind: "error";
  readonly guess: number;
  readonly turn: number;
  readonly code: ErrorCode;
  readonly message: string;
}
type GuessResult = GuessCorrect | GuessTooHigh | GuessTooLow | GuessError;

// --- 4. 映射类型 ---

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// --- 5. 自定义错误层级 ---

class GameError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = "GameError";
    this.code = code;
    Object.setPrototypeOf(this, GameError.prototype);
  }
}

// --- 6. as const 与 satisfies ---

const COMMANDS = ["play", "tournament", "learn", "stats", "challenge"] as const;
type Command = (typeof COMMANDS)[number];

const DEFAULT_CONFIG = {
  maxGuesses: 50,
  learningRounds: 10,
  poolSize: 20,
  difficulty: Difficulty.Medium,
  label: "默认配置",
} satisfies GameConfig;

const DIFFICULTY_PROFILE = {
  [Difficulty.Easy]: {
    range: [1, 50] as const,
    maxAttempts: 30,
    label: "简单",
  },
  [Difficulty.Medium]: {
    range: [1, 100] as const,
    maxAttempts: 50,
    label: "中等",
  },
  [Difficulty.Hard]: {
    range: [1, 500] as const,
    maxAttempts: 80,
    label: "困难",
  },
} satisfies Record<
  Difficulty,
  { range: readonly [number, number]; maxAttempts: number; label: string }
>;

// --- 7. Symbol 唯一键 ---

const STRATEGY_ID = Symbol("strategyId");
const SESSION_TAG = Symbol("sessionTag");

let strategyIdCounter = 0;
function nextStrategyId(): number {
  return ++strategyIdCounter;
}

// --- 8. 类型守卫 ---

function isGuessCorrect(r: GuessResult): r is GuessCorrect {
  return r.kind === "correct";
}
function isGuessTooHigh(r: GuessResult): r is GuessTooHigh {
  return r.kind === "tooHigh";
}
function isGuessTooLow(r: GuessResult): r is GuessTooLow {
  return r.kind === "tooLow";
}
function isGuessError(r: GuessResult): r is GuessError {
  return r.kind === "error";
}
function isCommand(v: string): v is Command {
  return (COMMANDS as readonly string[]).includes(v);
}
function isDifficulty(v: string): v is Difficulty {
  return (
    v === Difficulty.Easy || v === Difficulty.Medium || v === Difficulty.Hard
  );
}

// --- 9. 函数重载 ---

function parseNum(input: string): number;
function parseNum(input: string, fallback: number): number;
function parseNum(input: string, fallback?: number): number {
  const n = parseInt(input.trim(), 10);
  return isNaN(n) ? (fallback ?? NaN) : n;
}

function clamp(value: number, min: number, max: number): number;
function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number;
function clamp(
  value: number,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (isNaN(value)) return fallback ?? min;
  return Math.min(max, Math.max(min, value));
}

// --- 10. 辅助函数 ---

function randomSecret(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function evaluateGuess(
  guess: number,
  secret: number,
  turn: number,
  min: number,
  max: number,
): GuessResult {
  if (isNaN(guess) || guess < min || guess > max) {
    return {
      kind: "error",
      guess,
      turn,
      code: ErrorCode.InvalidGuess,
      message: `无效猜测值 ${guess}`,
    };
  }
  if (guess === secret) return { kind: "correct", guess, turn };
  if (guess < secret)
    return { kind: "tooLow", guess, turn, feedback: FeedbackType.Higher };
  return { kind: "tooHigh", guess, turn, feedback: FeedbackType.Lower };
}

function resultToFeedback(
  r: GuessCorrect | GuessTooHigh | GuessTooLow,
): FeedbackType {
  return r.kind === "correct" ? FeedbackType.Correct : r.feedback;
}

function printResult(r: GuessResult): void {
  if (isGuessError(r)) {
    console.log(
      `  第 ${r.turn} 猜: ${r.guess} -> 错误 [${r.code}] ${r.message}`,
    );
    return;
  }
  if (isGuessCorrect(r)) {
    console.log(`  第 ${r.turn} 猜: ${r.guess} -> 命中!`);
    return;
  }
  if (isGuessTooHigh(r)) {
    console.log(`  第 ${r.turn} 猜: ${r.guess} -> 更小 (太大)`);
    return;
  }
  if (isGuessTooLow(r)) {
    console.log(`  第 ${r.turn} 猜: ${r.guess} -> 更大 (太小)`);
    return;
  }
}

// --- 11. 抽象策略类与具体子类 ---

abstract class AbstractStrategy {
  abstract readonly name: string;
  abstract readonly strategyType: GuessStrategy;
  protected lo = 1;
  protected hi = 100;
  protected attempts = 0;
  readonly [STRATEGY_ID]!: number;

  constructor() {
    this[STRATEGY_ID] = nextStrategyId();
  }

  abstract reset(rangeMin: number, rangeMax: number): void;
  abstract nextGuess(): number;
  abstract receiveFeedback(guess: number, feedback: FeedbackType): void;
  abstract explain(): string;

  learn?(record: GuessRecord): void;

  get rangeSize(): number {
    return Math.max(0, this.hi - this.lo + 1);
  }
  get attemptCount(): number {
    return this.attempts;
  }
  protected recordAttempt(): void {
    this.attempts++;
  }
}

class BinarySearchStrategy extends AbstractStrategy {
  readonly name = "二分搜索";
  readonly strategyType = GuessStrategy.BinarySearch;

  reset(rangeMin: number, rangeMax: number): void {
    this.lo = rangeMin;
    this.hi = rangeMax;
    this.attempts = 0;
  }
  nextGuess(): number {
    this.recordAttempt();
    return Math.floor((this.lo + this.hi) / 2);
  }
  receiveFeedback(guess: number, feedback: FeedbackType): void {
    if (feedback === FeedbackType.Higher) this.lo = guess + 1;
    else if (feedback === FeedbackType.Lower) this.hi = guess - 1;
  }
  explain(): string {
    return `候选区间 [${this.lo}, ${this.hi}]，取中点 ${Math.floor((this.lo + this.hi) / 2)}`;
  }
}

class RandomStrategy extends AbstractStrategy {
  readonly name = "随机猜测";
  readonly strategyType = GuessStrategy.Random;
  private _seed = Date.now();

  reset(rangeMin: number, rangeMax: number): void {
    this.lo = rangeMin;
    this.hi = rangeMax;
    this.attempts = 0;
  }
  nextGuess(): number {
    this.recordAttempt();
    return Math.floor(Math.random() * (this.hi - this.lo + 1)) + this.lo;
  }
  receiveFeedback(guess: number, feedback: FeedbackType): void {
    if (feedback === FeedbackType.Higher) this.lo = guess + 1;
    else if (feedback === FeedbackType.Lower) this.hi = guess - 1;
  }
  explain(): string {
    return `候选区间 [${this.lo}, ${this.hi}]，随机取一个`;
  }
  get seed(): number {
    return this._seed;
  }
  set seed(value: number) {
    this._seed = value;
  }
}

class AdaptiveStrategy extends AbstractStrategy {
  readonly name = "自适应贝叶斯";
  readonly strategyType = GuessStrategy.Adaptive;
  private probs: Float64Array = new Float64Array(0);
  private _bias = 0.5;

  reset(rangeMin: number, rangeMax: number): void {
    this.lo = rangeMin;
    this.hi = rangeMax;
    this.attempts = 0;
    const n = rangeMax - rangeMin + 1;
    this.probs = new Float64Array(n);
    for (let i = 0; i < n; i++) this.probs[i] = 1 / n;
  }
  nextGuess(): number {
    this.recordAttempt();
    let bi = 0,
      bv = -1;
    for (let i = 0; i < this.probs.length; i++) {
      if (this.probs[i] > bv) {
        bv = this.probs[i];
        bi = i;
      }
    }
    return this.lo + bi;
  }
  receiveFeedback(guess: number, feedback: FeedbackType): void {
    if (feedback === FeedbackType.Correct) return;
    for (let i = 0; i < this.probs.length; i++) {
      const v = this.lo + i;
      const keep = feedback === FeedbackType.Higher ? v > guess : v < guess;
      if (!keep) this.probs[i] = 0;
    }
    let sum = 0;
    for (let i = 0; i < this.probs.length; i++) sum += this.probs[i];
    if (sum > 0)
      for (let i = 0; i < this.probs.length; i++) this.probs[i] /= sum;
  }
  explain(): string {
    let bi = 0,
      bv = -1;
    for (let i = 0; i < this.probs.length; i++) {
      if (this.probs[i] > bv) {
        bv = this.probs[i];
        bi = i;
      }
    }
    return `概率峰值: ${this.lo + bi} (p=${bv.toFixed(3)}), bias=${this._bias.toFixed(2)}`;
  }
  get bias(): number {
    return this._bias;
  }
  set bias(value: number) {
    this._bias = Math.min(1, Math.max(0, value));
  }
}

class FrequencyStrategy extends AbstractStrategy {
  readonly name = "频率学习";
  readonly strategyType = GuessStrategy.Frequency;
  private candidates: number[] = [];
  private static freq: Map<number, number> = new Map();

  reset(rangeMin: number, rangeMax: number): void {
    this.lo = rangeMin;
    this.hi = rangeMax;
    this.attempts = 0;
    this.candidates = [];
    for (let i = rangeMin; i <= rangeMax; i++) this.candidates.push(i);
    this.candidates.sort(
      (a, b) =>
        (FrequencyStrategy.freq.get(b) ?? 0) -
        (FrequencyStrategy.freq.get(a) ?? 0),
    );
  }
  nextGuess(): number {
    this.recordAttempt();
    const idx = Math.floor(this.candidates.length / 2);
    return this.candidates[Math.min(idx, this.candidates.length - 1)];
  }
  receiveFeedback(guess: number, feedback: FeedbackType): void {
    this.candidates = this.candidates.filter((c) =>
      feedback === FeedbackType.Higher
        ? c > guess
        : feedback === FeedbackType.Lower
          ? c < guess
          : c === guess,
    );
  }
  learn(record: GuessRecord): void {
    FrequencyStrategy.freq.set(
      record.secret,
      (FrequencyStrategy.freq.get(record.secret) ?? 0) + 1,
    );
  }
  explain(): string {
    const top = this.candidates.slice(0, 3);
    return `剩余候选 ${this.candidates.length} 个，优先候选 ${JSON.stringify(top)}`;
  }
}

function makeStrategies(): AbstractStrategy[] {
  return [
    new BinarySearchStrategy(),
    new RandomStrategy(),
    new AdaptiveStrategy(),
    new FrequencyStrategy(),
  ];
}

// --- 12. 泛型历史记录类（含生成器迭代） ---

class GameHistory<T extends GuessRecord> implements Iterable<T> {
  private readonly _records: T[] = [];
  private _roundCounter = 0;

  add(record: Omit<T, "round">): T {
    const full = { ...record, round: ++this._roundCounter } as T;
    this._records.push(full);
    return full;
  }

  get count(): number {
    return this._records.length;
  }
  get records(): ReadonlyArray<T> {
    return this._records;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.entries();
  }

  *entries(): Generator<T, void, unknown> {
    for (const r of this._records) yield r;
  }

  clear(): void {
    this._records.length = 0;
    this._roundCounter = 0;
  }

  averageGuesses(): number {
    if (this._records.length === 0) return 0;
    let sum = 0;
    for (const r of this._records) sum += r.guesses;
    return sum / this._records.length;
  }

  bestGuesses(): number {
    if (this._records.length === 0) return 0;
    let best = Infinity;
    for (const r of this._records) best = Math.min(best, r.guesses);
    return best;
  }
}

// --- 13. 游戏会话（getter/setter + GamePhase） ---

class GameSession {
  private _phase: GamePhase = GamePhase.Init;
  private _secret = 0;
  private readonly _strategy: AbstractStrategy;
  private readonly _min: number;
  private readonly _max: number;
  private readonly _maxAttempts: number;
  readonly steps: GuessStep[] = [];
  readonly [SESSION_TAG]!: string;

  constructor(
    strategy: AbstractStrategy,
    min: number,
    max: number,
    maxAttempts: number = DEFAULT_CONFIG.maxGuesses,
  ) {
    if (min > max)
      throw new GameError(`范围无效: [${min}, ${max}]`, ErrorCode.InvalidRange);
    this._strategy = strategy;
    this._min = min;
    this._max = max;
    this._maxAttempts = maxAttempts;
    this[SESSION_TAG] = `session-${strategy[STRATEGY_ID]}-${Date.now()}`;
  }

  get phase(): GamePhase {
    return this._phase;
  }
  get strategy(): AbstractStrategy {
    return this._strategy;
  }
  get range(): readonly [number, number] {
    return [this._min, this._max] as const;
  }
  get revealedSecret(): number {
    return this._phase === GamePhase.Finished ? this._secret : NaN;
  }
  set secret(value: number) {
    if (value < this._min || value > this._max) {
      throw new GameError(
        `秘密数 ${value} 越界 [${this._min}, ${this._max}]`,
        ErrorCode.InvalidSecret,
      );
    }
    this._secret = value;
  }

  run(verbose: boolean = false): GuessRecord {
    this._phase = GamePhase.Guessing;
    this._strategy.reset(this._min, this._max);
    let turn = 0;
    while (turn < this._maxAttempts) {
      const guess = this._strategy.nextGuess();
      turn++;
      const result = evaluateGuess(
        guess,
        this._secret,
        turn,
        this._min,
        this._max,
      );
      if (verbose) {
        console.log(`  ${this._strategy.explain()}`);
        printResult(result);
      }
      if (isGuessError(result)) {
        this._phase = GamePhase.Error;
        throw new GameError(result.message, result.code);
      }
      const feedback = resultToFeedback(result);
      this.steps.push({ guess: result.guess, feedback, turn });
      this._strategy.receiveFeedback(guess, feedback);
      if (isGuessCorrect(result)) {
        this._phase = GamePhase.Finished;
        break;
      }
    }
    if (this._phase === GamePhase.Guessing) this._phase = GamePhase.Error;
    return {
      round: 0,
      secret: this._secret,
      guesses: turn,
      history: [...this.steps],
      strategyName: this._strategy.name,
    };
  }
}

function playRound(
  strategy: AbstractStrategy,
  secret: number,
  rangeMin: number,
  rangeMax: number,
  verbose: boolean,
): GuessRecord {
  const session = new GameSession(strategy, rangeMin, rangeMax);
  session.secret = secret;
  const record = session.run(verbose);
  if (strategy.learn) strategy.learn(record);
  return record;
}

// --- 14. 统计持久化（使用 Mutable 映射类型） ---

const STATS_PATH: string = path.join(os.homedir(), ".guess-ai-stats.json");

function loadStats(): Record<string, StrategyStats> {
  if (!fs.existsSync(STATS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, "utf-8")) as Record<
      string,
      StrategyStats
    >;
  } catch {
    return {};
  }
}

function saveStats(stats: Record<string, StrategyStats>): void {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), "utf-8");
}

function updateStats(
  stats: Record<string, StrategyStats>,
  name: string,
  guesses: number,
): void {
  const base: Mutable<StrategyStats> = stats[name]
    ? { ...stats[name] }
    : {
        name,
        rounds: 0,
        totalGuesses: 0,
        wins: 0,
        bestGuesses: Infinity,
        worstGuesses: 0,
      };
  base.rounds++;
  base.totalGuesses += guesses;
  if (guesses <= DEFAULT_CONFIG.maxGuesses) base.wins++;
  base.bestGuesses = Math.min(base.bestGuesses, guesses);
  base.worstGuesses = Math.max(base.worstGuesses, guesses);
  stats[name] = base;
}

// --- 15. CLI 参数解析 ---

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  let rounds = 10,
    rangeMin = 1,
    rangeMax = 100,
    verbose = false;
  let difficulty: Difficulty = Difficulty.Medium;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case "-r":
      case "--rounds": {
        const v = parseNum(rest[++i] ?? "", 10);
        if (v > 0) rounds = v;
        break;
      }
      case "--min": {
        rangeMin = parseNum(rest[++i] ?? "", 1);
        break;
      }
      case "--max": {
        rangeMax = parseNum(rest[++i] ?? "", 100);
        break;
      }
      case "-v":
      case "--verbose": {
        verbose = true;
        break;
      }
      case "-d":
      case "--difficulty": {
        const v = rest[++i] ?? "";
        if (isDifficulty(v)) difficulty = v;
        break;
      }
      default:
        break;
    }
  }
  if (rangeMin > rangeMax) {
    const t = rangeMin;
    rangeMin = rangeMax;
    rangeMax = t;
  }
  return { command, rounds, rangeMin, rangeMax, verbose, difficulty };
}

function printHelp(): void {
  console.log(`
猜数字 AI 玩家 (Number Guessing AI)

用法:
  play [-v] [--min n] [--max n] [-d 难度]      AI 表演赛，逐步显示推理
  tournament [-r rounds]                        多策略锦标赛比较
  learn [-r rounds]                             AI 多轮学习并改进
  stats                                         查看跨轮统计
  challenge                                     你选数字，AI 猜（交互）

难度: easy / medium / hard
策略: 二分搜索 / 随机猜测 / 自适应贝叶斯 / 频率学习

示例:
  node dist/index.js play -v
  node dist/index.js tournament -r 50
  node dist/index.js learn -r 100
`);
}

// --- 16. 命令实现 ---

function cmdPlay(opts: ParsedArgs): void {
  const secret = randomSecret(opts.rangeMin, opts.rangeMax);
  const strat = new BinarySearchStrategy();
  console.log(
    `=== AI 表演赛 === (范围 ${opts.rangeMin}-${opts.rangeMax}, 难度 ${DIFFICULTY_PROFILE[opts.difficulty].label})`,
  );
  const record = playRound(strat, secret, opts.rangeMin, opts.rangeMax, true);
  console.log(`\n结果: 秘密数=${secret}, 用了 ${record.guesses} 次`);
  const stats = loadStats();
  updateStats(stats, strat.name, record.guesses);
  saveStats(stats);
}

function cmdTournament(opts: ParsedArgs): void {
  const strategies = makeStrategies();
  type Row = { name: string; avg: number; best: number; worst: number };
  const summary: Row[] = [];
  for (const s of strategies) {
    const history = new GameHistory<GuessRecord>();
    for (let r = 0; r < opts.rounds; r++) {
      const secret = randomSecret(opts.rangeMin, opts.rangeMax);
      const rec = playRound(s, secret, opts.rangeMin, opts.rangeMax, false);
      history.add({
        secret: rec.secret,
        guesses: rec.guesses,
        history: rec.history,
        strategyName: rec.strategyName,
      });
    }
    const avg = history.averageGuesses();
    const best = history.bestGuesses();
    let worst = 0;
    for (const rec of history) worst = Math.max(worst, rec.guesses);
    summary.push({ name: s.name, avg, best, worst });
    const stats = loadStats();
    for (const rec of history) updateStats(stats, s.name, rec.guesses);
    saveStats(stats);
  }
  console.log(
    `=== 锦标赛 (${opts.rounds} 轮, 范围 ${opts.rangeMin}-${opts.rangeMax}) ===`,
  );
  console.log("策略            平均    最佳  最差");
  for (const row of summary) {
    console.log(
      `${row.name.padEnd(14)} ${row.avg.toFixed(2).padStart(6)}  ${row.best.toString().padStart(4)}  ${row.worst.toString().padStart(4)}`,
    );
  }
  summary.sort((a, b) => a.avg - b.avg);
  console.log(
    `\n冠军: ${summary[0].name} (平均 ${summary[0].avg.toFixed(2)} 次)`,
  );
}

function cmdLearn(opts: ParsedArgs): void {
  console.log(`=== 学习模式 (${opts.rounds} 轮) ===`);
  const strategies = makeStrategies();
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  const probe = (s: AbstractStrategy): number => {
    let sum = 0;
    for (let r = 0; r < DEFAULT_CONFIG.learningRounds; r++) {
      const secret = randomSecret(opts.rangeMin, opts.rangeMax);
      sum += playRound(s, secret, opts.rangeMin, opts.rangeMax, false).guesses;
    }
    return sum / DEFAULT_CONFIG.learningRounds;
  };
  for (const s of strategies) before[s.name] = probe(s);
  for (let r = 0; r < opts.rounds; r++) {
    for (const s of strategies) {
      const secret = randomSecret(opts.rangeMin, opts.rangeMax);
      playRound(s, secret, opts.rangeMin, opts.rangeMax, false);
    }
    const step = Math.max(1, Math.floor(opts.rounds / 5));
    if ((r + 1) % step === 0)
      console.log(`  完成 ${r + 1}/${opts.rounds} 轮...`);
  }
  for (const s of strategies) after[s.name] = probe(s);
  console.log("\n策略            学习前  学习后   变化");
  for (const s of strategies) {
    const b = before[s.name];
    const a = after[s.name];
    const diff = b > 0 ? (((a - b) / b) * 100).toFixed(1) : "0.0";
    console.log(
      `${s.name.padEnd(14)} ${b.toFixed(2).padStart(6)}  ${a.toFixed(2).padStart(6)}  ${diff}%`,
    );
  }
}

function cmdStats(): void {
  const stats = loadStats();
  const names = Object.keys(stats);
  if (names.length === 0) {
    console.log("(暂无统计数据，先运行 play/tournament/learn)");
    return;
  }
  console.log("=== 跨轮统计 ===");
  console.log("策略            轮数  总猜测  胜数  最佳  最差  平均");
  for (const n of names) {
    const s = stats[n];
    const avg = s.rounds > 0 ? (s.totalGuesses / s.rounds).toFixed(2) : "0";
    console.log(
      `${s.name.padEnd(14)} ${s.rounds.toString().padStart(4)}  ${s.totalGuesses.toString().padStart(6)}  ${s.wins.toString().padStart(4)}  ${s.bestGuesses.toString().padStart(4)}  ${s.worstGuesses.toString().padStart(4)}  ${avg}`,
    );
  }
  console.log(`统计文件: ${STATS_PATH}`);
}

function cmdChallenge(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, res));
  (async () => {
    const minStr = await ask("请输入范围最小值(默认1): ");
    const maxStr = await ask("请输入范围最大值(默认100): ");
    const lo = minStr.trim() ? parseNum(minStr, 1) : 1;
    const hi = maxStr.trim() ? parseNum(maxStr, 100) : 100;
    const clampedLo = clamp(lo, 1, 100000, 1);
    const clampedHi = clamp(hi, clampedLo, 100000, 100);
    const secretStr = await ask(
      `请你在心里选一个 ${clampedLo}-${clampedHi} 的数字（输入它，AI 不会偷看）: `,
    );
    const secret = parseNum(secretStr, NaN);
    if (isNaN(secret) || secret < clampedLo || secret > clampedHi) {
      console.log("无效数字，挑战取消。");
      rl.close();
      return;
    }
    const strat = new BinarySearchStrategy();
    console.log("\nAI 开始猜测:");
    try {
      const record = playRound(strat, secret, clampedLo, clampedHi, true);
      console.log(`\nAI 用了 ${record.guesses} 次猜中你的数字 ${secret}。`);
    } catch (e) {
      if (e instanceof GameError)
        console.error(`游戏错误 [${e.code}]: ${e.message}`);
      else throw e;
    }
    rl.close();
  })();
}

// --- 17. 入口 ---

function main(): void {
  const opts = parseArgs(process.argv);
  if (!isCommand(opts.command)) {
    console.error(`未知命令: ${opts.command}`);
    printHelp();
    process.exit(1);
  }
  try {
    switch (opts.command) {
      case "play":
        cmdPlay(opts);
        break;
      case "tournament":
        cmdTournament(opts);
        break;
      case "learn":
        cmdLearn(opts);
        break;
      case "stats":
        cmdStats();
        break;
      case "challenge":
        cmdChallenge();
        break;
    }
  } catch (e) {
    if (e instanceof GameError) {
      console.error(`游戏错误 [${e.code}]: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main();
