#!/usr/bin/env node
/**
 * 56. 爬取图片到本地 — 增强版
 * 图片下载器：提取网页图片、并发下载、robots.txt 检查、画廊生成。
 * 仅使用 Node.js 内置模块 (fs, path, url, http, https, zlib, crypto)。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as crypto from "crypto";

// ============================================================
// 1. 枚举
// ============================================================

enum Command {
  Download = "download",
  Batch = "batch",
  Gallery = "gallery",
  Help = "help",
}

enum HttpMethod {
  Get = "GET",
  Post = "POST",
}

enum ContentType {
  Html = "text/html",
  Image = "image/*",
}

enum ImageFormat {
  Jpg = "jpg",
  Png = "png",
  Gif = "gif",
  Webp = "webp",
  Bmp = "bmp",
  Svg = "svg",
  Avif = "avif",
  Bin = "bin",
}

enum DownloadStatus {
  Pending = "pending",
  Downloading = "downloading",
  Success = "success",
  Failed = "failed",
  Skipped = "skipped",
}

enum ErrorCode {
  NetworkError = "network_error",
  TimeoutError = "timeout_error",
  RobotsBlocked = "robots_blocked",
  InvalidUrl = "invalid_url",
  IoError = "io_error",
}

// ============================================================
// 2. 类型与工具类型
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface FetchOptions {
  readonly timeout?: number;
  readonly headers?: Record<string, string>;
}

interface FetchResult {
  readonly status: number;
  readonly body: string;
  readonly finalUrl: string;
}

interface BufferResult {
  readonly status: number;
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly finalUrl: string;
}

interface ImageInfo {
  readonly url: string;
  readonly alt: string;
  readonly id: string;
}

type SuccessResult = {
  readonly kind: "success";
  readonly url: string;
  readonly file: string;
  readonly bytes: number;
  readonly elapsedMs: number;
};

type ErrorResult = {
  readonly kind: "error";
  readonly url: string;
  readonly error: string;
  readonly elapsedMs: number;
};

type SkipResult = {
  readonly kind: "skip";
  readonly url: string;
  readonly reason: string;
};

type DownloadOutcome = SuccessResult | ErrorResult | SkipResult;

interface Identifiable {
  readonly id: string;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

abstract class ScraperError extends Error {
  abstract readonly code: ErrorCode;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class NetworkErrorX extends ScraperError {
  readonly code = ErrorCode.NetworkError;
}

class TimeoutErrorX extends ScraperError {
  readonly code = ErrorCode.TimeoutError;
}

class RobotsBlockedError extends ScraperError {
  readonly code = ErrorCode.RobotsBlocked;
}

// ============================================================
// 4. 常量、Symbol、as const、satisfies
// ============================================================

const SYM_META = Symbol("downloadMeta");
const SYM_HASH = Symbol("urlHash");

interface DownloadMeta {
  readonly startedAt: Date;
  status: DownloadStatus;
  retries: number;
}

interface LoggerShape {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const Logger: LoggerShape = {
  info: (m) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  warn: (m) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  error: (m) => console.error(`\x1b[31m[ERROR]\x1b[0m ${m}`),
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_UA,
  Accept: "text/html,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate",
} as const;

const CONTENT_TYPE_MAP: Readonly<Record<string, ImageFormat>> = {
  "image/jpeg": ImageFormat.Jpg,
  "image/png": ImageFormat.Png,
  "image/gif": ImageFormat.Gif,
  "image/webp": ImageFormat.Webp,
  "image/bmp": ImageFormat.Bmp,
  "image/svg+xml": ImageFormat.Svg,
  "image/avif": ImageFormat.Avif,
} as const;

// ============================================================
// 5. 泛型下载队列
// ============================================================

class DownloadQueue<T extends Identifiable> {
  private readonly queue: T[] = [];
  private readonly completed = new Map<string, DownloadOutcome>();
  private _label: string;

  constructor(label: string) {
    this._label = label;
  }

  get label(): string {
    return this._label;
  }
  set label(v: string) {
    this._label = v;
  }
  get pending(): number {
    return this.queue.length;
  }
  get done(): number {
    return this.completed.size;
  }

  enqueue(item: T): void {
    this.queue.push(item);
  }
  dequeue(): T | undefined {
    return this.queue.shift();
  }

  record(id: string, outcome: DownloadOutcome): void {
    this.completed.set(id, outcome);
  }

  *[Symbol.iterator](): Generator<T> {
    for (const item of this.queue) yield item;
  }

  *results(): Generator<readonly [string, DownloadOutcome]> {
    for (const [k, v] of this.completed.entries()) yield [k, v] as const;
  }

  *successes(): Generator<SuccessResult> {
    for (const [, v] of this.completed.entries()) {
      if (v.kind === "success") yield v;
    }
  }
}

// ============================================================
// 6. HTTP 助手 (函数重载)
// ============================================================

function fetchText(rawUrl: string): Promise<FetchResult>;
function fetchText(rawUrl: string, opts: FetchOptions): Promise<FetchResult>;
function fetchText(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const timeout = opts.timeout ?? 12000;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new NetworkErrorX(`无效 URL: ${target}`));
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
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= 5) {
              reject(new NetworkErrorX("重定向次数过多"));
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
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br")
            stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () =>
            resolve({
              status: res.statusCode || 200,
              body: Buffer.concat(chunks).toString("utf8"),
              finalUrl: currentUrl,
            }),
          );
          stream.on("error", (err: Error) =>
            reject(new NetworkErrorX(err.message)),
          );
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new TimeoutErrorX(`请求超时 (${timeout}ms)`)),
      );
      req.on("error", (err: Error) => reject(new NetworkErrorX(err.message)));
      req.end();
    };
    attempt(currentUrl);
  });
}

function fetchBuffer(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<BufferResult> {
  const timeout = opts.timeout ?? 20000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "image/*,*/*;q=0.8",
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new NetworkErrorX(`无效 URL: ${target}`));
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
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= 5) {
              reject(new NetworkErrorX("重定向次数过多"));
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
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new NetworkErrorX(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode || 200,
              buffer: Buffer.concat(chunks),
              contentType:
                res.headers["content-type"] || "application/octet-stream",
              finalUrl: currentUrl,
            }),
          );
          res.on("error", (err: Error) =>
            reject(new NetworkErrorX(err.message)),
          );
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new TimeoutErrorX(`请求超时 (${timeout}ms)`)),
      );
      req.on("error", (err: Error) => reject(new NetworkErrorX(err.message)));
      req.end();
    };
    attempt(currentUrl);
  });
}

