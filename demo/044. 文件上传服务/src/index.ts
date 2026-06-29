#!/usr/bin/env node
/**
 * 44. 文件上传服务 (Enhanced with advanced TypeScript features)
 * ----------------------------------------------------
 * HTTP 服务器，接收 multipart/form-data 上传，手动解析边界、头部、二进制内容。
 *   - GET  /        HTML 上传表单
 *   - POST /upload  接收多文件上传 (multipart/form-data)
 *   - GET  /files   列出已上传文件 (JSON)
 *   - 保存到 ./uploads 目录，限制单文件大小 (--max-size bytes)
 *
 * 增强特性: 字符串/常规枚举、泛型类、判别联合、映射类型、条件类型、模板字面量类型、
 *           抽象类层级、函数重载、自定义错误层级、satisfies、生成器、Symbol 唯一键、
 *           as const、类型守卫、元组与只读元组。仅使用 Node.js 内置模块。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ===== 1. 字符串枚举 (String Enums) =====
enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}
enum ContentType {
  Html = "text/html; charset=utf-8",
  Json = "application/json; charset=utf-8",
  Multipart = "multipart/form-data",
  TextPlain = "text/plain",
  OctetStream = "application/octet-stream",
  UrlEncoded = "application/x-www-form-urlencoded",
}
enum UploadStatus {
  Pending = "PENDING",
  Received = "RECEIVED",
  Saving = "SAVING",
  Success = "SUCCESS",
  Failed = "FAILED",
  Skipped = "SKIPPED",
}

// ===== 2. 常规枚举 (Regular Enums, 可与 Object.values() 共用) =====
enum ErrorCode {
  NotFound = "NOT_FOUND",
  BadRequest = "BAD_REQUEST",
  PayloadTooLarge = "PAYLOAD_TOO_LARGE",
  Internal = "INTERNAL_ERROR",
  MissingBoundary = "MISSING_BOUNDARY",
  UnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE",
  ParseError = "PARSE_ERROR",
  SaveFailed = "SAVE_FAILED",
}
enum FieldType {
  File = "FILE",
  Text = "TEXT",
}

// ===== 3. 判别联合 (Discriminated Unions) =====
interface BaseField {
  readonly kind: FieldType;
  readonly name: string;
  readonly contentType: string;
  readonly data: Buffer;
}
interface FileField extends BaseField {
  readonly kind: FieldType.File;
  readonly filename: string;
}
interface TextField extends BaseField {
  readonly kind: FieldType.Text;
  readonly filename: null;
  readonly value: string;
}
type UploadField = FileField | TextField;

// ===== 4. 条件类型 (Conditional Types) =====
type FieldKind<T extends UploadField> = T extends FileField
  ? FieldType.File
  : T extends TextField
    ? FieldType.Text
    : never;
type FieldFilename<T extends UploadField> = T extends FileField ? string : null;

// ===== 5. 模板字面量类型 (Template Literal Types) =====
type Route = `${HttpMethod} ${string}`;
type CustomHeader = `x-${string}`;
type BoundaryParam = `boundary=${string}`;

// ===== 6. 映射类型 (Mapped Types) =====
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
type Stringified<T extends object> = { [K in keyof T]: string };

// ===== 7. 元组与只读元组 (Tuples) =====
type HeaderPair = readonly [string, string];
type FieldTuple = readonly [string, UploadField];
type StatusEntry = readonly [string, UploadStatus, number];

// ===== 8. Symbol 唯一属性键 =====
const symId = Symbol("id");
const symMeta = Symbol("meta");

// ===== 9. as const 断言 =====
const DEFAULTS = {
  port: 5000,
  maxSize: 20 * 1024 * 1024,
  headerBudget: 1024 * 1024,
  multiplier: 16,
} as const;

const ROUTE_TABLE: Record<string, Route> = {
  index: "GET /",
  upload: "POST /upload",
  files: "GET /files",
} as const;

const PARSER_META = { [symMeta]: { version: 1, encoding: "utf8" } } as const;

// ===== 10. 接口 (optional / readonly / index signatures) =====
interface ServerOptions {
  readonly port: number;
  readonly uploadDir: string;
  readonly maxSize: number;
  readonly headers?: Record<string, string>;
}
interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}
interface UploadResultItem {
  readonly field: string;
  readonly filename: string;
  readonly savedAs: string;
  readonly size: number;
  readonly path: string;
  readonly contentType: string;
  readonly status: UploadStatus;
  [symId]: string;
}
interface FileListEntry {
  readonly name: string;
  readonly size: number;
  readonly mtime: string;
}
interface FieldAttributes {
  readonly [key: string]: string | number | boolean | null;
}

// ===== 11. 自定义错误层级 (Error hierarchy with `code`) =====
class UploadError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  constructor(message: string, code: ErrorCode, statusCode: number = 500) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class SizeLimitError extends UploadError {
  readonly limit: number;
  readonly actual: number;
  constructor(filename: string, limit: number, actual: number) {
    super(
      `文件 ${filename} 超过 ${limit} 字节限制 (实际 ${actual})`,
      ErrorCode.PayloadTooLarge,
      413,
    );
    this.name = "SizeLimitError";
    this.limit = limit;
    this.actual = actual;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class ParseError extends UploadError {
  constructor(message: string) {
    super(`解析 multipart 失败: ${message}`, ErrorCode.ParseError, 400);
    this.name = "ParseError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class SaveError extends UploadError {
  constructor(filename: string, cause: string) {
    super(`保存 ${filename} 失败: ${cause}`, ErrorCode.SaveFailed, 500);
    this.name = "SaveError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ===== 12. 类型守卫 (Type Guards) =====
function isFileField(field: UploadField): field is FileField {
  return field.kind === FieldType.File;
}
function isTextField(field: UploadField): field is TextField {
  return field.kind === FieldType.Text;
}
function isUploadError(err: unknown): err is UploadError {
  return err instanceof UploadError;
}
function hasCode(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

// ===== 13. 函数重载 (Function Overloads) =====
function createField(name: string, value: string): TextField;
function createField(
  name: string,
  filename: string,
  data: Buffer,
  contentType: string,
): FileField;
function createField(
  name: string,
  filenameOrValue: string,
  data?: Buffer,
  contentType?: string,
): UploadField {
  if (data !== undefined && contentType !== undefined) {
    return {
      kind: FieldType.File,
      name,
      filename: filenameOrValue,
      contentType,
      data,
    } satisfies FileField;
  }
  return {
    kind: FieldType.Text,
    name,
    filename: null,
    contentType: ContentType.TextPlain,
    data: Buffer.from(filenameOrValue, "utf8"),
    value: filenameOrValue,
  } satisfies TextField;
}

// ===== 14. Logger =====
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
    const time = new Date().toISOString();
    console.log(
      `${time} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${color}m${status}\x1b[0m`,
    );
  },
} as const;

// ===== 15. 抽象类与具体子类 (Abstract class hierarchy) =====
abstract class AbstractParser<T extends UploadField> {
  protected readonly buffer: Buffer;
  protected readonly positions: number[] = [];
  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }
  abstract parse(): T[];
  abstract get contentType(): string;
  get length(): number {
    return this.buffer.length;
  }
  protected indexOfSequence(seq: Buffer, from: number = 0): number {
    return this.buffer.indexOf(seq, from);
  }
  /** 生成器: 迭代解析出的所有字段 */
  *[Symbol.iterator](): Generator<T, void, undefined> {
    for (const f of this.parse()) yield f;
  }
}

