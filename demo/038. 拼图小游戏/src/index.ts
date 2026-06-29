#!/usr/bin/env node
/**
 * 拼图小游戏 (Sliding Puzzle) — Enhanced Edition
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
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
} as const;

enum Dir {
  Up = "U",
  Down = "D",
  Left = "L",
  Right = "R",
}
enum GameMode {
  Number = "number",
  Picture = "picture",
  Color = "color",
}
enum GamePhase {
  Menu = "menu",
  Playing = "playing",
  Won = "won",
}
enum Color {
  Red = "red",
  Green = "green",
  Yellow = "yellow",
  Cyan = "cyan",
  Gray = "gray",
}

type ColorCode = (typeof ANSI)[keyof typeof ANSI];

const COLOR_MAP: Record<Color, ColorCode> = {
  [Color.Red]: ANSI.RED,
  [Color.Green]: ANSI.GREEN,
  [Color.Yellow]: ANSI.YELLOW,
  [Color.Cyan]: ANSI.CYAN,
  [Color.Gray]: ANSI.GRAY,
} as const satisfies Record<Color, ColorCode>;

interface BoardConfig {
  readonly size: number;
  readonly label: string;
}

const BOARD_SIZES: Record<number, BoardConfig> = {
  3: { size: 3, label: "3x3" },
  4: { size: 4, label: "4x4" },
  5: { size: 5, label: "5x5" },
} as const satisfies Record<number, BoardConfig>;

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".puzzle_data.json",
);

// ============================================================
// 2. 接口与类型
// ============================================================

type Tiles = readonly (readonly string[])[];
type Coord = readonly [number, number];

interface PuzzleState {
  readonly size: number;
  readonly mode: GameMode;
  readonly tiles: Tiles;
  order: number[];
  blank: number;
  moves: number;
  startTime: number;
  endTime: number | null;
  won: boolean;
  statusMsg: string;
}

interface GameStats {
  readonly gamesPlayed: number;
  readonly gamesWon: number;
  readonly bestMoves: Partial<Record<number, number>>;
  readonly bestTimes: Partial<Record<number, number>>;
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface EventMap {
  move: { readonly dir: Dir; readonly moves: number };
  win: { readonly moves: number; readonly time: number };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
}

type EventType = keyof EventMap;

type GameEvent =
  | { readonly type: "move"; readonly dir: Dir }
  | { readonly type: "undo" }
  | { readonly type: "newGame" }
  | { readonly type: "quit" };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

type ParsedCommand =
  | { readonly action: "move"; readonly dir: Dir }
  | { readonly action: "newGame" }
  | { readonly action: "mode"; readonly mode: GameMode }
  | { readonly action: "size"; readonly size: number }
  | { readonly action: "undo" }
  | { readonly action: "help" }
  | { readonly action: "quit" }
  | { readonly action: "unknown"; readonly input: string };

// ============================================================
// 3. 自定义错误
// ============================================================

abstract class PuzzleError extends Error {
  abstract readonly code: string;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InvalidMoveError extends PuzzleError {
  readonly code = "INVALID_MOVE";
  constructor(dir: Dir) {
    super(`无法向 ${dir} 方向移动`);
  }
}

class InvalidSizeError extends PuzzleError {
  readonly code = "INVALID_SIZE";
  constructor(size: number) {
    super(`无效尺寸: ${size}, 可选: 3, 4, 5`);
  }
}

// ============================================================
// 4. 类型守卫
// ============================================================

function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" &&
    Object.values(GameMode).includes(value as GameMode)
  );
}

function isDir(value: unknown): value is Dir {
  return typeof value === "string" && Object.values(Dir).includes(value as Dir);
}

// ============================================================
// 5. 泛型事件系统与栈
// ============================================================

class EventEmitter<E extends object> {
  private readonly handlers: Map<string, Set<(p: any) => void>> = new Map();

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): void {
    const key = String(event);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler as (p: any) => void);
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

class Stack<T> {
  private readonly items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  get isEmpty(): boolean {
    return this.items.length === 0;
  }
  clear(): void {
    this.items.length = 0;
  }
  *[Symbol.iterator](): Iterator<T> {
    for (let i = this.items.length - 1; i >= 0; i--) yield this.items[i]!;
  }
}

// ============================================================
// 6. 生成器
// ============================================================

function* iteratePositions(size: number): Generator<Coord> {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      yield [x, y];
    }
  }
}

// ============================================================
// 7. 可解性检查
// ============================================================

function countInversions(order: number[], size: number): number {
  const filtered = order.filter((v) => v !== size * size - 1);
  let inversions = 0;
  for (let i = 0; i < filtered.length; i++) {
    for (let j = i + 1; j < filtered.length; j++) {
      if (filtered[i]! > filtered[j]!) inversions++;
    }
  }
  return inversions;
}

function isSolvable(order: number[], size: number): boolean {
  const inversions = countInversions(order, size);
  const blankIdx = order.indexOf(size * size - 1);
  const blankRowFromBottom = size - Math.floor(blankIdx / size);
  if (size % 2 === 1) return inversions % 2 === 0;
  return (inversions + blankRowFromBottom) % 2 === 0;
}

// ============================================================
// 8. 抽象棋盘渲染
// ============================================================

abstract class BoardRenderer {
  abstract get tilesHeight(): number;
  abstract get cellWidth(): number;
  abstract renderTile(
    tileIdx: number,
    pos: number,
    size: number,
    isBlank: boolean,
    isCorrect: boolean,
    useColor: boolean,
  ): string;

  render(state: PuzzleState, useColor: boolean): string {
    const lines: string[] = [];
    const c = (t: string, col: Color): string =>
      useColor ? `${COLOR_MAP[col]}${t}${ANSI.RESET}` : t;
    const sep = "+" + ("-".repeat(this.cellWidth + 2) + "+").repeat(state.size);

    for (let r = 0; r < state.size; r++) {
      lines.push(c(sep, Color.Gray));
      for (let h = 0; h < this.tilesHeight; h++) {
        let rowStr = c("|", Color.Gray);
        for (let cc = 0; cc < state.size; cc++) {
          const pos = r * state.size + cc;
          const tileIdx = state.order[pos]!;
          const isBlank = tileIdx === state.size * state.size - 1;
          const isCorrect = tileIdx === pos && !isBlank;
          rowStr += this.renderTile(
            tileIdx,
            pos,
            state.size,
            isBlank,
            isCorrect,
            useColor,
          );
          rowStr += c("|", Color.Gray);
        }
        lines.push(rowStr);
      }
    }
    lines.push(c(sep, Color.Gray));
    return lines.join("\n");
  }
}

class NumberRenderer extends BoardRenderer {
  get tilesHeight(): number {
    return 1;
  }
  get cellWidth(): number {
    return 3;
  }
  renderTile(
    tileIdx: number,
    _pos: number,
    _size: number,
    isBlank: boolean,
    isCorrect: boolean,
    useColor: boolean,
  ): string {
    const c = (t: string, col: Color): string =>
      useColor ? `${COLOR_MAP[col]}${t}${ANSI.RESET}` : t;
    if (isBlank) return "   ";
    const v = (tileIdx + 1).toString().padStart(2, " ");
    const col = isCorrect ? Color.Green : Color.Yellow;
    return ` ${c(v, col)} `;
  }
}

class PictureRenderer extends BoardRenderer {
  private readonly tileLines: number;
  private readonly tileCols: number;
  private readonly tiles: Tiles;

  constructor(tiles: Tiles) {
    super();
    this.tiles = tiles;
    this.tileLines = tiles[0]?.length ?? 1;
    this.tileCols = tiles[0]?.[0]?.length ?? 3;
  }

  get tilesHeight(): number {
    return this.tileLines;
  }
  get cellWidth(): number {
    return this.tileCols;
  }

  renderTile(
    tileIdx: number,
    _pos: number,
    _size: number,
    isBlank: boolean,
    isCorrect: boolean,
    useColor: boolean,
  ): string {
    const c = (t: string, col: Color): string =>
      useColor ? `${COLOR_MAP[col]}${t}${ANSI.RESET}` : t;
    const tile = this.tiles[tileIdx] ?? [];
    const parts: string[] = [];
    for (let h = 0; h < this.tileLines; h++) {
      const line = tile[h] ?? " ".repeat(this.tileCols);
      if (isBlank) parts.push(" ".repeat(this.tileCols));
      else if (isCorrect) parts.push(c(line, Color.Green));
      else parts.push(c(line, Color.Yellow));
    }
    return parts.join("");
  }
}

class ColorRenderer extends BoardRenderer {
  get tilesHeight(): number {
    return 1;
  }
  get cellWidth(): number {
    return 3;
  }
  renderTile(
    tileIdx: number,
    _pos: number,
    _size: number,
    isBlank: boolean,
    isCorrect: boolean,
    useColor: boolean,
  ): string {
    const c = (t: string, col: Color): string =>
      useColor ? `${COLOR_MAP[col]}${t}${ANSI.RESET}` : t;
    if (isBlank) return "   ";
    const colors: readonly Color[] = [
      Color.Red,
      Color.Green,
      Color.Yellow,
      Color.Cyan,
      Color.Gray,
    ];
    const col = colors[tileIdx % 5] ?? Color.Gray;
    return ` ${c((tileIdx + 1).toString().padStart(2, " "), isCorrect ? Color.Green : col)} `;
  }
}

// ============================================================
// 9. 游戏引擎
// ============================================================

class PuzzleEvents extends EventEmitter<EventMap> {}

class PuzzleGame {
  private state: PuzzleState;
  private phase: GamePhase = GamePhase.Menu;
  private readonly history: Stack<Dir> = new Stack();
  private readonly events = new PuzzleEvents();
  private readonly stats: GameStats;

  constructor(
    readonly size: number,
    readonly mode: GameMode,
  ) {
    this.state = this.createSolved(size, mode);
    this.stats = loadStats();
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }
  get moveCount(): number {
    return this.state.moves;
  }
  get elapsed(): number {
    const end = this.state.endTime ?? Date.now();
    return Math.floor((end - this.state.startTime) / 1000);
  }
  get message(): string {
    return this.state.statusMsg;
  }
  get canUndo(): boolean {
    return !this.history.isEmpty;
  }
  get boardState(): PuzzleState {
    return this.state;
  }

  private transition(to: GamePhase): void {
    const from = this.phase;
    if (from === to) return;
    this.events.emit("phaseChange", { from, to });
    this.phase = to;
  }

  on<K extends EventType>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): void {
    this.events.on(event, handler);
  }

  start(): void {
    this.shuffle();
    this.transition(GamePhase.Playing);
  }

  private createSolved(size: number, mode: GameMode): PuzzleState {
    const n = size * size;
    const tiles = this.makeTiles(size, mode);
    const order = Array.from({ length: n }, (_, i) => i);
    return {
      size,
      mode,
      tiles,
      order,
      blank: n - 1,
      moves: 0,
      startTime: Date.now(),
      endTime: null,
      won: false,
      statusMsg: "",
    };
  }

  private makeTiles(size: number, mode: GameMode): Tiles {
    const n = size * size;
    if (mode === GameMode.Number || mode === GameMode.Color) {
      return Array.from({ length: n }, (_, i) => {
        if (i === n - 1) return ["   "];
        return [(i + 1).toString().padStart(2, " ").padEnd(3, " ")];
      });
    }
    // Picture mode
    return Array.from({ length: n }, (_, i) => {
      if (i === n - 1) return ["   "];
      const ch = String.fromCharCode(65 + i);
      return [` ${ch} `];
    });
  }

  private shuffle(): void {
    const steps = this.size * this.size * 20;
    const dirs: readonly Dir[] = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];
    const opposite: Record<Dir, Dir> = {
      U: Dir.Down,
      D: Dir.Up,
      L: Dir.Right,
      R: Dir.Left,
    };
    let last: Dir | null = null;
    for (let i = 0; i < steps; i++) {
      const valid = dirs.filter((d) => {
        if (last !== null && opposite[last] === d) return false;
        return this.canMove(d);
      });
      if (valid.length === 0) continue;
      const d = valid[Math.floor(Math.random() * valid.length)]!;
      this.doMove(d);
      last = d;
    }
    this.state.moves = 0;
    this.state.startTime = Date.now();
    this.state.endTime = null;
    this.state.won = false;
    this.state.statusMsg = "";
    this.history.clear();
  }

  private canMove(dir: Dir): boolean {
    const size = this.state.size;
    const br = Math.floor(this.state.blank / size);
    const bc = this.state.blank % size;
    if (dir === Dir.Up && br === 0) return false;
    if (dir === Dir.Down && br === size - 1) return false;
    if (dir === Dir.Left && bc === 0) return false;
    if (dir === Dir.Right && bc === size - 1) return false;
    return true;
  }

  private doMove(dir: Dir): void {
    const size = this.state.size;
    const br = Math.floor(this.state.blank / size);
    const bc = this.state.blank % size;
    let nr = br;
    let nc = bc;
    if (dir === Dir.Up) nr--;
    else if (dir === Dir.Down) nr++;
    else if (dir === Dir.Left) nc--;
    else if (dir === Dir.Right) nc++;
    const ni = nr * size + nc;
    const order = [...this.state.order];
    [order[this.state.blank], order[ni]] = [
      order[ni]!,
      order[this.state.blank]!,
    ];
    this.state.order = order;
    this.state.blank = ni;
  }

  move(dir: Dir): boolean {
    if (this.phase !== GamePhase.Playing) return false;
    if (!this.canMove(dir)) {
      this.state.statusMsg = `无法向 ${dir} 方向移动`;
      return false;
    }
    this.doMove(dir);
    this.state.moves++;
    this.history.push(dir);
    this.state.statusMsg = "";
    this.events.emit("move", { dir, moves: this.state.moves });

    if (this.isSolved()) {
      this.state.won = true;
      this.state.endTime = Date.now();
      this.state.statusMsg = "恭喜完成!";
      this.transition(GamePhase.Won);
      this.events.emit("win", { moves: this.state.moves, time: this.elapsed });
      this.saveStats();
    }
    return true;
  }

  undo(): boolean {
    if (this.history.isEmpty) {
      this.state.statusMsg = "无棋可悔";
      return false;
    }
    const dir = this.history.pop()!;
    const opposite: Record<Dir, Dir> = {
      U: Dir.Down,
      D: Dir.Up,
      L: Dir.Right,
      R: Dir.Left,
    };
    this.doMove(opposite[dir]);
    this.state.moves = Math.max(0, this.state.moves - 1);
    this.state.statusMsg = "已悔棋";
    return true;
  }

  private isSolved(): boolean {
    for (let i = 0; i < this.state.order.length; i++) {
      if (this.state.order[i] !== i) return false;
    }
    return true;
  }

  private saveStats(): void {
    const s = this.stats as Mutable<GameStats>;
    s.gamesPlayed++;
    s.gamesWon++;
    const best = s.bestMoves[this.size];
    if (best === undefined || this.state.moves < best)
      s.bestMoves[this.size] = this.state.moves;
    const bestTime = s.bestTimes[this.size];
    if (bestTime === undefined || this.elapsed < bestTime)
      s.bestTimes[this.size] = this.elapsed;
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
    const c = (t: string, col: Color): string =>
      useColor ? `${COLOR_MAP[col]}${t}${ANSI.RESET}` : t;

    lines.push(c("===== 拼图小游戏 =====", Color.Cyan));
    lines.push(
      `模式: ${this.mode}  尺寸: ${this.size}x${this.size}  步数: ${this.state.moves}  用时: ${this.elapsed}s`,
    );
    lines.push("");

    const renderer =
      this.mode === GameMode.Picture
        ? new PictureRenderer(this.state.tiles)
        : this.mode === GameMode.Color
          ? new ColorRenderer()
          : new NumberRenderer();
    lines.push(renderer.render(this.state, useColor));

    lines.push("");
    if (this.phase === GamePhase.Won) {
      lines.push(c("===== 完成! =====", Color.Green));
      lines.push(`步数: ${this.state.moves}  用时: ${this.elapsed}s`);
      lines.push(c("输入 n 重新开始, q 退出", Color.Cyan));
    } else {
      lines.push(
        c(
          "命令: u/d/l/r 移动  z 悔棋  n 新游戏  mode <number|picture|color>  size <3|4|5>  q 退出",
          Color.Cyan,
        ),
      );
    }
    if (this.state.statusMsg) lines.push(c(this.state.statusMsg, Color.Yellow));

    return lines.join("\n");
  }
}

// ============================================================
// 10. 数据持久化
// ============================================================

function loadStats(): GameStats {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<GameStats>;
      return {
        gamesPlayed: d.gamesPlayed ?? 0,
        gamesWon: d.gamesWon ?? 0,
        bestMoves: d.bestMoves ?? {},
        bestTimes: d.bestTimes ?? {},
      };
    }
  } catch {
    /* ignore */
  }
  return { gamesPlayed: 0, gamesWon: 0, bestMoves: {}, bestTimes: {} };
}

