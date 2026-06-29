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
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 文件批量重命名工具 (Batch File Rename Tool) - Enhanced Edition
 * 支持模板/替换/正则/大小写/前缀后缀/序号/日期/冲突解决/撤销/事务日志/过滤/排序/进度/彩色预览/dry-run diff。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// === 1. Enums ===
var RenameMode;
(function (RenameMode) {
    RenameMode["Template"] = "template";
    RenameMode["Replace"] = "replace";
    RenameMode["Regex"] = "regex";
    RenameMode["Case"] = "case";
    RenameMode["PrefixSuffix"] = "prefixSuffix";
    RenameMode["Sequence"] = "sequence";
})(RenameMode || (RenameMode = {}));
var CaseConversion;
(function (CaseConversion) {
    CaseConversion["Lower"] = "lower";
    CaseConversion["Upper"] = "upper";
    CaseConversion["Title"] = "title";
    CaseConversion["Camel"] = "camel";
    CaseConversion["Snake"] = "snake";
    CaseConversion["Kebab"] = "kebab";
})(CaseConversion || (CaseConversion = {}));
var ConflictResolution;
(function (ConflictResolution) {
    ConflictResolution["Skip"] = "skip";
    ConflictResolution["Overwrite"] = "overwrite";
    ConflictResolution["AutoRename"] = "autoRename";
})(ConflictResolution || (ConflictResolution = {}));
var SortField;
(function (SortField) {
    SortField["Name"] = "name";
    SortField["Date"] = "date";
    SortField["Size"] = "size";
})(SortField || (SortField = {}));
var PreviewAction;
(function (PreviewAction) {
    PreviewAction["Preview"] = "preview";
    PreviewAction["Execute"] = "execute";
    PreviewAction["Diff"] = "diff";
    PreviewAction["Undo"] = "undo";
})(PreviewAction || (PreviewAction = {}));
// === 2. Symbols ===
const STRATEGY_SYMBOL = Symbol("strategyId");
const TRANSACTION_SYMBOL = Symbol("transaction");
// === 7. Custom Error hierarchy ===
class RenameError extends Error {
    constructor(message, code = "RENAME_ERROR") {
        super(message);
        this.code = code;
        this.name = "RenameError";
    }
}
class ConflictError extends RenameError {
    constructor(message, conflicts) {
        super(message, "CONFLICT");
        this.conflicts = conflicts;
        this.name = "ConflictError";
    }
}
class InvalidPatternError extends RenameError {
    constructor(message) { super(message, "INVALID_PATTERN"); this.name = "InvalidPatternError"; }
}
class FileNotFoundError extends RenameError {
    constructor(dir) { super(`目录不存在: ${dir}`, "NOT_FOUND"); this.name = "FileNotFoundError"; }
}
class UndoError extends RenameError {
    constructor(message) { super(message, "UNDO_FAILED"); this.name = "UndoError"; }
}
// === 8. Type guards ===
function isRenameMode(v) { return typeof v === "string" && Object.values(RenameMode).includes(v); }
function isCaseConversion(v) { return typeof v === "string" && Object.values(CaseConversion).includes(v); }
function isConflictResolution(v) { return typeof v === "string" && Object.values(ConflictResolution).includes(v); }
function isSortField(v) { return typeof v === "string" && Object.values(SortField).includes(v); }
function isFileEntry(v) { return typeof v === "object" && v !== null && "name" in v && "path" in v && "size" in v; }
function isPreviewResult(v) { return typeof v === "object" && v !== null && "kind" in v; }
// === 9. Constants (`as const` + `satisfies`) ===
const COLORS = {
    red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
    magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m", reset: "\x1b[0m", bold: "\x1b[1m",
};
const DEFAULT_OPTIONS = {
    conflict: ConflictResolution.Skip, startIndex: 1, padding: 3, ascending: true, includeHidden: false,
};
// === 10. Helpers ===
function colorize(text, color) { return `${COLORS[color]}${text}${COLORS.reset}`; }
function formatDate(fmt) {
    const d = new Date();
    const map = {
        YYYY: String(d.getFullYear()), MM: String(d.getMonth() + 1).padStart(2, "0"),
        DD: String(d.getDate()).padStart(2, "0"), HH: String(d.getHours()).padStart(2, "0"),
        mm: String(d.getMinutes()).padStart(2, "0"), ss: String(d.getSeconds()).padStart(2, "0"),
    };
    let r = fmt;
    for (const [k, v] of Object.entries(map))
        r = r.split(k).join(v);
    return r;
}
function parseExtList(s) {
    if (!s)
        return undefined;
    return s.split(",").map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`)).filter(Boolean);
}
// === 11. Generators ===
function* iterateFiles(dir, filter) {
    if (!fs.existsSync(dir))
        throw new FileNotFoundError(dir);
    const stat = fs.statSync(dir);
    if (!stat.isDirectory())
        throw new RenameError(`不是目录: ${dir}`, "NOT_DIR");
    for (const name of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, name);
        let s;
        try {
            s = fs.statSync(fullPath);
        }
        catch {
            continue;
        }
        if (!s.isFile())
            continue;
        if (!filter?.includeHidden && name.startsWith("."))
            continue;
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        if (filter?.extensions && !filter.extensions.includes(ext.toLowerCase()))
            continue;
        if (filter?.pattern && !filter.pattern.test(name))
            continue;
        if (filter?.minSize !== undefined && s.size < filter.minSize)
            continue;
        if (filter?.maxSize !== undefined && s.size > filter.maxSize)
            continue;
        yield { name, path: fullPath, size: s.size, mtime: s.mtime, ext, base };
    }
}
function collectFiles(dir, filter) { return Array.from(iterateFiles(dir, filter)); }
function sortFiles(files, opts) {
    if (!opts)
        return [...files];
    const sorted = [...files];
    const asc = opts.ascending ?? true;
    switch (opts.field) {
        case SortField.Name:
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case SortField.Date:
            sorted.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
            break;
        case SortField.Size:
            sorted.sort((a, b) => a.size - b.size);
            break;
    }
    return asc ? sorted : sorted.reverse();
}
// === 12. Case conversions ===
function toTitleCase(s) { return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()); }
function toCamelCase(s) {
    return s.split(/[\s_-]+/).filter(Boolean)
        .map((p, i) => i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
}
function toSnakeCase(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase(); }
function toKebabCase(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase(); }
function applyCase(name, type) {
    switch (type) {
        case CaseConversion.Lower: return name.toLowerCase();
        case CaseConversion.Upper: return name.toUpperCase();
        case CaseConversion.Title: return toTitleCase(name);
        case CaseConversion.Camel: return toCamelCase(name);
        case CaseConversion.Snake: return toSnakeCase(name);
        case CaseConversion.Kebab: return toKebabCase(name);
    }
}
// === 13. Template application ===
function applyTemplate(template, original, index, startIndex, padding) {
    const ext = path.extname(original);
    const name = path.basename(original, ext);
    let r = template;
    r = r.replace(/\{index:(\d+)\}/g, (_, n) => String(index).padStart(parseInt(n, 10), "0"));
    r = r.replace(/\{n:(\d+)\}/g, (_, n) => String(index).padStart(parseInt(n, 10), "0"));
    r = r.replace(/\{date:([^}]+)\}/g, (_, fmt) => formatDate(fmt));
    r = r.replace(/\{date\}/g, formatDate("YYYYMMDD"));
    r = r.replace(/\{time\}/g, formatDate("HHmmss"));
    r = r.replace(/\{name\}/g, name);
    r = r.replace(/\{base\}/g, name);
    r = r.replace(/\{ext\}/g, ext);
    r = r.replace(/\{n\}/g, String(index).padStart(padding, "0"));
    r = r.replace(/\{index\}/g, String(index - startIndex + 1));
    return r;
}
// === 14. Abstract strategy + subclasses ===
class AbstractRenameStrategy {
    constructor(mode) {
        this.mode = mode;
        this[STRATEGY_SYMBOL] = mode;
    }
}
class TemplateStrategy extends AbstractRenameStrategy {
    constructor(template) {
        super(RenameMode.Template);
        this.template = template;
        this.displayName = "Template";
    }
    validate() { if (!this.template)
        throw new InvalidPatternError("模板不能为空"); }
    transform(entry, index, startIndex) { return applyTemplate(this.template, entry.name, index, startIndex, 0); }
}
class ReplaceStrategy extends AbstractRenameStrategy {
    constructor(from, to) {
        super(RenameMode.Replace);
        this.from = from;
        this.to = to;
        this.displayName = "Replace";
    }
    validate() { if (!this.from)
        throw new InvalidPatternError("替换源字符串不能为空"); }
    transform(entry) { return entry.name.split(this.from).join(this.to); }
}
class RegexStrategy extends AbstractRenameStrategy {
    constructor(pattern, flags, replacement) {
        super(RenameMode.Regex);
        this.replacement = replacement;
        this.displayName = "Regex";
        try {
            this.re = new RegExp(pattern, flags);
        }
        catch (e) {
            throw new InvalidPatternError(`正则表达式无效: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    validate() { }
    transform(entry) { return entry.name.replace(this.re, this.replacement); }
}
class CaseStrategy extends AbstractRenameStrategy {
    constructor(caseType) {
        super(RenameMode.Case);
        this.caseType = caseType;
        this.displayName = `Case:${this.caseType}`;
    }
    validate() { if (!isCaseConversion(this.caseType))
        throw new InvalidPatternError(`无效的大小写类型: ${this.caseType}`); }
    transform(entry) { return applyCase(entry.name, this.caseType); }
}
class PrefixSuffixStrategy extends AbstractRenameStrategy {
    constructor(prefix = "", suffix = "") {
        super(RenameMode.PrefixSuffix);
        this.prefix = prefix;
        this.suffix = suffix;
        this.displayName = "PrefixSuffix";
    }
    validate() { if (!this.prefix && !this.suffix)
        throw new InvalidPatternError("前缀和后缀不能同时为空"); }
    transform(entry) { return `${this.prefix}${entry.base}${this.suffix}${entry.ext}`; }
}
class SequenceStrategy extends AbstractRenameStrategy {
    constructor(template, startIndex = 1, padding = 3) {
        super(RenameMode.Sequence);
        this.template = template;
        this.startIndex = startIndex;
        this.padding = padding;
        this.displayName = "Sequence";
    }
    validate() {
        if (!this.template)
            throw new InvalidPatternError("序号模板不能为空");
        if (this.padding < 0)
            throw new InvalidPatternError("填充位数不能为负");
        if (this.startIndex < 0)
            throw new InvalidPatternError("起始序号不能为负");
    }
    transform(entry, index, startIndex) {
        const seq = (startIndex ?? 1) + index;
        return applyTemplate(this.template, entry.name, seq, startIndex, this.padding);
    }
}
// === 15. Strategy factory (mapped type) ===
function createStrategy(op) {
    const map = {
        [RenameMode.Template]: new TemplateStrategy(op.template),
        [RenameMode.Replace]: new ReplaceStrategy(op.from, op.to),
        [RenameMode.Regex]: new RegexStrategy(op.regex, op.flags, op.replacement),
        [RenameMode.Case]: new CaseStrategy(op.caseType),
        [RenameMode.PrefixSuffix]: new PrefixSuffixStrategy(op.prefix, op.suffix),
        [RenameMode.Sequence]: new SequenceStrategy(op.template, op.startIndex, op.padding),
    };
    const strategy = map[op.mode];
    if (!strategy)
        throw new RenameError(`未知的重命名模式: ${op.mode}`);
    return strategy;
}
function* generateRenamePlans(dir, strategy, opts) {
    const files = sortFiles(collectFiles(dir, opts.filter), opts.sort);
    const start = opts.startIndex ?? DEFAULT_OPTIONS.startIndex;
    for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const newName = strategy.transform(entry, i, start);
        yield { oldPath: entry.path, newPath: path.join(dir, newName), oldName: entry.name, newName };
    }
}
// === 17. Iterable collection (Symbol.iterator + getters) ===
class RenamePlanCollection {
    constructor(pairs) { this._pairs = Object.freeze([...pairs]); }
    [Symbol.iterator]() {
        let i = 0;
        const pairs = this._pairs;
        return { next() {
                if (i >= pairs.length)
                    return { done: true, value: undefined };
                return { done: false, value: pairs[i++] };
            } };
    }
    get length() { return this._pairs.length; }
    get pairs() { return this._pairs; }
    filter(pred) { return new RenamePlanCollection(this._pairs.filter(pred)); }
}
// === 18. Conflict detection + resolution ===
function detectConflicts(pairs) {
    const events = [];
    const counts = new Map();
    for (const p of pairs)
        counts.set(p.newName, (counts.get(p.newName) ?? 0) + 1);
    for (const [name, count] of counts)
        if (count > 1)
            events.push({ type: "duplicate", name, count });
    return events;
}
function resolveAutoName(name, used, attempt) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let candidate = `${base}_${attempt}${ext}`;
    while (used.has(candidate))
        candidate = `${base}_${++attempt}${ext}`;
    return candidate;
}
// === 19. Preview builder ===
function buildPreview(dir, strategy, opts) {
    const rawPairs = Array.from(generateRenamePlans(dir, strategy, opts));
    const results = [];
    const existing = new Set(collectFiles(dir).map((f) => f.name));
    const used = new Set();
    const finalPairs = [];
    const resolution = opts.conflict ?? DEFAULT_OPTIONS.conflict;
    for (const pair of rawPairs) {
        if (pair.oldName === pair.newName) {
            results.push({ kind: "unchanged", name: pair.oldName });
            continue;
        }
        const hasConflict = used.has(pair.newName) || (existing.has(pair.newName) && pair.newName !== pair.oldName);
        if (hasConflict) {
            if (resolution === ConflictResolution.Skip) {
                results.push({ kind: "conflict", pair, reason: "命名冲突，跳过" });
                continue;
            }
            if (resolution === ConflictResolution.AutoRename) {
                const candidate = resolveAutoName(pair.newName, used, 1);
                const newPair = { oldPath: pair.oldPath, newPath: path.join(dir, candidate), oldName: pair.oldName, newName: candidate };
                finalPairs.push(newPair);
                used.add(candidate);
                results.push({ kind: "success", pair: newPair });
                continue;
            }
            // Overwrite falls through
        }
        finalPairs.push(pair);
        used.add(pair.newName);
        results.push({ kind: "success", pair });
    }
    return { collection: new RenamePlanCollection(finalPairs), results };
}
// === 20. Color-coded preview + diff ===
function printPreview(results, dir) {
    let changed = 0;
    const rows = [];
    for (const r of results) {
        if (r.kind === "success") {
            changed++;
            rows.push({ old: r.pair.oldName, new: r.pair.newName, color: "cyan", mark: "" });
        }
        else if (r.kind === "conflict") {
            changed++;
            rows.push({ old: r.pair.oldName, new: r.pair.newName, color: "yellow", mark: " [冲突]" });
        }
    }
    if (rows.length === 0) {
        console.log(colorize("没有需要重命名的文件。", "gray"));
        return 0;
    }
    const w1 = Math.max(...rows.map((r) => r.old.length), 4);
    console.log(`\n${colorize("目录:", "bold")} ${path.resolve(dir)}`);
    console.log(colorize(`将重命名 ${changed} 个文件:\n`, "green"));
    for (const r of rows)
        console.log(`  ${r.old.padEnd(w1)}  ${colorize("->", "gray")}  ${colorize(r.new + r.mark, r.color)}`);
    const conflicts = results.filter((r) => r.kind === "conflict").length;
    if (conflicts > 0)
        console.log(colorize(`\n警告: ${conflicts} 个文件存在命名冲突。`, "yellow"));
    console.log("");
    return changed;
}
function printDiff(results) {
    console.log(colorize("\n=== Dry Run Diff ===\n", "bold"));
    for (const r of results) {
        switch (r.kind) {
            case "success":
                console.log(`  ${colorize("-", "red")} ${r.pair.oldName}`);
                console.log(`  ${colorize("+", "green")} ${r.pair.newName}`);
                break;
            case "conflict":
                console.log(`  ${colorize("!", "yellow")} ${r.pair.oldName} -> ${r.pair.newName} ${colorize(`(${r.reason})`, "yellow")}`);
                break;
            case "unchanged":
                console.log(`  ${colorize(" ", "gray")} ${r.name} ${colorize("(不变)", "gray")}`);
                break;
            case "skipped":
                console.log(`  ${colorize("#", "gray")} ${r.name} ${colorize(`(${r.reason})`, "gray")}`);
                break;
        }
    }
    console.log("");
}
const TX_FILE = path.join(os.tmpdir(), "batch-rename-transactions.json");
function loadLogs() {
    try {
        const raw = fs.readFileSync(TX_FILE, "utf-8");
        const arr = JSON.parse(raw);
        return arr.map((s) => ({
            id: s.id, timestamp: new Date(s.timestamp), dir: s.dir,
            pairs: s.pairs, mode: s.mode,
            [TRANSACTION_SYMBOL]: true,
        }));
    }
    catch {
        return [];
    }
}
function saveLogs(logs) {
    try {
        const ser = logs.map((t) => ({
            id: t.id, timestamp: t.timestamp.toISOString(), dir: t.dir, pairs: t.pairs, mode: t.mode,
        }));
        fs.writeFileSync(TX_FILE, JSON.stringify(ser, null, 2), "utf-8");
    }
    catch { /* ignore persistence errors */ }
}
class TransactionManager {
    constructor() {
        this._logs = loadLogs();
        this._counter = this._logs.reduce((m, t) => Math.max(m, t.id), 0);
    }
    get count() { return this._logs.length; }
    get last() { return this._logs[this._logs.length - 1]; }
    get isEmpty() { return this._logs.length === 0; }
    get all() { return this._logs; }
    log(dir, pairs, mode) {
        const tx = {
            id: ++this._counter, timestamp: new Date(), dir,
            pairs: pairs, mode, [TRANSACTION_SYMBOL]: true,
        };
        this._logs.push(tx);
        saveLogs(this._logs);
        return tx;
    }
    undoLast() {
        const tx = this._logs.pop();
        if (!tx)
            throw new UndoError("没有可撤销的事务");
        const tempMap = new Map();
        let i = 0;
        for (const [oldName, newName] of tx.pairs) {
            const temp = `.__undo_tmp_${tx.id}_${i}__`;
            const currentP = path.join(tx.dir, newName);
            if (fs.existsSync(currentP)) {
                fs.renameSync(currentP, path.join(tx.dir, temp));
                tempMap.set(temp, oldName);
            }
            i++;
        }
        for (const [temp, oldName] of tempMap)
            fs.renameSync(path.join(tx.dir, temp), path.join(tx.dir, oldName));
        saveLogs(this._logs);
        return tx;
    }
    clear() { this._logs.length = 0; saveLogs(this._logs); }
}
const transactionManager = new TransactionManager();
function defaultProgress(current, total, name) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    process.stdout.write(`\r${colorize(`[${pct}%]`, "magenta")} ${current}/${total} ${name}`.padEnd(80, " "));
    if (current === total)
        process.stdout.write("\n");
}
function executeRename(collection, dir, mode, opts) {
    const pairs = [...collection];
    const total = pairs.length;
    if (opts.dryRun) {
        console.log(colorize("[Dry Run] 不会实际执行重命名。", "magenta"));
        return total;
    }
    let done = 0;
    const tempMap = new Map();
    const logPairs = [];
    for (const p of pairs) {
        opts.onProgress?.(done + 1, total, p.oldName);
        const temp = `.__batch_tmp_${process.pid}_${done}__`;
        try {
            fs.renameSync(p.oldPath, path.join(dir, temp));
            tempMap.set(temp, p.newName);
            logPairs.push([p.oldName, p.newName]);
            done++;
        }
        catch (e) {
            console.error(colorize(`\n失败: ${p.oldName} - ${e instanceof Error ? e.message : String(e)}`, "red"));
        }
    }
    for (const [temp, newName] of tempMap)
        fs.renameSync(path.join(dir, temp), path.join(dir, newName));
    transactionManager.log(dir, logPairs, mode);
    console.log(colorize(`\n完成: 成功重命名 ${done} 个文件。`, "green"));
    return done;
}
function rename(dir, opts) {
    const strategy = createStrategy(opts);
    strategy.validate();
    const { collection } = buildPreview(dir, strategy, opts);
    return [...collection];
}
function parseArgs(args) {
    const rest = [];
    let yes = false, dry = false, desc = false;
    let conflict = DEFAULT_OPTIONS.conflict;
    let sort;
    let exts;
    let min, max;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "-y" || a === "--yes")
            yes = true;
        else if (a === "--dry")
            dry = true;
        else if (a === "--desc")
            desc = true;
        else if (a === "--conflict") {
            const v = args[++i];
            if (isConflictResolution(v))
                conflict = v;
        }
        else if (a === "--sort") {
            const v = args[++i];
            if (isSortField(v))
                sort = v;
        }
        else if (a === "--ext")
            exts = parseExtList(args[++i]);
        else if (a === "--min")
            min = Number(args[++i]);
        else if (a === "--max")
            max = Number(args[++i]);
        else
            rest.push(a);
    }
    return { rest, yes, dry, conflict, sort, desc, exts, min, max };
}
function runStrategy(dir, strategy, parsed, action) {
    const opts = {
        mode: strategy.mode, conflict: parsed.conflict, dryRun: parsed.dry,
        filter: { extensions: parsed.exts, minSize: parsed.min, maxSize: parsed.max, includeHidden: DEFAULT_OPTIONS.includeHidden },
        sort: parsed.sort ? { field: parsed.sort, ascending: !parsed.desc } : undefined,
        startIndex: DEFAULT_OPTIONS.startIndex, padding: DEFAULT_OPTIONS.padding, onProgress: defaultProgress,
    };
    strategy.validate();
    const { collection, results } = buildPreview(dir, strategy, opts);
    if (action === PreviewAction.Diff) {
        printDiff(results);
        return;
    }
    const changed = printPreview(results, dir);
    if (changed === 0)
        return;
    if (action === PreviewAction.Preview || (!parsed.yes && !parsed.dry)) {
        if (parsed.dry) {
            console.log(colorize("[Dry Run] 不会实际执行重命名。", "magenta"));
            return;
        }
        console.log(colorize("这是预览模式。如需真正执行，请添加 -y 标志。", "yellow"));
        return;
    }
    executeRename(collection, dir, strategy.mode, { dryRun: parsed.dry, onProgress: defaultProgress });
}
// === 25. CLI command handlers ===
function cmdTemplate(args, action) {
    const parsed = parseArgs(args);
    const [dir, pattern] = parsed.rest;
    if (!dir || !pattern) {
        console.error("错误: 用法 <dir> <pattern>");
        process.exit(1);
    }
    runStrategy(dir, new TemplateStrategy(pattern), parsed, action);
}
function cmdReplace(args) {
    const parsed = parseArgs(args);
    const [dir, from, to] = parsed.rest;
    if (!dir || !from) {
        console.error("错误: 用法 replace <dir> <from> <to> [-y]");
        process.exit(1);
    }
    runStrategy(dir, new ReplaceStrategy(from, to ?? ""), parsed, PreviewAction.Execute);
}
function cmdRegex(args) {
    const parsed = parseArgs(args);
    const [dir, pattern, replacement] = parsed.rest;
    if (!dir || !pattern) {
        console.error("错误: 用法 regex <dir> <pattern> <replacement> [-y]");
        process.exit(1);
    }
    runStrategy(dir, new RegexStrategy(pattern, "g", replacement ?? ""), parsed, PreviewAction.Execute);
}
function cmdCase(args, caseType) {
    const parsed = parseArgs(args);
    const [dir] = parsed.rest;
    if (!dir) {
        console.error("错误: 用法 <dir> [-y]");
        process.exit(1);
    }
    runStrategy(dir, new CaseStrategy(caseType), parsed, PreviewAction.Execute);
}
function cmdPrefixSuffix(args, isSuffix) {
    const parsed = parseArgs(args);
    const [dir, value] = parsed.rest;
    if (!dir) {
        console.error("错误: 用法 <dir> <value> [-y]");
        process.exit(1);
    }
    const v = value ?? "";
    runStrategy(dir, new PrefixSuffixStrategy(isSuffix ? "" : v, isSuffix ? v : ""), parsed, PreviewAction.Execute);
}
function cmdSequence(args) {
    const parsed = parseArgs(args);
    const [dir, pattern] = parsed.rest;
    if (!dir || !pattern) {
        console.error("错误: 用法 sequence <dir> <pattern> [-y]");
        process.exit(1);
    }
    runStrategy(dir, new SequenceStrategy(pattern, DEFAULT_OPTIONS.startIndex, DEFAULT_OPTIONS.padding), parsed, PreviewAction.Execute);
}
function cmdUndo() {
    try {
        const tx = transactionManager.undoLast();
        console.log(colorize(`已撤销事务 #${tx.id} (${tx.mode})，共 ${tx.pairs.length} 个文件。`, "green"));
    }
    catch (e) {
        console.error(colorize(`撤销失败: ${e instanceof Error ? e.message : String(e)}`, "red"));
        process.exit(1);
    }
}
function printHelp() {
    console.log(`
文件批量重命名工具 (Batch File Rename Tool) - Enhanced
======================================================
支持模板、替换、正则、大小写、前缀后缀、序号、撤销、事务日志等。

用法:
  batch-rename preview   <dir> <pattern>                 预览模板重命名
  batch-rename execute   <dir> <pattern> [-y]            执行模板重命名
  batch-rename diff      <dir> <pattern>                 dry-run 详细 diff
  batch-rename replace   <dir> <from> <to> [-y]          替换字符串
  batch-rename regex     <dir> <pattern> <repl> [-y]     正则替换
  batch-rename lowercase <dir> [-y]                      转小写
  batch-rename uppercase <dir> [-y]                      转大写
  batch-rename titlecase <dir> [-y]                      转标题大小写
  batch-rename snake     <dir> [-y]                      转蛇形命名
  batch-rename kebab     <dir> [-y]                      转短横线命名
  batch-rename addprefix <dir> <prefix> [-y]             添加前缀
  batch-rename addsuffix <dir> <suffix> [-y]             添加后缀
  batch-rename sequence  <dir> <pattern> [-y]            序号编号
  batch-rename undo                                       撤销上次重命名

选项:
  -y, --yes                              真正执行 (默认仅预览)
  --dry                                  dry-run 模式
  --conflict <skip|overwrite|autoRename> 冲突解决策略
  --sort <name|date|size>                排序字段
  --desc                                 降序排序
  --ext <.txt,.md>                       按扩展名过滤
  --min <bytes>                          最小文件大小
  --max <bytes>                          最大文件大小

模板变量:
  {name} {base}  原文件名 (不含扩展名)
  {ext}          扩展名 (含点)
  {index}        序号 (从 1 开始)
  {index:N}      零填充序号到 N 位
  {n}            序号 (使用默认填充)
  {n:N}          零填充序号
  {date}         当前日期 YYYYMMDD
  {date:fmt}     指定日期格式
  {time}         当前时间 HHmmss

示例:
  batch-rename preview ./photos IMG_{index:3}{ext}
  batch-rename execute ./docs report_{date}_{name}{ext} -y
  batch-rename replace ./data old_ new_ -y
  batch-rename regex ./imgs ^(\\d+)-(.+)\\.jpg$ $2_$1.jpg -y
  batch-rename sequence ./photos IMG_{n}{ext} -y --sort date
  batch-rename addsuffix ./images _thumb -y
  batch-rename diff ./logs log_{date}_{name}{ext}
  batch-rename undo
`);
}
// === 26. Main entry point ===
function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const rest = args.slice(1);
    try {
        switch (command) {
            case "preview":
                cmdTemplate(rest, PreviewAction.Preview);
                break;
            case "execute":
                cmdTemplate(rest, PreviewAction.Execute);
                break;
            case "diff":
                cmdTemplate(rest, PreviewAction.Diff);
                break;
            case "replace":
                cmdReplace(rest);
                break;
            case "regex":
                cmdRegex(rest);
                break;
            case "lowercase":
                cmdCase(rest, CaseConversion.Lower);
                break;
            case "uppercase":
                cmdCase(rest, CaseConversion.Upper);
                break;
            case "titlecase":
                cmdCase(rest, CaseConversion.Title);
                break;
            case "snake":
                cmdCase(rest, CaseConversion.Snake);
                break;
            case "kebab":
                cmdCase(rest, CaseConversion.Kebab);
                break;
            case "addprefix":
                cmdPrefixSuffix(rest, false);
                break;
            case "addsuffix":
                cmdPrefixSuffix(rest, true);
                break;
            case "sequence":
                cmdSequence(rest);
                break;
            case "undo":
                cmdUndo();
                break;
            case "help":
            case "--help":
            case "-h":
            case undefined:
                printHelp();
                break;
            default:
                console.error(colorize(`未知命令: ${command}`, "red"));
                console.error("运行 'batch-rename help' 查看帮助。");
                process.exit(1);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(colorize(`错误: ${msg}`, "red"));
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map