#!/usr/bin/env node
/**
 * 58. 爬取微博热搜 (Enhanced TypeScript Version)
 * ------------------------------------------------------------------
 * 微博热搜爬虫，使用大量高级 TypeScript 特性：
 *   字符串/常规枚举、泛型类(带约束)、抽象类与子类、判别联合、
 *   映射类型、条件类型、模板字面量类型、函数重载、自定义 Error 层级、
 *   getters/setters、生成器/迭代器、Symbol 唯一键、as const、satisfies、
 *   类型守卫、元组与只读元组。
 *   命令：hot、search、history、export、help
 *   仅使用 Node.js 内置模块：fs、path、url、http、https、zlib、crypto。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as crypto from "crypto";

// ===========================================================================
// 枚举
// ===========================================================================

/** 字符串枚举：CLI 命令 */
enum Command {
  Hot = "hot",
  Search = "search",
  History = "history",
  Export = "export",
  Help = "help",
}
/** 字符串枚举：导出内容类型 */
enum ContentType {
  Json = "json",
  Csv = "csv",
  Html = "html",
}
/** 字符串枚举：热搜分类标签 */
enum HotCategory {
  Boil = "沸",
  Hot = "热",
  New = "新",
  Normal = "",
}
/** 常规枚举：错误码 */
enum ErrorCode {
  NetworkError = 1001,
  ParseError = 1002,
  CacheError = 1003,
  InvalidArgument = 1004,
  NoData = 1005,
  Unknown = 9999,
}
/** 常规枚举：热度趋势方向 */
enum TrendDirection {
  Up = "UP",
  Down = "DOWN",
  Same = "SAME",
  NewEntry = "NEW",
}
/** 常规枚举：排名变化 */
enum RankChange {
  Rise = "RISE",
  Fall = "FALL",
  Unchanged = "UNCHANGED",
  NewEntry = "NEW_ENTRY",
}

// ===========================================================================
// 自定义 Error 层级（带 code 属性）
// ===========================================================================

class HotSearchError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "HotSearchError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class NetworkError extends HotSearchError {
  readonly targetUrl: string;
  constructor(targetUrl: string, message: string) {
    super(ErrorCode.NetworkError, message);
    this.name = "NetworkError";
    this.targetUrl = targetUrl;
  }
}

class ParseError extends HotSearchError {
  constructor(message: string) {
    super(ErrorCode.ParseError, message);
    this.name = "ParseError";
  }
}

class CacheError extends HotSearchError {
  constructor(message: string) {
    super(ErrorCode.CacheError, message);
    this.name = "CacheError";
  }
}

// ===========================================================================
// 判别联合：不同条目类型
// ===========================================================================

type ItemKind = "hot" | "new" | "rising" | "ad";

interface BaseItem {
  readonly rank: number;
  keyword: string;
  heat: number;
  link: string;
}

interface HotItem extends BaseItem {
  kind: "hot";
  category: HotCategory | string;
}
interface NewItem extends BaseItem {
  kind: "new";
  firstSeen: string;
}
interface RisingItem extends BaseItem {
  kind: "rising";
  growthRate: number;
}
interface AdItem extends BaseItem {
  kind: "ad";
  sponsor: string;
}

type AnyItem = HotItem | NewItem | RisingItem | AdItem;

// ===========================================================================
// 映射类型、条件类型、模板字面量类型、元组
// ===========================================================================

/** 映射类型：将所有属性变为只读 */
type DeepReadonly<T> = { readonly [K in keyof T]: T[K] };
/** 映射类型：将所有属性变为可选 */
type Partially<T> = { [K in keyof T]?: T[K] };
/** 条件类型：提取非广告条目 */
type NonAdItem<T> = T extends AdItem ? never : T;
/** 条件类型：判断是否为 JSON 原始值 */
type JsonPrimitive<T> = T extends string | number | boolean | null ? T : never;
/** 模板字面量类型：缓存文件名 */
type CacheFileName = `hot-${string}.json`;
/** 模板字面量类型：导出文件名 */
type ExportFileName<F extends string> = `weibo-hot-${string}.${F}`;
/** 模板字面量类型：长选项 */
type LongFlag = `--${string}`;
/** 只读元组：演示数据行 */
type HeatTuple = readonly [keyword: string, heat: number, category: string];
/** 只读元组：快照元数据 */
type SnapshotMeta = readonly [
  fetchedAt: string,
  source: "live" | "demo",
  count: number,
];

