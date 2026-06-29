#!/usr/bin/env node
/**
 * 文字版贪吃蛇 (Text-based Snake) - Enhanced Edition
 * 操作: 菜单 M 切换模式 / N 切换难度 / Enter 开始; 游戏中 WASD 或方向键移动,
 * P 或空格暂停, R 重开, Q 或 Ctrl+C 退出.
 * 特性: 4 难度 4 模式 特殊食物(奖励/加速/缩短) 连击 倍率 统计 方向队列 状态机 事件系统 回放.
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// ============== ANSI ==============
const ANSI = {
  RESET: "\x1b[0m",
  CLEAR: "\x1b[2J",
  CLEAR_LINE: "\x1b[2K",
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
  HOME: "\x1b[H",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  BG_RED: "\x1b[41m",
} as const;

// ============== 枚举：const enum + string enum ==============
const enum Dir {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}
enum GameMode {
  Classic = "CLASSIC",
  Wrap = "WRAP",
  Obstacle = "OBSTACLE",
  TimeAttack = "TIME_ATTACK",
}
enum Difficulty {
  Easy = "EASY",
  Normal = "NORMAL",
  Hard = "HARD",
  Insane = "INSANE",
}
enum Phase {
  Menu = "MENU",
  Playing = "PLAYING",
  Paused = "PAUSED",
  GameOver = "GAME_OVER",
}
enum FoodKind {
  Normal = "NORMAL",
  Bonus = "BONUS",
  SpeedUp = "SPEED_UP",
  Shrink = "SHRINK",
}

// ============== 基础类型 ==============
interface Point {
  readonly x: number;
  readonly y: number;
}
type Cell = readonly [number, number]; // readonly tuple

interface Food {
  readonly kind: FoodKind;
  readonly pos: Point;
  readonly glyph: string;
  readonly color: string;
  readonly value: number;
  readonly born: number;
  readonly ttl?: number; // 可选属性
}

// Discriminated union（type 字段判别）
type GameEvent =
  | {
      readonly type: "start";
      readonly mode: GameMode;
      readonly difficulty: Difficulty;
    }
  | { readonly type: "tick"; readonly step: number; readonly phase: Phase }
  | {
      readonly type: "eat";
      readonly food: FoodKind;
      readonly points: number;
      readonly combo: number;
    }
  | { readonly type: "grow"; readonly newLength: number }
  | { readonly type: "shrink"; readonly newLength: number }
  | {
      readonly type: "gameover";
      readonly reason: string;
      readonly finalScore: number;
    }
  | { readonly type: "phase"; readonly from: Phase; readonly to: Phase }
  | { readonly type: "pause" }
  | { readonly type: "resume" };

type EventType = GameEvent["type"];
type HandlerName = `on${Capitalize<EventType>}`; // 模板字面量类型
type Mutable<T> = { -readonly [K in keyof T]: T[K] }; // 映射类型 + -readonly
type EventMap = { [K in EventType]: Extract<GameEvent, { readonly type: K }> };
type Listener<T extends GameEvent> = (e: T) => void; // 泛型约束
type UnwrapKind<T> = T extends { readonly kind: infer K } ? K : never; // 条件类型
type FoodKindOf = UnwrapKind<Food>;
type CoreStats = Omit<Statistics, "byMode">;

// ============== 自定义错误层级（带 code）==============
class GameError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}
class ConfigError extends GameError {
  constructor(m: string) {
    super(m, "CONFIG_ERROR");
    this.name = "ConfigError";
  }
}
class StateError extends GameError {
  constructor(m: string) {
    super(m, "STATE_ERROR");
    this.name = "StateError";
  }
}
class InputError extends GameError {
  constructor(m: string) {
    super(m, "INPUT_ERROR");
    this.name = "InputError";
  }
}

// ============== 配置 ==============
interface DifficultyConfig {
  readonly speed: number;
  readonly width: number;
  readonly height: number;
  readonly obstacles: number;
  readonly scoreMultiplier: number;
  readonly label: string;
}
const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  [Difficulty.Easy]: {
    speed: 220,
    width: 24,
    height: 14,
    obstacles: 0,
    scoreMultiplier: 1.0,
    label: "简单",
  },
  [Difficulty.Normal]: {
    speed: 160,
    width: 22,
    height: 13,
    obstacles: 0,
    scoreMultiplier: 1.5,
    label: "普通",
  },
  [Difficulty.Hard]: {
    speed: 110,
    width: 20,
    height: 12,
    obstacles: 6,
    scoreMultiplier: 2.0,
    label: "困难",
  },
  [Difficulty.Insane]: {
    speed: 70,
    width: 18,
    height: 11,
    obstacles: 12,
    scoreMultiplier: 3.0,
    label: "极限",
  },
} satisfies Record<Difficulty, DifficultyConfig>;

interface ModeConfig {
  readonly wrapWalls: boolean;
  readonly obstaclesEnabled: boolean;
  readonly timeLimit?: number;
  readonly label: string;
}
const MODE: Record<GameMode, ModeConfig> = {
  [GameMode.Classic]: {
    wrapWalls: false,
    obstaclesEnabled: false,
    label: "经典",
  },
  [GameMode.Wrap]: { wrapWalls: true, obstaclesEnabled: false, label: "穿墙" },
  [GameMode.Obstacle]: {
    wrapWalls: false,
    obstaclesEnabled: true,
    label: "障碍",
  },
  [GameMode.TimeAttack]: {
    wrapWalls: false,
    obstaclesEnabled: false,
    timeLimit: 60,
    label: "限时",
  },
} satisfies Record<GameMode, ModeConfig>;

// ============== 统计信息 ==============
interface Statistics {
  gamesPlayed: number;
  totalScore: number;
  bestScore: number;
  longestSnake: number;
  totalFoodEaten: number;
  bestCombo: number;
  byMode: { [mode: string]: number }; // 索引签名
}
const DEFAULT_STATS: Readonly<Statistics> = {
  gamesPlayed: 0,
  totalScore: 0,
  bestScore: 0,
  longestSnake: 0,
  totalFoodEaten: 0,
  bestCombo: 0,
  byMode: {},
};

// Symbol 作为唯一属性键
const STATS_VERSION = Symbol("statsVersion");
interface PersistedStats extends Statistics {
  [STATS_VERSION]?: number;
}

const DATA_DIR = process.env.USERPROFILE || process.env.HOME || ".";
const HIGH_SCORE_FILE = path.join(DATA_DIR, ".snake_highscore.txt");
const STATS_FILE = path.join(DATA_DIR, ".snake_stats.json");

function loadHighScore(): number {
  try {
    if (fs.existsSync(HIGH_SCORE_FILE)) {
      const n = parseInt(fs.readFileSync(HIGH_SCORE_FILE, "utf-8").trim(), 10);
      return Number.isNaN(n) ? 0 : n;
    }
  } catch {
    /* 忽略 */
  }
  return 0;
}
function saveHighScore(score: number): void {
  try {
    fs.writeFileSync(HIGH_SCORE_FILE, String(score), "utf-8");
  } catch {
    /* 忽略 */
  }
}
function loadStats(): Statistics {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = JSON.parse(
        fs.readFileSync(STATS_FILE, "utf-8"),
      ) as Partial<Statistics>;
      return { ...DEFAULT_STATS, ...raw, byMode: { ...raw.byMode } };
    }
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULT_STATS, byMode: {} };
}
function saveStats(stats: Readonly<Statistics>): void {
  try {
    const copy: PersistedStats = {
      ...stats,
      byMode: { ...stats.byMode },
      [STATS_VERSION]: 1,
    };
    fs.writeFileSync(STATS_FILE, JSON.stringify(copy, null, 2), "utf-8");
  } catch {
    /* 忽略 */
  }
}
// 异步版本，演示 Awaited / ReturnType
async function loadStatsAsync(): Promise<Statistics> {
  return new Promise<Statistics>((resolve) => {
    fs.readFile(STATS_FILE, "utf-8", (err, data) => {
      if (err) return resolve({ ...DEFAULT_STATS, byMode: {} });
      try {
        const raw = JSON.parse(data) as Partial<Statistics>;
        resolve({ ...DEFAULT_STATS, ...raw, byMode: { ...raw.byMode } });
      } catch {
        resolve({ ...DEFAULT_STATS, byMode: {} });
      }
    });
  });
}
type LoadedStats = Awaited<ReturnType<typeof loadStatsAsync>>;
type PickFoodParams = Parameters<typeof pickFood>;
type SpawnFoodKind = FoodKindOf;

