#!/usr/bin/env node
/**
 * 50. 图片上传与展示 Web App (Enhanced)
 * 多图上传 + 画廊展示 Web 应用 (增强版，运用大量高级 TypeScript 特性)。
 * 命令: start [-p port] [-d gallerydir] ; 仅使用 Node.js 内置模块。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { URL } from "url";

/* ====================== 枚举 (字符串 / 数字) ====================== */
enum HttpMethod {
  GET = "GET",
  POST = "POST",
  DELETE = "DELETE",
  PUT = "PUT",
  PATCH = "PATCH",
}
enum StatusCode {
  OK = 200,
  BAD_REQUEST = 400,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  PAYLOAD_TOO_LARGE = 413,
  INTERNAL_ERROR = 500,
}
enum SortOrder {
  NewestFirst = 0,
  OldestFirst = 1,
  LargestFirst = 2,
  SmallestFirst = 3,
  ByName = 4,
}
enum ImageFormat {
  Png = 0,
  Jpeg = 1,
  Gif = 2,
  Webp = 3,
  Bmp = 4,
  Svg = 5,
  Unknown = 6,
}
enum AppErrorCode {
  InvalidInput = "INVALID_INPUT",
  NotFound = "NOT_FOUND",
  Forbidden = "FORBIDDEN",
  TooLarge = "TOO_LARGE",
  ParseError = "PARSE_ERROR",
  IoError = "IO_ERROR",
}
enum ContentType {
  HTML = "text/html; charset=utf-8",
  JSON = "application/json; charset=utf-8",
  PNG = "image/png",
  JPEG = "image/jpeg",
  GIF = "image/gif",
  WEBP = "image/webp",
  BMP = "image/bmp",
  SVG = "image/svg+xml",
  OCTET_STREAM = "application/octet-stream",
  MULTIPART = "multipart/form-data",
}

/* ============ 模板字面量类型 / Symbol / 元组 ============ */
type ApiPath = `/api/${string}`;
type ImagePath = `/images/${string}`;
type RoutePath = "/" | "/index.html" | "/upload" | ApiPath | ImagePath;
const STORE_SYMBOL = Symbol("MetadataStore");
const FORMAT_SYMBOL = Symbol("format");
type Dimension = readonly [number, number];
type DetectionResult = readonly [ImageFormat, Dimension | null];

/* ============ 判别联合 (图像信息) ============ */
interface BaseImageInfo {
  readonly format: ImageFormat;
  readonly mime: ContentType;
}
interface PngImage extends BaseImageInfo {
  format: ImageFormat.Png;
  mime: ContentType.PNG;
  width: number;
  height: number;
  bitDepth: number;
}
interface JpegImage extends BaseImageInfo {
  format: ImageFormat.Jpeg;
  mime: ContentType.JPEG;
  width: number;
  height: number;
  quality: number | null;
}
interface GifImage extends BaseImageInfo {
  format: ImageFormat.Gif;
  mime: ContentType.GIF;
  width: number;
  height: number;
  animated: boolean;
}
interface WebpImage extends BaseImageInfo {
  format: ImageFormat.Webp;
  mime: ContentType.WEBP;
  width: number;
  height: number;
  lossless: boolean;
}
interface BmpImage extends BaseImageInfo {
  format: ImageFormat.Bmp;
  mime: ContentType.BMP;
  width: number;
  height: number;
}
interface SvgImage extends BaseImageInfo {
  format: ImageFormat.Svg;
  mime: ContentType.SVG;
  viewBox: string | null;
}
interface UnknownImage extends BaseImageInfo {
  format: ImageFormat.Unknown;
  mime: ContentType.OCTET_STREAM;
}
type ImageInfo =
  | PngImage
  | JpegImage
  | GifImage
  | WebpImage
  | BmpImage
  | SvgImage
  | UnknownImage;

/* ============ 映射类型 / 条件类型 ============ */
type Mutable<T> = { -readonly [P in keyof T]: T[P] };
type ImageMetaInput = Omit<ImageMeta, "id" | "uploadedAt" | "format">;
type ImageMetaSummary = Pick<
  ImageMeta,
  "id" | "filename" | "size" | "width" | "height"
>;
type ImageMetaPatch = Partial<Omit<ImageMeta, "id">>;
type IsImage<T extends ImageInfo> = T extends UnknownImage ? false : true;
type DimensionField<T extends ImageInfo> = T extends SvgImage
  ? "viewBox"
  : "width";

