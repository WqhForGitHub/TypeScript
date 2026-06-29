#!/usr/bin/env node

/**
 * 温度转换器 CLI (增强版)
 * 一个使用大量 TypeScript 高级特性编写的命令行温度转换器演示。
 *
 * 支持的温度单位 (8 种):
 *   C   摄氏度    (Celsius)
 *   F   华氏度    (Fahrenheit)
 *   K   开尔文    (Kelvin)
 *   R   兰金度    (Rankine)
 *   De  德利斯尔  (Delisle)
 *   N   牛顿度    (Newton)
 *   Re  列氏度    (Reaumur)
 *   Ro  罗默度    (Romer)
 *
 * 用法:
 *   temp-cli                                  进入交互式模式
 *   temp-cli <value> <from> <to>              单次转换
 *   temp-cli --table <value> <from>           打印该温度的全部单位换算表
 *   temp-cli --compare <v1> <u1> <v2> <u2>    比较两个温度
 *   temp-cli --chain <value> <u1> <u2> ...    转换链 (依次转换)
 *   temp-cli --units                          列出所有单位
 *   temp-cli --help | -h                      显示帮助
 *
 * 本文件刻意演示以下 TypeScript 高级特性:
 *   - 字符串枚举 (String Enum)
 *   - 泛型与约束 (Generics with constraints)
 *   - 可辨识联合 (Discriminated unions)
 *   - 映射类型 (Mapped types)
 *   - 条件类型 (Conditional types)
 *   - 模板字面量类型 (Template literal types)
 *   - 类型守卫 (Type guards)
 *   - 工具类型 (Partial / Pick / Omit / Readonly / Record / ReturnType / Parameters)
 *   - 元组与只读元组 (Tuples & readonly tuples)
 *   - 抽象类 (Abstract classes)
 *   - 函数重载 (Function overloads)
 *   - as const 断言
 *   - 自定义错误类层级 (Custom Error hierarchy)
 *   - 含可选 / 只读属性的接口 (Interfaces)
 *   - 索引签名 (Index signatures)
 *   - satisfies 运算符
 *   - getter / setter 访问器
 *   - readonly 修饰符
 */

import * as readline from "readline";

// ============================================================
// 1. 字符串枚举: 温度单位
// ============================================================

enum TemperatureUnit {
  Celsius = "CELSIUS",
  Fahrenheit = "FAHRENHEIT",
  Kelvin = "KELVIN",
  Rankine = "RANKINE",
  Delisle = "DELISLE",
  Newton = "NEWTON",
  Reaumur = "REAUMUR",
  Romer = "ROMER",
}

// ============================================================
// 2. 模板字面量类型 & 条件类型 & 映射类型 & 工具类型
// ============================================================

/** 模板字面量类型: 形如 "CELSIUS-to-FAHRENHEIT" 的转换标签 */
type ConversionLabel<
  From extends string,
  To extends string,
> = `${From}-to-${To}`;

/** 模板字面量类型: 带前缀的单位键 */
type PrefixedUnit = `unit:${TemperatureUnit}`;

/** 条件类型: 根据单位推导其符号字符串字面量 */
type SymbolOf<T extends TemperatureUnit> = T extends TemperatureUnit.Celsius
  ? "°C"
  : T extends TemperatureUnit.Fahrenheit
    ? "°F"
    : T extends TemperatureUnit.Kelvin
      ? "K"
      : T extends TemperatureUnit.Rankine
        ? "°R"
        : T extends TemperatureUnit.Delisle
          ? "°De"
          : T extends TemperatureUnit.Newton
            ? "°N"
            : T extends TemperatureUnit.Reaumur
              ? "°Re"
              : T extends TemperatureUnit.Romer
                ? "°Rø"
                : never;

/** 映射类型: 完整的 [from][to] -> 转换函数 表 */
type ConversionTable = {
  [K in TemperatureUnit]: {
    [P in TemperatureUnit]: (value: number) => number;
  };
};

// ============================================================
// 3. 接口 (含可选 / 只读属性) & 索引签名
// ============================================================

/** 单位元信息 */
interface UnitInfo {
  readonly name: string;
  readonly symbol: string;
  readonly shortCode: string;
  readonly absoluteZero: number;
  readonly aliases: readonly string[];
}

/** 数字格式化选项 (含可选属性) */
interface NumberFormatOptions {
  readonly scientific?: boolean;
  readonly precision?: number;
}

/** 转换选项 (用于触发带状态的返回) */
interface ConversionOptions {
  readonly asOutcome: true;
  readonly precision?: number;
}

/** 转换链中的单步 */
interface ChainStep {
  readonly unit: TemperatureUnit;
  readonly value: number;
}

/** 一组温度读数 (值 + 单位) */
interface TemperatureReading {
  readonly value: number;
  readonly unit: TemperatureUnit;
}

