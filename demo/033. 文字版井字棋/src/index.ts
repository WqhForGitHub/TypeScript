#!/usr/bin/env node
/**
 * 文字版井字棋 (Text-based Tic-Tac-Toe) — Enhanced Edition
 *
 * Features:
 *   - Multiple game modes: PvP, PvAI (3 difficulty levels), AIvAI
 *   - Board sizes: 3x3, 4x4, 5x5 with configurable win length
 *   - AI with minimax + alpha-beta pruning, difficulty-based randomness
 *   - Move history with undo/redo
 *   - Game state machine, statistics, event system
 *   - ANSI color rendering, player profiles
 *
 * TypeScript features: enums, generics, discriminated unions, mapped types,
 * conditional types, template literal types, type guards, utility types,
 * tuples, abstract classes, function overloads, as const, custom errors,
 * generators, symbols, satisfies, getters/setters.
 */

import * as readline from "readline";

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
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
} as const;

enum Mark {
  X = "X",
  O = "O",
  Empty = " ",
}

enum GameMode {
  PvP = "pvp",
  PvAI = "pvc",
  AIvAI = "cvc",
}

enum AIDifficulty {
  Easy = "easy",
  Medium = "medium",
  Hard = "hard",
}

enum GamePhase {
  Menu = "menu",
  Playing = "playing",
  Won = "won",
  Draw = "draw",
}

enum Color {
  Red = "red",
  Green = "green",
  Yellow = "yellow",
  Cyan = "cyan",
  Gray = "gray",
  Bold = "bold",
}

type ColorCode = (typeof ANSI)[keyof typeof ANSI];

const COLOR_MAP: Record<Color, ColorCode> = {
  [Color.Red]: ANSI.RED,
  [Color.Green]: ANSI.GREEN,
  [Color.Yellow]: ANSI.YELLOW,
  [Color.Cyan]: ANSI.CYAN,
  [Color.Gray]: ANSI.GRAY,
  [Color.Bold]: ANSI.BOLD,
};

const DATA_FILE = `${process.env.USERPROFILE || process.env.HOME || "."}/.tictactoe_data.json`;

interface BoardSizeConfig {
  readonly size: number;
  readonly winLength: number;
  readonly label: string;
}

const BOARD_PRESETS: Record<number, BoardSizeConfig> = {
  3: { size: 3, winLength: 3, label: "3x3" },
  4: { size: 4, winLength: 4, label: "4x4" },
  5: { size: 5, winLength: 4, label: "5x5" },
} as const satisfies Record<number, BoardSizeConfig>;

// ============================================================
// 2. 接口与类型
// ============================================================

type Cell = Mark;
type Board = readonly Cell[];

type Coord = readonly [number, number];

interface PlayerProfile {
  readonly name: string;
  readonly mark: Mark;
  readonly isAI: boolean;
  readonly difficulty?: AIDifficulty;
}

interface GameResult {
  readonly winner: Mark | "draw" | null;
  readonly winLine: readonly number[] | null;
}

interface GameStats {
  readonly gamesPlayed: number;
  readonly xWins: number;
  readonly oWins: number;
  readonly draws: number;
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface EventMap {
  move: { readonly pos: number; readonly mark: Mark };
  undo: { readonly pos: number };
  redo: { readonly pos: number };
  gameEnd: { readonly result: GameResult };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
}

type EventType = keyof EventMap;
type EventHandler<E extends EventType> = (payload: EventMap[E]) => void;

type EventName = `on${Capitalize<string>}`;

// ============================================================
// 3. 判别联合
// ============================================================

type GameEvent =
  | { readonly type: "move"; readonly pos: number; readonly mark: Mark }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "restart" }
  | { readonly type: "menu" }
  | { readonly type: "quit" };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

type ParsedCommand =
  | { readonly action: "move"; readonly pos: number }
  | { readonly action: "undo" }
  | { readonly action: "redo" }
  | { readonly action: "restart" }
  | { readonly action: "menu" }
  | { readonly action: "stats" }
  | { readonly action: "help" }
  | { readonly action: "quit" }
  | { readonly action: "next" }
  | { readonly action: "unknown"; readonly input: string };

