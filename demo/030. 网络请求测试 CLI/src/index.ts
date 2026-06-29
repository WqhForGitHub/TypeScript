#!/usr/bin/env node
/**
 * 网络请求测试 CLI (Network Request Testing CLI) v2.0
 *
 * 类似简易版 curl/HTTPie 的网络请求测试工具，支持 GET/POST/PUT/DELETE/HEAD/PATCH、
 * 文件下载（带进度条）、主机 Ping (TCP 连通性)、批量请求、请求重放，并提供
 * 拦截器链、多种鉴权、重定向、自动重试、Cookie Jar、响应计时分解、JSON 语法高亮等。
 *
 * 该文件演示大量高级 TypeScript 特性：Enums / Discriminated unions / Mapped types /
 * Conditional types / Template literal types / Type guards / Utility types / Tuples /
 * Abstract classes / Function overloads / as const / satisfies / Custom Error hierarchy /
 * Generators / Symbols / Getters / Optional chaining & nullish coalescing.
 */

import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";

// ---- Enums ----
enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  HEAD = "HEAD",
  PATCH = "PATCH",
}
enum ContentType {
  JSON = "application/json",
  FORM = "application/x-www-form-urlencoded",
  MULTIPART = "multipart/form-data",
  TEXT = "text/plain",
  HTML = "text/html",
  OCTET = "application/octet-stream",
}
enum AuthType {
  NONE = "none",
  BASIC = "basic",
  BEARER = "bearer",
  APIKEY_HEADER = "apikey-header",
  APIKEY_QUERY = "apikey-query",
}
enum OutputFormat {
  RAW = "raw",
  JSON = "json",
  PRETTY = "pretty",
  HEADERS = "headers",
}
enum RequestState {
  IDLE = "idle",
  BUILDING = "building",
  SENDING = "sending",
  REDIRECTING = "redirecting",
  DONE = "done",
  FAILED = "failed",
}
enum RedirectMode {
  FOLLOW = "follow",
  MANUAL = "manual",
  ERROR = "error",
}

// ---- Template literal / Mapped / Conditional / Tuple types ----
type HttpUrl = `http://${string}` | `https://${string}`;
type StatusCode = `${2 | 3 | 4 | 5}${number}`;
type HeaderMap = { [K in string]: string };
type MethodHandler = { [K in HttpMethod]: (a: string[]) => Promise<void> };
type TimingPhases = readonly [
  dns: number,
  connect: number,
  ttfb: number,
  total: number,
];
type FormPair = readonly [string, string];
type BodyOf<M extends HttpMethod> = M extends
  HttpMethod.POST | HttpMethod.PUT | HttpMethod.PATCH
  ? string | undefined
  : undefined;
type IsSuccessCode<C extends number> = C extends 200 | 201 | 202 | 204 | 206
  ? true
  : false;

// ---- Discriminated unions ----
type RequestEvent =
  | { readonly state: RequestState.BUILDING; readonly url: string }
  | { readonly state: RequestState.SENDING; readonly bytes: number }
  | {
      readonly state: RequestState.REDIRECTING;
      readonly to: string;
      readonly code: number;
    }
  | { readonly state: RequestState.DONE; readonly code: number }
  | { readonly state: RequestState.FAILED; readonly reason: string };

type ResponseKind =
  | { readonly kind: "success"; readonly code: number; readonly body: Buffer }
  | {
      readonly kind: "redirect";
      readonly code: number;
      readonly location: string;
    }
  | { readonly kind: "error"; readonly code: number; readonly message: string };

// ---- Generic Result type ----
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ---- Custom Error hierarchy ----
class HttpError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
class NetworkError extends HttpError {
  constructor(msg: string) {
    super(msg);
    this.name = "NetworkError";
  }
}
class TimeoutError extends HttpError {
  constructor(msg = "请求超时") {
    super(msg);
    this.name = "TimeoutError";
  }
}
class DnsError extends HttpError {
  constructor(host: string) {
    super(`DNS 解析失败: ${host}`);
    this.name = "DnsError";
  }
}
class SslError extends HttpError {
  constructor(msg: string) {
    super(msg);
    this.name = "SslError";
  }
}

// ---- Type guards ----
function isHttpMethod(v: string): v is HttpMethod {
  return (Object.values(HttpMethod) as string[]).includes(v);
}
function isSuccess(code: number): code is 200 | 201 | 202 | 204 | 206 {
  return code >= 200 && code < 300;
}
function isRedirectCode(code: number): boolean {
  return [301, 302, 303, 307, 308].includes(code);
}
function isJsonResponse(ct: string | undefined): boolean {
  return !!ct && ct.toLowerCase().includes("json");
}
function isOutputFormat(v: string): v is OutputFormat {
  return (Object.values(OutputFormat) as string[]).includes(v);
}

