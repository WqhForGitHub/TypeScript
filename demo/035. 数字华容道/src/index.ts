#!/usr/bin/env node
/**
 * 数字华容道 (15-puzzle / Number Sliding Puzzle)
 * ---------------------------------------------
 * 默认 4x4 (15 拼图)，可通过参数调整尺寸 (3x3, 4x4, 5x5)。
 *
 * 命令：
 *   u / d / l / r   将空白格 上 / 下 / 左 / 右 的数字滑入空白格
 *                   (即空白格向上/下/左/右移动)
 *   n               新游戏 (重新洗牌)
 *   s               自动求解 (A*, 仅对小棋盘推荐, 如 3x3)
 *   q               退出
 *   h               帮助
 *
 * 显示：
 *   数字 1..N-1 表示对应编号的方块
 *   空白格显示为两个空格
 *
 * 规则：
 *   - 通过滑动将数字按 1..N-1 顺序排列，最后留一个空白
 *   - 步数与时间均计入统计
 *   - 洗牌保证有解 (通过随机走步逆操作生成)
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

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
};

interface PuzzleState {
  size: number;
  tiles: number[]; // 0 表示空白, 1..N-1 表示数字
  blank: number; // 空白在 tiles 中的索引
  moves: number;
  startTime: number;
  endTime: number | null;
  won: boolean;
  solving: boolean;
  statusMsg: string;
}

const BEST_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".slidingpuzzle_best.json"
);

interface BestRecord {
  size: number;
  moves: number;
  seconds: number;
}

function loadBest(): BestRecord[] {
  try {
    if (fs.existsSync(BEST_FILE)) {
      const data = JSON.parse(fs.readFileSync(BEST_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch {
    /* 忽略 */
  }
  return [];
}

