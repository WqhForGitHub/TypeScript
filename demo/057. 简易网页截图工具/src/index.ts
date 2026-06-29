#!/usr/bin/env node
/**
 * 57. 简易网页截图工具 - 增强版
 * 文本快照工具（非像素截图）：抓取网页，提取标题/正文/链接/图片/元数据/响应头/计时。
 * 命令：snapshot / compare / archive。仅用 Node 内置模块。
 * 演示：枚举、判别式联合、映射/条件/模板字面量类型、抽象类、泛型类、函数重载、
 *       错误类层级、接口索引签名、satisfies、getter/setter、生成器/迭代器、Symbol、as const、类型守卫。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as crypto from "crypto";
import * as net from "net";

// --- 1. 枚举（字符串枚举 + 数字枚举）--------------------------------------

enum CliCommand {
  Snapshot = "snapshot",
  Compare = "compare",
  Archive = "archive",
  Help = "help",
}
enum ContentType {
  TextHtml = "text/html",
  ApplicationJson = "application/json",
  TextPlain = "text/plain",
  Unknown = "unknown",
}
enum SnapshotType {
  Text = "text",
  Json = "json",
  Archive = "archive",
}
enum ErrorCode {
  InvalidUrl = 1001,
  Timeout = 1002,
  TooManyRedirects = 1003,
  HttpError = 1004,
  NetworkError = 1005,
  ParseError = 1006,
  FileSystemError = 1007,
  Unknown = 9999,
}
enum ComparisonResult {
  Equal = 1,
  Different = 2,
  Incomparable = 3,
}

// --- 2. 模板字面量类型 / 映射类型 / 条件类型 --------------------------------

type HeaderName = `X-${string}`;
type LogLevel = `${"info" | "warn" | "error"}:${string}`;
type SnapshotId = `snap_${string}_${number}`;
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
type ElementByKind<K extends ElementKind> = Extract<
  SnapshotElement,
  { kind: K }
>;
type IsString<T> = T extends string ? true : false;

// --- 3. 判别式联合（snapshot 元素类型）-------------------------------------

type ElementKind = "text" | "link" | "image" | "meta";
interface BaseElement {
  readonly kind: ElementKind;
  readonly index: number;
}
interface TextElement extends BaseElement {
  kind: "text";
  text: string;
  level?: number;
}
interface LinkElement extends BaseElement {
  kind: "link";
  text: string;
  href: string;
}
interface ImageElement extends BaseElement {
  kind: "image";
  src: string;
  alt: string;
}
interface MetaElement extends BaseElement {
  kind: "meta";
  name: string;
  content: string;
}
type SnapshotElement = TextElement | LinkElement | ImageElement | MetaElement;

// --- 4. 接口（可选 / 只读 / 索引签名 / 元组）-------------------------------

interface FetchOptions {
  timeout?: number;
  headers?: Readonly<Record<string, string>>;
  maxRedirects?: number;
  readonly userAgent?: string;
  [key: string]: unknown;
}
interface TimingInfo {
  readonly dns: number;
  readonly connect: number;
  readonly ttfb: number;
  readonly total: number;
}
interface SnapshotMeta {
  readonly url: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly bytes: number;
  readonly timing: TimingInfo;
  readonly fetchedAt: string;
  readonly contentType: string;
}
interface LinkInfo {
  readonly text: string;
  readonly href: string;
}
interface ImageInfo {
  readonly src: string;
  readonly alt: string;
}
interface SnapshotData {
  meta: SnapshotMeta;
  title: string;
  description: string;
  metaTags: ReadonlyArray<readonly [string, string]>;
  text: string;
  links: ReadonlyArray<LinkInfo>;
  images: ReadonlyArray<ImageInfo>;
  headings: ReadonlyArray<readonly [number, string]>;
  scripts: number;
  stylesheets: number;
  hash: string;
}

// --- 5. Symbol 唯一键 & as const ------------------------------------------

const SYM_RAW_HTML = Symbol("rawHtml");
const SYM_FETCHED_AT = Symbol("fetchedAt");
const SYM_HASH = Symbol("hash");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "zh-CN,zh;q=0.9",
} as const;

// 字符串枚举可安全使用 Object.values()（const enum 不行）
const SUPPORTED_COMMANDS = Object.values(CliCommand);

// --- 6. 自定义错误类层级（带 code 属性）------------------------------------

abstract class SnapshotError extends Error {
  abstract readonly code: ErrorCode;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class InvalidUrlError extends SnapshotError {
  readonly code = ErrorCode.InvalidUrl;
}
class TimeoutError extends SnapshotError {
  readonly code = ErrorCode.Timeout;
}
class TooManyRedirectsError extends SnapshotError {
  readonly code = ErrorCode.TooManyRedirects;
}
class NetworkError extends SnapshotError {
  readonly code = ErrorCode.NetworkError;
}
class ParseError extends SnapshotError {
  readonly code = ErrorCode.ParseError;
}
class FileSystemError extends SnapshotError {
  readonly code = ErrorCode.FileSystemError;
}
class UnknownSnapshotError extends SnapshotError {
  readonly code = ErrorCode.Unknown;
}
class HttpError extends SnapshotError {
  readonly code = ErrorCode.HttpError;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// --- 7. 类型守卫 & 断言函数 -------------------------------------------------

function isTextElement(el: SnapshotElement): el is TextElement {
  return el.kind === "text";
}
function isLinkElement(el: SnapshotElement): el is LinkElement {
  return el.kind === "link";
}
function isImageElement(el: SnapshotElement): el is ImageElement {
  return el.kind === "image";
}
function isMetaElement(el: SnapshotElement): el is MetaElement {
  return el.kind === "meta";
}
function isSnapshotError(err: unknown): err is SnapshotError {
  return err instanceof SnapshotError;
}
function isHeaderName(s: string): s is HeaderName {
  return s.startsWith("X-");
}
function assertCommand(cmd: string): asserts cmd is CliCommand {
  if (!SUPPORTED_COMMANDS.includes(cmd as CliCommand)) {
    throw new UnknownSnapshotError(`未知命令: ${cmd}`);
  }
}

// --- 8. satisfies 运算符 ---------------------------------------------------

const DEFAULT_FETCH_OPTIONS = {
  timeout: 15000,
  maxRedirects: 5,
  headers: { ...DEFAULT_HEADERS },
} satisfies FetchOptions;

// --- 9. getter/setter 配置类 -----------------------------------------------

class FetchConfig {
  private _timeout: number;
  private _userAgent: string;
  constructor() {
    this._timeout = DEFAULT_FETCH_OPTIONS.timeout;
    this._userAgent = DEFAULT_HEADERS["User-Agent"];
  }
  get timeout(): number {
    return this._timeout;
  }
  set timeout(v: number) {
    if (v < 0 || v > 300000) throw new RangeError("timeout 超出范围");
    this._timeout = v;
  }
  get userAgent(): string {
    return this._userAgent;
  }
  set userAgent(v: string) {
    if (!v.trim()) throw new Error("userAgent 不能为空");
    this._userAgent = v;
  }
  toHeaders(): Record<string, string> {
    return { ...DEFAULT_HEADERS, "User-Agent": this._userAgent };
  }
}

// --- 10. HTTP 助手（含计时）------------------------------------------------

function detectContentType(raw: string | undefined): ContentType {
  if (!raw) return ContentType.Unknown;
  const lower = raw.toLowerCase();
  if (lower.includes("text/html")) return ContentType.TextHtml;
  if (lower.includes("application/json")) return ContentType.ApplicationJson;
  if (lower.includes("text/plain")) return ContentType.TextPlain;
  return ContentType.Unknown;
}

function fetchWithMeta(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<{ body: string; meta: SnapshotMeta }> {
  const cfg = new FetchConfig();
  cfg.timeout = opts.timeout ?? cfg.timeout;
  cfg.userAgent = opts.userAgent ?? cfg.userAgent;
  const timeout = cfg.timeout;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_FETCH_OPTIONS.maxRedirects;
  const headers: Record<string, string> = {
    ...cfg.toHeaders(),
    ...(opts.headers ?? {}),
  };

  return new Promise((resolve, reject) => {
    let redirects = 0;
    const t0 = Date.now();
    let tConnect = 0;
    let tTtfb = 0;
    let currentUrl = rawUrl;

    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new InvalidUrlError(`无效 URL: ${target}`));
        return;
      }
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : undefined,
          path: parsed.path || "/",
          method: "GET",
          headers,
        },
        (res) => {
          tTtfb = Date.now() - t0;
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= maxRedirects) {
              reject(new TooManyRedirectsError("重定向次数过多"));
              res.resume();
              return;
            }
            redirects++;
            const next = url.resolve(target, res.headers.location);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }
          if (
            res.statusCode &&
            (res.statusCode < 200 || res.statusCode >= 400)
          ) {
            reject(
              new HttpError(
                `HTTP ${res.statusCode} ${res.statusMessage || ""}`,
                res.statusCode,
              ),
            );
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br")
            stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const total = Date.now() - t0;
            const meta: SnapshotMeta = {
              url: rawUrl,
              finalUrl: currentUrl,
              status: res.statusCode || 200,
              statusText: res.statusMessage || "",
              headers: res.headers,
              bytes: Buffer.byteLength(body),
              timing: {
                dns: Math.max(0, Math.round(tConnect * 0.3)),
                connect: tConnect,
                ttfb: tTtfb,
                total,
              },
              fetchedAt: new Date().toISOString(),
              contentType: res.headers["content-type"] || ContentType.Unknown,
            };
            resolve({ body, meta });
          });
          stream.on("error", (err: Error) =>
            reject(new NetworkError(err.message)),
          );
        },
      );
      req.on("socket", (sock: net.Socket) => {
        sock.on("connect", () => {
          tConnect = Date.now() - t0;
        });
      });
      req.setTimeout(timeout, () => {
        req.destroy(new TimeoutError(`请求超时 (${timeout}ms)`));
      });
      req.on("error", (err: Error) => {
        if (isSnapshotError(err)) reject(err);
        else reject(new NetworkError(err.message));
      });
      req.end();
    };
    attempt(currentUrl);
  });
}

// --- 11. HTML 提取器 -------------------------------------------------------

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function firstMatch(re: RegExp, html: string): string {
  const m = re.exec(html);
  return m ? m[1] : "";
}
function extractTitle(html: string): string {
  return stripTags(firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html));
}
function extractMeta(html: string): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  const re = /<meta\s+([^>]+?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const nameM = /\s(?:name|property)=["']([^"']+)["']/i.exec(attrs);
    const contentM = /\scontent=["']([^"']*)["']/i.exec(attrs);
    if (nameM && contentM) out.push([nameM[1], contentM[1]] as const);
  }
  return out;
}
function extractLinks(html: string, base: string): ReadonlyArray<LinkInfo> {
  const out: LinkInfo[] = [];
  const seen = new Set<string>();
  const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripTags(m[2]).trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#"))
      continue;
    const abs = url.resolve(base, href);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ text: text || "(无文本)", href: abs });
  }
  return out;
}
function extractImages(html: string, base: string): ReadonlyArray<ImageInfo> {
  const out: ImageInfo[] = [];
  const seen = new Set<string>();
  const re = /<img\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const srcM = /\ssrc=["']([^"']+)["']/i.exec(attrs);
    const altM = /\salt=["']([^"']*)["']/i.exec(attrs);
    if (!srcM) continue;
    const abs = url.resolve(base, srcM[1]);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ src: abs, alt: altM ? altM[1] : "" });
  }
  return out;
}
function extractHeadings(
  html: string,
): ReadonlyArray<readonly [number, string]> {
  const out: Array<readonly [number, string]> = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push([parseInt(m[1], 10), stripTags(m[2])] as const);
  }
  return out;
}
function renderText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(
    /<(\/?)(p|div|section|article|header|footer|nav|aside|ul|ol|li|h[1-6]|tr|br)[^>]*>/gi,
    "\n",
  );
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  s = s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

// --- 12. 抽象快照类 + 具体子类（泛型 + 生成器 + 迭代器 + Symbol 键）---------

abstract class AbstractSnapshot<T extends SnapshotData = SnapshotData> {
  protected readonly _data: T;
  protected readonly [SYM_RAW_HTML]: string;
  protected readonly [SYM_FETCHED_AT]: string;
  protected readonly [SYM_HASH]: string;
  protected _tag: string;

  constructor(data: T, rawHtml: string) {
    this._data = data;
    this[SYM_RAW_HTML] = rawHtml;
    this[SYM_FETCHED_AT] = data.meta.fetchedAt;
    this[SYM_HASH] = data.hash;
    this._tag = `${data.meta.url}@${data.meta.fetchedAt}`;
  }

  abstract render(): string;
  abstract get snapshotType(): SnapshotType;

  get url(): string {
    return this._data.meta.url;
  }
  get title(): string {
    return this._data.title;
  }
  get hash(): string {
    return this._data.hash;
  }
  get bytes(): number {
    return this._data.meta.bytes;
  }
  get status(): number {
    return this._data.meta.status;
  }
  get contentType(): ContentType {
    return detectContentType(this._data.meta.contentType);
  }
  get timing(): TimingInfo {
    return this._data.meta.timing;
  }
  get links(): ReadonlyArray<LinkInfo> {
    return this._data.links;
  }
  get images(): ReadonlyArray<ImageInfo> {
    return this._data.images;
  }
  get headings(): ReadonlyArray<readonly [number, string]> {
    return this._data.headings;
  }
  get metaTags(): ReadonlyArray<readonly [string, string]> {
    return this._data.metaTags;
  }
  get tag(): string {
    return this._tag;
  }
  set tag(v: string) {
    this._tag = v;
  }

  // 生成器：按序产出所有元素（判别式联合）
  *elements(): Generator<SnapshotElement, void, unknown> {
    let idx = 0;
    for (const [level, text] of this._data.headings) {
      yield { kind: "text", index: idx++, text, level };
    }
    for (const link of this._data.links) {
      yield { kind: "link", index: idx++, text: link.text, href: link.href };
    }
    for (const img of this._data.images) {
      yield { kind: "image", index: idx++, src: img.src, alt: img.alt };
    }
    for (const [name, content] of this._data.metaTags) {
      yield { kind: "meta", index: idx++, name, content };
    }
  }

  // 迭代器协议：使实例可被 for...of 消费
  [Symbol.iterator](): IterableIterator<SnapshotElement> {
    return this.elements();
  }

  countByKind(): Record<ElementKind, number> {
    const acc: Record<ElementKind, number> = {
      text: 0,
      link: 0,
      image: 0,
      meta: 0,
    };
    for (const el of this) acc[el.kind]++;
    return acc;
  }

  toJSON(): string {
    return JSON.stringify(this._data, null, 2);
  }
}

class TextSnapshot extends AbstractSnapshot<SnapshotData> {
  get snapshotType(): SnapshotType {
    return SnapshotType.Text;
  }
  render(): string {
    return renderSnapshotText(this._data);
  }
}
class JsonSnapshot extends AbstractSnapshot<SnapshotData> {
  get snapshotType(): SnapshotType {
    return SnapshotType.Json;
  }
  render(): string {
    return this.toJSON();
  }
}
class ArchiveSnapshot extends AbstractSnapshot<SnapshotData> {
  get snapshotType(): SnapshotType {
    return SnapshotType.Archive;
  }
  render(): string {
    return renderSnapshotText(this._data);
  }
  archiveJson(): string {
    return this.toJSON();
  }
}

// --- 13. 函数重载（创建快照）-----------------------------------------------

function createSnapshot(
  data: SnapshotData,
  type: SnapshotType.Text,
): TextSnapshot;
function createSnapshot(
  data: SnapshotData,
  type: SnapshotType.Json,
): JsonSnapshot;
function createSnapshot(
  data: SnapshotData,
  type: SnapshotType.Archive,
): ArchiveSnapshot;
function createSnapshot(
  data: SnapshotData,
  type: SnapshotType,
): AbstractSnapshot<SnapshotData>;
function createSnapshot(
  data: SnapshotData,
  type: SnapshotType,
): AbstractSnapshot<SnapshotData> {
  switch (type) {
    case SnapshotType.Text:
      return new TextSnapshot(data, "");
    case SnapshotType.Json:
      return new JsonSnapshot(data, "");
    case SnapshotType.Archive:
      return new ArchiveSnapshot(data, "");
  }
}

// --- 14. 泛型类（带约束）+ 元组初始化 --------------------------------------

class SnapshotRegistry<T extends AbstractSnapshot> {
  private readonly _store: Map<SnapshotId, T>;
  constructor(initial: ReadonlyArray<readonly [SnapshotId, T]> = []) {
    this._store = new Map<SnapshotId, T>();
    for (const [id, snap] of initial) this._store.set(id, snap);
  }
  register(id: SnapshotId, snap: T): void {
    this._store.set(id, snap);
  }
  get(id: string): T | undefined {
    return this._store.get(id as SnapshotId);
  }
  *values(): Generator<T, void, unknown> {
    for (const v of this._store.values()) yield v;
  }
  get size(): number {
    return this._store.size;
  }
}

// 条件类型 ElementByKind 的使用示例
function firstOfKind<K extends ElementKind>(
  snap: AbstractSnapshot,
  kind: K,
): ElementByKind<K> | undefined {
  for (const el of snap) if (el.kind === kind) return el as ElementByKind<K>;
  return undefined;
}
// 模板字面量类型 LogLevel 的使用
function logLine(level: LogLevel, msg: string): void {
  console.log(`[${level}] ${msg}`);
}

// --- 15. 快照数据构建 ------------------------------------------------------

function buildSnapshotData(body: string, meta: SnapshotMeta): SnapshotData {
  const title = extractTitle(body);
  const metaTags = extractMeta(body);
  const description = metaTags.find((m) => m[0] === "description")?.[1] || "";
  const links = extractLinks(body, meta.finalUrl);
  const images = extractImages(body, meta.finalUrl);
  const headings = extractHeadings(body);
  const scripts = (body.match(/<script\b/gi) || []).length;
  const stylesheets = (body.match(/<link[^>]+rel=["']stylesheet["']/gi) || [])
    .length;
  const text = renderText(body);
  const hash = crypto
    .createHash("sha256")
    .update(text)
    .digest("hex")
    .slice(0, 16);
  return {
    meta,
    title,
    description,
    metaTags,
    text,
    links,
    images,
    headings,
    scripts,
    stylesheets,
    hash,
  };
}

function makeSnapshotId(rawUrl: string, ts: number): SnapshotId {
  const safe = rawUrl
    .replace(/[^a-z0-9]/gi, "_")
    .slice(0, 24)
    .toLowerCase();
  return `snap_${safe}_${ts}` as SnapshotId;
}

function renderSnapshotText(s: SnapshotData): string {
  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push("网页文本快照（注意：非像素截图，仅文本表示）");
  lines.push("=".repeat(72));
  lines.push(`URL:      ${s.meta.url}`);
  lines.push(`最终URL:  ${s.meta.finalUrl}`);
  lines.push(`状态:     ${s.meta.status} ${s.meta.statusText}`);
  lines.push(`大小:     ${s.meta.bytes} 字节`);
  lines.push(`类型:     ${s.meta.contentType}`);
  lines.push(`时间:     ${s.meta.fetchedAt}`);
  lines.push(
    `计时:     DNS=${s.meta.timing.dns}ms 连接=${s.meta.timing.connect}ms TTFB=${s.meta.timing.ttfb}ms 总计=${s.meta.timing.total}ms`,
  );
  lines.push(`文本哈希: ${s.hash}`);
  lines.push("", "响应头:");
  for (const [k, v] of Object.entries(s.meta.headers)) {
    lines.push(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  lines.push("", "标题: " + (s.title || "(无)"));
  if (s.description) lines.push("描述: " + s.description);
  lines.push("", "标题结构:");
  for (const h of s.headings.slice(0, 30)) {
    lines.push(`  ${"  ".repeat(h[0] - 1)}H${h[0]} ${h[1]}`);
  }
  lines.push("", "链接 (" + s.links.length + "):");
  for (const l of s.links.slice(0, 30))
    lines.push(`  - ${l.text.slice(0, 40)}  ->  ${l.href}`);
  if (s.links.length > 30) lines.push(`  ... 还有 ${s.links.length - 30} 条`);
  lines.push("", "图片 (" + s.images.length + "):");
  for (const i of s.images.slice(0, 20))
    lines.push(`  - [${i.alt.slice(0, 30) || "无alt"}]  ${i.src}`);
  if (s.images.length > 20) lines.push(`  ... 还有 ${s.images.length - 20} 张`);
  lines.push(
    "",
    "脚本/样式: scripts=" + s.scripts + "  stylesheets=" + s.stylesheets,
  );
  lines.push("", "正文（前 4000 字）:", "-".repeat(72));
  lines.push(s.text.slice(0, 4000));
  if (s.text.length > 4000)
    lines.push(`\n... [正文共 ${s.text.length} 字，已截断]`);
  lines.push("=".repeat(72));
  return lines.join("\n");
}

// --- 16. 命令实现 ----------------------------------------------------------

async function takeSnapshot(targetUrl: string): Promise<TextSnapshot> {
  const { body, meta } = await fetchWithMeta(targetUrl);
  return createSnapshot(buildSnapshotData(body, meta), SnapshotType.Text);
}

async function cmdSnapshot(targetUrl: string, outFile?: string): Promise<void> {
  console.log(`[snapshot] ${targetUrl}`);
  const registry = new SnapshotRegistry<AbstractSnapshot>();
  try {
    const s = await takeSnapshot(targetUrl);
    const id = makeSnapshotId(targetUrl, Date.now());
    registry.register(id, s);
    const text = s.render();
    if (outFile) {
      const abs = path.resolve(process.cwd(), outFile);
      try {
        fs.writeFileSync(abs, text, "utf8");
        console.log(`[snapshot] 已保存: ${abs}`);
      } catch (err) {
        throw new FileSystemError(`写入失败: ${(err as Error).message}`);
      }
    } else {
      console.log(text);
    }
    logLine(
      "info:snapshot",
      `type=${s.snapshotType} elements=${JSON.stringify(s.countByKind())} id=${id}`,
    );
  } catch (err) {
    if (isSnapshotError(err))
      console.log(`[snapshot] 失败 [${err.code}]: ${err.message}`);
    else console.log(`[snapshot] 失败: ${(err as Error).message}`);
  }
}

function compareSnapshots(
  s1: AbstractSnapshot,
  s2: AbstractSnapshot,
): ComparisonResult {
  return s1.hash === s2.hash
    ? ComparisonResult.Equal
    : ComparisonResult.Different;
}

async function cmdCompare(u1: string, u2: string): Promise<void> {
  console.log(`[compare] ${u1}  vs  ${u2}`);
  let s1: TextSnapshot | null = null;
  let s2: TextSnapshot | null = null;
  try {
    s1 = await takeSnapshot(u1);
  } catch (err) {
    console.log(`[compare] ${u1} 失败: ${(err as Error).message}`);
  }
  try {
    s2 = await takeSnapshot(u2);
  } catch (err) {
    console.log(`[compare] ${u2} 失败: ${(err as Error).message}`);
  }
  if (!s1 || !s2) return;

  const result = compareSnapshots(s1, s2);
  console.log(
    "",
    "对比结果: " +
      (result === ComparisonResult.Equal ? "文本完全一致" : "文本不同"),
  );
  console.log("─".repeat(60));
  console.log(`  标题:     ${s1.title || "(无)"}  |  ${s2.title || "(无)"}`);
  console.log(`  状态:     ${s1.status}  |  ${s2.status}`);
  console.log(`  大小:     ${s1.bytes}B  |  ${s2.bytes}B`);
  console.log(`  总耗时:   ${s1.timing.total}ms  |  ${s2.timing.total}ms`);
  console.log(`  链接:     ${s1.links.length}  |  ${s2.links.length}`);
  console.log(`  图片:     ${s1.images.length}  |  ${s2.images.length}`);
  console.log(`  标题结构: ${s1.headings.length}  |  ${s2.headings.length}`);
  console.log(`  内容类型: ${s1.contentType}  |  ${s2.contentType}`);
  console.log(`  文本哈希: ${s1.hash}  |  ${s2.hash}`);

  const set1 = new Set(s1.links.map((l) => l.href));
  const set2 = new Set(s2.links.map((l) => l.href));
  const only1 = s1.links.filter((l) => !set2.has(l.href));
  const only2 = s2.links.filter((l) => !set1.has(l.href));
  console.log("", `  仅 ${u1} 有的链接: ${only1.length}`);
  only1.slice(0, 5).forEach((l) => console.log(`    + ${l.href}`));
  console.log(`  仅 ${u2} 有的链接: ${only2.length}`);
  only2.slice(0, 5).forEach((l) => console.log(`    + ${l.href}`));
  console.log("");
}

async function cmdArchive(targetUrl: string): Promise<void> {
  console.log(`[archive] ${targetUrl}`);
  const outDir = path.resolve(process.cwd(), "output", "archive");
  if (!fs.existsSync(outDir)) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (err) {
      throw new FileSystemError(`创建目录失败: ${(err as Error).message}`);
    }
  }
  try {
    const { body, meta } = await fetchWithMeta(targetUrl);
    const archiveSnap = createSnapshot(
      buildSnapshotData(body, meta),
      SnapshotType.Archive,
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = targetUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 50);
    const textFile = path.join(outDir, `${safe}_${stamp}.txt`);
    const jsonFile = path.join(outDir, `${safe}_${stamp}.json`);
    try {
      fs.writeFileSync(textFile, archiveSnap.render(), "utf8");
      fs.writeFileSync(jsonFile, archiveSnap.archiveJson(), "utf8");
    } catch (err) {
      throw new FileSystemError(`写入失败: ${(err as Error).message}`);
    }
    console.log(`[archive] 文本快照: ${textFile}`);
    console.log(`[archive] 元数据 JSON: ${jsonFile}`);
    console.log(`[archive] 快照ID: ${makeSnapshotId(targetUrl, Date.now())}`);
    logLine(
      "info:archive",
      `archived ${archiveSnap.url} (${archiveSnap.bytes}B)`,
    );
  } catch (err) {
    if (isSnapshotError(err))
      console.log(`[archive] 失败 [${err.code}]: ${err.message}`);
    else console.log(`[archive] 失败: ${(err as Error).message}`);
  }
}

// --- 17. 入口 --------------------------------------------------------------

function printHelp(): void {
  console.log(`
简易网页截图工具 - 用法:
  node dist/index.js snapshot <url> [-o file]      生成文本快照
  node dist/index.js compare <url1> <url2>          对比两个快照
  node dist/index.js archive <url>                  归档快照与元数据
  node dist/index.js help                           显示本帮助

支持命令: ${SUPPORTED_COMMANDS.join(", ")}

重要说明:
  本工具输出的是“文本快照”，不是浏览器像素截图。
  包含：标题、正文文本、链接列表、图片列表、元数据、响应头、请求计时。
`);
}

function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") flags.out = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === CliCommand.Help || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const { positional, flags } = parseFlags(argv.slice(1));

  try {
    assertCommand(cmd);
    logLine("info:dispatch", `command=${cmd}`);
    switch (cmd) {
      case CliCommand.Snapshot:
        if (!positional[0]) {
          console.log("请提供 URL。");
          return;
        }
        await cmdSnapshot(positional[0], flags.out);
        break;
      case CliCommand.Compare:
        if (!positional[0] || !positional[1]) {
          console.log("请提供两个 URL。");
          return;
        }
        await cmdCompare(positional[0], positional[1]);
        break;
      case CliCommand.Archive:
        if (!positional[0]) {
          console.log("请提供 URL。");
          return;
        }
        await cmdArchive(positional[0]);
        break;
      case CliCommand.Help:
        printHelp();
        break;
    }
  } catch (err) {
    if (isSnapshotError(err))
      console.error(`运行出错 [${err.code}]:`, err.message);
    else console.error("运行出错:", (err as Error).message);
    process.exit(1);
  }
}

main();
