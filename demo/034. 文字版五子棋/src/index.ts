#!/usr/bin/env node
/**
 * 文字版五子棋 (Text-based Gomoku / Five in a Row)
 * -----------------------------------------------
 * 15x15 棋盘，黑棋 (●) 先手，白棋 (○) 后手。
 *
 * 模式：
 *   pvp  - 玩家 vs 玩家
 *   pvc  - 玩家(黑) vs AI(白)
 *
 * 输入坐标：字母列 + 数字行, 例如 H8 表示第 H 列第 8 行。
 *   列 A-O, 行 1-15。
 *
 * 命令：
 *   <coord>     落子，如 H8
 *   u           悔棋 (撤销上一步)
 *   r           重新开始
 *   m           返回菜单
 *   q           退出
 *
 * 规则：
 *   - 横/竖/斜/反斜四个方向任意方向 5 子连珠获胜
 *   - 超过 5 子 (六子) 视为禁手失败由用户判断 (本程序仅检测 >=5 即胜)
 *
 * AI：
 *   - 启发式评估每个候选点，综合考虑进攻与防守
 *   - 检测连五、活四、冲四、活三、眠三、活二等棋型
 *   - 优先阻止对方活四/冲四
 */

import * as readline from "readline";

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

const BOARD_SIZE = 15;

type Stone = "B" | "W" | " "; // Black / White / Empty
type Board = Stone[][];
type GameMode = "pvp" | "pvc";

interface Move {
  x: number;
  y: number;
  stone: Stone;
}

interface GameState {
  board: Board;
  mode: GameMode;
  current: Stone; // 当前轮到谁
  history: Move[];
  winner: Stone | "draw" | null;
  winLine: number[][] | null;
  statusMsg: string;
}

const COL_LETTERS = "ABCDEFGHIJKLMNO".split("");

function emptyBoard(): Board {
  const b: Board = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    b.push(new Array<Stone>(BOARD_SIZE).fill(" "));
  }
  return b;
}

function newGame(mode: GameMode): GameState {
  return {
    board: emptyBoard(),
    mode,
    current: "B",
    history: [],
    winner: null,
    winLine: null,
    statusMsg: "",
  };
}

// 检查是否五连，返回连珠坐标列表
function checkWin(board: Board, x: number, y: number, stone: Stone): number[][] | null {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of dirs) {
    const line: number[][] = [[x, y]];
    // 正向
    let nx = x + dx;
    let ny = y + dy;
    while (
      nx >= 0 &&
      nx < BOARD_SIZE &&
      ny >= 0 &&
      ny < BOARD_SIZE &&
      board[ny][nx] === stone
    ) {
      line.push([nx, ny]);
      nx += dx;
      ny += dy;
    }
    // 反向
    nx = x - dx;
    ny = y - dy;
    while (
      nx >= 0 &&
      nx < BOARD_SIZE &&
      ny >= 0 &&
      ny < BOARD_SIZE &&
      board[ny][nx] === stone
    ) {
      line.unshift([nx, ny]);
      nx -= dx;
      ny -= dy;
    }
    if (line.length >= 5) return line;
  }
  return null;
}

function isBoardFull(board: Board): boolean {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === " ") return false;
    }
  }
  return true;
}

function parseCoord(input: string): { x: number; y: number } | null {
  const s = input.trim().toUpperCase();
  if (s.length < 2) return null;
  const colCh = s[0];
  const rowStr = s.slice(1);
  const x = COL_LETTERS.indexOf(colCh);
  const y = parseInt(rowStr, 10) - 1;
  if (x < 0 || x >= BOARD_SIZE) return null;
  if (Number.isNaN(y) || y < 0 || y >= BOARD_SIZE) return null;
  return { x, y };
}

function coordLabel(x: number, y: number): string {
  return `${COL_LETTERS[x]}${y + 1}`;
}

