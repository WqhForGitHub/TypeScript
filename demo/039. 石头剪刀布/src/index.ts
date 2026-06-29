#!/usr/bin/env node
/**
 * 石头剪刀布 (Rock Paper Scissors) — Enhanced Edition
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

enum Move {
  Rock = "rock",
  Paper = "paper",
  Scissors = "scissors",
  Lizard = "lizard",
  Spock = "spock",
}
enum GamePhase {
  Menu = "menu",
  Playing = "playing",
  Over = "over",
}
enum Color {
  Red = "red",
  Green = "green",
  Yellow = "yellow",
  Cyan = "cyan",
  Gray = "gray",
}
enum StrategyName {
  Random = "random",
  Frequency = "frequency",
  Pattern = "pattern",
  Mirror = "mirror",
  CounterMirror = "counter-mirror",
}

type ColorCode = (typeof ANSI)[keyof typeof ANSI];

const COLOR_MAP: Record<Color, ColorCode> = {
  [Color.Red]: ANSI.RED,
  [Color.Green]: ANSI.GREEN,
  [Color.Yellow]: ANSI.YELLOW,
  [Color.Cyan]: ANSI.CYAN,
  [Color.Gray]: ANSI.GRAY,
} as const satisfies Record<Color, ColorCode>;

const MOVE_CN: Record<Move, string> = {
  [Move.Rock]: "石头",
  [Move.Paper]: "布",
  [Move.Scissors]: "剪刀",
  [Move.Lizard]: "蜥蜴",
  [Move.Spock]: "斯波克",
} as const satisfies Record<Move, string>;

const MOVE_ICON: Record<Move, string> = {
  [Move.Rock]: "✊",
  [Move.Paper]: "✋",
  [Move.Scissors]: "✌",
  [Move.Lizard]: "🦎",
  [Move.Spock]: "🖖",
} as const satisfies Record<Move, string>;

// Win rules: key beats each value in the array
const WIN_RULES: Record<Move, readonly Move[]> = {
  [Move.Rock]: [Move.Scissors, Move.Lizard],
  [Move.Paper]: [Move.Rock, Move.Spock],
  [Move.Scissors]: [Move.Paper, Move.Lizard],
  [Move.Lizard]: [Move.Paper, Move.Spock],
  [Move.Spock]: [Move.Rock, Move.Scissors],
} as const satisfies Record<Move, readonly Move[]>;

const ALL_MOVES: readonly Move[] = Object.values(Move) as readonly Move[];
const CLASSIC_MOVES: readonly Move[] = [Move.Rock, Move.Paper, Move.Scissors];

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".rps_data.json",
);

// ============================================================
// 2. 接口与类型
// ============================================================

interface RoundResult {
  readonly player: Move;
  readonly ai: Move;
  readonly outcome: Outcome;
  readonly strategy: StrategyName;
  readonly timestamp: number;
}

type Outcome = "win" | "lose" | "draw";

interface PlayerData {
  playerName: string;
  totalRounds: number;
  wins: number;
  losses: number;
  draws: number;
  moveCount: Record<Move, number>;
  currentStreak: number;
  bestStreak: number;
  history: RoundResult[];
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface EventMap {
  round: {
    readonly player: Move;
    readonly ai: Move;
    readonly outcome: Outcome;
  };
  streak: { readonly streak: number };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
  gameOver: {
    readonly winner: "player" | "ai" | "draw";
    readonly score: readonly [number, number];
  };
}

type EventType = keyof EventMap;

type GameEvent =
  | { readonly type: "move"; readonly move: Move }
  | { readonly type: "undo" }
  | { readonly type: "quit" }
  | { readonly type: "restart" };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

type ParsedCommand =
  | {
      readonly action: "play";
      readonly strategy: StrategyName;
      readonly extended: boolean;
    }
  | {
      readonly action: "bestOf";
      readonly n: number;
      readonly strategy: StrategyName;
      readonly extended: boolean;
    }
  | { readonly action: "tournament" }
  | { readonly action: "stats" }
  | { readonly action: "history" }
  | { readonly action: "clear" }
  | { readonly action: "name"; readonly newName: string }
  | { readonly action: "help" }
  | { readonly action: "quit" }
  | { readonly action: "unknown"; readonly input: string };

// ============================================================
// 3. 自定义错误
// ============================================================

abstract class RpsError extends Error {
  abstract readonly code: string;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InvalidMoveError extends RpsError {
  readonly code = "INVALID_MOVE";
  constructor(input: string) {
    super(`无效出招: ${input}`);
  }
}

class GameStateError extends RpsError {
  readonly code = "GAME_STATE";
  constructor(msg: string) {
    super(msg);
  }
}

// ============================================================
// 4. 类型守卫
// ============================================================

function isMove(value: unknown): value is Move {
  return typeof value === "string" && ALL_MOVES.includes(value as Move);
}

function isStrategyName(value: unknown): value is StrategyName {
  return (
    typeof value === "string" &&
    Object.values(StrategyName).includes(value as StrategyName)
  );
}

// ============================================================
// 5. 泛型事件系统
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

// ============================================================
// 6. 生成器
// ============================================================

function* recentRounds(
  history: readonly RoundResult[],
  count: number,
): Generator<RoundResult> {
  const start = Math.max(0, history.length - count);
  for (let i = history.length - 1; i >= start; i--) {
    yield history[i]!;
  }
}

function* streakIterator(
  history: readonly RoundResult[],
): Generator<{ readonly streak: number; readonly outcome: Outcome }> {
  let current: Outcome | null = null;
  let count = 0;
  for (const r of history) {
    if (current !== null && r.outcome === current) {
      count++;
    } else {
      if (count > 0 && current) yield { streak: count, outcome: current };
      current = r.outcome === "draw" ? null : r.outcome;
      count = r.outcome === "draw" ? 0 : 1;
    }
  }
  if (count > 0 && current) yield { streak: count, outcome: current };
}

// ============================================================
// 7. 抽象 AI 策略
// ============================================================

abstract class AIStrategy {
  abstract readonly name: StrategyName;
  abstract readonly description: string;
  abstract decide(
    selfHistory: readonly Move[],
    opponentHistory: readonly Move[],
    availableMoves: readonly Move[],
  ): Move;
}

class RandomAI extends AIStrategy {
  readonly name = StrategyName.Random;
  readonly description = "完全随机";
  decide(
    _self: readonly Move[],
    _opp: readonly Move[],
    moves: readonly Move[],
  ): Move {
    return moves[Math.floor(Math.random() * moves.length)] ?? Move.Rock;
  }
}

class FrequencyAI extends AIStrategy {
  readonly name = StrategyName.Frequency;
  readonly description = "频率分析 - 反制最常出的招";
  decide(
    _self: readonly Move[],
    opp: readonly Move[],
    moves: readonly Move[],
  ): Move {
    if (opp.length === 0)
      return moves[Math.floor(Math.random() * moves.length)] ?? Move.Rock;
    const counts: Record<Move, number> = {
      rock: 0,
      paper: 0,
      scissors: 0,
      lizard: 0,
      spock: 0,
    };
    for (const m of opp) counts[m]++;
    let mostCommon: Move = Move.Rock;
    let max = -1;
    for (const m of moves) {
      if (counts[m] > max) {
        max = counts[m];
        mostCommon = m;
      }
    }
    return counter(mostCommon, moves);
  }
}

class PatternAI extends AIStrategy {
  readonly name = StrategyName.Pattern;
  readonly description = "模式识别 - 基于转移概率预测";
  decide(
    _self: readonly Move[],
    opp: readonly Move[],
    moves: readonly Move[],
  ): Move {
    if (opp.length < 3)
      return moves[Math.floor(Math.random() * moves.length)] ?? Move.Rock;
    const lastTwo = `${opp[opp.length - 2]},${opp[opp.length - 1]}`;
    const transitions: Move[] = [];
    for (let i = 0; i < opp.length - 2; i++) {
      const pair = `${opp[i]},${opp[i + 1]}`;
      if (pair === lastTwo) transitions.push(opp[i + 2]!);
    }
    if (transitions.length === 0)
      return moves[Math.floor(Math.random() * moves.length)] ?? Move.Rock;
    const counts: Record<Move, number> = {
      rock: 0,
      paper: 0,
      scissors: 0,
      lizard: 0,
      spock: 0,
    };
    for (const m of transitions) counts[m]++;
    let predicted: Move = Move.Rock;
    let max = -1;
    for (const m of moves) {
      if (counts[m] > max) {
        max = counts[m];
        predicted = m;
      }
    }
    return counter(predicted, moves);
  }
}

class MirrorAI extends AIStrategy {
  readonly name = StrategyName.Mirror;
  readonly description = "模仿玩家上一步";
  decide(
    _self: readonly Move[],
    opp: readonly Move[],
    _moves: readonly Move[],
  ): Move {
    if (opp.length === 0) return Move.Rock;
    return opp[opp.length - 1]!;
  }
}

class CounterMirrorAI extends AIStrategy {
  readonly name = StrategyName.CounterMirror;
  readonly description = "反制玩家上一步";
  decide(
    _self: readonly Move[],
    opp: readonly Move[],
    moves: readonly Move[],
  ): Move {
    if (opp.length === 0)
      return moves[Math.floor(Math.random() * moves.length)] ?? Move.Rock;
    return counter(opp[opp.length - 1]!, moves);
  }
}

const STRATEGIES: Record<StrategyName, AIStrategy> = {
  [StrategyName.Random]: new RandomAI(),
  [StrategyName.Frequency]: new FrequencyAI(),
  [StrategyName.Pattern]: new PatternAI(),
  [StrategyName.Mirror]: new MirrorAI(),
  [StrategyName.CounterMirror]: new CounterMirrorAI(),
} as const satisfies Record<StrategyName, AIStrategy>;

// ============================================================
// 8. 游戏逻辑
// ============================================================

function beats(a: Move, b: Move): boolean {
  return WIN_RULES[a].includes(b);
}

function counter(m: Move, availableMoves: readonly Move[]): Move {
  for (const candidate of availableMoves) {
    if (beats(candidate, m)) return candidate;
  }
  return availableMoves[0] ?? Move.Rock;
}

function getOutcome(player: Move, ai: Move): Outcome {
  if (player === ai) return "draw";
  return beats(player, ai) ? "win" : "lose";
}

// ============================================================
// 9. 游戏引擎
// ============================================================

class RpsEvents extends EventEmitter<EventMap> {}

class RpsGame {
  private phase: GamePhase = GamePhase.Menu;
  private readonly events = new RpsEvents();
  private playerScore: number = 0;
  private aiScore: number = 0;
  private draws: number = 0;
  private round: number = 0;
  private readonly playerHistory: Move[] = [];
  private readonly aiHistory: Move[] = [];
  private readonly data: PlayerData;

  constructor(
    readonly strategy: StrategyName,
    readonly extended: boolean,
    readonly bestOf: number,
    data: PlayerData,
  ) {
    this.data = data;
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }
  get playerWins(): number {
    return this.playerScore;
  }
  get aiWins(): number {
    return this.aiScore;
  }
  get drawCount(): number {
    return this.draws;
  }
  get roundNumber(): number {
    return this.round;
  }
  get targetWins(): number {
    return Math.floor(this.bestOf / 2) + 1;
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
    this.transition(GamePhase.Playing);
  }

  play(playerMove: Move): {
    player: Move;
    ai: Move;
    outcome: Outcome;
    gameOver: boolean;
  } {
    if (this.phase !== GamePhase.Playing)
      throw new GameStateError("游戏未在进行中");
    const moves = this.extended ? ALL_MOVES : CLASSIC_MOVES;
    const ai = STRATEGIES[this.strategy].decide(
      this.aiHistory,
      this.playerHistory,
      moves,
    );
    const outcome = getOutcome(playerMove, ai);

    this.round++;
    this.playerHistory.push(playerMove);
    this.aiHistory.push(ai);

    if (outcome === "win") {
      this.playerScore++;
      this.data.currentStreak =
        this.data.currentStreak > 0 ? this.data.currentStreak + 1 : 1;
      if (this.data.currentStreak > this.data.bestStreak)
        this.data.bestStreak = this.data.currentStreak;
      this.events.emit("streak", { streak: this.data.currentStreak });
    } else if (outcome === "lose") {
      this.aiScore++;
      this.data.currentStreak =
        this.data.currentStreak < 0 ? this.data.currentStreak - 1 : -1;
    } else {
      this.draws++;
    }

    this.data.totalRounds++;
    if (outcome === "win") this.data.wins++;
    else if (outcome === "lose") this.data.losses++;
    else this.data.draws++;
    this.data.moveCount[playerMove]++;
    this.data.history.push({
      player: playerMove,
      ai,
      outcome,
      strategy: this.strategy,
      timestamp: Date.now(),
    });
    if (this.data.history.length > 500)
      this.data.history = this.data.history.slice(-500);
    saveData(this.data);

    this.events.emit("round", { player: playerMove, ai, outcome });

    let gameOver = false;
    if (
      this.playerScore >= this.targetWins ||
      this.aiScore >= this.targetWins
    ) {
      gameOver = true;
      this.transition(GamePhase.Over);
      const winner = this.playerScore > this.aiScore ? "player" : "ai";
      this.events.emit("gameOver", {
        winner,
        score: [this.playerScore, this.aiScore],
      });
    }

    return { player: playerMove, ai, outcome, gameOver };
  }
}

// ============================================================
// 10. 数据持久化
// ============================================================

function loadData(): PlayerData {
  const empty: PlayerData = {
    playerName: "Player",
    totalRounds: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    moveCount: { rock: 0, paper: 0, scissors: 0, lizard: 0, spock: 0 },
    currentStreak: 0,
    bestStreak: 0,
    history: [],
  };
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<PlayerData>;
      return {
        ...empty,
        ...d,
        moveCount: { ...empty.moveCount, ...(d.moveCount ?? {}) },
      };
    }
  } catch {
    /* ignore */
  }
  return empty;
}

