#!/usr/bin/env node
/**
 * 45. 静态文件服务器 (增强版 - 演示高级 TypeScript 特性)
 * 功能: MIME / Range(206) / ETag(304) / gzip / 目录列表 / 路径安全
 * 仅使用 Node.js 内置模块。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";

// ===== String enums =====
enum HttpMethod {
  GET = "GET",
  HEAD = "HEAD",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  OPTIONS = "OPTIONS",
}
enum ContentType {
  TEXT_HTML = "text/html; charset=utf-8",
  TEXT_PLAIN = "text/plain; charset=utf-8",
  APPLICATION_JSON = "application/json; charset=utf-8",
  APPLICATION_OCTET_STREAM = "application/octet-stream",
}
enum EncodingType {
  GZIP = "gzip",
  DEFLATE = "deflate",
  BR = "br",
  IDENTITY = "identity",
}

// ===== Regular (numeric) enums =====
enum HttpStatusCode {
  OK = 200,
  PARTIAL_CONTENT = 206,
  MOVED_PERMANENTLY = 301,
  NOT_MODIFIED = 304,
  BAD_REQUEST = 400,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  RANGE_NOT_SATISFIABLE = 416,
  INTERNAL_ERROR = 500,
}
enum CacheDirective {
  PUBLIC = "public",
  PRIVATE = "private",
  NO_CACHE = "no-cache",
  NO_STORE = "no-store",
  MUST_REVALIDATE = "must-revalidate",
}

// ===== Template literal types =====
type FilePath = `/${string}`;
type FileExtension = `.${string}`;
type StatusCodeLine = `${number} ${string}`;

// ===== Mapped types & conditional types =====
type ReadonlyFields<T> = { readonly [K in keyof T]: T[K] };
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
type ExtractExtension<S> = S extends `.${infer Ext}` ? Ext : never;
type IsCompressible<S extends string> = S extends `${infer _}text/${infer __}`
  ? true
  : S extends `${infer _}json${infer __}`
    ? true
    : S extends `${infer _}javascript${infer __}`
      ? true
      : S extends `${infer _}svg${infer __}`
        ? true
        : false;
type HtmlExt = ExtractExtension<".html">;

// ===== Interfaces (optional / readonly / index signatures) =====
interface ServerOptions {
  port: number;
  root: string;
  listing: boolean;
  gzip: boolean;
  [key: string]: unknown;
}
interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}
interface HandlerContext {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly options: ServerOptions;
}
interface HttpRequestMeta {
  readonly method: HttpMethod;
  readonly url: string;
  readonly range?: string;
  readonly ifNoneMatch?: string;
  readonly acceptEncoding?: string;
}
interface RangeBound {
  readonly start: number;
  readonly end: number;
}
interface DirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly mtime: Date;
}

// ===== Tuples & readonly tuples =====
type RangeTuple = readonly [number, number];
type StatusTuple = readonly [HttpStatusCode, string];
const STATUS_LINES: readonly StatusTuple[] = [
  [HttpStatusCode.OK, "OK"],
  [HttpStatusCode.NOT_FOUND, "Not Found"],
  [HttpStatusCode.INTERNAL_ERROR, "Internal Server Error"],
];

// ===== Symbols for unique property keys =====
const HANDLER_KIND = Symbol("handlerKind");
const REGISTRY_LOCKED = Symbol("registryLocked");

// ===== Discriminated unions for response types =====
interface BaseResponse {
  readonly status: HttpStatusCode;
  readonly headers: ReadonlyFields<http.OutgoingHttpHeaders>;
}
interface FileResponse extends BaseResponse {
  readonly kind: "file";
  readonly filePath: string;
  readonly stat: fs.Stats;
  readonly mime: string;
}
interface RangeResponse extends BaseResponse {
  readonly kind: "range";
  readonly filePath: string;
  readonly stat: fs.Stats;
  readonly range: RangeBound;
}
interface GzipResponse extends BaseResponse {
  readonly kind: "gzip";
  readonly filePath: string;
  readonly stat: fs.Stats;
  readonly mime: string;
}
interface DirectoryResponse extends BaseResponse {
  readonly kind: "directory";
  readonly dirPath: string;
  readonly html: string;
}
type ServerResponse =
  FileResponse | RangeResponse | GzipResponse | DirectoryResponse;

// ===== Type guards =====
function isFileResponse(r: ServerResponse): r is FileResponse {
  return r.kind === "file";
}
function isRangeResponse(r: ServerResponse): r is RangeResponse {
  return r.kind === "range";
}
function isGzipResponse(r: ServerResponse): r is GzipResponse {
  return r.kind === "gzip";
}
function isDirectoryResponse(r: ServerResponse): r is DirectoryResponse {
  return r.kind === "directory";
}
function isServerError(err: unknown): err is ServerError {
  return err instanceof ServerError;
}
function isString(v: unknown): v is string {
  return typeof v === "string";
}

// ===== Custom Error hierarchy with `code` property =====
abstract class ServerError extends Error {
  abstract readonly code: string;
  readonly statusCode: HttpStatusCode;
  constructor(message: string, statusCode: HttpStatusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class NotFoundError extends ServerError {
  readonly code = "ENOENT";
  constructor(m = "未找到") {
    super(m, HttpStatusCode.NOT_FOUND);
  }
}
class ForbiddenError extends ServerError {
  readonly code = "EFORBIDDEN";
  constructor(m = "禁止访问") {
    super(m, HttpStatusCode.FORBIDDEN);
  }
}
class MethodNotAllowedError extends ServerError {
  readonly code = "EMETHOD";
  constructor(m = "方法不允许") {
    super(m, HttpStatusCode.METHOD_NOT_ALLOWED);
  }
}
class RangeNotSatisfiableError extends ServerError {
  readonly code = "ERANGE";
  constructor(m = "范围不满足") {
    super(m, HttpStatusCode.RANGE_NOT_SATISFIABLE);
  }
}
class InternalServerError extends ServerError {
  readonly code = "EINTERNAL";
  constructor(m = "内部错误") {
    super(m, HttpStatusCode.INTERNAL_ERROR);
  }
}

// ===== `as const` MIME map + `satisfies` operator =====
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".csv": "text/csv; charset=utf-8",
  ".wasm": "application/wasm",
} as const satisfies Record<FileExtension, string>;
const DEFAULT_MIME: string = ContentType.APPLICATION_OCTET_STREAM;
void (null as unknown as HtmlExt); // type-level usage of ExtractExtension

// ===== Generic class with constraints + getter/setter + Symbol key =====
class MimeRegistry<T extends string> {
  private readonly entries: Map<string, T> = new Map();
  private _default: T;
  [REGISTRY_LOCKED]: boolean = false;

  constructor(defaultType: T) {
    this._default = defaultType;
  }

  get default(): T {
    return this._default;
  }
  set default(value: T) {
    if (this[REGISTRY_LOCKED]) throw new InternalServerError("注册表已锁定");
    this._default = value;
  }
  get size(): number {
    return this.entries.size;
  }

  register(ext: FileExtension, mime: T): this {
    if (this[REGISTRY_LOCKED]) throw new InternalServerError("注册表已锁定");
    this.entries.set(ext.toLowerCase(), mime);
    return this;
  }
  lookup(filename: string): T {
    const ext = path.extname(filename).toLowerCase() as FileExtension;
    return this.entries.get(ext) ?? this._default;
  }
  has(ext: FileExtension): boolean {
    return this.entries.has(ext.toLowerCase());
  }
  lock(): void {
    this[REGISTRY_LOCKED] = true;
  }
  *extensions(): IterableIterator<string> {
    for (const k of this.entries.keys()) yield k;
  }
}

const mimeRegistry = new MimeRegistry<string>(DEFAULT_MIME);
for (const [ext, mime] of Object.entries(MIME_TYPES))
  mimeRegistry.register(ext as FileExtension, mime);
mimeRegistry.lock();
function getMimeType(filename: string): string {
  return mimeRegistry.lookup(filename);
}

// ===== Logger =====
const Logger = {
  info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  req(method: string, url: string, status: number): void {
    const color =
      status < 300 ? 32 : status < 400 ? 36 : status < 500 ? 33 : 31;
    console.log(
      `${new Date().toISOString()} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${color}m${status}\x1b[0m`,
    );
  },
};

// ===== Function overloads =====
function formatSize(bytes: number): string;
function formatSize(bytes: number, includeUnit: true): string;
function formatSize(bytes: number, includeUnit: false): number;
function formatSize(
  bytes: number,
  includeUnit: boolean = true,
): string | number {
  if (!includeUnit) return bytes;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function safeJoin(root: string, urlPath: string): string | null;
function safeJoin(root: string, urlPath: string, strict: true): string;
function safeJoin(root: string, urlPath: string, strict?: false): string | null;
function safeJoin(
  root: string,
  urlPath: string,
  strict: boolean = false,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    if (strict) throw new ForbiddenError("无效的 URL 编码");
    return null;
  }
  const target = path.normalize(path.join(root, decoded));
  if (target !== root && !target.startsWith(root + path.sep)) {
    if (strict) throw new ForbiddenError("路径越界");
    return null;
  }
  return target;
}

// ===== Helpers: ETag / Range / gzip =====
function computeEtag(stat: fs.Stats, file: string): string {
  const raw = `${file}-${stat.size}-${stat.mtimeMs}`;
  return (
    '"' +
    crypto.createHash("sha1").update(raw).digest("hex").substring(0, 16) +
    '"'
  );
}

function parseRange(range: string, size: number): RangeBound | null {
  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  let start: number, end: number;
  if (match[1] === "" && match[2] === "") return null;
  if (match[1] === "") {
    const suffix = parseInt(match[2], 10);
    if (Number.isNaN(suffix)) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === "" ? size - 1 : parseInt(match[2], 10);
    if (Number.isNaN(start)) return null;
    if (start >= size) return null;
    if (end >= size) end = size - 1;
  }
  if (start > end) return null;
  return { start, end };
}
function rangeToTuple(r: RangeBound): RangeTuple {
  return [r.start, r.end];
}

function acceptsGzip(req: http.IncomingMessage): boolean {
  const enc = req.headers["accept-encoding"];
  return isString(enc) && enc.toLowerCase().includes(EncodingType.GZIP);
}
function shouldCompress(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("xml") ||
    mime.includes("svg") ||
    mime.includes("wasm")
  );
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function sendText(
  res: http.ServerResponse,
  text: string,
  status: HttpStatusCode,
  contentType: string = ContentType.TEXT_PLAIN,
): void {
  const buf = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
  });
  res.end(buf);
}

// ===== Generator for directory entries =====
function* iterateDirectoryEntries(
  dirPath: string,
): IterableIterator<DirectoryEntry> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".") continue;
    let size = 0;
    let mtime = new Date(0);
    try {
      const stat = fs.statSync(path.join(dirPath, entry.name));
      size = stat.size;
      mtime = stat.mtime;
    } catch {
      /* ignore */
    }
    yield { name: entry.name, isDirectory: entry.isDirectory(), size, mtime };
  }
}

