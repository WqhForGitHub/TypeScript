#!/usr/bin/env node
/**
 * 文字版五子棋 (Text-based Gomoku) — Enhanced Edition
 *
 * Features:
 *   - Multiple game modes: PvP, PvAI (3 difficulty levels), AIvAI
 *   - Board sizes: 9x9, 13x13, 15x15, 19x19
 *   - AI with pattern-based evaluation, threat detection, minimax
 *   - Move history with undo/redo
 *   - Game state machine, statistics, event system
 *   - ANSI color rendering, coordinate labels
 *
 * TypeScript features: enums, generics, discriminated unions, mapped types,
 * conditional types, template literal types, type guards, utility types,
 * tuples, abstract classes, function overloads, as const, custom errors,
 * generators, symbols, satisfies, getters/setters.
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

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

const enum Pattern {
  Five = "five",
  OpenFour = "open4",
  Four = "four",
  OpenThree = "open3",
  Three = "three",
  OpenTwo = "open2",
  Two = "two",
  One = "one",
}

enum Stone {
  Black = "B",
  White = "W",
  Empty = " ",
}

enum GameMode {
  PvP = "pvp",
  PvAI = "pvc",
  AIvAI = "cvc",
}

enum AILevel {
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

interface BoardSizeConfig {
  readonly size: number;
  readonly winLength: number;
  readonly label: string;
}

const BOARD_PRESETS: Record<number, BoardSizeConfig> = {
  9: { size: 9, winLength: 5, label: "9x9" },
  13: { size: 13, winLength: 5, label: "13x13" },
  15: { size: 15, winLength: 5, label: "15x15" },
  19: { size: 19, winLength: 5, label: "19x19" },
} as const satisfies Record<number, BoardSizeConfig>;

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".gomoku_data.json",
);

// Pattern scores
const PATTERN_SCORES: Record<Pattern, number> = {
  [Pattern.Five]: 100000,
  [Pattern.OpenFour]: 10000,
  [Pattern.Four]: 1000,
  [Pattern.OpenThree]: 500,
  [Pattern.Three]: 100,
  [Pattern.OpenTwo]: 50,
  [Pattern.Two]: 10,
  [Pattern.One]: 1,
} as const satisfies Record<Pattern, number>;

// Pattern matching strings (X = self, O = opponent, _ = empty, # = boundary)
const PATTERN_STRINGS: ReadonlyArray<{
  readonly str: string;
  readonly pattern: Pattern;
}> = [
  { str: "XXXXX", pattern: Pattern.Five },
  { str: "_XXXX_", pattern: Pattern.OpenFour },
  { str: "_XXXX", pattern: Pattern.Four },
  { str: "XXXX_", pattern: Pattern.Four },
  { str: "X_XXX", pattern: Pattern.Four },
  { str: "XXX_X", pattern: Pattern.Four },
  { str: "XX_XX", pattern: Pattern.Four },
  { str: "_XXX_", pattern: Pattern.OpenThree },
  { str: "_XX_X_", pattern: Pattern.OpenThree },
  { str: "_X_XX_", pattern: Pattern.OpenThree },
  { str: "_XXX", pattern: Pattern.Three },
  { str: "XXX_", pattern: Pattern.Three },
  { str: "_XX_", pattern: Pattern.OpenTwo },
  { str: "_X_X_", pattern: Pattern.OpenTwo },
  { str: "_X_", pattern: Pattern.One },
] as const;

// ============================================================
// 2. 接口与类型
// ============================================================

type Board = Stone[][];
type Coord = readonly [number, number];
type Direction = readonly [number, number];

interface Move {
  readonly x: number;
  readonly y: number;
  readonly stone: Stone;
  readonly moveNumber: number;
}

interface GameResult {
  readonly winner: Stone | "draw" | null;
  readonly winLine: readonly Coord[] | null;
}

interface GameStats {
  readonly gamesPlayed: number;
  readonly blackWins: number;
  readonly whiteWins: number;
  readonly draws: number;
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface EventMap {
  move: {
    readonly pos: Coord;
    readonly stone: Stone;
    readonly moveNum: number;
  };
  undo: { readonly moveNum: number };
  gameEnd: { readonly result: GameResult };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
}

type EventType = keyof EventMap;
type EventHandler<E extends EventType> = (payload: EventMap[E]) => void;

type EventName = `on${Capitalize<string>}`;

type LineString = string;

// ============================================================
// 3. 判别联合
// ============================================================

type GameEvent =
  | {
      readonly type: "move";
      readonly x: number;
      readonly y: number;
      readonly stone: Stone;
    }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "restart"; readonly mode: GameMode }
  | { readonly type: "menu" }
  | { readonly type: "quit" };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

type ParsedCommand =
  | { readonly action: "move"; readonly x: number; readonly y: number }
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

abstract class GomokuError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

class InvalidCoordError extends GomokuError {
  readonly code = "INVALID_COORD";
  constructor(input: string) {
    super(`坐标无效: ${input}`);
  }
}

class CellOccupiedError extends GomokuError {
  readonly code = "CELL_OCCUPIED";
  constructor(x: number, y: number) {
    super(`(${x}, ${y}) 已被占用`);
  }
}

class GameStateError extends GomokuError {
  readonly code = "GAME_STATE";
  constructor(msg: string) {
    super(msg);
  }
}

// ============================================================
// 5. 类型守卫
// ============================================================

function isStone(value: unknown): value is Stone {
  return (
    typeof value === "string" && Object.values(Stone).includes(value as Stone)
  );
}

function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" &&
    Object.values(GameMode).includes(value as GameMode)
  );
}

function isAILevel(value: unknown): value is AILevel {
  return (
    typeof value === "string" &&
    Object.values(AILevel).includes(value as AILevel)
  );
}

// ============================================================
// 6. 泛型事件系统 & 栈
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
    for (let i = this.items.length - 1; i >= 0; i--) yield this.items[i]!;
  }
}

// ============================================================
// 7. 生成器
// ============================================================

const DIRECTIONS: readonly Direction[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

function* iterateBoard(size: number): Generator<Coord> {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      yield [x, y];
    }
  }
}

function* neighbors(
  board: Board,
  x: number,
  y: number,
  range: number,
): Generator<Coord> {
  for (const [dx, dy] of DIRECTIONS) {
    for (const [sx, sy] of [
      [dx, dy],
      [-dx, -dy],
    ] as const) {
      for (let i = 1; i <= range; i++) {
        const nx = x + sx * i;
        const ny = y + sy * i;
        if (nx >= 0 && nx < board[0]!.length && ny >= 0 && ny < board.length) {
          yield [nx, ny];
        }
      }
    }
  }
}

function* candidateMoves(board: Board, range: number): Generator<Coord> {
  const seen = new Set<string>();
  let hasStone = false;
  for (const [x, y] of iterateBoard(board.length)) {
    if (board[y]![x] !== Stone.Empty) {
      hasStone = true;
      for (let dy = -range; dy <= range; dy++) {
        for (let dx = -range; dx <= range; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 &&
            nx < board.length &&
            ny >= 0 &&
            ny < board.length &&
            board[ny]![nx] === Stone.Empty
          ) {
            const key = `${nx},${ny}`;
            if (!seen.has(key)) {
              seen.add(key);
              yield [nx, ny];
            }
          }
        }
      }
    }
  }
  if (!hasStone) {
    const center = Math.floor(board.length / 2);
    yield [center, center];
  }
}

// ============================================================
// 8. 抽象 AI 策略
// ============================================================

abstract class AIStrategy {
  abstract readonly name: string;
  abstract chooseMove(
    board: Board,
    player: Stone,
    size: number,
    winLength: number,
  ): Coord;
}

class RandomAI extends AIStrategy {
  readonly name = "随机";
  chooseMove(
    board: Board,
    _player: Stone,
    _size: number,
    _winLength: number,
  ): Coord {
    const moves = [...candidateMoves(board, 2)];
    if (moves.length === 0) {
      const center = Math.floor(board.length / 2);
      return [center, center];
    }
    return moves[Math.floor(Math.random() * moves.length)] ?? [0, 0];
  }
}

class HeuristicAI extends AIStrategy {
  readonly name = "启发式";

  chooseMove(
    board: Board,
    player: Stone,
    size: number,
    winLength: number,
  ): Coord {
    const opponent = player === Stone.Black ? Stone.White : Stone.Black;
    let bestScore = -Infinity;
    let bestMoves: Coord[] = [];

    for (const [x, y] of candidateMoves(board, 2)) {
      const offense = this.evaluatePoint(board, x, y, player, size, winLength);
      const defense = this.evaluatePoint(
        board,
        x,
        y,
        opponent,
        size,
        winLength,
      );
      const score = offense * 1.1 + defense;
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [[x, y]];
      } else if (score === bestScore) {
        bestMoves.push([x, y]);
      }
    }

    if (bestMoves.length === 0) {
      const center = Math.floor(size / 2);
      return [center, center];
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? [0, 0];
  }

  private evaluatePoint(
    board: Board,
    x: number,
    y: number,
    stone: Stone,
    size: number,
    winLength: number,
  ): number {
    if (board[y]![x] !== Stone.Empty) return -1;
    let total = 0;
    for (const [dx, dy] of DIRECTIONS) {
      const lineStr = this.getLineString(board, x, y, dx, dy, stone, size);
      let best = 0;
      for (const { str, pattern } of PATTERN_STRINGS) {
        if (lineStr.includes(str)) {
          const score = PATTERN_SCORES[pattern];
          if (score > best) best = score;
        }
      }
      total += best;
    }
    return total;
  }

  private getLineString(
    board: Board,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stone: Stone,
    size: number,
  ): LineString {
    let s = "";
    for (let i = -4; i <= 4; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
        s += "#";
      } else {
        const v = board[ny]![nx]!;
        if (v === Stone.Empty) s += "_";
        else if (v === stone) s += "X";
        else s += "O";
      }
    }
    return s;
  }
}

class MinimaxAI extends AIStrategy {
  readonly name = "极小极大";
  private readonly maxDepth: number = 2;

  chooseMove(
    board: Board,
    player: Stone,
    size: number,
    winLength: number,
  ): Coord {
    const opponent = player === Stone.Black ? Stone.White : Stone.Black;
    const heuristic = new HeuristicAI();
    let bestScore = -Infinity;
    let bestMove: Coord | null = null;

    // Get top candidates by heuristic to limit search
    const candidates: Array<{ coord: Coord; score: number }> = [];
    for (const [x, y] of candidateMoves(board, 2)) {
      const off = (
        heuristic as unknown as {
          evaluatePoint: (
            b: Board,
            x: number,
            y: number,
            s: Stone,
            sz: number,
            w: number,
          ) => number;
        }
      ).evaluatePoint(board, x, y, player, size, winLength);
      const def = (
        heuristic as unknown as {
          evaluatePoint: (
            b: Board,
            x: number,
            y: number,
            s: Stone,
            sz: number,
            w: number,
          ) => number;
        }
      ).evaluatePoint(board, x, y, opponent, size, winLength);
      candidates.push({ coord: [x, y], score: off + def });
    }
    candidates.sort((a, b) => b.score - a.score);
    const topMoves = candidates.slice(0, 10);

    for (const { coord } of topMoves) {
      const [x, y] = coord;
      board[y]![x] = player;
      const score = this.minimax(
        board,
        false,
        player,
        opponent,
        size,
        winLength,
        1,
        -Infinity,
        Infinity,
      );
      board[y]![x] = Stone.Empty;
      if (score > bestScore) {
        bestScore = score;
        bestMove = coord;
      }
    }

    if (bestMove === null) {
      return heuristic.chooseMove(board, player, size, winLength);
    }
    return bestMove;
  }

  private minimax(
    board: Board,
    isMax: boolean,
    aiPlayer: Stone,
    currentPlayer: Stone,
    size: number,
    winLength: number,
    depth: number,
    alpha: number,
    beta: number,
  ): number {
    const opponent = aiPlayer === Stone.Black ? Stone.White : Stone.Black;

    // Check for wins
    for (const [x, y] of iterateBoard(size)) {
      if (board[y]![x] !== Stone.Empty) {
        const winLine = checkWin(board, x, y, board[y]![x]!, size, winLength);
        if (winLine) {
          if (board[y]![x] === aiPlayer) return 10000 - depth;
          return -10000 + depth;
        }
      }
    }

    if (depth >= this.maxDepth) return 0;

    const heuristic = new HeuristicAI();
    const candidates = [...candidateMoves(board, 1)].slice(0, 6);

    if (candidates.length === 0) return 0;

    const nextPlayer =
      currentPlayer === Stone.Black ? Stone.White : Stone.Black;

    if (isMax) {
      let best = -Infinity;
      for (const [x, y] of candidates) {
        board[y]![x] = currentPlayer;
        const score = this.minimax(
          board,
          false,
          aiPlayer,
          nextPlayer,
          size,
          winLength,
          depth + 1,
          alpha,
          beta,
        );
        board[y]![x] = Stone.Empty;
        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const [x, y] of candidates) {
        board[y]![x] = currentPlayer;
        const score = this.minimax(
          board,
          true,
          aiPlayer,
          nextPlayer,
          size,
          winLength,
          depth + 1,
          alpha,
          beta,
        );
        board[y]![x] = Stone.Empty;
        best = Math.min(best, score);
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return best;
    }
  }
}

const AI_STRATEGIES: Record<AILevel, AIStrategy> = {
  [AILevel.Easy]: new RandomAI(),
  [AILevel.Medium]: new HeuristicAI(),
  [AILevel.Hard]: new MinimaxAI(),
} as const satisfies Record<AILevel, AIStrategy>;

// ============================================================
// 9. 胜负检测
// ============================================================

function checkWin(
  board: Board,
  x: number,
  y: number,
  stone: Stone,
  size: number,
  winLength: number,
): readonly Coord[] | null {
  for (const [dx, dy] of DIRECTIONS) {
    const line: Coord[] = [[x, y]];
    // Forward
    let nx = x + dx;
    let ny = y + dy;
    while (
      nx >= 0 &&
      nx < size &&
      ny >= 0 &&
      ny < size &&
      board[ny]![nx] === stone
    ) {
      line.push([nx, ny]);
      nx += dx;
      ny += dy;
    }
    // Backward
    nx = x - dx;
    ny = y - dy;
    while (
      nx >= 0 &&
      nx < size &&
      ny >= 0 &&
      ny < size &&
      board[ny]![nx] === stone
    ) {
      line.unshift([nx, ny]);
      nx -= dx;
      ny -= dy;
    }
    if (line.length >= winLength) return line;
  }
  return null;
}

function isBoardFull(board: Board, size: number): boolean {
  for (const [x, y] of iterateBoard(size)) {
    if (board[y]![x] === Stone.Empty) return false;
  }
  return true;
}

// ============================================================
// 10. 坐标转换
// ============================================================

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRS".split("");

function parseCoord(input: string, size: number): Coord | null {
  const s = input.trim().toUpperCase();
  if (s.length < 2) return null;
  const colCh = s[0]!;
  const rowStr = s.slice(1);
  const x = COL_LETTERS.indexOf(colCh);
  const y = parseInt(rowStr, 10) - 1;
  if (x < 0 || x >= size) return null;
  if (Number.isNaN(y) || y < 0 || y >= size) return null;
  return [x, y];
}

function coordLabel(x: number, y: number): string {
  return `${COL_LETTERS[x]}${y + 1}`;
}

// ============================================================
// 11. 游戏引擎
// ============================================================

class GameEvents extends EventEmitter<EventMap> {}

class GomokuGame {
  private board: Board;
  private phase: GamePhase = GamePhase.Menu;
  private currentStone: Stone = Stone.Black;
  private result: GameResult = { winner: null, winLine: null };
  private readonly history: Move[] = [];
  private readonly redoStack: Move[] = [];
  private readonly events = new GameEvents();
  private readonly stats: GameStats;
  private statusMsg: string = "";
  private moveCount: number = 0;

  constructor(
    readonly mode: GameMode,
    readonly size: number,
    readonly winLength: number,
    readonly aiLevel: AILevel,
  ) {
    this.board = [];
    for (let y = 0; y < size; y++) {
      this.board.push(new Array<Stone>(size).fill(Stone.Empty));
    }
    this.stats = loadStats();
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }
  get current(): Stone {
    return this.currentStone;
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
  get moveHistory(): readonly Move[] {
    return this.history;
  }
  get totalMoves(): number {
    return this.moveCount;
  }
  get canUndo(): boolean {
    return this.history.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
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

  makeMove(x: number, y: number): boolean {
    if (this.phase !== GamePhase.Playing) return false;
    if (x < 0 || x >= this.size || y < 0 || y >= this.size)
      throw new InvalidCoordError(coordLabel(x, y));
    if (this.board[y]![x] !== Stone.Empty) throw new CellOccupiedError(x, y);

    this.moveCount++;
    const move: Move = {
      x,
      y,
      stone: this.currentStone,
      moveNumber: this.moveCount,
    };
    this.board[y]![x] = this.currentStone;
    this.history.push(move);
    this.redoStack.length = 0;
    this.events.emit("move", {
      pos: [x, y],
      stone: this.currentStone,
      moveNum: this.moveCount,
    });
    this.statusMsg = "";

    const winLine = checkWin(
      this.board,
      x,
      y,
      this.currentStone,
      this.size,
      this.winLength,
    );
    if (winLine) {
      this.result = { winner: this.currentStone, winLine };
      this.transition(GamePhase.Won);
      this.events.emit("gameEnd", { result: this.result });
      this.saveStats(this.result);
      return true;
    }

    if (isBoardFull(this.board, this.size)) {
      this.result = { winner: "draw", winLine: null };
      this.transition(GamePhase.Draw);
      this.events.emit("gameEnd", { result: this.result });
      this.saveStats(this.result);
      return true;
    }

    this.currentStone =
      this.currentStone === Stone.Black ? Stone.White : Stone.Black;
    return true;
  }

  undo(): boolean {
    if (this.history.length === 0) {
      this.statusMsg = "无棋可悔";
      return false;
    }

    const steps =
      this.mode === GameMode.PvAI && this.history.length >= 2 ? 2 : 1;
    for (let i = 0; i < steps && this.history.length > 0; i++) {
      const last = this.history.pop()!;
      this.board[last.y]![last.x] = Stone.Empty;
      this.currentStone = last.stone;
      this.moveCount--;
      this.redoStack.push(last);
    }
    this.result = { winner: null, winLine: null };
    if (this.phase !== GamePhase.Playing) this.transition(GamePhase.Playing);
    this.events.emit("undo", { moveNum: this.moveCount });
    this.statusMsg = "已悔棋";
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) {
      this.statusMsg = "无棋可前";
      return false;
    }
    const steps =
      this.mode === GameMode.PvAI && this.redoStack.length >= 2 ? 2 : 1;
    for (let i = 0; i < steps && this.redoStack.length > 0; i++) {
      const move = this.redoStack.pop()!;
      this.board[move.y]![move.x] = move.stone;
      this.currentStone =
        move.stone === Stone.Black ? Stone.White : Stone.Black;
      this.moveCount++;
      this.history.push(move);
    }
    this.statusMsg = "已重做";
    return true;
  }

  aiMove(): boolean {
    if (this.phase !== GamePhase.Playing) return false;
    const strategy = AI_STRATEGIES[this.aiLevel];
    const [x, y] = strategy.chooseMove(
      this.board,
      this.currentStone,
      this.size,
      this.winLength,
    );
    return this.makeMove(x, y);
  }

  isCurrentPlayerAI(): boolean {
    if (this.mode === GameMode.PvP) return false;
    if (this.mode === GameMode.AIvAI) return true;
    // PvAI: AI is White
    return this.currentStone === Stone.White;
  }

  reset(): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        this.board[y]![x] = Stone.Empty;
      }
    }
    this.currentStone = Stone.Black;
    this.result = { winner: null, winLine: null };
    this.statusMsg = "";
    this.history.length = 0;
    this.redoStack.length = 0;
    this.moveCount = 0;
    this.transition(GamePhase.Playing);
  }

  private saveStats(result: GameResult): void {
    const s = this.stats as Mutable<GameStats>;
    s.gamesPlayed++;
    if (result.winner === Stone.Black) s.blackWins++;
    else if (result.winner === Stone.White) s.whiteWins++;
    else if (result.winner === "draw") s.draws++;
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
    const fmtStone = (s: Stone): string => {
      if (s === Stone.Black) return c("● 黑", Color.Red);
      if (s === Stone.White) return c("○ 白", Color.Green);
      return "";
    };

    lines.push(c("===== 文字版五子棋 =====", Color.Cyan));
    lines.push(
      `模式: ${this.mode}  当前: ${fmtStone(this.currentStone)}  棋盘: ${this.size}x${this.size}  步数: ${this.moveCount}`,
    );

    // Column header
    let header = "   ";
    for (let x = 0; x < this.size; x++) header += COL_LETTERS[x] + " ";
    lines.push(c(header, Color.Gray));

    const winSet = new Set<string>();
    if (this.result.winLine) {
      for (const [x, y] of this.result.winLine) winSet.add(`${x},${y}`);
    }

    for (let y = 0; y < this.size; y++) {
      let rowStr = c(`${(y + 1).toString().padStart(2, " ")} `, Color.Gray);
      for (let x = 0; x < this.size; x++) {
        const v = this.board[y]![x]!;
        if (v === Stone.Empty) {
          rowStr += c("+", Color.Gray) + " ";
        } else if (winSet.has(`${x},${y}`)) {
          rowStr += c(v === Stone.Black ? "●" : "○", Color.Yellow) + " ";
        } else if (v === Stone.Black) {
          rowStr += c("●", Color.Red) + " ";
        } else {
          rowStr += c("○", Color.Green) + " ";
        }
      }
      lines.push(rowStr);
    }

    lines.push("");
    if (this.phase === GamePhase.Won) {
      lines.push(
        c(
          `${this.result.winner === Stone.Black ? "黑" : "白"} 胜利!`,
          Color.Yellow,
        ),
      );
    } else if (this.phase === GamePhase.Draw) {
      lines.push(c("平局!", Color.Yellow));
    } else if (this.mode === GameMode.AIvAI) {
      lines.push(c("[AI vs AI] 按回车执行下一步", Color.Cyan));
    }

    if (this.phase === GamePhase.Playing) {
      lines.push(
        c(
          "输入坐标 (如 H8) 落子  u 悔棋  y 重做  r 重新开始  m 返回菜单  q 退出",
          Color.Cyan,
        ),
      );
    } else {
      lines.push(c("r 重新开始  m 返回菜单  q 退出", Color.Cyan));
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
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<GameStats>;
      return {
        gamesPlayed: data.gamesPlayed ?? 0,
        blackWins: data.blackWins ?? 0,
        whiteWins: data.whiteWins ?? 0,
        draws: data.draws ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { gamesPlayed: 0, blackWins: 0, whiteWins: 0, draws: 0 };
}

// ============================================================
// 13. 命令解析
// ============================================================

function parseCommand(line: string, boardSize: number): ParsedCommand {
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

  const coord = parseCoord(input, boardSize);
  if (coord) {
    return { action: "move", x: coord[0], y: coord[1] };
  }

  return { action: "unknown", input: line };
}

// ============================================================
// 14. 符号
// ============================================================

const SYM_SESSION = Symbol("session");

interface GameSession {
  [SYM_SESSION]: boolean;
  readonly game: GomokuGame;
}

function createSession(
  mode: GameMode,
  size: number,
  level: AILevel,
): GameSession {
  const cfg = BOARD_PRESETS[size] ?? BOARD_PRESETS[15];
  const game = new GomokuGame(mode, cfg.size, cfg.winLength, level);
  game.start();
  return { [SYM_SESSION]: true, game };
}

// ============================================================
// 15. 主程序
// ============================================================

function showMenu(): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 文字版五子棋 =====" + ANSI.RESET);
  console.log("请选择模式:");
  console.log("  1 / pvp  - 玩家 vs 玩家");
  console.log("  2 / pvc  - 玩家(黑) vs AI(白)");
  console.log("  3 / cvc  - AI vs AI 演示");
  console.log("  s        - 查看统计");
  console.log("  q        - 退出");
}

function showAILevelMenu(): void {
  console.log("\n选择 AI 难度:");
  console.log("  1 / easy   - 简单 (随机)");
  console.log("  2 / medium - 中等 (启发式)");
  console.log("  3 / hard   - 困难 (极小极大)");
}

function showBoardSizeMenu(): void {
  console.log("\n选择棋盘大小:");
  console.log("  9  - 9x9");
  console.log("  13 - 13x13");
  console.log("  15 - 15x15");
  console.log("  19 - 19x19");
}

function showStats(stats: Readonly<GameStats>): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 统计 =====" + ANSI.RESET);
  console.log(`  游戏次数: ${stats.gamesPlayed}`);
  console.log(`  黑胜: ${stats.blackWins}`);
  console.log(`  白胜: ${stats.whiteWins}`);
  console.log(`  平局: ${stats.draws}`);
}

type MenuState = "menu" | "difficulty" | "boardsize" | "playing";

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let session: GameSession | null = null;
  let menuState: MenuState = "menu";
  let pendingMode: GameMode = GameMode.PvP;
  let pendingLevel: AILevel = AILevel.Medium;
  let pendingSize: number = 15;

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

    if (menuState === "menu") {
      if (input === "1" || input === "pvp") {
        showBoardSizeMenu();
        menuState = "boardsize";
        pendingMode = GameMode.PvP;
        rl.setPrompt("棋盘> ");
      } else if (input === "2" || input === "pvc") {
        showAILevelMenu();
        menuState = "difficulty";
        pendingMode = GameMode.PvAI;
        rl.setPrompt("AI难度> ");
      } else if (input === "3" || input === "cvc") {
        showAILevelMenu();
        menuState = "difficulty";
        pendingMode = GameMode.AIvAI;
        rl.setPrompt("AI难度> ");
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

    if (menuState === "difficulty") {
      if (input === "1" || input === "easy") pendingLevel = AILevel.Easy;
      else if (input === "2" || input === "medium")
        pendingLevel = AILevel.Medium;
      else if (input === "3" || input === "hard") pendingLevel = AILevel.Hard;
      else {
        console.log(ANSI.RED + "无效输入, 默认中等" + ANSI.RESET);
        pendingLevel = AILevel.Medium;
      }
      showBoardSizeMenu();
      menuState = "boardsize";
      rl.setPrompt("棋盘> ");
      rl.prompt();
      return;
    }

    if (menuState === "boardsize") {
      const size = parseInt(input, 10);
      if (!Number.isNaN(size) && [9, 13, 15, 19].includes(size)) {
        pendingSize = size;
      } else {
        console.log(ANSI.RED + "无效输入, 默认 15x15" + ANSI.RESET);
        pendingSize = 15;
      }
      session = createSession(pendingMode, pendingSize, pendingLevel);
      menuState = "playing";
      refresh();
      rl.setPrompt(pendingMode === GameMode.AIvAI ? "回车继续> " : "落子> ");
      rl.prompt();
      return;
    }

    if (!session) return;

    const cmd = parseCommand(line, session.game.size);

    switch (cmd.action) {
      case "quit":
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
        break;
      case "menu":
        menuState = "menu";
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
            session.game.makeMove(cmd.x, cmd.y);
          } catch (e) {
            if (e instanceof GomokuError)
              console.log(ANSI.RED + e.message + ANSI.RESET);
          }
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
        break;
      case "redo":
        session.game.redo();
        break;
      case "stats":
        showStats(session.game.getStatistics());
        break;
      case "help":
        console.log("\n帮助:");
        console.log("  <坐标>   落子, 如 H8");
        console.log("  u        悔棋");
        console.log("  y        重做");
        console.log("  r        重新开始");
        console.log("  m        返回菜单");
        console.log("  s        查看统计");
        console.log("  q        退出");
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
