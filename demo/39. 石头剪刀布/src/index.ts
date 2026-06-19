#!/usr/bin/env node
/**
 * 石头剪刀布 (Rock Paper Scissors)
 * --------------------------------
 * 模式：
 *   play            单局对战电脑 (可指定策略)
 *   best-of <n>     N 局多胜制 (默认 5)
 *   tournament      多种 AI 策略循环赛 (round-robin)
 *   stats           查看个人统计与历史
 *   history         查看最近对局记录
 *   clear           清空数据
 *   help / h        帮助
 *   quit / q        退出
 *
 * 出招：
 *   r / rock        石头
 *   p / paper       布
 *   s / scissors    剪刀
 *
 * AI 策略：
 *   random             随机出招
 *   frequency          频率分析: 反制玩家最常出的招
 *   pattern            模式识别: 基于玩家最近两步转移概率预测
 *   mirror             模仿玩家上一步
 *   counter-mirror     反制玩家上一步
 *
 * 规则：
 *   石头胜剪刀, 剪刀胜布, 布胜石头
 *
 * 数据存储:
 *   ~/.rps_data.json
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

type Move = "rock" | "paper" | "scissors";
type StrategyName =
  | "random"
  | "frequency"
  | "pattern"
  | "mirror"
  | "counter-mirror";

interface Strategy {
  name: StrategyName;
  description: string;
  decide(history: Move[], opponentHistory: Move[]): Move;
}

const MOVES: Move[] = ["rock", "paper", "scissors"];
const MOVE_CN: Record<Move, string> = {
  rock: "石头",
  paper: "布",
  scissors: "剪刀",
};
const MOVE_ICON: Record<Move, string> = {
  rock: "✊",
  paper: "✋",
  scissors: "✌",
};

function beats(a: Move, b: Move): -1 | 0 | 1 {
  if (a === b) return 0;
  if (
    (a === "rock" && b === "scissors") ||
    (a === "scissors" && b === "paper") ||
    (a === "paper" && b === "rock")
  )
    return 1;
  return -1;
}

function counter(m: Move): Move {
  if (m === "rock") return "paper";
  if (m === "paper") return "scissors";
  return "rock";
}

function randomMove(): Move {
  return MOVES[Math.floor(Math.random() * 3)];
}

// ============== AI 策略实现 ==============
const STRATEGIES: Record<StrategyName, Strategy> = {
  random: {
    name: "random",
    description: "完全随机",
    decide(): Move {
      return randomMove();
    },
  },
  frequency: {
    name: "frequency",
    description: "频率分析 - 反制玩家最常出的招",
    decide(_history, opponentHistory): Move {
      if (opponentHistory.length === 0) return randomMove();
      const count: Record<Move, number> = { rock: 0, paper: 0, scissors: 0 };
      for (const m of opponentHistory) count[m]++;
      // 找出最常出的
      let mostCommon: Move = "rock";
      let max = -1;
      (Object.keys(count) as Move[]).forEach((k) => {
        if (count[k] > max) {
          max = count[k];
          mostCommon = k;
        }
      });
      return counter(mostCommon);
    },
  },
  pattern: {
    name: "pattern",
    description: "模式识别 - 基于玩家最近两步转移概率预测",
    decide(_history, opponentHistory): Move {
      if (opponentHistory.length < 3) return randomMove();
      const lastTwo = opponentHistory.slice(-2).join(",");
      // 统计历史中 "上一步模式" 之后跟的招
      const transitions: Move[] = [];
      for (let i = 0; i < opponentHistory.length - 2; i++) {
        const pair = opponentHistory[i] + "," + opponentHistory[i + 1];
        if (pair === lastTwo) {
          transitions.push(opponentHistory[i + 2]);
        }
      }
      if (transitions.length === 0) return randomMove();
      const count: Record<Move, number> = { rock: 0, paper: 0, scissors: 0 };
      for (const m of transitions) count[m]++;
      let predicted: Move = "rock";
      let max = -1;
      (Object.keys(count) as Move[]).forEach((k) => {
        if (count[k] > max) {
          max = count[k];
          predicted = k;
        }
      });
      return counter(predicted);
    },
  },
  mirror: {
    name: "mirror",
    description: "模仿玩家上一步",
    decide(_history, opponentHistory): Move {
      if (opponentHistory.length === 0) return randomMove();
      return opponentHistory[opponentHistory.length - 1];
    },
  },
  "counter-mirror": {
    name: "counter-mirror",
    description: "反制玩家上一步",
    decide(_history, opponentHistory): Move {
      if (opponentHistory.length === 0) return randomMove();
      return counter(opponentHistory[opponentHistory.length - 1]);
    },
  },
};

// ============== 数据 ==============
interface RoundResult {
  player: Move;
  ai: Move;
  outcome: "win" | "lose" | "draw";
  strategy: StrategyName;
  timestamp: number;
}

interface PlayerData {
  totalRounds: number;
  wins: number;
  losses: number;
  draws: number;
  moveCount: Record<Move, number>;
  history: RoundResult[];
}

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".rps_data.json"
);

function loadData(): PlayerData {
  const empty: PlayerData = {
    totalRounds: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    moveCount: { rock: 0, paper: 0, scissors: 0 },
    history: [],
  };
  try {
    if (fs.existsSync(DATA_FILE)) {
      return { ...empty, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) };
    }
  } catch {
    /* 忽略 */
  }
  return empty;
}

