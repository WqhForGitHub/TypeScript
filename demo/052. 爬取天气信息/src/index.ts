#!/usr/bin/env node
/**
 * 52. 爬取天气信息 (Enhanced TypeScript Edition)
 * ------------------------------------------------------------------
 * 类型安全的天气爬虫：Open-Meteo 实时数据 + 城市名哈希模拟回退。
 * 命令：weather <city> | forecast <city> [-d days] | compare <c1> <c2> | help
 * 仅使用 Node.js 内置模块：http、https、url、crypto、zlib、buffer。
 *
 * 集中演示高级 TS 特性：字符串/常规枚举、泛型类与约束、判别联合、
 * 映射类型、条件类型、模板字面量类型、抽象类与子类、函数重载、
 * 自定义错误层级、接口(可选/只读/索引签名)、satisfies、getter/setter、
 * 生成器/迭代器、Symbol 唯一键、as const、类型守卫、元组与只读元组。
 */
import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as crypto from "crypto";
import * as zlib from "zlib";

// ---- 枚举 ----
enum Command {
  Weather = "weather",
  Forecast = "forecast",
  Compare = "compare",
  Help = "help",
}
enum WeatherCondition {
  Sunny = "晴",
  Cloudy = "多云",
  Overcast = "阴",
  LightRain = "小雨",
  ModRain = "中雨",
  Thunder = "雷阵雨",
  Snow = "雪",
  Fog = "雾",
  Shower = "阵雨",
  Unknown = "未知",
}
enum Unit {
  Celsius = "°C",
  KmPerHour = "km/h",
  HPa = "hPa",
  Km = "km",
  Percent = "%",
}
/** 常规枚举（非 const enum，便于 Object.values） */
enum ErrorCode {
  NetworkError = 1001,
  ParseError = 1002,
  Timeout = 1003,
  RedirectLoop = 1004,
  InvalidUrl = 1005,
  NoData = 1006,
  InvalidArgs = 1007,
}
enum ForecastType {
  Daily,
  Hourly,
}

// ---- 高级类型：模板字面量 / 条件 / 映射 / 元组 ----
type CommandName = `${Command}`;
type SourceTag = "live" | "demo";
type Unwrap<T> = T extends ReadonlyArray<infer U> ? U : T;
type SourceLabel<T extends SourceTag> = T extends "live" ? "实时" : "演示";
/** 映射类型（键重映射 + Capitalize + 模板字面量） */
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};
type Coord = readonly [lat: number, lon: number];
type CompareRow = readonly [label: string, a: string, b: string];

// ---- 判别联合 ----
interface CurrentWeather {
  readonly kind: "current";
  city: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDir: string;
  pressure: number;
  visibility: number;
  condition: WeatherCondition;
  conditionIcon: string;
  updatedAt: string;
  source: SourceTag;
}
interface ForecastDay {
  readonly kind: "forecast";
  date: string;
  maxTemp: number;
  minTemp: number;
  condition: WeatherCondition;
  humidity: number;
  windSpeed: number;
  precipProb: number;
}
interface HourlyForecast {
  readonly kind: "hourly";
  time: string;
  temperature: number;
  condition: WeatherCondition;
  precipProb: number;
}
type WeatherData = CurrentWeather | ForecastDay | HourlyForecast;

// 类型守卫
function isCurrent(d: WeatherData): d is CurrentWeather {
  return d.kind === "current";
}
function isForecast(d: WeatherData): d is ForecastDay {
  return d.kind === "forecast";
}
function isHourly(d: WeatherData): d is HourlyForecast {
  return d.kind === "hourly";
}

// ---- 接口（可选 / 只读 / 索引签名） ----
interface FetchOptions {
  readonly timeout?: number;
  readonly maxRedirects?: number;
  readonly headers?: Record<string, string>;
}
interface FetchResult {
  readonly status: number;
  readonly body: string;
  readonly finalUrl: string;
}
interface GeoCode {
  readonly lat: number;
  readonly lon: number;
  readonly name: string;
}
interface ConditionInfo {
  readonly name: WeatherCondition;
  readonly icon: string;
  readonly codeRange?: readonly [number, number];
}
interface CityRegistry {
  [city: string]: Coord | Unit;
  readonly defaultUnit: Unit;
}

// ---- 自定义错误类层级（带 code） ----
class WeatherError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WeatherError";
  }
}
class NetworkError extends WeatherError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.NetworkError, cause);
    this.name = "NetworkError";
  }
}
class TimeoutError extends WeatherError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.Timeout, cause);
    this.name = "TimeoutError";
  }
}

