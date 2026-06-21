#!/usr/bin/env node
/**
 * 52. 爬取天气信息
 * ------------------------------------------------------------------
 * 演示一个天气信息爬虫：
 *   - 优先尝试从公开天气源（Open-Meteo 等免 key 接口）抓取实时数据
 *   - 网络失败或解析失败时，基于城市名哈希生成稳定的“模拟天气数据”
 *   - 支持命令：weather <city>、forecast <city> [-d days]、compare <city1> <city2>
 *   - 以格式化表格展示温度、湿度、风力、天气状况
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
  maxRedirects?: number;
  headers?: Record<string, string>;
}

interface FetchResult {
  status: number;
  body: string;
  finalUrl: string;
}

interface CurrentWeather {
  city: string;
  temperature: number;     // 摄氏度
  feelsLike: number;
  humidity: number;        // %
  windSpeed: number;       // km/h
  windDir: string;         // 风向（中文）
  pressure: number;        // hPa
  visibility: number;      // km
  condition: string;       // 中文天气描述
  conditionIcon: string;   // 文本图标
  updatedAt: string;
  source: "live" | "demo";
}

interface ForecastDay {
  date: string;
  maxTemp: number;
  minTemp: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  precipProb: number; // 降水概率 %
}

// ---------------------------------------------------------------------------
// HTTP 抓取助手
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeout = opts.timeout ?? 10000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "application/json,text/html,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    ...opts.headers,
  };

  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new Error(`无效 URL: ${target}`));
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
              reject(new Error("重定向次数过多"));
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
          else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            resolve({
              status: res.statusCode || 200,
              body: Buffer.concat(chunks).toString("utf8"),
              finalUrl: currentUrl,
            });
          });
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
// 模拟数据生成（基于城市名哈希 → 稳定结果）
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  return crypto.createHash("md5").update(s, "utf8").digest().readUInt32BE(0);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

const CONDITIONS: Array<{ name: string; icon: string }> = [
  { name: "晴", icon: "☀" },
  { name: "多云", icon: "⛅" },
  { name: "阴", icon: "☁" },
  { name: "小雨", icon: "🌦" },
  { name: "中雨", icon: "🌧" },
  { name: "雷阵雨", icon: "⛈" },
  { name: "雪", icon: "❄" },
  { name: "雾", icon: "🌫" },
];

const WIND_DIRS = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];

function mockCurrent(city: string): CurrentWeather {
  const seed = hashStr(city + new Date().toDateString());
  const baseTemp = 8 + (seed % 25); // 8 ~ 32
  const cond = pick(CONDITIONS, seed >> 3);
  return {
    city,
    temperature: baseTemp,
    feelsLike: baseTemp + ((seed % 7) - 3),
    humidity: 30 + (seed % 60),
    windSpeed: 2 + (seed % 25),
    windDir: pick(WIND_DIRS, seed >> 5),
    pressure: 1000 + (seed % 25),
    visibility: 3 + (seed % 20),
    condition: cond.name,
    conditionIcon: cond.icon,
    updatedAt: new Date().toISOString(),
    source: "demo",
  };
}

function mockForecast(city: string, days: number): ForecastDay[] {
  const baseSeed = hashStr(city);
  const out: ForecastDay[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const seed = hashStr(`${city}-${d.toDateString()}`) ^ baseSeed;
    const cond = pick(CONDITIONS, seed);
    const baseTemp = 6 + ((seed >> 2) % 28);
    out.push({
      date: d.toISOString().slice(0, 10),
      maxTemp: baseTemp + 3 + (seed % 5),
      minTemp: baseTemp - 4 - (seed % 4),
      condition: cond.name,
      humidity: 30 + (seed % 60),
      windSpeed: 2 + (seed % 25),
      precipProb: seed % 100,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 实时数据抓取（Open-Meteo 免费 API，无需 key）
// ---------------------------------------------------------------------------

// 内置城市坐标表（仅用于演示）
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  北京: { lat: 39.9042, lon: 116.4074 },
  上海: { lat: 31.2304, lon: 121.4737 },
  广州: { lat: 23.1291, lon: 113.2644 },
  深圳: { lat: 22.5431, lon: 114.0579 },
  成都: { lat: 30.5728, lon: 104.0668 },
  重庆: { lat: 29.563, lon: 106.5516 },
  杭州: { lat: 30.2741, lon: 120.1551 },
  西安: { lat: 34.3416, lon: 108.9398 },
  武汉: { lat: 30.5928, lon: 114.3055 },
  南京: { lat: 32.0603, lon: 118.7969 },
};

interface GeoCode { lat: number; lon: number; name: string; }

async function geocode(city: string): Promise<GeoCode | null> {
  if (CITY_COORDS[city]) {
    return { ...CITY_COORDS[city], name: city };
  }
  // 使用 Open-Meteo 的 geocoding API
  try {
    const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`;
    const res = await fetchText(u, { timeout: 8000 });
    const data = JSON.parse(res.body) as { results?: Array<{ latitude: number; longitude: number; name: string }> };
    if (data.results && data.results[0]) {
      return { lat: data.results[0].latitude, lon: data.results[0].longitude, name: data.results[0].name };
    }
  } catch (err) {
    console.log(`[地理编码] 失败: ${(err as Error).message}`);
  }
  return null;
}

async function liveCurrent(city: string): Promise<CurrentWeather | null> {
  const geo = await geocode(city);
  if (!geo) return null;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,pressure_msl,visibility,weather_code`;
  try {
    const res = await fetchText(u, { timeout: 8000 });
    const data = JSON.parse(res.body) as {
      current?: {
        temperature_2m: number;
        relative_humidity_2m: number;
        apparent_temperature: number;
        wind_speed_10m: number;
        wind_direction_10m: number;
        pressure_msl: number;
        visibility: number;
        weather_code: number;
      };
    };
    if (!data.current) return null;
    const c = data.current;
    const cond = codeToCondition(c.weather_code);
    const dir = degToDir(c.wind_direction_10m);
    return {
      city: geo.name,
      temperature: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      windSpeed: Math.round(c.wind_speed_10m),
      windDir: dir,
      pressure: Math.round(c.pressure_msl),
      visibility: Math.round(c.visibility / 1000),
      condition: cond.name,
      conditionIcon: cond.icon,
      updatedAt: new Date().toISOString(),
      source: "live",
    };
  } catch (err) {
    console.log(`[实时天气] 失败: ${(err as Error).message}`);
    return null;
  }
}

async function liveForecast(city: string, days: number): Promise<ForecastDay[] | null> {
  const geo = await geocode(city);
  if (!geo) return null;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,wind_speed_10m_max,precipitation_probability_max&timezone=auto&forecast_days=${Math.min(days, 16)}`;
  try {
    const res = await fetchText(u, { timeout: 8000 });
    const data = JSON.parse(res.body) as {
      daily?: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        relative_humidity_2m_mean: number[];
        wind_speed_10m_max: number[];
        precipitation_probability_max: number[];
      };
    };
    if (!data.daily) return null;
    const d = data.daily;
    const out: ForecastDay[] = [];
    for (let i = 0; i < d.time.length; i++) {
      out.push({
        date: d.time[i],
        maxTemp: Math.round(d.temperature_2m_max[i]),
        minTemp: Math.round(d.temperature_2m_min[i]),
        condition: codeToCondition(d.weather_code[i]).name,
        humidity: Math.round(d.relative_humidity_2m_mean[i]),
        windSpeed: Math.round(d.wind_speed_10m_max[i]),
        precipProb: Math.round(d.precipitation_probability_max[i] || 0),
      });
    }
    return out;
  } catch (err) {
    console.log(`[预报] 失败: ${(err as Error).message}`);
    return null;
  }
}

function codeToCondition(code: number): { name: string; icon: string } {
  if (code === 0) return { name: "晴", icon: "☀" };
  if (code <= 2) return { name: "多云", icon: "⛅" };
  if (code === 3) return { name: "阴", icon: "☁" };
  if (code >= 45 && code <= 48) return { name: "雾", icon: "🌫" };
  if (code >= 51 && code <= 57) return { name: "小雨", icon: "🌦" };
  if (code >= 61 && code <= 67) return { name: "中雨", icon: "🌧" };
  if (code >= 71 && code <= 77) return { name: "雪", icon: "❄" };
  if (code >= 80 && code <= 82) return { name: "阵雨", icon: "🌧" };
  if (code >= 95) return { name: "雷阵雨", icon: "⛈" };
  return { name: "未知", icon: "•" };
}

function degToDir(deg: number): string {
  const dirs = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return dirs[Math.round(deg / 45) % 8];
}

// ---------------------------------------------------------------------------
// 表格渲染
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  // 中文按 2 宽度
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}

function printCurrent(w: CurrentWeather): void {
  console.log("");
  console.log(`  ${w.conditionIcon} ${w.city} 当前天气  （数据源: ${w.source === "live" ? "实时" : "演示"}）`);
  console.log("  " + "─".repeat(48));
  console.log(`  温度:     ${w.temperature}°C  (体感 ${w.feelsLike}°C)`);
  console.log(`  天气:     ${w.condition}`);
  console.log(`  湿度:     ${w.humidity}%`);
  console.log(`  风:       ${w.windDir} ${w.windSpeed} km/h`);
  console.log(`  气压:     ${w.pressure} hPa`);
  console.log(`  能见度:   ${w.visibility} km`);
  console.log(`  更新时间: ${w.updatedAt}`);
  console.log("");
}

function printForecast(city: string, days: ForecastDay[]): void {
  console.log("");
  console.log(`  📅 ${city} 未来 ${days.length} 天预报`);
  console.log("  " + "─".repeat(78));
  const header = ["日期", "天气", "最高", "最低", "湿度", "风力", "降水%"];
  const widths = [14, 8, 8, 8, 8, 10, 8];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(78));
  for (const d of days) {
    const row = [d.date, d.condition, `${d.maxTemp}°C`, `${d.minTemp}°C`, `${d.humidity}%`, `${d.windSpeed}km/h`, `${d.precipProb}%`];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

function printCompare(c1: CurrentWeather, c2: CurrentWeather): void {
  console.log("");
  console.log(`  ⚖  ${c1.city}  vs  ${c2.city}`);
  console.log("  " + "─".repeat(56));
  const rows: Array<[string, string, string]> = [
    ["温度", `${c1.temperature}°C`, `${c2.temperature}°C`],
    ["体感", `${c1.feelsLike}°C`, `${c2.feelsLike}°C`],
    ["天气", c1.condition, c2.condition],
    ["湿度", `${c1.humidity}%`, `${c2.humidity}%`],
    ["风", `${c1.windDir} ${c1.windSpeed}`, `${c2.windDir} ${c2.windSpeed}`],
    ["气压", `${c1.pressure} hPa`, `${c2.pressure} hPa`],
    ["能见度", `${c1.visibility} km`, `${c2.visibility} km`],
  ];
  console.log("  " + pad("项目", 10) + pad(c1.city, 22) + pad(c2.city, 22));
  console.log("  " + "─".repeat(56));
  for (const [k, a, b] of rows) {
    console.log("  " + pad(k, 10) + pad(a, 22) + pad(b, 22));
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function cmdWeather(city: string): Promise<void> {
  console.log(`[weather] 查询: ${city}`);
  const live = await liveCurrent(city);
  if (live) {
    console.log("[weather] 使用实时数据。");
    printCurrent(live);
  } else {
    console.log("[weather] 实时数据不可用，使用基于城市哈希的演示数据。");
    printCurrent(mockCurrent(city));
  }
}

async function cmdForecast(city: string, days: number): Promise<void> {
  console.log(`[forecast] 查询: ${city}, 未来 ${days} 天`);
  const live = await liveForecast(city, days);
  if (live && live.length > 0) {
    console.log("[forecast] 使用实时数据。");
    printForecast(city, live);
  } else {
    console.log("[forecast] 实时数据不可用，使用演示数据。");
    printForecast(city, mockForecast(city, days));
  }
}

async function cmdCompare(c1: string, c2: string): Promise<void> {
  console.log(`[compare] ${c1}  vs  ${c2}`);
  const a = (await liveCurrent(c1)) || mockCurrent(c1);
  const b = (await liveCurrent(c2)) || mockCurrent(c2);
  printCompare(a, b);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
天气信息爬虫 - 用法:
  node dist/index.js weather <city>                 查询当前天气
  node dist/index.js forecast <city> [-d days]      查询未来 N 天预报（默认 7）
  node dist/index.js compare <city1> <city2>        对比两座城市
  node dist/index.js help                           显示本帮助

说明:
  - 优先使用 Open-Meteo 公共 API（无需 key）；失败时回退到演示数据。
  - 内置部分中国城市坐标，其他城市将通过 geocoding API 解析。
`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-d" || a === "--days") flags.days = args[++i];
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
  const days = parseInt(flags.days || "7", 10) || 7;

  try {
    switch (cmd) {
      case "weather":
        if (!positional[0]) { console.log("请提供城市名。"); return; }
        await cmdWeather(positional[0]);
        break;
      case "forecast":
        if (!positional[0]) { console.log("请提供城市名。"); return; }
        await cmdForecast(positional[0], Math.min(Math.max(days, 1), 16));
        break;
      case "compare":
        if (!positional[0] || !positional[1]) { console.log("请提供两个城市名。"); return; }
        await cmdCompare(positional[0], positional[1]);
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
