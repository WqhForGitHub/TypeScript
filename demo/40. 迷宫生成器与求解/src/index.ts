#!/usr/bin/env node
/**
 * 迷宫生成器与求解器 (Maze Generator & Solver)
 * -------------------------------------------
 * 命令行界面：
 *   generate <w> <h> [-s seed] [-o file]
 *       生成 w x h 的迷宫 (单元格数), 使用递归回溯算法
 *       -s seed  指定随机种子 (整数)
 *       -o file  保存到文件 (默认 maze_<w>x<h>_<seed>.txt)
 *
 *   solve <maze-file> [-m bfs|dfs] [-o file]
 *       求解迷宫, 默认 BFS (最短路径)
 *       -m bfs  广度优先 (保证最短)
 *       -m dfs  深度优先 (不保证最短)
 *       -o file 保存求解结果
 *
 *   animate <maze-file> [-m bfs|dfs]
 *       动画展示求解过程 (步进显示)
 *
 *   show <maze-file>
 *       显示迷宫
 *
 *   help / h
 *       帮助
 *
 * 显示：
 *   █ 墙
 *   (空格) 通路
 *   S 起点 (左上)
 *   E 终点 (右下)
 *   ● 路径
 *   · 已探索
 *
 * 文件格式：
 *   第一行: w h
 *   之后: 字符矩阵 (# 或空格)
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

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
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
};

// ============== 简单种子随机 ==============
class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }
  next(): number {
    // LCG (Linear Congruential Generator)
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

// ============== 迷宫数据结构 ==============
// 用 (2w+1) x (2h+1) 字符矩阵表示, 偶数索引为单元格, 奇数索引为墙
// '#' 墙, ' ' 路
type MazeGrid = string[][];

interface Maze {
  width: number; // 单元格列数
  height: number; // 单元格行数
  grid: MazeGrid; // (2h+1) x (2w+1)
}

function createMaze(w: number, h: number, seed: number): Maze {
  const gw = 2 * w + 1;
  const gh = 2 * h + 1;
  // 初始全是墙
  const grid: MazeGrid = [];
  for (let y = 0; y < gh; y++) {
    grid.push(new Array(gw).fill("#"));
  }

  // 单元格 对应 grid[2r+1][2c+1]
  const visited: boolean[][] = [];
  for (let r = 0; r < h; r++) {
    visited.push(new Array(w).fill(false));
  }

  const rng = new SeededRandom(seed);
  // 递归回溯 (用栈避免递归过深)
  const stack: Array<{ r: number; c: number }> = [];
  const start = { r: 0, c: 0 };
  visited[0][0] = true;
  grid[1][1] = " ";
  stack.push(start);

  const dirs = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    // 找未访问邻居
    const neighbors: Array<{ r: number; c: number; dr: number; dc: number }> = [];
    for (const d of dirs) {
      const nr = cur.r + d.dr;
      const nc = cur.c + d.dc;
      if (nr >= 0 && nr < h && nc >= 0 && nc < w && !visited[nr][nc]) {
        neighbors.push({ r: nr, c: nc, dr: d.dr, dc: d.dc });
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    // 随机选一个
    const next = neighbors[rng.nextInt(neighbors.length)];
    // 打通中间的墙
    const wallR = 2 * cur.r + 1 + next.dr;
    const wallC = 2 * cur.c + 1 + next.dc;
    grid[wallR][wallC] = " ";
    grid[2 * next.r + 1][2 * next.c + 1] = " ";
    visited[next.r][next.c] = true;
    stack.push({ r: next.r, c: next.c });
  }

  // 起点 (0,0) 单元格 -> grid[1][1]
  // 终点 (h-1, w-1) 单元格 -> grid[2h-1][2w-1]
  return { width: w, height: h, grid };
}

// ============== 求解 ==============
interface SolveStep {
  x: number;
  y: number;
  parent: { x: number; y: number } | null;
}

interface SolveResult {
  path: Array<{ x: number; y: number }>; // 最短路径 (含起点终点)
  explored: Array<{ x: number; y: number }>; // 探索过的所有点
  method: "bfs" | "dfs";
  found: boolean;
}

function getStartEnd(maze: Maze): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  return {
    start: { x: 1, y: 1 },
    end: { x: 2 * maze.width - 1, y: 2 * maze.height - 1 },
  };
}

function isPath(grid: MazeGrid, x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  if (x < 0 || x >= grid[0].length) return false;
  return grid[y][x] !== "#";
}

function solve(maze: Maze, method: "bfs" | "dfs"): SolveResult {
  const { start, end } = getStartEnd(maze);
  const visited: boolean[][] = [];
  for (let y = 0; y < maze.grid.length; y++) {
    visited.push(new Array(maze.grid[0].length).fill(false));
  }
  const explored: Array<{ x: number; y: number }> = [];
  const parents: Record<string, { x: number; y: number } | null> = {};
  const key = (x: number, y: number) => `${x},${y}`;

  // 用数组当队列 (BFS) 或栈 (DFS)
  const frontier: Array<{ x: number; y: number }> = [start];
  visited[start.y][start.x] = true;
  parents[key(start.x, start.y)] = null;

  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];

  let found = false;
  while (frontier.length > 0) {
    let cur: { x: number; y: number };
    if (method === "bfs") {
      cur = frontier.shift() as { x: number; y: number };
    } else {
      cur = frontier.pop() as { x: number; y: number };
    }
    explored.push(cur);
    if (cur.x === end.x && cur.y === end.y) {
      found = true;
      break;
    }
    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (isPath(maze.grid, nx, ny) && !visited[ny][nx]) {
        visited[ny][nx] = true;
        parents[key(nx, ny)] = cur;
        frontier.push({ x: nx, y: ny });
      }
    }
  }

  // 回溯路径
  const path: Array<{ x: number; y: number }> = [];
  if (found) {
    let cur: { x: number; y: number } | null = end;
    while (cur) {
      path.unshift(cur);
      cur = parents[key(cur.x, cur.y)];
    }
  }
  return { path, explored, method, found };
}

// ============== 渲染 ==============
function renderMaze(
  maze: Maze,
  options: {
    path?: Array<{ x: number; y: number }>;
    explored?: Array<{ x: number; y: number }>;
    showStartEnd?: boolean;
  } = {}
): void {
  const { grid } = maze;
  const pathSet = new Set((options.path || []).map((p) => `${p.x},${p.y}`));
  const exploredSet = new Set(
    (options.explored || []).map((p) => `${p.x},${p.y}`)
  );
  const { start, end } = getStartEnd(maze);

  const lines: string[] = [];
  for (let y = 0; y < grid.length; y++) {
    let row = "";
    for (let x = 0; x < grid[0].length; x++) {
      const cell = grid[y][x];
      const k = `${x},${y}`;
      if (cell === "#") {
        row += ANSI.GRAY + "█" + ANSI.RESET;
      } else if (options.showStartEnd && x === start.x && y === start.y) {
        row += ANSI.GREEN + "S" + ANSI.RESET;
      } else if (options.showStartEnd && x === end.x && y === end.y) {
        row += ANSI.RED + "E" + ANSI.RESET;
      } else if (pathSet.has(k)) {
        row += ANSI.YELLOW + "●" + ANSI.RESET;
      } else if (exploredSet.has(k)) {
        row += ANSI.BLUE + "·" + ANSI.RESET;
      } else {
        row += " ";
      }
    }
    lines.push(row);
  }
  console.log(lines.join("\n"));
}

function renderMazeWithStats(
  maze: Maze,
  result: SolveResult,
  elapsedMs: number
): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(
    ANSI.BOLD +
      ANSI.CYAN +
      `===== 迷宫求解 (${result.method.toUpperCase()}) =====` +
      ANSI.RESET
  );
  console.log(
    `尺寸: ${maze.width} x ${maze.height}   ` +
      `找到路径: ${result.found ? ANSI.GREEN + "是" : ANSI.RED + "否"}${ANSI.RESET}   ` +
      `路径长度: ${result.path.length}   ` +
      `探索点数: ${result.explored.length}   ` +
      `耗时: ${elapsedMs}ms`
  );
  console.log("");
  renderMaze(maze, {
    path: result.path,
    explored: result.explored,
    showStartEnd: true,
  });
  console.log("");
  console.log(
    ANSI.GRAY + "● 路径  · 已探索  S 起点  E 终点  █ 墙" + ANSI.RESET
  );
}

// ============== 文件 I/O ==============
function saveMaze(maze: Maze, file: string): void {
  const lines: string[] = [];
  lines.push(`${maze.width} ${maze.height}`);
  for (const row of maze.grid) {
    lines.push(row.join("").replace(/ /g, " ").replace(/#/g, "#"));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
}

function loadMaze(file: string): Maze {
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("迷宫文件格式无效");
  const [wStr, hStr] = lines[0].split(/\s+/);
  const w = parseInt(wStr, 10);
  const h = parseInt(hStr, 10);
  if (Number.isNaN(w) || Number.isNaN(h)) throw new Error("迷宫尺寸无效");
  const grid: MazeGrid = [];
  for (let i = 1; i < lines.length; i++) {
    grid.push(lines[i].split(""));
  }
  return { width: w, height: h, grid };
}

// ============== 命令处理 ==============
function parseArgs(args: string[]): {
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      const key = args[i].replace(/^-+/, "");
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

function cmdGenerate(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 2) {
    console.log(ANSI.RED + "用法: generate <w> <h> [-s seed] [-o file]" + ANSI.RESET);
    return;
  }
  const w = parseInt(positional[0], 10);
  const h = parseInt(positional[1], 10);
  if (Number.isNaN(w) || Number.isNaN(h) || w < 1 || h < 1) {
    console.log(ANSI.RED + "尺寸必须为正整数" + ANSI.RESET);
    return;
  }
  if (w > 100 || h > 100) {
    console.log(ANSI.RED + "尺寸过大, 上限 100x100" + ANSI.RESET);
    return;
  }
  const seed = flags.s ? parseInt(flags.s, 10) : Math.floor(Math.random() * 1000000);
  const maze = createMaze(w, h, seed);
  const file = flags.o || `maze_${w}x${h}_${seed}.txt`;
  saveMaze(maze, file);
  console.log(
    ANSI.GREEN + `已生成 ${w}x${h} 迷宫 (种子 ${seed}) -> ${file}` + ANSI.RESET
  );
  console.log("");
  renderMaze(maze, { showStartEnd: true });
}

function cmdSolve(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 1) {
    console.log(ANSI.RED + "用法: solve <maze-file> [-m bfs|dfs] [-o file]" + ANSI.RESET);
    return;
  }
  const file = positional[0];
  if (!fs.existsSync(file)) {
    console.log(ANSI.RED + `文件不存在: ${file}` + ANSI.RESET);
    return;
  }
  const method: "bfs" | "dfs" = flags.m === "dfs" ? "dfs" : "bfs";
  const maze = loadMaze(file);
  const start = Date.now();
  const result = solve(maze, method);
  const elapsed = Date.now() - start;
  renderMazeWithStats(maze, result, elapsed);
  if (flags.o) {
    // 保存求解后的迷宫 (在路径上标记 .)
    const grid = maze.grid.map((row) => row.slice());
    for (const p of result.explored) {
      if (grid[p.y][p.x] === " ") grid[p.y][p.x] = ".";
    }
    for (const p of result.path) {
      grid[p.y][p.x] = "*";
    }
    const lines: string[] = [`${maze.width} ${maze.height}`];
    for (const row of grid) lines.push(row.join(""));
    fs.writeFileSync(flags.o, lines.join("\n") + "\n", "utf-8");
    console.log(ANSI.GREEN + `已保存求解结果到 ${flags.o}` + ANSI.RESET);
  }
}

function cmdAnimate(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 1) {
    console.log(ANSI.RED + "用法: animate <maze-file> [-m bfs|dfs]" + ANSI.RESET);
    return;
  }
  const file = positional[0];
  if (!fs.existsSync(file)) {
    console.log(ANSI.RED + `文件不存在: ${file}` + ANSI.RESET);
    return;
  }
  const method: "bfs" | "dfs" = flags.m === "dfs" ? "dfs" : "bfs";
  const maze = loadMaze(file);
  animateSolve(maze, method);
}

function animateSolve(maze: Maze, method: "bfs" | "dfs"): void {
  const { start, end } = getStartEnd(maze);
  const visited: boolean[][] = [];
  for (let y = 0; y < maze.grid.length; y++) {
    visited.push(new Array(maze.grid[0].length).fill(false));
  }
  const explored: Array<{ x: number; y: number }> = [];
  const parents: Record<string, { x: number; y: number } | null> = {};
  const key = (x: number, y: number) => `${x},${y}`;
  const frontier: Array<{ x: number; y: number }> = [start];
  visited[start.y][start.x] = true;
  parents[key(start.x, start.y)] = null;
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];

  let found = false;
  let done = false;
  let finalPath: Array<{ x: number; y: number }> = [];

  const renderStep = () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log(
      ANSI.BOLD +
        ANSI.CYAN +
        `===== 迷宫求解动画 (${method.toUpperCase()}) =====` +
        ANSI.RESET
    );
    console.log(
      `已探索: ${explored.length} 点   ${found ? "找到终点!" : done ? "未找到路径" : "搜索中..."}`
    );
    // 渲染
    const pathSet = new Set(finalPath.map((p) => key(p.x, p.y)));
    const exploredSet = new Set(explored.map((p) => key(p.x, p.y)));
    for (let y = 0; y < maze.grid.length; y++) {
      let row = "";
      for (let x = 0; x < maze.grid[0].length; x++) {
        const cell = maze.grid[y][x];
        const k = key(x, y);
        if (cell === "#") {
          row += ANSI.GRAY + "█" + ANSI.RESET;
        } else if (x === start.x && y === start.y) {
          row += ANSI.GREEN + "S" + ANSI.RESET;
        } else if (x === end.x && y === end.y) {
          row += ANSI.RED + "E" + ANSI.RESET;
        } else if (pathSet.has(k)) {
          row += ANSI.YELLOW + "●" + ANSI.RESET;
        } else if (exploredSet.has(k)) {
          row += ANSI.BLUE + "·" + ANSI.RESET;
        } else {
          row += " ";
        }
      }
      process.stdout.write(row + "\n");
    }
  };

  process.stdout.write(ANSI.HIDE_CURSOR);

  const step = () => {
    if (done) {
      // 最后展示完整路径
      renderStep();
      process.stdout.write(ANSI.SHOW_CURSOR);
      console.log("");
      console.log(
        ANSI.GREEN +
          `动画结束. 路径长度: ${finalPath.length}, 探索点数: ${explored.length}` +
          ANSI.RESET
      );
      return;
    }
    // 每帧执行若干步 (大迷宫加速)
    const stepsPerFrame = Math.max(1, Math.floor(explored.length / 50) + 1);
    for (let s = 0; s < stepsPerFrame && !done; s++) {
      if (frontier.length === 0) {
        done = true;
        break;
      }
      let cur: { x: number; y: number };
      if (method === "bfs") {
        cur = frontier.shift() as { x: number; y: number };
      } else {
        cur = frontier.pop() as { x: number; y: number };
      }
      explored.push(cur);
      if (cur.x === end.x && cur.y === end.y) {
        found = true;
        // 回溯路径
        let p: { x: number; y: number } | null = end;
        while (p) {
          finalPath.unshift(p);
          p = parents[key(p.x, p.y)];
        }
        done = true;
        break;
      }
      for (const d of dirs) {
        const nx = cur.x + d.dx;
        const ny = cur.y + d.dy;
        if (isPath(maze.grid, nx, ny) && !visited[ny][nx]) {
          visited[ny][nx] = true;
          parents[key(nx, ny)] = cur;
          frontier.push({ x: nx, y: ny });
        }
      }
    }
    renderStep();
    if (!done) {
      setTimeout(step, 30);
    } else {
      setTimeout(step, 300);
    }
  };

  step();
}

function cmdShow(args: string[]): void {
  const { positional } = parseArgs(args);
  if (positional.length < 1) {
    console.log(ANSI.RED + "用法: show <maze-file>" + ANSI.RESET);
    return;
  }
  const file = positional[0];
  if (!fs.existsSync(file)) {
    console.log(ANSI.RED + `文件不存在: ${file}` + ANSI.RESET);
    return;
  }
  const maze = loadMaze(file);
  console.log(
    ANSI.BOLD +
      ANSI.CYAN +
      `===== 迷宫 ${maze.width}x${maze.height} =====` +
      ANSI.RESET
  );
  renderMaze(maze, { showStartEnd: true });
}

function showHelp(): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 迷宫生成器与求解器 =====" + ANSI.RESET);
  console.log("");
  console.log("命令:");
  console.log("  generate <w> <h> [-s seed] [-o file]   生成迷宫");
  console.log("  solve <maze-file> [-m bfs|dfs] [-o f]  求解迷宫");
  console.log("  animate <maze-file> [-m bfs|dfs]       动画展示求解过程");
  console.log("  show <maze-file>                       显示迷宫");
  console.log("  help / h                               显示帮助");
  console.log("  quit / q                               退出");
  console.log("");
  console.log("图例: █ 墙  S 起点  E 终点  ● 路径  · 已探索");
  console.log("");
  console.log("示例:");
  console.log("  generate 20 15 -s 42");
  console.log("  solve maze_20x15_42.txt -m bfs");
  console.log("  animate maze_20x15_42.txt -m dfs");
}

// ============== 主程序 ==============
function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // 进入交互式 shell
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "maze> ",
    });
    showHelp();
    rl.prompt();
    rl.on("line", (line: string) => {
      const parts = line.trim().split(/\s+/);
      const cmd = (parts[0] || "").toLowerCase();
      const rest = parts.slice(1);
      if (cmd === "quit" || cmd === "q" || cmd === "exit") {
        process.stdout.write(ANSI.SHOW_CURSOR);
        rl.close();
        return;
      }
      if (cmd === "help" || cmd === "h") {
        showHelp();
      } else if (cmd === "generate") {
        cmdGenerate(rest);
      } else if (cmd === "solve") {
        cmdSolve(rest);
      } else if (cmd === "animate") {
        cmdAnimate(rest);
      } else if (cmd === "show") {
        cmdShow(rest);
      } else if (cmd === "") {
        // no-op
      } else {
        console.log(ANSI.RED + `未知命令: ${cmd}` + ANSI.RESET);
      }
      rl.prompt();
    });
    rl.on("close", () => {
      process.stdout.write(ANSI.SHOW_CURSOR + ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    });
    return;
  }

  // 一次性命令
  const cmd = args[0].toLowerCase();
  const rest = args.slice(1);
  if (cmd === "help" || cmd === "h") {
    showHelp();
  } else if (cmd === "generate") {
    cmdGenerate(rest);
  } else if (cmd === "solve") {
    cmdSolve(rest);
  } else if (cmd === "animate") {
    cmdAnimate(rest);
  } else if (cmd === "show") {
    cmdShow(rest);
  } else {
    console.log(ANSI.RED + `未知命令: ${cmd}` + ANSI.RESET);
    showHelp();
    process.exit(1);
  }
}

main();
