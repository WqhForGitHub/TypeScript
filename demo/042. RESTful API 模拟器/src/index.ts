#!/usr/bin/env node

import * as http from "http";
import * as url from "url";

// ============================================================
// 1. String Enums (HTTP methods / status codes / content types)
// ============================================================

enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  PATCH = "PATCH",
  DELETE = "DELETE",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}

enum HttpStatus {
  OK = "200",
  CREATED = "201",
  NO_CONTENT = "204",
  BAD_REQUEST = "400",
  UNAUTHORIZED = "401",
  FORBIDDEN = "403",
  NOT_FOUND = "404",
  CONFLICT = "409",
  UNPROCESSABLE = "422",
  INTERNAL_ERROR = "500",
}

enum ContentType {
  JSON = "application/json; charset=utf-8",
  TEXT = "text/plain; charset=utf-8",
  HTML = "text/html; charset=utf-8",
}

// ============================================================
// 2. Regular Enums (route types / middleware types)
// ============================================================

enum RouteType {
  Static = "static",
  Param = "param",
  Resource = "resource",
  Wildcard = "wildcard",
}
enum MiddlewareType {
  Global = "global",
  Route = "route",
  Error = "error",
  Auth = "auth",
}

// ============================================================
// 3. Template Literal Types — 路由路径
// ============================================================

type RoutePath = `/${string}`;
type ResourcePath = `/api/${string}`;
type ParamPath<T extends string> = `${RoutePath}/:${T}`;

// ============================================================
// 4. Mapped / Conditional / Utility Types
// ============================================================

type Headers = Record<string, string>;
type RouteParams = Record<string, string>;
type QueryParams = Record<string, string>;

/** 移除只读修饰符的映射类型 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** 深层 Partial（条件类型 + 映射类型） */
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
/** 条件类型：根据方法推断是否需要请求体 */
type HasBody<M extends HttpMethod> = M extends
  HttpMethod.POST | HttpMethod.PUT | HttpMethod.PATCH
  ? true
  : false;
/** 提取路由参数名（递归条件类型） */
type ExtractParams<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractParams<`/${Rest}`>]: string }
    : P extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

// ============================================================
// 5. Discriminated Unions — 响应类型
// ============================================================

interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SuccessResponse<T> {
  readonly kind: "success";
  status: HttpStatus;
  data: T;
}
interface ErrorResponse {
  readonly kind: "error";
  status: HttpStatus;
  error: string;
  message: string;
  details?: readonly string[];
}
interface PaginatedResponse<T> {
  readonly kind: "paginated";
  status: HttpStatus;
  data: T[];
  pagination: PaginationMeta;
}
type ApiResponse<T> = SuccessResponse<T> | ErrorResponse | PaginatedResponse<T>;

// ============================================================
// 6. 接口（optional / readonly / index signatures） + tuples
// ============================================================

interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  headers: Headers;
  query: QueryParams;
  params: RouteParams;
  body: unknown;
  rawBody: string;
  [key: string]: unknown; // 索引签名
}

interface HttpResponse {
  statusCode: number;
  headers: Headers;
  body: unknown;
}

/** State 接口：同时支持 string 索引签名与 unique symbol 键 */
interface ContextState {
  [key: string]: unknown;
  [STATE_USER]?: {
    readonly name: string;
    readonly role: string;
    readonly token: string;
  } | null;
}

interface Context {
  request: HttpRequest;
  response: HttpResponse;
  state: ContextState;
}
interface MatchResult {
  matched: boolean;
  params: RouteParams;
}

type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;
type RouteHandler = (ctx: Context) => Promise<void> | void;

interface Route {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
  middlewares: Middleware[];
  type: RouteType;
}

/** 只读元组：[方法, 路径] */
type RouteSignature = readonly [HttpMethod, RoutePath];

// ============================================================
// 7. Symbols 作为唯一属性键
// ============================================================

const STATE_USER = Symbol("state.user");
const ROUTE_META = Symbol("route.meta");

// ============================================================
// 8. 自定义错误类层次结构（带 code 属性）
// ============================================================

abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly status: HttpStatus;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly status = HttpStatus.NOT_FOUND;
}
class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED";
  readonly status = HttpStatus.UNAUTHORIZED;
}
class BadRequestError extends AppError {
  readonly code = "BAD_REQUEST";
  readonly status = HttpStatus.BAD_REQUEST;
}
class ValidationError extends AppError {
  readonly code = "VALIDATION";
  readonly status = HttpStatus.UNPROCESSABLE;
  constructor(
    message: string,
    public readonly details: readonly string[],
  ) {
    super(message);
  }
}

