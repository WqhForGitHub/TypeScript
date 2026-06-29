#!/usr/bin/env node
/**
 * 日期时间工具库 (Date Time Utility Library) - Advanced TypeScript Edition
 * 演示高级 TS 特性: enums / discriminated unions / generics / abstract classes /
 * mapped types / custom errors / satisfies / getters / generators / symbols /
 * as const / type guards / overloads / template literal types.
 */

// ===================== String Enums =====================

export enum TimeUnit {
  Millisecond = "ms",
  Second = "s",
  Minute = "m",
  Hour = "h",
  Day = "d",
  Week = "w",
  Month = "M",
  Year = "y",
}

export enum Weekday {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}

export enum Month {
  January = 0,
  February = 1,
  March = 2,
  April = 3,
  May = 4,
  June = 5,
  July = 6,
  August = 7,
  September = 8,
  October = 9,
  November = 10,
  December = 11,
}

export enum DateFormat {
  ISO8601 = "YYYY-MM-DDTHH:mm:ss.SSSZ",
  Date = "YYYY-MM-DD",
  DateTime = "YYYY-MM-DD HH:mm:ss",
  Time = "HH:mm:ss",
  CNDate = "YYYY年MM月DD日",
  US = "MM/DD/YYYY",
  Short = "YY-MM-DD",
}

export enum ErrorCode {
  InvalidDate = "INVALID_DATE",
  ParseFailed = "PARSE_FAILED",
  OutOfRange = "OUT_OF_RANGE",
  Ambiguous = "AMBIGUOUS",
  UnsupportedFormat = "UNSUPPORTED_FORMAT",
}

// ===================== Mapped / Template Literal Types =====================

export type Unit = TimeUnit | `${TimeUnit}`;
/** Mapped type: strips `readonly` modifiers from all properties. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** Branded primitive using template literal type. */
type IsoTimestamp = `${number}-${number}-${number}T${string}`;
type FormatToken =
  | "YYYY"
  | "YY"
  | "MMMM"
  | "MMM"
  | "MM"
  | "M"
  | "DD"
  | "D"
  | "HH"
  | "H"
  | "hh"
  | "h"
  | "mm"
  | "m"
  | "ss"
  | "s"
  | "SSS"
  | "A"
  | "a"
  | "dddd"
  | "ddd"
  | "W";
type FormatPattern = `${string}${FormatToken}${string}`;

// ===================== Interfaces =====================

export interface DateComponent {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
  readonly millisecond?: number;
}

export interface Duration {
  readonly value: number;
  readonly unit: TimeUnit;
  [key: string]: number | string | undefined;
}

export interface ParseOptions {
  readonly formats?: readonly string[];
  readonly strict?: boolean;
  readonly timezone?: number;
}

export interface FormatterRegistry {
  readonly default: string;
  [key: string]: string;
}

// ===================== Discriminated Unions =====================

export interface ParseSuccess {
  readonly success: true;
  readonly date: Date;
  readonly format: string;
}
export interface ParseError {
  readonly success: false;
  readonly error: true;
  readonly code: ErrorCode;
  readonly message: string;
  readonly input: string;
}
export interface ParseAmbiguous {
  readonly success: true;
  readonly ambiguous: true;
  readonly candidates: ReadonlyArray<{
    readonly date: Date;
    readonly format: string;
  }>;
}
export type ParseResult = ParseSuccess | ParseError | ParseAmbiguous;

// ===================== Custom Error Hierarchy =====================

export class DateError extends Error {
  readonly code: ErrorCode;
  readonly input?: string;
  constructor(code: ErrorCode, message: string, input?: string) {
    super(message);
    this.name = "DateError";
    this.code = code;
    this.input = input;
    Object.setPrototypeOf(this, DateError.prototype);
  }
}

export class ParseErrorException extends DateError {
  constructor(message: string, input: string) {
    super(ErrorCode.ParseFailed, message, input);
    this.name = "ParseErrorException";
    Object.setPrototypeOf(this, ParseErrorException.prototype);
  }
}

