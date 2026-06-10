/**
 * 天气 API 模块
 *
 * 使用 Open-Meteo API（免费、无需 API Key）获取天气数据。
 * - 地理编码：https://geocoding-api.open-meteo.com
 * - 天气数据：https://api.open-meteo.com
 */

import * as https from "https";

/* ============================== 类型定义 ============================== */

/** 地理编码结果 */
interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string; // 省/州
  timezone: string;
}

/** 当前天气 */
interface CurrentWeather {
  temperature: number; // 摄氏度
  feelsLike: number; // 体感温度
  humidity: number; // 湿度 %
  windSpeed: number; // 风速 km/h
  windDirection: number; // 风向 度
  weatherCode: number; // WMO 天气代码
  isDay: boolean; // 是否白天
  pressure: number; // 气压 hPa
  precipitation: number; // 降水量 mm
}

/** 每日预报 */
interface DailyForecast {
  date: string;
  maxTemp: number;
  minTemp: number;
  weatherCode: number;
  precipitationSum: number; // 降水总量 mm
  precipitationProbability: number; // 降水概率 %
  windSpeedMax: number; // 最大风速 km/h
  sunrise: string;
  sunset: string;
}

/** 每小时预报（简化） */
interface HourlyForecast {
  time: string;
  temperature: number;
  humidity: number;
  weatherCode: number;
  precipitation: number;
  windSpeed: number;
}

/** 完整天气数据 */
interface WeatherData {
  location: GeoLocation;
  current: CurrentWeather;
  daily: DailyForecast[];
  hourly: HourlyForecast[];
}

/* ============================== WMO 天气代码映射 ============================== */

const WMO_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: "晴", icon: "☀️" },
  1: { description: "大部晴朗", icon: "🌤️" },
  2: { description: "多云", icon: "⛅" },
  3: { description: "阴天", icon: "☁️" },
  45: { description: "雾", icon: "🌫️" },
  48: { description: "沉积雾凇", icon: "🌫️" },
  51: { description: "小毛毛雨", icon: "🌦️" },
  53: { description: "中毛毛雨", icon: "🌦️" },
  55: { description: "大毛毛雨", icon: "🌧️" },
  56: { description: "冻毛毛雨", icon: "🌧️" },
  57: { description: "密集冻毛毛雨", icon: "🌧️" },
  61: { description: "小雨", icon: "🌧️" },
  63: { description: "中雨", icon: "🌧️" },
  65: { description: "大雨", icon: "🌧️" },
  66: { description: "冻雨", icon: "🧊" },
  67: { description: "大冻雨", icon: "🧊" },
  71: { description: "小雪", icon: "🌨️" },
  73: { description: "中雪", icon: "🌨️" },
  75: { description: "大雪", icon: "❄️" },
  77: { description: "雪粒", icon: "🌨️" },
  80: { description: "小阵雨", icon: "🌦️" },
  81: { description: "中阵雨", icon: "🌧️" },
  82: { description: "大阵雨", icon: "⛈️" },
  85: { description: "小阵雪", icon: "🌨️" },
  86: { description: "大阵雪", icon: "❄️" },
  95: { description: "雷暴", icon: "⛈️" },
  96: { description: "雷暴伴小冰雹", icon: "⛈️" },
  99: { description: "雷暴伴大冰雹", icon: "⛈️" },
};

/** 获取天气描述 */
export function getWeatherDescription(code: number): string {
  return WMO_CODES[code]?.description ?? "未知";
}

/** 获取天气图标 */
export function getWeatherIcon(code: number): string {
  return WMO_CODES[code]?.icon ?? "❓";
}