// ============================================================
// 7. 图片 URL 提取
// ============================================================

function extractImages(html: string, baseUrl: string): ImageInfo[] {
  const out: ImageInfo[] = [];
  const seen = new Set<string>();
  const push = (rawUrl: string, alt: string): void => {
    if (
      !rawUrl ||
      rawUrl.startsWith("data:") ||
      rawUrl.startsWith("javascript:") ||
      rawUrl.startsWith("#")
    )
      return;
    const abs = url.resolve(baseUrl, rawUrl);
    if (!/^https?:\/\//.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    const id = crypto.createHash("md5").update(abs).digest("hex").slice(0, 12);
    out.push({ url: abs, alt: alt || "", id });
  };
  const imgRe = /<img\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1] || "";
    const srcMatch = /\ssrc=["']([^"']+)["']/i.exec(attrs);
    const altMatch = /\salt=["']([^"']*)["']/i.exec(attrs);
    if (srcMatch) push(srcMatch[1], altMatch ? altMatch[1] : "");
    const srcsetMatch = /\ssrcset=["']([^"']+)["']/i.exec(attrs);
    if (srcsetMatch) {
      for (const c of srcsetMatch[1].split(",")) {
        const u = c.trim().split(/\s+/)[0];
        if (u) push(u, altMatch ? altMatch[1] : "");
      }
    }
  }
  const aRe =
    /<a\s+[^>]*?href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp|svg))["']/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = aRe.exec(html)) !== null) push(m2[1], "link");
  return out;
}