function saveData(d: PlayerData): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), "utf-8");
  } catch {
    /* 忽略 */
  }
}

// ============== 显示 ==============
function showMenu(): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 石头剪刀布 =====" + ANSI.RESET);
  console.log("命令:");
  console.log("  play [strategy]       单局对战 (可选策略)");
  console.log("  best-of <n> [strat]   N 局多胜制 (默认 5)");
  console.log("  tournament            AI 策略循环赛");
  console.log("  stats                 查看个人统计");
  console.log("  history               查看最近对局记录");
  console.log("  clear                 清空数据");
  console.log("  help / h              帮助");
  console.log("  quit / q              退出");
  console.log("");
  console.log("策略: random / frequency / pattern / mirror / counter-mirror");
  console.log("出招: r(rock) p(paper) s(scissors)");
}

function showStats(data: PlayerData, rl: readline.Interface): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 个人统计 =====" + ANSI.RESET);
  console.log(`总场次: ${data.totalRounds}`);
  console.log(`胜: ${ANSI.GREEN}${data.wins}${ANSI.RESET}   负: ${ANSI.RED}${data.losses}${ANSI.RESET}   平: ${ANSI.YELLOW}${data.draws}${ANSI.RESET}`);
  const winRate =
    data.totalRounds === 0
      ? "0%"
      : ((data.wins / data.totalRounds) * 100).toFixed(1) + "%";
  console.log(`胜率: ${winRate}`);
  console.log("出招分布:");
  (Object.keys(data.moveCount) as Move[]).forEach((m) => {
    const total = data.moveCount.rock + data.moveCount.paper + data.moveCount.scissors;
    const pct = total === 0 ? "0%" : ((data.moveCount[m] / total) * 100).toFixed(1) + "%";
    console.log(`  ${MOVE_CN[m]} (${MOVE_ICON[m]}): ${data.moveCount[m]} 次 (${pct})`);
  });
  rl.prompt();
}

function showHistory(data: PlayerData, rl: readline.Interface): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 最近 10 场对局 =====" + ANSI.RESET);
  const recent = data.history.slice(-10).reverse();
  if (recent.length === 0) {
    console.log(ANSI.GRAY + "  (暂无记录)" + ANSI.RESET);
  } else {
    recent.forEach((r) => {
      const date = new Date(r.timestamp).toLocaleString();
      const outcomeStr =
        r.outcome === "win"
          ? ANSI.GREEN + "胜" + ANSI.RESET
          : r.outcome === "lose"
          ? ANSI.RED + "负" + ANSI.RESET
          : ANSI.YELLOW + "平" + ANSI.RESET;
      console.log(
        `  你: ${MOVE_CN[r.player]}${MOVE_ICON[r.player]}  AI(${r.strategy}): ${MOVE_CN[r.ai]}${MOVE_ICON[r.ai]}  -> ${outcomeStr}   ${ANSI.GRAY}${date}${ANSI.RESET}`
      );
    });
  }
  rl.prompt();
}