class MultipartParser extends AbstractParser<UploadField> {
  private readonly boundary: string;
  private _contentType: ContentType = ContentType.Multipart;
  private _encoding: BufferEncoding = "utf8";
  constructor(buffer: Buffer, boundary: string) {
    super(buffer);
    this.boundary = boundary;
  }
  get contentType(): ContentType {
    return this._contentType;
  }
  get encoding(): BufferEncoding {
    return this._encoding;
  }
  set encoding(value: BufferEncoding) {
    this._encoding = value;
  }

  parse(): UploadField[] {
    const fields: UploadField[] = [];
    const boundaryBuf = Buffer.from(`--${this.boundary}`);
    this.positions.length = 0;
    let start = 0;
    while (start < this.buffer.length) {
      const idx = this.indexOfSequence(boundaryBuf, start);
      if (idx === -1) break;
      this.positions.push(idx);
      start = idx + boundaryBuf.length;
    }
    const crlf2 = Buffer.from("\r\n\r\n");
    for (let i = 0; i < this.positions.length - 1; i++) {
      const partStart = this.positions[i] + boundaryBuf.length;
      let cursor = partStart;
      if (
        cursor + 2 <= this.buffer.length &&
        this.buffer[cursor] === 0x0d &&
        this.buffer[cursor + 1] === 0x0a
      ) {
        cursor += 2;
      } else {
        continue;
      }
      const headerEnd = this.indexOfSequence(crlf2, cursor);
      if (headerEnd === -1) continue;
      const headerBuf = this.buffer.slice(cursor, headerEnd);
      const contentStart = headerEnd + 4;
      const nextBoundary = this.positions[i + 1];
      let contentEnd = nextBoundary;
      if (
        contentEnd >= 2 &&
        this.buffer[contentEnd - 2] === 0x0d &&
        this.buffer[contentEnd - 1] === 0x0a
      ) {
        contentEnd -= 2;
      }
      const content = this.buffer.slice(contentStart, contentEnd);
      const headers = this.parsePartHeaders(headerBuf.toString(this._encoding));
      if (headers.filename !== null) {
        fields.push({
          kind: FieldType.File,
          name: headers.name,
          filename: headers.filename,
          contentType: headers.contentType,
          data: content,
        } satisfies FileField);
      } else {
        fields.push({
          kind: FieldType.Text,
          name: headers.name,
          filename: null,
          contentType: headers.contentType || ContentType.TextPlain,
          data: content,
          value: content.toString(this._encoding),
        } satisfies TextField);
      }
    }
    return fields;
  }

