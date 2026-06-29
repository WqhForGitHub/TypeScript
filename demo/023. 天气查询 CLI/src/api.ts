/**
 * 天气 API 模块（增强版）
 *
 * 使用 Open-Meteo API（免费、无需 API Key）获取天气数据。
 * - 地理编码：https://geocoding-api.open-meteo.com
 * - 天气数据：https://api.open-meteo.com
 *
 * 高级特性：枚举、泛型约束、可辨识联合、映射类型、条件类型、
 * 模板字面量类型、类型守卫、元组、自定义错误层级、as const/satisfies、
 * 索引签名、getter/setter、工具类型(Pick/Omit/Partial/Readonly/Record/ReturnType)。
 */

import * as https from "https";

/* ============================== 枚举 ============================== */

enum WeatherCondition {
  Clear = "CLEAR",
  PartlyCloudy = "PARTLY_CLOUDY",
  Cloudy = "CLOUDY",
  Fog = "FOG",
  Drizzle = "DRIZZLE",
  Rain = "RAIN",
  FreezingRain = "FREEZING_RAIN",
  Snow = "SNOW",
  Showers = "SHOWERS",
  Thunderstorm = "THUNDERSTORM",
  Unknown = "UNKNOWN",
}

enum TemperatureUnit {
  Celsius = "C",
  Fahrenheit = "F",
  Kelvin = "K",
}

enum WindDirection {
  N = "N",
  NE = "NE",
  E = "E",
  SE = "SE",
  S = "S",
  SW = "SW",
  W = "W",
  NW = "NW",
}

enum ApiEndpoint {
  Geocoding = "GEOCODING",
  Forecast = "FORECAST",
}

enum ForecastType {
  Current = "CURRENT",
  Daily = "DAILY",
  Hourly = "HOURLY",
}

/* ================ 模板字面量 / 条件 / 映射类型 / 元组 ================ */

type HttpUrl = `https://${string}`;
type GeocodingUrl = `https://geocoding-api.open-meteo.com/v1/${string}`;
type ForecastUrl = `https://api.open-meteo.com/v1/${string}`;

type EndpointUrl<T extends ApiEndpoint> = T extends ApiEndpoint.Geocoding
  ? GeocodingUrl
  : T extends ApiEndpoint.Forecast
    ? ForecastUrl
    : HttpUrl;

type ForecastData<T extends ForecastType> = T extends ForecastType.Current
  ? CurrentWeather
  : T extends ForecastType.Daily
    ? readonly DailyForecast[]
    : T extends ForecastType.Hourly
      ? readonly HourlyForecast[]
      : never;

type ConditionLabel = { [K in WeatherCondition]: string };
type ConditionMeta = {
  readonly [K in WeatherCondition]: {
    readonly cn: string;
    readonly en: string;
  };
};

type Coordinates = readonly [lat: number, lon: number];
type TemperatureRange = readonly [min: number, max: number];

/* ============================== 接口 ============================== */

interface GeoLocation {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly country: string;
  readonly admin1?: string;
  readonly timezone: string;
  readonly coordinates: Coordinates;
}

interface CurrentWeather {
  readonly temperature: number;
  readonly feelsLike: number;
  readonly humidity: number;
  readonly windSpeed: number;
  readonly windDirection: number;
  readonly weatherCode: number;
  readonly isDay: boolean;
  readonly pressure: number;
  readonly precipitation: number;
  readonly cloudCover?: number;
}

interface DailyForecast {
  readonly date: string;
  readonly maxTemp: number;
  readonly minTemp: number;
  readonly weatherCode: number;
  readonly precipitationSum: number;
  readonly precipitationProbability: number;
  readonly windSpeedMax: number;
  readonly sunrise: string;
  readonly sunset: string;
}

interface HourlyForecast {
  readonly time: string;
  readonly temperature: number;
  readonly humidity: number;
  readonly weatherCode: number;
  readonly precipitation: number;
  readonly windSpeed: number;
}

interface WeatherData {
  readonly location: GeoLocation;
  readonly current: CurrentWeather;
  readonly daily: readonly DailyForecast[];
  readonly hourly: readonly HourlyForecast[];
}

interface SevereAlert {
  readonly level: "info" | "warning" | "severe";
  readonly title: string;
  readonly message: string;
  readonly condition?: WeatherCondition;
}

