#!/usr/bin/env node
/**
 * 数字华容道 (Number 15-puzzle / Klotski) - Enhanced Edition
 * 支持 3x3 / 4x4 / 5x5，三种模式 (数字 / ASCII 图像 / 颜色)，可解性校验、
 * 保证有解的洗牌、撤销/重做、A* 求解 (曼哈顿+线性冲突)、提示、状态机、
 * 类型化事件系统、统计与最佳成绩持久化。
 *
 * 命令: u/d/l/r 移动 | n 新游戏 | s 求解 | i 提示 | z 撤销 | y 重做
 *        p 暂停 | m 切换模式 | +/- 改尺寸 | h 帮助 | q 退出
 */
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// ===================== Const Enums & String Enums =====================
const enum Direction {
  Up = "U",
  Down = "D",
  Left = "L",
  Right = "R",
}
enum GameMode {
  Classic = "classic",
  Image = "image",
  Color = "color",
}
enum GameStatus {
  Menu = "menu",
  Playing = "playing",
  Paused = "paused",
  Won = "won",
}

// ===================== as const / satisfies =====================
const ANSI = {
  RESET: "\x1b[0m",
  CLEAR: "\x1b[2J",
  HOME: "\x1b[H",
  BOLD: "\x1b[1m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
  WHITE: "\x1b[97m",
} as const;

interface DirDef {
  readonly name: Direction;
  readonly dr: number;
  readonly dc: number;
  readonly opp: Direction;
}

const DIRECTIONS = [
  { name: Direction.Up, dr: -1, dc: 0, opp: Direction.Down },
  { name: Direction.Down, dr: 1, dc: 0, opp: Direction.Up },
  { name: Direction.Left, dr: 0, dc: -1, opp: Direction.Right },
  { name: Direction.Right, dr: 0, dc: 1, opp: Direction.Left },
] as const satisfies readonly DirDef[];

const VALID_SIZES = [3, 4, 5] as const;
type BoardSize = (typeof VALID_SIZES)[number];

const MODE_LABELS: Record<GameMode, string> = {
  [GameMode.Classic]: "数字排序",
  [GameMode.Image]: "ASCII 图像",
  [GameMode.Color]: "颜色排序",
} as const;

// ===================== Custom Error Hierarchy =====================
class PuzzleError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PuzzleError";
    this.code = code;
  }
}
class InvalidMoveError extends PuzzleError {
  constructor(m: string) {
    super(m, "INVALID_MOVE");
    this.name = "InvalidMoveError";
  }
}
class UnsolvableBoardError extends PuzzleError {
  constructor(m: string) {
    super(m, "UNSOLVABLE");
    this.name = "UnsolvableBoardError";
  }
}
class SolverTimeoutError extends PuzzleError {
  constructor(m: string) {
    super(m, "SOLVER_TIMEOUT");
    this.name = "SolverTimeoutError";
  }
}

// ===================== Template Literal / Conditional / Mapped Types =====================
type EventName = `on${Capitalize<string>}`;
type SizeKey = `size${BoardSize}`;
// Mapped type with -readonly, plus a recursive conditional inside.
type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K];
};
type Unwrap<T> = T extends Array<infer U> ? U : T;
type EventOfType<E, T> = E extends { type: T } ? E : never;

// Discriminated union for game events (the `type` field is the discriminant).
type GameEvent =
  | { type: "move"; direction: Direction; moves: number }
  | { type: "shuffle"; steps: number }
  | { type: "solve"; path: readonly Direction[] }
  | { type: "win"; moves: number; seconds: number; isBest: boolean }
  | { type: "status"; message: string }
  | { type: "undo"; moves: number }
  | { type: "redo"; moves: number }
  | { type: "hint"; direction: Direction }
  | { type: "mode"; mode: GameMode };

type EventHandler<E extends GameEvent = GameEvent> = (event: E) => void;

// ===================== Symbols =====================
const SYM_TILES = Symbol("tiles");
const SYM_BLANK = Symbol("blank");

