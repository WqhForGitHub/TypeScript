#!/usr/bin/env node
/**
 * 51. 爬取新闻网站 (Enhanced, type-safe edition)
 * 基于 Node.js 内置模块的新闻网站爬虫，演示大量 TypeScript 高级特性。
 * 仅使用：fs、path、url、http、https、zlib。
 *
 * 功能保持不变：fetch <url> / latest / search <keyword>，
 * HTML 解析、JSON 输出、离线回退演示数据。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";

// --- 枚举：字符串枚举 + 常规枚举 ---
enum Command {
  Fetch = "fetch",
  Latest = "latest",
  Search = "search",
  Help = "help",
}
enum HttpMethod {
  Get = "GET",
  Post = "POST",
  Head = "HEAD",
}
enum ContentType {
  TextHtml = "text/html",
  ApplicationJson = "application/json",
  ApplicationXhtml = "application/xhtml+xml",
  ApplicationXml = "application/xml",
  Any = "*/*",
}
enum FetchStatus {
  Idle,
  InProgress,
  Success,
  Redirected,
  Failed,
}
enum ErrorCode {
  NetworkError = "NETWORK_ERROR",
  TimeoutError = "TIMEOUT_ERROR",
  ParseError = "PARSE_ERROR",
  RedirectLoopError = "REDIRECT_LOOP_ERROR",
  InvalidUrlError = "INVALID_URL_ERROR",
  NoContentError = "NO_CONTENT_ERROR",
  EncodingError = "ENCODING_ERROR",
}
enum ArticleCategory {
  General,
  Technology,
  Science,
  Politics,
  Business,
  Sports,
  Health,
  Entertainment,
}

// --- 模板字面量类型 / 元组 / 只读元组 ---
type UrlPattern = `http://${string}` | `https://${string}`;
type OutputFilename = `news-${string}-${number}.json`;
type SearchFilename = `news-search-${string}-${number}.json`;
type HeaderEntry = readonly [name: string, value: string];
type StatusLine = readonly [
  method: HttpMethod,
  target: UrlPattern,
  status: number,
];

// --- 接口（可选 / 只读 / 索引签名）---
interface Identifiable {
  readonly id: string;
}
interface FetchOptions {
  readonly method?: HttpMethod;
  timeout?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  contentType?: ContentType;
}
interface NewsArticle extends Identifiable {
  title: string;
  link: string;
  summary: string;
  source: string;
  fetchedAt: string;
  category: ArticleCategory;
  readonly createdAt: number;
  [key: string]: string | number | ArticleCategory;
}
interface HtmlNode {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly text: string;
}
interface ParserOptions {
  readonly minTitleLength?: number;
  readonly maxSummaryLength?: number;
}
interface ParsedArgs {
  positional: readonly string[];
  flags: Readonly<Record<string, string>>;
}

// --- 判别联合（Discriminated Unions）---
interface SuccessResult {
  readonly kind: "success";
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  readonly finalUrl: string;
}
interface ErrorResult {
  readonly kind: "error";
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: Error;
}
interface RedirectResult {
  readonly kind: "redirect";
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly maxRedirects: number;
}
type FetchOutcome = SuccessResult | ErrorResult | RedirectResult;

// --- 条件类型 / 映射类型 ---
type IsSuccess<T> = T extends { kind: "success" } ? true : false;
type UnwrapBody<T> = T extends { body: infer B } ? B : never;
type Mutable<T> = { -readonly [P in keyof T]: T[P] };
type ArticleWithoutMeta = Omit<
  NewsArticle,
  "fetchedAt" | "source" | "createdAt"
>;
type ArticleSummary = Pick<NewsArticle, "title" | "summary">;
type ArticleHeader = Readonly<Pick<NewsArticle, "title" | "link">>;
type CategoryMap = { [K in ArticleCategory]: string };

// --- Symbol 唯一属性键 ---
const ARTICLE_STORE = Symbol("articleStore");
const FETCH_METADATA = Symbol("fetchMetadata");
const ORIGIN_TAG = Symbol("originTag");

