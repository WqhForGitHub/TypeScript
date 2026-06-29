#!/usr/bin/env node
/**
 * 天气查询 CLI（增强版）— 命令行天气查询工具
 * 数据源：Open-Meteo API（免费、无需 API Key）
 *
 * 命令：now / forecast / hourly / search / compare / export / history / help
 * 无参数启动进入交互模式。
 *
 * 高级特性：枚举、可辨识联合、泛型命令处理器、函数重载、自定义错误层级、
 * 生成器/迭代器、ANSI 颜色、readline 交互模式。
 */

import * as readline from "readline";
import * as fs from "fs";
import {
  geocode,
  geocodeMultiple,
  fetchWeather,
  getWeatherDescription,
  getWeatherIcon,
  getWeatherAscii,
  codeToCondition,
  conditionLabel,
  convertTemperature,
  formatWind,
  computeForecastStats,
  detectAlerts,
  TemperatureUnit,
} from "./api";
import type {
  WeatherData,
  GeoLocation,
  DailyForecast,
  HourlyForecast,
  SevereAlert,
  ForecastStats,
} from "./api";

/* ============================== 枚举 ============================== */

enum OutputFormat {
  JSON = "JSON",
  Text = "TEXT",
}
enum DisplayMode {
  Compact = "COMPACT",
  Detailed = "DETAILED",
}
enum SortField {
  Date = "DATE",
  Temperature = "TEMP",
  Precipitation = "PRECIP",
  WindSpeed = "WIND",
}

/* ============================== ANSI 颜色 ============================== */

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
} as const;

type ColorCode = keyof typeof COLORS;

function c(text: string, ...codes: ColorCode[]): string {
  return codes.map((code) => COLORS[code]).join("") + text + COLORS.reset;
}

/* ============================== 自定义错误层级 ============================== */

class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string = "CLI_ERROR",
  ) {
    super(message);
    this.name = "CLIError";
  }
}

class InvalidCommandError extends CLIError {
  constructor(cmd: string) {
    super(`未知命令：「${cmd}」`, "INVALID_COMMAND");
    this.name = "InvalidCommandError";
  }
}

class MissingArgumentError extends CLIError {
  constructor(arg: string) {
    super(`缺少参数：${arg}`, "MISSING_ARG");
    this.name = "MissingArgumentError";
  }
}

class ExportError extends CLIError {
  constructor(message: string) {
    super(message, "EXPORT_ERROR");
    this.name = "ExportError";
  }
}

/* ============== 可辨识联合 / 泛型命令处理器 ============== */

type NowCommand = { readonly kind: "now"; readonly city: string };
type ForecastCommand = { readonly kind: "forecast"; readonly city: string };
type HourlyCommand = { readonly kind: "hourly"; readonly city: string };
type SearchCommand = { readonly kind: "search"; readonly city: string };
type CompareCommand = {
  readonly kind: "compare";
  readonly cities: readonly string[];
};
type HistoryCommand = { readonly kind: "history" };
type ExportCommand = {
  readonly kind: "export";
  readonly city: string;
  readonly format: OutputFormat;
};
type HelpCommand = { readonly kind: "help" };
type ExitCommand = { readonly kind: "exit" };

type CLICommand =
  | NowCommand
  | ForecastCommand
  | HourlyCommand
  | SearchCommand
  | CompareCommand
  | HistoryCommand
  | ExportCommand
  | HelpCommand
  | ExitCommand;

type CommandHandler<T extends CLICommand> = (cmd: T) => Promise<void>;

type HandlerRegistry = {
  [K in CLICommand["kind"]]: CommandHandler<Extract<CLICommand, { kind: K }>>;
};

/* ============================== 格式化工具 ============================== */

const divider = (ch = "─", len = 60): string => ch.repeat(len);

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

const formatHour = (timeStr: string): string =>
  `${String(new Date(timeStr).getHours()).padStart(2, "0")}:00`;

