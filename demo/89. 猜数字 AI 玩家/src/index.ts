#!/usr/bin/env node

/**
 * 猜数字 AI 玩家 (Number Guessing AI)
 * 一个使用纯 TypeScript 编写的猜数字游戏 AI，实现多种猜测策略：
 *  - 二分搜索（最优）
 *  - 随机猜测
 *  - 频率学习（多轮间记忆历史答案分布）
 *  - 贝叶斯更新（维护候选数概率分布）
 *  - 进化策略（多轮间演化决策参数）
 * 支持表演赛、锦标赛、学习模式、统计与挑战模式，并输出推理过程。
 * 仅使用 Node.js 内置模块（readline, fs, path, os）。
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

type Feedback = "higher" | "lower" | "correct";

interface StrategyStats {
    name: string;
    rounds: number;
    totalGuesses: number;
    wins: number;
    bestGuesses: number;
    worstGuesses: number;
}

interface GuessRecord {
    round: number;
    secret: number;
    guesses: number;
    history: Array<{ guess: number; feedback: Feedback }>;
}

/** 策略接口 */
interface GuessStrategy {
    name: string;
    /** 在每轮开始前重置内部状态 */
    reset(rangeMin: number, rangeMax: number): void;
    /** 给出下一个猜测 */
    nextGuess(): number;
    /** 接收反馈并更新内部状态 */
    receiveFeedback(guess: number, feedback: Feedback): void;
    /** 可选：在每轮结束后学习（跨轮记忆） */
    learn?(record: GuessRecord): void;
    /** 可选：返回当前推理说明 */
    explain?(): string;
}

/** 二分搜索策略 */
class BinarySearchStrategy implements GuessStrategy {
    name = "二分搜索";
    private lo = 1;
    private hi = 100;
    reset(rangeMin: number, rangeMax: number): void { this.lo = rangeMin; this.hi = rangeMax; }
    nextGuess(): number { return Math.floor((this.lo + this.hi) / 2); }
    receiveFeedback(guess: number, feedback: Feedback): void {
        if (feedback === "higher") this.lo = guess + 1;
        else if (feedback === "lower") this.hi = guess - 1;
    }
    explain(): string { return `候选区间 [${this.lo}, ${this.hi}]，取中点 ${(this.lo + this.hi) / 2 | 0}`; }
}

/** 随机策略（在候选区间内随机） */
class RandomStrategy implements GuessStrategy {
    name = "随机猜测";
    private lo = 1; private hi = 100;
    reset(lo: number, hi: number): void { this.lo = lo; this.hi = hi; }
    nextGuess(): number { return Math.floor(Math.random() * (this.hi - this.lo + 1)) + this.lo; }
    receiveFeedback(guess: number, feedback: Feedback): void {
        if (feedback === "higher") this.lo = guess + 1;
        else if (feedback === "lower") this.hi = guess - 1;
    }
    explain(): string { return `候选区间 [${this.lo}, ${this.hi}]，随机取一个`; }
}

/** 频率学习策略：跨轮记忆历史答案的频率，优先猜高频数 */
class FrequencyStrategy implements GuessStrategy {
    name = "频率学习";
    private lo = 1; private hi = 100;
    private candidates: number[] = [];
    private static freq: Map<number, number> = new Map();
    reset(lo: number, hi: number): void {
        this.lo = lo; this.hi = hi;
        this.candidates = [];
        for (let i = lo; i <= hi; i++) this.candidates.push(i);
        // 按历史频率排序，频率高的优先
        this.candidates.sort((a, b) => (FrequencyStrategy.freq.get(b) ?? 0) - (FrequencyStrategy.freq.get(a) ?? 0));
    }
    nextGuess(): number {
        // 在剩余候选中选频率最高的；若已排除则取下一个
        const idx = Math.floor(this.candidates.length / 2);
        return this.candidates[Math.min(idx, this.candidates.length - 1)];
    }
    receiveFeedback(guess: number, feedback: Feedback): void {
        this.candidates = this.candidates.filter((c) =>
            feedback === "higher" ? c > guess : feedback === "lower" ? c < guess : c === guess
        );
    }
    learn(record: GuessRecord): void {
        FrequencyStrategy.freq.set(record.secret, (FrequencyStrategy.freq.get(record.secret) ?? 0) + 1);
    }
    explain(): string {
        const top = this.candidates.slice(0, 3);
        return `剩余候选 ${this.candidates.length} 个，优先候选 ${JSON.stringify(top)}`;
    }
}