// ============================================================
// 9. 类型守卫
// ============================================================

function isErrorResponse<T>(r: ApiResponse<T>): r is ErrorResponse {
  return r.kind === "error";
}
function isPaginatedResponse<T>(r: ApiResponse<T>): r is PaginatedResponse<T> {
  return r.kind === "paginated";
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ============================================================
// 10. 工具函数 + as const + satisfies
// ============================================================

const STATUS_MESSAGES = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
} as const satisfies Record<number, string>;

function parseQueryString(qs: string): QueryParams {
  const result: QueryParams = {};
  if (!qs) return result;
  const search = qs.startsWith("?") ? qs.slice(1) : qs;
  for (const pair of search.split("&")) {
    const [k, v] = pair.split("=");
    if (k) result[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
  }
  return result;
}

function compileRoutePattern(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, p: string) => {
    paramNames.push(p);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function matchRoute(pattern: string, actualPath: string): MatchResult {
  const { regex, paramNames } = compileRoutePattern(pattern);
  const m = actualPath.match(regex);
  if (!m) return { matched: false, params: {} };
  const params: RouteParams = {};
  paramNames.forEach((n, i) => (params[n] = m[i + 1]));
  return { matched: true, params };
}

/** 自增 ID 生成器，带 getter/setter + 生成器 + 迭代器 */
class AutoIncrementId {
  private _current = 0;
  get current(): number {
    return this._current;
  }
  set current(v: number) {
    if (v < 0) throw new BadRequestError("ID 不能为负");
    this._current = v;
  }
  next(): number {
    return ++this._current;
  }
  reset(): void {
    this._current = 0;
  }
  *take(n: number): Generator<number> {
    for (let i = 0; i < n; i++) yield this.next();
  }
  [Symbol.iterator](): Iterator<number> {
    let n = 0;
    return { next: () => ({ value: ++n, done: false }) };
  }
}

// ============================================================
// 11. 抽象类 AbstractMiddleware + 具体子类
// ============================================================

abstract class AbstractMiddleware {
  abstract readonly type: MiddlewareType;
  abstract handle(ctx: Context, next: () => Promise<void>): Promise<void>;
  toMiddleware(): Middleware {
    return (ctx, next) => this.handle(ctx, next);
  }
}

class LoggerMiddleware extends AbstractMiddleware {
  readonly type = MiddlewareType.Global;
  async handle(ctx: Context, next: () => Promise<void>): Promise<void> {
    const start = Date.now();
    console.log(
      `→ [${new Date().toISOString()}] ${ctx.request.method} ${ctx.request.path}`,
    );
    await next();
    const ms = Date.now() - start;
    ctx.response.headers["X-Response-Time"] = `${ms}ms`;
    console.log(
      `← ${ctx.request.method} ${ctx.request.path} ${ctx.response.statusCode} (${ms}ms)`,
    );
  }
}

class CorsMiddleware extends AbstractMiddleware {
  readonly type = MiddlewareType.Global;
  async handle(ctx: Context, next: () => Promise<void>): Promise<void> {
    ctx.response.headers["Access-Control-Allow-Origin"] = "*";
    ctx.response.headers["Access-Control-Allow-Methods"] =
      Object.values(HttpMethod).join(", ");
    ctx.response.headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization";
    if (ctx.request.method === HttpMethod.OPTIONS) {
      ctx.response.statusCode = 204;
      ctx.response.body = "";
      return;
    }
    await next();
  }
}

class AuthMiddleware extends AbstractMiddleware {
  readonly type = MiddlewareType.Auth;
  constructor(
    private readonly tokens: readonly string[] = ["secret-token", "demo-key"],
  ) {
    super();
  }
  async handle(ctx: Context, next: () => Promise<void>): Promise<void> {
    const header = ctx.request.headers["authorization"];
    if (!header || !header.startsWith("Bearer "))
      throw new UnauthorizedError("缺少或无效的 Authorization 头");
    const token = header.slice(7);
    if (!this.tokens.includes(token)) throw new UnauthorizedError("Token 无效");
    ctx.state[STATE_USER] = { name: "Admin", role: "admin", token } as const;
    await next();
  }
}

class TimingMiddleware extends AbstractMiddleware {
  readonly type = MiddlewareType.Global;
  async handle(ctx: Context, next: () => Promise<void>): Promise<void> {
    const start = process.hrtime.bigint();
    await next();
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    ctx.response.headers["X-Timing"] = ms.toFixed(3);
  }
}

// ============================================================
// 12. Router（函数重载 + 生成器 + 迭代器）
// ============================================================

class Router {
  private routes: Route[] = [];

  register(method: HttpMethod, path: RoutePath, handler: RouteHandler): void;
  register(
    method: HttpMethod,
    path: RoutePath,
    handler: RouteHandler,
    ...mws: Middleware[]
  ): void;
  register(
    method: HttpMethod,
    path: RoutePath,
    handler: RouteHandler,
    ...mws: Middleware[]
  ): void {
    this.routes.push({
      method,
      path,
      handler,
      middlewares: mws,
      type: RouteType.Param,
    });
  }

  get(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): void {
    this.register(HttpMethod.GET, path, h, ...mws);
  }
  post(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): void {
    this.register(HttpMethod.POST, path, h, ...mws);
  }
  put(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): void {
    this.register(HttpMethod.PUT, path, h, ...mws);
  }
  patch(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): void {
    this.register(HttpMethod.PATCH, path, h, ...mws);
  }
  delete(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): void {
    this.register(HttpMethod.DELETE, path, h, ...mws);
  }

  find(
    method: HttpMethod,
    path: string,
  ): { route: Route; params: RouteParams } | null {
    for (const route of this.routes) {
      const r = matchRoute(route.path, path);
      if (r.matched && route.method === method)
        return { route, params: r.params };
    }
    return null;
  }

  *signatures(): Generator<RouteSignature> {
    for (const r of this.routes) yield [r.method, r.path as RoutePath];
  }

  getRoutes(): ReadonlyArray<Readonly<Route>> {
    return this.routes;
  }

  [Symbol.iterator](): Iterator<Route> {
    let i = 0;
    const rs = this.routes;
    return {
      next: () =>
        i < rs.length
          ? { value: rs[i++], done: false }
          : { value: undefined, done: true },
    };
  }
}

// ============================================================
// 13. ResourceController 接口 + AbstractController 抽象类
// ============================================================

interface ResourceController<T = unknown> {
  index(ctx: Context): Promise<void> | void;
  show(ctx: Context): Promise<void> | void;
  create(ctx: Context): Promise<void> | void;
  update(ctx: Context): Promise<void> | void;
  destroy(ctx: Context): Promise<void> | void;
}

type ValidationResult = { valid: boolean; errors: string[] };
type Validator<T> = (data: unknown) => ValidationResult;

abstract class AbstractController<
  T extends object,
> implements ResourceController<T> {
  protected readonly store = new Map<number, T>();
  protected readonly idGen = new AutoIncrementId();

  constructor(
    protected readonly resourceName: string,
    protected readonly validator?: Validator<T>,
  ) {}

  abstract index(ctx: Context): Promise<void> | void;
  abstract show(ctx: Context): Promise<void> | void;
  abstract create(ctx: Context): Promise<void> | void;
  abstract update(ctx: Context): Promise<void> | void;
  abstract destroy(ctx: Context): Promise<void> | void;

  protected seedItems(items: readonly Omit<T, "id">[]): void {
    for (const it of items) {
      const id = this.idGen.next();
      this.store.set(id, { id, ...(it as object) } as T);
    }
  }

  getStore(): Map<number, T> {
    return this.store;
  }
  getIdGenerator(): AutoIncrementId {
    return this.idGen;
  }

  *[Symbol.iterator](): Generator<T> {
    for (const v of this.store.values()) yield v;
  }
}

// ============================================================
// 14. 通用 CRUD 控制器（继承 AbstractController）
// ============================================================

class CrudController<T extends object> extends AbstractController<T> {
  async index(ctx: Context): Promise<void> {
    const { page = "1", pageSize = "10", ...filters } = ctx.request.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.max(
      1,
      Math.min(100, parseInt(pageSize, 10) || 10),
    );
    let items = Array.from(this.store.values());
    for (const [k, v] of Object.entries(filters)) {
      items = items.filter(
        (it) =>
          String((it as Record<string, unknown>)[k]).toLowerCase() ===
          v.toLowerCase(),
      );
    }
    const total = items.length;
    const totalPages = Math.ceil(total / pageSizeNum);
    const start = (pageNum - 1) * pageSizeNum;
    const data = items.slice(start, start + pageSizeNum);
    const pagination: PaginationMeta = {
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages,
    };
    const resp: PaginatedResponse<T> = {
      kind: "paginated",
      status: HttpStatus.OK,
      data,
      pagination,
    };
    ctx.response.statusCode = 200;
    ctx.response.body = resp;
  }

  async show(ctx: Context): Promise<void> {
    const id = parseInt(ctx.request.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("ID 必须是数字");
    const item = this.store.get(id);
    if (!item) throw new NotFoundError(`${this.resourceName} #${id} 不存在`);
    const resp: SuccessResponse<T> = {
      kind: "success",
      status: HttpStatus.OK,
      data: item,
    };
    ctx.response.statusCode = 200;
    ctx.response.body = resp;
  }

  async create(ctx: Context): Promise<void> {
    if (!isObject(ctx.request.body))
      throw new BadRequestError("请求体必须是 JSON 对象");
    if (this.validator) {
      const r = this.validator(ctx.request.body);
      if (!r.valid) throw new ValidationError("数据验证失败", r.errors);
    }
    const id = this.idGen.next();
    const item = { id, ...(ctx.request.body as object) } as T;
    this.store.set(id, item);
    const resp: SuccessResponse<T> = {
      kind: "success",
      status: HttpStatus.CREATED,
      data: item,
    };
    ctx.response.statusCode = 201;
    ctx.response.body = resp;
  }

  async update(ctx: Context): Promise<void> {
    const id = parseInt(ctx.request.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("ID 必须是数字");
    if (!this.store.has(id))
      throw new NotFoundError(`${this.resourceName} #${id} 不存在`);
    if (!isObject(ctx.request.body))
      throw new BadRequestError("请求体必须是 JSON 对象");
    if (this.validator) {
      const r = this.validator(ctx.request.body);
      if (!r.valid) throw new ValidationError("数据验证失败", r.errors);
    }
    const updated = { id, ...(ctx.request.body as object) } as T;
    this.store.set(id, updated);
    const resp: SuccessResponse<T> = {
      kind: "success",
      status: HttpStatus.OK,
      data: updated,
    };
    ctx.response.statusCode = 200;
    ctx.response.body = resp;
  }

  async destroy(ctx: Context): Promise<void> {
    const id = parseInt(ctx.request.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("ID 必须是数字");
    if (!this.store.has(id))
      throw new NotFoundError(`${this.resourceName} #${id} 不存在`);
    this.store.delete(id);
    ctx.response.statusCode = 200;
    ctx.response.body = {
      kind: "success",
      status: HttpStatus.OK,
      data: { id, deleted: true },
    };
  }

  seed(items: readonly Omit<T, "id">[]): void {
    this.seedItems(items);
  }
}

// ============================================================
// 15. 领域模型：User / Post + 派生类型
// ============================================================

interface User {
  readonly id: number;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  createdAt: string;
}

interface Post {
  readonly id: number;
  title: string;
  content: string;
  authorId: number;
  tags: readonly string[];
  createdAt: string;
}

type UserCreateDTO = Omit<User, "id" | "createdAt">;
type UserUpdateDTO = Partial<UserCreateDTO>;
type UserPublicView = Pick<User, "id" | "name" | "role">;
type PostSummary = Pick<Post, "id" | "title" | "authorId">;

const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

function validateUser(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(data)) return { valid: false, errors: ["请求体必须是对象"] };
  if (typeof data.name !== "string" || data.name.trim().length < 2)
    errors.push("name 至少 2 个字符");
  if (typeof data.email !== "string" || !data.email.includes("@"))
    errors.push("email 无效");
  if (data.role !== undefined && !isRole(data.role))
    errors.push("role 必须是 admin/editor/viewer");
  return { valid: errors.length === 0, errors };
}

function validatePost(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(data)) return { valid: false, errors: ["请求体必须是对象"] };
  if (typeof data.title !== "string" || !data.title.trim())
    errors.push("title 不能为空");
  if (typeof data.content !== "string") errors.push("content 不能为空");
  if (data.authorId !== undefined && typeof data.authorId !== "number")
    errors.push("authorId 必须是数字");
  if (data.tags !== undefined && !Array.isArray(data.tags))
    errors.push("tags 必须是数组");
  return { valid: errors.length === 0, errors };
}

// ============================================================
// 16. Application 应用
// ============================================================

class Application {
  private readonly router = new Router();
  private readonly globalMiddlewares: Middleware[] = [];
  private server: http.Server | null = null;
  // 用 unique symbol 作为私有字段键
  private readonly [ROUTE_META]: Map<string, unknown> = new Map();

  use(mw: Middleware | AbstractMiddleware): this {
    const fn = mw instanceof AbstractMiddleware ? mw.toMiddleware() : mw;
    this.globalMiddlewares.push(fn);
    return this;
  }

  get(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): this {
    this.router.get(path, h, ...mws);
    return this;
  }
  post(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): this {
    this.router.post(path, h, ...mws);
    return this;
  }
  put(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): this {
    this.router.put(path, h, ...mws);
    return this;
  }
  patch(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): this {
    this.router.patch(path, h, ...mws);
    return this;
  }
  delete(path: RoutePath, h: RouteHandler, ...mws: Middleware[]): this {
    this.router.delete(path, h, ...mws);
    return this;
  }

  /** 泛型方法 + 约束：注册 RESTful 资源路由 */
  resource<T extends object>(
    basePath: ResourcePath,
    controller: AbstractController<T>,
  ): this {
    this.router.get(basePath, controller.index.bind(controller));
    this.router.get(
      `${basePath}/:id` as RoutePath,
      controller.show.bind(controller),
    );
    this.router.post(basePath, controller.create.bind(controller));
    this.router.put(
      `${basePath}/:id` as RoutePath,
      controller.update.bind(controller),
    );
    this.router.delete(
      `${basePath}/:id` as RoutePath,
      controller.destroy.bind(controller),
    );
    return this;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const parsed = url.parse(req.url || "/", true);
    const method = (req.method || "GET").toUpperCase() as HttpMethod;
    const path = parsed.pathname || "/";
    const query = parseQueryString(parsed.search || "");
    const rawBody = await this.readBody(req);
    let body: unknown = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    const ctx: Context = {
      request: {
        method,
        path,
        headers: req.headers as Headers,
        query,
        params: {},
        body,
        rawBody,
      },
      response: {
        statusCode: 200,
        headers: { "Content-Type": ContentType.JSON },
        body: null,
      },
      state: {},
    };

    const found = this.router.find(method, path);
    if (!found) {
      ctx.response.statusCode = 404;
      const errResp: ErrorResponse = {
        kind: "error",
        status: HttpStatus.NOT_FOUND,
        error: "Not Found",
        message: `路由 ${method} ${path} 不存在`,
        details: this.router
          .getRoutes()
          .map((r) => `${r.method.padEnd(7)} ${r.path}`),
      };
      ctx.response.body = errResp;
      this.sendResponse(res, ctx);
      return;
    }

    ctx.request.params = found.params;
    const chain: Middleware[] = [
      ...this.globalMiddlewares,
      ...found.route.middlewares,
    ];
    let handlerCalled = false;
    const handlerMw: Middleware = async (c) => {
      handlerCalled = true;
      await found.route.handler(c);
    };
    chain.push(handlerMw);

    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error("next() 被多次调用");
      index = i;
      if (i >= chain.length) return;
      await chain[i](ctx, () => dispatch(i + 1));
    };

    try {
      await dispatch(0);
      if (!handlerCalled && !ctx.response.body) {
        ctx.response.statusCode = 403;
        ctx.response.body = {
          kind: "error",
          status: HttpStatus.FORBIDDEN,
          error: "Forbidden",
          message: "请求被中间件拦截",
        } satisfies ErrorResponse;
      }
    } catch (err) {
      if (err instanceof AppError) {
        ctx.response.statusCode = parseInt(err.status, 10);
        ctx.response.body = {
          kind: "error",
          status: err.status,
          error: err.name,
          message: err.message,
          details: err instanceof ValidationError ? err.details : undefined,
        } satisfies ErrorResponse;
      } else {
        ctx.response.statusCode = 500;
        ctx.response.body = {
          kind: "error",
          status: HttpStatus.INTERNAL_ERROR,
          error: "Internal Server Error",
          message: err instanceof Error ? err.message : String(err),
        } satisfies ErrorResponse;
      }
    }

    this.sendResponse(res, ctx);
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  private sendResponse(res: http.ServerResponse, ctx: Context): void {
    const bodyStr =
      typeof ctx.response.body === "string"
        ? ctx.response.body
        : JSON.stringify(ctx.response.body, null, 2);
    res.writeHead(ctx.response.statusCode, ctx.response.headers);
    res.end(bodyStr);
  }

  listen(port: number, cb?: () => void): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((e) => {
        res.writeHead(500, { "Content-Type": ContentType.JSON });
        res.end(JSON.stringify({ error: String(e) }));
      });
    });
    this.server.listen(port, () => {
      console.log(`\n[RESTful API 模拟器已启动] http://localhost:${port}\n`);
      this.printRoutes();
      cb?.();
    });
  }

  private printRoutes(): void {
    const routes = this.router.getRoutes();
    console.log("已注册路由：");
    console.log("─".repeat(45));
    for (const r of routes) console.log(`${r.method.padEnd(10)}${r.path}`);
    console.log("─".repeat(45));
    console.log(`共 ${routes.length} 条路由\n`);
  }
}