// --- 自定义 Error 类层级（带 code 属性）---
abstract class ScraperError extends Error {
  abstract readonly code: ErrorCode;
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class NetworkError extends ScraperError {
  readonly code = ErrorCode.NetworkError;
}
class TimeoutError extends ScraperError {
  readonly code = ErrorCode.TimeoutError;
}
class ParseError extends ScraperError {
  readonly code = ErrorCode.ParseError;
}
class RedirectLoopError extends ScraperError {
  readonly code = ErrorCode.RedirectLoopError;
}
class InvalidUrlError extends ScraperError {
  readonly code = ErrorCode.InvalidUrlError;
}
class NoContentError extends ScraperError {
  readonly code = ErrorCode.NoContentError;
}

// --- 类型守卫 ---
function isSuccess(r: FetchOutcome): r is SuccessResult {
  return r.kind === "success";
}
function isError(r: FetchOutcome): r is ErrorResult {
  return r.kind === "error";
}
function isRedirect(r: FetchOutcome): r is RedirectResult {
  return r.kind === "redirect";
}
function isUrlPattern(s: string): s is UrlPattern {
  return /^https?:\/\//.test(s);
}
function isArticle(obj: unknown): obj is NewsArticle {
  if (typeof obj !== "object" || obj === null) return false;
  const a = obj as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.title === "string" &&
    typeof a.link === "string"
  );
}
function isScraperError(e: unknown): e is ScraperError {
  return e instanceof ScraperError;
}

// --- as const 断言 / satisfies 操作符 ---
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_UA,
  Accept: `${ContentType.TextHtml},${ContentType.ApplicationXhtml},${ContentType.ApplicationXml};q=0.9,${ContentType.Any};q=0.8`,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate",
} as const;
const DEFAULT_OPTIONS = {
  timeout: 12000,
  maxRedirects: 5,
  method: HttpMethod.Get,
} as const;
const VOID_TAGS = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
] as const;
const CATEGORY_LABELS: CategoryMap = {
  [ArticleCategory.General]: "综合",
  [ArticleCategory.Technology]: "科技",
  [ArticleCategory.Science]: "科学",
  [ArticleCategory.Politics]: "政治",
  [ArticleCategory.Business]: "财经",
  [ArticleCategory.Sports]: "体育",
  [ArticleCategory.Health]: "健康",
  [ArticleCategory.Entertainment]: "娱乐",
} satisfies CategoryMap;
const runtimeConfig = {
  timeout: 12000,
  maxRedirects: 5,
  userAgent: DEFAULT_UA,
  outputDir: "output",
  defaultSource: "https://news.ycombinator.com/",
} satisfies {
  timeout: number;
  maxRedirects: number;
  userAgent: string;
  outputDir: string;
  defaultSource: UrlPattern;
};