// ---- Symbol 唯一属性键 ----
const SOURCE_ID = Symbol("sourceId");
const CACHE_TIMESTAMP = Symbol("cacheTimestamp");
interface WithSymbols {
  [SOURCE_ID]: number;
  [CACHE_TIMESTAMP]: number;
}

// ---- HTTP 抓取助手（函数重载） ----
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string): Promise<FetchResult>;
function fetchText(rawUrl: string, opts: FetchOptions): Promise<FetchResult>;
function fetchText(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const timeout = opts.timeout ?? 10000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "application/json,text/html,*/*;q=0.8",
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
        reject(new WeatherError(`无效 URL: ${target}`, ErrorCode.InvalidUrl));
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
              reject(
                new WeatherError("重定向次数过多", ErrorCode.RedirectLoop),
              );
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
            reject(new NetworkError(err.message, err)),
          );
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new TimeoutError(`请求超时 (${timeout}ms)`)),
      );
      req.on("error", (err: Error) =>
        reject(new NetworkError(err.message, err)),
      );
      req.end();
    };
    attempt(currentUrl);
  });
}

// ---- 工具函数与常量 ----
function hashStr(s: string): number {
  return crypto.createHash("md5").update(s, "utf8").digest().readUInt32BE(0);
}
function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

/** satisfies 运算符：校验结构而不拓宽类型 */
const CONDITIONS = [
  { name: WeatherCondition.Sunny, icon: "☀" },
  { name: WeatherCondition.Cloudy, icon: "⛅" },
  { name: WeatherCondition.Overcast, icon: "☁" },
  { name: WeatherCondition.LightRain, icon: "🌦" },
  { name: WeatherCondition.ModRain, icon: "🌧" },
  { name: WeatherCondition.Thunder, icon: "⛈" },
  { name: WeatherCondition.Snow, icon: "❄" },
  { name: WeatherCondition.Fog, icon: "🌫" },
] satisfies readonly ConditionInfo[];

/** as const 断言 */
const WIND_DIRS = [
  "北风",
  "东北风",
  "东风",
  "东南风",
  "南风",
  "西南风",
  "西风",
  "西北风",
] as const;

const CITY_COORDS = {
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
} as const;

function codeToCondition(code: number): ConditionInfo {
  if (code === 0) return { name: WeatherCondition.Sunny, icon: "☀" };
  if (code <= 2) return { name: WeatherCondition.Cloudy, icon: "⛅" };
  if (code === 3) return { name: WeatherCondition.Overcast, icon: "☁" };
  if (code >= 45 && code <= 48)
    return { name: WeatherCondition.Fog, icon: "🌫" };
  if (code >= 51 && code <= 57)
    return { name: WeatherCondition.LightRain, icon: "🌦" };
  if (code >= 61 && code <= 67)
    return { name: WeatherCondition.ModRain, icon: "🌧" };
  if (code >= 71 && code <= 77)
    return { name: WeatherCondition.Snow, icon: "❄" };
  if (code >= 80 && code <= 82)
    return { name: WeatherCondition.Shower, icon: "🌧" };
  if (code >= 95) return { name: WeatherCondition.Thunder, icon: "⛈" };
  return { name: WeatherCondition.Unknown, icon: "•" };
}
function degToDir(deg: number): string {
  return WIND_DIRS[Math.round(deg / 45) % 8];
}

/** 使用映射类型 Getters<T> 派生 getter 风格键名 */
type CurrentWeatherGetters = Getters<CurrentWeather>;
function getterNameFor(key: keyof CurrentWeather): keyof CurrentWeatherGetters {
  return ("get" +
    key.charAt(0).toUpperCase() +
    key.slice(1)) as keyof CurrentWeatherGetters;
}
/** 使用条件类型 SourceLabel */
function sourceText<T extends SourceTag>(s: T): SourceLabel<T> {
  return (s === "live" ? "实时" : "演示") as SourceLabel<T>;
}
/** 使用 ForecastType 枚举 */
function describeForecast(type: ForecastType): string {
  return type === ForecastType.Daily ? "每日预报" : "逐时预报";
}