/** 索引签名: 别名 -> 单位 */
interface UnitAliasMap {
  [alias: string]: TemperatureUnit;
}

// ============================================================
// 4. 可辨识联合: 转换结果 (success | error)
// ============================================================

interface SuccessResult {
  readonly status: "success";
  readonly value: number;
  readonly from: TemperatureUnit;
  readonly to: TemperatureUnit;
  readonly result: number;
  readonly timestamp: Date;
}

interface ErrorResult {
  readonly status: "error";
  readonly value: number;
  readonly from: TemperatureUnit;
  readonly to: TemperatureUnit;
  readonly error: TemperatureError;
  readonly timestamp: Date;
}

type ConversionOutcome = SuccessResult | ErrorResult;

// 更多工具类型派生 (Partial / Pick / Omit / Readonly / Record / ReturnType / Parameters)
type ResultSnapshot = Pick<SuccessResult, "value" | "from" | "to" | "result">;
type OutcomeSummary = Omit<ConversionOutcome, "timestamp">;
type FrozenOutcome = Readonly<ConversionOutcome>;
type UnitValueMap = Record<TemperatureUnit, number>;
type CompareInput = Parameters<typeof compareTemperatures>[0];
type ParsedUnit = ReturnType<typeof parseUnit>;

// ============================================================
// 5. 自定义错误类层级
// ============================================================

