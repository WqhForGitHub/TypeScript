#!/usr/bin/env node

/**
 * 自动化任务脚本 (Automation Tasks) - Enhanced Edition
 * 任务调度器与执行器（纯 TypeScript，仅使用 Node.js 内置模块）。
 * 支持：备份目录、运行命令、SMTP 发送邮件(net 实现)、文件同步、日志轮转、自定义脚本。
 * 调度：间隔秒数 或 简易 cron 格式（分 时 日 月 周，支持 *）。
 * 命令：list / run <task> / start / add <task.json> / history [task] / stop / example
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import * as crypto from "crypto";
import { exec } from "child_process";

// ---- 字符串枚举 ----
enum TaskType {
  Backup = "backup",
  Command = "command",
  Email = "email",
  Sync = "sync",
  LogRotate = "logrotate",
  Script = "script",
}

enum ErrorCode {
  NotFound = "ERR_NOT_FOUND",
  InvalidConfig = "ERR_INVALID_CONFIG",
  ExecutionFailed = "ERR_EXEC_FAILED",
  SmtpError = "ERR_SMTP",
  Timeout = "ERR_TIMEOUT",
  Unknown = "ERR_UNKNOWN",
}

enum TaskState {
  Idle = "IDLE",
  Running = "RUNNING",
  Succeeded = "SUCCEEDED",
  Failed = "FAILED",
  Skipped = "SKIPPED",
  Waiting = "WAITING",
}

enum ScheduleMode {
  Interval = "interval",
  Cron = "cron",
  Once = "once",
}

enum EmailPriority {
  Low = "low",
  Normal = "normal",
  High = "high",
  Urgent = "urgent",
}

// ---- Symbol 唯一属性键 ----
const taskIdSym = Symbol("taskId");
const taskMetaSym = Symbol("taskMeta");

// ---- 映射类型 + as const 常量 ----
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DEFAULT_SMTP_PORT = 25 as const;
const MAX_HISTORY = 500 as const;
const SMTP_TIMEOUT_MS = 15000 as const;
const SHOW_HISTORY_COUNT = 20 as const;
const TASK_TYPES = [
  "backup",
  "command",
  "email",
  "sync",
  "logrotate",
  "script",
] as const;

// ---- 接口（含可选 / 只读 / 索引签名） ----
interface TaskAction {
  readonly type: TaskType;
  source?: string;
  dest?: string;
  command?: string;
  smtpHost?: string;
  smtpPort?: number;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  priority?: EmailPriority;
  logFile?: string;
  maxLines?: number;
  file?: string;
  [key: string]: unknown;
}

interface TaskDef {
  readonly name: string;
  schedule: string;
  action: TaskAction;
  enabled: boolean;
  [taskIdSym]: number;
  [taskMetaSym]?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}

interface TaskRecord {
  readonly task: string;
  readonly time: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly message: string;
  readonly state: TaskState;
}

// ---- 判别联合（任务结果） ----
interface TaskSuccess {
  readonly kind: "success";
  readonly taskName: string;
  readonly message: string;
  readonly durationMs: number;
}
interface TaskErrorResult {
  readonly kind: "error";
  readonly taskName: string;
  readonly error: TaskError;
  readonly durationMs: number;
}
interface TaskSkipped {
  readonly kind: "skipped";
  readonly taskName: string;
  readonly reason: string;
}
interface TaskRetry {
  readonly kind: "retry";
  readonly taskName: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly cause: string;
}
type TaskResult = TaskSuccess | TaskErrorResult | TaskSkipped | TaskRetry;

// ---- 自定义错误类层级 ----
class TaskError extends Error {
  readonly code: ErrorCode;
  readonly taskName?: string;
  constructor(code: ErrorCode, message: string, taskName?: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
    this.taskName = taskName;
  }
}

class SmtpError extends TaskError {
  readonly smtpResponse?: string;
  constructor(message: string, smtpResponse?: string, taskName?: string) {
    super(ErrorCode.SmtpError, message, taskName);
    this.name = "SmtpError";
    this.smtpResponse = smtpResponse;
  }
}

// ---- 类型守卫 ----
function isTaskSuccess(r: TaskResult): r is TaskSuccess {
  return r.kind === "success";
}
function isTaskError(r: TaskResult): r is TaskErrorResult {
  return r.kind === "error";
}
function isTaskSkipped(r: TaskResult): r is TaskSkipped {
  return r.kind === "skipped";
}
function isTaskRetry(r: TaskResult): r is TaskRetry {
  return r.kind === "retry";
}
function isTaskErrorInstance(e: unknown): e is TaskError {
  return e instanceof TaskError;
}

// ---- satisfies 用法 ----
const PRIORITY_HEADERS = {
  [EmailPriority.Low]: "5 (Lowest)",
  [EmailPriority.Normal]: "3 (Normal)",
  [EmailPriority.High]: "2 (High)",
  [EmailPriority.Urgent]: "1 (Highest)",
} satisfies Record<EmailPriority, string>;

// ---- 配置路径 ----
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
  try {
    fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  } catch {
    /* 忽略日志写入错误 */
  }
}

