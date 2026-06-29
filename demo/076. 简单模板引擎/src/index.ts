#!/usr/bin/env node
/**
 * 简单模板引擎 (Template Engine) — Enhanced TypeScript Edition
 * 支持：变量插值/原始输出/嵌套访问/过滤器/条件/循环/partial/helper/注释。
 * 仅依赖 Node.js 内置模块: fs, path.
 */
import fs from "fs";
import path from "path";

// ===================== Enums =====================

export enum TokenType {
  Text = "text",
  Expression = "expression",
  RawExpression = "raw_expression",
  IfStart = "if_start",
  EachStart = "each_start",
  Else = "else",
  EndIf = "end_if",
  EndEach = "end_each",
  Partial = "partial",
  Helper = "helper",
  Comment = "comment",
}

export enum NodeType {
  Text = "text",
  Var = "var",
  If = "if",
  For = "for",
  Include = "include",
  Block = "block",
}

export enum ErrorCode {
  ParseError = "PARSE_ERROR",
  RenderError = "RENDER_ERROR",
  UnknownFilter = "UNKNOWN_FILTER",
  UnknownHelper = "UNKNOWN_HELPER",
  UnknownPartial = "UNKNOWN_PARTIAL",
  InvalidSyntax = "INVALID_SYNTAX",
  DepthExceeded = "DEPTH_EXCEEDED",
}

export enum FilterName {
  Upper = "upper",
  Lower = "lower",
  Trim = "trim",
  Length = "length",
  Default = "default",
  Json = "json",
  Reverse = "reverse",
}

// ===================== Template Literal Types =====================

type OpenBrace = "{";
type CloseBrace = "}";
type DoubleOpen = `${OpenBrace}${OpenBrace}`;
type DoubleClose = `${CloseBrace}${CloseBrace}`;
type TripleOpen = `${OpenBrace}${DoubleOpen}`;
type TripleClose = `${CloseBrace}${DoubleClose}`;
type VarExpression = `${DoubleOpen}${string}${DoubleClose}`;
type DirectiveStart = `${DoubleOpen}#${string}`;
type PartialStart = `${DoubleOpen}>${string}`;
type BlockClose = `${DoubleOpen}/${string}${DoubleClose}`;
type TemplateSyntax =
  VarExpression | DirectiveStart | PartialStart | BlockClose;

// ===================== Type Aliases & Mapped Types =====================

export type HelperFn = (...args: unknown[]) => string;
export type FilterFn = (value: unknown, ...args: unknown[]) => unknown;

/** Removes `readonly` modifiers from all properties of T. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Render data bag: string-indexed, holding arbitrary values. */
export interface RenderData {
  [key: string]: unknown;
}

// ===================== Interfaces =====================

export interface Identifiable {
  readonly id: string;
}

interface EvalContext {
  readonly data: RenderData;
  readonly helpers: ReadonlyMap<string, HelperFn>;
  readonly filters: ReadonlyMap<string, FilterFn>;
  readonly partials: TemplateStore<PartialEntry>;
  readonly depth: number;
  readonly maxDepth: number;
}

export interface PartialEntry extends Identifiable {
  readonly id: string;
  readonly ast: readonly AbstractNode[];
  readonly source: string;
}

export interface CompileOptions {
  readonly strict?: boolean;
  readonly maxDepth?: number;
  readonly sourceFile?: string;
}

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly args?: readonly string[];
}

interface Frame {
  children: AbstractNode[];
  /** When this frame is the then/els body of an `{{#if}}`, the owning IfNode. */
  ifNode: IfNode | null;
}

// ===================== `as const` assertions =====================

const SYNTAX = {
  open: "{{",
  close: "}}",
  rawOpen: "{{{",
  rawClose: "}}}",
  ifStart: "#if",
  eachStart: "#each",
  partial: ">",
  commentOpen: "!--",
  commentClose: "--",
  else: "else",
  endIf: "/if",
  endEach: "/each",
  pipe: "|",
  colon: ":",
} as const;