// ---- Interfaces (readonly/optional/index signature) ----
interface BaseRequestOptions {
  readonly method: HttpMethod;
  readonly headers: HeaderMap;
  data?: string;
  verbose?: boolean;
  timeout?: number;
}
interface HttpRequest<T extends HttpMethod> extends BaseRequestOptions {
  readonly method: T;
  url: HttpUrl | string;
  readonly meta?: Record<string, unknown>;
}
interface ResponseInfo {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Buffer;
  readonly timing: TimingPhases;
  readonly redirects: readonly string[];
}
interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly retryOn: readonly number[];
}
interface CookieEntry {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
}
interface ClientConfig {
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly redirectMode: RedirectMode;
  readonly retry: RetryPolicy;
  readonly verbose: boolean;
}

// ---- as const / satisfies ----
const DEFAULT_RETRY = {
  maxRetries: 0,
  baseDelayMs: 200,
  factor: 2,
  retryOn: [502, 503, 504],
} as const satisfies Readonly<RetryPolicy>;
const DEFAULT_CONFIG = {
  userAgent: "nettest/2.0",
  timeoutMs: 30000,
  maxRedirects: 5,
  redirectMode: RedirectMode.FOLLOW,
  retry: DEFAULT_RETRY,
  verbose: false,
} as const satisfies ClientConfig;
const STATUS_COLORS = {
  success: "\x1b[32m",
  redirect: "\x1b[36m",
  clientError: "\x1b[33m",
  serverError: "\x1b[31m",
  reset: "\x1b[0m",
} as const;
const Colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const;

// ---- Symbol for interceptor chain ----
const INTERCEPTOR_CHAIN = Symbol("interceptor-chain");

// ---- Abstract classes ----
abstract class AbstractInterceptor<T> {
  constructor(protected readonly order = 0) {}
  abstract before(ctx: T): Promise<T> | T;
  abstract after(
    ctx: T,
    res: ResponseInfo,
  ): Promise<ResponseInfo> | ResponseInfo;
}
abstract class AbstractAuth {
  abstract readonly type: AuthType;
  abstract apply(req: HttpRequest<HttpMethod>): HttpRequest<HttpMethod>;
  abstract describe(): string;
}
abstract class AbstractResponseFormatter {
  abstract canHandle(fmt: OutputFormat): boolean;
  abstract format(res: ResponseInfo, fmt: OutputFormat): string;
}

// ---- Auth implementations ----
class BasicAuth extends AbstractAuth {
  readonly type = AuthType.BASIC;
  constructor(
    private readonly user: string,
    private readonly pass: string,
  ) {
    super();
  }
  apply(req: HttpRequest<HttpMethod>): HttpRequest<HttpMethod> {
    const token = Buffer.from(`${this.user}:${this.pass}`).toString("base64");
    return {
      ...req,
      headers: { ...req.headers, Authorization: `Basic ${token}` },
    };
  }
  describe(): string {
    return `Basic(${this.user})`;
  }
}
class BearerAuth extends AbstractAuth {
  readonly type = AuthType.BEARER;
  constructor(private readonly token: string) {
    super();
  }
  apply(req: HttpRequest<HttpMethod>): HttpRequest<HttpMethod> {
    return {
      ...req,
      headers: { ...req.headers, Authorization: `Bearer ${this.token}` },
    };
  }
  describe(): string {
    return "Bearer(***)";
  }
}
class ApiKeyAuth extends AbstractAuth {
  readonly type: AuthType;
  constructor(
    private readonly key: string,
    private readonly value: string,
    type: AuthType.APIKEY_HEADER | AuthType.APIKEY_QUERY,
  ) {
    super();
    this.type = type;
  }
  apply(req: HttpRequest<HttpMethod>): HttpRequest<HttpMethod> {
    if (this.type === AuthType.APIKEY_HEADER)
      return { ...req, headers: { ...req.headers, [this.key]: this.value } };
    const u = new URL(req.url);
    u.searchParams.set(this.key, this.value);
    return { ...req, url: u.toString() as HttpUrl };
  }
  describe(): string {
    return `ApiKey(${this.key})`;
  }
}

