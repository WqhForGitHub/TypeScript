#!/usr/bin/env node
/**
 * 简单 HTTP 请求库 (Simple HTTP Client) - Enhanced TypeScript Edition
 * 基于 Node.js 内置 http/https 模块封装的 Promise 风格 HTTP 客户端。
 * 仅依赖内置模块: http, https, url, querystring, fs, path.
 *
 * TypeScript 特性: 字符串枚举 / 可辨识联合 / 泛型类(约束) / 抽象类 /
 * 映射类型 / 自定义错误层级 / 索引签名 / satisfies / as const /
 * Symbol / 生成器 / 迭代器 / getter-setter / 类型守卫 / 函数重载.
 */
import http from "http";
import https from "https";
import { URL } from "url";
import qs from "querystring";
import fs from "fs";
import path from "path";

// ===================== Enums =====================
export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}
export enum HttpStatus {
  OK = 200,
  Created = 201,
  Accepted = 202,
  NoContent = 204,
  MovedPermanently = 301,
  Found = 302,
  SeeOther = 303,
  NotModified = 304,
  TemporaryRedirect = 307,
  PermanentRedirect = 308,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  MethodNotAllowed = 405,
  InternalServerError = 500,
  BadGateway = 502,
  ServiceUnavailable = 503,
}
export enum ErrorCode {
  Timeout = "ETIMEOUT",
  Network = "ENETWORK",
  Redirect = "EREDIRECT",
  Aborted = "EABORTED",
  Parse = "EPARSE",
  Http = "EHTTP",
  InvalidUrl = "EINVALIDURL",
}
export enum Protocol {
  HTTP = "http:",
  HTTPS = "https:",
}
export enum ContentType {
  Json = "application/json",
  Form = "application/x-www-form-urlencoded",
  Text = "text/plain",
  Html = "text/html",
  Binary = "application/octet-stream",
  MultiPart = "multipart/form-data",
}

// ===================== Symbols / 映射类型 =====================
const HANDLER_KIND = Symbol("handlerKind");
const REQUEST_TAG = Symbol("requestTag");
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ===================== 接口 =====================
export interface Identifiable {
  readonly id: string | number;
}
export interface HttpClientOptions {
  readonly baseURL?: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly timeout?: number;
  readonly retry?: number;
  readonly maxRedirects?: number;
}
export interface RequestConfig {
  readonly url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | string[]>;
  body?: string | Buffer | object;
  json?: boolean;
  form?: Record<string, string | number>;
  timeout?: number;
  retry?: number;
  retryDelay?: number;
  maxRedirects?: number;
  auth?: { readonly username: string; readonly password: string };
  responseType?: "text" | "json" | "buffer";
  onProgress?: (received: number, total: number | null) => void;
}
export interface ResponseMeta {
  readonly requestId: number;
  readonly durationMs: number;
  readonly attempts: number;
  readonly redirectCount: number;
  [key: string]: string | number | boolean | undefined; // 索引签名
}
interface BaseResponse {
  readonly type: "text" | "json" | "binary" | "error";
  readonly status: number;
  readonly statusText: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly config: Readonly<RequestConfig>;
  readonly meta: ResponseMeta;
}
export interface TextResponse extends BaseResponse {
  readonly type: "text";
  readonly data: string;
}
export interface JsonResponse extends BaseResponse {
  readonly type: "json";
  readonly data: unknown;
}
export interface BinaryResponse extends BaseResponse {
  readonly type: "binary";
  readonly data: Buffer;
}
export interface ErrorResponse extends BaseResponse {
  readonly type: "error";
  readonly error: HttpError;
  readonly data: Buffer;
}
/** 可辨识联合 */
export type HttpResponse =
  TextResponse | JsonResponse | BinaryResponse | ErrorResponse;
export type SuccessResponse = TextResponse | JsonResponse | BinaryResponse;
export type RequestInterceptor = (
  config: RequestConfig,
) => RequestConfig | Promise<RequestConfig>;
export type ResponseInterceptor = (
  resp: HttpResponse,
) => HttpResponse | Promise<HttpResponse>;
export interface BenchmarkResult {
  readonly url: string;
  readonly total: number;
  readonly success: number;
  readonly failed: number;
  readonly totalTimeMs: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly rps: number;
}
export interface QueuedRequest extends Identifiable {
  readonly id: number;
  readonly method: HttpMethod;
  readonly url: string;
  readonly startedAt: number;
  [REQUEST_TAG]: number;
}