const BUILTIN_FILTER_NAMES = [
  FilterName.Upper,
  FilterName.Lower,
  FilterName.Trim,
  FilterName.Length,
  FilterName.Default,
  FilterName.Json,
  FilterName.Reverse,
] as const;

const COMMENT_OPEN: string = `${SYNTAX.open}${SYNTAX.commentOpen}`;
const COMMENT_CLOSE: string = `${SYNTAX.commentClose}${SYNTAX.close}`;

// ===================== Symbols (unique property keys) =====================

const NODE_ID = Symbol("nodeId");
const ENGINE_VERSION = Symbol("version");

// ===================== Custom Error Hierarchy =====================

export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly line?: number,
    public readonly column?: number,
  ) {
    super(message);
    this.name = "TemplateError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toJSON(): { name: string; code: ErrorCode; message: string; line?: number } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      line: this.line,
    };
  }
}

export class ParseError extends TemplateError {
  constructor(message: string, line?: number, column?: number) {
    super(message, ErrorCode.ParseError, line, column);
    this.name = "ParseError";
  }
}

export class RenderError extends TemplateError {
  constructor(
    message: string,
    public readonly nodeType?: NodeType,
  ) {
    super(message, ErrorCode.RenderError);
    this.name = "RenderError";
  }
}

// ===================== Abstract Node + Concrete Subclasses =====================

export abstract class AbstractNode implements Iterable<AbstractNode> {
  abstract readonly type: NodeType;
  readonly [NODE_ID]: number;
  private static _counter = 0;
  constructor() {
    this[NODE_ID] = AbstractNode._counter++;
  }
  get nodeId(): number {
    return this[NODE_ID];
  }
  abstract render(ctx: EvalContext): string;
  abstract [Symbol.iterator](): IterableIterator<AbstractNode>;
}

export class TextNode extends AbstractNode {
  readonly type: NodeType.Text = NodeType.Text;
  constructor(readonly value: string) {
    super();
  }
  render(): string {
    return this.value;
  }
  *[Symbol.iterator](): IterableIterator<AbstractNode> {
    yield this;
  }
}

export class VarNode extends AbstractNode {
  readonly type: NodeType.Var = NodeType.Var;
  constructor(
    readonly expr: string,
    readonly raw: boolean,
  ) {
    super();
  }
  render(ctx: EvalContext): string {
    return renderExpression(this.expr, this.raw, ctx);
  }
  *[Symbol.iterator](): IterableIterator<AbstractNode> {
    yield this;
  }
}

export class IfNode extends AbstractNode {
  readonly type: NodeType.If = NodeType.If;
  then: AbstractNode[];
  readonly els: AbstractNode[] | null = null;
  constructor(readonly cond: string) {
    super();
    this.then = [];
  }
  render(ctx: EvalContext): string {
    if (evalBool(this.cond, ctx)) return renderNodes(this.then, ctx);
    return this.els ? renderNodes(this.els, ctx) : "";
  }
  *[Symbol.iterator](): IterableIterator<AbstractNode> {
    yield this;
    for (const n of this.then) yield* n;
    if (this.els) for (const n of this.els) yield* n;
  }
}

export class ForNode extends AbstractNode {
  readonly type: NodeType.For = NodeType.For;
  body: AbstractNode[];
  constructor(readonly expr: string) {
    super();
    this.body = [];
  }
  render(ctx: EvalContext): string {
    return renderLoop(this.expr, this.body, ctx);
  }
  *[Symbol.iterator](): IterableIterator<AbstractNode> {
    yield this;
    for (const n of this.body) yield* n;
  }
}

export class IncludeNode extends AbstractNode {
  readonly type: NodeType.Include = NodeType.Include;
  constructor(readonly name: string) {
    super();
  }
  render(ctx: EvalContext): string {
    const entry = ctx.partials.get(this.name);
    if (!entry) return "";
    if (ctx.depth >= ctx.maxDepth) {
      throw new RenderError(
        `max depth exceeded at partial "${this.name}"`,
        NodeType.Include,
      );
    }
    return renderNodes(entry.ast, { ...ctx, depth: ctx.depth + 1 });
  }
  *[Symbol.iterator](): IterableIterator<AbstractNode> {
    yield this;
  }
}