// ============== 工具函数 ==============
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
// 类型守卫
function isPoint(v: unknown): v is Point {
  return (
    typeof v === "object" &&
    v !== null &&
    "x" in v &&
    "y" in v &&
    Number.isFinite((v as Point).x) &&
    Number.isFinite((v as Point).y)
  );
}
const keyOf = (p: Point): string => `${p.x},${p.y}`;
const eq = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
const DELTA: Readonly<Record<Dir, Cell>> = {
  [Dir.Up]: [0, -1],
  [Dir.Down]: [0, 1],
  [Dir.Left]: [-1, 0],
  [Dir.Right]: [1, 0],
} as const;
function isOpposite(a: Dir, b: Dir): boolean {
  return (
    (a === Dir.Up && b === Dir.Down) ||
    (a === Dir.Down && b === Dir.Up) ||
    (a === Dir.Left && b === Dir.Right) ||
    (a === Dir.Right && b === Dir.Left)
  );
}
// 生成器：整数范围
function* range(
  start: number,
  end: number,
  step = 1,
): Generator<number, void, unknown> {
  if (step <= 0) throw new GameError("step must be positive", "RANGE_STEP");
  for (let i = start; i < end; i += step) yield i;
}
// 生成器：所有空白格子
function* emptyCells(
  width: number,
  height: number,
  occupied: ReadonlySet<string>,
): Generator<Point> {
  for (const y of range(0, height))
    for (const x of range(0, width)) {
      const p: Point = { x, y };
      if (!occupied.has(keyOf(p))) yield p;
    }
}