// ---- 函数重载 ----
function findTask(tasks: TaskDef[], name: string): TaskDef | undefined;
function findTask(tasks: TaskDef[], name: string, required: true): TaskDef;
function findTask(
  tasks: TaskDef[],
  name: string,
  required?: boolean,
): TaskDef | undefined {
  const found = tasks.find((t) => t.name === name);
  if (required && !found)
    throw new TaskError(ErrorCode.NotFound, `任务不存在: ${name}`);
  return found;
}

// ---- 任务存储：泛型类（带约束） ----
class TaskStore<T extends TaskDef> {
  private items: Map<string, T> = new Map();
  private counter = 0;
  private _label: string;

  constructor(label: string) {
    this._label = label;
  }
  get label(): string {
    return this._label;
  }
  set label(value: string) {
    this._label = value || "task-store";
  }

  add(task: T): void {
    (task as Mutable<T>)[taskIdSym] = ++this.counter;
    this.items.set(task.name, task);
  }
  get(name: string): T | undefined {
    return this.items.get(name);
  }
  remove(name: string): boolean {
    return this.items.delete(name);
  }
  all(): T[] {
    return Array.from(this.items.values());
  }
  count(): number {
    return this.items.size;
  }

  /** 生成器：迭代任务 */
  *iter(): IterableIterator<T> {
    for (const t of this.items.values()) yield t;
  }
  [Symbol.iterator](): IterableIterator<T> {
    return this.iter();
  }

  static fromArray<U extends TaskDef>(arr: U[], label: string): TaskStore<U> {
    const store = new TaskStore<U>(label);
    for (const t of arr) store.add(t);
    return store;
  }
}

// ---- 抽象任务类 + 具体子类 ----
abstract class AbstractTask {
  readonly id: number;
  readonly name: string;
  readonly action: TaskAction;
  state: TaskState = TaskState.Idle;
  private _lastRun: Date | null = null;
  private _attempts = 0;

  constructor(def: TaskDef) {
    this.id = def[taskIdSym];
    this.name = def.name;
    this.action = def.action;
  }
  get lastRun(): Date | null {
    return this._lastRun;
  }
  get attempts(): number {
    return this._attempts;
  }
  set attempts(v: number) {
    this._attempts = v < 0 ? 0 : Math.floor(v);
  }

  abstract execute(): Promise<string>;
  reset(): void {
    this.attempts = 0;
    this.state = TaskState.Idle;
  }

  async run(): Promise<TaskResult> {
    const start = Date.now();
    this.state = TaskState.Running;
    this._lastRun = new Date();
    log(`运行任务: ${this.name} (${this.action.type})`);
    try {
      const msg = await this.execute();
      this.state = TaskState.Succeeded;
      const res: TaskSuccess = {
        kind: "success",
        taskName: this.name,
        message: msg,
        durationMs: Date.now() - start,
      };
      log(`  成功: ${msg} (${res.durationMs}ms)`);
      return res;
    } catch (err) {
      this._attempts++;
      this.state = TaskState.Failed;
      const e = isTaskErrorInstance(err)
        ? err
        : new TaskError(
            ErrorCode.ExecutionFailed,
            (err as Error).message,
            this.name,
          );
      log(`  失败: ${e.message}`);
      return {
        kind: "error",
        taskName: this.name,
        error: e,
        durationMs: Date.now() - start,
      };
    }
  }
  describe(): string {
    return `[${this.state}] ${this.name} (${this.action.type}) attempts=${this.attempts}`;
  }
}