/* ============ 接口 (optional / readonly / index signature) ============ */
interface ServerOptions {
  port: number;
  galleryDir: string;
  readonly env: string;
  [key: string]: unknown;
}
interface ImageMeta {
  readonly id: string;
  filename: string;
  savedAs: string;
  size: number;
  contentType: string;
  uploadedAt: string;
  width: number | null;
  height: number | null;
  format: ImageFormat;
}
interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}
interface MultipartField {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

/* ============ 自定义错误层级 (带 code 属性) ============ */
class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: StatusCode;
  constructor(message: string, code: AppErrorCode, status: StatusCode) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}
class InvalidInputError extends AppError {
  constructor(m: string) {
    super(m, AppErrorCode.InvalidInput, StatusCode.BAD_REQUEST);
    this.name = "InvalidInputError";
  }
}
class NotFoundError extends AppError {
  constructor(m: string) {
    super(m, AppErrorCode.NotFound, StatusCode.NOT_FOUND);
    this.name = "NotFoundError";
  }
}
class TooLargeError extends AppError {
  constructor(m: string) {
    super(m, AppErrorCode.TooLarge, StatusCode.PAYLOAD_TOO_LARGE);
    this.name = "TooLargeError";
  }
}
class ParseErrorEx extends AppError {
  constructor(m: string) {
    super(m, AppErrorCode.ParseError, StatusCode.BAD_REQUEST);
    this.name = "ParseError";
  }
}

/* ============ 类型守卫 ============ */
function hasDimension(
  info: ImageInfo,
): info is PngImage | JpegImage | GifImage | WebpImage | BmpImage {
  return info.format !== ImageFormat.Svg && info.format !== ImageFormat.Unknown;
}
function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/* ============ 抽象图像检测器层级 ============ */
abstract class AbstractImageDetector {
  abstract readonly supportedFormat: ImageFormat;
  abstract detect(buf: Buffer): DetectionResult | null;
  protected safeRead(
    buf: Buffer,
    offset: number,
    length: number,
  ): Buffer | null {
    if (offset < 0 || offset + length > buf.length) return null;
    return buf.slice(offset, offset + length);
  }
}
class PngDetector extends AbstractImageDetector {
  readonly supportedFormat = ImageFormat.Png;
  detect(buf: Buffer): DetectionResult | null {
    if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR")
      return null;
    return [ImageFormat.Png, [buf.readUInt32BE(16), buf.readUInt32BE(20)]];
  }
}
class JpegDetector extends AbstractImageDetector {
  readonly supportedFormat = ImageFormat.Jpeg;
  detect(buf: Buffer): DetectionResult | null {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      )
        return [
          ImageFormat.Jpeg,
          [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)],
        ];
      i += 2 + len;
    }
    return null;
  }
}
class GifDetector extends AbstractImageDetector {
  readonly supportedFormat = ImageFormat.Gif;
  detect(buf: Buffer): DetectionResult | null {
    if (buf.length < 10) return null;
    const sig = buf.toString("ascii", 0, 6);
    if (sig !== "GIF87a" && sig !== "GIF89a") return null;
    return [ImageFormat.Gif, [buf.readUInt16LE(6), buf.readUInt16LE(8)]];
  }
}
class BmpDetector extends AbstractImageDetector {
  readonly supportedFormat = ImageFormat.Bmp;
  detect(buf: Buffer): DetectionResult | null {
    if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
    return [
      ImageFormat.Bmp,
      [Math.abs(buf.readInt32LE(18)), Math.abs(buf.readInt32LE(22))],
    ];
  }
}
class WebpDetector extends AbstractImageDetector {
  readonly supportedFormat = ImageFormat.Webp;
  detect(buf: Buffer): DetectionResult | null {
    if (buf.length < 30) return null;
    const vp = buf.toString("ascii", 12, 16);
    if (vp === "VP8 ")
      return [
        ImageFormat.Webp,
        [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff],
      ];
    if (vp === "VP8L") {
      const b0 = buf[21],
        b1 = buf[22],
        b2 = buf[23],
        b3 = buf[24];
      return [
        ImageFormat.Webp,
        [
          1 + (((b1 & 0x3f) << 8) | b0),
          1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        ],
      ];
    }
    if (vp === "VP8X")
      return [
        ImageFormat.Webp,
        [
          1 + (buf.readUInt32LE(24) & 0xffffff),
          1 + (buf.readUInt32LE(27) & 0xffffff),
        ],
      ];
    return null;
  }
}
class SvgDetector extends AbstractImageDetector {
  readonly supportedFormat = ImageFormat.Svg;
  detect(buf: Buffer): DetectionResult | null {
    const head = buf.slice(0, Math.min(512, buf.length)).toString("utf8");
    if (head.includes("<svg") || head.includes("<?xml"))
      return [ImageFormat.Svg, null];
    return null;
  }
}
class DetectorRegistry {
  private readonly detectors: readonly AbstractImageDetector[];
  constructor(detectors: readonly AbstractImageDetector[]) {
    this.detectors = detectors;
  }
  detect(buf: Buffer, mimeHint?: string): DetectionResult {
    for (const d of this.detectors) {
      const r = d.detect(buf);
      if (r) return r;
    }
    return [mimeToFormat(mimeHint ?? ""), null];
  }
}
function mimeToFormat(mime: string): ImageFormat {
  switch (mime) {
    case ContentType.PNG:
      return ImageFormat.Png;
    case ContentType.JPEG:
      return ImageFormat.Jpeg;
    case ContentType.GIF:
      return ImageFormat.Gif;
    case ContentType.WEBP:
      return ImageFormat.Webp;
    case ContentType.BMP:
      return ImageFormat.Bmp;
    case ContentType.SVG:
      return ImageFormat.Svg;
    default:
      return ImageFormat.Unknown;
  }
}
const DEFAULT_DETECTORS: readonly AbstractImageDetector[] = [
  new PngDetector(),
  new JpegDetector(),
  new GifDetector(),
  new BmpDetector(),
  new WebpDetector(),
  new SvgDetector(),
];
const registry = new DetectorRegistry(DEFAULT_DETECTORS);