// ===================== Interfaces, Tuples, Index Signatures =====================
interface BestRecord {
  readonly size: number;
  moves: number;
  seconds: number;
}
interface Statistics {
  gamesPlayed: number;
  gamesSolved: number;
  bestMoves: Partial<Record<number, number>>;
  bestTime: Partial<Record<number, number>>;
  [key: string]: unknown; // index signature for extension
}
interface Coordinate {
  readonly row: number;
  readonly col: number;
}
interface Renderable {
  render(): string;
}

type MoveTuple = readonly [direction: Direction, prevBlank: number]; // readonly tuple
type ScoreOnly = Pick<BestRecord, "moves" | "seconds">;
type RecordWithoutSize = Omit<BestRecord, "size">;
type FrozenRecord = Readonly<BestRecord>;

// ===================== Type Guards =====================
function isDirection(v: unknown): v is Direction {
  return (
    v === Direction.Up ||
    v === Direction.Down ||
    v === Direction.Left ||
    v === Direction.Right
  );
}
function isBoardSize(n: unknown): n is BoardSize {
  return (
    typeof n === "number" && (VALID_SIZES as readonly number[]).includes(n)
  );
}
function isGameMode(v: unknown): v is GameMode {
  return (
    typeof v === "string" && (Object.values(GameMode) as string[]).includes(v)
  );
}

// ===================== Function Overloads =====================
function bestSummary(size: number): string;
function bestSummary(size: number, detailed: true): ScoreOnly | null;
function bestSummary(
  size: number,
  detailed?: boolean,
): string | ScoreOnly | null {
  const rec = loadBest().find((r) => r.size === size) ?? null;
  if (detailed) return rec ? { moves: rec.moves, seconds: rec.seconds } : null;
  return rec ? `最佳: ${rec.moves} 步 / ${rec.seconds}s` : "暂无最佳";
}

// ===================== Solvability (inversion count + blank parity) =====================
function countInversions(tiles: readonly number[]): number {
  let inv = 0;
  const f = tiles.filter((t) => t !== 0);
  for (let i = 0; i < f.length; i++)
    for (let j = i + 1; j < f.length; j++) if (f[i]! > f[j]!) inv++;
  return inv;
}
function isSolvable(tiles: readonly number[], size: number): boolean {
  const inv = countInversions(tiles);
  const blankRowFromBottom = size - Math.floor(tiles.indexOf(0) / size);
  return size % 2 === 1 ? inv % 2 === 0 : (inv + blankRowFromBottom) % 2 === 0;
}

// ===================== Heuristics =====================
function manhattan(tiles: readonly number[], size: number): number {
  let total = 0;
  for (let i = 0; i < tiles.length; i++) {
    const v = tiles[i];
    if (v === 0) continue;
    const tr = Math.floor((v - 1) / size),
      tc = (v - 1) % size;
    total += Math.abs(Math.floor(i / size) - tr) + Math.abs((i % size) - tc);
  }
  return total;
}
// Linear conflict (pattern-database-like optimization on top of Manhattan).
function linearConflict(tiles: readonly number[], size: number): number {
  let lc = 0;
  for (let r = 0; r < size; r++)
    for (let c1 = 0; c1 < size; c1++) {
      const v1 = tiles[r * size + c1];
      if (v1 === 0 || Math.floor((v1 - 1) / size) !== r) continue;
      for (let c2 = c1 + 1; c2 < size; c2++) {
        const v2 = tiles[r * size + c2];
        if (v2 !== 0 && Math.floor((v2 - 1) / size) === r && v1 > v2) lc += 2;
      }
    }
  for (let c = 0; c < size; c++)
    for (let r1 = 0; r1 < size; r1++) {
      const v1 = tiles[r1 * size + c];
      if (v1 === 0 || (v1 - 1) % size !== c) continue;
      for (let r2 = r1 + 1; r2 < size; r2++) {
        const v2 = tiles[r2 * size + c];
        if (v2 !== 0 && (v2 - 1) % size === c && v1 > v2) lc += 2;
      }
    }
  return lc;
}
const heuristic = (tiles: readonly number[], size: number): number =>
  manhattan(tiles, size) + linearConflict(tiles, size);
const tilesKey = (tiles: readonly number[]): string => tiles.join(",");

