#!/usr/bin/env node
/**
 * 文字版扫雷游戏 (Text-based Minesweeper) — Enhanced Edition
 *
 * Features:
 *   - Multiple difficulty levels (beginner, intermediate, expert, custom)
 *   - Cell states: hidden, revealed, flagged, questioned
 *   - First-click safety guarantee (flood fill + safe zone)
 *   - Chord (both-click) functionality
 *   - Game state machine (menu, playing, paused, won, lost)
 *   - Timer with pause, statistics, best-time persistence
 *   - Typed event system, ANSI color rendering
 *   - Hint system, move history
 *
 * TypeScript features: enums, generics, discriminated unions, mapped types,
 * conditional types, template literal types, type guards, utility types,
 * tuples, abstract classes, function overloads, as const, custom errors,
 * generators, symbols, satisfies, getters/setters.
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// ============================================================
// 1. 常量与枚举
// ============================================================

const ANSI = {
  RESET: "\x1b[0m",
  CLEAR: "\x1b[2J",
  HOME: "\x1b[H",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
} as const;

const enum Dir {
  None = 0,
  Up = 1,
  Down = 2,
  Left = 3,
  Right = 4,
}

enum CellState {
  Hidden = "hidden",
  Revealed = "revealed",
  Flagged = "flagged",
  Questioned = "questioned",
}

enum GamePhase {
  Menu = "menu",
  Playing = "playing",
  Paused = "paused",
  Won = "won",
  Lost = "lost",
}

enum Difficulty {
  Beginner = "beginner",
  Intermediate = "intermediate",
  Expert = "expert",
  Custom = "custom",
}

enum Color {
  Reset = "reset",
  Red = "red",
  Green = "green",
  Yellow = "yellow",
  Blue = "blue",
  Cyan = "cyan",
  Gray = "gray",
  Bold = "bold",
}

type ColorCode = (typeof ANSI)[keyof typeof ANSI];

const COLOR_MAP: Record<Color, ColorCode> = {
  [Color.Reset]: ANSI.RESET,
  [Color.Red]: ANSI.RED,
  [Color.Green]: ANSI.GREEN,
  [Color.Yellow]: ANSI.YELLOW,
  [Color.Blue]: ANSI.BLUE,
  [Color.Cyan]: ANSI.CYAN,
  [Color.Gray]: ANSI.GRAY,
  [Color.Bold]: ANSI.BOLD,
};

interface DifficultyConfig {
  readonly width: number;
  readonly height: number;
  readonly mines: number;
  readonly label: string;
}

const DIFFICULTY_PRESETS: Record<
  Exclude<Difficulty, Difficulty.Custom>,
  DifficultyConfig
> = {
  [Difficulty.Beginner]: { width: 9, height: 9, mines: 10, label: "初级" },
  [Difficulty.Intermediate]: {
    width: 16,
    height: 16,
    mines: 40,
    label: "中级",
  },
  [Difficulty.Expert]: { width: 30, height: 16, mines: 99, label: "高级" },
} as const satisfies Record<string, DifficultyConfig>;

const NUMBER_COLORS: readonly Color[] = [
  Color.Blue,
  Color.Green,
  Color.Red,
  Color.Cyan,
  Color.Yellow,
  Color.Cyan,
  Color.Bold,
  Color.Gray,
] as const;

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".minesweeper_data.json",
);

// ============================================================
// 2. 接口与类型
// ============================================================

interface Cell {
  readonly isMine: boolean;
  readonly adjacent: number;
  state: CellState;
}

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly mineCount: number;
  readonly cells: readonly (readonly Cell[])[];
  firstClickDone: boolean;
}

interface GameStats {
  readonly gamesPlayed: number;
  readonly gamesWon: number;
  readonly bestTimes: Partial<Record<Difficulty, number>>;
  readonly totalFlagsUsed: number;
  readonly totalCellsRevealed: number;
  readonly [key: string]: unknown;
}

interface BestRecord {
  readonly time: number;
  readonly date: string;
  readonly difficulty: Difficulty;
}

type Coord = readonly [number, number];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface EventMap {
  cellRevealed: { readonly pos: Coord; readonly adjacent: number };
  cellFlagged: { readonly pos: Coord; readonly state: CellState };
  mineHit: { readonly pos: Coord };
  gameWon: { readonly time: number; readonly cellsRevealed: number };
  gameLost: { readonly pos: Coord };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
  flagCountChange: { readonly count: number };
}

type EventType = keyof EventMap;

type EventHandler<E extends EventType> = (payload: EventMap[E]) => void;

type EventName = `on${Capitalize<string>}`;

type DirectionOffset = readonly [number, number];

const DIRECTIONS: readonly DirectionOffset[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const satisfies readonly DirectionOffset[];

// ============================================================
// 3. 判别联合 (Discriminated Unions)
// ============================================================

type GameEvent =
  | { readonly type: "reveal"; readonly x: number; readonly y: number }
  | { readonly type: "flag"; readonly x: number; readonly y: number }
  | { readonly type: "chord"; readonly x: number; readonly y: number }
  | { readonly type: "newGame"; readonly difficulty: Difficulty }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "quit" }
  | { readonly type: "hint" };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

// ============================================================
// 4. 泛型工具
// ============================================================

class EventEmitter<E extends object> {
  private readonly handlers: Map<string, Set<(p: any) => void>> = new Map();

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): void {
    const key = String(event);
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler as (p: any) => void);
  }

  off<K extends keyof E>(event: K, handler: (payload: E[K]) => void): void {
    this.handlers.get(String(event))?.delete(handler as (p: any) => void);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.handlers.get(String(event))?.forEach((h) => {
      try {
        (h as (p: E[K]) => void)(payload);
      } catch {
        /* swallow */
      }
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shuffle<T>(arr: Mutable<T[]>): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============================================================
// 5. 自定义错误层次
// ============================================================