class BackupTask extends AbstractTask {
  readonly source: string;
  readonly dest: string;
  constructor(def: TaskDef) {
    super(def);
    if (!def.action.source || !def.action.dest)
      throw new TaskError(
        ErrorCode.InvalidConfig,
        "backup 需 source/dest",
        def.name,
      );
    this.source = def.action.source;
    this.dest = def.action.dest;
  }
  async execute(): Promise<string> {
    if (!fs.existsSync(this.source))
      throw new TaskError(
        ErrorCode.NotFound,
        `源不存在: ${this.source}`,
        this.name,
      );
    fs.mkdirSync(this.dest, { recursive: true });
    copyDir(this.source, this.dest);
    return `备份 ${this.source} -> ${this.dest} 完成`;
  }
}

class EmailTask extends AbstractTask {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly priority: EmailPriority;
  constructor(def: TaskDef) {
    super(def);
    const a = def.action;
    if (!a.smtpHost || !a.from || !a.to)
      throw new TaskError(
        ErrorCode.InvalidConfig,
        "email 需 smtpHost/from/to",
        def.name,
      );
    this.host = a.smtpHost;
    this.port = a.smtpPort ?? DEFAULT_SMTP_PORT;
    this.from = a.from;
    this.to = a.to;
    this.subject = a.subject ?? "(无主题)";
    this.body = a.body ?? "";
    this.priority =
      (a.priority as EmailPriority | undefined) ?? EmailPriority.Normal;
  }
  async execute(): Promise<string> {
    return sendEmail({
      host: this.host,
      port: this.port,
      from: this.from,
      to: this.to,
      subject: this.subject,
      body: this.body,
      priority: this.priority,
    });
  }
}

class SyncTask extends AbstractTask {
  readonly source: string;
  readonly dest: string;
  constructor(def: TaskDef) {
    super(def);
    if (!def.action.source || !def.action.dest)
      throw new TaskError(
        ErrorCode.InvalidConfig,
        "sync 需 source/dest",
        def.name,
      );
    this.source = def.action.source;
    this.dest = def.action.dest;
  }
  async execute(): Promise<string> {
    fs.mkdirSync(this.dest, { recursive: true });
    syncDir(this.source, this.dest);
    return `同步 ${this.source} -> ${this.dest} 完成`;
  }
}

class CleanTask extends AbstractTask {
  readonly logFile: string;
  readonly maxLines: number;
  constructor(def: TaskDef) {
    super(def);
    if (!def.action.logFile)
      throw new TaskError(
        ErrorCode.InvalidConfig,
        "logrotate 需 logFile",
        def.name,
      );
    this.logFile = def.action.logFile;
    this.maxLines = def.action.maxLines ?? 1000;
  }
  async execute(): Promise<string> {
    if (!fs.existsSync(this.logFile)) return "日志文件不存在，跳过";
    const lines = fs.readFileSync(this.logFile, "utf-8").split("\n");
    const rotated = lines.slice(-this.maxLines).join("\n");
    fs.writeFileSync(this.logFile, rotated, "utf-8");
    const archive = `${this.logFile}.${Date.now()}.bak`;
    fs.writeFileSync(archive, lines.join("\n"), "utf-8");
    return `日志轮转: 保留 ${this.maxLines} 行，归档 ${archive}`;
  }
}

class CommandTask extends AbstractTask {
  readonly command: string;
  constructor(def: TaskDef) {
    super(def);
    if (!def.action.command)
      throw new TaskError(
        ErrorCode.InvalidConfig,
        "command 需 command",
        def.name,
      );
    this.command = def.action.command;
  }
  async execute(): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(this.command, (err, stdout, stderr) => {
        if (err)
          reject(
            new TaskError(
              ErrorCode.ExecutionFailed,
              `命令失败: ${stderr || err.message}`,
              this.name,
            ),
          );
        else resolve(`命令执行成功: ${stdout.substring(0, 200)}`);
      });
    });
  }
}

class ScriptTask extends AbstractTask {
  readonly file: string;
  constructor(def: TaskDef) {
    super(def);
    if (!def.action.file)
      throw new TaskError(ErrorCode.InvalidConfig, "script 需 file", def.name);
    this.file = def.action.file;
  }
  async execute(): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(`node "${this.file}"`, (err, stdout, stderr) => {
        if (err)
          reject(
            new TaskError(
              ErrorCode.ExecutionFailed,
              `脚本失败: ${stderr || err.message}`,
              this.name,
            ),
          );
        else resolve(`脚本执行成功: ${stdout.substring(0, 200)}`);
      });
    });
  }
}