// ============== 食物生成器（抽象类 + 模板方法）==============
abstract class FoodSpawner {
  constructor(protected readonly rng: () => number = Math.random) {}
  abstract kind(): FoodKind;
  abstract glyph(): string;
  abstract color(): string;
  abstract scoreValue(): number;
  protected ttl(): number | undefined {
    return undefined;
  }
  spawn(pos: Point): Food {
    // 模板方法
    return {
      kind: this.kind(),
      pos,
      glyph: this.glyph(),
      color: this.color(),
      value: this.scoreValue(),
      born: Date.now(),
      ttl: this.ttl(),
    };
  }
}
class NormalFood extends FoodSpawner {
  kind() {
    return FoodKind.Normal;
  }
  glyph() {
    return "●";
  }
  color() {
    return ANSI.RED;
  }
  scoreValue() {
    return 10;
  }
}
class BonusFood extends FoodSpawner {
  kind() {
    return FoodKind.Bonus;
  }
  glyph() {
    return "★";
  }
  color() {
    return ANSI.YELLOW;
  }
  scoreValue() {
    return 50;
  }
  protected ttl() {
    return 8000;
  }
}
class SpeedFood extends FoodSpawner {
  kind() {
    return FoodKind.SpeedUp;
  }
  glyph() {
    return "⚡";
  }
  color() {
    return ANSI.MAGENTA;
  }
  scoreValue() {
    return 20;
  }
  protected ttl() {
    return 6000;
  }
}
class ShrinkFood extends FoodSpawner {
  kind() {
    return FoodKind.Shrink;
  }
  glyph() {
    return "✂";
  }
  color() {
    return ANSI.CYAN;
  }
  scoreValue() {
    return 30;
  }
  protected ttl() {
    return 6000;
  }
}
const SPAWNERS: Record<FoodKind, FoodSpawner> = {
  [FoodKind.Normal]: new NormalFood(),
  [FoodKind.Bonus]: new BonusFood(),
  [FoodKind.SpeedUp]: new SpeedFood(),
  [FoodKind.Shrink]: new ShrinkFood(),
};

// 函数重载
function pickFood(available: readonly FoodKind[], exclude?: FoodKind): FoodKind;
function pickFood<T extends FoodKind>(
  available: readonly T[],
  rng?: () => number,
): T;
function pickFood(
  available: readonly FoodKind[],
  rngOrExclude?: FoodKind | (() => number),
): FoodKind {
  const rng = typeof rngOrExclude === "function" ? rngOrExclude : Math.random;
  const exclude = typeof rngOrExclude === "string" ? rngOrExclude : undefined;
  const pool = exclude ? available.filter((k) => k !== exclude) : available;
  if (pool.length === 0) return FoodKind.Normal;
  return pool[Math.floor(rng() * pool.length)] ?? FoodKind.Normal;
}

// ============== 方向队列 ==============
class DirectionQueue {
  private readonly queue: Dir[] = [];
  private readonly max: number;
  constructor(max = 3) {
    if (max < 1) throw new ConfigError("queue max must be >= 1");
    this.max = max;
  }
  enqueue(dir: Dir, current: Dir): boolean {
    const last =
      this.queue.length > 0 ? this.queue[this.queue.length - 1] : current;
    if (isOpposite(dir, last) || dir === last || this.queue.length >= this.max)
      return false;
    this.queue.push(dir);
    return true;
  }
  dequeue(current: Dir): Dir {
    return this.queue.length === 0 ? current : (this.queue.shift() as Dir);
  }
  clear(): void {
    this.queue.length = 0;
  }
  get length(): number {
    return this.queue.length;
  }
  [Symbol.iterator](): Iterator<Dir> {
    let i = 0;
    const arr = [...this.queue];
    return {
      next: (): IteratorResult<Dir> =>
        i < arr.length
          ? { value: arr[i++], done: false }
          : { value: undefined as unknown as Dir, done: true },
    };
  }
}

// ============== 事件系统 ==============
class GameEventEmitter {
  private readonly listeners = new Map<EventType, Array<(e: any) => void>>();
  on<K extends EventType>(type: K, fn: Listener<EventMap[K]>): () => void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
    return () => this.off(type, fn);
  }
  off<K extends EventType>(type: K, fn: Listener<EventMap[K]>): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  emit<K extends EventType>(type: K, e: EventMap[K]): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    for (const fn of [...arr]) {
      try {
        fn(e);
      } catch (err) {
        const code = err instanceof GameError ? err.code : "LISTENER_ERROR";
        process.stderr.write(
          `[listener ${String(type)}] ${code}: ${(err as Error).message}\n`,
        );
      }
    }
  }
}