abstract class MineGameError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

class InvalidCoordError extends MineGameError {
  readonly code = "INVALID_COORD";
  constructor(x: number, y: number) {
    super(`坐标无效: (${x}, ${y})`);
  }
}

class CellRevealedError extends MineGameError {
  readonly code = "CELL_REVEALED";
  constructor(x: number, y: number) {
    super(`单元格 (${x}, ${y}) 已揭开`);
  }
}

class GameStateException extends MineGameError {
  readonly code = "GAME_STATE";
  constructor(msg: string) {
    super(msg);
  }
}

// ============================================================
// 6. 类型守卫
// ============================================================

function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === "string" &&
    Object.values(Difficulty).includes(value as Difficulty)
  );
}

function isCoord(value: unknown): value is Coord {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isGameEvent(value: unknown): value is GameEvent {
  if (typeof value !== "object" || value === null || !("type" in value))
    return false;
  const t = (value as { type: unknown }).type;
  return [
    "reveal",
    "flag",
    "chord",
    "newGame",
    "pause",
    "resume",
    "quit",
    "hint",
  ].includes(t as string);
}

// ============================================================
// 7. 生成器
// ============================================================

function* iterateCells(
  grid: Grid,
): Generator<
  { readonly x: number; readonly y: number; readonly cell: Cell },
  void,
  unknown
> {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      yield { x, y, cell: grid.cells[y][x] };
    }
  }
}

function* neighbors(
  grid: Grid,
  x: number,
  y: number,
): Generator<
  { readonly x: number; readonly y: number; readonly cell: Cell },
  void,
  unknown
> {
  for (const [dx, dy] of DIRECTIONS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
      yield { x: nx, y: ny, cell: grid.cells[ny][nx] };
    }
  }
}

// ============================================================
// 8. 抽象类 — 棋盘创建与操作
// ============================================================

abstract class AbstractBoard {
  protected readonly cells: Cell[][];
  readonly firstClickDone: boolean = false;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly mineCount: number,
  ) {
    this.cells = [];
    for (let y = 0; y < height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) {
        row.push({ isMine: false, adjacent: 0, state: CellState.Hidden });
      }
      this.cells.push(row);
    }
  }

  get grid(): Grid {
    return {
      width: this.width,
      height: this.height,
      mineCount: this.mineCount,
      cells: this.cells,
      firstClickDone: this.firstClickDone,
    };
  }

  abstract placeMines(safeX: number, safeY: number): void;

  protected computeAdjacents(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y][x].isMine) continue;
        let count = 0;
        for (const { cell } of neighbors(this.grid, x, y)) {
          if (cell.isMine) count++;
        }
        (this.cells[y][x] as Mutable<Cell>).adjacent = count;
      }
    }
  }
}