function saveBest(records: BestRecord[]): void {
  try {
    fs.writeFileSync(BEST_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch {
    /* 忽略 */
  }
}

function updateBest(state: PuzzleState): boolean {
  const seconds = Math.floor(
    ((state.endTime ?? Date.now()) - state.startTime) / 1000
  );
  const records = loadBest();
  const idx = records.findIndex((r) => r.size === state.size);
  let isBest = false;
  if (idx === -1) {
    records.push({ size: state.size, moves: state.moves, seconds });
    isBest = true;
  } else {
    const cur = records[idx];
    if (state.moves < cur.moves || (state.moves === cur.moves && seconds < cur.seconds)) {
      records[idx] = { size: state.size, moves: state.moves, seconds };
      isBest = true;
    }
  }
  saveBest(records);
  return isBest;
}

function getBestString(size: number): string {
  const r = loadBest().find((b) => b.size === size);
  return r ? `最佳: ${r.moves} 步 / ${r.seconds}s` : "暂无最佳";
}

// ============== 拼图核心 ==============
function createSolved(size: number): PuzzleState {
  const n = size * size;
  const tiles: number[] = [];
  for (let i = 1; i < n; i++) tiles.push(i);
  tiles.push(0);
  return {
    size,
    tiles,
    blank: n - 1,
    moves: 0,
    startTime: Date.now(),
    endTime: null,
    won: false,
    solving: false,
    statusMsg: "",
  };
}

function isSolved(state: PuzzleState): boolean {
  const n = state.tiles.length;
  for (let i = 0; i < n - 1; i++) {
    if (state.tiles[i] !== i + 1) return false;
  }
  return state.tiles[n - 1] === 0;
}

// 通过随机合法走步洗牌, 保证有解
function shuffle(state: PuzzleState, steps: number): void {
  const dirs = [
    { name: "U", dr: -1, dc: 0 },
    { name: "D", dr: 1, dc: 0 },
    { name: "L", dr: 0, dc: -1 },
    { name: "R", dr: 0, dc: 1 },
  ];
  let lastMove = "";
  for (let i = 0; i < steps; i++) {
    const size = state.size;
    const br = Math.floor(state.blank / size);
    const bc = state.blank % size;
    const valid = dirs.filter((d) => {
      const nr = br + d.dr;
      const nc = bc + d.dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) return false;
      // 避免立刻回退上一步
      if (
        (lastMove === "U" && d.name === "D") ||
        (lastMove === "D" && d.name === "U") ||
        (lastMove === "L" && d.name === "R") ||
        (lastMove === "R" && d.name === "L")
      )
        return false;
      return true;
    });
    if (valid.length === 0) continue;
    const d = valid[Math.floor(Math.random() * valid.length)];
    const nr = br + d.dr;
    const nc = bc + d.dc;
    const ni = nr * size + nc;
    [state.tiles[state.blank], state.tiles[ni]] = [
      state.tiles[ni],
      state.tiles[state.blank],
    ];
    state.blank = ni;
    lastMove = d.name;
  }
  state.moves = 0;
  state.startTime = Date.now();
  state.endTime = null;
  state.won = false;
  state.statusMsg = "";
}

// 输入 u/d/l/r: 空白格向该方向移动
// 即: 空白格相邻方向上的数字滑入空白格
function moveBlank(state: PuzzleState, dir: "U" | "D" | "L" | "R"): boolean {
  if (state.won || state.solving) return false;
  const size = state.size;
  const br = Math.floor(state.blank / size);
  const bc = state.blank % size;
  let nr = br;
  let nc = bc;
  if (dir === "U") nr--;
  else if (dir === "D") nr++;
  else if (dir === "L") nc--;
  else if (dir === "R") nc++;
  if (nr < 0 || nr >= size || nc < 0 || nc >= size) {
    state.statusMsg = "无法向该方向移动";
    return false;
  }
  const ni = nr * size + nc;
  [state.tiles[state.blank], state.tiles[ni]] = [
    state.tiles[ni],
    state.tiles[state.blank],
  ];
  state.blank = ni;
  state.moves++;
  state.statusMsg = "";
  if (isSolved(state)) {
    state.won = true;
    state.endTime = Date.now();
    const isBest = updateBest(state);
    state.statusMsg = isBest ? "恭喜! 创造新纪录!" : "恭喜完成!";
  }
  return true;
}

// ============== A* 自动求解 ==============
// 仅推荐用于 3x3, 4x4 也可 (可能耗时)
// 状态以 tiles 数组的字符串作为 key
type Dir = "U" | "D" | "L" | "R";

interface Node {
  tiles: number[];
  blank: number;
  g: number;
  h: number;
  f: number;
  path: Dir[];
  key: string;
}

function manhattan(tiles: number[], size: number): number {
  let total = 0;
  for (let i = 0; i < tiles.length; i++) {
    const v = tiles[i];
    if (v === 0) continue;
    const targetR = Math.floor((v - 1) / size);
    const targetC = (v - 1) % size;
    const r = Math.floor(i / size);
    const c = i % size;
    total += Math.abs(r - targetR) + Math.abs(c - targetC);
  }
  return total;
}

function tilesKey(tiles: number[]): string {
  return tiles.join(",");
}

function neighbors(node: Node, size: number): Node[] {
  const result: Node[] = [];
  const br = Math.floor(node.blank / size);
  const bc = node.blank % size;
  const dirs: Array<{ name: Dir; dr: number; dc: number }> = [
    { name: "U", dr: -1, dc: 0 },
    { name: "D", dr: 1, dc: 0 },
    { name: "L", dr: 0, dc: -1 },
    { name: "R", dr: 0, dc: 1 },
  ];
  for (const d of dirs) {
    const nr = br + d.dr;
    const nc = bc + d.dc;
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
    const ni = nr * size + nc;
    const newTiles = node.tiles.slice();
    [newTiles[node.blank], newTiles[ni]] = [newTiles[ni], newTiles[node.blank]];
    const key = tilesKey(newTiles);
    const h = manhattan(newTiles, size);
    const g = node.g + 1;
    const newPath = node.path.concat(d.name);
    result.push({
      tiles: newTiles,
      blank: ni,
      g,
      h,
      f: g + h,
      path: newPath,
      key,
    });
  }
  return result;
}

// A* 求解, 返回移动序列 (限步数防卡死)
function solveAStar(state: PuzzleState, maxIterations = 200000): Dir[] | null {
  const size = state.size;
  const start: Node = {
    tiles: state.tiles.slice(),
    blank: state.blank,
    g: 0,
    h: manhattan(state.tiles, size),
    f: 0,
    path: [],
    key: tilesKey(state.tiles),
  };
  start.f = start.g + start.h;
  const targetKey = tilesKey(createSolved(size).tiles);

  const open: Node[] = [start];
  const closed = new Set<string>();
  let iters = 0;

  while (open.length > 0) {
    iters++;
    if (iters > maxIterations) return null;
    // 取 f 最小
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0];
    if (cur.key === targetKey) return cur.path;
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);
    const ns = neighbors(cur, size);
    for (const n of ns) {
      if (closed.has(n.key)) continue;
      open.push(n);
    }
  }
  return null;
}

