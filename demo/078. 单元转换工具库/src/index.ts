#!/usr/bin/env node
/**
 * 单元转换工具库 (Unit Converter)
 * -------------------------------------------------------------
 * 支持多类别单位转换。API：
 *   - convert(value).from(unit).to(unit)
 *   - convert(value, from, to)
 *
 * 支持类别: length, mass, temperature, area, volume, time, speed,
 *           data, pressure, energy, angle
 *
 * 仅依赖 Node.js 内置模块 (本库不需要任何模块依赖).
 */

/** 单位定义 */
interface UnitDef {
  name: string; // 显示名
  symbol: string; // 符号
  /** 相对基准单位的倍数（线性类别） */
  factor?: number;
  /** 偏移（线性类别，相对基准），例如华氏度 */
  offset?: number;
  /** 非线性转换函数（如温度），toBase/toFrom */
  toBase?: (v: number) => number;
  fromBase?: (v: number) => number;
}

interface Category {
  name: string;
  cn: string;
  base: string; // 基准单位 symbol
  units: Record<string, UnitDef>;
}

const categories: Record<string, Category> = {
  length: {
    name: 'length',
    cn: '长度',
    base: 'm',
    units: {
      m: { name: 'meter', symbol: 'm', factor: 1 },
      km: { name: 'kilometer', symbol: 'km', factor: 1000 },
      cm: { name: 'centimeter', symbol: 'cm', factor: 0.01 },
      mm: { name: 'millimeter', symbol: 'mm', factor: 0.001 },
      mile: { name: 'mile', symbol: 'mile', factor: 1609.344 },
      yard: { name: 'yard', symbol: 'yd', factor: 0.9144 },
      foot: { name: 'foot', symbol: 'ft', factor: 0.3048 },
      inch: { name: 'inch', symbol: 'in', factor: 0.0254 },
      nmi: { name: 'nautical mile', symbol: 'nmi', factor: 1852 },
    },
  },
  mass: {
    name: 'mass',
    cn: '质量',
    base: 'kg',
    units: {
      kg: { name: 'kilogram', symbol: 'kg', factor: 1 },
      g: { name: 'gram', symbol: 'g', factor: 0.001 },
      mg: { name: 'milligram', symbol: 'mg', factor: 1e-6 },
      t: { name: 'ton', symbol: 't', factor: 1000 },
      lb: { name: 'pound', symbol: 'lb', factor: 0.45359237 },
      oz: { name: 'ounce', symbol: 'oz', factor: 0.028349523125 },
    },
  },
  temperature: {
    name: 'temperature',
    cn: '温度',
    base: 'C',
    units: {
      C: { name: 'celsius', symbol: 'C', toBase: (v) => v, fromBase: (v) => v },
      F: {
        name: 'fahrenheit',
        symbol: 'F',
        toBase: (v) => (v - 32) * (5 / 9),
        fromBase: (v) => v * (9 / 5) + 32,
      },
      K: {
        name: 'kelvin',
        symbol: 'K',
        toBase: (v) => v - 273.15,
        fromBase: (v) => v + 273.15,
      },
    },
  },
  area: {
    name: 'area',
    cn: '面积',
    base: 'm2',
    units: {
      m2: { name: 'square meter', symbol: 'm²', factor: 1 },
      km2: { name: 'square kilometer', symbol: 'km²', factor: 1e6 },
      ha: { name: 'hectare', symbol: 'ha', factor: 1e4 },
      acre: { name: 'acre', symbol: 'acre', factor: 4046.8564224 },
      ft2: { name: 'square foot', symbol: 'ft²', factor: 0.09290304 },
      mu: { name: 'mu (亩)', symbol: 'mu', factor: 666.6666667 },
    },
  },
  volume: {
    name: 'volume',
    cn: '体积',
    base: 'L',
    units: {
      L: { name: 'liter', symbol: 'L', factor: 1 },
      mL: { name: 'milliliter', symbol: 'mL', factor: 0.001 },
      m3: { name: 'cubic meter', symbol: 'm³', factor: 1000 },
      gal: { name: 'gallon (US)', symbol: 'gal', factor: 3.785411784 },
      pt: { name: 'pint (US)', symbol: 'pt', factor: 0.473176473 },
      cup: { name: 'cup (US)', symbol: 'cup', factor: 0.2365882365 },
    },
  },
  time: {
    name: 'time',
    cn: '时间',
    base: 's',
    units: {
      ms: { name: 'millisecond', symbol: 'ms', factor: 0.001 },
      s: { name: 'second', symbol: 's', factor: 1 },
      min: { name: 'minute', symbol: 'min', factor: 60 },
      h: { name: 'hour', symbol: 'h', factor: 3600 },
      day: { name: 'day', symbol: 'd', factor: 86400 },
      week: { name: 'week', symbol: 'w', factor: 604800 },
      month: { name: 'month (30d)', symbol: 'mo', factor: 2592000 },
      year: { name: 'year (365d)', symbol: 'y', factor: 31536000 },
    },
  },
  speed: {
    name: 'speed',
    cn: '速度',
    base: 'm/s',
    units: {
      'm/s': { name: 'meter per second', symbol: 'm/s', factor: 1 },
      'km/h': { name: 'kilometer per hour', symbol: 'km/h', factor: 1 / 3.6 },
      mph: { name: 'mile per hour', symbol: 'mph', factor: 0.44704 },
      knot: { name: 'knot', symbol: 'kn', factor: 0.514444444 },
    },
  },
  data: {
    name: 'data',
    cn: '数据',
    base: 'B',
    units: {
      B: { name: 'byte', symbol: 'B', factor: 1 },
      KB: { name: 'kilobyte (binary)', symbol: 'KiB', factor: 1024 },
      MB: { name: 'megabyte (binary)', symbol: 'MiB', factor: 1024 ** 2 },
      GB: { name: 'gigabyte (binary)', symbol: 'GiB', factor: 1024 ** 3 },
      TB: { name: 'terabyte (binary)', symbol: 'TiB', factor: 1024 ** 4 },
      PB: { name: 'petabyte (binary)', symbol: 'PiB', factor: 1024 ** 5 },
    },
  },
  pressure: {
    name: 'pressure',
    cn: '压力',
    base: 'Pa',
    units: {
      Pa: { name: 'pascal', symbol: 'Pa', factor: 1 },
      kPa: { name: 'kilopascal', symbol: 'kPa', factor: 1000 },
      MPa: { name: 'megapascal', symbol: 'MPa', factor: 1e6 },
      bar: { name: 'bar', symbol: 'bar', factor: 1e5 },
      atm: { name: 'atmosphere', symbol: 'atm', factor: 101325 },
      psi: { name: 'pound per square inch', symbol: 'psi', factor: 6894.757 },
    },
  },
  energy: {
    name: 'energy',
    cn: '能量',
    base: 'J',
    units: {
      J: { name: 'joule', symbol: 'J', factor: 1 },
      kJ: { name: 'kilojoule', symbol: 'kJ', factor: 1000 },
      cal: { name: 'calorie', symbol: 'cal', factor: 4.184 },
      kcal: { name: 'kilocalorie', symbol: 'kcal', factor: 4184 },
      Wh: { name: 'watt-hour', symbol: 'Wh', factor: 3600 },
      kWh: { name: 'kilowatt-hour', symbol: 'kWh', factor: 3.6e6 },
      BTU: { name: 'british thermal unit', symbol: 'BTU', factor: 1055.05585 },
    },
  },
  angle: {
    name: 'angle',
    cn: '角度',
    base: 'rad',
    units: {
      rad: { name: 'radian', symbol: 'rad', factor: 1 },
      deg: { name: 'degree', symbol: '°', factor: Math.PI / 180 },
      grad: { name: 'gradian', symbol: 'grad', factor: Math.PI / 200 },
      turn: { name: 'turn', symbol: 'turn', factor: 2 * Math.PI },
      arcmin: { name: 'arcminute', symbol: "'", factor: Math.PI / 180 / 60 },
      arcsec: { name: 'arcsecond', symbol: '"', factor: Math.PI / 180 / 3600 },
    },
  },
};