interface ForecastStats {
  readonly avgTemp: number;
  readonly minTemp: number;
  readonly maxTemp: number;
  readonly totalPrecip: number;
  readonly maxWind: number;
  readonly range: TemperatureRange;
}

/** 索引签名：WMO 代码到元数据的映射 */
interface WmoCodeMap {
  [code: number]: {
    readonly description: string;
    readonly icon: string;
    readonly condition: WeatherCondition;
    readonly ascii: string;
  };
}

interface GeocodingResult {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly country: string;
  readonly admin1?: string;
  readonly timezone: string;
}

interface GeocodingResponse {
  readonly results?: readonly GeocodingResult[];
}

interface ApiRequest<T extends ApiEndpoint> {
  readonly endpoint: T;
  readonly url: EndpointUrl<T>;
  readonly params: Readonly<Record<string, string>>;
}

/** 可辨识联合：API 响应 / 结果 */
type ApiResponse<T extends ApiEndpoint> =
  | { readonly ok: true; readonly endpoint: T; readonly data: unknown }
  | { readonly ok: false; readonly endpoint: T; readonly error: ApiError };

type ApiResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: ApiError };

/** 工具类型示例 */
type LocationLabel = Pick<GeoLocation, "name" | "country" | "admin1">;
type DaySummary = Omit<DailyForecast, "sunrise" | "sunset">;
type WeatherUpdates = Partial<CurrentWeather>;
type WeatherResult = ReturnType<typeof fetchWeather>;

/** Open-Meteo 原始响应（合并当前 / 每日 / 小时） */
interface OpenMeteoResponse {
  readonly current: {
    readonly temperature_2m: number;
    readonly relative_humidity_2m: number;
    readonly apparent_temperature: number;
    readonly weather_code: number;
    readonly wind_speed_10m: number;
    readonly wind_direction_10m: number;
    readonly is_day: number;
    readonly surface_pressure: number;
    readonly precipitation: number;
    readonly cloud_cover: number;
  };
  readonly daily: {
    readonly time: readonly string[];
    readonly temperature_2m_max: readonly number[];
    readonly temperature_2m_min: readonly number[];
    readonly weather_code: readonly number[];
    readonly precipitation_sum: readonly number[];
    readonly precipitation_probability_max: readonly number[];
    readonly wind_speed_10m_max: readonly number[];
    readonly sunrise: readonly string[];
    readonly sunset: readonly string[];
  };
  readonly hourly: {
    readonly time: readonly string[];
    readonly temperature_2m: readonly number[];
    readonly relative_humidity_2m: readonly number[];
    readonly weather_code: readonly number[];
    readonly precipitation: readonly number[];
    readonly wind_speed_10m: readonly number[];
  };
}

/* ============================== 自定义错误层级 ============================== */

class ApiError extends Error {
  public readonly timestamp: Date;
  constructor(
    message: string,
    public readonly code: string = "API_ERROR",
  ) {
    super(message);
    this.name = "ApiError";
    this.timestamp = new Date();
  }
}

class NetworkError extends ApiError {
  constructor(message: string) {
    super(message, "NETWORK_ERROR");
    this.name = "NetworkError";
  }
}

class ParseError extends ApiError {
  constructor(
    message: string,
    public readonly raw?: string,
  ) {
    super(message, "PARSE_ERROR");
    this.name = "ParseError";
  }
}

class RateLimitError extends ApiError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message, "RATE_LIMIT_ERROR");
    this.name = "RateLimitError";
  }
}

/* ============================== WMO 代码映射 ============================== */

