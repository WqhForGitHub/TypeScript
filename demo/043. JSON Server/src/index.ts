#!/usr/bin/env node
/**
 * 43. JSON Server (Enhanced)
 * 加载 JSON 文件作为内存数据库，对外提供 RESTful CRUD API。
 * 增强版使用了多种高级 TypeScript 特性。
 *
 *   GET    /resource                列表 (?limit&offset&filter)
 *   GET    /resource/:id            单条
 *   POST   /resource                新建 (自增 ID)
 *   PUT    /resource/:id            全量更新
 *   PATCH  /resource/:id            部分更新
 *   DELETE /resource/:id            删除
 *
 * 选项: --port <n> | --file <path> | --watch
 * 仅使用 Node.js 内置模块。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";

// ============== 枚举 ==============

enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  PATCH = "PATCH",
  DELETE = "DELETE",
  OPTIONS = "OPTIONS",
}

enum Operation {
  Create = "CREATE",
  ReadOne = "READ_ONE",
  List = "LIST",
  Update = "UPDATE",
  Delete = "DELETE",
}

enum ContentType {
  JSON = "application/json; charset=utf-8",
  TEXT = "text/plain; charset=utf-8",
}

enum StatusCode {
  OK = 200,
  Created = 201,
  NoContent = 204,
  BadRequest = 400,
  NotFound = 404,
  MethodNotAllowed = 405,
  Conflict = 409,
  InternalError = 500,
}

enum QueryParam {
  Limit = "limit",
  Offset = "offset",
}

// ============== 接口 ==============

interface Resource {
  id: number;
  [key: string]: unknown;
}
interface Database {
  [resource: string]: Resource[];
}
interface ServerOptions {
  readonly port: number;
  readonly file: string;
  readonly watch: boolean;
}
interface ParsedArgs {
  readonly options: ServerOptions;
  readonly help: boolean;
}
interface ListResult {
  readonly data: readonly Resource[];
  readonly total: number;
  readonly limit: number | null;
  readonly offset: number;
}
interface StoreMeta {
  createdAt: Date;
  lastModified: Date;
  operationCount: number;
}

// ============== 符号 ==============

const STORE_META: unique symbol = Symbol("storeMeta");

// ============== 可辨识联合 ==============

interface CreateOp {
  readonly type: "create";
  readonly resource: string;
  readonly data: Record<string, unknown>;
}
interface ReadOneOp {
  readonly type: "readOne";
  readonly resource: string;
  readonly id: string;
}
interface ListOp {
  readonly type: "list";
  readonly resource: string;
  readonly search: URLSearchParams;
}
interface UpdateOp {
  readonly type: "update";
  readonly resource: string;
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly full: boolean;
}
interface DeleteOp {
  readonly type: "delete";
  readonly resource: string;
  readonly id: string;
}
type CrudOp = CreateOp | ReadOneOp | ListOp | UpdateOp | DeleteOp;

// ============== 映射类型 / 条件类型 / 模板字面量 ==============

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type CreatableResource = Omit<Resource, "id">;
type ResourceId = Pick<Resource, "id">;
type StoreEntry = readonly [string, AbstractStore<Resource>];
type ExtractData<O> = O extends { data: infer D } ? D : never;
type IsListOp<O> = O extends ListOp ? true : false;
type ResourcePath = `/${string}`;
type ResourceIdPath = `/${string}/${string | number}`;
type EndpointLabel = `${string}-endpoint`;

// ============== 类型守卫 ==============

const VALID_METHODS = new Set<string>(Object.values(HttpMethod));

function isHttpMethod(value: string): value is HttpMethod {
  return VALID_METHODS.has(value);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isResource(value: unknown): value is Resource {
  return isObject(value) && typeof value.id === "number";
}
function isDatabase(value: unknown): value is Database {
  if (!isObject(value)) return false;
  return Object.values(value).every((v) => Array.isArray(v));
}
function isCrudOp(value: unknown): value is CrudOp {
  if (!isObject(value)) return false;
  const t = value.type;
  return (
    t === "create" ||
    t === "readOne" ||
    t === "list" ||
    t === "update" ||
    t === "delete"
  );
}

// ============== 自定义错误层级 ==============

abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly status: StatusCode;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toJSON(): { error: string; message: string; status: StatusCode } {
    return { error: this.code, message: this.message, status: this.status };
  }
}
class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly status = StatusCode.NotFound;
}
class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly status = StatusCode.BadRequest;
}
class MethodNotAllowedError extends AppError {
  readonly code = "METHOD_NOT_ALLOWED";
  readonly status = StatusCode.MethodNotAllowed;
}
class InternalError extends AppError {
  readonly code = "INTERNAL_ERROR";
  readonly status = StatusCode.InternalError;
}

// ============== as const 与 satisfies ==============

const ALLOWED_METHODS_HEADER = "GET,POST,PUT,PATCH,DELETE,OPTIONS" as const;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": ALLOWED_METHODS_HEADER,
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const DEFAULT_DB = {
  posts: [
    { id: 1, title: "欢迎使用 JSON Server", author: "demo", views: 0 },
    { id: 2, title: "TypeScript 入门", author: "demo", views: 10 },
    { id: 3, title: "REST API 设计", author: "demo", views: 5 },
  ],
  users: [
    { id: 1, name: "张三", age: 28 },
    { id: 2, name: "李四", age: 34 },
  ],
  comments: [
    { id: 1, postId: 1, body: "很好用！" },
    { id: 2, postId: 1, body: "谢谢分享" },
  ],
} satisfies Database;

// ============== Logger ==============

interface ILogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  req(method: string, url: string, status: number): void;
}
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
    const c = status < 300 ? 32 : status < 400 ? 36 : status < 500 ? 33 : 31;
    console.log(
      `${new Date().toISOString()} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${c}m${status}\x1b[0m`,
    );
  },
} satisfies ILogger;

// ============== 抽象存储类（泛型 + 约束 + 生成器 + getter/setter） ==============

abstract class AbstractStore<T extends Resource> {
  protected items: T[];
  protected [STORE_META]: StoreMeta;

  constructor(items: T[] = []) {
    this.items = items;
    this[STORE_META] = {
      createdAt: new Date(),
      lastModified: new Date(),
      operationCount: 0,
    };
  }

  abstract persist(): void;
  abstract reload(): void;

  get count(): number {
    return this.items.length;
  }
  get meta(): Readonly<StoreMeta> {
    return this[STORE_META];
  }
  set data(items: T[]) {
    this.items = items;
    this.touch();
  }

  protected touch(): void {
    const m = this[STORE_META];
    m.lastModified = new Date();
    m.operationCount++;
  }

  getAll(): readonly T[] {
    return this.items;
  }
  getById(id: string): T | undefined {
    return this.items.find((i) => String(i.id) === id);
  }

  create(data: CreatableResource): T {
    const maxId = this.items.reduce((max, i) => Math.max(max, i.id), 0);
    const newId: ResourceId = { id: maxId + 1 };
    const newItem = { ...data, ...newId } as T;
    this.items.push(newItem);
    this.touch();
    this.persist();
    return newItem;
  }

  update(id: string, data: Partial<T>, full: boolean): T | undefined {
    const idx = this.items.findIndex((i) => String(i.id) === id);
    if (idx === -1) return undefined;
    const existing = this.items[idx];
    const updated = full
      ? ({ ...data, id: existing.id } as T)
      : ({ ...existing, ...data, id: existing.id } as T);
    this.items[idx] = updated;
    this.touch();
    this.persist();
    return updated;
  }

  remove(id: string): T | undefined {
    const idx = this.items.findIndex((i) => String(i.id) === id);
    if (idx === -1) return undefined;
    const [removed] = this.items.splice(idx, 1);
    this.touch();
    this.persist();
    return removed;
  }

  *iterate(): Generator<T, void, undefined> {
    for (const item of this.items) yield item;
  }
  [Symbol.iterator](): Iterator<T> {
    return this.iterate();
  }
}

// ============== JSON 文件存储（具体子类） ==============

class JsonStore extends AbstractStore<Resource> {
  constructor(
    items: Resource[],
    private readonly filePath: string,
    private readonly onSave: () => void,
  ) {
    super(items);
  }
  persist(): void {
    this.onSave();
  }
  reload(): void {
    /* 由 DatabaseManager 统一处理 */
  }
}