// --- 泛型类（带约束）+ getter/setter + 生成器 + Symbol 方法 ---
class DataStore<T extends Identifiable> {
  private readonly items = new Map<string, T>();
  private _count = 0;
  constructor(private readonly _name: string = "store") {}
  get name(): string {
    return this._name;
  }
  get count(): number {
    return this._count;
  }
  set count(v: number) {
    if (v < 0) throw new RangeError(`count must be >= 0, got ${v}`);
    this._count = v;
  }
  add(item: T): this {
    this.items.set(item.id, item);
    this._count = this.items.size;
    return this;
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  has(id: string): boolean {
    return this.items.has(id);
  }
  all(): readonly T[] {
    return Array.from(this.items.values());
  }
  clear(): void {
    this.items.clear();
    this._count = 0;
  }
  filter(predicate: (item: T) => boolean): T[] {
    const out: T[] = [];
    for (const v of this.items.values()) if (predicate(v)) out.push(v);
    return out;
  }
  [Symbol.iterator](): Iterator<T> {
    return this.items.values();
  }
  *entries(): IterableIterator<T> {
    for (const v of this.items.values()) yield v;
  }
  [ORIGIN_TAG](): string {
    return `DataStore<${this._name}>#${this._count}`;
  }
}

// --- 抽象抓取器 + 具体子类 (HttpFetcher / HttpsFetcher) ---
abstract class AbstractFetcher {
  abstract readonly protocol: "http:" | "https:";
  protected redirectCount = 0;
  protected lastStatus: FetchStatus = FetchStatus.Idle;
  abstract fetch(rawUrl: string, opts?: FetchOptions): Promise<FetchOutcome>;
  protected buildHeaders(opts?: FetchOptions): Record<string, string> {
    return { ...DEFAULT_HEADERS, ...(opts?.headers ?? {}) };
  }
  protected resolveUrl(base: string, relative: string): string {
    return url.resolve(base, relative);
  }
  get status(): FetchStatus {
    return this.lastStatus;
  }
}

class HttpFetcher extends AbstractFetcher {
  readonly protocol: "http:" = "http:";
  async fetch(rawUrl: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
    return doFetch(rawUrl, opts);
  }
}

class HttpsFetcher extends AbstractFetcher {
  readonly protocol: "https:" = "https:";
  async fetch(rawUrl: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
    return doFetch(rawUrl, opts);
  }
}

function selectFetcher(protocol: string): AbstractFetcher {
  return protocol === "https:" ? new HttpsFetcher() : new HttpFetcher();
}

// 实际抓取实现（Promise + 内置 http/https，支持重定向 / gzip / 超时）
function doFetch(rawUrl: string, opts: FetchOptions): Promise<FetchOutcome> {
  const timeout = opts.timeout ?? DEFAULT_OPTIONS.timeout;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_OPTIONS.maxRedirects;
  const headers = { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) };
  return new Promise<FetchOutcome>((resolve) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      let parsed: url.UrlWithStringQuery;
      try {
        parsed = url.parse(target);
      } catch {
        resolve({
          kind: "error",
          code: ErrorCode.InvalidUrlError,
          message: `URL 解析失败: ${target}`,
        });
        return;
      }
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        resolve({
          kind: "error",
          code: ErrorCode.InvalidUrlError,
          message: `无效主机: ${target}`,
        });
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
            if (redirects >= maxRedirects) {
              resolve({
                kind: "redirect",
                from: target,
                to: res.headers.location,
                count: redirects,
                maxRedirects,
              });
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
          const encoding = (
            res.headers["content-encoding"] || ""
          ).toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (encoding === "deflate")
            stream = res.pipe(zlib.createInflate());
          else if (encoding === "br")
            stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve({
              kind: "success",
              status: res.statusCode || 200,
              headers: res.headers,
              body,
              finalUrl: currentUrl,
            });
          });
          stream.on("error", (err: Error) => {
            resolve({
              kind: "error",
              code: ErrorCode.NetworkError,
              message: err.message,
              cause: err,
            });
          });
        },
      );
      req.setTimeout(timeout, () => {
        req.destroy(new Error(`请求超时 (${timeout}ms): ${target}`));
      });
      req.on("error", (err: Error) => {
        resolve({
          kind: "error",
          code: ErrorCode.NetworkError,
          message: err.message,
          cause: err,
        });
      });
      req.end();
    };
    attempt(currentUrl);
  });
}

// --- 抽象解析器 + 具体子类 HtmlParser ---
abstract class AbstractParser<TNode> {
  protected abstract readonly source: string;
  protected abstract tokenize(): TNode[];
  abstract parse(): TNode[];
  abstract extract(
    nodes: readonly TNode[],
    baseUrl: string,
    opts: ParserOptions,
  ): NewsArticle[];
}

