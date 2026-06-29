#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogStore = exports.FileRotateTransport = exports.JsonFileTransport = exports.ConsoleTransport = exports.AbstractTransport = exports.RotationError = exports.TransportError = exports.LogError = exports.LEVEL_NAMES = exports.LEVEL_PRIORITY = exports.TransportKind = exports.RotationType = exports.ErrorCode = exports.Command = exports.LogLevel = void 0;
exports.isLogLevel = isLogLevel;
exports.isLogResult = isLogResult;
exports.isLogFiltered = isLogFiltered;
exports.isLogErrorResult = isLogErrorResult;
exports.parseLevel = parseLevel;
exports.readLogLines = readLogLines;
exports.analyzeLogFile = analyzeLogFile;
exports.searchLog = searchLog;
exports.tailLog = tailLog;
/**
 * 日志记录工具 (Logging Tool) — Enhanced TypeScript Edition
 *
 * 功能：级别 DEBUG/INFO/WARN/ERROR/FATAL（字符串枚举）；多传输（控制台彩色 /
 * 文件按大小或日期轮转 / JSON）；格式化；缓冲与过滤；命令 tail/search/stats/
 * rotate/clear/demo。仅使用 Node.js 内置模块（fs / path）。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ===== 字符串枚举 =====
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
    LogLevel["FATAL"] = "FATAL";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
var Command;
(function (Command) {
    Command["Tail"] = "tail";
    Command["Search"] = "search";
    Command["Stats"] = "stats";
    Command["Rotate"] = "rotate";
    Command["Clear"] = "clear";
    Command["Demo"] = "demo";
})(Command || (exports.Command = Command = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["TransportClosed"] = "TRANSPORT_CLOSED";
    ErrorCode["RotationFailed"] = "ROTATION_FAILED";
    ErrorCode["FileNotFound"] = "FILE_NOT_FOUND";
    ErrorCode["InvalidLevel"] = "INVALID_LEVEL";
    ErrorCode["UnknownCommand"] = "UNKNOWN_COMMAND";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
var RotationType;
(function (RotationType) {
    RotationType["Size"] = "size";
    RotationType["Date"] = "date";
})(RotationType || (exports.RotationType = RotationType = {}));
var TransportKind;
(function (TransportKind) {
    TransportKind["Console"] = "console";
    TransportKind["JsonFile"] = "json-file";
    TransportKind["FileRotate"] = "file-rotate";
})(TransportKind || (exports.TransportKind = TransportKind = {}));
// ===== as const 断言 / satisfies 运算符 =====
/** 级别优先级（数值越大越严重）—— as const 保留字面量类型 */
exports.LEVEL_PRIORITY = {
    [LogLevel.DEBUG]: 10, [LogLevel.INFO]: 20, [LogLevel.WARN]: 30,
    [LogLevel.ERROR]: 40, [LogLevel.FATAL]: 50,
};
/** 级别名称映射 —— satisfies 校验完整性，同时保留字面量 */
exports.LEVEL_NAMES = {
    [LogLevel.DEBUG]: "DEBUG", [LogLevel.INFO]: "INFO", [LogLevel.WARN]: "WARN",
    [LogLevel.ERROR]: "ERROR", [LogLevel.FATAL]: "FATAL",
};
const COLORS = {
    [LogLevel.DEBUG]: "\x1b[36m", [LogLevel.INFO]: "\x1b[32m", [LogLevel.WARN]: "\x1b[33m",
    [LogLevel.ERROR]: "\x1b[31m", [LogLevel.FATAL]: "\x1b[35m",
};
const RESET = "\x1b[0m";
// ===== 类型守卫 =====
function isLogLevel(v) {
    return typeof v === "string" && Object.values(LogLevel).includes(v);
}
function isLogResult(o) { return o.kind === "result"; }
function isLogFiltered(o) { return o.kind === "filtered"; }
function isLogErrorResult(o) { return o.kind === "error"; }
// ===== 自定义错误类层级 =====
class LogError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "LogError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.LogError = LogError;
class TransportError extends LogError {
    constructor(message) { super(ErrorCode.TransportClosed, message); this.name = "TransportError"; }
}
exports.TransportError = TransportError;
class RotationError extends LogError {
    constructor(message) { super(ErrorCode.RotationFailed, message); this.name = "RotationError"; }
}
exports.RotationError = RotationError;
// ===== Symbol 唯一属性键 =====
const symOrigin = Symbol("origin");
const symSeq = Symbol("seq");
function parseLevel(name, fallback) {
    const up = String(name).toUpperCase();
    if (isLogLevel(up))
        return up;
    return fallback;
}
// ===== 抽象传输基类 + 具体子类 =====
class AbstractTransport {
    constructor(opts = {}) {
        this.closed = false;
        this.minLevel = opts.minLevel ?? LogLevel.DEBUG;
        this.categories = opts.categories ? new Set(opts.categories) : null;
    }
    get level() { return this.minLevel; }
    set level(v) { this.minLevel = v; }
    accept(r) {
        if (exports.LEVEL_PRIORITY[r.level] < exports.LEVEL_PRIORITY[this.minLevel])
            return "level";
        if (this.categories && !this.categories.has(r.category))
            return "category";
        return null;
    }
    ensureOpen() {
        if (this.closed)
            throw new TransportError("transport already closed");
    }
}
exports.AbstractTransport = AbstractTransport;
/** 控制台传输（彩色） */
class ConsoleTransport extends AbstractTransport {
    constructor() {
        super(...arguments);
        this.kind = TransportKind.Console;
    }
    write(r) {
        this.ensureOpen();
        const blocked = this.accept(r);
        if (blocked)
            return { kind: "filtered", reason: blocked, record: r };
        const color = COLORS[r.level];
        const body = r.message + (r.meta ? " " + JSON.stringify(r.meta) : "");
        const line = `[${r.ts}] [${r.level}] [${r.category}] ${body}`;
        process.stdout.write(`${color}${line}${RESET}\n`);
        return { kind: "result", record: r, written: 1 };
    }
    flush() { }
    close() { this.closed = true; }
}
exports.ConsoleTransport = ConsoleTransport;
/** JSON 文件传输（每行一个 JSON） */
class JsonFileTransport extends AbstractTransport {
    constructor(file, opts = {}) {
        super(opts);
        this.kind = TransportKind.JsonFile;
        this.buffer = [];
        this.fd = fs.openSync(path.resolve(file), "a");
        this.bufSize = opts.bufferSize ?? 100;
    }
    write(r) {
        this.ensureOpen();
        const blocked = this.accept(r);
        if (blocked)
            return { kind: "filtered", reason: blocked, record: r };
        this.buffer.push(JSON.stringify(r));
        if (this.buffer.length >= this.bufSize)
            this.flush();
        return { kind: "result", record: r, written: 1 };
    }
    flush() {
        if (this.buffer.length === 0)
            return;
        fs.writeSync(this.fd, this.buffer.join("\n") + "\n");
        this.buffer = [];
    }
    close() { this.flush(); fs.closeSync(this.fd); this.closed = true; }
}
exports.JsonFileTransport = JsonFileTransport;
/** 文件轮转传输 */
class FileRotateTransport extends AbstractTransport {
    constructor(opts) {
        super(opts);
        this.kind = TransportKind.FileRotate;
        this.buffer = [];
        this.currentSize = 0;
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
        }
        catch {
            this.currentSize = 0;
        }
    }
    get rotationType() { return this.rotateByDate ? RotationType.Date : RotationType.Size; }
    get currentPath() { return this.file; }
    write(r) {
        this.ensureOpen();
        const blocked = this.accept(r);
        if (blocked)
            return { kind: "filtered", reason: blocked, record: r };
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
        if (this.buffer.length >= this.bufSize)
            this.flush();
        return { kind: "result", record: r, written: 1 };
    }
    format(r) {
        const body = r.message + (r.meta ? " " + JSON.stringify(r.meta) : "");
        return `[${r.ts}] [${r.level}] [${r.category}] ${body}`;
    }
    rotate(suffix) {
        try {
            fs.closeSync(this.fd);
            const rotated = this.file + suffix;
            for (let i = this.maxFiles - 1; i >= 1; i--) {
                const from = `${rotated}.${i}`;
                const to = `${rotated}.${i + 1}`;
                if (fs.existsSync(from)) {
                    if (i + 1 > this.maxFiles && fs.existsSync(to))
                        fs.unlinkSync(to);
                    fs.renameSync(from, to);
                }
            }
            if (fs.existsSync(this.file))
                fs.renameSync(this.file, `${rotated}.1`);
            this.fd = fs.openSync(this.file, "a");
            this.currentSize = 0;
        }
        catch (e) {
            throw new RotationError(`rotation failed: ${e.message}`);
        }
    }
    flush() {
        if (this.buffer.length === 0)
            return;
        fs.writeSync(this.fd, this.buffer.join("\n") + "\n");
        this.buffer = [];
    }
    close() { this.flush(); fs.closeSync(this.fd); this.closed = true; }
}
exports.FileRotateTransport = FileRotateTransport;
// ===== 泛型日志存储（带约束）+ 生成器迭代 + Symbol 属性键 =====
class LogStore {
    constructor() {
        this.records = [];
        this[_a] = 0;
    }
    add(r) { this[symSeq]++; this.records.push(r); }
    get count() { return this.records.length; }
    get sequence() { return this[symSeq]; }
    get last() {
        return this.records.length > 0 ? this.records[this.records.length - 1] : undefined;
    }
    /** 生成器：逐条产出记录 */
    *iterate() { for (const r of this.records)
        yield r; }
    /** 内置 Symbol.iterator：使存储可被 for...of 消费 */
    [(_a = symSeq, Symbol.iterator)]() { return this.iterate(); }
    filter(pred) { return this.records.filter(pred); }
    clear() { this.records.length = 0; this[symSeq] = 0; }
}
exports.LogStore = LogStore;
// ===== 主 Logger 类 =====
class Logger {
    constructor(category = "app", minLevel = LogLevel.DEBUG) {
        this.transports = [];
        this._category = category;
        this._minLevel = minLevel;
        this[symOrigin] = category;
    }
    get category() { return this._category; }
    set category(v) { this._category = v; }
    get minLevel() { return this._minLevel; }
    set minLevel(v) { this._minLevel = v; }
    addTransport(t) { this.transports.push(t); return this; }
    setLevel(level) { this._minLevel = level; return this; }
    log(level, message, meta) {
        const record = this.makeRecord(level, message, meta);
        if (exports.LEVEL_PRIORITY[level] < exports.LEVEL_PRIORITY[this._minLevel]) {
            return [{ kind: "filtered", reason: "level", record }];
        }
        const outcomes = [];
        for (const t of this.transports) {
            try {
                outcomes.push(t.write(record));
            }
            catch (e) {
                outcomes.push({ kind: "error", code: ErrorCode.TransportClosed, message: e.message });
            }
        }
        return outcomes;
    }
    makeRecord(level, message, meta) {
        return {
            ts: new Date().toISOString(),
            level,
            levelName: exports.LEVEL_NAMES[level],
            category: this._category,
            message,
            meta,
        };
    }
    debug(msg, meta) { this.log(LogLevel.DEBUG, msg, meta); }
    info(msg, meta) { this.log(LogLevel.INFO, msg, meta); }
    warn(msg, meta) { this.log(LogLevel.WARN, msg, meta); }
    error(msg, meta) { this.log(LogLevel.ERROR, msg, meta); }
    fatal(msg, meta) { this.log(LogLevel.FATAL, msg, meta); }
    flush() { for (const t of this.transports)
        t.flush(); }
    close() { for (const t of this.transports)
        t.close(); }
    child(category) {
        const childPath = `${this._category}:${category}`;
        const c = new Logger(childPath, this._minLevel);
        c.transports = this.transports;
        return c;
    }
}
exports.Logger = Logger;
// ===== 日志文件读取 / 搜索 / 统计（生成器迭代行） =====
/** 生成器：逐行产出日志文件内容 */
function* readLogLines(file) {
    if (!fs.existsSync(file))
        return;
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        if (line)
            yield line;
    }
}
function analyzeLogFile(file) {
    const stats = { total: 0, byLevel: {}, byCategory: {} };
    if (!fs.existsSync(file))
        return stats;
    for (const line of readLogLines(file)) {
        const m = line.match(/^\[(.+?)\] \[(\w+)\] \[(.+?)\] (.*)$/);
        if (!m)
            continue;
        const [, ts, level, cat] = m;
        stats.total++;
        stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
        if (!stats.earliest || ts < stats.earliest)
            stats.earliest = ts;
        if (!stats.latest || ts > stats.latest)
            stats.latest = ts;
    }
    return stats;
}
function searchLog(file, pattern, maxResults = 100) {
    if (!fs.existsSync(file))
        return [];
    const re = new RegExp(pattern, "i");
    const out = [];
    for (const line of readLogLines(file)) {
        if (re.test(line)) {
            out.push(line);
            if (out.length >= maxResults)
                break;
        }
    }
    return out;
}
function tailLog(file, lines) {
    if (!fs.existsSync(file))
        return [];
    const all = [];
    for (const line of readLogLines(file))
        all.push(line);
    return all.slice(-lines);
}
// ===== CLI =====
function getOpt(args, name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}
function resolveCommand(cmd) {
    if (!cmd)
        return undefined;
    return Object.values(Command).includes(cmd) ? cmd : undefined;
}
async function main() {
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
                const tag = (lv ?? level.toUpperCase());
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
            if (s.earliest)
                console.log("  最早:", s.earliest);
            if (s.latest)
                console.log("  最新:", s.latest);
            break;
        }
        case Command.Rotate: {
            if (fs.existsSync(logFile)) {
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                const rotated = `${logFile}.${stamp}`;
                fs.renameSync(logFile, rotated);
                console.log(`已轮转: ${logFile} -> ${rotated}`);
            }
            else {
                console.log("(无日志文件)");
            }
            break;
        }
        case Command.Clear: {
            if (fs.existsSync(logFile)) {
                fs.writeFileSync(logFile, "", "utf8");
                console.log("已清空日志");
            }
            else {
                console.log("(无日志文件)");
            }
            break;
        }
        case Command.Demo: {
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
            // 演示泛型存储 + 生成器迭代 + Symbol.iterator
            const store = new LogStore();
            store.add({
                ts: new Date().toISOString(),
                level: LogLevel.INFO,
                levelName: exports.LEVEL_NAMES[LogLevel.INFO],
                category: "demo",
                message: "stored record",
            });
            console.log(`\n--- 存储条数: ${store.count}, 序列: ${store.sequence} ---`);
            for (const rec of store)
                console.log("store:", rec.message);
            // 演示判别联合 + 类型守卫
            const outcomes = logger.log(LogLevel.INFO, "outcome demo");
            for (const o of outcomes) {
                if (isLogResult(o))
                    console.log(`written: ${o.written}`);
                else if (isLogFiltered(o))
                    console.log(`filtered: ${o.reason}`);
                else if (isLogErrorResult(o))
                    console.log(`error: ${o.code}`);
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
    main().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("错误:", msg);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map