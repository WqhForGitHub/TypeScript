#!/usr/bin/env node
/**
 * 55. 爬取小说章节 — 增强版
 * 小说章节爬虫，含目录提取、章节下载、全文搜索。
 * 仅使用 Node.js 内置模块 (fs, path, url, http, https, zlib)。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";

// ============================================================
// 1. 枚举
// ============================================================

enum Command {
  Toc = "toc",
  Fetch = "fetch",
  Download = "download",
  Search = "search",
  Help = "help",
}

enum ContentType {
  Html = "text/html",
  Text = "text/plain",
  Json = "application/json",
}

enum ErrorCode {
  NetworkError = "network_error",
  TimeoutError = "timeout_error",
  ParseError = "parse_error",
  NoContent = "no_content",
  InvalidUrl = "invalid_url",
  UnknownCommand = "unknown_command",
}

enum ChapterStatus {
  Pending = "pending",
  Fetching = "fetching",
  Success = "success",
  Failed = "failed",
  Demo = "demo",
}

enum ContentSource {
  Live = "live",
  Demo = "demo",
}

// ============================================================
// 2. 类型与工具类型
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Optional<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] };

interface FetchOptions {
  readonly timeout?: number;
  readonly headers?: Record<string, string>;
}

interface FetchResult {
  readonly status: number;
  readonly body: string;
  readonly finalUrl: string;
}

interface ChapterLink {
  readonly title: string;
  readonly url: string;
  readonly index: number;
}

type TocEntry = {
  readonly kind: "toc";
  readonly title: string;
  readonly url: string;
  readonly index: number;
};

type ChapterContent = {
  readonly kind: "chapter";
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly index: number;
  readonly source: ContentSource;
  readonly wordCount: number;
};

type SearchResult = {
  readonly kind: "search";
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
};

type NovelItem = TocEntry | ChapterContent | SearchResult;

interface Identifiable {
  readonly id: string;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

abstract class NovelError extends Error {
  abstract readonly code: ErrorCode;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class NetworkErrorX extends NovelError {
  readonly code = ErrorCode.NetworkError;
}

class TimeoutErrorX extends NovelError {
  readonly code = ErrorCode.TimeoutError;
}

class ParseErrorX extends NovelError {
  readonly code = ErrorCode.ParseError;
}

class NoContentError extends NovelError {
  readonly code = ErrorCode.NoContent;
}

// ============================================================
// 4. Symbol、as const、satisfies
// ============================================================

const SYM_META = Symbol("chapterMeta");
const SYM_HASH = Symbol("contentHash");

interface ChapterMeta {
  readonly fetchedAt: Date;
  bytes: number;
  status: ChapterStatus;
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
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "zh-CN,zh;q=0.9",
} as const;

const AD_PATTERNS = [
  /本章未完.*?点击下一页继续/gi,
  /www\.[a-z0-9]+\.(com|net|org|cn)/gi,
  /本章完/g,
  /手机用户请浏览.*?阅读/gi,
  /百度搜索.*?小说/gi,
] as const;

// ============================================================
// 5. 泛型存储
// ============================================================

class NovelStore<T extends Identifiable> {
  private readonly items = new Map<string, T>();
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  get name(): string {
    return this._name;
  }
  set name(v: string) {
    this._name = v;
  }
  get count(): number {
    return this.items.size;
  }

  add(item: T): void {
    this.items.set(item.id, item);
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }

  *[Symbol.iterator](): Generator<T> {
    for (const v of this.items.values()) yield v;
  }

  *entries(): Generator<readonly [string, T]> {
    for (const [k, v] of this.items.entries()) yield [k, v] as const;
  }

  toArray(): T[] {
    return Array.from(this.items.values());
  }
}

// ============================================================
// 6. HTTP fetch (函数重载)
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
      req.setTimeout(timeout, () => {
        req.destroy(new TimeoutErrorX(`请求超时 (${timeout}ms)`));
      });
      req.on("error", (err: Error) => reject(new NetworkErrorX(err.message)));
      req.end();
    };
    attempt(currentUrl);
  });
}

// ============================================================
// 7. HTML 提取工具
// ============================================================

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanContent(text: string): string {
  let out = text;
  for (const p of AD_PATTERNS) out = out.replace(p, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function extractLinks(html: string, baseUrl: string): ChapterLink[] {
  const out: ChapterLink[] = [];
  const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripTags(m[2] ?? "").trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#"))
      continue;
    if (!text || text.length < 2) continue;
    const absolute = url.resolve(baseUrl, href);
    out.push({ title: text, url: absolute, index: idx++ });
  }
  return out;
}

const CONTENT_PATTERNS = [
  /<div[^>]*id=["']?content["']?[^>]*>([\s\S]*?)<\/div>/i,
  /<div[^>]*class=["']?[^"']*?content[^"']*?["']?[^>]*>([\s\S]*?)<\/div>/i,
  /<div[^>]*id=["']?chaptercontent["']?[^>]*>([\s\S]*?)<\/div>/i,
  /<div[^>]*class=["']?[^"']*?chapter[^"']*?["']?[^>]*>([\s\S]*?)<\/div>/i,
] as const;

function extractContent(html: string, title: string): string {
  for (const p of CONTENT_PATTERNS) {
    const m = p.exec(html);
    if (m && m[1] && m[1].length > 200) return stripTags(m[1]);
  }
  const ps: string[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html)) !== null) {
    const t = stripTags(mm[1] ?? "").trim();
    if (t.length > 20) ps.push(t);
  }
  if (ps.length > 0) return ps.join("\n\n");
  const bodyMatch = /<body[\s\S]*?>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch && bodyMatch[1]) return stripTags(bodyMatch[1]).slice(0, 8000);
  return `[无法解析正文] ${title}`;
}

// ============================================================
// 8. 演示数据
// ============================================================

const DEMO_NOVEL_TITLE = "演示小说·星空彼端";

const DEMO_CHAPTERS: ReadonlyArray<readonly [string, string]> = [
  [
    "第一章 觉醒",
    "凌晨三点，林舟从噩梦中惊醒。\n\n窗外的城市灯火稀疏，他擦了擦额头的冷汗，耳边似乎还回响着梦中那段低语。电子时钟的蓝光在墙壁上投射出模糊的数字，他坐起身，深吸了一口气。\n\n「又是这个梦……」\n\n他低声自语，伸手从床头柜拿起那枚古旧的怀表。怀表的指针在他指尖缓缓转动，发出极轻微的滴答声，仿佛在回应他的心跳。",
  ],
  [
    "第二章 信号",
    "实验室里，监视器的曲线剧烈起伏。\n\n「林舟，你过来看这个。」导师指着屏幕上的一段波形，神情严肃，「这是昨晚从深空接收到的信号，频率非常规整，不像是自然现象。」\n\n林舟凑近屏幕，瞳孔骤然收缩。那段波形与他在梦中听到的低语节奏，完全一致。\n\n「这不可能是巧合。」他喃喃道。",
  ],
  [
    "第三章 决定",
    "夜色更深了。\n\n林舟站在天台上，望着星空。怀表在他掌心微微发烫，仿佛有什么东西在召唤他。他想起导师白天的话，想起梦中那段低语，最终深吸一口气，做出了决定。\n\n「如果宇宙真的在呼唤我，」他轻声说，「那我就去回应它。」\n\n他转身下楼，开始收拾行装。",
  ],
  [
    "第四章 启程",
    "列车穿过晨雾，向着北方疾驰。\n\n林舟靠在窗边，看着窗外飞速后退的田野。怀表被他小心地放在胸前口袋，隔着布料，他能感觉到它的温度。这是一段未知旅程的起点，他不知道终点在哪里，但内心却异常平静。\n\n「无论前方是什么，」他想，「我都不会退缩。」",
  ],
  [
    "第五章 抵达",
    "北方的观测站隐藏在群山之间。\n\n林舟推开厚重的金属门，迎面是一个巨大的射电望远镜阵列。导师已经在门口等候，见到他，露出一丝复杂的神情。\n\n「你来了。」\n\n「我来了。」\n\n两人对视片刻，无需多言。他们都知道，从这一刻起，一切都将改变。",
  ],
] as const;

function demoLinks(): ChapterLink[] {
  return DEMO_CHAPTERS.map((c, i) => ({
    title: c[0],
    url: `demo://${i}`,
    index: i,
  }));
}

function demoContent(idx: number): string {
  return DEMO_CHAPTERS[idx]?.[1] ?? "(无内容)";
}

// ============================================================
// 9. 抽象数据源
// ============================================================

abstract class AbstractNovelSource {
  abstract readonly name: string;
  abstract fetchToc(targetUrl: string): Promise<ChapterLink[]>;
  abstract fetchChapter(link: ChapterLink): Promise<ChapterContent>;
}

class WebNovelSource extends AbstractNovelSource {
  readonly name = "WebNovelSource";

  async fetchToc(targetUrl: string): Promise<ChapterLink[]> {
    const res = await fetchText(targetUrl);
    let links = extractLinks(res.body, res.finalUrl).filter(
      (l) => /第.*章|chapter|卷/.test(l.title) || /\d+/.test(l.title),
    );
    if (links.length === 0) links = extractLinks(res.body, res.finalUrl);
    return links;
  }

  async fetchChapter(link: ChapterLink): Promise<ChapterContent> {
    const res = await fetchText(link.url);
    const raw = extractContent(res.body, link.title);
    const content = cleanContent(raw);
    return {
      kind: "chapter",
      title: link.title,
      url: link.url,
      content,
      index: link.index,
      source: ContentSource.Live,
      wordCount: content.length,
    };
  }
}

class MockNovelSource extends AbstractNovelSource {
  readonly name = "MockNovelSource";

  async fetchToc(_targetUrl: string): Promise<ChapterLink[]> {
    return demoLinks();
  }

  async fetchChapter(link: ChapterLink): Promise<ChapterContent> {
    const idx = parseInt(link.url.replace("demo://", ""), 10) || link.index;
    const content = demoContent(idx);
    return {
      kind: "chapter",
      title: link.title,
      url: link.url,
      content,
      index: link.index,
      source: ContentSource.Demo,
      wordCount: content.length,
    };
  }
}

// ============================================================
// 10. 类型守卫
// ============================================================

function isChapterContent(item: NovelItem): item is ChapterContent {
  return item.kind === "chapter";
}

function isTocEntry(item: NovelItem): item is TocEntry {
  return item.kind === "toc";
}

function isSearchResult(item: NovelItem): item is SearchResult {
  return item.kind === "search";
}

function isNovelError(err: unknown): err is NovelError {
  return err instanceof NovelError;
}

// ============================================================
// 11. 命令实现
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function cmdToc(targetUrl: string): Promise<void> {
  Logger.info(`抓取目录: ${targetUrl}`);
  let links: ChapterLink[];
  let sourceLabel = "实时";
  try {
    const webSource = new WebNovelSource();
    links = await webSource.fetchToc(targetUrl);
    Logger.info(`解析到 ${links.length} 个章节链接 (来源: ${sourceLabel})`);
  } catch (err) {
    Logger.warn(
      `实时抓取失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    Logger.warn("回退到演示小说目录。");
    const mockSource = new MockNovelSource();
    links = await mockSource.fetchToc("");
    sourceLabel = "演示";
  }
  console.log("");
  console.log(
    `  《${DEMO_NOVEL_TITLE}》  共 ${links.length} 章  [${sourceLabel}]`,
  );
  console.log("  " + "─".repeat(60));
  for (const l of links.slice(0, 50)) {
    console.log(`  ${String(l.index + 1).padStart(4, " ")}. ${l.title}`);
  }
  if (links.length > 50)
    console.log(`  ... 还有 ${links.length - 50} 章未显示`);
  console.log("");
}

async function cmdFetch(
  targetUrl: string,
  start: number,
  end: number,
  outDir: string,
  delayMs: number,
): Promise<void> {
  Logger.info(
    `抓取 ${targetUrl}  章节 ${start}-${end}  输出: ${outDir}  限速: ${delayMs}ms`,
  );
  const webSource = new WebNovelSource();
  const mockSource = new MockNovelSource();
  let links: ChapterLink[];
  let useMock = false;
  try {
    links = await webSource.fetchToc(targetUrl);
    Logger.info(`解析到 ${links.length} 个章节`);
  } catch (err) {
    Logger.warn(
      `实时抓取失败: ${err instanceof Error ? err.message : String(err)}，使用演示小说。`,
    );
    useMock = true;
    links = await mockSource.fetchToc("");
  }

  const absOut = path.resolve(process.cwd(), outDir);
  if (!fs.existsSync(absOut)) fs.mkdirSync(absOut, { recursive: true });

  const s = Math.max(1, start) - 1;
  const e = Math.min(links.length, end);
  const store = new NovelStore<ChapterContent & Identifiable>("chapters");

  for (let i = s; i < e; i++) {
    const link = links[i]!;
    let chapter: ChapterContent;
    if (useMock || link.url.startsWith("demo://")) {
      chapter = await mockSource.fetchChapter(link);
      console.log(
        `  (${i + 1}/${e}) [demo] ${link.title}  [${chapter.wordCount}字]`,
      );
    } else {
      try {
        chapter = await webSource.fetchChapter(link);
        console.log(
          `  (${i + 1}/${e}) ✓ ${link.title}  [${chapter.wordCount}字]`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        chapter = {
          kind: "chapter",
          title: link.title,
          url: link.url,
          content: `[抓取失败] ${msg}`,
          index: link.index,
          source: ContentSource.Live,
          wordCount: 0,
        };
        console.log(`  (${i + 1}/${e}) ✗ ${link.title}  失败: ${msg}`);
      }
      if (delayMs > 0) await sleep(delayMs);
    }
    const id = `ch-${String(i + 1).padStart(4, "0")}`;
    store.add({ ...chapter, id });
    const safeTitle = link.title.replace(/[\\/:*?"<>|]/g, "_");
    const file = path.join(
      absOut,
      `${String(i + 1).padStart(4, "0")}_${safeTitle}.txt`,
    );
    fs.writeFileSync(file, `${link.title}\n\n${chapter.content}\n`, "utf8");
  }
  Logger.info(`完成，${store.count} 章保存于: ${absOut}`);
}

async function cmdDownload(targetUrl: string, delayMs: number): Promise<void> {
  Logger.info(`下载整本小说: ${targetUrl}`);
  const webSource = new WebNovelSource();
  const mockSource = new MockNovelSource();
  let links: ChapterLink[];
  let useMock = false;
  try {
    links = await webSource.fetchToc(targetUrl);
  } catch (err) {
    Logger.warn(
      `实时失败: ${err instanceof Error ? err.message : String(err)}，使用演示小说。`,
    );
    useMock = true;
    links = await mockSource.fetchToc("");
  }

  const parts: string[] = [];
  parts.push(
    `《${DEMO_NOVEL_TITLE}》\n共 ${links.length} 章  抓取时间: ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`,
  );

  for (let i = 0; i < links.length; i++) {
    const link = links[i]!;
    let chapter: ChapterContent;
    if (useMock || link.url.startsWith("demo://")) {
      chapter = await mockSource.fetchChapter(link);
    } else {
      try {
        chapter = await webSource.fetchChapter(link);
        console.log(`  (${i + 1}/${links.length}) ✓ ${link.title}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        chapter = {
          kind: "chapter",
          title: link.title,
          url: link.url,
          content: `[抓取失败] ${msg}`,
          index: link.index,
          source: ContentSource.Live,
          wordCount: 0,
        };
        console.log(`  (${i + 1}/${links.length}) ✗ ${link.title}`);
      }
      if (delayMs > 0 && i < links.length - 1) await sleep(delayMs);
    }
    parts.push(`${link.title}\n\n${chapter.content}\n\n${"-".repeat(60)}\n\n`);
  }

  const outDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${DEMO_NOVEL_TITLE}.txt`);
  fs.writeFileSync(file, parts.join(""), "utf8");
  Logger.info(`完成，整本小说保存于: ${file}`);
}

async function cmdSearch(site: string, keyword: string): Promise<void> {
  Logger.info(`站点: ${site}  关键词: ${keyword}`);
  const searchUrl = `${site}/search?q=${encodeURIComponent(keyword)}`;
  try {
    const res = await fetchText(searchUrl, { timeout: 10000 });
    const links = extractLinks(res.body, res.finalUrl).filter(
      (l) => l.title.includes(keyword) || l.url.includes(keyword),
    );
    if (links.length === 0) {
      Logger.warn("未找到匹配结果（或站点不可访问）。");
      return;
    }
    console.log(`找到 ${links.length} 条结果：`);
    for (const [i, l] of links.slice(0, 20).entries()) {
      console.log(`  ${i + 1}. ${l.title}\n     ${l.url}`);
    }
  } catch (err) {
    Logger.error(
      `搜索失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    Logger.warn("提示：本命令仅演示搜索请求构造与解析技术。");
  }
}

// ============================================================
// 12. CLI
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
    if (a === "-s" || a === "--start") flags.start = args[++i] ?? "";
    else if (a === "-e" || a === "--end") flags.end = args[++i] ?? "";
    else if (a === "-o" || a === "--out") flags.out = args[++i] ?? "";
    else if (a === "--delay") flags.delay = args[++i] ?? "";
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i] ?? "";
    else positional.push(a);
  }
  return { positional, flags };
}

function printHelp(): void {
  console.log(`
小说章节爬虫 - 用法:
  node dist/index.js toc <url>                          抓取目录页
  node dist/index.js fetch <url> [-s start] [-e end]    抓取指定章节范围
                         [-o outdir] [--delay ms]
  node dist/index.js download <url> [--delay ms]        下载整本到单个 .txt
  node dist/index.js search <site> <keyword>            搜索小说
  node dist/index.js help                               显示本帮助

选项:
  -s, --start <n>     起始章节（默认 1）
  -e, --end <n>       结束章节（默认 10）
  -o, --out <dir>     输出目录（默认 ./output/chapters）
  --delay <ms>        每章请求间隔（默认 800ms，限速）

说明:
  - 优先实时抓取；失败时回退到内置演示小说。
  - 自动清理常见广告/水印文本。
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

  try {
    switch (cmd) {
      case Command.Toc:
        if (!positional[0]) {
          Logger.error("请提供目录页 URL。");
          return;
        }
        await cmdToc(positional[0]);
        break;
      case Command.Fetch: {
        if (!positional[0]) {
          Logger.error("请提供目录页 URL。");
          return;
        }
        const start = parseInt(flags.start || "1", 10) || 1;
        const end = parseInt(flags.end || "10", 10) || 10;
        const out = flags.out || path.join("output", "chapters");
        const delay = parseInt(flags.delay || "800", 10) || 800;
        await cmdFetch(positional[0], start, end, out, delay);
        break;
      }
      case Command.Download: {
        if (!positional[0]) {
          Logger.error("请提供目录页 URL。");
          return;
        }
        const delay = parseInt(flags.delay || "800", 10) || 800;
        await cmdDownload(positional[0], delay);
        break;
      }
      case Command.Search:
        if (!positional[0] || !positional[1]) {
          Logger.error("用法: search <site> <keyword>");
          return;
        }
        await cmdSearch(positional[0], positional[1]);
        break;
      default:
        Logger.error(`未知命令: ${cmd}`);
        printHelp();
    }
  } catch (err) {
    const msg = isNovelError(err)
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    Logger.error(`运行出错: ${msg}`);
    process.exit(1);
  }
}

main();
