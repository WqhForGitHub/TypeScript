#!/usr/bin/env node
/**
 * 49. Todo Web 应用 (Enhanced Edition)
 * 完整的 Todo CRUD Web 应用 (增强版)：HTML UI + REST API + JSON 持久化
 * 新增：优先级/分类/排序、抽象存储层级、泛型仓库、判别联合、错误层级、生成器、Symbol
 * 命令: start [-p port] [-d datafile]   仅使用 Node.js 内置模块。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";

// === 1. 字符串枚举 (String Enums) ===
enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  OPTIONS = "OPTIONS",
}
enum ContentType {
  JSON = "application/json; charset=utf-8",
  HTML = "text/html; charset=utf-8",
  TEXT = "text/plain; charset=utf-8",
}
enum TodoFilter {
  All = "all",
  Active = "active",
  Completed = "completed",
}
enum TodoPriority {
  Low = "low",
  Medium = "medium",
  High = "high",
  Urgent = "urgent",
}
enum TodoCategory {
  General = "general",
  Work = "work",
  Personal = "personal",
  Study = "study",
}

// === 2. 数字枚举 (Regular Enums) ===
enum StatusCode {
  OK = 200,
  Created = 201,
  NoContent = 204,
  BadRequest = 400,
  NotFound = 404,
  Conflict = 409,
  InternalError = 500,
}
enum SortOrder {
  DateAsc = "date-asc",
  DateDesc = "date-desc",
  PriorityAsc = "priority-asc",
  PriorityDesc = "priority-desc",
  TitleAsc = "title-asc",
  TitleDesc = "title-desc",
}

// === 3. 模板字面量类型 / 只读元组 / as const ===
type ApiBase = `/api/todos`;
type ApiIdPath = `/api/todos/${number}`;
type ApiPath = ApiBase | ApiIdPath;
type PriorityRank = readonly [TodoPriority, number];

const PRIORITY_RANKS = [
  [TodoPriority.Low, 1],
  [TodoPriority.Medium, 2],
  [TodoPriority.High, 3],
  [TodoPriority.Urgent, 4],
] as const satisfies readonly PriorityRank[];

const PRIORITY_RANK_MAP: Record<TodoPriority, number> = PRIORITY_RANKS.reduce(
  (acc, [p, r]) => {
    acc[p] = r;
    return acc;
  },
  {} as Record<TodoPriority, number>,
);

const SERVER_DEFAULTS = { port: 3000, host: "localhost" } as const;

// === 4. Symbol 唯一属性键 ===
const SYM_METADATA = Symbol("metadata");
const SYM_ORIGINAL = Symbol("original");

// === 5. 接口 (可选 / 只读 / 索引签名 / Symbol 键) ===
interface Todo {
  readonly id: number;
  title: string;
  completed: boolean;
  priority: TodoPriority;
  category: TodoCategory;
  readonly createdAt: string;
  updatedAt: string;
  [SYM_METADATA]?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}
interface TodoInput {
  title: string;
  priority?: TodoPriority;
  category?: TodoCategory;
}
interface ServerOptions {
  readonly port: number;
  readonly dataFile: string;
}
interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}
interface LoggerShape {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  req(method: string, url: string, status: number): void;
}

// === 6. 映射类型 (Partial / Pick / Omit / -readonly) ===
type TodoUpdate = Partial<
  Pick<Todo, "title" | "completed" | "priority" | "category" | "updatedAt">
>;
type MutableTodo = { -readonly [K in keyof Todo]: Todo[K] };
type TodoSummary = Pick<
  Todo,
  "id" | "title" | "completed" | "priority" | "category"
>;
type TodoCreateData = Omit<Todo, "id" | "createdAt" | "updatedAt">;

// === 7. 条件类型 (Conditional Types) ===
type UnwrapTodo<T> = T extends Todo ? Todo : never;
type IsListRequest<R> = R extends { type: "list" } ? true : false;
type ResponseBody<R extends ApiRequest> = R extends { type: "list" }
  ? Todo[]
  : R extends { type: "create" | "update" }
    ? Todo
    : R extends { type: "delete" }
      ? { deleted: Todo }
      : R extends { type: "clear" }
        ? { count: number }
        : never;

// === 8. 判别联合 (Discriminated Unions) ===
type ApiRequest =
  | { type: "list"; filter: TodoFilter; sort?: SortOrder }
  | { type: "create"; input: TodoInput }
  | { type: "update"; id: number; patch: TodoUpdate }
  | { type: "delete"; id: number }
  | { type: "clear"; completedOnly: boolean };

type ApiResponse =
  | { type: "list"; todos: Todo[] }
  | { type: "todo"; todo: Todo }
  | { type: "deleted"; todo: Todo }
  | { type: "cleared"; count: number }
  | { type: "error"; code: StatusCode; message: string };

// === 9. 自定义错误层级 (Custom Error Hierarchy, 含 code) ===
abstract class AppError extends Error {
  abstract readonly code: StatusCode;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toJSON(): { error: string; code: StatusCode } {
    return { error: this.message, code: this.code };
  }
}
class NotFoundError extends AppError {
  readonly code = StatusCode.NotFound;
}
class ValidationError extends AppError {
  readonly code = StatusCode.BadRequest;
}
class InternalError extends AppError {
  readonly code = StatusCode.InternalError;
}

// === 10. 类型守卫 (Type Guards) ===
const enumValues = <T extends string>(e: object) => Object.values(e) as T[];
const isTodoPriority = (v: unknown): v is TodoPriority =>
  typeof v === "string" &&
  enumValues<TodoPriority>(TodoPriority).includes(v as TodoPriority);
const isTodoCategory = (v: unknown): v is TodoCategory =>
  typeof v === "string" &&
  enumValues<TodoCategory>(TodoCategory).includes(v as TodoCategory);
const isSortOrder = (v: unknown): v is SortOrder =>
  typeof v === "string" &&
  enumValues<SortOrder>(SortOrder).includes(v as SortOrder);
const isTodoFilter = (v: unknown): v is TodoFilter =>
  typeof v === "string" &&
  enumValues<TodoFilter>(TodoFilter).includes(v as TodoFilter);
function isTodo(x: unknown): x is Todo {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "number" &&
    typeof o.title === "string" &&
    typeof o.completed === "boolean" &&
    isTodoPriority(o.priority) &&
    isTodoCategory(o.category)
  );
}

// === 11. Logger (使用 satisfies) ===
const Logger = {
  info(msg: string): void {
    console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  },
  warn(msg: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  },
  error(msg: string): void {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  },
  req(method: string, url: string, status: number): void {
    const color =
      status < 300 ? 32 : status < 400 ? 36 : status < 500 ? 33 : 31;
    console.log(
      `${new Date().toISOString()} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${color}m${status}\x1b[0m`,
    );
  },
} satisfies LoggerShape;

// === 12. 抽象存储类层级 (AbstractStore<T extends {id:number}> + JsonTodoStore) ===
abstract class AbstractStore<T extends { id: number }> implements Iterable<T> {
  protected items: T[] = [];
  protected abstract load(): void;
  protected abstract persist(): void;
  get count(): number {
    return this.items.length;
  }
  all(): readonly T[] {
    return this.items.slice() as readonly T[];
  }
  find(id: number): T | undefined {
    return this.items.find((t) => t.id === id);
  }
  add(item: T): void {
    this.items.push(item);
    this.persist();
  }
  update(id: number, patch: Partial<T>): T | undefined {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    this.items[idx] = { ...this.items[idx], ...patch };
    this.persist();
    return this.items[idx];
  }
  remove(id: number): T | undefined {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const [removed] = this.items.splice(idx, 1);
    this.persist();
    return removed;
  }
  clear(pred?: (t: T) => boolean): number {
    const before = this.items.length;
    this.items = pred ? this.items.filter((t) => !pred(t)) : [];
    this.persist();
    return before - this.items.length;
  }
  abstract [Symbol.iterator](): Iterator<T>;
}

class JsonTodoStore extends AbstractStore<Todo> {
  private _nextId = 1;
  private _saveTimer: NodeJS.Timeout | null = null;
  constructor(private readonly file: string) {
    super();
    this.load();
  }
  get nextId(): number {
    return this._nextId;
  }
  set nextId(v: number) {
    this._nextId = v > 0 ? v : 1;
  }

  protected load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (Array.isArray(data)) {
          this.items = data.filter(isTodo) as Todo[];
          this._nextId = this.items.reduce((m, t) => Math.max(m, t.id), 0) + 1;
        }
      } else {
        const now = new Date().toISOString();
        this.items = [
          {
            id: 1,
            title: "学习 TypeScript",
            completed: true,
            priority: TodoPriority.High,
            category: TodoCategory.Study,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 2,
            title: "完成 Demo 49",
            completed: false,
            priority: TodoPriority.Urgent,
            category: TodoCategory.Work,
            createdAt: now,
            updatedAt: now,
          },
        ];
        this._nextId = 3;
        this.persistNow();
      }
    } catch (err) {
      Logger.warn(
        "数据加载失败: " +
          (err instanceof Error ? err.message : String(err)) +
          "，使用空数据",
      );
      this.items = [];
      this._nextId = 1;
    }
  }
  protected persist(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.persistNow(), 300);
  }
  persistNow(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2), "utf8");
    } catch (err) {
      Logger.error(
        "保存失败: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  flush(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.persistNow();
  }
  // 生成器: 默认迭代器
  *[Symbol.iterator](): Generator<Todo> {
    for (const t of this.items) yield t;
  }
  *byPriority(p: TodoPriority): Generator<Todo> {
    for (const t of this.items) if (t.priority === p) yield t;
  }
  *byCategory(c: TodoCategory): Generator<Todo> {
    for (const t of this.items) if (t.category === c) yield t;
  }
  *filter(pred: (t: Todo) => boolean): Generator<Todo> {
    for (const t of this.items) if (pred(t)) yield t;
  }
}

// 泛型仓库 (带函数重载)
class TodoRepository<T extends { id: number }> {
  constructor(protected readonly store: AbstractStore<T>) {}
  query(): readonly T[];
  query<K extends keyof T>(key: K, value: T[K]): readonly T[];
  query(pred: (x: T) => boolean): readonly T[];
  query(
    predOrKey?: ((x: T) => boolean) | keyof T,
    value?: T[keyof T],
  ): readonly T[] {
    const all = this.store.all();
    if (predOrKey === undefined) return all;
    if (typeof predOrKey === "function") return all.filter(predOrKey);
    return all.filter((x) => x[predOrKey] === value);
  }
  get(id: number): T | undefined {
    return this.store.find(id);
  }
  get count(): number {
    return this.store.count;
  }
}

// === 13. 过滤 / 排序工具函数 ===
function filterTodos(todos: readonly Todo[], filter: TodoFilter): Todo[] {
  switch (filter) {
    case TodoFilter.All:
      return todos.slice();
    case TodoFilter.Active:
      return todos.filter((t) => !t.completed);
    case TodoFilter.Completed:
      return todos.filter((t) => t.completed);
  }
}
function sortTodos(todos: readonly Todo[], order: SortOrder): Todo[] {
  const a = todos.slice();
  switch (order) {
    case SortOrder.DateAsc:
      return a.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    case SortOrder.DateDesc:
      return a.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    case SortOrder.PriorityAsc:
      return a.sort(
        (x, y) => PRIORITY_RANK_MAP[x.priority] - PRIORITY_RANK_MAP[y.priority],
      );
    case SortOrder.PriorityDesc:
      return a.sort(
        (x, y) => PRIORITY_RANK_MAP[y.priority] - PRIORITY_RANK_MAP[x.priority],
      );
    case SortOrder.TitleAsc:
      return a.sort((x, y) => x.title.localeCompare(y.title));
    case SortOrder.TitleDesc:
      return a.sort((x, y) => y.title.localeCompare(x.title));
  }
}

// === 14. 请求派发 (判别联合) ===
function dispatchRequest(store: JsonTodoStore, req: ApiRequest): ApiResponse {
  switch (req.type) {
    case "list": {
      const filtered = filterTodos(store.all(), req.filter);
      const sorted = req.sort ? sortTodos(filtered, req.sort) : filtered;
      return { type: "list", todos: sorted };
    }
    case "create": {
      const title = req.input.title.trim();
      if (!title)
        return {
          type: "error",
          code: StatusCode.BadRequest,
          message: "title 不能为空",
        };
      const now = new Date().toISOString();
      const todo: Todo = {
        id: store.nextId,
        title: title.slice(0, 200),
        completed: false,
        priority: req.input.priority ?? TodoPriority.Medium,
        category: req.input.category ?? TodoCategory.General,
        createdAt: now,
        updatedAt: now,
        [SYM_METADATA]: { createdVia: "api" as const },
        [SYM_ORIGINAL]: null,
      };
      store.add(todo);
      store.nextId = store.nextId + 1;
      return { type: "todo", todo };
    }
    case "update": {
      if (!store.find(req.id))
        return { type: "error", code: StatusCode.NotFound, message: "未找到" };
      const patch: Partial<Todo> = {
        ...req.patch,
        updatedAt: new Date().toISOString(),
      };
      const updated = store.update(req.id, patch);
      return updated
        ? { type: "todo", todo: updated }
        : {
            type: "error",
            code: StatusCode.InternalError,
            message: "更新失败",
          };
    }
    case "delete": {
      const removed = store.remove(req.id);
      return removed
        ? { type: "deleted", todo: removed }
        : { type: "error", code: StatusCode.NotFound, message: "未找到" };
    }
    case "clear": {
      const count = req.completedOnly
        ? store.clear((t) => t.completed)
        : store.clear();
      return { type: "cleared", count };
    }
  }
}

// === 15. 命令行解析 (函数重载) ===
function getArgValue(args: string[], flag: string): string | undefined;
function getArgValue(
  args: string[],
  flag: string,
  defaultValue: string,
): string;
function getArgValue(
  args: string[],
  flag: string,
  defaultValue?: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  return args[idx + 1];
}
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let port: number = SERVER_DEFAULTS.port;
  let dataFile = path.resolve(process.cwd(), "todos.json");
  let help = false;
  const build = (): ParsedArgs => ({
    command: "start",
    options: { port, dataFile },
    help,
  });
  if (args.length === 0) return build();
  if (args[0] === "-h" || args[0] === "--help") {
    help = true;
    return build();
  }
  if (args[0] === "start") args.shift();
  const portStr = getArgValue(args, "-p") ?? getArgValue(args, "--port");
  if (portStr !== undefined) {
    const p = parseInt(portStr, 10);
    if (!Number.isNaN(p) && p > 0 && p < 65536) port = p;
  }
  const dataStr = getArgValue(args, "-d") ?? getArgValue(args, "--data");
  if (dataStr) dataFile = path.resolve(dataStr);
  if (args.includes("-h") || args.includes("--help")) help = true;
  return build();
}
function printHelp(): void {
  console.log(`
Todo Web 应用 (增强版) - 使用说明

用法:  todo-web-app start [-p port] [-d datafile]

选项:
  start            启动服务器 (默认命令)
  -p, --port <n>   监听端口 (默认 3000)
  -d, --data <f>   数据文件路径 (默认 ./todos.json)
  -h, --help       显示帮助

API:
  GET    /api/todos            获取所有 (?filter=all|active|completed&sort=...)
  POST   /api/todos            新建 (body: { title, priority?, category? })
  PUT    /api/todos/:id        更新 (body: { title?, completed?, priority?, category? })
  DELETE /api/todos/:id        删除
  DELETE /api/todos            清空所有 (?completed=true 仅清已完成)

页面:  GET /  →  Todo 应用 HTML
`);
}

// === 16. HTTP 工具 ===
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} satisfies Record<string, string>;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > 1 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("非法 JSON"));
      }
    });
    req.on("error", reject);
  });
}
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status: StatusCode = StatusCode.OK,
): void {
  const buf = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": ContentType.JSON,
    "Content-Length": buf.length,
    ...CORS_HEADERS,
  });
  res.end(buf);
}
function sendHtml(res: http.ServerResponse, html: string): void {
  const buf = Buffer.from(html, "utf8");
  res.writeHead(StatusCode.OK, {
    "Content-Type": ContentType.HTML,
    "Content-Length": buf.length,
  });
  res.end(buf);
}
function sendError(res: http.ServerResponse, err: AppError | Error): void {
  if (err instanceof AppError) sendJson(res, err.toJSON(), err.code);
  else sendJson(res, { error: err.message }, StatusCode.InternalError);
}

// === 17. HTML 页面 (内联 CSS + JS) ===
function todoPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Todo 应用</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; color: #333; }
    .container { max-width: 620px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); overflow: hidden; }
    header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 24px; text-align: center; }
    header h1 { font-size: 28px; margin-bottom: 4px; } header .sub { opacity: 0.85; font-size: 13px; }
    .input-row { display: flex; padding: 16px; border-bottom: 1px solid #eee; gap: 8px; flex-wrap: wrap; }
    input[type="text"] { flex: 1; min-width: 160px; padding: 12px 14px; border: 2px solid #ddd; border-radius: 8px; font-size: 15px; transition: border 0.2s; }
    input[type="text"]:focus { outline: none; border-color: #667eea; }
    select { padding: 12px 10px; border: 2px solid #ddd; border-radius: 8px; font-size: 14px; background: #fff; }
    button { background: #667eea; color: #fff; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background 0.2s; }
    button:hover { background: #5568d3; }
    .filters { display: flex; padding: 12px 16px; gap: 8px; border-bottom: 1px solid #eee; flex-wrap: wrap; align-items: center; }
    .filters button { background: #ecf0f1; color: #555; padding: 6px 14px; font-size: 13px; } .filters button.active { background: #667eea; color: #fff; }
    .filters select { padding: 6px 10px; font-size: 13px; }
    .list { list-style: none; max-height: 480px; overflow-y: auto; }
    .list li { display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid #f5f5f5; transition: background 0.15s; gap: 10px; }
    .list li:hover { background: #f9f9f9; }
    .list li .checkbox { width: 22px; height: 22px; border: 2px solid #ddd; border-radius: 50%; cursor: pointer; flex-shrink: 0; position: relative; transition: all 0.2s; }
    .list li .checkbox.checked { background: #2ecc71; border-color: #2ecc71; }
    .list li .checkbox.checked::after { content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .list li .title { flex: 1; font-size: 15px; word-break: break-all; } .list li.completed .title { color: #aaa; text-decoration: line-through; }
    .list li .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; color: #fff; }
    .badge.low { background: #95a5a6; } .badge.medium { background: #3498db; } .badge.high { background: #e67e22; } .badge.urgent { background: #e74c3c; }
    .list li .delete { background: transparent; color: #e74c3c; padding: 4px 8px; font-size: 18px; opacity: 0; transition: opacity 0.2s; }
    .list li:hover .delete { opacity: 0.7; } .list li .delete:hover { opacity: 1; }
    .empty { padding: 40px; text-align: center; color: #aaa; }
    footer { padding: 12px 16px; background: #f8f9fa; color: #888; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
    footer .clear { background: transparent; color: #e74c3c; padding: 4px 8px; font-size: 12px; } footer .clear:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header><h1>Todo 应用</h1><div class="sub">TypeScript Demo 49 - 完整 CRUD + 优先级/分类/排序</div></header>
    <div class="input-row">
      <input type="text" id="newTodo" placeholder="添加一个新任务..." maxlength="200" />
      <select id="newPriority"><option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option><option value="urgent">紧急</option></select>
      <select id="newCategory"><option value="general" selected>通用</option><option value="work">工作</option><option value="personal">个人</option><option value="study">学习</option></select>
      <button id="addBtn">添加</button>
    </div>
    <div class="filters">
      <button class="active" data-filter="all">全部</button>
      <button data-filter="active">未完成</button>
      <button data-filter="completed">已完成</button>
      <select id="sortSelect"><option value="date-desc">日期 ↓</option><option value="date-asc">日期 ↑</option><option value="priority-desc">优先级 ↓</option><option value="priority-asc">优先级 ↑</option><option value="title-asc">标题 ↑</option><option value="title-desc">标题 ↓</option></select>
    </div>
    <ul class="list" id="list"></ul>
    <footer><span id="count">0 项任务</span><button class="clear" id="clearBtn">清除已完成</button></footer>
  </div>
  <script>
    let currentFilter = 'all', currentSort = 'date-desc';
    const listEl = document.getElementById('list'), inputEl = document.getElementById('newTodo');
    const prioEl = document.getElementById('newPriority'), catEl = document.getElementById('newCategory');
    const sortEl = document.getElementById('sortSelect'), addBtn = document.getElementById('addBtn');
    const countEl = document.getElementById('count'), clearBtn = document.getElementById('clearBtn');
    const filterBtns = document.querySelectorAll('.filters button[data-filter]');
    async function api(method, url, body) {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }
    async function load() { render(await api('GET', '/api/todos?filter=' + currentFilter + '&sort=' + currentSort)); }
    function badge(p) { const m = { low:'低', medium:'中', high:'高', urgent:'紧急' }; return '<span class="badge ' + p + '">' + (m[p]||p) + '</span>'; }
    function render(items) {
      listEl.innerHTML = '';
      if (!items || items.length === 0) { listEl.innerHTML = '<li class="empty">暂无任务</li>'; }
      else for (const t of items) {
        const li = document.createElement('li');
        if (t.completed) li.classList.add('completed');
        li.innerHTML = '<div class="checkbox ' + (t.completed ? 'checked' : '') + '"></div><div class="title"></div>' + badge(t.priority) + '<button class="delete">x</button>';
        li.querySelector('.title').textContent = t.title;
        li.querySelector('.checkbox').onclick = () => toggle(t);
        li.querySelector('.delete').onclick = () => remove(t.id);
        listEl.appendChild(li);
      }
      updateCount();
    }
    async function updateCount() {
      const all = await api('GET', '/api/todos?filter=all');
      countEl.textContent = all.filter((t) => !t.completed).length + ' 项未完成 / 共 ' + all.length + ' 项';
    }
    async function add() {
      const title = inputEl.value.trim(); if (!title) return;
      await api('POST', '/api/todos', { title, priority: prioEl.value, category: catEl.value });
      inputEl.value = ''; load();
    }
    async function toggle(t) { await api('PUT', '/api/todos/' + t.id, { completed: !t.completed }); load(); }
    async function remove(id) { await api('DELETE', '/api/todos/' + id); load(); }
    async function clearCompleted() { await api('DELETE', '/api/todos?completed=true'); load(); }
    addBtn.onclick = add;
    inputEl.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    clearBtn.onclick = clearCompleted;
    sortEl.onchange = () => { currentSort = sortEl.value; load(); };
    filterBtns.forEach((btn) => { btn.onclick = () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active'); currentFilter = btn.dataset.filter; load();
    }; });
    load();
  </script>
</body>
</html>`;
}

// === 18. API 路由 ===
async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  search: URLSearchParams,
  store: JsonTodoStore,
): Promise<boolean> {
  if (!pathname.startsWith("/api/todos")) return false;
  const isCollection = pathname === "/api/todos" || pathname === "/api/todos/";
  const idMatch = pathname.match(/^\/api\/todos\/(\d+)$/);

  if (method === HttpMethod.GET && isCollection) {
    const filter = isTodoFilter(search.get("filter"))
      ? (search.get("filter") as TodoFilter)
      : TodoFilter.All;
    const sort = isSortOrder(search.get("sort"))
      ? (search.get("sort") as SortOrder)
      : undefined;
    const resp = dispatchRequest(store, { type: "list", filter, sort });
    if (resp.type === "list") sendJson(res, resp.todos);
    else if (resp.type === "error")
      sendJson(res, { error: resp.message }, resp.code);
    return true;
  }
  if (method === HttpMethod.POST && isCollection) {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const input: TodoInput = {
      title: typeof body.title === "string" ? body.title.trim() : "",
      priority: isTodoPriority(body.priority) ? body.priority : undefined,
      category: isTodoCategory(body.category) ? body.category : undefined,
    };
    const resp = dispatchRequest(store, { type: "create", input });
    if (resp.type === "todo") sendJson(res, resp.todo, StatusCode.Created);
    else if (resp.type === "error")
      sendJson(res, { error: resp.message }, resp.code);
    return true;
  }
  if (method === HttpMethod.PUT && idMatch) {
    const id = parseInt(idMatch[1], 10);
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const patch: TodoUpdate = {};
    if (typeof body.title === "string") {
      const nt = body.title.trim();
      if (nt) patch.title = nt.slice(0, 200);
    }
    if (typeof body.completed === "boolean") patch.completed = body.completed;
    if (isTodoPriority(body.priority)) patch.priority = body.priority;
    if (isTodoCategory(body.category)) patch.category = body.category;
    const resp = dispatchRequest(store, { type: "update", id, patch });
    if (resp.type === "todo") sendJson(res, resp.todo);
    else if (resp.type === "error")
      sendJson(res, { error: resp.message }, resp.code);
    return true;
  }
  if (method === HttpMethod.DELETE && idMatch) {
    const resp = dispatchRequest(store, {
      type: "delete",
      id: parseInt(idMatch[1], 10),
    });
    if (resp.type === "deleted")
      sendJson(res, { success: true, deleted: resp.todo });
    else if (resp.type === "error")
      sendJson(res, { error: resp.message }, resp.code);
    return true;
  }
  if (method === HttpMethod.DELETE && isCollection) {
    const resp = dispatchRequest(store, {
      type: "clear",
      completedOnly: search.get("completed") === "true",
    });
    if (resp.type === "cleared")
      sendJson(res, { success: true, count: resp.count });
    else if (resp.type === "error")
      sendJson(res, { error: resp.message }, resp.code);
    return true;
  }
  sendJson(res, { error: "未找到" }, StatusCode.NotFound);
  return true;
}

// === 19. 请求处理 ===
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions,
  store: JsonTodoStore,
): Promise<void> {
  const method = req.method ?? HttpMethod.GET;
  const url = req.url ?? "/";
  const urlObj = new URL(url, `http://${SERVER_DEFAULTS.host}:${options.port}`);
  const pathname = urlObj.pathname;

  if (method === HttpMethod.OPTIONS) {
    res.writeHead(StatusCode.NoContent, CORS_HEADERS);
    res.end();
    return;
  }
  if (pathname.startsWith("/api/")) {
    try {
      const handled = await handleApi(
        req,
        res,
        pathname,
        method,
        urlObj.searchParams,
        store,
      );
      if (!handled) sendJson(res, { error: "未找到" }, StatusCode.NotFound);
    } catch (err) {
      const e = err instanceof Error ? err : new InternalError(String(err));
      Logger.error("API 错误: " + e.message);
      sendError(res, e);
    }
    return;
  }
  if (
    method === HttpMethod.GET &&
    (pathname === "/" || pathname === "/index.html")
  ) {
    sendHtml(res, todoPage());
    return;
  }
  res.writeHead(StatusCode.NotFound, { "Content-Type": ContentType.TEXT });
  res.end("未找到");
}

// === 20. 启动服务器 ===
function startServer(options: ServerOptions): {
  server: http.Server;
  store: JsonTodoStore;
} {
  const store = new JsonTodoStore(options.dataFile);
  const repo = new TodoRepository(store);
  // 演示：生成器遍历 + 仓库查询 + 函数重载
  Logger.info(`初始任务数: ${repo.count}`);
  for (const t of store) Logger.info(`  #${t.id} [${t.priority}] ${t.title}`);
  const allViaRepo = repo.query();
  const urgent = repo.query("priority", TodoPriority.Urgent);
  Logger.info(`仓库查询: 共 ${allViaRepo.length} 项, 紧急 ${urgent.length} 项`);
  const urgentGen = [...store.byPriority(TodoPriority.Urgent)];
  if (urgentGen.length > 0)
    Logger.info(`生成器: 紧急任务 ${urgentGen.length} 项`);

  const server = http.createServer((req, res) => {
    const method = req.method ?? HttpMethod.GET;
    const url = req.url ?? "/";
    handleRequest(req, res, options, store).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error("处理失败: " + msg);
      if (!res.headersSent)
        sendJson(res, { error: msg }, StatusCode.InternalError);
    });
    res.on("finish", () => Logger.req(method, url, res.statusCode));
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE")
      Logger.error(`端口 ${options.port} 已被占用`);
    else Logger.error(err.message);
    process.exit(1);
  });
  server.listen(options.port, () => {
    Logger.info(
      `Todo Web 应用运行于 http://${SERVER_DEFAULTS.host}:${options.port}`,
    );
    Logger.info(`数据文件: ${options.dataFile}`);
  });
  return { server, store };
}

// === 21. 主函数 ===
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }
  const { server, store } = startServer(parsed.options);
  const shutdown = (sig: string) => {
    Logger.warn(`收到 ${sig}，保存并关闭...`);
    store.flush();
    server.close(() => {
      Logger.info("已退出");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