// ============== 内存存储（具体子类） ==============

class MemoryStore extends AbstractStore<Resource> {
  persist(): void {
    /* 无操作 */
  }
  reload(): void {
    /* 无操作 */
  }
}

// ============== 数据库管理器 ==============

class DatabaseManager {
  private stores = new Map<string, JsonStore>();
  private saveTimer: NodeJS.Timeout | null = null;
  private _file: string;

  constructor(file: string) {
    this._file = file;
  }
  get file(): string {
    return this._file;
  }
  set file(value: string) {
    this._file = path.resolve(value);
  }
  get resourceNames(): string[] {
    return Array.from(this.stores.keys());
  }
  hasResource(name: string): boolean {
    return this.stores.has(name);
  }
  getStore(name: string): JsonStore | undefined {
    return this.stores.get(name);
  }

  *storesIter(): Generator<StoreEntry> {
    for (const entry of this.stores) yield entry as StoreEntry;
  }

  load(): void {
    try {
      if (!fs.existsSync(this._file)) {
        const cloned = JSON.parse(JSON.stringify(DEFAULT_DB)) as Database;
        fs.writeFileSync(this._file, JSON.stringify(cloned, null, 2), "utf8");
        Logger.info(`未发现数据库文件，已创建默认数据库: ${this._file}`);
        this.buildStores(cloned);
        return;
      }
      const raw = fs.readFileSync(this._file, "utf8");
      const data = JSON.parse(raw);
      if (!isDatabase(data))
        throw new ValidationError("数据库根节点必须是对象且值为数组");
      Logger.info(`数据库已加载: ${this._file}`);
      this.buildStores(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`加载数据库失败: ${msg}，使用默认数据`);
      this.buildStores(JSON.parse(JSON.stringify(DEFAULT_DB)) as Database);
    }
  }

