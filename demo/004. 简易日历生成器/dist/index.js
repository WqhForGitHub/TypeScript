#!/usr/bin/env node
"use strict";
/**
 * 简易日历生成器 (增强版)
 * ---------------------------
 * 在原有功能基础上大幅增强，演示大量 TypeScript 高级特性。
 *
 * 支持特性：
 *   - 多种输出格式：纯文本、HTML、Markdown、JSON
 *   - 节假日标记（中国 / 美国节假日，含浮动节日计算）
 *   - 简易农历标注（基于平均朔望月的近似推算）
 *   - 全年日历视图 (year-at-a-glance)
 *   - ISO 8601 周数显示
 *   - 可配置每周起始日（周日 / 周一）
 *   - 日历事件与备注（节假日 / 提醒 / 备注）
 *   - 日期区间查询与过滤
 *   - ANSI 颜色高亮（周末 / 节假日）
 *   - 可迭代日历对象（Iterator 协议）
 *
 * 使用方式：
 *   cal-cli                              → 显示当前月份日历
 *   cal-cli 2026                         → 显示 2026 年全年日历
 *   cal-cli 2026 6                       → 显示 2026 年 6 月日历
 *   cal-cli 2026 6 --format html         → 以 HTML 格式输出
 *   cal-cli --demo                       → 演示高级特性
 *   cal-cli --help                       → 显示帮助
 */
