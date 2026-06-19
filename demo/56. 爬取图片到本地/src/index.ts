#!/usr/bin/env node
/**
 * 56. 爬取图片到本地
 * ------------------------------------------------------------------
 * 演示一个图片下载器：
 *   - 抓取网页，提取所有 <img> 的 src 与 srcset 中的图片 URL
 *   - 并发下载（限制并发数），URL 去重，进度展示
 *   - 文件名取自 URL 末段或哈希
 *   - 基本遵守 robots.txt（检查 Disallow 路径）
 *   - 支持命令：download、batch、gallery
 *
 * 仅使用 Node.js 内置模块：fs、path、url、http、https、zlib、crypto、buffer。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

interface ImageInfo {
  url: string;
  alt: string;
}

interface DownloadResult {
  url: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  error?: string;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// HTTP 助手（文本与二进制）
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<{ status: number; body: string; finalUrl: string }> {
  const timeout = opts.timeout ?? 12000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) { reject(new Error(`无效 URL: ${target}`)); return; }
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : undefined,
          path: parsed.path || "/",
          method: "GET",
          headers,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects >= 5) { reject(new Error("重定向次数过多")); res.resume(); return; }
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
          else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => resolve({
            status: res.statusCode || 200,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: currentUrl,
          }));
          stream.on("error", (err: Error) => reject(err));
        }
      );
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时 (${timeout}ms)`)));
      req.on("error", (err: Error) => reject(err));
      req.end();
    };
    attempt(currentUrl);
  });
}

function fetchBuffer(rawUrl: string, opts: FetchOptions = {}): Promise<{ status: number; buffer: Buffer; contentType: string; finalUrl: string }> {
  const timeout = opts.timeout ?? 20000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "image/*,*/*;q=0.8",
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) { reject(new Error(`无效 URL: ${target}`)); return; }
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : undefined,
          path: parsed.path || "/",
          method: "GET",
          headers,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects >= 5) { reject(new Error("重定向次数过多")); res.resume(); return; }
            redirects++;
            const next = url.resolve(target, res.headers.location);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({
            status: res.statusCode || 200,
            buffer: Buffer.concat(chunks),
            contentType: res.headers["content-type"] || "application/octet-stream",
            finalUrl: currentUrl,
          }));
          res.on("error", (err: Error) => reject(err));
        }
      );
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时 (${timeout}ms)`)));
      req.on("error", (err: Error) => reject(err));
      req.end();
    };
    attempt(currentUrl);
  });
}

// ---------------------------------------------------------------------------
// 图片 URL 提取
// ---------------------------------------------------------------------------

function extractImages(html: string, baseUrl: string): ImageInfo[] {
  const out: ImageInfo[] = [];
  const seen = new Set<string>();

  const push = (rawUrl: string, alt: string): void => {
    if (!rawUrl || rawUrl.startsWith("data:")) return;
    if (rawUrl.startsWith("javascript:") || rawUrl.startsWith("#")) return;
    const abs = url.resolve(baseUrl, rawUrl);
    if (!/^https?:\/\//.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, alt: alt || "" });
  };

  // <img src="..." alt="...">
  const imgRe = /<img\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1] || "";
    const srcMatch = /\ssrc=["']([^"']+)["']/i.exec(attrs);
    const altMatch = /\salt=["']([^"']*)["']/i.exec(attrs);
    if (srcMatch) push(srcMatch[1], altMatch ? altMatch[1] : "");
    // srcset
    const srcsetMatch = /\ssrcset=["']([^"']+)["']/i.exec(attrs);
    if (srcsetMatch) {
      const candidates = srcsetMatch[1].split(",");
      for (const c of candidates) {
        const u = c.trim().split(/\s+/)[0];
        if (u) push(u, altMatch ? altMatch[1] : "");
      }
    }
  }

  // <a href="...jpg">
  const aRe = /<a\s+[^>]*?href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp|svg))["']/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = aRe.exec(html)) !== null) {
    push(m2[1], "link");
  }

  return out;
}

// ---------------------------------------------------------------------------
// robots.txt 基本检查
// ---------------------------------------------------------------------------

interface RobotsRule { userAgent: string; disallow: string[]; allow: string[]; }

const robotsCache = new Map<string, RobotsRule[]>();

async function fetchRobots(targetUrl: string): Promise<RobotsRule[]> {
  const parsed = url.parse(targetUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const rules: RobotsRule[] = [];
  try {
    const res = await fetchText(`${origin}/robots.txt`, { timeout: 6000 });
    if (res.status === 200) {
      let current: RobotsRule = { userAgent: "*", disallow: [], allow: [] };
      for (const line of res.body.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const idx = t.indexOf(":");
        if (idx === -1) continue;
        const key = t.slice(0, idx).trim().toLowerCase();
        const val = t.slice(idx + 1).trim();
        if (key === "user-agent") {
          if (current.disallow.length || current.allow.length) {
            rules.push(current);
          }
          current = { userAgent: val, disallow: [], allow: [] };
        } else if (key === "disallow") {
          if (val) current.disallow.push(val);
        } else if (key === "allow") {
          if (val) current.allow.push(val);
        }
      }
      if (current.disallow.length || current.allow.length) rules.push(current);
    }
  } catch (err) {
    void err;
  }
  robotsCache.set(origin, rules);
  return rules;
}

async function isAllowed(targetUrl: string): Promise<boolean> {
  const rules = await fetchRobots(targetUrl);
  const parsed = url.parse(targetUrl);
  const path = parsed.path || "/";
  for (const r of rules) {
    if (r.userAgent !== "*") continue;
    for (const a of r.allow) {
      if (path.startsWith(a)) return true;
    }
    for (const d of r.disallow) {
      if (d === "/" ) return false;
      if (path.startsWith(d)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// 下载与并发控制
// ---------------------------------------------------------------------------

function extFromUrl(u: string, contentType: string): string {
  const m = /\.([a-z0-9]+)(?:$|\?|#)/i.exec(u);
  if (m) {
    const e = m[1].toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"].includes(e)) {
      return e === "jpeg" ? "jpg" : e;
    }
  }
  const ct = contentType.split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
  };
  return map[ct] || "bin";
}

function safeFilename(u: string, contentType: string, idx: number): string {
  const parsed = url.parse(u);
  const base = path.basename(parsed.pathname || "").split(/[?#]/)[0];
  let stem = base.replace(/[\\/:*?"<>|]/g, "_");
  if (!stem || stem.length > 60) {
    stem = crypto.createHash("md5").update(u).digest("hex").slice(0, 16);
  }
  const ext = extFromUrl(u, contentType);
  return `${String(idx).padStart(3, "0")}_${stem}.${ext}`;
}

async function downloadOne(img: ImageInfo, idx: number, outDir: string): Promise<DownloadResult> {
  const t0 = Date.now();
  try {
    const res = await fetchBuffer(img.url);
    const file = safeFilename(img.url, res.contentType, idx);
    const fp = path.join(outDir, file);
    fs.writeFileSync(fp, res.buffer);
    return { url: img.url, ok: true, file, bytes: res.buffer.length, elapsedMs: Date.now() - t0 };
  } catch (err) {
    return { url: img.url, ok: false, error: (err as Error).message, elapsedMs: Date.now() - t0 };
  }
}

async function downloadAll(images: ImageInfo[], outDir: string, concurrency: number, limit: number): Promise<DownloadResult[]> {
  const target = images.slice(0, limit);
  const results: DownloadResult[] = new Array(target.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++;
      if (idx >= target.length) return;
      const r = await downloadOne(target[idx], idx, outDir);
      results[idx] = r;
      done++;
      const status = r.ok ? "OK" : "FAIL";
      const size = r.bytes ? `${(r.bytes / 1024).toFixed(1)}KB` : "-";
      process.stdout.write(`  [${done}/${target.length}] ${status}  ${size.padStart(8)}  ${r.url.slice(0, 60)}\n`);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, target.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// HTML 画廊生成
// ---------------------------------------------------------------------------

function buildGalleryHtml(pageUrl: string, results: DownloadResult[], outDir: string, relDir: string): string {
  const items = results
    .filter((r) => r.ok && r.file)
    .map((r) => {
      const rel = `${relDir}/${r.file}`.replace(/\\/g, "/");
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
<h1>来源: ${pageUrl}  (共 ${results.filter(r=>r.ok).length} 张)</h1>
<div class="grid">
${items}
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function getImagesFromPage(pageUrl: string): Promise<{ images: ImageInfo[]; finalUrl: string }> {
  const allowed = await isAllowed(pageUrl);
  if (!allowed) {
    console.log(`[robots] ${pageUrl} 被 robots.txt 禁止抓取，已跳过。`);
    return { images: [], finalUrl: pageUrl };
  }
  const res = await fetchText(pageUrl);
  const images = extractImages(res.body, res.finalUrl);
  return { images, finalUrl: res.finalUrl };
}

async function cmdDownload(pageUrl: string, outDir: string, limit: number, concurrency: number): Promise<void> {
  console.log(`[download] ${pageUrl}  limit=${limit}  concurrency=${concurrency}`);
  let images: ImageInfo[] = [];
  try {
    const r = await getImagesFromPage(pageUrl);
    images = r.images;
    console.log(`[download] 提取到 ${images.length} 张图片`);
  } catch (err) {
    console.log(`[download] 抓取页面失败: ${(err as Error).message}`);
    console.log("[download] 演示结束（无图片可下载）。");
    return;
  }
  if (images.length === 0) {
    console.log("[download] 页面未发现图片。");
    return;
  }
  const absOut = path.resolve(process.cwd(), outDir);
  if (!fs.existsSync(absOut)) fs.mkdirSync(absOut, { recursive: true });
  const results = await downloadAll(images, absOut, concurrency, limit);
  const okCount = results.filter((r) => r.ok).length;
  const totalBytes = results.reduce((s, r) => s + (r.bytes || 0), 0);
  console.log(`\n[download] 完成: ${okCount}/${results.length} 成功，共 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[download] 保存目录: ${absOut}`);
}

async function cmdBatch(urls: string[]): Promise<void> {
  console.log(`[batch] 共 ${urls.length} 个页面`);
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n=== [${i + 1}/${urls.length}] ${urls[i]} ===`);
    const out = path.join("output", "images", `page${i + 1}`);
    await cmdDownload(urls[i], out, 50, 4);
  }
}