// ============================================================
// 4. 自定义错误
// ============================================================

abstract class TicTacError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

class InvalidPositionError extends TicTacError {
  readonly code = "INVALID_POS";
  constructor(pos: number) {
    super(`位置无效: ${pos}`);
  }
}

class CellOccupiedError extends TicTacError {
  readonly code = "CELL_OCCUPIED";
  constructor(pos: number) {
    super(`位置 ${pos} 已被占用`);
  }
}

class GameStateError extends TicTacError {
  readonly code = "GAME_STATE";
  constructor(msg: string) {
    super(msg);
  }
}

// ============================================================
// 5. 类型守卫
// ============================================================

function isMark(value: unknown): value is Mark {
  return (
    typeof value === "string" && Object.values(Mark).includes(value as Mark)
  );
}

function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" &&
    Object.values(GameMode).includes(value as GameMode)
  );
}

function isAIDifficulty(value: unknown): value is AIDifficulty {
  return (
    typeof value === "string" &&
    Object.values(AIDifficulty).includes(value as AIDifficulty)
  );
}

// ============================================================
// 6. 泛型事件系统
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

// ============================================================
// 7. 泛型栈 (用于撤销/重做)
// ============================================================

class Stack<T> {
  private readonly items: T[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items.length = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = this.items.length - 1; i >= 0; i--) {
      yield this.items[i];
    }
  }
}

// ============================================================
// 8. 生成器
// ============================================================

function* winLines(
  size: number,
  winLength: number,
): Generator<readonly number[]> {
  // Horizontal
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - winLength; c++) {
      yield Array.from({ length: winLength }, (_, i) => r * size + c + i);
    }
  }
  // Vertical
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - winLength; r++) {
      yield Array.from({ length: winLength }, (_, i) => (r + i) * size + c);
    }
  }
  // Diagonal (down-right)
  for (let r = 0; r <= size - winLength; r++) {
    for (let c = 0; c <= size - winLength; c++) {
      yield Array.from({ length: winLength }, (_, i) => (r + i) * size + c + i);
    }
  }
  // Diagonal (down-left)
  for (let r = 0; r <= size - winLength; r++) {
    for (let c = winLength - 1; c < size; c++) {
      yield Array.from({ length: winLength }, (_, i) => (r + i) * size + c - i);
    }
  }
}

function* availablePositions(board: Board): Generator<number> {
  for (let i = 0; i < board.length; i++) {
    if (board[i] === Mark.Empty) yield i;
  }
}

// ============================================================
// 9. 抽象 AI 策略
// ============================================================

abstract class AIStrategy {
  abstract readonly name: string;
  abstract chooseMove(
    board: Board,
    player: Mark,
    size: number,
    winLength: number,
  ): number;
}

class RandomAI extends AIStrategy {
  readonly name = "随机";
  chooseMove(
    board: Board,
    _player: Mark,
    _size: number,
    _winLength: number,
  ): number {
    const moves = [...availablePositions(board)];
    if (moves.length === 0) return -1;
    return moves[Math.floor(Math.random() * moves.length)] ?? -1;
  }
}

class HeuristicAI extends AIStrategy {
  readonly name = "启发式";
  chooseMove(
    board: Board,
    player: Mark,
    size: number,
    winLength: number,
  ): number {
    const opponent = player === Mark.X ? Mark.O : Mark.X;

    // Try to win
    for (const pos of availablePositions(board)) {
      const test = [...board] as Mutable<Board>;
      test[pos] = player;
      if (checkWin(test as Board, player, size, winLength)) return pos;
    }

    // Block opponent
    for (const pos of availablePositions(board)) {
      const test = [...board] as Mutable<Board>;
      test[pos] = opponent;
      if (checkWin(test as Board, opponent, size, winLength)) return pos;
    }

    // Take center
    const center = Math.floor((size * size) / 2);
    if (board[center] === Mark.Empty) return center;

    // Take corners
    const corners = [0, size - 1, size * (size - 1), size * size - 1];
    const availCorners = corners.filter((c) => board[c] === Mark.Empty);
    if (availCorners.length > 0) {
      return availCorners[Math.floor(Math.random() * availCorners.length)] ?? 0;
    }

    // Random
    const moves = [...availablePositions(board)];
    return moves[Math.floor(Math.random() * moves.length)] ?? -1;
  }
}