// ============== AI 评估 ==============
// 评估一个点对于某方在某个方向上的棋型分数
// 通过提取该方向上的字符串模式进行匹配
const PATTERNS: Array<{ pattern: string; score: number; name: string }> = [
  { pattern: "XXXXX", score: 100000, name: "连五" },
  { pattern: "_XXXX_", score: 10000, name: "活四" },
  { pattern: "_XXXX", score: 1000, name: "冲四" },
  { pattern: "XXXX_", score: 1000, name: "冲四" },
  { pattern: "X_XXX", score: 1000, name: "冲四" },
  { pattern: "XXX_X", score: 1000, name: "冲四" },
  { pattern: "XX_XX", score: 1000, name: "冲四" },
  { pattern: "_XXX_", score: 500, name: "活三" },
  { pattern: "_XX_X_", score: 300, name: "跳三" },
  { pattern: "_X_XX_", score: 300, name: "跳三" },
  { pattern: "_XXX", score: 100, name: "眠三" },
  { pattern: "XXX_", score: 100, name: "眠三" },
  { pattern: "_XX_", score: 50, name: "活二" },
  { pattern: "_X_X_", score: 30, name: "跳二" },
  { pattern: "_X_", score: 10, name: "活一" },
];

function getLineString(
  board: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  stone: Stone
): string {
  // 取以为中心、方向上的 9 格窗口
  let s = "";
  for (let i = -4; i <= 4; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) {
      s += "#"; // 边界
    } else {
      const v = board[ny][nx];
      if (v === " ") s += "_";
      else if (v === stone) s += "X";
      else s += "O";
    }
  }
  return s;
}

function evaluatePoint(board: Board, x: number, y: number, stone: Stone): number {
  if (board[y][x] !== " ") return -1;
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let total = 0;
  for (const [dx, dy] of dirs) {
    const lineStr = getLineString(board, x, y, dx, dy, stone);
    let best = 0;
    for (const p of PATTERNS) {
      if (lineStr.includes(p.pattern)) {
        if (p.score > best) best = p.score;
      }
    }
    total += best;
  }
  return total;
}