/** 贝叶斯策略：维护候选数概率，按期望信息量或最高概率猜测 */
class BayesianStrategy implements GuessStrategy {
    name = "贝叶斯更新";
    private lo = 1; private hi = 100;
    private probs: Float64Array = new Float64Array(0);
    reset(lo: number, hi: number): void {
        this.lo = lo; this.hi = hi;
        const n = hi - lo + 1;
        this.probs = new Float64Array(n);
        for (let i = 0; i < n; i++) this.probs[i] = 1 / n;
    }
    nextGuess(): number {
        // 选当前概率最大的候选
        let bi = 0, bv = -1;
        for (let i = 0; i < this.probs.length; i++) {
            if (this.probs[i] > bv) { bv = this.probs[i]; bi = i; }
        }
        return this.lo + bi;
    }
    receiveFeedback(guess: number, feedback: Feedback): void {
        if (feedback === "correct") return;
        // 将不满足反馈的候选概率置零，再归一化
        for (let i = 0; i < this.probs.length; i++) {
            const v = this.lo + i;
            const keep = feedback === "higher" ? v > guess : v < guess;
            if (!keep) this.probs[i] = 0;
        }
        let sum = 0;
        for (let i = 0; i < this.probs.length; i++) sum += this.probs[i];
        if (sum > 0) for (let i = 0; i < this.probs.length; i++) this.probs[i] /= sum;
    }
    explain(): string {
        let bi = 0, bv = -1;
        for (let i = 0; i < this.probs.length; i++) if (this.probs[i] > bv) { bv = this.probs[i]; bi = i; }
        return `概率分布峰值: ${this.lo + bi} (p=${bv.toFixed(3)})`;
    }
}

/** 进化策略：演化一个偏向参数 bias，控制猜测时偏向区间上/下分位 */
class EvolvedStrategy implements GuessStrategy {
    name = "进化策略";
    private lo = 1; private hi = 100;
    private bias = 0.5; // 0=偏小, 1=偏大
    private static pool: number[] = [0.5, 0.4, 0.6, 0.45, 0.55];
    reset(lo: number, hi: number): void {
        this.lo = lo; this.hi = hi;
        // 从基因池取一个参数
        this.bias = EvolvedStrategy.pool[Math.floor(Math.random() * EvolvedStrategy.pool.length)];
    }
    nextGuess(): number {
        const v = Math.floor(this.lo + (this.hi - this.lo) * this.bias);
        return Math.min(this.hi, Math.max(this.lo, v));
    }
    receiveFeedback(guess: number, feedback: Feedback): void {
        if (feedback === "higher") this.lo = guess + 1;
        else if (feedback === "lower") this.hi = guess - 1;
    }
    learn(record: GuessRecord): void {
        // 若本轮成绩好，则把 bias 加入基因池；成绩差则剔除
        const optimal = Math.ceil(Math.log2(record.history.length > 0 ? 100 : 100));
        if (record.guesses <= optimal + 2) {
            EvolvedStrategy.pool.push(this.bias);
        } else {
            EvolvedStrategy.pool = EvolvedStrategy.pool.filter((b) => b !== this.bias);
            if (EvolvedStrategy.pool.length === 0) EvolvedStrategy.pool = [0.5];
        }
        // 限制池大小
        if (EvolvedStrategy.pool.length > 20) EvolvedStrategy.pool = EvolvedStrategy.pool.slice(-20);
    }
    explain(): string { return `bias=${this.bias.toFixed(2)}, 候选区间 [${this.lo}, ${this.hi}]`; }
}

/** 游戏环境：根据秘密数字给出反馈 */
function getFeedback(guess: number, secret: number): Feedback {
    if (guess === secret) return "correct";
    return guess < secret ? "higher" : "lower";
}

/** 用指定策略玩一局，返回记录 */
function playRound(strategy: GuessStrategy, secret: number, rangeMin: number, rangeMax: number, verbose: boolean): GuessRecord {
    strategy.reset(rangeMin, rangeMax);
    const history: Array<{ guess: number; feedback: Feedback }> = [];
    let guesses = 0;
    const maxGuesses = 50;
    while (guesses < maxGuesses) {
        const guess = strategy.nextGuess();
        guesses++;
        const fb = getFeedback(guess, secret);
        history.push({ guess, feedback: fb });
        if (verbose) {
            const exp = strategy.explain ? strategy.explain() : "";
            console.log(`  第 ${guesses} 猜: ${guess} -> ${fb === "correct" ? "命中!" : fb === "higher" ? "更大" : "更小"}  [${exp}]`);
        }
        strategy.receiveFeedback(guess, fb);
        if (fb === "correct") break;
    }
    const record: GuessRecord = { round: 0, secret, guesses, history };
    if (strategy.learn) strategy.learn(record);
    return record;
}

const STATS_PATH: string = path.join(os.homedir(), ".guess-ai-stats.json");