// ===========================================================================
// 接口（可选 / 只读 / 索引签名）
// ===========================================================================

interface FetchOptions {
  readonly timeout?: number;
  readonly headers?: Record<string, string>;
}

interface HotSnapshot {
  readonly fetchedAt: string;
  source: "live" | "demo";
  items: AnyItem[];
  [key: string]: unknown; // 索引签名：允许扩展字段
}

interface CacheEntry {
  readonly file: string;
  readonly snap: HotSnapshot;
}

// ===========================================================================
// Symbol 唯一键
// ===========================================================================

const INTERNAL_ID = Symbol("internalId");
const STORE_VERSION = Symbol("storeVersion");
interface WithInternalId {
  [INTERNAL_ID]?: number;
}

// ===========================================================================
// as const 常量配置 + satisfies
// ===========================================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
} as const;

const CONFIG = {
  targetUrl: "https://s.weibo.com/top/summary",
  timeout: 12000,
  maxRedirects: 5,
  defaultLimit: 50,
  maxLimit: 100,
} satisfies {
  targetUrl: string;
  timeout: number;
  maxRedirects: number;
  defaultLimit: number;
  maxLimit: number;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ===========================================================================
// 类型守卫
// ===========================================================================

function isHotItem(item: AnyItem): item is HotItem {
  return item.kind === "hot";
}
function isAdItem(item: AnyItem): item is AdItem {
  return item.kind === "ad";
}
function isNewItem(item: AnyItem): item is NewItem {
  return item.kind === "new";
}
function isRisingItem(item: AnyItem): item is RisingItem {
  return item.kind === "rising";
}
function isCommand(s: string): s is Command {
  return (Object.values(Command) as string[]).includes(s);
}
function isContentType(s: string): s is ContentType {
  return (Object.values(ContentType) as string[]).includes(s);
}

// ===========================================================================
// HTTP 助手
// ===========================================================================

type FetchResult = { status: number; body: string; finalUrl: string };

function fetchText(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const timeout = opts.timeout ?? CONFIG.timeout;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Cookie: "SUB=_2AkMS-fake_demo_session",
    ...opts.headers,
  };
  return new Promise<FetchResult>((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new NetworkError(target, `无效 URL: ${target}`));
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
            if (redirects >= CONFIG.maxRedirects) {
              reject(new NetworkError(target, "重定向次数过多"));
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
            reject(new NetworkError(target, err.message)),
          );
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new NetworkError(target, `请求超时 (${timeout}ms)`)),
      );
      req.on("error", (err: Error) =>
        reject(new NetworkError(target, err.message)),
      );
      req.end();
    };
    attempt(currentUrl);
  });
}

// ===========================================================================
// HTML 解析
// ===========================================================================

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
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

function parseHeat(s: string): number {
  const trimmed = s.trim();
  if (trimmed.includes("万")) return Math.round(parseFloat(trimmed) * 10000);
  return parseInt(trimmed.replace(/[^\d]/g, ""), 10) || 0;
}

function categoryToKind(cat: string): { kind: ItemKind; category: string } {
  if (cat === HotCategory.Boil)
    return { kind: "hot", category: HotCategory.Boil };
  if (cat === HotCategory.New)
    return { kind: "new", category: HotCategory.New };
  if (cat === HotCategory.Hot)
    return { kind: "hot", category: HotCategory.Hot };
  return { kind: "hot", category: cat };
}