// ===================== Abstract Board (template method pattern) =====================
abstract class AbstractBoard {
  protected readonly _size: BoardSize;
  protected readonly _tiles: number[];
  protected _blank: number;
  protected readonly _history: MoveTuple[] = [];
  protected _redoStack: MoveTuple[] = [];
  protected readonly [SYM_TILES]: number[];
  protected readonly [SYM_BLANK]: { value: number };

  constructor(size: BoardSize, tiles?: readonly number[]) {
    this._size = size;
    this._tiles = tiles ? tiles.slice() : AbstractBoard.solvedTiles(size);
    this._blank = this._tiles.indexOf(0);
    this[SYM_TILES] = this._tiles;
    this[SYM_BLANK] = { value: this._blank };
  }

  static solvedTiles(size: BoardSize): number[] {
    const t: number[] = [];
    for (let i = 1; i < size * size; i++) t.push(i);
    t.push(0);
    return t;
  }

  // ---- Getters ----
  get size(): BoardSize {
    return this._size;
  }
  get blank(): number {
    return this._blank;
  }
  get tiles(): readonly number[] {
    return this._tiles;
  }
  get moves(): number {
    return this._history.length;
  }
  get canUndo(): boolean {
    return this._history.length > 0;
  }
  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  // ---- Iterator / Generator ----
  *[Symbol.iterator](): Iterator<number> {
    for (const t of this._tiles) yield t;
  }

  *neighborMoves(): Generator<
    { dir: Direction; index: number },
    void,
    unknown
  > {
    const br = Math.floor(this._blank / this._size),
      bc = this._blank % this._size;
    for (const d of DIRECTIONS) {
      const nr = br + d.dr,
        nc = bc + d.dc;
      if (nr < 0 || nr >= this._size || nc < 0 || nc >= this._size) continue;
      yield { dir: d.name, index: nr * this._size + nc };
    }
  }

  coordinateOf(index: number): Coordinate {
    return { row: Math.floor(index / this._size), col: index % this._size };
  }

  // Core swap without recording history (used by shuffle).
  protected applyRawMove(dir: Direction): boolean {
    const br = Math.floor(this._blank / this._size),
      bc = this._blank % this._size;
    let nr = br,
      nc = bc;
    if (dir === Direction.Up) nr--;
    else if (dir === Direction.Down) nr++;
    else if (dir === Direction.Left) nc--;
    else nc++;
    if (nr < 0 || nr >= this._size || nc < 0 || nc >= this._size) return false;
    const ni = nr * this._size + nc;
    [this._tiles[this._blank], this._tiles[ni]] = [
      this._tiles[ni],
      this._tiles[this._blank],
    ];
    this._blank = ni;
    this[SYM_BLANK].value = ni;
    return true;
  }

  move(dir: Direction): boolean {
    const prevBlank = this._blank;
    if (!this.applyRawMove(dir)) return false;
    this._history.push([dir, prevBlank]);
    this._redoStack = [];
    return true;
  }

  undo(): boolean {
    const last = this._history.pop();
    if (!last) return false;
    const [, prevBlank] = last;
    [this._tiles[prevBlank], this._tiles[this._blank]] = [
      this._tiles[this._blank],
      this._tiles[prevBlank],
    ];
    this._blank = prevBlank;
    this[SYM_BLANK].value = prevBlank;
    this._redoStack.push(last);
    return true;
  }

  redo(): boolean {
    const next = this._redoStack.pop();
    if (!next) return false;
    const [dir] = next,
      prevBlank = this._blank;
    if (!this.applyRawMove(dir)) return false;
    this._history.push([dir, prevBlank]);
    return true;
  }

  resetHistory(): void {
    this._history.length = 0;
    this._redoStack.length = 0;
  }

  isSolved(): boolean {
    const n = this._tiles.length;
    for (let i = 0; i < n - 1; i++) if (this._tiles[i] !== i + 1) return false;
    return this._tiles[n - 1] === 0;
  }

  snapshot(): number[] {
    return this._tiles.slice();
  }

