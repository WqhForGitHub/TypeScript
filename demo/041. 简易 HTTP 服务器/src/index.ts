#!/usr/bin/env node
/**
 * 41. 简易 HTTP 服务器 (增强版 - Advanced TypeScript Features)
 * 仅使用 Node.js 内置模块。展示枚举、泛型、判别联合、映射/条件类型、
 * 模板字面量类型、抽象类、函数重载、自定义错误层次、迭代器/生成器、
 * Symbol、satisfies、as const、类型守卫、元组等高级特性。
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { URL } from "url";

// --- 字符串枚举 ---
enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
}
enum ContentType {
  JSON = "application/json; charset=utf-8",
  HTML = "text/html; charset=utf-8",
  TEXT = "text/plain; charset=utf-8",
}
enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

// --- 常规枚举（非 const enum，支持 Object.values）---
enum HttpStatus {
  OK = 200,
  BAD_REQUEST = 400,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  PAYLOAD_TOO_LARGE = 413,
  INTERNAL_ERROR = 500,
}
enum RouteName {
  HOME = "/",
  TIME = "/time",
  ECHO = "/echo",
  API_STATUS = "/api/status",
  API_HEADERS = "/api/headers",
}

// --- 模板字面量类型 ---
type RoutePath = `/${string}`;

// --- 条件类型 & 映射类型 ---
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type Mutable<T> = { -readonly [K in keyof T]: T[K] }; // 移除 readonly
type DeepPartial<T> = { [K in keyof T]?: T[K] | undefined }; // 深度可选
type IsString<T> = T extends string ? true : false; // 条件类型
type StatusMessage<T extends HttpStatus> = T extends HttpStatus.OK
  ? "成功"
  : T extends HttpStatus.NOT_FOUND
    ? "未找到"
    : T extends HttpStatus.BAD_REQUEST
      ? "错误请求"
      : "错误";

// --- 工具类型别名（Pick / Omit / Partial / ReturnType / Readonly）---
type PublicServerOptions = Pick<ServerOptions, "port" | "root">;
type CoreOptions = Omit<ServerOptions, "maxBodyBytes">;
type StatsUpdate = Partial<ServerStats>;
type ParseResult = ReturnType<typeof parseArgs>;
type FrozenStats = Readonly<ServerStats>;

// --- 接口（含可选 / 只读 / 索引签名）---
interface ServerOptions {
  readonly port: number;
  readonly root: string;
  readonly maxBodyBytes?: number;
}
interface HeaderBag {
  readonly [key: string]: string | string[] | undefined;
}
interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}
interface RouteStat {
  readonly path: string;
  readonly hits: number;
}
interface ServerStats {
  readonly startedAt: Date;
  totalRequests: number;
  totalBytesSent: number;
  errors: number;
  routes: Record<string, number>;
}

// --- 元组 & 只读元组 ---
type StatusLine = readonly [code: number, message: string];
type MethodRoutePair = readonly [HttpMethod, RouteName];

// --- 判别联合：请求类型 ---
type SimpleRequest = { kind: "simple"; method: HttpMethod; pathname: string };
type BodyRequest = {
  kind: "body";
  method: HttpMethod;
  pathname: string;
  body: string;
  contentType: string;
};
type StreamRequest = {
  kind: "stream";
  method: HttpMethod;
  pathname: string;
  incoming: http.IncomingMessage;
};
type AppRequest = SimpleRequest | BodyRequest | StreamRequest;

// --- 自定义错误类层次结构（含 code 属性）---
abstract class HttpError extends Error {
  abstract readonly code: HttpStatus;
  readonly timestamp: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class NotFoundError extends HttpError {
  readonly code = HttpStatus.NOT_FOUND;
}
class BadRequestError extends HttpError {
  readonly code = HttpStatus.BAD_REQUEST;
}
class PayloadTooLargeError extends HttpError {
  readonly code = HttpStatus.PAYLOAD_TOO_LARGE;
}
class InternalError extends HttpError {
  readonly code = HttpStatus.INTERNAL_ERROR;
}
class MethodNotAllowedError extends HttpError {
  readonly code = HttpStatus.METHOD_NOT_ALLOWED;
  readonly allowed: readonly HttpMethod[];
  constructor(message: string, allowed: readonly HttpMethod[]) {
    super(message);
    this.allowed = allowed;
  }
}

// --- 类型守卫 ---
function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
function isJsonPrimitive(v: unknown): v is JsonPrimitive {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}
function isBodyRequest(req: AppRequest): req is BodyRequest {
  return req.kind === "body";
}

// --- 泛型容器（带约束）+ 迭代器/生成器 ---
class Container<T extends string> {
  private items: Map<T, number> = new Map();
  private _size = 0;
  get size(): number {
    return this._size;
  }
  add(key: T, count = 1): void {
    this.items.set(key, (this.items.get(key) ?? 0) + count);
    this._size++;
  }
  get(key: T): number {
    return this.items.get(key) ?? 0;
  }
  *entries(): IterableIterator<readonly [T, number]> {
    for (const [k, v] of this.items) {
      yield [k, v] as const;
    }
  }
  [Symbol.iterator](): Iterator<readonly [T, number]> {
    return this.entries();
  }
}

// --- 统计迭代器（生成器）---
class StatsIterator implements Iterable<readonly [string, number]> {
  constructor(private readonly stats: ServerStats) {}
  *[Symbol.iterator](): Iterator<readonly [string, number]> {
    yield ["totalRequests", this.stats.totalRequests] as const;
    yield ["totalBytesSent", this.stats.totalBytesSent] as const;
    yield ["errors", this.stats.errors] as const;
    for (const [route, count] of Object.entries(this.stats.routes)) {
      yield [route, count] as const;
    }
  }
}

// --- Symbol 作为唯一属性键 ---
const STATS_KEY = Symbol("stats");
const ROUTER_KEY = Symbol("router");

// --- 日志类（单例、getter/setter、Record<LogLevel, string>）---
class Logger {
  private _level: LogLevel = LogLevel.INFO;
  private static instance: Logger | null = null;
  static getInstance(): Logger {
    if (Logger.instance === null) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }
  get level(): LogLevel {
    return this._level;
  }
  set level(value: LogLevel) {
    this._level = value;
  }
  private shouldLog(level: LogLevel): boolean {
    const order: readonly LogLevel[] = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
    ];
    return order.indexOf(level) >= order.indexOf(this._level);
  }
  private format(level: LogLevel, msg: string): string {
    const colors: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: "\x1b[37m",
      [LogLevel.INFO]: "\x1b[36m",
      [LogLevel.WARN]: "\x1b[33m",
      [LogLevel.ERROR]: "\x1b[31m",
    };
    return `${new Date().toISOString()} ${colors[level]}[${level}]\x1b[0m ${msg}`;
  }
  debug(msg: string): void {
    if (this.shouldLog(LogLevel.DEBUG))
      console.log(this.format(LogLevel.DEBUG, msg));
  }
  info(msg: string): void {
    if (this.shouldLog(LogLevel.INFO))
      console.log(this.format(LogLevel.INFO, msg));
  }
  warn(msg: string): void {
    if (this.shouldLog(LogLevel.WARN))
      console.log(this.format(LogLevel.WARN, msg));
  }
  error(msg: string): void {
    if (this.shouldLog(LogLevel.ERROR))
      console.log(this.format(LogLevel.ERROR, msg));
  }
  request(method: string, url: string, status: number): void {
    const sc =
      status < 300 ? "32" : status < 400 ? "36" : status < 500 ? "33" : "31";
    console.log(
      `${new Date().toISOString()} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${sc}m${status}\x1b[0m`,
    );
  }
}
const logger = Logger.getInstance();

// --- 请求包装类 ---
class RequestWrapper {
  readonly method: HttpMethod;
  readonly pathname: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly query: URLSearchParams;
  readonly raw: http.IncomingMessage;
  private bodyCache: string | null = null;

  constructor(req: http.IncomingMessage, port: number) {
    this.raw = req;
    this.method = (req.method ?? "GET") as HttpMethod;
    const fullUrl = req.url ?? "/";
    this.url = fullUrl;
    const urlObj = new URL(fullUrl, `http://localhost:${port}`);
    this.pathname = urlObj.pathname;
    this.query = urlObj.searchParams;
    this.headers = req.headers;
  }
  get contentType(): string {
    return this.headers["content-type"] ?? "";
  }
  async readBody(maxBytes: number): Promise<string> {
    if (this.bodyCache !== null) return this.bodyCache;
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      this.raw.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          reject(new PayloadTooLargeError(`请求体超过 ${maxBytes} 字节限制`));
          this.raw.destroy();
          return;
        }
        chunks.push(chunk);
      });
      this.raw.on("end", () => {
        this.bodyCache = Buffer.concat(chunks).toString("utf8");
        resolve(this.bodyCache);
      });
      this.raw.on("error", reject);
    });
  }
  toAppRequest(body?: string): AppRequest {
    if (body !== undefined) {
      return {
        kind: "body",
        method: this.method,
        pathname: this.pathname,
        body,
        contentType: this.contentType,
      };
    }
    return { kind: "simple", method: this.method, pathname: this.pathname };
  }
}

// --- 响应包装类 ---
class ResponseWrapper {
  private sent = false;
  constructor(
    private readonly raw: http.ServerResponse,
    private readonly stats: ServerStats,
  ) {}
  get headersSent(): boolean {
    return this.raw.headersSent;
  }
  get statusCode(): number {
    return this.raw.statusCode;
  }
  sendJson(data: JsonValue, status: HttpStatus = HttpStatus.OK): void {
    if (this.sent) return;
    this.sent = true;
    const buf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    this.raw.writeHead(status, {
      "Content-Type": ContentType.JSON,
      "Content-Length": buf.length,
    });
    this.raw.end(buf);
    this.stats.totalBytesSent += buf.length;
  }
  sendHtml(html: string, status: HttpStatus = HttpStatus.OK): void {
    if (this.sent) return;
    this.sent = true;
    const buf = Buffer.from(html, "utf8");
    this.raw.writeHead(status, {
      "Content-Type": ContentType.HTML,
      "Content-Length": buf.length,
    });
    this.raw.end(buf);
    this.stats.totalBytesSent += buf.length;
  }
  sendError(err: HttpError): void {
    if (this.sent) return;
    this.sent = true;
    const headers: http.OutgoingHttpHeaders = {
      "Content-Type": ContentType.JSON,
    };
    if (err instanceof MethodNotAllowedError) {
      headers["Allow"] = err.allowed.join(", ");
    }
    const payload: JsonValue = {
      error: err.name,
      message: err.message,
      code: err.code,
      timestamp: err.timestamp,
    };
    const buf = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
    headers["Content-Length"] = buf.length;
    this.raw.writeHead(err.code, headers);
    this.raw.end(buf);
    this.stats.totalBytesSent += buf.length;
  }
}

// --- 请求上下文（使用 Symbol 属性键）---
class RequestContext {
  readonly req: RequestWrapper;
  readonly res: ResponseWrapper;
  readonly options: ServerOptions;
  readonly params: Record<string, string> = {};
  [STATS_KEY]: ServerStats;
  constructor(
    req: RequestWrapper,
    res: ResponseWrapper,
    options: ServerOptions,
    stats: ServerStats,
  ) {
    this.req = req;
    this.res = res;
    this.options = options;
    this[STATS_KEY] = stats;
  }
  json(data: JsonValue, status: HttpStatus = HttpStatus.OK): void {
    this.res.sendJson(data, status);
  }
  html(html: string, status: HttpStatus = HttpStatus.OK): void {
    this.res.sendHtml(html, status);
  }
}

// --- 抽象 Handler 类与具体子类 ---
abstract class Handler {
  abstract handle(ctx: RequestContext): void | Promise<void>;
}
class JsonHandler extends Handler {
  constructor(
    private readonly data: JsonValue,
    private readonly status: HttpStatus = HttpStatus.OK,
  ) {
    super();
  }
  async handle(ctx: RequestContext): Promise<void> {
    ctx.json(this.data, this.status);
  }
}
class HtmlHandler extends Handler {
  constructor(
    private readonly html: string,
    private readonly status: HttpStatus = HttpStatus.OK,
  ) {
    super();
  }
  async handle(ctx: RequestContext): Promise<void> {
    ctx.html(this.html, this.status);
  }
}
class CallbackHandler extends Handler {
  constructor(
    private readonly fn: (
      ctx: RequestContext,
    ) => JsonValue | Promise<JsonValue>,
  ) {
    super();
  }
  async handle(ctx: RequestContext): Promise<void> {
    ctx.json(await this.fn(ctx));
  }
}
class EchoHandler extends Handler {
  async handle(ctx: RequestContext): Promise<void> {
    const maxBytes = ctx.options.maxBodyBytes ?? 5 * 1024 * 1024;
    const body = await ctx.req.readBody(maxBytes);
    let parsed: JsonValue = body;
    if (ctx.req.contentType.includes("application/json")) {
      try {
        const obj: unknown = JSON.parse(body);
        if (isJsonPrimitive(obj) || typeof obj === "object") {
          parsed = obj as JsonValue;
        }
      } catch {
        parsed = body;
      }
    }
    ctx.json({
      method: ctx.req.method,
      url: ctx.req.url,
      headers: ctx.req.headers as unknown as JsonValue,
      body: parsed,
      receivedAt: new Date().toISOString(),
    });
  }
}
class HeadersHandler extends Handler {
  async handle(ctx: RequestContext): Promise<void> {
    ctx.json({
      headers: ctx.req.headers as unknown as JsonValue,
      method: ctx.req.method,
      url: ctx.req.url,
      httpVersion: ctx.req.raw.httpVersion,
    });
  }
}

// --- 中间件类型 ---
type NextFunction = () => Promise<void> | void;
interface Middleware {
  (ctx: RequestContext, next: NextFunction): Promise<void> | void;
}

// --- 路由器（泛型容器 + 生成器 + 类型安全注册）---
class Router {
  private routes: Map<string, Handler> = new Map();
  private middlewares: Middleware[] = [];
  private readonly counters: Container<string> = new Container();
  get routeCount(): number {
    return this.routes.size;
  }
  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }
  register(method: HttpMethod, route: RoutePath, handler: Handler): this {
    this.routes.set(`${method} ${route}`, handler);
    return this;
  }
  private find(method: HttpMethod, route: string): Handler | undefined {
    return this.routes.get(`${method} ${route}`);
  }
  private findAllowedMethods(route: string): HttpMethod[] {
    const allowed: HttpMethod[] = [];
    for (const key of this.routes.keys()) {
      const idx = key.indexOf(" ");
      if (key.slice(idx + 1) === route) {
        allowed.push(key.slice(0, idx) as HttpMethod);
      }
    }
    return allowed;
  }
  *routeEntries(): IterableIterator<readonly [string, Handler]> {
    for (const [key, handler] of this.routes) {
      yield [key, handler] as const;
    }
  }
  async dispatch(ctx: RequestContext): Promise<void> {
    const middlewares = this.middlewares;
    const handler = this.find(ctx.req.method, ctx.req.pathname);
    const execute = async (i: number): Promise<void> => {
      if (i < middlewares.length) {
        await middlewares[i](ctx, () => execute(i + 1));
      } else {
        if (ctx.res.headersSent) return;
        if (!handler) {
          const allowed = this.findAllowedMethods(ctx.req.pathname);
          if (allowed.length > 0) {
            throw new MethodNotAllowedError(
              `方法 ${ctx.req.method} 不允许用于 ${ctx.req.pathname}`,
              allowed,
            );
          }
          throw new NotFoundError(
            `路由 ${ctx.req.method} ${ctx.req.pathname} 不存在`,
          );
        }
        await handler.handle(ctx);
      }
    };
    await execute(0);
  }
}

// --- 全局统计 ---
const STATS: ServerStats = {
  startedAt: new Date(),
  totalRequests: 0,
  totalBytesSent: 0,
  errors: 0,
  routes: {},
};

// --- as const & satisfies ---
const DEFAULT_OPTIONS = {
  port: 3000,
  root: process.cwd(),
  maxBodyBytes: 5 * 1024 * 1024,
} as const satisfies ServerOptions;

const AVAILABLE_ROUTES = [
  [HttpMethod.GET, RouteName.HOME],
  [HttpMethod.GET, RouteName.TIME],
  [HttpMethod.POST, RouteName.ECHO],
  [HttpMethod.GET, RouteName.API_STATUS],
  [HttpMethod.GET, RouteName.API_HEADERS],
] as const satisfies readonly MethodRoutePair[];

// --- 函数重载：构建状态行 ---
function buildStatusLine(code: HttpStatus): StatusLine;
function buildStatusLine(code: HttpStatus, message: string): StatusLine;
function buildStatusLine(code: HttpStatus, message?: string): StatusLine {
  const messages: Partial<Record<HttpStatus, string>> = {
    [HttpStatus.OK]: "成功",
    [HttpStatus.BAD_REQUEST]: "错误请求",
    [HttpStatus.NOT_FOUND]: "未找到",
    [HttpStatus.METHOD_NOT_ALLOWED]: "方法不允许",
    [HttpStatus.PAYLOAD_TOO_LARGE]: "请求体过大",
    [HttpStatus.INTERNAL_ERROR]: "内部错误",
  };
  return [code, message ?? messages[code] ?? "未知"] as const;
}

// --- 生成器函数：遍历枚举状态码（演示 Object.values + 类型守卫）---
function* iterateStatuses(): Generator<HttpStatus> {
  for (const v of Object.values(HttpStatus)) {
    if (typeof v === "number") {
      yield v as HttpStatus;
    }
  }
}

// --- 函数重载：参数解析 ---
function parseArgs(argv: string[]): ParsedArgs;
function parseArgs(argv: string[], strict: boolean): ParsedArgs;
function parseArgs(argv: string[], strict = false): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "start",
    options: {
      port: DEFAULT_OPTIONS.port,
      root: DEFAULT_OPTIONS.root,
      maxBodyBytes: DEFAULT_OPTIONS.maxBodyBytes,
    },
    help: false,
  };
  if (args.length === 0) return result;
  if (args[0] === "--help" || args[0] === "-h") {
    result.help = true;
    return result;
  }
  if (args[0] === "start") {
    result.command = "start";
    args.shift();
  } else if (strict) {
    throw new BadRequestError(`未知命令: ${args[0]}`);
  }

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case "-p":
      case "--port": {
        const port = parseInt(value, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
          result.options = { ...result.options, port };
          i++;
        } else if (strict) {
          throw new BadRequestError(`无效端口: ${value}`);
        }
        break;
      }
      case "-r":
      case "--root": {
        if (value) {
          result.options = { ...result.options, root: path.resolve(value) };
          i++;
        }
        break;
      }
      case "--help":
      case "-h":
        result.help = true;
        break;
      default:
        break;
    }
  }
  return result;
}

// --- 帮助信息 ---
function printHelp(): void {
  console.log(`
简易 HTTP 服务器 (增强版) - 使用说明

用法:
  simple-http-server start [-p port] [-r root]
  simple-http-server --help

选项:
  start              启动 HTTP 服务器 (默认命令)
  -p, --port <n>     监听端口 (默认: 3000)
  -r, --root <dir>   根目录 (默认: 当前工作目录)
  -h, --help         显示帮助信息

路由:
  GET  /             服务器信息页面
  GET  /time         返回当前时间 (JSON)
  POST /echo         回显请求体
  GET  /api/status   服务器运行状态 (JSON)
  GET  /api/headers  返回请求头 (JSON)
`);
}

// --- 信息页面 ---
function infoPage(): string {
  const uptime = Math.floor((Date.now() - STATS.startedAt.getTime()) / 1000);
  const routeList = AVAILABLE_ROUTES.map(
    ([m, r]) => `    <li><code>${m} ${r}</code></li>`,
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>简易 HTTP 服务器</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
    ul { line-height: 1.8; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    .footer { margin-top: 40px; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>简易 HTTP 服务器</h1>
  <p>欢迎使用 TypeScript 编写的简易 HTTP 服务器。可用路由：</p>
  <ul>
${routeList}
  </ul>
  <p>已运行：<strong>${uptime}</strong> 秒</p>
  <div class="footer">Powered by Node.js ${process.version} - TypeScript Demo 41</div>
</body>
</html>`;
}

// --- 构建路由器（中间件 + 类型安全注册）---
function buildRouter(): Router {
  const router = new Router();
  // 中间件：请求计数
  router.use((ctx, next) => {
    STATS.totalRequests++;
    STATS.routes[ctx.req.pathname] = (STATS.routes[ctx.req.pathname] ?? 0) + 1;
    return next();
  });
  // 中间件：慢请求警告
  router.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;
    if (elapsed > 500) {
      logger.warn(
        `请求处理耗时 ${elapsed}ms: ${ctx.req.method} ${ctx.req.url}`,
      );
    }
  });
  // 注册路由（RoutePath 保证路径以 / 开头）
  router.register(HttpMethod.GET, "/", new HtmlHandler(infoPage()));
  router.register(
    HttpMethod.GET,
    "/time",
    new CallbackHandler(() => ({
      iso: new Date().toISOString(),
      local: new Date().toLocaleString("zh-CN"),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timestamp: Date.now(),
    })),
  );
  router.register(HttpMethod.POST, "/echo", new EchoHandler());
  router.register(
    HttpMethod.GET,
    "/api/status",
    new CallbackHandler(() => {
      const uptime = Date.now() - STATS.startedAt.getTime();
      return {
        status: "running",
        startedAt: STATS.startedAt.toISOString(),
        uptimeMs: uptime,
        uptimeSeconds: Math.floor(uptime / 1000),
        totalRequests: STATS.totalRequests,
        totalBytesSent: STATS.totalBytesSent,
        errors: STATS.errors,
        routeCounts: STATS.routes,
        knownStatusCodes: Array.from(iterateStatuses()),
        memory: process.memoryUsage() as unknown as JsonValue,
        cpus: os.cpus().length,
        platform: process.platform,
        nodeVersion: process.version,
      };
    }),
  );
  router.register(HttpMethod.GET, "/api/headers", new HeadersHandler());
  return router;
}

// --- 启动服务器 ---
function formatEndpoint(opts: PublicServerOptions): string {
  return `http://localhost:${opts.port}`;
}

function startServer(options: ServerOptions): http.Server {
  const router = buildRouter();
  logger.info(`已注册路由数: ${router.routeCount}`);

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const reqWrap = new RequestWrapper(req, options.port);
    const resWrap = new ResponseWrapper(res, STATS);
    const ctx = new RequestContext(reqWrap, resWrap, options, STATS);
    res.on("finish", () => {
      logger.request(method, url, res.statusCode);
    });
    router.dispatch(ctx).catch((err: unknown) => {
      STATS.errors++;
      if (isHttpError(err)) {
        logger.error(`${err.name}: ${err.message}`);
        if (!resWrap.headersSent) resWrap.sendError(err);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`未捕获异常: ${message}`);
        if (!resWrap.headersSent) {
          resWrap.sendJson(
            { error: "内部错误", message } as JsonValue,
            HttpStatus.INTERNAL_ERROR,
          );
        }
      }
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`端口 ${options.port} 已被占用`);
    } else {
      logger.error(`服务器错误: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(options.port, () => {
    logger.info(`服务器已启动: ${formatEndpoint(options)}`);
    logger.info(`根目录: ${options.root}`);
    logger.info("按 Ctrl+C 优雅关闭");
  });
  return server;
}

// --- 优雅关闭 ---
function setupGracefulShutdown(server: http.Server): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`收到 ${signal} 信号，正在关闭服务器...`);
    const iter = new StatsIterator(STATS);
    for (const [key, val] of iter) {
      logger.info(`统计 ${key} = ${val}`);
    }
    server.close(() => {
      logger.info("所有连接已关闭，服务器退出");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("强制退出（部分连接未关闭）");
      process.exit(1);
    }, 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error(`未捕获异常: ${err.message}`);
    STATS.errors++;
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`未处理的 Promise 拒绝: ${String(reason)}`);
  });
}

// --- 主函数 ---
function main(): void {
  const parsed: ParseResult = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }
  if (parsed.command !== "start") {
    printHelp();
    process.exit(1);
    return;
  }
  if (!fs.existsSync(parsed.options.root)) {
    logger.error(`根目录不存在: ${parsed.options.root}`);
    process.exit(1);
  }
  // 演示 buildStatusLine 重载与 StatusLine 元组
  const statusLine: StatusLine = buildStatusLine(HttpStatus.OK);
  logger.debug(`启动状态: ${statusLine[0]} - ${statusLine[1]}`);
  const server = startServer(parsed.options);
  setupGracefulShutdown(server);
}

main();
