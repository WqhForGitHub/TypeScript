#!/usr/bin/env node
/**
 * 日期时间工具库 (Date Utils)
 * -------------------------------------------------------------
 * 提供日期时间的格式化、解析、加减、差值、起止时间、比较、人化时间等功能，
 * 并提供不可变日期包装类 DDate。
 *
 * 公开 API:
 *   - 函数:
 *       now(), format(date, fmt), parse(str, formats?), isValid(d)
 *       add(date, amount, unit), subtract(date, amount, unit)
 *       diff(d1, d2, unit), startOf(date, unit), endOf(date, unit)
 *       isBefore / isAfter / isSame / isBetween
 *       isLeapYear, daysInMonth, weekday
 *       humanize(date, base?), relativeTime(ms), calendar(date, base?)
 *       toTimezone(date, offsetHours)
 *   - 类 DDate (不可变):
 *       constructor(input?)
 *       format(fmt), add(...), subtract(...), diff(...), startOf(...), endOf(...)
 *       isBefore/isAfter/isSame/isBetween, humanize, calendar, clone, toDate(), valueOf
 *
 * 单位类型: 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y'
 *
 * 仅依赖 Node.js 内置模块 (本库不需要任何模块依赖).
 */

export type Unit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MS_PER: Record<Unit, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  M: 30 * 24 * 60 * 60 * 1000, // 近似
  y: 365 * 24 * 60 * 60 * 1000, // 近似
};

/** 当前时间 */
export function now(): Date {
  return new Date();
}

/** 判断是否有效日期 */
export function isValid(d: Date | string | number): boolean {
  const date = d instanceof Date ? d : new Date(d);
  return !Number.isNaN(date.getTime());
}

/** 两位补零 */
function p2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** 格式化日期
 * 支持令牌: YYYY YY MM M DD D HH H mm m ss s SSS A a ddd dddd W M名
 */
export function format(date: Date | string | number, fmt = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = date instanceof Date ? date : new Date(date);
  if (!isValid(d)) return 'Invalid Date';
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const mins = d.getMinutes();
  const secs = d.getSeconds();
  const ms = d.getMilliseconds();
  const wd = d.getDay();
  const ampm = hours < 12 ? 'AM' : 'PM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const tokens: Record<string, string> = {
    YYYY: String(year),
    YY: String(year).slice(-2),
    MM: p2(month),
    M: String(month),
    DD: p2(day),
    D: String(day),
    HH: p2(hours),
    H: String(hours),
    hh: p2(h12),
    h: String(h12),
    mm: p2(mins),
    m: String(mins),
    ss: p2(secs),
    s: String(secs),
    SSS: String(ms).padStart(3, '0'),
    A: ampm,
    a: ampm.toLowerCase(),
    ddd: WEEKDAYS_EN[wd].slice(0, 3),
    dddd: WEEKDAYS_EN[wd],
    W: ['日', '一', '二', '三', '四', '五', '六'][wd],
    MMM: MONTHS_EN[d.getMonth()].slice(0, 3),
    MMMM: MONTHS_EN[d.getMonth()],
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a|dddd|ddd|W/g, (m) => tokens[m] ?? m);
}

/** 解析字符串为日期，支持多格式尝试 */
export function parse(str: string, formats?: string[]): Date {
  if (formats && formats.length) {
    for (const fmt of formats) {
      const d = tryParseFormat(str, fmt);
      if (d && isValid(d)) return d;
    }
  }
  // 默认尝试 ISO 和常见格式
  const d = new Date(str);
  if (isValid(d)) return d;
  const common = [
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DD',
    'YYYY/MM/DD HH:mm:ss',
    'YYYY/MM/DD',
    'DD-MM-YYYY',
    'MM/DD/YYYY',
  ];
  for (const fmt of common) {
    const r = tryParseFormat(str, fmt);
    if (r && isValid(r)) return r;
  }
  return new Date(NaN);
}