// ===================== 自定义错误层级 =====================
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly response?: HttpResponse;
  constructor(
    message: string,
    code: ErrorCode,
    status?: number,
    response?: HttpResponse,
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.response = response;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
  get isClientError(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500;
  }
  get isServerError(): boolean {
    return this.status !== undefined && this.status >= 500;
  }
}

// ===================== 类型守卫 =====================
export function isTextResponse(r: HttpResponse): r is TextResponse {
  return r.type === "text";
}
export function isJsonResponse(r: HttpResponse): r is JsonResponse {
  return r.type === "json";
}
export function isBinaryResponse(r: HttpResponse): r is BinaryResponse {
  return r.type === "binary";
}
export function isErrorResponse(r: HttpResponse): r is ErrorResponse {
  return r.type === "error";
}
export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}

// ===================== 常量 (as const / satisfies) =====================
const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;
const METHOD_TO_GET_ON_REDIRECT = [301, 302, 303] as const;
const DEFAULT_CONFIG = { timeout: 15000, retry: 0, maxRedirects: 5 } as const;
const DEFAULT_HEADERS = {
  Accept: "*/*",
  "User-Agent": "simple-http/1.0",
} satisfies Record<string, string>;
const STATUS_TEXT_MAP: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.OK]: "OK",
  [HttpStatus.Created]: "Created",
  [HttpStatus.NoContent]: "No Content",
  [HttpStatus.NotFound]: "Not Found",
  [HttpStatus.InternalServerError]: "Internal Server Error",
};