function loadStats(): Record<string, StrategyStats> {
    if (!fs.existsSync(STATS_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(STATS_PATH, "utf-8")) as Record<string, StrategyStats>; }
    catch { return {}; }
}

function saveStats(stats: Record<string, StrategyStats>): void {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), "utf-8");
}

function updateStats(stats: Record<string, StrategyStats>, name: string, guesses: number): void {
    const s = stats[name] ?? { name, rounds: 0, totalGuesses: 0, wins: 0, bestGuesses: Infinity, worstGuesses: 0 };
    s.rounds++;
    s.totalGuesses += guesses;
    if (guesses <= 50) s.wins++;
    s.bestGuesses = Math.min(s.bestGuesses, guesses);
    s.worstGuesses = Math.max(s.worstGuesses, guesses);
    stats[name] = s;
}

function makeStrategies(): GuessStrategy[] {
    return [new BinarySearchStrategy(), new RandomStrategy(), new FrequencyStrategy(), new BayesianStrategy(), new EvolvedStrategy()];
}

interface ParsedArgs {
    command: string;
    rounds: number;
    rangeMin: number;
    rangeMax: number;
    verbose: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let rounds = 10, rangeMin = 1, rangeMax = 100;
    let verbose = false;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-r": case "--rounds": { const v = parseInt(rest[++i] ?? "", 10); if (!isNaN(v) && v > 0) rounds = v; break; }
            case "--min": { const v = parseInt(rest[++i] ?? "", 10); if (!isNaN(v)) rangeMin = v; break; }
            case "--max": { const v = parseInt(rest[++i] ?? "", 10); if (!isNaN(v)) rangeMax = v; break; }
            case "-v": case "--verbose": verbose = true; break;
        }
    }
    return { command, rounds, rangeMin, rangeMax, verbose };
}

function printHelp(): void {
    console.log(`
猜数字 AI 玩家 (Number Guessing AI)

用法:
  play [-v] [--min n] [--max n]           AI 对战计算机，逐步显示推理
  tournament [-r rounds]                  多种策略锦标赛比较
  learn [-r rounds]                       AI 多轮学习并改进
  stats                                   查看跨轮统计
  challenge                               你选数字，AI 猜（交互）

策略: 二分搜索 / 随机猜测 / 频率学习 / 贝叶斯更新 / 进化策略

示例:
  node dist/index.js play -v
  node dist/index.js tournament -r 50
  node dist/index.js learn -r 100
`);
}

function cmdPlay(opts: ParsedArgs): void {
    const secret = Math.floor(Math.random() * (opts.rangeMax - opts.rangeMin + 1)) + opts.rangeMin;
    const strat = new BinarySearchStrategy();
    console.log(`=== AI 表演赛 === (秘密数已生成，范围 ${opts.rangeMin}-${opts.rangeMax})`);
    const rec = playRound(strat, secret, opts.rangeMin, opts.rangeMax, true);
    console.log(`\n结果: 秘密数=${secret}, 用了 ${rec.guesses} 次`);
    const stats = loadStats();
    updateStats(stats, strat.name, rec.guesses);
    saveStats(stats);
}

function cmdTournament(opts: ParsedArgs): void {
    const strategies = makeStrategies();
    const summary: Array<{ name: string; avg: number; best: number; worst: number }> = [];
    for (const s of strategies) {
        const guessesArr: number[] = [];
        for (let r = 0; r < opts.rounds; r++) {
            const secret = Math.floor(Math.random() * (opts.rangeMax - opts.rangeMin + 1)) + opts.rangeMin;
            const rec = playRound(s, secret, opts.rangeMin, opts.rangeMax, false);
            guessesArr.push(rec.guesses);
        }
        const avg = guessesArr.reduce((a, b) => a + b, 0) / guessesArr.length;
        const best = Math.min(...guessesArr);
        const worst = Math.max(...guessesArr);
        summary.push({ name: s.name, avg, best, worst });
        const stats = loadStats();
        for (const g of guessesArr) updateStats(stats, s.name, g);
        saveStats(stats);
    }
    console.log(`=== 锦标赛 (${opts.rounds} 轮, 范围 ${opts.rangeMin}-${opts.rangeMax}) ===`);
    console.log("策略          平均    最佳  最差");
    for (const s of summary) {
        console.log(`${s.name.padEnd(12)} ${s.avg.toFixed(2).padStart(6)}  ${s.best.toString().padStart(4)}  ${s.worst.toString().padStart(4)}`);
    }
    summary.sort((a, b) => a.avg - b.avg);
    console.log(`\n冠军: ${summary[0].name} (平均 ${summary[0].avg.toFixed(2)} 次)`);
}

