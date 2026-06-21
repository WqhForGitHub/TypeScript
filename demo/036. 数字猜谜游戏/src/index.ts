#!/usr/bin/env node
/**
 * 数字猜谜游戏 (Number Guessing Game)
 * ----------------------------------
 * 电脑随机生成一个 [1, N] 范围内的整数，玩家猜测，系统提示 "大了" / "小了"。
 *
 * 难度：
 *   easy    范围 1..50
 *   medium  范围 1..100
 *   hard    范围 1..1000
 *
 * 评分：
 *   基础分 = 难度系数 × (上限 - 尝试次数 + 1)
 *   难度系数: easy=1, medium=2, hard=5
 *   未猜中不记分
 *
 * 命令：
 *   play [difficulty]  开始游戏 (默认 medium)
 *   stats              查看个人统计 (尝试次数、最佳分数等)
 *   leaderboard        查看本地排行榜 (Top 10)
 *   clear              清空本地数据 (需确认)
 *   help / h           帮助
 *   quit / q           退出
 *
 * 数据存储：
 *   ~/.number_guess_data.json 包含 stats 与 leaderboard
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

type Difficulty = "easy" | "medium" | "hard";

interface DifficultyConfig {
  name: Difficulty;
  upper: number;
  coefficient: number;
}

const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { name: "easy", upper: 50, coefficient: 1 },
  medium: { name: "medium", upper: 100, coefficient: 2 },
  hard: { name: "hard", upper: 1000, coefficient: 5 },
};

interface GameRecord {
  difficulty: Difficulty;
  attempts: number;
  score: number;
  timestamp: number;
}

interface PlayerData {
  playerName: string;
  totalGames: number;
  totalWins: number;
  bestScore: number;
  bestAttempts: Partial<Record<Difficulty, number>>;
  records: GameRecord[];
}

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".number_guess_data.json"
);

function loadData(): PlayerData {
  const empty: PlayerData = {
    playerName: "Player",
    totalGames: 0,
    totalWins: 0,
    bestScore: 0,
    bestAttempts: {},
    records: [],
  };
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return { ...empty, ...data };
    }
  } catch {
    /* 忽略 */
  }
  return empty;
}

function saveData(data: PlayerData): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    /* 忽略 */
  }
}

// ============== 游戏逻辑 ==============
function startGame(
  rl: readline.Interface,
  data: PlayerData,
  difficulty: Difficulty
): void {
  const cfg = DIFFICULTIES[difficulty];
  const target = Math.floor(Math.random() * cfg.upper) + 1;
  let attempts = 0;
  let won = false;
  const startTime = Date.now();

  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(
    ANSI.BOLD +
      ANSI.CYAN +
      `===== 数字猜谜 (${difficulty}) =====` +
      ANSI.RESET
  );
  console.log(
    `范围: 1 - ${cfg.upper}  难度系数: ${cfg.coefficient}  目标: ???`
  );
  console.log(
    ANSI.GRAY + "输入数字进行猜测, 'give' 放弃, 'quit' 退出" + ANSI.RESET + "\n"
  );

  const ask = () => {
    rl.question(`第 ${attempts + 1} 次尝试> `, (answer: string) => {
      const input = answer.trim().toLowerCase();
      if (input === "quit" || input === "q") {
        process.stdout.write(ANSI.CLEAR + ANSI.HOME);
        console.log("再见!");
        process.exit(0);
      }
      if (input === "give") {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(
          ANSI.RED +
            `已放弃! 答案是 ${target}, 用时 ${elapsed}s` +
            ANSI.RESET
        );
        data.totalGames++;
        saveData(data);
        returnToMenu(rl, data);
        return;
      }
      const guess = parseInt(input, 10);
      if (Number.isNaN(guess)) {
        console.log(ANSI.RED + "请输入有效数字" + ANSI.RESET);
        ask();
        return;
      }
      if (guess < 1 || guess > cfg.upper) {
        console.log(
          ANSI.RED + `请输入 1 到 ${cfg.upper} 之间的数字` + ANSI.RESET
        );
        ask();
        return;
      }
      attempts++;
      if (guess === target) {
        won = true;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const score =
          cfg.coefficient * (cfg.upper - attempts + 1);
        console.log(
          ANSI.GREEN +
            ANSI.BOLD +
            `恭喜! 答案就是 ${target}!` +
            ANSI.RESET
        );
        console.log(
          `尝试次数: ${attempts}   用时: ${elapsed}s   得分: ${ANSI.YELLOW}${score}${ANSI.RESET}`
        );
        // 更新数据
        data.totalGames++;
        data.totalWins++;
        if (score > data.bestScore) data.bestScore = score;
        const best = data.bestAttempts[difficulty];
        if (best === undefined || attempts < best) {
          data.bestAttempts[difficulty] = attempts;
        }
        data.records.push({
          difficulty,
          attempts,
          score,
          timestamp: Date.now(),
        });
        // 仅保留最近 200 条记录
        if (data.records.length > 200) {
          data.records = data.records.slice(-200);
        }
        saveData(data);
        returnToMenu(rl, data);
        return;
      } else if (guess < target) {
        console.log(ANSI.YELLOW + `小了! (尝试 ${attempts})` + ANSI.RESET);
      } else {
        console.log(ANSI.YELLOW + `大了! (尝试 ${attempts})` + ANSI.RESET);
      }
      ask();
    });
  };
  ask();
}