function parseHotItems(html: string, baseUrl: string): AnyItem[] {
  const out: AnyItem[] = [];
  const re = /<a\s+href=["'](\/weibo\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let rank = 0;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const keyword = stripTags(m[2]);
    if (!keyword || keyword.length < 1) continue;
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 300);
    const heatMatch = /<span[^>]*>([\d.万]+)</i.exec(tail);
    const heat = heatMatch ? parseHeat(heatMatch[1]) : 0;
    const catMatch =
      /<span[^>]*class=["'][^"']*(?:hot|new|boil|fei)[^"']*["'][^>]*>([\u4e00-\u9fa5])</i.exec(
        tail,
      );
    const cat = catMatch ? catMatch[1] : HotCategory.Hot;
    const { kind, category } = categoryToKind(cat);
    rank++;
    const base = { rank, keyword, heat, link: url.resolve(baseUrl, href) };
    if (kind === "new") {
      out.push({
        ...base,
        kind: "new",
        firstSeen: new Date().toISOString(),
      } as NewItem);
    } else {
      out.push({ ...base, kind: "hot", category } as HotItem);
    }
  }
  return out;
}

// ===========================================================================
// 抽象类与具体子类
// ===========================================================================

abstract class AbstractHotSource {
  abstract readonly name: string;
  abstract fetch(): Promise<AnyItem[]>;
  async fetchSnapshot(): Promise<HotSnapshot> {
    const items = await this.fetch();
    return {
      fetchedAt: new Date().toISOString(),
      source: this.name === "mock" ? "demo" : "live",
      items,
    };
  }
  protected log(msg: string): void {
    console.log(`[${this.name}] ${msg}`);
  }
}

class WeiboSource extends AbstractHotSource {
  readonly name = "weibo";
  constructor(private readonly targetUrl: string = CONFIG.targetUrl) {
    super();
  }
  async fetch(): Promise<AnyItem[]> {
    this.log(`抓取: ${this.targetUrl}`);
    const res = await fetchText(this.targetUrl, { timeout: CONFIG.timeout });
    if (res.status !== 200)
      throw new NetworkError(this.targetUrl, `HTTP ${res.status}`);
    const items = parseHotItems(res.body, res.finalUrl);
    if (items.length === 0) throw new ParseError("未解析到热搜条目");
    this.log(`实时抓取成功，共 ${items.length} 条`);
    return items;
  }
}

class MockSource extends AbstractHotSource {
  readonly name = "mock";
  async fetch(): Promise<AnyItem[]> {
    this.log("使用演示数据。");
    return demoHotItems();
  }
}

// ===========================================================================
// 模拟热搜数据
// ===========================================================================

function demoHotItems(): AnyItem[] {
  const B = HotCategory.Boil,
    H = HotCategory.Hot,
    N = HotCategory.New,
    Z = HotCategory.Normal;
  const data: readonly HeatTuple[] = [
    ["#新春档票房破纪录#", 4928103, B],
    ["#国产AI大模型新突破#", 4382102, B],
    ["#冬奥会金牌榜更新#", 3920411, H],
    ["#高校毕业生就业新政策#", 3502194, H],
    ["#城市夜经济火热#", 3120485, H],
    ["#新能源汽车出口增长#", 2891043, H],
    ["#国产电影获国际大奖#", 2650412, H],
    ["#astronaut太空授课#", 2401852, N],
    ["#高校招生改革方案#", 2210593, N],
    ["#城市马拉松开赛#", 2050184, N],
    ["#5G网络覆盖扩大#", 1930472, Z],
    ["#数字人民币试点#", 1810293, Z],
    ["#夏季高温预警#", 1720485, Z],
    ["#篮球联赛总决赛#", 1650284, Z],
    ["#非遗文化展#", 1520184, Z],
    ["#量子计算新进展#", 1430291, Z],
    ["#国产芯片量产#", 1340183, Z],
    ["#航母编队演练#", 1280472, Z],
    ["#高考成绩查询#", 1210284, Z],
    ["#城市轨道交通开通#", 1150183, Z],
    ["#科技创新大赛#", 1080472, Z],
    ["#国际电影节开幕#", 1020183, Z],
    ["#乡村振兴典型案例#", 960472, Z],
    ["#环保新规实施#", 910283, Z],
    ["#全国羽毛球锦标赛#", 860472, Z],
    ["#博物馆夜场开放#", 810283, Z],
    ["#智慧城市建设#", 760472, Z],
    ["#冰雪运动热潮#", 710283, Z],
    ["#老旧小区改造#", 660472, Z],
    ["#中医药走向世界#", 610283, Z],
    ["#青少年科技展#", 560472, Z],
    ["#新一代显示技术#", 510283, Z],
    ["#国产飞机首飞#", 470472, Z],
    ["#深空探测新进展#", 430283, Z],
    ["#海洋经济新政策#", 390472, Z],
    ["#机器人产业大会#", 350283, Z],
    ["#绿色能源峰会#", 310472, Z],
    ["#智能网联汽车#", 280283, Z],
    ["#职业教育改革#", 250472, Z],
    ["#国产操作系统发布#", 220283, Z],
    ["#量子通信实验#", 190472, Z],
    ["#文物保护新技术#", 160283, Z],
    ["#绿色建筑标准#", 130472, Z],
    ["#跨境电商新规#", 110283, Z],
    ["#智能制造示范#", 95000, Z],
    ["#乡村旅游精品线路#", 82000, Z],
    ["#生物育种新突破#", 71000, Z],
    ["#航天员出舱活动#", 60000, Z],
    ["#碳达峰行动方案#", 50000, Z],
    ["#智慧医疗落地#", 42000, Z],
  ] as const;

  return data.map(([keyword, heat, category], i): AnyItem => {
    const { kind, category: cat } = categoryToKind(category);
    const base = {
      rank: i + 1,
      keyword,
      heat,
      link: `https://s.weibo.com/weibo?q=${encodeURIComponent(keyword)}`,
    };
    if (kind === "new")
      return { ...base, kind: "new", firstSeen: new Date().toISOString() };
    return { ...base, kind: "hot", category: cat };
  });
}

