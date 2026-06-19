#!/usr/bin/env node
/**
 * 文字版井字棋 (Text-based Tic-Tac-Toe)
 * ------------------------------------
 * 棋盘 3x3, 位置编号 1-9:
 *   1 | 2 | 3
 *   4 | 5 | 6
 *   7 | 8 | 9
 *
 * 模式：
 *   pvp   玩家 vs 玩家
 *   pvc   玩家 vs AI (玩家执 X, AI 执 O, AI 使用 minimax 最优策略)
 *   cvc   AI vs AI 自动演示
 *
 * 命令：
 *   <1-9>        在对应位置落子 (玩家回合)
 *   <回车>       cvc 模式继续下一步
 *   r            重新开始
 *   m            返回菜单选择模式
 *   q            退出
 *
 * 规则：
 *   - X 先手
 *   - 三子连珠 (横/竖/斜) 获胜
 *   - 棋盘填满未分胜负为平局
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

type Player = "X" | "O";
type Cell = Player | " ";
type Board = Cell[]; // 长度 9, 索引 0-8 对应位置 1-9

type GameMode = "pvp" | "pvc" | "cvc";

interface GameResult {
  winner: Player | "draw" | null;
  line: number[] | null; // 获胜的三连索引
}

const WIN_LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8], // 横
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8], // 竖
  [0, 4, 8],
  [2, 4, 6], // 斜
];

function emptyBoard(): Board {
  return Array(9).fill(" ");
}

function checkResult(board: Board): GameResult {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] !== " " && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] as Player, line };
    }
  }
  if (board.every((c) => c !== " ")) {
    return { winner: "draw", line: null };
  }
  return { winner: null, line: null };
}

function availableMoves(board: Board): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === " ") moves.push(i);
  }
  return moves;
}

// ============== Minimax AI ==============
// 返回 { score, index }
// score: 10 表示 AI (maximizing) 胜, -10 表示对手 (minimizing) 胜, 0 平局或未终局
interface MinimaxResult {
  score: number;
  index: number;
}

function minimax(
  board: Board,
  isMaximizing: boolean,
  aiPlayer: Player,
  depth: number
): MinimaxResult {
  const human: Player = aiPlayer === "X" ? "O" : "X";
  const result = checkResult(board);

  if (result.winner === aiPlayer) {
    return { score: 10 - depth, index: -1 };
  }
  if (result.winner === human) {
    return { score: -10 + depth, index: -1 };
  }
  if (result.winner === "draw") {
    return { score: 0, index: -1 };
  }

  const moves = availableMoves(board);
  if (moves.length === 0) {
    return { score: 0, index: -1 };
  }

  const candidates: MinimaxResult[] = [];
  for (const m of moves) {
    board[m] = isMaximizing ? aiPlayer : human;
    const res = minimax(board, !isMaximizing, aiPlayer, depth + 1);
    candidates.push({ score: res.score, index: m });
    board[m] = " ";
  }

  if (isMaximizing) {
    let best = candidates[0];
    for (const c of candidates) {
      if (c.score > best.score) best = c;
    }
    return best;
  } else {
    let best = candidates[0];
    for (const c of candidates) {
      if (c.score < best.score) best = c;
    }
    return best;
  }
}

function bestMove(board: Board, aiPlayer: Player): number {
  const res = minimax(board, true, aiPlayer, 0);
  return res.index;
}

// ============== 渲染 ==============
function render(
  board: Board,
  mode: GameMode,
  currentPlayer: Player,
  result: GameResult,
  statusMsg: string
): void {
  const lines: string[] = [];
  lines.push(ANSI.BOLD + ANSI.CYAN + "===== 文字版井字棋 =====" + ANSI.RESET);
  lines.push(
    `模式: ${mode}   当前回合: ${formatPlayer(currentPlayer)}` +
      (result.winner ? `   结果: ${formatResult(result)}` : "")
  );
  lines.push("");

  const winningSet = new Set(result.line ?? []);
  // 棋盘 - 位置编号 1-9 对应 0-8
  const cells: string[] = [];
  for (let i = 0; i < 9; i++) {
    const v = board[i];
    if (v === " ") {
      cells.push(ANSI.GRAY + (i + 1).toString() + ANSI.RESET);
    } else if (winningSet.has(i)) {
      cells.push(ANSI.BOLD + ANSI.YELLOW + v + ANSI.RESET);
    } else if (v === "X") {
      cells.push(ANSI.RED + v + ANSI.RESET);
    } else {
      cells.push(ANSI.GREEN + v + ANSI.RESET);
    }
  }

  lines.push("     │     │     ");
  lines.push(`  ${cells[0]}  │  ${cells[1]}  │  ${cells[2]}  `);
  lines.push("─────┼─────┼─────");
  lines.push(`  ${cells[3]}  │  ${cells[4]}  │  ${cells[5]}  `);
  lines.push("─────┼─────┼─────");
  lines.push(`  ${cells[6]}  │  ${cells[7]}  │  ${cells[8]}  `);
  lines.push("     │     │     ");

  lines.push("");
  lines.push(ANSI.CYAN + "操作: 输入 1-9 落子  r 重新开始  m 返回菜单  q 退出" + ANSI.RESET);
  if (mode === "cvc") {
    lines.push(ANSI.CYAN + "[cvc] 按回车执行下一步" + ANSI.RESET);
  }
  if (statusMsg) {
    lines.push(ANSI.YELLOW + statusMsg + ANSI.RESET);
  }

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  process.stdout.write(lines.join("\n") + "\n");
}

const ANSI_GRAY = "\x1b[90m";
void ANSI_GRAY;

function formatPlayer(p: Player): string {
  return p === "X"
    ? ANSI.RED + "X" + ANSI.RESET
    : ANSI.GREEN + "O" + ANSI.RESET;
}

function formatResult(result: GameResult): string {
  if (result.winner === "draw") return ANSI.YELLOW + "平局" + ANSI.RESET;
  if (result.winner === null) return "";
  return formatPlayer(result.winner) + " 胜";
}

// ============== 游戏循环 ==============
interface GameContext {
  board: Board;
  mode: GameMode;
  currentPlayer: Player;
  result: GameResult;
  statusMsg: string;
}

function newGame(mode: GameMode): GameContext {
  return {
    board: emptyBoard(),
    mode,
    currentPlayer: "X",
    result: { winner: null, line: null },
    statusMsg: "",
  };
}

function applyMove(ctx: GameContext, pos: number): void {
  if (ctx.result.winner) return;
  if (pos < 0 || pos > 8) {
    ctx.statusMsg = "位置无效, 请输入 1-9";
    return;
  }
  if (ctx.board[pos] !== " ") {
    ctx.statusMsg = "该位置已被占用";
    return;
  }
  ctx.board[pos] = ctx.currentPlayer;
  ctx.result = checkResult(ctx.board);
  if (!ctx.result.winner) {
    ctx.currentPlayer = ctx.currentPlayer === "X" ? "O" : "X";
    ctx.statusMsg = "";
  } else {
    if (ctx.result.winner === "draw") ctx.statusMsg = "平局!";
    else ctx.statusMsg = `${ctx.result.winner} 获胜!`;
  }
}

function aiTurn(ctx: GameContext): void {
  if (ctx.result.winner) return;
  // cvc 中两方都是 AI
  if (ctx.mode === "pvc" && ctx.currentPlayer !== "O") return;
  if (ctx.mode === "pvp") return;
  const m = bestMove(ctx.board, ctx.currentPlayer);
  if (m >= 0) applyMove(ctx, m);
}

function showMenu(rl: readline.Interface): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 文字版井字棋 =====" + ANSI.RESET);
  console.log("请选择模式:");
  console.log("  1. pvp  - 玩家 vs 玩家");
  console.log("  2. pvc  - 玩家 vs AI (minimax)");
  console.log("  3. cvc  - AI vs AI 演示");
  console.log("  q       - 退出");
}

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let ctx: GameContext | null = null;
  let inMenu = true;

  showMenu(rl);
  rl.setPrompt("选择> ");
  rl.prompt();

  const refresh = () => {
    if (ctx) render(ctx.board, ctx.mode, ctx.currentPlayer, ctx.result, ctx.statusMsg);
  };

  rl.on("line", (line: string) => {
    const input = line.trim().toLowerCase();

    if (inMenu) {
      if (input === "1" || input === "pvp") {
        ctx = newGame("pvp");
        inMenu = false;
        refresh();
        rl.setPrompt("落子> ");
      } else if (input === "2" || input === "pvc") {
        ctx = newGame("pvc");
        inMenu = false;
        refresh();
        rl.setPrompt("落子> ");
      } else if (input === "3" || input === "cvc") {
        ctx = newGame("cvc");
        inMenu = false;
        // AI 先手
        aiTurn(ctx);
        refresh();
        rl.setPrompt("回车继续> ");
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

    if (!ctx) return;

    if (input === "q") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    }
    if (input === "m") {
      inMenu = true;
      ctx = null;
      showMenu(rl);
      rl.setPrompt("选择> ");
      rl.prompt();
      return;
    }
    if (input === "r") {
      const mode = ctx.mode;
      ctx = newGame(mode);
      if (mode === "cvc") aiTurn(ctx);
      refresh();
      rl.prompt();
      return;
    }

    // cvc 模式：回车下一步
    if (ctx.mode === "cvc") {
      aiTurn(ctx);
      refresh();
      rl.prompt();
      return;
    }

    // pvc 模式：玩家落子后 AI 接管
    const pos = parseInt(input, 10);
    if (Number.isNaN(pos)) {
      ctx.statusMsg = "请输入数字 1-9";
      refresh();
      rl.prompt();
      return;
    }
    applyMove(ctx, pos - 1);
    if (!ctx.result.winner && ctx.mode === "pvc") {
      aiTurn(ctx);
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
