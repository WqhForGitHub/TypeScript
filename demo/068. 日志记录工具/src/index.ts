#!/usr/bin/env node
/**
 * 日志记录工具 (Logging Tool) — Enhanced TypeScript Edition
 *
 * 功能：级别 DEBUG/INFO/WARN/ERROR/FATAL（字符串枚举）；多传输（控制台彩色 /
 * 文件按大小或日期轮转 / JSON）；格式化；缓冲与过滤；命令 tail/search/stats/
 * rotate/clear/demo。仅使用 Node.js 内置模块（fs / path）。
 */
import * as fs from "fs";
import * as path from "path";

// ===== 字符串枚举 =====

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  FATAL = "FATAL",
}
export enum Command {
  Tail = "tail",
  Search = "search",
  Stats = "stats",
  Rotate = "rotate",
  Clear = "clear",
  Demo = "demo",
}
export enum ErrorCode {
  TransportClosed = "TRANSPORT_CLOSED",
  RotationFailed = "ROTATION_FAILED",
  FileNotFound = "FILE_NOT_FOUND",
  InvalidLevel = "INVALID_LEVEL",
  UnknownCommand = "UNKNOWN_COMMAND",
}
export enum RotationType {
  Size = "size",
  Date = "date",
}
export enum TransportKind {
  Console = "console",
  JsonFile = "json-file",
  FileRotate = "file-rotate",
}

// ===== as const 断言 / satisfies 运算符 =====

/** 级别优先级（数值越大越严重）—— as const 保留字面量类型 */
export const LEVEL_PRIORITY = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.FATAL]: 50,
} as const;

/** 级别名称映射 —— satisfies 校验完整性，同时保留字面量 */
export const LEVEL_NAMES = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.FATAL]: "FATAL",
} satisfies Record<LogLevel, string>;

const COLORS = {
  [LogLevel.DEBUG]: "\x1b[36m",
  [LogLevel.INFO]: "\x1b[32m",
  [LogLevel.WARN]: "\x1b[33m",
  [LogLevel.ERROR]: "\x1b[31m",
  [LogLevel.FATAL]: "\x1b[35m",
} satisfies Record<LogLevel, string>;

const RESET = "\x1b[0m";

// ===== 映射类型 / 模板字面量类型 =====

/** 去除 readonly 修饰符的映射类型 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** 日志行格式（模板字面量类型） */
export type LogFormat = `[${string}] [${LogLevel}] [${string}] ${string}`;
/** 子分类路径（模板字面量类型） */
export type CategoryPath = `${string}:${string}`;

// ===== 接口（含可选 / readonly / 索引签名） =====

export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly levelName: string;
  readonly category: string;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface TransportOptions {
  readonly minLevel?: LogLevel;
  readonly categories?: readonly string[];
  readonly bufferSize?: number;
  readonly [key: string]: unknown;
}

export interface RotateOptions extends TransportOptions {
  readonly file: string;
  readonly maxSize?: number;
  readonly maxFiles?: number;
  readonly rotateByDate?: boolean;
}

export interface LogStats {
  readonly total: number;
  readonly byLevel: Record<string, number>;
  readonly byCategory: Record<string, number>;
  readonly earliest?: string;
  readonly latest?: string;
  readonly [key: string]: unknown;
}

// ===== 判别联合（Discriminated Union） =====

export interface LogResult {
  readonly kind: "result";
  readonly record: LogRecord;
  readonly written: number;
}
export interface LogFiltered {
  readonly kind: "filtered";
  readonly reason: "level" | "category";
  readonly record: LogRecord;
}
export interface LogErrorResult {
  readonly kind: "error";
  readonly code: ErrorCode;
  readonly message: string;
}
export type LogOutcome = LogResult | LogFiltered | LogErrorResult;

// ===== 类型守卫 =====