// ---- Cookie Jar (with iterator) ----
class CookieJar {
  private readonly store = new Map<string, CookieEntry>();
  add(url: string, name: string, value: string): void {
    const u = new URL(url);
    this.store.set(`${u.hostname}${u.pathname || "/"}:${name}`, {
      name,
      value,
      domain: u.hostname,
      path: u.pathname || "/",
    });
  }
  headerFor(url: string): string {
    const u = new URL(url);
    return [...this.store.values()]
      .filter(
        (c) => u.hostname === c.domain || u.hostname.endsWith(`.${c.domain}`),
      )
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
  clear(): void {
    this.store.clear();
  }
  get size(): number {
    return this.store.size;
  }
  *[Symbol.iterator](): Iterator<CookieEntry> {
    yield* this.store.values();
  }
}

// ---- Request history (with generator) ----
class RequestHistory {
  private readonly items: HttpRequest<HttpMethod>[] = [];
  add(r: HttpRequest<HttpMethod>): void {
    this.items.push(Object.freeze({ ...r }) as HttpRequest<HttpMethod>);
  }
  *iter(): Generator<HttpRequest<HttpMethod>> {
    for (const i of this.items) yield i;
  }
  get length(): number {
    return this.items.length;
  }
  last(): HttpRequest<HttpMethod> | undefined {
    return this.items[this.items.length - 1];
  }
  replay(): HttpRequest<HttpMethod> | undefined {
    const l = this.last();
    return l ? { ...l } : undefined;
  }
}

// ---- Interceptor chain (symbol-keyed) ----
class InterceptorChain<T> {
  [INTERCEPTOR_CHAIN]: AbstractInterceptor<T>[] = [];
  add(i: AbstractInterceptor<T>): this {
    this[INTERCEPTOR_CHAIN].push(i);
    this[INTERCEPTOR_CHAIN].sort((a, b) => a["order"] - b["order"]);
    return this;
  }
  get length(): number {
    return this[INTERCEPTOR_CHAIN].length;
  }
  async runBefore(ctx: T): Promise<T> {
    let c = ctx;
    for (const i of this[INTERCEPTOR_CHAIN]) c = await i.before(c);
    return c;
  }
  async runAfter(ctx: T, res: ResponseInfo): Promise<ResponseInfo> {
    let r = res;
    for (const i of [...this[INTERCEPTOR_CHAIN]].reverse())
      r = await i.after(ctx, r);
    return r;
  }
}

// ---- Helpers ----
function colorStatus(code: number): string {
  if (code >= 200 && code < 300)
    return `${STATUS_COLORS.success}${code}${STATUS_COLORS.reset}`;
  if (code >= 300 && code < 400)
    return `${STATUS_COLORS.redirect}${code}${STATUS_COLORS.reset}`;
  if (code >= 400 && code < 500)
    return `${STATUS_COLORS.clientError}${code}${STATUS_COLORS.reset}`;
  if (code >= 500)
    return `${STATUS_COLORS.serverError}${code}${STATUS_COLORS.reset}`;
  return String(code);
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function mapError(e: Error, host: string): HttpError {
  const msg = e.message ?? "";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return new DnsError(host);
  if (/ETIMEDOUT|timeout/i.test(msg)) return new TimeoutError(msg);
  if (/SSL|CERT|certificate|UNABLE_TO_VERIFY/i.test(msg))
    return new SslError(msg);
  return new NetworkError(msg);
}
function encodeForm(pairs: readonly FormPair[]): string {
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
function encodeMultipart(pairs: readonly FormPair[], boundary: string): string {
  let out = "";
  for (const [k, v] of pairs)
    out += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  return out + `--${boundary}--\r\n`;
}
// Result<T,E> usage: safe JSON parse
function tryParseJson(text: string): Result<unknown, Error> {
  try {
    return ok(JSON.parse(text));
  } catch (e) {
    return fail(e instanceof Error ? e : new Error(String(e)));
  }
}
function classify(res: ResponseInfo): ResponseKind {
  if (
    isRedirectCode(res.statusCode) &&
    typeof res.headers.location === "string"
  ) {
    return {
      kind: "redirect",
      code: res.statusCode,
      location: res.headers.location,
    };
  }
  if (isSuccess(res.statusCode))
    return { kind: "success", code: res.statusCode, body: res.body };
  return { kind: "error", code: res.statusCode, message: res.statusMessage };
}

// ---- HTTP Client ----
class HttpClient {
  private config: ClientConfig;
  readonly cookies = new CookieJar();
  readonly history = new RequestHistory();
  readonly interceptors = new InterceptorChain<HttpRequest<HttpMethod>>();
  private _state: RequestState = RequestState.IDLE;
  private eventLog: RequestEvent[] = [];

  constructor(config: Partial<ClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  get currentState(): RequestState {
    return this._state;
  }
  get events(): readonly RequestEvent[] {
    return this.eventLog;
  }
  setVerbose(v: boolean): void {
    this.config = { ...this.config, verbose: v };
  }
  private record(ev: RequestEvent): void {
    this.eventLog.push(ev);
  }

  // Function overloads: precise typing for body-less vs body-bearing methods,
  // plus a general fallback for callers passing the full HttpMethod union.
  async request<T extends HttpMethod.GET | HttpMethod.HEAD | HttpMethod.DELETE>(
    method: T,
    url: string,
    opts?: Partial<Omit<HttpRequest<T>, "method" | "url">>,
  ): Promise<ResponseInfo>;
  async request<T extends HttpMethod.POST | HttpMethod.PUT | HttpMethod.PATCH>(
    method: T,
    url: string,
    opts?: Partial<Omit<HttpRequest<T>, "method" | "url">> & { data?: string },
  ): Promise<ResponseInfo>;
  async request(
    method: HttpMethod,
    url: string,
    opts?: Partial<Omit<HttpRequest<HttpMethod>, "method" | "url">>,
  ): Promise<ResponseInfo>;
  async request(
    method: HttpMethod,
    url: string,
    opts: Partial<Omit<HttpRequest<HttpMethod>, "method" | "url">> = {},
  ): Promise<ResponseInfo> {
    const req: HttpRequest<HttpMethod> = {
      method,
      url,
      headers: opts.headers ?? {},
      data: opts.data,
      verbose: opts.verbose ?? this.config.verbose,
      timeout: opts.timeout ?? this.config.timeoutMs,
    };
    return this.sendWithRetry(req, 0);
  }

  private async sendWithRetry(
    req: HttpRequest<HttpMethod>,
    attempt: number,
  ): Promise<ResponseInfo> {
    try {
      return await this.send(req);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : undefined;
      const shouldRetry =
        attempt < this.config.retry.maxRetries &&
        ((code !== undefined && this.config.retry.retryOn.includes(code)) ||
          e instanceof TimeoutError);
      if (shouldRetry) {
        await sleep(
          this.config.retry.baseDelayMs *
            Math.pow(this.config.retry.factor, attempt),
        );
        return this.sendWithRetry(req, attempt + 1);
      }
      this._state = RequestState.FAILED;
      this.record({
        state: RequestState.FAILED,
        reason: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  private async send(
    req: HttpRequest<HttpMethod>,
    redirectCount = 0,
  ): Promise<ResponseInfo> {
    this._state = RequestState.BUILDING;
    this.record({ state: RequestState.BUILDING, url: req.url });
    const authed = await this.interceptors.runBefore(req);
    this._state = RequestState.SENDING;
    let res = await this.doRequest(authed);
    res = await this.interceptors.runAfter(authed, res);

    // Cookie jar
    const setCookie = res.headers["set-cookie"];
    if (setCookie) {
      const list = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const c of list) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0)
          this.cookies.add(
            authed.url,
            pair.slice(0, eq).trim(),
            pair.slice(eq + 1).trim(),
          );
      }
    }

    // Redirect following
    if (
      isRedirectCode(res.statusCode) &&
      this.config.redirectMode === RedirectMode.FOLLOW &&
      redirectCount < this.config.maxRedirects
    ) {
      const loc = res.headers.location;
      if (typeof loc === "string") {
        this._state = RequestState.REDIRECTING;
        this.record({
          state: RequestState.REDIRECTING,
          to: loc,
          code: res.statusCode,
        });
        const dropBody = res.statusCode === 303;
        const nextReq: HttpRequest<HttpMethod> = {
          ...authed,
          url: new URL(loc, authed.url).toString() as HttpUrl,
          method: dropBody ? HttpMethod.GET : authed.method,
          data: dropBody ? undefined : authed.data,
        };
        return this.send(nextReq, redirectCount + 1);
      }
    }
    this._state = RequestState.DONE;
    this.record({ state: RequestState.DONE, code: res.statusCode });
    this.history.add(authed);
    return res;
  }

  private doRequest(req: HttpRequest<HttpMethod>): Promise<ResponseInfo> {
    return new Promise<ResponseInfo>((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(req.url);
      } catch {
        reject(new HttpError(`无效的 URL: ${req.url}`));
        return;
      }
      const isHttps = parsed.protocol === "https:";
      const lib = isHttps ? https : http;
      const headers: HeaderMap = { ...req.headers };
      const hasCt = !!headers["Content-Type"] || !!headers["content-type"];
      if (req.data && !hasCt) headers["Content-Type"] = ContentType.JSON;
      if (req.data)
        headers["Content-Length"] = Buffer.byteLength(req.data).toString();
      if (!headers["User-Agent"] && !headers["user-agent"])
        headers["User-Agent"] = this.config.userAgent;
      const cookieHeader = this.cookies.headerFor(req.url);
      if (cookieHeader) headers["Cookie"] = cookieHeader;

      const redirects: string[] = [];
      const t0 = process.hrtime.bigint();
      const reqOpts: https.RequestOptions = {
        method: req.method,
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : isHttps ? 443 : 80,
        path: parsed.pathname + parsed.search,
        headers,
      };
      const timer = setTimeout(
        () =>
          r.destroy(
            new TimeoutError(
              `请求超时 (${req.timeout ?? this.config.timeoutMs}ms)`,
            ),
          ),
        req.timeout ?? this.config.timeoutMs,
      );

      const r = lib.request(reqOpts, (res) => {
        const ttfb = process.hrtime.bigint();
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          chunks.push(c);
          this.record({ state: RequestState.SENDING, bytes: c.length });
        });
        res.on("end", () => {
          clearTimeout(timer);
          const total = Number(process.hrtime.bigint() - t0) / 1e6;
          const timing: TimingPhases = [0, 0, Number(ttfb - t0) / 1e6, total];
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? "",
            headers: res.headers,
            body: Buffer.concat(chunks),
            timing,
            redirects: Object.freeze(redirects) as readonly string[],
          });
        });
        res.on("error", (e) => {
          clearTimeout(timer);
          reject(mapError(e as Error, parsed.hostname));
        });
      });
      r.on("error", (e) => {
        clearTimeout(timer);
        reject(mapError(e as Error, parsed.hostname));
      });
      if (req.data) r.write(req.data);
      r.end();
    });
  }