// ============== 游戏模式 ==============
function playOnce(
  rl: readline.Interface,
  data: PlayerData,
  strategyName: StrategyName,
  onDone: () => void
): void {
  const strategy = STRATEGIES[strategyName];
  rl.question(
    `出招 (r/p/s, 0 退出本局, 当前策略: ${strategy.name})> `,
    (answer: string) => {
      const input = answer.trim().toLowerCase();
      if (input === "0" || input === "quit" || input === "q") {
        onDone();
        return;
      }
      let playerMove: Move | null = null;
      if (input === "r" || input === "rock") playerMove = "rock";
      else if (input === "p" || input === "paper") playerMove = "paper";
      else if (input === "s" || input === "scissors") playerMove = "scissors";

      if (!playerMove) {
        console.log(ANSI.RED + "无效输入, 请输入 r/p/s" + ANSI.RESET);
        playOnce(rl, data, strategyName, onDone);
        return;
      }

      const aiMove = strategy.decide([], data.history.map((h) => h.player));
      const result = beats(playerMove, aiMove);
      const outcome: "win" | "lose" | "draw" =
        result > 0 ? "win" : result < 0 ? "lose" : "draw";

      const icon = result > 0 ? "✅" : result < 0 ? "❌" : "🟰";
      console.log(
        `  你: ${MOVE_CN[playerMove]} ${MOVE_ICON[playerMove]}   ` +
          `AI: ${MOVE_CN[aiMove]} ${MOVE_ICON[aiMove]}   ` +
          `结果: ${icon} ${outcome === "win" ? "你赢" : outcome === "lose" ? "AI赢" : "平局"}`
      );

      // 更新数据
      data.totalRounds++;
      if (outcome === "win") data.wins++;
      else if (outcome === "lose") data.losses++;
      else data.draws++;
      data.moveCount[playerMove]++;
      data.history.push({
        player: playerMove,
        ai: aiMove,
        outcome,
        strategy: strategyName,
        timestamp: Date.now(),
      });
      if (data.history.length > 500) data.history = data.history.slice(-500);
      saveData(data);

      // 继续下一局
      playOnce(rl, data, strategyName, onDone);
    }
  );
}

function bestOf(
  rl: readline.Interface,
  data: PlayerData,
  n: number,
  strategyName: StrategyName,
  onDone: () => void
): void {
  const target = Math.floor(n / 2) + 1;
  let playerWins = 0;
  let aiWins = 0;
  let draws = 0;
  let round = 0;
  const opponentHistory: Move[] = [];

  console.log(
    ANSI.BOLD +
      ANSI.CYAN +
      `\n===== Best of ${n} (先胜 ${target} 局获胜) =====\n` +
      ANSI.RESET
  );

  const ask = () => {
    round++;
    rl.question(`第 ${round} 局 (r/p/s, 0 退出)> `, (answer: string) => {
      const input = answer.trim().toLowerCase();
      if (input === "0" || input === "quit" || input === "q") {
        console.log(ANSI.GRAY + "已退出 best-of 模式" + ANSI.RESET);
        onDone();
        return;
      }
      let playerMove: Move | null = null;
      if (input === "r" || input === "rock") playerMove = "rock";
      else if (input === "p" || input === "paper") playerMove = "paper";
      else if (input === "s" || input === "scissors") playerMove = "scissors";
      if (!playerMove) {
        console.log(ANSI.RED + "无效输入" + ANSI.RESET);
        round--;
        ask();
        return;
      }
      const aiMove = STRATEGIES[strategyName].decide([], opponentHistory);
      const result = beats(playerMove, aiMove);
      opponentHistory.push(playerMove);
      if (result > 0) playerWins++;
      else if (result < 0) aiWins++;
      else draws++;
      console.log(
        `  你: ${MOVE_CN[playerMove]}${MOVE_ICON[playerMove]}   AI: ${MOVE_CN[aiMove]}${MOVE_ICON[aiMove]}   ` +
          `比分 -> 你 ${playerWins} : ${aiWins} AI (平 ${draws})`
      );
      // 同时记入个人数据
      data.totalRounds++;
      const outcome: "win" | "lose" | "draw" =
        result > 0 ? "win" : result < 0 ? "lose" : "draw";
      if (outcome === "win") data.wins++;
      else if (outcome === "lose") data.losses++;
      else data.draws++;
      data.moveCount[playerMove]++;
      data.history.push({
        player: playerMove,
        ai: aiMove,
        outcome,
        strategy: strategyName,
        timestamp: Date.now(),
      });
      saveData(data);

      if (playerWins >= target || aiWins >= target) {
        console.log(
          (playerWins > aiWins ? ANSI.GREEN : ANSI.RED) +
            ANSI.BOLD +
            `\n===== ${playerWins > aiWins ? "你赢得系列赛!" : "AI 赢得系列赛!"} 比分 ${playerWins}:${aiWins} =====\n` +
            ANSI.RESET
        );
        onDone();
        return;
      }
      ask();
    });
  };
  ask();
}

