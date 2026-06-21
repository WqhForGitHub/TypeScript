#!/usr/bin/env node

import * as http from "http";
import * as url from "url";

// ============================================================
// 类型定义
// ============================================================

/** HTTP 请求方法 */
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** 请求头 */
type Headers = Record<string, string>;

/** 路由参数，如 /users/:id 中的 { id: "1" } */
type RouteParams = Record<string, string>;

/** 查询参数，如 ?page=1&size=10 中的 { page: "1", size: "10" } */
type QueryParams = Record<string, string>;

/** 中间件函数：接收上下文，可选择调用 next() 传递给下一个中间件 */
type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;

/** 路由处理函数 */
type RouteHandler = (ctx: Context) => Promise<void> | void;

/** 路由条目 */
interface Route {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
  middlewares: Middleware[];
}

/** 模拟 HTTP 请求对象 */
interface HttpRequest {
  method: HttpMethod;
  path: string;
  headers: Headers;
  query: QueryParams;
  params: RouteParams;
  body: unknown;
  rawBody: string;
}

/** 模拟 HTTP 响应对象 */
interface HttpResponse {
  statusCode: number;
  headers: Headers;
  body: unknown;
}

/** 请求上下文：封装请求和响应 */
interface Context {
  request: HttpRequest;
  response: HttpResponse;
  /** 附加数据，供中间件传递信息 */
  state: Record<string, unknown>;
}

/** 路由匹配结果 */
interface MatchResult {
  matched: boolean;
  params: RouteParams;
}

/** 分页元数据 */
interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 分页响应 */
interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ============================================================
// 工具函数
// ============================================================

/** 解析查询字符串 */
function parseQueryString(qs: string): QueryParams {
  const result: QueryParams = {};
  if (!qs) return result;
  const search = qs.startsWith("?") ? qs.slice(1) : qs;
  for (const pair of search.split("&")) {
    const [key, value] = pair.split("=");
    if (key) {
      result[decodeURIComponent(key)] = value ? decodeURIComponent(value) : "";
    }
  }
  return result;
}

/** 将路由路径模式编译为正则表达式，并提取参数名 */
function compileRoutePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, paramName) => {
    paramNames.push(paramName);
    return "([^/]+)";
  });
  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/** 匹配路由路径 */
function matchRoute(pattern: string, actualPath: string): MatchResult {
  const { regex, paramNames } = compileRoutePattern(pattern);
  const match = actualPath.match(regex);
  if (!match) return { matched: false, params: {} };

  const params: RouteParams = {};
  paramNames.forEach((name, i) => {
    params[name] = match[i + 1];
  });
  return { matched: true, params };
}

/** 生成自增 ID */
class AutoIncrementId {
  private current = 0;
  next(): number {
    return ++this.current;
  }
  reset(): void {
    this.current = 0;
  }
}

// ============================================================
// Router 路由器
// ============================================================

class Router {
  private routes: Route[] = [];

  /** 注册路由 */
  private register(method: HttpMethod, path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.routes.push({ method, path, handler, middlewares });
  }

  get(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.register("GET", path, handler, ...middlewares);
  }

  post(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.register("POST", path, handler, ...middlewares);
  }

  put(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.register("PUT", path, handler, ...middlewares);
  }

  patch(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.register("PATCH", path, handler, ...middlewares);
  }

  delete(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.register("DELETE", path, handler, ...middlewares);
  }

  /** 查找匹配的路由 */
  find(method: HttpMethod, path: string): { route: Route; params: RouteParams } | null {
    for (const route of this.routes) {
      const result = matchRoute(route.path, path);
      if (result.matched && route.method === method) {
        return { route, params: result.params };
      }
    }
    return null;
  }

  /** 获取所有已注册路由（用于调试） */
  getRoutes(): ReadonlyArray<Readonly<Route>> {
    return this.routes;
  }
}

// ============================================================
// Application 应用
// ============================================================

class Application {
  private router = new Router();
  private globalMiddlewares: Middleware[] = [];
  private server: http.Server | null = null;

  /** 添加全局中间件 */
  use(middleware: Middleware): void {
    this.globalMiddlewares.push(middleware);
  }

  /** 路由快捷方法 */
  get(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.router.get(path, handler, ...middlewares);
  }

  post(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.router.post(path, handler, ...middlewares);
  }

  put(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.router.put(path, handler, ...middlewares);
  }

  patch(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.router.patch(path, handler, ...middlewares);
  }

