"use strict";
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
exports.WIND_DIR_LABELS = exports.CONDITION_META = exports.WMO_CODES = exports.directionLabel = exports.conditionLabel = exports.codeToCondition = exports.getWeatherAscii = exports.getWeatherIcon = exports.getWeatherDescription = exports.Temperature = exports.RateLimitError = exports.ParseError = exports.NetworkError = exports.ApiError = exports.ForecastType = exports.ApiEndpoint = exports.WindDirection = exports.TemperatureUnit = exports.WeatherCondition = void 0;
exports.geocode = geocode;
exports.geocodeMultiple = geocodeMultiple;
exports.fetchWeather = fetchWeather;
exports.getForecast = getForecast;
exports.convertTemperature = convertTemperature;
exports.degreesToDirection = degreesToDirection;
exports.formatWind = formatWind;
exports.computeForecastStats = computeForecastStats;
exports.detectAlerts = detectAlerts;
exports.isWeatherCondition = isWeatherCondition;
exports.isApiResponse = isApiResponse;
exports.isWmoCode = isWmoCode;
const https = __importStar(require("https"));
/* ============================== 枚举 ============================== */
var WeatherCondition;
(function (WeatherCondition) {
    WeatherCondition["Clear"] = "CLEAR";
    WeatherCondition["PartlyCloudy"] = "PARTLY_CLOUDY";
    WeatherCondition["Cloudy"] = "CLOUDY";
    WeatherCondition["Fog"] = "FOG";
    WeatherCondition["Drizzle"] = "DRIZZLE";
    WeatherCondition["Rain"] = "RAIN";
    WeatherCondition["FreezingRain"] = "FREEZING_RAIN";
    WeatherCondition["Snow"] = "SNOW";
    WeatherCondition["Showers"] = "SHOWERS";
    WeatherCondition["Thunderstorm"] = "THUNDERSTORM";
    WeatherCondition["Unknown"] = "UNKNOWN";
})(WeatherCondition || (exports.WeatherCondition = WeatherCondition = {}));
var TemperatureUnit;
(function (TemperatureUnit) {
    TemperatureUnit["Celsius"] = "C";
    TemperatureUnit["Fahrenheit"] = "F";
    TemperatureUnit["Kelvin"] = "K";
})(TemperatureUnit || (exports.TemperatureUnit = TemperatureUnit = {}));
var WindDirection;
(function (WindDirection) {
    WindDirection["N"] = "N";
    WindDirection["NE"] = "NE";
    WindDirection["E"] = "E";
    WindDirection["SE"] = "SE";
    WindDirection["S"] = "S";
    WindDirection["SW"] = "SW";
    WindDirection["W"] = "W";
    WindDirection["NW"] = "NW";
})(WindDirection || (exports.WindDirection = WindDirection = {}));
var ApiEndpoint;
(function (ApiEndpoint) {
    ApiEndpoint["Geocoding"] = "GEOCODING";
    ApiEndpoint["Forecast"] = "FORECAST";
})(ApiEndpoint || (exports.ApiEndpoint = ApiEndpoint = {}));
var ForecastType;
(function (ForecastType) {
    ForecastType["Current"] = "CURRENT";
    ForecastType["Daily"] = "DAILY";
    ForecastType["Hourly"] = "HOURLY";
})(ForecastType || (exports.ForecastType = ForecastType = {}));
/* ============================== 自定义错误层级 ============================== */
class ApiError extends Error {
    constructor(message, code = "API_ERROR") {
        super(message);
        this.code = code;
        this.name = "ApiError";
        this.timestamp = new Date();
    }
}
exports.ApiError = ApiError;
class NetworkError extends ApiError {
    constructor(message) { super(message, "NETWORK_ERROR"); this.name = "NetworkError"; }
}
exports.NetworkError = NetworkError;
class ParseError extends ApiError {
    constructor(message, raw) {
        super(message, "PARSE_ERROR");
        this.raw = raw;
        this.name = "ParseError";
    }
}
exports.ParseError = ParseError;
class RateLimitError extends ApiError {
    constructor(message, retryAfter) {
        super(message, "RATE_LIMIT_ERROR");
        this.retryAfter = retryAfter;
        this.name = "RateLimitError";
    }
}
exports.RateLimitError = RateLimitError;
/* ============================== WMO 代码映射 ============================== */
const WMO_CODES = {
    0: { description: "晴", icon: "☀️", condition: WeatherCondition.Clear, ascii: "  \\   /\n -- ☀ --\n  /   \\" },
    1: { description: "大部晴朗", icon: "🌤️", condition: WeatherCondition.Clear, ascii: "  \\ /\n --☀--\n   ☁ " },
    2: { description: "多云", icon: "⛅", condition: WeatherCondition.PartlyCloudy, ascii: "  \\ / \n --☀--\n  ☁  " },
    3: { description: "阴天", icon: "☁️", condition: WeatherCondition.Cloudy, ascii: "  .--.  \n (    ) \n(______)" },
    45: { description: "雾", icon: "🌫️", condition: WeatherCondition.Fog, ascii: "~~~~~~\n~~~~~~\n~~~~~~" },
    48: { description: "沉积雾凇", icon: "🌫️", condition: WeatherCondition.Fog, ascii: "~~*~~~\n~*~~~~\n~~*~~~" },
    51: { description: "小毛毛雨", icon: "🌦️", condition: WeatherCondition.Drizzle, ascii: " .--. \n(    )\n ´ ´ ´" },
    53: { description: "中毛毛雨", icon: "🌦️", condition: WeatherCondition.Drizzle, ascii: " .--. \n(    )\n ´´´´´" },
    55: { description: "大毛毛雨", icon: "🌧️", condition: WeatherCondition.Drizzle, ascii: " .--. \n(    )\n ´´´´´´" },
    56: { description: "冻毛毛雨", icon: "🌧️", condition: WeatherCondition.FreezingRain, ascii: " .--. \n(    )\n / / /" },
    57: { description: "密集冻毛毛雨", icon: "🌧️", condition: WeatherCondition.FreezingRain, ascii: " .--. \n(    )\n / / / " },
    61: { description: "小雨", icon: "🌧️", condition: WeatherCondition.Rain, ascii: " .--. \n(    )\n  | | " },
    63: { description: "中雨", icon: "🌧️", condition: WeatherCondition.Rain, ascii: " .--. \n(    )\n ||| ||" },
    65: { description: "大雨", icon: "🌧️", condition: WeatherCondition.Rain, ascii: " .--. \n(    )\n||||||" },
    66: { description: "冻雨", icon: "🧊", condition: WeatherCondition.FreezingRain, ascii: " .--. \n(    )\n /||/ " },
    67: { description: "大冻雨", icon: "🧊", condition: WeatherCondition.FreezingRain, ascii: " .--. \n(    )\n/||||/" },
    71: { description: "小雪", icon: "🌨️", condition: WeatherCondition.Snow, ascii: " .--. \n(    )\n  * * " },
    73: { description: "中雪", icon: "🌨️", condition: WeatherCondition.Snow, ascii: " .--. \n(    )\n ** **" },
    75: { description: "大雪", icon: "❄️", condition: WeatherCondition.Snow, ascii: " .--. \n(    )\n******" },
    77: { description: "雪粒", icon: "🌨️", condition: WeatherCondition.Snow, ascii: " .--. \n(    )\n • • •" },
    80: { description: "小阵雨", icon: "🌦️", condition: WeatherCondition.Showers, ascii: "  \\ / \n --☀--\n  | | " },
    81: { description: "中阵雨", icon: "🌧️", condition: WeatherCondition.Showers, ascii: "  \\ / \n --☀--\n ||| |" },
    82: { description: "大阵雨", icon: "⛈️", condition: WeatherCondition.Showers, ascii: "  \\ / \n --☀--\n||||||" },
    85: { description: "小阵雪", icon: "🌨️", condition: WeatherCondition.Showers, ascii: "  \\ / \n --☀--\n  * * " },
    86: { description: "大阵雪", icon: "❄️", condition: WeatherCondition.Showers, ascii: "  \\ / \n --☀--\n ** **" },
    95: { description: "雷暴", icon: "⛈️", condition: WeatherCondition.Thunderstorm, ascii: " .--. \n( ⚡ )\n ||||" },
    96: { description: "雷暴伴小冰雹", icon: "⛈️", condition: WeatherCondition.Thunderstorm, ascii: " .--. \n( ⚡ )\n ||*|" },
    99: { description: "雷暴伴大冰雹", icon: "⛈️", condition: WeatherCondition.Thunderstorm, ascii: " .--. \n( ⚡ )\n||**|" },
};
exports.WMO_CODES = WMO_CODES;
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
};
exports.CONDITION_META = CONDITION_META;
const WIND_DIR_LABELS = {
    [WindDirection.N]: "北", [WindDirection.NE]: "东北", [WindDirection.E]: "东", [WindDirection.SE]: "东南",
    [WindDirection.S]: "南", [WindDirection.SW]: "西南", [WindDirection.W]: "西", [WindDirection.NW]: "西北",
};
exports.WIND_DIR_LABELS = WIND_DIR_LABELS;
const WIND_DIRS_ORDER = [
    WindDirection.N, WindDirection.NE, WindDirection.E, WindDirection.SE,
    WindDirection.S, WindDirection.SW, WindDirection.W, WindDirection.NW,
];
/* ============================== 类型守卫 ============================== */
function isWeatherCondition(value) {
    return typeof value === "string" && Object.values(WeatherCondition).includes(value);
}
function isApiResponse(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    return typeof v["ok"] === "boolean" && typeof v["endpoint"] === "string";
}
function isWmoCode(code) {
    return typeof code === "number" && code in WMO_CODES;
}
/* ============================== WMO 工具 ============================== */
function wmoEntry(code) {
    return isWmoCode(code)
        ? WMO_CODES[code]
        : { description: "未知", icon: "❓", condition: WeatherCondition.Unknown, ascii: "   ?   " };
}
const getWeatherDescription = (code) => wmoEntry(code).description;
exports.getWeatherDescription = getWeatherDescription;
const getWeatherIcon = (code) => wmoEntry(code).icon;
exports.getWeatherIcon = getWeatherIcon;
const getWeatherAscii = (code) => wmoEntry(code).ascii;
exports.getWeatherAscii = getWeatherAscii;
const codeToCondition = (code) => wmoEntry(code).condition;
exports.codeToCondition = codeToCondition;
const conditionLabel = (condition) => CONDITION_META[condition]?.cn ?? "未知";
exports.conditionLabel = conditionLabel;
/* ============================== 温度 / 风向工具 ============================== */
class Temperature {
    constructor(celsius) { this._celsius = celsius; }
    static fromCelsius(c) { return new Temperature(c); }
    static fromFahrenheit(f) { return new Temperature((f - 32) * 5 / 9); }
    static fromKelvin(k) { return new Temperature(k - 273.15); }
    get celsius() { return this._celsius; }
    get fahrenheit() { return this._celsius * 9 / 5 + 32; }
    get kelvin() { return this._celsius + 273.15; }
    set celsius(v) { this._celsius = v; }
    convert(to) {
        switch (to) {
            case TemperatureUnit.Celsius: return this._celsius;
            case TemperatureUnit.Fahrenheit: return this.fahrenheit;
            case TemperatureUnit.Kelvin: return this.kelvin;
        }
    }
    format(to, digits = 0) {
        return `${this.convert(to).toFixed(digits)}°${to}`;
    }
    toRange() { return [this._celsius, this._celsius]; }
}
exports.Temperature = Temperature;
function convertTemperature(value, from, to) {
    const t = from === TemperatureUnit.Celsius ? Temperature.fromCelsius(value)
        : from === TemperatureUnit.Fahrenheit ? Temperature.fromFahrenheit(value)
            : Temperature.fromKelvin(value);
    return t.convert(to);
}
function degreesToDirection(deg) {
    return WIND_DIRS_ORDER[((Math.round(deg / 45) % 8) + 8) % 8];
}
const directionLabel = (dir) => WIND_DIR_LABELS[dir];
exports.directionLabel = directionLabel;
function formatWind(deg) {
    const dir = degreesToDirection(deg);
    return `${directionLabel(dir)}(${dir}) ${Math.round(deg)}°`;
}
/* ============================== HTTP 请求工具 ============================== */
function httpsGet(url, timeoutMs) {
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
                reject(new RateLimitError("请求过于频繁，请稍后再试", retry ? parseInt(retry, 10) : undefined));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new NetworkError(`HTTP 请求失败，状态码：${res.statusCode}`));
                return;
            }
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
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
function fetchJSON(url, timeoutMs = 15000) {
    return httpsGet(url, timeoutMs).then((raw) => {
        try {
            return JSON.parse(raw);
        }
        catch (e) {
            throw new ParseError(`JSON 解析失败：${e.message}`, raw);
        }
    });
}
const cache = new Map();
const CACHE_TTL = 600000;
function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry)
        return undefined;
    if (Date.now() > entry.expires) {
        cache.delete(key);
        return undefined;
    }
    return entry.data;
}
function cacheSet(key, data, ttl = CACHE_TTL) {
    cache.set(key, { data, expires: Date.now() + ttl });
}
/* ============================== 地理编码 ============================== */
function buildGeocodeUrl(city, count) {
    const params = new URLSearchParams({
        name: city, count: count.toString(), language: "zh", format: "json",
    });
    return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}
