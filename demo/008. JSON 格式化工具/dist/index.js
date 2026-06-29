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
 * JSON 格式化工具 (Enhanced TypeScript Edition)
 * 演示枚举/泛型/可辨识联合/映射类型/条件类型/模板字面量类型/类型守卫/
 * 工具类型/元组/抽象类/函数重载/as const/自定义错误层级/satisfies/getter&setter/生成器。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ===================== Enums =====================
var JsonType;
(function (JsonType) {
    JsonType["Object"] = "object";
    JsonType["Array"] = "array";
    JsonType["String"] = "string";
    JsonType["Number"] = "number";
    JsonType["Boolean"] = "boolean";
    JsonType["Null"] = "null";
})(JsonType || (JsonType = {}));
var FormatIndent;
(function (FormatIndent) {
    FormatIndent[FormatIndent["TwoSpaces"] = 2] = "TwoSpaces";
    FormatIndent[FormatIndent["FourSpaces"] = 4] = "FourSpaces";
    FormatIndent[FormatIndent["Tab"] = 0] = "Tab";
})(FormatIndent || (FormatIndent = {}));
var QueryOperator;
(function (QueryOperator) {
    QueryOperator["Equals"] = "==";
    QueryOperator["NotEquals"] = "!=";
    QueryOperator["Greater"] = ">";
    QueryOperator["GreaterEq"] = ">=";
    QueryOperator["Less"] = "<";
    QueryOperator["LessEq"] = "<=";
    QueryOperator["Exists"] = "?";
    QueryOperator["Wildcard"] = "*";
})(QueryOperator || (QueryOperator = {}));
var ValidateSeverity;
(function (ValidateSeverity) {
    ValidateSeverity["Error"] = "error";
    ValidateSeverity["Warning"] = "warning";
    ValidateSeverity["Info"] = "info";
})(ValidateSeverity || (ValidateSeverity = {}));
var OutputFormat;
(function (OutputFormat) {
    OutputFormat["Pretty"] = "pretty";
    OutputFormat["Minify"] = "minify";
    OutputFormat["Colored"] = "colored";
    OutputFormat["Tree"] = "tree";
})(OutputFormat || (OutputFormat = {}));
// ===================== Type Guards =====================
function isJsonNull(v) { return v === null; }
function isJsonObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function isJsonArray(v) { return Array.isArray(v); }
function isJsonPrimitive(v) {
    return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}