  async download(
    url: string,
    outPath: string,
    onProgress?: (received: number, total: number) => void,
  ): Promise<ResponseInfo> {
    const res = await this.request(HttpMethod.GET, url);
    if (res.statusCode >= 400)
      throw new HttpError(
        `下载失败，状态码: ${res.statusCode}`,
        res.statusCode,
      );
    const total =
      parseInt(
        (res.headers["content-length"] as string | undefined) ?? "0",
        10,
      ) || res.body.length;
    onProgress?.(res.body.length, total);
    fs.writeFileSync(outPath, res.body);
    return res;
  }

  // generator: iterate response body in fixed-size chunks
  *chunkIterator(res: ResponseInfo, size = 4096): Generator<Buffer> {
    for (let i = 0; i < res.body.length; i += size)
      yield res.body.subarray(i, Math.min(i + size, res.body.length));
  }
}

// utility type usage (Awaited / ReturnType / Parameters)
type AsyncResponse = Awaited<ReturnType<HttpClient["request"]>>;
type RequestParams = Parameters<HttpClient["request"]>;

// ---- Response formatters ----
class JsonResponseFormatter extends AbstractResponseFormatter {
  canHandle(fmt: OutputFormat): boolean {
    return fmt === OutputFormat.JSON || fmt === OutputFormat.PRETTY;
  }
  format(res: ResponseInfo, fmt: OutputFormat): string {
    const text = res.body.toString("utf8");
    const parsed = tryParseJson(text);
    if (!parsed.ok) return text;
    return this.highlight(JSON.stringify(parsed.value, null, 2));
  }
  private highlight(s: string): string {
    return s.replace(
      /("(\\.|[^"])*")(\s*:)?|\b(true|false|null)\b|\b(-?\d+\.?\d*)\b/g,
      (
        m,
        str: string | undefined,
        colon: string | undefined,
        kw: string | undefined,
        num: string | undefined,
      ) => {
        if (str)
          return colon
            ? `${Colors.cyan}${str}${Colors.reset}${colon}`
            : `${Colors.green}${str}${Colors.reset}`;
        if (kw) return `${Colors.magenta}${kw}${Colors.reset}`;
        if (num) return `${Colors.yellow}${num}${Colors.reset}`;
        return m;
      },
    );
  }
}
class RawResponseFormatter extends AbstractResponseFormatter {
  canHandle(fmt: OutputFormat): boolean {
    return fmt === OutputFormat.RAW || fmt === OutputFormat.HEADERS;
  }
  format(res: ResponseInfo, fmt: OutputFormat): string {
    if (fmt === OutputFormat.HEADERS) {
      return Object.entries(res.headers)
        .map(([k, v]) => `${Colors.gray}${k}:${Colors.reset} ${v}`)
        .join("\n");
    }
    return res.body.toString("utf8");
  }
}
class FormatterRegistry {
  private readonly formatters: AbstractResponseFormatter[] = [
    new JsonResponseFormatter(),
    new RawResponseFormatter(),
  ];
  format(res: ResponseInfo, fmt: OutputFormat): string {
    return (
      this.formatters.find((x) => x.canHandle(fmt)) ?? this.formatters[0]
    ).format(res, fmt);
  }
}

