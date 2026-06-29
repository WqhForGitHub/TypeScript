#!/usr/bin/env node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const url_1 = require("url");
// ---- Enums ----
var HttpMethod;
(function (HttpMethod) {
    HttpMethod["GET"] = "GET";
    HttpMethod["POST"] = "POST";
    HttpMethod["PUT"] = "PUT";
    HttpMethod["DELETE"] = "DELETE";
    HttpMethod["HEAD"] = "HEAD";
    HttpMethod["PATCH"] = "PATCH";
})(HttpMethod || (HttpMethod = {}));
var ContentType;
(function (ContentType) {
    ContentType["JSON"] = "application/json";
    ContentType["FORM"] = "application/x-www-form-urlencoded";
    ContentType["MULTIPART"] = "multipart/form-data";
    ContentType["TEXT"] = "text/plain";
    ContentType["HTML"] = "text/html";
    ContentType["OCTET"] = "application/octet-stream";
})(ContentType || (ContentType = {}));
var AuthType;
(function (AuthType) {
    AuthType["NONE"] = "none";
    AuthType["BASIC"] = "basic";
    AuthType["BEARER"] = "bearer";
    AuthType["APIKEY_HEADER"] = "apikey-header";
    AuthType["APIKEY_QUERY"] = "apikey-query";
})(AuthType || (AuthType = {}));
var OutputFormat;
(function (OutputFormat) {
    OutputFormat["RAW"] = "raw";
    OutputFormat["JSON"] = "json";
    OutputFormat["PRETTY"] = "pretty";
    OutputFormat["HEADERS"] = "headers";
})(OutputFormat || (OutputFormat = {}));
var RequestState;
(function (RequestState) {
    RequestState["IDLE"] = "idle";
    RequestState["BUILDING"] = "building";
    RequestState["SENDING"] = "sending";
    RequestState["REDIRECTING"] = "redirecting";
    RequestState["DONE"] = "done";
    RequestState["FAILED"] = "failed";
})(RequestState || (RequestState = {}));
var RedirectMode;
(function (RedirectMode) {
    RedirectMode["FOLLOW"] = "follow";
    RedirectMode["MANUAL"] = "manual";
    RedirectMode["ERROR"] = "error";
})(RedirectMode || (RedirectMode = {}));
const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });
// ---- Custom Error hierarchy ----
class HttpError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "HttpError";
    }
}
class NetworkError extends HttpError {
    constructor(msg) { super(msg); this.name = "NetworkError"; }
}
class TimeoutError extends HttpError {
    constructor(msg = "请求超时") { super(msg); this.name = "TimeoutError"; }
}
class DnsError extends HttpError {
    constructor(host) { super(`DNS 解析失败: ${host}`); this.name = "DnsError"; }
}
class SslError extends HttpError {
    constructor(msg) { super(msg); this.name = "SslError"; }
}
// ---- Type guards ----
function isHttpMethod(v) { return Object.values(HttpMethod).includes(v); }
function isSuccess(code) { return code >= 200 && code < 300; }
function isRedirectCode(code) { return [301, 302, 303, 307, 308].includes(code); }
function isJsonResponse(ct) { return !!ct && ct.toLowerCase().includes("json"); }
function isOutputFormat(v) { return Object.values(OutputFormat).includes(v); }
// ---- as const / satisfies ----
const DEFAULT_RETRY = { maxRetries: 0, baseDelayMs: 200, factor: 2, retryOn: [502, 503, 504] };
const DEFAULT_CONFIG = {
    userAgent: "nettest/2.0", timeoutMs: 30000, maxRedirects: 5,
    redirectMode: RedirectMode.FOLLOW, retry: DEFAULT_RETRY, verbose: false,
};
const STATUS_COLORS = {
    success: "\x1b[32m", redirect: "\x1b[36m", clientError: "\x1b[33m", serverError: "\x1b[31m", reset: "\x1b[0m",
};
const Colors = {
    reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
    blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m", bold: "\x1b[1m",
};
// ---- Symbol for interceptor chain ----
const INTERCEPTOR_CHAIN = Symbol("interceptor-chain");
// ---- Abstract classes ----
class AbstractInterceptor {
    constructor(order = 0) {
        this.order = order;
    }
}
class AbstractAuth {
}
class AbstractResponseFormatter {
}
// ---- Auth implementations ----
class BasicAuth extends AbstractAuth {
    constructor(user, pass) {
        super();
        this.user = user;
        this.pass = pass;
        this.type = AuthType.BASIC;
    }
    apply(req) {
        const token = Buffer.from(`${this.user}:${this.pass}`).toString("base64");
        return { ...req, headers: { ...req.headers, Authorization: `Basic ${token}` } };
    }
    describe() { return `Basic(${this.user})`; }
}
class BearerAuth extends AbstractAuth {
    constructor(token) {
        super();
        this.token = token;
        this.type = AuthType.BEARER;
    }
    apply(req) {
        return { ...req, headers: { ...req.headers, Authorization: `Bearer ${this.token}` } };
    }
    describe() { return "Bearer(***)"; }
}
class ApiKeyAuth extends AbstractAuth {
    constructor(key, value, type) {
        super();
        this.key = key;
        this.value = value;
        this.type = type;
    }
    apply(req) {
        if (this.type === AuthType.APIKEY_HEADER)
            return { ...req, headers: { ...req.headers, [this.key]: this.value } };
        const u = new url_1.URL(req.url);
        u.searchParams.set(this.key, this.value);
        return { ...req, url: u.toString() };
    }
    describe() { return `ApiKey(${this.key})`; }
}
// ---- Cookie Jar (with iterator) ----
class CookieJar {
    constructor() {
        this.store = new Map();
    }
    add(url, name, value) {
        const u = new url_1.URL(url);
        this.store.set(`${u.hostname}${u.pathname || "/"}:${name}`, { name, value, domain: u.hostname, path: u.pathname || "/" });
    }
    headerFor(url) {
        const u = new url_1.URL(url);
        return [...this.store.values()]
            .filter((c) => u.hostname === c.domain || u.hostname.endsWith(`.${c.domain}`))
            .map((c) => `${c.name}=${c.value}`).join("; ");
    }
    clear() { this.store.clear(); }
    get size() { return this.store.size; }
    *[Symbol.iterator]() { yield* this.store.values(); }
}
// ---- Request history (with generator) ----
class RequestHistory {
    constructor() {
        this.items = [];
    }
    add(r) { this.items.push(Object.freeze({ ...r })); }
    *iter() { for (const i of this.items)
        yield i; }
    get length() { return this.items.length; }
    last() { return this.items[this.items.length - 1]; }
    replay() { const l = this.last(); return l ? { ...l } : undefined; }
}
// ---- Interceptor chain (symbol-keyed) ----
class InterceptorChain {
    constructor() {
        this[_a] = [];
    }
    add(i) {
        this[INTERCEPTOR_CHAIN].push(i);
        this[INTERCEPTOR_CHAIN].sort((a, b) => a["order"] - b["order"]);
        return this;
    }
    get length() { return this[INTERCEPTOR_CHAIN].length; }
    async runBefore(ctx) {
        let c = ctx;
        for (const i of this[INTERCEPTOR_CHAIN])
            c = await i.before(c);
        return c;
    }
    async runAfter(ctx, res) {
        let r = res;
        for (const i of [...this[INTERCEPTOR_CHAIN]].reverse())
            r = await i.after(ctx, r);
        return r;
    }
}
_a = INTERCEPTOR_CHAIN;
// ---- Helpers ----
function colorStatus(code) {
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
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function mapError(e, host) {
    const msg = e.message ?? "";
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg))
        return new DnsError(host);
    if (/ETIMEDOUT|timeout/i.test(msg))
        return new TimeoutError(msg);
    if (/SSL|CERT|certificate|UNABLE_TO_VERIFY/i.test(msg))
        return new SslError(msg);
    return new NetworkError(msg);
}
function encodeForm(pairs) {
    return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
function encodeMultipart(pairs, boundary) {
    let out = "";
    for (const [k, v] of pairs)
        out += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    return out + `--${boundary}--\r\n`;
}
// Result<T,E> usage: safe JSON parse
function tryParseJson(text) {
    try {
        return ok(JSON.parse(text));
    }
    catch (e) {
        return fail(e instanceof Error ? e : new Error(String(e)));
    }
}
function classify(res) {
    if (isRedirectCode(res.statusCode) && typeof res.headers.location === "string") {
        return { kind: "redirect", code: res.statusCode, location: res.headers.location };
    }
    if (isSuccess(res.statusCode))
        return { kind: "success", code: res.statusCode, body: res.body };
    return { kind: "error", code: res.statusCode, message: res.statusMessage };
}
// ---- HTTP Client ----
class HttpClient {
    constructor(config = {}) {
        this.cookies = new CookieJar();
        this.history = new RequestHistory();
        this.interceptors = new InterceptorChain();
        this._state = RequestState.IDLE;
        this.eventLog = [];
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    get currentState() { return this._state; }
    get events() { return this.eventLog; }
    setVerbose(v) { this.config = { ...this.config, verbose: v }; }
    record(ev) { this.eventLog.push(ev); }
    async request(method, url, opts = {}) {
        const req = {
            method, url,
            headers: opts.headers ?? {},
            data: opts.data,
            verbose: opts.verbose ?? this.config.verbose,
            timeout: opts.timeout ?? this.config.timeoutMs,
        };
        return this.sendWithRetry(req, 0);
    }
    async sendWithRetry(req, attempt) {
        try {
            return await this.send(req);
        }
        catch (e) {
            const code = e instanceof HttpError ? e.code : undefined;
            const shouldRetry = attempt < this.config.retry.maxRetries &&
                ((code !== undefined && this.config.retry.retryOn.includes(code)) || e instanceof TimeoutError);
            if (shouldRetry) {
                await sleep(this.config.retry.baseDelayMs * Math.pow(this.config.retry.factor, attempt));
                return this.sendWithRetry(req, attempt + 1);
            }
            this._state = RequestState.FAILED;
            this.record({ state: RequestState.FAILED, reason: e instanceof Error ? e.message : String(e) });
            throw e;
        }
    }
    async send(req, redirectCount = 0) {
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
                    this.cookies.add(authed.url, pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
            }
        }
        // Redirect following
        if (isRedirectCode(res.statusCode) && this.config.redirectMode === RedirectMode.FOLLOW && redirectCount < this.config.maxRedirects) {
            const loc = res.headers.location;
            if (typeof loc === "string") {
                this._state = RequestState.REDIRECTING;
                this.record({ state: RequestState.REDIRECTING, to: loc, code: res.statusCode });
                const dropBody = res.statusCode === 303;
                const nextReq = {
                    ...authed,
                    url: new url_1.URL(loc, authed.url).toString(),
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
    doRequest(req) {
        return new Promise((resolve, reject) => {
            let parsed;
            try {
                parsed = new url_1.URL(req.url);
            }
            catch {
                reject(new HttpError(`无效的 URL: ${req.url}`));
                return;
            }
            const isHttps = parsed.protocol === "https:";
            const lib = isHttps ? https : http;
            const headers = { ...req.headers };
            const hasCt = !!headers["Content-Type"] || !!headers["content-type"];
            if (req.data && !hasCt)
                headers["Content-Type"] = ContentType.JSON;
            if (req.data)
                headers["Content-Length"] = Buffer.byteLength(req.data).toString();
            if (!headers["User-Agent"] && !headers["user-agent"])
                headers["User-Agent"] = this.config.userAgent;
            const cookieHeader = this.cookies.headerFor(req.url);
            if (cookieHeader)
                headers["Cookie"] = cookieHeader;
            const redirects = [];
            const t0 = process.hrtime.bigint();
            const reqOpts = {
                method: req.method, hostname: parsed.hostname,
                port: parsed.port ? parseInt(parsed.port, 10) : isHttps ? 443 : 80,
                path: parsed.pathname + parsed.search, headers,
            };
            const timer = setTimeout(() => r.destroy(new TimeoutError(`请求超时 (${req.timeout ?? this.config.timeoutMs}ms)`)), req.timeout ?? this.config.timeoutMs);
            const r = lib.request(reqOpts, (res) => {
                const ttfb = process.hrtime.bigint();
                const chunks = [];
                res.on("data", (c) => { chunks.push(c); this.record({ state: RequestState.SENDING, bytes: c.length }); });
                res.on("end", () => {
                    clearTimeout(timer);
                    const total = Number(process.hrtime.bigint() - t0) / 1e6;
                    const timing = [0, 0, Number(ttfb - t0) / 1e6, total];
                    resolve({
                        statusCode: res.statusCode ?? 0, statusMessage: res.statusMessage ?? "",
                        headers: res.headers, body: Buffer.concat(chunks),
                        timing, redirects: Object.freeze(redirects),
                    });
                });
                res.on("error", (e) => { clearTimeout(timer); reject(mapError(e, parsed.hostname)); });
            });
            r.on("error", (e) => { clearTimeout(timer); reject(mapError(e, parsed.hostname)); });
            if (req.data)
                r.write(req.data);
            r.end();
        });
    }
    async download(url, outPath, onProgress) {
        const res = await this.request(HttpMethod.GET, url);
        if (res.statusCode >= 400)
            throw new HttpError(`下载失败，状态码: ${res.statusCode}`, res.statusCode);
        const total = parseInt(res.headers["content-length"] ?? "0", 10) || res.body.length;
        onProgress?.(res.body.length, total);
        fs.writeFileSync(outPath, res.body);
        return res;
    }
    // generator: iterate response body in fixed-size chunks
    *chunkIterator(res, size = 4096) {
        for (let i = 0; i < res.body.length; i += size)
            yield res.body.subarray(i, Math.min(i + size, res.body.length));
    }
}
// ---- Response formatters ----
class JsonResponseFormatter extends AbstractResponseFormatter {
    canHandle(fmt) { return fmt === OutputFormat.JSON || fmt === OutputFormat.PRETTY; }
    format(res, fmt) {
        const text = res.body.toString("utf8");
        const parsed = tryParseJson(text);
        if (!parsed.ok)
            return text;
        return this.highlight(JSON.stringify(parsed.value, null, 2));
    }
    highlight(s) {
        return s.replace(/("(\\.|[^"])*")(\s*:)?|\b(true|false|null)\b|\b(-?\d+\.?\d*)\b/g, (m, str, colon, kw, num) => {
            if (str)
                return colon ? `${Colors.cyan}${str}${Colors.reset}${colon}` : `${Colors.green}${str}${Colors.reset}`;
            if (kw)
                return `${Colors.magenta}${kw}${Colors.reset}`;
            if (num)
                return `${Colors.yellow}${num}${Colors.reset}`;
            return m;
        });
    }
}
class RawResponseFormatter extends AbstractResponseFormatter {
    canHandle(fmt) { return fmt === OutputFormat.RAW || fmt === OutputFormat.HEADERS; }
    format(res, fmt) {
        if (fmt === OutputFormat.HEADERS) {
            return Object.entries(res.headers).map(([k, v]) => `${Colors.gray}${k}:${Colors.reset} ${v}`).join("\n");
        }
        return res.body.toString("utf8");
    }
}
class FormatterRegistry {
    constructor() {
        this.formatters = [new JsonResponseFormatter(), new RawResponseFormatter()];
    }
    format(res, fmt) {
        return (this.formatters.find((x) => x.canHandle(fmt)) ?? this.formatters[0]).format(res, fmt);
    }
}
// ---- Built-in interceptors ----
class VerboseInterceptor extends AbstractInterceptor {
    constructor() { super(0); }
    before(req) {
        if (req.verbose) {
            console.log(`${Colors.gray}> ${req.method} ${req.url}${Colors.reset}`);
            for (const [k, v] of Object.entries(req.headers))
                console.log(`${Colors.gray}> ${k}: ${v}${Colors.reset}`);
            if (req.data)
                console.log(`${Colors.gray}>\n> ${req.data}${Colors.reset}`);
        }
        return req;
    }
    after(_ctx, res) { return res; }
}
class AuthInterceptor extends AbstractInterceptor {
    constructor(auth) {
        super(1);
        this.auth = auth;
    }
    before(req) { return this.auth.apply(req); }
    after(_ctx, res) { return res; }
}
function parseArgs(args) {
    const headers = {};
    let data, verbose = false, urlVal = "", output;
    let count = 4, port = 80, auth, retry;
    let format = OutputFormat.PRETTY;
    const rest = [];
    const formPairs = [];
    const multipartPairs = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "-H" || a === "--header") {
            const h = args[++i] ?? "";
            const sep = h.indexOf(":");
            if (sep < 0)
                throw new Error(`无效的请求头格式: ${h} (应为 Key: Value)`);
            headers[h.slice(0, sep).trim()] = h.slice(sep + 1).trim();
        }
        else if (a === "-d" || a === "--data")
            data = args[++i];
        else if (a === "-t" || a === "--type")
            headers["Content-Type"] = (args[++i] ?? ContentType.JSON);
        else if (a === "-v" || a === "--verbose")
            verbose = true;
        else if (a === "-o" || a === "--output")
            output = args[++i];
        else if (a === "-c" || a === "--count")
            count = parseInt(args[++i] ?? "4", 10);
        else if (a === "-p" || a === "--port")
            port = parseInt(args[++i] ?? "80", 10);
        else if (a === "--basic") {
            auth = new BasicAuth(args[++i] ?? "", args[++i] ?? "");
        }
        else if (a === "--bearer")
            auth = new BearerAuth(args[++i] ?? "");
        else if (a === "--apikey") {
            const where = (args[++i] ?? "header");
            auth = new ApiKeyAuth(args[++i] ?? "", args[++i] ?? "", where === "header" ? AuthType.APIKEY_HEADER : AuthType.APIKEY_QUERY);
        }
        else if (a === "--retry")
            retry = parseInt(args[++i] ?? "0", 10);
        else if (a === "--format") {
            const f = args[++i] ?? "";
            if (isOutputFormat(f))
                format = f;
        }
        else if (a === "--form") {
            const kv = args[++i] ?? "";
            const eq = kv.indexOf("=");
            if (eq < 0)
                throw new Error(`无效的表单字段: ${kv}`);
            formPairs.push([kv.slice(0, eq), kv.slice(eq + 1)]);
        }
        else if (a === "--multipart") {
            const kv = args[++i] ?? "";
            const eq = kv.indexOf("=");
            if (eq < 0)
                throw new Error(`无效的 multipart 字段: ${kv}`);
            multipartPairs.push([kv.slice(0, eq), kv.slice(eq + 1)]);
        }
        else if (!urlVal && !a.startsWith("-"))
            urlVal = a;
        else
            rest.push(a);
    }
    // build body from form/multipart pairs (JSON/form/multipart body formats)
    if (multipartPairs.length > 0) {
        const boundary = `----nettest${Date.now()}`;
        headers["Content-Type"] = `${ContentType.MULTIPART}; boundary=${boundary}`;
        data = encodeMultipart(multipartPairs, boundary);
    }
    else if (formPairs.length > 0) {
        headers["Content-Type"] = ContentType.FORM;
        data = encodeForm(formPairs);
    }
    return { url: urlVal, headers, data, verbose, output, count, port, auth, retry, format, rest };
}
// ---- Response printer ----
function printResponse(res, fmt, verbose, req) {
    // Request line/headers are already printed by the VerboseInterceptor in the
    // client's interceptor chain when verbose is on; here we only print response info.
    void verbose;
    void req;
    console.log(`\n状态:     ${colorStatus(res.statusCode)} ${res.statusMessage}`);
    const [dns, conn, ttfb, total] = res.timing;
    console.log(`耗时:     ${total.toFixed(2)} ms  (TTFB ${ttfb.toFixed(2)} | connect ${conn.toFixed(2)} | dns ${dns.toFixed(2)})`);
    console.log(`大小:     ${formatBytes(res.body.length)}`);
    if (res.redirects.length)
        console.log(`重定向:   ${res.redirects.length} 次`);
    const kind = classify(res);
    if (kind.kind === "redirect")
        console.log(`Location: ${kind.location}`);
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
    const effective = fmt === OutputFormat.PRETTY && !isJsonResponse(ct) ? OutputFormat.RAW : fmt;
    console.log(registry.format(res, effective));
    console.log("");
}
// ---- Commands ----
async function cmdRequest(method, args) {
    const p = parseArgs(args);
    if (!p.url) {
        console.error(`错误: 请提供 URL，例如 ${method.toLowerCase()} https://example.com`);
        process.exit(1);
    }
    const client = new HttpClient({ verbose: p.verbose, retry: { ...DEFAULT_RETRY, maxRetries: p.retry ?? 0 } });
    client.interceptors.add(new VerboseInterceptor());
    if (p.auth)
        client.interceptors.add(new AuthInterceptor(p.auth));
    const req = { method, url: p.url, headers: p.headers, data: p.data, verbose: p.verbose };
    try {
        const res = await client.request(method, p.url, { headers: p.headers, data: p.data, verbose: p.verbose });
        if (p.output) {
            fs.writeFileSync(p.output, res.body);
            console.log(`${Colors.green}响应已保存到: ${path.resolve(p.output)}${Colors.reset}`);
            console.log(`大小: ${formatBytes(res.body.length)}  耗时: ${res.timing[3].toFixed(2)} ms`);
        }
        else {
            printResponse(res, p.format, p.verbose, req);
        }
    }
    catch (err) {
        console.error(`${Colors.red}请求失败 [${err instanceof Error ? err.name : "Error"}]: ${err instanceof Error ? err.message : String(err)}${Colors.reset}`);
        process.exit(1);
    }
}
async function cmdDownload(args) {
    const p = parseArgs(args);
    if (!p.url) {
        console.error("错误: 用法 download <url> [-o file]");
        process.exit(1);
    }
    let outPath = p.output ?? "";
    if (!outPath) {
        const u = new url_1.URL(p.url);
        outPath = path.basename(u.pathname) || "download.bin";
    }
    console.log(`正在下载: ${p.url}`);
    const client = new HttpClient();
    const bar = (recv, total) => {
        const pct = total > 0 ? Math.min(100, (recv / total) * 100) : 0;
        const line = "#".repeat(Math.round(pct / 2)).padEnd(50);
        process.stdout.write(`\r${Colors.cyan}[${line}]${Colors.reset} ${pct.toFixed(1)}% ${formatBytes(recv)}/${formatBytes(total)}`);
    };
    try {
        const res = await client.download(p.url, outPath, bar);
        process.stdout.write("\n");
        console.log(`${Colors.green}下载完成: ${path.resolve(outPath)}${Colors.reset}`);
        const total = res.timing[3];
        console.log(`大小: ${formatBytes(res.body.length)}  耗时: ${total.toFixed(2)} ms  速度: ${(res.body.length / 1024 / (total / 1000)).toFixed(2)} KB/s`);
    }
    catch (err) {
        console.error(`${Colors.red}下载失败: ${err instanceof Error ? err.message : String(err)}${Colors.reset}`);
        process.exit(1);
    }
}
async function cmdPing(args) {
    const p = parseArgs(args);
    if (!p.url) {
        console.error("错误: 用法 ping <host> [-c count] [-p port]");
        process.exit(1);
    }
    const host = p.url;
    const { count, port } = p;
    console.log(`PING ${host}:${port} (${count} 次 TCP 连通性测试)\n`);
    let success = 0, totalMs = 0, minMs = Infinity, maxMs = 0;
    for (let i = 0; i < count; i++) {
        const start = process.hrtime.bigint();
        try {
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(3000);
                socket.once("connect", () => { socket.destroy(); resolve(); });
                socket.once("timeout", () => { socket.destroy(); reject(new TimeoutError("超时")); });
                socket.once("error", reject);
                socket.connect(port, host);
            });
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            success++;
            totalMs += ms;
            minMs = Math.min(minMs, ms);
            maxMs = Math.max(maxMs, ms);
            console.log(`  来自 ${host}:${port}: ${Colors.green}连接成功${Colors.reset} time=${ms.toFixed(2)} ms`);
        }
        catch (err) {
            console.log(`  来自 ${host}:${port}: ${Colors.red}连接失败 (${err instanceof Error ? err.message : "错误"})${Colors.reset}`);
        }
        if (i < count - 1)
            await sleep(500);
    }
    console.log(`\n--- ${host}:${port} 统计 ---`);
    console.log(`发送: ${count}, 成功: ${success}, 失败: ${count - success}, 丢包率: ${(((count - success) / count) * 100).toFixed(0)}%`);
    if (success > 0)
        console.log(`最小: ${minMs.toFixed(2)} ms, 最大: ${maxMs.toFixed(2)} ms, 平均: ${(totalMs / success).toFixed(2)} ms`);
    console.log("");
}
async function cmdBatch(args) {
    const file = args[0];
    if (!file) {
        console.error("错误: 用法 batch <file>");
        process.exit(1);
    }
    if (!fs.existsSync(file)) {
        console.error(`错误: 文件不存在: ${file}`);
        process.exit(1);
    }
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
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
            const res = await client.request(cmd, target, {});
            console.log(`${colorStatus(res.statusCode)} ${cmd.padEnd(6)} ${target} - ${formatBytes(res.body.length)} ${res.timing[3].toFixed(0)}ms`);
        }
        catch (e) {
            console.log(`${Colors.red}ERR${Colors.reset}   ${cmd.padEnd(6)} ${target} - ${e instanceof Error ? e.message : e}`);
        }
    }
    console.log("");
}
async function cmdReplay(_args) {
    const histFile = path.join(process.cwd(), ".nettest-history.json");
    if (!fs.existsSync(histFile)) {
        console.error("错误: 没有可重放的请求历史");
        process.exit(1);
    }
    try {
        const raw = JSON.parse(fs.readFileSync(histFile, "utf8"));
        console.log(`重放: ${raw.method} ${raw.url}\n`);
        const client = new HttpClient();
        const res = await client.request(raw.method, raw.url, { headers: raw.headers ?? {}, data: raw.data });
        printResponse(res, OutputFormat.PRETTY, false, { method: raw.method, url: raw.url, headers: raw.headers ?? {}, data: raw.data });
    }
    catch (e) {
        console.error(`重放失败: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }
}
// ---- Help ----
function printHelp() {
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
    get: HttpMethod.GET, post: HttpMethod.POST, put: HttpMethod.PUT,
    delete: HttpMethod.DELETE, head: HttpMethod.HEAD, patch: HttpMethod.PATCH,
};
// mapped type MethodHandler in use
const HANDLERS = {
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
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const rest = args.slice(1);
    try {
        if (command && command in METHOD_COMMANDS) {
            await cmdRequest(METHOD_COMMANDS[command], rest);
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
    }
    catch (err) {
        console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
void main();
//# sourceMappingURL=index.js.map