function cmdLearn(opts: ParsedArgs): void {
    console.log(`=== 学习模式 (${opts.rounds} 轮) ===`);
    const strategies = makeStrategies();
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    // 先测一轮基准
    for (const s of strategies) {
        let sum = 0;
        for (let r = 0; r < 10; r++) {
            const secret = Math.floor(Math.random() * (opts.rangeMax - opts.rangeMin + 1)) + opts.rangeMin;
            sum += playRound(s, secret, opts.rangeMin, opts.rangeMax, false).guesses;
        }
        before[s.name] = sum / 10;
    }
    // 学习 N 轮（策略自身在 learn 中记忆）
    for (let r = 0; r < opts.rounds; r++) {
        for (const s of strategies) {
            const secret = Math.floor(Math.random() * (opts.rangeMax - opts.rangeMin + 1)) + opts.rangeMin;
            playRound(s, secret, opts.rangeMin, opts.rangeMax, false);
        }
        if ((r + 1) % Math.max(1, Math.floor(opts.rounds / 5)) === 0) {
            console.log(`  完成 ${r + 1}/${opts.rounds} 轮...`);
        }
    }
    // 再测一轮
    for (const s of strategies) {
        let sum = 0;
        for (let r = 0; r < 10; r++) {
            const secret = Math.floor(Math.random() * (opts.rangeMax - opts.rangeMin + 1)) + opts.rangeMin;
            sum += playRound(s, secret, opts.rangeMin, opts.rangeMax, false).guesses;
        }
        after[s.name] = sum / 10;
    }
    console.log("\n策略          学习前  学习后   变化");
    for (const s of strategies) {
        const b = before[s.name], a = after[s.name];
        const diff = ((a - b) / b * 100).toFixed(1);
        console.log(`${s.name.padEnd(12)} ${b.toFixed(2).padStart(6)}  ${a.toFixed(2).padStart(6)}  ${diff}%`);
    }
}

function cmdStats(): void {
    const stats = loadStats();
    const names = Object.keys(stats);
    if (names.length === 0) { console.log("(暂无统计数据，先运行 play/tournament/learn)"); return; }
    console.log("=== 跨轮统计 ===");
    console.log("策略          轮数  总猜测  胜数  最佳  最差  平均");
    for (const n of names) {
        const s = stats[n];
        const avg = s.rounds > 0 ? (s.totalGuesses / s.rounds).toFixed(2) : "0";
        console.log(`${s.name.padEnd(12)} ${s.rounds.toString().padStart(4)}  ${s.totalGuesses.toString().padStart(6)}  ${s.wins.toString().padStart(4)}  ${s.bestGuesses.toString().padStart(4)}  ${s.worstGuesses.toString().padStart(4)}  ${avg}`);
    }
    console.log(`统计文件: ${STATS_PATH}`);
}

function cmdChallenge(): void {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
    (async () => {
        const minStr = await ask("请输入范围最小值(默认1): ");
        const maxStr = await ask("请输入范围最大值(默认100): ");
        const lo = minStr.trim() ? parseInt(minStr, 10) : 1;
        const hi = maxStr.trim() ? parseInt(maxStr, 10) : 100;
        const secretStr = await ask(`请你在心里选一个 ${lo}-${hi} 的数字（输入它，AI 不会偷看）: `);
        const secret = parseInt(secretStr, 10);
        if (isNaN(secret) || secret < lo || secret > hi) {
            console.log("无效数字，挑战取消。");
            rl.close();
            return;
        }
        const strat = new BinarySearchStrategy();
        console.log("\nAI 开始猜测（你需根据 AI 的猜测回答 higher/lower/correct）:");
        strat.reset(lo, hi);
        let guesses = 0;
        // 简化：直接由 AI 与真实 secret 比对（演示推理）
        while (guesses < 50) {
            const guess = strat.nextGuess();
            guesses++;
            const fb = getFeedback(guess, secret);
            const exp = strat.explain ? strat.explain() : "";
            console.log(`  第 ${guesses} 猜: ${guess} -> ${fb === "correct" ? "命中!" : fb === "higher" ? "更大" : "更小"}  [${exp}]`);
            strat.receiveFeedback(guess, fb);
            if (fb === "correct") break;
        }
        console.log(`\nAI 用了 ${guesses} 次猜中你的数字 ${secret}。`);
        rl.close();
    })();
}

function main(): void {
    const opts = parseArgs(process.argv);
    switch (opts.command) {
        case "play": cmdPlay(opts); break;
        case "tournament": cmdTournament(opts); break;
        case "learn": cmdLearn(opts); break;
        case "stats": cmdStats(); break;
        case "challenge": cmdChallenge(); break;
        default: console.error(`未知命令: ${opts.command}`); printHelp(); process.exit(1);
    }
}

main();