  private parsePartHeaders(raw: string): {
    name: string;
    filename: string | null;
    contentType: string;
  } {
    const lines = raw.split("\r\n");
    let name = "";
    let filename: string | null = null;
    let contentType: string = ContentType.TextPlain;
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith("content-disposition:")) {
        const disp = line.substring(line.indexOf(":") + 1).trim();
        const nameMatch = disp.match(/name="([^"]*)"/);
        if (nameMatch) name = nameMatch[1];
        const fileMatch = disp.match(/filename="([^"]*)"/);
        if (fileMatch) filename = fileMatch[1];
      } else if (lower.startsWith("content-type:")) {
        contentType = line.substring(line.indexOf(":") + 1).trim();
      }
    }
    return { name, filename, contentType };
  }
}

// ===== 16. 生成器: 迭代上传字段 (Generators / Iterators) =====
function* iterateFileFields(
  fields: readonly UploadField[],
): Generator<FileField, void, undefined> {
  for (const f of fields) {
    if (isFileField(f)) yield f;
  }
}
function* enumerateFields(
  fields: readonly UploadField[],
): Generator<FieldTuple, void, undefined> {
  for (let i = 0; i < fields.length; i++) {
    yield [String(i), fields[i]] as const;
  }
}

// ===== 17. 泛型结果构造器 (Generic Result Builder with constraints) =====
class UploadResultBuilder<T extends UploadResultItem> {
  private readonly _results: T[] = [];
  private readonly _errors: string[] = [];
  private readonly _statuses: StatusEntry[] = [];
  private _label: string = "upload";
  addSuccess(item: T): this {
    this._results.push(item);
    this._statuses.push([item.filename, item.status, item.size]);
    return this;
  }
  addError(msg: string): this {
    this._errors.push(msg);
    return this;
  }
  addStatus(entry: StatusEntry): this {
    this._statuses.push(entry);
    return this;
  }
  get count(): number {
    return this._results.length;
  }
  get hasErrors(): boolean {
    return this._errors.length > 0;
  }
  get statuses(): readonly StatusEntry[] {
    return this._statuses;
  }
  get label(): string {
    return this._label;
  }
  set label(value: string) {
    this._label = value;
  }
  build(): {
    success: boolean;
    uploaded: readonly T[];
    errors: readonly string[];
    count: number;
  } {
    return {
      success: this._results.length > 0,
      uploaded: this._results,
      errors: this._errors,
      count: this._results.length,
    };
  }
  *[Symbol.iterator](): Generator<T, void, undefined> {
    for (const r of this._results) yield r;
  }
}

