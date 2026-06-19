#!/usr/bin/env node
/**
 * 文字版贪吃蛇游戏 (Text-based Snake)
 * ---------------------------------
 * 使用 readline 原始模式接收键盘输入。
 *
 * 操作说明：
 *   W / ↑  : 向上移动
 *   S / ↓  : 向下移动
 *   A / ←  : 向左移动
 *   D / →  : 向右移动
 *   P / 空格: 暂停 / 继续
 *   R      : 重新开始 (游戏结束后)
 *   Q      : 退出游戏
 *
 * 渲染：
 *   █ 表示蛇身
 *   ◆ 表示蛇头
 *   ● 表示食物
 *   (空格) 表示空白
 *
 * 规则：
 *   - 蛇吃到食物长度增加，分数 +10
 *   - 撞墙或撞自己游戏结束
 *   - 速度随分数提升
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// ============== ANSI 颜色与光标控制 ==============
const ANSI = {
  RESET: "\x1b[0m",
  CLEAR: "\x1b[2J",
  CLEAR_LINE: "\x1b[2K",
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
  HOME: "\x1b[H",
  GREEN: "\x1b[32m",
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  BOLD: "\x1b[1m",
};

// ============== 游戏类型定义 ==============
type Point = { x: number; y: number };
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

interface GameState {
  width: number;
  height: number;
  snake: Point[];
  direction: Direction;
  nextDirection: Direction;
  food: Point;
  score: number;
  isOver: boolean;
  isPaused: boolean;
  speed: number; // 毫秒每步
}

const HIGH_SCORE_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".snake_highscore.txt"
);

// ============== 工具函数 ==============
function loadHighScore(): number {
  try {
    if (fs.existsSync(HIGH_SCORE_FILE)) {
      const text = fs.readFileSync(HIGH_SCORE_FILE, "utf-8").trim();
      const n = parseInt(text, 10);
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

function randomFood(state: GameState): Point {
  // 随机选取一个不在蛇身上的点
  const occupied = new Set(state.snake.map((p) => `${p.x},${p.y}`));
  let p: Point;
  do {
    p = {
      x: Math.floor(Math.random() * state.width),
      y: Math.floor(Math.random() * state.height),
    };
  } while (occupied.has(`${p.x},${p.y}`));
  return p;
}

function createInitialState(width: number, height: number): GameState {
  const startX = Math.floor(width / 2);
  const startY = Math.floor(height / 2);
  const state: GameState = {
    width,
    height,
    snake: [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 0, y: 0 },
    score: 0,
    isOver: false,
    isPaused: false,
    speed: 200,
  };
  state.food = randomFood(state);
  return state;
}

// ============== 渲染 ==============
function render(state: GameState, highScore: number): void {
  const lines: string[] = [];
  // 顶部边框
  lines.push(ANSI.CYAN + "┌" + "─".repeat(state.width) + "┐" + ANSI.RESET);

  // 构建网格
  const grid: string[][] = [];
  for (let y = 0; y < state.height; y++) {
    grid.push(new Array(state.width).fill(" "));
  }
  // 食物
  grid[state.food.y][state.food.x] = ANSI.RED + "●" + ANSI.RESET;
  // 蛇
  for (let i = 0; i < state.snake.length; i++) {
    const seg = state.snake[i];
    if (seg.y >= 0 && seg.y < state.height && seg.x >= 0 && seg.x < state.width) {
      grid[seg.y][seg.x] = i === 0 ? ANSI.GREEN + "◆" + ANSI.RESET : ANSI.GREEN + "█" + ANSI.RESET;
    }
  }
  for (let y = 0; y < state.height; y++) {
    lines.push(ANSI.CYAN + "│" + ANSI.RESET + grid[y].join("") + ANSI.CYAN + "│" + ANSI.RESET);
  }
  // 底部边框
  lines.push(ANSI.CYAN + "└" + "─".repeat(state.width) + "┘" + ANSI.RESET);

  // 状态栏
  lines.push("");
  lines.push(
    `${ANSI.BOLD}分数: ${ANSI.YELLOW}${state.score}${ANSI.RESET}` +
      `   ${ANSI.BOLD}最高分: ${ANSI.YELLOW}${highScore}${ANSI.RESET}` +
      `   ${ANSI.BOLD}长度: ${ANSI.YELLOW}${state.snake.length}${ANSI.RESET}` +
      `   ${ANSI.BOLD}速度: ${ANSI.YELLOW}${state.speed}ms${ANSI.RESET}`
  );
  lines.push(
    `操作: WASD/方向键移动  P 空格暂停  Q 退出` +
      (state.isPaused ? `   ${ANSI.YELLOW}[已暂停]${ANSI.RESET}` : "")
  );

  if (state.isOver) {
    lines.push("");
    lines.push(
      `${ANSI.RED}${ANSI.BOLD}========== 游戏结束 ==========${ANSI.RESET}`
    );
    lines.push(`${ANSI.YELLOW}最终分数: ${state.score}${ANSI.RESET}`);
    lines.push(
      state.score >= highScore
        ? `${ANSI.YELLOW}★ 新的最高分! ★${ANSI.RESET}`
        : `${ANSI.CYAN}按 R 重新开始, Q 退出${ANSI.RESET}`
    );
  }

  // 写到屏幕
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

// ============== 游戏逻辑 ==============
function tick(state: GameState): void {
  if (state.isOver || state.isPaused) return;

  state.direction = state.nextDirection;
  const head = state.snake[0];
  const delta: Record<Direction, Point> = {
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  };
  const newHead: Point = {
    x: head.x + delta[state.direction].x,
    y: head.y + delta[state.direction].y,
  };

  // 撞墙
  if (
    newHead.x < 0 ||
    newHead.x >= state.width ||
    newHead.y < 0 ||
    newHead.y >= state.height
  ) {
    state.isOver = true;
    return;
  }
  // 撞自己（不含尾巴，因为尾巴会移动）
  for (let i = 0; i < state.snake.length - 1; i++) {
    if (state.snake[i].x === newHead.x && state.snake[i].y === newHead.y) {
      state.isOver = true;
      return;
    }
  }

  state.snake.unshift(newHead);

  // 吃食物
  if (newHead.x === state.food.x && newHead.y === state.food.y) {
    state.score += 10;
    state.food = randomFood(state);
    // 提速：每 50 分加快 10ms，最低 60ms
    state.speed = Math.max(60, 200 - Math.floor(state.score / 50) * 10);
  } else {
    state.snake.pop();
  }
}

// ============== 输入处理 ==============
function handleKey(
  key: string,
  state: GameState,
  controller: GameController
): void {
  const k = key.toLowerCase();
  const cur = state.direction;

  // 不能 180 度反向
  if ((k === "w" || k === "\x1b[a") && cur !== "DOWN") state.nextDirection = "UP";
  else if ((k === "s" || k === "\x1b[b") && cur !== "UP") state.nextDirection = "DOWN";
  else if ((k === "a" || k === "\x1b[d") && cur !== "RIGHT") state.nextDirection = "LEFT";
  else if ((k === "d" || k === "\x1b[c") && cur !== "LEFT") state.nextDirection = "RIGHT";
  else if (k === "p" || k === " ") state.isPaused = !state.isPaused;
  else if (k === "q") {
    controller.quit();
  } else if (k === "r" && state.isOver) {
    controller.restart();
  }
}

// ============== 游戏控制器 ==============
class GameController {
  private state: GameState;
  private highScore: number;
  private timer: NodeJS.Timeout | null = null;
  private rl: readline.Interface;
  private running = true;

  constructor(rl: readline.Interface, width = 20, height = 12) {
    this.rl = rl;
    this.state = createInitialState(width, height);
    this.highScore = loadHighScore();
  }

  start(): void {
    process.stdout.write(ANSI.HIDE_CURSOR);
    // 监听按键
    this.rl.on("keypress", (ch, key) => {
      if (!key && ch) {
        handleKey(ch, this.state, this);
      } else if (key) {
        // 方向键转义序列
        const seq = key.sequence || "";
        handleKey(seq, this.state, this);
      }
    });

    this.loop();
    this.render();
  }

  private loop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setInterval(() => {
      tick(this.state);
      this.render();
      if (this.state.isOver) {
        this.handleGameOver();
      }
    }, this.state.speed);
  }

  private render(): void {
    render(this.state, Math.max(this.highScore, this.state.score));
  }

  private handleGameOver(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.state.score > this.highScore) {
      this.highScore = this.state.score;
      saveHighScore(this.highScore);
    }
    this.render();
  }

  restart(): void {
    if (this.timer) clearInterval(this.timer);
    const w = this.state.width;
    const h = this.state.height;
    this.state = createInitialState(w, h);
    this.loop();
    this.render();
  }

  quit(): void {
    if (this.timer) clearInterval(this.timer);
    process.stdout.write(ANSI.SHOW_CURSOR + ANSI.CLEAR + ANSI.HOME);
    console.log("感谢游玩文字版贪吃蛇! 最终分数:", this.state.score);
    this.rl.close();
    this.running = false;
    process.exit(0);
  }
}

// ============== 入口 ==============
function main(): void {
  console.log(
    `${ANSI.BOLD}${ANSI.CYAN}===== 文字版贪吃蛇 =====${ANSI.RESET}`
  );
  console.log("操作: WASD/方向键移动, P 或空格暂停, Q 退出");
  console.log("按任意键开始, Ctrl+C 退出...\n");

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  } else {
    console.error("请在 TTY 终端下运行此游戏");
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const controller = new GameController(rl, 22, 14);

  // 任意键开始
  process.stdin.once("keypress", () => {
    controller.start();
  });
}

main();