  // Template method: build the grid, delegating per-cell rendering to subclasses.
  renderBoard(): string {
    const lines: string[] = [];
    const cellW = this._size >= 5 ? 4 : 3;
    const sep = "+" + ("-".repeat(cellW) + "+").repeat(this._size);
    for (let r = 0; r < this._size; r++) {
      lines.push(ANSI.GRAY + sep + ANSI.RESET);
      let row = ANSI.GRAY + "|" + ANSI.RESET;
      for (let c = 0; c < this._size; c++) {
        const idx = r * this._size + c;
        row +=
          this.renderCell(this._tiles[idx]!, idx, cellW) +
          ANSI.GRAY +
          "|" +
          ANSI.RESET;
      }
      lines.push(row);
    }
    lines.push(ANSI.GRAY + sep + ANSI.RESET);
    return lines.join("\n");
  }

  protected abstract renderCell(
    value: number,
    index: number,
    cellWidth: number,
  ): string;
  abstract describe(): string;
}

// Concrete subclasses.
class ClassicBoard extends AbstractBoard {
  protected renderCell(
    value: number,
    index: number,
    cellWidth: number,
  ): string {
    if (value === 0) return " ".repeat(cellWidth);
    const correct = value === index + 1;
    const text = value.toString().padStart(cellWidth - 1) + " ";
    return (correct ? ANSI.GREEN : ANSI.YELLOW) + text + ANSI.RESET;
  }
  describe(): string {
    return "按 1..N-1 顺序排列";
  }
}

class ImageBoard extends AbstractBoard {
  private static readonly GLYPHS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%" as const;
  protected renderCell(
    value: number,
    index: number,
    cellWidth: number,
  ): string {
    if (value === 0) return " ".repeat(cellWidth);
    const glyph = ImageBoard.GLYPHS[(value - 1) % ImageBoard.GLYPHS.length]!;
    const correct = value === index + 1;
    const text = (glyph + glyph).slice(0, cellWidth - 1) + " ";
    return (correct ? ANSI.CYAN : ANSI.MAGENTA) + text + ANSI.RESET;
  }
  describe(): string {
    return "按 ASCII 字符顺序拼合图像";
  }
}

class ColorBoard extends AbstractBoard {
  private static readonly COLORS = [
    ANSI.RED,
    ANSI.GREEN,
    ANSI.YELLOW,
    ANSI.BLUE,
    ANSI.MAGENTA,
    ANSI.CYAN,
  ] as const;
  protected renderCell(
    value: number,
    index: number,
    cellWidth: number,
  ): string {
    if (value === 0) return " ".repeat(cellWidth);
    const color = ColorBoard.COLORS[(value - 1) % ColorBoard.COLORS.length]!;
    const fill = value === index + 1 ? "█" : "▒";
    return color + fill.repeat(cellWidth - 1) + " " + ANSI.RESET;
  }
  describe(): string {
    return "按颜色顺序排列色块";
  }
}

function createBoard(
  size: BoardSize,
  mode: GameMode,
  tiles?: readonly number[],
): AbstractBoard {
  switch (mode) {
    case GameMode.Image:
      return new ImageBoard(size, tiles);
    case GameMode.Color:
      return new ColorBoard(size, tiles);
    default:
      return new ClassicBoard(size, tiles);
  }
}
type BoardFactoryParams = Parameters<typeof createBoard>;

// ===================== Shuffle (guaranteed solvable via random walk) =====================
function shuffleBoard(board: AbstractBoard, steps: number): void {
  let last: Direction | null = null;
  for (let i = 0; i < steps; i++) {
    const opts = [...board.neighborMoves()].filter(({ dir }) => {
      if (last === null) return true;
      return DIRECTIONS.find((d) => d.name === dir)!.opp !== last; // avoid immediate backtrack
    });
    if (opts.length === 0) continue;
    const pick = opts[Math.floor(Math.random() * opts.length)]!;
    board.move(pick.dir);
    last = pick.dir;
  }
  board.resetHistory();
  // A random walk from a solved state is always solvable; verify as a safety net.
  if (!isSolvable(board.tiles, board.size))
    throw new UnsolvableBoardError("洗牌产生不可解状态 (不应发生)");
}

// ===================== A* Solver =====================
interface SolverNode {
  readonly tiles: number[];
  readonly blank: number;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly path: readonly Direction[];
  readonly key: string;
}