  delete(path: string, handler: RouteHandler, ...middlewares: Middleware[]): void {
    this.router.delete(path, handler, ...middlewares);
  }

  /** 注册 RESTful 资源路由（一次性生成 CRUD 五个端点） */
  resource(basePath: string, controller: ResourceController): void {
    // GET /basePath — 列表
    this.router.get(basePath, controller.index.bind(controller));
    // GET /basePath/:id — 详情
    this.router.get(`${basePath}/:id`, controller.show.bind(controller));
    // POST /basePath — 创建
    this.router.post(basePath, controller.create.bind(controller));
    // PUT /basePath/:id — 全量更新
    this.router.put(`${basePath}/:id`, controller.update.bind(controller));
    // DELETE /basePath/:id — 删除
    this.router.delete(`${basePath}/:id`, controller.destroy.bind(controller));
  }

  /** 处理请求核心逻辑 */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || "/", true);
    const method = (req.method || "GET").toUpperCase() as HttpMethod;
    const path = parsedUrl.pathname || "/";
    const query = parseQueryString(parsedUrl.search || "");

    // 读取请求体
    const rawBody = await this.readBody(req);
    let body: unknown = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    // 构建 Context
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
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: null,
      },
      state: {},
    };

    // 查找路由
    const found = this.router.find(method, path);

    if (!found) {
      // 404
      ctx.response.statusCode = 404;
      ctx.response.body = {
        error: "Not Found",
        message: `路由 ${method} ${path} 不存在`,
        availableRoutes: this.router.getRoutes().map(
          (r) => `${r.method.padEnd(7)} ${r.path}`
        ),
      };
      this.sendResponse(res, ctx);
      return;
    }

    // 注入路由参数
    ctx.request.params = found.params;

    // 组合中间件链：全局中间件 + 路由级中间件 + 路由处理函数
    const allMiddlewares = [
      ...this.globalMiddlewares,
      ...found.route.middlewares,
    ];

    let handlerCalled = false;
    const handlerMiddleware: Middleware = async (c, _next) => {
      handlerCalled = true;
      await found.route.handler(c);
    };

    const chain = [...allMiddlewares, handlerMiddleware];

    // 执行中间件链
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error("next() 被调用了多次");
      index = i;
      if (i >= chain.length) return;
      const mw = chain[i];
      try {
        await mw(ctx, () => dispatch(i + 1));
      } catch (err) {
        // 错误处理中间件
        ctx.response.statusCode = 500;
        ctx.response.body = {
          error: "Internal Server Error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    };

    await dispatch(0);

    if (!handlerCalled) {
      // 所有中间件都未调用处理函数（可能被中间件拦截）
      if (!ctx.response.body) {
        ctx.response.statusCode = 403;
        ctx.response.body = { error: "Forbidden", message: "请求被中间件拦截" };
      }
    }

    this.sendResponse(res, ctx);
  }

  /** 读取请求体 */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  /** 发送响应 */
  private sendResponse(res: http.ServerResponse, ctx: Context): void {
    const bodyStr = typeof ctx.response.body === "string"
      ? ctx.response.body
      : JSON.stringify(ctx.response.body, null, 2);

    res.writeHead(ctx.response.statusCode, ctx.response.headers);
    res.end(bodyStr);
  }

  /** 启动服务器 */
  listen(port: number, callback?: () => void): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error", message: String(err) }));
      });
    });

    this.server.listen(port, () => {
      console.log(`\n🚀 RESTful API 模拟器已启动`);
      console.log(`   地址: http://localhost:${port}`);
      console.log(`   按 Ctrl+C 停止服务器\n`);
      this.printRoutes();
      callback?.();
    });
  }

  /** 打印所有路由 */
  private printRoutes(): void {
    const routes = this.router.getRoutes();
    console.log("已注册的路由：");
    console.log("─".repeat(45));
    console.log(`${"方法".padEnd(10)}${"路径".padEnd(20)}${"处理函数"}`);
    console.log("─".repeat(45));
    for (const route of routes) {
      const handlerName = route.handler.name || "<anonymous>";
      console.log(`${route.method.padEnd(10)}${route.path.padEnd(20)}${handlerName}`);
    }
    console.log("─".repeat(45));
    console.log(`共 ${routes.length} 条路由\n`);
  }
}

// ============================================================
// ResourceController 资源控制器接口
// ============================================================

interface ResourceController {
  index(ctx: Context): Promise<void> | void;
  show(ctx: Context): Promise<void> | void;
  create(ctx: Context): Promise<void> | void;
  update(ctx: Context): Promise<void> | void;
  destroy(ctx: Context): Promise<void> | void;
}

