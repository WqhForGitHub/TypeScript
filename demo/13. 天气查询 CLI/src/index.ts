#!/usr/bin/env node

/**
 * 天气查询 CLI — 命令行天气查询工具
 *
 * 功能：
 *   - now <城市>           查询当前天气
 *   - forecast <城市>      查看 7 日天气预报
 *   - hourly <城市>        查看 24 小时逐时预报
 *   - search <城市>        搜索城市（多结果选择）
 *   - help                 显示帮助信息
 *   - 交互模式             不带参数启动进入交互模式
 *
 * 数据源：Open-Meteo API（免费、无需 API Key）
 */

import * as readline from "readline";
import {
  geocode,
  geocodeMultiple,
  fetchWeather,
  getWeatherDescription,
  getWeatherIcon,
  GeoLocation,
  WeatherData,
} from "./api";

/* ============================== 终端颜色工具 ============================== */

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};

function c(text: string, ...codes: string[]): string {
  return codes.join("") + text + color.reset;
}

/* ============================== 格式化工具 ============================== */

function divider(char: string = "─", length: number = 60): string {
  return char.repeat(length);
}

function windDirection(degrees: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  const idx = Math.round(degrees / 45) % 8;
  return dirs[idx]!;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = weekdays[d.getDay()];
  return `${month}月${day}日 ${weekday}`;
}