export class BlockNode extends AbstractNode {
  readonly type: NodeType.Block = NodeType.Block;
  constructor(
    readonly name: string,
    readonly args: readonly string[],
  ) {
    super();
  }
  render(ctx: EvalContext): string {
    const fn = ctx.helpers.get(this.name);
    if (!fn) return "";
    const resolved = this.args.map((a) => resolveValue(a, ctx));
    return escapeHtml(fn(...resolved));
  }
  *[Symbol.iterator](): IterableIterator<AbstractNode> {
    yield this;
  }
}

/** Discriminated union of all AST node types. */
export type ASTNode =
  TextNode | VarNode | IfNode | ForNode | IncludeNode | BlockNode;

// ===================== Type Guards =====================

export function isTextNode(node: AbstractNode): node is TextNode {
  return node.type === NodeType.Text;
}
export function isVarNode(node: AbstractNode): node is VarNode {
  return node.type === NodeType.Var;
}
export function isIfNode(node: AbstractNode): node is IfNode {
  return node.type === NodeType.If;
}
export function isForNode(node: AbstractNode): node is ForNode {
  return node.type === NodeType.For;
}
export function isIncludeNode(node: AbstractNode): node is IncludeNode {
  return node.type === NodeType.Include;
}
export function isBlockNode(node: AbstractNode): node is BlockNode {
  return node.type === NodeType.Block;
}
export function isTemplateError(e: unknown): e is TemplateError {
  return e instanceof TemplateError;
}

// ===================== Core Helper Functions =====================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePath(expr: string, data: RenderData): unknown {
  const e = expr.trim();
  if (e === "this" || e === ".") return data["this"];
  if (e.startsWith("@")) return data[e];
  const parts = e.split(".");
  let cur: unknown = data;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as RenderData)[p];
  }
  return cur;
}

function resolveValue(expr: string, ctx: EvalContext): unknown {
  const e = expr.trim();
  switch (e) {
    case "true":
      return true;
    case "false":
      return false;
    case "null":
      return null;
    case "undefined":
      return undefined;
    default:
      break;
  }
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (
    (e.startsWith('"') && e.endsWith('"')) ||
    (e.startsWith("'") && e.endsWith("'"))
  ) {
    return e.slice(1, -1);
  }
  return resolvePath(e, ctx.data);
}

type ComparisonOp = "==" | "!=" | ">=" | "<=" | ">" | "<";

function evalBool(expr: string, ctx: EvalContext): boolean {
  const e = expr.trim();
  const cmpMatch = e.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (cmpMatch) {
    const left = resolveValue(cmpMatch[1].trim(), ctx);
    const right = resolveValue(cmpMatch[3].trim(), ctx);
    const op = cmpMatch[2] as ComparisonOp;
    switch (op) {
      case "==":
        return left == right; // eslint-disable-line eqeqeq
      case "!=":
        return left != right; // eslint-disable-line eqeqeq
      case ">":
        return Number(left) > Number(right);
      case "<":
        return Number(left) < Number(right);
      case ">=":
        return Number(left) >= Number(right);
      case "<=":
        return Number(left) <= Number(right);
    }
  }
  const v = resolveValue(e, ctx);
  return !!v && !(Array.isArray(v) && v.length === 0);
}

function renderExpression(
  expr: string,
  raw: boolean,
  ctx: EvalContext,
): string {
  let val: unknown;
  if (expr.includes(SYNTAX.pipe)) {
    const [pathPart, ...filterParts] = expr
      .split(SYNTAX.pipe)
      .map((s) => s.trim());
    val = resolvePath(pathPart, ctx.data);
    for (const fp of filterParts) {
      const [fname, ...args] = fp.split(SYNTAX.colon).map((s) => s.trim());
      const fn = ctx.filters.get(fname);
      if (fn) val = fn(val, ...args.map((a) => resolveValue(a, ctx)));
    }
  } else {
    val = resolvePath(expr, ctx.data);
  }
  if (val === null || val === undefined) val = "";
  return raw ? String(val) : escapeHtml(String(val));
}