const formatClock = (timeStr: string): string => {
  const d = new Date(timeStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function tempBar(
  current: number,
  min: number,
  max: number,
  width = 20,
): string {
  if (max === min) return "░".repeat(width);
  const pos = Math.round(((current - min) / (max - min)) * (width - 1));
  return "░".repeat(pos) + "█" + "░".repeat(width - pos - 1);
}

/** 函数重载：温度格式化 */
function formatTemperature(celsius: number): string;
function formatTemperature(celsius: number, unit: TemperatureUnit): string;
function formatTemperature(
  celsius: number,
  unit: TemperatureUnit = TemperatureUnit.Celsius,
): string {
  return `${convertTemperature(celsius, TemperatureUnit.Celsius, unit).toFixed(0)}°${unit}`;
}

const locationStr = (loc: GeoLocation): string =>
  loc.admin1
    ? `${loc.name}，${loc.admin1}，${loc.country}`
    : `${loc.name}，${loc.country}`;

function sortForecast(
  daily: readonly DailyForecast[],
  field: SortField = SortField.Date,
): readonly DailyForecast[] {
  const arr = [...daily];
  switch (field) {
    case SortField.Date:
      return arr;
    case SortField.Temperature:
      return arr.sort(
        (a, b) => b.maxTemp + b.minTemp - (a.maxTemp + a.minTemp),
      );
    case SortField.Precipitation:
      return arr.sort((a, b) => b.precipitationSum - a.precipitationSum);
    case SortField.WindSpeed:
      return arr.sort((a, b) => b.windSpeedMax - a.windSpeedMax);
    default:
      return arr;
  }
}

/* ============================== 生成器 / 迭代器 ============================== */

function* iterateForecast(
  daily: readonly DailyForecast[],
): IterableIterator<DailyForecast> {
  for (const d of daily) yield d;
}

function* iterateHours(
  hourly: readonly HourlyForecast[],
  step = 3,
): IterableIterator<HourlyForecast> {
  for (let i = 0; i < hourly.length; i += step) {
    const h = hourly[i];
    if (h) yield h;
  }
}

/* ============================== 搜索历史 ============================== */

class SearchHistory implements Iterable<string> {
  private readonly _entries: string[] = [];
  private readonly _max: number;
  constructor(max = 20) {
    this._max = max;
  }
  add(city: string): void {
    const lower = city.toLowerCase();
    const idx = this._entries.findIndex((e) => e.toLowerCase() === lower);
    if (idx >= 0) this._entries.splice(idx, 1);
    this._entries.unshift(city);
    if (this._entries.length > this._max) this._entries.length = this._max;
  }
  clear(): void {
    this._entries.length = 0;
  }
  get size(): number {
    return this._entries.length;
  }
  [Symbol.iterator](): Iterator<string> {
    let i = 0;
    const entries = this._entries;
    return {
      next(): IteratorResult<string> {
        return i < entries.length
          ? { value: entries[i++]!, done: false }
          : { value: undefined, done: true };
      },
    };
  }
}

const history = new SearchHistory(20);

/* ============================== 显示函数 ============================== */

function displayAlerts(alerts: readonly SevereAlert[]): void {
  console.log(c("  ⚠ 气象预警", "bold", "red"));
  for (const a of alerts) {
    const code: ColorCode =
      a.level === "severe" ? "bgRed" : a.level === "warning" ? "red" : "yellow";
    console.log(
      `  ${c(`[${a.level.toUpperCase()}]`, code)} ${c(a.title, "bold")} — ${a.message}`,
    );
  }
}

function displayCurrent(
  weather: WeatherData,
  mode: DisplayMode = DisplayMode.Detailed,
): void {
  const { location, current } = weather;
  console.log();
  console.log(
    c(
      `  ${getWeatherIcon(current.weatherCode)}  ${locationStr(location)} 当前天气`,
      "bold",
      "cyan",
    ),
  );
  console.log(`  ${divider("═", 60)}`);
  if (mode === DisplayMode.Detailed) {
    getWeatherAscii(current.weatherCode)
      .split("\n")
      .forEach((line) => console.log(`  ${c(line, "yellow")}`));
  }
  console.log(
    `  ${c("天气：", "bold")}${getWeatherIcon(current.weatherCode)} ${getWeatherDescription(current.weatherCode)} (${conditionLabel(codeToCondition(current.weatherCode))})`,
  );
  console.log(
    `  ${c("温度：", "bold")}${c(formatTemperature(current.temperature), "yellow")}   ${c("体感：", "bold")}${c(formatTemperature(current.feelsLike), "yellow")}`,
  );
  if (mode === DisplayMode.Detailed) {
    console.log(
      `  ${c("多单位：", "bold")}${formatTemperature(current.temperature, TemperatureUnit.Celsius)} / ${formatTemperature(current.temperature, TemperatureUnit.Fahrenheit)} / ${formatTemperature(current.temperature, TemperatureUnit.Kelvin)}`,
    );
  }
  console.log(
    `  ${c("湿度：", "bold")}${current.humidity}%   ${c("气压：", "bold")}${current.pressure.toFixed(0)} hPa   ${c("云量：", "bold")}${current.cloudCover ?? "—"}%`,
  );
  console.log(
    `  ${c("风速：", "bold")}${current.windSpeed} km/h   ${c("风向：", "bold")}${formatWind(current.windDirection)}`,
  );
  console.log(
    `  ${c("降水：", "bold")}${current.precipitation} mm   ${c("昼夜：", "bold")}${current.isDay ? c("白天", "yellow") : c("夜晚", "blue")}`,
  );
  const alerts = detectAlerts(weather);
  if (alerts.length > 0) displayAlerts(alerts);
  console.log(`  ${divider("═", 60)}`);
  console.log();
}

function displayStats(daily: readonly DailyForecast[]): void {
  const s: ForecastStats = computeForecastStats(daily);
  console.log(`  ${c("📊 7 日统计", "bold", "magenta")}`);
  console.log(
    `  ${c("平均温度：", "bold")}${formatTemperature(s.avgTemp)}   ${c("最低：", "bold")}${c(formatTemperature(s.minTemp), "blue")}   ${c("最高：", "bold")}${c(formatTemperature(s.maxTemp), "red")}`,
  );
  console.log(
    `  ${c("累计降水：", "bold")}${s.totalPrecip.toFixed(1)} mm   ${c("最大风速：", "bold")}${s.maxWind} km/h`,
  );
}

function displayForecast(weather: WeatherData): void {
  const { location, daily } = weather;
  const allMin = Math.min(...daily.map((d) => d.minTemp));
  const allMax = Math.max(...daily.map((d) => d.maxTemp));
  console.log();
  console.log(c(`  ${locationStr(location)} 7 日天气预报`, "bold", "cyan"));
  console.log(`  ${divider("═", 78)}`);
  console.log(
    c(
      "  日期         天气       最低  最高   温度范围        降水   概率  风速    日出/日落",
      "dim",
    ),
  );
  console.log(`  ${divider("─", 78)}`);
  for (const day of iterateForecast(sortForecast(daily, SortField.Date))) {
    const isToday = day.date === new Date().toISOString().slice(0, 10);
    const dateStr = isToday
      ? c(formatDate(day.date), "green", "bold")
      : formatDate(day.date);
    const desc =
      `${getWeatherIcon(day.weatherCode)}${getWeatherDescription(day.weatherCode)}`.padEnd(
        8,
      );
    const minT = c(formatTemperature(day.minTemp).padStart(5), "blue");
    const maxT = c(formatTemperature(day.maxTemp).padStart(5), "red");
    const bar = tempBar((day.minTemp + day.maxTemp) / 2, allMin, allMax, 12);
    const precip = `${day.precipitationSum}mm`.padStart(6);
    const prob = `${day.precipitationProbability}%`.padStart(4);
    const wind = `${day.windSpeedMax}km/h`.padStart(8);
    const sun = `${formatClock(day.sunrise)}-${formatClock(day.sunset)}`;
    console.log(
      `  ${dateStr}  ${desc} ${minT} ${maxT}  ${bar}  ${precip}  ${prob}  ${wind}  ${sun}`,
    );
  }
  console.log(`  ${divider("═", 78)}`);
  displayStats(daily);
  console.log();
}

function displayHourly(weather: WeatherData): void {
  const { location, hourly } = weather;
  console.log();
  console.log(c(`  ${locationStr(location)} 24 小时逐时预报`, "bold", "cyan"));
  console.log(`  ${divider("═", 68)}`);
  console.log(c("  时间   天气       温度     湿度   降水     风速", "dim"));
  console.log(`  ${divider("─", 68)}`);
  for (const hour of iterateHours(hourly, 3)) {
    const t = formatHour(hour.time);
    const desc =
      `${getWeatherIcon(hour.weatherCode)}${getWeatherDescription(hour.weatherCode)}`.padEnd(
        8,
      );
    const temp = c(formatTemperature(hour.temperature).padStart(6), "yellow");
    const hum = `${hour.humidity}%`.padStart(4);
    const precip = `${hour.precipitation}mm`.padStart(6);
    const wind = `${hour.windSpeed}km/h`.padStart(8);
    console.log(`  ${t}  ${desc} ${temp}  ${hum}   ${precip}  ${wind}`);
  }
  console.log(`  ${divider("═", 68)}`);
  console.log();
}

function displayComparison(items: readonly WeatherData[]): void {
  console.log();
  console.log(c(`  多城市对比（${items.length} 个城市）`, "bold", "cyan"));
  console.log(`  ${divider("═", 82)}`);
  console.log(
    c(
      "  城市             天气     温度    体感    湿度   风速     风向       降水",
      "dim",
    ),
  );
  console.log(`  ${divider("─", 82)}`);
  for (const w of items) {
    const cur = w.current;
    const name = w.location.name.padEnd(14);
    const desc =
      `${getWeatherIcon(cur.weatherCode)}${getWeatherDescription(cur.weatherCode)}`.padEnd(
        7,
      );
    const temp = c(formatTemperature(cur.temperature).padStart(5), "yellow");
    const feels = formatTemperature(cur.feelsLike).padStart(5);
    const hum = `${cur.humidity}%`.padStart(4);
    const wind = `${cur.windSpeed}km/h`.padStart(7);
    const dir = formatWind(cur.windDirection).padEnd(11);
    const precip = `${cur.precipitation}mm`.padStart(5);
    console.log(
      `  ${name}  ${desc} ${temp}  ${feels}  ${hum}   ${wind}  ${dir}  ${precip}`,
    );
  }
  console.log(`  ${divider("═", 82)}`);
  console.log();
}

/* ============================== 加载动画 / 查询 ============================== */

function showLoading(message: string): { stop: () => void } {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i]} ${message}...`);
    i = (i + 1) % frames.length;
  }, 80);
  return {
    stop() {
      clearInterval(interval);
      process.stdout.write("\r" + " ".repeat(message.length + 10) + "\r");
    },
  };
}

/** 函数重载：查询天气 */
function queryWeather(city: string): Promise<WeatherData | null>;
function queryWeather(
  location: GeoLocation,
  label: string,
): Promise<WeatherData | null>;
function queryWeather(
  cityOrLoc: string | GeoLocation,
  label?: string,
): Promise<WeatherData | null> {
  const displayLabel =
    typeof cityOrLoc === "string" ? cityOrLoc : (label ?? cityOrLoc.name);
  const loader = showLoading(`正在查询「${displayLabel}」的天气`);
  const location = typeof cityOrLoc === "string" ? null : cityOrLoc;
  const promise = location
    ? fetchWeather(location)
    : geocode(cityOrLoc as string).then(fetchWeather);
  return promise
    .then((weather) => {
      loader.stop();
      history.add(displayLabel);
      return weather;
    })
    .catch((err: Error) => {
      loader.stop();
      console.error(c(`错误：${err.message}`, "red"));
      return null;
    });
}

function requireCity(city: string, cmdName: string): string | null {
  if (!city || city.trim().length === 0)
    throw new MissingArgumentError(`${cmdName} <城市>`);
  return city.trim();
}

/* ============================== 导出报告 ============================== */

function formatAsText(weather: WeatherData): string {
  const { location, current, daily } = weather;
  const lines: string[] = [];
  lines.push(`天气报告 — ${locationStr(location)}`);
  lines.push("=".repeat(40));
  lines.push(`天气：${getWeatherDescription(current.weatherCode)}`);
  lines.push(`温度：${current.temperature}°C（体感 ${current.feelsLike}°C）`);
  lines.push(
    `湿度：${current.humidity}%  气压：${current.pressure.toFixed(0)} hPa`,
  );
  lines.push(
    `风：${formatWind(current.windDirection)} ${current.windSpeed} km/h`,
  );
  lines.push(`降水：${current.precipitation} mm`);
  const alerts = detectAlerts(weather);
  if (alerts.length > 0) {
    lines.push("", "气象预警：");
    for (const a of alerts)
      lines.push(`  [${a.level}] ${a.title} — ${a.message}`);
  }
  lines.push("", "7 日预报：");
  for (const d of daily) {
    lines.push(
      `  ${d.date} ${getWeatherDescription(d.weatherCode)} ${d.minTemp}~${d.maxTemp}°C  降水${d.precipitationSum}mm`,
    );
  }
  return lines.join("\n");
}

function exportReport(weather: WeatherData, format: OutputFormat): string {
  switch (format) {
    case OutputFormat.JSON:
      return JSON.stringify(
        {
          city: weather.location.name,
          country: weather.location.country,
          coordinates: weather.location.coordinates,
          current: weather.current,
          alerts: detectAlerts(weather),
          stats: computeForecastStats(weather.daily),
          daily: weather.daily,
        },
        null,
        2,
      );
    case OutputFormat.Text:
      return formatAsText(weather);
    default:
      throw new ExportError(`不支持的导出格式：${format as string}`);
  }
}

/* ============================== 命令处理器 ============================== */

const cmdNow: CommandHandler<NowCommand> = async (cmd) => {
  const city = requireCity(cmd.city, "now");
  if (!city) return;
  const w = await queryWeather(city);
  if (w) displayCurrent(w);
};

const cmdForecast: CommandHandler<ForecastCommand> = async (cmd) => {
  const city = requireCity(cmd.city, "forecast");
  if (!city) return;
  const w = await queryWeather(city);
  if (w) displayForecast(w);
};

const cmdHourly: CommandHandler<HourlyCommand> = async (cmd) => {
  const city = requireCity(cmd.city, "hourly");
  if (!city) return;
  const w = await queryWeather(city);
  if (w) displayHourly(w);
};

const cmdSearch: CommandHandler<SearchCommand> = async (cmd) => {
  const city = requireCity(cmd.city, "search");
  if (!city) return;
  const loader = showLoading(`正在搜索「${city}」`);
  try {
    const locations = await geocodeMultiple(city);
    loader.stop();
    console.log();
    console.log(c(`  搜索结果：${city}`, "bold", "cyan"));
    console.log(`  ${divider("═", 50)}`);
    locations.forEach((loc, i) => {
      const admin = loc.admin1 ? `，${loc.admin1}` : "";
      console.log(
        `  ${c(`[${i + 1}]`, "green")} ${loc.name}${admin}，${loc.country}  (${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)})`,
      );
    });
    console.log(`  ${divider("═", 50)}`);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        c("  请输入编号查看天气（直接回车取消）：", "yellow"),
        resolve,
      );
    });
    rl.close();
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < locations.length) {
      const selected = locations[idx]!;
      const w = await queryWeather(selected, selected.name);
      if (w) displayCurrent(w);
    } else {
      console.log(c("  已取消。", "dim"));
    }
  } catch (err) {
    loader.stop();
    console.error(c(`错误：${(err as Error).message}`, "red"));
  }
};

const cmdCompare: CommandHandler<CompareCommand> = async (cmd) => {
  if (cmd.cities.length < 2) {
    throw new MissingArgumentError("compare <城市1> <城市2> ...");
  }
  const results: WeatherData[] = [];
  for (const city of cmd.cities) {
    const trimmed = city.trim();
    if (!trimmed) continue;
    const w = await queryWeather(trimmed);
    if (w) results.push(w);
  }
  if (results.length > 0) displayComparison(results);
};

const cmdHistory: CommandHandler<HistoryCommand> = async () => {
  console.log();
  console.log(c("  搜索历史", "bold", "cyan"));
  console.log(`  ${divider("═", 40)}`);
  if (history.size === 0) {
    console.log(c("  （暂无历史记录）", "dim"));
  } else {
    let i = 1;
    for (const city of history) {
      console.log(`  ${c(`[${i++}]`, "green")} ${city}`);
    }
  }
  console.log(`  ${divider("═", 40)}`);
  console.log();
};

const cmdExport: CommandHandler<ExportCommand> = async (cmd) => {
  const city = requireCity(cmd.city, "export <json|text>");
  if (!city) return;
  const w = await queryWeather(city);
  if (!w) return;
  const content = exportReport(w, cmd.format);
  const ext = cmd.format === OutputFormat.JSON ? "json" : "txt";
  const safeName = city.replace(/[^\w\u4e00-\u9fa5]+/g, "_");
  const filename = `weather-${safeName}-${Date.now()}.${ext}`;
  try {
    fs.writeFileSync(filename, content, "utf8");
    console.log(c(`  已导出：${filename}（${content.length} 字节）`, "green"));
  } catch (err) {
    throw new ExportError(`导出失败：${(err as Error).message}`);
  }
};

const cmdHelp: CommandHandler<HelpCommand> = async () => {
  console.log(
    [
      c("天气查询 CLI — 命令行天气查询工具（增强版）", "bold", "cyan"),
      "",
      "用法： weather-cli <command> [args...]",
      "",
      "命令：",
      `  now <城市>                    ${c("查询当前天气", "dim")}`,
      `  forecast <城市>               ${c("查看 7 日天气预报（含统计）", "dim")}`,
      `  hourly <城市>                 ${c("查看 24 小时逐时预报", "dim")}`,
      `  search <城市>                 ${c("搜索城市并选择查看天气", "dim")}`,
      `  compare <城市1> <城市2> ...   ${c("多城市对比", "dim")}`,
      `  export <json|text> <城市>     ${c("导出天气报告", "dim")}`,
      `  history                       ${c("查看搜索历史", "dim")}`,
      `  help                          ${c("显示帮助信息", "dim")}`,
      "",
      "别名： now→n/current  forecast→f/fc  hourly→h  search→s/find  compare→cmp",
      "",
      "示例：",
      "  weather-cli now 北京",
      "  weather-cli compare 北京 上海 东京",
      "  weather-cli export json 广州",
      "",
      "数据源：Open-Meteo API（免费、无需 API Key）  https://open-meteo.com",
    ].join("\n"),
  );
};

const cmdExit: CommandHandler<ExitCommand> = async () => {
  console.log(c("  再见！", "dim"));
  process.exit(0);
};

/* ============================== 命令分发 ============================== */

const handlers: HandlerRegistry = {
  now: cmdNow,
  forecast: cmdForecast,
  hourly: cmdHourly,
  search: cmdSearch,
  compare: cmdCompare,
  history: cmdHistory,
  export: cmdExport,
  help: cmdHelp,
  exit: cmdExit,
};

async function handleCommand(cmd: CLICommand): Promise<void> {
  const handler = handlers[cmd.kind] as CommandHandler<CLICommand>;
  await handler(cmd);
}

function parseCommand(args: readonly string[]): CLICommand {
  const cmd = (args[0] ?? "help").toLowerCase();
  const rest = args.slice(1).join(" ").trim();
  switch (cmd) {
    case "now":
    case "current":
    case "n":
      return { kind: "now", city: rest };
    case "forecast":
    case "fc":
    case "f":
      return { kind: "forecast", city: rest };
    case "hourly":
    case "h":
      return { kind: "hourly", city: rest };
    case "search":
    case "s":
    case "find":
      return { kind: "search", city: rest };
    case "compare":
    case "cmp":
      return { kind: "compare", cities: args.slice(1) };
    case "history":
      return { kind: "history" };
    case "export": {
      const fmt =
        (args[1] ?? "").toUpperCase() === OutputFormat.JSON
          ? OutputFormat.JSON
          : OutputFormat.Text;
      return {
        kind: "export",
        city: args.slice(2).join(" ").trim(),
        format: fmt,
      };
    }
    case "help":
    case "--help":
    case "-h":
      return { kind: "help" };
    case "exit":
    case "quit":
    case "q":
      return { kind: "exit" };
    default:
      if (args.length > 0 && args[0] !== undefined)
        return { kind: "now", city: args.join(" ").trim() };
      throw new InvalidCommandError(cmd);
  }
}

/* ============================== 交互模式 ============================== */

async function interactiveMode(): Promise<void> {
  console.log();
  console.log(c("  天气查询 CLI — 交互模式", "bold", "cyan"));
  console.log(`  ${divider("═", 60)}`);
  console.log(c("  直接输入城市名查看当前天气", "dim"));
  console.log(
    c(
      "  命令：now/forecast/hourly/search/compare/export/history/help/exit",
      "dim",
    ),
  );
  console.log(`  ${divider("═", 60)}`);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c("天气 > ", "green"),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    const parts = input.split(/\s+/);
    if (["exit", "quit", "q"].includes(parts[0]!.toLowerCase())) {
      console.log(c("  再见！", "dim"));
      rl.close();
      return;
    }
    try {
      const cmd = parseCommand(parts);
      await handleCommand(cmd);
    } catch (err) {
      const msg =
        err instanceof CLIError ? err.message : (err as Error).message;
      console.error(c(`错误：${msg}`, "red"));
    }
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

/* ============================== 入口 ============================== */

async function main(): Promise<void> {
  const argv: string[] = process.argv.slice(2);

  if (argv.length === 0) {
    await interactiveMode();
    return;
  }

  try {
    const cmd = parseCommand(argv);
    await handleCommand(cmd);
  } catch (err) {
    const msg = err instanceof CLIError ? err.message : (err as Error).message;
    console.error(c(`错误：${msg}`, "red"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(c(`致命错误：${(err as Error).message}`, "red"));
  process.exit(1);
});