/** 由检测器构建 ImageInfo (判别联合) */
function buildImageInfo(buf: Buffer, mime: string): ImageInfo {
  const [fmt, dim] = registry.detect(buf, mime);
  const w = dim ? dim[0] : null;
  const h = dim ? dim[1] : null;
  switch (fmt) {
    case ImageFormat.Png:
      return {
        format: fmt,
        mime: ContentType.PNG,
        width: w ?? 0,
        height: h ?? 0,
        bitDepth: 8,
      };
    case ImageFormat.Jpeg:
      return {
        format: fmt,
        mime: ContentType.JPEG,
        width: w ?? 0,
        height: h ?? 0,
        quality: null,
      };
    case ImageFormat.Gif:
      return {
        format: fmt,
        mime: ContentType.GIF,
        width: w ?? 0,
        height: h ?? 0,
        animated: false,
      };
    case ImageFormat.Webp:
      return {
        format: fmt,
        mime: ContentType.WEBP,
        width: w ?? 0,
        height: h ?? 0,
        lossless: false,
      };
    case ImageFormat.Bmp:
      return {
        format: fmt,
        mime: ContentType.BMP,
        width: w ?? 0,
        height: h ?? 0,
      };
    case ImageFormat.Svg:
      return { format: fmt, mime: ContentType.SVG, viewBox: null };
    default:
      return { format: ImageFormat.Unknown, mime: ContentType.OCTET_STREAM };
  }
}

/* ============ 泛型元数据存储 (带约束) ============ */
class MetadataStore<T extends { id: string }> {
  private items: Map<string, T> = new Map();
  private order: string[] = [];
  readonly [STORE_SYMBOL]: boolean = true;
  readonly [FORMAT_SYMBOL] = "metadata-store";
  get count(): number {
    return this.items.size;
  }
  add(item: T): this {
    if (!this.items.has(item.id)) this.order.push(item.id);
    this.items.set(item.id, item);
    return this;
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  remove(id: string): T | undefined {
    const item = this.items.get(id);
    if (item) {
      this.items.delete(id);
      this.order = this.order.filter((x) => x !== id);
    }
    return item;
  }
  list(): T[] {
    return this.order.map((id) => this.items.get(id)!).filter(Boolean);
  }
  *[Symbol.iterator](): Iterator<T> {
    for (const id of this.order) {
      const it = this.items.get(id);
      if (it) yield it;
    }
  }
  filter(predicate: (item: T) => boolean): T[] {
    const r: T[] = [];
    for (const it of this) if (predicate(it)) r.push(it);
    return r;
  }
}

/* ============ as const / satisfies 常量 ============ */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
] as const;
type AllowedMime = (typeof ALLOWED_MIME)[number];
const RUNTIME_CONFIG = {
  maxImageSize: MAX_IMAGE_SIZE,
  maxTotalBody: MAX_IMAGE_SIZE * 20 + 2 * 1024 * 1024,
  allowedMime: ALLOWED_MIME,
  cacheMaxAge: 86400,
} satisfies {
  maxImageSize: number;
  maxTotalBody: number;
  allowedMime: readonly string[];
  cacheMaxAge: number;
};
/** 列出所有 image/* 类型 (演示 Object.values 对字符串枚举的兼容性) */
const SUPPORTED_IMAGE_MIMES: readonly ContentType[] = Object.values(
  ContentType,
).filter((ct) => ct.startsWith("image/"));