// ============================================================
// 通用 CRUD 控制器
// ============================================================

class CrudController<T extends object> implements ResourceController {
  private store = new Map<number, T>();
  private idGenerator = new AutoIncrementId();

  constructor(private resourceName: string, private validationSchema?: (data: unknown) => { valid: boolean; errors: string[] }) {}

  /** GET / — 列表（支持分页和过滤） */
  async index(ctx: Context): Promise<void> {
    const { page = "1", pageSize = "10", ...filters } = ctx.request.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 10));

    let items = Array.from(this.store.values());

    // 简单过滤：查询参数中非分页字段作为过滤条件
    for (const [key, value] of Object.entries(filters)) {
      items = items.filter((item) => String((item as Record<string, unknown>)[key]).toLowerCase() === value.toLowerCase());
    }

    const total = items.length;
    const totalPages = Math.ceil(total / pageSizeNum);
    const start = (pageNum - 1) * pageSizeNum;
    const data = items.slice(start, start + pageSizeNum);

    const pagination: PaginationMeta = { total, page: pageNum, pageSize: pageSizeNum, totalPages };
    const response: PaginatedResponse<T> = { data, pagination };

    ctx.response.statusCode = 200;
    ctx.response.body = response;
  }

  /** GET /:id — 详情 */
  async show(ctx: Context): Promise<void> {
    const id = parseInt(ctx.request.params.id, 10);
    if (isNaN(id)) {
      ctx.response.statusCode = 400;
      ctx.response.body = { error: "Bad Request", message: "ID 必须是数字" };
      return;
    }

    const item = this.store.get(id);
    if (!item) {
      ctx.response.statusCode = 404;
      ctx.response.body = { error: "Not Found", message: `${this.resourceName} #${id} 不存在` };
      return;
    }

    ctx.response.statusCode = 200;
    ctx.response.body = { data: item };
  }

  /** POST / — 创建 */
  async create(ctx: Context): Promise<void> {
    if (!ctx.request.body || typeof ctx.request.body !== "object") {
      ctx.response.statusCode = 400;
      ctx.response.body = { error: "Bad Request", message: "请求体必须是 JSON 对象" };
      return;
    }

    // 验证
    if (this.validationSchema) {
      const result = this.validationSchema(ctx.request.body);
      if (!result.valid) {
        ctx.response.statusCode = 422;
        ctx.response.body = { error: "Unprocessable Entity", message: "数据验证失败", details: result.errors };
        return;
      }
    }

    const id = this.idGenerator.next();
    const item = { id, ...(ctx.request.body as object) } as unknown as T;
    this.store.set(id, item);

    ctx.response.statusCode = 201;
    ctx.response.body = { data: item, message: `${this.resourceName} 创建成功` };
  }

  /** PUT /:id — 全量更新 */
  async update(ctx: Context): Promise<void> {
    const id = parseInt(ctx.request.params.id, 10);
    if (isNaN(id)) {
      ctx.response.statusCode = 400;
      ctx.response.body = { error: "Bad Request", message: "ID 必须是数字" };
      return;
    }

    if (!this.store.has(id)) {
      ctx.response.statusCode = 404;
      ctx.response.body = { error: "Not Found", message: `${this.resourceName} #${id} 不存在` };
      return;
    }

    if (!ctx.request.body || typeof ctx.request.body !== "object") {
      ctx.response.statusCode = 400;
      ctx.response.body = { error: "Bad Request", message: "请求体必须是 JSON 对象" };
      return;
    }

    // 验证
    if (this.validationSchema) {
      const result = this.validationSchema(ctx.request.body);
      if (!result.valid) {
        ctx.response.statusCode = 422;
        ctx.response.body = { error: "Unprocessable Entity", message: "数据验证失败", details: result.errors };
        return;
      }
    }

    const updated = { id, ...(ctx.request.body as object) } as unknown as T;
    this.store.set(id, updated);

    ctx.response.statusCode = 200;
    ctx.response.body = { data: updated, message: `${this.resourceName} #${id} 更新成功` };
  }

  /** DELETE /:id — 删除 */
  async destroy(ctx: Context): Promise<void> {
    const id = parseInt(ctx.request.params.id, 10);
    if (isNaN(id)) {
      ctx.response.statusCode = 400;
      ctx.response.body = { error: "Bad Request", message: "ID 必须是数字" };
      return;
    }

    if (!this.store.has(id)) {
      ctx.response.statusCode = 404;
      ctx.response.body = { error: "Not Found", message: `${this.resourceName} #${id} 不存在` };
      return;
    }

    this.store.delete(id);

    ctx.response.statusCode = 200;
    ctx.response.body = { message: `${this.resourceName} #${id} 删除成功` };
  }

  /** 获取存储（供种子数据使用） */
  getStore(): Map<number, T> {
    return this.store;
  }

  /** 获取 ID 生成器（供种子数据使用） */
  getIdGenerator(): AutoIncrementId {
    return this.idGenerator;
  }
}