// ============== 移动历史 / 回放 ==============
interface MoveRecord {
  readonly step: number;
  readonly dir: Dir;
  readonly head: Point;
  readonly ate: FoodKind | null;
}
class MoveHistory implements Iterable<MoveRecord> {
  private readonly records: MoveRecord[] = [];
  private readonly cap: number;
  constructor(cap = 1000) {
    this.cap = cap;
  }
  push(r: MoveRecord): void {
    this.records.push(r);
    if (this.records.length > this.cap) this.records.shift();
  }
  get length(): number {
    return this.records.length;
  }
  get last(): MoveRecord | undefined {
    return this.records[this.records.length - 1];
  }
  [Symbol.iterator](): Iterator<MoveRecord> {
    let i = 0;
    return {
      next: (): IteratorResult<MoveRecord> =>
        i < this.records.length
          ? { value: this.records[i++], done: false }
          : { value: undefined as unknown as MoveRecord, done: true },
    };
  }
  snapshot(): readonly MoveRecord[] {
    return [...this.records];
  }
}

// ============== 渲染上下文与棋盘状态 ==============
interface RenderContext {
  readonly phase: Phase;
  readonly mode: GameMode;
  readonly difficulty: Difficulty;
  readonly highScore: number;
  readonly stats: Readonly<Statistics>;
  readonly timeLeft?: number;
  readonly message?: string;
}
interface BoardState {
  readonly width: number;
  readonly height: number;
  readonly snake: readonly Point[];
  readonly foods: readonly Food[];
  readonly obstacles: readonly Point[];
  readonly direction: Dir;
  readonly speed: number;
  readonly score: number;
  readonly combo: number;
  readonly stepCount: number;
  readonly timeLeft?: number;
}