export function isLogLevel(v: unknown): v is LogLevel {
  return (
    typeof v === "string" && (Object.values(LogLevel) as string[]).includes(v)
  );
}
export function isLogResult(o: LogOutcome): o is LogResult {
  return o.kind === "result";
}
export function isLogFiltered(o: LogOutcome): o is LogFiltered {
  return o.kind === "filtered";
}
export function isLogErrorResult(o: LogOutcome): o is LogErrorResult {
  return o.kind === "error";
}

// ===== 自定义错误类层级 =====

export class LogError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "LogError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export class TransportError extends LogError {
  constructor(message: string) {
    super(ErrorCode.TransportClosed, message);
    this.name = "TransportError";
  }
}
export class RotationError extends LogError {
  constructor(message: string) {
    super(ErrorCode.RotationFailed, message);
    this.name = "RotationError";
  }
}

// ===== Symbol 唯一属性键 =====

const symOrigin: unique symbol = Symbol("origin");
const symSeq: unique symbol = Symbol("seq");

// ===== 函数重载 =====

export function parseLevel(name: string): LogLevel | undefined;
export function parseLevel(name: string, fallback: LogLevel): LogLevel;
export function parseLevel(
  name: string,
  fallback?: LogLevel,
): LogLevel | undefined {
  const up = String(name).toUpperCase();
  if (isLogLevel(up)) return up;
  return fallback;
}

// ===== 抽象传输基类 + 具体子类 =====

export abstract class AbstractTransport {
  abstract readonly kind: TransportKind;
  protected minLevel: LogLevel;
  protected categories: Set<string> | null;
  protected closed = false;

  constructor(opts: TransportOptions = {}) {
    this.minLevel = opts.minLevel ?? LogLevel.DEBUG;
    this.categories = opts.categories ? new Set(opts.categories) : null;
  }

  get level(): LogLevel {
    return this.minLevel;
  }
  set level(v: LogLevel) {
    this.minLevel = v;
  }

  protected accept(r: LogRecord): "level" | "category" | null {
    if (LEVEL_PRIORITY[r.level] < LEVEL_PRIORITY[this.minLevel]) return "level";
    if (this.categories && !this.categories.has(r.category)) return "category";
    return null;
  }

  protected ensureOpen(): void {
    if (this.closed) throw new TransportError("transport already closed");
  }

  abstract write(record: LogRecord): LogOutcome;
  abstract flush(): void;
  abstract close(): void;
}

/** 控制台传输（彩色） */
export class ConsoleTransport extends AbstractTransport {
  readonly kind = TransportKind.Console;

  write(r: LogRecord): LogOutcome {
    this.ensureOpen();
    const blocked = this.accept(r);
    if (blocked) return { kind: "filtered", reason: blocked, record: r };
    const color = COLORS[r.level];
    const body = r.message + (r.meta ? " " + JSON.stringify(r.meta) : "");
    const line: LogFormat = `[${r.ts}] [${r.level}] [${r.category}] ${body}`;
    process.stdout.write(`${color}${line}${RESET}\n`);
    return { kind: "result", record: r, written: 1 };
  }

  flush(): void {
    /* 控制台无需缓冲 */
  }
  close(): void {
    this.closed = true;
  }
}

/** JSON 文件传输（每行一个 JSON） */
export class JsonFileTransport extends AbstractTransport {
  readonly kind = TransportKind.JsonFile;
  private readonly fd: number;
  private buffer: string[] = [];
  private readonly bufSize: number;

  constructor(file: string, opts: TransportOptions = {}) {
    super(opts);
    this.fd = fs.openSync(path.resolve(file), "a");
    this.bufSize = opts.bufferSize ?? 100;
  }

  write(r: LogRecord): LogOutcome {
    this.ensureOpen();
    const blocked = this.accept(r);
    if (blocked) return { kind: "filtered", reason: blocked, record: r };
    this.buffer.push(JSON.stringify(r));
    if (this.buffer.length >= this.bufSize) this.flush();
    return { kind: "result", record: r, written: 1 };
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    fs.writeSync(this.fd, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }

  close(): void {
    this.flush();
    fs.closeSync(this.fd);
    this.closed = true;
  }
}

/** 文件轮转传输 */
export class FileRotateTransport extends AbstractTransport {
  readonly kind = TransportKind.FileRotate;
  private readonly file: string;
  private readonly maxSize: number;
  private readonly maxFiles: number;
  private readonly rotateByDate: boolean;
  private buffer: string[] = [];
  private readonly bufSize: number;
  private currentSize = 0;
  private currentDate: string;
  private fd: number;