class TemperatureError extends Error {
  readonly code: string;
  constructor(message: string, code: string = "TEMPERATURE_ERROR") {
    super(message);
    this.name = "TemperatureError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class BelowAbsoluteZeroError extends TemperatureError {
  constructor(value: number, unit: TemperatureUnit) {
    const info = UNIT_INFO[unit];
    super(
      `温度 ${value} ${info.symbol} 低于绝对零度 ` +
        `(最低 ${info.absoluteZero} ${info.symbol})`,
      "BELOW_ABSOLUTE_ZERO",
    );
    this.name = "BelowAbsoluteZeroError";
  }
}

class UnknownUnitError extends TemperatureError {
  constructor(input: string) {
    super(`未知的温度单位: '${input}'`, "UNKNOWN_UNIT");
    this.name = "UnknownUnitError";
  }
}

class InvalidNumberError extends TemperatureError {
  constructor(input: string) {
    super(`无效的数字: '${input}'`, "INVALID_NUMBER");
    this.name = "InvalidNumberError";
  }
}

class ParseError extends TemperatureError {
  constructor(message: string) {
    super(message, "PARSE_ERROR");
    this.name = "ParseError";
  }
}

// ============================================================
// 6. 常量数据 (as const / satisfies / Record)
// ============================================================

const UNIT_INFO: Record<TemperatureUnit, UnitInfo> = {
  [TemperatureUnit.Celsius]: {
    name: "摄氏度 (Celsius)",
    symbol: "°C",
    shortCode: "C",
    absoluteZero: -273.15,
    aliases: ["C", "°C", "CELSIUS", "摄氏度", "摄氏"],
  },
  [TemperatureUnit.Fahrenheit]: {
    name: "华氏度 (Fahrenheit)",
    symbol: "°F",
    shortCode: "F",
    absoluteZero: -459.67,
    aliases: ["F", "°F", "FAHRENHEIT", "华氏度", "华氏"],
  },
  [TemperatureUnit.Kelvin]: {
    name: "开尔文 (Kelvin)",
    symbol: "K",
    shortCode: "K",
    absoluteZero: 0,
    aliases: ["K", "KEL", "KELVIN", "开尔文", "开氏度", "开氏"],
  },
  [TemperatureUnit.Rankine]: {
    name: "兰金度 (Rankine)",
    symbol: "°R",
    shortCode: "R",
    absoluteZero: 0,
    aliases: ["R", "°R", "RANK", "RANKINE", "兰金", "兰氏度"],
  },
  [TemperatureUnit.Delisle]: {
    name: "德利斯尔 (Delisle)",
    symbol: "°De",
    shortCode: "De",
    absoluteZero: 559.725,
    aliases: ["DE", "°DE", "DEL", "DELISLE", "德利斯尔", "德氏度"],
  },
  [TemperatureUnit.Newton]: {
    name: "牛顿度 (Newton)",
    symbol: "°N",
    shortCode: "N",
    absoluteZero: -90.1395,
    aliases: ["N", "°N", "NEW", "NEWTON", "牛顿度", "牛顿"],
  },
  [TemperatureUnit.Reaumur]: {
    name: "列氏度 (Reaumur)",
    symbol: "°Re",
    shortCode: "Re",
    absoluteZero: -218.52,
    aliases: ["RE", "°RE", "REA", "REAUMUR", "列氏度", "列氏"],
  },
  [TemperatureUnit.Romer]: {
    name: "罗默度 (Romer)",
    symbol: "°Rø",
    shortCode: "Ro",
    absoluteZero: -135.90375,
    aliases: ["RO", "°RØ", "ROM", "ROMER", "罗默度", "罗氏"],
  },
};

const ABSOLUTE_ZERO: UnitValueMap = (() => {
  const map = {} as UnitValueMap;
  (Object.values(TemperatureUnit) as TemperatureUnit[]).forEach((u) => {
    map[u] = UNIT_INFO[u].absoluteZero;
  });
  return map;
})();

type ColorName =
  | "reset"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray"
  | "bold";

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const satisfies Record<ColorName, string>;

/** 支持的单位 (只读元组, 用于遍历) */
const SUPPORTED_UNITS = [
  TemperatureUnit.Celsius,
  TemperatureUnit.Fahrenheit,
  TemperatureUnit.Kelvin,
  TemperatureUnit.Rankine,
  TemperatureUnit.Delisle,
  TemperatureUnit.Newton,
  TemperatureUnit.Reaumur,
  TemperatureUnit.Romer,
] as const satisfies readonly TemperatureUnit[];

/** 默认转换链: C -> F -> K -> R */
const DEFAULT_CHAIN: readonly [
  TemperatureUnit,
  TemperatureUnit,
  TemperatureUnit,
  TemperatureUnit,
] = [
  TemperatureUnit.Celsius,
  TemperatureUnit.Fahrenheit,
  TemperatureUnit.Kelvin,
  TemperatureUnit.Rankine,
];

// 别名 -> 单位 的查找表 (索引签名)
const ALIAS_MAP: UnitAliasMap = (() => {
  const map: UnitAliasMap = {};
  for (const unit of Object.values(TemperatureUnit) as TemperatureUnit[]) {
    for (const alias of UNIT_INFO[unit].aliases) {
      map[alias.toUpperCase()] = unit;
    }
  }
  return map;
})();

// ============================================================
// 7. 核心转换函数 (toKelvin / fromKelvin) + 映射类型表
// ============================================================

const toKelvinFns = {
  [TemperatureUnit.Celsius]: (v: number): number => v + 273.15,
  [TemperatureUnit.Fahrenheit]: (v: number): number =>
    (v - 32) * (5 / 9) + 273.15,
  [TemperatureUnit.Kelvin]: (v: number): number => v,
  [TemperatureUnit.Rankine]: (v: number): number => v * (5 / 9),
  [TemperatureUnit.Delisle]: (v: number): number => 373.15 - v * (2 / 3),
  [TemperatureUnit.Newton]: (v: number): number => (v * 100) / 33 + 273.15,
  [TemperatureUnit.Reaumur]: (v: number): number => (v * 5) / 4 + 273.15,
  [TemperatureUnit.Romer]: (v: number): number =>
    ((v - 7.5) * 40) / 21 + 273.15,
} satisfies Record<TemperatureUnit, (v: number) => number>;

const fromKelvinFns = {
  [TemperatureUnit.Celsius]: (k: number): number => k - 273.15,
  [TemperatureUnit.Fahrenheit]: (k: number): number =>
    (k - 273.15) * (9 / 5) + 32,
  [TemperatureUnit.Kelvin]: (k: number): number => k,
  [TemperatureUnit.Rankine]: (k: number): number => k * (9 / 5),
  [TemperatureUnit.Delisle]: (k: number): number => (373.15 - k) * (3 / 2),
  [TemperatureUnit.Newton]: (k: number): number => ((k - 273.15) * 33) / 100,
  [TemperatureUnit.Reaumur]: (k: number): number => ((k - 273.15) * 4) / 5,
  [TemperatureUnit.Romer]: (k: number): number =>
    ((k - 273.15) * 21) / 40 + 7.5,
} satisfies Record<TemperatureUnit, (v: number) => number>;

/** 完整的 [from][to] 转换表 (映射类型) */
const CONVERSION_TABLE: ConversionTable = (() => {
  const table = {} as ConversionTable;
  const units = Object.values(TemperatureUnit) as TemperatureUnit[];
  for (const from of units) {
    table[from] = {} as ConversionTable[TemperatureUnit];
    for (const to of units) {
      table[from][to] = (v: number): number =>
        fromKelvinFns[to](toKelvinFns[from](v));
    }
  }
  return table;
})();

// ============================================================
// 8. 类型守卫
// ============================================================

function isTemperatureUnit(value: unknown): value is TemperatureUnit {
  return (
    typeof value === "string" &&
    (Object.values(TemperatureUnit) as string[]).includes(value)
  );
}

function isValidTemperature(value: number, unit: TemperatureUnit): boolean {
  // 通过开尔文判断, 对倒序温标 (Delisle) 同样正确
  return Number.isFinite(value) && toKelvinFns[unit](value) >= 0;
}

// ============================================================
// 9. 抽象类 + 具体转换器 (泛型类与泛型方法)
// ============================================================

abstract class BaseConverter<T extends TemperatureUnit> {
  abstract readonly unit: T;
  abstract readonly symbol: string;
  abstract readonly absoluteZero: number;
  abstract toKelvin(value: number): number;
  abstract fromKelvin(kelvin: number): number;