// ---- 抽象类 + 具体子类 ----
abstract class AbstractWeatherSource implements WithSymbols {
  abstract readonly name: string;
  protected callCount = 0;
  [SOURCE_ID]: number;
  [CACHE_TIMESTAMP] = 0;
  constructor() {
    this[SOURCE_ID] = hashStr(this.constructor.name);
  }
  get calls(): number {
    return this.callCount;
  }
  get lastFetchTs(): number {
    return this[CACHE_TIMESTAMP];
  }
  set lastFetchTs(v: number) {
    this[CACHE_TIMESTAMP] = v;
  }
  abstract fetchCurrent(city: string): Promise<CurrentWeather | null>;
  abstract fetchForecast(
    city: string,
    days: number,
  ): Promise<ForecastDay[] | null>;
  protected bump(): void {
    this.callCount++;
    this[CACHE_TIMESTAMP] = Date.now();
  }
}

class OpenMeteoSource extends AbstractWeatherSource {
  readonly name = "OpenMeteo";

  async geocode(city: string): Promise<GeoCode | null> {
    const built = CITY_COORDS as { [k: string]: { lat: number; lon: number } };
    if (built[city])
      return { lat: built[city].lat, lon: built[city].lon, name: city };
    try {
      const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`;
      const res = await fetchText(u, { timeout: 8000 });
      const data = JSON.parse(res.body) as {
        results?: Array<{ latitude: number; longitude: number; name: string }>;
      };
      if (data.results && data.results[0]) {
        return {
          lat: data.results[0].latitude,
          lon: data.results[0].longitude,
          name: data.results[0].name,
        };
      }
    } catch (err) {
      console.log(`[地理编码] 失败: ${(err as Error).message}`);
    }
    return null;
  }

  async fetchCurrent(city: string): Promise<CurrentWeather | null> {
    this.bump();
    const geo = await this.geocode(city);
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
      return {
        kind: "current",
        city: geo.name,
        temperature: Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        humidity: Math.round(c.relative_humidity_2m),
        windSpeed: Math.round(c.wind_speed_10m),
        windDir: degToDir(c.wind_direction_10m),
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

  async fetchForecast(
    city: string,
    days: number,
  ): Promise<ForecastDay[] | null> {
    this.bump();
    const geo = await this.geocode(city);
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
          kind: "forecast",
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
}

class MockSource extends AbstractWeatherSource {
  readonly name = "Mock";
  fetchCurrent(city: string): Promise<CurrentWeather | null> {
    this.bump();
    const seed = hashStr(city + new Date().toDateString());
    const baseTemp = 8 + (seed % 25);
    const cond = pick(CONDITIONS, seed >> 3);
    return Promise.resolve({
      kind: "current",
      city,
      temperature: baseTemp,
      feelsLike: baseTemp + ((seed % 7) - 3),
      humidity: 30 + (seed % 60),
      windSpeed: 2 + (seed % 25),
      windDir: pick([...WIND_DIRS], seed >> 5),
      pressure: 1000 + (seed % 25),
      visibility: 3 + (seed % 20),
      condition: cond.name,
      conditionIcon: cond.icon,
      updatedAt: new Date().toISOString(),
      source: "demo",
    });
  }
  fetchForecast(city: string, days: number): Promise<ForecastDay[] | null> {
    this.bump();
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
        kind: "forecast",
        date: d.toISOString().slice(0, 10),
        maxTemp: baseTemp + 3 + (seed % 5),
        minTemp: baseTemp - 4 - (seed % 4),
        condition: cond.name,
        humidity: 30 + (seed % 60),
        windSpeed: 2 + (seed % 25),
        precipProb: seed % 100,
      });
    }
    return Promise.resolve(out);
  }
}

// ---- 泛型类（带约束）：天气缓存 ----
class WeatherCache<T extends { readonly kind: string }> {
  private store = new Map<string, { ts: number; data: T }>();
  constructor(private readonly ttl: number = 60_000) {}
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttl) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }
  set(key: string, data: T): void {
    this.store.set(key, { ts: Date.now(), data });
  }
  get size(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
}

// ---- 可迭代预报集合（生成器 / 迭代器） ----
class ForecastCollection implements Iterable<ForecastDay> {
  constructor(private readonly days: readonly ForecastDay[]) {}
  *[Symbol.iterator](): Iterator<ForecastDay> {
    for (const d of this.days) yield d;
  }
  *entries(): IterableIterator<[number, ForecastDay]> {
    for (let i = 0; i < this.days.length; i++) yield [i, this.days[i]];
  }
  get length(): number {
    return this.days.length;
  }
  at(i: number): ForecastDay | undefined {
    return this.days[i];
  }
  /** 使用条件类型 Unwrap：返回元素类型 */
  first(): Unwrap<readonly ForecastDay[]> | undefined {
    return this.days[0];
  }
}

// ---- 带 getter/setter 的配置类 ----
class AppConfig {
  private _unit: Unit = Unit.Celsius;
  private _defaultDays = 7;
  private _timeout = 10_000;
  get unit(): Unit {
    return this._unit;
  }
  set unit(v: Unit) {
    this._unit = v;
  }
  get defaultDays(): number {
    return this._defaultDays;
  }
  set defaultDays(v: number) {
    if (v < 1 || v > 16)
      throw new WeatherError("days 超出范围 (1~16)", ErrorCode.InvalidArgs);
    this._defaultDays = v;
  }
  get timeout(): number {
    return this._timeout;
  }
  set timeout(v: number) {
    this._timeout = Math.max(1000, v);
  }
}

// ---- 表格渲染 ----
function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}
function printCurrent(w: CurrentWeather): void {
  console.log("");
  console.log(
    `  ${w.conditionIcon} ${w.city} 当前天气  （数据源: ${sourceText(w.source)}）`,
  );
  console.log("  " + "─".repeat(48));
  console.log(
    `  温度:     ${w.temperature}${Unit.Celsius}  (体感 ${w.feelsLike}${Unit.Celsius})`,
  );
  console.log(`  天气:     ${w.condition}`);
  console.log(`  湿度:     ${w.humidity}${Unit.Percent}`);
  console.log(`  风:       ${w.windDir} ${w.windSpeed} ${Unit.KmPerHour}`);
  console.log(`  气压:     ${w.pressure} ${Unit.HPa}`);
  console.log(`  能见度:   ${w.visibility} ${Unit.Km}`);
  console.log(`  更新时间: ${w.updatedAt}`);
  console.log("");
}
function printForecast(
  city: string,
  days: ForecastDay[] | ForecastCollection,
): void {
  const list: readonly ForecastDay[] = Array.isArray(days) ? days : [...days];
  console.log("");
  console.log(
    `  📅 ${city} 未来 ${list.length} 天预报  （${describeForecast(ForecastType.Daily)}）`,
  );
  console.log("  " + "─".repeat(78));
  const header = ["日期", "天气", "最高", "最低", "湿度", "风力", "降水%"];
  const widths = [14, 8, 8, 8, 8, 10, 8];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(78));
  for (const d of list) {
    const row = [
      d.date,
      d.condition,
      `${d.maxTemp}${Unit.Celsius}`,
      `${d.minTemp}${Unit.Celsius}`,
      `${d.humidity}${Unit.Percent}`,
      `${d.windSpeed}${Unit.KmPerHour}`,
      `${d.precipProb}${Unit.Percent}`,
    ];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}
function printCompare(c1: CurrentWeather, c2: CurrentWeather): void {
  console.log("");
  console.log(`  ⚖  ${c1.city}  vs  ${c2.city}`);
  console.log("  " + "─".repeat(56));
  const rows: ReadonlyArray<CompareRow> = [
    [
      "温度",
      `${c1.temperature}${Unit.Celsius}`,
      `${c2.temperature}${Unit.Celsius}`,
    ],
    [
      "体感",
      `${c1.feelsLike}${Unit.Celsius}`,
      `${c2.feelsLike}${Unit.Celsius}`,
    ],
    ["天气", c1.condition, c2.condition],
    ["湿度", `${c1.humidity}${Unit.Percent}`, `${c2.humidity}${Unit.Percent}`],
    ["风", `${c1.windDir} ${c1.windSpeed}`, `${c2.windDir} ${c2.windSpeed}`],
    ["气压", `${c1.pressure} ${Unit.HPa}`, `${c2.pressure} ${Unit.HPa}`],
    ["能见度", `${c1.visibility} ${Unit.Km}`, `${c2.visibility} ${Unit.Km}`],
  ];
  console.log("  " + pad("项目", 10) + pad(c1.city, 22) + pad(c2.city, 22));
  console.log("  " + "─".repeat(56));
  for (const [k, a, b] of rows)
    console.log("  " + pad(k, 10) + pad(a, 22) + pad(b, 22));
  console.log("");
}

/** 演示类型守卫与判别联合：根据数据类型打印一行摘要 */
function summarize(d: WeatherData): string {
  if (isCurrent(d))
    return `${d.city} 当前 ${d.condition} ${d.temperature}${Unit.Celsius}`;
  if (isForecast(d))
    return `${d.date} ${d.condition} ${d.minTemp}~${d.maxTemp}${Unit.Celsius}`;
  if (isHourly(d))
    return `${d.time} ${d.condition} ${d.temperature}${Unit.Celsius}`;
  return "未知数据";
}

// ---- 命令实现 ----
const liveSource = new OpenMeteoSource();
const mockSource = new MockSource();
const cache = new WeatherCache<CurrentWeather>();
const config = new AppConfig();

async function cmdWeather(city: string): Promise<void> {
  console.log(`[${Command.Weather}] 查询: ${city}`);
  const cached = cache.get(`current:${city}`);
  if (cached) {
    console.log(`[${Command.Weather}] 命中缓存。`);
    printCurrent(cached);
    return;
  }
  const live = await liveSource.fetchCurrent(city);
  if (live) {
    console.log(
      `[${Command.Weather}] 使用实时数据。  (getter示例: ${getterNameFor("city")})`,
    );
    cache.set(`current:${city}`, live);
    printCurrent(live);
  } else {
    console.log(
      `[${Command.Weather}] 实时数据不可用，使用基于城市哈希的演示数据。`,
    );
    const mock = await mockSource.fetchCurrent(city);
    if (mock) printCurrent(mock);
  }
}
async function cmdForecast(city: string, days: number): Promise<void> {
  console.log(`[${Command.Forecast}] 查询: ${city}, 未来 ${days} 天`);
  const live = await liveSource.fetchForecast(city, days);
  if (live && live.length > 0) {
    console.log(`[${Command.Forecast}] 使用实时数据。`);
    printForecast(city, new ForecastCollection(live));
  } else {
    console.log(`[${Command.Forecast}] 实时数据不可用，使用演示数据。`);
    const mock = await mockSource.fetchForecast(city, days);
    if (mock) printForecast(city, new ForecastCollection(mock));
  }
}
async function cmdCompare(c1: string, c2: string): Promise<void> {
  console.log(`[${Command.Compare}] ${c1}  vs  ${c2}`);
  const a =
    (await liveSource.fetchCurrent(c1)) ?? (await mockSource.fetchCurrent(c1));
  const b =
    (await liveSource.fetchCurrent(c2)) ?? (await mockSource.fetchCurrent(c2));
  if (!a || !b) {
    console.log("无法获取对比数据。");
    return;
  }
  printCompare(a, b);
  console.log(`  摘要: ${summarize(a)} / ${summarize(b)}`);
}

// ---- 入口 ----
function printHelp(): void {
  console.log(`
天气信息爬虫 - 用法:
  node dist/index.js ${Command.Weather} <city>                 查询当前天气
  node dist/index.js ${Command.Forecast} <city> [-d days]      查询未来 N 天预报（默认 7）
  node dist/index.js ${Command.Compare} <city1> <city2>        对比两座城市
  node dist/index.js ${Command.Help}                           显示本帮助

说明:
  - 优先使用 Open-Meteo 公共 API（无需 key）；失败时回退到演示数据。
  - 内置部分中国城市坐标，其他城市将通过 geocoding API 解析。
`);
}
interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}
function parseFlags(args: readonly string[]): ParsedArgs {
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
const VALID_COMMANDS: ReadonlySet<Command> = new Set<Command>(
  Object.values(Command) as Command[],
);
/** 类型守卫：判断字符串是否为合法命令 */
function isCommand(s: string): s is Command {
  return VALID_COMMANDS.has(s as Command);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === Command.Help || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmdRaw = argv[0];
  if (!isCommand(cmdRaw)) {
    console.log(`未知命令: ${cmdRaw}`);
    printHelp();
    return;
  }
  const cmd: Command = cmdRaw;
  const { positional, flags } = parseFlags(argv.slice(1));
  const parsedDays = parseInt(flags.days || "7", 10) || 7;
  config.defaultDays = Math.min(Math.max(parsedDays, 1), 16);
  const days = config.defaultDays;
  try {
    switch (cmd) {
      case Command.Weather:
        if (!positional[0]) {
          console.log("请提供城市名。");
          return;
        }
        await cmdWeather(positional[0]);
        break;
      case Command.Forecast:
        if (!positional[0]) {
          console.log("请提供城市名。");
          return;
        }
        await cmdForecast(positional[0], days);
        break;
      case Command.Compare:
        if (!positional[0] || !positional[1]) {
          console.log("请提供两个城市名。");
          return;
        }
        await cmdCompare(positional[0], positional[1]);
        break;
      case Command.Help:
        printHelp();
        break;
    }
  } catch (err) {
    if (err instanceof WeatherError) {
      console.error(
        `运行出错 [${err.code} ${ErrorCode[err.code]}]:`,
        err.message,
      );
    } else {
      console.error("运行出错:", (err as Error).message);
    }
    process.exit(1);
  }
}

main();