// ===================== 工具函数 (函数重载) =====================
export function queryString(
  obj: Record<string, string | number | boolean | string[]>,
): string {
  return qs.encode(obj as qs.ParsedUrlQueryInput);
}
export function basicAuth(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}
export function mergeHeaders(
  target: Record<string, string>,
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string>;
export function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string>;
export function mergeHeaders(
  target?: Record<string, string>,
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const result: Record<string, string> = { ...(target || {}) };
  for (const s of sources) if (s) Object.assign(result, s);
  return result;
}
export function buildUrl(base: string, pathSegment?: string): string;
export function buildUrl(
  base: string,
  query: Record<string, string | number | boolean>,
): string;
export function buildUrl(
  base: string,
  pathOrQuery?: string | Record<string, string | number | boolean>,
): string {
  if (typeof pathOrQuery === "string")
    return base.replace(/\/$/, "") + "/" + pathOrQuery.replace(/^\//, "");
  if (pathOrQuery && typeof pathOrQuery === "object") {
    const q = queryString(pathOrQuery);
    return q ? `${base}${base.includes("?") ? "&" : "?"}${q}` : base;
  }
  return base;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function statusText(status: number, fallback: string): string {
  return fallback || STATUS_TEXT_MAP[status as HttpStatus] || "";
}
function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.includes(status as 301 | 302 | 303 | 307 | 308);
}

// ===================== 泛型请求队列 (带约束) =====================
export class RequestQueue<T extends Identifiable> {
  private _items: T[] = [];
  private _maxSize: number;
  constructor(maxSize: number = 100) {
    if (maxSize <= 0) throw new Error("maxSize must be positive");
    this._maxSize = maxSize;
  }
  enqueue(item: T): boolean {
    if (this._items.length >= this._maxSize) return false;
    this._items.push(item);
    return true;
  }
  dequeue(): T | undefined {
    return this._items.shift();
  }
  remove(id: string | number): T | undefined {
    const idx = this._items.findIndex((i) => i.id === id);
    return idx === -1 ? undefined : this._items.splice(idx, 1)[0];
  }
  find(id: string | number): T | undefined {
    return this._items.find((i) => i.id === id);
  }
  /** 生成器 */
  *iterate(): Generator<T, void, undefined> {
    for (const item of this._items) yield item;
  }
  /** 迭代器协议 */
  [Symbol.iterator](): Iterator<T> {
    let index = 0;
    const items = this._items;
    return {
      next(): IteratorResult<T> {
        if (index < items.length) return { value: items[index++], done: false };
        return { value: undefined as never, done: true };
      },
    };
  }
  get size(): number {
    return this._items.length;
  }
  get maxSize(): number {
    return this._maxSize;
  }
  set maxSize(value: number) {
    if (value <= 0) throw new Error("maxSize must be positive");
    this._maxSize = value;
  }
  get isEmpty(): boolean {
    return this._items.length === 0;
  }
}

// ===================== 抽象处理器 + 具体子类 =====================
export abstract class AbstractRequestHandler {
  abstract readonly protocol: Protocol;
  protected readonly [HANDLER_KIND]: string = "abstract";
  abstract createRequest(options: http.RequestOptions): http.ClientRequest;
  canHandle(protocol: Protocol): boolean {
    return this.protocol === protocol;
  }
  protected defaultPort(): number {
    return this.protocol === Protocol.HTTPS ? 443 : 80;
  }
  protected prepareOptions(
    target: URL,
    config: RequestConfig,
    headers: Record<string, string>,
  ): http.RequestOptions {
    return {
      method: config.method || HttpMethod.GET,
      hostname: target.hostname,
      port: target.port || this.defaultPort(),
      path: target.pathname + target.search,
      headers,
    };
  }
  /** 公开入口：组装选项并创建请求 */
  buildRequest(
    target: URL,
    config: RequestConfig,
    headers: Record<string, string>,
  ): http.ClientRequest {
    return this.createRequest(this.prepareOptions(target, config, headers));
  }
}
export class HttpHandler extends AbstractRequestHandler {
  readonly protocol = Protocol.HTTP;
  protected readonly [HANDLER_KIND] = "http";
  createRequest(options: http.RequestOptions): http.ClientRequest {
    return http.request(options);
  }
}
export class HttpsHandler extends AbstractRequestHandler {
  readonly protocol = Protocol.HTTPS;
  protected readonly [HANDLER_KIND] = "https";
  createRequest(options: http.RequestOptions): http.ClientRequest {
    return https.request(options);
  }
}

// ===================== HTTP 客户端 =====================
export class HttpClient {
  private _baseURL: string | undefined;
  private readonly _defaultHeaders: Record<string, string>;
  private _defaultTimeout: number;
  private _defaultRetry: number;
  private _defaultMaxRedirects: number;
  private readonly _reqInterceptors: RequestInterceptor[] = [];
  private readonly _resInterceptors: ResponseInterceptor[] = [];
  private readonly _handlers: Record<Protocol, AbstractRequestHandler>;
  private readonly _activeQueue: RequestQueue<QueuedRequest> =
    new RequestQueue<QueuedRequest>(1000);
  private _nextId = 0;

  constructor(options: HttpClientOptions = {}) {
    this._baseURL = options.baseURL;
    this._defaultHeaders = options.defaultHeaders || { ...DEFAULT_HEADERS };
    this._defaultTimeout = options.timeout ?? DEFAULT_CONFIG.timeout;
    this._defaultRetry = options.retry ?? DEFAULT_CONFIG.retry;
    this._defaultMaxRedirects =
      options.maxRedirects ?? DEFAULT_CONFIG.maxRedirects;
    this._handlers = {
      [Protocol.HTTP]: new HttpHandler(),
      [Protocol.HTTPS]: new HttpsHandler(),
    };
  }
  get baseURL(): string | undefined {
    return this._baseURL;
  }
  set baseURL(value: string | undefined) {
    if (value !== undefined && !/^https?:\/\//i.test(value))
      throw new Error("baseURL 必须以 http:// 或 https:// 开头");
    this._baseURL = value;
  }
  get activeCount(): number {
    return this._activeQueue.size;
  }

  useInterceptor(req?: RequestInterceptor, res?: ResponseInterceptor): this {
    if (req) this._reqInterceptors.push(req);
    if (res) this._resInterceptors.push(res);
    return this;
  }
  get(
    url: string,
    config: Partial<RequestConfig> = {},
  ): Promise<SuccessResponse> {
    return this.request({ ...config, url, method: HttpMethod.GET });
  }
  post(
    url: string,
    body?: unknown,
    config: Partial<RequestConfig> = {},
  ): Promise<SuccessResponse> {
    return this.request({
      ...config,
      url,
      method: HttpMethod.POST,
      body: body as RequestConfig["body"],
    });
  }
  put(
    url: string,
    body?: unknown,
    config: Partial<RequestConfig> = {},
  ): Promise<SuccessResponse> {
    return this.request({
      ...config,
      url,
      method: HttpMethod.PUT,
      body: body as RequestConfig["body"],
    });
  }
  delete(
    url: string,
    config: Partial<RequestConfig> = {},
  ): Promise<SuccessResponse> {
    return this.request({ ...config, url, method: HttpMethod.DELETE });
  }
  patch(
    url: string,
    body?: unknown,
    config: Partial<RequestConfig> = {},
  ): Promise<SuccessResponse> {
    return this.request({
      ...config,
      url,
      method: HttpMethod.PATCH,
      body: body as RequestConfig["body"],
    });
  }

  async stream(
    url: string,
    config: Partial<RequestConfig> = {},
  ): Promise<http.IncomingMessage> {
    const full = await this.prepareConfig({ ...config, url });
    return this.execStream(full, 0);
  }
  async download(
    url: string,
    file: string,
    config: Partial<RequestConfig> = {},
  ): Promise<void> {
    const full = await this.prepareConfig({ ...config, url });
    const stream = await this.execStream(full, 0);
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      stream.pipe(out);
      out.on("finish", () => resolve());
      out.on("error", reject);
      stream.on("error", reject);
    });
  }
  async benchmark(url: string, count: number): Promise<BenchmarkResult> {
    const times: number[] = [];
    let success = 0,
      failed = 0;
    const start = Date.now();
    for (let i = 0; i < count; i++) {
      const t0 = Date.now();
      try {
        await this.get(url, { retry: 0, maxRedirects: 3 });
        times.push(Date.now() - t0);
        success++;
      } catch {
        failed++;
      }
    }
    const total = Date.now() - start;
    const avg = times.length
      ? times.reduce((a, b) => a + b, 0) / times.length
      : 0;
    const min = times.length ? Math.min(...times) : 0;
    const max = times.length ? Math.max(...times) : 0;
    return {
      url,
      total: count,
      success,
      failed,
      totalTimeMs: total,
      avgMs: Math.round(avg * 100) / 100,
      minMs: min,
      maxMs: max,
      rps: total > 0 ? Math.round((count / total) * 1000 * 100) / 100 : 0,
    };
  }

  /** 核心请求方法 (出错时抛出 HttpError) */
  async request(config: RequestConfig): Promise<SuccessResponse> {
    const start = Date.now();
    const full = await this.prepareConfig(config);
    const maxRetry = full.retry ?? this._defaultRetry;
    const reqId = ++this._nextId;
    this._activeQueue.enqueue({
      id: reqId,
      method: full.method || HttpMethod.GET,
      url: full.url,
      startedAt: start,
      [REQUEST_TAG]: reqId,
    });
    let lastErr: Error | null = null;
    try {
      for (let attempt = 0; attempt <= maxRetry; attempt++) {
        const attempts = attempt + 1;
        try {
          const resp = await this.execOnce(full, 0, reqId, start, attempts);
          return (await this.applyResponseInterceptors(
            resp,
          )) as SuccessResponse;
        } catch (err) {
          lastErr = err as Error;
          if (attempt < maxRetry)
            await sleep(full.retryDelay ?? 500 * (attempt + 1));
        }
      }
      throw lastErr ?? new HttpError("请求失败", ErrorCode.Http);
    } finally {
      this._activeQueue.remove(reqId);
    }
  }

  /** 安全变体：出错时返回 ErrorResponse 而非抛出 */
  async requestSafe(config: RequestConfig): Promise<HttpResponse> {
    try {
      return await this.request(config);
    } catch (e) {
      const err =
        e instanceof HttpError
          ? e
          : new HttpError((e as Error).message, ErrorCode.Network);
      if (err.response) return err.response;
      const resp: ErrorResponse = {
        type: "error",
        status: err.status ?? 0,
        statusText: "",
        headers: {},
        config,
        meta: { requestId: -1, durationMs: 0, attempts: 1, redirectCount: 0 },
        error: err,
        data: Buffer.alloc(0),
      };
      return resp;
    }
  }

  /** 生成器：遍历当前活跃请求 */
  *activeRequests(): Generator<QueuedRequest> {
    yield* this._activeQueue.iterate();
  }

  private async prepareConfig(config: RequestConfig): Promise<RequestConfig> {
    let full: Mutable<RequestConfig> = {
      url: config.url,
      method: config.method,
      headers: mergeHeaders(this._defaultHeaders, config.headers),
      query: config.query,
      body: config.body,
      json: config.json,
      form: config.form,
      timeout: config.timeout ?? this._defaultTimeout,
      retry: config.retry ?? this._defaultRetry,
      retryDelay: config.retryDelay,
      maxRedirects: config.maxRedirects ?? this._defaultMaxRedirects,
      auth: config.auth,
      responseType: config.responseType,
      onProgress: config.onProgress,
    };
    if (this._baseURL && !/^https?:\/\//i.test(full.url))
      full.url = buildUrl(this._baseURL, full.url);
    for (const fn of this._reqInterceptors)
      full = (await fn(full)) as Mutable<RequestConfig>;
    return full;
  }
  private async applyResponseInterceptors(
    resp: HttpResponse,
  ): Promise<HttpResponse> {
    let r = resp;
    for (const fn of this._resInterceptors) r = await fn(r);
    return r;
  }
  private selectHandler(protocol: string): AbstractRequestHandler {
    if (protocol === Protocol.HTTP) return this._handlers[Protocol.HTTP];
    if (protocol === Protocol.HTTPS) return this._handlers[Protocol.HTTPS];
    throw new HttpError(`不支持的协议: ${protocol}`, ErrorCode.InvalidUrl);
  }

  private execOnce(
    config: RequestConfig,
    redirectCount: number,
    reqId: number,
    start: number,
    attempts: number,
  ): Promise<SuccessResponse> {
    return new Promise<SuccessResponse>((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(config.url);
      } catch {
        return reject(
          new HttpError(`无效的 URL: ${config.url}`, ErrorCode.InvalidUrl),
        );
      }
      if (config.query) {
        const q = queryString(config.query);
        if (q)
          target.search = target.search ? `${target.search}&${q}` : `?${q}`;
      }
      let bodyData: Buffer | null = null;
      const headers: Record<string, string> = { ...(config.headers || {}) };
      if (config.form) {
        bodyData = Buffer.from(queryString(config.form));
        headers["Content-Type"] = ContentType.Form;
        headers["Content-Length"] = String(bodyData.length);
      } else if (config.json && config.body !== undefined) {
        bodyData = Buffer.from(JSON.stringify(config.body));
        headers["Content-Type"] = ContentType.Json;
        headers["Content-Length"] = String(bodyData.length);
      } else if (typeof config.body === "string") {
        bodyData = Buffer.from(config.body);
        headers["Content-Length"] = String(bodyData.length);
      } else if (Buffer.isBuffer(config.body)) {
        bodyData = config.body;
        headers["Content-Length"] = String(bodyData.length);
      }
      if (config.auth)
        headers["Authorization"] = basicAuth(
          config.auth.username,
          config.auth.password,
        );

      let handler: AbstractRequestHandler;
      try {
        handler = this.selectHandler(target.protocol);
      } catch (e) {
        return reject(e as Error);
      }
      const req = handler.buildRequest(target, config, headers);

      req.on("error", (err: Error) =>
        err instanceof HttpError
          ? reject(err)
          : reject(new HttpError(err.message, ErrorCode.Network)),
      );
      if (config.timeout && config.timeout > 0) {
        req.setTimeout(config.timeout, () =>
          req.destroy(
            new HttpError(`请求超时 (${config.timeout}ms)`, ErrorCode.Timeout),
          ),
        );
      }

      req.on("response", (res: http.IncomingMessage) => {
        const status = res.statusCode || 0;
        if (isRedirectStatus(status) && res.headers.location) {
          res.resume();
          if (
            redirectCount >= (config.maxRedirects ?? this._defaultMaxRedirects)
          ) {
            return reject(
              new HttpError(
                `超过最大重定向次数: ${config.maxRedirects}`,
                ErrorCode.Redirect,
              ),
            );
          }
          const nextConfig: RequestConfig = {
            ...config,
            url: new URL(res.headers.location, target).toString(),
          };
          if (METHOD_TO_GET_ON_REDIRECT.includes(status as 301 | 302 | 303)) {
            nextConfig.method = HttpMethod.GET;
            nextConfig.body = undefined;
            delete nextConfig.form;
            delete nextConfig.json;
          }
          return resolve(
            this.execOnce(
              nextConfig,
              redirectCount + 1,
              reqId,
              start,
              attempts,
            ),
          );
        }

        const chunks: Buffer[] = [];
        const totalHeader = res.headers["content-length"];
        const total = totalHeader ? parseInt(totalHeader, 10) : null;
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          received += chunk.length;
          if (config.onProgress) config.onProgress(received, total);
        });
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const meta: ResponseMeta = {
            requestId: reqId,
            durationMs: Date.now() - start,
            attempts,
            redirectCount,
          };
          const common = {
            status,
            statusText: statusText(status, res.statusMessage || ""),
            headers: res.headers,
            config,
            meta,
          };
          if (status >= 400) {
            return reject(
              new HttpError(
                `HTTP 错误: ${status} ${res.statusMessage}`,
                ErrorCode.Http,
                status,
              ),
            );
          }
          const ct = (res.headers["content-type"] || "").toLowerCase();
          const rt = config.responseType;
          if (
            rt === "json" ||
            (ct.includes(ContentType.Json.toLowerCase()) && rt !== "buffer")
          ) {
            try {
              const parsed: unknown = JSON.parse(buf.toString("utf8"));
              return resolve({
                ...common,
                type: "json",
                data: parsed,
              } as JsonResponse);
            } catch {
              return resolve({
                ...common,
                type: "text",
                data: buf.toString("utf8"),
              } as TextResponse);
            }
          }
          if (rt === "buffer")
            return resolve({
              ...common,
              type: "binary",
              data: buf,
            } as BinaryResponse);
          return resolve({
            ...common,
            type: "text",
            data: buf.toString("utf8"),
          } as TextResponse);
        });
        res.on("error", (err: Error) =>
          reject(new HttpError(err.message, ErrorCode.Network)),
        );
      });

      if (bodyData) req.write(bodyData);
      req.end();
    });
  }

  private execStream(
    config: RequestConfig,
    redirectCount: number,
  ): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(config.url);
      } catch {
        return reject(
          new HttpError(`无效的 URL: ${config.url}`, ErrorCode.InvalidUrl),
        );
      }
      if (config.query) {
        const q = queryString(config.query);
        if (q)
          target.search = target.search ? `${target.search}&${q}` : `?${q}`;
      }
      const headers: Record<string, string> = { ...(config.headers || {}) };
      if (config.auth)
        headers["Authorization"] = basicAuth(
          config.auth.username,
          config.auth.password,
        );

      let handler: AbstractRequestHandler;
      try {
        handler = this.selectHandler(target.protocol);
      } catch (e) {
        return reject(e as Error);
      }
      const req = handler.buildRequest(target, config, headers);
      req.on("error", (err: Error) =>
        err instanceof HttpError
          ? reject(err)
          : reject(new HttpError(err.message, ErrorCode.Network)),
      );
      req.on("response", (res: http.IncomingMessage) => {
        const status = res.statusCode || 0;
        if (isRedirectStatus(status) && res.headers.location) {
          res.resume();
          if (
            redirectCount >= (config.maxRedirects ?? this._defaultMaxRedirects)
          ) {
            return reject(
              new HttpError("超过最大重定向次数", ErrorCode.Redirect),
            );
          }
          return resolve(
            this.execStream(
              {
                ...config,
                url: new URL(res.headers.location, target).toString(),
              },
              redirectCount + 1,
            ),
          );
        }
        if (status >= 400)
          return reject(
            new HttpError(`HTTP 错误: ${status}`, ErrorCode.Http, status),
          );
        resolve(res);
      });
      if (config.timeout && config.timeout > 0) {
        req.setTimeout(config.timeout, () =>
          req.destroy(new HttpError("流式请求超时", ErrorCode.Timeout)),
        );
      }
      req.end();
    });
  }
}