function toGeoLocation(r) {
    return {
        name: r.name, latitude: r.latitude, longitude: r.longitude,
        country: r.country, admin1: r.admin1, timezone: r.timezone,
        coordinates: [r.latitude, r.longitude],
    };
}
async function geocode(cityName) {
    const key = `geo:${cityName}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const data = await fetchJSON(buildGeocodeUrl(cityName, 5));
    if (!data.results || data.results.length === 0) {
        throw new ApiError(`未找到城市：「${cityName}」。请检查城市名称是否正确。`, "NOT_FOUND");
    }
    const loc = toGeoLocation(data.results[0]);
    cacheSet(key, loc);
    return loc;
}
async function geocodeMultiple(cityName) {
    const data = await fetchJSON(buildGeocodeUrl(cityName, 10));
    if (!data.results || data.results.length === 0) {
        throw new ApiError(`未找到城市：「${cityName}」。请检查城市名称是否正确。`, "NOT_FOUND");
    }
    return data.results.map(toGeoLocation);
}
/* ============================== 天气数据获取 ============================== */
async function fetchWeather(location) {
    const { latitude, longitude, timezone } = location;
    const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        timezone,
        current: [
            "temperature_2m", "relative_humidity_2m", "apparent_temperature",
            "weather_code", "wind_speed_10m", "wind_direction_10m", "is_day",
            "surface_pressure", "precipitation", "cloud_cover",
        ].join(","),
        daily: [
            "temperature_2m_max", "temperature_2m_min", "weather_code",
            "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max",
            "sunrise", "sunset",
        ].join(","),
        hourly: [
            "temperature_2m", "relative_humidity_2m", "weather_code",
            "precipitation", "wind_speed_10m",
        ].join(","),
        forecast_days: "7",
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
    const data = await fetchJSON(url);
    const current = {
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
    const daily = data.daily.time.map((date, i) => ({
        date,
        maxTemp: data.daily.temperature_2m_max[i],
        minTemp: data.daily.temperature_2m_min[i],
        weatherCode: data.daily.weather_code[i],
        precipitationSum: data.daily.precipitation_sum[i],
        precipitationProbability: data.daily.precipitation_probability_max[i],
        windSpeedMax: data.daily.wind_speed_10m_max[i],
        sunrise: data.daily.sunrise[i],
        sunset: data.daily.sunset[i],
    }));
    const now = new Date();
    const currentHourStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`;
    const startIdx = data.hourly.time.indexOf(currentHourStr);
    const sliceStart = startIdx >= 0 ? startIdx : 0;
    const hourly = data.hourly.time
        .slice(sliceStart, sliceStart + 24)
        .map((time, i) => ({
        time,
        temperature: data.hourly.temperature_2m[sliceStart + i],
        humidity: data.hourly.relative_humidity_2m[sliceStart + i],
        weatherCode: data.hourly.weather_code[sliceStart + i],
        precipitation: data.hourly.precipitation[sliceStart + i],
        windSpeed: data.hourly.wind_speed_10m[sliceStart + i],
    }));
    return { location, current, daily, hourly };
}
/* ============================== 预报统计 / 预警 ============================== */
function computeForecastStats(daily) {
    const temps = daily.flatMap((d) => [d.minTemp, d.maxTemp]);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
    const totalPrecip = daily.reduce((a, d) => a + d.precipitationSum, 0);
    const maxWind = Math.max(...daily.map((d) => d.windSpeedMax));
    return { avgTemp, minTemp, maxTemp, totalPrecip, maxWind, range: [minTemp, maxTemp] };
}
function detectAlerts(weather) {
    const alerts = [];
    const c = weather.current;
    if (c.weatherCode >= 95) {
        alerts.push({ level: "severe", title: "雷暴天气", message: "当前有雷暴，请避免户外活动并远离空旷地带", condition: WeatherCondition.Thunderstorm });
    }
    if (c.windSpeed >= 50) {
        alerts.push({ level: "warning", title: "大风警报", message: `当前风速 ${c.windSpeed} km/h，请注意出行安全` });
    }
    else if (c.windSpeed >= 30) {
        alerts.push({ level: "info", title: "风力较强", message: `当前风速 ${c.windSpeed} km/h` });
    }
    if (c.temperature >= 35) {
        alerts.push({ level: "warning", title: "高温警报", message: `气温 ${c.temperature}°C，请注意防暑降温` });
    }
    else if (c.temperature <= -10) {
        alerts.push({ level: "warning", title: "严寒警报", message: `气温 ${c.temperature}°C，请注意防寒保暖` });
    }
    if ([65, 82, 67, 57].includes(c.weatherCode)) {
        alerts.push({ level: "warning", title: "强降水", message: "当前有强降水，注意防范积涝", condition: WeatherCondition.Rain });
    }
    if (c.weatherCode === 45 || c.weatherCode === 48) {
        alerts.push({ level: "info", title: "大雾提醒", message: "能见度较低，出行请注意安全", condition: WeatherCondition.Fog });
    }
    if (c.humidity >= 90 && c.weatherCode === 0) {
        alerts.push({ level: "info", title: "高湿", message: `湿度 ${c.humidity}%，体感闷热` });
    }
    return alerts;
}
/** 泛型预报数据获取器（演示条件类型 ForecastData 的使用） */
function getForecast(weather, type) {
    switch (type) {
        case ForecastType.Current: return weather.current;
        case ForecastType.Daily: return weather.daily;
        case ForecastType.Hourly: return weather.hourly;
        default: throw new ApiError(`未知预报类型：${type}`, "INVALID_FORECAST_TYPE");
    }
}
//# sourceMappingURL=api.js.map