// ============== 渲染器（抽象基类 + 具体子类）==============
abstract class BaseRenderer {
  protected readonly out: NodeJS.WritableStream = process.stdout;
  abstract render(board: BoardState, ctx: RenderContext): void;
  protected write(s: string): void {
    this.out.write(s);
  }
  protected reset(): void {
    this.write(ANSI.CLEAR + ANSI.HOME);
  }
}
class TerminalRenderer extends BaseRenderer {
  render(board: BoardState, ctx: RenderContext): void {
    this.reset();
    if (ctx.phase === Phase.Menu) {
      this.write(this.menuScreen(ctx));
      return;
    }
    const grid = this.buildGrid(board);
    const lines: string[] = [];
    lines.push(ANSI.CYAN + "┌" + "─".repeat(board.width) + "┐" + ANSI.RESET);
    for (const y of range(0, board.height))
      lines.push(
        ANSI.CYAN +
          "│" +
          ANSI.RESET +
          grid[y].join("") +
          ANSI.CYAN +
          "│" +
          ANSI.RESET,
      );
    lines.push(
      ANSI.CYAN + "└" + "─".repeat(board.width) + "┘" + ANSI.RESET,
      "",
    );
    lines.push(this.statusLine(board, ctx), this.helpLine(ctx));
    if (ctx.phase === Phase.GameOver) lines.push(this.gameOverLine(board, ctx));
    this.write(lines.join("\n") + "\n");
  }
  private buildGrid(board: BoardState): string[][] {
    const grid: string[][] = [];
    for (const _y of range(0, board.height))
      grid.push(Array.from({ length: board.width }, () => " "));
    for (const ob of board.obstacles)
      if (this.inBounds(ob, board))
        grid[ob.y][ob.x] = ANSI.DIM + "▓" + ANSI.RESET;
    for (const f of board.foods)
      if (this.inBounds(f.pos, board)) {
        const blink = this.expiredSoon(f) ? ANSI.BOLD : "";
        grid[f.pos.y][f.pos.x] = f.color + blink + f.glyph + ANSI.RESET;
      }
    board.snake.forEach((seg, i) => {
      if (this.inBounds(seg, board))
        grid[seg.y][seg.x] =
          i === 0
            ? ANSI.GREEN + ANSI.BOLD + "◆" + ANSI.RESET
            : ANSI.GREEN + "█" + ANSI.RESET;
    });
    return grid;
  }
  private inBounds(
    p: Point,
    board: Pick<BoardState, "width" | "height">,
  ): boolean {
    return p.x >= 0 && p.x < board.width && p.y >= 0 && p.y < board.height;
  }
  private expiredSoon(f: Food): boolean {
    return f.ttl !== undefined && f.ttl - (Date.now() - f.born) < 2000;
  }
  private statusLine(b: BoardState, ctx: RenderContext): string {
    const parts = [
      `${ANSI.BOLD}分数:${ANSI.RESET} ${ANSI.YELLOW}${b.score}${ANSI.RESET}`,
      `${ANSI.BOLD}最高:${ANSI.RESET} ${ANSI.YELLOW}${Math.max(ctx.highScore, b.score)}${ANSI.RESET}`,
      `${ANSI.BOLD}长度:${ANSI.RESET} ${ANSI.YELLOW}${b.snake.length}${ANSI.RESET}`,
      `${ANSI.BOLD}连击:${ANSI.RESET} ${ANSI.MAGENTA}x${b.combo}${ANSI.RESET}`,
      `${ANSI.BOLD}速度:${ANSI.RESET} ${ANSI.YELLOW}${b.speed}ms${ANSI.RESET}`,
    ];
    if (ctx.timeLeft !== undefined)
      parts.push(
        `${ANSI.BOLD}剩余:${ANSI.RESET} ${ctx.timeLeft > 10 ? ANSI.GREEN : ANSI.RED}${Math.ceil(ctx.timeLeft)}s${ANSI.RESET}`,
      );
    return parts.join("  ");
  }
  private helpLine(ctx: RenderContext): string {
    const tag =
      ctx.phase === Phase.Paused ? `  ${ANSI.YELLOW}[已暂停]${ANSI.RESET}` : "";
    return `${ANSI.DIM}WASD/方向键移动  P 空格暂停  Q 退出  R 重开${ANSI.RESET}${tag}`;
  }
  private gameOverLine(b: BoardState, ctx: RenderContext): string {
    const isNew = b.score >= ctx.highScore && b.score > 0;
    return [
      `${ANSI.RED}${ANSI.BOLD}========== 游戏结束 ==========${ANSI.RESET}`,
      `${ANSI.YELLOW}最终: ${b.score}  最长: ${ctx.stats.longestSnake}  已玩: ${ctx.stats.gamesPlayed}${ANSI.RESET}`,
      isNew
        ? `${ANSI.YELLOW}★ 新的最高分! ★${ANSI.RESET}`
        : `${ANSI.CYAN}按 R 返回菜单, Q 退出${ANSI.RESET}`,
    ].join("\n");
  }
  private menuScreen(ctx: RenderContext): string {
    const m = MODE[ctx.mode],
      d = DIFFICULTY[ctx.difficulty],
      s = ctx.stats;
    return (
      [
        `${ANSI.BOLD}${ANSI.CYAN}╔══════ 文字版贪吃蛇 (增强版) ══════╗${ANSI.RESET}`,
        "",
        `  ${ANSI.BOLD}模式${ANSI.RESET}  : ${ANSI.YELLOW}${m.label}${ANSI.RESET}  ${ANSI.DIM}(${ctx.mode})${ANSI.RESET}`,
        `  ${ANSI.BOLD}难度${ANSI.RESET}  : ${ANSI.YELLOW}${d.label}${ANSI.RESET}  ${ANSI.DIM}速度${d.speed}ms 棋盘${d.width}x${d.height} 障碍${d.obstacles} 倍率x${d.scoreMultiplier}${ANSI.RESET}`,
        "",
        `  ${ANSI.CYAN}M${ANSI.RESET} 切换模式    ${ANSI.CYAN}N${ANSI.RESET} 切换难度`,
        `  ${ANSI.CYAN}Enter / 空格${ANSI.RESET} 开始    ${ANSI.CYAN}Q${ANSI.RESET} 退出`,
        "",
        `  ${ANSI.DIM}食物图例:${ANSI.RESET} ${ANSI.RED}●${ANSI.RESET} 普通 ${ANSI.YELLOW}★${ANSI.RESET} 奖励 ${ANSI.MAGENTA}⚡${ANSI.RESET} 加速 ${ANSI.CYAN}✂${ANSI.RESET} 缩短`,
        `  ${ANSI.DIM}统计:${ANSI.RESET} 最高 ${ctx.highScore}  累计 ${s.totalScore}  最长 ${s.longestSnake}  场次 ${s.gamesPlayed}`,
        "",
        `${ANSI.DIM}选择后按 Enter 开始...${ANSI.RESET}`,
      ].join("\n") + "\n"
    );
  }
}

// ============== 游戏核心引擎 ==============
class SnakeGame {
  private _phase: Phase = Phase.Menu;
  private mode: GameMode = GameMode.Classic;
  private difficulty: Difficulty = Difficulty.Normal;
  private snake: Point[] = [];
  private dir: Dir = Dir.Right;
  private readonly dirQueue: DirectionQueue = new DirectionQueue(3);
  private foods: Food[] = [];
  private obstacles: Point[] = [];
  private _score = 0;
  private combo = 0;
  private comboTimer = 0;
  private speedBoostTicks = 0;
  private stepCount = 0;
  private foodStep = 0;
  private width = 22;
  private height = 13;
  private timeLeft: number | undefined;
  private readonly history = new MoveHistory(500);
  private readonly emitter = new GameEventEmitter();
  private readonly stats: Statistics;
  private highScore: number;

  constructor(opts: { highScore: number; stats: Statistics }) {
    this.highScore = opts.highScore;
    this.stats = opts.stats;
    this.initPreview();
  }