function renderDirectoryListing(dirPath: string, urlPath: string): string {
  const items: string[] = [];
  for (const entry of iterateDirectoryEntries(dirPath)) {
    const name = entry.name + (entry.isDirectory ? "/" : "");
    const icon = entry.isDirectory ? "\u{1F4C1}" : "\u{1F4C4}";
    const size = entry.isDirectory ? "" : formatSize(entry.size);
    const mtime = entry.mtime.toISOString().slice(0, 19).replace("T", " ");
    items.push(
      `<tr><td>${icon}</td><td><a href="${escapeHtml(name)}">${escapeHtml(name)}</a></td><td>${size}</td><td>${mtime}</td></tr>`,
    );
  }
  const body = items.join("");
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><title>索引: ${escapeHtml(urlPath)}</title>
<style>
  body{font-family:-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:30px auto;padding:0 20px;color:#333}
  h1{color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:10px;word-break:break-all}
  table{width:100%;border-collapse:collapse;margin-top:20px}
  th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
  th{background:#f8f9fa;color:#555;font-weight:600}
  td a{color:#3498db;text-decoration:none} td a:hover{text-decoration:underline}
  .path{font-family:monospace;background:#f4f4f4;padding:2px 6px;border-radius:3px}
</style></head><body>
<h1>索引: <span class="path">${escapeHtml(urlPath)}</span></h1>
<table><thead><tr><th></th><th>名称</th><th>大小</th><th>修改时间</th></tr></thead><tbody>
${urlPath !== "/" ? '<tr><td>\u{1F519}</td><td><a href="../">../</a></td><td></td><td></td></tr>' : ""}
${body}
</tbody></table></body></html>`;
}

// ===== Argument parsing =====
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "start",
    options: { port: 8080, root: process.cwd(), listing: true, gzip: true },
    help: false,
  };
  if (args.length === 0) return result;
  if (args[0] === "--help" || args[0] === "-h") {
    result.help = true;
    return result;
  }
  if (args[0] === "start") args.shift();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case "-p":
      case "--port": {
        const p = parseInt(value, 10);
        if (!Number.isNaN(p) && p > 0 && p < 65536) {
          result.options.port = p;
          i++;
        }
        break;
      }
      case "-r":
      case "--root": {
        if (value) {
          result.options.root = path.resolve(value);
          i++;
        }
        break;
      }
      case "--no-listing":
        result.options.listing = false;
        break;
      case "--no-gzip":
        result.options.gzip = false;
        break;
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

function printHelp(): void {
  console.log(`
静态文件服务器 - 使用说明
用法: static-file-server start [-p port] [-r root] [--no-listing] [--no-gzip]
选项:
  start            启动服务器 (默认命令)
  -p, --port <n>   监听端口 (默认 8080)
  -r, --root <dir> 根目录 (默认当前目录)
  --no-listing     禁用目录列表
  --no-gzip        禁用 gzip 压缩
  -h, --help       显示帮助
特性: MIME / Range(206) / ETag(304) / gzip / 目录列表 / 路径安全(防穿越)
`);
}

// ===== Abstract class hierarchy: AbstractHandler -> FileHandler / DirectoryHandler =====
abstract class AbstractHandler {
  abstract readonly handlerKind: string;
  protected successor?: AbstractHandler;

  get [HANDLER_KIND](): string {
    return this.handlerKind;
  }
  setSuccessor(handler: AbstractHandler): AbstractHandler {
    this.successor = handler;
    return handler;
  }
  abstract canHandle(target: string, stat: fs.Stats): boolean;
  abstract handle(ctx: HandlerContext, target: string, stat: fs.Stats): void;
  protected pass(ctx: HandlerContext, target: string, stat: fs.Stats): void {
    if (this.successor) {
      this.successor.handle(ctx, target, stat);
    } else {
      sendText(ctx.res, "不支持的内容", HttpStatusCode.NOT_FOUND);
    }
  }
}

class FileHandler extends AbstractHandler {
  readonly handlerKind = "file";
  canHandle(_target: string, stat: fs.Stats): boolean {
    return stat.isFile();
  }

  handle(ctx: HandlerContext, target: string, stat: fs.Stats): void {
    if (!this.canHandle(target, stat)) {
      this.pass(ctx, target, stat);
      return;
    }
    const mime = getMimeType(target);
    const etag = computeEtag(stat, target);
    const inm = ctx.req.headers["if-none-match"];
    if (isString(inm) && inm === etag) {
      ctx.res.writeHead(HttpStatusCode.NOT_MODIFIED, { ETag: etag });
      ctx.res.end();
      return;
    }
    sendResponse(ctx, this.buildResponse(ctx, target, stat, mime, etag));
  }

  private buildResponse(
    ctx: HandlerContext,
    target: string,
    stat: fs.Stats,
    mime: string,
    etag: string,
  ): ServerResponse {
    const baseHeaders: ReadonlyFields<http.OutgoingHttpHeaders> = {
      "Content-Type": mime,
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "Cache-Control": `${CacheDirective.PUBLIC}, max-age=0, ${CacheDirective.MUST_REVALIDATE}`,
      "Accept-Ranges": "bytes",
    };
    const rangeHeader = ctx.req.headers["range"];
    if (isString(rangeHeader)) {
      const range = parseRange(rangeHeader, stat.size);
      if (range) {
        const tuple: RangeTuple = rangeToTuple(range);
        return {
          kind: "range",
          status: HttpStatusCode.PARTIAL_CONTENT,
          headers: baseHeaders,
          filePath: target,
          stat,
          range: { start: tuple[0], end: tuple[1] },
        };
      }
    }
    if (
      ctx.options.gzip &&
      acceptsGzip(ctx.req) &&
      shouldCompress(mime) &&
      stat.size > 1024
    ) {
      return {
        kind: "gzip",
        status: HttpStatusCode.OK,
        headers: baseHeaders,
        filePath: target,
        stat,
        mime,
      };
    }
    return {
      kind: "file",
      status: HttpStatusCode.OK,
      headers: baseHeaders,
      filePath: target,
      stat,
      mime,
    };
  }
}

class DirectoryHandler extends AbstractHandler {
  readonly handlerKind = "directory";
  canHandle(_target: string, stat: fs.Stats): boolean {
    return stat.isDirectory();
  }

  handle(ctx: HandlerContext, target: string, stat: fs.Stats): void {
    if (!this.canHandle(target, stat)) {
      this.pass(ctx, target, stat);
      return;
    }
    // 优先 index.html
    const indexPath = path.join(target, "index.html");
    if (fs.existsSync(indexPath)) {
      try {
        const indexStat = fs.statSync(indexPath);
        if (indexStat.isFile()) {
          new FileHandler().handle(ctx, indexPath, indexStat);
          return;
        }
      } catch {
        /* 回退到目录列表 */
      }
    }
    if (ctx.options.listing) {
      const urlPath = (ctx.req.url ?? "/").split("?")[0];
      const response: DirectoryResponse = {
        kind: "directory",
        status: HttpStatusCode.OK,
        headers: { "Content-Type": ContentType.TEXT_HTML },
        dirPath: target,
        html: renderDirectoryListing(target, urlPath),
      };
      sendResponse(ctx, response);
      return;
    }
    sendText(ctx.res, "禁止目录列表", HttpStatusCode.FORBIDDEN);
  }
}

// ===== Response dispatcher (type guards on discriminated union) =====
function sendResponse(ctx: HandlerContext, response: ServerResponse): void {
  const { res, req } = ctx;
  const method = req.method ?? HttpMethod.GET;

  if (isRangeResponse(response)) {
    const length = response.range.end - response.range.start + 1;
    const headers: http.OutgoingHttpHeaders = {
      ...response.headers,
      "Content-Range": `bytes ${response.range.start}-${response.range.end}/${response.stat.size}`,
      "Content-Length": length,
    };
    res.writeHead(response.status, headers);
    if (method === HttpMethod.HEAD) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(response.filePath, {
      start: response.range.start,
      end: response.range.end,
    });
    stream.on("error", () => {
      Logger.error(`读取失败: ${response.filePath}`);
      if (!res.headersSent)
        sendText(res, "读取失败", HttpStatusCode.INTERNAL_ERROR);
      res.destroy();
    });
    stream.pipe(res);
    return;
  }
  if (isGzipResponse(response)) {
    const headers: http.OutgoingHttpHeaders = {
      ...response.headers,
      "Content-Encoding": EncodingType.GZIP,
      Vary: "Accept-Encoding",
    };
    res.writeHead(response.status, headers);
    if (method === HttpMethod.HEAD) {
      res.end();
      return;
    }
    const raw = fs.createReadStream(response.filePath);
    const gz = zlib.createGzip({ level: 6 });
    raw.on("error", () => {
      Logger.error(`读取失败: ${response.filePath}`);
      res.destroy();
    });
    gz.on("error", () => {
      Logger.error(`压缩失败: ${response.filePath}`);
      res.destroy();
    });
    raw.pipe(gz).pipe(res);
    return;
  }
  if (isDirectoryResponse(response)) {
    const buf = Buffer.from(response.html, "utf8");
    const headers: http.OutgoingHttpHeaders = {
      ...response.headers,
      "Content-Length": buf.length,
    };
    res.writeHead(response.status, headers);
    if (method === HttpMethod.HEAD) {
      res.end();
      return;
    }
    res.end(buf);
    return;
  }
  if (isFileResponse(response)) {
    const headers: http.OutgoingHttpHeaders = {
      ...response.headers,
      "Content-Length": response.stat.size,
    };
    res.writeHead(response.status, headers);
    if (method === HttpMethod.HEAD) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(response.filePath);
    stream.on("error", () => {
      Logger.error(`读取失败: ${response.filePath}`);
      if (!res.headersSent)
        sendText(res, "读取失败", HttpStatusCode.INTERNAL_ERROR);
      res.destroy();
    });
    stream.pipe(res);
    return;
  }
  // Exhaustiveness check
  const _exhaustive: never = response;
  void _exhaustive;
}

// ===== Top-level request handler =====
function serveStatic(ctx: HandlerContext): void {
  const { req, res, options } = ctx;
  const method = req.method ?? HttpMethod.GET;
  const url = req.url ?? "/";
  if (method !== HttpMethod.GET && method !== HttpMethod.HEAD) {
    sendText(res, "方法不允许", HttpStatusCode.METHOD_NOT_ALLOWED);
    return;
  }
  const target = safeJoin(options.root, url.split("?")[0]);
  if (!target) {
    sendText(res, "禁止访问", HttpStatusCode.FORBIDDEN);
    return;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    sendText(res, "未找到", HttpStatusCode.NOT_FOUND);
    return;
  }

  // Chain of responsibility: DirectoryHandler -> FileHandler
  const dirHandler = new DirectoryHandler();
  dirHandler.setSuccessor(new FileHandler());
  try {
    dirHandler.handle(ctx, target, stat);
  } catch (err) {
    if (isServerError(err)) {
      sendText(res, err.message, err.statusCode);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(msg);
      sendText(res, "内部错误", HttpStatusCode.INTERNAL_ERROR);
    }
  }
}

// ===== Server lifecycle =====
function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const method = req.method ?? HttpMethod.GET;
    const url = req.url ?? "/";
    const ctx: HandlerContext = { req, res, options };
    serveStatic(ctx);
    res.on("finish", () => Logger.req(method, url, res.statusCode));
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      Logger.error(`端口 ${options.port} 已被占用`);
    } else {
      Logger.error(err.message);
    }
    process.exit(1);
  });
  server.listen(options.port, () => {
    Logger.info(`静态文件服务器运行于 http://localhost:${options.port}`);
    Logger.info(`根目录: ${options.root}`);
    Logger.info(`目录列表: ${options.listing ? "开启" : "关闭"}`);
    Logger.info(`gzip 压缩: ${options.gzip ? "开启" : "关闭"}`);
    Logger.info(`已注册 MIME 类型: ${mimeRegistry.size} 种`);
  });
  return server;
}

function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }
  if (!fs.existsSync(parsed.options.root)) {
    Logger.error(`根目录不存在: ${parsed.options.root}`);
    process.exit(1);
  }
  const server = startServer(parsed.options);
  const shutdown = (sig: string) => {
    Logger.warn(`收到 ${sig}，关闭服务器...`);
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