// ============================================================
// 8. robots.txt 检查
// ============================================================

interface RobotsRule {
  readonly userAgent: string;
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
}

const robotsCache = new Map<string, RobotsRule[]>();

async function fetchRobots(targetUrl: string): Promise<RobotsRule[]> {
  const parsed = url.parse(targetUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const rules: RobotsRule[] = [];
  try {
    const res = await fetchText(`${origin}/robots.txt`, { timeout: 6000 });
    if (res.status === 200) {
      let current: { userAgent: string; disallow: string[]; allow: string[] } =
        { userAgent: "*", disallow: [], allow: [] };
      for (const line of res.body.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const idx = t.indexOf(":");
        if (idx === -1) continue;
        const key = t.slice(0, idx).trim().toLowerCase();
        const val = t.slice(idx + 1).trim();
        if (key === "user-agent") {
          if (current.disallow.length || current.allow.length)
            rules.push(current);
          current = { userAgent: val, disallow: [], allow: [] };
        } else if (key === "disallow") {
          if (val) current.disallow.push(val);
        } else if (key === "allow") {
          if (val) current.allow.push(val);
        }
      }
      if (current.disallow.length || current.allow.length) rules.push(current);
    }
  } catch {
    /* ignore */
  }
  robotsCache.set(origin, rules);
  return rules;
}

async function isAllowed(targetUrl: string): Promise<boolean> {
  const rules = await fetchRobots(targetUrl);
  const parsed = url.parse(targetUrl);
  const p = parsed.path || "/";
  for (const r of rules) {
    if (r.userAgent !== "*") continue;
    for (const a of r.allow) {
      if (p.startsWith(a)) return true;
    }
    for (const d of r.disallow) {
      if (d === "/" || p.startsWith(d)) return false;
    }
  }
  return true;
}

// ============================================================
// 9. 抽象下载器
// ============================================================

function extFromUrl(u: string, contentType: string): ImageFormat {
  const m = /\.([a-z0-9]+)(?:$|\?|#)/i.exec(u);
  if (m) {
    const e = m[1].toLowerCase();
    if (e === "jpeg") return ImageFormat.Jpg;
    if (Object.values(ImageFormat).includes(e as ImageFormat))
      return e as ImageFormat;
  }
  const ct = contentType.split(";")[0].trim();
  return CONTENT_TYPE_MAP[ct] ?? ImageFormat.Bin;
}

function safeFilename(u: string, contentType: string, idx: number): string {
  const parsed = url.parse(u);
  const base = path.basename(parsed.pathname || "").split(/[?#]/)[0];
  let stem = base.replace(/[\\/:*?"<>|]/g, "_");
  if (!stem || stem.length > 60)
    stem = crypto.createHash("md5").update(u).digest("hex").slice(0, 16);
  const ext = extFromUrl(u, contentType);
  return `${String(idx).padStart(3, "0")}_${stem}.${ext}`;
}

abstract class AbstractDownloader {
  abstract readonly name: string;
  abstract download(
    img: ImageInfo,
    idx: number,
    outDir: string,
  ): Promise<DownloadOutcome>;
}

class ImageDownloader extends AbstractDownloader {
  readonly name = "ImageDownloader";

  async download(
    img: ImageInfo,
    idx: number,
    outDir: string,
  ): Promise<DownloadOutcome> {
    const t0 = Date.now();
    try {
      const res = await fetchBuffer(img.url);
      const file = safeFilename(img.url, res.contentType, idx);
      fs.writeFileSync(path.join(outDir, file), res.buffer);
      return {
        kind: "success",
        url: img.url,
        file,
        bytes: res.buffer.length,
        elapsedMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        kind: "error",
        url: img.url,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t0,
      };
    }
  }
}

// ============================================================
// 10. 类型守卫
// ============================================================

function isSuccess(r: DownloadOutcome): r is SuccessResult {
  return r.kind === "success";
}
function isErrorR(r: DownloadOutcome): r is ErrorResult {
  return r.kind === "error";
}
function isSkipR(r: DownloadOutcome): r is SkipResult {
  return r.kind === "skip";
}
function isScraperError(err: unknown): err is ScraperError {
  return err instanceof ScraperError;
}

// ============================================================
// 11. 并发下载
// ============================================================

async function downloadAll(
  images: ImageInfo[],
  outDir: string,
  concurrency: number,
  limit: number,
): Promise<DownloadOutcome[]> {
  const target = images.slice(0, limit);
  const results: DownloadOutcome[] = new Array(target.length);
  const queue = new DownloadQueue<ImageInfo>("images");
  for (const img of target) queue.enqueue(img);

  let next = 0;
  let done = 0;
  const downloader = new ImageDownloader();

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++;
      if (idx >= target.length) return;
      const img = target[idx]!;
      const outcome = await downloader.download(img, idx, outDir);
      results[idx] = outcome;
      queue.record(img.id, outcome);
      done++;
      const status = isSuccess(outcome) ? "OK" : "FAIL";
      const size = isSuccess(outcome)
        ? `${(outcome.bytes / 1024).toFixed(1)}KB`
        : "-";
      process.stdout.write(
        `  [${done}/${target.length}] ${status}  ${size.padStart(8)}  ${img.url.slice(0, 60)}\n`,
      );
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, target.length); i++)
    workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ============================================================
// 12. HTML 画廊
// ============================================================

function buildGalleryHtml(pageUrl: string, results: DownloadOutcome[]): string {
  const items = results
    .filter(isSuccess)
    .map((r) => {
      const rel = `images/${r.file}`;
      return `<div class="cell"><img src="${rel}" alt=""><div class="src" title="${r.url}">${r.url.slice(0, 80)}</div></div>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>图片画廊 - ${pageUrl}</title>
<style>
body{font-family:sans-serif;margin:16px;background:#fafafa}
h1{font-size:16px;color:#333}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.cell{background:#fff;border:1px solid #eee;border-radius:6px;padding:8px;overflow:hidden}
.cell img{width:100%;height:180px;object-fit:cover;display:block;background:#eee}
.src{font-size:11px;color:#888;margin-top:6px;word-break:break-all}
</style></head>
<body>
<h1>来源: ${pageUrl}  (共 ${results.filter(isSuccess).length} 张)</h1>
<div class="grid">
${items}
</div>
</body></html>`;
}

// ============================================================
// 13. 命令实现
// ============================================================

async function getImagesFromPage(
  pageUrl: string,
): Promise<{ images: ImageInfo[]; finalUrl: string }> {
  const allowed = await isAllowed(pageUrl);
  if (!allowed) {
    Logger.warn(`[robots] ${pageUrl} 被 robots.txt 禁止抓取，已跳过。`);
    return { images: [], finalUrl: pageUrl };
  }
  const res = await fetchText(pageUrl);
  return {
    images: extractImages(res.body, res.finalUrl),
    finalUrl: res.finalUrl,
  };
}

async function cmdDownload(
  pageUrl: string,
  outDir: string,
  limit: number,
  concurrency: number,
): Promise<void> {
  Logger.info(
    `download ${pageUrl}  limit=${limit}  concurrency=${concurrency}`,
  );
  let images: ImageInfo[] = [];
  try {
    const r = await getImagesFromPage(pageUrl);
    images = r.images;
    Logger.info(`提取到 ${images.length} 张图片`);
  } catch (err) {
    Logger.error(
      `抓取页面失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (images.length === 0) {
    Logger.warn("页面未发现图片。");
    return;
  }
  const absOut = path.resolve(process.cwd(), outDir);
  if (!fs.existsSync(absOut)) fs.mkdirSync(absOut, { recursive: true });
  const results = await downloadAll(images, absOut, concurrency, limit);
  const okCount = results.filter(isSuccess).length;
  const totalBytes = results.filter(isSuccess).reduce((s, r) => s + r.bytes, 0);
  Logger.info(
    `完成: ${okCount}/${results.length} 成功，共 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  Logger.info(`保存目录: ${absOut}`);
}

async function cmdBatch(urls: string[]): Promise<void> {
  Logger.info(`batch 共 ${urls.length} 个页面`);
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n=== [${i + 1}/${urls.length}] ${urls[i]} ===`);
    await cmdDownload(
      urls[i]!,
      path.join("output", "images", `page${i + 1}`),
      50,
      4,
    );
  }
}

async function cmdGallery(pageUrl: string): Promise<void> {
  Logger.info(`gallery ${pageUrl}`);
  const outDir = path.resolve(process.cwd(), "output", "gallery");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  let images: ImageInfo[] = [];
  try {
    const r = await getImagesFromPage(pageUrl);
    images = r.images;
  } catch (err) {
    Logger.error(
      `抓取失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (images.length === 0) {
    Logger.warn("未发现图片。");
    return;
  }
  const results = await downloadAll(images, outDir, 4, 30);
  const html = buildGalleryHtml(pageUrl, results);
  const htmlFile = path.join(outDir, "index.html");
  fs.writeFileSync(htmlFile, html, "utf8");
  Logger.info(`画廊已生成: ${htmlFile}`);
}

// ============================================================
// 14. CLI
// ============================================================

interface ParsedFlags {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

function parseFlags(args: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-o" || a === "--out") flags.out = args[++i] ?? "";
    else if (a === "-l" || a === "--limit") flags.limit = args[++i] ?? "";
    else if (a === "-c" || a === "--concurrency")
      flags.concurrency = args[++i] ?? "";
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i] ?? "";
    else positional.push(a);
  }
  return { positional, flags };
}

function printHelp(): void {
  console.log(`
图片下载器 - 用法:
  node dist/index.js download <url> [-o outdir] [-l limit] [-c concurrency]
  node dist/index.js batch <url1> <url2> ...
  node dist/index.js gallery <url>
  node dist/index.js help

选项:
  -o, --out <dir>         输出目录（默认 ./output/images）
  -l, --limit <n>         最多下载图片数量（默认 50）
  -c, --concurrency <n>   并发数（默认 4）

说明:
  - 自动提取 <img src> 与 srcset，去重下载
  - 基本检查 robots.txt（仅 Disallow 路径）
  - 文件名取自 URL 或哈希
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0] as Command;
  const { positional, flags } = parseFlags(argv.slice(1));
  const limit = parseInt(flags.limit || "50", 10) || 50;
  const concurrency = parseInt(flags.concurrency || "4", 10) || 4;

  try {
    switch (cmd) {
      case Command.Download:
        if (!positional[0]) {
          Logger.error("请提供页面 URL。");
          return;
        }
        await cmdDownload(
          positional[0],
          flags.out || path.join("output", "images"),
          limit,
          Math.min(Math.max(concurrency, 1), 16),
        );
        break;
      case Command.Batch:
        if (positional.length === 0) {
          Logger.error("请提供至少一个 URL。");
          return;
        }
        await cmdBatch([...positional]);
        break;
      case Command.Gallery:
        if (!positional[0]) {
          Logger.error("请提供页面 URL。");
          return;
        }
        await cmdGallery(positional[0]);
        break;
      default:
        Logger.error(`未知命令: ${cmd}`);
        printHelp();
    }
  } catch (err) {
    const msg = isScraperError(err)
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    Logger.error(`运行出错: ${msg}`);
    process.exit(1);
  }
}

main();