// ===================== 命令行 =====================
function parseArgs(argv: string[]): {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let cmd = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-H")) flags["H"] = argv[++i];
    else if (a.startsWith("-q")) flags["q"] = argv[++i];
    else if (a.startsWith("-d")) flags["d"] = argv[++i];
    else if (a === "-j") flags["j"] = true;
    else if (a.startsWith("-o")) flags["o"] = argv[++i];
    else if (a.startsWith("-n")) flags["n"] = argv[++i];
    else if (!cmd) cmd = a;
    else positional.push(a);
  }
  return { cmd, positional, flags };
}

function printResponse(resp: SuccessResponse): void {
  console.log(`状态: ${resp.status} ${resp.statusText}`);
  console.log("响应头:", resp.headers);
  console.log("响应体:");
  if (isTextResponse(resp)) console.log(resp.data);
  else if (isJsonResponse(resp))
    console.log(JSON.stringify(resp.data, null, 2));
  else if (isBinaryResponse(resp))
    console.log(`<binary ${resp.data.length} bytes>`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    return;
  }
  const { cmd, positional, flags } = parseArgs(argv);
  const client = new HttpClient({ timeout: 20000, retry: 1 });
  try {
    switch (cmd) {
      case "get": {
        const url = positional[0];
        if (!url) return printHelp();
        const headers: Record<string, string> = {};
        if (typeof flags["H"] === "string") {
          const [k, v] = flags["H"].split(":");
          if (k && v) headers[k.trim()] = v.trim();
        }
        const query: Record<string, string> = {};
        if (typeof flags["q"] === "string") {
          const [k, v] = flags["q"].split("=");
          if (k && v) query[k] = v;
        }
        printResponse(await client.get(url, { headers, query }));
        break;
      }
      case "post": {
        const url = positional[0];
        if (!url) return printHelp();
        const data = typeof flags["d"] === "string" ? flags["d"] : "";
        let body: unknown = data;
        if (flags["j"]) {
          try {
            body = JSON.parse(data);
          } catch {
            /* 保留原始字符串 */
          }
        }
        printResponse(await client.post(url, body, { json: !!flags["j"] }));
        break;
      }
      case "download": {
        const url = positional[0];
        if (!url) return printHelp();
        let out = typeof flags["o"] === "string" ? flags["o"] : "";
        if (!out) {
          try {
            out = path.basename(new URL(url).pathname) || "download.bin";
          } catch {
            out = "download.bin";
          }
        }
        console.log(`正在下载 ${url} -> ${out}`);
        await client.download(url, out, {
          onProgress: (r, t) => {
            const pct = t ? Math.round((r / t) * 100) : 0;
            process.stdout.write(
              `\r已接收: ${r} bytes ${t ? `(${pct}%)` : ""}`,
            );
          },
        });
        console.log("\n下载完成。");
        break;
      }
      case "benchmark": {
        const url = positional[0];
        if (!url) return printHelp();
        const n =
          typeof flags["n"] === "string" ? parseInt(flags["n"], 10) : 10;
        console.log(`对 ${url} 发起 ${n} 次请求...`);
        console.log("基准测试结果:");
        console.log(JSON.stringify(await client.benchmark(url, n), null, 2));
        break;
      }
      default:
        printHelp();
    }
  } catch (err) {
    if (err instanceof HttpError)
      console.error(
        `请求出错 [${err.code}]${err.status ? ` (${err.status})` : ""}:`,
        err.message,
      );
    else console.error("请求出错:", (err as Error).message);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
简单 HTTP 请求库 - 命令行演示

用法:
  get <url> [-H header] [-q key=value]          发起 GET 请求
  post <url> [-d data] [-j]                     发起 POST 请求 (-j 表示 JSON)
  download <url> [-o file]                      下载文件
  benchmark <url> [-n requests]                 基准测试

示例:
  get https://httpbin.org/get -q foo=bar -H "X-Test:1"
  post https://httpbin.org/post -d '{"a":1}' -j
  download https://httpbin.org/bytes/1024 -o test.bin
  benchmark https://httpbin.org/get -n 20
`);
}

main();