function formatHour(timeStr: string): string {
  const d = new Date(timeStr);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function tempBar(
  current: number,
  min: number,
  max: number,
  width: number = 20,
): string {
  if (max === min) return "░".repeat(width);
  const pos = Math.round(((current - min) / (max - min)) * (width - 1));
  return "░".repeat(pos) + "█" + "░".repeat(width - pos - 1);
}

/* ============================== 显示函数 ============================== */

function displayCurrent(weather: WeatherData): void {
  const { location, current } = weather;
  const locationStr = location.admin1
    ? `${location.name}，${location.admin1}，${location.country}`
    : `${location.name}，${location.country}`;

  console.log();
  console.log(
    c(
      `  ${getWeatherIcon(current.weatherCode)}  ${locationStr} 当前天气`,
      color.bold,
      color.cyan,
    ),
  );
  console.log(`  ${divider("═", 56)}`);
  console.log(
    `  ${c("天气：", color.bold)}${getWeatherIcon(current.weatherCode)} ${getWeatherDescription(current.weatherCode)}`,
  );
  console.log(
    `  ${c("温度：", color.bold)}${c(`${current.temperature}°C`, color.yellow)}    ${c("体感：", color.bold)}${c(`${current.feelsLike}°C`, color.yellow)}`,
  );
  console.log(
    `  ${c("湿度：", color.bold)}${current.humidity}%     ${c("气压：", color.bold)}${current.pressure.toFixed(0)} hPa`,
  );
  console.log(
    `  ${c("风速：", color.bold)}${current.windSpeed} km/h  ${c("风向：", color.bold)}${windDirection(current.windDirection)}（${current.windDirection}°）`,
  );
  console.log(
    `  ${c("降水：", color.bold)}${current.precipitation} mm   ${c("昼夜：", color.bold)}${current.isDay ? c("白天", color.yellow) : c("夜晚", color.blue)}`,
  );
  console.log(`  ${divider("═", 56)}`);
  console.log();
}

function displayForecast(weather: WeatherData): void {
  const { location, daily, current } = weather;
  const locationStr = location.admin1
    ? `${location.name}，${location.admin1}，${location.country}`
    : `${location.name}，${location.country}`;

  // 找到整体温度范围用于温度条
  const allMin = Math.min(...daily.map((d) => d.minTemp));
  const allMax = Math.max(...daily.map((d) => d.maxTemp));

  console.log();
  console.log(c(`  ${locationStr} 7 日天气预报`, color.bold, color.cyan));
  console.log(`  ${divider("═", 72)}`);

  // 表头
  console.log(
    c("  日期         天气     最低  最高   降水    降水概率  风速", color.dim),
  );
  console.log(`  ${divider("─", 72)}`);

  for (const day of daily) {
    const isToday = day.date === new Date().toISOString().slice(0, 10);
    const dateStr = isToday
      ? c(formatDate(day.date), color.green, color.bold)
      : formatDate(day.date);

    const icon = getWeatherIcon(day.weatherCode);
    const desc = getWeatherDescription(day.weatherCode);
    const weatherStr = `${icon}${desc}`.padEnd(6);

    const minTempStr = c(`${day.minTemp}°C`.padStart(5), color.blue);
    const maxTempStr = c(`${day.maxTemp}°C`.padStart(5), color.red);

    const bar = tempBar((day.minTemp + day.maxTemp) / 2, allMin, allMax, 10);

    const precipStr = `${day.precipitationSum}mm`.padStart(6);
    const probStr = `${day.precipitationProbability}%`.padStart(6);
    const windStr = `${day.windSpeedMax}km/h`.padStart(8);

    console.log(
      `  ${dateStr}  ${weatherStr} ${minTempStr} ${maxTempStr}  ${bar}  ${precipStr}  ${probStr}   ${windStr}`,
    );
  }

  console.log(`  ${divider("═", 72)}`);
  console.log();
}

function displayHourly(weather: WeatherData): void {
  const { location, hourly } = weather;
  const locationStr = location.admin1
    ? `${location.name}，${location.admin1}，${location.country}`
    : `${location.name}，${location.country}`;

  console.log();
  console.log(c(`  ${locationStr} 24 小时逐时预报`, color.bold, color.cyan));
  console.log(`  ${divider("═", 64)}`);

  // 每 3 小时显示一次
  const displayHours = hourly.filter((_, i) => i % 3 === 0);

  for (const hour of displayHours) {
    const timeStr = formatHour(hour.time);
    const icon = getWeatherIcon(hour.weatherCode);
    const desc = getWeatherDescription(hour.weatherCode).padEnd(6);
    const tempStr = c(`${hour.temperature}°C`.padStart(6), color.yellow);
    const humStr = `${hour.humidity}%`.padStart(4);
    const precipStr = `${hour.precipitation}mm`.padStart(6);
    const windStr = `${hour.windSpeed}km/h`.padStart(8);

    console.log(
      `  ${timeStr}  ${icon}${desc} ${tempStr}  湿度${humStr}  降水${precipStr}  风速${windStr}`,
    );
  }

  console.log(`  ${divider("═", 64)}`);
  console.log();
}

/* ============================== 命令实现 ============================== */

/** 加载动画 */
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

async function queryAndDisplay(
  cityName: string,
  displayFn: (weather: WeatherData) => void,
): Promise<void> {
  const loader = showLoading(`正在查询「${cityName}」的天气`);
  try {
    const location = await geocode(cityName);
    const weather = await fetchWeather(location);
    loader.stop();
    displayFn(weather);
  } catch (err) {
    loader.stop();
    console.error(c(`错误：${(err as Error).message}`, color.red));
  }
}

async function cmdNow(cityName: string): Promise<void> {
  if (!cityName || cityName.trim().length === 0) {
    console.error(
      c("错误：请提供城市名称。用法：weather-cli now <城市>", color.red),
    );
    return;
  }
  await queryAndDisplay(cityName.trim(), displayCurrent);
}

async function cmdForecast(cityName: string): Promise<void> {
  if (!cityName || cityName.trim().length === 0) {
    console.error(
      c("错误：请提供城市名称。用法：weather-cli forecast <城市>", color.red),
    );
    return;
  }
  await queryAndDisplay(cityName.trim(), displayForecast);
}

async function cmdHourly(cityName: string): Promise<void> {
  if (!cityName || cityName.trim().length === 0) {
    console.error(
      c("错误：请提供城市名称。用法：weather-cli hourly <城市>", color.red),
    );
    return;
  }
  await queryAndDisplay(cityName.trim(), displayHourly);
}

async function cmdSearch(cityName: string): Promise<void> {
  if (!cityName || cityName.trim().length === 0) {
    console.error(
      c("错误：请提供城市名称。用法：weather-cli search <城市>", color.red),
    );
    return;
  }

  const loader = showLoading(`正在搜索「${cityName}」`);
  try {
    const locations = await geocodeMultiple(cityName.trim());
    loader.stop();

    console.log();
    console.log(c(`  搜索结果：${cityName}`, color.bold, color.cyan));
    console.log(`  ${divider("═", 50)}`);

    locations.forEach((loc, i) => {
      const admin = loc.admin1 ? `，${loc.admin1}` : "";
      console.log(
        `  ${c(`[${i + 1}]`, color.green)} ${loc.name}${admin}，${loc.country}  (${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)})`,
      );
    });

    console.log(`  ${divider("═", 50)}`);

    // 交互选择
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        c("  请输入编号查看天气（直接回车取消）：", color.yellow),
        resolve,
      );
    });
    rl.close();

    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < locations.length) {
      const selected = locations[idx]!;
      const loader2 = showLoading(`正在查询「${selected.name}」的天气`);
      try {
        const weather = await fetchWeather(selected);
        loader2.stop();
        displayCurrent(weather);
      } catch (err) {
        loader2.stop();
        console.error(c(`错误：${(err as Error).message}`, color.red));
      }
    } else {
      console.log(c("  已取消。", color.dim));
    }
  } catch (err) {
    loader.stop();
    console.error(c(`错误：${(err as Error).message}`, color.red));
  }
}

