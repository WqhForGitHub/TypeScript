#!/usr/bin/env node
/**
 * ASCII 艺术拼图小游戏 (Picture Sliding Puzzle)
 * ---------------------------------------------
 * 默认 3x3 (8-puzzle), 可选 4x4 (15-puzzle)。
 *
 * 支持两种模式：
 *   number  - 经典数字模式 (1..N-1, 空白格)
 *   picture - ASCII 艺术图片模式, 将内置图像切成 N 块后打乱, 还原原图
 *
 * 命令：
 *   u / d / l / r   空白格向上/下/左/右 移动 (相邻方块滑入空白)
 *   n               新游戏 (重新打乱)
 *   mode <m>        切换模式 (number / picture)
 *   size <n>        切换尺寸 (3 / 4)
 *   preview         预览原图 (1.5s 后关闭)
 *   q               退出
 *   h               帮助
 *
 * 显示：
 *   number 模式:   每格显示数字 (1..N-1) 或空格
 *   picture 模式:  每格显示 4 行 ASCII 图案片段, 拼对后可看到完整图案
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
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
};

type Mode = "number" | "picture";
type Dir = "U" | "D" | "L" | "R";

interface PuzzleState {
  size: number;
  mode: Mode;
  // 每块由字符串数组表示 (多行); number 模式下, 每块就是单字符
  tiles: string[][]; // 索引 0..N-1, 每个元素是该格的多行字符串
  order: number[]; // 当前每个位置上放的"原始块索引" (0..N-1); N-1 是空白块
  blank: number; // 空白在 order 中的位置索引
  moves: number;
  startTime: number;
  endTime: number | null;
  won: boolean;
  statusMsg: string;
}

// ============== 内置 ASCII 图 (用于 picture 模式) ==============
// 图案会被切成 size x size 块; 我们准备一个 12 行 x 36 列的图, 适合 3x3 (4 行 x 12 列每块)
// 与 4x4 (3 行 x 9 列每块)
const PICTURES: Array<{ name: string; lines: string[] }> = [
  {
    name: "Cat (猫)",
    lines: [
      "    /\\_/\\           ",
      "   ( o.o )          ",
      "    > ^ <           ",
      "   /|   |\\          ",
      "  (_|   |_)         ",
    ],
  },
  {
    name: "House (房子)",
    lines: [
      "       /\\          ",
      "      /  \\         ",
      "     /____\\        ",
      "    |  []  |       ",
      "    |      |       ",
      "    |__[][]|       ",
    ],
  },
  {
    name: "Star (星星)",
    lines: [
      "        *          ",
      "       ***         ",
      "      *****        ",
      "     *******       ",
      "      *****        ",
      "     *     *       ",
    ],
  },
];

// ============== 工具: 生成图块 ==============
function makeNumberTiles(n: number): string[][] {
  // n = size*size, 空白为 0
  const tiles: string[][] = [];
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      tiles.push(["   "]);
    } else {
      const v = (i + 1).toString();
      tiles.push([v.padStart(2, " ").padEnd(3, " ")]);
    }
  }
  return tiles;
}

function makePictureTiles(size: number, picIndex: number): string[][] {
  const pic = PICTURES[picIndex % PICTURES.length];
  const totalRows = pic.lines.length;
  const totalCols = Math.max(...pic.lines.map((l) => l.length));
  // 每块行数 / 列数 (向上取整以兼容不整除的情况)
  const rowsPerTile = Math.ceil(totalRows / size);
  const colsPerTile = Math.ceil(totalCols / size);

  // 把每行 pad 到 totalCols
  const padded = pic.lines.map((l) => l.padEnd(totalCols, " "));

  const tiles: string[][] = [];
  // 块的索引顺序: 从左到右, 从上到下; 最后一块 (n-1) 为空白
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      if (idx === size * size - 1) {
        // 空白块
        const blankTile: string[] = [];
        for (let rr = 0; rr < rowsPerTile; rr++) {
          blankTile.push(" ".repeat(colsPerTile));
        }
        tiles.push(blankTile);
        continue;
      }
      const lines: string[] = [];
      for (let rr = 0; rr < rowsPerTile; rr++) {
        const srcRow = r * rowsPerTile + rr;
        if (srcRow < totalRows) {
          const start = c * colsPerTile;
          const end = Math.min(start + colsPerTile, totalCols);
          lines.push(padded[srcRow].slice(start, end).padEnd(colsPerTile, " "));
        } else {
          lines.push(" ".repeat(colsPerTile));
        }
      }
      tiles.push(lines);
    }
  }
  return tiles;
}

// ============== 状态 ==============
function createSolvedState(size: number, mode: Mode, picIndex: number): PuzzleState {
  const n = size * size;
  let tiles: string[][];
  if (mode === "number") {
    tiles = makeNumberTiles(n);
  } else {
    tiles = makePictureTiles(size, picIndex);
  }
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
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

function isSolved(state: PuzzleState): boolean {
  for (let i = 0; i < state.order.length; i++) {
    if (state.order[i] !== i) return false;
  }
  return true;
}

function shuffle(state: PuzzleState, steps: number): void {
  const size = state.size;
  const dirs: Array<{ name: Dir; dr: number; dc: number }> = [
    { name: "U", dr: -1, dc: 0 },
    { name: "D", dr: 1, dc: 0 },
    { name: "L", dr: 0, dc: -1 },
    { name: "R", dr: 0, dc: 1 },
  ];
  let last = "";
  for (let i = 0; i < steps; i++) {
    const br = Math.floor(state.blank / size);
    const bc = state.blank % size;
    const valid = dirs.filter((d) => {
      const nr = br + d.dr;
      const nc = bc + d.dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) return false;
      if (
        (last === "U" && d.name === "D") ||
        (last === "D" && d.name === "U") ||
        (last === "L" && d.name === "R") ||
        (last === "R" && d.name === "L")
      )
        return false;
      return true;
    });
    if (valid.length === 0) continue;
    const d = valid[Math.floor(Math.random() * valid.length)];
    const nr = br + d.dr;
    const nc = bc + d.dc;
    const ni = nr * size + nc;
    [state.order[state.blank], state.order[ni]] = [
      state.order[ni],
      state.order[state.blank],
    ];
    state.blank = ni;
    last = d.name;
  }
  state.moves = 0;
  state.startTime = Date.now();
  state.endTime = null;
  state.won = false;
  state.statusMsg = "";
}

function moveBlank(state: PuzzleState, dir: Dir): boolean {
  if (state.won) return false;
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
  [state.order[state.blank], state.order[ni]] = [
    state.order[ni],
    state.order[state.blank],
  ];
  state.blank = ni;
  state.moves++;
  state.statusMsg = "";
  if (isSolved(state)) {
    state.won = true;
    state.endTime = Date.now();
    state.statusMsg = "恭喜完成!";
  }
  return true;
}

// ============== 渲染 ==============
function render(state: PuzzleState): void {
  const lines: string[] = [];
  lines.push(ANSI.BOLD + ANSI.CYAN + "===== 拼图小游戏 =====" + ANSI.RESET);
  const elapsed =
    state.endTime === null
      ? Math.floor((Date.now() - state.startTime) / 1000)
      : Math.floor((state.endTime - state.startTime) / 1000);
  lines.push(
    `模式: ${state.mode}   尺寸: ${state.size}x${state.size}   步数: ${state.moves}   用时: ${elapsed}s`
  );

  // 渲染网格
  const tilesHeight =
    state.mode === "number" ? 1 : state.tiles[0].length;
  const cellWidth =
    state.mode === "number" ? 3 : state.tiles[0][0].length;
  const sep =
    "+" + ("-".repeat(cellWidth + 2) + "+").repeat(state.size);

  for (let r = 0; r < state.size; r++) {
    lines.push(ANSI.GRAY + sep + ANSI.RESET);
    for (let h = 0; h < tilesHeight; h++) {
      let rowStr = ANSI.GRAY + "|" + ANSI.RESET;
      for (let c = 0; c < state.size; c++) {
        const pos = r * state.size + c;
        const tileIdx = state.order[pos];
        const tile = state.tiles[tileIdx];
        const isBlank = tileIdx === state.size * state.size - 1;
        let content: string;
        if (state.mode === "number") {
          content = (tile[0] as string).trim();
          if (isBlank) {
            content = "   ";
          } else {
            const isCorrect = tileIdx === pos;
            content = (isCorrect ? ANSI.GREEN : ANSI.YELLOW) +
              " " + (tile[0] as string).trim().padStart(2, " ") + " " +
              ANSI.RESET;
          }
        } else {
          const line = tile[h] ?? " ".repeat(cellWidth);
          const isCorrect = tileIdx === pos && !isBlank;
          if (isBlank) {
            content = " " + " ".repeat(cellWidth) + " ";
          } else if (isCorrect) {
            content = ANSI.GREEN + " " + line + " " + ANSI.RESET;
          } else {
            content = ANSI.YELLOW + " " + line + " " + ANSI.RESET;
          }
        }
        rowStr += content + ANSI.GRAY + "|" + ANSI.RESET;
      }
      lines.push(rowStr);
    }
  }
  lines.push(ANSI.GRAY + sep + ANSI.RESET);

  lines.push("");
  if (state.won) {
    lines.push(ANSI.GREEN + ANSI.BOLD + "===== 完成! =====" + ANSI.RESET);
    lines.push(`步数: ${state.moves}  用时: ${elapsed}s`);
    lines.push(ANSI.CYAN + "输入 n 重新开始, q 退出" + ANSI.RESET);
  } else {
    lines.push(
      ANSI.CYAN +
        "命令: u/d/l/r 移动  n 新游戏  mode <number|picture>  size <3|4>  preview 预览  q 退出" +
        ANSI.RESET
    );
  }
  if (state.statusMsg) {
    lines.push(ANSI.YELLOW + state.statusMsg + ANSI.RESET);
  }

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

function showPreview(state: PuzzleState, rl: readline.Interface): void {
  if (state.mode !== "picture") {
    state.statusMsg = "仅 picture 模式可预览";
    render(state);
    rl.prompt();
    return;
  }
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 原图预览 =====" + ANSI.RESET);
  const tilesHeight = state.tiles[0].length;
  for (let r = 0; r < state.size; r++) {
    for (let h = 0; h < tilesHeight; h++) {
      let rowStr = "";
      for (let c = 0; c < state.size; c++) {
        const idx = r * state.size + c;
        if (idx === state.size * state.size - 1) {
          rowStr += " ".repeat(state.tiles[0][0].length);
        } else {
          rowStr += state.tiles[idx][h] ?? "";
        }
      }
      console.log(rowStr);
    }
  }
  console.log(ANSI.GRAY + "1.5 秒后返回..." + ANSI.RESET);
  setTimeout(() => {
    render(state);
    rl.prompt();
  }, 1500);
}

// ============== 主程序 ==============
function main(): void {
  const args = process.argv.slice(2);
  let size = 3;
  let mode: Mode = "number";
  let picIndex = 0;

  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--size") {
      const s = parseInt(args[i + 1], 10);
      if (s === 3 || s === 4) size = s;
    }
    if (args[i] === "--mode") {
      const m = args[i + 1].toLowerCase();
      if (m === "number" || m === "picture") mode = m;
    }
    if (args[i] === "--picture") {
      const p = parseInt(args[i + 1], 10);
      if (!Number.isNaN(p)) picIndex = p;
    }
  }

  let state = createSolvedState(size, mode, picIndex);
  shuffle(state, size * size * 20);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "拼图> ",
  });

  render(state);
  rl.prompt();

  rl.on("line", (line: string) => {
    const parts = line.trim().toLowerCase().split(/\s+/);
    const cmd = parts[0] || "";

    if (cmd === "q" || cmd === "quit") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    }
    if (cmd === "h" || cmd === "help") {
      console.log("\n帮助:");
      console.log("  u/d/l/r          空白格向上/下/左/右移动");
      console.log("  n                新游戏");
      console.log("  mode <m>         切换模式 (number / picture)");
      console.log("  size <3|4>       切换尺寸");
      console.log("  preview          预览原图 (picture 模式)");
      console.log("  q                退出");
      render(state);
      rl.prompt();
      return;
    }
    if (cmd === "n") {
      const curMode = state.mode;
      const curSize = state.size;
      state = createSolvedState(curSize, curMode, picIndex);
      shuffle(state, curSize * curSize * 20);
      render(state);
      rl.prompt();
      return;
    }
    if (cmd === "mode") {
      const m = (parts[1] || "").toLowerCase();
      if (m !== "number" && m !== "picture") {
        state.statusMsg = "模式无效, 可选: number / picture";
        render(state);
        rl.prompt();
        return;
      }
      mode = m as Mode;
      state = createSolvedState(size, mode, picIndex);
      shuffle(state, size * size * 20);
      render(state);
      rl.prompt();
      return;
    }
    if (cmd === "size") {
      const s = parseInt(parts[1] || "", 10);
      if (s !== 3 && s !== 4) {
        state.statusMsg = "尺寸无效, 可选: 3 / 4";
        render(state);
        rl.prompt();
        return;
      }
      size = s;
      state = createSolvedState(size, mode, picIndex);
      shuffle(state, size * size * 20);
      render(state);
      rl.prompt();
      return;
    }
    if (cmd === "preview") {
      showPreview(state, rl);
      return;
    }
    if (cmd === "u" || cmd === "d" || cmd === "l" || cmd === "r") {
      moveBlank(state, cmd.toUpperCase() as Dir);
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