  /** 泛型方法: 将本单位的值转换为目标单位 */
  convertTo<U extends TemperatureUnit>(
    value: number,
    target: BaseConverter<U>,
  ): number {
    return target.fromKelvin(this.toKelvin(value));
  }
}

class CelsiusConverter extends BaseConverter<TemperatureUnit.Celsius> {
  readonly unit = TemperatureUnit.Celsius;
  readonly symbol = "°C";
  readonly absoluteZero = -273.15;
  toKelvin(value: number): number {
    return value + 273.15;
  }
  fromKelvin(kelvin: number): number {
    return kelvin - 273.15;
  }
}

class FahrenheitConverter extends BaseConverter<TemperatureUnit.Fahrenheit> {
  readonly unit = TemperatureUnit.Fahrenheit;
  readonly symbol = "°F";
  readonly absoluteZero = -459.67;
  toKelvin(value: number): number {
    return ((value - 32) * 5) / 9 + 273.15;
  }
  fromKelvin(kelvin: number): number {
    return ((kelvin - 273.15) * 9) / 5 + 32;
  }
}

class KelvinConverter extends BaseConverter<TemperatureUnit.Kelvin> {
  readonly unit = TemperatureUnit.Kelvin;
  readonly symbol = "K";
  readonly absoluteZero = 0;
  toKelvin(value: number): number {
    return value;
  }
  fromKelvin(kelvin: number): number {
    return kelvin;
  }
}

class RankineConverter extends BaseConverter<TemperatureUnit.Rankine> {
  readonly unit = TemperatureUnit.Rankine;
  readonly symbol = "°R";
  readonly absoluteZero = 0;
  toKelvin(value: number): number {
    return (value * 5) / 9;
  }
  fromKelvin(kelvin: number): number {
    return (kelvin * 9) / 5;
  }
}

class DelisleConverter extends BaseConverter<TemperatureUnit.Delisle> {
  readonly unit = TemperatureUnit.Delisle;
  readonly symbol = "°De";
  readonly absoluteZero = 559.725;
  toKelvin(value: number): number {
    return 373.15 - (value * 2) / 3;
  }
  fromKelvin(kelvin: number): number {
    return (373.15 - kelvin) * (3 / 2);
  }
}

class NewtonConverter extends BaseConverter<TemperatureUnit.Newton> {
  readonly unit = TemperatureUnit.Newton;
  readonly symbol = "°N";
  readonly absoluteZero = -90.1395;
  toKelvin(value: number): number {
    return (value * 100) / 33 + 273.15;
  }
  fromKelvin(kelvin: number): number {
    return ((kelvin - 273.15) * 33) / 100;
  }
}

class ReaumurConverter extends BaseConverter<TemperatureUnit.Reaumur> {
  readonly unit = TemperatureUnit.Reaumur;
  readonly symbol = "°Re";
  readonly absoluteZero = -218.52;
  toKelvin(value: number): number {
    return (value * 5) / 4 + 273.15;
  }
  fromKelvin(kelvin: number): number {
    return ((kelvin - 273.15) * 4) / 5;
  }
}

class RomerConverter extends BaseConverter<TemperatureUnit.Romer> {
  readonly unit = TemperatureUnit.Romer;
  readonly symbol = "°Rø";
  readonly absoluteZero = -135.90375;
  toKelvin(value: number): number {
    return ((value - 7.5) * 40) / 21 + 273.15;
  }
  fromKelvin(kelvin: number): number {
    return ((kelvin - 273.15) * 21) / 40 + 7.5;
  }
}

/** 单位 -> 转换器实例 的注册表 */
const CONVERTERS: Record<TemperatureUnit, BaseConverter<TemperatureUnit>> = {
  [TemperatureUnit.Celsius]: new CelsiusConverter(),
  [TemperatureUnit.Fahrenheit]: new FahrenheitConverter(),
  [TemperatureUnit.Kelvin]: new KelvinConverter(),
  [TemperatureUnit.Rankine]: new RankineConverter(),
  [TemperatureUnit.Delisle]: new DelisleConverter(),
  [TemperatureUnit.Newton]: new NewtonConverter(),
  [TemperatureUnit.Reaumur]: new ReaumurConverter(),
  [TemperatureUnit.Romer]: new RomerConverter(),
};

// ============================================================
// 10. 全局配置 (getter / setter)
// ============================================================

class ConverterConfig {
  private _colorize = true;
  private _precision = 4;
  private _scientific = false;
  private _warnAbsoluteZero = true;