function renderLoop(
  expr: string,
  body: readonly AbstractNode[],
  ctx: EvalContext,
): string {
  const arr = resolvePath(expr, ctx.data);
  let out = "";
  if (Array.isArray(arr)) {
    arr.forEach((item, idx) => {
      const childData: RenderData = { ...ctx.data, this: item, "@index": idx };
      out += renderNodes(body, { ...ctx, data: childData });
    });
  } else if (arr && typeof arr === "object") {
    for (const [k, v] of Object.entries(arr)) {
      const childData: RenderData = { ...ctx.data, this: v, "@key": k };
      out += renderNodes(body, { ...ctx, data: childData });
    }
  }
  return out;
}

function renderNodes(nodes: readonly AbstractNode[], ctx: EvalContext): string {
  let out = "";
  for (const node of nodes) out += node.render(ctx);
  return out;
}

/** Iterate every node reachable from the given root list. */
function* walkAll(
  nodes: readonly AbstractNode[],
): IterableIterator<AbstractNode> {
  for (const n of nodes) yield* n;
}

// ===================== Tokenizer =====================

function classifyContent(content: string): Token {
  if (content.startsWith(SYNTAX.ifStart)) {
    return {
      type: TokenType.IfStart,
      value: content.slice(SYNTAX.ifStart.length).trim(),
    };
  }
  if (content.startsWith(SYNTAX.eachStart)) {
    return {
      type: TokenType.EachStart,
      value: content.slice(SYNTAX.eachStart.length).trim(),
    };
  }
  if (content.startsWith(SYNTAX.partial)) {
    return {
      type: TokenType.Partial,
      value: content.slice(SYNTAX.partial.length).trim(),
    };
  }
  if (content === SYNTAX.else) return { type: TokenType.Else, value: content };
  if (content === SYNTAX.endIf)
    return { type: TokenType.EndIf, value: content };
  if (content === SYNTAX.endEach)
    return { type: TokenType.EndEach, value: content };
  const parts = content.split(/\s+/);
  if (
    parts.length > 1 &&
    /^[a-zA-Z_]\w*$/.test(parts[0]) &&
    !content.includes(SYNTAX.pipe)
  ) {
    return { type: TokenType.Helper, value: parts[0], args: parts.slice(1) };
  }
  return { type: TokenType.Expression, value: content };
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = "";
  const flush = (): void => {
    if (buf) {
      tokens.push({ type: TokenType.Text, value: buf });
      buf = "";
    }
  };
  while (i < src.length) {
    if (src.startsWith(COMMENT_OPEN, i)) {
      flush();
      const end = src.indexOf(COMMENT_CLOSE, i + COMMENT_OPEN.length);
      i = end === -1 ? src.length : end + COMMENT_CLOSE.length;
      tokens.push({ type: TokenType.Comment, value: "" });
      continue;
    }
    if (src.startsWith(SYNTAX.rawOpen, i)) {
      flush();
      const end = src.indexOf(SYNTAX.rawClose, i + SYNTAX.rawOpen.length);
      const expr = src
        .slice(i + SYNTAX.rawOpen.length, end === -1 ? undefined : end)
        .trim();
      tokens.push({ type: TokenType.RawExpression, value: expr });
      i = end === -1 ? src.length : end + SYNTAX.rawClose.length;
      continue;
    }
    if (src.startsWith(SYNTAX.open, i)) {
      flush();
      const end = src.indexOf(SYNTAX.close, i + SYNTAX.open.length);
      const content = src
        .slice(i + SYNTAX.open.length, end === -1 ? undefined : end)
        .trim();
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

function buildTree(tokens: readonly Token[]): AbstractNode[] {
  const root: AbstractNode[] = [];
  const stack: Frame[] = [{ children: root, ifNode: null }];
  const push = (node: AbstractNode): void => {
    stack[stack.length - 1].children.push(node);
  };

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
          const els: AbstractNode[] = [];
          (top.ifNode as Mutable<IfNode>).els = els;
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
        const _exhaustive: never = tok.type; // exhaustive guard
        void _exhaustive;
      }
    }
  }
  return root;
}