// =====================================================================
// 1. 枚举 (Enums)
// =====================================================================
/** 月份枚举 */
var Month;
(function (Month) {
    Month[Month["January"] = 1] = "January";
    Month[Month["February"] = 2] = "February";
    Month[Month["March"] = 3] = "March";
    Month[Month["April"] = 4] = "April";
    Month[Month["May"] = 5] = "May";
    Month[Month["June"] = 6] = "June";
    Month[Month["July"] = 7] = "July";
    Month[Month["August"] = 8] = "August";
    Month[Month["September"] = 9] = "September";
    Month[Month["October"] = 10] = "October";
    Month[Month["November"] = 11] = "November";
    Month[Month["December"] = 12] = "December";
})(Month || (Month = {}));
/** 星期枚举 (0=周日 ... 6=周六) */
var Weekday;
(function (Weekday) {
    Weekday[Weekday["Sunday"] = 0] = "Sunday";
    Weekday[Weekday["Monday"] = 1] = "Monday";
    Weekday[Weekday["Tuesday"] = 2] = "Tuesday";
    Weekday[Weekday["Wednesday"] = 3] = "Wednesday";
    Weekday[Weekday["Thursday"] = 4] = "Thursday";
    Weekday[Weekday["Friday"] = 5] = "Friday";
    Weekday[Weekday["Saturday"] = 6] = "Saturday";
})(Weekday || (Weekday = {}));
/** 日历输出格式 */
var CalendarFormat;
(function (CalendarFormat) {
    CalendarFormat["Text"] = "text";
    CalendarFormat["Html"] = "html";
    CalendarFormat["Markdown"] = "markdown";
    CalendarFormat["Json"] = "json";
})(CalendarFormat || (CalendarFormat = {}));
/** 输出样式 */
var OutputStyle;
(function (OutputStyle) {
    OutputStyle["Plain"] = "plain";
    OutputStyle["Colored"] = "colored";
})(OutputStyle || (OutputStyle = {}));
/** 每周起始日 */
var WeekStart;
(function (WeekStart) {
    WeekStart[WeekStart["Sunday"] = 0] = "Sunday";
    WeekStart[WeekStart["Monday"] = 1] = "Monday";
})(WeekStart || (WeekStart = {}));
/** 事件优先级 */
var Priority;
(function (Priority) {
    Priority["Low"] = "low";
    Priority["Medium"] = "medium";
    Priority["High"] = "high";
})(Priority || (Priority = {}));
/** 默认配置 */
const DEFAULT_CONFIG = {
    format: CalendarFormat.Text,
    style: OutputStyle.Plain,
    weekStart: WeekStart.Sunday,
    showWeekNumbers: false,
    showLunar: false,
    showEvents: true,
    region: "CN",
    locale: "zh-CN",
};
// =====================================================================
// 11. 自定义错误类层级 (Custom Error Hierarchy)
// =====================================================================
/** 日历错误抽象基类 */
class CalendarError extends Error {
    constructor(message) {
        super(message);
        this.name = "CalendarError";
        // 修复原型链，使 instanceof 在 ES5+ 下正常工作
        Object.setPrototypeOf(this, new.target.prototype);
    }
    toJSON() {
        return { code: this.code, message: this.message, name: this.name };
    }
}
class InvalidYearError extends CalendarError {
    constructor(year) {
        super(`无效年份: ${year} (应为 1-9999 之间的整数)`);
        this.code = "INVALID_YEAR";
        this.name = "InvalidYearError";
    }
}
class InvalidMonthError extends CalendarError {
    constructor(month) {
        super(`无效月份: ${month} (应为 1-12 之间的整数)`);
        this.code = "INVALID_MONTH";
        this.name = "InvalidMonthError";
    }
}
class InvalidDateError extends CalendarError {
    constructor(input) {
        super(`无效日期: ${input}`);
        this.code = "INVALID_DATE";
        this.name = "InvalidDateError";
    }
}
class UnsupportedFormatError extends CalendarError {
    constructor(format) {
        super(`不支持的输出格式: ${format}`);
        this.code = "UNSUPPORTED_FORMAT";
        this.name = "UnsupportedFormatError";
    }
}
class DateRangeError extends CalendarError {
    constructor(message) {
        super(message);
        this.code = "DATE_RANGE";
        this.name = "DateRangeError";
    }
}
class InvalidArgumentError extends CalendarError {
    constructor(arg, value) {
        super(`无效参数 ${arg}: ${value}`);
        this.code = "INVALID_ARGUMENT";
        this.name = "InvalidArgumentError";
    }
}
// =====================================================================
// 12. 常量 (as const 断言)
// =====================================================================
const MONTH_NAMES_CN = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月",
];
const MONTH_NAMES_EN = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_HEADER_CN = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_HEADER_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_HEADER_CN_MON = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_HEADER_EN_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const LUNAR_DAY_NAMES = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];
const LUNAR_MONTH_NAMES = [
    "正月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "冬月", "腊月",
];
/** ANSI 颜色码 */
const ANSI = {
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
};
// =====================================================================
// 13. satisfies 运算符 (+ as const)
// =====================================================================
/** 中国节假日（M-D 为键）。as const 保留字面量类型，satisfies 校验符合 HolidayEvent。 */
const CN_HOLIDAYS = {
    "1-1": { type: "holiday", name: "元旦", region: "CN", isOffDay: true },
    "2-14": { type: "holiday", name: "情人节", region: "CN", isOffDay: false },
    "3-8": { type: "holiday", name: "妇女节", region: "CN", isOffDay: false },
    "3-12": { type: "holiday", name: "植树节", region: "CN", isOffDay: false },
    "5-1": { type: "holiday", name: "劳动节", region: "CN", isOffDay: true },
    "6-1": { type: "holiday", name: "儿童节", region: "CN", isOffDay: false },
    "7-1": { type: "holiday", name: "建党节", region: "CN", isOffDay: false },
    "8-1": { type: "holiday", name: "建军节", region: "CN", isOffDay: false },
    "9-10": { type: "holiday", name: "教师节", region: "CN", isOffDay: false },
    "10-1": { type: "holiday", name: "国庆节", region: "CN", isOffDay: true },
    "11-11": { type: "holiday", name: "双十一", region: "CN", isOffDay: false },
    "12-25": { type: "holiday", name: "圣诞节", region: "CN", isOffDay: false },
};
/** 美国固定日期节假日（浮动节日单独计算） */
const US_HOLIDAYS_FIXED = {
    "1-1": { type: "holiday", name: "New Year's Day", region: "US", isOffDay: true },
    "2-14": { type: "holiday", name: "Valentine's Day", region: "US", isOffDay: false },
    "3-17": { type: "holiday", name: "St. Patrick's Day", region: "US", isOffDay: false },
    "4-15": { type: "holiday", name: "Tax Day", region: "US", isOffDay: false },
    "6-14": { type: "holiday", name: "Flag Day", region: "US", isOffDay: false },
    "7-4": { type: "holiday", name: "Independence Day", region: "US", isOffDay: true },
    "9-11": { type: "holiday", name: "Patriot Day", region: "US", isOffDay: false },
    "10-31": { type: "holiday", name: "Halloween", region: "US", isOffDay: false },
    "11-11": { type: "holiday", name: "Veterans Day", region: "US", isOffDay: true },
    "12-25": { type: "holiday", name: "Christmas Day", region: "US", isOffDay: true },
};
// =====================================================================
// 14. 类型守卫 (Type Guards)
// =====================================================================
function isWeekend(weekday) {
    return weekday === Weekday.Sunday || weekday === Weekday.Saturday;
}
function isHoliday(dateKey, holidays) {
    return dateKey in holidays;
}
function isValidYear(year) {
    return Number.isInteger(year) && year >= 1 && year <= 9999;
}
function isValidMonth(month) {
    return Number.isInteger(month) && month >= 1 && month <= 12;
}
function isValidDate(year, month, day) {
    if (!isValidYear(year))
        return false;
    if (!isValidMonth(month))
        return false;
    return day >= 1 && day <= getDaysInMonth(year, month);
}
function isHolidayEvent(event) {
    return event.type === "holiday";
}
function isReminderEvent(event) {
    return event.type === "reminder";
}
function isNoteEvent(event) {
    return event.type === "note";
}
function isCalendarError(err) {
    return err instanceof CalendarError;
}
// =====================================================================
// 15. 工具函数
// =====================================================================
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function getDaysInMonth(year, month) {
    if (month === Month.February && isLeapYear(year))
        return 29;
    return DAYS_IN_MONTH[month - 1];
}
function getFirstWeekday(year, month) {
    return new Date(year, month - 1, 1).getDay();
}
function getWeekdayOf(year, month, day) {
    return new Date(year, month - 1, day).getDay();
}
/** ISO 8601 周数计算 */
function getISOWeekNumber(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayNum = (date.getUTCDay() + 6) % 7; // 周一 = 0
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // 定位到本周周四
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const diffMs = date.getTime() - firstThursday.getTime();
    return 1 + Math.round(diffMs / (7 * 24 * 3600 * 1000));
}
/** 简易农历：基于平均朔望月 (29.5306 天) 的近似推算（非精确） */
function getLunarApprox(year, month, day) {
    // 以 1900-01-31 作为农历正月初一的近似基准
    const base = Date.UTC(1900, 0, 31);
    const target = Date.UTC(year, month - 1, day);
    const synodicMonth = 29.5306;
    const totalDays = Math.floor((target - base) / (24 * 3600 * 1000));
    let lunarMonthIdx = Math.floor(totalDays / synodicMonth) % 12;
    if (lunarMonthIdx < 0)
        lunarMonthIdx += 12;
    const monthStartDay = Math.floor(totalDays / synodicMonth) * synodicMonth;
    const dayInMonth = Math.floor(totalDays - monthStartDay);
    const lunarDay = ((dayInMonth % 30) + 30) % 30;
    return `${LUNAR_MONTH_NAMES[lunarMonthIdx]}${LUNAR_DAY_NAMES[lunarDay]}`;
}
/** 计算某年第 n 个星期几对应的日期 */
function nthWeekdayOfMonth(year, month, weekday, n) {
    const first = getFirstWeekday(year, month);
    const offset = (weekday - first + 7) % 7;
    return 1 + offset + (n - 1) * 7;
}
/** 计算某年某月最后一个星期几对应的日期 */
function lastWeekdayOfMonth(year, month, weekday) {
    const daysInMonth = getDaysInMonth(year, month);
    const lastWd = getWeekdayOf(year, month, daysInMonth);
    return daysInMonth - ((lastWd - weekday + 7) % 7);
}
function colorize(text, ...colors) {
    return colors.join("") + text + ANSI.reset;
}
function flattenMatrix(matrix) {
    const result = [];
    for (const week of matrix) {
        for (const cell of week) {
            result.push(cell);
        }
    }
    return result;
}
function mergeConfig(override) {
    return { ...DEFAULT_CONFIG, ...override };
}
function toWeekRow(cells) {
    if (cells.length !== 7) {
        throw new DateRangeError(`周行必须包含 7 个单元格，实际 ${cells.length}`);
    }
    return cells;
}
class SimpleLunarStrategy {
    getLunarLabel(year, month, day) {
        return getLunarApprox(year, month, day);
    }
}
class NullLunarStrategy {
    getLunarLabel() {
        return null;
    }
}
class ChineseHolidayStrategy {
    constructor() {
        this.floating = { ...CN_HOLIDAYS };
    }
    getHolidays() {
        return this.floating;
    }
    isHoliday(dateKey) {
        return dateKey in this.floating;
    }
    getHoliday(dateKey) {
        return dateKey in this.floating ? this.floating[dateKey] : undefined;
    }
}
/** 美国节假日策略（含浮动节日：马丁路德金日、总统日、感恩节等） */
class AmericanHolidayStrategy {
    constructor() {
        this.cache = new Map();
    }
    getHolidays(year) {
        const cached = this.cache.get(year);
        if (cached)
            return cached;
        const map = { ...US_HOLIDAYS_FIXED };
        // 马丁路德金日：1 月第三个周一
        map[`1-${nthWeekdayOfMonth(year, Month.January, Weekday.Monday, 3)}`] =
            { type: "holiday", name: "MLK Day", region: "US", isOffDay: true };
        // 总统日：2 月第三个周一
        map[`2-${nthWeekdayOfMonth(year, Month.February, Weekday.Monday, 3)}`] =
            { type: "holiday", name: "Presidents' Day", region: "US", isOffDay: true };
        // 母亲节：5 月第二个周日
        map[`5-${nthWeekdayOfMonth(year, Month.May, Weekday.Sunday, 2)}`] =
            { type: "holiday", name: "Mother's Day", region: "US", isOffDay: false };
        // 阵亡将士纪念日：5 月最后一个周一
        map[`5-${lastWeekdayOfMonth(year, Month.May, Weekday.Monday)}`] =
            { type: "holiday", name: "Memorial Day", region: "US", isOffDay: true };
        // 父亲节：6 月第三个周日
        map[`6-${nthWeekdayOfMonth(year, Month.June, Weekday.Sunday, 3)}`] =
            { type: "holiday", name: "Father's Day", region: "US", isOffDay: false };
        // 劳动节：9 月第一个周一
        map[`9-${nthWeekdayOfMonth(year, Month.September, Weekday.Monday, 1)}`] =
            { type: "holiday", name: "Labor Day", region: "US", isOffDay: true };
        // 哥伦布日：10 月第二个周一
        map[`10-${nthWeekdayOfMonth(year, Month.October, Weekday.Monday, 2)}`] =
            { type: "holiday", name: "Columbus Day", region: "US", isOffDay: false };
        // 感恩节：11 月第四个周四
        map[`11-${nthWeekdayOfMonth(year, Month.November, Weekday.Thursday, 4)}`] =
            { type: "holiday", name: "Thanksgiving", region: "US", isOffDay: true };
        this.cache.set(year, map);
        return map;
    }
    isHoliday(dateKey, year) {
        return dateKey in this.getHolidays(year);
    }
    getHoliday(dateKey, year) {
        const holidays = this.getHolidays(year);
        return dateKey in holidays ? holidays[dateKey] : undefined;
    }
}
function createHolidayStrategy(region) {
    return region === "CN" ? new ChineseHolidayStrategy() : new AmericanHolidayStrategy();
}
function createLunarStrategy(showLunar) {
    return showLunar ? new SimpleLunarStrategy() : new NullLunarStrategy();
}
// =====================================================================
// 17. 单元格工厂
// =====================================================================
function makeBlankCell(weekday) {
    return {
        day: null,
        weekday,
        isWeekend: isWeekend(weekday),
        isHoliday: false,
        weekNumber: null,
        lunarLabel: null,
        events: [],
        dateKey: null,
    };
}
function makeDayCell(year, month, day, weekday, holidays, lunarStrategy, config) {
    const dateKey = `${month}-${day}`;
    const holiday = dateKey in holidays ? holidays[dateKey] : undefined;
    const events = holiday ? [holiday] : [];
    return {
        day,
        weekday,
        isWeekend: isWeekend(weekday),
        isHoliday: Boolean(holiday),
        weekNumber: getISOWeekNumber(year, month, day),
        lunarLabel: config.showLunar ? lunarStrategy.getLunarLabel(year, month, day) : null,
        events,
        dateKey,
    };
}
// =====================================================================
// 18. 月度数据构建
// =====================================================================
function buildMonthData(year, month, config, holidayStrategy, lunarStrategy) {
    const totalDays = getDaysInMonth(year, month);
    const firstWeekday = getFirstWeekday(year, month);
    const offset = config.weekStart === WeekStart.Sunday
        ? firstWeekday
        : (firstWeekday + 6) % 7;
    const holidays = holidayStrategy.getHolidays(year);
    const weekdayForCol = (col) => ((config.weekStart + col) % 7);
    const cells = [];
    // 前置空白
    for (let i = 0; i < offset; i++) {
        cells.push(makeBlankCell(weekdayForCol(i)));
    }
    // 填入日期
    for (let day = 1; day <= totalDays; day++) {
        const weekday = getWeekdayOf(year, month, day);
        cells.push(makeDayCell(year, month, day, weekday, holidays, lunarStrategy, config));
    }
    // 末尾补齐到 7 的倍数
    while (cells.length % 7 !== 0) {
        cells.push(makeBlankCell(weekdayForCol(cells.length % 7)));
    }
    // 切分成周
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
        weeks.push(toWeekRow(cells.slice(i, i + 7)));
    }
    return weeks;
}
function buildCalendarData(year, month, config) {
    const lunarStrategy = createLunarStrategy(config.showLunar);
    const holidayStrategy = createHolidayStrategy(config.region);
    const weeks = buildMonthData(year, month, config, holidayStrategy, lunarStrategy);
    return {
        year,
        month,
        monthName: config.locale === "zh-CN" ? MONTH_NAMES_CN[month - 1] : MONTH_NAMES_EN[month - 1],
        weeks,
    };
}
// =====================================================================
// 19. 抽象渲染器基类 + 具体子类 (Abstract Classes / Strategy)
// =====================================================================
class CalendarRenderer {
    constructor(config) {
        this.config = config;
        this.lunarStrategy = createLunarStrategy(config.showLunar);
        this.holidayStrategy = createHolidayStrategy(config.region);
    }
    buildMonthData(year, month) {
        return buildMonthData(year, month, this.config, this.holidayStrategy, this.lunarStrategy);
    }
    getWeekdayHeaders() {
        const cn = this.config.locale === "zh-CN";
        if (this.config.weekStart === WeekStart.Sunday) {
            return cn ? WEEKDAY_HEADER_CN : WEEKDAY_HEADER_EN;
        }
        return cn ? WEEKDAY_HEADER_CN_MON : WEEKDAY_HEADER_EN_MON;
    }
    getMonthName(month) {
        return this.config.locale === "zh-CN"
            ? MONTH_NAMES_CN[month - 1]
            : MONTH_NAMES_EN[month - 1];
    }
    makeTitle(year, month) {
        return `${year} 年 ${this.getMonthName(month)}`;
    }
}
/** 纯文本渲染器 */
class TextRenderer extends CalendarRenderer {
    constructor() {
        super(...arguments);
        this.format = CalendarFormat.Text;
    }
    renderMonth(year, month) {
        const matrix = this.buildMonthData(year, month);
        const title = this.makeTitle(year, month);
        const headers = this.getWeekdayHeaders();
        const showWk = this.config.showWeekNumbers;
        const colored = this.config.style === OutputStyle.Colored;
        const lines = [];
        const headerLine = (showWk ? "WK " : "") + headers.join("  ");
        const padLeft = Math.max(0, Math.floor((headerLine.length - title.length) / 2));
        lines.push(" ".repeat(padLeft) + title);
        lines.push(colored ? colorize(headerLine, ANSI.bold) : headerLine);
        for (const week of matrix) {
            const parts = [];
            if (showWk) {
                const wkCell = week.find((c) => c.day !== null && c.weekNumber !== null);
                parts.push(String(wkCell?.weekNumber ?? 0).padStart(2, " ") + " ");
            }
            for (const cell of week) {
                parts.push(this.renderTextCell(cell, colored));
            }
            lines.push(parts.join(" "));
        }
        // 节假日标注
        if (this.config.showEvents) {
            const holidayCells = flattenMatrix(matrix).filter((c) => c.isHoliday && c.day !== null);
            if (holidayCells.length > 0) {
                lines.push("");
                for (const c of holidayCells) {
                    const evt = c.events.find(isHolidayEvent);
                    if (evt && c.dateKey) {
                        let line = `  * ${c.dateKey} ${evt.name}${evt.isOffDay ? " (休)" : ""}`;
                        if (colored)
                            line = colorize(line, ANSI.cyan);
                        lines.push(line);
                    }
                }
            }
        }
        return lines.join("\n");
    }
    renderTextCell(cell, colored) {
        if (cell.day === null)
            return "  ";
        let text = cell.day.toString().padStart(2, " ");
        if (colored) {
            if (cell.isHoliday)
                text = colorize(text, ANSI.cyan, ANSI.bold);
            else if (cell.isWeekend)
                text = colorize(text, ANSI.red);
            else
                text = colorize(text, ANSI.white);
        }
        return text;
    }
    renderYear(year) {
        const blocks = [];
        blocks.push(`========== ${year} 年日历 ==========`);
        for (let m = 1; m <= 12; m++) {
            blocks.push("");
            blocks.push(this.renderMonth(year, m));
        }
        return blocks.join("\n");
    }
}
/** HTML 渲染器 */
class HtmlRenderer extends CalendarRenderer {
    constructor() {
        super(...arguments);
        this.format = CalendarFormat.Html;
    }
    renderMonth(year, month) {
        const matrix = this.buildMonthData(year, month);
        const headers = this.getWeekdayHeaders();
        const lines = [];
        lines.push(`<table class="calendar">`);
        lines.push(`  <caption>${year} 年 ${this.getMonthName(month)}</caption>`);
        lines.push(`  <thead><tr>`);
        if (this.config.showWeekNumbers)
            lines.push(`<th>WK</th>`);
        for (const h of headers)
            lines.push(`<th>${h}</th>`);
        lines.push(`  </tr></thead>`);
        lines.push(`  <tbody>`);
        for (const week of matrix) {
            lines.push(`  <tr>`);
            if (this.config.showWeekNumbers) {
                const wkCell = week.find((c) => c.day !== null && c.weekNumber !== null);
                lines.push(`<td class="wk">${wkCell?.weekNumber ?? ""}</td>`);
            }
            for (const cell of week) {
                lines.push(this.renderHtmlCell(cell));
            }
            lines.push(`  </tr>`);
        }
        lines.push(`  </tbody>`);
        lines.push(`</table>`);
        return lines.join("\n");
    }
    renderHtmlCell(cell) {
        if (cell.day === null)
            return `<td class="empty"></td>`;
        const classes = [];
        if (cell.isWeekend)
            classes.push("weekend");
        if (cell.isHoliday)
            classes.push("holiday");
        const lunar = cell.lunarLabel
            ? `<span class="lunar">${cell.lunarLabel}</span>`
            : "";
        const cls = classes.length ? ` class="${classes.join(" ")}"` : "";
        return `<td${cls}>${cell.day}${lunar}</td>`;
    }
    renderYear(year) {
        const parts = [
            `<!DOCTYPE html>`,
            `<html lang="${this.config.locale}">`,
            `<head><meta charset="utf-8"><title>${year} 年日历</title></head>`,
            `<body>`,
            `<div class="year-calendar"><h1>${year} 年</h1>`,
        ];
        for (let m = 1; m <= 12; m++) {
            parts.push(this.renderMonth(year, m));
        }
        parts.push(`</div>`);
        parts.push(`</body></html>`);
        return parts.join("\n");
    }
}
/** Markdown 渲染器 */
class MarkdownRenderer extends CalendarRenderer {
    constructor() {
        super(...arguments);
        this.format = CalendarFormat.Markdown;
    }
    renderMonth(year, month) {
        const matrix = this.buildMonthData(year, month);
        const headers = this.getWeekdayHeaders();
        const lines = [];
        lines.push(`## ${year} 年 ${this.getMonthName(month)}`);
        const headerRow = [];
        if (this.config.showWeekNumbers)
            headerRow.push("WK");
        for (const h of headers)
            headerRow.push(h);
        lines.push(`| ${headerRow.join(" | ")} |`);
        lines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);
        for (const week of matrix) {
            const row = [];
            if (this.config.showWeekNumbers) {
                const wkCell = week.find((c) => c.day !== null && c.weekNumber !== null);
                row.push(String(wkCell?.weekNumber ?? ""));
            }
            for (const cell of week) {
                row.push(this.renderMdCell(cell));
            }
            lines.push(`| ${row.join(" | ")} |`);
        }
        return lines.join("\n");
    }
    renderMdCell(cell) {
        if (cell.day === null)
            return " ";
        let text = String(cell.day);
        if (cell.isHoliday)
            text = `**${text}**`;
        if (cell.lunarLabel)
            text += `<br/>${cell.lunarLabel}`;
        return text;
    }
    renderYear(year) {
        const parts = [`# ${year} 年日历`];
        for (let m = 1; m <= 12; m++) {
            parts.push("");
            parts.push(this.renderMonth(year, m));
        }
        return parts.join("\n");
    }
}
/** JSON 渲染器（输出 JSON 字符串） */
class JsonRenderer extends CalendarRenderer {
    constructor() {
        super(...arguments);
        this.format = CalendarFormat.Json;
    }
    renderMonth(year, month) {
        return JSON.stringify(buildCalendarData(year, month, this.config), null, 2);
    }
    renderYear(year) {
        const months = [];
        for (let m = 1; m <= 12; m++) {
            months.push(buildCalendarData(year, m, this.config));
        }
        return JSON.stringify({ year, months }, null, 2);
    }
}
function createRenderer(format, config) {
    switch (format) {
        case CalendarFormat.Text:
            return new TextRenderer(config);
        case CalendarFormat.Html:
            return new HtmlRenderer(config);
        case CalendarFormat.Markdown:
            return new MarkdownRenderer(config);
        case CalendarFormat.Json:
            return new JsonRenderer(config);
        default:
            throw new UnsupportedFormatError(String(format));
    }
}
// =====================================================================
// 20. 泛型渲染入口 (Generics with constraints + Conditional return)
// =====================================================================
function renderCalendar(year, month, format, config) {
    const merged = mergeConfig({ ...config, format });
    if (format === CalendarFormat.Json) {
        return buildCalendarData(year, month, merged);
    }
    const renderer = createRenderer(format, merged);
    return renderer.renderMonth(year, month);
}
// =====================================================================
// 21. 可迭代日历对象 (Iterator Protocol)
// =====================================================================
class MonthCalendar {
    constructor(year, month, matrix, config = DEFAULT_CONFIG) {
        this.year = year;
        this.month = month;
        this.matrix = matrix;
        this.config = config;
    }
    *[Symbol.iterator]() {
        for (const week of this.matrix) {
            for (const cell of week) {
                yield cell;
            }
        }
    }
    getCells() {
        return flattenMatrix(this.matrix);
    }
    filter(predicate) {
        return this.getCells().filter(predicate);
    }
    findHolidays() {
        return this.filter((c) => c.isHoliday && c.day !== null);
    }
    findWeekends() {
        return this.filter((c) => c.isWeekend && c.day !== null);
    }
    getDay(day) {
        return this.getCells().find((c) => c.day === day);
    }
}
function queryDateRange(range, predicate, config) {
    const start = new Date(range.start.year, range.start.month - 1, range.start.day);
    const end = new Date(range.end.year, range.end.month - 1, range.end.day);
    if (start > end) {
        throw new DateRangeError("起始日期不能晚于结束日期");
    }
    const holidayStrategy = createHolidayStrategy(config.region);
    const lunarStrategy = createLunarStrategy(config.showLunar);
    const result = [];
    const cursor = new Date(start.getTime());
    while (cursor <= end) {
        const year = cursor.getFullYear();
        const month = (cursor.getMonth() + 1);
        const day = cursor.getDate();
        const weekday = cursor.getDay();
        const dateKey = `${month}-${day}`;
        const holidays = holidayStrategy.getHolidays(year);
        const holiday = dateKey in holidays ? holidays[dateKey] : undefined;
        const events = holiday ? [holiday] : [];
        const cell = {
            day,
            weekday,
            isWeekend: isWeekend(weekday),
            isHoliday: Boolean(holiday),
            weekNumber: getISOWeekNumber(year, month, day),
            lunarLabel: lunarStrategy.getLunarLabel(year, month, day),
            events,
            dateKey,
        };
        if (predicate(cell))
            result.push(cell);
        cursor.setDate(cursor.getDate() + 1);
    }
    return result;
}
// =====================================================================
// 23. 辅助：单元格摘要与事件名称 (使用 Pick / Omit / 条件类型)
// =====================================================================
function summarizeCell(cell) {
    return {
        day: cell.day,
        weekday: cell.weekday,
        isWeekend: cell.isWeekend,
        isHoliday: cell.isHoliday,
        weekNumber: cell.weekNumber,
    };
}
function getEventName(event) {
    if (isHolidayEvent(event))
        return event.name;
    if (isReminderEvent(event))
        return event.title;
    return event.content;
}
function eventNameOf(event) {
    return getEventName(event);
}
function generate(year, ...rest) {
    let month;
    let configOverride = {};
    if (rest.length >= 1) {
        const first = rest[0];
        if (typeof first === "number") {
            month = first;
            if (rest.length >= 2 && typeof rest[1] === "object" && rest[1] !== null) {
                configOverride = rest[1];
            }
        }
        else if (typeof first === "object" && first !== null) {
            configOverride = first;
        }
    }
    const config = mergeConfig(configOverride);
    if (config.format === CalendarFormat.Json) {
        const renderer = new JsonRenderer(config);
        return month !== undefined ? renderer.renderMonth(year, month) : renderer.renderYear(year);
    }
    const renderer = createRenderer(config.format, config);
    return month !== undefined ? renderer.renderMonth(year, month) : renderer.renderYear(year);
}
function parseFormat(val) {
    switch (val) {
        case "text":
            return CalendarFormat.Text;
        case "html":
            return CalendarFormat.Html;
        case "markdown":
        case "md":
            return CalendarFormat.Markdown;
        case "json":
            return CalendarFormat.Json;
        default:
            throw new InvalidArgumentError("--format", String(val));
    }
}
function parseStyle(val) {
    switch (val) {
        case "plain":
            return OutputStyle.Plain;
        case "colored":
        case "color":
            return OutputStyle.Colored;
        default:
            throw new InvalidArgumentError("--style", String(val));
    }
}
function parseWeekStart(val) {
    switch (val) {
        case "sunday":
        case "sun":
            return WeekStart.Sunday;
        case "monday":
        case "mon":
            return WeekStart.Monday;
        default:
            throw new InvalidArgumentError("--week-start", String(val));
    }
}
function parseRegion(val) {
    switch (val) {
        case "CN":
        case "cn":
            return "CN";
        case "US":
        case "us":
            return "US";
        default:
            throw new InvalidArgumentError("--region", String(val));
    }
}
function parseArgs(argv) {
    const args = argv.slice(2);
    const now = new Date();
    // 解析阶段需要可变对象，故使用 Writable<Partial<CalendarConfig>>。
    // 返回时自动兼容只读的 Partial<CalendarConfig>。
    const config = {};
    if (args.includes("--help") || args.includes("-h")) {
        return { year: now.getFullYear(), showHelp: true, showDemo: false, config };
    }
    if (args.includes("--demo")) {
        return { year: now.getFullYear(), showHelp: false, showDemo: true, config };
    }
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        switch (a) {
            case "--format":
            case "-f":
                config.format = parseFormat(args[++i]);
                break;
            case "--style":
                config.style = parseStyle(args[++i]);
                break;
            case "--week-start":
                config.weekStart = parseWeekStart(args[++i]);
                break;
            case "--week-numbers":
            case "-w":
                config.showWeekNumbers = true;
                break;
            case "--lunar":
            case "-l":
                config.showLunar = true;
                break;
            case "--region":
                config.region = parseRegion(args[++i]);
                break;
            case "--locale":
                config.locale = args[++i] === "en-US" ? "en-US" : "zh-CN";
                break;
            case "--no-events":
                config.showEvents = false;
                break;
            default:
                if (a.startsWith("--")) {
                    throw new InvalidArgumentError(a, "(未知选项)");
                }
                positional.push(a);
        }
    }
    if (positional.length === 0) {
        return {
            year: now.getFullYear(),
            month: (now.getMonth() + 1),
            showHelp: false,
            showDemo: false,
            config,
        };
    }
    const yearNum = Number(positional[0]);
    if (!isValidYear(yearNum)) {
        throw new InvalidYearError(Number(positional[0]));
    }
    if (positional.length === 1) {
        return { year: yearNum, showHelp: false, showDemo: false, config };
    }
    const monthNum = Number(positional[1]);
    if (!isValidMonth(monthNum)) {
        throw new InvalidMonthError(Number(positional[1]));
    }
    return {
        year: yearNum,
        month: monthNum,
        showHelp: false,
        showDemo: false,
        config,
    };
}
function printHelp() {
    const help = `
简易日历生成器 (TypeScript 增强版)

用法:
  cal-cli                              显示当前月份日历
  cal-cli <year>                       显示指定年份的全年日历
  cal-cli <year> <month>               显示指定年月的日历
  cal-cli --demo                       演示高级特性
  cal-cli --help, -h                   显示帮助信息

选项:
  -f, --format <text|html|markdown|json>   输出格式 (默认: text)
  --style <plain|colored>                  输出样式 (默认: plain)
  --week-start <sunday|monday>             每周起始日 (默认: sunday)
  -w, --week-numbers                       显示 ISO 周数
  -l, --lunar                              显示简易农历
  --region <CN|US>                         节假日区域 (默认: CN)
  --locale <zh-CN|en-US>                   语言 (默认: zh-CN)
  --no-events                             不显示节假日标注

示例:
  cal-cli 2026 6
  cal-cli 2026 6 --format html
  cal-cli 2026 6 --format markdown -w -l
  cal-cli 2026 --region US --locale en-US
  cal-cli --demo
`.trim();
    console.log(help);
}
// =====================================================================
// 26. 高级特性演示
// =====================================================================
function runDemo() {
    console.log("=== 高级特性演示 ===\n");
    // (a) Iterator 协议：遍历日历单元格
    const data = buildCalendarData(2026, Month.June, DEFAULT_CONFIG);
    const cal = new MonthCalendar(2026, Month.June, data.weeks, DEFAULT_CONFIG);
    console.log("1) 迭代 2026 年 6 月的节假日 (Iterator 协议):");
    for (const cell of cal) {
        if (cell.isHoliday && cell.day !== null) {
            const evt = cell.events.find(isHolidayEvent);
            if (evt) {
                console.log(`   ${cell.dateKey} (第 ${cell.weekNumber} 周): ${eventNameOf(evt)}`);
            }
        }
    }
    // (b) 泛型 + 条件类型：JSON 返回结构化对象
    const jsonData = renderCalendar(2026, Month.June, CalendarFormat.Json, { showLunar: true });
    console.log("\n2) renderCalendar<Json> 返回结构化数据:");
    console.log(`   ${JSON.stringify({ year: jsonData.year, month: jsonData.month, monthName: jsonData.monthName })}`);
    // (c) 日期区间查询
    const range = {
        start: { year: 2026, month: Month.June, day: 1 },
        end: { year: 2026, month: Month.June, day: 30 },
    };
    const weekends = queryDateRange(range, (c) => c.isWeekend, DEFAULT_CONFIG);
    console.log(`\n3) 日期区间查询：2026 年 6 月周末共 ${weekends.length} 天`);
    // (d) Markdown 输出 (带周数)
    const md = renderCalendar(2026, Month.June, CalendarFormat.Markdown, {
        showWeekNumbers: true,
    });
    console.log("\n4) Markdown 输出预览 (前 4 行):");
    console.log(md.split("\n").slice(0, 4).join("\n"));
    // (e) 美国节假日策略
    const usData = buildCalendarData(2026, Month.November, {
        ...DEFAULT_CONFIG,
        region: "US",
        locale: "en-US",
    });
    const usCal = new MonthCalendar(2026, Month.November, usData.weeks, {
        ...DEFAULT_CONFIG,
        region: "US",
    });
    console.log("\n5) 美国节假日策略 (2026 年 11 月):");
    for (const cell of usCal.findHolidays()) {
        const evt = cell.events.find(isHolidayEvent);
        if (evt)
            console.log(`   ${cell.dateKey}: ${eventNameOf(evt)}`);
    }
    // (f) 单元格摘要 (Pick / Omit)
    const sample = cal.getDay(1);
    if (sample) {
        console.log(`\n6) 单元格摘要 (Pick): ${JSON.stringify(summarizeCell(sample))}`);
    }
    console.log("\n=== 演示结束 ===");
}
// =====================================================================
// 27. 主入口
// =====================================================================
function main() {
    try {
        const parsed = parseArgs(process.argv);
        if (parsed.showHelp) {
            printHelp();
            return;
        }
        if (parsed.showDemo) {
            runDemo();
            return;
        }
        if (parsed.month !== undefined) {
            console.log(generate(parsed.year, parsed.month, parsed.config));
        }
        else {
            console.log(generate(parsed.year, parsed.config));
        }
    }
    catch (err) {
        const msg = isCalendarError(err)
            ? `[${err.code}] ${err.message}`
            : err instanceof Error
                ? err.message
                : String(err);
        console.error(`错误: ${msg}\n`);
        printHelp();
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map