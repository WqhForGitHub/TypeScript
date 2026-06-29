#!/usr/bin/env node
/**
 * 53. 爬取股票行情 (Enhanced TypeScript Edition)
 * ------------------------------------------------------------------
 * 股票行情爬虫，使用大量 TypeScript 高级特性：
 *   字符串/普通枚举、判别联合、映射/条件类型、模板字面量类型、
 *   泛型类、抽象类、函数重载、自定义 Error 层级、Symbol、
 *   as const、satisfies、Getter/Setter、Generator、类型守卫、元组。
 *
 * 仅使用 Node.js 内置模块：http、https、url、crypto、zlib。
 */

import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as crypto from "crypto";
import * as zlib from "zlib";

// ===========================================================================
// 1. 枚举
// ===========================================================================

enum Command {
  Quote = "quote",
  Batch = "batch",
  Watch = "watch",
  History = "history",
  Help = "help",
}
enum Market {
  SH = "sh",
  SZ = "sz",
  HK = "hk",
  US = "us",
}
enum Trend {
  Up = 1,
  Down = -1,
  Flat = 0,
}
enum ErrorCode {
  NetworkError = 1001,
  ParseError = 1002,
  TimeoutError = 1003,
  InvalidCode = 1004,
  UnknownCommand = 1005,
  RateLimited = 1006,
}

// ===========================================================================
// 2. 模板字面量类型 & 元组类型
// ===========================================================================

type StockCode = `${Market}${string}`;
type SinaVarName = `hq_str_${string}`;
type QuoteTuple = readonly [code: string, price: number, change: number];
type SummaryRow = readonly [string, string, number, Trend];

// ===========================================================================
// 3. 接口（可选 / readonly / 索引签名）
// ===========================================================================

interface Quote {
  readonly code: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  change: number;
  changePct: number;
  timestamp: number;
  readonly source: "live" | "demo";
  [extra: string]: string | number;
}

interface HistoryDay {
  readonly date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface FetchOptions {
  timeout?: number;
  headers?: Readonly<Record<string, string>>;
}

// ===========================================================================
// 4. 判别联合
// ===========================================================================

interface RealtimeQuote extends Quote {
  type: "realtime";
  bidPrice: number;
  askPrice: number;
}
interface HistoricalQuote {
  type: "historical";
  code: string;
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}
interface IndexQuote {
  type: "index";
  code: string;
  name: string;
  value: number;
  change: number;
  changePct: number;
  timestamp: number;
}
type AnyQuote = RealtimeQuote | HistoricalQuote | IndexQuote;

// ===========================================================================
// 5. 映射类型 & 条件类型
// ===========================================================================

type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
type NumericFields<T> = {
  [K in keyof T as T[K] extends number ? K : never]: T[K];
};
type QuoteTypeName<T> = T extends { type: infer U } ? U : never;
type FrozenQuote = DeepReadonly<Quote>;
type QuoteNumbers = NumericFields<Quote>;

// ===========================================================================
// 6. Symbol & as const
// ===========================================================================

const SOURCE_TAG = Symbol("source-tag");
const VERSION_TAG = Symbol("version-tag");

const COLOR_CODES = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const;
type ColorName = keyof typeof COLOR_CODES;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const KNOWN_NAMES: Readonly<Record<string, string>> = {
  sh600519: "贵州茅台",
  sh000001: "上证指数",
  sz000001: "平安银行",
  sz000002: "万科A",
  sh601318: "中国平安",
  sh600036: "招商银行",
  sz000651: "格力电器",
  sh600276: "恒瑞医药",
  sz300750: "宁德时代",
  sh601899: "紫金矿业",
  sh601398: "工商银行",
  sz002594: "比亚迪",
};

// ===========================================================================
// 7. 自定义 Error 层级（带 code 属性）
// ===========================================================================

abstract class QuoteError extends Error {
  abstract readonly code: ErrorCode;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toJSON(): { name: string; code: ErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}
class NetworkError extends QuoteError {
  readonly code = ErrorCode.NetworkError;
}
class ParseError extends QuoteError {
  readonly code = ErrorCode.ParseError;
}
class TimeoutError extends QuoteError {
  readonly code = ErrorCode.TimeoutError;
}
class InvalidCodeError extends QuoteError {
  readonly code = ErrorCode.InvalidCode;
}
class UnknownCommandError extends QuoteError {
  readonly code = ErrorCode.UnknownCommand;
}

// ===========================================================================
// 8. 类型守卫
// ===========================================================================

function isRealtime(q: AnyQuote): q is RealtimeQuote {
  return q.type === "realtime";
}
function isHistorical(q: AnyQuote): q is HistoricalQuote {
  return q.type === "historical";
}
function isIndex(q: AnyQuote): q is IndexQuote {
  return q.type === "index";
}
function isStockCode(s: string): s is StockCode {
  return /^(sh|sz|hk|us)\d/.test(s);
}

function toTrend(change: number): Trend {
  if (change > 0) return Trend.Up;
  if (change < 0) return Trend.Down;
  return Trend.Flat;
}

// ===========================================================================
// 9. HTTP 助手（支持 gzip / 超时 / 重定向）
// ===========================================================================

function fetchText(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<{ status: number; body: string; finalUrl: string }> {
  const timeout = opts.timeout ?? 10000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate",
    Referer: "https://finance.sina.com.cn/",
    ...(opts.headers ?? {}),
  };
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new NetworkError(`无效 URL: ${target}`));
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
              reject(new NetworkError("重定向次数过多"));
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
            reject(new NetworkError(err.message)),
          );
        },
      );
      req.setTimeout(timeout, () => {
        req.destroy(new TimeoutError(`请求超时 (${timeout}ms)`));
      });
      req.on("error", (err: Error) => reject(new NetworkError(err.message)));
      req.end();
    };
    attempt(currentUrl);
  });
}