function solverNeighbors(node: SolverNode, size: number): SolverNode[] {
  const out: SolverNode[] = [];
  const br = Math.floor(node.blank / size),
    bc = node.blank % size;
  for (const d of DIRECTIONS) {
    const nr = br + d.dr,
      nc = bc + d.dc;
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
    const ni = nr * size + nc;
    const nt = node.tiles.slice();
    [nt[node.blank], nt[ni]] = [nt[ni], nt[node.blank]];
    const g = node.g + 1,
      h = heuristic(nt, size);
    out.push({
      tiles: nt,
      blank: ni,
      g,
      h,
      f: g + h,
      path: node.path.concat(d.name),
      key: tilesKey(nt),
    });
  }
  return out;
}

function solveAStar(
  tiles: readonly number[],
  size: number,
  maxIter = 200000,
): readonly Direction[] | null {
  if (!isSolvable(tiles, size))
    throw new UnsolvableBoardError("当前棋盘不可解");
  const startH = heuristic(tiles, size);
  const start: SolverNode = {
    tiles: tiles.slice(),
    blank: tiles.indexOf(0),
    g: 0,
    h: startH,
    f: startH,
    path: [],
    key: tilesKey(tiles),
  };
  const target = tilesKey(AbstractBoard.solvedTiles(size as BoardSize));
  const open: SolverNode[] = [start];
  const closed = new Set<string>();
  let iter = 0;
  while (open.length > 0) {
    if (++iter > maxIter)
      throw new SolverTimeoutError(`求解超过 ${maxIter} 次迭代`);
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (cur.key === target) return cur.path;
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);
    for (const n of solverNeighbors(cur, size))
      if (!closed.has(n.key)) open.push(n);
  }
  return null;
}
type SolveOutcome = ReturnType<typeof solveAStar>;

// Async wrapper (demonstrates Awaited).
function asyncSolve(
  tiles: readonly number[],
  size: number,
): Promise<SolveOutcome> {
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        resolve(solveAStar(tiles, size));
      } catch {
        resolve(null);
      }
    }, 0);
  });
}
type AsyncSolveOutcome = Awaited<ReturnType<typeof asyncSolve>>;

// Greedy one-step hint (fast fallback for large boards).
function greedyHint(board: AbstractBoard): Direction | null {
  const size = board.size,
    tiles = board.snapshot(),
    blank = board.blank;
  let best: { dir: Direction; score: number } | null = null;
  for (const { dir, index } of board.neighborMoves()) {
    const sim = tiles.slice();
    [sim[blank], sim[index]] = [sim[index], sim[blank]];
    const score = heuristic(sim, size);
    if (best === null || score < best.score) best = { dir, score };
  }
  return best?.dir ?? null;
}

function computeHint(board: AbstractBoard): Direction | null {
  if (board.isSolved()) return null;
  if (board.size <= 3) {
    try {
      const path = solveAStar(board.tiles, board.size, 40000);
      if (path && path.length > 0) return path[0] ?? null;
    } catch {
      /* fall through to greedy */
    }
  }
  return greedyHint(board);
}

// ===================== Typed Event System =====================
class GameEventEmitter {
  private readonly handlers = new Map<GameEvent["type"], EventHandler[]>();
  on<E extends GameEvent["type"]>(
    type: E,
    handler: EventHandler<Extract<GameEvent, { type: E }>>,
  ): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as EventHandler<GameEvent>);
    this.handlers.set(type, list);
  }
  emit(event: GameEvent): void {
    for (const h of this.handlers.get(event.type) ?? [])
      (h as EventHandler<GameEvent>)(event);
  }
}

// ===================== Persistence =====================
const DATA_FILE = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? ".",
  ".slidingpuzzle_data.json",
);

const DEFAULT_STATS: Statistics = {
  gamesPlayed: 0,
  gamesSolved: 0,
  bestMoves: {},
  bestTime: {},
};

interface PersistedData {
  stats: Statistics;
  best: BestRecord[];
}

function loadData(): PersistedData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<PersistedData>;
      return {
        stats: { ...DEFAULT_STATS, ...(raw.stats ?? {}) },
        best: Array.isArray(raw.best) ? (raw.best as BestRecord[]) : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { stats: { ...DEFAULT_STATS }, best: [] };
}

function saveData(data: PersistedData): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}
function loadBest(): BestRecord[] {
  return loadData().best;
}