function saveData(data: PlayerData): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

// ============================================================
// 11. 命令解析
// ============================================================

const SYM_SESSION = Symbol("session");

interface GameSession {
  [SYM_SESSION]: boolean;
  readonly game: RpsGame;
  readonly extended: boolean;
}

function parseCommand(line: string): ParsedCommand {
  const parts = line.trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();

  if (cmd === "q" || cmd === "quit") return { action: "quit" };
  if (cmd === "h" || cmd === "help" || cmd === "?") return { action: "help" };
  if (cmd === "s" || cmd === "stats") return { action: "stats" };
  if (cmd === "history") return { action: "history" };
  if (cmd === "clear") return { action: "clear" };
  if (cmd === "name")
    return { action: "name", newName: parts.slice(1).join(" ").trim() };
  if (cmd === "tournament") return { action: "tournament" };

  if (cmd === "play" || cmd === "best-of" || cmd === "bo") {
    const isBestOf = cmd !== "play";
    let idx = 1;
    let n = 1;
    if (isBestOf) {
      n = parseInt(parts[idx] ?? "5", 10) || 5;
      idx++;
    }
    let strategy = StrategyName.Random;
    let extended = false;
    for (let i = idx; i < parts.length; i++) {
      const p = parts[i]!.toLowerCase();
      if (isStrategyName(p)) strategy = p as StrategyName;
      else if (p === "extended" || p === "ext") extended = true;
    }
    return isBestOf
      ? { action: "bestOf", n, strategy, extended }
      : { action: "play", strategy, extended };
  }

  return { action: "unknown", input: line };
}