// ===========================================================================
// 10. 配置类（Getter / Setter）
// ===========================================================================

class ScraperConfig {
  private _timeout: number = 10000;
  private _maxRedirects: number = 5;
  private _retryCount: number = 0;
  static readonly MIN_TIMEOUT = 1000;
  static readonly MAX_TIMEOUT = 60000;

  get timeout(): number {
    return this._timeout;
  }
  set timeout(v: number) {
    if (v < ScraperConfig.MIN_TIMEOUT || v > ScraperConfig.MAX_TIMEOUT)
      throw new RangeError(
        `timeout 必须在 [${ScraperConfig.MIN_TIMEOUT}, ${ScraperConfig.MAX_TIMEOUT}] 之间`,
      );
    this._timeout = v;
  }
  get maxRedirects(): number {
    return this._maxRedirects;
  }
  set maxRedirects(v: number) {
    this._maxRedirects = Math.max(0, Math.floor(v));
  }
  get retryCount(): number {
    return this._retryCount;
  }
  set retryCount(v: number) {
    this._retryCount = Math.max(0, Math.min(v, 5));
  }
}

// ===========================================================================
// 11. 哈希工具
// ===========================================================================

function hashStr(s: string): number {
  return crypto.createHash("md5").update(s, "utf8").digest().readUInt32BE(0);
}

// ===========================================================================
// 12. 抽象行情源 + 具体实现（Sina / Mock）
// ===========================================================================

abstract class AbstractQuoteSource {
  abstract readonly name: string;
  abstract fetch(code: string): Promise<Quote | null>;

  async fetchMany(codes: string[]): Promise<Quote[]> {
    const out: Quote[] = [];
    for (const c of codes) {
      const q = await this.fetch(c);
      if (q) out.push(q);
    }
    return out;
  }

  async *fetchStream(codes: string[]): AsyncGenerator<Quote, void, unknown> {
    for (const c of codes) {
      const q = await this.fetch(c);
      if (q) yield q;
    }
  }
}

class SinaSource extends AbstractQuoteSource {
  readonly name = "Sina";
  constructor(private config: ScraperConfig = new ScraperConfig()) {
    super();
  }