function tryParseFormat(str: string, fmt: string): Date | null {
  const tokens: Record<string, number | undefined> = {};
  let pattern = '';
  let i = 0;
  while (i < fmt.length) {
    const rest = fmt.slice(i);
    const matched = [
      'YYYY', 'YY', 'MM', 'DD', 'HH', 'hh', 'mm', 'ss', 'SSS',
    ].find((t) => rest.startsWith(t));
    if (matched) {
      pattern += '(\\d+)';
      i += matched.length;
    } else {
      pattern += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  const re = new RegExp('^' + pattern + '$');
  const m = str.match(re);
  if (!m) return null;
  // 把捕获组按顺序赋值给 token
  const order = (fmt.match(/YYYY|YY|MM|DD|HH|hh|mm|ss|SSS/g) || []);
  order.forEach((tok, idx) => {
    tokens[tok] = parseInt(m[idx + 1], 10);
  });
  const year = tokens.YYYY ?? (tokens.YY ? 2000 + tokens.YY : 1970);
  const month = (tokens.MM ?? 1) - 1;
  const day = tokens.DD ?? 1;
  const hour = tokens.HH ?? tokens.hh ?? 0;
  const minute = tokens.mm ?? 0;
  const second = tokens.ss ?? 0;
  const ms = tokens.SSS ?? 0;
  return new Date(year, month, day, hour, minute, second, ms);
}

/** 加时间 */
export function add(date: Date | string | number, amount: number, unit: Unit): Date {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  switch (unit) {
    case 'ms': d.setMilliseconds(d.getMilliseconds() + amount); break;
    case 's': d.setSeconds(d.getSeconds() + amount); break;
    case 'm': d.setMinutes(d.getMinutes() + amount); break;
    case 'h': d.setHours(d.getHours() + amount); break;
    case 'd': d.setDate(d.getDate() + amount); break;
    case 'w': d.setDate(d.getDate() + amount * 7); break;
    case 'M': d.setMonth(d.getMonth() + amount); break;
    case 'y': d.setFullYear(d.getFullYear() + amount); break;
  }
  return d;
}

/** 减时间 */
export function subtract(date: Date | string | number, amount: number, unit: Unit): Date {
  return add(date, -amount, unit);
}

/** 计算差值，返回指定单位的数值（带小数） */
export function diff(d1: Date | string | number, d2: Date | string | number, unit: Unit = 'ms'): number {
  const a = d1 instanceof Date ? d1 : new Date(d1);
  const b = d2 instanceof Date ? d2 : new Date(d2);
  const delta = a.getTime() - b.getTime();
  if (unit === 'M' || unit === 'y') {
    // 月份/年份精确计算
    const months = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
    if (unit === 'y') return months / 12;
    return months + (a.getDate() - b.getDate()) / 30; // 近似
  }
  return delta / MS_PER[unit];
}

/** 起始时间 */
export function startOf(date: Date | string | number, unit: Unit): Date {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  switch (unit) {
    case 'ms': break;
    case 's': d.setMilliseconds(0); break;
    case 'm': d.setSeconds(0, 0); break;
    case 'h': d.setMinutes(0, 0, 0); break;
    case 'd': d.setHours(0, 0, 0, 0); break;
    case 'w': {
      d.setHours(0, 0, 0, 0);
      const day = d.getDay(); // 0=周日
      const offset = day === 0 ? -6 : 1 - day; // 周一为起始
      d.setDate(d.getDate() + offset);
      break;
    }
    case 'M': d.setDate(1); d.setHours(0, 0, 0, 0); break;
    case 'y': d.setMonth(0, 1); d.setHours(0, 0, 0, 0); break;
  }
  return d;
}

/** 结束时间 */
export function endOf(date: Date | string | number, unit: Unit): Date {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  switch (unit) {
    case 'ms': break;
    case 's': d.setMilliseconds(999); break;
    case 'm': d.setSeconds(59, 999); break;
    case 'h': d.setMinutes(59, 59, 999); break;
    case 'd': d.setHours(23, 59, 59, 999); break;
    case 'w': {
      const start = startOf(d, 'w');
      d.setTime(start.getTime() + 7 * MS_PER.d - 1);
      break;
    }
    case 'M': d.setMonth(d.getMonth() + 1, 0); d.setHours(23, 59, 59, 999); break;
    case 'y': d.setMonth(11, 31); d.setHours(23, 59, 59, 999); break;
  }
  return d;
}

export function isBefore(d1: Date | string | number, d2: Date | string | number, unit?: Unit): boolean {
  if (!unit) return toDate(d1).getTime() < toDate(d2).getTime();
  return startOf(d1, unit).getTime() < startOf(d2, unit).getTime();
}
export function isAfter(d1: Date | string | number, d2: Date | string | number, unit?: Unit): boolean {
  if (!unit) return toDate(d1).getTime() > toDate(d2).getTime();
  return startOf(d1, unit).getTime() > startOf(d2, unit).getTime();
}
export function isSame(d1: Date | string | number, d2: Date | string | number, unit?: Unit): boolean {
  if (!unit) return toDate(d1).getTime() === toDate(d2).getTime();
  return startOf(d1, unit).getTime() === startOf(d2, unit).getTime();
}
export function isBetween(d: Date | string | number, start: Date | string | number, end: Date | string | number, unit?: Unit): boolean {
  return !isBefore(d, start, unit) && !isAfter(d, end, unit);
}

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}

/** 是否闰年 */
export function isLeapYear(date: Date | string | number): boolean {
  const y = toDate(date).getFullYear();
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 某月天数 */
export function daysInMonth(date: Date | string | number): number {
  const d = toDate(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** 星期几 (0=周日) */
export function weekday(date: Date | string | number): number {
  return toDate(date).getDay();
}

/** 人化时间，例如 "3 小时前" / "2 天后" */
export function humanize(date: Date | string | number, base: Date = new Date()): string {
  const d = toDate(date);
  const delta = d.getTime() - base.getTime();
  const abs = Math.abs(delta);
  const future = delta > 0;
  const units: Array<[number, string]> = [
    [MS_PER.y, '年'],
    [MS_PER.M, '个月'],
    [MS_PER.d, '天'],
    [MS_PER.h, '小时'],
    [MS_PER.m, '分钟'],
    [MS_PER.s, '秒'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return future ? `${n} ${label}后` : `${n} ${label}前`;
    }
  }
  return '刚刚';
}

/** 相对时间（毫秒 → 人化） */
export function relativeTime(ms: number): string {
  const abs = Math.abs(ms);
  const future = ms > 0;
  const units: Array<[number, string]> = [
    [MS_PER.y, '年'],
    [MS_PER.M, '个月'],
    [MS_PER.d, '天'],
    [MS_PER.h, '小时'],
    [MS_PER.m, '分钟'],
    [MS_PER.s, '秒'],
  ];
  for (const [u, label] of units) {
    if (abs >= u) {
      const n = Math.floor(abs / u);
      return future ? `${n} ${label}后` : `${n} ${label}前`;
    }
  }
  return '刚刚';
}

/** 日历视图：今天/昨天/明天/上周等 */
export function calendar(date: Date | string | number, base: Date = new Date()): string {
  const d = toDate(date);
  if (isSame(d, base, 'd')) return '今天 ' + format(d, 'HH:mm');
  if (isSame(d, subtract(base, 1, 'd'), 'd')) return '昨天 ' + format(d, 'HH:mm');
  if (isSame(d, add(base, 1, 'd'), 'd')) return '明天 ' + format(d, 'HH:mm');
  if (d.getTime() > startOf(base, 'w').getTime() && d.getTime() < endOf(base, 'w').getTime()) {
    return '本周' + WEEKDAYS_CN[d.getDay()] + ' ' + format(d, 'HH:mm');
  }
  return format(d, 'YYYY-MM-DD');
}

/** 简单时区转换（基于 UTC 偏移小时数） */
export function toTimezone(date: Date | string | number, offsetHours: number): Date {
  const d = toDate(date);
  // 转换为 UTC 毫秒 + 目标偏移
  const utc = d.getTime() + d.getTimezoneOffset() * MS_PER.m;
  return new Date(utc + offsetHours * MS_PER.h);
}

// ---------- 不可变包装类 ----------
export class DDate {
  private _d: Date;
  constructor(input: Date | string | number = new Date()) {
    this._d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  }
  format(fmt = 'YYYY-MM-DD HH:mm:ss'): string {
    return format(this._d, fmt);
  }
  add(amount: number, unit: Unit): DDate {
    return new DDate(add(this._d, amount, unit));
  }
  subtract(amount: number, unit: Unit): DDate {
    return new DDate(subtract(this._d, amount, unit));
  }
  diff(other: DDate | Date, unit: Unit = 'ms'): number {
    const o = other instanceof DDate ? other.toDate() : other;
    return diff(this._d, o, unit);
  }
  startOf(unit: Unit): DDate {
    return new DDate(startOf(this._d, unit));
  }
  endOf(unit: Unit): DDate {
    return new DDate(endOf(this._d, unit));
  }
  isBefore(other: DDate | Date, unit?: Unit): boolean {
    const o = other instanceof DDate ? other.toDate() : other;
    return isBefore(this._d, o, unit);
  }
  isAfter(other: DDate | Date, unit?: Unit): boolean {
    const o = other instanceof DDate ? other.toDate() : other;
    return isAfter(this._d, o, unit);
  }
  isSame(other: DDate | Date, unit?: Unit): boolean {
    const o = other instanceof DDate ? other.toDate() : other;
    return isSame(this._d, o, unit);
  }
  isBetween(start: DDate | Date, end: DDate | Date, unit?: Unit): boolean {
    const s = start instanceof DDate ? start.toDate() : start;
    const e = end instanceof DDate ? end.toDate() : end;
    return isBetween(this._d, s, e, unit);
  }
  humanize(base?: Date): string {
    return humanize(this._d, base);
  }
  calendar(base?: Date): string {
    return calendar(this._d, base);
  }
  clone(): DDate {
    return new DDate(this._d);
  }
  toDate(): Date {
    return new Date(this._d.getTime());
  }
  valueOf(): number {
    return this._d.getTime();
  }
  toString(): string {
    return this._d.toString();
  }
}

// ===================== CLI 演示 =====================

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'now': {
      const fmtFlag = process.argv.indexOf('-f');
      const fmt = fmtFlag >= 0 ? process.argv[fmtFlag + 1] : 'YYYY-MM-DD HH:mm:ss';
      console.log(format(now(), fmt));
      break;
    }
    case 'format': {
      const date = process.argv[3];
      const fmt = process.argv[4] || 'YYYY-MM-DD HH:mm:ss';
      if (!date) {
        console.log('用法: format <date> <format>');
        return;
      }
      console.log(format(parse(date), fmt));
      break;
    }
    case 'diff': {
      const d1 = process.argv[3];
      const d2 = process.argv[4];
      const unitFlag = process.argv.indexOf('-u');
      const unit = (unitFlag >= 0 ? process.argv[unitFlag + 1] : 'ms') as Unit;
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
      const unit = (process.argv[5] || 'd') as Unit;
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
    default:
      console.log(`
日期时间工具库 - 命令行演示

用法:
  now [-f format]                当前时间格式化
  format <date> <format>         格式化指定日期
  diff <d1> <d2> [-u unit]       计算差值 (ms|s|m|h|d|w|M|y)
  add <date> <amount> <unit>     日期加法
  ago <date>                     人化时间

格式令牌: YYYY YY MM M DD D HH H hh h mm m ss s SSS A a ddd dddd W MMM MMMM

示例:
  now -f "YYYY年MM月DD日 HH:mm:ss"
  format "2024-01-15 10:30:00" "YYYY/MM/DD"
  diff "2024-12-31" "2024-01-01" -u d
  add "2024-01-15" 30 d
  ago "2024-01-01"
`);
  }
}

main();