  get colorize(): boolean {
    return this._colorize;
  }
  set colorize(v: boolean) {
    this._colorize = v;
  }
  get precision(): number {
    return this._precision;
  }
  set precision(v: number) {
    if (!Number.isInteger(v) || v < 0 || v > 20) {
      throw new RangeError("precision 必须是 0..20 的整数");
    }
    this._precision = v;
  }
  get scientific(): boolean {
    return this._scientific;
  }
  set scientific(v: boolean) {
    this._scientific = v;
  }
  get warnAbsoluteZero(): boolean {
    return this._warnAbsoluteZero;
  }
  set warnAbsoluteZero(v: boolean) {
    this._warnAbsoluteZero = v;
  }
}

const config = new ConverterConfig();

// ============================================================
// 11. 历史记录 (getter / setter + readonly)
// ============================================================

class ConversionHistory {
  private readonly _entries: ConversionOutcome[] = [];
  private _maxSize: number;

  constructor(maxSize: number = 100) {
    this._maxSize = maxSize;
  }

  get size(): number {
    return this._entries.length;
  }
  get maxSize(): number {
    return this._maxSize;
  }
  set maxSize(value: number) {
    if (value < 1) throw new RangeError("maxSize 必须 >= 1");
    this._maxSize = value;
    this.trim();
  }
  get entries(): readonly ConversionOutcome[] {
    return this._entries;
  }

  add(entry: ConversionOutcome): void {
    this._entries.push(entry);
    this.trim();
  }

  clear(): void {
    this._entries.length = 0;
  }

  snapshots(): readonly ResultSnapshot[] {
    return this._entries
      .filter((e): e is SuccessResult => e.status === "success")
      .map((e) => ({
        value: e.value,
        from: e.from,
        to: e.to,
        result: e.result,
      }));
  }

  private trim(): void {
    while (this._entries.length > this._maxSize) {
      this._entries.shift();
    }
  }
}

const history = new ConversionHistory();

// ============================================================
// 12. 校验 & 格式化
// ============================================================

function validateTemperature(value: number, unit: TemperatureUnit): void {
  if (!Number.isFinite(value)) {
    throw new InvalidNumberError(String(value));
  }
  // 统一换算到开尔文后判断: K < 0 即低于绝对零度。
  // 注意 Delisle 等倒序温标的绝对零度是该单位的"最大值",
  // 因此不能用 value < ABSOLUTE_ZERO[unit] 这种简单比较。
  const kelvin = toKelvinFns[unit](value);
  if (kelvin < 0) {
    throw new BelowAbsoluteZeroError(value, unit);
  }
}

function mergeOptions(
  base: NumberFormatOptions,
  overrides: Partial<NumberFormatOptions>,
): NumberFormatOptions {
  return { ...base, ...overrides };
}

function formatNumber(value: number, options?: NumberFormatOptions): string {
  if (!Number.isFinite(value)) return value.toString();
  const precision = options?.precision ?? 4;
  const autoScientific =
    Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 1e-4);
  const useScientific = options?.scientific ?? autoScientific;
  if (useScientific) {
    return value.toExponential(precision);
  }
  const fixed = value.toFixed(precision);
  return parseFloat(fixed).toString();
}

function formatTemp(value: number): string {
  return formatNumber(value, {
    precision: config.precision,
    scientific: config.scientific,
  });
}

function colorize(text: string, color: ColorName): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function paint(text: string, color: ColorName): string {
  return config.colorize ? colorize(text, color) : text;
}

function conversionLabel<
  From extends TemperatureUnit,
  To extends TemperatureUnit,
>(from: From, to: To): ConversionLabel<From, To> {
  return `${from}-to-${to}`;
}

function formatResult(r: SuccessResult): string {
  const fromSym = UNIT_INFO[r.from].symbol;
  const toSym = UNIT_INFO[r.to].symbol;
  return (
    paint(`${formatTemp(r.value)} ${fromSym}`, "cyan") +
    paint("  =  ", "gray") +
    paint(`${formatTemp(r.result)} ${toSym}`, "green")
  );
}

function absoluteZeroWarning(
  value: number,
  unit: TemperatureUnit,
): string | null {
  const kelvin = toKelvinFns[unit](value);
  if (kelvin < 10) {
    const info = UNIT_INFO[unit];
    return paint(
      `警告: 温度接近绝对零度 (距绝对零度 ${formatTemp(kelvin)} K / ` +
        `该单位绝对零度 ${formatTemp(ABSOLUTE_ZERO[unit])} ${info.symbol})`,
      "yellow",
    );
  }
  return null;
}

// ============================================================
// 13. 转换核心: 函数重载 + 泛型
// ============================================================

