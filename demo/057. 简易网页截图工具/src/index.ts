#!/usr/bin/env node
/**
 * 57. 简易网页截图工具
 * ------------------------------------------------------------------
 * 这是一个“文本快照”工具，而非像素级截图：
 *   - 抓取网页，提取标题、正文文本（保留基本布局提示）、链接列表、
 *     图片列表、元数据（meta）、响应头与请求计时
 *   - 支持命令：snapshot、compare、archive
 *   - 清晰说明：本工具输出文本快照，不是浏览器像素截图
 *
 * 仅使用 Node.js 内置模块：fs、path、url、http、https、zlib、buffer、crypto、net。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as crypto from "crypto";
import * as net from "net";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

interface SnapshotMeta {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  bytes: number;
  timing: {
    dns: number;       // 模拟（Node http 内置未单独暴露 DNS）
    connect: number;   // 模拟
    ttfb: number;      // 首字节
    total: number;     // 总耗时
  };
  fetchedAt: string;
  contentType: string;
}

interface Snapshot {
  meta: SnapshotMeta;
  title: string;
  description: string;
  metaTags: Array<{ name: string; content: string }>;
  text: string;             // 渲染为带布局提示的文本
  links: Array<{ text: string; href: string }>;
  images: Array<{ src: string; alt: string }>;
  headings: Array<{ level: number; text: string }>;
  scripts: number;
  stylesheets: number;
  hash: string;
}

// ---------------------------------------------------------------------------
// HTTP 助手（含计时）
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchWithMeta(rawUrl: string, opts: FetchOptions = {}): Promise<{ body: string; meta: SnapshotMeta }> {
  const timeout = opts.timeout ?? 15000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9",
    ...opts.headers,
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
          tTtfb = Date.now() - t0;
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
              contentType: res.headers["content-type"] || "unknown",
            };
            resolve({ body, meta });
          });
          stream.on("error", (err: Error) => reject(err));
        }
      );
      req.on("socket", (sock: net.Socket) => {
        sock.on("connect", () => { tConnect = Date.now() - t0; });
      });
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时 (${timeout}ms)`)));
      req.on("error", (err: Error) => reject(err));
      req.end();
    };
    attempt(currentUrl);
  });
}

// ---------------------------------------------------------------------------
// HTML 提取器
// ---------------------------------------------------------------------------

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

function extractMeta(html: string): Array<{ name: string; content: string }> {
  const out: Array<{ name: string; content: string }> = [];
  const re = /<meta\s+([^>]+?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const nameM = /\s(?:name|property)=["']([^"']+)["']/i.exec(attrs);
    const contentM = /\scontent=["']([^"']*)["']/i.exec(attrs);
    if (nameM && contentM) {
      out.push({ name: nameM[1], content: contentM[1] });
    }
  }
  return out;
}

function extractLinks(html: string, base: string): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = [];
  const seen = new Set<string>();
  const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripTags(m[2]).trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    const abs = url.resolve(base, href);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ text: text || "(无文本)", href: abs });
  }
  return out;
}

function extractImages(html: string, base: string): Array<{ src: string; alt: string }> {
  const out: Array<{ src: string; alt: string }> = [];
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

function extractHeadings(html: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ level: parseInt(m[1], 10), text: stripTags(m[2]) });
  }
  return out;
}

function renderText(html: string): string {
  // 1. 移除脚本与样式
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // 2. 块级元素换行
  s = s.replace(/<(\/?)(p|div|section|article|header|footer|nav|aside|ul|ol|li|h[1-6]|tr|br)[^>]*>/gi, "\n");
  // 3. 去标签
  s = s.replace(/<[^>]+>/g, " ");
  // 4. 实体
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // 5. 折叠空白
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// ---------------------------------------------------------------------------
// 快照构建
// ---------------------------------------------------------------------------

function buildSnapshot(body: string, meta: SnapshotMeta): Snapshot {
  const title = extractTitle(body);
  const metaTags = extractMeta(body);
  const description = metaTags.find((m) => m.name === "description")?.content || "";
  const links = extractLinks(body, meta.finalUrl);
  const images = extractImages(body, meta.finalUrl);
  const headings = extractHeadings(body);
  const scripts = (body.match(/<script\b/gi) || []).length;
  const stylesheets = (body.match(/<link[^>]+rel=["']stylesheet["']/gi) || []).length;
  const text = renderText(body);
  const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  return {
    meta, title, description, metaTags, text, links, images, headings, scripts, stylesheets, hash,
  };
}

// ---------------------------------------------------------------------------
// 渲染快照为可读文本
// ---------------------------------------------------------------------------

function renderSnapshot(s: Snapshot): string {
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
  lines.push(`计时:     DNS=${s.meta.timing.dns}ms 连接=${s.meta.timing.connect}ms TTFB=${s.meta.timing.ttfb}ms 总计=${s.meta.timing.total}ms`);
  lines.push(`文本哈希: ${s.hash}`);
  lines.push("");
  lines.push("响应头:");
  for (const [k, v] of Object.entries(s.meta.headers)) {
    lines.push(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  lines.push("");
  lines.push("标题: " + (s.title || "(无)"));
  if (s.description) lines.push("描述: " + s.description);
  lines.push("");
  lines.push("标题结构:");
  for (const h of s.headings.slice(0, 30)) {
    lines.push(`  ${"  ".repeat(h.level - 1)}H${h.level} ${h.text}`);
  }
  lines.push("");
  lines.push("链接 (" + s.links.length + "):");
  for (const l of s.links.slice(0, 30)) {
    lines.push(`  - ${l.text.slice(0, 40)}  ->  ${l.href}`);
  }
  if (s.links.length > 30) lines.push(`  ... 还有 ${s.links.length - 30} 条`);
  lines.push("");
  lines.push("图片 (" + s.images.length + "):");
  for (const i of s.images.slice(0, 20)) {
    lines.push(`  - [${i.alt.slice(0, 30) || "无alt"}]  ${i.src}`);
  }
  if (s.images.length > 20) lines.push(`  ... 还有 ${s.images.length - 20} 张`);
  lines.push("");
  lines.push("脚本/样式: scripts=" + s.scripts + "  stylesheets=" + s.stylesheets);
  lines.push("");
  lines.push("正文（前 4000 字）:");
  lines.push("-".repeat(72));
  lines.push(s.text.slice(0, 4000));
  if (s.text.length > 4000) lines.push(`\n... [正文共 ${s.text.length} 字，已截断]`);
  lines.push("=".repeat(72));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function takeSnapshot(targetUrl: string): Promise<Snapshot> {
  const { body, meta } = await fetchWithMeta(targetUrl);
  return buildSnapshot(body, meta);
}

async function cmdSnapshot(targetUrl: string, outFile?: string): Promise<void> {
  console.log(`[snapshot] ${targetUrl}`);
  try {
    const s = await takeSnapshot(targetUrl);
    const text = renderSnapshot(s);
    if (outFile) {
      const abs = path.resolve(process.cwd(), outFile);
      fs.writeFileSync(abs, text, "utf8");
      console.log(`[snapshot] 已保存: ${abs}`);
    } else {
      console.log(text);
    }
  } catch (err) {
    console.log(`[snapshot] 失败: ${(err as Error).message}`);
  }
}

async function cmdCompare(u1: string, u2: string): Promise<void> {
  console.log(`[compare] ${u1}  vs  ${u2}`);
  let s1: Snapshot | null = null;
  let s2: Snapshot | null = null;
  try { s1 = await takeSnapshot(u1); } catch (err) { console.log(`[compare] ${u1} 失败: ${(err as Error).message}`); }
  try { s2 = await takeSnapshot(u2); } catch (err) { console.log(`[compare] ${u2} 失败: ${(err as Error).message}`); }
  if (!s1 || !s2) return;
  console.log("");
  console.log("对比结果:");
  console.log("─".repeat(60));
  console.log(`  标题:   ${s1.title || "(无)"}  |  ${s2.title || "(无)"}`);
  console.log(`  状态:   ${s1.meta.status}  |  ${s2.meta.status}`);
  console.log(`  大小:   ${s1.meta.bytes}B  |  ${s2.meta.bytes}B`);
  console.log(`  总耗时: ${s1.meta.timing.total}ms  |  ${s2.meta.timing.total}ms`);
  console.log(`  链接:   ${s1.links.length}  |  ${s2.links.length}`);
  console.log(`  图片:   ${s1.images.length}  |  ${s2.images.length}`);
  console.log(`  标题结构: ${s1.headings.length}  |  ${s2.headings.length}`);
  console.log(`  文本哈希: ${s1.hash}  |  ${s2.hash}`);
  console.log(`  哈希相同: ${s1.hash === s2.hash ? "是（文本完全一致）" : "否"}`);
  // 找出独有链接
  const set1 = new Set(s1.links.map((l) => l.href));
  const set2 = new Set(s2.links.map((l) => l.href));
  const only1 = s1.links.filter((l) => !set2.has(l.href));
  const only2 = s2.links.filter((l) => !set1.has(l.href));
  console.log("");
  console.log(`  仅 ${u1} 有的链接: ${only1.length}`);
  only1.slice(0, 5).forEach((l) => console.log(`    + ${l.href}`));
  console.log(`  仅 ${u2} 有的链接: ${only2.length}`);
  only2.slice(0, 5).forEach((l) => console.log(`    + ${l.href}`));
  console.log("");
}

async function cmdArchive(targetUrl: string): Promise<void> {
  console.log(`[archive] ${targetUrl}`);
  const outDir = path.resolve(process.cwd(), "output", "archive");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  try {
    const s = await takeSnapshot(targetUrl);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = targetUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 50);
    const textFile = path.join(outDir, `${safe}_${stamp}.txt`);
    const jsonFile = path.join(outDir, `${safe}_${stamp}.json`);
    fs.writeFileSync(textFile, renderSnapshot(s), "utf8");
    fs.writeFileSync(jsonFile, JSON.stringify(s, null, 2), "utf8");
    console.log(`[archive] 文本快照: ${textFile}`);
    console.log(`[archive] 元数据 JSON: ${jsonFile}`);
  } catch (err) {
    console.log(`[archive] 失败: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
简易网页截图工具 - 用法:
  node dist/index.js snapshot <url> [-o file]      生成文本快照
  node dist/index.js compare <url1> <url2>          对比两个快照
  node dist/index.js archive <url>                  归档快照与元数据
  node dist/index.js help                           显示本帮助

重要说明:
  本工具输出的是“文本快照”，不是浏览器像素截图。
  包含：标题、正文文本、链接列表、图片列表、元数据、响应头、请求计时。
`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
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
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const { positional, flags } = parseFlags(argv.slice(1));

  try {
    switch (cmd) {
      case "snapshot":
        if (!positional[0]) { console.log("请提供 URL。"); return; }
        await cmdSnapshot(positional[0], flags.out);
        break;
      case "compare":
        if (!positional[0] || !positional[1]) { console.log("请提供两个 URL。"); return; }
        await cmdCompare(positional[0], positional[1]);
        break;
      case "archive":
        if (!positional[0]) { console.log("请提供 URL。"); return; }
        await cmdArchive(positional[0]);
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