// ============================================================
// 17. 种子数据与自定义路由
// ============================================================

function seedUsers(c: CrudController<User>): void {
  c.seed([
    {
      name: "张三",
      email: "zhangsan@example.com",
      role: "admin",
      createdAt: "2024-01-15T08:00:00Z",
    },
    {
      name: "李四",
      email: "lisi@example.com",
      role: "editor",
      createdAt: "2024-02-20T09:30:00Z",
    },
    {
      name: "王五",
      email: "wangwu@example.com",
      role: "viewer",
      createdAt: "2024-03-10T14:15:00Z",
    },
  ] as const as readonly Omit<User, "id">[]);
}

function seedPosts(c: CrudController<Post>): void {
  c.seed([
    {
      title: "TypeScript 入门",
      content: "基本概念...",
      authorId: 1,
      tags: ["ts"],
      createdAt: "2024-01-20T10:00:00Z",
    },
    {
      title: "RESTful 设计",
      content: "最佳实践...",
      authorId: 2,
      tags: ["api"],
      createdAt: "2024-02-25T14:30:00Z",
    },
  ] as const as readonly Omit<Post, "id">[]);
}

async function apiIndexHandler(ctx: Context): Promise<void> {
  const endpoints = {
    users: "GET/POST /api/users, GET/PUT/DELETE /api/users/:id",
    posts: "GET/POST /api/posts, GET/PUT/DELETE /api/posts/:id",
    admin: "GET /api/admin/dashboard (需认证)",
  } as const;
  ctx.response.body = {
    kind: "success",
    status: HttpStatus.OK,
    data: { name: "RESTful API 模拟器", version: "1.0.0", endpoints },
  } satisfies SuccessResponse<unknown>;
}

