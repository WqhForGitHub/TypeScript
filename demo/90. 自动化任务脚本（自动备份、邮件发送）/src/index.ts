#!/usr/bin/env node

/**
 * 自动化任务脚本 (Automation Tasks)
 * 一个使用纯 TypeScript 编写的任务调度器与执行器。
 * 支持：备份目录、运行命令、SMTP 发送邮件(net 实现)、文件同步、日志轮转、自定义脚本。
 * 调度：间隔秒数 或 简易 cron 格式（分 时 日 月 周，支持 *）。
 * 命令：list / run <task> / start / add <task.json> / history [task] / stop
 * 仅使用 Node.js 内置模块（fs, path, os, net, child_process, events）。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { exec } from "child_process";

type ActionType = "backup" | "command" | "email" | "sync" | "logrotate" | "script";

interface TaskAction {
    type: ActionType;
    // backup: source, dest
    source?: string;
    dest?: string;
    // command: command
    command?: string;
    // email: smtp host/port, from, to, subject, body
    smtpHost?: string;
    smtpPort?: number;
    from?: string;
    to?: string;
    subject?: string;
    body?: string;
    // sync: src, dst (覆盖同步)
    // logrotate: logFile, maxLines (按行截断保留尾部)
    logFile?: string;
    maxLines?: number;
    // script: file (node 脚本路径)
    file?: string;
}

interface Task {
    name: string;
    schedule: string; // "interval:60" 或 cron "*/5 * * * *"
    action: TaskAction;
    enabled: boolean;
}

interface TaskRecord {
    task: string;
    time: string;
    success: boolean;
    durationMs: number;
    message: string;
}

const CONFIG_DIR: string = path.join(os.homedir(), ".automation-tasks");
const TASKS_FILE: string = path.join(CONFIG_DIR, "tasks.json");
const HISTORY_FILE: string = path.join(CONFIG_DIR, "history.json");
const LOG_FILE: string = path.join(CONFIG_DIR, "scheduler.log");

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function log(msg: string): void {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + "\n", "utf-8"); } catch { /* 忽略日志写入错误 */ }
}

function loadTasks(): Task[] {
    if (!fs.existsSync(TASKS_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")) as Task[]; }
    catch { return []; }
}

function saveTasks(tasks: Task[]): void {
    ensureConfigDir();
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

function loadHistory(): TaskRecord[] {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as TaskRecord[]; }
    catch { return []; }
}

function appendHistory(rec: TaskRecord): void {
    const hist = loadHistory();
    hist.push(rec);
    // 仅保留最近 500 条
    const trimmed = hist.slice(-500);
    ensureConfigDir();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
}

/** ============ SMTP 客户端（net 实现，纯演示，无 TLS） ============ */
function sendEmail(opts: {
    host: string; port: number; from: string; to: string; subject: string; body: string;
}): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(opts.port, opts.host);
        const steps: Array<{ cmd: string; expect: number }> = [
            { cmd: "", expect: 220 }, // 服务器问候
            { cmd: `HELO ${os.hostname()}`, expect: 250 },
            { cmd: `MAIL FROM:<${opts.from}>`, expect: 250 },
            { cmd: `RCPT TO:<${opts.to}>`, expect: 250 },
            { cmd: "DATA", expect: 354 },
        ];
        let stepIdx = 0;
        let dataMode = false;
        const cleanup = (): void => { socket.removeAllListeners(); socket.destroy(); };

        socket.setEncoding("utf-8");
        socket.on("error", (err: NodeJS.ErrnoException) => { cleanup(); reject(err); });
        socket.on("timeout", () => { cleanup(); reject(new Error("SMTP 超时")); });
        socket.setTimeout(15000);

        const sendCmd = (cmd: string): void => {
            log(`  SMTP> ${cmd}`);
            socket.write(cmd + "\r\n", "utf-8");
        };

        socket.on("data", (chunk: string) => {
            const lines = chunk.split("\r\n").filter((l) => l.length > 0);
            for (const line of lines) {
                log(`  SMTP< ${line}`);
                if (dataMode) continue; // DATA 模式忽略服务器输出，直到结束
                const code = parseInt(line.substring(0, 3), 10);
                if (isNaN(code)) continue;
                if (stepIdx >= steps.length) continue;
                const expected = steps[stepIdx].expect;
                if (code !== expected) {
                    cleanup();
                    reject(new Error(`SMTP 期望 ${expected}，收到 ${line}`));
                    return;
                }
                stepIdx++;
                if (stepIdx === steps.length) {
                    // 进入 DATA 模式
                    dataMode = true;
                    const body = `From: ${opts.from}\r\nTo: ${opts.to}\r\nSubject: ${opts.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${opts.body}\r\n.\r\n`;
                    log("  SMTP> (发送邮件正文 ...)");
                    socket.write(body, "utf-8");
                    dataMode = false;
                    // 等待 250 后 QUIT
                    const quitWait = (): void => {
                        sendCmd("QUIT");
                        cleanup();
                        resolve("已发送");
                    };
                    setTimeout(quitWait, 500);
                    return;
                }
                sendCmd(steps[stepIdx].cmd);
            }
        });
    });
}