  async fetch(code: string): Promise<Quote | null> {
    const u = `https://hq.sinajs.cn/list=${code}`;
    try {
      const res = await fetchText(u, { timeout: this.config.timeout });
      if (res.status !== 200) return null;
      const m = /="([^"]*)"/.exec(res.body);
      if (!m) return null;
      const parts = m[1].split(",");
      if (parts.length < 32) return null;
      const name = parts[0] || KNOWN_NAMES[code] || code;
      const open = parseFloat(parts[1]) || 0;
      const prevClose = parseFloat(parts[2]) || 0;
      const price = parseFloat(parts[3]) || 0;
      const high = parseFloat(parts[4]) || 0;
      const low = parseFloat(parts[5]) || 0;
      const volume = (parseFloat(parts[8]) || 0) / 100;
      const amount = parseFloat(parts[9]) || 0;
      const bidPrice = parseFloat(parts[10]) || 0;
      const askPrice = parseFloat(parts[12]) || 0;
      if (price <= 0) return null;
      const change = +(price - prevClose).toFixed(2);
      const changePct =
        prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : 0;
      const quote: RealtimeQuote = {
        type: "realtime",
        code,
        name,
        price,
        prevClose,
        open,
        high,
        low,
        volume,
        amount,
        change,
        changePct,
        timestamp: Date.now(),
        source: "live",
        bidPrice,
        askPrice,
      };
      return quote;
    } catch (err) {
      console.log(`[SinaSource] ${code} 失败: ${(err as Error).message}`);
      return null;
    }
  }
}

class MockSource extends AbstractQuoteSource {
  readonly name = "Mock";
  async fetch(code: string): Promise<Quote | null> {
    return mockQuote(code);
  }
}

// ===========================================================================
// 13. 泛型行情存储（带约束）
// ===========================================================================

class QuoteStore<T extends Quote> {
  private items = new Map<string, T>();
  private readonly createdAt: number = Date.now();

  [SOURCE_TAG]: string = "quote-store";
  static readonly [VERSION_TAG]: number = 1;

  add(q: T): void {
    this.items.set(q.code, q);
  }
  get(code: string): T | undefined {
    return this.items.get(code);
  }
  get size(): number {
    return this.items.size;
  }
  get age(): number {
    return Date.now() - this.createdAt;
  }

  *[Symbol.iterator](): Generator<T, void, unknown> {
    for (const item of this.items.values()) yield item;
  }

  filter(pred: (q: T) => boolean): T[];
  filter(pred: (q: T) => boolean, limit: number): T[];
  filter(pred: (q: T) => boolean, limit?: number): T[] {
    const out: T[] = [];
    for (const q of this) {
      if (pred(q)) {
        out.push(q);
        if (limit !== undefined && out.length >= limit) break;
      }
    }
    return out;
  }

  clear(): void {
    this.items.clear();
  }
  toArray(): T[] {
    return [...this];
  }
}

// ===========================================================================
// 14. 模拟数据生成
// ===========================================================================

function mockQuote(code: string): Quote {
  const seed = hashStr(code);
  const name = KNOWN_NAMES[code] || `模拟股票(${code})`;
  const prevClose = 5 + (seed % 200);
  const drift = ((seed % 1000) / 1000 - 0.5) * 0.1;
  const price = +(prevClose * (1 + drift)).toFixed(2);
  const open = +(prevClose * (1 + ((seed >> 3) % 100) / 1000 - 0.05)).toFixed(
    2,
  );
  const high = +(Math.max(price, open) * (1 + (seed % 30) / 1000)).toFixed(2);
  const low = +(Math.min(price, open) * (1 - (seed % 30) / 1000)).toFixed(2);
  const volume = (seed % 1000000) + 1000;
  const amount = +(price * volume * 100 * (0.95 + (seed % 100) / 2000)).toFixed(
    0,
  );
  const change = +(price - prevClose).toFixed(2);
  const changePct = +((change / prevClose) * 100).toFixed(2);
  return {
    code,
    name,
    price,
    prevClose,
    open,
    high,
    low,
    volume,
    amount,
    change,
    changePct,
    timestamp: Date.now(),
    source: "demo",
  };
}