export class RangeErrorException extends DateError {
  constructor(message: string) {
    super(ErrorCode.OutOfRange, message);
    this.name = "RangeErrorException";
    Object.setPrototypeOf(this, RangeErrorException.prototype);
  }
}

// ===================== Symbols & Constants =====================

const RAW_DATE: unique symbol = Symbol("rawDate");
const FORMAT_REGISTRY: unique symbol = Symbol("formatRegistry");

const WEEKDAYS_CN = ["日", "一", "二", "三", "四", "五", "六"] as const;
const WEEKDAYS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MS_PER: Record<string, number> = {
  [TimeUnit.Millisecond]: 1,
  [TimeUnit.Second]: 1000,
  [TimeUnit.Minute]: 60 * 1000,
  [TimeUnit.Hour]: 60 * 60 * 1000,
  [TimeUnit.Day]: 24 * 60 * 60 * 1000,
  [TimeUnit.Week]: 7 * 24 * 60 * 60 * 1000,
  [TimeUnit.Month]: 30 * 24 * 60 * 60 * 1000,
  [TimeUnit.Year]: 365 * 24 * 60 * 60 * 1000,
} satisfies Record<`${TimeUnit}`, number>;

const DEFAULT_FORMATS = [
  DateFormat.DateTime,
  DateFormat.Date,
  "YYYY/MM/DD HH:mm:ss",
  "YYYY/MM/DD",
  "DD-MM-YYYY",
  DateFormat.US,
] as const;

// ===================== Type Guards =====================

export function isDate(v: unknown): v is Date {
  return v instanceof Date;
}
export function isValidDate(v: unknown): v is Date {
  return isDate(v) && !Number.isNaN(v.getTime());
}
export function isParseSuccess(r: ParseResult): r is ParseSuccess {
  return r.success === true;
}
export function isParseError(r: ParseResult): r is ParseError {
  return r.success === false;
}
export function isParseAmbiguous(r: ParseResult): r is ParseAmbiguous {
  return r.success === true && (r as ParseAmbiguous).ambiguous === true;
}
/** Type guard validating that a string is a usable format pattern. */
export function isValidFormat(fmt: string): fmt is FormatPattern {
  return /YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a|dddd|ddd|W/.test(
    fmt,
  );
}

// ===================== Helpers =====================

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}
function p2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
function msPer(unit: Unit): number {
  return MS_PER[unit as string] ?? 1;
}

// ===================== Core Functions =====================

export function now(): Date {
  return new Date();
}

export function isValid(d: Date | string | number): boolean {
  const date = d instanceof Date ? d : new Date(d);
  return !Number.isNaN(date.getTime());
}

/** 格式化日期 (函数重载 + 模板字面量类型) */
export function format(
  date: Date | string | number,
  fmt?: FormatPattern,
): string;
export function format(date: Date | string | number, fmt: DateFormat): string;
export function format(date: Date | string | number, fmt?: string): string;
export function format(
  date: Date | string | number,
  fmt: string = DateFormat.DateTime,
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (!isValid(d)) return "Invalid Date";
  const year = d.getFullYear(),
    month = d.getMonth() + 1,
    day = d.getDate();
  const hours = d.getHours(),
    mins = d.getMinutes(),
    secs = d.getSeconds();
  const ms = d.getMilliseconds(),
    wd = d.getDay();
  const ampm = hours < 12 ? "AM" : "PM";
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
    SSS: String(ms).padStart(3, "0"),
    A: ampm,
    a: ampm.toLowerCase(),
    ddd: WEEKDAYS_EN[wd].slice(0, 3),
    dddd: WEEKDAYS_EN[wd],
    W: WEEKDAYS_CN[wd],
    MMM: MONTHS_EN[d.getMonth()].slice(0, 3),
    MMMM: MONTHS_EN[d.getMonth()],
  };
  return fmt.replace(
    /YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a|dddd|ddd|W/g,
    (m) => tokens[m] ?? m,
  );
}