function getJsonType(v) {
    if (v === null)
        return JsonType.Null;
    if (Array.isArray(v))
        return JsonType.Array;
    if (typeof v === "string")
        return JsonType.String;
    if (typeof v === "number")
        return JsonType.Number;
    if (typeof v === "boolean")
        return JsonType.Boolean;
    return JsonType.Object;
}
function typeName(v) { return getJsonType(v); }
// ===================== Custom Error Hierarchy =====================
class JsonError extends Error {
    constructor(message) {
        super(message);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
class ParseError extends JsonError {
    constructor(message, position) {
        super(message);
        this.position = position;
        this.code = "PARSE_ERROR";
    }
}
class PathError extends JsonError {
    constructor(message, segment) {
        super(message);
        this.segment = segment;
        this.code = "PATH_ERROR";
    }
}
class ValidationError extends JsonError {
    constructor(message, issues = []) {
        super(message);
        this.issues = issues;
        this.code = "VALIDATION_ERROR";
    }
}
class RuntimeError extends JsonError {
    constructor(message) {
        super(message);
        this.code = "RUNTIME_ERROR";
    }
}
// ===================== as const 常量 =====================
const COLOR = { RESET: "\x1b[0m", RED: "\x1b[31m", GREEN: "\x1b[32m", YELLOW: "\x1b[33m", BLUE: "\x1b[34m", CYAN: "\x1b[36m", MAGENTA: "\x1b[35m", GRAY: "\x1b[90m", BOLD: "\x1b[1m" };
const INDENT_CHARS = { [FormatIndent.TwoSpaces]: "  ", [FormatIndent.FourSpaces]: "    ", [FormatIndent.Tab]: "\t" };
const VALID_COMMANDS = ["format", "minify", "validate", "query", "stats", "diff", "merge", "csv", "sort", "escape", "unescape"];
// ===================== Abstract Visitor & Formatter =====================
class AbstractJsonVisitor {
    visit(node, ctx) {
        switch (node.type) {
            case JsonType.Object: return this.visitObject(node, ctx);
            case JsonType.Array: return this.visitArray(node, ctx);
            case JsonType.String: return this.visitString(node, ctx);
            case JsonType.Number: return this.visitNumber(node, ctx);
            case JsonType.Boolean: return this.visitBoolean(node, ctx);
            case JsonType.Null: return this.visitNull(node, ctx);
            default: {
                const _x = node;
                throw new RuntimeError(`不可达: ${JSON.stringify(_x)}`);
            }
        }
    }
}
class AbstractFormatter {
    constructor(indent = 2) { this._indentSize = indent; }
    get indent() { return this._indentSize; }
    set indent(value) { this._indentSize = value >= 0 ? value : 0; }
    pad(depth) {
        const unit = this._indentSize > 0 ? " ".repeat(this._indentSize) : "\t";
        return unit.repeat(depth);
    }
}
// ===================== AST Builder & Converters =====================
function buildAst(value, prefix = "$") {
    if (value === null)
        return { type: JsonType.Null, path: prefix };
    if (typeof value === "string")
        return { type: JsonType.String, value, path: prefix };
    if (typeof value === "number")
        return { type: JsonType.Number, value, path: prefix };
    if (typeof value === "boolean")
        return { type: JsonType.Boolean, value, path: prefix };
    if (Array.isArray(value)) {
        return { type: JsonType.Array, path: prefix, items: value.map((v, i) => buildAst(v, `${prefix}[${i}]`)) };
    }
    if (typeof value === "object") {
        const obj = value;
        return {
            type: JsonType.Object, path: prefix,
            properties: Object.entries(obj).map(([k, v]) => [k, buildAst(v, `${prefix}.${k}`)]),
        };
    }
    throw new ParseError(`无法识别的值类型: ${typeof value}`);
}
function nodeToValue(node) {
    switch (node.type) {
        case JsonType.Null: return null;
        case JsonType.String: return node.value;
        case JsonType.Number: return node.value;
        case JsonType.Boolean: return node.value;
        case JsonType.Array: return node.items.map(nodeToValue);
        case JsonType.Object: {
            const obj = {};
            for (const [k, v] of node.properties)
                obj[k] = nodeToValue(v);
            return obj;
        }
        default: {
            const _x = node;
            throw new RuntimeError(`不可达: ${JSON.stringify(_x)}`);
        }
    }
}
// ===================== Generators (Iterators) =====================
function* walkLeaves(node) {
    if (node.type === JsonType.Object) {
        for (const [, c] of node.properties)
            yield* walkLeaves(c);
    }
    else if (node.type === JsonType.Array) {
        for (const c of node.items)
            yield* walkLeaves(c);
    }
    else {
        yield [node.path, node];
    }
}
function* walkAll(node) {
    yield node;
    if (node.type === JsonType.Object) {
        for (const [, c] of node.properties)
            yield* walkAll(c);
    }
    else if (node.type === JsonType.Array) {
        for (const c of node.items)
            yield* walkAll(c);
    }
}
// ===================== Concrete Visitors =====================
class TypeDistributionVisitor extends AbstractJsonVisitor {
    visitObject(n, ctx) { ctx[JsonType.Object]++; for (const [, c] of n.properties)
        this.visit(c, ctx); return ctx; }
    visitArray(n, ctx) { ctx[JsonType.Array]++; for (const c of n.items)
        this.visit(c, ctx); return ctx; }
    visitString(_n, ctx) { ctx[JsonType.String]++; return ctx; }
    visitNumber(_n, ctx) { ctx[JsonType.Number]++; return ctx; }
    visitBoolean(_n, ctx) { ctx[JsonType.Boolean]++; return ctx; }
    visitNull(_n, ctx) { ctx[JsonType.Null]++; return ctx; }
}
class DepthAnalyzer {
    get maxDepth() { return this._maxDepth; }
    set maxDepth(value) { this._maxDepth = value >= 0 ? value : 0; }
    constructor(root) {
        this.root = root;
        this._maxDepth = 0;
    }
    analyze() { this._maxDepth = 0; this._walk(this.root, 0); return this._maxDepth; }
    _walk(node, depth) {
        if (depth > this._maxDepth)
            this._maxDepth = depth;
        if (node.type === JsonType.Object) {
            for (const [, c] of node.properties)
                this._walk(c, depth + 1);
        }
        else if (node.type === JsonType.Array) {
            for (const c of node.items)
                this._walk(c, depth + 1);
        }
    }
}
// ===================== Pretty & Tree Formatters =====================
class PrettyFormatter extends AbstractFormatter {
    format(node, depth = 0) {
        const pad = this.pad(depth), padChild = this.pad(depth + 1);
        switch (node.type) {
            case JsonType.Null: return "null";
            case JsonType.String: return JSON.stringify(node.value);
            case JsonType.Number: return String(node.value);
            case JsonType.Boolean: return String(node.value);
            case JsonType.Array:
                if (node.items.length === 0)
                    return "[]";
                return `[\n${node.items.map((c) => padChild + this.format(c, depth + 1)).join(",\n")}\n${pad}]`;
            case JsonType.Object:
                if (node.properties.length === 0)
                    return "{}";
                return `{\n${node.properties.map(([k, v]) => `${padChild}${JSON.stringify(k)}: ${this.format(v, depth + 1)}`).join(",\n")}\n${pad}}`;
            default: {
                const _x = node;
                throw new RuntimeError(`不可达: ${JSON.stringify(_x)}`);
            }
        }
    }
}
class TreeFormatter extends AbstractFormatter {
    format(node, depth = 0) {
        const pad = this.pad(depth);
        switch (node.type) {
            case JsonType.Null: return `${pad}null`;
            case JsonType.String: return `${pad}"${node.value}"`;
            case JsonType.Number: return `${pad}${node.value}`;
            case JsonType.Boolean: return `${pad}${node.value}`;
            case JsonType.Array: {
                const lines = [`${pad}Array(${node.items.length})`];
                node.items.forEach((c, i) => lines.push(`${this.pad(depth + 1)}[${i}] ${this.format(c, depth + 1).trimStart()}`));
                return lines.join("\n");
            }
            case JsonType.Object: {
                const lines = [`${pad}Object(${node.properties.length})`];
                for (const [k, v] of node.properties)
                    lines.push(`${this.pad(depth + 1)}${k}: ${this.format(v, depth + 1).trimStart()}`);
                return lines.join("\n");
            }
            default: {
                const _x = node;
                throw new RuntimeError(`不可达: ${JSON.stringify(_x)}`);
            }
        }
    }
}
function tokenizeQuery(q) {
    const tokens = [{ kind: "root" }];
    const src = q.trim();
    let i = src.startsWith("$") ? 1 : 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === ".") {
            i++;
            if (src[i] === "*") {
                tokens.push({ kind: "wildcard" });
                i++;
                continue;
            }
            let name = "";
            while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]))
                name += src[i++];
            if (name)
                tokens.push({ kind: "key", name });
        }
        else if (ch === "[") {
            i++;
            if (src[i] === "*") {
                tokens.push({ kind: "wildcard" });
                i += 2;
                continue;
            }
            if (src[i] === "?") {
                const end = src.indexOf("]", i);
                if (end === -1)
                    throw new PathError("过滤器未闭合", ch);
                const expr = src.slice(i + 1, end).replace(/^\(/, "").replace(/\)$/, "").trim();
                const m = expr.match(/@\.(\w+)\s*(==|!=|>=|<=|>|<|\?)\s*(.*)/);
                if (m)
                    tokens.push({ kind: "filter", left: m[1], op: m[2], right: m[3].replace(/['")]/g, "").trim() });
                i = end + 1;
                continue;
            }
            let num = "";
            while (i < src.length && src[i] !== "]")
                num += src[i++];
            i++;
            const idx = Number(num);
            if (Number.isNaN(idx))
                throw new PathError("无效的数组索引", num);
            tokens.push({ kind: "index", idx });
        }
        else {
            i++;
        }
    }
    return tokens;
}
function applyFilter(left, op, right) {
    switch (op) {
        case QueryOperator.Exists: return left !== undefined && left !== null;
        case QueryOperator.Equals: return String(left) === right;
        case QueryOperator.NotEquals: return String(left) !== right;
        case QueryOperator.Greater: return Number(left) > Number(right);
        case QueryOperator.GreaterEq: return Number(left) >= Number(right);
        case QueryOperator.Less: return Number(left) < Number(right);
        case QueryOperator.LessEq: return Number(left) <= Number(right);
        default: return false;
    }
}
function queryAst(root, q) {
    const tokens = tokenizeQuery(q);
    let current = [root];
    for (let t = 1; t < tokens.length; t++) {
        const tok = tokens[t];
        const next = [];
        for (const node of current) {
            if (tok.kind === "key") {
                if (node.type === JsonType.Object) {
                    const found = node.properties.find(([k]) => k === tok.name);
                    if (found)
                        next.push(found[1]);
                }
            }
            else if (tok.kind === "index") {
                if (node.type === JsonType.Array && tok.idx >= 0 && tok.idx < node.items.length)
                    next.push(node.items[tok.idx]);
            }
            else if (tok.kind === "wildcard") {
                if (node.type === JsonType.Array)
                    next.push(...node.items);
                else if (node.type === JsonType.Object)
                    next.push(...node.properties.map(([, v]) => v));
            }
            else if (tok.kind === "filter") {
                if (node.type === JsonType.Array) {
                    for (const item of node.items) {
                        if (item.type === JsonType.Object) {
                            const f = item.properties.find(([k]) => k === tok.left);
                            if (f && applyFilter(nodeToValue(f[1]), tok.op, tok.right))
                                next.push(item);
                        }
                    }
                }
            }
        }
        current = next;
        if (current.length === 0)
            break;
    }
    return current;
}
// ===================== Schema Validation =====================
function validateSchema(value, schema, p = "$") {
    const issues = [];
    const actual = getJsonType(value);
    if (actual !== schema.type) {
        issues.push([p, ValidateSeverity.Error, `类型不匹配: 期望 ${schema.type}, 实际 ${actual}`]);
        return issues;
    }
    if (schema.enum && !schema.enum.some((e) => e === value))
        issues.push([p, ValidateSeverity.Error, "值不在枚举范围内"]);
    if (schema.type === JsonType.Object) {
        const obj = value;
        for (const k of schema.required ?? [])
            if (!(k in obj))
                issues.push([`${p}.${k}`, ValidateSeverity.Error, `缺少必需字段: ${k}`]);
        if (schema.properties)
            for (const [k, sub] of Object.entries(schema.properties))
                if (k in obj)
                    issues.push(...validateSchema(obj[k], sub, `${p}.${k}`));
    }
    else if (schema.type === JsonType.Array) {
        const arr = value;
        if (schema.minItems !== undefined && arr.length < schema.minItems)
            issues.push([p, ValidateSeverity.Error, `数组长度 ${arr.length} < minItems ${schema.minItems}`]);
        if (schema.maxItems !== undefined && arr.length > schema.maxItems)
            issues.push([p, ValidateSeverity.Warning, `数组长度 ${arr.length} > maxItems ${schema.maxItems}`]);
        if (schema.items)
            arr.forEach((v, i) => issues.push(...validateSchema(v, schema.items, `${p}[${i}]`)));
    }
    else if (schema.type === JsonType.Number) {
        const n = value;
        if (schema.minimum !== undefined && n < schema.minimum)
            issues.push([p, ValidateSeverity.Error, `${n} < minimum ${schema.minimum}`]);
        if (schema.maximum !== undefined && n > schema.maximum)
            issues.push([p, ValidateSeverity.Error, `${n} > maximum ${schema.maximum}`]);
    }
    return issues;
}
// ===================== JSON Diff =====================
function jsonDiff(left, right, p = "$") {
    const diffs = [];
    if (isJsonPrimitive(left) || isJsonPrimitive(right)) {
        if (left !== right)
            diffs.push([p, "changed", left, right]);
        return diffs;
    }
    if (isJsonArray(left) && isJsonArray(right)) {
        const len = Math.max(left.length, right.length);
        for (let i = 0; i < len; i++) {
            if (i >= left.length)
                diffs.push([`${p}[${i}]`, "added", undefined, right[i]]);
            else if (i >= right.length)
                diffs.push([`${p}[${i}]`, "removed", left[i], undefined]);
            else
                diffs.push(...jsonDiff(left[i], right[i], `${p}[${i}]`));
        }
        return diffs;
    }
    if (isJsonObject(left) && isJsonObject(right)) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const k of keys) {
            const inL = k in left, inR = k in right;
            if (inL && !inR)
                diffs.push([`${p}.${k}`, "removed", left[k], undefined]);
            else if (!inL && inR)
                diffs.push([`${p}.${k}`, "added", undefined, right[k]]);
            else
                diffs.push(...jsonDiff(left[k], right[k], `${p}.${k}`));
        }
        return diffs;
    }
    if (left !== right)
        diffs.push([p, "changed", left, right]);
    return diffs;
}
// ===================== Deep Merge / Sort Keys / CSV / Unicode =====================
function deepMerge(left, right) {
    if (isJsonObject(left) && isJsonObject(right)) {
        const out = { ...left };
        for (const [k, v] of Object.entries(right))
            out[k] = k in left ? deepMerge(left[k], v) : v;
        return out;
    }
    if (isJsonArray(left) && isJsonArray(right))
        return [...left, ...right];
    return right;
}
function sortKeys(value) {
    if (isJsonArray(value))
        return value.map(sortKeys);
    if (isJsonObject(value)) {
        const out = {};
        for (const k of Object.keys(value).sort())
            out[k] = sortKeys(value[k]);
        return out;
    }
    return value;
}
function jsonToCsv(arr) {
    if (arr.length === 0)
        return "";
    const cols = new Set();
    for (const row of arr)
        for (const k of Object.keys(row))
            cols.add(k);
    const headers = [...cols];
    const esc = (v) => {
        const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const row of arr)
        lines.push(headers.map((h) => esc(row[h])).join(","));
    return lines.join("\n");
}
function unicodeEscape(s) {
    return s.replace(/[^\x00-\x7F]/g, (c) => {
        const code = c.codePointAt(0);
        return code > 0xffff
            ? `\\u${(0xd800 + (code >> 10) - 0x40).toString(16).padStart(4, "0")}\\u${(0xdc00 + (code & 0x3ff)).toString(16).padStart(4, "0")}`
            : `\\u${code.toString(16).padStart(4, "0")}`;
    });
}
function unicodeUnescape(s) {
    return s.replace(/\\u([0-9a-fA-F]{4})\\u([0-9a-fA-F]{4})|\\u([0-9a-fA-F]{4})/g, (_m, hi, lo, single) => {
        if (single !== undefined)
            return String.fromCharCode(parseInt(single, 16));
        const hiCode = parseInt(hi, 16), loCode = parseInt(lo, 16);
        if (hiCode >= 0xd800 && hiCode <= 0xdbff)
            return String.fromCodePoint(0x10000 + ((hiCode - 0xd800) << 10) + (loCode - 0xdc00));
        return String.fromCharCode(hiCode) + String.fromCharCode(loCode);
    });
}
// ===================== Colorize / IO / Parse =====================
function colorize(jsonStr) {
    return jsonStr
        .replace(/("(?:\\.|[^"\\])*")\s*:/g, `${COLOR.CYAN}$1${COLOR.RESET}:`)
        .replace(/:\s*("(?:\\.|[^"\\])*")/g, `: ${COLOR.GREEN}$1${COLOR.RESET}`)
        .replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, `: ${COLOR.YELLOW}$1${COLOR.RESET}`)
        .replace(/:\s*(true|false)/g, `: ${COLOR.BLUE}$1${COLOR.RESET}`)
        .replace(/:\s*(null)/g, `: ${COLOR.GRAY}$1${COLOR.RESET}`);
}
function readInput(filePath) {
    if (filePath === "-")
        return fs.readFileSync(0, "utf-8");
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath))
        throw new RuntimeError(`文件不存在: ${absPath}`);
    return fs.readFileSync(absPath, "utf-8");
}
function safeParse(raw) {
    try {
        return [JSON.parse(raw), null];
    }
    catch (err) {
        const msg = err instanceof SyntaxError ? err.message : String(err);
        const m = msg.match(/position\s+(\d+)/i);
        return [null, new ParseError(msg, m ? Number(m[1]) : undefined)];
    }
}
function format(raw, opts = {}) {
    const [obj, err] = safeParse(raw);
    if (err)
        throw err;
    let value = obj;
    if (opts.sort)
        value = sortKeys(value);
    const indent = opts.indent ?? 2;
    const output = opts.output ?? OutputFormat.Pretty;
    if (output === OutputFormat.Minify)
        return JSON.stringify(value);
    const ast = buildAst(value);
    if (output === OutputFormat.Tree)
        return new TreeFormatter(indent).format(ast);
    const formatted = new PrettyFormatter(indent).format(ast);
    return output === OutputFormat.Colored ? colorize(formatted) : formatted;
}
function query(raw, q, asArray) {
    const [obj, err] = safeParse(raw);
    if (err)
        throw err;
    const results = queryAst(buildAst(obj), q).map(nodeToValue);
    if (asArray)
        return results;
    return results.length === 1 ? results[0] : results;
}
function getStats(value, rawSize) {
    const ast = buildAst(value);
    const distVisitor = new TypeDistributionVisitor();
    const empty = { [JsonType.Object]: 0, [JsonType.Array]: 0, [JsonType.String]: 0, [JsonType.Number]: 0, [JsonType.Boolean]: 0, [JsonType.Null]: 0 };
    distVisitor.visit(ast, empty);
    const depth = new DepthAnalyzer(ast).analyze();
    const nodeCount = Object.values(empty).reduce((a, b) => a + b, 0);
    const base = { type: ast.type, depth, sizeBytes: rawSize, nodeCount, distribution: empty };
    if (ast.type === JsonType.Object) {
        const keys = ast.properties.map(([k]) => k);
        return { ...base, keys: keys.length, keyList: keys };
    }
    if (ast.type === JsonType.Array)
        return { ...base, keys: 0, arrayLength: ast.items.length };
    return { ...base, keys: 0 };
}
// ===================== CLI Command Implementations =====================
function die(msg) { console.error(`${COLOR.RED}错误: ${msg}${COLOR.RESET}`); process.exit(1); }
function cmdFormat(raw, indent, output, sort) {
    const formatted = format(raw, { indent, output: OutputFormat.Colored, sort });
    console.log(formatted);
    const minified = JSON.stringify(JSON.parse(raw));
    const saved = raw.length - minified.length;
    const ratio = raw.length > 0 ? ((saved / raw.length) * 100).toFixed(1) : "0.0";
    console.log(`\n${COLOR.GRAY}原始: ${raw.length} 字节 | 格式化: ${formatted.length} 字节 | 压缩后: ${minified.length} 字节 | 可压缩: ${ratio}%${COLOR.RESET}`);
    if (output === OutputFormat.Tree)
        console.log("\n" + new TreeFormatter(indent).format(buildAst(JSON.parse(raw))));
}
function cmdMinify(raw) {
    const minified = format(raw, { output: OutputFormat.Minify });
    console.log(minified);
    console.log(`\n${COLOR.GRAY}原始: ${raw.length} 字节 → 压缩: ${minified.length} 字节 (节省 ${raw.length - minified.length} 字节, ${((1 - minified.length / raw.length) * 100).toFixed(1)}%)${COLOR.RESET}`);
}
function cmdValidate(raw, schemaPath) {
    const [, err] = safeParse(raw);
    if (err) {
        console.log(`${COLOR.RED}✗ JSON 不合法${COLOR.RESET}`);
        console.log(`${COLOR.RED}  ${err.message}${COLOR.RESET}`);
        if (err instanceof ParseError && err.position !== undefined) {
            const pos = err.position, start = Math.max(0, pos - 20), end = Math.min(raw.length, pos + 20);
            const context = raw.substring(start, end).replace(/\n/g, "\\n");
            const pointer = " ".repeat(pos - start) + "^";
            console.log(`${COLOR.YELLOW}  上下文: ...${context}...${COLOR.RESET}`);
            console.log(`${COLOR.YELLOW}          ${pointer}${COLOR.RESET}`);
        }
        process.exit(1);
    }
    console.log(`${COLOR.GREEN}✓ JSON 格式合法${COLOR.RESET} (${raw.length} 字节)`);
    if (schemaPath) {
        const [schemaObj, sErr] = safeParse(readInput(schemaPath));
        if (sErr)
            die(`Schema 解析失败: ${sErr.message}`);
        const issues = validateSchema(JSON.parse(raw), schemaObj);
        const errors = issues.filter((i) => i[1] === ValidateSeverity.Error).length;
        const warns = issues.filter((i) => i[1] === ValidateSeverity.Warning).length;
        console.log(`${COLOR.BOLD}── Schema 校验 ──${COLOR.RESET} ${errors} 错误 / ${warns} 警告`);
        for (const [p, sev, msg] of issues) {
            const col = sev === ValidateSeverity.Error ? COLOR.RED : sev === ValidateSeverity.Warning ? COLOR.YELLOW : COLOR.CYAN;
            console.log(`  ${col}[${sev}] ${p}: ${msg}${COLOR.RESET}`);
        }
        if (errors > 0)
            process.exit(1);
    }
}
function cmdQuery(raw, q) {
    try {
        const result = query(raw, q, true);
        if (result.length === 0) {
            console.log(`${COLOR.YELLOW}路径 "${q}" 未匹配任何值${COLOR.RESET}`);
            process.exit(1);
        }
        console.log(`${COLOR.GRAY}匹配 ${result.length} 个结果:${COLOR.RESET}`);
        for (const r of result) {
            if (typeof r === "object" && r !== null)
                console.log(colorize(JSON.stringify(r, null, 2)));
            else if (typeof r === "string")
                console.log(`${COLOR.GREEN}"${r}"${COLOR.RESET}`);
            else
                console.log(`${COLOR.YELLOW}${r}${COLOR.RESET}`);
        }
    }
    catch (e) {
        die(`查询失败: ${e instanceof Error ? e.message : String(e)}`);
    }
}
function cmdStats(raw) {
    const [obj, err] = safeParse(raw);
    if (err)
        die(err.message);
    const stats = getStats(obj, raw.length);
    console.log(`${COLOR.BOLD}── JSON 统计信息 ──${COLOR.RESET}`);
    console.log(`  根类型:    ${COLOR.CYAN}${stats.type}${COLOR.RESET}`);
    console.log(`  嵌套深度:  ${COLOR.YELLOW}${stats.depth}${COLOR.RESET}`);
    console.log(`  节点总数:  ${COLOR.MAGENTA}${stats.nodeCount}${COLOR.RESET}`);
    console.log(`  原始大小:  ${COLOR.GREEN}${stats.sizeBytes} 字节${COLOR.RESET}`);
    console.log(`${COLOR.BOLD}  类型分布:${COLOR.RESET}`);
    for (const [k, v] of Object.entries(stats.distribution))
        console.log(`    ${k.padEnd(8)} ${COLOR.BLUE}${v}${COLOR.RESET}`);
    if (stats.type === JsonType.Object && stats.keyList) {
        console.log(`  键数量:    ${COLOR.BLUE}${stats.keys}${COLOR.RESET}`);
        console.log(`  键列表:    ${COLOR.GRAY}${stats.keyList.slice(0, 20).join(", ")}${stats.keyList.length > 20 ? ` ... (共 ${stats.keyList.length} 个)` : ""}${COLOR.RESET}`);
    }
    if (stats.type === JsonType.Array && stats.arrayLength !== undefined)
        console.log(`  数组长度:  ${COLOR.BLUE}${stats.arrayLength}${COLOR.RESET}`);
}
function cmdDiff(rawA, rawB) {
    const [a, e1] = safeParse(rawA);
    const [b, e2] = safeParse(rawB);
    if (e1)
        die(`A 解析失败: ${e1.message}`);
    if (e2)
        die(`B 解析失败: ${e2.message}`);
    const diffs = jsonDiff(a, b);
    if (diffs.length === 0) {
        console.log(`${COLOR.GREEN}✓ 两个 JSON 完全相同${COLOR.RESET}`);
        return;
    }
    console.log(`${COLOR.BOLD}── 差异 (${diffs.length} 处) ──${COLOR.RESET}`);
    for (const [p, kind, left, right] of diffs) {
        const col = kind === "added" ? COLOR.GREEN : kind === "removed" ? COLOR.RED : COLOR.YELLOW;
        const sym = kind === "added" ? "+" : kind === "removed" ? "-" : "~";
        console.log(`${col}${sym} ${p}  ${JSON.stringify(left)} => ${JSON.stringify(right)}${COLOR.RESET}`);
    }
}
function cmdMerge(rawA, rawB) {
    const [a, e1] = safeParse(rawA);
    const [b, e2] = safeParse(rawB);
    if (e1)
        die(`A 解析失败: ${e1.message}`);
    if (e2)
        die(`B 解析失败: ${e2.message}`);
    console.log(colorize(JSON.stringify(deepMerge(a, b), null, 2)));
}
function cmdCsv(raw) {
    const [obj, err] = safeParse(raw);
    if (err)
        die(err.message);
    if (!isJsonArray(obj))
        die("CSV 转换仅支持数组类型 JSON");
    const rows = obj.filter(isJsonObject);
    if (rows.length === 0)
        die("数组中无可用的对象元素");
    console.log(jsonToCsv(rows));
}
function cmdSort(raw) {
    const [obj, err] = safeParse(raw);
    if (err)
        die(err.message);
    console.log(colorize(JSON.stringify(sortKeys(obj), null, 2)));
}
function cmdEscape(raw) { console.log(unicodeEscape(raw)); }
function cmdUnescape(raw) { console.log(unicodeUnescape(raw)); }
// ===================== CLI Arg Parsing =====================
function printHelp() {
    console.log(`
JSON 格式化工具 (TypeScript Enhanced Edition)

用法:
  json-fmt <command> <file.json> [options]
  json-fmt --help, -h                     显示帮助

命令:
  format     格式化 JSON (美化输出，带语法高亮)
  minify     压缩 JSON (移除所有空白)
  validate   校验 JSON 是否合法 (--schema 校验 schema)
  query      JSONPath 查询 ($.a.b[0].c, $.items[*].name, $.users[?(@.age>=18)])
  stats      显示 JSON 统计信息
  diff       比较两个 JSON 文件的差异
  merge      深度合并两个 JSON
  csv        将对象数组转换为 CSV
  sort       递归排序所有对象键
  escape     将非 ASCII 字符转义为 \\uXXXX
  unescape   将 \\uXXXX 反转义

选项:
  -i, --indent <n>      格式化缩进空格数 (默认: 2)
  -o, --output <fmt>    输出格式: pretty|minify|colored|tree
  -s, --sort            递归排序键
  --schema <file>       validate 时指定 schema

stdin 读取: 用 "-" 作为文件名
  echo '{"a":1}' | json-fmt format -

示例:
  json-fmt format data.json -i 4
  json-fmt query data.json "$.users[?(@.age>=18)].name"
  json-fmt diff a.json b.json
  json-fmt csv data.json
`.trim());
}
function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        return { command: null, filePath: "", secondPath: "", indent: 2, output: OutputFormat.Pretty, queryPath: "", schemaPath: "", sortKeys: false, useStdin: false, showHelp: true };
    }
    const command = args[0];
    if (!VALID_COMMANDS.includes(command))
        throw new RuntimeError(`未知命令: "${command}" (可用: ${VALID_COMMANDS.join(", ")})`);
    if (args.length < 2)
        throw new RuntimeError(`命令 "${command}" 需要指定 JSON 文件路径 (或 "-" 从 stdin 读取)`);
    const filePath = args[1];
    let indent = 2, output = OutputFormat.Pretty, queryPath = "", schemaPath = "", secondPath = "", sortKeys = false;
    const needsSecond = command === "diff" || command === "merge";
    for (let i = 2; i < args.length; i++) {
        const a = args[i];
        if (a === "-i" || a === "--indent") {
            i++;
            if (i >= args.length)
                throw new RuntimeError("--indent 需要一个数字参数");
            indent = Number(args[i]);
            if (Number.isNaN(indent) || indent < 0)
                throw new RuntimeError("--indent 必须为非负整数");
        }
        else if (a === "-o" || a === "--output") {
            i++;
            if (i >= args.length)
                throw new RuntimeError("--output 需要参数");
            output = args[i];
        }
        else if (a === "-s" || a === "--sort") {
            sortKeys = true;
        }
        else if (a === "--schema") {
            i++;
            if (i >= args.length)
                throw new RuntimeError("--schema 需要参数");
            schemaPath = args[i];
        }
        else if (needsSecond && !secondPath) {
            secondPath = a;
        }
        else if (command === "query" && !queryPath) {
            queryPath = a;
        }
    }
    if (needsSecond && !secondPath)
        throw new RuntimeError(`命令 "${command}" 需要第二个文件路径`);
    if (command === "query" && !queryPath)
        throw new RuntimeError('query 命令需要查询路径, 例如: json-fmt query data.json "$.a.b"');
    return { command, filePath, secondPath, indent, output, queryPath, schemaPath, sortKeys, useStdin: filePath === "-", showHelp: false };
}
// ===================== Main Entry =====================
function main() {
    try {
        const parsed = parseArgs(process.argv);
        if (parsed.showHelp) {
            printHelp();
            return;
        }
        const raw = readInput(parsed.filePath);
        switch (parsed.command) {
            case "format":
                cmdFormat(raw, parsed.indent, parsed.output, parsed.sortKeys);
                break;
            case "minify":
                cmdMinify(raw);
                break;
            case "validate":
                cmdValidate(raw, parsed.schemaPath);
                break;
            case "query":
                cmdQuery(raw, parsed.queryPath);
                break;
            case "stats":
                cmdStats(raw);
                break;
            case "diff":
                cmdDiff(raw, readInput(parsed.secondPath));
                break;
            case "merge":
                cmdMerge(raw, readInput(parsed.secondPath));
                break;
            case "csv":
                cmdCsv(raw);
                break;
            case "sort":
                cmdSort(raw);
                break;
            case "escape":
                cmdEscape(raw);
                break;
            case "unescape":
                cmdUnescape(raw);
                break;
            case null:
                printHelp();
                break;
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${COLOR.RED}错误: ${msg}${COLOR.RESET}\n`);
        printHelp();
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map