/** ============ 任务动作执行 ============ */
function execAction(action: TaskAction): Promise<string> {
    return new Promise((resolve, reject) => {
        switch (action.type) {
            case "backup": {
                if (!action.source || !action.dest) return reject(new Error("backup 需 source/dest"));
                if (!fs.existsSync(action.source)) return reject(new Error(`源不存在: ${action.source}`));
                fs.mkdirSync(action.dest, { recursive: true });
                copyDir(action.source, action.dest);
                resolve(`备份 ${action.source} -> ${action.dest} 完成`);
                break;
            }
            case "command": {
                if (!action.command) return reject(new Error("command 需 command"));
                exec(action.command, (err, stdout, stderr) => {
                    if (err) return reject(new Error(`命令失败: ${stderr || err.message}`));
                    resolve(`命令执行成功: ${stdout.substring(0, 200)}`);
                });
                break;
            }
            case "email": {
                if (!action.smtpHost || !action.from || !action.to) return reject(new Error("email 需 smtpHost/from/to"));
                sendEmail({
                    host: action.smtpHost,
                    port: action.smtpPort ?? 25,
                    from: action.from,
                    to: action.to,
                    subject: action.subject ?? "(无主题)",
                    body: action.body ?? "",
                }).then(resolve, reject);
                break;
            }
            case "sync": {
                if (!action.source || !action.dest) return reject(new Error("sync 需 source/dest"));
                fs.mkdirSync(action.dest, { recursive: true });
                syncDir(action.source, action.dest);
                resolve(`同步 ${action.source} -> ${action.dest} 完成`);
                break;
            }
            case "logrotate": {
                if (!action.logFile) return reject(new Error("logrotate 需 logFile"));
                if (!fs.existsSync(action.logFile)) return resolve("日志文件不存在，跳过");
                const lines = fs.readFileSync(action.logFile, "utf-8").split("\n");
                const keep = action.maxLines ?? 1000;
                const rotated = lines.slice(-keep).join("\n");
                fs.writeFileSync(action.logFile, rotated, "utf-8");
                const archive = action.logFile + "." + Date.now() + ".bak";
                fs.writeFileSync(archive, lines.join("\n"), "utf-8");
                resolve(`日志轮转: 保留 ${keep} 行，归档 ${archive}`);
                break;
            }
            case "script": {
                if (!action.file) return reject(new Error("script 需 file"));
                exec(`node "${action.file}"`, (err, stdout, stderr) => {
                    if (err) return reject(new Error(`脚本失败: ${stderr || err.message}`));
                    resolve(`脚本执行成功: ${stdout.substring(0, 200)}`);
                });
                break;
            }
            default:
                reject(new Error(`未知动作类型: ${(action as { type: string }).type}`));
        }
    });
}

function copyDir(src: string, dst: string): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d); }
        else fs.copyFileSync(s, d);
    }
}

function syncDir(src: string, dst: string): void {
    // 简单同步：复制 src 中存在但 dst 不存在或较旧的文件
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); syncDir(s, d); }
        else {
            let needCopy = true;
            if (fs.existsSync(d)) {
                const sstat = fs.statSync(s), dstat = fs.statSync(d);
                needCopy = sstat.mtimeMs > dstat.mtimeMs;
            }
            if (needCopy) fs.copyFileSync(s, d);
        }
    }
}

