#!/usr/bin/env node
/**
 * 打地鼠小游戏 (Whack-a-Mole)
 * --------------------------
 * 3x3 网格 (9 个洞), 地鼠随机冒出, 玩家输入 1-9 数字击打对应洞口。
 *
 * 玩法：
 *   - 输入 1-9 击打对应洞口
 *   - 60 秒倒计时, 时间到游戏结束
 *   - 难度随时间递增: 地鼠出现频率加快, 停留时间缩短
 *   - 击中得分 (+10 + 难度奖励), 击空扣 2 分 (最低 0)
 *
 * 命令：
 *   1-9           击打对应洞口
 *   start         开始游戏 (菜单)
 *   q             退出
 *
 * 显示：
 *   ☺  地鼠
 *   ·  空洞
 *   ✗  被击中 (短暂闪烁)
 *
 * 数据存储：
 *   ~/.whackamole_highscore.txt 保存最高分
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

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
  BG_YELLOW: "\x1b[43m",
};

const GAME_DURATION = 60; // 秒
const GRID_SIZE = 9;

interface Hole {
  hasMole: boolean;
  hitAt: number | null; // 被击中的时间戳
  moleAppearedAt: number | null; // 地鼠出现的时间戳
  moleDuration: number; // 地鼠停留时长 (毫秒)
}

interface GameState {
  holes: Hole[];
  score: number;
  hits: number;
  misses: number;
  startTime: number;
  endTime: number | null;
  over: boolean;
  level: number;
  statusMsg: string;
}

const HIGHSCORE_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".whackamole_highscore.txt"
);

function loadHighScore(): number {
  try {
    if (fs.existsSync(HIGHSCORE_FILE)) {
      const n = parseInt(fs.readFileSync(HIGHSCORE_FILE, "utf-8").trim(), 10);
      return Number.isNaN(n) ? 0 : n;
    }
  } catch {
    /* 忽略 */
  }
  return 0;
}

function saveHighScore(s: number): void {
  try {
    fs.writeFileSync(HIGHSCORE_FILE, String(s), "utf-8");
  } catch {
    /* 忽略 */
  }
}

function newGame(): GameState {
  const holes: Hole[] = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    holes.push({
      hasMole: false,
      hitAt: null,
      moleAppearedAt: null,
      moleDuration: 1200,
    });
  }
  return {
    holes,
    score: 0,
    hits: 0,
    misses: 0,
    startTime: Date.now(),
    endTime: null,
    over: false,
    level: 1,
    statusMsg: "",
  };
}

// 根据已用时间计算当前难度
function currentLevel(elapsedSec: number): number {
  return Math.min(5, 1 + Math.floor(elapsedSec / 12));
}

function moleDurationForLevel(level: number): number {
  // level 1: 1200ms, 5: 400ms
  return Math.max(400, 1200 - (level - 1) * 200);
}

function spawnIntervalForLevel(level: number): number {
  // level 1: 900ms, 5: 350ms
  return Math.max(350, 900 - (level - 1) * 130);
}