// ---- Built-in interceptors ----
class VerboseInterceptor extends AbstractInterceptor<HttpRequest<HttpMethod>> {
  constructor() {
    super(0);
  }
  before(req: HttpRequest<HttpMethod>): HttpRequest<HttpMethod> {
    if (req.verbose) {
      console.log(`${Colors.gray}> ${req.method} ${req.url}${Colors.reset}`);
      for (const [k, v] of Object.entries(req.headers))
        console.log(`${Colors.gray}> ${k}: ${v}${Colors.reset}`);
      if (req.data)
        console.log(`${Colors.gray}>\n> ${req.data}${Colors.reset}`);
    }
    return req;
  }
  after(_ctx: HttpRequest<HttpMethod>, res: ResponseInfo): ResponseInfo {
    return res;
  }
}
class AuthInterceptor extends AbstractInterceptor<HttpRequest<HttpMethod>> {
  constructor(private readonly auth: AbstractAuth) {
    super(1);
  }
  before(req: HttpRequest<HttpMethod>): HttpRequest<HttpMethod> {
    return this.auth.apply(req);
  }
  after(_ctx: HttpRequest<HttpMethod>, res: ResponseInfo): ResponseInfo {
    return res;
  }
}

// ---- Argument parsing ----
interface ParsedArgs {
  url: string;
  headers: HeaderMap;
  data?: string;
  verbose: boolean;
  output?: string;
  count: number;
  port: number;
  auth?: AbstractAuth;
  retry?: number;
  format: OutputFormat;
  rest: string[];
}
function parseArgs(args: string[]): ParsedArgs {
  const headers: HeaderMap = {};
  let data: string | undefined,
    verbose = false,
    urlVal = "",
    output: string | undefined;
  let count = 4,
    port = 80,
    auth: AbstractAuth | undefined,
    retry: number | undefined;
  let format = OutputFormat.PRETTY;
  const rest: string[] = [];
  const formPairs: FormPair[] = [];
  const multipartPairs: FormPair[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-H" || a === "--header") {
      const h = args[++i] ?? "";
      const sep = h.indexOf(":");
      if (sep < 0) throw new Error(`无效的请求头格式: ${h} (应为 Key: Value)`);
      headers[h.slice(0, sep).trim()] = h.slice(sep + 1).trim();
    } else if (a === "-d" || a === "--data") data = args[++i];
    else if (a === "-t" || a === "--type")
      headers["Content-Type"] = (args[++i] ?? ContentType.JSON) as ContentType;
    else if (a === "-v" || a === "--verbose") verbose = true;
    else if (a === "-o" || a === "--output") output = args[++i];
    else if (a === "-c" || a === "--count")
      count = parseInt(args[++i] ?? "4", 10);
    else if (a === "-p" || a === "--port")
      port = parseInt(args[++i] ?? "80", 10);
    else if (a === "--basic") {
      auth = new BasicAuth(args[++i] ?? "", args[++i] ?? "");
    } else if (a === "--bearer") auth = new BearerAuth(args[++i] ?? "");
    else if (a === "--apikey") {
      const where = (args[++i] ?? "header") as "header" | "query";
      auth = new ApiKeyAuth(
        args[++i] ?? "",
        args[++i] ?? "",
        where === "header" ? AuthType.APIKEY_HEADER : AuthType.APIKEY_QUERY,
      );
    } else if (a === "--retry") retry = parseInt(args[++i] ?? "0", 10);
    else if (a === "--format") {
      const f = args[++i] ?? "";
      if (isOutputFormat(f)) format = f;
    } else if (a === "--form") {
      const kv = args[++i] ?? "";
      const eq = kv.indexOf("=");
      if (eq < 0) throw new Error(`无效的表单字段: ${kv}`);
      formPairs.push([kv.slice(0, eq), kv.slice(eq + 1)] as FormPair);
    } else if (a === "--multipart") {
      const kv = args[++i] ?? "";
      const eq = kv.indexOf("=");
      if (eq < 0) throw new Error(`无效的 multipart 字段: ${kv}`);
      multipartPairs.push([kv.slice(0, eq), kv.slice(eq + 1)] as FormPair);
    } else if (!urlVal && !a.startsWith("-")) urlVal = a;
    else rest.push(a);
  }
  // build body from form/multipart pairs (JSON/form/multipart body formats)
  if (multipartPairs.length > 0) {
    const boundary = `----nettest${Date.now()}`;
    headers["Content-Type"] = `${ContentType.MULTIPART}; boundary=${boundary}`;
    data = encodeMultipart(multipartPairs, boundary);
  } else if (formPairs.length > 0) {
    headers["Content-Type"] = ContentType.FORM;
    data = encodeForm(formPairs);
  }
  return {
    url: urlVal,
    headers,
    data,
    verbose,
    output,
    count,
    port,
    auth,
    retry,
    format,
    rest,
  };
}

