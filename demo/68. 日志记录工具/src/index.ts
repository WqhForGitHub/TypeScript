#!/usr/bin/env node
/**
 * 日志记录工具
 * - 日志级别：DEBUG / INFO / WARN / ERROR / FATAL
 * - 多种传输：控制台（彩色）/ 文件（按大小或日期轮转）/ JSON
 * - 格式化：时间戳、级别、分类、消息、元数据
 * - 缓冲、按级别/分类过滤
 * - 命令：tail / search / stats / rotate / clear
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  FATAL = 50,
}

export const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.FATAL]: "FATAL",
};

export interface LogRecord {
  ts: string; // ISO 时间
  level: LogLevel;
  levelName: string;
  category: string;
  message: string;
  meta?: Record<string, unknown>;
}

/** 传输接口 */
export interface Transport {
  write(record: LogRecord): void;
  flush?(): void;
}

/** 颜色映射（ANSI） */
const COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "\x1b[36m", // cyan
  [LogLevel.INFO]: "\x1b[32m",  // green
  [LogLevel.WARN]: "\x1b[33m",  // yellow
  [LogLevel.ERROR]: "\x1b[31m", // red
  [LogLevel.FATAL]: "\x1b[35m", // magenta
};
const RESET = "\x1b[0m";

/** 控制台传输（彩色） */
export class ConsoleTransport implements Transport {
  private minLevel: LogLevel;
  private categories: Set<string> | null;

  constructor(opts: { minLevel?: LogLevel; categories?: string[] } = {}) {
    this.minLevel = opts.minLevel ?? LogLevel.DEBUG;
    this.categories = opts.categories ? new Set(opts.categories) : null;
  }
  write(r: LogRecord): void {
    if (r.level < this.minLevel) return;
    if (this.categories && !this.categories.has(r.category)) return;
    const color = COLORS[r.level];
    const meta = r.meta ? " " + JSON.stringify(r.meta) : "";
    process.stdout.write(
      `${color}[${r.ts}] [${r.levelName}] [${r.category}]${RESET} ${r.message}${meta}\n`
    );
  }
}

/** JSON 传输（写文件，每行一个 JSON） */
export class JsonFileTransport implements Transport {
  private fd: number;
  private buffer: string[] = [];
  private bufSize: number;
  private minLevel: LogLevel;
  constructor(file: string, opts: { minLevel?: LogLevel; bufferSize?: number } = {}) {
    this.fd = fs.openSync(path.resolve(file), "a");
    this.minLevel = opts.minLevel ?? LogLevel.DEBUG;
    this.bufSize = opts.bufferSize ?? 100;
  }
  write(r: LogRecord): void {
    if (r.level < this.minLevel) return;
    this.buffer.push(JSON.stringify(r));
    if (this.buffer.length >= this.bufSize) this.flush();
  }
  flush(): void {
    if (this.buffer.length === 0) return;
    fs.writeSync(this.fd, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }
  close(): void {
    this.flush();
    fs.closeSync(this.fd);
  }
}

/** 文件轮转传输 */
export interface RotateOptions {
  file: string;
  maxSize?: number; // 字节，默认 10MB
  maxFiles?: number; // 保留数量
  rotateByDate?: boolean; // 按日期轮转
  minLevel?: LogLevel;
  bufferSize?: number;
}

export class FileRotateTransport implements Transport {
  private file: string;
  private maxSize: number;
  private maxFiles: number;
  private rotateByDate: boolean;
  private minLevel: LogLevel;
  private buffer: string[] = [];
  private bufSize: number;
  private currentSize = 0;
  private currentDate: string;
  private fd: number;