// ===========================================================================
// 泛型存储类（带约束、getter/setter、生成器、Symbol 键）
// ===========================================================================

class HotSearchStore<T extends AnyItem> {
  private _items: T[] = [];
  private _idCounter = 0;
  [STORE_VERSION]: number = 1;

  constructor(items?: T[]) {
    if (items) this.items = items;
  }

  get count(): number {
    return this._items.length;
  }
  get items(): readonly T[] {
    return this._items;
  }
  set items(value: T[]) {
    this._items = value.slice();
    for (const item of this._items)
      (item as T & WithInternalId)[INTERNAL_ID] = ++this._idCounter;
  }

  add(item: T): void {
    (item as T & WithInternalId)[INTERNAL_ID] = ++this._idCounter;
    this._items.push(item);
  }

  search(keyword: string): T[] {
    const k = keyword.toLowerCase();
    return this._items.filter((it) => it.keyword.toLowerCase().includes(k));
  }

  /** 过滤非广告条目（使用条件类型 NonAdItem） */
  filterNonAd(): NonAdItem<T>[] {
    return this._items.filter((it) => !isAdItem(it)) as NonAdItem<T>[];
  }

  /** 生成器：正序迭代 */
  *[Symbol.iterator](): Iterator<T> {
    for (const item of this._items) yield item;
  }

  /** 生成器：按热度降序 */
  *byHeat(): Generator<T, void, unknown> {
    const sorted = [...this._items].sort((a, b) => b.heat - a.heat);
    for (const item of sorted) yield item;
  }

  averageHeat(): number {
    if (this._items.length === 0) return 0;
    return Math.round(
      this._items.reduce((acc, it) => acc + it.heat, 0) / this._items.length,
    );
  }

  trendOf(item: T): TrendDirection {
    const avg = this.averageHeat();
    if (item.heat > avg * 1.5) return TrendDirection.Up;
    if (item.heat < avg * 0.5) return TrendDirection.Down;
    return TrendDirection.Same;
  }

  /** 快照元数据（只读元组） */
  meta(source: "live" | "demo"): SnapshotMeta {
    return [new Date().toISOString(), source, this._items.length] as const;
  }
}

/** 排名比较（使用 RankChange 枚举） */
function compareRank(prevRank: number, currRank: number): RankChange {
  if (currRank < prevRank) return RankChange.Rise;
  if (currRank > prevRank) return RankChange.Fall;
  return RankChange.Unchanged;
}