function cmdHelp(): void {
  console.log(
    [
      `${c("天气查询 CLI — 命令行天气查询工具", color.bold, color.cyan)}`,
      "",
      "用法： weather-cli <command> [args...]",
      "",
      "命令：",
      `  now <城市>           ${c("查询当前天气", color.dim)}`,
      `  forecast <城市>      ${c("查看 7 日天气预报", color.dim)}`,
      `  hourly <城市>        ${c("查看 24 小时逐时预报", color.dim)}`,
      `  search <城市>        ${c("搜索城市并选择查看天气", color.dim)}`,
      `  help                 ${c("显示帮助信息", color.dim)}`,
      "",
      "交互模式：",
      "  不带参数启动时进入交互模式，可连续查询多个城市。",
      "",
      "别名：",
      "  now      → current, n",
      "  forecast → fc, f",
      "  hourly   → h",
      "  search   → s, find",
      "",
      "数据源：Open-Meteo API（免费、无需 API Key）",
      "  https://open-meteo.com",
      "",
      "示例：",
      "  weather-cli now 北京",
      "  weather-cli forecast Shanghai",
      "  weather-cli hourly 东京",
      "  weather-cli search 广州",
    ].join("\n"),
  );
}

/* ============================== 交互模式 ============================== */

async function interactiveMode(): Promise<void> {
  console.log();
  console.log(c("  天气查询 CLI — 交互模式", color.bold, color.cyan));
  console.log(`  ${divider("═", 40)}`);
  console.log(c("  输入城市名查看当前天气", color.dim));
  console.log(c("  命令：now/forecast/hourly/search/help/exit", color.dim));
  console.log(`  ${divider("═", 40)}`);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c("天气 > ", color.green),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const parts = input.split(/\s+/);
    const cmd = parts[0]!.toLowerCase();

    switch (cmd) {
      case "exit":
      case "quit":
      case "q":
        console.log(c("  再见！", color.dim));
        rl.close();
        return;

      case "help":
      case "h":
        cmdHelp();
        break;

      case "now":
      case "current":
      case "n":
        await cmdNow(parts.slice(1).join(" "));
        break;

      case "forecast":
      case "fc":
      case "f":
        await cmdForecast(parts.slice(1).join(" "));
        break;

      case "hourly":
        await cmdHourly(parts.slice(1).join(" "));
        break;

      case "search":
      case "s":
      case "find":
        await cmdSearch(parts.slice(1).join(" "));
        break;

      default:
        // 直接输入城市名，查询当前天气
        await cmdNow(input);
        break;
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

/* ============================== 入口 ============================== */

async function main(): Promise<void> {
  const argv: string[] = process.argv.slice(2);

  // 无参数 → 交互模式
  if (argv.length === 0) {
    await interactiveMode();
    return;
  }

  const command: string = (argv[0] ?? "help").toLowerCase();

  switch (command) {
    case "now":
    case "current":
    case "n":
      await cmdNow(argv.slice(1).join(" "));
      break;

    case "forecast":
    case "fc":
    case "f":
      await cmdForecast(argv.slice(1).join(" "));
      break;

    case "hourly":
    case "h":
      await cmdHourly(argv.slice(1).join(" "));
      break;

    case "search":
    case "s":
    case "find":
      await cmdSearch(argv.slice(1).join(" "));
      break;

    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;

    default:
      // 未识别的命令当作城市名，查询当前天气
      await cmdNow(argv.join(" "));
      break;
  }
}

main().catch((err) => {
  console.error(c(`致命错误：${(err as Error).message}`, color.red));
  process.exit(1);
});