// ============== 渲染 ==============
function render(state: GameState, highScore: number): void {
  const lines: string[] = [];
  const now = Date.now();
  const elapsed =
    state.endTime === null
      ? Math.floor((now - state.startTime) / 1000)
      : Math.floor((state.endTime - state.startTime) / 1000);
  const remaining = Math.max(0, GAME_DURATION - elapsed);

  lines.push(ANSI.BOLD + ANSI.CYAN + "===== 打地鼠 =====" + ANSI.RESET);
  lines.push(
    `分数: ${ANSI.YELLOW}${state.score}${ANSI.RESET}   ` +
      `时间: ${remaining > 10 ? ANSI.GREEN : ANSI.RED}${remaining}${ANSI.RESET}s   ` +
      `命中: ${state.hits}  错失: ${state.misses}   ` +
      `等级: ${state.level}   ` +
      `最高分: ${highScore}`
  );
  lines.push("");

  // 3x3 网格显示
  for (let r = 0; r < 3; r++) {
    let row = "   ";
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const hole = state.holes[idx];
      let cell: string;
      // 击中闪烁: 250ms 内显示 ✗
      if (hole.hitAt !== null && now - hole.hitAt < 250) {
        cell = ANSI.RED + ANSI.BOLD + "✗" + ANSI.RESET;
      } else if (hole.hasMole) {
        cell = ANSI.YELLOW + "☺" + ANSI.RESET;
      } else {
        cell = ANSI.GRAY + "·" + ANSI.RESET;
      }
      const num = ANSI.GRAY + (idx + 1).toString() + ANSI.RESET;
      row += `${num}:${cell}   `;
    }
    lines.push(row);
  }

  lines.push("");
  lines.push(
    ANSI.CYAN + "输入 1-9 击打对应洞口, q 退出" + ANSI.RESET
  );
  if (state.statusMsg) {
    lines.push(ANSI.YELLOW + state.statusMsg + ANSI.RESET);
  }
  if (state.over) {
    lines.push("");
    lines.push(
      ANSI.BOLD + ANSI.RED + "===== 游戏结束 =====" + ANSI.RESET
    );
    lines.push(
      `最终分数: ${ANSI.YELLOW}${state.score}${ANSI.RESET}   命中率: ${
        state.hits + state.misses === 0
          ? "0%"
          : Math.round((state.hits / (state.hits + state.misses)) * 100) + "%"
      }`
    );
    if (state.score > highScore) {
      lines.push(ANSI.YELLOW + "★ 新的最高分! ★" + ANSI.RESET);
    }
    lines.push(ANSI.CYAN + "输入 start 重新开始, q 退出" + ANSI.RESET);
  }

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

// ============== 游戏循环 ==============
class GameRunner {
  private state: GameState;
  private highScore: number;
  private spawnTimer: NodeJS.Timeout | null = null;
  private renderTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private rl: readline.Interface;
  private running = true;

  constructor(rl: readline.Interface) {
    this.rl = rl;
    this.highScore = loadHighScore();
    this.state = newGame();
  }

  start(): void {
    process.stdout.write(ANSI.HIDE);
    this.running = true;
    this.state = newGame();
    this.scheduleSpawn();
    this.renderTimer = setInterval(() => {
      this.updateMoles();
      this.checkTimeUp();
      render(this.state, Math.max(this.highScore, this.state.score));
    }, 100);
    this.tickTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.state.startTime) / 1000);
      const newLevel = currentLevel(elapsed);
      if (newLevel !== this.state.level) {
        this.state.level = newLevel;
        this.state.statusMsg = `难度提升至 ${newLevel} 级!`;
        // 重排地鼠以应用新速度
        this.scheduleSpawn();
      }
    }, 1000);
  }

  private scheduleSpawn(): void {
    if (this.spawnTimer) clearTimeout(this.spawnTimer);
    if (this.state.over) return;
    const interval = spawnIntervalForLevel(this.state.level);
    this.spawnTimer = setTimeout(() => {
      this.spawnMole();
      this.scheduleSpawn();
    }, interval);
  }

  private spawnMole(): void {
    if (this.state.over) return;
    const empty: number[] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      if (!this.state.holes[i].hasMole && this.state.holes[i].hitAt === null) {
        empty.push(i);
      }
    }
    if (empty.length === 0) return;
    const idx = empty[Math.floor(Math.random() * empty.length)];
    const dur = moleDurationForLevel(this.state.level);
    this.state.holes[idx] = {
      hasMole: true,
      hitAt: null,
      moleAppearedAt: Date.now(),
      moleDuration: dur,
    };
  }

  private updateMoles(): void {
    const now = Date.now();
    for (let i = 0; i < GRID_SIZE; i++) {
      const h = this.state.holes[i];
      // 击中动画 250ms 后清除 hitAt
      if (h.hitAt !== null && now - h.hitAt > 250) {
        h.hitAt = null;
        h.hasMole = false;
        h.moleAppearedAt = null;
      }
      // 地鼠超时未被打 -> 错失
      if (
        h.hasMole &&
        h.moleAppearedAt !== null &&
        now - h.moleAppearedAt > h.moleDuration
      ) {
        h.hasMole = false;
        h.moleAppearedAt = null;
        // 错失不扣分, 但计入 misses 统计
      }
    }
  }

  private checkTimeUp(): void {
    if (this.state.over) return;
    const elapsed = Math.floor((Date.now() - this.state.startTime) / 1000);
    if (elapsed >= GAME_DURATION) {
      this.state.over = true;
      this.state.endTime = Date.now();
      if (this.state.score > this.highScore) {
        this.highScore = this.state.score;
        saveHighScore(this.highScore);
      }
      this.cleanup();
      render(this.state, this.highScore);
    }
  }

  private cleanup(): void {
    if (this.spawnTimer) clearTimeout(this.spawnTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.spawnTimer = null;
    this.renderTimer = null;
    this.tickTimer = null;
  }

  whack(idx: number): void {
    if (this.state.over) return;
    if (idx < 0 || idx >= GRID_SIZE) return;
    const h = this.state.holes[idx];
    if (h.hasMole && h.hitAt === null) {
      h.hitAt = Date.now();
      h.hasMole = false;
      this.state.hits++;
      // 分数: 基础 10 + 等级加成
      const gained = 10 + (this.state.level - 1) * 3;
      this.state.score += gained;
      this.state.statusMsg = `+${gained} 分!`;
    } else {
      // 击空
      this.state.misses++;
      this.state.score = Math.max(0, this.state.score - 2);
      this.state.statusMsg = "落空! -2 分";
    }
  }

  isOver(): boolean {
    return this.state.over;
  }

  quit(): void {
    this.cleanup();
    process.stdout.write(ANSI.SHOW + ANSI.CLEAR + ANSI.HOME);
    console.log("感谢游玩打地鼠! 最终分数:", this.state.score);
    this.rl.close();
    process.exit(0);
  }
}