function createTask(def: TaskDef): AbstractTask {
  const t = def.action.type;
  switch (t) {
    case TaskType.Backup:
      return new BackupTask(def);
    case TaskType.Email:
      return new EmailTask(def);
    case TaskType.Sync:
      return new SyncTask(def);
    case TaskType.LogRotate:
      return new CleanTask(def);
    case TaskType.Command:
      return new CommandTask(def);
    case TaskType.Script:
      return new ScriptTask(def);
    default: {
      const exhaustive: never = t;
      throw new TaskError(
        ErrorCode.Unknown,
        `未知动作类型: ${String(exhaustive)}`,
      );
    }
  }
}

// ---- 文件操作工具 ----
function copyDir(src: string, dst: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else fs.copyFileSync(s, d);
  }
}

function syncDir(src: string, dst: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      syncDir(s, d);
    } else {
      let needCopy = true;
      if (fs.existsSync(d)) {
        const sstat = fs.statSync(s),
          dstat = fs.statSync(d);
        needCopy = sstat.mtimeMs > dstat.mtimeMs;
      }
      if (needCopy) fs.copyFileSync(s, d);
    }
  }
}

// ---- SMTP 客户端（net 实现，纯演示，无 TLS） ----
interface SendEmailOpts {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly priority: EmailPriority;
}

function sendEmail(opts: SendEmailOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(opts.port, opts.host);
    const steps: Array<{ cmd: string; expect: number }> = [
      { cmd: "", expect: 220 },
      { cmd: `HELO ${os.hostname()}`, expect: 250 },
      { cmd: `MAIL FROM:<${opts.from}>`, expect: 250 },
      { cmd: `RCPT TO:<${opts.to}>`, expect: 250 },
      { cmd: "DATA", expect: 354 },
    ];
    let stepIdx = 0;
    let dataMode = false;
    const cleanup = (): void => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setEncoding("utf-8");
    socket.on("error", (err: NodeJS.ErrnoException) => {
      cleanup();
      reject(err);
    });
    socket.on("timeout", () => {
      cleanup();
      reject(new SmtpError("SMTP 超时", undefined, undefined));
    });
    socket.setTimeout(SMTP_TIMEOUT_MS);

    const sendCmd = (cmd: string): void => {
      log(`  SMTP> ${cmd}`);
      socket.write(cmd + "\r\n", "utf-8");
    };
    const messageId = `<${crypto.randomBytes(16).toString("hex")}@${os.hostname()}>`;
    const priorityHeader =
      PRIORITY_HEADERS[opts.priority] ?? PRIORITY_HEADERS[EmailPriority.Normal];

    socket.on("data", (chunk: string) => {
      const lines = chunk.split("\r\n").filter((l) => l.length > 0);
      for (const line of lines) {
        log(`  SMTP< ${line}`);
        if (dataMode) continue;
        const code = parseInt(line.substring(0, 3), 10);
        if (isNaN(code)) continue;
        if (stepIdx >= steps.length) continue;
        const expected = steps[stepIdx].expect;
        if (code !== expected) {
          cleanup();
          reject(new SmtpError(`SMTP 期望 ${expected}，收到 ${line}`, line));
          return;
        }
        stepIdx++;
        if (stepIdx === steps.length) {
          dataMode = true;
          const body =
            `From: ${opts.from}\r\nTo: ${opts.to}\r\nSubject: ${opts.subject}\r\n` +
            `Message-ID: ${messageId}\r\nDate: ${new Date().toUTCString()}\r\n` +
            `X-Priority: ${priorityHeader}\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n\r\n${opts.body}\r\n.\r\n`;
          log("  SMTP> (发送邮件正文 ...)");
          socket.write(body, "utf-8");
          dataMode = false;
          setTimeout(() => {
            sendCmd("QUIT");
            cleanup();
            resolve("已发送");
          }, 500);
          return;
        }
        sendCmd(steps[stepIdx].cmd);
      }
    });
  });
}