function convert<T extends TemperatureUnit, U extends TemperatureUnit>(
  value: number,
  from: T,
  to: U,
): number;
function convert(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit,
  options: ConversionOptions,
): ConversionOutcome;
function convert(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit,
  options?: ConversionOptions,
): number | ConversionOutcome {
  if (options && options.asOutcome === true) {
    try {
      validateTemperature(value, from);
      const result = CONVERSION_TABLE[from][to](value);
      const success: SuccessResult = {
        status: "success",
        value,
        from,
        to,
        result,
        timestamp: new Date(),
      };
      return success;
    } catch (err) {
      const error =
        err instanceof TemperatureError
          ? err
          : new TemperatureError(
              err instanceof Error ? err.message : String(err),
            );
      const failure: ErrorResult = {
        status: "error",
        value,
        from,
        to,
        error,
        timestamp: new Date(),
      };
      return failure;
    }
  }
  validateTemperature(value, from);
  return CONVERSION_TABLE[from][to](value);
}

/** 批量转换: 一个值 -> 全部单位 */
function convertToAll(value: number, from: TemperatureUnit): UnitValueMap {
  validateTemperature(value, from);
  const results = {} as UnitValueMap;
  for (const unit of SUPPORTED_UNITS) {
    results[unit] = convert(value, from, unit);
  }
  return results;
}

/** 温度比较: 返回 -1 / 0 / 1 */
function compareTemperatures(
  a: TemperatureReading,
  b: TemperatureReading,
): -1 | 0 | 1 {
  const ka = toKelvinFns[a.unit](a.value);
  const kb = toKelvinFns[b.unit](b.value);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return 0;
}

/** 转换链: 依次经过一系列单位 (使用抽象类的转换器) */
function conversionChain(
  value: number,
  chain: readonly TemperatureUnit[],
): readonly ChainStep[] {
  if (chain.length === 0) {
    throw new ParseError("转换链至少需要一个单位");
  }
  validateTemperature(value, chain[0]);
  const steps: ChainStep[] = [{ unit: chain[0], value }];
  let current = value;
  for (let i = 1; i < chain.length; i++) {
    const fromConverter = CONVERTERS[chain[i - 1]];
    const toConverter = CONVERTERS[chain[i]];
    current = fromConverter.convertTo(current, toConverter);
    steps.push({ unit: chain[i], value: current });
  }
  return steps;
}

/** 生成转换表文本 (用于 --table) */
function generateTable(
  value: number,
  from: TemperatureUnit,
): readonly string[] {
  const all = convertToAll(value, from);
  const lines: string[] = [];
  lines.push(
    paint(`输入: ${formatTemp(value)} ${UNIT_INFO[from].symbol}`, "bold"),
  );
  lines.push(paint("-".repeat(54), "gray"));
  for (const unit of SUPPORTED_UNITS) {
    const tag = unit === from ? paint(" (原值)", "magenta") : "";
    const name = UNIT_INFO[unit].name.padEnd(22);
    const val = formatTemp(all[unit]).padStart(14);
    lines.push(`  ${name} : ${val} ${UNIT_INFO[unit].symbol}${tag}`);
  }
  return lines;
}

// ============================================================
// 14. 输入解析
// ============================================================

function parseUnit(input: string): TemperatureUnit {
  const key = input.trim().toUpperCase();
  if (isTemperatureUnit(key)) {
    return key;
  }
  const unit = ALIAS_MAP[key];
  if (unit === undefined) {
    throw new UnknownUnitError(input);
  }
  return unit;
}

function safeParseUnit(input: string): ParsedUnit | null {
  try {
    return parseUnit(input);
  } catch {
    return null;
  }
}

function parseNumber(input: string): number {
  const n = Number(input.trim());
  if (!Number.isFinite(n)) {
    throw new InvalidNumberError(input);
  }
  return n;
}

/** 解析交互模式下的转换表达式: <数值> <源单位> <目标单位> */
function parseConversionLine(line: string): {
  value: number;
  from: TemperatureUnit;
  to: TemperatureUnit;
} {
  const normalized = line
    .replace(/->|=>|→/g, " ")
    .replace(/\bto\b/gi, " ")
    .replace(/\b转\b|\b转为\b|\b转换为\b|\b转成\b/g, " ")
    .replace(/(-?\d+(?:\.\d+)?)/g, " $1 ")
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);

  if (normalized.length !== 3) {
    throw new ParseError(
      "无法解析输入。期望格式: <数值> <源单位> <目标单位>，例如: 100 C F",
    );
  }
  const [valStr, fromStr, toStr] = normalized as [string, string, string];
  return {
    value: parseNumber(valStr),
    from: parseUnit(fromStr),
    to: parseUnit(toStr),
  };
}

// ============================================================
// 15. 命令行帮助 & 横幅
// ============================================================