/* ============ 函数重载 ============ */
function formatSize(bytes: number): string;
function formatSize(bytes: number, withUnit: false): number;
function formatSize(bytes: number, withUnit: boolean = true): string | number {
  if (withUnit === false) return bytes;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ============ Logger (静态 getter/setter) ============ */
class Logger {
  private static _level = 3;
  static get level(): number {
    return Logger._level;
  }
  static set level(v: number) {
    Logger._level = Math.max(0, Math.min(5, v));
  }
  static info(msg: string): void {
    if (Logger._level >= 3) console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  }
  static warn(msg: string): void {
    if (Logger._level >= 2) console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  }
  static error(msg: string): void {
    if (Logger._level >= 1) console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  }
  static req(method: string, url: string, status: number): void {
    const color =
      status < 300 ? 32 : status < 400 ? 36 : status < 500 ? 33 : 31;
    console.log(
      `${new Date().toISOString()} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${color}m${status}\x1b[0m`,
    );
  }
}

/* ============ 排序 / 摘要 / 生成器 ============ */
function sortMetas(metas: ImageMeta[], order: SortOrder): ImageMeta[] {
  const arr: Mutable<ImageMeta>[] = metas.map((m) => ({ ...m }));
  const cmp: Record<SortOrder, (a: ImageMeta, b: ImageMeta) => number> = {
    [SortOrder.NewestFirst]: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt),
    [SortOrder.OldestFirst]: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
    [SortOrder.LargestFirst]: (a, b) => b.size - a.size,
    [SortOrder.SmallestFirst]: (a, b) => a.size - b.size,
    [SortOrder.ByName]: (a, b) => a.filename.localeCompare(b.filename),
  };
  return arr.sort(cmp[order]);
}
function summarize(meta: ImageMeta): ImageMetaSummary {
  return {
    id: meta.id,
    filename: meta.filename,
    size: meta.size,
    width: meta.width,
    height: meta.height,
  };
}
function* imageSummaries(
  store: MetadataStore<ImageMeta>,
): Generator<ImageMetaSummary, void, unknown> {
  for (const meta of store) yield summarize(meta);
}

/* ============ 命令行解析 ============ */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "start",
    options: {
      port: 5000,
      galleryDir: path.resolve(process.cwd(), "gallery"),
      env: process.env.NODE_ENV ?? "dev",
    },
    help: false,
  };
  if (args.length === 0) return result;
  if (args[0] === "-h" || args[0] === "--help") {
    result.help = true;
    return result;
  }
  if (args[0] === "start") args.shift();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if ((flag === "-p" || flag === "--port") && value) {
      const p = parseInt(value, 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) {
        result.options.port = p;
        i++;
      }
    } else if (
      (flag === "-d" || flag === "--dir" || flag === "--gallery") &&
      value
    ) {
      result.options.galleryDir = path.resolve(value);
      i++;
    } else if (flag === "-h" || flag === "--help") result.help = true;
  }
  return result;
}
function printHelp(): void {
  console.log(`
图片上传与展示 Web App - 使用说明
用法: image-gallery-web-app start [-p port] [-d gallerydir]
选项:
  start             启动服务器 (默认命令)
  -p, --port <n>    监听端口 (默认 5000)
  -d, --dir <path>  图片存储目录 (默认 ./gallery)
  -h, --help        显示帮助
API:
  GET    /api/images           获取所有图片元数据 (支持 ?sort=0..4)
  DELETE /api/images/:id       删除图片
  POST   /upload               上传图片 (multipart/form-data)
  GET /                        画廊 HTML
  GET /images/:file            访问图片
`);
}