  // Getter
  get phase(): Phase {
    return this._phase;
  }
  get score(): number {
    return this._score;
  }
  get currentMode(): GameMode {
    return this.mode;
  }
  get currentDifficulty(): Difficulty {
    return this.difficulty;
  }
  get highScoreValue(): number {
    return this.highScore;
  }
  set highScoreValue(n: number) {
    this.highScore = Math.max(0, Math.floor(n));
    saveHighScore(this.highScore);
  }
  get statsValue(): Readonly<Statistics> {
    return this.stats;
  }
  get historySnapshot(): readonly MoveRecord[] {
    return this.history.snapshot();
  }
  get currentSpeed(): number {
    const d = DIFFICULTY[this.difficulty];
    const accel = Math.max(0, Math.floor(this._score / 80) * 8);
    const boosted = this.speedBoostTicks > 0 ? 30 : 0;
    return Math.max(40, d.speed - accel - boosted);
  }
  get board(): BoardState {
    return {
      width: this.width,
      height: this.height,
      snake: this.snake,
      foods: this.foods,
      obstacles: this.obstacles,
      direction: this.dir,
      speed: this.currentSpeed,
      score: this._score,
      combo: this.combo,
      stepCount: this.stepCount,
      timeLeft: this.timeLeft,
    };
  }
  on<K extends EventType>(type: K, fn: Listener<EventMap[K]>): () => void {
    return this.emitter.on(type, fn);
  }