function recordResult(
  data: PersistedData,
  size: number,
  moves: number,
  seconds: number,
): boolean {
  const idx = data.best.findIndex((r) => r.size === size);
  let isBest = false;
  if (idx === -1) {
    data.best.push({ size, moves, seconds });
    isBest = true;
  } else {
    const cur = data.best[idx]!;
    if (moves < cur.moves || (moves === cur.moves && seconds < cur.seconds)) {
      data.best[idx] = { size, moves, seconds };
      isBest = true;
    }
  }
  data.stats.bestMoves[size] = Math.min(
    data.stats.bestMoves[size] ?? moves,
    moves,
  );
  data.stats.bestTime[size] = Math.min(
    data.stats.bestTime[size] ?? seconds,
    seconds,
  );
  saveData(data);
  return isBest;
}

// ===================== Game State Machine =====================
class Game implements Renderable {
  private board: AbstractBoard;
  private _status: GameStatus = GameStatus.Playing;
  private _mode: GameMode;
  private _size: BoardSize;
  private _startTime: number;
  private _endTime: number | null = null;
  private _pausedAccum = 0;
  private _pauseStart: number | null = null;
  private _message = "";
  private _solving = false;
  private readonly emitter = new GameEventEmitter();
  private readonly data: PersistedData;

  constructor(size: BoardSize, mode: GameMode) {
    this._size = size;
    this._mode = mode;
    this.board = createBoard(size, mode);
    this.data = loadData();
    this._startTime = Date.now();
    this.shuffle();
    this.emitter.on("win", (e) => {
      this.data.stats.gamesSolved++;
      saveData(this.data);
      if (e.isBest) this._message = "恭喜! 创造新纪录!";
    });
  }

  // ---- Getters / Setters ----
  get status(): GameStatus {
    return this._status;
  }
  get mode(): GameMode {
    return this._mode;
  }
  set mode(m: GameMode) {
    if (m === this._mode) return;
    this._mode = m;
    this.board = createBoard(this._size, m, this.board.tiles);
    this.emitter.emit({ type: "mode", mode: m });
  }
  get size(): BoardSize {
    return this._size;
  }
  get moves(): number {
    return this.board.moves;
  }
  get solving(): boolean {
    return this._solving;
  }
  get message(): string {
    return this._message;
  }
  set message(v: string) {
    this._message = v;
  }
  get elapsedSeconds(): number {
    const end = this._endTime ?? Date.now();
    const paused =
      this._pausedAccum +
      (this._pauseStart !== null ? Date.now() - this._pauseStart : 0);
    return Math.max(0, Math.floor((end - this._startTime - paused) / 1000));
  }

  // ---- State transitions ----
  private transition(next: GameStatus): void {
    const allowed: Record<GameStatus, readonly GameStatus[]> = {
      [GameStatus.Menu]: [GameStatus.Playing],
      [GameStatus.Playing]: [
        GameStatus.Paused,
        GameStatus.Won,
        GameStatus.Menu,
      ],
      [GameStatus.Paused]: [GameStatus.Playing, GameStatus.Menu],
      [GameStatus.Won]: [GameStatus.Playing, GameStatus.Menu],
    } as const;
    if (!(allowed[this._status] as readonly GameStatus[]).includes(next))
      return;
    this._status = next;
  }

  shuffle(): void {
    this.board = createBoard(this._size, this._mode);
    shuffleBoard(this.board, this._size * this._size * 20);
    this._startTime = Date.now();
    this._endTime = null;
    this._pausedAccum = 0;
    this._pauseStart = null;
    this._status = GameStatus.Playing;
    this._message = "新游戏已开始";
    this.emitter.emit({ type: "shuffle", steps: this._size * this._size * 20 });
  }

  move(dir: Direction): boolean {
    if (
      this._solving ||
      this._status === GameStatus.Won ||
      this._status === GameStatus.Paused
    ) {
      this._message = "当前不可移动";
      return false;
    }
    if (!this.board.move(dir)) {
      this._message = "无法向该方向移动";
      return false;
    }
    this._message = "";
    this.emitter.emit({
      type: "move",
      direction: dir,
      moves: this.board.moves,
    });
    if (this.board.isSolved()) this.handleWin();
    return true;
  }