// ===========================================================================
// 缓存（本地 JSON 文件）
// ===========================================================================

const CACHE_DIR = path.resolve(process.cwd(), "output", "weibo-cache");

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function snapshotHash(snap: HotSnapshot): string {
  return crypto
    .createHash("md5")
    .update(JSON.stringify(snap.items))
    .digest("hex")
    .slice(0, 8);
}

function saveCache(snap: HotSnapshot): string {
  ensureCacheDir();
  const fileName: CacheFileName = `hot-${snap.fetchedAt.replace(/[:.]/g, "-")}.json`;
  const file = path.join(CACHE_DIR, fileName);
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), "utf8");
  return file;
}

function listCache(): string[] {
  ensureCacheDir();
  return fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("hot-") && f.endsWith(".json"))
    .sort()
    .reverse();
}

function loadCache(file: string): HotSnapshot | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(CACHE_DIR, file), "utf8"),
    ) as HotSnapshot;
  } catch {
    return null;
  }
}

// ===========================================================================
// 颜色与展示
// ===========================================================================

function colorCategory(cat: string): string {
  if (cat === HotCategory.Boil) return C.red + cat + C.reset;
  if (cat === HotCategory.Hot) return C.yellow + cat + C.reset;
  if (cat === HotCategory.New) return C.green + cat + C.reset;
  return C.gray + cat + C.reset;
}

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}

function fmtHeat(h: number): string {
  if (h >= 10000) return (h / 10000).toFixed(1) + "万";
  return h.toString();
}

function itemLabel(item: AnyItem): string {
  switch (item.kind) {
    case "hot":
      return item.category || HotCategory.Hot;
    case "new":
      return HotCategory.New;
    case "rising":
      return "↑";
    case "ad":
      return "广";
  }
}