// ===== 18. 命令行参数解析 =====
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const opts: Mutable<ServerOptions> = {
    port: DEFAULTS.port,
    uploadDir: path.resolve(process.cwd(), "uploads"),
    maxSize: DEFAULTS.maxSize,
  };
  const result: ParsedArgs = { command: "start", options: opts, help: false };
  if (args.length === 0) return result;
  if (args[0] === "--help" || args[0] === "-h") {
    result.help = true;
    return result;
  }
  if (args[0] === "start") {
    args.shift();
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case "-p":
      case "--port": {
        const p = parseInt(value, 10);
        if (!Number.isNaN(p) && p > 0 && p < 65536) {
          opts.port = p;
          i++;
        }
        break;
      }
      case "-d":
      case "--dir":
      case "--uploaddir": {
        if (value) {
          opts.uploadDir = path.resolve(value);
          i++;
        }
        break;
      }
      case "--max-size": {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n > 0) {
          opts.maxSize = n;
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

function printHelp(): void {
  console.log(`
文件上传服务 - 使用说明

用法:
  file-upload-service start [-p port] [-d uploaddir] [--max-size bytes]

选项:
  start                 启动服务器 (默认命令)
  -p, --port <n>        监听端口 (默认 5000)
  -d, --dir <path>      上传保存目录 (默认 ./uploads)
  --max-size <bytes>    单文件最大字节数 (默认 20MB)
  -h, --help            显示帮助

路由:
  GET  /                HTML 上传表单
  POST /upload          接收 multipart/form-data 上传
  GET  /files           列出已上传文件 (JSON)
`);
}

// ===== 19. 工具函数 =====
function uniqueFilename(original: string): string {
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  const safeBase =
    base.replace(/[^\w\u4e00-\u9fa5.-]/g, "_").slice(0, 40) || "file";
  const hash = crypto.randomBytes(6).toString("hex");
  const ts = Date.now();
  return `${safeBase}_${ts}_${hash}${ext.toLowerCase()}`;
}

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  if (match) return match[1] ?? match[2] ?? null;
  return null;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      total += c.length;
      if (total > limit) {
        aborted = true;
        reject(new SizeLimitError("request-body", limit, total));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ===== 20. HTML 上传表单 =====
function uploadForm(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>文件上传</title>
  <style>
    body{font-family:-apple-system,"Segoe UI",sans-serif;max-width:640px;margin:40px auto;padding:20px;background:#f5f7fa;color:#333}
    h1{color:#2c3e50}.card{background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .form-row{margin-bottom:16px}label{display:block;margin-bottom:6px;font-weight:600;color:#555}
    input[type="file"]{width:100%;padding:8px;border:1px dashed #aaa;border-radius:4px}
    button{background:#3498db;color:#fff;border:none;padding:10px 20px;border-radius:4px;font-size:14px;cursor:pointer}
    button:hover{background:#2980b9}
    .result{margin-top:24px;padding:16px;background:#eaf7ea;border-radius:4px;display:none}
    .result.error{background:#fdecea}pre{white-space:pre-wrap;word-break:break-all}
    .note{font-size:12px;color:#888;margin-top:8px}
  </style>
</head>
<body>
  <h1>文件上传服务</h1>
  <div class="card">
    <form id="form" action="/upload" method="POST" enctype="multipart/form-data">
      <div class="form-row">
        <label for="files">选择文件 (可多选)</label>
        <input type="file" id="files" name="files" multiple required />
      </div>
      <div class="form-row">
        <label for="desc">描述 (可选)</label>
        <input type="text" id="desc" name="desc" placeholder="备注信息" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;" />
      </div>
      <button type="submit">上传</button>
    </form>
    <div class="note">单文件最大 20MB，仅使用 Node 内置模块实现 multipart 解析。</div>
    <div id="result" class="result"><pre id="output"></pre></div>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const resultEl = document.getElementById('result');
      const outputEl = document.getElementById('output');
      resultEl.style.display = 'block';
      resultEl.classList.remove('error');
      outputEl.textContent = '上传中...';
      try {
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const json = await res.json();
        outputEl.textContent = JSON.stringify(json, null, 2);
        if (!res.ok) resultEl.classList.add('error');
      } catch (err) {
        resultEl.classList.add('error');
        outputEl.textContent = '上传失败: ' + err.message;
      }
    });
  </script>
</body>
</html>`;
}

// ===== 21. 响应辅助 (使用只读元组 HeaderPair) =====
function writeResponse(
  res: http.ServerResponse,
  status: number,
  headers: readonly HeaderPair[],
  body: Buffer,
): void {
  const headerObj: Record<string, string> = {};
  for (const [k, v] of headers) headerObj[k] = v;
  res.writeHead(status, headerObj);
  res.end(body);
}
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status: number = 200,
): void {
  const body = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  const headers: HeaderPair[] = [
    ["Content-Type", ContentType.Json],
    ["Content-Length", String(body.length)],
  ];
  writeResponse(res, status, headers, body);
}
function sendHtml(
  res: http.ServerResponse,
  html: string,
  status: number = 200,
): void {
  const body = Buffer.from(html, "utf8");
  const headers: HeaderPair[] = [
    ["Content-Type", ContentType.Html],
    ["Content-Length", String(body.length)],
  ];
  writeResponse(res, status, headers, body);
}

// ===== 22. 列出已上传文件 =====
function listUploadedFiles(dir: string): FileListEntry[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .map((name): FileListEntry => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}
function stringifyEntry(entry: FileListEntry): Stringified<FileListEntry> {
  return { name: entry.name, size: String(entry.size), mtime: entry.mtime };
}

// ===== 23. 请求处理 =====
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: DeepReadonly<ServerOptions>,
): Promise<void> {
  const method = (req.method ?? HttpMethod.GET) as HttpMethod;
  const url = req.url ?? "/";

  if (method === HttpMethod.GET && (url === "/" || url === "/index.html")) {
    sendHtml(res, uploadForm());
    return;
  }
  if (method === HttpMethod.GET && url === "/files") {
    const list = listUploadedFiles(options.uploadDir);
    const stringified = list.map(stringifyEntry);
    sendJson(res, { files: list, count: list.length, stringified });
    return;
  }
  if (method === HttpMethod.POST && (url === "/upload" || url === "/")) {
    const contentTypeHeader = req.headers["content-type"] ?? "";
    if (!contentTypeHeader.toLowerCase().includes(ContentType.Multipart)) {
      sendJson(
        res,
        {
          error: "Content-Type 必须是 multipart/form-data",
          code: ErrorCode.UnsupportedMediaType,
        },
        400,
      );
      return;
    }
    const boundary = extractBoundary(contentTypeHeader);
    if (!boundary) {
      sendJson(
        res,
        { error: "缺少 boundary", code: ErrorCode.MissingBoundary },
        400,
      );
      return;
    }
    const totalLimit =
      options.maxSize * DEFAULTS.multiplier + DEFAULTS.headerBudget;
    let buffer: Buffer;
    try {
      buffer = await readBody(req, totalLimit);
    } catch (err) {
      if (isUploadError(err)) {
        sendJson(res, { error: err.message, code: err.code }, err.statusCode);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg, code: ErrorCode.PayloadTooLarge }, 413);
      }
      return;
    }
    let fields: UploadField[];
    try {
      const parser = new MultipartParser(buffer, boundary);
      fields = parser.parse();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(
        res,
        { error: "解析 multipart 失败: " + msg, code: ErrorCode.ParseError },
        400,
      );
      return;
    }
    const builder = new UploadResultBuilder<UploadResultItem>();
    builder.label = "multipart-upload";
    const attributes: Mutable<FieldAttributes> = {
      receivedAt: Date.now(),
      source: "multipart",
    };
    for (const field of iterateFileFields(fields)) {
      if (field.filename === "") {
        builder.addError(`跳过空文件名字段: ${field.name}`);
        continue;
      }
      if (field.data.length > options.maxSize) {
        const err = new SizeLimitError(
          field.filename,
          options.maxSize,
          field.data.length,
        );
        builder.addError(err.message);
        continue;
      }
      const savedName = uniqueFilename(field.filename);
      const fullPath = path.join(options.uploadDir, savedName);
      try {
        fs.writeFileSync(fullPath, field.data);
        const item: UploadResultItem = {
          field: field.name,
          filename: field.filename,
          savedAs: savedName,
          size: field.data.length,
          path: fullPath,
          contentType: field.contentType,
          status: UploadStatus.Success,
          [symId]: crypto.randomBytes(16).toString("hex"),
        };
        builder.addSuccess(item);
        Logger.info(
          `已保存 ${field.filename} -> ${savedName} (${field.data.length} bytes)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        builder.addError(new SaveError(field.filename, msg).message);
      }
    }
    for (const [, field] of enumerateFields(fields)) {
      if (isTextField(field)) {
        attributes[field.name] = field.value.slice(0, 32);
      }
    }
    sendJson(res, {
      ...builder.build(),
      attributes,
      [symMeta]: PARSER_META[symMeta],
    });
    return;
  }
  sendJson(
    res,
    { error: "未找到", method, url, code: ErrorCode.NotFound },
    404,
  );
}

// ===== 24. 启动服务器 =====
function startServer(options: ServerOptions): http.Server {
  if (!fs.existsSync(options.uploadDir)) {
    fs.mkdirSync(options.uploadDir, { recursive: true });
    Logger.info(`已创建上传目录: ${options.uploadDir}`);
  }
  const server = http.createServer((req, res) => {
    const method = req.method ?? HttpMethod.GET;
    const url = req.url ?? "/";
    handleRequest(req, res, options).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`处理失败: ${msg}`);
      if (!res.headersSent) {
        const code = hasCode(err) ? err.code : ErrorCode.Internal;
        sendJson(res, { error: "内部错误", message: msg, code }, 500);
      }
    });
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
    Logger.info(`文件上传服务运行于 http://localhost:${options.port}`);
    Logger.info(`上传目录: ${options.uploadDir}`);
    Logger.info(`单文件限制: ${options.maxSize} 字节`);
    Logger.info(`可用路由: ${Object.values(ROUTE_TABLE).join(", ")}`);
  });
  return server;
}

// ===== 25. 主函数 =====
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }
  const server = startServer(parsed.options);
  const shutdown = (sig: string): void => {
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