  undo(): boolean {
    if (this._solving || !this.board.canUndo) return false;
    this.board.undo();
    this._message = `已撤销 (步数 ${this.board.moves})`;
    this.emitter.emit({ type: "undo", moves: this.board.moves });
    return true;
  }

  redo(): boolean {
    if (this._solving || !this.board.canRedo) return false;
    this.board.redo();
    this._message = `已重做 (步数 ${this.board.moves})`;
    this.emitter.emit({ type: "redo", moves: this.board.moves });
    return true;
  }

  togglePause(): void {
    if (this._status === GameStatus.Playing) {
      this._pauseStart = Date.now();
      this.transition(GameStatus.Paused);
      this._message = "已暂停";
    } else if (this._status === GameStatus.Paused) {
      if (this._pauseStart !== null) {
        this._pausedAccum += Date.now() - this._pauseStart;
        this._pauseStart = null;
      }
      this.transition(GameStatus.Playing);
      this._message = "继续游戏";
    }
  }

  changeSize(delta: number): void {
    const next = this._size + delta;
    if (!isBoardSize(next)) {
      this._message = "棋盘尺寸超出范围 (3..5)";
      return;
    }
    this._size = next;
    this.shuffle();
    this._message = `棋盘已切换为 ${next}x${next}`;
  }

  cycleMode(): void {
    const order: readonly GameMode[] = [
      GameMode.Classic,
      GameMode.Image,
      GameMode.Color,
    ];
    this.mode = order[(order.indexOf(this._mode) + 1) % order.length]!;
    this._message = `模式: ${MODE_LABELS[this._mode]}`;
  }

  hint(): Direction | null {
    if (this._status === GameStatus.Won) {
      this._message = "已完成, 无需提示";
      return null;
    }
    const h = computeHint(this.board);
    if (h !== null) this.emitter.emit({ type: "hint", direction: h });
    this._message = h !== null ? `提示: 向 ${h} 移动` : "无可用提示";
    return h;
  }

  requestSolve(rl: readline.Interface): void {
    if (this._status === GameStatus.Won) {
      this._message = "已经完成, 无需求解";
      return;
    }
    this._solving = true;
    this._message = "正在求解中...";
    this.render();
    const snapshot = this.board.snapshot();
    void asyncSolve(snapshot, this._size).then((sol: AsyncSolveOutcome) => {
      this._solving = false;
      if (!sol || sol.length === 0) {
        this._message = "求解失败 (步数超限)";
        this.render();
        rl.prompt();
        return;
      }
      this._message = `已找到 ${sol.length} 步解, 自动播放中...`;
      this.emitter.emit({ type: "solve", path: sol });
      this.playSolution(sol, rl);
    });
  }

  private playSolution(
    sol: readonly Direction[],
    rl: readline.Interface,
  ): void {
    this._solving = true;
    let i = 0;
    const step = (): void => {
      if (i >= sol.length || this._status === GameStatus.Won) {
        this._solving = false;
        this.render();
        rl.prompt();
        return;
      }
      this.board.move(sol[i]!);
      this.emitter.emit({
        type: "move",
        direction: sol[i]!,
        moves: this.board.moves,
      });
      i++;
      this.render();
      if (this.board.isSolved()) {
        this._solving = false;
        this.handleWin();
        this.render();
        rl.prompt();
        return;
      }
      setTimeout(step, 180);
    };
    step();
  }

  private handleWin(): void {
    this._endTime = Date.now();
    this.transition(GameStatus.Won);
    const seconds = this.elapsedSeconds;
    this.data.stats.gamesPlayed++;
    const isBest = recordResult(
      this.data,
      this._size,
      this.board.moves,
      seconds,
    );
    if (!this._message)
      this._message = isBest ? "恭喜! 创造新纪录!" : "恭喜完成!";
    this.emitter.emit({
      type: "win",
      moves: this.board.moves,
      seconds,
      isBest,
    });
  }

