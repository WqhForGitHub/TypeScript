#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateEngine = exports.TemplateStore = exports.BlockNode = exports.IncludeNode = exports.ForNode = exports.IfNode = exports.VarNode = exports.TextNode = exports.AbstractNode = exports.RenderError = exports.ParseError = exports.TemplateError = exports.FilterName = exports.ErrorCode = exports.NodeType = exports.TokenType = void 0;
exports.isTextNode = isTextNode;
exports.isVarNode = isVarNode;
exports.isIfNode = isIfNode;
exports.isForNode = isForNode;
exports.isIncludeNode = isIncludeNode;
exports.isBlockNode = isBlockNode;
exports.isTemplateError = isTemplateError;
/**
 * 简单模板引擎 (Template Engine) — Enhanced TypeScript Edition
 * 支持：变量插值/原始输出/嵌套访问/过滤器/条件/循环/partial/helper/注释。
 * 仅依赖 Node.js 内置模块: fs, path.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ===================== Enums =====================
var TokenType;
(function (TokenType) {
    TokenType["Text"] = "text";
    TokenType["Expression"] = "expression";
    TokenType["RawExpression"] = "raw_expression";
    TokenType["IfStart"] = "if_start";
    TokenType["EachStart"] = "each_start";
    TokenType["Else"] = "else";
    TokenType["EndIf"] = "end_if";
    TokenType["EndEach"] = "end_each";
    TokenType["Partial"] = "partial";
    TokenType["Helper"] = "helper";
    TokenType["Comment"] = "comment";
})(TokenType || (exports.TokenType = TokenType = {}));
var NodeType;
(function (NodeType) {
    NodeType["Text"] = "text";
    NodeType["Var"] = "var";
    NodeType["If"] = "if";
    NodeType["For"] = "for";
    NodeType["Include"] = "include";
    NodeType["Block"] = "block";
})(NodeType || (exports.NodeType = NodeType = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["ParseError"] = "PARSE_ERROR";
    ErrorCode["RenderError"] = "RENDER_ERROR";
    ErrorCode["UnknownFilter"] = "UNKNOWN_FILTER";
    ErrorCode["UnknownHelper"] = "UNKNOWN_HELPER";
    ErrorCode["UnknownPartial"] = "UNKNOWN_PARTIAL";
    ErrorCode["InvalidSyntax"] = "INVALID_SYNTAX";
    ErrorCode["DepthExceeded"] = "DEPTH_EXCEEDED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
var FilterName;
(function (FilterName) {
    FilterName["Upper"] = "upper";
    FilterName["Lower"] = "lower";
    FilterName["Trim"] = "trim";
    FilterName["Length"] = "length";
    FilterName["Default"] = "default";
    FilterName["Json"] = "json";
    FilterName["Reverse"] = "reverse";
})(FilterName || (exports.FilterName = FilterName = {}));
// ===================== `as const` assertions =====================
const SYNTAX = {
    open: '{{', close: '}}', rawOpen: '{{{', rawClose: '}}}',
    ifStart: '#if', eachStart: '#each', partial: '>',
    commentOpen: '!--', commentClose: '--',
    else: 'else', endIf: '/if', endEach: '/each',
    pipe: '|', colon: ':',
};
const BUILTIN_FILTER_NAMES = [
    FilterName.Upper, FilterName.Lower, FilterName.Trim, FilterName.Length,
    FilterName.Default, FilterName.Json, FilterName.Reverse,
];
const COMMENT_OPEN = `${SYNTAX.open}${SYNTAX.commentOpen}`;
const COMMENT_CLOSE = `${SYNTAX.commentClose}${SYNTAX.close}`;
// ===================== Symbols (unique property keys) =====================
const NODE_ID = Symbol('nodeId');
const ENGINE_VERSION = Symbol('version');
// ===================== Custom Error Hierarchy =====================
class TemplateError extends Error {
    constructor(message, code, line, column) {
        super(message);
        this.code = code;
        this.line = line;
        this.column = column;
        this.name = 'TemplateError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
    toJSON() {
        return { name: this.name, code: this.code, message: this.message, line: this.line };
    }
}
exports.TemplateError = TemplateError;
class ParseError extends TemplateError {
    constructor(message, line, column) {
        super(message, ErrorCode.ParseError, line, column);
        this.name = 'ParseError';
    }
}
exports.ParseError = ParseError;
class RenderError extends TemplateError {
    constructor(message, nodeType) {
        super(message, ErrorCode.RenderError);
        this.nodeType = nodeType;
        this.name = 'RenderError';
    }
}
exports.RenderError = RenderError;
// ===================== Abstract Node + Concrete Subclasses =====================
class AbstractNode {
    constructor() { this[NODE_ID] = AbstractNode._counter++; }
    get nodeId() { return this[NODE_ID]; }
}
exports.AbstractNode = AbstractNode;
AbstractNode._counter = 0;
class TextNode extends AbstractNode {
    constructor(value) {
        super();
        this.value = value;
        this.type = NodeType.Text;
    }
    render() { return this.value; }
    *[Symbol.iterator]() { yield this; }
}
exports.TextNode = TextNode;
class VarNode extends AbstractNode {
    constructor(expr, raw) {
        super();
        this.expr = expr;
        this.raw = raw;
        this.type = NodeType.Var;
    }
    render(ctx) { return renderExpression(this.expr, this.raw, ctx); }
    *[Symbol.iterator]() { yield this; }
}
exports.VarNode = VarNode;
class IfNode extends AbstractNode {
    constructor(cond) {
        super();
        this.cond = cond;
        this.type = NodeType.If;
        this.els = null;
        this.then = [];
    }
    render(ctx) {
        if (evalBool(this.cond, ctx))
            return renderNodes(this.then, ctx);
        return this.els ? renderNodes(this.els, ctx) : '';
    }
    *[Symbol.iterator]() {
        yield this;
        for (const n of this.then)
            yield* n;
        if (this.els)
            for (const n of this.els)
                yield* n;
    }
}
exports.IfNode = IfNode;
class ForNode extends AbstractNode {
    constructor(expr) {
        super();
        this.expr = expr;
        this.type = NodeType.For;
        this.body = [];
    }
    render(ctx) { return renderLoop(this.expr, this.body, ctx); }
    *[Symbol.iterator]() {
        yield this;
        for (const n of this.body)
            yield* n;
    }
}
exports.ForNode = ForNode;
class IncludeNode extends AbstractNode {
    constructor(name) {
        super();
        this.name = name;
        this.type = NodeType.Include;
    }
    render(ctx) {
        const entry = ctx.partials.get(this.name);
        if (!entry)
            return '';
        if (ctx.depth >= ctx.maxDepth) {
            throw new RenderError(`max depth exceeded at partial "${this.name}"`, NodeType.Include);
        }
        return renderNodes(entry.ast, { ...ctx, depth: ctx.depth + 1 });
    }
    *[Symbol.iterator]() { yield this; }
}
exports.IncludeNode = IncludeNode;
class BlockNode extends AbstractNode {
    constructor(name, args) {
        super();
        this.name = name;
        this.args = args;
        this.type = NodeType.Block;
    }
    render(ctx) {
        const fn = ctx.helpers.get(this.name);
        if (!fn)
            return '';
        const resolved = this.args.map((a) => resolveValue(a, ctx));
        return escapeHtml(fn(...resolved));
    }
    *[Symbol.iterator]() { yield this; }
}
exports.BlockNode = BlockNode;
// ===================== Type Guards =====================
function isTextNode(node) { return node.type === NodeType.Text; }
function isVarNode(node) { return node.type === NodeType.Var; }
function isIfNode(node) { return node.type === NodeType.If; }
function isForNode(node) { return node.type === NodeType.For; }
function isIncludeNode(node) { return node.type === NodeType.Include; }
function isBlockNode(node) { return node.type === NodeType.Block; }
function isTemplateError(e) { return e instanceof TemplateError; }
// ===================== Core Helper Functions =====================
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function resolvePath(expr, data) {
    const e = expr.trim();
    if (e === 'this' || e === '.')
        return data['this'];
    if (e.startsWith('@'))
        return data[e];
    const parts = e.split('.');
    let cur = data;
    for (const p of parts) {
        if (cur === null || cur === undefined)
            return undefined;
        if (typeof cur !== 'object')
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function resolveValue(expr, ctx) {
    const e = expr.trim();
    switch (e) {
        case 'true': return true;
        case 'false': return false;
        case 'null': return null;
        case 'undefined': return undefined;
        default: break;
    }
    if (/^-?\d+(\.\d+)?$/.test(e))
        return Number(e);
    if ((e.startsWith('"') && e.endsWith('"')) || (e.startsWith("'") && e.endsWith("'"))) {
        return e.slice(1, -1);
    }
    return resolvePath(e, ctx.data);
}
function evalBool(expr, ctx) {
    const e = expr.trim();
    const cmpMatch = e.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (cmpMatch) {
        const left = resolveValue(cmpMatch[1].trim(), ctx);
        const right = resolveValue(cmpMatch[3].trim(), ctx);
        const op = cmpMatch[2];
        switch (op) {
            case '==': return left == right; // eslint-disable-line eqeqeq
            case '!=': return left != right; // eslint-disable-line eqeqeq
            case '>': return Number(left) > Number(right);
            case '<': return Number(left) < Number(right);
            case '>=': return Number(left) >= Number(right);
            case '<=': return Number(left) <= Number(right);
        }
    }
    const v = resolveValue(e, ctx);
    return !!v && !(Array.isArray(v) && v.length === 0);
}
function renderExpression(expr, raw, ctx) {
    let val;
    if (expr.includes(SYNTAX.pipe)) {
        const [pathPart, ...filterParts] = expr.split(SYNTAX.pipe).map((s) => s.trim());
        val = resolvePath(pathPart, ctx.data);
        for (const fp of filterParts) {
            const [fname, ...args] = fp.split(SYNTAX.colon).map((s) => s.trim());
            const fn = ctx.filters.get(fname);
            if (fn)
                val = fn(val, ...args.map((a) => resolveValue(a, ctx)));
        }
    }
    else {
        val = resolvePath(expr, ctx.data);
    }
    if (val === null || val === undefined)
        val = '';
    return raw ? String(val) : escapeHtml(String(val));
}
function renderLoop(expr, body, ctx) {
    const arr = resolvePath(expr, ctx.data);
    let out = '';
    if (Array.isArray(arr)) {
        arr.forEach((item, idx) => {
            const childData = { ...ctx.data, this: item, '@index': idx };
            out += renderNodes(body, { ...ctx, data: childData });
        });
    }
    else if (arr && typeof arr === 'object') {
        for (const [k, v] of Object.entries(arr)) {
            const childData = { ...ctx.data, this: v, '@key': k };
            out += renderNodes(body, { ...ctx, data: childData });
        }
    }
    return out;
}
function renderNodes(nodes, ctx) {
    let out = '';
    for (const node of nodes)
        out += node.render(ctx);
    return out;
}
/** Iterate every node reachable from the given root list. */
function* walkAll(nodes) {
    for (const n of nodes)
        yield* n;
}
// ===================== Tokenizer =====================
function classifyContent(content) {
    if (content.startsWith(SYNTAX.ifStart)) {
        return { type: TokenType.IfStart, value: content.slice(SYNTAX.ifStart.length).trim() };
    }
    if (content.startsWith(SYNTAX.eachStart)) {
        return { type: TokenType.EachStart, value: content.slice(SYNTAX.eachStart.length).trim() };
    }
    if (content.startsWith(SYNTAX.partial)) {
        return { type: TokenType.Partial, value: content.slice(SYNTAX.partial.length).trim() };
    }
    if (content === SYNTAX.else)
        return { type: TokenType.Else, value: content };
    if (content === SYNTAX.endIf)
        return { type: TokenType.EndIf, value: content };
    if (content === SYNTAX.endEach)
        return { type: TokenType.EndEach, value: content };
    const parts = content.split(/\s+/);
    if (parts.length > 1 && /^[a-zA-Z_]\w*$/.test(parts[0]) && !content.includes(SYNTAX.pipe)) {
        return { type: TokenType.Helper, value: parts[0], args: parts.slice(1) };
    }
    return { type: TokenType.Expression, value: content };
}
function tokenize(src) {
    const tokens = [];
    let i = 0;
    let buf = '';
    const flush = () => {
        if (buf) {
            tokens.push({ type: TokenType.Text, value: buf });
            buf = '';
        }
    };
    while (i < src.length) {
        if (src.startsWith(COMMENT_OPEN, i)) {
            flush();
            const end = src.indexOf(COMMENT_CLOSE, i + COMMENT_OPEN.length);
            i = end === -1 ? src.length : end + COMMENT_CLOSE.length;
            tokens.push({ type: TokenType.Comment, value: '' });
            continue;
        }
        if (src.startsWith(SYNTAX.rawOpen, i)) {
            flush();
            const end = src.indexOf(SYNTAX.rawClose, i + SYNTAX.rawOpen.length);
            const expr = src.slice(i + SYNTAX.rawOpen.length, end === -1 ? undefined : end).trim();
            tokens.push({ type: TokenType.RawExpression, value: expr });
            i = end === -1 ? src.length : end + SYNTAX.rawClose.length;
            continue;
        }
        if (src.startsWith(SYNTAX.open, i)) {
            flush();
            const end = src.indexOf(SYNTAX.close, i + SYNTAX.open.length);
            const content = src.slice(i + SYNTAX.open.length, end === -1 ? undefined : end).trim();
            i = end === -1 ? src.length : end + SYNTAX.close.length;
            tokens.push(classifyContent(content));
            continue;
        }
        buf += src[i];
        i++;
    }
    flush();
    return tokens;
}
// ===================== AST Builder =====================
function buildTree(tokens) {
    const root = [];
    const stack = [{ children: root, ifNode: null }];
    const push = (node) => { stack[stack.length - 1].children.push(node); };
    for (const tok of tokens) {
        switch (tok.type) {
            case TokenType.Text:
                push(new TextNode(tok.value));
                break;
            case TokenType.Expression:
                push(new VarNode(tok.value, false));
                break;
            case TokenType.RawExpression:
                push(new VarNode(tok.value, true));
                break;
            case TokenType.IfStart: {
                const node = new IfNode(tok.value);
                push(node);
                stack.push({ children: node.then, ifNode: node });
                break;
            }
            case TokenType.EachStart: {
                const node = new ForNode(tok.value);
                push(node);
                stack.push({ children: node.body, ifNode: null });
                break;
            }
            case TokenType.Else: {
                // Attach the else branch to the IfNode owning the current frame.
                // Tracking via the frame (rather than a single variable) correctly
                // handles `{{else}}` that follows a closed nested `{{#each}}`.
                const top = stack[stack.length - 1];
                if (top.ifNode) {
                    stack.pop();
                    const els = [];
                    top.ifNode.els = els;
                    stack.push({ children: els, ifNode: top.ifNode });
                }
                break;
            }
            case TokenType.EndIf:
            case TokenType.EndEach:
                stack.pop();
                break;
            case TokenType.Partial:
                push(new IncludeNode(tok.value));
                break;
            case TokenType.Helper:
                push(new BlockNode(tok.value, tok.args ?? []));
                break;
            case TokenType.Comment:
                break;
            default: {
                const _exhaustive = tok.type; // exhaustive guard
                void _exhaustive;
            }
        }
    }
    return root;
}
// ===================== Generic Template Store =====================
class TemplateStore {
    constructor() {
        this._items = new Map();
        this._count = 0;
    }
    get size() { return this._items.size; }
    get count() { return this._count; }
    add(item) {
        if (!this._items.has(item.id))
            this._count++;
        this._items.set(item.id, item);
        return this;
    }
    get(id) { return this._items.get(id); }
    has(id) { return this._items.has(id); }
    remove(id) {
        const r = this._items.delete(id);
        if (r)
            this._count--;
        return r;
    }
    clear() { this._items.clear(); this._count = 0; }
    [Symbol.iterator]() { return this._items.values()[Symbol.iterator](); }
    *values() { for (const v of this._items.values())
        yield v; }
    toArray() { return Array.from(this._items.values()); }
}
exports.TemplateStore = TemplateStore;
// ===================== Template Engine =====================
class TemplateEngine {
    get maxDepth() { return this._maxDepth; }
    set maxDepth(v) {
        if (v < 1 || !Number.isFinite(v)) {
            throw new TemplateError('maxDepth must be a positive finite number', ErrorCode.InvalidSyntax);
        }
        this._maxDepth = Math.floor(v);
    }
    get partialCount() { return this._partials.size; }
    get version() { return this[ENGINE_VERSION]; }
    constructor() {
        this._helpers = new Map();
        this._filters = new Map();
        this._partials = new TemplateStore();
        this._maxDepth = 100;
        this[_a] = '1.0.0';
        this.registerBuiltins();
    }
    registerBuiltins() {
        const builtinFilters = {
            upper: (v) => String(v).toUpperCase(),
            lower: (v) => String(v).toLowerCase(),
            trim: (v) => String(v).trim(),
            length: (v) => (Array.isArray(v) ? v.length : String(v).length),
            default: (v, d) => (v === null || v === undefined || v === '' ? d : v),
            json: (v) => JSON.stringify(v),
            reverse: (v) => String(v).split('').reverse().join(''),
        };
        const entries = Object.entries(builtinFilters);
        for (const [name, fn] of entries)
            this._filters.set(name, fn);
        void BUILTIN_FILTER_NAMES;
        this._helpers.set('upper', (s) => String(s).toUpperCase());
        this._helpers.set('concat', (...args) => args.map(String).join(''));
        this._helpers.set('ifEqual', (a, b) => (a == b ? 'true' : 'false')); // eslint-disable-line eqeqeq
    }
    registerFilter(name, fn) {
        this._filters.set(name, fn);
        return this;
    }
    registerHelper(name, fn) { this._helpers.set(name, fn); return this; }
    registerPartial(name, template) {
        const ast = buildTree(tokenize(template));
        this._partials.add({ id: name, ast, source: template });
        return this;
    }
    hasPartial(name) { return this._partials.has(name); }
    compile(template, options) {
        const ast = buildTree(tokenize(template));
        const maxDepth = options?.maxDepth ?? this._maxDepth;
        const ctx = {
            data: {}, helpers: this._helpers, filters: this._filters,
            partials: this._partials, depth: 0, maxDepth,
        };
        return (data) => renderNodes(ast, { ...ctx, data });
    }
    render(template, data, options) {
        return this.compile(template, options)(data);
    }
    /** Walk every node in a compiled template (inspection / tooling). */
    *walk(template) {
        yield* walkAll(buildTree(tokenize(template)));
    }
}
exports.TemplateEngine = TemplateEngine;
_a = ENGINE_VERSION;
// ===================== CLI 演示 =====================
function showExamples() {
    console.log('===== 模板引擎示例 =====\n');
    const engine = new TemplateEngine();
    engine.registerPartial('greeting', '你好, {{name}}!');
    engine.registerHelper('repeat', (s, n) => String(s).repeat(Number(n)));
    const tpl = `{{!-- 这是一个注释，不会输出 --}}
{{greeting name=name}} <{{email}}>
{{{rawHtml}}}

过滤: {{name | upper}} | {{name | reverse}}
默认: {{missing | default:"N/A"}}

{{#if items.length}}
项目列表:
{{#each items}}
  [{{@index}}] {{this.name}} - {{this.price}} 元
{{/each}}
{{else}}
没有项目
{{/if}}

{{#if user.isAdmin}}
管理员模式
{{else}}
普通用户模式
{{/if}}

重复: {{repeat "ab" 3}}

> partial: {{> greeting}}
`;
    const data = {
        name: '<script>x</script>张三',
        email: 'zhangsan@test.com',
        rawHtml: '<b>原始 HTML</b>',
        missing: '',
        items: [
            { name: '苹果', price: 5 },
            { name: '香蕉', price: 3 },
            { name: '橙子', price: 4 },
        ],
        user: { isAdmin: true },
    };
    console.log('--- 模板 ---');
    console.log(tpl);
    console.log('--- 渲染结果 ---');
    console.log(engine.render(tpl, data));
    // Demonstrate the generator walk + type guards.
    const nodes = Array.from(engine.walk(tpl));
    const counts = {};
    for (const n of nodes) {
        const key = isIfNode(n) ? 'if' : isForNode(n) ? 'for' : isIncludeNode(n) ? 'include'
            : isBlockNode(n) ? 'block' : isVarNode(n) ? 'var' : isTextNode(n) ? 'text' : 'other';
        counts[key] = (counts[key] ?? 0) + 1;
    }
    console.log(`--- 节点统计 (共 ${nodes.length} 个) ---`, counts);
}
async function main() {
    const cmd = process.argv[2];
    switch (cmd) {
        case 'render': {
            const tpl = process.argv[3];
            const jsonFile = process.argv[4];
            if (!tpl || !jsonFile) {
                console.log('用法: render <模板文件或字符串> <data.json>');
                return;
            }
            const engine = new TemplateEngine();
            let templateStr = tpl;
            const resolved = path_1.default.resolve(tpl);
            if (fs_1.default.existsSync(resolved))
                templateStr = fs_1.default.readFileSync(resolved, 'utf8');
            const data = JSON.parse(fs_1.default.readFileSync(path_1.default.resolve(jsonFile), 'utf8'));
            try {
                console.log(engine.render(templateStr, data));
            }
            catch (e) {
                if (isTemplateError(e))
                    console.error(`[${e.code}] ${e.message}`);
                else
                    throw e;
            }
            break;
        }
        case 'compile': {
            const tpl = process.argv[3];
            const oFlag = process.argv.indexOf('-o');
            if (!tpl) {
                console.log('用法: compile <模板文件> [-o outfile]');
                return;
            }
            const engine = new TemplateEngine();
            const src = fs_1.default.readFileSync(path_1.default.resolve(tpl), 'utf8');
            const fn = engine.compile(src);
            const outPath = oFlag >= 0 ? process.argv[oFlag + 1] : path_1.default.join(process.cwd(), 'compiled.js');
            const code = `// 预编译模板，由简单模板引擎生成
// 使用: const fn = require('./compiled.js'); fn(data);
module.exports = ${fn.toString()};\n`;
            fs_1.default.writeFileSync(outPath, code, 'utf8');
            console.log(`已预编译并输出到 ${outPath}`);
            break;
        }
        case 'examples':
            showExamples();
            break;
        default:
            console.log(`
简单模板引擎 - 命令行演示

用法:
  render <模板文件或字符串> <data.json>   渲染模板
  compile <模板文件> [-o outfile]         预编译模板为函数
  examples                                展示示例

示例:
  examples
  render ./tpl.txt ./data.json
  compile ./tpl.txt -o compiled.js
`);
    }
}
void main();
//# sourceMappingURL=index.js.map