// ---- 持久化 ----
function loadTasks(): TaskDef[] {
  if (!fs.existsSync(TASKS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")) as TaskDef[];
    for (const t of raw) (t as Mutable<TaskDef>)[taskIdSym] = 0;
    return raw;
  } catch {
    return [];
  }
}

function saveTasks(tasks: TaskDef[]): void {
  ensureConfigDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

function loadHistory(): TaskRecord[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as TaskRecord[];
  } catch {
    return [];
  }
}

function appendHistory(rec: TaskRecord): void {
  const hist = loadHistory();
  hist.push(rec);
  const trimmed = hist.slice(-MAX_HISTORY);
  ensureConfigDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
}

// ---- 任务结果 -> 记录 ----
function resultToRecord(
  taskName: string,
  result: TaskResult,
  fallbackStart: number,
): TaskRecord {
  let success = false;
  let durationMs = Date.now() - fallbackStart;
  let message = "";
  let state = TaskState.Idle;
  if (isTaskSuccess(result)) {
    success = true;
    durationMs = result.durationMs;
    message = result.message;
    state = TaskState.Succeeded;
  } else if (isTaskError(result)) {
    success = false;
    durationMs = result.durationMs;
    message = result.error.message;
    state = TaskState.Failed;
  } else if (isTaskSkipped(result)) {
    success = false;
    message = result.reason;
    state = TaskState.Skipped;
  } else if (isTaskRetry(result)) {
    success = false;
    message = `重试 ${result.attempt}/${result.maxAttempts}: ${result.cause}`;
    state = TaskState.Waiting;
  }
  return {
    task: taskName,
    time: new Date().toISOString(),
    success,
    durationMs,
    message,
    state,
  };
}

async function runTask(task: TaskDef): Promise<TaskRecord> {
  const start = Date.now();
  const abstract = createTask(task);
  const result = await abstract.run();
  const rec = resultToRecord(task.name, result, start);
  appendHistory(rec);
  return rec;
}

// ---- 生成器：迭代启用任务 ----
function* enabledTasks(tasks: TaskDef[]): IterableIterator<TaskDef> {
  for (const t of tasks) if (t.enabled) yield t;
}

// ---- 调度解析 ----
function parseSchedule(schedule: string): { mode: ScheduleMode; ms: number } {
  const s = schedule.trim();
  if (s.startsWith("interval:")) {
    const sec = parseInt(s.substring("interval:".length), 10);
    return { mode: ScheduleMode.Interval, ms: isNaN(sec) ? 0 : sec * 1000 };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour] = parts;
    if (min.startsWith("*/")) {
      const n = parseInt(min.substring(2), 10);
      if (!isNaN(n) && n > 0)
        return { mode: ScheduleMode.Cron, ms: n * 60 * 1000 };
    }
    if (min === "*" && hour === "*")
      return { mode: ScheduleMode.Cron, ms: 60 * 1000 };
    log(`  警告: 暂不支持完整 cron '${s}'，建议用 interval:N 或 */N * * * *`);
    return { mode: ScheduleMode.Cron, ms: 0 };
  }
  return { mode: ScheduleMode.Once, ms: 0 };
}

// ---- 调度器 ----
class Scheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private _running = false;
  private _maxConcurrent = 4;

  get running(): boolean {
    return this._running;
  }
  get maxConcurrent(): number {
    return this._maxConcurrent;
  }
  set maxConcurrent(v: number) {
    this._maxConcurrent = v > 0 ? Math.floor(v) : 1;
  }

  start(tasks: TaskDef[]): void {
    this.stop();
    this._running = true;
    let scheduled = 0;
    for (const task of enabledTasks(tasks)) {
      const { ms } = parseSchedule(task.schedule);
      if (ms <= 0) continue;
      const timer = setInterval(() => {
        runTask(task).catch((e: NodeJS.ErrnoException) =>
          log(`调度异常: ${e.message}`),
        );
      }, ms);
      this.timers.set(task.name, timer);
      log(`已调度: ${task.name} 每 ${ms}ms`);
      scheduled++;
    }
    log(`调度器启动: ${scheduled} 个任务，最大并发 ${this._maxConcurrent}`);
  }
  stop(): void {
    for (const [, t] of this.timers) clearInterval(t);
    this.timers.clear();
    this._running = false;
  }
}

