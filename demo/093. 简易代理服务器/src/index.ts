#!/usr/bin/env node

/**
 * 简易 HTTP/HTTPS 代理服务器演示（TypeScript 高级特性增强版）
 * 功能：HTTP/HTTPS 代理转发、CONNECT 隧道、日志、域名/IP/内容过滤、
 *   响应缓存、请求头修改、统计、Basic Auth、管理面板、优雅关闭。
 * 高级 TS 特性：string enums、判别联合、泛型类与约束、抽象类与子类、
 *   映射类型、自定义错误层级、接口（可选/只读/索引签名）、satisfies、
 *   getter/setter、生成器/迭代器、Symbol 唯一键、as const、类型守卫、函数重载。
 */

import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as url from "url";
import * as crypto from "crypto";

// 字符串枚举

enum ProxyMode {
  Open = "open",
  Auth = "auth",
  Allowlist = "allowlist",
}
enum ErrorCode {
  Blocked = "BLOCKED",
  BadRequest = "BAD_REQUEST",
  BadGateway = "BAD_GATEWAY",
  AuthRequired = "AUTH_REQUIRED",
  TunnelError = "TUNNEL_ERROR",
  CacheExpired = "CACHE_EXPIRED",
}
enum CacheState {
  Hit = "hit",
  Miss = "miss",
  Expired = "expired",
  Disabled = "disabled",
}
enum FilterAction {
  Allow = "allow",
  Block = "block",
}
enum HttpMethod {
  Get = "GET",
  Post = "POST",
  Put = "PUT",
  Delete = "DELETE",
  Head = "HEAD",
  Options = "OPTIONS",
  Patch = "PATCH",
  Connect = "CONNECT",
}

// 接口（含可选 / 只读 / 索引签名）

interface Identifiable {
  readonly id: string;
}

interface CacheEntry extends Identifiable {
  statusCode: number;
  headers: http.OutgoingHttpHeaders;
  body: Buffer;
  cachedAt: number;
  expiresAt: number;
}

interface RequestLog {
  readonly id: number;
  method: string;
  url: string;
  timestamp: string;
  statusCode: number;
  duration: number;
  blocked: boolean;
  cached: boolean;
  readonly meta?: Record<string, unknown>;
}

interface ProxyConfig {
  readonly port: number;
  readonly host: string;
  readonly adminPath: string;
  auth: { username: string; password: string } | null;
  cacheEnabled: boolean;
  cacheTTL: number;
  cacheMaxSize: number;
  blocklist: Set<string>;
  allowlist: Set<string>;
  allowlistMode: boolean;
  mode?: ProxyMode;
  blockedIps?: Set<string>;
  contentKeywords?: Set<string>;
}

interface ProxyStats {
  totalRequests: number;
  blockedRequests: number;
  cachedHits: number;
  cacheState: CacheState;
  domainCounts: Map<string, number>;
  [key: string]: number | Map<string, number> | CacheState;
}

// 映射类型

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function toMutable<T extends object>(obj: T): Mutable<T> {
  return { ...obj };
}

// 判别联合 + 类型守卫

interface ProxySuccess {
  readonly type: "success";
  statusCode: number;
  headers: http.OutgoingHttpHeaders;
  body: Buffer;
  duration: number;
}
interface ProxyErrorResult {
  readonly type: "error";
  code: ErrorCode;
  message: string;
  duration: number;
}
interface ProxyBlocked {
  readonly type: "blocked";
  hostname: string;
  duration: number;
}
interface ProxyCached {
  readonly type: "cached";
  entry: CacheEntry;
  duration: number;
}
type ProxyResult = ProxySuccess | ProxyErrorResult | ProxyBlocked | ProxyCached;

function isProxySuccess(r: ProxyResult): r is ProxySuccess {
  return r.type === "success";
}
function isProxyError(r: ProxyResult): r is ProxyErrorResult {
  return r.type === "error";
}
function isProxyBlocked(r: ProxyResult): r is ProxyBlocked {
  return r.type === "blocked";
}
function isProxyCached(r: ProxyResult): r is ProxyCached {
  return r.type === "cached";
}

// as const 常量 + satisfies

const DEFAULT_BLOCKLIST = [
  "ads.example.com",
  "tracker.example.com",
  "malware.example.com",
] as const;