class MinimaxAI extends AIStrategy {
  readonly name = "极小极大";

  chooseMove(
    board: Board,
    player: Mark,
    size: number,
    winLength: number,
  ): number {
    const result = this.minimax(
      board,
      true,
      player,
      player,
      size,
      winLength,
      -Infinity,
      Infinity,
      0,
    );
    return result.move ?? -1;
  }

  private minimax(
    board: Board,
    isMax: boolean,
    aiPlayer: Mark,
    currentPlayer: Mark,
    size: number,
    winLength: number,
    alpha: number,
    beta: number,
    depth: number,
  ): { readonly score: number; readonly move?: number } {
    const opponent = aiPlayer === Mark.X ? Mark.O : Mark.X;
    const result = checkWin(board, aiPlayer, size, winLength);
    const oppResult = checkWin(board, opponent, size, winLength);

    if (result) return { score: 100 - depth };
    if (oppResult) return { score: -100 + depth };

    const moves = [...availablePositions(board)];
    if (moves.length === 0) return { score: 0 };

    // Limit depth for larger boards
    if (depth > 8) return { score: 0 };

    let bestMove: number | undefined;
    let bestScore = isMax ? -Infinity : Infinity;
    const nextPlayer = currentPlayer === Mark.X ? Mark.O : Mark.X;

    for (const move of moves) {
      const test = [...board] as Mutable<Board>;
      test[move] = currentPlayer;
      const child = this.minimax(
        test as Board,
        !isMax,
        aiPlayer,
        nextPlayer,
        size,
        winLength,
        alpha,
        beta,
        depth + 1,
      );

      if (isMax) {
        if (child.score > bestScore) {
          bestScore = child.score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (child.score < bestScore) {
          bestScore = child.score;
          bestMove = move;
        }
        beta = Math.min(beta, bestScore);
      }

      if (beta <= alpha) break;
    }

    return { score: bestScore, move: bestMove };
  }
}

const AI_STRATEGIES: Record<AIDifficulty, AIStrategy> = {
  [AIDifficulty.Easy]: new RandomAI(),
  [AIDifficulty.Medium]: new HeuristicAI(),
  [AIDifficulty.Hard]: new MinimaxAI(),
} as const satisfies Record<AIDifficulty, AIStrategy>;

// ============================================================
// 10. 胜负检测
// ============================================================

function checkWin(
  board: Board,
  player: Mark,
  size: number,
  winLength: number,
): readonly number[] | null {
  for (const line of winLines(size, winLength)) {
    if (line.every((idx) => board[idx] === player)) {
      return line;
    }
  }
  return null;
}

function checkResult(
  board: Board,
  size: number,
  winLength: number,
): GameResult {
  for (const player of [Mark.X, Mark.O]) {
    const line = checkWin(board, player, size, winLength);
    if (line) return { winner: player, winLine: line };
  }
  if (board.every((c) => c !== Mark.Empty)) {
    return { winner: "draw", winLine: null };
  }
  return { winner: null, winLine: null };
}

// ============================================================
// 11. 游戏引擎
// ============================================================

class GameEvents extends EventEmitter<EventMap> {}

class TicTacToeGame {
  private board: Cell[];
  private phase: GamePhase = GamePhase.Menu;
  private currentPlayer: Mark = Mark.X;
  private result: GameResult = { winner: null, winLine: null };
  private readonly undoStack: Stack<number>;
  private readonly redoStack: Stack<number>;
  private readonly events = new GameEvents();
  private readonly stats: GameStats;
  private statusMsg: string = "";