  private buildStores(db: Database): void {
    this.stores.clear();
    for (const [name, items] of Object.entries(db)) {
      this.stores.set(
        name,
        new JsonStore(items, this._file, () => this.scheduleSave()),
      );
    }
  }

  save(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const db: Database = {};
      for (const [name, store] of this.stores) db[name] = [...store.getAll()];
      fs.writeFileSync(this._file, JSON.stringify(db, null, 2), "utf8");
      Logger.info(`数据库已保存到 ${this._file}`);
    } catch (err) {
      Logger.error(
        `保存数据库失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  reloadFromFile(): void {
    try {
      const raw = fs.readFileSync(this._file, "utf8");
      const data = JSON.parse(raw);
      if (isDatabase(data)) {
        this.buildStores(data);
        Logger.info("数据库重新加载完成");
      }
    } catch (err) {
      Logger.error(
        `重载失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  overview(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, store] of this.stores) result[name] = store.count;
    return result;
  }
}

let dbManager: DatabaseManager;

// ============== 命令行参数解析（函数重载） ==============

function parseArgs(argv: string[]): ParsedArgs;
function parseArgs(
  argv: string[],
  defaults: Partial<ServerOptions>,
): ParsedArgs;
function parseArgs(
  argv: string[],
  defaults?: Partial<ServerOptions>,
): ParsedArgs {
  const args = argv.slice(2);
  let port = defaults?.port ?? 4000;
  let file = defaults?.file ?? path.resolve(process.cwd(), "db.json");
  let watch = defaults?.watch ?? false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case "--port":
        if (value) {
          const p = parseInt(value, 10);
          if (!Number.isNaN(p) && p > 0 && p < 65536) {
            port = p;
            i++;
          }
        }
        break;
      case "--file":
        if (value) {
          file = path.resolve(value);
          i++;
        }
        break;
      case "--watch":
        watch = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        break;
    }
  }
  return { options: { port, file, watch }, help };
}

function printHelp(): void {
  console.log(`
JSON Server - 模拟 REST API

用法: json-server [--port <n>] [--file <path>] [--watch]

选项:
  --port <n>      监听端口 (默认 4000)
  --file <path>   JSON 数据库文件 (默认 ./db.json)
  --watch         监听源文件变更，自动重载数据库
  -h, --help      显示帮助

API:
  GET    /<resource>                  列表 (?limit&offset&<field>=<value>)
  GET    /<resource>/:id              单条
  POST   /<resource>                  新建
  PUT    /<resource>/:id              全量更新
  PATCH  /<resource>/:id              部分更新
  DELETE /<resource>/:id              删除
  GET    /                            数据库总览
`);
}