  // ---- Renderable ----
  render(): string {
    const lines: string[] = [];
    lines.push(
      ANSI.BOLD + ANSI.CYAN + "===== 数字华容道 (Enhanced) =====" + ANSI.RESET,
    );
    lines.push(
      `尺寸: ${this._size}x${this._size}   模式: ${MODE_LABELS[this._mode]}   ` +
        `状态: ${this._status}   步数: ${this.board.moves}   用时: ${this.elapsedSeconds}s   ` +
        bestSummary(this._size),
    );
    lines.push(`目标: ${this.board.describe()}`);
    if (this._status === GameStatus.Paused) {
      lines.push(ANSI.YELLOW + "[ 暂停中 — 按 p 继续 ]" + ANSI.RESET);
    } else {
      lines.push(this.board.renderBoard());
    }
    lines.push("");
    if (this._status === GameStatus.Won) {
      lines.push(
        ANSI.GREEN +
          ANSI.BOLD +
          `===== 完成! 步数: ${this.board.moves} 用时: ${this.elapsedSeconds}s =====` +
          ANSI.RESET,
      );
      lines.push(
        `统计: 已玩 ${this.data.stats.gamesPlayed} / 已解 ${this.data.stats.gamesSolved}`,
      );
      lines.push(
        ANSI.CYAN + "n 新游戏  m 切换模式  +/- 改尺寸  q 退出" + ANSI.RESET,
      );
    } else {
      lines.push(
        ANSI.CYAN +
          "u/d/l/r 移动  n 新游戏  s 求解  i 提示  z 撤销  y 重做  p 暂停  m 模式  +/- 尺寸  h 帮助  q 退出" +
          ANSI.RESET,
      );
    }
    if (this._message) lines.push(ANSI.YELLOW + this._message + ANSI.RESET);
    return ANSI.CLEAR + ANSI.HOME + lines.join("\n") + "\n";
  }
}

// ===================== Main =====================
function main(): void {
  const args = process.argv.slice(2);
  let size: BoardSize = 4;
  let mode: GameMode = GameMode.Classic;
  for (const a of args) {
    const s = parseInt(a, 10);
    if (!Number.isNaN(s) && isBoardSize(s)) size = s;
    else if (isGameMode(a)) mode = a as GameMode;
  }

  const game = new Game(size, mode);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "华容道> ",
  });
  const redraw = (): void => {
    process.stdout.write(game.render());
    rl.prompt();
  };
  redraw();

  rl.on("line", (line: string) => {
    const input = line.trim().toLowerCase();
    switch (input) {
      case "q":
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      case "h":
        console.log(
          "\n帮助:\n" +
            "  u/d/l/r  空白格上/下/左/右移动\n" +
            "  n        新游戏 (重新洗牌, 保证有解)\n" +
            "  s        A* 自动求解并播放\n" +
            "  i        提示下一步\n" +
            "  z / y    撤销 / 重做\n" +
            "  p        暂停 / 继续\n" +
            "  m        切换模式 (数字 / 图像 / 颜色)\n" +
            "  + / -    增大 / 减小棋盘 (3..5)\n" +
            "  q        退出",
        );
        break;
      case "n":
        game.shuffle();
        break;
      case "s":
        game.requestSolve(rl);
        return; // async; redraw happens in callback
      case "i": {
        const hint = game.hint();
        if (hint) console.log(`提示: 向 ${hint} 移动`);
        break;
      }
      case "z":
        game.undo();
        break;
      case "y":
        game.redo();
        break;
      case "p":
        game.togglePause();
        break;
      case "m":
        game.cycleMode();
        break;
      case "+":
        game.changeSize(1);
        break;
      case "-":
        game.changeSize(-1);
        break;
      case "u":
      case "d":
      case "l":
      case "r":
        game.move(input.toUpperCase() as Direction);
        break;
      default:
        game.message = "未知命令, 输入 h 查看帮助";
    }
    redraw();
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

// Keep utility/template types referenced (no runtime effect).
type _Unused = Record<string, unknown> &
  Record<SizeKey, number> &
  Record<EventName, unknown> &
  Unwrap<readonly Direction[]>;
void (null as unknown as _Unused);
void (null as unknown as DeepMutable<BestRecord>);
void (null as unknown as FrozenRecord);
void (null as unknown as RecordWithoutSize);
void (null as unknown as BoardFactoryParams);
void (null as unknown as EventOfType<GameEvent, "win">);
void new InvalidMoveError("x");
void new SolverTimeoutError("x");

main();