function mockHistory(code: string, days: number): HistoryDay[] {
  const seed = hashStr(code);
  let price = 5 + (seed % 200);
  const out: HistoryDay[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const s = hashStr(`${code}-${d.toDateString()}`) ^ seed;
    const change = (s % 1000) / 1000 - 0.5;
    const open = +(price * (1 + change * 0.05)).toFixed(2);
    const close = +(price * (1 + change * 0.1)).toFixed(2);
    const high = +(Math.max(open, close) * (1 + (s % 20) / 1000)).toFixed(2);
    const low = +(Math.min(open, close) * (1 - (s % 20) / 1000)).toFixed(2);
    const volume = (s % 1000000) + 1000;
    out.push({
      date: d.toISOString().slice(0, 10),
      open,
      close,
      high,
      low,
      volume,
    });
    price = close;
  }
  return out;
}

// ===========================================================================
// 15. 颜色 & 渲染
// ===========================================================================

function color(s: string, name: ColorName): string {
  return COLOR_CODES[name] + s + COLOR_CODES.reset;
}
function colorByChange(s: string, change: number): string {
  const trend = toTrend(change);
  if (trend === Trend.Up) return color(s, "red");
  if (trend === Trend.Down) return color(s, "green");
  return s;
}
function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}
function fmtVol(v: number): string {
  return v >= 10000 ? (v / 10000).toFixed(2) + "万手" : v.toFixed(0) + "手";
}
function fmtAmount(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(2) + "万";
  return v.toFixed(0);
}

function printQuote(q: Quote): void {
  const src = q.source === "live" ? "实时" : "演示";
  console.log("");
  console.log(`  ${color(q.name, "bold")} (${q.code})   数据源: ${src}`);
  console.log("  " + "─".repeat(56));
  const priceStr = colorByChange(q.price.toFixed(2), q.change);
  const sign = q.change >= 0 ? "+" : "";
  const changeStr = colorByChange(
    `${sign}${q.change.toFixed(2)}  (${sign}${q.changePct.toFixed(2)}%)`,
    q.change,
  );
  console.log(`  现价:     ${priceStr}`);
  console.log(`  涨跌:     ${changeStr}`);
  console.log(
    `  今开:     ${q.open.toFixed(2)}    昨收: ${q.prevClose.toFixed(2)}`,
  );
  console.log(`  最高:     ${q.high.toFixed(2)}    最低: ${q.low.toFixed(2)}`);
  console.log(
    `  成交量:   ${fmtVol(q.volume)}    成交额: ${fmtAmount(q.amount)}元`,
  );
  console.log(`  时间:     ${new Date(q.timestamp).toLocaleString()}`);
  console.log("");
}

