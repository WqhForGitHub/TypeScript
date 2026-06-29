#!/usr/bin/env node
/**
 * 数字猜谜游戏 (Number Guessing Game) — Enhanced Edition
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
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
} as const;

enum Difficulty {
  Easy = "easy",
  Medium = "medium",
  Hard = "hard",
  Insane = "insane",
}
enum GamePhase {
  Menu = "menu",
  Playing = "playing",
  Won = "won",
  Lost = "lost",
}
enum HintType {
  Range = "range",
  HotCold = "hotcold",
  Divisible = "divisible",
  Parity = "parity",
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
} as const satisfies Record<Color, ColorCode>;

interface DifficultyConfig {
  readonly upper: number;
  readonly coefficient: number;
  readonly maxAttempts: number;
  readonly label: string;
  readonly hintsAllowed: readonly HintType[];
}

const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  [Difficulty.Easy]: {
    upper: 50,
    coefficient: 1,
    maxAttempts: 10,
    label: "简单",
    hintsAllowed: [HintType.Range, HintType.HotCold],
  },
  [Difficulty.Medium]: {
    upper: 100,
    coefficient: 2,
    maxAttempts: 8,
    label: "中等",
    hintsAllowed: [HintType.Range, HintType.HotCold, HintType.Parity],
  },
  [Difficulty.Hard]: {
    upper: 500,
    coefficient: 5,
    maxAttempts: 12,
    label: "困难",
    hintsAllowed: [HintType.Range, HintType.Divisible, HintType.Parity],
  },
  [Difficulty.Insane]: {
    upper: 1000,
    coefficient: 10,
    maxAttempts: 15,
    label: "疯狂",
    hintsAllowed: [HintType.Divisible, HintType.Parity],
  },
} as const satisfies Record<Difficulty, DifficultyConfig>;

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".number_guess_data.json",
);

// ============================================================
// 2. 接口与类型
// ============================================================

interface GameRecord {
  readonly difficulty: Difficulty;
  readonly attempts: number;
  readonly score: number;
  readonly timestamp: number;
  readonly won: boolean;
}

interface PlayerData {
  playerName: string;
  totalGames: number;
  totalWins: number;
  bestScore: number;
  currentStreak: number;
  bestStreak: number;
  bestAttempts: Partial<Record<Difficulty, number>>;
  records: GameRecord[];
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface EventMap {
  guess: {
    readonly value: number;
    readonly attempts: number;
    readonly hint: string;
  };
  win: {
    readonly target: number;
    readonly attempts: number;
    readonly score: number;
  };
  lose: { readonly target: number; readonly attempts: number };
  hint: { readonly type: HintType; readonly text: string };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
}

type EventType = keyof EventMap;

type GameEvent =
  | { readonly type: "guess"; readonly value: number }
  | { readonly type: "hint"; readonly hintType: HintType }
  | { readonly type: "give" }
  | { readonly type: "quit" };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

type ParsedCommand =
  | { readonly action: "guess"; readonly value: number }
  | { readonly action: "hint" }
  | { readonly action: "give" }
  | { readonly action: "quit" }
  | { readonly action: "unknown"; readonly input: string };

// ============================================================
// 3. 自定义错误
// ============================================================

abstract class GameError extends Error {
  abstract readonly code: string;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InvalidGuessError extends GameError {
  readonly code = "INVALID_GUESS";
  constructor(value: number, upper: number) {
    super(`请输入 1 到 ${upper} 之间的数字, 得到: ${value}`);
  }
}

class NoHintsLeftError extends GameError {
  readonly code = "NO_HINTS";
  constructor() {
    super("已无可用提示次数");
  }
}

// ============================================================
// 4. 类型守卫
// ============================================================

function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === "string" &&
    Object.values(Difficulty).includes(value as Difficulty)
  );
}

function isHintType(value: unknown): value is HintType {
  return (
    typeof value === "string" &&
    Object.values(HintType).includes(value as HintType)
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

function* iterateRecords(
  records: readonly GameRecord[],
): Generator<GameRecord> {
  for (const r of records) yield r;
}

function* recentRecords(
  records: readonly GameRecord[],
  count: number,
): Generator<GameRecord> {
  const start = Math.max(0, records.length - count);
  for (let i = records.length - 1; i >= start; i--) {
    yield records[i]!;
  }
}

// ============================================================
// 7. 抽象提示策略
// ============================================================

abstract class HintStrategy {
  abstract readonly type: HintType;
  abstract generate(
    target: number,
    upper: number,
    lastGuess: number | null,
  ): string;
}

class RangeHint extends HintStrategy {
  readonly type = HintType.Range;
  generate(_target: number, _upper: number, lastGuess: number | null): string {
    if (lastGuess === null) return "还没有猜过, 无法给出范围提示";
    if (lastGuess < _target) return `目标数字 > ${lastGuess}`;
    return `目标数字 < ${lastGuess}`;
  }
}

class HotColdHint extends HintStrategy {
  readonly type = HintType.HotCold;
  generate(target: number, _upper: number, lastGuess: number | null): string {
    if (lastGuess === null) return "还没有猜过, 无法判断冷热";
    const diff = Math.abs(target - lastGuess);
    if (diff === 0) return "正中靶心!";
    if (diff <= 5) return "🔥 极热!";
    if (diff <= 15) return "🌡️ 热";
    if (diff <= 30) return "❄️ 冷";
    return "🧊 极冷";
  }
}

class DivisibleHint extends HintStrategy {
  readonly type = HintType.Divisible;
  generate(target: number, _upper: number, _lastGuess: number | null): string {
    const divisors: number[] = [];
    for (const d of [2, 3, 5, 7]) {
      if (target % d === 0) divisors.push(d);
    }
    if (divisors.length === 0) return "目标数字是质数";
    return `目标数字能被 ${divisors.join(", ")} 整除`;
  }
}

class ParityHint extends HintStrategy {
  readonly type = HintType.Parity;
  generate(target: number, _upper: number, _lastGuess: number | null): string {
    return target % 2 === 0 ? "目标数字是偶数" : "目标数字是奇数";
  }
}

const HINT_STRATEGIES: Record<HintType, HintStrategy> = {
  [HintType.Range]: new RangeHint(),
  [HintType.HotCold]: new HotColdHint(),
  [HintType.Divisible]: new DivisibleHint(),
  [HintType.Parity]: new ParityHint(),
} as const satisfies Record<HintType, HintStrategy>;

// ============================================================
// 8. 游戏引擎
// ============================================================

class GameEvents extends EventEmitter<EventMap> {}

class GuessGame {
  private phase: GamePhase = GamePhase.Menu;
  private readonly events = new GameEvents();
  private readonly target: number;
  private attempts: number = 0;
  private lastGuess: number | null = null;
  private hintsUsed: number = 0;
  private readonly startTime: number;
  private readonly data: PlayerData;

  constructor(
    readonly difficulty: Difficulty,
    data: PlayerData,
  ) {
    const cfg = DIFFICULTIES[difficulty];
    this.target = Math.floor(Math.random() * cfg.upper) + 1;
    this.startTime = Date.now();
    this.data = data;
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }
  get attemptCount(): number {
    return this.attempts;
  }
  get remainingAttempts(): number {
    return DIFFICULTIES[this.difficulty].maxAttempts - this.attempts;
  }
  get elapsedTime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
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

  guess(value: number): { hint: string; won: boolean } {
    const cfg = DIFFICULTIES[this.difficulty];
    if (this.phase !== GamePhase.Playing)
      return { hint: "游戏未在进行中", won: false };
    if (value < 1 || value > cfg.upper)
      throw new InvalidGuessError(value, cfg.upper);

    this.attempts++;
    this.lastGuess = value;
    let hint: string;

    if (value === this.target) {
      hint = "恭喜! 答对了!";
      const score = cfg.coefficient * (cfg.upper - this.attempts + 1);
      this.transition(GamePhase.Won);
      this.events.emit("win", {
        target: this.target,
        attempts: this.attempts,
        score,
      });
      this.saveResult(true, score);
      return { hint, won: true };
    }

    if (this.attempts >= cfg.maxAttempts) {
      hint = `次数用尽! 答案是 ${this.target}`;
      this.transition(GamePhase.Lost);
      this.events.emit("lose", {
        target: this.target,
        attempts: this.attempts,
      });
      this.saveResult(false, 0);
      return { hint, won: false };
    }

    if (value < this.target) {
      hint = `小了! (剩余 ${this.remainingAttempts} 次)`;
    } else {
      hint = `大了! (剩余 ${this.remainingAttempts} 次)`;
    }

    this.events.emit("guess", { value, attempts: this.attempts, hint });
    return { hint, won: false };
  }

  useHint(): string {
    const cfg = DIFFICULTIES[this.difficulty];
    const maxHints = Math.max(1, Math.floor(cfg.maxAttempts / 4));
    if (this.hintsUsed >= maxHints) throw new NoHintsLeftError();

    const available = cfg.hintsAllowed;
    const hintType =
      available[this.hintsUsed % available.length] ?? HintType.Range;
    const strategy = HINT_STRATEGIES[hintType];
    const text = strategy.generate(this.target, cfg.upper, this.lastGuess);
    this.hintsUsed++;
    this.events.emit("hint", { type: hintType, text });
    return `[提示 ${this.hintsUsed}/${maxHints}] ${text}`;
  }

  giveUp(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.transition(GamePhase.Lost);
    this.events.emit("lose", { target: this.target, attempts: this.attempts });
    this.saveResult(false, 0);
  }

  private saveResult(won: boolean, score: number): void {
    const d = this.data as Mutable<PlayerData>;
    d.totalGames++;
    if (won) {
      d.totalWins++;
      d.currentStreak++;
      if (d.currentStreak > d.bestStreak) d.bestStreak = d.currentStreak;
      if (score > d.bestScore) d.bestScore = score;
      const best = d.bestAttempts[this.difficulty];
      if (best === undefined || this.attempts < best) {
        d.bestAttempts[this.difficulty] = this.attempts;
      }
    } else {
      d.currentStreak = 0;
    }
    d.records.push({
      difficulty: this.difficulty,
      attempts: this.attempts,
      score,
      timestamp: Date.now(),
      won,
    });
    if (d.records.length > 200) d.records = d.records.slice(-200);
    saveData(this.data);
  }
}

// ============================================================
// 9. 数据持久化
// ============================================================

function loadData(): PlayerData {
  const empty: PlayerData = {
    playerName: "Player",
    totalGames: 0,
    totalWins: 0,
    bestScore: 0,
    currentStreak: 0,
    bestStreak: 0,
    bestAttempts: {},
    records: [],
  };
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<PlayerData>;
      return { ...empty, ...data };
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
// 10. 命令解析 (函数重载)
// ============================================================

function parseCommand(line: string): ParsedCommand;
function parseCommand(line: string, upper: number): ParsedCommand;
function parseCommand(line: string, upper?: number): ParsedCommand {
  const input = line.trim().toLowerCase();
  if (input === "q" || input === "quit") return { action: "quit" };
  if (input === "h" || input === "hint") return { action: "hint" };
  if (input === "give" || input === "surrender") return { action: "give" };

  const num = parseInt(input, 10);
  if (!Number.isNaN(num) && upper !== undefined && num >= 1 && num <= upper) {
    return { action: "guess", value: num };
  }
  if (!Number.isNaN(num) && upper === undefined) {
    return { action: "guess", value: num };
  }
  return { action: "unknown", input: line };
}

// ============================================================
// 11. 符号
// ============================================================

const SYM_SESSION = Symbol("session");

interface GameSession {
  [SYM_SESSION]: boolean;
  readonly game: GuessGame;
  readonly difficulty: Difficulty;
}

function createSession(difficulty: Difficulty, data: PlayerData): GameSession {
  const game = new GuessGame(difficulty, data);
  game.start();
  return { [SYM_SESSION]: true, game, difficulty };
}

// ============================================================
// 12. 显示
// ============================================================

function colorize(
  text: string,
  color: Color,
  useColor: boolean = true,
): string {
  return useColor ? `${COLOR_MAP[color]}${text}${ANSI.RESET}` : text;
}

function showMenu(data: PlayerData): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(colorize("===== 数字猜谜游戏 =====", Color.Cyan));
  console.log(
    `玩家: ${data.playerName}  场次: ${data.totalGames}  胜: ${data.totalWins}  最高分: ${data.bestScore}  连胜: ${data.currentStreak}/${data.bestStreak}`,
  );
  console.log("");
  console.log("命令:");
  console.log("  play [easy|medium|hard|insane]  开始游戏 (默认 medium)");
  console.log("  stats                           查看统计");
  console.log("  leaderboard                     排行榜 (Top 10)");
  console.log("  name <新名字>                   修改玩家名");
  console.log("  clear                           清空数据");
  console.log("  help / h                        帮助");
  console.log("  quit / q                        退出");
  console.log("");
  console.log("游戏内: 输入数字猜测, h 提示, give 放弃, q 退出");
}

function showStats(data: PlayerData): void {
  console.log(colorize("\n===== 个人统计 =====", Color.Cyan));
  console.log(`玩家: ${data.playerName}`);
  console.log(
    `总场次: ${data.totalGames}  胜利: ${data.totalWins}  胜率: ${data.totalGames > 0 ? ((data.totalWins / data.totalGames) * 100).toFixed(1) : "0.0"}%`,
  );
  console.log(
    `最高分: ${data.bestScore}  当前连胜: ${data.currentStreak}  最佳连胜: ${data.bestStreak}`,
  );
  console.log("各难度最少尝试次数:");
  for (const d of Object.values(Difficulty)) {
    const v = data.bestAttempts[d];
    console.log(
      `  ${DIFFICULTIES[d].label.padEnd(4)}: ${v === undefined ? "未通关" : v + " 次"}`,
    );
  }
  console.log("\n最近 5 场:");
  let count = 0;
  for (const r of recentRecords(data.records, 5)) {
    const date = new Date(r.timestamp).toLocaleString();
    const result = r.won
      ? colorize("胜", Color.Green)
      : colorize("负", Color.Red);
    console.log(
      `  [${DIFFICULTIES[r.difficulty].label}] ${result} 尝试 ${r.attempts} 次, 得分 ${r.score}  ${colorize(date, Color.Gray)}`,
    );
    count++;
  }
  if (count === 0) console.log(colorize("  (暂无记录)", Color.Gray));
}

function showLeaderboard(data: PlayerData): void {
  console.log(colorize("\n===== 排行榜 (Top 10) =====", Color.Cyan));
  const sorted = [...data.records]
    .filter((r) => r.won)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  if (sorted.length === 0) {
    console.log(colorize("  (暂无记录)", Color.Gray));
    return;
  }
  console.log(
    `${"排名".padEnd(4)} ${"难度".padEnd(6)} ${"分数".padEnd(8)} ${"次数".padEnd(6)} 时间`,
  );
  sorted.forEach((r, i) => {
    const date = new Date(r.timestamp).toLocaleString();
    console.log(
      `${(i + 1).toString().padEnd(4)} ${DIFFICULTIES[r.difficulty].label.padEnd(6)} ${r.score.toString().padEnd(8)} ${r.attempts.toString().padEnd(6)} ${date}`,
    );
  });
}

// ============================================================
// 13. 主程序
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
    rl.setPrompt("菜单> ");
    rl.prompt();
  };

  if (data.totalGames === 0 && data.records.length === 0) {
    rl.question("欢迎首次游玩! 请输入你的名字: ", (name: string) => {
      const trimmed = name.trim();
      if (trimmed) data.playerName = trimmed;
      saveData(data);
      refreshMenu();
    });
  } else {
    refreshMenu();
  }

  rl.on("line", (line: string) => {
    if (session) {
      const cfg = DIFFICULTIES[session.difficulty];
      const cmd = parseCommand(line, cfg.upper);
      switch (cmd.action) {
        case "quit":
          session = null;
          refreshMenu();
          return;
        case "give":
          session.game.giveUp();
          console.log(
            colorize(
              `已放弃! 答案是 ${session.game.attemptCount} 次未猜中`,
              Color.Red,
            ),
          );
          session = null;
          refreshMenu();
          return;
        case "hint":
          try {
            console.log(colorize(session.game.useHint(), Color.Yellow));
          } catch (e) {
            if (e instanceof GameError)
              console.log(colorize(e.message, Color.Red));
          }
          break;
        case "guess": {
          try {
            const result = session.game.guess(cmd.value);
            console.log(result.hint);
            if (result.won) {
              console.log(
                colorize(`用时: ${session.game.elapsedTime}s`, Color.Cyan),
              );
              session = null;
              refreshMenu();
              return;
            }
            if (session.game.currentPhase === GamePhase.Lost) {
              session = null;
              refreshMenu();
              return;
            }
          } catch (e) {
            if (e instanceof GameError)
              console.log(colorize(e.message, Color.Red));
          }
          break;
        }
        default:
          console.log(
            colorize(
              "未知命令, 输入数字猜测, h 提示, give 放弃, q 退出",
              Color.Red,
            ),
          );
      }
      if (session && session.game.currentPhase === GamePhase.Playing) {
        rl.setPrompt(`第 ${session.game.attemptCount + 1} 次> `);
      }
      rl.prompt();
      return;
    }

    // Menu mode
    const parts = line.trim().split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();

    if (cmd === "q" || cmd === "quit") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    }
    if (cmd === "play") {
      const diff = isDifficulty(parts[1])
        ? (parts[1] as Difficulty)
        : Difficulty.Medium;
      session = createSession(diff, data);
      const cfg = DIFFICULTIES[diff];
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log(colorize(`===== 数字猜谜 (${cfg.label}) =====`, Color.Cyan));
      console.log(
        `范围: 1 - ${cfg.upper}  系数: ${cfg.coefficient}  最多 ${cfg.maxAttempts} 次`,
      );
      console.log(
        colorize("输入数字猜测, h 提示, give 放弃, q 退出\n", Color.Gray),
      );
      rl.setPrompt(`第 1 次> `);
      rl.prompt();
      return;
    }
    if (cmd === "stats") {
      showStats(data);
      rl.prompt();
      return;
    }
    if (cmd === "leaderboard" || cmd === "lb") {
      showLeaderboard(data);
      rl.prompt();
      return;
    }
    if (cmd === "name") {
      const newName = parts.slice(1).join(" ").trim();
      if (newName) {
        data.playerName = newName;
        saveData(data);
        console.log(colorize(`玩家名已更新: ${newName}`, Color.Green));
      } else {
        console.log(colorize("请提供新名字", Color.Red));
      }
      rl.prompt();
      return;
    }
    if (cmd === "clear") {
      rl.question(
        colorize("确认清空所有数据? (yes/no) ", Color.Red),
        (answer: string) => {
          if (answer.trim().toLowerCase() === "yes") {
            const fresh: PlayerData = {
              playerName: data.playerName,
              totalGames: 0,
              totalWins: 0,
              bestScore: 0,
              currentStreak: 0,
              bestStreak: 0,
              bestAttempts: {},
              records: [],
            };
            Object.assign(data, fresh);
            saveData(data);
            console.log(colorize("已清空数据", Color.Green));
          } else {
            console.log("已取消");
          }
          rl.prompt();
        },
      );
      return;
    }
    if (cmd === "help" || cmd === "h") {
      console.log(
        "\n命令: play [easy|medium|hard|insane]  stats  leaderboard  name <名字>  clear  quit",
      );
      rl.prompt();
      return;
    }
    if (cmd === "") {
      rl.prompt();
      return;
    }
    console.log(colorize(`未知命令: ${cmd}`, Color.Red));
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