const WMO_CODES = {
  0: {
    description: "晴",
    icon: "☀️",
    condition: WeatherCondition.Clear,
    ascii: "  \\   /\n -- ☀ --\n  /   \\",
  },
  1: {
    description: "大部晴朗",
    icon: "🌤️",
    condition: WeatherCondition.Clear,
    ascii: "  \\ /\n --☀--\n   ☁ ",
  },
  2: {
    description: "多云",
    icon: "⛅",
    condition: WeatherCondition.PartlyCloudy,
    ascii: "  \\ / \n --☀--\n  ☁  ",
  },
  3: {
    description: "阴天",
    icon: "☁️",
    condition: WeatherCondition.Cloudy,
    ascii: "  .--.  \n (    ) \n(______)",
  },
  45: {
    description: "雾",
    icon: "🌫️",
    condition: WeatherCondition.Fog,
    ascii: "~~~~~~\n~~~~~~\n~~~~~~",
  },
  48: {
    description: "沉积雾凇",
    icon: "🌫️",
    condition: WeatherCondition.Fog,
    ascii: "~~*~~~\n~*~~~~\n~~*~~~",
  },
  51: {
    description: "小毛毛雨",
    icon: "🌦️",
    condition: WeatherCondition.Drizzle,
    ascii: " .--. \n(    )\n ´ ´ ´",
  },
  53: {
    description: "中毛毛雨",
    icon: "🌦️",
    condition: WeatherCondition.Drizzle,
    ascii: " .--. \n(    )\n ´´´´´",
  },
  55: {
    description: "大毛毛雨",
    icon: "🌧️",
    condition: WeatherCondition.Drizzle,
    ascii: " .--. \n(    )\n ´´´´´´",
  },
  56: {
    description: "冻毛毛雨",
    icon: "🌧️",
    condition: WeatherCondition.FreezingRain,
    ascii: " .--. \n(    )\n / / /",
  },
  57: {
    description: "密集冻毛毛雨",
    icon: "🌧️",
    condition: WeatherCondition.FreezingRain,
    ascii: " .--. \n(    )\n / / / ",
  },
  61: {
    description: "小雨",
    icon: "🌧️",
    condition: WeatherCondition.Rain,
    ascii: " .--. \n(    )\n  | | ",
  },
  63: {
    description: "中雨",
    icon: "🌧️",
    condition: WeatherCondition.Rain,
    ascii: " .--. \n(    )\n ||| ||",
  },
  65: {
    description: "大雨",
    icon: "🌧️",
    condition: WeatherCondition.Rain,
    ascii: " .--. \n(    )\n||||||",
  },
  66: {
    description: "冻雨",
    icon: "🧊",
    condition: WeatherCondition.FreezingRain,
    ascii: " .--. \n(    )\n /||/ ",
  },
  67: {
    description: "大冻雨",
    icon: "🧊",
    condition: WeatherCondition.FreezingRain,
    ascii: " .--. \n(    )\n/||||/",
  },
  71: {
    description: "小雪",
    icon: "🌨️",
    condition: WeatherCondition.Snow,
    ascii: " .--. \n(    )\n  * * ",
  },
  73: {
    description: "中雪",
    icon: "🌨️",
    condition: WeatherCondition.Snow,
    ascii: " .--. \n(    )\n ** **",
  },
  75: {
    description: "大雪",
    icon: "❄️",
    condition: WeatherCondition.Snow,
    ascii: " .--. \n(    )\n******",
  },
  77: {
    description: "雪粒",
    icon: "🌨️",
    condition: WeatherCondition.Snow,
    ascii: " .--. \n(    )\n • • •",
  },
  80: {
    description: "小阵雨",
    icon: "🌦️",
    condition: WeatherCondition.Showers,
    ascii: "  \\ / \n --☀--\n  | | ",
  },
  81: {
    description: "中阵雨",
    icon: "🌧️",
    condition: WeatherCondition.Showers,
    ascii: "  \\ / \n --☀--\n ||| |",
  },
  82: {
    description: "大阵雨",
    icon: "⛈️",
    condition: WeatherCondition.Showers,
    ascii: "  \\ / \n --☀--\n||||||",
  },
  85: {
    description: "小阵雪",
    icon: "🌨️",
    condition: WeatherCondition.Showers,
    ascii: "  \\ / \n --☀--\n  * * ",
  },
  86: {
    description: "大阵雪",
    icon: "❄️",
    condition: WeatherCondition.Showers,
    ascii: "  \\ / \n --☀--\n ** **",
  },
  95: {
    description: "雷暴",
    icon: "⛈️",
    condition: WeatherCondition.Thunderstorm,
    ascii: " .--. \n( ⚡ )\n ||||",
  },
  96: {
    description: "雷暴伴小冰雹",
    icon: "⛈️",
    condition: WeatherCondition.Thunderstorm,
    ascii: " .--. \n( ⚡ )\n ||*|",
  },
  99: {
    description: "雷暴伴大冰雹",
    icon: "⛈️",
    condition: WeatherCondition.Thunderstorm,
    ascii: " .--. \n( ⚡ )\n||**|",
  },
} as const satisfies WmoCodeMap;