// ============================================================
// 内置中间件
// ============================================================

/** 日志中间件 */
const loggerMiddleware: Middleware = async (ctx, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  console.log(`→ [${timestamp}] ${ctx.request.method} ${ctx.request.path}`);

  await next();

  const duration = Date.now() - start;
  console.log(`← [${new Date().toISOString()}] ${ctx.request.method} ${ctx.request.path} ${ctx.response.statusCode} (${duration}ms)`);
};

/** CORS 中间件 */
const corsMiddleware: Middleware = async (ctx, next) => {
  ctx.response.headers["Access-Control-Allow-Origin"] = "*";
  ctx.response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
  ctx.response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";

  // 处理预检请求
  if (ctx.request.method === "OPTIONS") {
    ctx.response.statusCode = 204;
    ctx.response.body = "";
    return;
  }

  await next();
};

/** 认证中间件（模拟） */
const authMiddleware: Middleware = async (ctx, next) => {
  const authHeader = ctx.request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    ctx.response.statusCode = 401;
    ctx.response.body = { error: "Unauthorized", message: "缺少或无效的 Authorization 头" };
    return;
  }

  const token = authHeader.slice(7);
  // 模拟 token 验证：接受 "secret-token" 或 "demo-key"
  if (token !== "secret-token" && token !== "demo-key") {
    ctx.response.statusCode = 401;
    ctx.response.body = { error: "Unauthorized", message: "Token 无效" };
    return;
  }

  // 将用户信息存入 state
  ctx.state.user = { name: "Admin", role: "admin", token };
  await next();
};

/** 请求计时中间件 */
const timingMiddleware: Middleware = async (ctx, next) => {
  const start = process.hrtime.bigint();
  await next();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  ctx.response.headers["X-Response-Time"] = `${ms.toFixed(2)}ms`;
};

// ============================================================
// 数据验证器
// ============================================================

interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  createdAt: string;
}

interface Post {
  id: number;
  title: string;
  content: string;
  authorId: number;
  tags: string[];
  createdAt: string;
}

/** 用户验证 */
function validateUser(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["请求体必须是对象"] };
  }
  const obj = data as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== "string" || obj.name.trim().length < 2) {
    errors.push("name 必须是至少 2 个字符的字符串");
  }
  if (!obj.email || typeof obj.email !== "string" || !obj.email.includes("@")) {
    errors.push("email 必须是有效的邮箱地址");
  }
  if (obj.role && !["admin", "editor", "viewer"].includes(obj.role as string)) {
    errors.push("role 必须是 admin、editor 或 viewer 之一");
  }

  return { valid: errors.length === 0, errors };
}