function tryParseFormat(str: string, fmt: string): Date | null {
  const tokens: Record<string, number | undefined> = {};
  let pattern = "",
    i = 0;
  const known = ["YYYY", "YY", "MM", "DD", "HH", "hh", "mm", "ss", "SSS"];
  while (i < fmt.length) {
    const rest = fmt.slice(i);
    const matched = known.find((t) => rest.startsWith(t));
    if (matched) {
      pattern += "(\\d+)";
      i += matched.length;
    } else {
      pattern += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  const m = str.match(new RegExp("^" + pattern + "$"));
  if (!m) return null;
  const order = fmt.match(/YYYY|YY|MM|DD|HH|hh|mm|ss|SSS/g) || [];
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

/** 解析字符串为日期 (函数重载 + 判别联合返回) */
export function parse(str: string, formats?: readonly string[]): Date;
export function parse(str: string, options: ParseOptions): ParseResult;
export function parse(
  str: string,
  options?: readonly string[] | ParseOptions,
): Date | ParseResult {
  const useDetailed =
    !!options && !Array.isArray(options) && typeof options === "object";
  const formats = useDetailed
    ? (options as ParseOptions).formats
    : (options as readonly string[] | undefined);
  const candidates: Array<{ date: Date; format: string }> = [];
  if (formats && formats.length) {
    for (const fmt of formats) {
      const d = tryParseFormat(str, fmt);
      if (d && isValid(d)) candidates.push({ date: d, format: fmt });
    }
  }
  if (candidates.length === 0) {
    const d = new Date(str);
    if (isValid(d)) candidates.push({ date: d, format: "native" });
  }
  if (candidates.length === 0) {
    for (const fmt of DEFAULT_FORMATS) {
      const r = tryParseFormat(str, fmt);
      if (r && isValid(r)) candidates.push({ date: r, format: fmt });
    }
  }
  if (useDetailed) {
    if (candidates.length === 0) {
      return {
        success: false,
        error: true,
        code: ErrorCode.ParseFailed,
        message: `Cannot parse date string: ${str}`,
        input: str,
      } satisfies ParseError;
    }
    if (candidates.length > 1) {
      return {
        success: true,
        ambiguous: true,
        candidates,
      } satisfies ParseAmbiguous;
    }
    return {
      success: true,
      date: candidates[0].date,
      format: candidates[0].format,
    } satisfies ParseSuccess;
  }
  if (candidates.length === 0) return new Date(NaN);
  return candidates[0].date;
}

export function add(
  date: Date | string | number,
  amount: number,
  unit: Unit,
): Date {
  const d = new Date(
    date instanceof Date ? date.getTime() : new Date(date).getTime(),
  );
  switch (unit as string) {
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
    default:
      break;
  }
  return d;
}

export function subtract(
  date: Date | string | number,
  amount: number,
  unit: Unit,
): Date {
  return add(date, -amount, unit);
}

export function diff(
  d1: Date | string | number,
  d2: Date | string | number,
  unit: Unit = TimeUnit.Millisecond,
): number {
  const a = d1 instanceof Date ? d1 : new Date(d1);
  const b = d2 instanceof Date ? d2 : new Date(d2);
  const delta = a.getTime() - b.getTime();
  const u = unit as string;
  if (u === TimeUnit.Month || u === TimeUnit.Year) {
    const months =
      (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
    if (u === TimeUnit.Year) return months / 12;
    return months + (a.getDate() - b.getDate()) / 30;
  }
  return delta / msPer(unit);
}

export function startOf(date: Date | string | number, unit: Unit): Date {
  const d = new Date(
    date instanceof Date ? date.getTime() : new Date(date).getTime(),
  );
  switch (unit as string) {
    case TimeUnit.Millisecond:
      break;
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
    default:
      break;
  }
  return d;
}

export function endOf(date: Date | string | number, unit: Unit): Date {
  const d = new Date(
    date instanceof Date ? date.getTime() : new Date(date).getTime(),
  );
  switch (unit as string) {
    case TimeUnit.Millisecond:
      break;
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
    default:
      break;
  }
  return d;
}

export function isBefore(
  d1: Date | string | number,
  d2: Date | string | number,
  unit?: Unit,
): boolean {
  if (!unit) return toDate(d1).getTime() < toDate(d2).getTime();
  return startOf(d1, unit).getTime() < startOf(d2, unit).getTime();
}
export function isAfter(
  d1: Date | string | number,
  d2: Date | string | number,
  unit?: Unit,
): boolean {
  if (!unit) return toDate(d1).getTime() > toDate(d2).getTime();
  return startOf(d1, unit).getTime() > startOf(d2, unit).getTime();
}
export function isSame(
  d1: Date | string | number,
  d2: Date | string | number,
  unit?: Unit,
): boolean {
  if (!unit) return toDate(d1).getTime() === toDate(d2).getTime();
  return startOf(d1, unit).getTime() === startOf(d2, unit).getTime();
}
export function isBetween(
  d: Date | string | number,
  start: Date | string | number,
  end: Date | string | number,
  unit?: Unit,
): boolean {
  return !isBefore(d, start, unit) && !isAfter(d, end, unit);
}

export function isLeapYear(date: Date | string | number): boolean {
  const y = toDate(date).getFullYear();
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(date: Date | string | number): number {
  const d = toDate(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function weekday(date: Date | string | number): Weekday {
  return toDate(date).getDay() as Weekday;
}

export function humanize(
  date: Date | string | number,
  base: Date = new Date(),
): string {
  return relativeTime(toDate(date).getTime() - base.getTime());
}

export function relativeTime(ms: number): string {
  const abs = Math.abs(ms);
  const future = ms > 0;
  const units: ReadonlyArray<readonly [TimeUnit, string]> = [
    [TimeUnit.Year, "年"],
    [TimeUnit.Month, "个月"],
    [TimeUnit.Day, "天"],
    [TimeUnit.Hour, "小时"],
    [TimeUnit.Minute, "分钟"],
    [TimeUnit.Second, "秒"],
  ];
  for (const [u, label] of units) {
    const per = msPer(u);
    if (abs >= per) {
      const n = Math.floor(abs / per);
      return future ? `${n} ${label}后` : `${n} ${label}前`;
    }
  }
  return "刚刚";
}

export function calendar(
  date: Date | string | number,
  base: Date = new Date(),
): string {
  const d = toDate(date);
  if (isSame(d, base, TimeUnit.Day))
    return "今天 " + format(d, DateFormat.Time);
  if (isSame(d, subtract(base, 1, TimeUnit.Day), TimeUnit.Day))
    return "昨天 " + format(d, DateFormat.Time);
  if (isSame(d, add(base, 1, TimeUnit.Day), TimeUnit.Day))
    return "明天 " + format(d, DateFormat.Time);
  if (
    d.getTime() > startOf(base, TimeUnit.Week).getTime() &&
    d.getTime() < endOf(base, TimeUnit.Week).getTime()
  ) {
    return "本周" + WEEKDAYS_CN[d.getDay()] + " " + format(d, DateFormat.Time);
  }
  return format(d, DateFormat.Date);
}

export function toTimezone(
  date: Date | string | number,
  offsetHours: number,
): Date {
  const d = toDate(date);
  const utc = d.getTime() + d.getTimezoneOffset() * msPer(TimeUnit.Minute);
  return new Date(utc + offsetHours * msPer(TimeUnit.Hour));
}

/** 从 Date 提取组件 (使用 satisfies 与索引签名) */
export function toComponent(date: Date | string | number): DateComponent {
  const d = toDate(date);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    millisecond: d.getMilliseconds(),
  } satisfies DateComponent;
}

// ===================== Abstract Formatter Hierarchy =====================

export abstract class AbstractDateFormatter {
  abstract format(date: Date): string;
  abstract get name(): string;
  protected tokens(date: Date): Record<string, string> {
    return {
      YYYY: String(date.getFullYear()),
      MM: p2(date.getMonth() + 1),
      DD: p2(date.getDate()),
      HH: p2(date.getHours()),
      mm: p2(date.getMinutes()),
      ss: p2(date.getSeconds()),
      ddd: WEEKDAYS_EN[date.getDay()].slice(0, 3),
    };
  }
}

export class IsoFormatter extends AbstractDateFormatter {
  get name(): string {
    return "ISO-8601";
  }
  format(date: Date): string {
    return date.toISOString() as IsoTimestamp;
  }
}

export class LocaleFormatter extends AbstractDateFormatter {
  private _locale: string;
  constructor(locale: string = "zh-CN") {
    super();
    this._locale = locale;
  }
  get name(): string {
    return `Locale(${this._locale})`;
  }
  get locale(): string {
    return this._locale;
  }
  set locale(v: string) {
    this._locale = v;
  }
  format(date: Date): string {
    try {
      return date.toLocaleString(this._locale);
    } catch {
      return date.toLocaleString();
    }
  }
}

export class CustomFormatter extends AbstractDateFormatter {
  private _pattern: string;
  constructor(pattern: string = DateFormat.DateTime) {
    super();
    this._pattern = pattern;
  }
  get name(): string {
    return `Custom(${this._pattern})`;
  }
  get pattern(): string {
    return this._pattern;
  }
  set pattern(v: string) {
    this._pattern = v;
  }
  format(date: Date): string {
    return format(date, this._pattern);
  }
}

// ===================== Generic DateRange (with generator iteration) =====================

export class DateRange<T extends Date> {
  private readonly _start: T;
  private _end: T;
  readonly step: number;
  readonly unit: TimeUnit;

  constructor(
    start: T,
    end: T,
    step: number = 1,
    unit: TimeUnit = TimeUnit.Day,
  ) {
    if (start.getTime() > end.getTime())
      throw new RangeErrorException("start must be <= end");
    if (step <= 0) throw new RangeErrorException("step must be > 0");
    this._start = start;
    this._end = end;
    this.step = step;
    this.unit = unit;
  }

  get start(): T {
    return this._start;
  }
  get end(): T {
    return this._end;
  }
  set end(v: T) {
    if (v.getTime() < this._start.getTime())
      throw new RangeErrorException("end must be >= start");
    this._end = v;
  }

  contains(date: Date): boolean {
    return (
      date.getTime() >= this._start.getTime() &&
      date.getTime() <= this._end.getTime()
    );
  }

  /** Generator yielding each date in the range. */
  *[Symbol.iterator](): Generator<T, void, unknown> {
    let current = new Date(this._start.getTime()) as T;
    while (current.getTime() <= this._end.getTime()) {
      yield current;
      current = add(current, this.step, this.unit) as T;
    }
  }

  toArray(): T[] {
    return Array.from(this);
  }
  forEach(cb: (d: T, index: number) => void): void {
    let i = 0;
    for (const d of this) cb(d, i++);
  }
  count(): number {
    let n = 0;
    for (const _ of this) {
      n++;
      void _;
    }
    return n;
  }
}

// ===================== Immutable DDate wrapper =====================

export class DDate {
  [RAW_DATE]: Date;
  [FORMAT_REGISTRY]: FormatterRegistry = {
    default: DateFormat.DateTime,
    short: DateFormat.Short,
  };

  constructor(input: Date | string | number = new Date()) {
    this[RAW_DATE] =
      input instanceof Date ? new Date(input.getTime()) : new Date(input);
  }

  get year(): number {
    return this[RAW_DATE].getFullYear();
  }
  get month(): number {
    return this[RAW_DATE].getMonth() + 1;
  }
  get day(): number {
    return this[RAW_DATE].getDate();
  }
  get hours(): number {
    return this[RAW_DATE].getHours();
  }
  get minutes(): number {
    return this[RAW_DATE].getMinutes();
  }
  get seconds(): number {
    return this[RAW_DATE].getSeconds();
  }
  get timestamp(): number {
    return this[RAW_DATE].getTime();
  }

  format(fmt: string = DateFormat.DateTime): string {
    return format(this[RAW_DATE], fmt);
  }
  add(amount: number, unit: Unit): DDate {
    return new DDate(add(this[RAW_DATE], amount, unit));
  }
  subtract(amount: number, unit: Unit): DDate {
    return new DDate(subtract(this[RAW_DATE], amount, unit));
  }
  diff(other: DDate | Date, unit: Unit = TimeUnit.Millisecond): number {
    const o = other instanceof DDate ? other.toDate() : other;
    return diff(this[RAW_DATE], o, unit);
  }
  startOf(unit: Unit): DDate {
    return new DDate(startOf(this[RAW_DATE], unit));
  }
  endOf(unit: Unit): DDate {
    return new DDate(endOf(this[RAW_DATE], unit));
  }
  isBefore(other: DDate | Date, unit?: Unit): boolean {
    const o = other instanceof DDate ? other.toDate() : other;
    return isBefore(this[RAW_DATE], o, unit);
  }
  isAfter(other: DDate | Date, unit?: Unit): boolean {
    const o = other instanceof DDate ? other.toDate() : other;
    return isAfter(this[RAW_DATE], o, unit);
  }
  isSame(other: DDate | Date, unit?: Unit): boolean {
    const o = other instanceof DDate ? other.toDate() : other;
    return isSame(this[RAW_DATE], o, unit);
  }
  isBetween(start: DDate | Date, end: DDate | Date, unit?: Unit): boolean {
    const s = start instanceof DDate ? start.toDate() : start;
    const e = end instanceof DDate ? end.toDate() : end;
    return isBetween(this[RAW_DATE], s, e, unit);
  }
  humanize(base?: Date): string {
    return humanize(this[RAW_DATE], base);
  }
  calendar(base?: Date): string {
    return calendar(this[RAW_DATE], base);
  }
  clone(): DDate {
    return new DDate(this[RAW_DATE]);
  }
  toDate(): Date {
    return new Date(this[RAW_DATE].getTime());
  }
  valueOf(): number {
    return this[RAW_DATE].getTime();
  }
  toString(): string {
    return this[RAW_DATE].toString();
  }
}

// ===================== CLI 演示 =====================

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "now": {
      const fmtFlag = process.argv.indexOf("-f");
      const fmt =
        fmtFlag >= 0 ? process.argv[fmtFlag + 1] : DateFormat.DateTime;
      console.log(format(now(), fmt));
      break;
    }
    case "format": {
      const date = process.argv[3];
      const fmt = process.argv[4] || DateFormat.DateTime;
      if (!date) {
        console.log("用法: format <date> <format>");
        return;
      }
      console.log(format(parse(date), fmt));
      break;
    }
    case "diff": {
      const d1 = process.argv[3],
        d2 = process.argv[4];
      const unitFlag = process.argv.indexOf("-u");
      const unit = (unitFlag >= 0 ? process.argv[unitFlag + 1] : "ms") as Unit;
      if (!d1 || !d2) {
        console.log("用法: diff <d1> <d2> [-u unit]");
        return;
      }
      console.log(`差值: ${diff(parse(d1), parse(d2), unit)} ${unit}`);
      break;
    }
    case "add": {
      const date = process.argv[3];
      const amount = parseInt(process.argv[4] || "0", 10);
      const unit = (process.argv[5] || "d") as Unit;
      if (!date) {
        console.log("用法: add <date> <amount> <unit>");
        return;
      }
      console.log(format(add(parse(date), amount, unit)));
      break;
    }
    case "ago": {
      const date = process.argv[3];
      if (!date) {
        console.log("用法: ago <date>");
        return;
      }
      console.log(humanize(parse(date)));
      console.log("日历:", calendar(parse(date)));
      break;
    }
    case "range": {
      const s = process.argv[3],
        e = process.argv[4];
      if (!s || !e) {
        console.log("用法: range <start> <end>");
        return;
      }
      const range = new DateRange(parse(s), parse(e), 1, TimeUnit.Day);
      for (const d of range) console.log(format(d, DateFormat.Date));
      break;
    }
    case "parse": {
      const date = process.argv[3];
      if (!date) {
        console.log("用法: parse <date>");
        return;
      }
      const result = parse(date, {
        formats: [DateFormat.DateTime, DateFormat.Date],
      });
      if (isParseError(result)) {
        console.log(`解析失败 [${result.code}]: ${result.message}`);
      } else if (isParseAmbiguous(result)) {
        console.log("解析结果有歧义, 候选:");
        for (const c of result.candidates)
          console.log(`  - ${format(c.date)} (via ${c.format})`);
      } else {
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
