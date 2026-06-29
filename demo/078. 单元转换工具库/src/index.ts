#!/usr/bin/env node
/**
 * 单元转换工具库 (Unit Converter) - Enhanced TypeScript Edition
 * 支持: length, mass, temperature, area, volume, time, speed, data, pressure, energy, angle
 * API: convert(value).from(u).to(u) | convert(value, from, to) | .tryTo(u) -> ConversionResult
 * 仅依赖 Node.js 内置模块.
 * 演示特性: 字符串枚举 / 判别式联合 / 泛型类 / 抽象类 / 映射类型 / 错误层级 /
 *   接口(只读/可选/索引签名/Symbol键) / satisfies / as const / getter/setter /
 *   生成器迭代器 / 类型守卫 / 函数重载 / 模板字面量类型
 */

// ===================== 枚举 =====================

enum UnitCategory {
  Length = "length",
  Mass = "mass",
  Temperature = "temperature",
  Area = "area",
  Volume = "volume",
  Time = "time",
  Speed = "speed",
  Data = "data",
  Pressure = "pressure",
  Energy = "energy",
  Angle = "angle",
}

enum ErrorCode {
  UnknownUnit = "UNKNOWN_UNIT",
  UnknownCategory = "UNKNOWN_CATEGORY",
  CategoryMismatch = "CATEGORY_MISMATCH",
  NoFromUnit = "NO_FROM_UNIT",
  InvalidValue = "INVALID_VALUE",
  OutOfRange = "OUT_OF_RANGE",
}

enum ConversionState {
  Ok = "OK",
  Error = "ERROR",
  Same = "SAME",
}

enum TemperatureUnit {
  Celsius = "C",
  Fahrenheit = "F",
  Kelvin = "K",
}

// ===================== Symbol =====================

const REGISTRY_ID = Symbol("registryId");
const UNIT_META = Symbol("unitMeta");

// ===================== 接口 (只读 / 可选 / 索引签名 / Symbol 键) =====================

interface UnitDef {
  readonly name: string;
  readonly symbol: string;
  readonly factor?: number;
  readonly offset?: number;
  readonly toBase?: (v: number) => number;
  readonly fromBase?: (v: number) => number;
  readonly [key: string]: string | number | ((v: number) => number) | undefined;
}

interface Category {
  readonly name: string;
  readonly cn: string;
  readonly base: string;
  readonly units: Readonly<Record<string, UnitDef>>;
  readonly [REGISTRY_ID]?: number;
}

interface CategoryInfo {
  readonly key: string;
  readonly cn: string;
  readonly count: number;
}
interface UnitInfo {
  readonly symbol: string;
  readonly name: string;
}

// ===================== 映射类型 / 模板字面量类型 =====================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type UnitExpression = `${number} ${string}`;

// ===================== 判别式联合 =====================

interface ConversionSuccess {
  readonly state: ConversionState.Ok;
  readonly value: number;
  readonly from: string;
  readonly to: string;
}
interface ConversionError {
  readonly state: ConversionState.Error;
  readonly code: ErrorCode;
  readonly message: string;
}
interface ConversionSame {
  readonly state: ConversionState.Same;
  readonly value: number;
  readonly unit: string;
}
type ConversionResult = ConversionSuccess | ConversionError | ConversionSame;

// ===================== 自定义错误层级 =====================

class UnitError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "UnitError";
    this.code = code;
    Object.setPrototypeOf(this, UnitError.prototype);
  }
}

class UnknownUnitError extends UnitError {
  readonly unit: string;
  constructor(unit: string) {
    super(ErrorCode.UnknownUnit, `未知单位: ${unit}`);
    this.name = "UnknownUnitError";
    this.unit = unit;
    Object.setPrototypeOf(this, UnknownUnitError.prototype);
  }
}

class CategoryMismatchError extends UnitError {
  readonly from: string;
  readonly to: string;
  constructor(from: string, fromCn: string, to: string, toCn: string) {
    super(
      ErrorCode.CategoryMismatch,
      `单位类别不匹配: ${from} (${fromCn}) vs ${to} (${toCn})`,
    );
    this.name = "CategoryMismatchError";
    this.from = from;
    this.to = to;
    Object.setPrototypeOf(this, CategoryMismatchError.prototype);
  }
}