// ---- Response printer ----
function printResponse(
  res: ResponseInfo,
  fmt: OutputFormat,
  verbose: boolean,
  req: HttpRequest<HttpMethod>,
): void {
  // Request line/headers are already printed by the VerboseInterceptor in the
  // client's interceptor chain when verbose is on; here we only print response info.
  void verbose;
  void req;
  console.log(
    `\n状态:     ${colorStatus(res.statusCode)} ${res.statusMessage}`,
  );
  const [dns, conn, ttfb, total] = res.timing;
  console.log(
    `耗时:     ${total.toFixed(2)} ms  (TTFB ${ttfb.toFixed(2)} | connect ${conn.toFixed(2)} | dns ${dns.toFixed(2)})`,
  );
  console.log(`大小:     ${formatBytes(res.body.length)}`);
  if (res.redirects.length) console.log(`重定向:   ${res.redirects.length} 次`);
  const kind = classify(res);
  if (kind.kind === "redirect") console.log(`Location: ${kind.location}`);
  console.log(`\n响应头:`);
  for (const [k, v] of Object.entries(res.headers))
    console.log(`  ${Colors.gray}${k}:${Colors.reset} ${v}`);
  if (res.body.length === 0) {
    console.log("\n(无响应体)\n");
    return;
  }
  console.log(`\n响应体:`);
  const registry = new FormatterRegistry();
  const ct = res.headers["content-type"] ?? res.headers["Content-Type"];
  const effective: OutputFormat =
    fmt === OutputFormat.PRETTY && !isJsonResponse(ct as string | undefined)
      ? OutputFormat.RAW
      : fmt;
  console.log(registry.format(res, effective));
  console.log("");
}