  constructor(opts: RotateOptions) {
    super(opts);
    this.file = path.resolve(opts.file);
    this.maxSize = opts.maxSize ?? 10 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 5;
    this.rotateByDate = opts.rotateByDate ?? false;
    this.bufSize = opts.bufferSize ?? 100;
    this.currentDate = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.fd = fs.openSync(this.file, "a");
    try {
      const st = fs.statSync(this.file);
      this.currentSize = st.size;
    } catch {
      this.currentSize = 0;
    }
  }

  get rotationType(): RotationType {
    return this.rotateByDate ? RotationType.Date : RotationType.Size;
  }
  get currentPath(): string {
    return this.file;
  }

  write(r: LogRecord): LogOutcome {
    this.ensureOpen();
    const blocked = this.accept(r);
    if (blocked) return { kind: "filtered", reason: blocked, record: r };
    const line = this.format(r);
    this.buffer.push(line);
    this.currentSize += Buffer.byteLength(line + "\n");
    if (this.rotateByDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== this.currentDate) {
        this.flush();
        this.rotate(`.${this.currentDate}`);
        this.currentDate = today;
      }
    }
    if (this.currentSize >= this.maxSize) {
      this.flush();
      this.rotate("");
    }
    if (this.buffer.length >= this.bufSize) this.flush();
    return { kind: "result", record: r, written: 1 };
  }

  private format(r: LogRecord): LogFormat {
    const body = r.message + (r.meta ? " " + JSON.stringify(r.meta) : "");
    return `[${r.ts}] [${r.level}] [${r.category}] ${body}`;
  }

  private rotate(suffix: string): void {
    try {
      fs.closeSync(this.fd);
      const rotated = this.file + suffix;
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const from = `${rotated}.${i}`;
        const to = `${rotated}.${i + 1}`;
        if (fs.existsSync(from)) {
          if (i + 1 > this.maxFiles && fs.existsSync(to)) fs.unlinkSync(to);
          fs.renameSync(from, to);
        }
      }
      if (fs.existsSync(this.file)) fs.renameSync(this.file, `${rotated}.1`);
      this.fd = fs.openSync(this.file, "a");
      this.currentSize = 0;
    } catch (e) {
      throw new RotationError(`rotation failed: ${(e as Error).message}`);
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    fs.writeSync(this.fd, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }

  close(): void {
    this.flush();
    fs.closeSync(this.fd);
    this.closed = true;
  }
}

// ===== 泛型日志存储（带约束）+ 生成器迭代 + Symbol 属性键 =====

export class LogStore<T extends LogRecord> {
  private readonly records: T[] = [];
  [symSeq]: number = 0;

  add(r: T): void {
    this[symSeq]++;
    this.records.push(r);
  }
  get count(): number {
    return this.records.length;
  }
  get sequence(): number {
    return this[symSeq];
  }
  get last(): T | undefined {
    return this.records.length > 0
      ? this.records[this.records.length - 1]
      : undefined;
  }

  /** 生成器：逐条产出记录 */
  *iterate(): Generator<T> {
    for (const r of this.records) yield r;
  }

  /** 内置 Symbol.iterator：使存储可被 for...of 消费 */
  [Symbol.iterator](): Iterator<T> {
    return this.iterate();
  }

  filter(pred: (r: T) => boolean): T[] {
    return this.records.filter(pred);
  }
  clear(): void {
    this.records.length = 0;
    this[symSeq] = 0;
  }
}

// ===== 主 Logger 类 =====

export class Logger {
  private transports: AbstractTransport[] = [];
  private _category: string;
  private _minLevel: LogLevel;
  readonly [symOrigin]: string;