// ===================== as const 配置 =====================

const CONVERTER_CONFIG = {
  precision: 6,
  maxPrecision: 20,
  rounding: "half-even",
  caseSensitive: true,
} as const;

// ===================== 数据定义 (satisfies) =====================

const categories = {
  length: {
    name: UnitCategory.Length,
    cn: "长度",
    base: "m",
    units: {
      m: { name: "meter", symbol: "m", factor: 1 },
      km: { name: "kilometer", symbol: "km", factor: 1000 },
      cm: { name: "centimeter", symbol: "cm", factor: 0.01 },
      mm: { name: "millimeter", symbol: "mm", factor: 0.001 },
      mile: { name: "mile", symbol: "mile", factor: 1609.344 },
      yard: { name: "yard", symbol: "yd", factor: 0.9144 },
      foot: { name: "foot", symbol: "ft", factor: 0.3048 },
      inch: { name: "inch", symbol: "in", factor: 0.0254 },
      nmi: { name: "nautical mile", symbol: "nmi", factor: 1852 },
    },
  },
  mass: {
    name: UnitCategory.Mass,
    cn: "质量",
    base: "kg",
    units: {
      kg: { name: "kilogram", symbol: "kg", factor: 1 },
      g: { name: "gram", symbol: "g", factor: 0.001 },
      mg: { name: "milligram", symbol: "mg", factor: 1e-6 },
      t: { name: "ton", symbol: "t", factor: 1000 },
      lb: { name: "pound", symbol: "lb", factor: 0.45359237 },
      oz: { name: "ounce", symbol: "oz", factor: 0.028349523125 },
    },
  },
  temperature: {
    name: UnitCategory.Temperature,
    cn: "温度",
    base: TemperatureUnit.Celsius,
    units: {
      C: { name: "celsius", symbol: "C", toBase: (v) => v, fromBase: (v) => v },
      F: {
        name: "fahrenheit",
        symbol: "F",
        toBase: (v) => (v - 32) * (5 / 9),
        fromBase: (v) => v * (9 / 5) + 32,
      },
      K: {
        name: "kelvin",
        symbol: "K",
        toBase: (v) => v - 273.15,
        fromBase: (v) => v + 273.15,
      },
    },
  },
  area: {
    name: UnitCategory.Area,
    cn: "面积",
    base: "m2",
    units: {
      m2: { name: "square meter", symbol: "m²", factor: 1 },
      km2: { name: "square kilometer", symbol: "km²", factor: 1e6 },
      ha: { name: "hectare", symbol: "ha", factor: 1e4 },
      acre: { name: "acre", symbol: "acre", factor: 4046.8564224 },
      ft2: { name: "square foot", symbol: "ft²", factor: 0.09290304 },
      mu: { name: "mu (亩)", symbol: "mu", factor: 666.6666667 },
    },
  },
  volume: {
    name: UnitCategory.Volume,
    cn: "体积",
    base: "L",
    units: {
      L: { name: "liter", symbol: "L", factor: 1 },
      mL: { name: "milliliter", symbol: "mL", factor: 0.001 },
      m3: { name: "cubic meter", symbol: "m³", factor: 1000 },
      gal: { name: "gallon (US)", symbol: "gal", factor: 3.785411784 },
      pt: { name: "pint (US)", symbol: "pt", factor: 0.473176473 },
      cup: { name: "cup (US)", symbol: "cup", factor: 0.2365882365 },
    },
  },
  time: {
    name: UnitCategory.Time,
    cn: "时间",
    base: "s",
    units: {
      ms: { name: "millisecond", symbol: "ms", factor: 0.001 },
      s: { name: "second", symbol: "s", factor: 1 },
      min: { name: "minute", symbol: "min", factor: 60 },
      h: { name: "hour", symbol: "h", factor: 3600 },
      day: { name: "day", symbol: "d", factor: 86400 },
      week: { name: "week", symbol: "w", factor: 604800 },
      month: { name: "month (30d)", symbol: "mo", factor: 2592000 },
      year: { name: "year (365d)", symbol: "y", factor: 31536000 },
    },
  },
  speed: {
    name: UnitCategory.Speed,
    cn: "速度",
    base: "m/s",
    units: {
      "m/s": { name: "meter per second", symbol: "m/s", factor: 1 },
      "km/h": { name: "kilometer per hour", symbol: "km/h", factor: 1 / 3.6 },
      mph: { name: "mile per hour", symbol: "mph", factor: 0.44704 },
      knot: { name: "knot", symbol: "kn", factor: 0.514444444 },
    },
  },
  data: {
    name: UnitCategory.Data,
    cn: "数据",
    base: "B",
    units: {
      B: { name: "byte", symbol: "B", factor: 1 },
      KB: { name: "kilobyte (binary)", symbol: "KiB", factor: 1024 },
      MB: { name: "megabyte (binary)", symbol: "MiB", factor: 1024 ** 2 },
      GB: { name: "gigabyte (binary)", symbol: "GiB", factor: 1024 ** 3 },
      TB: { name: "terabyte (binary)", symbol: "TiB", factor: 1024 ** 4 },
      PB: { name: "petabyte (binary)", symbol: "PiB", factor: 1024 ** 5 },
    },
  },
  pressure: {
    name: UnitCategory.Pressure,
    cn: "压力",
    base: "Pa",
    units: {
      Pa: { name: "pascal", symbol: "Pa", factor: 1 },
      kPa: { name: "kilopascal", symbol: "kPa", factor: 1000 },
      MPa: { name: "megapascal", symbol: "MPa", factor: 1e6 },
      bar: { name: "bar", symbol: "bar", factor: 1e5 },
      atm: { name: "atmosphere", symbol: "atm", factor: 101325 },
      psi: { name: "pound per square inch", symbol: "psi", factor: 6894.757 },
    },
  },
  energy: {
    name: UnitCategory.Energy,
    cn: "能量",
    base: "J",
    units: {
      J: { name: "joule", symbol: "J", factor: 1 },
      kJ: { name: "kilojoule", symbol: "kJ", factor: 1000 },
      cal: { name: "calorie", symbol: "cal", factor: 4.184 },
      kcal: { name: "kilocalorie", symbol: "kcal", factor: 4184 },
      Wh: { name: "watt-hour", symbol: "Wh", factor: 3600 },
      kWh: { name: "kilowatt-hour", symbol: "kWh", factor: 3.6e6 },
      BTU: { name: "british thermal unit", symbol: "BTU", factor: 1055.05585 },
    },
  },
  angle: {
    name: UnitCategory.Angle,
    cn: "角度",
    base: "rad",
    units: {
      rad: { name: "radian", symbol: "rad", factor: 1 },
      deg: { name: "degree", symbol: "°", factor: Math.PI / 180 },
      grad: { name: "gradian", symbol: "grad", factor: Math.PI / 200 },
      turn: { name: "turn", symbol: "turn", factor: 2 * Math.PI },
      arcmin: { name: "arcminute", symbol: "'", factor: Math.PI / 180 / 60 },
      arcsec: { name: "arcsecond", symbol: '"', factor: Math.PI / 180 / 3600 },
    },
  },
} satisfies Record<UnitCategory, Category>;