// ===================== Generic Template Store =====================

export class TemplateStore<T extends Identifiable> implements Iterable<T> {
  private readonly _items = new Map<string, T>();
  private _count = 0;

  get size(): number {
    return this._items.size;
  }
  get count(): number {
    return this._count;
  }
  add(item: T): this {
    if (!this._items.has(item.id)) this._count++;
    this._items.set(item.id, item);
    return this;
  }
  get(id: string): T | undefined {
    return this._items.get(id);
  }
  has(id: string): boolean {
    return this._items.has(id);
  }
  remove(id: string): boolean {
    const r = this._items.delete(id);
    if (r) this._count--;
    return r;
  }
  clear(): void {
    this._items.clear();
    this._count = 0;
  }
  [Symbol.iterator](): Iterator<T> {
    return this._items.values()[Symbol.iterator]();
  }
  *values(): IterableIterator<T> {
    for (const v of this._items.values()) yield v;
  }
  toArray(): T[] {
    return Array.from(this._items.values());
  }
}

// ===================== Template Engine =====================

export class TemplateEngine {
  private readonly _helpers = new Map<string, HelperFn>();
  private readonly _filters = new Map<string, FilterFn>();
  private readonly _partials = new TemplateStore<PartialEntry>();
  private _maxDepth = 100;
  readonly [ENGINE_VERSION]: string = "1.0.0";

  get maxDepth(): number {
    return this._maxDepth;
  }
  set maxDepth(v: number) {
    if (v < 1 || !Number.isFinite(v)) {
      throw new TemplateError(
        "maxDepth must be a positive finite number",
        ErrorCode.InvalidSyntax,
      );
    }
    this._maxDepth = Math.floor(v);
  }
  get partialCount(): number {
    return this._partials.size;
  }
  get version(): string {
    return this[ENGINE_VERSION];
  }

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    const builtinFilters = {
      upper: (v: unknown) => String(v).toUpperCase(),
      lower: (v: unknown) => String(v).toLowerCase(),
      trim: (v: unknown) => String(v).trim(),
      length: (v: unknown) => (Array.isArray(v) ? v.length : String(v).length),
      default: (v: unknown, d: unknown) =>
        v === null || v === undefined || v === "" ? d : v,
      json: (v: unknown) => JSON.stringify(v),
      reverse: (v: unknown) => String(v).split("").reverse().join(""),
    } satisfies Record<FilterName, FilterFn>;
    const entries = Object.entries(builtinFilters) as Array<[string, FilterFn]>;
    for (const [name, fn] of entries) this._filters.set(name, fn);
    void BUILTIN_FILTER_NAMES;
    this._helpers.set("upper", (s: unknown) => String(s).toUpperCase());
    this._helpers.set("concat", (...args: unknown[]) =>
      args.map(String).join(""),
    );
    this._helpers.set("ifEqual", (a: unknown, b: unknown) =>
      a == b ? "true" : "false",
    ); // eslint-disable-line eqeqeq
  }

  // Function overloads: register a built-in filter name or arbitrary string.
  registerFilter(name: FilterName, fn: FilterFn): this;
  registerFilter(name: string, fn: FilterFn): this;
  registerFilter(name: string, fn: FilterFn): this {
    this._filters.set(name, fn);
    return this;
  }

  registerHelper(name: string, fn: HelperFn): this {
    this._helpers.set(name, fn);
    return this;
  }

  registerPartial(name: string, template: string): this {
    const ast = buildTree(tokenize(template));
    this._partials.add({ id: name, ast, source: template });
    return this;
  }

  hasPartial(name: string): boolean {
    return this._partials.has(name);
  }

  compile(
    template: string,
    options?: CompileOptions,
  ): (data: Record<string, unknown>) => string {
    const ast = buildTree(tokenize(template));
    const maxDepth = options?.maxDepth ?? this._maxDepth;
    const ctx: EvalContext = {
      data: {},
      helpers: this._helpers,
      filters: this._filters,
      partials: this._partials,
      depth: 0,
      maxDepth,
    };
    return (data: Record<string, unknown>): string =>
      renderNodes(ast, { ...ctx, data });
  }

  render(
    template: string,
    data: Record<string, unknown>,
    options?: CompileOptions,
  ): string {
    return this.compile(template, options)(data);
  }

  /** Walk every node in a compiled template (inspection / tooling). */
  *walk(template: string): IterableIterator<AbstractNode> {
    yield* walkAll(buildTree(tokenize(template)));
  }
}