class HtmlParser extends AbstractParser<HtmlNode> {
  protected readonly source: string;
  private readonly nodes: HtmlNode[];
  private readonly voidSet: ReadonlySet<string>;
  constructor(source: string) {
    super();
    this.source = source;
    this.voidSet = new Set<string>(VOID_TAGS);
    this.nodes = this.tokenize();
  }
  protected tokenize(): HtmlNode[] {
    return this.parseImpl();
  }
  parse(): HtmlNode[] {
    return this.nodes.slice();
  }
  extract(
    nodes: readonly HtmlNode[],
    baseUrl: string,
    opts: ParserOptions,
  ): NewsArticle[] {
    return extractArticlesFromNodes(nodes, baseUrl, opts);
  }
  byTag(tag: string): HtmlNode[] {
    return this.nodes.filter((n) => n.tag === tag.toLowerCase());
  }
  headings(): HtmlNode[] {
    return this.nodes.filter(
      (n) => n.tag === "h1" || n.tag === "h2" || n.tag === "h3",
    );
  }
  links(): HtmlNode[] {
    return this.nodes.filter((n) => n.tag === "a" && !!n.attrs.href);
  }
  paragraphs(): HtmlNode[] {
    return this.nodes.filter((n) => n.tag === "p" && !!n.text);
  }
  *iterateLinks(): IterableIterator<HtmlNode> {
    for (const n of this.nodes) if (n.tag === "a" && n.attrs.href) yield n;
  }
  *iterateHeadings(): IterableIterator<HtmlNode> {
    for (const n of this.nodes)
      if (n.tag === "h1" || n.tag === "h2" || n.tag === "h3") yield n;
  }
  private parseImpl(): HtmlNode[] {
    const html = this.source;
    const out: HtmlNode[] = [];
    let i = 0;
    const len = html.length;
    while (i < len) {
      if (html[i] === "<") {
        if (html.substr(i, 4) === "<!--") {
          const end = html.indexOf("-->", i + 4);
          i = end === -1 ? len : end + 3;
          continue;
        }
        if (/^<\?/i.test(html.substr(i, 2))) {
          const end = html.indexOf("?>", i + 2);
          i = end === -1 ? len : end + 2;
          continue;
        }
        if (/^<!/i.test(html.substr(i, 2))) {
          const end = html.indexOf(">", i + 2);
          i = end === -1 ? len : end + 1;
          continue;
        }
        const tagEnd = html.indexOf(">", i + 1);
        if (tagEnd === -1) break;
        const tagContent = html.slice(i + 1, tagEnd);
        const selfClose = tagContent.endsWith("/");
        const cleaned = selfClose
          ? tagContent.slice(0, -1).trim()
          : tagContent.trim();
        const match = /^([a-zA-Z][a-zA-Z0-9]*)\s*(.*)$/s.exec(cleaned);
        if (!match) {
          i = tagEnd + 1;
          continue;
        }
        const tag = match[1].toLowerCase();
        const attrs = HtmlParser.parseAttrs(match[2] || "");
        if (tag === "script" || tag === "style") {
          const closeTag = `</${tag}`;
          const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
          i = closeIdx === -1 ? len : html.indexOf(">", closeIdx) + 1;
          continue;
        }
        if (selfClose || this.voidSet.has(tag)) {
          out.push({ tag, attrs, text: "" });
          i = tagEnd + 1;
          continue;
        }
        const closeTag = `</${tag}`;
        const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
        if (closeIdx === -1) {
          out.push({
            tag,
            attrs,
            text: HtmlParser.cleanText(html.slice(tagEnd + 1)),
          });
          i = len;
          continue;
        }
        const inner = html.slice(tagEnd + 1, closeIdx);
        out.push({ tag, attrs, text: HtmlParser.cleanText(inner) });
        const realCloseEnd = html.indexOf(">", closeIdx);
        i = realCloseEnd === -1 ? len : realCloseEnd + 1;
      } else {
        const nextTag = html.indexOf("<", i);
        const end = nextTag === -1 ? len : nextTag;
        const text = HtmlParser.cleanText(html.slice(i, end));
        if (text.trim()) out.push({ tag: "#text", attrs: {}, text });
        i = end;
      }
    }
    return out;
  }
  private static parseAttrs(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re =
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)'|(\s)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrStr)) !== null) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return attrs;
  }
  private static cleanText(s: string): string {
    return s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// --- 函数重载 ---
function makeFilename(tag: string): OutputFilename;
function makeFilename(tag: "search", keyword: string): SearchFilename;
function makeFilename(tag: string, keyword?: string): string {
  const ts = Date.now();
  if (tag === "search" && keyword !== undefined)
    return `news-search-${keyword}-${ts}.json`;
  return `news-${tag}-${ts}.json`;
}

function classify(title: string): ArticleCategory;
function classify(title: string, summary: string): ArticleCategory;
function classify(title: string, summary?: string): ArticleCategory {
  const text = (title + " " + (summary ?? "")).toLowerCase();
  if (/ai|人工智能|芯片|5g|互联网|科技|数码|算法|大模型/.test(text))
    return ArticleCategory.Technology;
  if (/航天|物理|生物|医学|科学|实验/.test(text))
    return ArticleCategory.Science;
  if (/政策|国务院|政府|改革|人大|外交/.test(text))
    return ArticleCategory.Politics;
  if (/经济|金融|股市|央行|gdp|消费|财经/.test(text))
    return ArticleCategory.Business;
  if (/奥运|足球|篮球|体育|联赛/.test(text)) return ArticleCategory.Sports;
  if (/健康|医疗|疫情|医院|疫苗/.test(text)) return ArticleCategory.Health;
  if (/电影|明星|娱乐|综艺|音乐/.test(text))
    return ArticleCategory.Entertainment;
  return ArticleCategory.General;
}

// --- 文章提取（基于节点）---
function extractArticlesFromNodes(
  nodes: readonly HtmlNode[],
  baseUrl: string,
  opts: ParserOptions,
): NewsArticle[] {
  const minTitle = opts.minTitleLength ?? 6;
  const maxSummary = opts.maxSummaryLength ?? 160;
  const links = nodes.filter((n) => n.tag === "a" && !!n.attrs.href);
  const headings = nodes.filter(
    (n) => n.tag === "h1" || n.tag === "h2" || n.tag === "h3",
  );
  const paragraphs = nodes.filter((n) => n.tag === "p" && !!n.text);
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  const now = new Date().toISOString();
  let counter = 0;
  const nextId = (): string => `art-${Date.now()}-${counter++}`;
  for (const a of links) {
    const href = a.attrs.href || "";
    if (!href || href.startsWith("javascript:") || href.startsWith("#"))
      continue;
    const absolute = url.resolve(baseUrl, href);
    if (!isUrlPattern(absolute)) continue;
    const title = a.text.trim();
    if (title.length < minTitle || seen.has(absolute)) continue;
    seen.add(absolute);
    let summary = "";
    for (const p of paragraphs) {
      if (p.text.length > 30 && p.text.includes(title.slice(0, 4))) {
        summary = p.text.slice(0, maxSummary);
        break;
      }
    }
    if (!summary && paragraphs.length > 0)
      summary = paragraphs[0].text.slice(0, maxSummary);
    articles.push({
      id: nextId(),
      title,
      link: absolute,
      summary,
      source: baseUrl,
      fetchedAt: now,
      category: classify(title, summary),
      createdAt: Date.now(),
    });
  }
  for (const h of headings) {
    const text = h.text.trim();
    if (!text || text.length < 4) continue;
    if (articles.some((a) => a.title === text)) continue;
    articles.push({
      id: nextId(),
      title: text,
      link: "",
      summary: "",
      source: baseUrl,
      fetchedAt: now,
      category: classify(text),
      createdAt: Date.now(),
    });
  }
  return articles;
}

function extractArticles(html: string, baseUrl: string): NewsArticle[] {
  const parser = new HtmlParser(html);
  return parser.extract(parser.parse(), baseUrl, {
    minTitleLength: 6,
    maxSummaryLength: 160,
  });
}

// --- 生成器：迭代文章与链接 ---
function* iterateArticles(
  articles: readonly NewsArticle[],
): IterableIterator<NewsArticle> {
  for (const a of articles) yield a;
}
function* iterateLinks(
  articles: readonly NewsArticle[],
): IterableIterator<HeaderEntry> {
  for (const a of articles) if (a.link) yield [a.title, a.link] as HeaderEntry;
}

// --- JSON 输出与打印 ---
function saveJson(filename: string, data: unknown): void {
  const outDir = path.resolve(process.cwd(), runtimeConfig.outputDir);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  console.log(`\n[保存] 结果已写入: ${file}`);
}

function printArticles(articles: NewsArticle[], limit: number): void {
  const slice = articles.slice(0, limit);
  console.log(`\n共 ${articles.length} 条，显示 ${slice.length} 条：`);
  console.log("=".repeat(72));
  slice.forEach((a, idx) => {
    const label = CATEGORY_LABELS[a.category as ArticleCategory];
    console.log(`\n[${idx + 1}] ${a.title}  [${label}]`);
    if (a.link) console.log(`    链接: ${a.link}`);
    if (a.summary) console.log(`    摘要: ${a.summary}`);
    console.log(`    来源: ${a.source}  时间: ${a.fetchedAt}`);
  });
  console.log("\n" + "=".repeat(72));
}

// --- 演示数据（离线回退）---
function demoArticles(): NewsArticle[] {
  const now = new Date().toISOString();
  const ts = Date.now();
  const raw: ArticleWithoutMeta[] = [
    {
      id: `demo-${ts}-1`,
      title: "国家发布 2025 年数字经济新政策 推动高质量发展",
      link: "https://demo.news.example.com/p/1001",
      summary:
        "国务院近日发布关于数字经济的新政策，明确未来五年发展方向，重点支持人工智能与制造业深度融合。",
      category: classify("国家发布 2025 年数字经济新政策", "人工智能"),
    },
    {
      id: `demo-${ts}-2`,
      title: "全球气候大会达成新协议 多国承诺减排目标",
      link: "https://demo.news.example.com/p/1002",
      summary:
        "经过两周谈判，与会各国就减排路线图达成共识，发达国家承诺提供更多气候融资。",
      category: ArticleCategory.General,
    },
    {
      id: `demo-${ts}-3`,
      title: "中国空间站完成新一轮科学实验 取得重要成果",
      link: "https://demo.news.example.com/p/1003",
      summary:
        "神舟乘组在轨完成多项生命科学与材料科学实验，相关数据已传回地面。",
      category: ArticleCategory.Science,
    },
    {
      id: `demo-${ts}-4`,
      title: "国内新能源汽车销量再创新高 出口持续增长",
      link: "https://demo.news.example.com/p/1004",
      summary:
        "据行业协会统计，上月新能源汽车销量同比增长 35%，欧洲市场表现尤为亮眼。",
      category: ArticleCategory.Business,
    },
    {
      id: `demo-${ts}-5`,
      title: "高校招生改革新方案公布 注重综合素质评价",
      link: "https://demo.news.example.com/p/1005",
      summary:
        "教育部公布新一轮招生改革方案，强化对学生综合素质与实践能力的考察。",
      category: ArticleCategory.Politics,
    },
    {
      id: `demo-${ts}-6`,
      title: "5G 网络覆盖进一步扩大 农村地区受益明显",
      link: "https://demo.news.example.com/p/1006",
      summary:
        "工信部数据显示，全国 5G 基站总数突破 400 万，偏远地区网络体验显著改善。",
      category: ArticleCategory.Technology,
    },
    {
      id: `demo-${ts}-7`,
      title: "人工智能大模型在医疗影像领域取得突破",
      link: "https://demo.news.example.com/p/1007",
      summary:
        "国内研究团队开发的医学影像大模型在多中心测试中表现优于传统方法。",
      category: ArticleCategory.Health,
    },
    {
      id: `demo-${ts}-8`,
      title: "央行下调存款准备金率 释放长期资金",
      link: "https://demo.news.example.com/p/1008",
      summary:
        "中国人民银行宣布降准 0.5 个百分点，预计释放约 1 万亿元长期资金。",
      category: ArticleCategory.Business,
    },
  ];
  return raw.map(
    (r) =>
      ({
        ...r,
        source: "演示数据",
        fetchedAt: now,
        createdAt: ts,
      }) as NewsArticle,
  );
}

// --- 命令实现 ---
async function cmdFetch(targetUrl: string, limit: number): Promise<void> {
  console.log(`[抓取] 目标: ${targetUrl} (limit=${limit})`);
  const store = new DataStore<NewsArticle>(ARTICLE_STORE.toString());
  let useDemo = false;
  let articles: NewsArticle[] = [];
  try {
    if (!isUrlPattern(targetUrl)) {
      throw new InvalidUrlError(
        `URL 必须以 http:// 或 https:// 开头: ${targetUrl}`,
      );
    }
    const fetcher = selectFetcher(url.parse(targetUrl).protocol || "http:");
    const outcome = await fetcher.fetch(targetUrl, { timeout: 12000 });
    if (isError(outcome)) throw new NetworkError(outcome.message);
    if (isRedirect(outcome))
      throw new RedirectLoopError(`重定向次数过多 (>${outcome.maxRedirects})`);
    if (!isSuccess(outcome)) throw new NoContentError("未知抓取结果");
    console.log(
      `[抓取] HTTP ${outcome.status}, 共 ${outcome.body.length} 字节`,
    );
    articles = extractArticles(outcome.body, outcome.finalUrl);
    if (articles.length === 0) {
      console.log("[抓取] 未解析到文章，使用演示数据。");
      useDemo = true;
      articles = demoArticles();
    } else {
      console.log(`[抓取] 解析到 ${articles.length} 条文章（数据来源: 实时）`);
    }
  } catch (err) {
    useDemo = true;
    const msg = isScraperError(err)
      ? `[${err.code}] ${err.message}`
      : (err as Error).message;
    console.log(`[抓取] 实时请求失败: ${msg}`);
    console.log("[抓取] 回退到演示数据。");
    articles = demoArticles();
  }
  for (const a of articles) store.add(a);
  printArticles(store.all() as NewsArticle[], limit);
  const tag = useDemo ? "demo" : "live";
  saveJson(makeFilename(tag), store.all());
  // 演示生成器遍历
  let n = 0;
  for (const _ of iterateArticles(store.all())) n++;
  console.log(`[元信息] ${store[ORIGIN_TAG]()}（生成器遍历 ${n} 条）`);
}

async function cmdLatest(): Promise<void> {
  const defaultUrl: UrlPattern = runtimeConfig.defaultSource;
  console.log(`[latest] 抓取默认新闻源: ${defaultUrl}`);
  await cmdFetch(defaultUrl, 20);
}

async function cmdSearch(keyword: string): Promise<void> {
  console.log(`[search] 关键词: ${keyword}`);
  let pool: NewsArticle[] = [];
  try {
    const target: UrlPattern = runtimeConfig.defaultSource;
    const fetcher = selectFetcher("https:");
    const outcome = await fetcher.fetch(target, { timeout: 12000 });
    if (isSuccess(outcome)) {
      pool = extractArticles(outcome.body, outcome.finalUrl);
      console.log(`[search] 实时抓取到 ${pool.length} 条候选`);
    } else if (isError(outcome)) {
      console.log(
        `[search] 实时抓取失败: [${outcome.code}] ${outcome.message}，使用演示数据。`,
      );
    } else {
      console.log(`[search] 重定向过多，使用演示数据。`);
    }
  } catch (err) {
    console.log(
      `[search] 实时抓取失败: ${(err as Error).message}，使用演示数据。`,
    );
  }
  if (pool.length === 0) pool = demoArticles();
  const k = keyword.toLowerCase();
  const matched = pool.filter(
    (a) =>
      a.title.toLowerCase().includes(k) || a.summary.toLowerCase().includes(k),
  );
  if (matched.length === 0) {
    console.log(`[search] 未找到与 "${keyword}" 匹配的文章。`);
    return;
  }
  printArticles(matched, 50);
  saveJson(makeFilename("search", keyword), matched);
}

// --- 命令行解析与入口 ---
function printHelp(): void {
  console.log(`
新闻网站爬虫 - 用法:
  node dist/index.js fetch <url> [-l limit]   抓取指定 URL，提取文章
  node dist/index.js latest                   抓取默认新闻源（Hacker News）
  node dist/index.js search <keyword>         在抓取结果中搜索关键词
  node dist/index.js help                     显示本帮助

选项:
  -l, --limit <n>   最多显示的文章数量（默认 20）
`);
}

function parseFlags(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-l" || a === "--limit") {
      flags.limit = args[++i];
    } else if (a.startsWith("--")) {
      flags[a.slice(2)] = args[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional, flags } satisfies ParsedArgs;
}

function toCommand(s: string): Command | null {
  const found = (Object.values(Command) as string[]).includes(s);
  return found ? (s as Command) : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === Command.Help || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = toCommand(argv[0]);
  if (cmd === null) {
    console.log(`未知命令: ${argv[0]}`);
    printHelp();
    return;
  }
  const rest = argv.slice(1);
  const { positional, flags } = parseFlags(rest);
  const limit = parseInt(flags.limit || "20", 10) || 20;
  try {
    switch (cmd) {
      case Command.Fetch: {
        if (!positional[0]) {
          console.log("请提供要抓取的 URL。");
          return;
        }
        await cmdFetch(positional[0], limit);
        break;
      }
      case Command.Latest:
        await cmdLatest();
        break;
      case Command.Search: {
        if (!positional[0]) {
          console.log("请提供搜索关键词。");
          return;
        }
        await cmdSearch(positional[0]);
        break;
      }
      case Command.Help:
        printHelp();
        break;
    }
  } catch (err) {
    if (isScraperError(err)) {
      console.error(`运行出错 [${err.code}]:`, err.message);
    } else {
      console.error("运行出错:", (err as Error).message);
    }
    process.exit(1);
  }
}

main();