  constructor(category = "app", minLevel: LogLevel = LogLevel.DEBUG) {
    this._category = category;
    this._minLevel = minLevel;
    this[symOrigin] = category;
  }

  get category(): string {
    return this._category;
  }
  set category(v: string) {
    this._category = v;
  }
  get minLevel(): LogLevel {
    return this._minLevel;
  }
  set minLevel(v: LogLevel) {
    this._minLevel = v;
  }

  addTransport(t: AbstractTransport): this {
    this.transports.push(t);
    return this;
  }
  setLevel(level: LogLevel): this {
    this._minLevel = level;
    return this;
  }

  log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): LogOutcome[] {
    const record = this.makeRecord(level, message, meta);
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this._minLevel]) {
      return [{ kind: "filtered", reason: "level", record }];
    }
    const outcomes: LogOutcome[] = [];
    for (const t of this.transports) {
      try {
        outcomes.push(t.write(record));
      } catch (e) {
        outcomes.push({
          kind: "error",
          code: ErrorCode.TransportClosed,
          message: (e as Error).message,
        });
      }
    }
    return outcomes;
  }

  private makeRecord(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): LogRecord {
    return {
      ts: new Date().toISOString(),
      level,
      levelName: LEVEL_NAMES[level],
      category: this._category,
      message,
      meta,
    } satisfies LogRecord;
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, msg, meta);
  }
  fatal(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, msg, meta);
  }

  flush(): void {
    for (const t of this.transports) t.flush();
  }
  close(): void {
    for (const t of this.transports) t.close();
  }

  child(category: string): Logger {
    const childPath: CategoryPath = `${this._category}:${category}`;
    const c = new Logger(childPath, this._minLevel);
    c.transports = this.transports;
    return c;
  }
}

// ===== 日志文件读取 / 搜索 / 统计（生成器迭代行） =====

/** 生成器：逐行产出日志文件内容 */
export function* readLogLines(file: string): Generator<string> {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line) yield line;
  }
}

export function analyzeLogFile(file: string): LogStats {
  const stats: Mutable<LogStats> = { total: 0, byLevel: {}, byCategory: {} };
  if (!fs.existsSync(file)) return stats;
  for (const line of readLogLines(file)) {
    const m = line.match(/^\[(.+?)\] \[(\w+)\] \[(.+?)\] (.*)$/);
    if (!m) continue;
    const [, ts, level, cat] = m;
    stats.total++;
    stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
    if (!stats.earliest || ts < stats.earliest) stats.earliest = ts;
    if (!stats.latest || ts > stats.latest) stats.latest = ts;
  }
  return stats;
}

export function searchLog(
  file: string,
  pattern: string,
  maxResults = 100,
): string[] {
  if (!fs.existsSync(file)) return [];
  const re = new RegExp(pattern, "i");
  const out: string[] = [];
  for (const line of readLogLines(file)) {
    if (re.test(line)) {
      out.push(line);
      if (out.length >= maxResults) break;
    }
  }
  return out;
}

export function tailLog(file: string, lines: number): string[] {
  if (!fs.existsSync(file)) return [];
  const all: string[] = [];
  for (const line of readLogLines(file)) all.push(line);
  return all.slice(-lines);
}

// ===== CLI =====

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function resolveCommand(cmd: string | undefined): Command | undefined {
  if (!cmd) return undefined;
  return (Object.values(Command) as string[]).includes(cmd)
    ? (cmd as Command)
    : undefined;
}