  private initPreview(): void {
    const d = DIFFICULTY[this.difficulty];
    this.width = d.width;
    this.height = d.height;
    const sx = Math.floor(this.width / 2),
      sy = Math.floor(this.height / 2);
    this.snake = [
      { x: sx, y: sy },
      { x: sx - 1, y: sy },
      { x: sx - 2, y: sy },
    ];
    this.foods = [
      {
        kind: FoodKind.Normal,
        pos: { x: 2, y: 2 },
        glyph: "●",
        color: ANSI.RED,
        value: 10,
        born: Date.now(),
      },
    ];
    this.obstacles = [];
    this._score = 0;
  }
  private setPhase(p: Phase): void {
    const from = this._phase;
    if (from === p) return;
    this._phase = p;
    this.emitter.emit("phase", { type: "phase", from, to: p });
  }
  cycleMode(): void {
    const ms = Object.values(GameMode);
    this.mode = ms[(ms.indexOf(this.mode) + 1) % ms.length];
  }
  cycleDifficulty(): void {
    const ds = Object.values(Difficulty);
    this.difficulty = ds[(ds.indexOf(this.difficulty) + 1) % ds.length];
    if (this._phase === Phase.Menu) this.initPreview();
  }
  start(): void {
    const d = DIFFICULTY[this.difficulty],
      m = MODE[this.mode];
    this.width = d.width;
    this.height = d.height;
    this._score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.speedBoostTicks = 0;
    this.stepCount = 0;
    this.foodStep = 0;
    this.dir = Dir.Right;
    this.dirQueue.clear();
    const sx = Math.floor(this.width / 2),
      sy = Math.floor(this.height / 2);
    this.snake = [
      { x: sx, y: sy },
      { x: sx - 1, y: sy },
      { x: sx - 2, y: sy },
    ];
    this.obstacles = [];
    this.placeObstacles(m.obstaclesEnabled ? d.obstacles : 0);
    this.foods = [];
    this.spawnFood(FoodKind.Normal);
    this.timeLeft = m.timeLimit;
    this.setPhase(Phase.Playing);
    this.emitter.emit("start", {
      type: "start",
      mode: this.mode,
      difficulty: this.difficulty,
    });
  }
  private placeObstacles(count: number): void {
    const occupied = new Set<string>(this.snake.map(keyOf));
    for (let i = 0; i < count; i++) {
      const cells = [...emptyCells(this.width, this.height, occupied)];
      if (cells.length === 0) break;
      const p = cells[Math.floor(Math.random() * cells.length)] ?? cells[0];
      this.obstacles.push(p);
      occupied.add(keyOf(p));
    }
  }
  private spawnFood(forceKind?: SpawnFoodKind): Food {
    const occupied = new Set<string>([
      ...this.snake.map(keyOf),
      ...this.obstacles.map(keyOf),
      ...this.foods.map((f) => keyOf(f.pos)),
    ]);
    const cells = [...emptyCells(this.width, this.height, occupied)];
    if (cells.length === 0) throw new StateError("no empty cell for food");
    const pos = cells[Math.floor(Math.random() * cells.length)] ?? cells[0];
    const kind = (forceKind ?? this.chooseFoodKind()) as FoodKind;
    const food = SPAWNERS[kind].spawn(pos);
    this.foods.push(food);
    return food;
  }
  private chooseFoodKind(): FoodKind {
    const r = Math.random();
    if (this.snake.length > 6 && r < 0.12) return FoodKind.Shrink;
    if (r < 0.2) return FoodKind.SpeedUp;
    if (r < 0.32) return FoodKind.Bonus;
    return FoodKind.Normal;
  }
  private expireFoods(): void {
    const now = Date.now();
    this.foods = this.foods.filter((f) =>
      f.ttl === undefined ? true : now - f.born < f.ttl,
    );
    if (this.foods.length === 0) this.spawnFood(FoodKind.Normal);
  }
  // 单步推进
  tick(): void {
    if (this._phase !== Phase.Playing) return;
    this.stepCount++;
    this.expireFoods();
    if (this.comboTimer > 0 && --this.comboTimer === 0) this.combo = 0;
    if (this.speedBoostTicks > 0) this.speedBoostTicks--;
    this.dir = this.dirQueue.dequeue(this.dir);
    const [dx, dy] = DELTA[this.dir];
    const head = this.snake[0];
    let nx = head.x + dx,
      ny = head.y + dy;
    const m = MODE[this.mode];
    if (m.wrapWalls) {
      nx = (nx + this.width) % this.width;
      ny = (ny + this.height) % this.height;
    } else if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height)
      return this.gameOver("撞墙");
    const newHead: Point = { x: nx, y: ny };
    if (this.obstacles.some((o) => eq(o, newHead)))
      return this.gameOver("撞到障碍");
    const willGrow = this.foods.some((f) => eq(f.pos, newHead));
    const bodyLimit = willGrow ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < bodyLimit; i++)
      if (eq(this.snake[i], newHead)) return this.gameOver("撞到自己");
    this.snake.unshift(newHead);
    let ate: FoodKind | null = null;
    const foodIdx = this.foods.findIndex((f) => eq(f.pos, newHead));
    if (foodIdx >= 0) {
      const f = this.foods[foodIdx];
      ate = f.kind;
      this.foods.splice(foodIdx, 1);
      this.applyFood(f);
      this.spawnFood(FoodKind.Normal);
      if (this.foodStep++ % 5 === 0 && Math.random() < 0.5) {
        try {
          this.spawnFood();
        } catch {
          /* 忽略 */
        }
      }
    } else {
      this.snake.pop();
    }
    this.history.push({
      step: this.stepCount,
      dir: this.dir,
      head: newHead,
      ate,
    });
    this.emitter.emit("tick", {
      type: "tick",
      step: this.stepCount,
      phase: this._phase,
    });
    if (this.timeLeft !== undefined && this.timeLeft <= 0)
      return this.gameOver("时间到");
  }
  private applyFood(f: Food): void {
    const d = DIFFICULTY[this.difficulty];
    this.combo++;
    this.comboTimer = 30;
    if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;
    const comboMult = 1 + (this.combo - 1) * 0.25;
    const gained = Math.round(f.value * d.scoreMultiplier * comboMult);
    this._score += gained;
    this.stats.totalFoodEaten++;
    this.emitter.emit("eat", {
      type: "eat",
      food: f.kind,
      points: gained,
      combo: this.combo,
    });
    switch (f.kind) {
      case FoodKind.Bonus:
        this.growBy(2);
        break;
      case FoodKind.SpeedUp:
        this.speedBoostTicks = 40;
        break;
      case FoodKind.Shrink:
        this.shrinkBy(2);
        break;
      case FoodKind.Normal:
      default:
        break;
    }
    if (this.snake.length > this.stats.longestSnake)
      this.stats.longestSnake = this.snake.length;
  }
  private growBy(n: number): void {
    const tail = this.snake[this.snake.length - 1];
    for (let i = 0; i < n; i++) this.snake.push({ ...tail });
    this.emitter.emit("grow", { type: "grow", newLength: this.snake.length });
  }
  private shrinkBy(n: number): void {
    for (let i = 0; i < n && this.snake.length > 2; i++) this.snake.pop();
    this.emitter.emit("shrink", {
      type: "shrink",
      newLength: this.snake.length,
    });
  }
  // 输入处理；抛 InputError 表示请求退出
  input(name: string, sequence: string, ctrl: boolean): void {
    const k = (name || sequence || "").toLowerCase();
    if (ctrl && (k === "c" || k === "\x03")) throw new InputError("quit");
    if (this._phase === Phase.Menu) {
      if (k === "m") this.cycleMode();
      else if (k === "n") this.cycleDifficulty();
      else if (k === "return" || k === "enter" || k === " ") this.start();
      else if (k === "q") throw new InputError("quit");
      return;
    }
    if (this._phase === Phase.GameOver) {
      if (k === "r") this.setPhase(Phase.Menu);
      else if (k === "q") throw new InputError("quit");
      return;
    }
    if (k === "p" || k === "space" || k === " ") {
      if (this._phase === Phase.Playing) {
        this.setPhase(Phase.Paused);
        this.emitter.emit("pause", { type: "pause" });
      } else if (this._phase === Phase.Paused) {
        this.setPhase(Phase.Playing);
        this.emitter.emit("resume", { type: "resume" });
      }
      return;
    }
    if (k === "q") throw new InputError("quit");
    if (this._phase !== Phase.Playing) return;
    const map: Record<string, Dir> = {
      w: Dir.Up,
      up: Dir.Up,
      s: Dir.Down,
      down: Dir.Down,
      a: Dir.Left,
      left: Dir.Left,
      d: Dir.Right,
      right: Dir.Right,
    };
    const nd = map[k];
    if (nd !== undefined) this.dirQueue.enqueue(nd, this.dir);
  }
  private gameOver(reason: string): void {
    this.setPhase(Phase.GameOver);
    this.stats.gamesPlayed++;
    this.stats.totalScore += this._score;
    this.stats.byMode[this.mode] = (this.stats.byMode[this.mode] ?? 0) + 1;
    if (this._score > this.highScore) {
      this.highScore = this._score;
      saveHighScore(this.highScore);
    }
    if (this._score > this.stats.bestScore) this.stats.bestScore = this._score;
    if (this.snake.length > this.stats.longestSnake)
      this.stats.longestSnake = this.snake.length;
    saveStats(this.stats);
    this.emitter.emit("gameover", {
      type: "gameover",
      reason,
      finalScore: this._score,
    });
  }
  tickTime(dtSeconds: number): void {
    if (this._phase !== Phase.Playing) return;
    if (this.timeLeft !== undefined)
      this.timeLeft = Math.max(0, this.timeLeft - dtSeconds);
  }
}