function printBatchTable(qs: Quote[]): void {
  console.log("");
  console.log(`  ${color("批量行情", "bold")}  (共 ${qs.length} 只)`);
  console.log("  " + "─".repeat(78));
  const widths: readonly number[] = [10, 12, 12, 14, 14, 12];
  const header: readonly string[] = [
    "代码",
    "名称",
    "现价",
    "涨跌幅",
    "成交额",
    "数据源",
  ];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(78));
  for (const q of qs) {
    const price = colorByChange(q.price.toFixed(2), q.change);
    const pct = colorByChange(
      `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`,
      q.change,
    );
    const row = [
      q.code,
      q.name,
      price,
      pct,
      fmtAmount(q.amount),
      q.source === "live" ? "实时" : "演示",
    ];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

function printHistory(code: string, days: HistoryDay[]): void {
  console.log("");
  console.log(
    `  ${color("历史行情", "bold")}  ${code}  (近 ${days.length} 天)`,
  );
  console.log("  " + "─".repeat(60));
  const widths: readonly number[] = [14, 10, 10, 10, 10, 12];
  const header: readonly string[] = [
    "日期",
    "开盘",
    "收盘",
    "最高",
    "最低",
    "成交量",
  ];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(60));
  for (const d of days) {
    const close = colorByChange(d.close.toFixed(2), d.close - d.open);
    const row = [
      d.date,
      d.open.toFixed(2),
      close,
      d.high.toFixed(2),
      d.low.toFixed(2),
      fmtVol(d.volume),
    ];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

// ===========================================================================
// 16. 判别联合工具函数（演示类型守卫）
// ===========================================================================

function toHistoricalQuote(code: string, day: HistoryDay): HistoricalQuote {
  return {
    type: "historical",
    code,
    date: day.date,
    open: day.open,
    close: day.close,
    high: day.high,
    low: day.low,
    volume: day.volume,
  };
}
function toIndexQuote(q: Quote): IndexQuote {
  return {
    type: "index",
    code: q.code,
    name: q.name,
    value: q.price,
    change: q.change,
    changePct: q.changePct,
    timestamp: q.timestamp,
  };
}
function describeQuote(q: AnyQuote): string {
  if (isRealtime(q))
    return `${q.name} 实时 现价${q.price} 买${q.bidPrice}/卖${q.askPrice}`;
  if (isHistorical(q)) return `${q.code} 历史 ${q.date} 收盘${q.close}`;
  return `${q.name} 指数 ${q.value} (${q.changePct >= 0 ? "+" : ""}${q.changePct}%)`;
}

// ===========================================================================
// 17. 命令实现
// ===========================================================================

async function cmdQuote(
  rawCode: string,
  store?: QuoteStore<Quote>,
): Promise<void> {
  const code = parseCode(rawCode);
  console.log(`[quote] ${code}`);
  const source = new SinaSource();
  const q = await source.fetch(code);
  if (q) {
    console.log("[quote] 使用实时数据。");
    printQuote(q);
    if (store) store.add(q);
  } else {
    console.log("[quote] 实时数据不可用，使用演示数据。");
    printQuote(mockQuote(code));
  }
}

async function cmdBatch(
  rawCodes: string[],
  store: QuoteStore<Quote>,
): Promise<void> {
  console.log(`[batch] ${rawCodes.length} 只`);
  const codes = rawCodes.map((c) => parseCode(c));
  const sina = new SinaSource();
  const live = await sina.fetchMany(codes);
  const liveMap = new Map(live.map((q) => [q.code, q] as const));
  const out: Quote[] = [];
  for (const c of codes) {
    const found = liveMap.get(c);
    if (found) {
      out.push(found);
      store.add(found);
    } else {
      console.log(`[batch] ${c} 实时失败，使用演示数据。`);
      out.push(mockQuote(c));
    }
  }
  printBatchTable(out);
}

async function cmdWatch(rawCode: string, interval: number): Promise<void> {
  const code = parseCode(rawCode);
  console.log(`[watch] ${code}  间隔 ${interval}s  (Ctrl+C 退出)`);
  const sina = new SinaSource();
  const mock = new MockSource();
  let round = 0;
  const tick = async (): Promise<void> => {
    round++;
    console.log(`\n--- 第 ${round} 轮  ${new Date().toLocaleTimeString()} ---`);
    const q = await sina.fetch(code);
    if (q) printQuote(q);
    else {
      const mq = await mock.fetch(code);
      if (mq) printQuote(mq);
    }
  };
  await tick();
  setInterval(tick, interval * 1000);
}

async function cmdHistory(rawCode: string, days: number): Promise<void> {
  const code = parseCode(rawCode);
  console.log(`[history] ${code}  近 ${days} 天`);
  console.log("[history] 使用模拟历史数据（仅用于演示技术）.");
  const history = mockHistory(code, days);
  printHistory(code, history);
  const hq: HistoricalQuote = toHistoricalQuote(code, history[0]);
  console.log(`  [调试] ${describeQuote(hq)}`);
}

// ===========================================================================
// 18. 函数重载 & satisfies
// ===========================================================================

const COMMAND_ALIASES = {
  q: Command.Quote,
  qt: Command.Quote,
  b: Command.Batch,
  w: Command.Watch,
  hist: Command.History,
  h: Command.Help,
  "?": Command.Help,
} satisfies Record<string, Command>;

function resolveCommand(input: string): Command | null {
  const lower = input.toLowerCase();
  const allCommands = Object.values(Command) as readonly string[];
  if (allCommands.includes(lower)) return lower as Command;
  if (lower in COMMAND_ALIASES)
    return COMMAND_ALIASES[lower as keyof typeof COMMAND_ALIASES];
  return null;
}

/** 函数重载：解析股票代码 */
function parseCode(input: string): StockCode;
function parseCode(input: string, strict: true): StockCode;
function parseCode(input: string, strict: false): StockCode | null;
function parseCode(input: string, strict: boolean = true): StockCode | null {
  const lc = input.toLowerCase();
  if (isStockCode(lc)) return lc;
  if (strict) throw new InvalidCodeError(`无效股票代码: ${input}`);
  return null;
}

// ===========================================================================
// 19. 参数解析
// ===========================================================================

interface ParsedArgs {
  positional: readonly string[];
  flags: Readonly<Record<string, string>>;
}

function parseFlags(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-i" || a === "--interval") flags.interval = args[++i];
    else if (a === "-d" || a === "--days") flags.days = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

function printHelp(): void {
  console.log(`
股票行情爬虫 - 用法:
  node dist/index.js quote <code>                    查询单只股票 (如 sh600519)
  node dist/index.js batch <code1> <code2> ...       批量查询
  node dist/index.js watch <code> [-i seconds]       持续监控（默认 5 秒）
  node dist/index.js history <code> [-d days]        查看历史（默认 30 天）
  node dist/index.js help                            显示本帮助

代码格式: sh6XXXXX / sz0XXXXX / sz3XXXXX / sz002XXX 等
说明:
  - 优先使用新浪财经公开接口；失败时回退到演示数据。
  - A股惯例：红色表示上涨，绿色表示下跌。
`);
}

// ===========================================================================
// 20. 入口
// ===========================================================================

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    return;
  }

  const resolved = resolveCommand(argv[0]);
  if (resolved === null) {
    console.log(`未知命令: ${argv[0]}`);
    printHelp();
    return;
  }
  if (resolved === Command.Help) {
    printHelp();
    return;
  }

  const { positional, flags } = parseFlags(argv.slice(1));
  const store = new QuoteStore<Quote>();

  try {
    switch (resolved) {
      case Command.Quote: {
        if (!positional[0]) {
          console.log("请提供股票代码。");
          return;
        }
        await cmdQuote(positional[0], store);
        break;
      }
      case Command.Batch: {
        if (positional.length === 0) {
          console.log("请提供至少一个股票代码。");
          return;
        }
        await cmdBatch([...positional], store);
        break;
      }
      case Command.Watch: {
        if (!positional[0]) {
          console.log("请提供股票代码。");
          return;
        }
        const interval = parseInt(flags.interval || "5", 10) || 5;
        await cmdWatch(positional[0], Math.min(Math.max(interval, 1), 3600));
        break;
      }
      case Command.History: {
        if (!positional[0]) {
          console.log("请提供股票代码。");
          return;
        }
        const days = parseInt(flags.days || "30", 10) || 30;
        await cmdHistory(positional[0], Math.min(Math.max(days, 1), 365));
        break;
      }
      default:
        throw new UnknownCommandError(`未处理的命令: ${resolved}`);
    }

    // 演示 Generator 迭代 + 元组解构
    if (store.size > 0) {
      console.log("  ── 本次会话摘要 ──");
      const summaries: SummaryRow[] = [];
      for (const q of store)
        summaries.push([q.code, q.name, q.changePct, toTrend(q.change)]);
      for (const [code, name, pct, trend] of summaries) {
        const arrow =
          trend === Trend.Up ? "↑" : trend === Trend.Down ? "↓" : "→";
        console.log(`  ${arrow} ${code} ${name} ${pct >= 0 ? "+" : ""}${pct}%`);
      }
    }
  } catch (err) {
    if (err instanceof QuoteError)
      console.error(`运行出错 [${err.name} #${err.code}]:`, err.message);
    else console.error("运行出错:", (err as Error).message);
    process.exit(1);
  }
}

main();