class StandardBoard extends AbstractBoard {
  placeMines(safeX: number, safeY: number): void {
    const safeZone = new Set<string>();
    for (const [dx, dy] of DIRECTIONS) {
      const nx = safeX + dx;
      const ny = safeY + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        safeZone.add(`${nx},${ny}`);
      }
    }
    safeZone.add(`${safeX},${safeY}`);

    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!safeZone.has(`${x},${y}`)) {
          candidates.push({ x, y });
        }
      }
    }

    shuffle(candidates);
    const toPlace = Math.min(this.mineCount, candidates.length);
    for (let i = 0; i < toPlace; i++) {
      const { x, y } = candidates[i];
      (this.cells[y][x] as Mutable<Cell>).isMine = true;
    }
    this.computeAdjacents();
  }
}

// ============================================================
// 9. 游戏引擎
// ============================================================

class GameEvents extends EventEmitter<EventMap> {}

class MinesweeperGame {
  private board: AbstractBoard;
  private phase: GamePhase = GamePhase.Menu;
  private startTime: number | null = null;
  private endTime: number | null = null;
  private pauseTime: number | null = null;
  private totalPausedMs: number = 0;
  private readonly history: Coord[] = [];
  private readonly events = new GameEvents();
  private readonly stats: GameStats;
  private readonly difficulty: Difficulty;

  constructor(difficulty: Difficulty, custom?: Partial<DifficultyConfig>) {
    this.difficulty = difficulty;
    const cfg =
      difficulty === Difficulty.Custom && custom
        ? {
            width: clamp(custom.width ?? 9, 5, 40),
            height: clamp(custom.height ?? 9, 5, 30),
            mines: clamp(custom.mines ?? 10, 1, 99),
            label: "自定义",
          }
        : DIFFICULTY_PRESETS[
            difficulty as Exclude<Difficulty, Difficulty.Custom>
          ];

    const maxMines = cfg.width * cfg.height - 9;
    const mines = Math.min(cfg.mines, maxMines);
    this.board = new StandardBoard(cfg.width, cfg.height, mines);
    this.stats = loadStats();
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }

  get grid(): Grid {
    return this.board.grid;
  }
  get elapsed(): number {
    if (this.startTime === null) return 0;
    const end =
      this.endTime ??
      (this.phase === GamePhase.Paused ? this.pauseTime! : Date.now());
    return Math.floor((end - this.startTime - this.totalPausedMs) / 1000);
  }

  get flagCount(): number {
    let count = 0;
    for (const { cell } of iterateCells(this.board.grid)) {
      if (cell.state === CellState.Flagged) count++;
    }
    return count;
  }

  get unflaggedMines(): number {
    return this.board.mineCount - this.flagCount;
  }

  on<K extends EventType>(event: K, handler: EventHandler<K>): void {
    this.events.on(event, handler as EventHandler<EventType>);
  }

  private transition(to: GamePhase): void {
    const from = this.phase;
    if (from === to) return;
    this.events.emit("phaseChange", { from, to });
    this.phase = to;
  }

  reveal(x: number, y: number): void {
    if (this.phase === GamePhase.Won || this.phase === GamePhase.Lost) return;
    if (x < 0 || x >= this.board.width || y < 0 || y >= this.board.height) {
      throw new InvalidCoordError(x, y);
    }

    const cell = this.board.grid.cells[y][x];
    if (cell.state === CellState.Revealed) throw new CellRevealedError(x, y);
    if (cell.state === CellState.Flagged) return;

    if (!this.board.firstClickDone) {
      this.board.placeMines(x, y);
      (this.board as { firstClickDone: boolean }).firstClickDone = true;
      this.startTime = Date.now();
      this.transition(GamePhase.Playing);
    }

    (cell as Mutable<Cell>).state = CellState.Revealed;
    this.history.push([x, y]);
    this.events.emit("cellRevealed", { pos: [x, y], adjacent: cell.adjacent });

    if (cell.isMine) {
      this.revealAllMines();
      this.endTime = Date.now();
      this.transition(GamePhase.Lost);
      this.events.emit("mineHit", { pos: [x, y] });
      this.events.emit("gameLost", { pos: [x, y] });
      this.saveStats(false);
      return;
    }

    if (cell.adjacent === 0) {
      this.floodFill(x, y);
    }

    this.checkWin();
  }