/** 文章验证 */
function validatePost(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["请求体必须是对象"] };
  }
  const obj = data as Record<string, unknown>;

  if (!obj.title || typeof obj.title !== "string" || obj.title.trim().length < 1) {
    errors.push("title 不能为空");
  }
  if (!obj.content || typeof obj.content !== "string") {
    errors.push("content 不能为空");
  }
  if (obj.authorId !== undefined && typeof obj.authorId !== "number") {
    errors.push("authorId 必须是数字");
  }
  if (obj.tags && !Array.isArray(obj.tags)) {
    errors.push("tags 必须是数组");
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// 种子数据
// ============================================================

function seedUsers(controller: CrudController<User>): void {
  const store = controller.getStore();
  const idGen = controller.getIdGenerator();

  const users: Omit<User, "id">[] = [
    { name: "张三", email: "zhangsan@example.com", role: "admin", createdAt: "2024-01-15T08:00:00Z" },
    { name: "李四", email: "lisi@example.com", role: "editor", createdAt: "2024-02-20T09:30:00Z" },
    { name: "王五", email: "wangwu@example.com", role: "viewer", createdAt: "2024-03-10T14:15:00Z" },
    { name: "赵六", email: "zhaoliu@example.com", role: "editor", createdAt: "2024-04-05T16:45:00Z" },
    { name: "钱七", email: "qianqi@example.com", role: "viewer", createdAt: "2024-05-12T11:20:00Z" },
  ];

  for (const user of users) {
    const id = idGen.next();
    store.set(id, { id, ...user });
  }
}

function seedPosts(controller: CrudController<Post>): void {
  const store = controller.getStore();
  const idGen = controller.getIdGenerator();

  const posts: Omit<Post, "id">[] = [
    { title: "TypeScript 入门指南", content: "本文介绍 TypeScript 的基本概念和安装方法...", authorId: 1, tags: ["typescript", "教程"], createdAt: "2024-01-20T10:00:00Z" },
    { title: "RESTful API 设计最佳实践", content: "如何设计优雅的 RESTful API 接口...", authorId: 2, tags: ["api", "rest", "设计"], createdAt: "2024-02-25T14:30:00Z" },
    { title: "Node.js 异步编程详解", content: "深入理解 Promise、async/await 和事件循环...", authorId: 2, tags: ["nodejs", "异步"], createdAt: "2024-03-15T09:00:00Z" },
    { title: "前端性能优化策略", content: "从加载到渲染，全方位优化前端性能...", authorId: 4, tags: ["前端", "性能"], createdAt: "2024-04-10T16:00:00Z" },
  ];

  for (const post of posts) {
    const id = idGen.next();
    store.set(id, { id, ...post });
  }
}

// ============================================================
// 自定义路由处理函数
// ============================================================

/** 首页 — API 概览 */
async function apiIndexHandler(ctx: Context): Promise<void> {
  ctx.response.body = {
    name: "RESTful API 模拟器",
    version: "1.0.0",
    description: "纯 TypeScript 实现的 RESTful API 模拟器",
    endpoints: {
      users: {
        list: "GET    /api/users",
        detail: "GET    /api/users/:id",
        create: "POST   /api/users",
        update: "PUT    /api/users/:id",
        delete: "DELETE /api/users/:id",
      },
      posts: {
        list: "GET    /api/posts",
        detail: "GET    /api/posts/:id",
        create: "POST   /api/posts",
        update: "PUT    /api/posts/:id",
        delete: "DELETE /api/posts/:id",
      },
      admin: {
        dashboard: "GET    /api/admin/dashboard (需要认证)",
      },
      other: {
        index: "GET    /",
        health: "GET    /health",
      },
    },
  };
}

/** 健康检查 */
async function healthCheckHandler(ctx: Context): Promise<void> {
  ctx.response.body = {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    },
  };
}

/** 管理后台（需要认证） */
async function adminDashboardHandler(ctx: Context): Promise<void> {
  ctx.response.body = {
    message: "欢迎进入管理后台",
    user: ctx.state.user,
    stats: {
      totalRequests: "—",
      activeUsers: "—",
      systemStatus: "正常运行",
    },
  };
}

// ============================================================
// 主函数：组装应用
// ============================================================

async function main(): Promise<void> {
  const app = new Application();
  const PORT = 3000;

  // ── 全局中间件 ──
  app.use(timingMiddleware);
  app.use(corsMiddleware);
  app.use(loggerMiddleware);

  // ── 基础路由 ──
  app.get("/", apiIndexHandler);
  app.get("/health", healthCheckHandler);

  // ── 用户资源 CRUD ──
  const userController = new CrudController<User>("用户", validateUser);
  seedUsers(userController);
  app.resource("/api/users", userController);

  // ── 文章资源 CRUD ──
  const postController = new CrudController<Post>("文章", validatePost);
  seedPosts(postController);
  app.resource("/api/posts", postController);

  // ── 需要认证的管理路由 ──
  app.get("/api/admin/dashboard", adminDashboardHandler, authMiddleware);

  // ── 启动服务器 ──
  app.listen(PORT);

  // ── 演示：发送模拟请求 ──
  setTimeout(() => runDemoRequests(PORT), 500);
}

// ============================================================
// 演示请求
// ============================================================

interface DemoResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** 发送 HTTP 请求的工具函数 */
function sendRequest(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<DemoResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`请求超时: ${method} ${path}`));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

