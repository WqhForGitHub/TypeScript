#!/usr/bin/env node
/**
 * 文字版扫雷游戏 (Text-based Minesweeper)
 * ---------------------------------------
 * 默认 9x9 棋盘，10 颗雷（可配置）。
 *
 * 命令：
 *   r <x> <y>      揭开 (x, y) 单元格
 *   f <x> <y>      标记/取消标记 旗帜
 *   c <x> <y>      和弦 (chord) - 当该数字格周围旗帜数等于数字时，揭开周围未标记格
 *   n              新游戏
 *   q              退出
 *   h              显示帮助
 *
 * 显示：
 *   . 未揭开
 *   F 已标记
 *   1-8 周围雷数
 *   * 雷（游戏结束时显示）
 *   空格 周围无雷
 *
 * 规则：
 *   - 首次点击保证不踩雷（点击前才生成雷图）
 *   - 揭开 0 周围自动递归展开
 *   - 揭开所有非雷单元格获胜
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

interface Cell {
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  adjacent: number; // 周围雷数
}

interface Board {
  width: number;
  height: number;
  mineCount: number;
  cells: Cell[][];
  firstClickDone: boolean;
  gameOver: boolean;
  won: boolean;
  startTime: number | null;
  endTime: number | null;
}

const BEST_TIME_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".minesweeper_best.txt"
);

function loadBestTime(): number | null {
  try {
    if (fs.existsSync(BEST_TIME_FILE)) {
      const n = parseInt(fs.readFileSync(BEST_TIME_FILE, "utf-8").trim(), 10);
      return Number.isNaN(n) ? null : n;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

function saveBestTime(seconds: number): void {
  try {
    fs.writeFileSync(BEST_TIME_FILE, String(seconds), "utf-8");
  } catch {
    /* 忽略 */
  }
}

function createBoard(width: number, height: number, mineCount: number): Board {
  const cells: Cell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        adjacent: 0,
      });
    }
    cells.push(row);
  }
  return {
    width,
    height,
    mineCount,
    cells,
    firstClickDone: false,
    gameOver: false,
    won: false,
    startTime: null,
    endTime: null,
  };
}

// 首次点击后才放置雷，避免第一次踩雷
function placeMines(board: Board, safeX: number, safeY: number): void {
  const safeZone = new Set<string>();
  // 点击的格子及其周围 8 格均为安全
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = safeX + dx;
      const ny = safeY + dy;
      if (nx >= 0 && nx < board.width && ny >= 0 && ny < board.height) {
        safeZone.add(`${nx},${ny}`);
      }
    }
  }

  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (!safeZone.has(`${x},${y}`)) {
        candidates.push({ x, y });
      }
    }
  }

  // 洗牌
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const minesToPlace = Math.min(board.mineCount, candidates.length);
  for (let i = 0; i < minesToPlace; i++) {
    const { x, y } = candidates[i];
    board.cells[y][x].isMine = true;
  }

  // 计算 adjacent
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.cells[y][x].isMine) continue;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < board.width && ny >= 0 && ny < board.height) {
            if (board.cells[ny][nx].isMine) count++;
          }
        }
      }
      board.cells[y][x].adjacent = count;
    }
  }
}

function revealCell(board: Board, x: number, y: number): void {
  if (board.gameOver) return;
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return;
  const cell = board.cells[y][x];
  if (cell.isRevealed || cell.isFlagged) return;

  if (!board.firstClickDone) {
    placeMines(board, x, y);
    board.firstClickDone = true;
    board.startTime = Date.now();
  }

  cell.isRevealed = true;

  if (cell.isMine) {
    board.gameOver = true;
    board.endTime = Date.now();
    // 揭开所有雷
    for (let yy = 0; yy < board.height; yy++) {
      for (let xx = 0; xx < board.width; xx++) {
        if (board.cells[yy][xx].isMine) {
          board.cells[yy][xx].isRevealed = true;
        }
      }
    }
    return;
  }

  // 若是 0，递归揭开周围
  if (cell.adjacent === 0) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        revealCell(board, x + dx, y + dy);
      }
    }
  }

  checkWin(board);
}

function toggleFlag(board: Board, x: number, y: number): void {
  if (board.gameOver) return;
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return;
  const cell = board.cells[y][x];
  if (cell.isRevealed) return;
  cell.isFlagged = !cell.isFlagged;
}

function chord(board: Board, x: number, y: number): void {
  if (board.gameOver) return;
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return;
  const cell = board.cells[y][x];
  if (!cell.isRevealed || cell.adjacent === 0 || cell.isMine) return;

  let flagCount = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < board.width && ny >= 0 && ny < board.height) {
        if (board.cells[ny][nx].isFlagged) flagCount++;
      }
    }
  }

  if (flagCount === cell.adjacent) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < board.width && ny >= 0 && ny < board.height) {
          const neighbor = board.cells[ny][nx];
          if (!neighbor.isFlagged && !neighbor.isRevealed) {
            revealCell(board, nx, ny);
            if (board.gameOver) return;
          }
        }
      }
    }
  }
}

function checkWin(board: Board): void {
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const cell = board.cells[y][x];
      if (!cell.isMine && !cell.isRevealed) return;
    }
  }
  board.won = true;
  board.gameOver = true;
  board.endTime = Date.now();
  // 标记所有雷
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.cells[y][x].isMine) board.cells[y][x].isFlagged = true;
    }
  }
}

