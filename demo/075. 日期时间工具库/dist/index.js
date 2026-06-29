#!/usr/bin/env node
"use strict";
/**
 * 日期时间工具库 (Date Time Utility Library) - Advanced TypeScript Edition
 * 演示高级 TS 特性: enums / discriminated unions / generics / abstract classes /
 * mapped types / custom errors / satisfies / getters / generators / symbols /
 * as const / type guards / overloads / template literal types.
 */
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DDate = exports.DateRange = exports.CustomFormatter = exports.LocaleFormatter = exports.IsoFormatter = exports.AbstractDateFormatter = exports.RangeErrorException = exports.ParseErrorException = exports.DateError = exports.ErrorCode = exports.DateFormat = exports.Month = exports.Weekday = exports.TimeUnit = void 0;
exports.isDate = isDate;
exports.isValidDate = isValidDate;
exports.isParseSuccess = isParseSuccess;
exports.isParseError = isParseError;
exports.isParseAmbiguous = isParseAmbiguous;
exports.isValidFormat = isValidFormat;
exports.now = now;
exports.isValid = isValid;
exports.format = format;
exports.parse = parse;
exports.add = add;
exports.subtract = subtract;
exports.diff = diff;
exports.startOf = startOf;
exports.endOf = endOf;
exports.isBefore = isBefore;
exports.isAfter = isAfter;
exports.isSame = isSame;
exports.isBetween = isBetween;
exports.isLeapYear = isLeapYear;
exports.daysInMonth = daysInMonth;
exports.weekday = weekday;
exports.humanize = humanize;
exports.relativeTime = relativeTime;
exports.calendar = calendar;
exports.toTimezone = toTimezone;
exports.toComponent = toComponent;
// ===================== String Enums =====================
var TimeUnit;
(function (TimeUnit) {
    TimeUnit["Millisecond"] = "ms";
    TimeUnit["Second"] = "s";
    TimeUnit["Minute"] = "m";
    TimeUnit["Hour"] = "h";
    TimeUnit["Day"] = "d";
    TimeUnit["Week"] = "w";
    TimeUnit["Month"] = "M";
    TimeUnit["Year"] = "y";
})(TimeUnit || (exports.TimeUnit = TimeUnit = {}));
var Weekday;
(function (Weekday) {
    Weekday[Weekday["Sunday"] = 0] = "Sunday";
    Weekday[Weekday["Monday"] = 1] = "Monday";
    Weekday[Weekday["Tuesday"] = 2] = "Tuesday";
    Weekday[Weekday["Wednesday"] = 3] = "Wednesday";
    Weekday[Weekday["Thursday"] = 4] = "Thursday";
    Weekday[Weekday["Friday"] = 5] = "Friday";
    Weekday[Weekday["Saturday"] = 6] = "Saturday";
})(Weekday || (exports.Weekday = Weekday = {}));
var Month;
(function (Month) {
    Month[Month["January"] = 0] = "January";
    Month[Month["February"] = 1] = "February";
    Month[Month["March"] = 2] = "March";
    Month[Month["April"] = 3] = "April";
    Month[Month["May"] = 4] = "May";
    Month[Month["June"] = 5] = "June";
    Month[Month["July"] = 6] = "July";
    Month[Month["August"] = 7] = "August";
    Month[Month["September"] = 8] = "September";
    Month[Month["October"] = 9] = "October";
    Month[Month["November"] = 10] = "November";
    Month[Month["December"] = 11] = "December";
})(Month || (exports.Month = Month = {}));
var DateFormat;
(function (DateFormat) {
    DateFormat["ISO8601"] = "YYYY-MM-DDTHH:mm:ss.SSSZ";
    DateFormat["Date"] = "YYYY-MM-DD";
    DateFormat["DateTime"] = "YYYY-MM-DD HH:mm:ss";
    DateFormat["Time"] = "HH:mm:ss";
    DateFormat["CNDate"] = "YYYY\u5E74MM\u6708DD\u65E5";
    DateFormat["US"] = "MM/DD/YYYY";
    DateFormat["Short"] = "YY-MM-DD";
})(DateFormat || (exports.DateFormat = DateFormat = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["InvalidDate"] = "INVALID_DATE";
    ErrorCode["ParseFailed"] = "PARSE_FAILED";
    ErrorCode["OutOfRange"] = "OUT_OF_RANGE";
    ErrorCode["Ambiguous"] = "AMBIGUOUS";
    ErrorCode["UnsupportedFormat"] = "UNSUPPORTED_FORMAT";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
// ===================== Custom Error Hierarchy =====================
class DateError extends Error {
    constructor(code, message, input) {
        super(message);
        this.name = 'DateError';
        this.code = code;
        this.input = input;
        Object.setPrototypeOf(this, DateError.prototype);
    }
}
exports.DateError = DateError;
class ParseErrorException extends DateError {
    constructor(message, input) {
        super(ErrorCode.ParseFailed, message, input);
        this.name = 'ParseErrorException';
        Object.setPrototypeOf(this, ParseErrorException.prototype);
    }
}
exports.ParseErrorException = ParseErrorException;
class RangeErrorException extends DateError {
    constructor(message) {
        super(ErrorCode.OutOfRange, message);
        this.name = 'RangeErrorException';
        Object.setPrototypeOf(this, RangeErrorException.prototype);
    }
}
exports.RangeErrorException = RangeErrorException;
// ===================== Symbols & Constants =====================
const RAW_DATE = Symbol('rawDate');
const FORMAT_REGISTRY = Symbol('formatRegistry');
const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const MS_PER = {
    [TimeUnit.Millisecond]: 1,
    [TimeUnit.Second]: 1000,
    [TimeUnit.Minute]: 60 * 1000,
    [TimeUnit.Hour]: 60 * 60 * 1000,
    [TimeUnit.Day]: 24 * 60 * 60 * 1000,
    [TimeUnit.Week]: 7 * 24 * 60 * 60 * 1000,
    [TimeUnit.Month]: 30 * 24 * 60 * 60 * 1000,
    [TimeUnit.Year]: 365 * 24 * 60 * 60 * 1000,
};
const DEFAULT_FORMATS = [
    DateFormat.DateTime, DateFormat.Date, 'YYYY/MM/DD HH:mm:ss',
    'YYYY/MM/DD', 'DD-MM-YYYY', DateFormat.US,
];
// ===================== Type Guards =====================
function isDate(v) { return v instanceof Date; }
function isValidDate(v) { return isDate(v) && !Number.isNaN(v.getTime()); }
function isParseSuccess(r) { return r.success === true; }
function isParseError(r) { return r.success === false; }
function isParseAmbiguous(r) {
    return r.success === true && r.ambiguous === true;
}
/** Type guard validating that a string is a usable format pattern. */
function isValidFormat(fmt) {
    return /YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a|dddd|ddd|W/.test(fmt);
}
// ===================== Helpers =====================
function toDate(v) { return v instanceof Date ? v : new Date(v); }
function p2(n) { return n < 10 ? '0' + n : String(n); }
function msPer(unit) { return MS_PER[unit] ?? 1; }
// ===================== Core Functions =====================
function now() { return new Date(); }
function isValid(d) {
    const date = d instanceof Date ? d : new Date(d);
    return !Number.isNaN(date.getTime());
}
function format(date, fmt = DateFormat.DateTime) {
    const d = date instanceof Date ? date : new Date(date);
    if (!isValid(d))
        return 'Invalid Date';
    const year = d.getFullYear(), month = d.getMonth() + 1, day = d.getDate();
    const hours = d.getHours(), mins = d.getMinutes(), secs = d.getSeconds();
    const ms = d.getMilliseconds(), wd = d.getDay();
    const ampm = hours < 12 ? 'AM' : 'PM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    const tokens = {
        YYYY: String(year), YY: String(year).slice(-2),
        MM: p2(month), M: String(month), DD: p2(day), D: String(day),
        HH: p2(hours), H: String(hours), hh: p2(h12), h: String(h12),
        mm: p2(mins), m: String(mins), ss: p2(secs), s: String(secs),
        SSS: String(ms).padStart(3, '0'),
        A: ampm, a: ampm.toLowerCase(),
        ddd: WEEKDAYS_EN[wd].slice(0, 3), dddd: WEEKDAYS_EN[wd],
        W: WEEKDAYS_CN[wd],
        MMM: MONTHS_EN[d.getMonth()].slice(0, 3), MMMM: MONTHS_EN[d.getMonth()],
    };
    return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a|dddd|ddd|W/g, (m) => tokens[m] ?? m);
}
function tryParseFormat(str, fmt) {
    const tokens = {};
    let pattern = '', i = 0;
    const known = ['YYYY', 'YY', 'MM', 'DD', 'HH', 'hh', 'mm', 'ss', 'SSS'];
    while (i < fmt.length) {
        const rest = fmt.slice(i);
        const matched = known.find((t) => rest.startsWith(t));
        if (matched) {
            pattern += '(\\d+)';
            i += matched.length;
        }
        else {
            pattern += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            i++;
        }
    }
    const m = str.match(new RegExp('^' + pattern + '$'));
    if (!m)
        return null;
    const order = fmt.match(/YYYY|YY|MM|DD|HH|hh|mm|ss|SSS/g) || [];
    order.forEach((tok, idx) => { tokens[tok] = parseInt(m[idx + 1], 10); });
    const year = tokens.YYYY ?? (tokens.YY ? 2000 + tokens.YY : 1970);
    const month = (tokens.MM ?? 1) - 1;
    const day = tokens.DD ?? 1;
    const hour = tokens.HH ?? tokens.hh ?? 0;
    const minute = tokens.mm ?? 0;
    const second = tokens.ss ?? 0;
    const ms = tokens.SSS ?? 0;
    return new Date(year, month, day, hour, minute, second, ms);
}
function parse(str, options) {
    const useDetailed = !!options && !Array.isArray(options) && typeof options === 'object';
    const formats = useDetailed
        ? options.formats
        : options;
    const candidates = [];
    if (formats && formats.length) {
        for (const fmt of formats) {
            const d = tryParseFormat(str, fmt);
            if (d && isValid(d))
                candidates.push({ date: d, format: fmt });
        }
    }
    if (candidates.length === 0) {
        const d = new Date(str);
        if (isValid(d))
            candidates.push({ date: d, format: 'native' });
    }
    if (candidates.length === 0) {
        for (const fmt of DEFAULT_FORMATS) {
            const r = tryParseFormat(str, fmt);
            if (r && isValid(r))
                candidates.push({ date: r, format: fmt });
        }
    }
    if (useDetailed) {
        if (candidates.length === 0) {
            return { success: false, error: true, code: ErrorCode.ParseFailed,
                message: `Cannot parse date string: ${str}`, input: str };
        }
        if (candidates.length > 1) {
            return { success: true, ambiguous: true, candidates };
        }
        return { success: true, date: candidates[0].date, format: candidates[0].format };
    }
    if (candidates.length === 0)
        return new Date(NaN);
    return candidates[0].date;
}
function add(date, amount, unit) {
    const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
    switch (unit) {
        case TimeUnit.Millisecond:
            d.setMilliseconds(d.getMilliseconds() + amount);
            break;
        case TimeUnit.Second:
            d.setSeconds(d.getSeconds() + amount);
            break;
        case TimeUnit.Minute:
            d.setMinutes(d.getMinutes() + amount);
            break;
        case TimeUnit.Hour:
            d.setHours(d.getHours() + amount);
            break;
        case TimeUnit.Day:
            d.setDate(d.getDate() + amount);
            break;
        case TimeUnit.Week:
            d.setDate(d.getDate() + amount * 7);
            break;
        case TimeUnit.Month:
            d.setMonth(d.getMonth() + amount);
            break;
        case TimeUnit.Year:
            d.setFullYear(d.getFullYear() + amount);
            break;
        default: break;
    }
    return d;
}
function subtract(date, amount, unit) {
    return add(date, -amount, unit);
}
function diff(d1, d2, unit = TimeUnit.Millisecond) {
    const a = d1 instanceof Date ? d1 : new Date(d1);
    const b = d2 instanceof Date ? d2 : new Date(d2);
    const delta = a.getTime() - b.getTime();
    const u = unit;
    if (u === TimeUnit.Month || u === TimeUnit.Year) {
        const months = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
        if (u === TimeUnit.Year)
            return months / 12;
        return months + (a.getDate() - b.getDate()) / 30;
    }
    return delta / msPer(unit);
}
function startOf(date, unit) {
    const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
    switch (unit) {
        case TimeUnit.Millisecond: break;
        case TimeUnit.Second:
            d.setMilliseconds(0);
            break;
        case TimeUnit.Minute:
            d.setSeconds(0, 0);
            break;
        case TimeUnit.Hour:
            d.setMinutes(0, 0, 0);
            break;
        case TimeUnit.Day:
            d.setHours(0, 0, 0, 0);
            break;
        case TimeUnit.Week: {
            d.setHours(0, 0, 0, 0);
            const day = d.getDay();
            const offset = day === 0 ? -6 : 1 - day;
            d.setDate(d.getDate() + offset);
            break;
        }
        case TimeUnit.Month:
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            break;
        case TimeUnit.Year:
            d.setMonth(0, 1);
            d.setHours(0, 0, 0, 0);
            break;
        default: break;
    }
    return d;
}
function endOf(date, unit) {
    const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
    switch (unit) {
        case TimeUnit.Millisecond: break;
        case TimeUnit.Second:
            d.setMilliseconds(999);
            break;
        case TimeUnit.Minute:
            d.setSeconds(59, 999);
            break;
        case TimeUnit.Hour:
            d.setMinutes(59, 59, 999);
            break;
        case TimeUnit.Day:
            d.setHours(23, 59, 59, 999);
            break;
        case TimeUnit.Week: {
            const start = startOf(d, TimeUnit.Week);
            d.setTime(start.getTime() + 7 * msPer(TimeUnit.Day) - 1);
            break;
        }
        case TimeUnit.Month:
            d.setMonth(d.getMonth() + 1, 0);
            d.setHours(23, 59, 59, 999);
            break;
        case TimeUnit.Year:
            d.setMonth(11, 31);
            d.setHours(23, 59, 59, 999);
            break;
        default: break;
    }
    return d;
}
function isBefore(d1, d2, unit) {
    if (!unit)
        return toDate(d1).getTime() < toDate(d2).getTime();
    return startOf(d1, unit).getTime() < startOf(d2, unit).getTime();
}
function isAfter(d1, d2, unit) {
    if (!unit)
        return toDate(d1).getTime() > toDate(d2).getTime();
    return startOf(d1, unit).getTime() > startOf(d2, unit).getTime();
}
function isSame(d1, d2, unit) {
    if (!unit)
        return toDate(d1).getTime() === toDate(d2).getTime();
    return startOf(d1, unit).getTime() === startOf(d2, unit).getTime();
}
function isBetween(d, start, end, unit) {
    return !isBefore(d, start, unit) && !isAfter(d, end, unit);
}
function isLeapYear(date) {
    const y = toDate(date).getFullYear();
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(date) {
    const d = toDate(date);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function weekday(date) {
    return toDate(date).getDay();
}
function humanize(date, base = new Date()) {
    return relativeTime(toDate(date).getTime() - base.getTime());
}
function relativeTime(ms) {
    const abs = Math.abs(ms);
    const future = ms > 0;
    const units = [
        [TimeUnit.Year, '年'], [TimeUnit.Month, '个月'], [TimeUnit.Day, '天'],
        [TimeUnit.Hour, '小时'], [TimeUnit.Minute, '分钟'], [TimeUnit.Second, '秒'],
    ];
    for (const [u, label] of units) {
        const per = msPer(u);
        if (abs >= per) {
            const n = Math.floor(abs / per);
            return future ? `${n} ${label}后` : `${n} ${label}前`;
        }
    }
    return '刚刚';
}
function calendar(date, base = new Date()) {
    const d = toDate(date);
    if (isSame(d, base, TimeUnit.Day))
        return '今天 ' + format(d, DateFormat.Time);
    if (isSame(d, subtract(base, 1, TimeUnit.Day), TimeUnit.Day))
        return '昨天 ' + format(d, DateFormat.Time);
    if (isSame(d, add(base, 1, TimeUnit.Day), TimeUnit.Day))
        return '明天 ' + format(d, DateFormat.Time);
    if (d.getTime() > startOf(base, TimeUnit.Week).getTime() && d.getTime() < endOf(base, TimeUnit.Week).getTime()) {
        return '本周' + WEEKDAYS_CN[d.getDay()] + ' ' + format(d, DateFormat.Time);
    }
    return format(d, DateFormat.Date);
}
function toTimezone(date, offsetHours) {
    const d = toDate(date);
    const utc = d.getTime() + d.getTimezoneOffset() * msPer(TimeUnit.Minute);
    return new Date(utc + offsetHours * msPer(TimeUnit.Hour));
}
/** 从 Date 提取组件 (使用 satisfies 与索引签名) */
function toComponent(date) {
    const d = toDate(date);
    return {
        year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
        hour: d.getHours(), minute: d.getMinutes(),
        second: d.getSeconds(), millisecond: d.getMilliseconds(),
    };
}
// ===================== Abstract Formatter Hierarchy =====================
class AbstractDateFormatter {
    tokens(date) {
        return {
            YYYY: String(date.getFullYear()), MM: p2(date.getMonth() + 1),
            DD: p2(date.getDate()), HH: p2(date.getHours()),
            mm: p2(date.getMinutes()), ss: p2(date.getSeconds()),
            ddd: WEEKDAYS_EN[date.getDay()].slice(0, 3),
        };
    }
}
exports.AbstractDateFormatter = AbstractDateFormatter;
class IsoFormatter extends AbstractDateFormatter {
    get name() { return 'ISO-8601'; }
    format(date) { return date.toISOString(); }
}
exports.IsoFormatter = IsoFormatter;
class LocaleFormatter extends AbstractDateFormatter {
    constructor(locale = 'zh-CN') { super(); this._locale = locale; }
    get name() { return `Locale(${this._locale})`; }
    get locale() { return this._locale; }
    set locale(v) { this._locale = v; }
    format(date) {
        try {
            return date.toLocaleString(this._locale);
        }
        catch {
            return date.toLocaleString();
        }
    }
}
exports.LocaleFormatter = LocaleFormatter;
class CustomFormatter extends AbstractDateFormatter {
    constructor(pattern = DateFormat.DateTime) { super(); this._pattern = pattern; }
    get name() { return `Custom(${this._pattern})`; }
    get pattern() { return this._pattern; }
    set pattern(v) { this._pattern = v; }
    format(date) { return format(date, this._pattern); }
}
exports.CustomFormatter = CustomFormatter;
// ===================== Generic DateRange (with generator iteration) =====================
class DateRange {
    constructor(start, end, step = 1, unit = TimeUnit.Day) {
        if (start.getTime() > end.getTime())
            throw new RangeErrorException('start must be <= end');
        if (step <= 0)
            throw new RangeErrorException('step must be > 0');
        this._start = start;
        this._end = end;
        this.step = step;
        this.unit = unit;
    }
    get start() { return this._start; }
    get end() { return this._end; }
    set end(v) {
        if (v.getTime() < this._start.getTime())
            throw new RangeErrorException('end must be >= start');
        this._end = v;
    }
    contains(date) {
        return date.getTime() >= this._start.getTime() && date.getTime() <= this._end.getTime();
    }
    /** Generator yielding each date in the range. */
    *[Symbol.iterator]() {
        let current = new Date(this._start.getTime());
        while (current.getTime() <= this._end.getTime()) {
            yield current;
            current = add(current, this.step, this.unit);
        }
    }
    toArray() { return Array.from(this); }
    forEach(cb) {
        let i = 0;
        for (const d of this)
            cb(d, i++);
    }
    count() {
        let n = 0;
        for (const _ of this) {
            n++;
            void _;
        }
        return n;
    }
}
exports.DateRange = DateRange;
// ===================== Immutable DDate wrapper =====================
class DDate {
    constructor(input = new Date()) {
        this[_a] = { default: DateFormat.DateTime, short: DateFormat.Short };
        this[RAW_DATE] = input instanceof Date ? new Date(input.getTime()) : new Date(input);
    }
    get year() { return this[RAW_DATE].getFullYear(); }
    get month() { return this[RAW_DATE].getMonth() + 1; }
    get day() { return this[RAW_DATE].getDate(); }
    get hours() { return this[RAW_DATE].getHours(); }
    get minutes() { return this[RAW_DATE].getMinutes(); }
    get seconds() { return this[RAW_DATE].getSeconds(); }
    get timestamp() { return this[RAW_DATE].getTime(); }
    format(fmt = DateFormat.DateTime) { return format(this[RAW_DATE], fmt); }
    add(amount, unit) { return new DDate(add(this[RAW_DATE], amount, unit)); }
    subtract(amount, unit) { return new DDate(subtract(this[RAW_DATE], amount, unit)); }
    diff(other, unit = TimeUnit.Millisecond) {
        const o = other instanceof DDate ? other.toDate() : other;
        return diff(this[RAW_DATE], o, unit);
    }
    startOf(unit) { return new DDate(startOf(this[RAW_DATE], unit)); }
    endOf(unit) { return new DDate(endOf(this[RAW_DATE], unit)); }
    isBefore(other, unit) {
        const o = other instanceof DDate ? other.toDate() : other;
        return isBefore(this[RAW_DATE], o, unit);
    }
    isAfter(other, unit) {
        const o = other instanceof DDate ? other.toDate() : other;
        return isAfter(this[RAW_DATE], o, unit);
    }
    isSame(other, unit) {
        const o = other instanceof DDate ? other.toDate() : other;
        return isSame(this[RAW_DATE], o, unit);
    }
    isBetween(start, end, unit) {
        const s = start instanceof DDate ? start.toDate() : start;
        const e = end instanceof DDate ? end.toDate() : end;
        return isBetween(this[RAW_DATE], s, e, unit);
    }
    humanize(base) { return humanize(this[RAW_DATE], base); }
    calendar(base) { return calendar(this[RAW_DATE], base); }
    clone() { return new DDate(this[RAW_DATE]); }
    toDate() { return new Date(this[RAW_DATE].getTime()); }
    valueOf() { return this[RAW_DATE].getTime(); }
    toString() { return this[RAW_DATE].toString(); }
}
exports.DDate = DDate;
_a = FORMAT_REGISTRY;
// ===================== CLI 演示 =====================
async function main() {
    const cmd = process.argv[2];
    switch (cmd) {
        case 'now': {
            const fmtFlag = process.argv.indexOf('-f');
            const fmt = fmtFlag >= 0 ? process.argv[fmtFlag + 1] : DateFormat.DateTime;
            console.log(format(now(), fmt));
            break;
        }
        case 'format': {
            const date = process.argv[3];
            const fmt = process.argv[4] || DateFormat.DateTime;
            if (!date) {
                console.log('用法: format <date> <format>');
                return;
            }
            console.log(format(parse(date), fmt));
            break;
        }
        case 'diff': {
            const d1 = process.argv[3], d2 = process.argv[4];
            const unitFlag = process.argv.indexOf('-u');
            const unit = (unitFlag >= 0 ? process.argv[unitFlag + 1] : 'ms');
            if (!d1 || !d2) {
                console.log('用法: diff <d1> <d2> [-u unit]');
                return;
            }
            console.log(`差值: ${diff(parse(d1), parse(d2), unit)} ${unit}`);
            break;
        }
        case 'add': {
            const date = process.argv[3];
            const amount = parseInt(process.argv[4] || '0', 10);
            const unit = (process.argv[5] || 'd');
            if (!date) {
                console.log('用法: add <date> <amount> <unit>');
                return;
            }
            console.log(format(add(parse(date), amount, unit)));
            break;
        }
        case 'ago': {
            const date = process.argv[3];
            if (!date) {
                console.log('用法: ago <date>');
                return;
            }
            console.log(humanize(parse(date)));
            console.log('日历:', calendar(parse(date)));
            break;
        }
        case 'range': {
            const s = process.argv[3], e = process.argv[4];
            if (!s || !e) {
                console.log('用法: range <start> <end>');
                return;
            }
            const range = new DateRange(parse(s), parse(e), 1, TimeUnit.Day);
            for (const d of range)
                console.log(format(d, DateFormat.Date));
            break;
        }
        case 'parse': {
            const date = process.argv[3];
            if (!date) {
                console.log('用法: parse <date>');
                return;
            }
            const result = parse(date, { formats: [DateFormat.DateTime, DateFormat.Date] });
            if (isParseError(result)) {
                console.log(`解析失败 [${result.code}]: ${result.message}`);
            }
            else if (isParseAmbiguous(result)) {
                console.log('解析结果有歧义, 候选:');
                for (const c of result.candidates)
                    console.log(`  - ${format(c.date)} (via ${c.format})`);
            }
            else {
                console.log(`解析成功: ${format(result.date)} (via ${result.format})`);
            }
            break;
        }
        default:
            console.log(`
日期时间工具库 - 命令行演示

用法:
  now [-f format]                当前时间格式化
  format <date> <format>         格式化指定日期
  diff <d1> <d2> [-u unit]       计算差值 (ms|s|m|h|d|w|M|y)
  add <date> <amount> <unit>     日期加法
  ago <date>                     人化时间
  range <start> <end>            日期范围迭代
  parse <date>                   详细解析结果 (判别联合)

示例:
  now -f "YYYY年MM月DD日 HH:mm:ss"
  format "2024-01-15 10:30:00" "YYYY/MM/DD"
  diff "2024-12-31" "2024-01-01" -u d
  add "2024-01-15" 30 d
  ago "2024-01-01"
  range "2024-01-01" "2024-01-05"
  parse "2024-01-15"
`);
    }
}
main();
//# sourceMappingURL=index.js.map