/** 单元查找：返回所属类别 key 与 UnitDef */
function findUnit(unit: string): { cat: string; def: UnitDef } | null {
  for (const [catKey, cat] of Object.entries(categories)) {
    if (cat.units[unit]) return { cat: catKey, def: cat.units[unit] };
  }
  return null;
}

/** 将值转为基准单位 */
function toBaseValue(value: number, def: UnitDef): number {
  if (def.toBase) return def.toBase(value);
  return value * (def.factor ?? 1) + (def.offset ?? 0);
}

/** 将基准值转为目标单位 */
function fromBaseValue(baseValue: number, def: UnitDef): number {
  if (def.fromBase) return def.fromBase(baseValue);
  return (baseValue - (def.offset ?? 0)) / (def.factor ?? 1);
}

/** 流式 API 构建器 */
export class ConvertBuilder {
  private value: number;
  private fromUnit: string | null = null;
  constructor(value: number) {
    this.value = value;
  }
  from(unit: string): this {
    this.fromUnit = unit;
    return this;
  }
  to(unit: string): number {
    if (!this.fromUnit) throw new Error('必须先调用 from(unit)');
    return convert(this.value, this.fromUnit, unit);
  }
  /** 转换为同类别所有单位 */
  toAll(): Record<string, number> {
    if (!this.fromUnit) throw new Error('必须先调用 from(unit)');
    const from = findUnit(this.fromUnit);
    if (!from) throw new Error(`未知单位: ${this.fromUnit}`);
    const cat = categories[from.cat];
    const baseValue = toBaseValue(this.value, from.def);
    const result: Record<string, number> = {};
    for (const [sym, def] of Object.entries(cat.units)) {
      result[sym] = fromBaseValue(baseValue, def);
    }
    return result;
  }
}