/** 字符串索引视图, 便于运行时按 string / enum 查找 */
const categoryLookup: Record<string, Category> = categories;

// ===================== 抽象转换器与具体子类 =====================

abstract class AbstractConverter {
  protected readonly categoryName: string;
  protected readonly baseUnit: string;
  constructor(categoryName: string, baseUnit: string) {
    this.categoryName = categoryName;
    this.baseUnit = baseUnit;
  }
  abstract toBase(value: number, fromSymbol: string): number;
  abstract fromBase(baseValue: number, toSymbol: string): number;
  abstract get unitSymbols(): readonly string[];
  get category(): string {
    return this.categoryName;
  }
  get base(): string {
    return this.baseUnit;
  }
  convert(value: number, from: string, to: string): number {
    if (from === to) return value;
    return this.fromBase(this.toBase(value, from), to);
  }
}

class LinearConverter extends AbstractConverter {
  protected readonly units: Map<string, UnitDef>;
  constructor(category: Category) {
    super(category.name, category.base);
    this.units = new Map(Object.entries(category.units));
  }
  toBase(value: number, fromSymbol: string): number {
    const def = this.units.get(fromSymbol);
    if (!def) throw new UnknownUnitError(fromSymbol);
    return value * (def.factor ?? 1) + (def.offset ?? 0);
  }
  fromBase(baseValue: number, toSymbol: string): number {
    const def = this.units.get(toSymbol);
    if (!def) throw new UnknownUnitError(toSymbol);
    return (baseValue - (def.offset ?? 0)) / (def.factor ?? 1);
  }
  get unitSymbols(): readonly string[] {
    return [...this.units.keys()];
  }
}