const CONDITION_META = {
  [WeatherCondition.Clear]: { cn: "晴朗", en: "Clear" },
  [WeatherCondition.PartlyCloudy]: { cn: "少云", en: "Partly Cloudy" },
  [WeatherCondition.Cloudy]: { cn: "多云", en: "Cloudy" },
  [WeatherCondition.Fog]: { cn: "雾", en: "Fog" },
  [WeatherCondition.Drizzle]: { cn: "毛毛雨", en: "Drizzle" },
  [WeatherCondition.Rain]: { cn: "雨", en: "Rain" },
  [WeatherCondition.FreezingRain]: { cn: "冻雨", en: "Freezing Rain" },
  [WeatherCondition.Snow]: { cn: "雪", en: "Snow" },
  [WeatherCondition.Showers]: { cn: "阵雨", en: "Showers" },
  [WeatherCondition.Thunderstorm]: { cn: "雷暴", en: "Thunderstorm" },
  [WeatherCondition.Unknown]: { cn: "未知", en: "Unknown" },
} as const satisfies ConditionMeta;

const WIND_DIR_LABELS: Record<WindDirection, string> = {
  [WindDirection.N]: "北",
  [WindDirection.NE]: "东北",
  [WindDirection.E]: "东",
  [WindDirection.SE]: "东南",
  [WindDirection.S]: "南",
  [WindDirection.SW]: "西南",
  [WindDirection.W]: "西",
  [WindDirection.NW]: "西北",
};

const WIND_DIRS_ORDER = [
  WindDirection.N,
  WindDirection.NE,
  WindDirection.E,
  WindDirection.SE,
  WindDirection.S,
  WindDirection.SW,
  WindDirection.W,
  WindDirection.NW,
] as const satisfies readonly WindDirection[];

/* ============================== 类型守卫 ============================== */

function isWeatherCondition(value: unknown): value is WeatherCondition {
  return (
    typeof value === "string" &&
    (Object.values(WeatherCondition) as string[]).includes(value)
  );
}

function isApiResponse<T extends ApiEndpoint>(
  value: unknown,
): value is ApiResponse<T> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["ok"] === "boolean" && typeof v["endpoint"] === "string";
}

function isWmoCode(code: unknown): code is keyof typeof WMO_CODES {
  return typeof code === "number" && code in WMO_CODES;
}

/* ============================== WMO 工具 ============================== */

function wmoEntry(code: number): WmoCodeMap[number] {
  return isWmoCode(code)
    ? WMO_CODES[code]
    : {
        description: "未知",
        icon: "❓",
        condition: WeatherCondition.Unknown,
        ascii: "   ?   ",
      };
}

const getWeatherDescription = (code: number): string =>
  wmoEntry(code).description;
const getWeatherIcon = (code: number): string => wmoEntry(code).icon;
const getWeatherAscii = (code: number): string => wmoEntry(code).ascii;
const codeToCondition = (code: number): WeatherCondition =>
  wmoEntry(code).condition;
const conditionLabel = (condition: WeatherCondition): string =>
  CONDITION_META[condition]?.cn ?? "未知";

/* ============================== 温度 / 风向工具 ============================== */

class Temperature {
  private _celsius: number;
  constructor(celsius: number) {
    this._celsius = celsius;
  }
  static fromCelsius(c: number): Temperature {
    return new Temperature(c);
  }
  static fromFahrenheit(f: number): Temperature {
    return new Temperature(((f - 32) * 5) / 9);
  }
  static fromKelvin(k: number): Temperature {
    return new Temperature(k - 273.15);
  }

  get celsius(): number {
    return this._celsius;
  }
  get fahrenheit(): number {
    return (this._celsius * 9) / 5 + 32;
  }
  get kelvin(): number {
    return this._celsius + 273.15;
  }
  set celsius(v: number) {
    this._celsius = v;
  }

  convert(to: TemperatureUnit): number {
    switch (to) {
      case TemperatureUnit.Celsius:
        return this._celsius;
      case TemperatureUnit.Fahrenheit:
        return this.fahrenheit;
      case TemperatureUnit.Kelvin:
        return this.kelvin;
    }
  }