/** 流式 API 入口 */
export function convert(value: number): ConvertBuilder;
export function convert(value: number, from: string, to: string): number;
export function convert(value: number, from?: string, to?: string): ConvertBuilder | number {
  if (from !== undefined && to !== undefined) {
    const fromDef = findUnit(from);
    const toDef = findUnit(to);
    if (!fromDef) throw new Error(`未知单位: ${from}`);
    if (!toDef) throw new Error(`未知单位: ${to}`);
    if (fromDef.cat !== toDef.cat) {
      throw new Error(`单位类别不匹配: ${from} (${categories[fromDef.cat].cn}) vs ${to} (${categories[toDef.cat].cn})`);
    }
    const baseValue = toBaseValue(value, fromDef.def);
    return fromBaseValue(baseValue, toDef.def);
  }
  return new ConvertBuilder(value);
}

/** 获取所有类别 */
export function listCategories(): Array<{ key: string; cn: string; count: number }> {
  return Object.entries(categories).map(([k, c]) => ({
    key: k,
    cn: c.cn,
    count: Object.keys(c.units).length,
  }));
}

/** 获取某类别下所有单位 */
export function listUnits(catKey: string): Array<{ symbol: string; name: string }> {
  const cat = categories[catKey];
  if (!cat) return [];
  return Object.entries(cat.units).map(([sym, def]) => ({ symbol: sym, name: def.name }));
}

/** 获取类别中文名 */
export function categoryCn(catKey: string): string {
  return categories[catKey]?.cn ?? catKey;
}

// ===================== CLI 演示 =====================

function round(n: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'convert': {
      const value = Number(process.argv[3]);
      const from = process.argv[4];
      const to = process.argv[5];
      if (!value || !from || !to) {
        console.log('用法: convert <value> <from> <to>');
        return;
      }
      try {
        const result = convert(value, from, to);
        console.log(`${value} ${from} = ${round(result, 8)} ${to}`);
      } catch (e) {
        console.log(`错误: ${(e as Error).message}`);
        console.log('提示: 使用 "categories" 查看可用类别, "units <category>" 查看单位');
      }
      break;
    }
    case 'table': {
      const cat = process.argv[3];
      const value = Number(process.argv[4]);
      const unit = process.argv[5];
      if (!cat || !value || !unit) {
        console.log('用法: table <category> <value> <unit>');
        return;
      }
      try {
        const result = convert(value).from(unit).toAll();
        console.log(`${value} ${unit} 在各类同单位下的换算 (${categoryCn(cat)}):`);
        for (const [sym, v] of Object.entries(result)) {
          const def = categories[cat].units[sym];
          console.log(`  ${sym.padEnd(6)} (${def.name.padEnd(20)}) = ${round(v, 8)}`);
        }
      } catch (e) {
        console.log(`错误: ${(e as Error).message}`);
      }
      break;
    }
    case 'categories': {
      console.log('所有转换类别:');
      for (const c of listCategories()) {
        console.log(`  ${c.key.padEnd(14)} ${c.cn.padEnd(6)} (${c.count} 个单位)`);
      }
      break;
    }
    case 'units': {
      const cat = process.argv[3];
      if (!cat) {
        console.log('用法: units <category>');
        return;
      }
      const units = listUnits(cat);
      if (units.length === 0) {
        console.log(`未知类别: ${cat}`);
        return;
      }
      console.log(`类别 ${cat} (${categoryCn(cat)}) 的单位:`);
      for (const u of units) {
        console.log(`  ${u.symbol.padEnd(8)} ${u.name}`);
      }
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

可用类别: ${Object.keys(categories).join(', ')}

示例:
  convert 100 km mile
  convert 25 C F
  convert 1 m/s km/h
  table length 1 km
  table temperature 100 C
  categories
  units data
`);
  }
}

main();