function tournament(rl: readline.Interface, onDone: () => void): void {
  const names = Object.keys(STRATEGIES) as StrategyName[];
  console.log(
    ANSI.BOLD +
      ANSI.CYAN +
      "\n===== AI 策略循环赛 =====" +
      ANSI.RESET
  );
  console.log(`参赛策略: ${names.join(", ")}`);
  console.log("每对策略对战 30 局\n");

  const scores: Record<string, { wins: number; losses: number; draws: number }> = {};
  for (const n of names) scores[n] = { wins: 0, losses: 0, draws: 0 };

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const aHistory: Move[] = [];
      const bHistory: Move[] = [];
      let aWins = 0;
      let bWins = 0;
      let draws = 0;
      const ROUNDS = 30;
      for (let k = 0; k < ROUNDS; k++) {
        const moveA = STRATEGIES[a].decide(aHistory, bHistory);
        const moveB = STRATEGIES[b].decide(bHistory, aHistory);
        aHistory.push(moveA);
        bHistory.push(moveB);
        const r = beats(moveA, moveB);
        if (r > 0) aWins++;
        else if (r < 0) bWins++;
        else draws++;
      }
      scores[a].wins += aWins;
      scores[a].losses += bWins;
      scores[a].draws += draws;
      scores[b].wins += bWins;
      scores[b].losses += aWins;
      scores[b].draws += draws;
      console.log(
        `  ${a.padEnd(15)} vs ${b.padEnd(15)} -> ${aWins} : ${bWins} (平 ${draws})`
      );
    }
  }

  console.log("\n" + ANSI.BOLD + ANSI.CYAN + "===== 总排名 =====" + ANSI.RESET);
  const ranking = names
    .map((n) => ({
      name: n,
      wins: scores[n].wins,
      losses: scores[n].losses,
      draws: scores[n].draws,
      points: scores[n].wins - scores[n].losses,
    }))
    .sort((x, y) => y.points - x.points);
  console.log(
    `${"策略".padEnd(18)} ${"胜".padEnd(6)} ${"负".padEnd(6)} ${"平".padEnd(6)} ${"净胜分"}`
  );
  ranking.forEach((r, i) => {
    console.log(
      `${(i + 1).toString()}. ${r.name.padEnd(15)} ` +
        `${r.wins.toString().padEnd(6)} ${r.losses.toString().padEnd(6)} ${r.draws.toString().padEnd(6)} ${r.points}`
    );
  });
  console.log("");
  onDone();
}

// ============== 主程序 ==============
function main(): void {
  const data = loadData();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  showMenu();
  rl.setPrompt("> ");
  rl.prompt();

  const isValidStrategy = (s: string): s is StrategyName =>
    s === "random" ||
    s === "frequency" ||
    s === "pattern" ||
    s === "mirror" ||
    s === "counter-mirror";

  rl.on("line", (line: string) => {
    const parts = line.trim().split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();

    const onDone = () => {
      showMenu();
      rl.setPrompt("> ");
      rl.prompt();
    };

    if (cmd === "quit" || cmd === "q") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    }
    if (cmd === "help" || cmd === "h") {
      console.log("\n命令:");
      console.log("  play [strategy]       单局对战");
      console.log("  best-of <n> [strat]   N 局多胜制");
      console.log("  tournament            AI 策略循环赛");
      console.log("  stats                 查看统计");
      console.log("  history               查看历史");
      console.log("  clear                 清空数据");
      console.log("  quit                  退出");
      rl.prompt();
      return;
    }
    if (cmd === "stats") {
      showStats(data, rl);
      return;
    }
    if (cmd === "history") {
      showHistory(data, rl);
      return;
    }
    if (cmd === "clear") {
      const fresh: PlayerData = {
        totalRounds: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        moveCount: { rock: 0, paper: 0, scissors: 0 },
        history: [],
      };
      Object.assign(data, fresh);
      saveData(data);
      console.log(ANSI.GREEN + "已清空数据" + ANSI.RESET);
      rl.prompt();
      return;
    }
    if (cmd === "play") {
      const s = (parts[1] || "random").toLowerCase();
      const strategy: StrategyName = isValidStrategy(s) ? s : "random";
      console.log(
        ANSI.CYAN + `\n进入对战模式 (策略: ${strategy} - ${STRATEGIES[strategy].description})\n` + ANSI.RESET
      );
      playOnce(rl, data, strategy, onDone);
      return;
    }
    if (cmd === "best-of") {
      const n = parseInt(parts[1] || "5", 10) || 5;
      const s = (parts[2] || "random").toLowerCase();
      const strategy: StrategyName = isValidStrategy(s) ? s : "random";
      bestOf(rl, data, n, strategy, onDone);
      return;
    }
    if (cmd === "tournament") {
      tournament(rl, onDone);
      return;
    }
    if (cmd === "") {
      rl.prompt();
      return;
    }
    console.log(ANSI.RED + `未知命令: ${cmd}` + ANSI.RESET);
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