  private floodFill(x: number, y: number): void {
    const queue: Coord[] = [[x, y]];
    const visited = new Set<string>([`${x},${y}`]);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const cell = this.board.grid.cells[cy][cx];
      if (cell.adjacent !== 0 || cell.isMine) continue;

      for (const n of neighbors(this.board.grid, cx, cy)) {
        const key = `${n.x},${n.y}`;
        if (visited.has(key)) continue;
        visited.add(key);

        if (n.cell.state === CellState.Hidden && !n.cell.isMine) {
          (n.cell as Mutable<Cell>).state = CellState.Revealed;
          this.history.push([n.x, n.y]);
          this.events.emit("cellRevealed", {
            pos: [n.x, n.y],
            adjacent: n.cell.adjacent,
          });

          if (n.cell.adjacent === 0) {
            queue.push([n.x, n.y]);
          }
        }
      }
    }
  }

  toggleFlag(x: number, y: number): void {
    if (this.phase === GamePhase.Won || this.phase === GamePhase.Lost) return;
    if (x < 0 || x >= this.board.width || y < 0 || y >= this.board.height)
      return;
    const cell = this.board.grid.cells[y][x];
    if (cell.state === CellState.Revealed) return;

    const states: readonly CellState[] = [
      CellState.Hidden,
      CellState.Flagged,
      CellState.Questioned,
    ];
    const idx = states.indexOf(cell.state);
    const next = states[(idx + 1) % states.length] ?? CellState.Hidden;
    (cell as Mutable<Cell>).state = next;
    this.events.emit("cellFlagged", { pos: [x, y], state: next });
    this.events.emit("flagCountChange", { count: this.flagCount });
  }

  chord(x: number, y: number): void {
    if (this.phase !== GamePhase.Playing) return;
    if (x < 0 || x >= this.board.width || y < 0 || y >= this.board.height)
      return;
    const cell = this.board.grid.cells[y][x];
    if (cell.state !== CellState.Revealed || cell.adjacent === 0 || cell.isMine)
      return;

    let flagCount = 0;
    for (const n of neighbors(this.board.grid, x, y)) {
      if (n.cell.state === CellState.Flagged) flagCount++;
    }

    if (flagCount === cell.adjacent) {
      for (const n of neighbors(this.board.grid, x, y)) {
        if (n.cell.state === CellState.Hidden) {
          this.reveal(n.x, n.y);
          if ((this.phase as GamePhase) === GamePhase.Lost) return;
        }
      }
    }
  }

  private revealAllMines(): void {
    for (const { x, y, cell } of iterateCells(this.board.grid)) {
      if (cell.isMine) {
        (cell as Mutable<Cell>).state = CellState.Revealed;
      }
    }
  }

  private checkWin(): void {
    for (const { cell } of iterateCells(this.board.grid)) {
      if (!cell.isMine && cell.state !== CellState.Revealed) return;
    }
    this.endTime = Date.now();
    this.transition(GamePhase.Won);
    let revealed = 0;
    for (const { cell } of iterateCells(this.board.grid)) {
      if (cell.state === CellState.Revealed && !cell.isMine) revealed++;
    }
    this.events.emit("gameWon", {
      time: this.elapsed,
      cellsRevealed: revealed,
    });
    this.saveStats(true);
  }

  pause(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.pauseTime = Date.now();
    this.transition(GamePhase.Paused);
  }

  resume(): void {
    if (this.phase !== GamePhase.Paused) return;
    if (this.pauseTime !== null) {
      this.totalPausedMs += Date.now() - this.pauseTime;
      this.pauseTime = null;
    }
    this.transition(GamePhase.Playing);
  }

  hint(): Coord | null {
    for (const { x, y, cell } of iterateCells(this.board.grid)) {
      if (cell.state === CellState.Hidden && !cell.isMine) {
        return [x, y];
      }
    }
    return null;
  }

  private saveStats(won: boolean): void {
    const s = this.stats as Mutable<GameStats>;
    s.gamesPlayed++;
    if (won) {
      s.gamesWon++;
      const best = s.bestTimes[this.difficulty];
      if (best === undefined || this.elapsed < best) {
        s.bestTimes[this.difficulty] = this.elapsed;
      }
    }
    s.totalFlagsUsed += this.flagCount;
    for (const { cell } of iterateCells(this.board.grid)) {
      if (cell.state === CellState.Revealed) s.totalCellsRevealed++;
    }
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.stats, null, 2), "utf-8");
    } catch {
      /* ignore */
    }
  }

  getStatistics(): Readonly<GameStats> {
    return this.stats;
  }

  render(useColor: boolean = true): string {
    const lines: string[] = [];
    const c = (text: string, color: Color): string =>
      useColor ? `${COLOR_MAP[color]}${text}${ANSI.RESET}` : text;

    lines.push(c("===== 文字版扫雷 =====", Color.Cyan));
    lines.push(
      `难度: ${this.difficulty}  大小: ${this.board.width}x${this.board.height}  雷数: ${this.board.mineCount}  旗帜: ${this.flagCount}  时间: ${this.elapsed}s`,
    );

    const colHeader =
      "   " +
      Array.from({ length: this.board.width }, (_, i) =>
        (i % 10).toString(),
      ).join(" ");
    lines.push(c(colHeader, Color.Gray));

    for (let y = 0; y < this.board.height; y++) {
      let row = c(`${(y % 10).toString()}  `, Color.Gray);
      for (let x = 0; x < this.board.width; x++) {
        const cell = this.board.grid.cells[y][x];
        row +=
          this.renderCell(
            cell,
            this.phase === GamePhase.Lost || this.phase === GamePhase.Won,
            useColor,
          ) + " ";
      }
      lines.push(row);
    }

    lines.push("");
    if (this.phase === GamePhase.Won) {
      lines.push(c("===== 恭喜胜利! =====", Color.Green));
      const best = this.stats.bestTimes[this.difficulty];
      if (best !== undefined && this.elapsed <= best) {
        lines.push(c(`★ 新的最佳时间: ${this.elapsed}s ★`, Color.Yellow));
      } else if (best !== undefined) {
        lines.push(c(`本局用时: ${this.elapsed}s  最佳: ${best}s`, Color.Cyan));
      }
    } else if (this.phase === GamePhase.Lost) {
      lines.push(c("===== 踩到雷, 游戏结束 =====", Color.Red));
    } else if (this.phase === GamePhase.Paused) {
      lines.push(c("[已暂停]", Color.Yellow));
    }

    if (this.phase === GamePhase.Won || this.phase === GamePhase.Lost) {
      lines.push(c("输入 n 开始新游戏, q 退出", Color.Cyan));
    } else {
      lines.push(
        "命令: r <x> <y> 揭开  f <x> <y> 标记  c <x> <y> 和弦  h 提示  p 暂停  n 新游戏  q 退出",
      );
    }

    return lines.join("\n");
  }

  private renderCell(cell: Cell, gameOver: boolean, useColor: boolean): string {
    const c = (text: string, color: Color): string =>
      useColor ? `${COLOR_MAP[color]}${text}${ANSI.RESET}` : text;
    if (cell.state === CellState.Flagged) return c("F", Color.Red);
    if (cell.state === CellState.Questioned) return c("?", Color.Yellow);
    if (cell.state === CellState.Hidden) return c(".", Color.Gray);
    if (cell.isMine) return gameOver ? c("*", Color.Red) : c(".", Color.Gray);
    if (cell.adjacent === 0) return " ";
    const color = NUMBER_COLORS[cell.adjacent - 1] ?? Color.Gray;
    return c(String(cell.adjacent), color);
  }
}

