#!/usr/bin/env node
/**
 * 股票价格查询 CLI (Stock Price Query CLI)
 *
 * 基于股票代码哈希确定性生成模拟行情数据 (无需 API Key)，
 * 支持实时报价、历史走势、涨跌排行与定时刷新。
 *
 * 命令:
 *   quote <symbol>                 查询当前价格与涨跌
 *   history <symbol> [-d days]     查看历史价格走势 (默认 30 天)
 *   top                            查看涨跌幅排行榜
 *   watch <symbol> [-i seconds]    定时刷新报价 (默认 5 秒)
 *   help                           显示帮助信息
 *
 * 说明: 所有行情数据均为基于代码哈希确定性生成的模拟数据，仅供学习演示。
 */

import * as crypto from "crypto";

/** 确定性伪随机数生成器 (mulberry32) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由字符串生成 32 位种子 */
function hashSeed(input: string): number {
  const h = crypto.createHash("md5").update(input).digest();
  return h.readUInt32LE(0);
}

interface DayQuote {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StockInfo {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  marketCap: number;
  history: DayQuote[];
}

const STOCK_NAMES: Record<string, string> = {
  AAPL: "苹果公司", MSFT: "微软公司", GOOGL: "谷歌", AMZN: "亚马逊",
  TSLA: "特斯拉", META: "Meta平台", NVDA: "英伟达", NFLX: "奈飞",
  BABA: "阿里巴巴", TCEHY: "腾讯", BIDU: "百度", JD: "京东",
  PDD: "拼多多", NIO: "蔚来", XPEV: "小鹏", LI: "理想汽车",
};

/** 生成某股票的完整模拟数据 (含历史) */
function generateStock(symbol: string, days = 60): StockInfo {
  const sym = symbol.toUpperCase();
  const seed = hashSeed(sym);
  const rng = mulberry32(seed);
  // 基础价格 20~500 之间，使用指数分布让小盘股更多
  const basePrice = 20 + Math.floor(Math.pow(rng(), 2) * 480);
  // 历史波动率
  const volatility = 0.015 + rng() * 0.04;
  const history: DayQuote[] = [];
  let price = basePrice;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 用一个每日种子保证历史每日固定，但"今天"的收盘随当前分钟变化
  for (let i = days; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayRng = mulberry32(hashSeed(sym + d.toISOString().slice(0, 10)));
    const drift = (dayRng() - 0.48) * volatility * price;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * (1 + dayRng() * volatility * 0.6);
    const low = Math.min(open, close) * (1 - dayRng() * volatility * 0.6);
    const volume = Math.floor((5_000_000 + dayRng() * 50_000_000) * (1 + Math.abs(drift) / price * 20));
    history.push({
      date: d.toISOString().slice(0, 10),
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume,
    });
    price = close;
  }
  const prevClose = history[history.length - 1].close;
  // "当前"价格：基于今日分钟数微调，使 watch 有变化
  const now = new Date();
  const minuteSeed = hashSeed(sym + now.toISOString().slice(0, 16));
  const intradayRng = mulberry32(minuteSeed);
  const dayDrift = (intradayRng() - 0.5) * volatility * prevClose * 1.5;
  const currentPrice = Math.max(0.5, prevClose + dayDrift);
  const open = prevClose * (1 + (intradayRng() - 0.5) * volatility * 0.5);
  const high = Math.max(open, currentPrice) * (1 + intradayRng() * volatility * 0.4);
  const low = Math.min(open, currentPrice) * (1 - intradayRng() * volatility * 0.4);
  const volume = Math.floor((5_000_000 + intradayRng() * 80_000_000));
  const change = round2(currentPrice - prevClose);
  const changePercent = round2((change / prevClose) * 100);
  const shares = Math.floor((1e7 + rng() * 5e9));
  return {
    symbol: sym,
    name: STOCK_NAMES[sym] ?? `${sym} 公司`,
    price: round2(currentPrice),
    change,
    changePercent,
    open: round2(open),
    high: round2(high),
    low: round2(low),
    prevClose: round2(prevClose),
    volume,
    marketCap: Math.floor(currentPrice * shares),
    history,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function fmtMoney(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "万亿";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(2) + "万";
  return n.toString();
}
function fmtVolume(n: number): string { return fmtMoney(n); }

/** 终端表格渲染 */
function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]?.length ?? 0)));
  const sep = "+" + widths.map(w => "-".repeat(w + 2)).join("+") + "+";
  const line = (cells: string[]) => "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  return [sep, line(headers), sep, ...rows.map(line), sep].join("\n");
}

function colorChange(val: number, text: string): string {
  if (val > 0) return `\x1b[31m${text}\x1b[0m`; // 红涨
  if (val < 0) return `\x1b[32m${text}\x1b[0m`; // 绿跌
  return text;
}

