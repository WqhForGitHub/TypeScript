#!/usr/bin/env node
/**
 * 53. 爬取股票行情
 * ------------------------------------------------------------------
 * 演示一个股票行情爬虫：
 *   - 尝试从新浪财经公开接口（无需 key）抓取实时行情
 *   - 网络失败时基于股票代码哈希生成稳定模拟数据
 *   - 支持命令：quote、batch、watch、history
 *   - 彩色表格展示（A股惯例：红涨绿跌）
 *
 * 仅使用 Node.js 内置模块：http、https、url、crypto、zlib、buffer。
 */

import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as crypto from "crypto";
import * as zlib from "zlib";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

interface StockQuote {
  code: string;        // sh600519
  name: string;
  price: number;       // 当前价
  prevClose: number;   // 昨收
  open: number;        // 今开
  high: number;        // 最高
  low: number;         // 最低
  volume: number;      // 成交量（手）
  amount: number;      // 成交额（元）
  change: number;      // 涨跌额
  changePct: number;   // 涨跌幅 %
  timestamp: number;
  source: "live" | "demo";
}

interface HistoryDay {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// HTTP 助手（支持 gzip / 超时 / 重定向）
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<{ status: number; body: string; finalUrl: string }> {
  const timeout = opts.timeout ?? 10000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",
    Referer: "https://finance.sina.com.cn/",
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

// ---------------------------------------------------------------------------
// 颜色（ANSI）
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

function colorByChange(s: string, change: number): string {
  if (change > 0) return C.red + s + C.reset;   // A股：红涨
  if (change < 0) return C.green + s + C.reset; // 绿跌
  return s;
}

// ---------------------------------------------------------------------------
// 实时行情（新浪接口）
// ---------------------------------------------------------------------------

// 已知股票名称表
const KNOWN_NAMES: Record<string, string> = {
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

async function liveQuote(code: string): Promise<StockQuote | null> {
  // 新浪接口: hq.sinajs.cn/list=sh600519
  const u = `https://hq.sinajs.cn/list=${code}`;
  try {
    const res = await fetchText(u, { timeout: 8000 });
    if (res.status !== 200) return null;
    // 返回内容形如: var hq_str_sh600519="贵州茅台,1...,2024-...";
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
    const volume = parseFloat(parts[8]) / 100 || 0;     // 股 → 手
    const amount = parseFloat(parts[9]) || 0;
    if (price <= 0) return null;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      code, name, price, prevClose, open, high, low,
      volume, amount, change, changePct,
      timestamp: Date.now(), source: "live",
    };
  } catch (err) {
    console.log(`[liveQuote] ${code} 失败: ${(err as Error).message}`);
    return null;
  }
}

async function liveQuotes(codes: string[]): Promise<StockQuote[]> {
  const out: StockQuote[] = [];
  for (const c of codes) {
    const q = await liveQuote(c);
    if (q) out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 模拟数据（基于代码哈希 → 稳定结果）
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  return crypto.createHash("md5").update(s, "utf8").digest().readUInt32BE(0);
}

function mockQuote(code: string): StockQuote {
  const seed = hashStr(code);
  const name = KNOWN_NAMES[code] || `模拟股票(${code})`;
  const prevClose = 5 + (seed % 200);
  const drift = ((seed % 1000) / 1000 - 0.5) * 0.1; // ±5%
  const price = +(prevClose * (1 + drift)).toFixed(2);
  const open = +(prevClose * (1 + ((seed >> 3) % 100) / 1000 - 0.05)).toFixed(2);
  const high = +(Math.max(price, open) * (1 + (seed % 30) / 1000)).toFixed(2);
  const low = +(Math.min(price, open) * (1 - (seed % 30) / 1000)).toFixed(2);
  const volume = (seed % 1000000) + 1000;
  const amount = +(price * volume * 100 * (0.95 + (seed % 100) / 2000)).toFixed(0);
  const change = +(price - prevClose).toFixed(2);
  const changePct = +((change / prevClose) * 100).toFixed(2);
  return {
    code, name, price, prevClose, open, high, low,
    volume, amount, change, changePct,
    timestamp: Date.now(), source: "demo",
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
      open, close, high, low, volume,
    });
    price = close;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 表格渲染
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}

function fmtVol(v: number): string {
  if (v >= 10000) return (v / 10000).toFixed(2) + "万手";
  return v.toFixed(0) + "手";
}

function fmtAmount(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(2) + "万";
  return v.toFixed(0);
}

function printQuote(q: StockQuote): void {
  const src = q.source === "live" ? "实时" : "演示";
  console.log("");
  console.log(`  ${C.bold}${q.name}${C.reset} (${q.code})   数据源: ${src}`);
  console.log("  " + "─".repeat(56));
  const priceStr = colorByChange(q.price.toFixed(2), q.change);
  const changeStr = colorByChange(
    `${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}  (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%)`,
    q.change
  );
  console.log(`  现价:     ${priceStr}`);
  console.log(`  涨跌:     ${changeStr}`);
  console.log(`  今开:     ${q.open.toFixed(2)}    昨收: ${q.prevClose.toFixed(2)}`);
  console.log(`  最高:     ${q.high.toFixed(2)}    最低: ${q.low.toFixed(2)}`);
  console.log(`  成交量:   ${fmtVol(q.volume)}    成交额: ${fmtAmount(q.amount)}元`);
  console.log(`  时间:     ${new Date(q.timestamp).toLocaleString()}`);
  console.log("");
}

function printBatchTable(qs: StockQuote[]): void {
  console.log("");
  console.log(`  ${C.bold}批量行情${C.reset}  (共 ${qs.length} 只)`);
  console.log("  " + "─".repeat(78));
  const widths = [10, 12, 12, 14, 14, 12];
  const header = ["代码", "名称", "现价", "涨跌幅", "成交额", "数据源"];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(78));
  for (const q of qs) {
    const price = colorByChange(q.price.toFixed(2), q.change);
    const pct = colorByChange(`${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`, q.change);
    const row = [q.code, q.name, price, pct, fmtAmount(q.amount), q.source === "live" ? "实时" : "演示"];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

function printHistory(code: string, days: HistoryDay[]): void {
  console.log("");
  console.log(`  ${C.bold}历史行情${C.reset}  ${code}  (近 ${days.length} 天)`);
  console.log("  " + "─".repeat(60));
  const widths = [14, 10, 10, 10, 10, 12];
  const header = ["日期", "开盘", "收盘", "最高", "最低", "成交量"];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(60));
  for (const d of days) {
    const close = colorByChange(d.close.toFixed(2), d.close - d.open);
    const row = [d.date, d.open.toFixed(2), close, d.high.toFixed(2), d.low.toFixed(2), fmtVol(d.volume)];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function cmdQuote(code: string): Promise<void> {
  code = code.toLowerCase();
  console.log(`[quote] ${code}`);
  const q = await liveQuote(code);
  if (q) {
    console.log("[quote] 使用实时数据。");
    printQuote(q);
  } else {
    console.log("[quote] 实时数据不可用，使用演示数据。");
    printQuote(mockQuote(code));
  }
}

async function cmdBatch(codes: string[]): Promise<void> {
  console.log(`[batch] ${codes.length} 只`);
  const live = await liveQuotes(codes.map((c) => c.toLowerCase()));
  const liveSet = new Set(live.map((q) => q.code));
  const out: StockQuote[] = [];
  for (const c of codes) {
    const lc = c.toLowerCase();
    const found = live.find((q) => q.code === lc);
    if (found) out.push(found);
    else {
      console.log(`[batch] ${lc} 实时失败，使用演示数据。`);
      out.push(mockQuote(lc));
    }
  }
  void liveSet;
  printBatchTable(out);
}

async function cmdWatch(code: string, interval: number): Promise<void> {
  code = code.toLowerCase();
  console.log(`[watch] ${code}  间隔 ${interval}s  (Ctrl+C 退出)`);
  let round = 0;
  const tick = async (): Promise<void> => {
    round++;
    console.log(`\n--- 第 ${round} 轮  ${new Date().toLocaleTimeString()} ---`);
    const q = await liveQuote(code);
    if (q) printQuote(q);
    else printQuote(mockQuote(code));
  };
  await tick();
  setInterval(tick, interval * 1000);
}

async function cmdHistory(code: string, days: number): Promise<void> {
  code = code.toLowerCase();
  console.log(`[history] ${code}  近 ${days} 天`);
  // 历史数据尝试通过新浪接口难以稳定获取，这里直接使用模拟数据并明确标注
  console.log("[history] 使用模拟历史数据（仅用于演示技术）.");
  printHistory(code, mockHistory(code, days));
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

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

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
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
      case "quote":
        if (!positional[0]) { console.log("请提供股票代码。"); return; }
        await cmdQuote(positional[0]);
        break;
      case "batch":
        if (positional.length === 0) { console.log("请提供至少一个股票代码。"); return; }
        await cmdBatch(positional);
        break;
      case "watch": {
        if (!positional[0]) { console.log("请提供股票代码。"); return; }
        const interval = parseInt(flags.interval || "5", 10) || 5;
        await cmdWatch(positional[0], Math.min(Math.max(interval, 1), 3600));
        break;
      }
      case "history": {
        if (!positional[0]) { console.log("请提供股票代码。"); return; }
        const days = parseInt(flags.days || "30", 10) || 30;
        await cmdHistory(positional[0], Math.min(Math.max(days, 1), 365));
        break;
      }
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