// ---- Commands ----
async function cmdRequest(method: HttpMethod, args: string[]): Promise<void> {
  const p = parseArgs(args);
  if (!p.url) {
    console.error(
      `错误: 请提供 URL，例如 ${method.toLowerCase()} https://example.com`,
    );
    process.exit(1);
  }
  const client = new HttpClient({
    verbose: p.verbose,
    retry: { ...DEFAULT_RETRY, maxRetries: p.retry ?? 0 },
  });
  client.interceptors.add(new VerboseInterceptor());
  if (p.auth) client.interceptors.add(new AuthInterceptor(p.auth));
  const req: HttpRequest<HttpMethod> = {
    method,
    url: p.url,
    headers: p.headers,
    data: p.data,
    verbose: p.verbose,
  };
  try {
    const res = await client.request(method, p.url, {
      headers: p.headers,
      data: p.data,
      verbose: p.verbose,
    });
    if (p.output) {
      fs.writeFileSync(p.output, res.body);
      console.log(
        `${Colors.green}响应已保存到: ${path.resolve(p.output)}${Colors.reset}`,
      );
      console.log(
        `大小: ${formatBytes(res.body.length)}  耗时: ${res.timing[3].toFixed(2)} ms`,
      );
    } else {
      printResponse(res, p.format, p.verbose, req);
    }
  } catch (err) {
    console.error(
      `${Colors.red}请求失败 [${err instanceof Error ? err.name : "Error"}]: ${err instanceof Error ? err.message : String(err)}${Colors.reset}`,
    );
    process.exit(1);
  }
}

async function cmdDownload(args: string[]): Promise<void> {
  const p = parseArgs(args);
  if (!p.url) {
    console.error("错误: 用法 download <url> [-o file]");
    process.exit(1);
  }
  let outPath = p.output ?? "";
  if (!outPath) {
    const u = new URL(p.url);
    outPath = path.basename(u.pathname) || "download.bin";
  }
  console.log(`正在下载: ${p.url}`);
  const client = new HttpClient();
  const bar = (recv: number, total: number): void => {
    const pct = total > 0 ? Math.min(100, (recv / total) * 100) : 0;
    const line = "#".repeat(Math.round(pct / 2)).padEnd(50);
    process.stdout.write(
      `\r${Colors.cyan}[${line}]${Colors.reset} ${pct.toFixed(1)}% ${formatBytes(recv)}/${formatBytes(total)}`,
    );
  };
  try {
    const res = await client.download(p.url, outPath, bar);
    process.stdout.write("\n");
    console.log(
      `${Colors.green}下载完成: ${path.resolve(outPath)}${Colors.reset}`,
    );
    const total = res.timing[3];
    console.log(
      `大小: ${formatBytes(res.body.length)}  耗时: ${total.toFixed(2)} ms  速度: ${(res.body.length / 1024 / (total / 1000)).toFixed(2)} KB/s`,
    );
  } catch (err) {
    console.error(
      `${Colors.red}下载失败: ${err instanceof Error ? err.message : String(err)}${Colors.reset}`,
    );
    process.exit(1);
  }
}

async function cmdPing(args: string[]): Promise<void> {
  const p = parseArgs(args);
  if (!p.url) {
    console.error("错误: 用法 ping <host> [-c count] [-p port]");
    process.exit(1);
  }
  const host = p.url;
  const { count, port } = p;
  console.log(`PING ${host}:${port} (${count} 次 TCP 连通性测试)\n`);
  let success = 0,
    totalMs = 0,
    minMs = Infinity,
    maxMs = 0;
  for (let i = 0; i < count; i++) {
    const start = process.hrtime.bigint();
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("timeout", () => {
          socket.destroy();
          reject(new TimeoutError("超时"));
        });
        socket.once("error", reject);
        socket.connect(port, host);
      });
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      success++;
      totalMs += ms;
      minMs = Math.min(minMs, ms);
      maxMs = Math.max(maxMs, ms);
      console.log(
        `  来自 ${host}:${port}: ${Colors.green}连接成功${Colors.reset} time=${ms.toFixed(2)} ms`,
      );
    } catch (err) {
      console.log(
        `  来自 ${host}:${port}: ${Colors.red}连接失败 (${err instanceof Error ? err.message : "错误"})${Colors.reset}`,
      );
    }
    if (i < count - 1) await sleep(500);
  }
  console.log(`\n--- ${host}:${port} 统计 ---`);
  console.log(
    `发送: ${count}, 成功: ${success}, 失败: ${count - success}, 丢包率: ${(((count - success) / count) * 100).toFixed(0)}%`,
  );
  if (success > 0)
    console.log(
      `最小: ${minMs.toFixed(2)} ms, 最大: ${maxMs.toFixed(2)} ms, 平均: ${(totalMs / success).toFixed(2)} ms`,
    );
  console.log("");
}