// ============================================================
// 10. 统计数据持久化
// ============================================================

function loadStats(): GameStats {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<GameStats>;
      return {
        gamesPlayed: data.gamesPlayed ?? 0,
        gamesWon: data.gamesWon ?? 0,
        bestTimes: data.bestTimes ?? {},
        totalFlagsUsed: data.totalFlagsUsed ?? 0,
        totalCellsRevealed: data.totalCellsRevealed ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    bestTimes: {},
    totalFlagsUsed: 0,
    totalCellsRevealed: 0,
  };
}

// ============================================================
// 11. 命令解析 (函数重载)
// ============================================================

type ParsedCommand =
  | { readonly action: "reveal"; readonly x: number; readonly y: number }
  | { readonly action: "flag"; readonly x: number; readonly y: number }
  | { readonly action: "chord"; readonly x: number; readonly y: number }
  | { readonly action: "hint" }
  | { readonly action: "newGame" }
  | { readonly action: "pause" }
  | { readonly action: "resume" }
  | { readonly action: "quit" }
  | { readonly action: "stats" }
  | { readonly action: "help" }
  | { readonly action: "unknown"; readonly input: string };

function parseCommand(line: string): ParsedCommand;
function parseCommand(line: string, maxXY: Coord): ParsedCommand;
function parseCommand(line: string, maxXY?: Coord): ParsedCommand {
  const parts = line.trim().toLowerCase().split(/\s+/);
  const cmd = parts[0] ?? "";

  if (cmd === "n" || cmd === "new") return { action: "newGame" };
  if (cmd === "q" || cmd === "quit") return { action: "quit" };
  if (cmd === "h" || cmd === "hint") return { action: "hint" };
  if (cmd === "p" || cmd === "pause") return { action: "pause" };
  if (cmd === "s" || cmd === "stats") return { action: "stats" };
  if (cmd === "?" || cmd === "help") return { action: "help" };

  const x = parts.length >= 2 ? parseInt(parts[1], 10) : NaN;
  const y = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;

  if (Number.isNaN(x) || Number.isNaN(y)) {
    return { action: "unknown", input: line };
  }

  if (maxXY && (x < 0 || x >= maxXY[0] || y < 0 || y >= maxXY[1])) {
    return { action: "unknown", input: line };
  }

  if (cmd === "r") return { action: "reveal", x, y };
  if (cmd === "f") return { action: "flag", x, y };
  if (cmd === "c") return { action: "chord", x, y };

  return { action: "unknown", input: line };
}