async function cmdGallery(pageUrl: string): Promise<void> {
  console.log(`[gallery] ${pageUrl}`);
  const outDir = path.resolve(process.cwd(), "output", "gallery");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  let images: ImageInfo[] = [];
  try {
    const r = await getImagesFromPage(pageUrl);
    images = r.images;
  } catch (err) {
    console.log(`[gallery] 抓取失败: ${(err as Error).message}`);
    return;
  }
  if (images.length === 0) {
    console.log("[gallery] 未发现图片。");
    return;
  }
  const results = await downloadAll(images, outDir, 4, 30);
  const html = buildGalleryHtml(pageUrl, results, outDir, "images");
  const htmlFile = path.join(outDir, "index.html");
  fs.writeFileSync(htmlFile, html, "utf8");
  console.log(`\n[gallery] 画廊已生成: ${htmlFile}`);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

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

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") flags.out = args[++i];
    else if (a === "-l" || a === "--limit") flags.limit = args[++i];
    else if (a === "-c" || a === "--concurrency") flags.concurrency = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const { positional, flags } = parseFlags(argv.slice(1));
  const limit = parseInt(flags.limit || "50", 10) || 50;
  const concurrency = parseInt(flags.concurrency || "4", 10) || 4;

  try {
    switch (cmd) {
      case "download":
        if (!positional[0]) { console.log("请提供页面 URL。"); return; }
        await cmdDownload(positional[0], flags.out || path.join("output", "images"), limit, Math.min(Math.max(concurrency, 1), 16));
        break;
      case "batch":
        if (positional.length === 0) { console.log("请提供至少一个 URL。"); return; }
        await cmdBatch(positional);
        break;
      case "gallery":
        if (!positional[0]) { console.log("请提供页面 URL。"); return; }
        await cmdGallery(positional[0]);
        break;
      default:
        console.log(`未知命令: ${cmd}`);
        printHelp();
    }
  } catch (err) {
    console.error("运行出错:", (err as Error).message);
    process.exit(1);
  }
}

main();
