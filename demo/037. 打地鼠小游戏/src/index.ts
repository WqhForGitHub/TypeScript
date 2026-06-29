#!/usr/bin/env node
/**
 * 打地鼠小游戏 (Whack-a-Mole) — Enhanced Edition
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
  HIDE: "\x1b[?25l",
  SHOW: "\x1b[?25h",
  BOLD: "\x1b[1m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
  MAGENTA: "\x1b[35m",
} as const;

const enum MoleType {
  Normal = "normal",
  Golden = "golden",
  Bomb = "bomb",
  Bonus = "bonus",
}
enum GamePhase {
  Menu = "menu",
  Playing = "playing",
  Paused = "paused",
  Over = "over",
}
enum GameMode {
  Classic = "classic",
  TimeAttack = "timeAttack",
  Survival = "survival",
  Frenzy = "frenzy",
}
enum Difficulty {
  Easy = "easy",
  Normal = "normal",
  Hard = "hard",
  Insane = "insane",
}
enum Color {
  Red = "red",
  Green = "green",
  Yellow = "yellow",
  Cyan = "cyan",
  Gray = "gray",
  Magenta = "magenta",
  Bold = "bold",
}

type ColorCode = (typeof ANSI)[keyof typeof ANSI];

const COLOR_MAP: Record<Color, ColorCode> = {
  [Color.Red]: ANSI.RED,
  [Color.Green]: ANSI.GREEN,
  [Color.Yellow]: ANSI.YELLOW,
  [Color.Cyan]: ANSI.CYAN,
  [Color.Gray]: ANSI.GRAY,
  [Color.Magenta]: ANSI.MAGENTA,
  [Color.Bold]: ANSI.BOLD,
} as const satisfies Record<Color, ColorCode>;

interface DifficultyConfig {
  readonly duration: number;
  readonly gridSize: number;
  readonly spawnInterval: number;
  readonly moleDuration: number;
  readonly bombChance: number;
  readonly goldenChance: number;
  readonly label: string;
}

const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  [Difficulty.Easy]: {
    duration: 60,
    gridSize: 9,
    spawnInterval: 900,
    moleDuration: 1200,
    bombChance: 0.05,
    goldenChance: 0.08,
    label: "简单",
  },
  [Difficulty.Normal]: {
    duration: 60,
    gridSize: 9,
    spawnInterval: 700,
    moleDuration: 1000,
    bombChance: 0.1,
    goldenChance: 0.06,
    label: "普通",
  },
  [Difficulty.Hard]: {
    duration: 45,
    gridSize: 9,
    spawnInterval: 500,
    moleDuration: 800,
    bombChance: 0.15,
    goldenChance: 0.05,
    label: "困难",
  },
  [Difficulty.Insane]: {
    duration: 30,
    gridSize: 9,
    spawnInterval: 350,
    moleDuration: 500,
    bombChance: 0.2,
    goldenChance: 0.04,
    label: "疯狂",
  },
} as const satisfies Record<Difficulty, DifficultyConfig>;

interface MoleInfo {
  readonly type: MoleType;
  readonly appearedAt: number;
  readonly duration: number;
  readonly score: number;
}

interface HoleState {
  mole: MoleInfo | null;
  hitAt: number | null;
}

interface GameStats {
  readonly gamesPlayed: number;
  readonly totalScore: number;
  readonly bestScore: number;
  readonly totalHits: number;
  readonly totalMisses: number;
  readonly bestCombo: number;
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".whackamole_data.json",
);

// ============================================================
// 2. 判别联合
// ============================================================

type GameEvent =
  | {
      readonly type: "hit";
      readonly hole: number;
      readonly moleType: MoleType;
      readonly score: number;
    }
  | { readonly type: "miss"; readonly hole: number }
  | {
      readonly type: "spawn";
      readonly hole: number;
      readonly moleType: MoleType;
    }
  | { readonly type: "combo"; readonly combo: number }
  | {
      readonly type: "phaseChange";
      readonly from: GamePhase;
      readonly to: GamePhase;
    }
  | { readonly type: "gameOver"; readonly score: number };

type EventOfType<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

type ParsedCommand =
  | { readonly action: "start"; readonly difficulty: Difficulty }
  | { readonly action: "whack"; readonly hole: number }
  | { readonly action: "pause" }
  | { readonly action: "resume" }
  | { readonly action: "quit" }
  | { readonly action: "stats" }
  | { readonly action: "help" }
  | { readonly action: "unknown"; readonly input: string };

// ============================================================
// 3. 自定义错误
// ============================================================

abstract class WhackError extends Error {
  abstract readonly code: string;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InvalidHoleError extends WhackError {
  readonly code = "INVALID_HOLE";
  constructor(hole: number) {
    super(`无效洞口: ${hole}`);
  }
}

class GameStateException extends WhackError {
  readonly code = "GAME_STATE";
  constructor(msg: string) {
    super(msg);
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

function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" &&
    Object.values(GameMode).includes(value as GameMode)
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

function* iterateHoles(
  holes: readonly HoleState[],
): Generator<{ readonly idx: number; readonly state: HoleState }> {
  for (let i = 0; i < holes.length; i++) {
    yield { idx: i, state: holes[i]! };
  }
}

function* emptyHoles(holes: readonly HoleState[]): Generator<number> {
  for (let i = 0; i < holes.length; i++) {
    if (holes[i]!.mole === null && holes[i]!.hitAt === null) yield i;
  }
}

// ============================================================
// 7. 地鼠生成策略
// ============================================================

abstract class MoleSpawner {
  abstract spawn(
    holes: readonly HoleState[],
    cfg: DifficultyConfig,
  ): { readonly hole: number; readonly mole: MoleInfo } | null;
}

class RandomSpawner extends MoleSpawner {
  spawn(
    holes: readonly HoleState[],
    cfg: DifficultyConfig,
  ): { readonly hole: number; readonly mole: MoleInfo } | null {
    const empty = [...emptyHoles(holes)];
    if (empty.length === 0) return null;
    const hole = empty[Math.floor(Math.random() * empty.length)]!;
    const mole = this.createMole(cfg);
    return { hole, mole };
  }

  protected createMole(cfg: DifficultyConfig): MoleInfo {
    const r = Math.random();
    let type: MoleType;
    let score: number;
    if (r < cfg.bombChance) {
      type = MoleType.Bomb;
      score = -20;
    } else if (r < cfg.bombChance + cfg.goldenChance) {
      type = MoleType.Golden;
      score = 50;
    } else if (r < cfg.bombChance + cfg.goldenChance + 0.1) {
      type = MoleType.Bonus;
      score = 30;
    } else {
      type = MoleType.Normal;
      score = 10;
    }
    return { type, appearedAt: Date.now(), duration: cfg.moleDuration, score };
  }
}

const SPAWNERS: Record<GameMode, MoleSpawner> = {
  [GameMode.Classic]: new RandomSpawner(),
  [GameMode.TimeAttack]: new RandomSpawner(),
  [GameMode.Survival]: new RandomSpawner(),
  [GameMode.Frenzy]: new RandomSpawner(),
} as const satisfies Record<GameMode, MoleSpawner>;

// ============================================================
// 8. 游戏引擎
// ============================================================

interface EventMap {
  hit: {
    readonly hole: number;
    readonly moleType: MoleType;
    readonly score: number;
  };
  miss: { readonly hole: number };
  spawn: { readonly hole: number; readonly moleType: MoleType };
  combo: { readonly combo: number };
  phaseChange: { readonly from: GamePhase; readonly to: GamePhase };
  gameOver: { readonly score: number };
}

class WhackGame {
  private phase: GamePhase = GamePhase.Menu;
  private readonly holes: HoleState[];
  private score: number = 0;
  private hits: number = 0;
  private misses: number = 0;
  private combo: number = 0;
  private bestCombo: number = 0;
  private readonly startTime: number;
  private endTime: number | null = null;
  private statusMsg: string = "";
  private readonly events = new EventEmitter<EventMap>();
  private readonly stats: GameStats;

  constructor(
    readonly difficulty: Difficulty,
    readonly mode: GameMode,
  ) {
    const cfg = DIFFICULTIES[difficulty];
    this.holes = Array.from(
      { length: cfg.gridSize },
      () => ({ mole: null, hitAt: null }) as HoleState,
    );
    this.startTime = Date.now();
    this.stats = loadStats();
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }
  get currentScore(): number {
    return this.score;
  }
  get currentCombo(): number {
    return this.combo;
  }
  get elapsed(): number {
    const end = this.endTime ?? Date.now();
    return Math.floor((end - this.startTime) / 1000);
  }
  get remaining(): number {
    const cfg = DIFFICULTIES[this.difficulty];
    return Math.max(0, cfg.duration - this.elapsed);
  }
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : Math.round((this.hits / total) * 100);
  }
  get status(): string {
    return this.statusMsg;
  }

  private transition(to: GamePhase): void {
    const from = this.phase;
    if (from === to) return;
    this.events.emit("phaseChange", { from, to });
    this.phase = to;
  }

  on<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): void {
    this.events.on(event, handler);
  }

  start(): void {
    this.transition(GamePhase.Playing);
  }

  pause(): void {
    if (this.phase === GamePhase.Playing) this.transition(GamePhase.Paused);
  }
  resume(): void {
    if (this.phase === GamePhase.Paused) this.transition(GamePhase.Playing);
  }

  tick(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.updateMoles();
    if (this.remaining <= 0) this.endGame();
  }

  trySpawn(): { readonly hole: number; readonly moleType: MoleType } | null {
    if (this.phase !== GamePhase.Playing) return null;
    const cfg = DIFFICULTIES[this.difficulty];
    const spawner = SPAWNERS[this.mode];
    const result = spawner.spawn(this.holes, cfg);
    if (result) {
      this.holes[result.hole]!.mole = result.mole;
      this.events.emit("spawn", {
        hole: result.hole,
        moleType: result.mole.type,
      });
      return { hole: result.hole, moleType: result.mole.type };
    }
    return null;
  }

  private updateMoles(): void {
    const now = Date.now();
    for (const { state } of iterateHoles(this.holes)) {
      if (state.hitAt !== null && now - state.hitAt > 250) {
        state.hitAt = null;
        state.mole = null;
      }
      if (
        state.mole !== null &&
        now - state.mole.appearedAt > state.mole.duration
      ) {
        state.mole = null;
      }
    }
  }

  whack(hole: number): {
    hit: boolean;
    score: number;
    moleType: MoleType | null;
  } {
    if (this.phase !== GamePhase.Playing)
      return { hit: false, score: 0, moleType: null };
    if (hole < 0 || hole >= this.holes.length) throw new InvalidHoleError(hole);

    const state = this.holes[hole]!;
    if (state.mole === null || state.hitAt !== null) {
      this.misses++;
      this.combo = 0;
      this.score = Math.max(0, this.score - 2);
      this.statusMsg = "落空! -2";
      this.events.emit("miss", { hole });
      return { hit: false, score: -2, moleType: null };
    }

    const mole = state.mole;
    state.hitAt = Date.now();
    state.mole = null;
    this.hits++;

    let gained = mole.score;
    if (mole.type !== MoleType.Bomb) {
      this.combo++;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
      const comboBonus = Math.floor(this.combo / 3) * 5;
      gained += comboBonus;
      if (this.combo > 0 && this.combo % 3 === 0) {
        this.events.emit("combo", { combo: this.combo });
      }
    } else {
      this.combo = 0;
    }

    this.score = Math.max(0, this.score + gained);
    this.statusMsg =
      mole.type === MoleType.Bomb
        ? `炸弹! ${gained}`
        : `+${gained} ${mole.type === MoleType.Golden ? "★" : ""}`;
    this.events.emit("hit", { hole, moleType: mole.type, score: gained });
    return { hit: true, score: gained, moleType: mole.type };
  }

  private endGame(): void {
    this.transition(GamePhase.Over);
    this.endTime = Date.now();
    this.events.emit("gameOver", { score: this.score });
    this.saveStats();
  }

  private saveStats(): void {
    const s = this.stats as Mutable<GameStats>;
    s.gamesPlayed++;
    s.totalScore += this.score;
    if (this.score > s.bestScore) s.bestScore = this.score;
    s.totalHits += this.hits;
    s.totalMisses += this.misses;
    if (this.bestCombo > s.bestCombo) s.bestCombo = this.bestCombo;
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
    const now = Date.now();

    lines.push(c("===== 打地鼠 =====", Color.Cyan));
    const rem = this.remaining;
    const timeColor = rem > 10 ? Color.Green : Color.Red;
    lines.push(
      `分数: ${c(String(this.score), Color.Yellow)}  时间: ${c(`${rem}s`, timeColor)}  命中: ${this.hits}  错失: ${this.misses}  连击: ${c(String(this.combo), Color.Magenta)}`,
    );

    lines.push("");
    const cols = 3;
    for (let r = 0; r < this.holes.length / cols; r++) {
      let row = "  ";
      for (let cc = 0; cc < cols; cc++) {
        const idx = r * cols + cc;
        if (idx >= this.holes.length) break;
        const state = this.holes[idx]!;
        let cell: string;
        if (state.hitAt !== null && now - state.hitAt < 250) {
          cell = c("X", Color.Red);
        } else if (state.mole !== null) {
          const m = state.mole;
          if (m.type === MoleType.Golden) cell = c("*", Color.Yellow);
          else if (m.type === MoleType.Bomb) cell = c("B", Color.Red);
          else if (m.type === MoleType.Bonus) cell = c("+", Color.Magenta);
          else cell = c("o", Color.Green);
        } else {
          cell = c(".", Color.Gray);
        }
        const num = c(String(idx + 1), Color.Gray);
        row += `${num}:${cell}  `;
      }
      lines.push(row);
    }

    lines.push("");
    if (this.phase === GamePhase.Over) {
      lines.push(c("===== 游戏结束 =====", Color.Red));
      lines.push(
        `最终分数: ${this.score}  命中率: ${this.hitRate}%  最佳连击: ${this.bestCombo}`,
      );
      if (this.score >= this.stats.bestScore)
        lines.push(c("★ 新最高分! ★", Color.Yellow));
      lines.push(c("输入 start 重新开始, q 退出", Color.Cyan));
    } else if (this.phase === GamePhase.Paused) {
      lines.push(c("[已暂停] p 继续", Color.Yellow));
    } else {
      lines.push(c("输入 1-9 击打, p 暂停, q 退出", Color.Cyan));
    }
    if (this.statusMsg) lines.push(c(this.statusMsg, Color.Yellow));

    return lines.join("\n");
  }
}

// ============================================================
// 9. 数据持久化
// ============================================================

function loadStats(): GameStats {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<GameStats>;
      return {
        gamesPlayed: d.gamesPlayed ?? 0,
        totalScore: d.totalScore ?? 0,
        bestScore: d.bestScore ?? 0,
        totalHits: d.totalHits ?? 0,
        totalMisses: d.totalMisses ?? 0,
        bestCombo: d.bestCombo ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    gamesPlayed: 0,
    totalScore: 0,
    bestScore: 0,
    totalHits: 0,
    totalMisses: 0,
    bestCombo: 0,
  };
}

// ============================================================
// 10. 符号与函数重载
// ============================================================

const SYM_GAME = Symbol("game");

interface GameSession {
  [SYM_GAME]: boolean;
  readonly game: WhackGame;
  spawnTimer: NodeJS.Timeout | null;
  renderTimer: NodeJS.Timeout | null;
}

function parseCommand(line: string): ParsedCommand;
function parseCommand(line: string, gridSize: number): ParsedCommand;
function parseCommand(line: string, gridSize?: number): ParsedCommand {
  const input = line.trim().toLowerCase();
  if (input === "q" || input === "quit") return { action: "quit" };
  if (input === "p" || input === "pause") return { action: "pause" };
  if (input === "s" || input === "stats") return { action: "stats" };
  if (input === "h" || input === "help" || input === "?")
    return { action: "help" };
  if (input === "start")
    return { action: "start", difficulty: Difficulty.Normal };

  if (input.startsWith("start ")) {
    const diff = input.slice(6).trim();
    if (isDifficulty(diff)) return { action: "start", difficulty: diff };
  }

  const num = parseInt(input, 10);
  if (
    !Number.isNaN(num) &&
    gridSize !== undefined &&
    num >= 1 &&
    num <= gridSize
  ) {
    return { action: "whack", hole: num - 1 };
  }

  return { action: "unknown", input: line };
}

// ============================================================
// 11. 主程序
// ============================================================

function showMenu(stats: Readonly<GameStats>): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 打地鼠小游戏 =====" + ANSI.RESET);
  console.log(
    `最高分: ${stats.bestScore}  总场次: ${stats.gamesPlayed}  最佳连击: ${stats.bestCombo}`,
  );
  console.log("");
  console.log("命令: start [easy|normal|hard|insane]  stats  help  q");
  console.log("游戏中: 输入 1-9 击打, p 暂停, q 退出");
}

function showStats(stats: Readonly<GameStats>): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 统计 =====" + ANSI.RESET);
  console.log(
    `  场次: ${stats.gamesPlayed}  总分: ${stats.totalScore}  最高分: ${stats.bestScore}`,
  );
  console.log(
    `  总命中: ${stats.totalHits}  总错失: ${stats.totalMisses}  最佳连击: ${stats.bestCombo}`,
  );
}

function main(): void {
  const stats = loadStats();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let session: GameSession | null = null;
  let inMenu = true;

  showMenu(stats);
  rl.setPrompt("> ");
  rl.prompt();

  readline.emitKeypressEvents(process.stdin);

  process.stdin.on("keypress", (ch: string | undefined) => {
    if (inMenu || !session) return;
    if (ch && ch >= "1" && ch <= "9") {
      const hole = parseInt(ch, 10) - 1;
      session.game.whack(hole);
    }
  });

  rl.on("line", (line: string) => {
    if (!session || session.game.currentPhase === GamePhase.Over) {
      const cmd = parseCommand(line);
      switch (cmd.action) {
        case "quit":
          process.stdout.write(ANSI.CLEAR + ANSI.HOME);
          console.log("再见!");
          process.exit(0);
        case "start": {
          const game = new WhackGame(cmd.difficulty, GameMode.Classic);
          game.start();
          const cfg = DIFFICULTIES[cmd.difficulty];
          const spawnTimer = setInterval(
            () => game.trySpawn(),
            cfg.spawnInterval,
          );
          const renderTimer = setInterval(() => game.tick(), 100);
          session = { [SYM_GAME]: true, game, spawnTimer, renderTimer };
          inMenu = false;
          process.stdout.write(ANSI.HIDE);
          break;
        }
        case "stats":
          showStats(stats);
          break;
        case "help":
          console.log("\n命令: start [easy|normal|hard|insane]  stats  q");
          break;
        default:
          console.log(ANSI.RED + "未知命令" + ANSI.RESET);
      }
      if (inMenu) {
        rl.prompt();
      }
      return;
    }

    const cmd = parseCommand(line, 9);
    switch (cmd.action) {
      case "quit":
        if (session.spawnTimer) clearInterval(session.spawnTimer);
        if (session.renderTimer) clearInterval(session.renderTimer);
        process.stdout.write(ANSI.SHOW + ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      case "pause":
        session.game.pause();
        break;
      case "whack":
        session.game.whack(cmd.hole);
        break;
      default:
        break;
    }
  });

  // Render loop
  setInterval(() => {
    if (session && !inMenu) {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      process.stdout.write(session.game.render(true) + "\n");
      if (session.game.currentPhase === GamePhase.Over) {
        process.stdout.write(ANSI.SHOW);
        if (session.spawnTimer) clearInterval(session.spawnTimer);
        if (session.renderTimer) clearInterval(session.renderTimer);
        inMenu = true;
        session = null;
        rl.setPrompt("> ");
        rl.prompt();
      }
    }
  }, 100);

  rl.on("close", () => {
    process.stdout.write(ANSI.SHOW + ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