function printHot(snap: HotSnapshot, limit: number): void {
  const src = snap.source === "live" ? "实时" : "演示";
  const hash = snapshotHash(snap);
  console.log("");
  console.log(
    `  ${C.bold}微博热搜榜${C.reset}  数据源: ${src}  抓取时间: ${snap.fetchedAt}  hash: ${hash}`,
  );
  console.log("  " + "─".repeat(60));
  const widths: readonly number[] = [6, 8, 28, 14] as const;
  const header: readonly string[] = ["排名", "标签", "关键词", "热度"] as const;
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(60));
  const store = new HotSearchStore<AnyItem>(snap.items);
  for (const it of store) {
    if (it.rank > limit) break;
    const cat = colorCategory(itemLabel(it));
    const row = [
      `#${it.rank}`,
      cat,
      it.keyword,
      C.magenta + fmtHeat(it.heat) + C.reset,
    ];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

// ===========================================================================
// 命令实现（函数重载）
// ===========================================================================

async function fetchHot(): Promise<HotSnapshot>;
async function fetchHot(source: "live" | "demo"): Promise<HotSnapshot>;
async function fetchHot(source?: "live" | "demo"): Promise<HotSnapshot> {
  const live = new WeiboSource();
  const mock = new MockSource();
  if (source === "demo") return mock.fetchSnapshot();
  try {
    return await live.fetchSnapshot();
  } catch (err) {
    const e =
      err instanceof HotSearchError
        ? err
        : new HotSearchError(ErrorCode.Unknown, (err as Error).message);
    console.log(`[hot] 实时抓取失败: ${e.message} (code: ${e.code})`);
    console.log("[hot] 回退到演示数据。");
    return mock.fetchSnapshot();
  }
}

async function cmdHot(limit: number): Promise<void> {
  const snap = await fetchHot();
  printHot(snap, limit);
  const file = saveCache(snap);
  console.log(`[hot] 已缓存到: ${file}`);
}

async function cmdSearch(keyword: string): Promise<void> {
  console.log(`[search] 关键词: ${keyword}`);
  const snap = await fetchHot();
  const store = new HotSearchStore<AnyItem>(snap.items);
  const matched = store.search(keyword);
  if (matched.length === 0) {
    console.log(`[search] 未找到包含 "${keyword}" 的热搜。`);
    return;
  }
  console.log(`[search] 命中 ${matched.length} 条：`);
  printHot({ ...snap, items: matched }, matched.length);
}

function cmdHistory(): void {
  const files = listCache();
  if (files.length === 0) {
    console.log("[history] 暂无历史缓存。请先运行 hot 命令。");
    return;
  }
  console.log(`[history] 共 ${files.length} 条历史缓存：`);
  for (const f of files.slice(0, 20)) {
    const snap = loadCache(f);
    if (snap)
      console.log(
        `  ${f}  ${snap.source === "live" ? "实时" : "演示"}  ${snap.items.length}条  ${snap.fetchedAt}`,
      );
  }
  if (files.length > 20) console.log(`  ... 还有 ${files.length - 20} 条`);
}

function cmdExport(format: ContentType): void {
  const files = listCache();
  if (files.length === 0) {
    console.log("[export] 暂无缓存可导出。请先运行 hot 命令。");
    return;
  }
  const snap = loadCache(files[0]);
  if (!snap) {
    console.log("[export] 读取缓存失败。");
    return;
  }
  const outDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  let file: string;
  let content: string;
  if (format === ContentType.Json) {
    const fileName: ExportFileName<"json"> = `weibo-hot-${Date.now()}.json`;
    file = path.join(outDir, fileName);
    content = JSON.stringify(snap, null, 2);
  } else {
    const fileName: ExportFileName<"csv"> = `weibo-hot-${Date.now()}.csv`;
    file = path.join(outDir, fileName);
    const rows: string[] = ["rank,keyword,heat,category,link"];
    const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    for (const it of snap.items) {
      const cat = isHotItem(it) ? it.category : itemLabel(it);
      rows.push(
        [
          it.rank,
          esc(it.keyword),
          it.heat,
          esc(String(cat)),
          esc(it.link),
        ].join(","),
      );
    }
    content = "\ufeff" + rows.join("\n");
  }
  fs.writeFileSync(file, content, "utf8");
  console.log(
    `[export] 已导出 ${format.toUpperCase()}: ${file}  (共 ${snap.items.length} 条)`,
  );
}

// ===========================================================================
// 入口
// ===========================================================================

function printHelp(): void {
  console.log(`
微博热搜爬虫 - 用法:
  node dist/index.js hot [-l limit]                 抓取当前热搜（默认 ${CONFIG.defaultLimit} 条）
  node dist/index.js search <keyword>               在热搜中搜索关键词
  node dist/index.js history                         查看本地缓存历史
  node dist/index.js export [-f json|csv]           导出最近一次抓取结果
  node dist/index.js help                            显示本帮助

说明:
  - 优先抓取 s.weibo.com/top/summary；失败时回退到演示数据。
  - 抓取结果按时间戳缓存到 ./output/weibo-cache/。
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
    if (a === "-l" || a === "--limit") flags.limit = args[++i];
    else if (a === "-f" || a === "--format") flags.format = args[++i];
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
    if (!isCommand(cmd)) {
      console.log(`未知命令: ${cmd}`);
      printHelp();
      return;
    }
    switch (cmd) {
      case Command.Hot: {
        const limit =
          parseInt(flags.limit || String(CONFIG.defaultLimit), 10) ||
          CONFIG.defaultLimit;
        await cmdHot(Math.min(Math.max(limit, 1), CONFIG.maxLimit));
        break;
      }
      case Command.Search:
        if (!positional[0]) {
          console.log("请提供搜索关键词。");
          return;
        }
        await cmdSearch(positional[0]);
        break;
      case Command.History:
        cmdHistory();
        break;
      case Command.Export: {
        const fmt =
          flags.format &&
          isContentType(flags.format) &&
          flags.format === ContentType.Csv
            ? ContentType.Csv
            : ContentType.Json;
        cmdExport(fmt);
        break;
      }
      case Command.Help:
        printHelp();
        break;
    }
  } catch (err) {
    const e =
      err instanceof HotSearchError
        ? err
        : new HotSearchError(ErrorCode.Unknown, (err as Error).message);
    console.error("运行出错:", e.message, `(code: ${e.code})`);
    process.exit(1);
  }
}

main();