const DEFAULTS = {
  port: 8888,
  host: "127.0.0.1",
  adminPath: "/_proxy_admin",
  cacheTTL: 60000,
  cacheMaxSize: 100,
  maxLogs: 200,
} as const;

const ERROR_STATUS_MAP = {
  [ErrorCode.Blocked]: 403,
  [ErrorCode.BadRequest]: 400,
  [ErrorCode.BadGateway]: 502,
  [ErrorCode.AuthRequired]: 407,
  [ErrorCode.TunnelError]: 502,
  [ErrorCode.CacheExpired]: 504,
} satisfies Record<ErrorCode, number>;

const SERVER_INFO = {
  name: "simple-proxy-server",
  version: "1.0.0",
  capabilities: ["http", "https", "connect"],
} satisfies { name: string; version: string; capabilities: readonly string[] };

// 自定义错误层级

class ProxyError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ProxyError.prototype);
  }
}

class ProxyTunnelError extends ProxyError {
  constructor(message: string) {
    super(
      ErrorCode.TunnelError,
      message,
      ERROR_STATUS_MAP[ErrorCode.TunnelError],
    );
    this.name = "ProxyTunnelError";
    Object.setPrototypeOf(this, ProxyTunnelError.prototype);
  }
}

// Symbol 唯一属性键

const STATS_KEY = Symbol("stats");
const ADMIN_TOKEN = Symbol("adminToken");
const SESSION_SECRET: string = crypto.randomBytes(16).toString("hex");

const proxyRegistry: Record<symbol, unknown> = {
  [STATS_KEY]: null,
  [ADMIN_TOKEN]: SESSION_SECRET,
};

// 抽象过滤器与具体子类

abstract class AbstractFilter {
  abstract check(target: string): FilterAction;
  protected matchesWildcard(pattern: string, value: string): boolean {
    if (pattern.startsWith("*.")) return value.endsWith(pattern.slice(1));
    return pattern === value;
  }
}

class DomainFilter extends AbstractFilter {
  private readonly blocklist: Set<string>;
  private readonly allowlist: Set<string>;
  private readonly allowlistMode: boolean;
  constructor(
    blocklist: Set<string>,
    allowlist: Set<string>,
    allowlistMode: boolean,
  ) {
    super();
    this.blocklist = blocklist;
    this.allowlist = allowlist;
    this.allowlistMode = allowlistMode;
  }
  check(hostname: string): FilterAction {
    if (
      this.allowlistMode &&
      this.allowlist.size > 0 &&
      !this.allowlist.has(hostname)
    ) {
      return FilterAction.Block;
    }
    for (const pattern of this.blocklist) {
      if (this.matchesWildcard(pattern, hostname)) return FilterAction.Block;
    }
    return FilterAction.Allow;
  }
}

class IpFilter extends AbstractFilter {
  private readonly blockedIps: Set<string>;
  constructor(blockedIps: Set<string>) {
    super();
    this.blockedIps = blockedIps;
  }
  check(ip: string): FilterAction {
    return this.blockedIps.has(ip) ? FilterAction.Block : FilterAction.Allow;
  }
}

class ContentFilter extends AbstractFilter {
  private readonly keywords: Set<string>;
  constructor(keywords: Set<string>) {
    super();
    this.keywords = keywords;
  }
  check(content: string): FilterAction {
    const lower = content.toLowerCase();
    for (const kw of this.keywords) {
      if (lower.includes(kw.toLowerCase())) return FilterAction.Block;
    }
    return FilterAction.Allow;
  }
}

// 泛型缓存类（约束 + getter/setter + 生成器/迭代器）

class CacheStore<T extends Identifiable> {
  private readonly store = new Map<string, T>();
  private _maxSize: number;
  constructor(maxSize: number) {
    this._maxSize = maxSize;
  }
  get maxSize(): number {
    return this._maxSize;
  }
  set maxSize(value: number) {
    this._maxSize = value;
  }
  get size(): number {
    return this.store.size;
  }
  get(id: string): T | undefined {
    return this.store.get(id);
  }
  has(id: string): boolean {
    return this.store.has(id);
  }
  set(entry: T): void {
    if (this.store.size >= this._maxSize && !this.store.has(entry.id)) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(entry.id, entry);
  }
  delete(id: string): boolean {
    return this.store.delete(id);
  }
  clear(): void {
    this.store.clear();
  }
  *entries(): IterableIterator<[string, T]> {
    yield* this.store.entries();
  }
  [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.entries();
  }
}