// ============== 按键信息 ==============
interface KeyInfo {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

// ============== 游戏控制器 ==============
class GameController {
  private readonly game: SnakeGame;
  private readonly renderer: TerminalRenderer;
  private readonly rl: readline.Interface;
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;

  constructor(rl: readline.Interface) {
    this.rl = rl;
    this.game = new SnakeGame({
      highScore: loadHighScore(),
      stats: loadStats(),
    });
    this.renderer = new TerminalRenderer();
    this.game.on("phase", () => this.render());
    this.game.on("gameover", () => this.render());
  }
  start(): void {
    process.stdout.write(ANSI.HIDE_CURSOR);
    this.rl.on("keypress", (_ch, key) =>
      this.onKey(key as KeyInfo | undefined),
    );
    this.render();
    this.schedule();
  }
  private onKey(key?: KeyInfo): void {
    if (!key) return;
    try {
      this.game.input(key?.name ?? "", key?.sequence ?? "", key?.ctrl ?? false);
    } catch (e) {
      if (e instanceof InputError) {
        this.quit();
        return;
      }
      throw e;
    }
    this.render();
    this.schedule();
  }
  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.game.phase === Phase.Playing) {
      this.lastTick = Date.now();
      this.timer = setTimeout(() => this.step(), this.game.currentSpeed);
    } else {
      this.timer = setTimeout(() => this.idle(), 250);
    }
  }
  private idle(): void {
    this.game.tickTime(0.25);
    this.render();
    this.schedule();
  }
  private step(): void {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.game.tick();
    this.game.tickTime(dt);
    this.render();
    this.schedule();
  }
  private render(): void {
    const b = this.game.board;
    this.renderer.render(b, {
      phase: this.game.phase,
      mode: this.game.currentMode,
      difficulty: this.game.currentDifficulty,
      highScore: this.game.highScoreValue,
      stats: this.game.statsValue,
      timeLeft: b.timeLeft,
    });
  }
  quit(): void {
    if (this.timer) clearTimeout(this.timer);
    process.stdout.write(ANSI.SHOW_CURSOR + ANSI.CLEAR + ANSI.HOME);
    const s = this.game.statsValue;
    console.log(`${ANSI.CYAN}感谢游玩文字版贪吃蛇!${ANSI.RESET}`);
    console.log(
      `最终分数: ${this.game.score}  最高分: ${this.game.highScoreValue}`,
    );
    console.log(
      `统计: 场次 ${s.gamesPlayed}  累计 ${s.totalScore}  最长 ${s.longestSnake}  最佳连击 ${s.bestCombo}`,
    );
    this.rl.close();
    process.exit(0);
  }
}

// ============== 入口 ==============
function main(): void {
  console.log(
    `${ANSI.BOLD}${ANSI.CYAN}===== 文字版贪吃蛇 (增强版) =====${ANSI.RESET}`,
  );
  console.log(
    "操作: 菜单中 M 切换模式 / N 切换难度 / Enter 开始; 游戏中 WASD 或方向键移动",
  );
  console.log("P 或空格暂停, Q 或 Ctrl+C 退出\n");
  if (!process.stdin.isTTY) {
    console.error("请在 TTY 终端下运行此游戏");
    process.exit(1);
  }
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const controller = new GameController(rl);
  controller.start();
  process.on("SIGINT", () => controller.quit());
}

main();