/* ============================== HTTP 请求工具 ============================== */

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      // 处理重定向
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          httpsGet(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP 请求失败，状态码：${res.statusCode}`));
        return;
      }

      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("请求超时（15 秒）"));
    });
  });
}

function fetchJSON<T>(url: string): Promise<T> {
  return httpsGet(url).then((data) => JSON.parse(data) as T);
}

/* ============================== 地理编码 ============================== */

interface GeocodingResponse {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country: string;
    admin1?: string;
    timezone: string;
  }>;
}

/**
 * 将城市名称转换为地理坐标
 * 支持中文城市名和英文城市名
 */
export async function geocode(cityName: string): Promise<GeoLocation> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=zh&format=json`;

  const data = await fetchJSON<GeocodingResponse>(url);

  if (!data.results || data.results.length === 0) {
    throw new Error(`未找到城市：「${cityName}」。请检查城市名称是否正确。`);
  }

  // 优先选择中国城市（如果搜索的是中文名）
  const result = data.results[0]!;

  return {
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
    country: result.country,
    admin1: result.admin1,
    timezone: result.timezone,
  };
}

/**
 * 返回匹配的多个城市供用户选择
 */
export async function geocodeMultiple(
  cityName: string,
): Promise<GeoLocation[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=zh&format=json`;

  const data = await fetchJSON<GeocodingResponse>(url);

  if (!data.results || data.results.length === 0) {
    throw new Error(`未找到城市：「${cityName}」。请检查城市名称是否正确。`);
  }

  return data.results.map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin1: r.admin1,
    timezone: r.timezone,
  }));
}

/* ============================== 天气数据获取 ============================== */

interface OpenMeteoCurrentResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    is_day: number;
    surface_pressure: number;
    precipitation: number;
  };
}

interface OpenMeteoDailyResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
    sunrise: string[];
    sunset: string[];
  };
}

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    weather_code: number[];
    precipitation: number[];
    wind_speed_10m: number[];
  };
}

type OpenMeteoResponse = OpenMeteoCurrentResponse &
  OpenMeteoDailyResponse &
  OpenMeteoHourlyResponse;

/**
 * 获取完整天气数据（当前 + 7 日预报 + 24 小时预报）
 */
export async function fetchWeather(
  location: GeoLocation,
): Promise<WeatherData> {
  const { latitude, longitude, timezone } = location;

  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    timezone,
    // 当前天气
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
      "surface_pressure",
      "precipitation",
    ].join(","),
    // 每日预报
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "weather_code",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "sunrise",
      "sunset",
    ].join(","),
    // 小时预报
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "weather_code",
      "precipitation",
      "wind_speed_10m",
    ].join(","),
    forecast_days: "7",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const data = await fetchJSON<OpenMeteoResponse>(url);

  // 解析当前天气
  const current: CurrentWeather = {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windDirection: data.current.wind_direction_10m,
    weatherCode: data.current.weather_code,
    isDay: data.current.is_day === 1,
    pressure: data.current.surface_pressure,
    precipitation: data.current.precipitation,
  };

  // 解析每日预报
  const daily: DailyForecast[] = data.daily.time.map((date, i) => ({
    date,
    maxTemp: data.daily.temperature_2m_max[i]!,
    minTemp: data.daily.temperature_2m_min[i]!,
    weatherCode: data.daily.weather_code[i]!,
    precipitationSum: data.daily.precipitation_sum[i]!,
    precipitationProbability: data.daily.precipitation_probability_max[i]!,
    windSpeedMax: data.daily.wind_speed_10m_max[i]!,
    sunrise: data.daily.sunrise[i]!,
    sunset: data.daily.sunset[i]!,
  }));

  // 解析 24 小时预报（从当前小时开始的 24 个小时）
  const now = new Date();
  const currentHourStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`;

  const startIdx = data.hourly.time.indexOf(currentHourStr);
  const sliceStart = startIdx >= 0 ? startIdx : 0;

  const hourly: HourlyForecast[] = data.hourly.time
    .slice(sliceStart, sliceStart + 24)
    .map((time, i) => ({
      time,
      temperature: data.hourly.temperature_2m[sliceStart + i]!,
      humidity: data.hourly.relative_humidity_2m[sliceStart + i]!,
      weatherCode: data.hourly.weather_code[sliceStart + i]!,
      precipitation: data.hourly.precipitation[sliceStart + i]!,
      windSpeed: data.hourly.wind_speed_10m[sliceStart + i]!,
    }));

  return { location, current, daily, hourly };
}

/* ============================== 导出类型 ============================== */

export type {
  GeoLocation,
  CurrentWeather,
  DailyForecast,
  HourlyForecast,
  WeatherData,
};