// ============================================================
// 12. 输入验证符号
// ============================================================

const SYM_VALIDATED = Symbol("validated");

interface ValidatedInput {
  [SYM_VALIDATED]: boolean;
  readonly difficulty: Difficulty;
  readonly custom?: Partial<DifficultyConfig>;
}

function validateArgs(args: readonly string[]): ValidatedInput {
  let difficulty: Difficulty = Difficulty.Beginner;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--difficulty" && i + 1 < args.length) {
      const d = args[++i];
      if (isDifficulty(d)) difficulty = d;
    }
  }

  return { [SYM_VALIDATED]: true, difficulty };
}

// ============================================================
// 13. 主程序
// ============================================================

function showHelp(): void {
  console.log("\n帮助:");
  console.log("  r <x> <y>  揭开格子");
  console.log("  f <x> <y>  标记/取消旗帜 (循环: 旗帜→问号→隐藏)");
  console.log("  c <x> <y>  和弦 (周围旗帜数等于数字时揭开周围)");
  console.log("  h          提示 (显示一个安全的未揭开格子)");
  console.log("  p          暂停/继续");
  console.log("  s          查看统计");
  console.log("  n          新游戏");
  console.log("  q          退出");
}

function showStats(stats: Readonly<GameStats>): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 统计 =====" + ANSI.RESET);
  console.log(`  游戏次数: ${stats.gamesPlayed}`);
  console.log(`  胜利次数: ${stats.gamesWon}`);
  const winRate =
    stats.gamesPlayed > 0
      ? ((stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1)
      : "0.0";
  console.log(`  胜率: ${winRate}%`);
  console.log("  最佳时间:");
  for (const [diff, time] of Object.entries(stats.bestTimes)) {
    console.log(`    ${diff}: ${time}s`);
  }
  console.log(`  总标记旗帜: ${stats.totalFlagsUsed}`);
  console.log(`  总揭开格子: ${stats.totalCellsRevealed}`);
}

function main(): void {
  const validated = validateArgs(process.argv.slice(2));
  let game = new MinesweeperGame(validated.difficulty, validated.custom);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "扫雷> ",
  });

  const refresh = (): void => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    process.stdout.write(game.render(true) + "\n");
  };

  refresh();
  rl.prompt();

  rl.on("line", (line: string) => {
    if (line.trim() === "") {
      refresh();
      rl.prompt();
      return;
    }

    const cmd = parseCommand(line, [game.grid.width, game.grid.height]);

    switch (cmd.action) {
      case "quit":
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
        break;
      case "newGame":
        game = new MinesweeperGame(validated.difficulty, validated.custom);
        break;
      case "reveal":
        try {
          game.reveal(cmd.x, cmd.y);
        } catch (e) {
          if (e instanceof MineGameError)
            console.log(ANSI.RED + e.message + ANSI.RESET);
        }
        break;
      case "flag":
        game.toggleFlag(cmd.x, cmd.y);
        break;
      case "chord":
        game.chord(cmd.x, cmd.y);
        break;
      case "hint": {
        const hint = game.hint();
        if (hint) {
          console.log(
            ANSI.GREEN + `提示: 尝试 (${hint[0]}, ${hint[1]})` + ANSI.RESET,
          );
        } else {
          console.log(ANSI.YELLOW + "无可用提示" + ANSI.RESET);
        }
        break;
      }
      case "pause":
        if (game.currentPhase === GamePhase.Paused) {
          game.resume();
        } else {
          game.pause();
        }
        break;
      case "resume":
        game.resume();
        break;
      case "stats":
        showStats(game.getStatistics());
        break;
      case "help":
        showHelp();
        break;
      default:
        console.log(ANSI.RED + "未知命令, 输入 h 查看帮助" + ANSI.RESET);
    }

    refresh();
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