export type { TemplateSyntax, VarExpression, DirectiveStart, BlockClose };

// ===================== CLI 演示 =====================

function showExamples(): void {
  console.log("===== 模板引擎示例 =====\n");
  const engine = new TemplateEngine();
  engine.registerPartial("greeting", "你好, {{name}}!");
  engine.registerHelper("repeat", (s: unknown, n: unknown) =>
    String(s).repeat(Number(n)),
  );

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

  const data: RenderData = {
    name: "<script>x</script>张三",
    email: "zhangsan@test.com",
    rawHtml: "<b>原始 HTML</b>",
    missing: "",
    items: [
      { name: "苹果", price: 5 },
      { name: "香蕉", price: 3 },
      { name: "橙子", price: 4 },
    ],
    user: { isAdmin: true },
  };
  console.log("--- 模板 ---");
  console.log(tpl);
  console.log("--- 渲染结果 ---");
  console.log(engine.render(tpl, data));

  // Demonstrate the generator walk + type guards.
  const nodes = Array.from(engine.walk(tpl));
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    const key = isIfNode(n)
      ? "if"
      : isForNode(n)
        ? "for"
        : isIncludeNode(n)
          ? "include"
          : isBlockNode(n)
            ? "block"
            : isVarNode(n)
              ? "var"
              : isTextNode(n)
                ? "text"
                : "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log(`--- 节点统计 (共 ${nodes.length} 个) ---`, counts);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "render": {
      const tpl = process.argv[3];
      const jsonFile = process.argv[4];
      if (!tpl || !jsonFile) {
        console.log("用法: render <模板文件或字符串> <data.json>");
        return;
      }
      const engine = new TemplateEngine();
      let templateStr = tpl;
      const resolved = path.resolve(tpl);
      if (fs.existsSync(resolved))
        templateStr = fs.readFileSync(resolved, "utf8");
      const data = JSON.parse(fs.readFileSync(path.resolve(jsonFile), "utf8"));
      try {
        console.log(engine.render(templateStr, data));
      } catch (e: unknown) {
        if (isTemplateError(e)) console.error(`[${e.code}] ${e.message}`);
        else throw e;
      }
      break;
    }
    case "compile": {
      const tpl = process.argv[3];
      const oFlag = process.argv.indexOf("-o");
      if (!tpl) {
        console.log("用法: compile <模板文件> [-o outfile]");
        return;
      }
      const engine = new TemplateEngine();
      const src = fs.readFileSync(path.resolve(tpl), "utf8");
      const fn = engine.compile(src);
      const outPath =
        oFlag >= 0
          ? process.argv[oFlag + 1]
          : path.join(process.cwd(), "compiled.js");
      const code = `// 预编译模板，由简单模板引擎生成
// 使用: const fn = require('./compiled.js'); fn(data);
module.exports = ${fn.toString()};\n`;
      fs.writeFileSync(outPath, code, "utf8");
      console.log(`已预编译并输出到 ${outPath}`);
      break;
    }
    case "examples":
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
