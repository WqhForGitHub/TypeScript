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
exports.CsvParser = exports.RowStore = exports.CsvFieldParser = exports.AbstractFieldParser = exports.CoerceError = exports.ParseError = exports.CsvError = exports.CellKind = exports.ConvertResult = exports.ErrorCode = exports.DataType = exports.State = void 0;
exports.isParseSuccess = isParseSuccess;
exports.isParseFailure = isParseFailure;
exports.isNumberCell = isNumberCell;
exports.isTextCell = isTextCell;
exports.isTaggedRow = isTaggedRow;
exports.coerce = coerce;
exports.getCell = getCell;
exports.inferColumnType = inferColumnType;
exports.inferSchema = inferSchema;
exports.jsonToCsv = jsonToCsv;
exports.parseStream = parseStream;
/**
 * CSV 转 JSON 工具 (enhanced edition)
 * 功能不变：完整 CSV 解析（引号/转义/嵌入换行/自定义分隔符/注释）、
 * 类型推断、JSON↔CSV、流式处理。仅用 Node 内置模块（fs/path/readline）。
 *
 * 刻意展示高级 TS 特性：字符串枚举、判别联合、泛型类与约束、抽象类、
 * 映射类型、自定义错误层级、接口（可选/只读/索引签名）、satisfies、
 * getter/setter、生成器与迭代器、Symbol 唯一键、as const、类型守卫、函数重载。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
/* ---- 1. 字符串枚举（非 const enum）---- */
/** 解析器状态机状态 */
var State;
(function (State) {
    State["Start"] = "Start";
    State["InField"] = "InField";
    State["InQuotes"] = "InQuotes";
    State["AfterQuote"] = "AfterQuote";
    State["Delimiter"] = "Delimiter";
    State["EndOfLine"] = "EndOfLine";
    State["Comment"] = "Comment";
})(State || (exports.State = State = {}));
/** 推断得到的列数据类型 */
var DataType;
(function (DataType) {
    DataType["Integer"] = "integer";
    DataType["Real"] = "real";
    DataType["Number"] = "number";
    DataType["Boolean"] = "boolean";
    DataType["Date"] = "date";
    DataType["String"] = "string";
    DataType["Null"] = "null";
})(DataType || (exports.DataType = DataType = {}));
/** 错误码 */
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["InvalidDelimiter"] = "INVALID_DELIMITER";
    ErrorCode["UnbalancedQuotes"] = "UNBALANCED_QUOTES";
    ErrorCode["EmptyInput"] = "EMPTY_INPUT";
    ErrorCode["UnknownCommand"] = "UNKNOWN_COMMAND";
    ErrorCode["CoerceFailed"] = "COERCE_FAILED";
    ErrorCode["HeaderMissing"] = "HEADER_MISSING";
    ErrorCode["NotAnArray"] = "NOT_AN_ARRAY";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