// ============== 主程序 ==============
function showMenu(highScore: number): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 打地鼠小游戏 =====" + ANSI.RESET);
  console.log(`历史最高分: ${highScore}`);
  console.log("");
  console.log("玩法: 60 秒内, 地鼠随机冒出, 输入 1-9 击打对应洞口");
  console.log("      击中 +10 分 (含难度加成), 击空 -2 分");
  console.log("");
  console.log("命令:");
  console.log("  start    开始游戏");
  console.log("  q        退出");
}

function main(): void {
  const highScore = loadHighScore();

  if (!process.stdin.isTTY) {
    console.error("请在 TTY 终端下运行此游戏");
    process.exit(1);
  }

  readline.emitKeypressEvents(process.stdin);
  // 不进入 raw mode, 这样用户可以正常输入 start / q 等命令

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let runner: GameRunner | null = null;
  let inMenu = true;

  showMenu(highScore);
  rl.setPrompt("> ");
  rl.prompt();

  // 数字键实时响应: 通过 keypress 事件
  interface KeyPressInfo {
    ctrl?: boolean;
    name?: string;
    sequence?: string;
  }
  process.stdin.on(
    "keypress",
    (ch: string | undefined, key: KeyPressInfo | undefined) => {
      if (inMenu || !runner || runner.isOver()) return;
      if (ch && ch >= "1" && ch <= "9") {
        runner.whack(parseInt(ch, 10) - 1);
      } else if (key && key.ctrl && key.name === "c") {
        process.stdout.write(ANSI.SHOW + ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      }
    }
  );

  rl.on("line", (line: string) => {
    const input = line.trim().toLowerCase();
    if (inMenu) {
      if (input === "start") {
        inMenu = false;
        runner = new GameRunner(rl);
        runner.start();
        rl.setPrompt("");
      } else if (input === "q" || input === "quit") {
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      } else if (input === "") {
        rl.prompt();
      } else {
        console.log(ANSI.RED + "未知命令" + ANSI.RESET);
        rl.prompt();
      }
      return;
    }

    // 游戏中
    if (input === "q" || input === "quit") {
      if (runner) runner.quit();
      return;
    }
    if (runner && runner.isOver()) {
      if (input === "start") {
        runner = new GameRunner(rl);
        runner.start();
      } else if (input === "q" || input === "quit") {
        if (runner) runner.quit();
      }
    }
    // 数字击打已通过 keypress 处理
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.SHOW + ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