// 配置与全局状态

const config: ProxyConfig = {
  port: DEFAULTS.port,
  host: DEFAULTS.host,
  adminPath: DEFAULTS.adminPath,
  auth: null,
  cacheEnabled: true,
  cacheTTL: DEFAULTS.cacheTTL,
  cacheMaxSize: DEFAULTS.cacheMaxSize,
  blocklist: new Set<string>(DEFAULT_BLOCKLIST),
  allowlist: new Set<string>(),
  allowlistMode: false,
  mode: ProxyMode.Open,
  blockedIps: new Set<string>(),
  contentKeywords: new Set<string>(),
};

const stats: ProxyStats = {
  totalRequests: 0,
  blockedRequests: 0,
  cachedHits: 0,
  cacheState: CacheState.Disabled,
  domainCounts: new Map<string, number>(),
};
proxyRegistry[STATS_KEY] = stats;

const requestLogs: RequestLog[] = [];
const MAX_LOGS: number = DEFAULTS.maxLogs;
let logIdCounter = 0;

const cache = new CacheStore<CacheEntry>(config.cacheMaxSize);

const domainFilter = new DomainFilter(
  config.blocklist,
  config.allowlist,
  config.allowlistMode,
);
const ipFilter = new IpFilter(config.blockedIps ?? new Set<string>());
const contentFilter = new ContentFilter(
  config.contentKeywords ?? new Set<string>(),
);

// 配置管理器（getter/setter 同步白名单模式）

class ConfigManager {
  private _mode: ProxyMode;
  constructor(initial: ProxyMode) {
    this._mode = initial;
  }
  get mode(): ProxyMode {
    return this._mode;
  }
  set mode(value: ProxyMode) {
    this._mode = value;
    config.allowlistMode = value === ProxyMode.Allowlist;
  }
  snapshot(): Mutable<ProxyConfig> {
    return toMutable(config);
  }
}

const configManager = new ConfigManager(ProxyMode.Open);

// 工具函数与函数重载