/* ============ 元数据持久化 ============ */
function metaFile(options: ServerOptions): string {
  return path.join(options.galleryDir, "metadata.json");
}
function loadMetaStore(options: ServerOptions): MetadataStore<ImageMeta> {
  const store = new MetadataStore<ImageMeta>();
  try {
    if (fs.existsSync(metaFile(options))) {
      const data = JSON.parse(fs.readFileSync(metaFile(options), "utf8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && typeof item.id === "string") {
            store.add({
              id: item.id,
              filename: String(item.filename ?? ""),
              savedAs: String(item.savedAs ?? ""),
              size: Number(item.size ?? 0),
              contentType: String(item.contentType ?? ContentType.OCTET_STREAM),
              uploadedAt: String(item.uploadedAt ?? new Date().toISOString()),
              width: item.width != null ? Number(item.width) : null,
              height: item.height != null ? Number(item.height) : null,
              format:
                typeof item.format === "number"
                  ? item.format
                  : ImageFormat.Unknown,
            });
          }
        }
      }
    }
  } catch (err) {
    Logger.warn(
      "元数据加载失败: " + (err instanceof Error ? err.message : String(err)),
    );
  }
  return store;
}
function saveMetaStore(
  options: ServerOptions,
  store: MetadataStore<ImageMeta>,
): void {
  try {
    fs.writeFileSync(
      metaFile(options),
      JSON.stringify(store.list(), null, 2),
      "utf8",
    );
  } catch (err) {
    Logger.error(
      "元数据保存失败: " + (err instanceof Error ? err.message : String(err)),
    );
  }
}
function uniqueFilename(original: string): string {
  const ext = path.extname(original).toLowerCase() || ".bin";
  const base =
    path
      .basename(original, ext)
      .replace(/[^\w\u4e00-\u9fa5.-]/g, "_")
      .slice(0, 30) || "image";
  return `${base}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
}

/* ============ multipart 解析 ============ */
function extractBoundary(contentType: string): string | null {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  return m ? (m[1] ?? m[2] ?? null) : null;
}
function parsePartHeaders(raw: string): {
  name: string;
  filename: string | null;
  contentType: string;
} {
  let name = "";
  let filename: string | null = null;
  let contentType = "text/plain";
  for (const line of raw.split("\r\n")) {
    const lower = line.toLowerCase();
    if (lower.startsWith("content-disposition:")) {
      const disp = line.substring(line.indexOf(":") + 1).trim();
      const nm = disp.match(/name="([^"]*)"/);
      if (nm) name = nm[1];
      const fm = disp.match(/filename="([^"]*)"/);
      if (fm) filename = fm[1];
    } else if (lower.startsWith("content-type:"))
      contentType = line.substring(line.indexOf(":") + 1).trim();
  }
  return { name, filename, contentType };
}
function parseMultipart(buffer: Buffer, boundary: string): MultipartField[] {
  const fields: MultipartField[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const positions: number[] = [];
  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    positions.push(idx);
    start = idx + boundaryBuf.length;
  }
  for (let i = 0; i < positions.length - 1; i++) {
    const partStart = positions[i] + boundaryBuf.length;
    let cursor = partStart;
    if (
      cursor + 2 <= buffer.length &&
      buffer[cursor] === 0x0d &&
      buffer[cursor + 1] === 0x0a
    )
      cursor += 2;
    else continue;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) continue;
    const headerBuf = buffer.slice(cursor, headerEnd);
    let contentEnd = positions[i + 1];
    if (
      contentEnd >= 2 &&
      buffer[contentEnd - 2] === 0x0d &&
      buffer[contentEnd - 1] === 0x0a
    )
      contentEnd -= 2;
    const content = buffer.slice(headerEnd + 4, contentEnd);
    const headers = parsePartHeaders(headerBuf.toString("utf8"));
    fields.push({
      name: headers.name,
      filename: headers.filename,
      contentType: headers.contentType,
      data: content,
    });
  }
  return fields;
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
        reject(new TooLargeError(`请求体超过限制 ${limit} 字节`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ============ HTTP 工具 ============ */
function getMime(ext: string): string {
  const map: Record<string, string> = {
    ".html": ContentType.HTML,
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": ContentType.PNG,
    ".jpg": ContentType.JPEG,
    ".jpeg": ContentType.JPEG,
    ".gif": ContentType.GIF,
    ".webp": ContentType.WEBP,
    ".bmp": ContentType.BMP,
    ".svg": ContentType.SVG,
    ".ico": "image/x-icon",
  };
  return map[ext.toLowerCase()] ?? ContentType.OCTET_STREAM;
}
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status: StatusCode = StatusCode.OK,
): void {
  const buf = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": ContentType.JSON,
    "Content-Length": buf.length,
  });
  res.end(buf);
}
function sendHtml(res: http.ServerResponse, html: string): void {
  const buf = Buffer.from(html, "utf8");
  res.writeHead(StatusCode.OK, {
    "Content-Type": ContentType.HTML,
    "Content-Length": buf.length,
  });
  res.end(buf);
}
function parseSortOrder(value: string | null): SortOrder {
  const n = parseInt(value ?? "", 10);
  switch (n) {
    case SortOrder.NewestFirst:
      return SortOrder.NewestFirst;
    case SortOrder.OldestFirst:
      return SortOrder.OldestFirst;
    case SortOrder.LargestFirst:
      return SortOrder.LargestFirst;
    case SortOrder.SmallestFirst:
      return SortOrder.SmallestFirst;
    case SortOrder.ByName:
      return SortOrder.ByName;
    default:
      return SortOrder.NewestFirst;
  }
}

/* ============ 画廊 HTML ============ */
function galleryPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>图片画廊</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif;background:#f5f7fa;color:#333;min-height:100vh;padding:20px}
h1{color:#2c3e50;margin-bottom:20px;text-align:center}
.upload-card{background:#fff;max-width:880px;margin:0 auto 24px;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.upload-area{border:2px dashed #bbb;border-radius:8px;padding:28px;text-align:center;cursor:pointer;transition:all .2s}
.upload-area:hover,.upload-area.drag{border-color:#3498db;background:#ebf5fb} .upload-area p{color:#7f8c8d;margin-top:8px}
input[type="file"]{display:none} .btn{background:#3498db;color:#fff;border:none;padding:10px 22px;border-radius:4px;cursor:pointer;font-size:14px;margin-top:12px}
.btn:hover{background:#2980b9} .btn:disabled{background:#aaa;cursor:not-allowed}
.gallery{max-width:880px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.card{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.1);position:relative}
.card img{width:100%;height:160px;object-fit:cover;display:block;cursor:pointer}
.card .meta{padding:8px 10px;font-size:12px;color:#666} .card .meta .name{color:#333;font-weight:600;word-break:break-all}
.card .delete{position:absolute;top:6px;right:6px;background:rgba(231,76,60,.9);color:#fff;border:none;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px}
.card .delete:hover{background:#c0392b} .empty{text-align:center;padding:60px 20px;color:#aaa;grid-column:1/-1}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:1000}
.modal.show{display:flex} .modal img{max-width:90%;max-height:90%;border-radius:8px}
.modal-close{position:absolute;top:20px;right:30px;color:#fff;font-size:36px;cursor:pointer;user-select:none}
.status{text-align:center;color:#888;font-size:13px;margin-top:10px} .status.error{color:#e74c3c}
.toolbar{max-width:880px;margin:0 auto 16px;text-align:center} .toolbar select{padding:4px 8px;border-radius:4px;border:1px solid #ccc}
</style></head><body>
<h1>图片画廊</h1>
<div class="upload-card"><div class="upload-area" id="dropZone"><div style="font-size:36px">\u{1F4F7}</div>
<p>点击或拖拽图片到此处上传</p><p style="font-size:11px;color:#aaa">支持 PNG / JPEG / GIF / WEBP / BMP / SVG，单图最大 20MB</p></div>
<input type="file" id="fileInput" accept="image/*" multiple /><div id="status" class="status"></div></div>
<div class="toolbar"><label>排序: </label><select id="sortSel"><option value="0">最新优先</option><option value="1">最旧优先</option><option value="2">最大优先</option><option value="3">最小优先</option><option value="4">按名称</option></select></div>
<div class="gallery" id="gallery"></div>
<div class="modal" id="modal"><span class="modal-close" id="modalClose">&times;</span><img id="modalImg" src="" alt="预览" /></div>
<script>
const $=(id)=>document.getElementById(id);
const dropZone=$('dropZone'),fileInput=$('fileInput'),galleryEl=$('gallery'),statusEl=$('status'),modal=$('modal'),modalImg=$('modalImg'),modalClose=$('modalClose'),sortSel=$('sortSel');
dropZone.onclick=()=>fileInput.click();
dropZone.ondragover=(e)=>{e.preventDefault();dropZone.classList.add('drag')};
dropZone.ondragleave=()=>dropZone.classList.remove('drag');
dropZone.ondrop=(e)=>{e.preventDefault();dropZone.classList.remove('drag');uploadFiles(e.dataTransfer.files)};
fileInput.onchange=()=>uploadFiles(fileInput.files);
sortSel.onchange=()=>loadGallery();
async function uploadFiles(files){if(!files||files.length===0)return;statusEl.className='status';statusEl.textContent='上传中... ('+files.length+' 张)';
  const fd=new FormData();for(const f of files)fd.append('images',f);
  try{const res=await fetch('/upload',{method:'POST',body:fd});const json=await res.json();
    if(res.ok){statusEl.textContent='上传成功 '+(json.uploaded?json.uploaded.length:0)+' 张'+(json.errors&&json.errors.length?'，失败 '+json.errors.length:'');loadGallery();}
    else{statusEl.className='status error';statusEl.textContent='上传失败: '+(json.error||res.status);}}
  catch(err){statusEl.className='status error';statusEl.textContent='上传失败: '+err.message;}}
async function loadGallery(){const res=await fetch('/api/images?sort='+sortSel.value);const data=await res.json();galleryEl.innerHTML='';
  if(!data.images||data.images.length===0){galleryEl.innerHTML='<div class="empty">还没有图片，上传一张试试吧！</div>';return;}
  for(const img of data.images){const card=document.createElement('div');card.className='card';
    card.innerHTML='<img src="/images/'+encodeURIComponent(img.savedAs)+'" alt="'+escapeHtml(img.filename)+'" loading="lazy" /><button class="delete" title="删除">&times;</button><div class="meta"><div class="name"></div><div>'+(img.width&&img.height?img.width+'x'+img.height+' · ':'')+formatSize(img.size)+' · '+new Date(img.uploadedAt).toLocaleString()+'</div></div>';
    card.querySelector('.name').textContent=img.filename;card.querySelector('img').onclick=()=>openModal('/images/'+encodeURIComponent(img.savedAs));
    card.querySelector('.delete').onclick=()=>del(img.id,card);galleryEl.appendChild(card);}}
async function del(id,card){if(!confirm('确定删除该图片？'))return;const res=await fetch('/api/images/'+id,{method:'DELETE'});if(res.ok){card.remove();statusEl.className='status';statusEl.textContent='已删除';}else{alert('删除失败');}}
function openModal(src){modalImg.src=src;modal.classList.add('show');}
modalClose.onclick=()=>modal.classList.remove('show');modal.onclick=(e)=>{if(e.target===modal)modal.classList.remove('show');};
function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function formatSize(b){if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';return (b/1048576).toFixed(1)+' MB';}
loadGallery();
</script></body></html>`;
}