async function cmdBatch(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) {
    console.error("错误: 用法 batch <file>");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`错误: 文件不存在: ${file}`);
    process.exit(1);
  }
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const client = new HttpClient();
  console.log(`批量请求: ${lines.length} 条\n`);
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const cmd = (parts[0] ?? "").toUpperCase();
    const target = parts[1];
    if (!isHttpMethod(cmd) || !target) {
      console.log(`${Colors.red}跳过无效行:${Colors.reset} ${line}`);
      continue;
    }
    try {
      const res = await client.request(cmd as HttpMethod, target, {});
      console.log(
        `${colorStatus(res.statusCode)} ${cmd.padEnd(6)} ${target} - ${formatBytes(res.body.length)} ${res.timing[3].toFixed(0)}ms`,
      );
    } catch (e) {
      console.log(
        `${Colors.red}ERR${Colors.reset}   ${cmd.padEnd(6)} ${target} - ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  console.log("");
}

async function cmdReplay(_args: string[]): Promise<void> {
  const histFile = path.join(process.cwd(), ".nettest-history.json");
  if (!fs.existsSync(histFile)) {
    console.error("错误: 没有可重放的请求历史");
    process.exit(1);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(histFile, "utf8")) as Pick<
      HttpRequest<HttpMethod>,
      "method" | "url" | "headers" | "data"
    >;
    console.log(`重放: ${raw.method} ${raw.url}\n`);
    const client = new HttpClient();
    const res = await client.request(raw.method as HttpMethod, raw.url, {
      headers: raw.headers ?? {},
      data: raw.data,
    });
    printResponse(res, OutputFormat.PRETTY, false, {
      method: raw.method as HttpMethod,
      url: raw.url,
      headers: raw.headers ?? {},
      data: raw.data,
    });
  } catch (e) {
    console.error(`重放失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ---- Help ----
function printHelp(): void {
  console.log(`
网络请求测试 CLI (Network Request Testing CLI) v2.0
====================================================
类似简易版 curl/HTTPie 的网络请求测试工具，支持拦截器链、多种鉴权、
重定向、自动重试、Cookie Jar、批量请求、响应计时分解、JSON 语法高亮等。

用法:
  nettest get <url> [opts]                          GET 请求
  nettest post <url> [-d data] [-t type] [opts]     POST 请求
  nettest put <url> [-d data] [opts]                PUT 请求
  nettest delete <url> [opts]                       DELETE 请求
  nettest head <url> [opts]                         HEAD 请求
  nettest patch <url> [-d data] [opts]              PATCH 请求
  nettest download <url> [-o file]                  下载文件 (带进度条)
  nettest ping <host> [-c n] [-p port]              TCP 连通性测试
  nettest batch <file>                              批量请求 (每行: METHOD URL)
  nettest replay                                    重放上一次请求
  nettest help                                      显示本帮助

选项:
  -H, --header <k:v>     自定义请求头 (可多次使用)
  -d, --data <data>      请求体
  -t, --type <type>      Content-Type (默认 application/json)
  -o, --output <file>    输出文件路径 (响应保存为文件)
  -v, --verbose          显示请求详情
  -c, --count <n>        Ping 次数 (默认 4)
  -p, --port <n>         Ping 端口 (默认 80)
  --basic <user> <pass>  Basic 鉴权
  --bearer <token>       Bearer 鉴权
  --apikey <header|query> <key> <value>  API Key 鉴权
  --retry <n>            自动重试次数 (默认 0)
  --format <fmt>         输出格式 raw|json|pretty|headers

示例:
  nettest get https://httpbin.org/get
  nettest post https://httpbin.org/post -d '{"name":"test"}' -v
  nettest get https://api.example.com --bearer mytoken
  nettest put https://httpbin.org/put -d 'x=1' --basic user pass
  nettest download https://example.com/file.zip -o file.zip
  nettest ping example.com -c 5 -p 443
  nettest batch requests.txt
`);
}

// ---- Method dispatch table (mapped type usage) ----
const METHOD_COMMANDS = {
  get: HttpMethod.GET,
  post: HttpMethod.POST,
  put: HttpMethod.PUT,
  delete: HttpMethod.DELETE,
  head: HttpMethod.HEAD,
  patch: HttpMethod.PATCH,
} as const satisfies Record<string, HttpMethod>;
type CommandName = keyof typeof METHOD_COMMANDS;

// mapped type MethodHandler in use
const HANDLERS: MethodHandler = {
  [HttpMethod.GET]: (a) => cmdRequest(HttpMethod.GET, a),
  [HttpMethod.POST]: (a) => cmdRequest(HttpMethod.POST, a),
  [HttpMethod.PUT]: (a) => cmdRequest(HttpMethod.PUT, a),
  [HttpMethod.DELETE]: (a) => cmdRequest(HttpMethod.DELETE, a),
  [HttpMethod.HEAD]: (a) => cmdRequest(HttpMethod.HEAD, a),
  [HttpMethod.PATCH]: (a) => cmdRequest(HttpMethod.PATCH, a),
};
// HANDLERS kept as a mapped-type dispatch table demo (also referenced for completeness)
void HANDLERS;

// ---- Main entry ----
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    if (command && command in METHOD_COMMANDS) {
      await cmdRequest(METHOD_COMMANDS[command as CommandName], rest);
      return;
    }
    switch (command) {
      case "download":
        await cmdDownload(rest);
        break;
      case "ping":
        await cmdPing(rest);
        break;
      case "batch":
        await cmdBatch(rest);
        break;
      case "replay":
        await cmdReplay(rest);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;
      default:
        console.error(`未知命令: ${command}\n运行 'nettest help' 查看帮助。`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