function now(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function getDomain(requestUrl: string): string {
  try {
    return new URL(requestUrl).hostname;
  } catch {
    return requestUrl;
  }
}

/** 函数重载：解析 HTTP 方法 */
function parseMethod(m: string | undefined): HttpMethod;
function parseMethod(m: string | undefined, fallback: HttpMethod): HttpMethod;
function parseMethod(
  m: string | undefined,
  fallback: HttpMethod = HttpMethod.Get,
): HttpMethod {
  if (!m) return fallback;
  const upper = m.toUpperCase();
  const all = Object.values(HttpMethod) as string[];
  return all.includes(upper) ? (upper as HttpMethod) : fallback;
}

/** 函数重载：生成缓存 key */
function cacheKey(method: HttpMethod, requestUrl: string): string;
function cacheKey(method: string, requestUrl: string): string;
function cacheKey(method: string, requestUrl: string): string {
  return `${method}:${requestUrl}`;
}

/** 函数重载：格式化日志 */
function formatLog(log: RequestLog): string;
function formatLog(log: RequestLog, compact: boolean): string;
function formatLog(log: RequestLog, compact: boolean = false): string {
  if (compact) return `[${log.timestamp}] ${log.method} ${log.statusCode}`;
  return `[${log.timestamp}] ${log.method} ${log.url} -> ${log.statusCode} (${log.duration}ms)`;
}

/** 处理代理结果（判别联合 + 类型守卫） */
function describeResult(r: ProxyResult): string {
  if (isProxySuccess(r)) return `success ${r.statusCode} (${r.duration}ms)`;
  if (isProxyCached(r)) return `cached ${r.entry.statusCode} (${r.duration}ms)`;
  if (isProxyBlocked(r)) return `blocked ${r.hostname} (${r.duration}ms)`;
  if (isProxyError(r)) return `error ${r.code}: ${r.message} (${r.duration}ms)`;
  return "unknown";
}

function getFromCache(key: string): CacheEntry | null {
  if (!config.cacheEnabled) {
    stats.cacheState = CacheState.Disabled;
    return null;
  }
  const entry = cache.get(key);
  if (!entry) {
    stats.cacheState = CacheState.Miss;
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    stats.cacheState = CacheState.Expired;
    return null;
  }
  stats.cacheState = CacheState.Hit;
  return entry;
}

function setCache(
  key: string,
  statusCode: number,
  headers: http.OutgoingHttpHeaders,
  body: Buffer,
): void {
  if (!config.cacheEnabled || statusCode !== 200 || body.length > 1024 * 1024)
    return;
  cache.set({
    id: key,
    statusCode,
    headers,
    body,
    cachedAt: Date.now(),
    expiresAt: Date.now() + config.cacheTTL,
  });
}

function addLog(log: Omit<RequestLog, "id">): void {
  logIdCounter++;
  requestLogs.push({ ...log, id: logIdCounter });
  if (requestLogs.length > MAX_LOGS) requestLogs.shift();
}

function updateStats(
  hostname: string,
  blocked: boolean,
  cached: boolean,
): void {
  stats.totalRequests++;
  if (blocked) stats.blockedRequests++;
  if (cached) stats.cachedHits++;
  stats.domainCounts.set(hostname, (stats.domainCounts.get(hostname) || 0) + 1);
}

interface RecordParams {
  method: string;
  requestUrl: string;
  hostname: string;
  statusCode: number;
  duration: number;
  blocked: boolean;
  cached: boolean;
  log?: string;
  err?: boolean;
}

/** 统一记录请求：写日志 + 更新统计 + 控制台输出 */
function recordRequest(p: RecordParams): void {
  addLog({
    method: p.method,
    url: p.requestUrl,
    timestamp: now(),
    statusCode: p.statusCode,
    duration: p.duration,
    blocked: p.blocked,
    cached: p.cached,
  });
  updateStats(p.hostname, p.blocked, p.cached);
  if (p.log) {
    if (p.err) console.error(p.log);
    else console.log(p.log);
  }
}

function checkAuth(req: http.IncomingMessage): boolean {
  if (!config.auth) return true;
  const authHeader = req.headers["proxy-authorization"];
  if (!authHeader) return false;
  const parts = String(authHeader).split(" ");
  if (parts.length !== 2 || parts[0] !== "Basic") return false;
  const decoded = Buffer.from(parts[1], "base64").toString("utf-8");
  const [username, password] = decoded.split(":");
  return username === config.auth.username && password === config.auth.password;
}

/** 综合过滤：域名 / IP / 内容（可选） */
function shouldBlock(hostname: string, ip: string, content?: string): boolean {
  if (domainFilter.check(hostname) === FilterAction.Block) return true;
  if (ipFilter.check(ip) === FilterAction.Block) return true;
  if (
    content !== undefined &&
    contentFilter.check(content) === FilterAction.Block
  )
    return true;
  return false;
}

// HTTP 代理请求处理

function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const startTime = Date.now();
  const requestUrl = req.url || "";
  const method = parseMethod(req.method);

  if (requestUrl.startsWith(config.adminPath)) {
    handleAdmin(req, res);
    return;
  }

  if (!checkAuth(req)) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Proxy Server"' });
    res.end("Proxy Authentication Required");
    return;
  }

  const hostname = getDomain(requestUrl);
  const clientIp = req.socket.remoteAddress || "";

  // 域名 / IP 过滤
  if (shouldBlock(hostname, clientIp)) {
    const duration = Date.now() - startTime;
    recordRequest({
      method: req.method || "GET",
      requestUrl,
      hostname,
      statusCode: 403,
      duration,
      blocked: true,
      cached: false,
      log: `[${now()}] 拦截: ${req.method} ${requestUrl} (${describeResult({ type: "blocked", hostname, duration })})`,
    });
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<html><body><h1>403 禁止访问</h1><p>域名 ${hostname} 已被代理服务器屏蔽</p></body></html>`,
    );
    return;
  }

  // 缓存检查
  const cKey = cacheKey(method, requestUrl);
  const cachedEntry = getFromCache(cKey);
  if (cachedEntry) {
    const duration = Date.now() - startTime;
    recordRequest({
      method: req.method || "GET",
      requestUrl,
      hostname,
      statusCode: cachedEntry.statusCode,
      duration,
      blocked: false,
      cached: true,
      log: `[${now()}] 缓存命中: ${req.method} ${requestUrl} (${describeResult({ type: "cached", entry: cachedEntry, duration })})`,
    });
    res.writeHead(cachedEntry.statusCode, cachedEntry.headers);
    res.end(cachedEntry.body);
    return;
  }

  // 解析目标 URL
  let targetUrl: URL;
  try {
    targetUrl = new URL(requestUrl);
  } catch {
    const duration = Date.now() - startTime;
    const err = new ProxyError(
      ErrorCode.BadRequest,
      "无法解析目标 URL",
      ERROR_STATUS_MAP[ErrorCode.BadRequest],
    );
    recordRequest({
      method: req.method || "GET",
      requestUrl,
      hostname,
      statusCode: 400,
      duration,
      blocked: false,
      cached: false,
      log: `[${now()}] 错误: ${describeResult({ type: "error", code: err.code, message: err.message, duration })}`,
    });
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("400 Bad Request: 无法解析目标 URL");
    return;
  }

  // 构造代理请求头
  const proxyHeaders: http.IncomingHttpHeaders = { ...req.headers };
  delete proxyHeaders["proxy-connection"];
  delete proxyHeaders["proxy-authorization"];
  proxyHeaders["x-forwarded-for"] = clientIp;
  proxyHeaders["x-forwarded-proto"] = targetUrl.protocol.replace(":", "");

  const options: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: proxyHeaders,
  };

  const isHttps = targetUrl.protocol === "https:";
  const handleProxyResponse = (proxyRes: http.IncomingMessage): void => {
    const duration = Date.now() - startTime;
    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      const status = proxyRes.statusCode || 500;
      recordRequest({
        method: req.method || "GET",
        requestUrl,
        hostname,
        statusCode: status,
        duration,
        blocked: false,
        cached: false,
        log: `[${now()}] 代理: ${req.method} ${requestUrl} -> ${status} (${describeResult({ type: "success", statusCode: status, headers: proxyRes.headers, body, duration })})`,
      });
      setCache(cKey, status, proxyRes.headers, body);
      res.writeHead(status, proxyRes.headers);
      res.end(body);
    });
  };

  const proxyReq = isHttps
    ? https.request(options, handleProxyResponse)
    : http.request(options, handleProxyResponse);

  proxyReq.on("error", (err: Error) => {
    const duration = Date.now() - startTime;
    const proxyErr =
      err instanceof ProxyError
        ? err
        : new ProxyError(
            ErrorCode.BadGateway,
            err.message,
            ERROR_STATUS_MAP[ErrorCode.BadGateway],
          );
    recordRequest({
      method: req.method || "GET",
      requestUrl,
      hostname,
      statusCode: 502,
      duration,
      blocked: false,
      cached: false,
      err: true,
      log: `[${now()}] 代理错误: ${describeResult({ type: "error", code: proxyErr.code, message: proxyErr.message, duration })}`,
    });
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`502 Bad Gateway: ${err.message}`);
    }
  });

  req.on("data", (chunk: Buffer) => proxyReq.write(chunk));
  req.on("end", () => proxyReq.end());
}

// HTTPS CONNECT 隧道代理

function handleConnect(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
): void {
  const startTime = Date.now();
  const [hostnameRaw, portStr] = (req.url || "").split(":");
  const hostname = hostnameRaw || "";
  const port = parseInt(portStr, 10) || 443;

  if (!checkAuth(req)) {
    socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n");
    socket.write('Proxy-Authenticate: Basic realm="Proxy Server"\r\n');
    socket.write("\r\n");
    socket.end();
    return;
  }

  if (shouldBlock(hostname, "")) {
    const duration = Date.now() - startTime;
    recordRequest({
      method: "CONNECT",
      requestUrl: req.url || "",
      hostname,
      statusCode: 403,
      duration,
      blocked: true,
      cached: false,
      log: `[${now()}] 拦截: CONNECT ${req.url} (域名已被屏蔽)`,
    });
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.end();
    return;
  }

  console.log(`[${now()}] 隧道: CONNECT ${hostname}:${port}`);

  const targetSocket = net.connect(port, hostname, () => {
    const duration = Date.now() - startTime;
    recordRequest({
      method: "CONNECT",
      requestUrl: req.url || "",
      hostname,
      statusCode: 200,
      duration,
      blocked: false,
      cached: false,
    });
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) targetSocket.write(head);
    targetSocket.pipe(socket);
    socket.pipe(targetSocket);
  });

  targetSocket.on("error", (err: Error) => {
    const tunnelErr = new ProxyTunnelError(err.message);
    console.error(
      `[${now()}] 隧道错误: ${tunnelErr.code} ${tunnelErr.message}`,
    );
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.end();
  });

  socket.on("error", (err: Error) => {
    console.error(`[${now()}] 客户端隧道错误: ${err.message}`);
    targetSocket.destroy();
  });
}

// 管理面板

const PAGE_STYLE = `body{font-family:"Microsoft YaHei",sans-serif;max-width:900px;margin:40px auto;padding:0 20px;background:#f5f5f5}h1{color:#333;border-bottom:2px solid #4CAF50;padding-bottom:10px}.card{background:#fff;border-radius:8px;padding:20px;margin:15px 0;box-shadow:0 2px 4px rgba(0,0,0,.1)}nav a{display:inline-block;padding:8px 16px;margin:4px;background:#4CAF50;color:#fff;text-decoration:none;border-radius:4px}nav a:hover{background:#45a049}table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #ddd;font-size:.9em}th{background:#f0f0f0}.blocked{color:#f44336;font-weight:bold}.cached{color:#2196F3}.stat{display:inline-block;width:22%;text-align:center;margin:10px 1%}.stat .number{font-size:2em;font-weight:bold;color:#4CAF50}.stat .label{color:#666;font-size:.9em}.success{color:#4CAF50;font-size:1.2em}`;

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title} - 代理服务器</title><style>${PAGE_STYLE}</style></head><body><h1>${title}</h1>${body}</body></html>`;
}

const NAV_LINKS = `<nav><a href="?action=index">首页</a><a href="?action=stats">请求统计</a><a href="?action=logs">请求日志</a><a href="?action=cache">缓存内容</a><a href="?action=blocklist">黑名单</a><a href="?action=allowlist">白名单</a><a href="?action=cache_clear">清除缓存</a></nav>`;

function handleAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const parsedUrl = url.parse(req.url || "", true);
  const action = (parsedUrl.query.action as string) || "index";
  let html = "";
  switch (action) {
    case "stats":
      html = renderStats();
      break;
    case "cache":
      html = renderCache();
      break;
    case "cache_clear":
      cache.clear();
      html = renderMessage("缓存已清除", "cache");
      break;
    case "blocklist":
      html = renderList("黑名单", config.blocklist);
      break;
    case "allowlist":
      html = renderList("白名单", config.allowlist);
      break;
    case "logs":
      html = renderLogs();
      break;
    default:
      html = renderIndex();
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderIndex(): string {
  const body =
    `${NAV_LINKS}<div class="card"><h2>服务器概览</h2>` +
    `<div class="stat"><div class="number">${stats.totalRequests}</div><div class="label">总请求数</div></div>` +
    `<div class="stat"><div class="number">${stats.blockedRequests}</div><div class="label">拦截请求</div></div>` +
    `<div class="stat"><div class="number">${stats.cachedHits}</div><div class="label">缓存命中</div></div>` +
    `<div class="stat"><div class="number">${cache.size}</div><div class="label">缓存条目</div></div></div>` +
    `<div class="card"><h2>最近请求</h2>${renderRecentLogsTable(10)}</div>` +
    `<footer>${SERVER_INFO.name} v${SERVER_INFO.version} | 端口 ${config.port} | 模式 ${configManager.mode}</footer>`;
  return renderPage("代理服务器管理面板", body);
}

function renderStats(): string {
  const topDomains = Array.from(stats.domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  let rows = "";
  for (const [domain, count] of topDomains)
    rows += `<tr><td>${domain}</td><td>${count}</td></tr>`;
  const body =
    `<nav><a href="?action=index">返回首页</a></nav>` +
    `<div class="card"><h2>总览</h2><p>总请求数: ${stats.totalRequests}</p><p>拦截请求: ${stats.blockedRequests}</p>` +
    `<p>缓存命中: ${stats.cachedHits}</p><p>缓存状态: ${stats.cacheState}</p><p>缓存条目: ${cache.size}</p></div>` +
    `<div class="card"><h2>域名请求排行 (Top 20)</h2><table><tr><th>域名</th><th>请求次数</th></tr>${rows || '<tr><td colspan="2">暂无数据</td></tr>'}</table></div>`;
  return renderPage("请求统计", body);
}

function renderCache(): string {
  let rows = "";
  for (const [key, entry] of cache) {
    const remaining = Math.max(
      0,
      Math.round((entry.expiresAt - Date.now()) / 1000),
    );
    const shortKey = key.length > 60 ? key.substring(0, 60) + "..." : key;
    rows += `<tr><td>${shortKey}</td><td>${entry.statusCode}</td><td>${(entry.body.length / 1024).toFixed(1)} KB</td><td>${remaining}s</td></tr>`;
  }
  const body =
    `<nav><a href="?action=index">返回首页</a> <a href="?action=cache_clear">清除缓存</a></nav>` +
    `<div class="card"><p>缓存条目: ${cache.size} / ${config.cacheMaxSize} | 缓存有效期: ${config.cacheTTL / 1000}s</p>` +
    `<table><tr><th>缓存 Key</th><th>状态码</th><th>大小</th><th>剩余有效期</th></tr>${rows || '<tr><td colspan="4">缓存为空</td></tr>'}</table></div>`;
  return renderPage("缓存内容", body);
}

function renderList(title: string, list: Set<string>): string {
  let items = "";
  for (const item of list) items += `<tr><td>${item}</td></tr>`;
  const body = `<nav><a href="?action=index">返回首页</a></nav><div class="card"><table><tr><th>域名</th></tr>${items || "<tr><td>列表为空</td></tr>"}</table></div>`;
  return renderPage(title, body);
}

function renderLogs(): string {
  const body = `<nav><a href="?action=index">返回首页</a></nav><div class="card">${renderRecentLogsTable(50)}</div>`;
  return renderPage("请求日志", body);
}

function renderRecentLogsTable(count: number): string {
  const recentLogs = requestLogs.slice(-count).reverse();
  let rows = "";
  for (const log of recentLogs) {
    const flags: string[] = [];
    if (log.blocked) flags.push('<span class="blocked">已拦截</span>');
    if (log.cached) flags.push('<span class="cached">缓存</span>');
    const truncatedUrl =
      log.url.length > 60 ? log.url.substring(0, 60) + "..." : log.url;
    rows += `<tr><td>${log.timestamp}</td><td>${log.method}</td><td title="${log.url}">${truncatedUrl}</td><td>${log.statusCode}</td><td>${log.duration}ms</td><td>${flags.join(" ") || "-"}</td></tr>`;
  }
  return `<table><tr><th>时间</th><th>方法</th><th>URL</th><th>状态码</th><th>耗时</th><th>标记</th></tr>${rows || '<tr><td colspan="6">暂无日志</td></tr>'}</table>`;
}

function renderMessage(message: string, backAction: string): string {
  const body = `<div class="card"><p class="success">${message}</p></div><nav><a href="?action=${backAction}">返回</a> <a href="?action=index">首页</a></nav>`;
  return renderPage("操作结果", body);
}

// 主函数（CLI 入口）

function main(): void {
  if (config.mode) configManager.mode = config.mode;

  const server = http.createServer((req, res) => handleHttpRequest(req, res));

  server.on(
    "connect",
    (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      handleConnect(req, socket, head);
    },
  );

  server.listen(config.port, config.host, () => {
    console.log("========================================");
    console.log("  简易 HTTP/HTTPS 代理服务器已启动");
    console.log(`  代理地址: ${config.host}:${config.port}`);
    console.log(
      `  管理面板: http://${config.host}:${config.port}${config.adminPath}`,
    );
    console.log("========================================");
    console.log(
      `  缓存: ${config.cacheEnabled ? "已启用" : "已禁用"} (TTL: ${config.cacheTTL / 1000}s)`,
    );
    console.log(`  黑名单: ${config.blocklist.size} 个域名`);
    console.log(`  白名单模式: ${config.allowlistMode ? "已启用" : "已禁用"}`);
    console.log(`  认证: ${config.auth ? "已启用" : "已禁用"}`);
    console.log(`  运行模式: ${configManager.mode}`);
    console.log("========================================");
    console.log("  使用方法:");
    console.log("  1. 配置浏览器代理为 127.0.0.1:8888");
    console.log("  2. 或使用 curl 测试:");
    console.log(
      `     curl -x http://${config.host}:${config.port} http://example.com`,
    );
    console.log("========================================");
  });

  server.on("error", (err: Error) => {
    console.error(`[${now()}] 服务器错误: ${err.message}`);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    console.log(`\n[${now()}] 正在关闭代理服务器...`);
    server.close(() => {
      console.log(`[${now()}] 代理服务器已关闭`);
      process.exit(0);
    });
    setTimeout(() => {
      console.error(`[${now()}] 强制退出`);
      process.exit(1);
    }, 5000);
  });
}

main();