// ---- CLI ----
interface ParsedArgs {
  readonly command: string;
  readonly taskName: string;
  readonly taskFile: string;
  readonly schedule: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  let taskName = "",
    taskFile = "",
    schedule = "";
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

动作类型: ${TASK_TYPES.join(" | ")}

示例:
  node dist/index.js example
  node dist/index.js list
  node dist/index.js run backup-docs
  node dist/index.js start
`);
}

function cmdList(): void {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log("(暂无任务，运行 'example' 生成示例)");
    return;
  }
  const store = TaskStore.fromArray(tasks, "cli-list");
  console.log("任务列表:");
  for (const t of store) {
    console.log(
      `  [${t.enabled ? "启用" : "停用"}] ${t.name.padEnd(20)} 调度: ${t.schedule.padEnd(16)} 动作: ${t.action.type}`,
    );
  }
  console.log(`共 ${store.count()} 个任务。配置: ${TASKS_FILE}`);
}

async function cmdRun(taskName: string): Promise<void> {
  const tasks = loadTasks();
  let task: TaskDef;
  try {
    task = findTask(tasks, taskName, true);
  } catch (e) {
    console.error(`错误：${(e as Error).message}`);
    process.exit(1);
  }
  const rec = await runTask(task);
  console.log(
    `\n结果: ${rec.success ? "成功" : "失败"} - ${rec.message} (${rec.durationMs}ms)`,
  );
}

function cmdStart(): void {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log("无任务可调度。");
    return;
  }
  const scheduler = new Scheduler();
  scheduler.maxConcurrent = 4;
  scheduler.start(tasks);
  const enabledCount = Array.from(enabledTasks(tasks)).length;
  console.log(
    `调度器已启动（running=${scheduler.running}），共 ${enabledCount} 个启用任务。按 Ctrl+C 停止。`,
  );
  process.on("SIGINT", () => {
    console.log("\n正在停止调度器...");
    scheduler.stop();
    process.exit(0);
  });
}

function cmdAdd(taskFile: string): void {
  if (!taskFile || !fs.existsSync(taskFile)) {
    console.error("错误：缺少任务 JSON 文件");
    process.exit(1);
  }
  const newTask = JSON.parse(fs.readFileSync(taskFile, "utf-8")) as TaskDef;
  if (!newTask.name || !newTask.schedule || !newTask.action) {
    console.error("错误：任务需包含 name, schedule, action");
    process.exit(1);
  }
  if (!newTask.enabled) newTask.enabled = true;
  (newTask as Mutable<TaskDef>)[taskIdSym] = 0;
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.name === newTask.name);
  if (idx >= 0) tasks[idx] = newTask;
  else tasks.push(newTask);
  saveTasks(tasks);
  console.log(`已添加/更新任务: ${newTask.name}`);
}

function cmdHistory(taskName: string): void {
  const hist = loadHistory();
  const filtered = taskName ? hist.filter((h) => h.task === taskName) : hist;
  if (filtered.length === 0) {
    console.log("(无历史记录)");
    return;
  }
  const show = filtered.slice(-SHOW_HISTORY_COUNT);
  console.log(
    `历史记录 (最近 ${show.length} 条${taskName ? `，任务 ${taskName}` : ""}):`,
  );
  for (const h of show) {
    console.log(
      `  ${h.time}  ${h.success ? "OK " : "ERR"}  ${h.task.padEnd(18)}  ${h.durationMs}ms  ${h.message.substring(0, 60)}`,
    );
  }
}

function cmdExample(): void {
  const exampleTasks: TaskDef[] = [
    {
      name: "backup-docs",
      schedule: "interval:3600",
      enabled: true,
      action: {
        type: TaskType.Backup,
        source: "./docs",
        dest: "./backup/docs",
      },
      [taskIdSym]: 0,
    },
    {
      name: "sync-config",
      schedule: "*/10 * * * *",
      enabled: false,
      action: {
        type: TaskType.Sync,
        source: "./config",
        dest: "./backup/config",
      },
      [taskIdSym]: 0,
    },
    {
      name: "rotate-logs",
      schedule: "interval:86400",
      enabled: false,
      action: {
        type: TaskType.LogRotate,
        logFile: "./app.log",
        maxLines: 5000,
      },
      [taskIdSym]: 0,
    },
    {
      name: "notify-email",
      schedule: "interval:60",
      enabled: false,
      action: {
        type: TaskType.Email,
        smtpHost: "localhost",
        smtpPort: DEFAULT_SMTP_PORT,
        from: "bot@example.com",
        to: "admin@example.com",
        subject: "自动化任务报告",
        body: "这是一封来自自动化任务调度器的测试邮件。",
        priority: EmailPriority.Normal,
      },
      [taskIdSym]: 0,
    },
  ];
  saveTasks(exampleTasks);
  console.log(`已写入 ${exampleTasks.length} 个示例任务到 ${TASKS_FILE}`);
  console.log("运行 'list' 查看。");
}

function main(): void {
  const opts = parseArgs(process.argv);
  switch (opts.command) {
    case "list":
      cmdList();
      break;
    case "run":
      cmdRun(opts.taskName);
      break;
    case "start":
      cmdStart();
      break;
    case "stop":
      console.log("停止命令需对运行中的调度器实例执行（SIGINT）。");
      break;
    case "add":
      cmdAdd(opts.taskFile);
      break;
    case "history":
      cmdHistory(opts.taskName);
      break;
    case "example":
      cmdExample();
      break;
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main();