function returnToMenu(rl: readline.Interface, data: PlayerData): void {
  rl.question("\n按回车返回菜单... ", () => {
    showMenu(rl, data);
  });
}

// ============== 显示 ==============
function showMenu(rl: readline.Interface, data: PlayerData): void {
  process.stdout.write(ANSI.CLEAR + ANSI.HOME);
  console.log(ANSI.BOLD + ANSI.CYAN + "===== 数字猜谜游戏 =====" + ANSI.RESET);
  console.log(`玩家: ${data.playerName}  总场次: ${data.totalGames}  胜场: ${data.totalWins}  最高分: ${data.bestScore}`);
  console.log("");
  console.log("命令:");
  console.log("  play [easy|medium|hard]  开始游戏 (默认 medium)");
  console.log("  stats                    查看个人统计");
  console.log("  leaderboard              查看排行榜 (Top 10)");
  console.log("  name <新名字>            修改玩家名");
  console.log("  clear                    清空本地数据");
  console.log("  help / h                 帮助");
  console.log("  quit / q                 退出");
  console.log("");
  rl.setPrompt("菜单> ");
  rl.prompt();
}

function showStats(rl: readline.Interface, data: PlayerData): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 个人统计 =====" + ANSI.RESET);
  console.log(`玩家名: ${data.playerName}`);
  console.log(`总场次: ${data.totalGames}`);
  console.log(`胜利场次: ${data.totalWins}`);
  console.log(`最高分: ${data.bestScore}`);
  console.log("各难度最少尝试次数:");
  (["easy", "medium", "hard"] as Difficulty[]).forEach((d) => {
    const v = data.bestAttempts[d];
    console.log(`  ${d.padEnd(8)}: ${v === undefined ? "未通关" : v + " 次"}`);
  });
  // 最近 5 场
  console.log("\n最近 5 场记录:");
  const recent = data.records.slice(-5).reverse();
  if (recent.length === 0) {
    console.log(ANSI.GRAY + "  (暂无记录)" + ANSI.RESET);
  } else {
    recent.forEach((r) => {
      const date = new Date(r.timestamp).toLocaleString();
      console.log(
        `  [${r.difficulty.padEnd(7)}] 尝试 ${r.attempts} 次, 得分 ${r.score}   ${ANSI.GRAY}${date}${ANSI.RESET}`
      );
    });
  }
  rl.prompt();
}

