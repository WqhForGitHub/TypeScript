#!/usr/bin/env node
"use strict";
/**
 * 股票价格查询 CLI (Stock Price Query CLI) — Enhanced Edition
 *
 * 基于股票代码哈希确定性生成模拟行情数据 (无需 API Key)，
 * 支持实时报价、技术指标、趋势检测、历史走势、涨跌排行、组合盈亏与定时刷新。
 *
 * 命令:
 *   quote <symbol>                 查询当前价格、技术指标与交易信号
 *   history <symbol> [-d days]     查看历史 K 线与收盘价走势 (默认 30 天)
 *   top                            查看涨跌 / 成交量 / 市值排行榜
 *   watch <symbol> [-i seconds]    定时刷新报价 (默认 5 秒)
 *   portfolio [name]               查看模拟组合盈亏
 *   help                           显示帮助信息
 *
 * 说明: 所有行情数据均为基于代码哈希确定性生成的模拟数据，仅供学习演示。
 *       本文件用于演示高级 TypeScript 特性 (枚举 / 泛型 / 判别联合 / 映射类型 /
 *       条件类型 / 模板字面量类型 / 类型守卫 / 抽象类 / 重载 / 生成器 / Symbol 等)。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = __importStar(require("crypto"));
// ============================================================
// 1. 枚举 (Enums)
// ============================================================
var StockType;
(function (StockType) {
    StockType["Stock"] = "STOCK";
    StockType["ETF"] = "ETF";
    StockType["Index"] = "INDEX";
    StockType["Bond"] = "BOND";
})(StockType || (StockType = {}));
var MarketType;
(function (MarketType) {
    MarketType["SH"] = "SH";
    MarketType["SZ"] = "SZ";
    MarketType["HK"] = "HK";
    MarketType["US"] = "US";
    MarketType["Crypto"] = "CRYPTO";
})(MarketType || (MarketType = {}));
var TrendDirection;
(function (TrendDirection) {
    TrendDirection["Bullish"] = "BULLISH";
    TrendDirection["Bearish"] = "BEARISH";
    TrendDirection["Sideways"] = "SIDEWAYS";
})(TrendDirection || (TrendDirection = {}));
var SortField;
(function (SortField) {
    SortField["ChangePercent"] = "changePercent";
    SortField["Volume"] = "volume";
    SortField["Price"] = "price";
    SortField["MarketCap"] = "marketCap";
})(SortField || (SortField = {}));
var OutputFormat;
(function (OutputFormat) {
    OutputFormat["Table"] = "TABLE";
    OutputFormat["List"] = "LIST";
    OutputFormat["Chart"] = "CHART";
})(OutputFormat || (OutputFormat = {}));
var TimeRange;
(function (TimeRange) {
    TimeRange["Day"] = "1D";
    TimeRange["Week"] = "1W";
    TimeRange["Month"] = "1M";
    TimeRange["Quarter"] = "3M";
    TimeRange["HalfYear"] = "6M";
    TimeRange["Year"] = "1Y";
})(TimeRange || (TimeRange = {}));
const STOCK_TYPE_LABELS = {
    [StockType.Stock]: "股票",
    [StockType.ETF]: "ETF基金",
    [StockType.Index]: "指数",
    [StockType.Bond]: "债券",
};
const TREND_LABELS = {
    [TrendDirection.Bullish]: "上升",
    [TrendDirection.Bearish]: "下降",
    [TrendDirection.Sideways]: "震荡",
};
// 示例: 泛型约束 + 条件类型组合的实例化
const SAMPLE_INDEX_DATA = {
    symbol: "sh000001",
    type: StockType.Index,
    market: MarketType.SH,
    constituents: 1800,
};
class AbstractIndicator {
    constructor(config) {
        this.config = config;
    }
}
// ============================================================
// 8. 自定义错误类层级 (Custom Error hierarchy)
// ============================================================
class StockError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "StockError";
    }
}
class InvalidCodeError extends StockError {
    constructor(symbol) {
        super(`无效的股票代码: ${symbol}`, "INVALID_CODE");
        this.name = "InvalidCodeError";
    }
}
class MarketClosedError extends StockError {
    constructor(market) {
        super(`市场已关闭: ${market}`, "MARKET_CLOSED");
        this.name = "MarketClosedError";
    }
}
class DataUnavailableError extends StockError {
    constructor(symbol) {
        super(`数据不可用: ${symbol}`, "DATA_UNAVAILABLE");
        this.name = "DataUnavailableError";
    }
}
// ============================================================
// 9. 类型守卫 (Type guards)
// ============================================================
function isStockType(v) {
    return typeof v === "string" && Object.values(StockType).includes(v);
}
function isMarketType(v) {
    return typeof v === "string" && Object.values(MarketType).includes(v);
}
function isStockCode(v) {
    if (typeof v !== "string")
        return false;
    return /^sh\d{6}$/i.test(v) || /^sz\d{6}$/i.test(v) || /^[A-Z]{1,6}$/.test(v);
}
// ============================================================
// 11. Symbol (internal methods)
// ============================================================
const REFRESH = Symbol("refresh");
const COMPUTE_INDICATORS = Symbol("computeIndicators");
// ============================================================
// 12. PRNG & 哈希 (deterministic seed)
// ============================================================
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashSeed(input) {
    const h = crypto.createHash("md5").update(input).digest();
    return h.readUInt32LE(0);
}
// ============================================================
// 13. 常量 + `satisfies` + `as const`
// ============================================================
const STOCK_NAMES = {
    AAPL: "苹果公司", MSFT: "微软公司", GOOGL: "谷歌", AMZN: "亚马逊",
    TSLA: "特斯拉", META: "Meta平台", NVDA: "英伟达", NFLX: "奈飞",
    BABA: "阿里巴巴", TCEHY: "腾讯", BIDU: "百度", JD: "京东",
    PDD: "拼多多", NIO: "蔚来", XPEV: "小鹏", LI: "理想汽车",
};
const EXTRA_SYMBOLS = ["INTC", "AMD", "ORCL", "SAP", "SHOP", "SQ", "PYPL", "UBER"];
const TIME_RANGE_DAYS = {
    [TimeRange.Day]: 1,
    [TimeRange.Week]: 7,
    [TimeRange.Month]: 30,
    [TimeRange.Quarter]: 90,
    [TimeRange.HalfYear]: 180,
    [TimeRange.Year]: 365,
};
// ============================================================
// 14. 通用辅助函数
// ============================================================
function round2(n) { return Math.round(n * 100) / 100; }
function fmtMoney(n) {
    if (n >= 1e12)
        return (n / 1e12).toFixed(2) + "万亿";
    if (n >= 1e8)
        return (n / 1e8).toFixed(2) + "亿";
    if (n >= 1e4)
        return (n / 1e4).toFixed(2) + "万";
    return n.toString();
}
const fmtVolume = (n) => fmtMoney(n);
function colorChange(val, text) {
    if (val > 0)
        return `\x1b[31m${text}\x1b[0m`; // 红涨 (中国习惯)
    if (val < 0)
        return `\x1b[32m${text}\x1b[0m`; // 绿跌
    return text;
}
// ============================================================
// 15. 抽象数据提供者 + 具体实现
// ============================================================
class AbstractStockDataProvider {
    [REFRESH]() { }
}
class MockStockProvider extends AbstractStockDataProvider {
    constructor() {
        super(...arguments);
        this.sourceName = "MockDataProvider";
    }
    fetch(symbol) { return generateStock(symbol); }
    fetchHistory(symbol, days) {
        return generateStock(symbol, days).history;
    }
}
// ============================================================
// 16. 技术指标 (AbstractIndicator 子类)
// ============================================================
class MovingAverageIndicator extends AbstractIndicator {
    constructor() {
        super(...arguments);
        this.name = `MA(${this.config.period})`;
    }
    compute(prices) {
        const { period } = this.config;
        const out = [];
        for (let i = 0; i < prices.length; i++) {
            if (i < period - 1) {
                out.push(NaN);
                continue;
            }
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++)
                sum += prices[j];
            out.push(sum / period);
        }
        return out;
    }
}
class EMAIndicator extends AbstractIndicator {
    constructor() {
        super(...arguments);
        this.name = `EMA(${this.config.period})`;
    }
    compute(prices) {
        const k = 2 / (this.config.period + 1);
        const out = [];
        let prev = prices[0] ?? 0;
        out.push(prev);
        for (let i = 1; i < prices.length; i++) {
            prev = prices[i] * k + prev * (1 - k);
            out.push(prev);
        }
        return out;
    }
}
class RSIIndicator extends AbstractIndicator {
    constructor() {
        super(...arguments);
        this.name = `RSI(${this.config.period})`;
    }
    compute(prices) {
        const { period } = this.config;
        const out = new Array(prices.length).fill(NaN);
        if (prices.length < period + 1)
            return out;
        let gain = 0, loss = 0;
        for (let i = 1; i <= period; i++) {
            const d = prices[i] - prices[i - 1];
            if (d >= 0)
                gain += d;
            else
                loss -= d;
        }
        let avgGain = gain / period, avgLoss = loss / period;
        out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
        for (let i = period + 1; i < prices.length; i++) {
            const d = prices[i] - prices[i - 1];
            const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
            avgGain = (avgGain * (period - 1) + g) / period;
            avgLoss = (avgLoss * (period - 1) + l) / period;
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            out[i] = 100 - 100 / (1 + rs);
        }
        return out;
    }
}
class MACDIndicator extends AbstractIndicator {
    constructor() {
        super(...arguments);
        this.name = "MACD";
    }
    compute(prices) {
        const emaFast = new EMAIndicator({ period: this.config.fast }).compute(prices);
        const emaSlow = new EMAIndicator({ period: this.config.slow }).compute(prices);
        const macd = prices.map((_, i) => emaFast[i] - emaSlow[i]);
        const signal = new EMAIndicator({ period: this.config.signal }).compute(macd);
        return macd.map((m, i) => m - signal[i]);
    }
}
class BollingerIndicator extends AbstractIndicator {
    constructor() {
        super(...arguments);
        this.name = "BOLL";
    }
    compute(prices) {
        const { period, stdDev } = this.config;
        const out = new Array(prices.length).fill(NaN);
        for (let i = period - 1; i < prices.length; i++) {
            const slice = prices.slice(i - period + 1, i + 1);
            const mean = slice.reduce((a, b) => a + b, 0) / period;
            const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
            out[i] = mean + Math.sqrt(variance) * stdDev;
        }
        return out;
    }
}
// ============================================================
// 17. 生成器 / 迭代器 (Generators / Iterators)
// ============================================================
function* iterateHistory(history) {
    for (const q of history)
        yield q;
}
function* generateMockTicks(symbol, count) {
    const rng = mulberry32(hashSeed(symbol + "-ticks"));
    let price = 100;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        price = Math.max(1, price + (rng() - 0.5) * 5);
        yield [now - (count - i) * 1000, round2(price)];
    }
}
// ============================================================
// 18. 趋势 / 支撑阻力 检测
// ============================================================
function detectTrend(history) {
    if (history.length < 5)
        return TrendDirection.Sideways;
    const closes = history.map(h => h.ohlc[3]);
    const n5 = Math.min(5, closes.length);
    const n20 = Math.min(20, closes.length);
    const ma5 = closes.slice(-n5).reduce((a, b) => a + b, 0) / n5;
    const ma20 = closes.slice(-n20).reduce((a, b) => a + b, 0) / n20;
    const pct = (ma5 - ma20) / ma20;
    if (pct > 0.02)
        return TrendDirection.Bullish;
    if (pct < -0.02)
        return TrendDirection.Bearish;
    return TrendDirection.Sideways;
}
function detectSupportResistance(history) {
    const recent = history.slice(-20);
    const lows = recent.map(h => h.ohlc[2]).sort((a, b) => a - b);
    const highs = recent.map(h => h.ohlc[1]).sort((a, b) => b - a);
    return {
        support: lows[Math.floor(lows.length * 0.2)] ?? 0,
        resistance: highs[Math.floor(highs.length * 0.2)] ?? 0,
    };
}
// ============================================================
// 19. 股票模拟数据生成 (核心)
// ============================================================
function generateStock(symbol, days = 60) {
    const sym = symbol.toUpperCase();
    if (!isStockCode(sym))
        throw new InvalidCodeError(sym);
    const seed = hashSeed(sym);
    const rng = mulberry32(seed);
    const basePrice = 20 + Math.floor(Math.pow(rng(), 2) * 480);
    const volatility = 0.015 + rng() * 0.04;
    const history = [];
    let price = basePrice;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days; i >= 1; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayRng = mulberry32(hashSeed(sym + d.toISOString().slice(0, 10)));
        const drift = (dayRng() - 0.48) * volatility * price;
        const open = price;
        const close = Math.max(1, open + drift);
        const high = Math.max(open, close) * (1 + dayRng() * volatility * 0.6);
        const low = Math.min(open, close) * (1 - dayRng() * volatility * 0.6);
        const volume = Math.floor((5000000 + dayRng() * 50000000) * (1 + Math.abs(drift) / price * 20));
        history.push({
            date: d.toISOString().slice(0, 10),
            ohlc: [round2(open), round2(high), round2(low), round2(close)],
            volume,
        });
        price = close;
    }
    const prevClose = history[history.length - 1]?.ohlc[3] ?? basePrice;
    const now = new Date();
    const intradayRng = mulberry32(hashSeed(sym + now.toISOString().slice(0, 16)));
    const dayDrift = (intradayRng() - 0.5) * volatility * prevClose * 1.5;
    const currentPrice = Math.max(0.5, prevClose + dayDrift);
    const open = prevClose * (1 + (intradayRng() - 0.5) * volatility * 0.5);
    const high = Math.max(open, currentPrice) * (1 + intradayRng() * volatility * 0.4);
    const low = Math.min(open, currentPrice) * (1 - intradayRng() * volatility * 0.4);
    const volume = Math.floor(5000000 + intradayRng() * 80000000);
    const change = round2(currentPrice - prevClose);
    const changePercent = round2((change / prevClose) * 100);
    const shares = Math.floor(1e7 + rng() * 5e9);
    const market = /^sh/i.test(sym) ? MarketType.SH : /^sz/i.test(sym) ? MarketType.SZ : MarketType.US;
    return {
        symbol: sym,
        name: STOCK_NAMES[sym] ?? `${sym} 公司`,
        type: StockType.Stock,
        market,
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
function query(symbol, range = TimeRange.Month, _format = OutputFormat.Table) {
    const days = TIME_RANGE_DAYS[range] ?? 30;
    return generateStock(symbol, days);
}
// ============================================================
// 21. 组合跟踪 (getter/setter + generator)
// ============================================================
class Portfolio {
    constructor() {
        this.entries = new Map();
        this._label = "MyPortfolio";
    }
    get label() { return this._label; }
    set label(v) { this._label = v || "MyPortfolio"; }
    get size() { return this.entries.size; }
    add(entry) { this.entries.set(entry.symbol, entry); }
    remove(symbol) { return this.entries.delete(symbol); }
    *pnl() {
        for (const [, entry] of this.entries) {
            const s = generateStock(entry.symbol);
            const pnl = round2((s.price - entry.costPrice) * entry.shares);
            const pnlPercent = round2(((s.price - entry.costPrice) / entry.costPrice) * 100);
            yield { symbol: entry.symbol, pnl, pnlPercent };
        }
    }
}
// ============================================================
// 22. 排行与统计
// ============================================================
function rankStocks(stocks, field = SortField.ChangePercent, ascending = false, limit = 5) {
    const sorted = [...stocks].sort((a, b) => {
        const av = a[field] ?? 0;
        const bv = b[field] ?? 0;
        return ascending ? av - bv : bv - av;
    });
    return sorted.slice(0, limit);
}
function computeMarketStats(stocks) {
    return {
        gainers: rankStocks(stocks, SortField.ChangePercent, false, 5),
        losers: rankStocks(stocks, SortField.ChangePercent, true, 5),
        volumeLeaders: rankStocks(stocks, SortField.Volume, false, 5),
        topMarketCap: rankStocks(stocks, SortField.MarketCap, false, 5),
    };
}
// ============================================================
// 23. 交易信号 (discriminated union 输出)
// ============================================================
function generateSignal(s) {
    const rsiArr = new RSIIndicator({ period: 14 }).compute(s.history.map(h => h.ohlc[3]));
    const lastRsi = rsiArr[rsiArr.length - 1] ?? 50;
    if (s.changePercent > 3 && lastRsi < 70) {
        return { type: "BUY", strength: Math.min(1, s.changePercent / 10), reason: `涨幅 ${s.changePercent}% 且 RSI 未超买` };
    }
    if (s.changePercent < -3 && lastRsi > 30) {
        return { type: "SELL", strength: Math.min(1, -s.changePercent / 10), reason: `跌幅 ${s.changePercent}% 且 RSI 未超卖` };
    }
    return { type: "HOLD", reason: `RSI=${lastRsi.toFixed(1)}，无明显信号` };
}
function formatSignal(signal) {
    switch (signal.type) {
        case "BUY":
        case "SELL":
            return `[${signal.type}] ${signal.reason} (强度 ${signal.strength.toFixed(2)})`;
        case "HOLD":
            return `[HOLD] ${signal.reason}`;
    }
}
// 事件构造示例 (展示判别联合 narrowing)
function buildEvent(s) {
    if (s.change > 0)
        return { kind: "PRICE_UP", symbol: s.symbol, delta: s.change };
    if (s.change < 0)
        return { kind: "PRICE_DOWN", symbol: s.symbol, delta: s.change };
    return { kind: "VOLUME_SPIKE", symbol: s.symbol, volume: s.volume };
}
// ============================================================
// 24. 渲染 (表格 / 列表 / ASCII 图)
// ============================================================
function renderTable(headers, rows) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]?.length ?? 0)));
    const sep = "+" + widths.map(w => "-".repeat(w + 2)).join("+") + "+";
    const line = (cells) => "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
    return [sep, line(headers), sep, ...rows.map(line), sep].join("\n");
}
function renderChart(closes, height = 10) {
    if (closes.length === 0)
        return "";
    const min = Math.min(...closes), max = Math.max(...closes);
    const span = max - min || 1;
    const lines = [];
    for (let row = height; row >= 0; row--) {
        const target = min + (span * row) / height;
        let line = target.toFixed(1).padStart(8) + " |";
        for (const c of closes) {
            const step = Math.round(((c - min) / span) * height);
            line += step >= row ? " █" : "  ";
        }
        lines.push(line);
    }
    lines.push("          " + "-".repeat(closes.length * 2 + 1));
    return lines.join("\n");
}
function formatStock(s, fmt) {
    switch (fmt) {
        case OutputFormat.List:
            return [
                `${s.symbol} - ${s.name} (${STOCK_TYPE_LABELS[s.type]})`,
                `  价格: $${s.price.toFixed(2)}`,
                `  涨跌: ${colorChange(s.change, `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePercent.toFixed(2)}%)`)}`,
                `  成交量: ${fmtVolume(s.volume)}  市值: $${fmtMoney(s.marketCap)}`,
            ].join("\n");
        case OutputFormat.Chart:
            return renderChart(s.history.map(h => h.ohlc[3]));
        case OutputFormat.Table:
        default:
            return renderTable(["代码", "名称", "价格", "涨跌额", "涨跌幅", "成交量"], [[s.symbol, s.name, `$${s.price.toFixed(2)}`, `${s.change.toFixed(2)}`, `${s.changePercent.toFixed(2)}%`, fmtVolume(s.volume)]]);
    }
}
// ============================================================
// 25. 命令实现
// ============================================================
const provider = new MockStockProvider();
function cmdQuote(args) {
    const symbol = args[0];
    if (!symbol)
        throw new StockError("请提供股票代码，例如 quote AAPL", "MISSING_ARG");
    const s = provider.fetch(symbol);
    const trend = detectTrend(s.history);
    const sr = detectSupportResistance(s.history);
    const signal = generateSignal(s);
    const event = buildEvent(s);
    console.log(`\n【${s.symbol}】${s.name} (${STOCK_TYPE_LABELS[s.type]} · ${s.market})`);
    console.log(`当前价格: $${s.price.toFixed(2)}  ${colorChange(s.change, `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%)`)}`);
    console.log(`昨收: $${s.prevClose.toFixed(2)}  开盘: $${s.open.toFixed(2)}  最高: $${s.high.toFixed(2)}  最低: $${s.low.toFixed(2)}`);
    console.log(`成交量: ${fmtVolume(s.volume)}  市值: $${fmtMoney(s.marketCap)}`);
    console.log(`趋势: ${TREND_LABELS[trend]}  支撑: $${sr.support.toFixed(2)}  阻力: $${sr.resistance.toFixed(2)}`);
    console.log(`信号: ${formatSignal(signal)}`);
    // event narrowing
    const evtDesc = event.kind === "PRICE_UP" || event.kind === "PRICE_DOWN"
        ? `${event.kind} Δ${event.delta.toFixed(2)}`
        : event.kind === "VOLUME_SPIKE"
            ? `VOLUME_SPIKE vol=${fmtVolume(event.volume)}`
            : `${event.kind}`;
    console.log(`事件: ${evtDesc}`);
    // 技术指标
    const closes = s.history.map(h => h.ohlc[3]);
    const ma5 = new MovingAverageIndicator({ period: 5 }).compute(closes);
    const ma20 = new MovingAverageIndicator({ period: 20 }).compute(closes);
    const rsi = new RSIIndicator({ period: 14 }).compute(closes);
    const macd = new MACDIndicator({ fast: 12, slow: 26, signal: 9 }).compute(closes);
    const boll = new BollingerIndicator({ period: 20, stdDev: 2 }).compute(closes);
    const last = (a) => a[a.length - 1];
    console.log(`MA5=${last(ma5)?.toFixed(2) ?? "-"}  MA20=${last(ma20)?.toFixed(2) ?? "-"}  RSI(14)=${last(rsi)?.toFixed(2) ?? "-"}  MACD=${last(macd)?.toFixed(2) ?? "-"}  BOLL上轨=${last(boll)?.toFixed(2) ?? "-"}`);
    // 价格条
    const range = s.high - s.low || 1;
    const pos = Math.min(1, Math.max(0, (s.price - s.low) / range));
    const barLen = 30, filled = Math.round(pos * barLen);
    console.log(`价格区间: [${"█".repeat(filled)}${"░".repeat(barLen - filled)}]  ${s.low.toFixed(2)} - ${s.high.toFixed(2)}\n`);
}
function cmdHistory(args) {
    const symbol = args[0];
    if (!symbol)
        throw new StockError("请提供股票代码", "MISSING_ARG");
    let days = 30;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === "-d" || args[i] === "--days")
            days = parseInt(args[++i] ?? "30", 10);
    }
    const s = provider.fetch(symbol);
    const recent = s.history.slice(-days);
    console.log(`\n【${s.symbol}】最近 ${recent.length} 天历史 K 线\n`);
    const rows = recent.map(d => [
        d.date,
        `$${d.ohlc[0].toFixed(2)}`,
        `$${d.ohlc[1].toFixed(2)}`,
        `$${d.ohlc[2].toFixed(2)}`,
        colorChange(d.ohlc[3] - d.ohlc[0], `$${d.ohlc[3].toFixed(2)}`),
        fmtVolume(d.volume),
    ]);
    console.log(renderTable(["日期", "开盘", "最高", "最低", "收盘", "成交量"], rows));
    // 用生成器迭代收集收盘价
    const closes = [];
    for (const q of iterateHistory(recent))
        closes.push(q.ohlc[3]);
    console.log(`\n收盘价走势 (高度 10):`);
    console.log(renderChart(closes));
    console.log("");
}
function cmdTop() {
    const symbols = [...Object.keys(STOCK_NAMES), ...EXTRA_SYMBOLS];
    const stocks = symbols.map(s => generateStock(s));
    const stats = computeMarketStats(stocks);
    console.log(`\n=== 涨幅榜 TOP 5 ===`);
    console.log(renderTable(["代码", "名称", "价格", "涨跌额", "涨跌幅"], stats.gainers.map(s => [s.symbol, s.name, `$${s.price.toFixed(2)}`, `+${s.change.toFixed(2)}`, colorChange(s.changePercent, `+${s.changePercent.toFixed(2)}%`)])));
    console.log(`\n=== 跌幅榜 TOP 5 ===`);
    console.log(renderTable(["代码", "名称", "价格", "涨跌额", "涨跌幅"], stats.losers.map(s => [s.symbol, s.name, `$${s.price.toFixed(2)}`, s.change.toFixed(2), colorChange(s.changePercent, `${s.changePercent.toFixed(2)}%`)])));
    console.log(`\n=== 成交量榜 TOP 5 ===`);
    console.log(renderTable(["代码", "名称", "价格", "成交量"], stats.volumeLeaders.map(s => [s.symbol, s.name, `$${s.price.toFixed(2)}`, fmtVolume(s.volume)])));
    console.log(`\n=== 市值榜 TOP 5 ===`);
    console.log(renderTable(["代码", "名称", "价格", "市值"], stats.topMarketCap.map(s => [s.symbol, s.name, `$${s.price.toFixed(2)}`, `$${fmtMoney(s.marketCap)}`])));
    console.log("");
}
function cmdWatch(args) {
    const symbol = args[0];
    if (!symbol)
        throw new StockError("请提供股票代码", "MISSING_ARG");
    let interval = 5;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === "-i" || args[i] === "--interval")
            interval = parseInt(args[++i] ?? "5", 10);
    }
    if (interval < 1)
        interval = 1;
    console.log(`监控 ${symbol.toUpperCase()}，每 ${interval} 秒刷新一次 (Ctrl+C 退出)\n`);
    const tick = () => {
        const s = generateStock(symbol);
        const time = new Date().toLocaleTimeString();
        process.stdout.write("\r\x1b[K");
        process.stdout.write(`[${time}] ${s.symbol} $${s.price.toFixed(2)} ${colorChange(s.change, `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%)`)}  昨收 $${s.prevClose.toFixed(2)}`);
    };
    tick();
    const timer = setInterval(tick, interval * 1000);
    process.on("SIGINT", () => { clearInterval(timer); console.log("\n已停止监控。"); process.exit(0); });
}
function cmdPortfolio(args) {
    const p = new Portfolio();
    p.label = args[0] ?? "默认组合";
    p.add({ symbol: "AAPL", costPrice: 150, shares: 100 });
    p.add({ symbol: "TSLA", costPrice: 200, shares: 50 });
    p.add({ symbol: "NVDA", costPrice: 400, shares: 30 });
    console.log(`\n=== 组合: ${p.label} (${p.size} 只股票) ===`);
    const rows = [];
    let totalPnl = 0;
    for (const r of p.pnl()) {
        totalPnl += r.pnl;
        rows.push([
            r.symbol,
            colorChange(r.pnl, r.pnl >= 0 ? `+${r.pnl.toFixed(2)}` : r.pnl.toFixed(2)),
            colorChange(r.pnlPercent, `${r.pnlPercent >= 0 ? "+" : ""}${r.pnlPercent.toFixed(2)}%`),
        ]);
    }
    rows.push(["合计", colorChange(totalPnl, totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2)), ""]);
    console.log(renderTable(["代码", "盈亏($)", "盈亏%"], rows));
    console.log("");
}
function printHelp() {
    console.log(`
股票价格查询 CLI (Stock Price Query CLI) — Enhanced
====================================================
基于股票代码哈希确定性生成模拟行情数据，支持报价、技术指标、趋势检测、
历史 K 线、涨跌/成交量/市值排行、组合盈亏与定时刷新。

用法:
  stock quote <symbol>               查询当前价格、技术指标与交易信号
  stock history <symbol> [-d days]   查看历史 K 线与收盘价走势 (默认 30 天)
  stock top                          查看涨跌 / 成交量 / 市值排行榜
  stock watch <symbol> [-i seconds]  定时刷新报价 (默认 5 秒)
  stock portfolio [name]             查看模拟组合盈亏
  stock help                         显示本帮助

示例:
  stock quote AAPL
  stock history TSLA -d 10
  stock top
  stock watch NVDA -i 2
  stock portfolio 我的组合

说明: 所有数据均为基于代码哈希确定性生成的模拟数据，仅用于学习演示。
`);
}
// ============================================================
// 26. 入口
// ============================================================
function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const rest = args.slice(1);
    try {
        switch (command) {
            case "quote":
                cmdQuote(rest);
                break;
            case "history":
                cmdHistory(rest);
                break;
            case "top":
                cmdTop();
                break;
            case "watch":
                cmdWatch(rest);
                break;
            case "portfolio":
                cmdPortfolio(rest);
                break;
            case "help":
            case "--help":
            case "-h":
            case undefined:
                printHelp();
                break;
            default:
                console.error(`未知命令: ${command}\n运行 'stock help' 查看帮助。`);
                process.exit(1);
        }
    }
    catch (err) {
        if (err instanceof StockError) {
            console.error(`[${err.code}] ${err.message}`);
        }
        else {
            console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map