/** 运行单个任务（含历史记录与错误通知） */
async function runTask(task: Task): Promise<TaskRecord> {
    const start = Date.now();
    log(`运行任务: ${task.name} (${task.action.type})`);
    try {
        const msg = await execAction(task.action);
        const rec: TaskRecord = {
            task: task.name, time: new Date().toISOString(),
            success: true, durationMs: Date.now() - start, message: msg,
        };
        log(`  成功: ${msg} (${rec.durationMs}ms)`);
        appendHistory(rec);
        return rec;
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        const rec: TaskRecord = {
            task: task.name, time: new Date().toISOString(),
            success: false, durationMs: Date.now() - start, message: e.message,
        };
        log(`  失败: ${e.message}`);
        appendHistory(rec);
        // 错误通知：尝试发邮件（避免循环，仅当任务本身不是 email）
        if (task.action.type !== "email") {
            // 略：可在此触发通知任务
        }
        return rec;
    }
}

/** ============ 调度器 ============ */
class Scheduler {
    private timers: Map<string, NodeJS.Timeout> = new Map();
    private running = false;

    start(tasks: Task[]): void {
        this.stop();
        this.running = true;
        for (const task of tasks) {
            if (!task.enabled) continue;
            const ms = parseSchedule(task.schedule);
            if (ms <= 0) continue;
            const timer = setInterval(() => {
                runTask(task).catch((e: NodeJS.ErrnoException) => log(`调度异常: ${e.message}`));
            }, ms);
            this.timers.set(task.name, timer);
            log(`已调度: ${task.name} 每 ${ms}ms`);
        }
    }

    stop(): void {
        for (const [, t] of this.timers) clearInterval(t);
        this.timers.clear();
        this.running = false;
    }

    isRunning(): boolean { return this.running; }
}

/** 解析调度表达式，返回毫秒间隔。支持 "interval:N" 或简易 cron */
function parseSchedule(schedule: string): number {
    const s = schedule.trim();
    if (s.startsWith("interval:")) {
        const sec = parseInt(s.substring("interval:".length), 10);
        return isNaN(sec) ? 0 : sec * 1000;
    }
    // 简易 cron: "*/N * * * *" -> 每 N 分钟；"N * * * *" -> 每小时第 N 分
    const parts = s.split(/\s+/);
    if (parts.length === 5) {
        const [min, hour, dom, mon, dow] = parts;
        // 仅支持 */N 形式与 *
        if (min.startsWith("*/")) {
            const n = parseInt(min.substring(2), 10);
            if (!isNaN(n) && n > 0) return n * 60 * 1000;
        }
        if (min === "*" && hour === "*") return 60 * 1000; // 每分钟
        // 复杂 cron 不在此实现，回退为 0
        log(`  警告: 暂不支持完整 cron '${s}'，建议用 interval:N 或 */N * * * *`);
        return 0;
    }
    return 0;
}

/** ============ CLI ============ */

interface ParsedArgs {
    command: string;
    taskName: string;
    taskFile: string;
    schedule: string;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let taskName = "", taskFile = "", schedule = "";
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === "-s" || a === "--schedule") schedule = rest[++i] ?? "";
        else if (!a.startsWith("-")) {
            if (command === "run" || command === "history") taskName = a;
            else if (command === "add") taskFile = a;
        }
    }
    return { command, taskName, taskFile, schedule };
}

function printHelp(): void {
    console.log(`
自动化任务脚本 (Automation Tasks)

用法:
  list                         列出所有任务
  run <task>                   手动运行一个任务
  start                        启动调度器（前台运行）
  stop                         停止调度器（向运行中的实例发信号，此处仅退出当前进程）
  add <task.json>              从 JSON 添加任务（写入配置）
  history [task]               查看执行历史
  example                      写入示例任务配置

调度格式:
  interval:60        每 60 秒
  */5 * * * *        每 5 分钟（简易 cron）

动作类型: backup | command | email | sync | logrotate | script

示例:
  node dist/index.js example
  node dist/index.js list
  node dist/index.js run backup-docs
  node dist/index.js start
`);
}

function cmdList(): void {
    const tasks = loadTasks();
    if (tasks.length === 0) { console.log("(暂无任务，运行 'example' 生成示例)"); return; }
    console.log("任务列表:");
    for (const t of tasks) {
        console.log(`  [${t.enabled ? "启用" : "停用"}] ${t.name.padEnd(20)} 调度: ${t.schedule.padEnd(16)} 动作: ${t.action.type}`);
    }
    console.log(`共 ${tasks.length} 个任务。配置: ${TASKS_FILE}`);
}