// ============== 路径解析（只读元组） ==============

function parsePath(pathname: string): readonly [string, string | null] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return ["", null] as const;
  if (parts.length === 1) return [decodeURIComponent(parts[0]), null] as const;
  return [decodeURIComponent(parts[0]), decodeURIComponent(parts[1])] as const;
}

// ============== JSON 响应（函数重载） ==============

function sendJson(res: http.ServerResponse, data: unknown): void;
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status: StatusCode,
): void;
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status: StatusCode = StatusCode.OK,
): void {
  const buf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": ContentType.JSON,
    "Content-Length": buf.length,
    ...CORS_HEADERS,
  });
  res.end(buf);
}

// ============== 读取请求体 ==============

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const limit = 10 * 1024 * 1024;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        reject(new ValidationError("请求体过大"));
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
        reject(new ValidationError("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ============== 列表过滤与分页 ==============

function listResource(
  collection: readonly Resource[],
  search: URLSearchParams,
): ListResult {
  let result: Resource[] = collection.slice();
  const filterKeys = Array.from(search.keys()).filter(
    (k) => k !== QueryParam.Limit && k !== QueryParam.Offset,
  );
  for (const key of filterKeys) {
    const expected = search.get(key);
    if (expected === null) continue;
    result = result.filter((item) => {
      const val = item[key];
      return val !== undefined && String(val) === expected;
    });
  }
  const total = result.length;
  let limit: number | null = null;
  let offset = 0;
  if (search.has(QueryParam.Limit)) {
    const l = parseInt(search.get(QueryParam.Limit) ?? "0", 10);
    if (!Number.isNaN(l) && l >= 0) limit = l;
  }
  if (search.has(QueryParam.Offset)) {
    const o = parseInt(search.get(QueryParam.Offset) ?? "0", 10);
    if (!Number.isNaN(o) && o >= 0) offset = o;
  }
  if (limit !== null) result = result.slice(offset, offset + limit);
  else if (offset > 0) result = result.slice(offset);
  return { data: result, total, limit, offset };
}

// ============== 构建操作（返回可辨识联合 CrudOp） ==============

function buildOp(
  method: string,
  resource: string,
  idStr: string | null,
  search: URLSearchParams,
  body: Record<string, unknown> | undefined,
): CrudOp {
  switch (method) {
    case HttpMethod.GET:
      if (idStr === null) return { type: "list", resource, search };
      return { type: "readOne", resource, id: idStr };
    case HttpMethod.POST:
      if (idStr !== null) throw new MethodNotAllowedError("POST 不支持指定 ID");
      if (!body) throw new ValidationError("缺少请求体");
      return { type: "create", resource, data: body };
    case HttpMethod.PUT:
      if (idStr === null) throw new MethodNotAllowedError("PUT 需要指定 ID");
      if (!body) throw new ValidationError("缺少请求体");
      return { type: "update", resource, id: idStr, data: body, full: true };
    case HttpMethod.PATCH:
      if (idStr === null) throw new MethodNotAllowedError("PATCH 需要指定 ID");
      if (!body) throw new ValidationError("缺少请求体");
      return { type: "update", resource, id: idStr, data: body, full: false };
    case HttpMethod.DELETE:
      if (idStr === null) throw new MethodNotAllowedError("DELETE 需要指定 ID");
      return { type: "delete", resource, id: idStr };
    default:
      throw new MethodNotAllowedError(`不支持的方法: ${method}`);
  }
}

// ============== 操作执行（可辨识联合 + 穷尽检查） ==============

interface OpResult {
  readonly status: StatusCode;
  readonly body: unknown;
}

function executeOp(store: AbstractStore<Resource>, op: CrudOp): OpResult {
  switch (op.type) {
    case "create":
      return { status: StatusCode.Created, body: store.create(op.data) };
    case "readOne": {
      const item = store.getById(op.id);
      if (!item) throw new NotFoundError(`资源 ${op.id} 未找到`);
      return { status: StatusCode.OK, body: item };
    }
    case "list": {
      const r = listResource(store.getAll(), op.search);
      return {
        status: StatusCode.OK,
        body: {
          data: r.data,
          total: r.total,
          limit: r.limit,
          offset: r.offset,
          count: r.data.length,
        },
      };
    }
    case "update": {
      const item = store.update(op.id, op.data, op.full);
      if (!item) throw new NotFoundError(`资源 ${op.id} 未找到`);
      return { status: StatusCode.OK, body: item };
    }
    case "delete": {
      const item = store.remove(op.id);
      if (!item) throw new NotFoundError(`资源 ${op.id} 未找到`);
      return { status: StatusCode.OK, body: { success: true, deleted: item } };
    }
    default: {
      const _exhaustive: never = op;
      throw new InternalError(`未知操作: ${String(_exhaustive)}`);
    }
  }
}

// ============== 请求处理 ==============

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions,
): Promise<void> {
  const method = req.method ?? HttpMethod.GET;
  const fullUrl = req.url ?? "/";
  const urlObj = new URL(fullUrl, `http://localhost:${options.port}`);
  const pathname = urlObj.pathname;

  if (method === HttpMethod.OPTIONS) {
    res.writeHead(StatusCode.NoContent, { ...CORS_HEADERS });
    res.end();
    return;
  }

  if (pathname === "/" && method === HttpMethod.GET) {
    sendJson(res, {
      message: "JSON Server 正在运行",
      resources: dbManager.resourceNames,
      counts: dbManager.overview(),
      endpoints: dbManager.resourceNames.map((k) => `/${k}` as EndpointLabel),
    });
    return;
  }

  const [resource, idStr] = parsePath(pathname);

  if (!resource || !dbManager.hasResource(resource)) {
    sendJson(
      res,
      { error: "资源不存在", resource, available: dbManager.resourceNames },
      StatusCode.NotFound,
    );
    return;
  }

  const store = dbManager.getStore(resource)!;

  let body: Record<string, unknown> | undefined;
  if (
    method === HttpMethod.POST ||
    method === HttpMethod.PUT ||
    method === HttpMethod.PATCH
  ) {
    const raw = await readJsonBody(req);
    if (!isObject(raw)) {
      sendJson(
        res,
        { error: "VALIDATION_ERROR", message: "请求体必须是对象" },
        StatusCode.BadRequest,
      );
      return;
    }
    body = raw;
  }

  try {
    const op = buildOp(method, resource, idStr, urlObj.searchParams, body);
    if (!isCrudOp(op)) throw new InternalError("操作构建异常");
    const result = executeOp(store, op);
    sendJson(res, result.body, result.status);
  } catch (err) {
    if (err instanceof AppError) sendJson(res, err.toJSON(), err.status);
    else throw err;
  }
}

// ============== 启动服务器 ==============

function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const method = req.method ?? HttpMethod.GET;
    const url = req.url ?? "/";
    handleRequest(req, res, options).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`处理失败: ${msg}`);
      if (!res.headersSent)
        sendJson(
          res,
          { error: "INTERNAL_ERROR", message: msg },
          StatusCode.InternalError,
        );
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
    Logger.info(`JSON Server 运行于 http://localhost:${options.port}`);
    Logger.info(`数据库文件: ${options.file}`);
    Logger.info(`可用资源: ${dbManager.resourceNames.join(", ")}`);
    if (options.watch) Logger.info("已开启 --watch，源文件变更将自动重载");
  });

  return server;
}

// ============== 监听数据库文件变化 ==============

function watchDatabaseFile(options: ServerOptions): void {
  try {
    fs.watchFile(options.file, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      Logger.warn("检测到数据库文件外部变更，重新加载...");
      dbManager.reloadFromFile();
    });
  } catch (err) {
    Logger.warn(
      `无法监听文件: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ============== 主函数 ==============

function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }

  dbManager = new DatabaseManager(parsed.options.file);
  dbManager.load();

  // 演示 MemoryStore 与生成器迭代
  const mem = new MemoryStore([
    { id: 1, label: "demo-a" },
    { id: 2, label: "demo-b" },
  ]);
  Logger.info(
    `MemoryStore 演示迭代: ${[...mem].map((i) => String(i.label)).join(", ")}`,
  );

  const server = startServer(parsed.options);
  if (parsed.options.watch) watchDatabaseFile(parsed.options);

  const shutdown = (sig: string): void => {
    Logger.warn(`收到 ${sig}，正在保存并关闭...`);
    dbManager.save();
    server.close(() => {
      Logger.info("服务器已退出");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
