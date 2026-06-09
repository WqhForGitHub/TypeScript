"use strict";
/**
 * 天气 API 模块
 *
 * 使用 Open-Meteo API（免费、无需 API Key）获取天气数据。
 * - 地理编码：https://geocoding-api.open-meteo.com
 * - 天气数据：https://api.open-meteo.com
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
exports.getWeatherDescription = getWeatherDescription;
exports.getWeatherIcon = getWeatherIcon;
exports.geocode = geocode;
exports.geocodeMultiple = geocodeMultiple;
exports.fetchWeather = fetchWeather;
const https = __importStar(require("https"));
/* ============================== WMO 天气代码映射 ============================== */
const WMO_CODES = {
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
function getWeatherDescription(code) {
    return WMO_CODES[code]?.description ?? "未知";
}
/** 获取天气图标 */
function getWeatherIcon(code) {
    return WMO_CODES[code]?.icon ?? "❓";
}
/* ============================== HTTP 请求工具 ============================== */
function httpsGet(url) {
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
            res.on("data", (chunk) => {
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
function fetchJSON(url) {
    return httpsGet(url).then((data) => JSON.parse(data));
}
/**
 * 将城市名称转换为地理坐标
 * 支持中文城市名和英文城市名
 */
async function geocode(cityName) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=zh&format=json`;
    const data = await fetchJSON(url);
    if (!data.results || data.results.length === 0) {
        throw new Error(`未找到城市：「${cityName}」。请检查城市名称是否正确。`);
    }
    // 优先选择中国城市（如果搜索的是中文名）
    const result = data.results[0];
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
async function geocodeMultiple(cityName) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=zh&format=json`;
    const data = await fetchJSON(url);
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
/**
 * 获取完整天气数据（当前 + 7 日预报 + 24 小时预报）
 */
async function fetchWeather(location) {
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
    const data = await fetchJSON(url);
    // 解析当前天气
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
    };
    // 解析每日预报
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
    // 解析 24 小时预报（从当前小时开始的 24 个小时）
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
//# sourceMappingURL=api.js.map