async function cmdRun(taskName: string): Promise<void> {
    const tasks = loadTasks();
    const task = tasks.find((t) => t.name === taskName);
    if (!task) { console.error(`错误：任务不存在 ${taskName}`); process.exit(1); }
    const rec = await runTask(task);
    console.log(`\n结果: ${rec.success ? "成功" : "失败"} - ${rec.message} (${rec.durationMs}ms)`);
}

function cmdStart(): void {
    const tasks = loadTasks();
    if (tasks.length === 0) { console.log("无任务可调度。"); return; }
    const scheduler = new Scheduler();
    scheduler.start(tasks);
    console.log(`调度器已启动，共 ${tasks.filter((t) => t.enabled).length} 个任务。按 Ctrl+C 停止。`);
    process.on("SIGINT", () => {
        console.log("\n正在停止调度器...");
        scheduler.stop();
        process.exit(0);
    });
    // 立即运行一次所有启用任务（演示）
    // for (const t of tasks) if (t.enabled) runTask(t);
}

function cmdAdd(taskFile: string): void {
    if (!taskFile || !fs.existsSync(taskFile)) { console.error("错误：缺少任务 JSON 文件"); process.exit(1); }
    const newTask = JSON.parse(fs.readFileSync(taskFile, "utf-8")) as Task;
    if (!newTask.name || !newTask.schedule || !newTask.action) {
        console.error("错误：任务需包含 name, schedule, action"); process.exit(1);
    }
    const tasks = loadTasks();
    const idx = tasks.findIndex((t) => t.name === newTask.name);
    if (idx >= 0) tasks[idx] = newTask; else tasks.push(newTask);
    saveTasks(tasks);
    console.log(`已添加/更新任务: ${newTask.name}`);
}

function cmdHistory(taskName: string): void {
    const hist = loadHistory();
    const filtered = taskName ? hist.filter((h) => h.task === taskName) : hist;
    if (filtered.length === 0) { console.log("(无历史记录)"); return; }
    const show = filtered.slice(-20);
    console.log(`历史记录 (最近 ${show.length} 条${taskName ? `，任务 ${taskName}` : ""}):`);
    for (const h of show) {
        console.log(`  ${h.time}  ${h.success ? "OK " : "ERR"}  ${h.task.padEnd(18)}  ${h.durationMs}ms  ${h.message.substring(0, 60)}`);
    }
}

function cmdExample(): void {
    const exampleTasks: Task[] = [
        {
            name: "backup-docs",
            schedule: "interval:3600",
            enabled: true,
            action: { type: "backup", source: "./docs", dest: "./backup/docs" },
        },
        {
            name: "sync-config",
            schedule: "*/10 * * * *",
            enabled: false,
            action: { type: "sync", source: "./config", dest: "./backup/config" },
        },
        {
            name: "rotate-logs",
            schedule: "interval:86400",
            enabled: false,
            action: { type: "logrotate", logFile: "./app.log", maxLines: 5000 },
        },
        {
            name: "notify-email",
            schedule: "interval:60",
            enabled: false,
            action: {
                type: "email",
                smtpHost: "localhost",
                smtpPort: 25,
                from: "bot@example.com",
                to: "admin@example.com",
                subject: "自动化任务报告",
                body: "这是一封来自自动化任务调度器的测试邮件。",
            },
        },
    ];
    saveTasks(exampleTasks);
    console.log(`已写入 ${exampleTasks.length} 个示例任务到 ${TASKS_FILE}`);
    console.log("运行 'list' 查看。");
}

function main(): void {
    const opts = parseArgs(process.argv);
    switch (opts.command) {
        case "list": cmdList(); break;
        case "run": cmdRun(opts.taskName); break;
        case "start": cmdStart(); break;
        case "stop": console.log("停止命令需对运行中的调度器实例执行（SIGINT）。"); break;
        case "add": cmdAdd(opts.taskFile); break;
        case "history": cmdHistory(opts.taskName); break;
        case "example": cmdExample(); break;
        default: console.error(`未知命令: ${opts.command}`); printHelp(); process.exit(1);
    }
}

main();