// ============================================================
// 11. 命令解析
// ============================================================

function parseCommand(line: string): ParsedCommand {
  const parts = line.trim().toLowerCase().split(/\s+/);
  const cmd = parts[0] ?? "";
  if (cmd === "q" || cmd === "quit") return { action: "quit" };
  if (cmd === "n" || cmd === "new") return { action: "newGame" };
  if (cmd === "z" || cmd === "undo") return { action: "undo" };
  if (cmd === "h" || cmd === "help" || cmd === "?") return { action: "help" };
  if (cmd === "mode") {
    const m = parts[1] ?? "";
    if (isGameMode(m)) return { action: "mode", mode: m };
    return { action: "unknown", input: line };
  }
  if (cmd === "size") {
    const s = parseInt(parts[1] ?? "", 10);
    if (s === 3 || s === 4 || s === 5) return { action: "size", size: s };
    return { action: "unknown", input: line };
  }
  if (isDir(cmd.toUpperCase()))
    return { action: "move", dir: cmd.toUpperCase() as Dir };
  return { action: "unknown", input: line };
}

// ============================================================
// 12. 符号
// ============================================================

const SYM_GAME = Symbol("game");

interface GameSession {
  [SYM_GAME]: boolean;
  readonly game: PuzzleGame;
}

function createSession(size: number, mode: GameMode): GameSession {
  const game = new PuzzleGame(size, mode);
  game.start();
  return { [SYM_GAME]: true, game };
}

// ============================================================
// 13. 主程序
// ============================================================

function main(): void {
  let size = 3;
  let mode: GameMode = GameMode.Number;
  let session = createSession(size, mode);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "拼图> ",
  });

  const refresh = (): void => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    process.stdout.write(session.game.render(true) + "\n");
  };

  refresh();
  rl.prompt();

  rl.on("line", (line: string) => {
    const cmd = parseCommand(line);
    switch (cmd.action) {
      case "quit":
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      case "newGame":
        session = createSession(size, mode);
        break;
      case "move":
        session.game.move(cmd.dir);
        break;
      case "undo":
        session.game.undo();
        break;
      case "mode":
        mode = cmd.mode;
        session = createSession(size, mode);
        break;
      case "size":
        size = cmd.size;
        session = createSession(size, mode);
        break;
      case "help":
        console.log("\n帮助:");
        console.log("  u/d/l/r   空白格移动方向");
        console.log("  z         悔棋");
        console.log("  n         新游戏");
        console.log("  mode <m>  切换模式 (number/picture/color)");
        console.log("  size <n>  切换尺寸 (3/4/5)");
        console.log("  q         退出");
        break;
      default:
        session.game.boardState.statusMsg = "未知命令, 输入 h 查看帮助";
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