async function main(): Promise<void> {
  const [, , rawCmd, ...rest] = process.argv;
  const logDir = path.join(process.cwd(), "logs");
  const logFile = path.join(logDir, "app.log");
  const cmd = resolveCommand(rawCmd);

  if (!cmd) {
    console.log(`日志记录工具 CLI
用法:
  tail [-n lines] [-l level]   查看日志末尾
  search <pattern>             搜索日志
  stats                        日志统计
  rotate                       手动轮转
  clear                        清空日志
  demo                         演示日志输出
`);
    return;
  }

  switch (cmd) {
    case Command.Tail: {
      const n = parseInt(getOpt(rest, "-n") || "20", 10);
      const lines = tailLog(logFile, n);
      const level = getOpt(rest, "-l");
      let filtered = lines;
      if (level) {
        const lv = parseLevel(level);
        const tag = (lv ?? level.toUpperCase()) as string;
        const re = new RegExp(`\\[${tag}\\]`);
        filtered = lines.filter((l) => re.test(l));
      }
      console.log(filtered.join("\n") || "(无日志)");
      break;
    }
    case Command.Search: {
      const [pattern] = rest;
      if (!pattern)
        throw new LogError(ErrorCode.InvalidLevel, "缺少搜索 pattern");
      const results = searchLog(logFile, pattern);
      console.log(`找到 ${results.length} 条匹配:`);
      console.log(results.join("\n"));
      break;
    }
    case Command.Stats: {
      const s = analyzeLogFile(logFile);
      console.log("日志统计:");
      console.log("  总条数:", s.total);
      console.log("  按级别:", s.byLevel);
      console.log("  按分类:", s.byCategory);
      if (s.earliest) console.log("  最早:", s.earliest);
      if (s.latest) console.log("  最新:", s.latest);
      break;
    }
    case Command.Rotate: {
      if (fs.existsSync(logFile)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotated = `${logFile}.${stamp}`;
        fs.renameSync(logFile, rotated);
        console.log(`已轮转: ${logFile} -> ${rotated}`);
      } else {
        console.log("(无日志文件)");
      }
      break;
    }
    case Command.Clear: {
      if (fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, "", "utf8");
        console.log("已清空日志");
      } else {
        console.log("(无日志文件)");
      }
      break;
    }
    case Command.Demo: {
      fs.mkdirSync(logDir, { recursive: true });
      const logger = new Logger("demo")
        .addTransport(new ConsoleTransport())
        .addTransport(
          new FileRotateTransport({
            file: logFile,
            maxSize: 1024 * 100,
            maxFiles: 3,
          }),
        )
        .addTransport(
          new JsonFileTransport(path.join(logDir, "app.json.log"), {
            bufferSize: 5,
          }),
        );
      logger.debug("调试信息", { id: 1 });
      logger.info("应用启动");
      logger.info("用户登录", { user: "Alice", ip: "127.0.0.1" });
      logger.warn("磁盘空间不足", { free: "1.2GB" });
      logger.error("数据库连接失败", { code: "ECONNREFUSED" });
      logger.fatal("致命错误，进程退出", { pid: process.pid });
      const child = logger.child("db");
      child.info("查询执行", { sql: "SELECT 1", ms: 3 });
      logger.flush();

      // 演示泛型存储 + 生成器迭代 + Symbol.iterator
      const store = new LogStore<LogRecord>();
      store.add({
        ts: new Date().toISOString(),
        level: LogLevel.INFO,
        levelName: LEVEL_NAMES[LogLevel.INFO],
        category: "demo",
        message: "stored record",
      } satisfies LogRecord);
      console.log(
        `\n--- 存储条数: ${store.count}, 序列: ${store.sequence} ---`,
      );
      for (const rec of store) console.log("store:", rec.message);

      // 演示判别联合 + 类型守卫
      const outcomes = logger.log(LogLevel.INFO, "outcome demo");
      for (const o of outcomes) {
        if (isLogResult(o)) console.log(`written: ${o.written}`);
        else if (isLogFiltered(o)) console.log(`filtered: ${o.reason}`);
        else if (isLogErrorResult(o)) console.log(`error: ${o.code}`);
      }

      console.log("\n--- 日志文件内容 ---");
      console.log(fs.readFileSync(logFile, "utf8"));
      const s = analyzeLogFile(logFile);
      console.log("统计:", s);
      logger.close();
      break;
    }
    default:
      throw new LogError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("错误:", msg);
    process.exit(1);
  });
}