class TemperatureConverter extends AbstractConverter {
  protected readonly units: Map<string, UnitDef>;
  constructor(category: Category) {
    super(category.name, category.base);
    this.units = new Map(Object.entries(category.units));
  }
  toBase(value: number, fromSymbol: string): number {
    const def = this.units.get(fromSymbol);
    if (!def) throw new UnknownUnitError(fromSymbol);
    if (def.toBase) return def.toBase(value);
    return value * (def.factor ?? 1) + (def.offset ?? 0);
  }
  fromBase(baseValue: number, toSymbol: string): number {
    const def = this.units.get(toSymbol);
    if (!def) throw new UnknownUnitError(toSymbol);
    if (def.fromBase) return def.fromBase(baseValue);
    return (baseValue - (def.offset ?? 0)) / (def.factor ?? 1);
  }
  get unitSymbols(): readonly string[] {
    return [...this.units.keys()];
  }
  /** 校验温度不低于绝对零度 */
  static assertAboveAbsoluteZero(symbol: string, value: number): void {
    if (symbol === TemperatureUnit.Kelvin && value < 0)
      throw new UnitError(
        ErrorCode.OutOfRange,
        "开尔文温度不能低于绝对零度 (0 K)",
      );
    if (symbol === TemperatureUnit.Celsius && value < -273.15)
      throw new UnitError(
        ErrorCode.OutOfRange,
        "摄氏温度不能低于绝对零度 (-273.15 C)",
      );
    if (symbol === TemperatureUnit.Fahrenheit && value < -459.67)
      throw new UnitError(
        ErrorCode.OutOfRange,
        "华氏温度不能低于绝对零度 (-459.67 F)",
      );
  }
}

class DataConverter extends AbstractConverter {
  protected readonly units: Map<string, UnitDef>;
  static readonly BASE = 1024;
  constructor(category: Category) {
    super(category.name, category.base);
    this.units = new Map(Object.entries(category.units));
  }
  toBase(value: number, fromSymbol: string): number {
    const def = this.units.get(fromSymbol);
    if (!def) throw new UnknownUnitError(fromSymbol);
    return value * (def.factor ?? 1);
  }
  fromBase(baseValue: number, toSymbol: string): number {
    const def = this.units.get(toSymbol);
    if (!def) throw new UnknownUnitError(toSymbol);
    return baseValue / (def.factor ?? 1);
  }
  get unitSymbols(): readonly string[] {
    return [...this.units.keys()];
  }
  /** 将字节数格式化为可读字符串 */
  formatBytes(bytes: number, decimals = 2): string {
    if (!Number.isFinite(bytes)) return String(bytes);
    if (bytes === 0) return "0 B";
    const k = DataConverter.BASE;
    const sizes = this.unitSymbols;
    const i = Math.min(
      Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)),
      sizes.length - 1,
    );
    const def = this.units.get(sizes[i]);
    return `${(bytes / (def?.factor ?? 1)).toFixed(decimals)} ${def?.symbol ?? "B"}`;
  }
}

// ===================== 转换器注册 (按类别) =====================

const converters = new Map<UnitCategory, AbstractConverter>();
for (const [key, cat] of Object.entries(categoryLookup)) {
  const catEnum = key as UnitCategory;
  let converter: AbstractConverter;
  if (catEnum === UnitCategory.Temperature)
    converter = new TemperatureConverter(cat);
  else if (catEnum === UnitCategory.Data) converter = new DataConverter(cat);
  else converter = new LinearConverter(cat);
  converters.set(catEnum, converter);
}