function showLeaderboard(rl: readline.Interface, data: PlayerData): void {
  console.log(ANSI.BOLD + ANSI.CYAN + "\n===== 排行榜 (Top 10) =====" + ANSI.RESET);
  const sorted = [...data.records].sort((a, b) => b.score - a.score).slice(0, 10);
  if (sorted.length === 0) {
    console.log(ANSI.GRAY + "  (暂无记录)" + ANSI.RESET);
  } else {
    console.log(
      `${"排名".padEnd(4)} ${"难度".padEnd(8)} ${"分数".padEnd(8)} ${"次数".padEnd(6)} ${"时间"}`
    );
    sorted.forEach((r, i) => {
      const date = new Date(r.timestamp).toLocaleString();
      console.log(
        `${(i + 1).toString().padEnd(4)} ${r.difficulty.padEnd(8)} ${r.score.toString().padEnd(8)} ${r.attempts.toString().padEnd(6)} ${date}`
      );
    });
  }
  rl.prompt();
}

function clearData(rl: readline.Interface, data: PlayerData): void {
  rl.question(
    ANSI.RED + "确认清空所有本地数据? (yes/no) " + ANSI.RESET,
    (answer: string) => {
      if (answer.trim().toLowerCase() === "yes") {
        const fresh: PlayerData = {
          playerName: data.playerName,
          totalGames: 0,
          totalWins: 0,
          bestScore: 0,
          bestAttempts: {},
          records: [],
        };
        saveData(fresh);
        console.log(ANSI.GREEN + "已清空本地数据" + ANSI.RESET);
        // 重置引用
        Object.assign(data, fresh);
      } else {
        console.log("已取消");
      }
      rl.prompt();
    }
  );
}

// ============== 主程序 ==============
function main(): void {
  const data = loadData();
  // 若首次运行, 询问玩家名
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (data.totalGames === 0 && data.records.length === 0) {
    rl.question("欢迎首次游玩! 请输入你的名字: ", (name: string) => {
      const trimmed = name.trim();
      if (trimmed) data.playerName = trimmed;
      saveData(data);
      showMenu(rl, data);
    });
  } else {
    showMenu(rl, data);
  }

  rl.on("line", (line: string) => {
    const parts = line.trim().split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
    const arg = (parts[1] || "").toLowerCase();

    if (cmd === "quit" || cmd === "q") {
      process.stdout.write(ANSI.CLEAR + ANSI.HOME);
      console.log("再见!");
      process.exit(0);
    } else if (cmd === "help" || cmd === "h") {
      console.log("\n命令列表:");
      console.log("  play [easy|medium|hard]  开始游戏");
      console.log("  stats                    查看个人统计");
      console.log("  leaderboard              查看排行榜 (Top 10)");
      console.log("  name <新名字>            修改玩家名");
      console.log("  clear                    清空本地数据");
      console.log("  quit                     退出");
      rl.prompt();
    } else if (cmd === "play") {
      const diff: Difficulty =
        arg === "easy" || arg === "medium" || arg === "hard" ? arg : "medium";
      startGame(rl, data, diff);
    } else if (cmd === "stats") {
      showStats(rl, data);
    } else if (cmd === "leaderboard" || cmd === "lb") {
      showLeaderboard(rl, data);
    } else if (cmd === "name") {
      const newName = parts.slice(1).join(" ").trim();
      if (newName) {
        data.playerName = newName;
        saveData(data);
        console.log(ANSI.GREEN + `玩家名已更新为: ${newName}` + ANSI.RESET);
      } else {
        console.log(ANSI.RED + "请提供新名字" + ANSI.RESET);
      }
      rl.prompt();
    } else if (cmd === "clear") {
      clearData(rl, data);
    } else if (cmd === "") {
      rl.prompt();
    } else {
      console.log(ANSI.RED + `未知命令: ${cmd}` + ANSI.RESET);
      rl.prompt();
    }
  });

  rl.on("close", () => {
    process.stdout.write(ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