/** 打印响应 */
function printResponse(label: string, res: DemoResponse): void {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`📌 ${label}`);
  console.log(`${"─".repeat(55)}`);
  console.log(`   状态码: ${res.statusCode}`);

  let bodyDisplay: string;
  try {
    const parsed = JSON.parse(res.body);
    bodyDisplay = JSON.stringify(parsed, null, 2);
  } catch {
    bodyDisplay = res.body;
  }

  // 限制输出长度
  if (bodyDisplay.length > 500) {
    bodyDisplay = bodyDisplay.slice(0, 500) + "\n   ... (输出已截断)";
  }
  console.log(`   响应体: ${bodyDisplay.split("\n").join("\n            ")}`);
}

/** 运行演示请求序列 */
async function runDemoRequests(port: number): Promise<void> {
  console.log("\n" + "=".repeat(55));
  console.log("  开始自动演示 RESTful API 请求");
  console.log("=".repeat(55));

  try {
    // 1. API 概览
    const r1 = await sendRequest("GET", "/");
    printResponse("1. GET / — API 概览", r1);

    // 2. 健康检查
    const r2 = await sendRequest("GET", "/health");
    printResponse("2. GET /health — 健康检查", r2);

    // 3. 获取用户列表
    const r3 = await sendRequest("GET", "/api/users");
    printResponse("3. GET /api/users — 用户列表", r3);

    // 4. 获取用户列表（带分页）
    const r4 = await sendRequest("GET", "/api/users?page=1&pageSize=2");
    printResponse("4. GET /api/users?page=1&pageSize=2 — 分页查询", r4);

    // 5. 获取单个用户
    const r5 = await sendRequest("GET", "/api/users/1");
    printResponse("5. GET /api/users/1 — 用户详情", r5);

    // 6. 创建用户
    const r6 = await sendRequest("POST", "/api/users", {
      body: { name: "孙八", email: "sunba@example.com", role: "viewer" },
    });
    printResponse("6. POST /api/users — 创建用户", r6);

    // 7. 更新用户
    const r7 = await sendRequest("PUT", "/api/users/3", {
      body: { name: "王五（已更新）", email: "wangwu_new@example.com", role: "editor" },
    });
    printResponse("7. PUT /api/users/3 — 更新用户", r7);

    // 8. 验证失败：创建缺少必填字段的用户
    const r8 = await sendRequest("POST", "/api/users", {
      body: { name: "A" }, // name 太短，缺少 email
    });
    printResponse("8. POST /api/users — 验证失败", r8);

    // 9. 获取不存在的用户
    const r9 = await sendRequest("GET", "/api/users/999");
    printResponse("9. GET /api/users/999 — 404 未找到", r9);

    // 10. 获取文章列表
    const r10 = await sendRequest("GET", "/api/posts");
    printResponse("10. GET /api/posts — 文章列表", r10);

    // 11. 创建文章
    const r11 = await sendRequest("POST", "/api/posts", {
      body: {
        title: "TypeScript 高级类型",
        content: "深入探讨条件类型、映射类型和模板字面量类型...",
        authorId: 1,
        tags: ["typescript", "高级"],
      },
    });
    printResponse("11. POST /api/posts — 创建文章", r11);

    // 12. 删除用户
    const r12 = await sendRequest("DELETE", "/api/users/5");
    printResponse("12. DELETE /api/users/5 — 删除用户", r12);

    // 13. 访问需要认证的接口（无 Token）
    const r13 = await sendRequest("GET", "/api/admin/dashboard");
    printResponse("13. GET /api/admin/dashboard — 未认证", r13);

    // 14. 访问需要认证的接口（有 Token）
    const r14 = await sendRequest("GET", "/api/admin/dashboard", {
      headers: { Authorization: "Bearer demo-key" },
    });
    printResponse("14. GET /api/admin/dashboard — 已认证", r14);

    // 15. 访问不存在的路由
    const r15 = await sendRequest("GET", "/api/unknown");
    printResponse("15. GET /api/unknown — 404 路由不存在", r15);
  } catch (err) {
    console.error("演示请求出错:", err);
  }

  console.log("\n" + "=".repeat(55));
  console.log("  演示完成！服务器仍在运行中...");
  console.log("  你可以使用 curl 或其他工具继续测试：");
  console.log("    curl http://localhost:3000/");
  console.log("    curl http://localhost:3000/api/users");
  console.log("    curl http://localhost:3000/api/users/1");
  console.log("    curl -X POST http://localhost:3000/api/users \\");
  console.log('      -H "Content-Type: application/json" \\');
  console.log('      -d \'{"name":"测试","email":"test@example.com","role":"viewer"}\'');
  console.log("    curl -X DELETE http://localhost:3000/api/users/1");
  console.log("=".repeat(55));
}

// 启动
main().catch(console.error);