function cellDisplay(cell: Cell, gameOver: boolean): string {
  if (cell.isFlagged) return ANSI.RED + "F" + ANSI.RESET;
  if (!cell.isRevealed) return ANSI.GRAY + "." + ANSI.RESET;
  if (cell.isMine) return gameOver ? ANSI.RED + "*" + ANSI.RESET : ANSI.GRAY + "." + ANSI.RESET;
  if (cell.adjacent === 0) return " ";
  const colorMap: Record<number, string> = {
    1: ANSI.BLUE,
    2: ANSI.GREEN,
    3: ANSI.RED,
    4: ANSI.CYAN,
    5: ANSI.YELLOW,
    6: ANSI.BOLD + ANSI.CYAN,
    7: ANSI.BOLD + ANSI.RED,
    8: ANSI.GRAY,
  };
  return colorMap[cell.adjacent] + String(cell.adjacent) + ANSI.RESET;
}

function render(board: Board): void {
  const lines: string[] = [];
  lines.push(ANSI.BOLD + ANSI.CYAN + "===== 文字版扫雷 =====" + ANSI.RESET);
  const elapsed =
    board.startTime === null
      ? 0
      : Math.floor(((board.endTime ?? Date.now()) - board.startTime) / 1000);
  let flagCount = 0;
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.cells[y][x].isFlagged) flagCount++;
    }
  }
  lines.push(
    `大小: ${board.width}x${board.height}  雷数: ${board.mineCount}  ` +
      `旗帜: ${flagCount}  时间: ${elapsed}s`
  );

  // 列号
  const colHeader =
    "   " +
    Array.from({ length: board.width }, (_, i) =>
      (i % 10).toString()
    ).join(" ");
  lines.push(ANSI.GRAY + colHeader + ANSI.RESET);

  for (let y = 0; y < board.height; y++) {
    let row = ANSI.GRAY + (y % 10).toString() + "  " + ANSI.RESET;
    for (let x = 0; x < board.width; x++) {
      row += cellDisplay(board.cells[y][x], board.gameOver) + " ";
    }
    lines.push(row);
  }

  lines.push("");
  if (board.gameOver) {
    if (board.won) {
      lines.push(
        ANSI.GREEN + ANSI.BOLD + "===== 恭喜胜利! =====" + ANSI.RESET
      );
      const best = loadBestTime();
      if (best === null || elapsed < best) {
        saveBestTime(elapsed);
        lines.push(
          ANSI.YELLOW + `★ 新的最佳时间: ${elapsed}s ★` + ANSI.RESET
        );
      } else {
        lines.push(ANSI.CYAN + `本局用时: ${elapsed}s  最佳: ${best}s` + ANSI.RESET);
      }
    } else {
      lines.push(ANSI.RED + ANSI.BOLD + "===== 踩到雷, 游戏结束 =====" + ANSI.RESET);
    }
    lines.push(ANSI.CYAN + "输入 n 开始新游戏, q 退出" + ANSI.RESET);
  } else {
    lines.push("命令: r <x> <y> 揭开  f <x> <y> 标记  c <x> <y> 和弦  n 新游戏  q 退出");
  }

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

function parseAndExecute(board: Board, line: string): Board {
  const parts = line.trim().toLowerCase().split(/\s+/);
  const cmd = parts[0];

  if (cmd === "n") {
    return createBoard(board.width, board.height, board.mineCount);
  }
  if (cmd === "q") {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  }
  if (cmd === "h") {
    console.log("\n帮助:");
    console.log("  r <x> <y>  揭开格子");
    console.log("  f <x> <y>  标记/取消旗帜");
    console.log("  c <x> <y>  和弦 (周围旗帜数等于数字时揭开周围)");
    console.log("  n          新游戏");
    console.log("  q          退出");
    return board;
  }

  const x = parts.length >= 2 ? parseInt(parts[1], 10) : NaN;
  const y = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
  if (Number.isNaN(x) || Number.isNaN(y)) {
    console.log(ANSI.RED + "坐标无效, 示例: r 3 4" + ANSI.RESET);
    return board;
  }

  if (cmd === "r") revealCell(board, x, y);
  else if (cmd === "f") toggleFlag(board, x, y);
  else if (cmd === "c") chord(board, x, y);
  else {
    console.log(ANSI.RED + "未知命令, 输入 h 查看帮助" + ANSI.RESET);
  }
  return board;
}

function main(): void {
  const args = process.argv.slice(2);
  let width = 9;
  let height = 9;
  let mineCount = 10;

  // 简单参数解析: --width 9 --height 9 --mines 10 或 w h m
  if (args.length >= 3) {
    const a = parseInt(args[0], 10);
    const b = parseInt(args[1], 10);
    const c = parseInt(args[2], 10);
    if (!Number.isNaN(a) && !Number.isNaN(b) && !Number.isNaN(c)) {
      width = a;
      height = b;
      mineCount = c;
    }
  }
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--width") width = parseInt(args[i + 1], 10) || width;
    if (args[i] === "--height") height = parseInt(args[i + 1], 10) || height;
    if (args[i] === "--mines") mineCount = parseInt(args[i + 1], 10) || mineCount;
  }

  if (mineCount >= width * height - 9) {
    mineCount = Math.max(1, width * height - 9);
  }

  let board = createBoard(width, height, mineCount);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "扫雷> ",
  });

  render(board);
  rl.prompt();

  rl.on("line", (line: string) => {
    if (line.trim() === "") {
      render(board);
      rl.prompt();
      return;
    }
    board = parseAndExecute(board, line);
    render(board);
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