async function healthCheckHandler(ctx: Context): Promise<void> {
  const mem = process.memoryUsage();
  ctx.response.body = {
    kind: "success",
    status: HttpStatus.OK,
    data: {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        rss: `${(mem.rss / 1048576).toFixed(2)}MB`,
        heap: `${(mem.heapUsed / 1048576).toFixed(2)}MB`,
      },
    },
  } satisfies SuccessResponse<unknown>;
}

async function adminDashboardHandler(ctx: Context): Promise<void> {
  const user = ctx.state[STATE_USER] ?? null;
  ctx.response.body = {
    kind: "success",
    status: HttpStatus.OK,
    data: {
      message: "欢迎进入管理后台",
      user,
      stats: { systemStatus: "正常" },
    },
  } satisfies SuccessResponse<unknown>;
}

// ============================================================
// 18. 主函数
// ============================================================

async function main(): Promise<void> {
  const app = new Application();
  const PORT = 3000;

  // 全局中间件（AbstractMiddleware 子类实例）
  app
    .use(new TimingMiddleware())
    .use(new CorsMiddleware())
    .use(new LoggerMiddleware());

  app.get("/", apiIndexHandler);
  app.get("/health", healthCheckHandler);

  const userCtrl = new CrudController<User>("用户", validateUser);
  seedUsers(userCtrl);
  app.resource("/api/users", userCtrl);

  const postCtrl = new CrudController<Post>("文章", validatePost);
  seedPosts(postCtrl);
  app.resource("/api/posts", postCtrl);

  app.get(
    "/api/admin/dashboard",
    adminDashboardHandler,
    new AuthMiddleware().toMiddleware(),
  );

  app.listen(PORT);
}

main().catch(console.error);