// ============== 渲染 ==============
function render(state: PuzzleState): void {
  const lines: string[] = [];
  lines.push(ANSI.BOLD + ANSI.CYAN + "===== 数字华容道 =====" + ANSI.RESET);
  const elapsed =
    state.endTime === null
      ? Math.floor((Date.now() - state.startTime) / 1000)
      : Math.floor((state.endTime - state.startTime) / 1000);
  lines.push(
    `尺寸: ${state.size}x${state.size}   步数: ${state.moves}   用时: ${elapsed}s   ` +
      getBestString(state.size)
  );

  const cellWidth = state.size >= 5 ? 4 : 3;
  const sep = "+" + ("-".repeat(cellWidth) + "+").repeat(state.size);
  for (let r = 0; r < state.size; r++) {
    lines.push(ANSI.GRAY + sep + ANSI.RESET);
    let row = ANSI.GRAY + "|" + ANSI.RESET;
    for (let c = 0; c < state.size; c++) {
      const idx = r * state.size + c;
      const v = state.tiles[idx];
      if (v === 0) {
        row += " ".repeat(cellWidth) + ANSI.GRAY + "|" + ANSI.RESET;
      } else {
        const isCorrect = v === idx + 1;
        const text = v.toString().padStart(cellWidth - 1) + " ";
        if (isCorrect) {
          row += ANSI.GREEN + text + ANSI.RESET + ANSI.GRAY + "|" + ANSI.RESET;
        } else {
          row += ANSI.YELLOW + text + ANSI.RESET + ANSI.GRAY + "|" + ANSI.RESET;
        }
      }
    }
    lines.push(row);
  }
  lines.push(ANSI.GRAY + sep + ANSI.RESET);

  lines.push("");
  if (state.won) {
    lines.push(
      ANSI.GREEN +
        ANSI.BOLD +
        `===== 完成! 步数: ${state.moves} 用时: ${elapsed}s =====` +
        ANSI.RESET
    );
    lines.push(ANSI.CYAN + "输入 n 重新开始, q 退出" + ANSI.RESET);
  } else {
    lines.push(
      ANSI.CYAN +
        "命令: u/d/l/r 滑动  n 新游戏  s 自动求解  h 帮助  q 退出" +
        ANSI.RESET
    );
  }
  if (state.statusMsg) {
    lines.push(ANSI.YELLOW + state.statusMsg + ANSI.RESET);
  }

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

function playSolution(state: PuzzleState, solution: Dir[], rl: readline.Interface): void {
  state.solving = true;
  let i = 0;
  const step = () => {
    if (i >= solution.length || state.won) {
      state.solving = false;
      render(state);
      rl.prompt();
      return;
    }
    moveBlank(state, solution[i]);
    i++;
    render(state);
    setTimeout(step, 200);
  };
  step();
}

// ============== 主程序 ==============
function main(): void {
  const args = process.argv.slice(2);
  let size = 4;
  if (args.length >= 1) {
    const s = parseInt(args[0], 10);
    if (!Number.isNaN(s) && s >= 2 && s <= 6) size = s;
  }

  const state = createSolved(size);
  // 初始洗牌
  shuffle(state, size * size * 20);
  state.startTime = Date.now();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "华容道> ",
  });

  render(state);
  rl.prompt();

  rl.on("line", (line: string) => {
    const input = line.trim().toLowerCase();
    if (input === "q") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    }
    if (input === "h") {
      console.log("\n帮助:");
      console.log("  u/d/l/r  空白格向上/下/左/右移动 (即对应方向上的数字滑入空白)");
      console.log("  n        新游戏 (重新洗牌)");
      console.log("  s        自动求解 (A*, 3x3 推荐)");
      console.log("  q        退出");
      render(state);
      rl.prompt();
      return;
    }
    if (input === "n") {
      shuffle(state, size * size * 20);
      state.startTime = Date.now();
      state.statusMsg = "新游戏已开始";
      render(state);
      rl.prompt();
      return;
    }
    if (input === "s") {
      if (state.won) {
        state.statusMsg = "已经完成, 无需求解";
        render(state);
        rl.prompt();
        return;
      }
      state.statusMsg = "正在求解中...";
      render(state);
      // 异步求解避免阻塞
      setTimeout(() => {
        const sol = solveAStar(state);
        if (!sol) {
          state.statusMsg = "求解失败 (步数超限或不可解)";
          state.solving = false;
          render(state);
          rl.prompt();
          return;
        }
        state.statusMsg = `已找到 ${sol.length} 步解, 自动播放中...`;
        render(state);
        playSolution(state, sol, rl);
      }, 50);
      return;
    }
    if (input === "u" || input === "d" || input === "l" || input === "r") {
      moveBlank(state, input.toUpperCase() as Dir);
      render(state);
      rl.prompt();
      return;
    }
    state.statusMsg = "未知命令, 输入 h 查看帮助";
    render(state);
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