  constructor(
    readonly mode: GameMode,
    readonly size: number,
    readonly winLength: number,
    readonly playerX: PlayerProfile,
    readonly playerO: PlayerProfile,
  ) {
    this.board = new Array<Cell>(size * size).fill(Mark.Empty);
    this.undoStack = new Stack<number>();
    this.redoStack = new Stack<number>();
    this.stats = loadStats();
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }
  get currentMark(): Mark {
    return this.currentPlayer;
  }
  get currentResult(): GameResult {
    return this.result;
  }
  get message(): string {
    return this.statusMsg;
  }
  get boardState(): Board {
    return this.board;
  }

  get canUndo(): boolean {
    return !this.undoStack.isEmpty;
  }
  get canRedo(): boolean {
    return !this.redoStack.isEmpty;
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

  start(): void {
    this.transition(GamePhase.Playing);
  }

  makeMove(pos: number): boolean {
    if (this.phase !== GamePhase.Playing) return false;
    if (pos < 0 || pos >= this.board.length)
      throw new InvalidPositionError(pos);
    if (this.board[pos] !== Mark.Empty) throw new CellOccupiedError(pos);

    this.board[pos] = this.currentPlayer;
    this.undoStack.push(pos);
    this.redoStack.clear();
    this.events.emit("move", { pos, mark: this.currentPlayer });
    this.statusMsg = "";

    const result = checkResult(this.board, this.size, this.winLength);
    if (result.winner) {
      this.result = result;
      if (result.winner === "draw") {
        this.transition(GamePhase.Draw);
      } else {
        this.transition(GamePhase.Won);
      }
      this.events.emit("gameEnd", { result });
      this.saveStats(result);
    } else {
      this.currentPlayer = this.currentPlayer === Mark.X ? Mark.O : Mark.X;
    }
    return true;
  }

  undo(): boolean {
    if (
      this.phase !== GamePhase.Playing &&
      this.phase !== GamePhase.Won &&
      this.phase !== GamePhase.Draw
    )
      return false;
    if (this.undoStack.isEmpty) {
      this.statusMsg = "无棋可悔";
      return false;
    }
    const pos = this.undoStack.pop()!;
    this.board[pos] = Mark.Empty;
    this.redoStack.push(pos);
    this.currentPlayer = this.currentPlayer === Mark.X ? Mark.O : Mark.X;
    this.result = { winner: null, winLine: null };
    if (this.phase !== GamePhase.Playing) this.transition(GamePhase.Playing);
    this.events.emit("undo", { pos });
    this.statusMsg = "已悔棋";
    return true;
  }

  redo(): boolean {
    if (this.phase !== GamePhase.Playing) return false;
    if (this.redoStack.isEmpty) {
      this.statusMsg = "无棋可前";
      return false;
    }
    const pos = this.redoStack.pop()!;
    this.board[pos] = this.currentPlayer;
    this.undoStack.push(pos);
    this.events.emit("redo", { pos });
    this.statusMsg = "已重做";

    const result = checkResult(this.board, this.size, this.winLength);
    if (result.winner) {
      this.result = result;
      if (result.winner === "draw") {
        this.transition(GamePhase.Draw);
      } else {
        this.transition(GamePhase.Won);
      }
      this.events.emit("gameEnd", { result });
    } else {
      this.currentPlayer = this.currentPlayer === Mark.X ? Mark.O : Mark.X;
    }
    return true;
  }

  aiMove(): boolean {
    if (this.phase !== GamePhase.Playing) return false;
    const player = this.currentPlayer === Mark.X ? this.playerX : this.playerO;
    if (!player.isAI) return false;

    const strategy = player.difficulty
      ? AI_STRATEGIES[player.difficulty]
      : AI_STRATEGIES[AIDifficulty.Medium];
    const pos = strategy.chooseMove(
      this.board,
      this.currentPlayer,
      this.size,
      this.winLength,
    );
    if (pos < 0) return false;
    return this.makeMove(pos);
  }

  isCurrentPlayerAI(): boolean {
    const player = this.currentPlayer === Mark.X ? this.playerX : this.playerO;
    return player.isAI;
  }

  reset(): void {
    this.board = new Array<Cell>(this.size * this.size).fill(Mark.Empty);
    this.currentPlayer = Mark.X;
    this.result = { winner: null, winLine: null };
    this.statusMsg = "";
    this.undoStack.clear();
    this.redoStack.clear();
    this.transition(GamePhase.Playing);
  }

  private saveStats(result: GameResult): void {
    const s = this.stats as Mutable<GameStats>;
    s.gamesPlayed++;
    if (result.winner === Mark.X) s.xWins++;
    else if (result.winner === Mark.O) s.oWins++;
    else if (result.winner === "draw") s.draws++;
    try {
      const fs = require("fs");
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
    const fmtPlayer = (m: Mark): string =>
      m === Mark.X ? c("X", Color.Red) : c("O", Color.Green);

    lines.push(c("===== 文字版井字棋 =====", Color.Cyan));
    const playerInfo =
      this.currentPlayer === Mark.X ? this.playerX : this.playerO;
    lines.push(
      `模式: ${this.mode}  当前: ${fmtPlayer(this.currentPlayer)} (${playerInfo.name})  棋盘: ${this.size}x${this.size}  连珠: ${this.winLength}`,
    );

    const winSet = new Set<number>(this.result.winLine ?? []);
    const cells: string[] = [];
    for (let i = 0; i < this.board.length; i++) {
      const v = this.board[i];
      if (v === Mark.Empty) {
        cells.push(c((i + 1).toString(), Color.Gray));
      } else if (winSet.has(i)) {
        cells.push(c(v, Color.Yellow));
      } else if (v === Mark.X) {
        cells.push(c(v, Color.Red));
      } else {
        cells.push(c(v, Color.Green));
      }
    }

    lines.push("");
    const cellWidth = String(this.board.length).length;
    for (let r = 0; r < this.size; r++) {
      const rowCells: string[] = [];
      for (let cc = 0; cc < this.size; cc++) {
        rowCells.push(cells[r * this.size + cc].padEnd(cellWidth));
      }
      lines.push("  " + rowCells.join("  │  "));
      if (r < this.size - 1) {
        lines.push(
          "  " +
            Array.from({ length: this.size }, () =>
              "─".repeat(cellWidth + 2),
            ).join("┼"),
        );
      }
    }

    lines.push("");
    if (this.phase === GamePhase.Won) {
      lines.push(c(`${this.result.winner} 获胜!`, Color.Yellow));
    } else if (this.phase === GamePhase.Draw) {
      lines.push(c("平局!", Color.Yellow));
    } else if (this.mode === GameMode.AIvAI) {
      lines.push(c("[AI vs AI] 按回车执行下一步", Color.Cyan));
    }

    if (this.phase === GamePhase.Playing) {
      lines.push(
        c(
          "操作: 输入位置编号落子  u 悔棋  y 重做  r 重新开始  m 返回菜单  q 退出",
          Color.Cyan,
        ),
      );
    } else {
      lines.push(c("操作: r 重新开始  m 返回菜单  q 退出", Color.Cyan));
    }

    if (this.statusMsg) {
      lines.push(c(this.statusMsg, Color.Yellow));
    }

    return lines.join("\n");
  }
}

// ============================================================
// 12. 统计数据
// ============================================================

function loadStats(): GameStats {
  try {
    const fs = require("fs");
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<GameStats>;
      return {
        gamesPlayed: data.gamesPlayed ?? 0,
        xWins: data.xWins ?? 0,
        oWins: data.oWins ?? 0,
        draws: data.draws ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { gamesPlayed: 0, xWins: 0, oWins: 0, draws: 0 };
}

// ============================================================
// 13. 命令解析 (函数重载)
// ============================================================

function parseCommand(line: string, maxPos: number): ParsedCommand {
  const input = line.trim().toLowerCase();
  if (input === "q" || input === "quit") return { action: "quit" };
  if (input === "m" || input === "menu") return { action: "menu" };
  if (input === "r" || input === "restart") return { action: "restart" };
  if (input === "u" || input === "undo") return { action: "undo" };
  if (input === "y" || input === "redo") return { action: "redo" };
  if (input === "s" || input === "stats") return { action: "stats" };
  if (input === "h" || input === "?" || input === "help")
    return { action: "help" };
  if (input === "" || input === " ") return { action: "next" };

  const pos = parseInt(input, 10);
  if (!Number.isNaN(pos) && pos >= 1 && pos <= maxPos) {
    return { action: "move", pos: pos - 1 };
  }

  return { action: "unknown", input: line };
}

// ============================================================
// 14. 符号
// ============================================================

const SYM_SESSION = Symbol("session");

interface GameSession {
  [SYM_SESSION]: boolean;
  readonly game: TicTacToeGame;
}

function createSession(
  mode: GameMode,
  size: number,
  difficulty: AIDifficulty,
): GameSession {
  const cfg = BOARD_PRESETS[size] ?? BOARD_PRESETS[3];
  const winLength = cfg.winLength;

  const playerX: PlayerProfile = {
    name: mode === GameMode.AIvAI ? "AI-X" : "玩家",
    mark: Mark.X,
    isAI: mode === GameMode.AIvAI,
    difficulty: mode === GameMode.AIvAI ? difficulty : undefined,
  };

  const playerO: PlayerProfile = {
    name:
      mode === GameMode.PvP ? "玩家2" : mode === GameMode.AIvAI ? "AI-O" : "AI",
    mark: Mark.O,
    isAI: mode !== GameMode.PvP,
    difficulty: mode !== GameMode.PvP ? difficulty : undefined,
  };

  const game = new TicTacToeGame(mode, cfg.size, winLength, playerX, playerO);
  game.start();

  return { [SYM_SESSION]: true, game };
}

// ============================================================
// 15. 主程序
// ============================================================

function showMenu(): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 文字版井字棋 =====" + ANSI.RESET);
  console.log("请选择模式:");
  console.log("  1 / pvp  - 玩家 vs 玩家");
  console.log("  2 / pvc  - 玩家 vs AI");
  console.log("  3 / cvc  - AI vs AI 演示");
  console.log("  s        - 查看统计");
  console.log("  q        - 退出");
}

function showAIDifficultyMenu(): void {
  console.log("\n选择 AI 难度:");
  console.log("  1 / easy   - 简单 (随机)");
  console.log("  2 / medium - 中等 (启发式)");
  console.log("  3 / hard   - 困难 (极小极大)");
}

function showBoardSizeMenu(): void {
  console.log("\n选择棋盘大小:");
  console.log("  3 - 3x3 (三连珠)");
  console.log("  4 - 4x4 (四连珠)");
  console.log("  5 - 5x5 (四连珠)");
}

function showStats(stats: Readonly<GameStats>): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 统计 =====" + ANSI.RESET);
  console.log(`  游戏次数: ${stats.gamesPlayed}`);
  console.log(`  X 胜: ${stats.xWins}`);
  console.log(`  O 胜: ${stats.oWins}`);
  console.log(`  平局: ${stats.draws}`);
}

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let session: GameSession | null = null;
  let inMenu = true;
  let pendingMode: GameMode | null = null;
  let pendingDifficulty: AIDifficulty = AIDifficulty.Medium;
  let pendingSize: number = 3;

  const refresh = (): void => {
    if (session) {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      process.stdout.write(session.game.render(true) + "\n");
    }
  };

  showMenu();
  rl.setPrompt("选择> ");
  rl.prompt();

  rl.on("line", (line: string) => {
    const input = line.trim().toLowerCase();

    if (inMenu) {
      if (input === "1" || input === "pvp") {
        session = createSession(GameMode.PvP, pendingSize, pendingDifficulty);
        inMenu = false;
        refresh();
        rl.setPrompt("落子> ");
      } else if (input === "2" || input === "pvc") {
        pendingMode = GameMode.PvAI;
        showAIDifficultyMenu();
        rl.setPrompt("AI难度> ");
        inMenu = false;
        // Set a flag for difficulty selection
        (inMenu as unknown) = "difficulty";
      } else if (input === "3" || input === "cvc") {
        pendingMode = GameMode.AIvAI;
        showAIDifficultyMenu();
        rl.setPrompt("AI难度> ");
        inMenu = false;
        (inMenu as unknown) = "difficulty";
      } else if (input === "s" || input === "stats") {
        showStats(loadStats());
      } else if (input === "q") {
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      } else {
        console.log(ANSI.RED + "无效输入" + ANSI.RESET);
      }
      rl.prompt();
      return;
    }

    // Difficulty selection
    if ((inMenu as unknown) === "difficulty") {
      if (input === "1" || input === "easy")
        pendingDifficulty = AIDifficulty.Easy;
      else if (input === "2" || input === "medium")
        pendingDifficulty = AIDifficulty.Medium;
      else if (input === "3" || input === "hard")
        pendingDifficulty = AIDifficulty.Hard;
      else {
        console.log(ANSI.RED + "无效输入, 默认中等" + ANSI.RESET);
        pendingDifficulty = AIDifficulty.Medium;
      }
      showBoardSizeMenu();
      rl.setPrompt("棋盘> ");
      (inMenu as unknown) = "boardsize";
      rl.prompt();
      return;
    }

    // Board size selection
    if ((inMenu as unknown) === "boardsize") {
      const size = parseInt(input, 10);
      if (!Number.isNaN(size) && size >= 3 && size <= 5) {
        pendingSize = size;
      } else {
        console.log(ANSI.RED + "无效输入, 默认 3x3" + ANSI.RESET);
        pendingSize = 3;
      }
      if (pendingMode) {
        session = createSession(pendingMode, pendingSize, pendingDifficulty);
        inMenu = false;
        refresh();
        rl.setPrompt(pendingMode === GameMode.AIvAI ? "回车继续> " : "落子> ");
      }
      rl.prompt();
      return;
    }

    if (!session) return;

    const cmd = parseCommand(line, session.game.boardState.length);

    switch (cmd.action) {
      case "quit":
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
        break;
      case "menu":
        inMenu = true;
        session = null;
        showMenu();
        rl.setPrompt("选择> ");
        break;
      case "restart":
        session.game.reset();
        break;
      case "move":
        if (
          session.game.currentPhase === GamePhase.Playing &&
          !session.game.isCurrentPlayerAI()
        ) {
          try {
            session.game.makeMove(cmd.pos);
          } catch (e) {
            if (e instanceof TicTacError)
              console.log(ANSI.RED + e.message + ANSI.RESET);
          }
          // AI turn
          if (
            session.game.currentPhase === GamePhase.Playing &&
            session.game.isCurrentPlayerAI()
          ) {
            session.game.aiMove();
          }
        }
        break;
      case "next":
        if (
          session.game.mode === GameMode.AIvAI &&
          session.game.currentPhase === GamePhase.Playing
        ) {
          session.game.aiMove();
        }
        break;
      case "undo":
        session.game.undo();
        // Undo twice in PvAI mode (player + AI)
        if (
          session.game.mode === GameMode.PvAI &&
          session.game.canUndo &&
          session.game.isCurrentPlayerAI()
        ) {
          session.game.undo();
        }
        break;
      case "redo":
        session.game.redo();
        break;
      case "stats":
        showStats(session.game.getStatistics());
        break;
      case "help":
        console.log("\n帮助:");
        console.log("  <编号>  在对应位置落子");
        console.log("  u       悔棋");
        console.log("  y       重做");
        console.log("  r       重新开始");
        console.log("  m       返回菜单");
        console.log("  s       查看统计");
        console.log("  q       退出");
        break;
      default:
        console.log(ANSI.RED + "未知命令" + ANSI.RESET);
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