function printBanner(): void {
  console.log(paint("==========================================", "cyan"));
  console.log(paint("   TypeScript 温度转换器 (temp-cli)", "bold"));
  console.log(paint("==========================================", "cyan"));
  console.log("支持 8 种温标: C / F / K / R / De / N / Re / Ro");
  console.log("示例: 100 C F   或   32F to C   或   300 K C");
  console.log("输入 'help' 查看帮助，输入 'exit' 退出。");
  console.log("");
}

function printHelp(): void {
  console.log(`
Usage:
  temp-cli                                  进入交互式模式
  temp-cli <value> <from> <to>              单次转换
  temp-cli --table <value> <from>           打印该温度的全部单位换算表
  temp-cli --compare <v1> <u1> <v2> <u2>    比较两个温度
  temp-cli --chain <value> <u1> <u2> ...    转换链 (依次转换)
  temp-cli --units                          列出所有单位
  temp-cli --help | -h                      显示帮助

Units (8 种温标):
  C   摄氏度   (Celsius)
  F   华氏度   (Fahrenheit)
  K   开尔文   (Kelvin)
  R   兰金度   (Rankine)
  De  德利斯尔 (Delisle)
  N   牛顿度   (Newton)
  Re  列氏度   (Reaumur)
  Ro  罗默度   (Romer)

Interactive commands:
  help | ?              显示帮助
  units                 列出所有单位
  table <value> <from>  打印换算表
  compare <v1> <u1> <v2> <u2>   比较两个温度
  chain <value> <u1> <u2> ...   转换链
  history               查看历史记录
  clear                 清空历史
  config <key> <value>  修改配置 (colorize|precision|scientific|warnAbsoluteZero)
  exit | quit           退出

Examples:
  temp-cli 100 C F              # 100 摄氏度 -> 华氏度
  temp-cli --table 25 C         # 25°C 对应全部 8 种温标
  temp-cli --compare 100 C 212 F
  temp-cli --chain 100 C F K R  # 100°C 依次转 F -> K -> R
`);
}

function printUnits(): void {
  console.log("支持的温度单位:");
  for (const unit of SUPPORTED_UNITS) {
    const info = UNIT_INFO[unit];
    console.log(
      `  ${info.shortCode.padEnd(3)} ${info.symbol.padEnd(5)} ${info.name}  ` +
        `(绝对零度: ${info.absoluteZero})`,
    );
  }
}

function printTable(value: number, from: TemperatureUnit): void {
  for (const line of generateTable(value, from)) {
    console.log(line);
  }
  const warn = config.warnAbsoluteZero
    ? absoluteZeroWarning(value, from)
    : null;
  if (warn) console.log(warn);
}

function printCompare(a: TemperatureReading, b: TemperatureReading): void {
  const cmp = compareTemperatures(a, b);
  const aStr = `${formatTemp(a.value)} ${UNIT_INFO[a.unit].symbol}`;
  const bStr = `${formatTemp(b.value)} ${UNIT_INFO[b.unit].symbol}`;
  if (cmp === 0) {
    console.log(paint(`${aStr}  ==  ${bStr}  (两者相等)`, "yellow"));
  } else if (cmp < 0) {
    console.log(paint(`${aStr}  <  ${bStr}  (后者更热)`, "green"));
  } else {
    console.log(paint(`${aStr}  >  ${bStr}  (前者更热)`, "red"));
  }
}

function printChain(value: number, chain: readonly TemperatureUnit[]): void {
  const steps = conversionChain(value, chain);
  console.log(paint("转换链:", "bold"));
  steps.forEach((step, i) => {
    const info = UNIT_INFO[step.unit];
    const arrow = i === 0 ? "  " : paint(" -> ", "magenta");
    const label = paint(
      conversionLabel(i === 0 ? step.unit : steps[i - 1].unit, step.unit),
      "gray",
    );
    console.log(
      `  [${i}] ${arrow}${formatTemp(step.value)} ${info.symbol}   ${label}`,
    );
  });
}

function printHistory(): void {
  const entries = history.entries;
  if (entries.length === 0) {
    console.log(paint("(无历史记录)", "gray"));
    return;
  }
  console.log(paint(`历史记录 (最近 ${entries.length} 条):`, "bold"));
  entries.forEach((e, i) => {
    const idx = paint(`[${(i + 1).toString().padStart(3)}]`, "gray");
    const ts = paint(e.timestamp.toISOString(), "gray");
    if (e.status === "success") {
      console.log(`  ${idx} ${ts}  ${formatResult(e)}`);
    } else {
      console.log(
        `  ${idx} ${ts}  ${paint("错误: " + e.error.message, "red")}`,
      );
    }
  });
}

// ============================================================
// 16. 交互模式
// ============================================================