  format(to: TemperatureUnit, digits = 0): string {
    return `${this.convert(to).toFixed(digits)}°${to}`;
  }

  toRange(): TemperatureRange {
    return [this._celsius, this._celsius] as const;
  }
}

function convertTemperature(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit,
): number {
  const t =
    from === TemperatureUnit.Celsius
      ? Temperature.fromCelsius(value)
      : from === TemperatureUnit.Fahrenheit
        ? Temperature.fromFahrenheit(value)
        : Temperature.fromKelvin(value);
  return t.convert(to);
}

function degreesToDirection(deg: number): WindDirection {
  return WIND_DIRS_ORDER[((Math.round(deg / 45) % 8) + 8) % 8]!;
}

const directionLabel = (dir: WindDirection): string => WIND_DIR_LABELS[dir];

function formatWind(deg: number): string {
  const dir = degreesToDirection(deg);
  return `${directionLabel(dir)}(${dir}) ${Math.round(deg)}°`;
}

/* ============================== HTTP 请求工具 ============================== */

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) {
          httpsGet(loc, timeoutMs).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode === 429) {
        const retry = res.headers["retry-after"];
        reject(
          new RateLimitError(
            "请求过于频繁，请稍后再试",
            retry ? parseInt(retry, 10) : undefined,
          ),
        );
        return;
      }
      if (res.statusCode !== 200) {
        reject(new NetworkError(`HTTP 请求失败，状态码：${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => resolve(data));
      res.on("error", (e) => reject(new NetworkError(e.message)));
    });
    req.on("error", (e) => reject(new NetworkError(e.message)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new NetworkError(`请求超时（${timeoutMs}ms）`));
    });
  });
}

function fetchJSON<T>(url: string, timeoutMs = 15000): Promise<T> {
  return httpsGet(url, timeoutMs).then((raw) => {
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      throw new ParseError(`JSON 解析失败：${(e as Error).message}`, raw);
    }
  });
}

/* ============================== 简易缓存 ============================== */

interface CacheEntry<T> {
  readonly data: T;
  readonly expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 600_000;

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, ttl: number = CACHE_TTL): void {
  cache.set(key, { data, expires: Date.now() + ttl });
}

/* ============================== 地理编码 ============================== */

function buildGeocodeUrl(city: string, count: number): GeocodingUrl {
  const params = new URLSearchParams({
    name: city,
    count: count.toString(),
    language: "zh",
    format: "json",
  });
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}

function toGeoLocation(r: GeocodingResult): GeoLocation {
  return {
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin1: r.admin1,
    timezone: r.timezone,
    coordinates: [r.latitude, r.longitude] as Coordinates,
  };
}

async function geocode(cityName: string): Promise<GeoLocation> {
  const key = `geo:${cityName}`;
  const cached = cacheGet<GeoLocation>(key);
  if (cached) return cached;

  const data = await fetchJSON<GeocodingResponse>(buildGeocodeUrl(cityName, 5));
  if (!data.results || data.results.length === 0) {
    throw new ApiError(
      `未找到城市：「${cityName}」。请检查城市名称是否正确。`,
      "NOT_FOUND",
    );
  }
  const loc = toGeoLocation(data.results[0]!);
  cacheSet(key, loc);
  return loc;
}

async function geocodeMultiple(
  cityName: string,
): Promise<readonly GeoLocation[]> {
  const data = await fetchJSON<GeocodingResponse>(
    buildGeocodeUrl(cityName, 10),
  );
  if (!data.results || data.results.length === 0) {
    throw new ApiError(
      `未找到城市：「${cityName}」。请检查城市名称是否正确。`,
      "NOT_FOUND",
    );
  }
  return data.results.map(toGeoLocation);
}

/* ============================== 天气数据获取 ============================== */

async function fetchWeather(location: GeoLocation): Promise<WeatherData> {
  const { latitude, longitude, timezone } = location;

  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    timezone,
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
      "cloud_cover",
    ].join(","),
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
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "weather_code",
      "precipitation",
      "wind_speed_10m",
    ].join(","),
    forecast_days: "7",
  });

  const url: ForecastUrl = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const data = await fetchJSON<OpenMeteoResponse>(url);

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
    cloudCover: data.current.cloud_cover,
  };

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

/* ============================== 预报统计 / 预警 ============================== */

function computeForecastStats(daily: readonly DailyForecast[]): ForecastStats {
  const temps = daily.flatMap((d) => [d.minTemp, d.maxTemp]);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
  const totalPrecip = daily.reduce((a, d) => a + d.precipitationSum, 0);
  const maxWind = Math.max(...daily.map((d) => d.windSpeedMax));
  return {
    avgTemp,
    minTemp,
    maxTemp,
    totalPrecip,
    maxWind,
    range: [minTemp, maxTemp] as const,
  };
}

function detectAlerts(weather: WeatherData): readonly SevereAlert[] {
  const alerts: SevereAlert[] = [];
  const c = weather.current;

  if (c.weatherCode >= 95) {
    alerts.push({
      level: "severe",
      title: "雷暴天气",
      message: "当前有雷暴，请避免户外活动并远离空旷地带",
      condition: WeatherCondition.Thunderstorm,
    });
  }
  if (c.windSpeed >= 50) {
    alerts.push({
      level: "warning",
      title: "大风警报",
      message: `当前风速 ${c.windSpeed} km/h，请注意出行安全`,
    });
  } else if (c.windSpeed >= 30) {
    alerts.push({
      level: "info",
      title: "风力较强",
      message: `当前风速 ${c.windSpeed} km/h`,
    });
  }
  if (c.temperature >= 35) {
    alerts.push({
      level: "warning",
      title: "高温警报",
      message: `气温 ${c.temperature}°C，请注意防暑降温`,
    });
  } else if (c.temperature <= -10) {
    alerts.push({
      level: "warning",
      title: "严寒警报",
      message: `气温 ${c.temperature}°C，请注意防寒保暖`,
    });
  }
  if ([65, 82, 67, 57].includes(c.weatherCode)) {
    alerts.push({
      level: "warning",
      title: "强降水",
      message: "当前有强降水，注意防范积涝",
      condition: WeatherCondition.Rain,
    });
  }
  if (c.weatherCode === 45 || c.weatherCode === 48) {
    alerts.push({
      level: "info",
      title: "大雾提醒",
      message: "能见度较低，出行请注意安全",
      condition: WeatherCondition.Fog,
    });
  }
  if (c.humidity >= 90 && c.weatherCode === 0) {
    alerts.push({
      level: "info",
      title: "高湿",
      message: `湿度 ${c.humidity}%，体感闷热`,
    });
  }
  return alerts;
}

/** 泛型预报数据获取器（演示条件类型 ForecastData 的使用） */
function getForecast<T extends ForecastType>(
  weather: WeatherData,
  type: T,
): ForecastData<T> {
  switch (type) {
    case ForecastType.Current:
      return weather.current as ForecastData<T>;
    case ForecastType.Daily:
      return weather.daily as ForecastData<T>;
    case ForecastType.Hourly:
      return weather.hourly as ForecastData<T>;
    default:
      throw new ApiError(
        `未知预报类型：${type as string}`,
        "INVALID_FORECAST_TYPE",
      );
  }
}

/* ============================== 导出 ============================== */

export {
  WeatherCondition,
  TemperatureUnit,
  WindDirection,
  ApiEndpoint,
  ForecastType,
  ApiError,
  NetworkError,
  ParseError,
  RateLimitError,
  Temperature,
  geocode,
  geocodeMultiple,
  fetchWeather,
  getForecast,
  getWeatherDescription,
  getWeatherIcon,
  getWeatherAscii,
  codeToCondition,
  conditionLabel,
  convertTemperature,
  degreesToDirection,
  directionLabel,
  formatWind,
  computeForecastStats,
  detectAlerts,
  isWeatherCondition,
  isApiResponse,
  isWmoCode,
  WMO_CODES,
  CONDITION_META,
  WIND_DIR_LABELS,
};

export type {
  GeoLocation,
  CurrentWeather,
  DailyForecast,
  HourlyForecast,
  WeatherData,
  WeatherUpdates,
  SevereAlert,
  ForecastStats,
  Coordinates,
  TemperatureRange,
  HttpUrl,
  GeocodingUrl,
  ForecastUrl,
  EndpointUrl,
  ForecastData,
  ConditionLabel,
  ConditionMeta,
  WmoCodeMap,
  ApiRequest,
  ApiResponse,
  ApiResult,
  LocationLabel,
  DaySummary,
  WeatherResult,
};