/* ============ 请求处理 ============ */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions,
): Promise<void> {
  const method = req.method ?? HttpMethod.GET;
  const url = req.url ?? "/";
  const urlObj = new URL(url, `http://localhost:${options.port}`);
  const pathname = urlObj.pathname as RoutePath;
  if (
    method === HttpMethod.GET &&
    (pathname === "/" || pathname === "/index.html")
  ) {
    sendHtml(res, galleryPage());
    return;
  }
  if (method === HttpMethod.GET && pathname === "/api/images") {
    const store = loadMetaStore(options);
    const sorted = sortMetas(
      store.list(),
      parseSortOrder(urlObj.searchParams.get("sort")),
    );
    sendJson(res, {
      images: sorted,
      count: store.count,
      summaries: [...imageSummaries(store)],
    });
    return;
  }
  const delMatch = pathname.match(/^\/api\/images\/([\w-]+)$/);
  if (method === HttpMethod.DELETE && delMatch) {
    const store = loadMetaStore(options);
    const removed = store.remove(delMatch[1]);
    if (!removed) {
      sendJson(res, { error: "未找到" }, StatusCode.NOT_FOUND);
      return;
    }
    saveMetaStore(options, store);
    try {
      const fp = path.join(options.galleryDir, removed.savedAs);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      Logger.warn(
        "删除文件失败: " + (err instanceof Error ? err.message : String(err)),
      );
    }
    sendJson(res, { success: true, deleted: removed });
    return;
  }
  if (method === HttpMethod.POST && pathname === "/upload") {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().includes(ContentType.MULTIPART)) {
      sendJson(
        res,
        { error: "Content-Type 必须是 multipart/form-data" },
        StatusCode.BAD_REQUEST,
      );
      return;
    }
    const boundary = extractBoundary(contentType);
    if (!boundary) {
      sendJson(res, { error: "缺少 boundary" }, StatusCode.BAD_REQUEST);
      return;
    }
    let buffer: Buffer;
    try {
      buffer = await readBody(req, RUNTIME_CONFIG.maxTotalBody);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(
        res,
        { error: msg },
        isAppError(err) ? err.status : StatusCode.PAYLOAD_TOO_LARGE,
      );
      return;
    }
    let fields: MultipartField[];
    try {
      fields = parseMultipart(buffer, boundary);
    } catch (err) {
      sendJson(
        res,
        {
          error:
            "解析失败: " + (err instanceof Error ? err.message : String(err)),
        },
        StatusCode.BAD_REQUEST,
      );
      return;
    }
    const store = loadMetaStore(options);
    const uploaded: ImageMeta[] = [];
    const errors: string[] = [];
    for (const field of fields) {
      if (field.filename === null || field.filename === "") continue;
      if (!(ALLOWED_MIME as readonly string[]).includes(field.contentType)) {
        errors.push(
          `${field.filename} 不是允许的图片类型 (${field.contentType})`,
        );
        continue;
      }
      if (field.data.length > MAX_IMAGE_SIZE) {
        errors.push(`${field.filename} 超过 ${MAX_IMAGE_SIZE} 字节`);
        continue;
      }
      const savedAs = uniqueFilename(field.filename);
      try {
        fs.writeFileSync(path.join(options.galleryDir, savedAs), field.data);
        const info = buildImageInfo(field.data, field.contentType);
        const meta: ImageMeta = {
          id: crypto.randomBytes(8).toString("hex"),
          filename: field.filename,
          savedAs,
          size: field.data.length,
          contentType: field.contentType,
          uploadedAt: new Date().toISOString(),
          width: hasDimension(info) ? info.width : null,
          height: hasDimension(info) ? info.height : null,
          format: info.format,
        };
        store.add(meta);
        uploaded.push(meta);
        Logger.info(
          `已上传 ${field.filename} -> ${savedAs} (${formatSize(field.data.length)})`,
        );
      } catch (err) {
        errors.push(
          `保存 ${field.filename} 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    saveMetaStore(options, store);
    sendJson(res, {
      success: uploaded.length > 0,
      uploaded,
      errors,
      count: uploaded.length,
    });
    return;
  }
  const imgMatch = pathname.match(/^\/images\/(.+)$/);
  if (method === HttpMethod.GET && imgMatch) {
    const filename = path.basename(decodeURIComponent(imgMatch[1]));
    const filePath = path.join(options.galleryDir, filename);
    if (
      !filePath.startsWith(options.galleryDir + path.sep) &&
      filePath !== options.galleryDir
    ) {
      res.writeHead(StatusCode.FORBIDDEN);
      res.end("禁止访问");
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(StatusCode.NOT_FOUND);
      res.end("未找到");
      return;
    }
    const stat = fs.statSync(filePath);
    res.writeHead(StatusCode.OK, {
      "Content-Type": getMime(path.extname(filename)),
      "Content-Length": stat.size,
      "Cache-Control": `public, max-age=${RUNTIME_CONFIG.cacheMaxAge}`,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  res.writeHead(StatusCode.NOT_FOUND, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("未找到");
}

/* ============ 启动服务器 ============ */
function startServer(options: ServerOptions): http.Server {
  if (!fs.existsSync(options.galleryDir)) {
    fs.mkdirSync(options.galleryDir, { recursive: true });
    Logger.info(`已创建图片目录: ${options.galleryDir}`);
  }
  const server = http.createServer((req, res) => {
    const method = req.method ?? HttpMethod.GET;
    const url = req.url ?? "/";
    handleRequest(req, res, options).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error("处理失败: " + msg);
      if (!res.headersSent)
        sendJson(
          res,
          { error: msg },
          isAppError(err) ? err.status : StatusCode.INTERNAL_ERROR,
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
    Logger.info(`图片画廊应用运行于 http://localhost:${options.port}`);
    Logger.info(`图片目录: ${options.galleryDir}`);
    Logger.info(
      `单图限制: ${formatSize(MAX_IMAGE_SIZE)} (${MAX_IMAGE_SIZE} 字节)`,
    );
    Logger.info(`支持的图片类型: ${SUPPORTED_IMAGE_MIMES.join(", ")}`);
  });
  return server;
}

/* ============ 主函数 ============ */
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
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