// ============================================================
// 12. 显示
// ============================================================

function colorize(text: string, color: Color): string {
  return `${COLOR_MAP[color]}${text}${ANSI.RESET}`;
}

function showMenu(data: PlayerData): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(colorize("===== 石头剪刀布 =====", Color.Cyan));
  console.log(
    `玩家: ${data.playerName}  场次: ${data.totalRounds}  胜: ${data.wins}  负: ${data.losses}  平: ${data.draws}  最佳连胜: ${data.bestStreak}`,
  );
  console.log("");
  console.log("命令:");
  console.log("  play [strategy] [extended]       单局对战");
  console.log("  best-of <n> [strategy] [ext]     N局多胜制");
  console.log("  tournament                       AI策略循环赛");
  console.log("  stats                            查看统计");
  console.log("  history                          查看历史");
  console.log("  name <新名字>                    修改玩家名");
  console.log("  clear                            清空数据");
  console.log("  quit                             退出");
  console.log("");
  console.log("策略: random / frequency / pattern / mirror / counter-mirror");
  console.log("出招: r(ock) p(aper) s(cissors) [l(izard) v(spock)]");
  console.log("extended 模式: 石头剪刀布蜥蜴斯波克");
}

function showStats(data: PlayerData): void {
  console.log(colorize("\n===== 个人统计 =====", Color.Cyan));
  console.log(`玩家: ${data.playerName}`);
  console.log(
    `总场次: ${data.totalRounds}  胜: ${data.wins}  负: ${data.losses}  平: ${data.draws}`,
  );
  const winRate =
    data.totalRounds > 0
      ? ((data.wins / data.totalRounds) * 100).toFixed(1)
      : "0.0";
  console.log(
    `胜率: ${winRate}%  当前连胜: ${data.currentStreak}  最佳连胜: ${data.bestStreak}`,
  );
  console.log("出招分布:");
  const total = Object.values(data.moveCount).reduce((a, b) => a + b, 0);
  for (const m of ALL_MOVES) {
    const pct =
      total > 0 ? ((data.moveCount[m] / total) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${MOVE_CN[m]} ${MOVE_ICON[m]}: ${data.moveCount[m]} (${pct}%)`,
    );
  }
}

function showHistory(data: PlayerData): void {
  console.log(colorize("\n===== 最近 10 场 =====", Color.Cyan));
  let count = 0;
  for (const r of recentRounds(data.history, 10)) {
    const date = new Date(r.timestamp).toLocaleString();
    const outcomeStr =
      r.outcome === "win"
        ? colorize("胜", Color.Green)
        : r.outcome === "lose"
          ? colorize("负", Color.Red)
          : colorize("平", Color.Yellow);
    console.log(
      `  你: ${MOVE_CN[r.player]}${MOVE_ICON[r.player]}  AI(${r.strategy}): ${MOVE_CN[r.ai]}${MOVE_ICON[r.ai]}  -> ${outcomeStr}  ${colorize(date, Color.Gray)}`,
    );
    count++;
  }
  if (count === 0) console.log(colorize("  (暂无记录)", Color.Gray));
}

// ============================================================
// 13. AI 锦标赛
// ============================================================

function runTournament(): void {
  const names = Object.values(StrategyName);
  console.log(colorize("\n===== AI 策略循环赛 =====", Color.Cyan));
  console.log(`参赛: ${names.join(", ")}`);
  console.log("每对策略对战 30 局\n");

  const scores: Record<
    string,
    { wins: number; losses: number; draws: number }
  > = {};
  for (const n of names) scores[n] = { wins: 0, losses: 0, draws: 0 };

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const aHist: Move[] = [];
      const bHist: Move[] = [];
      let aWins = 0,
        bWins = 0,
        draws = 0;
      for (let k = 0; k < 30; k++) {
        const moveA = STRATEGIES[a].decide(aHist, bHist, CLASSIC_MOVES);
        const moveB = STRATEGIES[b].decide(bHist, aHist, CLASSIC_MOVES);
        aHist.push(moveA);
        bHist.push(moveB);
        if (beats(moveA, moveB)) aWins++;
        else if (beats(moveB, moveA)) bWins++;
        else draws++;
      }
      scores[a].wins += aWins;
      scores[a].losses += bWins;
      scores[a].draws += draws;
      scores[b].wins += bWins;
      scores[b].losses += aWins;
      scores[b].draws += draws;
      console.log(
        `  ${a.padEnd(15)} vs ${b.padEnd(15)} -> ${aWins}:${bWins} (平${draws})`,
      );
    }
  }

  console.log(colorize("\n===== 总排名 =====", Color.Cyan));
  const ranking = names
    .map((n) => ({
      name: n,
      wins: scores[n].wins,
      losses: scores[n].losses,
      draws: scores[n].draws,
      points: scores[n].wins - scores[n].losses,
    }))
    .sort((x, y) => y.points - x.points);
  ranking.forEach((r, i) => {
    console.log(
      `  ${i + 1}. ${r.name.padEnd(15)} ${r.wins}W ${r.losses}L ${r.draws}D (净胜${r.points})`,
    );
  });
}

// ============================================================
// 14. 主程序
// ============================================================

function main(): void {
  const data = loadData();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let session: GameSession | null = null;

  const refreshMenu = (): void => {
    showMenu(data);
    rl.setPrompt("> ");
    rl.prompt();
  };

  refreshMenu();

  rl.on("line", (line: string) => {
    if (session) {
      // In-game: parse move
      const input = line.trim().toLowerCase();
      if (input === "q" || input === "quit") {
        session = null;
        refreshMenu();
        return;
      }
      const moveMap: Record<string, Move> = {
        r: Move.Rock,
        rock: Move.Rock,
        p: Move.Paper,
        paper: Move.Paper,
        s: Move.Scissors,
        scissors: Move.Scissors,
        l: Move.Lizard,
        lizard: Move.Lizard,
        v: Move.Spock,
        spock: Move.Spock,
      };
      const playerMove = moveMap[input];
      if (!playerMove) {
        console.log(colorize("无效出招", Color.Red));
        rl.prompt();
        return;
      }
      if (!session.extended && !CLASSIC_MOVES.includes(playerMove)) {
        console.log(colorize("当前为经典模式, 仅支持 r/p/s", Color.Red));
        rl.prompt();
        return;
      }
      try {
        const result = session.game.play(playerMove);
        const outcomeStr =
          result.outcome === "win"
            ? colorize("你赢!", Color.Green)
            : result.outcome === "lose"
              ? colorize("AI赢!", Color.Red)
              : colorize("平局", Color.Yellow);
        console.log(
          `  你: ${MOVE_CN[result.player]}${MOVE_ICON[result.player]}  AI: ${MOVE_CN[result.ai]}${MOVE_ICON[result.ai]}  -> ${outcomeStr}`,
        );
        console.log(
          `  比分: 你 ${session.game.playerWins} : ${session.game.aiWins} AI (平 ${session.game.drawCount})`,
        );
        if (result.gameOver) {
          const winner =
            session.game.playerWins > session.game.aiWins
              ? "你赢了系列赛!"
              : "AI 赢了系列赛!";
          console.log(colorize(`\n===== ${winner} =====\n`, Color.Yellow));
          session = null;
          refreshMenu();
          return;
        }
      } catch (e) {
        if (e instanceof RpsError) console.log(colorize(e.message, Color.Red));
      }
      rl.prompt();
      return;
    }

    // Menu mode
    const cmd = parseCommand(line);
    switch (cmd.action) {
      case "quit":
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      case "play":
      case "bestOf": {
        const bestOf = cmd.action === "bestOf" ? cmd.n : 5;
        const game = new RpsGame(cmd.strategy, cmd.extended, bestOf, data);
        game.start();
        session = { [SYM_SESSION]: true, game, extended: cmd.extended };
        const moves = cmd.extended ? "r/p/s/l/v" : "r/p/s";
        console.log(
          colorize(
            `\n===== ${cmd.extended ? "扩展" : "经典"}模式 (策略: ${cmd.strategy}, Best of ${bestOf}) =====`,
            Color.Cyan,
          ),
        );
        console.log(`出招: ${moves}  (q 退出)\n`);
        rl.setPrompt("出招> ");
        break;
      }
      case "tournament":
        runTournament();
        rl.prompt();
        break;
      case "stats":
        showStats(data);
        rl.prompt();
        break;
      case "history":
        showHistory(data);
        rl.prompt();
        break;
      case "name":
        if (cmd.newName) {
          data.playerName = cmd.newName;
          saveData(data);
          console.log(colorize(`玩家名已更新: ${cmd.newName}`, Color.Green));
        } else {
          console.log(colorize("请提供新名字", Color.Red));
        }
        rl.prompt();
        break;
      case "clear":
        data.totalRounds = 0;
        data.wins = 0;
        data.losses = 0;
        data.draws = 0;
        data.moveCount = {
          rock: 0,
          paper: 0,
          scissors: 0,
          lizard: 0,
          spock: 0,
        };
        data.currentStreak = 0;
        data.bestStreak = 0;
        data.history = [];
        saveData(data);
        console.log(colorize("已清空数据", Color.Green));
        rl.prompt();
        break;
      case "help":
        console.log(
          "\n命令: play [strategy] [extended]  best-of <n>  tournament  stats  history  name <名字>  clear  quit",
        );
        rl.prompt();
        break;
      default:
        if (line.trim() === "") {
          rl.prompt();
          return;
        }
        console.log(colorize(`未知命令: ${line.trim()}`, Color.Red));
        rl.prompt();
    }
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