function handleConfigCommand(args: readonly string[]): void {
  if (args.length !== 2) {
    console.log("用法: config <key> <value>");
    console.log("  key: colorize | precision | scientific | warnAbsoluteZero");
    return;
  }
  const [key, val] = args as [string, string];
  switch (key) {
    case "colorize":
      config.colorize = val === "true" || val === "1";
      break;
    case "precision":
      config.precision = Number(val);
      break;
    case "scientific":
      config.scientific = val === "true" || val === "1";
      break;
    case "warnAbsoluteZero":
      config.warnAbsoluteZero = val === "true" || val === "1";
      break;
    default:
      console.error(paint(`未知配置项: '${key}'`, "red"));
      return;
  }
  console.log(
    `已设置 ${key} = ${config[key as keyof ConverterConfig] as unknown as string}`,
  );
}

function handleInteractiveLine(line: string): void {
  const parts = line
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
  if (parts.length === 0) return;

  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1);

  try {
    switch (cmd) {
      case "exit":
      case "quit":
        console.log("再见！");
        process.exit(0);
        break;
      case "help":
      case "?":
        printHelp();
        break;
      case "units":
        printUnits();
        break;
      case "table":
      case "all": {
        if (rest.length !== 2) {
          throw new ParseError("用法: table <value> <from>");
        }
        printTable(parseNumber(rest[0]), parseUnit(rest[1]));
        break;
      }
      case "compare": {
        if (rest.length !== 4) {
          throw new ParseError("用法: compare <v1> <u1> <v2> <u2>");
        }
        printCompare(
          { value: parseNumber(rest[0]), unit: parseUnit(rest[1]) },
          { value: parseNumber(rest[2]), unit: parseUnit(rest[3]) },
        );
        break;
      }
      case "chain": {
        if (rest.length < 3) {
          throw new ParseError("用法: chain <value> <u1> <u2> [...]");
        }
        const value = parseNumber(rest[0]);
        const chain = rest.slice(1).map((s) => parseUnit(s));
        printChain(value, chain);
        break;
      }
      case "history":
        printHistory();
        break;
      case "clear":
        history.clear();
        console.log(paint("已清空历史记录。", "gray"));
        break;
      case "config":
        handleConfigCommand(rest);
        break;
      default: {
        // 当作转换表达式解析
        const { value, from, to } = parseConversionLine(line);
        const outcome = convert(value, from, to, { asOutcome: true });
        history.add(outcome);
        if (outcome.status === "success") {
          console.log(`= ${formatResult(outcome)}`);
          if (config.warnAbsoluteZero) {
            const warn = absoluteZeroWarning(value, from);
            if (warn) console.log(warn);
          }
        } else {
          console.error(paint(`错误: ${outcome.error.message}`, "red"));
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(paint(`错误: ${msg}`, "red"));
  }
}

function runInteractive(): void {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "temp> ",
  });

  rl.prompt();

  rl.on("line", (line: string) => {
    handleInteractiveLine(line);
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

// ============================================================
// 17. 入口
// ============================================================

function handleCliArgError(msg: string): never {
  console.error(paint(`错误: ${msg}`, "red"));
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    runInteractive();
    return;
  }

  const first = args[0];

  if (first === "--help" || first === "-h") {
    printHelp();
    return;
  }

  if (first === "--units") {
    printUnits();
    return;
  }

  try {
    if (first === "--table") {
      if (args.length !== 3) {
        throw new ParseError("--table 用法: temp-cli --table <value> <from>");
      }
      printTable(parseNumber(args[1]), parseUnit(args[2]));
      return;
    }

    if (first === "--compare") {
      if (args.length !== 5) {
        throw new ParseError(
          "--compare 用法: temp-cli --compare <v1> <u1> <v2> <u2>",
        );
      }
      printCompare(
        { value: parseNumber(args[1]), unit: parseUnit(args[2]) },
        { value: parseNumber(args[3]), unit: parseUnit(args[4]) },
      );
      return;
    }

    if (first === "--chain") {
      if (args.length < 4) {
        throw new ParseError(
          "--chain 用法: temp-cli --chain <value> <u1> <u2> [...]",
        );
      }
      const value = parseNumber(args[1]);
      const chain = args.slice(2).map((s) => parseUnit(s));
      printChain(value, chain);
      return;
    }

    if (args.length !== 3) {
      throw new ParseError(
        "参数数量错误。用法: temp-cli <value> <from> <to>，例如: temp-cli 100 C F",
      );
    }

    const value = parseNumber(args[0]);
    const from = parseUnit(args[1]);
    const to = parseUnit(args[2]);
    const outcome = convert(value, from, to, { asOutcome: true });
    history.add(outcome);
    if (outcome.status === "success") {
      console.log(formatResult(outcome));
      if (config.warnAbsoluteZero) {
        const warn = absoluteZeroWarning(value, from);
        if (warn) console.log(warn);
      }
    } else {
      handleCliArgError(outcome.error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    handleCliArgError(msg);
  }
}

main();