/** 转换结果状态 */
var ConvertResult;
(function (ConvertResult) {
    ConvertResult["Success"] = "SUCCESS";
    ConvertResult["Failure"] = "FAILURE";
    ConvertResult["Partial"] = "PARTIAL";
})(ConvertResult || (exports.ConvertResult = ConvertResult = {}));
/* ---- 2. Symbol 唯一属性键 ---- */
const RAW_KEY = Symbol("rawRow");
const META_KEY = Symbol("storeMeta");
/** 单元格类型判别联合 */
var CellKind;
(function (CellKind) {
    CellKind["Text"] = "Text";
    CellKind["Number"] = "Number";
    CellKind["Boolean"] = "Boolean";
    CellKind["Date"] = "Date";
    CellKind["Null"] = "Null";
})(CellKind || (exports.CellKind = CellKind = {}));
/* ---- 5. 自定义错误层级 ---- */
class CsvError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "CsvError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.CsvError = CsvError;
class ParseError extends CsvError {
    constructor(code, message) {
        super(code, message);
        this.name = "ParseError";
    }
}
exports.ParseError = ParseError;
class CoerceError extends CsvError {
    constructor(message) {
        super(ErrorCode.CoerceFailed, message);
        this.name = "CoerceError";
    }
}
exports.CoerceError = CoerceError;
/* ---- 6. 类型守卫 ---- */
function isParseSuccess(r) {
    return r.ok === true;
}
function isParseFailure(r) {
    return r.ok === false;
}
function isNumberCell(c) {
    return c.kind === CellKind.Number;
}
function isTextCell(c) {
    return c.kind === CellKind.Text;
}
function isTaggedRow(v) {
    return typeof v === "object" && v !== null && RAW_KEY in v;
}
/* ---- 7. 抽象类 + 具体子类 ---- */
class AbstractFieldParser {
    normalize(s) {
        return s.trim();
    }
}
exports.AbstractFieldParser = AbstractFieldParser;
class CsvFieldParser extends AbstractFieldParser {
    parse(raw) {
        const s = this.normalize(raw);
        if (s === "" || s === "null" || s === "NULL")
            return { kind: CellKind.Null };
        if (s === "true")
            return { kind: CellKind.Boolean, value: true };
        if (s === "false")
            return { kind: CellKind.Boolean, value: false };
        if (/^-?\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (Number.isSafeInteger(n))
                return { kind: CellKind.Number, value: n };
        }
        if (/^-?\d+\.\d+$/.test(s))
            return { kind: CellKind.Number, value: parseFloat(s) };
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/.test(s)) {
            const d = new Date(s);
            if (!Number.isNaN(d.getTime()))
                return { kind: CellKind.Date, value: d.toISOString() };
        }
        return { kind: CellKind.Text, value: s };
    }
    format(cell) {
        switch (cell.kind) {
            case CellKind.Null: return "";
            case CellKind.Boolean: return cell.value ? "true" : "false";
            case CellKind.Number: return String(cell.value);
            case CellKind.Date: return cell.value;
            case CellKind.Text: return cell.value;
        }
    }
}
exports.CsvFieldParser = CsvFieldParser;
function cellToValue(c) {
    switch (c.kind) {
        case CellKind.Null: return null;
        case CellKind.Boolean: return c.value;
        case CellKind.Number: return c.value;
        case CellKind.Date: return c.value;
        case CellKind.Text: return c.value;
    }
}
/* ---- 8. 泛型类（带约束）+ getter/setter + 生成器/迭代器 ---- */
class RowStore {
    constructor(tag = "csv-store") {
        this._rows = [];
        this._cursor = 0;
        this[META_KEY] = { created: Date.now(), tag };
    }
    add(row) { this._rows.push(row); }
    get length() { return this._rows.length; }
    get current() { return this._rows[this._cursor]; }
    set current(row) {
        if (row === undefined) {
            if (this._rows.length > 0)
                this._rows.pop();
        }
        else if (this._cursor < this._rows.length) {
            this._rows[this._cursor] = row;
        }
        else {
            this._rows.push(row);
        }
    }
    get meta() { return this[META_KEY]; }
    set metaTag(tag) { this[META_KEY].tag = tag; }
    /** 自定义迭代器协议实现 */
    [Symbol.iterator]() {
        let i = 0;
        const rows = this._rows;
        return {
            next() {
                if (i < rows.length)
                    return { value: rows[i++], done: false };
                return { value: undefined, done: true };
            },
            [Symbol.iterator]() { return this; },
        };
    }
    /** 生成器方式逐行产出 */
    *rows() {
        for (const r of this._rows)
            yield r;
    }
    toArray() { return this._rows; }
}
exports.RowStore = RowStore;
/* ---- 9. CSV 解析器（状态机）---- */
class CsvParser {
    constructor(opts = {}) {
        this._lastState = State.Start;
        // Mutable 映射类型允许在拷贝上赋值
        const o = { ...opts };
        const d = o.delimiter ?? ",";
        if (d.length !== 1) {
            throw new ParseError(ErrorCode.InvalidDelimiter, `delimiter must be exactly 1 char, got: ${JSON.stringify(d)}`);
        }
        this.delim = d;
        this.header = o.header ?? true;
        this.comment = o.comment ?? null;
        this.skipEmpty = o.skipEmptyLines ?? true;
    }
    get lastState() { return this._lastState; }
    parse(text) {
        const records = this.parseRecords(text);
        if (records.length === 0)
            return { header: [], rows: [] };
        if (this.header)
            return { header: records[0], rows: records.slice(1) };
        const n = records[0].length;
        return {
            header: Array.from({ length: n }, (_, i) => `col${i + 1}`),
            rows: records,
        };
    }
    /** 安全解析：返回判别联合 ParseResult */
    tryParse(text) {
        try {
            const { header, rows } = this.parse(text);
            if (header.length === 0) {
                return { ok: false, error: new ParseError(ErrorCode.EmptyInput, "empty input or header missing") };
            }
            return { ok: true, header, rows, count: rows.length };
        }
        catch (e) {
            const err = e instanceof CsvError
                ? e
                : new ParseError(ErrorCode.UnknownCommand, e instanceof Error ? e.message : String(e));
            return { ok: false, error: err };
        }
    }
    parseObjects(text, opts = {}) {
        const { header, rows } = this.parse(text);
        if (header.length === 0)
            return [];
        const fieldParser = opts.coerce ? new CsvFieldParser() : null;
        return rows.map((r) => {
            const o = { [RAW_KEY]: r };
            for (let i = 0; i < header.length; i++) {
                const raw = r[i] ?? "";
                o[header[i]] = fieldParser ? cellToValue(fieldParser.parse(raw)) : raw;
            }
            return o;
        });
    }
    /** 生成器：逐行产出（行迭代） */
    *iterRows(text) {
        const { rows } = this.parse(text);
        for (const r of rows)
            yield r;
    }
    parseRecords(text) {
        const records = [];
        let field = "";
        let row = [];
        let i = 0;
        let inQuotes = false;
        let lineStart = true;
        let state = State.Start;
        const n = text.length;
        while (i < n) {
            if (lineStart && this.comment && text[i] === this.comment) {
                state = State.Comment;
                while (i < n && text[i] !== "\n")
                    i++;
                if (i < n)
                    i++;
                continue;
            }
            lineStart = false;
            const c = text[i];
            if (inQuotes) {
                state = State.InQuotes;
                if (c === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i += 2;
                        continue;
                    }
                    inQuotes = false;
                    state = State.AfterQuote;
                    i++;
                    continue;
                }
                field += c;
                i++;
                continue;
            }
            if (c === '"') {
                inQuotes = true;
                state = State.InQuotes;
                i++;
                continue;
            }
            if (c === this.delim) {
                row.push(field);
                field = "";
                state = State.Delimiter;
                i++;
                continue;
            }
            if (c === "\r" || c === "\n") {
                row.push(field);
                field = "";
                if (this.skipEmpty && row.length === 1 && row[0] === "") {
                    row = [];
                    if (c === "\r" && text[i + 1] === "\n")
                        i++;
                    i++;
                    lineStart = true;
                    state = State.EndOfLine;
                    continue;
                }
                records.push(row);
                row = [];
                if (c === "\r" && text[i + 1] === "\n")
                    i++;
                i++;
                lineStart = true;
                state = State.EndOfLine;
                continue;
            }
            field += c;
            state = State.InField;
            i++;
        }
        if (field.length > 0 || row.length > 0) {
            row.push(field);
            if (!(this.skipEmpty && row.length === 1 && row[0] === ""))
                records.push(row);
        }
        this._lastState = state;
        return records;
    }
}
exports.CsvParser = CsvParser;
function coerce(s, mode) {
    const cell = new CsvFieldParser().parse(s);
    return mode === "cell" ? cell : cellToValue(cell);
}
function getCell(parser, raw, asValue) {
    const cell = parser.parse(raw);
    return asValue ? cellToValue(cell) : cell;
}
function inferColumnType(values) {
    let hasInt = false, hasReal = false, hasBool = false, hasDate = false, hasText = false;
    for (const v of values) {
        if (v === "")
            continue;
        if (/^-?\d+$/.test(v))
            hasInt = true;
        else if (/^-?\d+\.\d+$/.test(v))
            hasReal = true;
        else if (v === "true" || v === "false")
            hasBool = true;
        else if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime()))
            hasDate = true;
        else
            hasText = true;
    }
    if (hasText)
        return DataType.String;
    if (hasReal || hasInt)
        return DataType.Number;
    if (hasBool)
        return DataType.Boolean;
    if (hasDate)
        return DataType.Date;
    return DataType.String;
}
function inferSchema(text, opts = {}) {
    const parser = new CsvParser(opts);
    const { header, rows } = parser.parse(text);
    const out = {};
    for (let i = 0; i < header.length; i++) {
        const col = rows.map((r) => r[i] ?? "");
        out[header[i]] = inferColumnType(col);
    }
    return out;
}
/* ---- 11. JSON -> CSV ---- */
function jsonToCsv(json, opts = {}) {
    if (json.length === 0)
        return "";
    const delim = opts.delimiter ?? ",";
    const colSet = [];
    for (const r of json) {
        for (const k of Object.keys(r)) {
            if (!colSet.includes(k))
                colSet.push(k);
        }
    }
    const lines = [colSet.map((c) => escapeField(c, delim)).join(delim)];
    for (const r of json) {
        lines.push(colSet.map((c) => escapeField(fmtValue(r[c]), delim)).join(delim));
    }
    return lines.join("\n");
}
function fmtValue(v) {
    if (v === null || v === undefined)
        return "";
    if (typeof v === "object")
        return JSON.stringify(v);
    return String(v);
}
function escapeField(s, delim = ",") {
    if (s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
/* ---- 12. 流式解析大文件 ---- */
async function parseStream(filePath, onRow, opts = {}) {
    const parser = new CsvParser(opts);
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, "utf8"),
        crlfDelay: Infinity,
    });
    // readline 按行分割会破坏嵌入换行的引号字段，这里累积缓冲直到引号平衡。
    let buffer = "";
    let header = null;
    let count = 0;
    const flushBuffer = () => {
        if (buffer.trim() === "")
            return;
        const records = parser.parse(buffer);
        if (records.rows.length === 0)
            return;
        if (header === null) {
            if (opts.header !== false) {
                header = records.rows[0];
                records.rows.slice(1).forEach(processRow);
            }
            else {
                header = Array.from({ length: records.rows[0].length }, (_, i) => `col${i + 1}`);
                records.rows.forEach(processRow);
            }
        }
        else {
            records.rows.forEach(processRow);
        }
        buffer = "";
    };
    const processRow = (r) => {
        const o = {};
        const h = header;
        for (let i = 0; i < h.length; i++) {
            const raw = r[i] ?? "";
            o[h[i]] = opts.coerce ? coerce(raw) : raw;
        }
        onRow(o);
        count++;
    };
    for await (const line of rl) {
        buffer += (buffer ? "\n" : "") + line;
        const qcount = (buffer.match(/"/g) || []).length;
        if (qcount % 2 === 0)
            flushBuffer();
    }
    if (buffer.trim() !== "")
        flushBuffer();
    return count;
}
/* ---- 13. as const / satisfies 配置 ---- */
const TYPE_PRIORITY = [
    DataType.String,
    DataType.Number,
    DataType.Boolean,
    DataType.Date,
];
const DEFAULT_CSV_OPTS = {
    delimiter: ",",
    header: true,
    skipEmptyLines: true,
};
const CLI_HELP = `CSV 转 JSON 工具 CLI
用法:
  convert <csv> [-o json] [-d delim] [--no-header]   转换 CSV 为 JSON
  preview <csv> [-n rows]                            预览前 N 行
  schema  <csv>                                      推断列类型
  json2csv <json> [-o csv]                           JSON 转 CSV
  stream  <csv>                                      流式处理大文件
  demo                                               运行内置示例`;
function runConvert(file, opts) {
    try {
        const text = fs.readFileSync(path.resolve(file), "utf8");
        const parser = new CsvParser({ delimiter: opts.delim, header: !opts.noHeader });
        const rows = parser.parseObjects(text, { coerce: opts.coerce });
        const json = JSON.stringify(rows, null, 2);
        return {
            result: rows.length === 0 ? ConvertResult.Partial : ConvertResult.Success,
            count: rows.length,
            json,
        };
    }
    catch (e) {
        const err = e instanceof CsvError
            ? e
            : new CsvError(ErrorCode.UnknownCommand, e instanceof Error ? e.message : String(e));
        return { result: ConvertResult.Failure, count: 0, json: "", error: err };
    }
}
/* ---- 15. CLI ---- */
function getOpt(args, name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}
function getOptNum(args, name, def) {
    const v = getOpt(args, name);
    return v ? parseInt(v, 10) : def;
}
async function main() {
    const [, , cmd, ...rest] = process.argv;
    if (!cmd) {
        console.log(CLI_HELP);
        return;
    }
    switch (cmd) {
        case "convert": {
            const [file] = rest;
            if (!file)
                throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
            const delim = getOpt(rest, "-d") ?? DEFAULT_CSV_OPTS.delimiter;
            const noHeader = rest.includes("--no-header");
            const out = getOpt(rest, "-o");
            const res = runConvert(file, { delim, noHeader, coerce: true });
            if (res.result === ConvertResult.Failure) {
                throw res.error ?? new CsvError(ErrorCode.UnknownCommand, "未知错误");
            }
            if (out)
                fs.writeFileSync(path.resolve(out), res.json, "utf8");
            else
                console.log(res.json);
            console.error(`已转换 ${res.count} 行 (结果: ${res.result})`);
            break;
        }
        case "preview": {
            const [file] = rest;
            if (!file)
                throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
            const n = getOptNum(rest, "-n", 5);
            const text = fs.readFileSync(path.resolve(file), "utf8");
            const parser = new CsvParser({ header: true });
            const { header, rows } = parser.parse(text);
            console.log(header.join(" | "));
            console.log(header.map((h) => "-".repeat(Math.max(5, h.length))).join("-+-"));
            for (let i = 0; i < Math.min(n, rows.length); i++) {
                console.log(rows[i].map((c) => c ?? "").join(" | "));
            }
            console.log(`(共 ${rows.length} 行，预览 ${Math.min(n, rows.length)} 行)`);
            console.log(`解析结束状态: ${parser.lastState}`);
            break;
        }
        case "schema": {
            const [file] = rest;
            if (!file)
                throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
            const text = fs.readFileSync(path.resolve(file), "utf8");
            const schema = inferSchema(text);
            console.log(JSON.stringify(schema, null, 2));
            console.log(`类型优先级: ${TYPE_PRIORITY.join(" > ")}`);
            break;
        }
        case "json2csv": {
            const [file] = rest;
            if (!file)
                throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
            const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
            if (!Array.isArray(data))
                throw new CsvError(ErrorCode.NotAnArray, "JSON 顶层必须是数组");
            const csv = jsonToCsv(data);
            const out = getOpt(rest, "-o");
            if (out)
                fs.writeFileSync(path.resolve(out), csv, "utf8");
            else
                console.log(csv);
            break;
        }
        case "stream": {
            const [file] = rest;
            if (!file)
                throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
            let count = 0;
            const n = await parseStream(path.resolve(file), (row) => { if (count < 3)
                console.log(JSON.stringify(row)); count++; }, { coerce: true });
            console.log(`流式处理完成，共 ${n} 行（仅显示前 3 行）`);
            break;
        }
        case "demo": {
            const csv = `id,name,note,active
1,Alice,"Hello, world",true
2,Bob,"Line1
Line2",false
3,"Carol ""C""","quoted ""text""",true
4,Dave,,false`;
            console.log("=== 原始 CSV ===");
            console.log(csv);
            const parser = new CsvParser({ delimiter: ",", header: true });
            const rows = parser.parseObjects(csv, { coerce: true });
            // 展示 RowStore + 生成器 + Symbol 标记
            const store = new RowStore("demo");
            for (const r of rows)
                store.add(r);
            console.log(`\n=== RowStore (length=${store.length}, tag=${store.meta.tag}) ===`);
            console.log("\n=== 转换为 JSON ===");
            console.log(JSON.stringify(rows, null, 2));
            console.log("\n=== Schema ===");
            console.log(JSON.stringify(inferSchema(csv), null, 2));
            console.log("\n=== 回写 CSV ===");
            console.log(jsonToCsv(rows));
            // 类型守卫 + 判别联合演示
            const cell = coerce("42", "cell");
            if (isNumberCell(cell))
                console.log(`\n[类型守卫] 识别为数字: ${cell.value + 1}`);
            const first = rows[0];
            console.log(`[Symbol] 行已标记原始数据: ${isTaggedRow(first)}`);
            break;
        }
        default:
            throw new CsvError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
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