function aiMove(board: Board, aiStone: Stone): { x: number; y: number } {
  const human: Stone = aiStone === "B" ? "W" : "B";
  let bestScore = -Infinity;
  let bestMoves: Array<{ x: number; y: number }> = [];

  // 仅考虑已有棋子周围 2 格内的空位 (减少搜索范围)
  const candidates = new Set<string>();
  let hasStone = false;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== " ") {
        hasStone = true;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (
              nx >= 0 &&
              nx < BOARD_SIZE &&
              ny >= 0 &&
              ny < BOARD_SIZE &&
              board[ny][nx] === " "
            ) {
              candidates.add(`${nx},${ny}`);
            }
          }
        }
      }
    }
  }
  // 若棋盘空, 直接下中央
  if (!hasStone) {
    return { x: 7, y: 7 };
  }

  for (const key of candidates) {
    const [xStr, yStr] = key.split(",");
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    const offense = evaluatePoint(board, x, y, aiStone);
    const defense = evaluatePoint(board, x, y, human);
    // 进攻略大于防守
    const score = offense * 1.1 + defense;
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [{ x, y }];
    } else if (score === bestScore) {
      bestMoves.push({ x, y });
    }
  }
  if (bestMoves.length === 0) {
    // fallback
    return { x: 7, y: 7 };
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

// ============== 渲染 ==============
function render(state: GameState): void {
  const lines: string[] = [];
  lines.push(ANSI.BOLD + ANSI.CYAN + "===== 文字版五子棋 =====" + ANSI.RESET);
  lines.push(
    `模式: ${state.mode}   当前: ${formatStone(state.current)}` +
      (state.winner ? `   结果: ${formatWinner(state)}` : "") +
      `   历史: ${state.history.length} 步`
  );

  // 列头
  let header = "   ";
  for (let x = 0; x < BOARD_SIZE; x++) {
    header += COL_LETTERS[x] + " ";
  }
  lines.push(ANSI.GRAY + header + ANSI.RESET);

  const winSet = new Set<string>();
  if (state.winLine) {
    for (const [x, y] of state.winLine) winSet.add(`${x},${y}`);
  }

  for (let y = 0; y < BOARD_SIZE; y++) {
    let rowStr = ANSI.GRAY + (y + 1).toString().padStart(2, " ") + " " + ANSI.RESET;
    for (let x = 0; x < BOARD_SIZE; x++) {
      const v = state.board[y][x];
      if (v === " ") {
        rowStr += ANSI.GRAY + "+" + ANSI.RESET + " ";
      } else if (winSet.has(`${x},${y}`)) {
        rowStr += ANSI.BOLD + ANSI.YELLOW + (v === "B" ? "●" : "○") + ANSI.RESET + " ";
      } else if (v === "B") {
        rowStr += ANSI.RED + "●" + ANSI.RESET + " ";
      } else {
        rowStr += ANSI.GREEN + "○" + ANSI.RESET + " ";
      }
    }
    lines.push(rowStr);
  }

  lines.push("");
  lines.push(
    ANSI.CYAN +
      "输入坐标 (如 H8) 落子  u 悔棋  r 重新开始  m 返回菜单  q 退出" +
      ANSI.RESET
  );
  if (state.statusMsg) {
    lines.push(ANSI.YELLOW + state.statusMsg + ANSI.RESET);
  }

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

function formatStone(s: Stone): string {
  if (s === "B") return ANSI.RED + "● 黑" + ANSI.RESET;
  if (s === "W") return ANSI.GREEN + "○ 白" + ANSI.RESET;
  return "";
}

function formatWinner(state: GameState): string {
  if (state.winner === "draw") return "平局";
  if (state.winner === "B") return ANSI.RED + "● 黑胜" + ANSI.RESET;
  if (state.winner === "W") return ANSI.GREEN + "○ 白胜" + ANSI.RESET;
  return "";
}

// ============== 游戏操作 ==============
function applyMove(state: GameState, x: number, y: number): boolean {
  if (state.winner) return false;
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
    state.statusMsg = "坐标越界";
    return false;
  }
  if (state.board[y][x] !== " ") {
    state.statusMsg = "该位置已被占用";
    return false;
  }
  state.board[y][x] = state.current;
  state.history.push({ x, y, stone: state.current });

  const winLine = checkWin(state.board, x, y, state.current);
  if (winLine) {
    state.winner = state.current;
    state.winLine = winLine;
    state.statusMsg = `${state.current === "B" ? "黑" : "白"} 胜利!`;
    return true;
  }
  if (isBoardFull(state.board)) {
    state.winner = "draw";
    state.statusMsg = "平局!";
    return true;
  }
  state.current = state.current === "B" ? "W" : "B";
  state.statusMsg = "";
  return true;
}

function undo(state: GameState): void {
  if (state.history.length === 0) {
    state.statusMsg = "无棋可悔";
    return;
  }
  // pvc 模式下, 悔棋撤销玩家+AI 两步
  const steps = state.mode === "pvc" && state.history.length >= 2 ? 2 : 1;
  for (let i = 0; i < steps; i++) {
    const last = state.history.pop();
    if (!last) break;
    state.board[last.y][last.x] = " ";
    state.current = last.stone;
  }
  state.winner = null;
  state.winLine = null;
  state.statusMsg = "已悔棋";
}

// ============== 主程序 ==============
function showMenu(): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 文字版五子棋 =====" + ANSI.RESET);
  console.log("请选择模式:");
  console.log("  1 / pvp  - 玩家 vs 玩家");
  console.log("  2 / pvc  - 玩家(黑) vs AI(白)");
  console.log("  q        - 退出");
}

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let state: GameState | null = null;
  let inMenu = true;

  showMenu();
  rl.setPrompt("选择> ");
  rl.prompt();

  const refresh = () => {
    if (state) render(state);
  };

  rl.on("line", (line: string) => {
    const input = line.trim().toLowerCase();

    if (inMenu) {
      if (input === "1" || input === "pvp") {
        state = newGame("pvp");
        inMenu = false;
        refresh();
        rl.setPrompt("落子> ");
      } else if (input === "2" || input === "pvc") {
        state = newGame("pvc");
        inMenu = false;
        refresh();
        rl.setPrompt("落子> ");
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

    if (!state) return;

    if (input === "q") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    }
    if (input === "m") {
      inMenu = true;
      state = null;
      showMenu();
      rl.setPrompt("选择> ");
      rl.prompt();
      return;
    }
    if (input === "r") {
      const m = state.mode;
      state = newGame(m);
      refresh();
      rl.prompt();
      return;
    }
    if (input === "u") {
      undo(state);
      refresh();
      rl.prompt();
      return;
    }

    const coord = parseCoord(input);
    if (!coord) {
      state.statusMsg = "坐标无效, 示例: H8";
      refresh();
      rl.prompt();
      return;
    }

    const ok = applyMove(state, coord.x, coord.y);
    if (ok && !state.winner && state.mode === "pvc") {
      // AI 走棋
      const ai = aiMove(state.board, "W");
      applyMove(state, ai.x, ai.y);
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