  constructor(opts: RotateOptions) {
    this.file = path.resolve(opts.file);
    this.maxSize = opts.maxSize ?? 10 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 5;
    this.rotateByDate = opts.rotateByDate ?? false;
    this.minLevel = opts.minLevel ?? LogLevel.DEBUG;
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

  write(r: LogRecord): void {
    if (r.level < this.minLevel) return;
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
  }

  private format(r: LogRecord): string {
    const meta = r.meta ? " " + JSON.stringify(r.meta) : "";
    return `[${r.ts}] [${r.levelName}] [${r.category}] ${r.message}${meta}`;
  }

  private rotate(suffix: string): void {
    fs.closeSync(this.fd);
    // 现有 file -> file.1
    const rotated = this.file + suffix;
    // 移动旧的轮转文件
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${rotated}.${i}`;
      const to = `${rotated}.${i + 1}`;
      if (fs.existsSync(from)) {
        if (i + 1 > this.maxFiles && fs.existsSync(to)) fs.unlinkSync(to);
        fs.renameSync(from, to);
      }
    }
    if (fs.existsSync(this.file)) {
      fs.renameSync(this.file, `${rotated}.1`);
    }
    this.fd = fs.openSync(this.file, "a");
    this.currentSize = 0;
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    fs.writeSync(this.fd, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }

  close(): void {
    this.flush();
    fs.closeSync(this.fd);
  }
}

/** 主 Logger 类 */
export class Logger {
  private transports: Transport[] = [];
  private category: string;
  private minLevel: LogLevel;

  constructor(category = "app", minLevel: LogLevel = LogLevel.DEBUG) {
    this.category = category;
    this.minLevel = minLevel;
  }

  addTransport(t: Transport): this {
    this.transports.push(t);
    return this;
  }

  setLevel(level: LogLevel): this {
    this.minLevel = level;
    return this;
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (level < this.minLevel) return;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      levelName: LEVEL_NAMES[level],
      category: this.category,
      message,
      meta,
    };
    for (const t of this.transports) t.write(record);
  }

  debug(msg: string, meta?: Record<string, unknown>): void { this.log(LogLevel.DEBUG, msg, meta); }
  info(msg: string, meta?: Record<string, unknown>): void { this.log(LogLevel.INFO, msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void { this.log(LogLevel.WARN, msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this.log(LogLevel.ERROR, msg, meta); }
  fatal(msg: string, meta?: Record<string, unknown>): void { this.log(LogLevel.FATAL, msg, meta); }

  flush(): void {
    for (const t of this.transports) if (t.flush) t.flush();
  }

  child(category: string): Logger {
    const c = new Logger(`${this.category}:${category}`, this.minLevel);
    c.transports = this.transports;
    return c;
  }
}

/* ----------------------- 日志文件读取/搜索 ----------------------- */

export interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
  earliest?: string;
  latest?: string;
}

/** 读取日志文件统计 */
export function analyzeLogFile(file: string): LogStats {
  const stats: LogStats = {
    total: 0,
    byLevel: {},
    byCategory: {},
  };
  if (!fs.existsSync(file)) return stats;
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  // 同步遍历（这里用逐行读取，但返回 Promise 会更自然；为了同步统计改用 readFileSync split）
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^\[(.+?)\] \[(\w+)\] \[(.+?)\] (.*)$/);
    if (!m) continue;
    const [, ts, level, cat] = m;
    stats.total++;
    stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
    if (!stats.earliest || ts < stats.earliest) stats.earliest = ts;
    if (!stats.latest || ts > stats.latest) stats.latest = ts;
  }
  void rl;
  return stats;
}

/** 在日志中搜索 */
export function searchLog(file: string, pattern: string, maxResults = 100): string[] {
  if (!fs.existsSync(file)) return [];
  const re = new RegExp(pattern, "i");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (re.test(line)) {
      out.push(line);
      if (out.length >= maxResults) break;
    }
  }
  return out;
}

/** tail 日志 */
export function tailLog(file: string, lines: number): string[] {
  if (!fs.existsSync(file)) return [];
  const all = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l);
  return all.slice(-lines);
}

/* ----------------------- CLI ----------------------- */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasOpt(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const logDir = path.join(process.cwd(), "logs");
  const logFile = path.join(logDir, "app.log");

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
    case "tail": {
      const n = parseInt(getOpt(rest, "-n") || "20", 10);
      const lines = tailLog(logFile, n);
      const level = getOpt(rest, "-l");
      let filtered = lines;
      if (level) {
        const re = new RegExp(`\\[${level.toUpperCase()}\\]`);
        filtered = lines.filter((l) => re.test(l));
      }
      console.log(filtered.join("\n") || "(无日志)");
      break;
    }
    case "search": {
      const [pattern] = rest;
      if (!pattern) throw new Error("缺少搜索 pattern");
      const results = searchLog(logFile, pattern);
      console.log(`找到 ${results.length} 条匹配:`);
      console.log(results.join("\n"));
      break;
    }
    case "stats": {
      const s = analyzeLogFile(logFile);
      console.log("日志统计:");
      console.log("  总条数:", s.total);
      console.log("  按级别:", s.byLevel);
      console.log("  按分类:", s.byCategory);
      if (s.earliest) console.log("  最早:", s.earliest);
      if (s.latest) console.log("  最新:", s.latest);
      break;
    }
    case "rotate": {
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
    case "clear": {
      if (fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, "", "utf8");
        console.log("已清空日志");
      } else console.log("(无日志文件)");
      break;
    }
    case "demo": {
      fs.mkdirSync(logDir, { recursive: true });
      const logger = new Logger("demo")
        .addTransport(new ConsoleTransport())
        .addTransport(new FileRotateTransport({ file: logFile, maxSize: 1024 * 100, maxFiles: 3 }))
        .addTransport(new JsonFileTransport(path.join(logDir, "app.json.log"), { bufferSize: 5 }));
      logger.debug("调试信息", { id: 1 });
      logger.info("应用启动");
      logger.info("用户登录", { user: "Alice", ip: "127.0.0.1" });
      logger.warn("磁盘空间不足", { free: "1.2GB" });
      logger.error("数据库连接失败", { code: "ECONNREFUSED" });
      logger.fatal("致命错误，进程退出", { pid: process.pid });
      const child = logger.child("db");
      child.info("查询执行", { sql: "SELECT 1", ms: 3 });
      logger.flush();
      console.log("\n--- 日志文件内容 ---");
      console.log(fs.readFileSync(logFile, "utf8"));
      const s = analyzeLogFile(logFile);
      console.log("统计:", s);
      break;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