function getConverter(cat: UnitCategory): AbstractConverter {
  const c = converters.get(cat);
  if (!c) throw new UnitError(ErrorCode.UnknownCategory, `未知类别: ${cat}`);
  return c;
}

// ===================== 生成器 =====================

function* iterateUnits(cat: Category): Generator<[string, UnitDef]> {
  for (const entry of Object.entries(cat.units)) yield entry;
}
function* iterateCategories(): Generator<[string, Category]> {
  for (const entry of Object.entries(categoryLookup)) yield entry;
}

// ===================== 类型守卫 =====================

function isConversionSuccess(r: ConversionResult): r is ConversionSuccess {
  return r.state === ConversionState.Ok;
}
function isConversionError(r: ConversionResult): r is ConversionError {
  return r.state === ConversionState.Error;
}
function isConversionSame(r: ConversionResult): r is ConversionSame {
  return r.state === ConversionState.Same;
}
function isTemperatureSymbol(s: string): s is TemperatureUnit {
  return (
    s === TemperatureUnit.Celsius ||
    s === TemperatureUnit.Fahrenheit ||
    s === TemperatureUnit.Kelvin
  );
}
function isLinearUnit(def: UnitDef): def is UnitDef & { factor: number } {
  return typeof def.factor === "number";
}

// ===================== 查找与转换 =====================

function findUnit(unit: string): { cat: UnitCategory; def: UnitDef } | null {
  for (const [catKey, cat] of iterateCategories()) {
    if (Object.prototype.hasOwnProperty.call(cat.units, unit)) {
      return { cat: catKey as UnitCategory, def: cat.units[unit] };
    }
  }
  return null;
}

/** 抛出异常的转换 (使用具体错误子类) */
function convertOrThrow(value: number, from: string, to: string): number {
  if (from === to) return value;
  const fromFound = findUnit(from);
  if (!fromFound) throw new UnknownUnitError(from);
  const toFound = findUnit(to);
  if (!toFound) throw new UnknownUnitError(to);
  if (fromFound.cat !== toFound.cat) {
    throw new CategoryMismatchError(
      from,
      categoryLookup[fromFound.cat].cn,
      to,
      categoryLookup[toFound.cat].cn,
    );
  }
  return getConverter(fromFound.cat).convert(value, from, to);
}