function cmdQuote(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供股票代码，例如 quote AAPL"); process.exit(1); }
  const s = generateStock(args[0]);
  console.log(`\n【${s.symbol}】${s.name}`);
  console.log(`当前价格: $${s.price.toFixed(2)}  ${colorChange(s.change, `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%)`)}`);
  console.log(`昨收: $${s.prevClose.toFixed(2)}  开盘: $${s.open.toFixed(2)}  最高: $${s.high.toFixed(2)}  最低: $${s.low.toFixed(2)}`);
  console.log(`成交量: ${fmtVolume(s.volume)}  市值: $${fmtMoney(s.marketCap)}`);
  // 简易价格条
  const range = s.high - s.low || 1;
  const pos = Math.min(1, Math.max(0, (s.price - s.low) / range));
  const barLen = 30;
  const filled = Math.round(pos * barLen);
  console.log(`价格区间: [${"█".repeat(filled)}${"░".repeat(barLen - filled)}]  ${s.low.toFixed(2)} - ${s.high.toFixed(2)}\n`);
}

function cmdHistory(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供股票代码"); process.exit(1); }
  let days = 30;
  for (let i = 1; i < args.length; i++) if (args[i] === "-d" || args[i] === "--days") days = parseInt(args[++i] ?? "30", 10);
  const s = generateStock(args[0]);
  const recent = s.history.slice(-days);
  console.log(`\n【${s.symbol}】最近 ${recent.length} 天历史走势\n`);
  const rows = recent.map(d => [
    d.date,
    `$${d.open.toFixed(2)}`,
    `$${d.high.toFixed(2)}`,
    `$${d.low.toFixed(2)}`,
    colorChange(d.close - d.open, `$${d.close.toFixed(2)}`),
    fmtVolume(d.volume),
  ]);
  console.log(renderTable(["日期", "开盘", "最高", "最低", "收盘", "成交量"], rows));
  // 简易收盘价折线图
  const closes = recent.map(d => d.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  console.log(`\n收盘价走势 (高度 10):`);
  const chartH = 10;
  for (let row = chartH; row >= 0; row--) {
    const target = min + (span * row) / chartH;
    let line = target.toFixed(1).padStart(8) + " |";
    for (const c of closes) {
      const step = Math.round(((c - min) / span) * chartH);
      line += step >= row ? " █" : "  ";
    }
    console.log(line);
  }
  console.log("          " + "-".repeat(closes.length * 2 + 1));
  console.log("");
}

function cmdTop(): void {
  const symbols = Object.keys(STOCK_NAMES).concat(["INTC", "AMD", "ORCL", "SAP", "SHOP", "SQ", "PYPL", "UBER"]);
  const stocks = symbols.map(s => generateStock(s));
  const gainers = [...stocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const losers = [...stocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
  console.log(`\n=== 涨幅榜 TOP 5 ===`);
  console.log(renderTable(["代码", "名称", "价格", "涨跌额", "涨跌幅"],
    gainers.map(s => [s.symbol, s.name, `$${s.price.toFixed(2)}`, `+${s.change.toFixed(2)}`, colorChange(s.changePercent, `+${s.changePercent.toFixed(2)}%`)])));
  console.log(`\n=== 跌幅榜 TOP 5 ===`);
  console.log(renderTable(["代码", "名称", "价格", "涨跌额", "涨跌幅"],
    losers.map(s => [s.symbol, s.name, `$${s.price.toFixed(2)}`, s.change.toFixed(2), colorChange(s.changePercent, `${s.changePercent.toFixed(2)}%`)])));
  console.log("");
}

function cmdWatch(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供股票代码"); process.exit(1); }
  let interval = 5;
  for (let i = 1; i < args.length; i++) if (args[i] === "-i" || args[i] === "--interval") interval = parseInt(args[++i] ?? "5", 10);
  if (interval < 1) interval = 1;
  console.log(`监控 ${args[0].toUpperCase()}，每 ${interval} 秒刷新一次 (Ctrl+C 退出)\n`);
  const tick = () => {
    const s = generateStock(args[0]);
    const time = new Date().toLocaleTimeString();
    process.stdout.write("\r\x1b[K");
    process.stdout.write(`[${time}] ${s.symbol} $${s.price.toFixed(2)} ${colorChange(s.change, `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%)`)}  昨收 $${s.prevClose.toFixed(2)}`);
  };
  tick();
  const timer = setInterval(tick, interval * 1000);
  process.on("SIGINT", () => { clearInterval(timer); console.log("\n已停止监控。"); process.exit(0); });
}

function printHelp(): void {
  console.log(`
股票价格查询 CLI (Stock Price Query CLI)
========================================
基于股票代码哈希确定性生成模拟行情数据，支持报价、历史、排行与监控。

用法:
  stock quote <symbol>               查询当前价格与涨跌
  stock history <symbol> [-d days]   查看历史价格走势 (默认 30 天)
  stock top                          查看涨跌幅排行榜
  stock watch <symbol> [-i seconds]  定时刷新报价 (默认 5 秒)
  stock help                         显示本帮助

示例:
  stock quote AAPL
  stock history TSLA -d 10
  stock top
  stock watch NVDA -i 2

说明: 所有数据均为基于代码哈希确定性生成的模拟数据，仅用于学习演示。
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "quote": cmdQuote(rest); break;
      case "history": cmdHistory(rest); break;
      case "top": cmdTop(); break;
      case "watch": cmdWatch(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'stock help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