/** 安全转换: 返回判别式联合结果, 不抛异常 */
function tryConvert(value: number, from: string, to: string): ConversionResult {
  if (from === to) return { state: ConversionState.Same, value, unit: from };
  try {
    return {
      state: ConversionState.Ok,
      value: convertOrThrow(value, from, to),
      from,
      to,
    };
  } catch (e) {
    if (e instanceof UnitError)
      return { state: ConversionState.Error, code: e.code, message: e.message };
    return {
      state: ConversionState.Error,
      code: ErrorCode.InvalidValue,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ===================== 流式 API (含 getter / setter) =====================

class ConvertBuilder {
  private _value: number;
  private _fromUnit: string | null = null;
  private _precision: number = CONVERTER_CONFIG.precision;
  constructor(value: number) {
    this._value = value;
  }
  get value(): number {
    return this._value;
  }
  set value(v: number) {
    if (Number.isNaN(v))
      throw new UnitError(ErrorCode.InvalidValue, "值不能为 NaN");
    this._value = v;
  }
  get precision(): number {
    return this._precision;
  }
  set precision(p: number) {
    if (p < 0 || p > CONVERTER_CONFIG.maxPrecision)
      throw new UnitError(
        ErrorCode.InvalidValue,
        `精度必须在 0-${CONVERTER_CONFIG.maxPrecision} 之间`,
      );
    this._precision = p;
  }
  get fromUnit(): string | null {
    return this._fromUnit;
  }
  from(unit: string): this {
    this._fromUnit = unit;
    return this;
  }
  to(unit: string): number {
    if (!this._fromUnit)
      throw new UnitError(ErrorCode.NoFromUnit, "必须先调用 from(unit)");
    return convertOrThrow(this._value, this._fromUnit, unit);
  }
  /** 安全转换, 返回判别式联合 */
  tryTo(unit: string): ConversionResult {
    if (!this._fromUnit)
      return {
        state: ConversionState.Error,
        code: ErrorCode.NoFromUnit,
        message: "必须先调用 from(unit)",
      };
    return tryConvert(this._value, this._fromUnit, unit);
  }
  /** 转换为同类别所有单位 */
  toAll(): Record<string, number> {
    if (!this._fromUnit)
      throw new UnitError(ErrorCode.NoFromUnit, "必须先调用 from(unit)");
    const from = findUnit(this._fromUnit);
    if (!from) throw new UnknownUnitError(this._fromUnit);
    const converter = getConverter(from.cat);
    const result: Record<string, number> = {};
    for (const [sym] of iterateUnits(categoryLookup[from.cat]))
      result[sym] = converter.convert(this._value, this._fromUnit, sym);
    return result;
  }
}

/** 函数重载 */
function convert(value: number): ConvertBuilder;
function convert(value: number, from: string, to: string): number;
function convert(
  value: number,
  from?: string,
  to?: string,
): ConvertBuilder | number {
  if (from !== undefined && to !== undefined)
    return convertOrThrow(value, from, to);
  return new ConvertBuilder(value);
}

// ===================== 泛型注册表 (Symbol 键 + 生成器 + Mutable) =====================

class UnitRegistry<T extends UnitDef> {
  private readonly units = new Map<string, T>();
  readonly [REGISTRY_ID]: number;
  [UNIT_META]: UnitCategory;
  private static counter = 0;
  constructor(category: UnitCategory) {
    this[REGISTRY_ID] = UnitRegistry.counter++;
    this[UNIT_META] = category;
  }
  register(symbol: string, def: T): this {
    this.units.set(symbol, def);
    return this;
  }
  get(symbol: string): T | undefined {
    return this.units.get(symbol);
  }
  has(symbol: string): boolean {
    return this.units.has(symbol);
  }
  get size(): number {
    return this.units.size;
  }
  /** 默认迭代器: 支持 for...of */
  *[Symbol.iterator](): Iterator<[string, T]> {
    for (const e of this.units) yield e;
  }
  *symbols(): Generator<string> {
    for (const k of this.units.keys()) yield k;
  }
  *definitions(): Generator<T> {
    for (const d of this.units.values()) yield d;
  }
  /** 使用 Mutable 映射类型导出可变快照 */
  snapshot(): Mutable<Readonly<Record<string, T>>> {
    const out: Record<string, T> = {};
    for (const [k, v] of this.units) out[k] = v;
    return out;
  }
}

// ===================== 查询 API =====================

function listCategories(): CategoryInfo[] {
  return [...iterateCategories()].map(([k, c]) => ({
    key: k,
    cn: c.cn,
    count: [...iterateUnits(c)].length,
  }));
}
function listUnits(catKey: string): UnitInfo[] {
  const cat = categoryLookup[catKey];
  if (!cat) return [];
  return [...iterateUnits(cat)].map(([sym, def]) => ({
    symbol: sym,
    name: def.name,
  }));
}
function categoryCn(catKey: string): string {
  return categoryLookup[catKey]?.cn ?? catKey;
}
function parseExpression(expr: string): { value: number; unit: string } | null {
  const idx = expr.indexOf(" ");
  if (idx < 0) return null;
  const value = Number(expr.slice(0, idx));
  const unit = expr.slice(idx + 1).trim();
  if (Number.isNaN(value) || !unit) return null;
  return { value, unit };
}
/** 描述一个 UnitExpression (模板字面量类型演示) */
function describeExpression(expr: UnitExpression): string {
  const p = parseExpression(expr);
  return p
    ? `表达式 "${expr}" -> 值=${p.value}, 单位=${p.unit}`
    : `无效表达式: ${expr}`;
}

// ===================== 导出公共 API =====================

export {
  UnitCategory,
  ErrorCode,
  ConversionState,
  TemperatureUnit,
  UnitError,
  UnknownUnitError,
  CategoryMismatchError,
  AbstractConverter,
  LinearConverter,
  TemperatureConverter,
  DataConverter,
  UnitRegistry,
  ConvertBuilder,
  convert,
  tryConvert,
  convertOrThrow,
  listCategories,
  listUnits,
  categoryCn,
  findUnit,
  parseExpression,
  describeExpression,
  iterateUnits,
  iterateCategories,
  isConversionSuccess,
  isConversionError,
  isConversionSame,
  isTemperatureSymbol,
  isLinearUnit,
};
export type {
  UnitDef,
  Category,
  CategoryInfo,
  UnitInfo,
  Mutable,
  UnitExpression,
  ConversionResult,
  ConversionSuccess,
  ConversionError,
  ConversionSame,
};

// ===================== CLI 演示 =====================

function round(n: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "convert": {
      const value = Number(process.argv[3]);
      const from = process.argv[4];
      const to = process.argv[5];
      if (!from || !to || Number.isNaN(value)) {
        console.log("用法: convert <value> <from> <to>");
        return;
      }
      try {
        console.log(
          `${value} ${from} = ${round(convert(value, from, to), 8)} ${to}`,
        );
      } catch (e) {
        if (e instanceof UnitError)
          console.log(`错误 [${e.code}]: ${e.message}`);
        else console.log(`错误: ${(e as Error).message}`);
        console.log(
          '提示: 使用 "categories" 查看可用类别, "units <category>" 查看单位',
        );
      }
      break;
    }
    case "table": {
      const cat = process.argv[3];
      const value = Number(process.argv[4]);
      const unit = process.argv[5];
      if (!cat || !unit || Number.isNaN(value)) {
        console.log("用法: table <category> <value> <unit>");
        return;
      }
      try {
        const catObj = categoryLookup[cat];
        if (!catObj)
          throw new UnitError(ErrorCode.UnknownCategory, `未知类别: ${cat}`);
        const result = convert(value).from(unit).toAll();
        console.log(
          `${value} ${unit} 在各类同单位下的换算 (${categoryCn(cat)}):`,
        );
        for (const [sym, v] of Object.entries(result)) {
          const def = catObj.units[sym];
          console.log(
            `  ${sym.padEnd(6)} (${def.name.padEnd(20)}) = ${round(v, 8)}`,
          );
        }
      } catch (e) {
        console.log(`错误: ${(e as Error).message}`);
      }
      break;
    }
    case "categories": {
      console.log("所有转换类别:");
      for (const c of listCategories())
        console.log(
          `  ${c.key.padEnd(14)} ${c.cn.padEnd(6)} (${c.count} 个单位)`,
        );
      break;
    }
    case "units": {
      const cat = process.argv[3];
      if (!cat) {
        console.log("用法: units <category>");
        return;
      }
      const units = listUnits(cat);
      if (units.length === 0) {
        console.log(`未知类别: ${cat}`);
        return;
      }
      console.log(`类别 ${cat} (${categoryCn(cat)}) 的单位:`);
      for (const u of units) console.log(`  ${u.symbol.padEnd(8)} ${u.name}`);
      break;
    }
    case "registry": {
      const reg = new UnitRegistry<UnitDef>(UnitCategory.Length);
      for (const [, d] of iterateUnits(categoryLookup[UnitCategory.Length]))
        reg.register(d.symbol, d);
      console.log(
        `注册表 #${String(reg[REGISTRY_ID])} (${categoryCn(reg[UNIT_META])}): ${reg.size} 单位`,
      );
      const r = tryConvert(100, "km", "mile");
      if (isConversionSuccess(r))
        console.log(
          `判别式联合: 100 km = ${round(r.value, 6)} mile (state=${r.state})`,
        );
      console.log(describeExpression("100 km"));
      const dc = getConverter(UnitCategory.Data) as DataConverter;
      console.log(
        `数据格式化: ${dc.formatBytes(1048576)} / ${dc.formatBytes(1073741824)}`,
      );
      break;
    }
    default:
      console.log(`
单元转换工具库 - 命令行演示

用法:
  convert <value> <from> <to>      单次转换
  table <category> <value> <unit>  显示同类别所有单位换算表
  categories                       列出所有类别
  units <category>                 列出某类别下所有单位
  registry                         演示注册表 / 生成器 / 判别式联合

可用类别: ${Object.keys(categoryLookup).join(", ")}

示例:
  convert 100 km mile
  convert 25 C F
  convert 1 m/s km/h
  table length 1 km
  table temperature 100 C
  categories
  units data
  registry
`);
  }
}

main();
