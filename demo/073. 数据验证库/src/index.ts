#!/usr/bin/env node
/**
 * 数据验证库 (Data Validator)
 * -------------------------------------------------------------
 * 模式化数据验证库，类似精简版 Joi/Zod。
 *
 * 公开 API:
 *   - 抽象基类 Schema<T>
 *       validate(value) -> { success, errors, value }
 *       assert(value) -> T            // 验证失败抛错
 *       check(value) -> boolean
 *       nullable() / optional() / default(v) / transform(fn)
 *       and(schema) / or(schema) / not()
 *       ref(fn)                        // 自定义验证
 *
 *   - 工厂函数:
 *       v.string() / v.number() / v.boolean() / v.date()
 *       v.array(itemSchema) / v.object(shape) / v.any()
 *       v.union(...schemas) / v.literal(value)
 *       v.custom(fn)
 *
 *   - 验证结果: ValidationResult<T>
 *   - 错误: ValidationError { path, message, expected, received }
 *
 * 仅依赖 Node.js 内置模块 (本库实际上不需要任何模块依赖).
 */

import fs from 'fs';
import path from 'path';

/** 验证错误 */
export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/** 验证结果 */
export interface ValidationResult<T> {
  success: boolean;
  errors: ValidationError[];
  value: T;
}

/** 验证上下文 */
interface Context {
  errors: ValidationError[];
  root: unknown;
}

/** 自定义验证函数 */
export type CustomValidator<T> = (value: T, ctx: Context) => ValidationError | null;

/** Schema 抽象基类 */
export abstract class Schema<T> {
  protected isOptional = false;
  protected isNullable = false;
  protected defaultValue: { has: boolean; value: any } = { has: false, value: undefined };
  protected transforms: Array<(v: any) => any> = [];
  protected customs: Array<(value: any, ctx: Context) => ValidationError | null> = [];

  /** 核心类型检查，子类实现 */
  protected abstract _parse(value: unknown, path: string, ctx: Context): T;

  /** 验证入口 */
  validate(input: unknown): ValidationResult<T> {
    const ctx: Context = { errors: [], root: input };
    let value = input;
    // 处理 optional / nullable / default
    if (value === undefined) {
      if (this.defaultValue.has) {
        value = this.defaultValue.value;
      } else if (this.isOptional) {
        return { success: true, errors: [], value: undefined as T };
      } else {
        ctx.errors.push({ path: '', message: '值不能为 undefined', expected: 'defined', received: 'undefined' });
        return { success: false, errors: ctx.errors, value: undefined as T };
      }
    }
    if (value === null) {
      if (this.isNullable) {
        return { success: true, errors: [], value: null as T };
      } else {
        ctx.errors.push({ path: '', message: '值不能为 null', expected: 'non-null', received: 'null' });
        return { success: false, errors: ctx.errors, value: null as T };
      }
    }
    // 类型解析
    let parsed: T;
    try {
      parsed = this._parse(value, '', ctx);
    } catch (err) {
      ctx.errors.push({ path: '', message: `解析异常: ${(err as Error).message}` });
      return { success: false, errors: ctx.errors, value: undefined as T };
    }
    // 自定义验证
    for (const fn of this.customs) {
      const e = fn(parsed, ctx);
      if (e) ctx.errors.push(e);
    }
    // 转换
    for (const t of this.transforms) {
      parsed = t(parsed);
    }
    return { success: ctx.errors.length === 0, errors: ctx.errors, value: parsed };
  }

  /** 验证失败抛错 */
  assert(input: unknown): T {
    const r = this.validate(input);
    if (!r.success) {
      throw new Error(`验证失败: ${r.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ')}`);
    }
    return r.value;
  }

  /** 仅返回布尔结果 */
  check(input: unknown): input is T {
    return this.validate(input).success;
  }

  // 修饰方法
  optional(): Schema<T | undefined> {
    this.isOptional = true;
    return this as unknown as Schema<T | undefined>;
  }
  nullable(): Schema<T | null> {
    this.isNullable = true;
    return this as unknown as Schema<T | null>;
  }
  default(value: T): this {
    this.defaultValue = { has: true, value };
    return this;
  }
  transform(fn: (v: T) => T): this {
    this.transforms.push(fn);
    return this;
  }
  ref(fn: CustomValidator<T>): this {
    this.customs.push(fn);
    return this;
  }

  /** 与另一 schema 取交集（两者都必须通过） */
  and<U>(other: Schema<U>): Schema<T & U> {
    return new AndSchema(this, other);
  }
  /** 与另一 schema 取并集（任一通过即可） */
  or<U>(other: Schema<U>): Schema<T | U> {
    return new OrSchema(this, other);
  }
  /** 取反 */
  not(): Schema<unknown> {
    return new NotSchema(this);
  }
}

/** AndSchema */
class AndSchema<T, U> extends Schema<T & U> {
  constructor(private a: Schema<T>, private b: Schema<U>) {
    super();
  }
  protected _parse(value: unknown, p: string, ctx: Context): T & U {
    const ra = this.a.validate(value);
    if (!ra.success) ctx.errors.push(...ra.errors.map((e) => ({ ...e, path: p + e.path })));
    const rb = this.b.validate(value);
    if (!rb.success) ctx.errors.push(...rb.errors.map((e) => ({ ...e, path: p + e.path })));
    return { ...(ra.value as object), ...(rb.value as object) } as T & U;
  }
}

/** OrSchema */
class OrSchema<T, U> extends Schema<T | U> {
  constructor(private a: Schema<T>, private b: Schema<U>) {
    super();
  }
  protected _parse(value: unknown, p: string, ctx: Context): T | U {
    const ra = this.a.validate(value);
    if (ra.success) return ra.value;
    const rb = this.b.validate(value);
    if (rb.success) return rb.value;
    ctx.errors.push({
      path: p,
      message: '所有联合类型均验证失败',
      expected: 'union match',
      received: typeof value,
    });
    return value as T | U;
  }
}

/** NotSchema */
class NotSchema<T> extends Schema<unknown> {
  constructor(private a: Schema<T>) {
    super();
  }
  protected _parse(value: unknown, p: string, ctx: Context): unknown {
    const r = this.a.validate(value);
    if (r.success) {
      ctx.errors.push({ path: p, message: '值不应匹配该 schema', expected: 'not match', received: typeof value });
    }
    return value;
  }
}

// ---------- 字符串 ----------
class StringSchema extends Schema<string> {
  private minLen?: { n: number; msg?: string };
  private maxLen?: { n: number; msg?: string };
  private exactLen?: { n: number; msg?: string };
  private pattern?: { re: RegExp; msg?: string };
  private inEnum?: { values: string[]; msg?: string };

  protected _parse(value: unknown, p: string, ctx: Context): string {
    if (typeof value !== 'string') {
      ctx.errors.push({ path: p, message: '期望字符串', expected: 'string', received: typeof value });
      return String(value);
    }
    if (this.minLen && value.length < this.minLen.n) {
      ctx.errors.push({ path: p, message: this.minLen.msg ?? `长度不能小于 ${this.minLen.n}` });
    }
    if (this.maxLen && value.length > this.maxLen.n) {
      ctx.errors.push({ path: p, message: this.maxLen.msg ?? `长度不能大于 ${this.maxLen.n}` });
    }
    if (this.exactLen && value.length !== this.exactLen.n) {
      ctx.errors.push({ path: p, message: this.exactLen.msg ?? `长度必须为 ${this.exactLen.n}` });
    }
    if (this.pattern && !this.pattern.re.test(value)) {
      ctx.errors.push({ path: p, message: this.pattern.msg ?? `不匹配模式 ${this.pattern.re}` });
    }
    if (this.inEnum && !this.inEnum.values.includes(value)) {
      ctx.errors.push({ path: p, message: this.inEnum.msg ?? `值必须是 ${this.inEnum.values.join(', ')} 之一` });
    }
    return value;
  }

  min(n: number, msg?: string): this {
    this.minLen = { n, msg };
    return this;
  }
  max(n: number, msg?: string): this {
    this.maxLen = { n, msg };
    return this;
  }
  length(n: number, msg?: string): this {
    this.exactLen = { n, msg };
    return this;
  }
  matches(re: RegExp, msg?: string): this {
    this.pattern = { re, msg };
    return this;
  }
  email(msg?: string): this {
    return this.matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg ?? '无效的邮箱格式');
  }
  url(msg?: string): this {
    return this.matches(/^https?:\/\/.+/, msg ?? '无效的 URL 格式');
  }
  enum(values: string[], msg?: string): this {
    this.inEnum = { values, msg };
    return this;
  }
}

// ---------- 数字 ----------
class NumberSchema extends Schema<number> {
  private minVal?: { n: number; msg?: string };
  private maxVal?: { n: number; msg?: string };
  private intOnly = false;
  private positiveOnly = false;

  protected _parse(value: unknown, p: string, ctx: Context): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      ctx.errors.push({ path: p, message: '期望数字', expected: 'number', received: typeof value });
      return 0;
    }
    if (this.intOnly && !Number.isInteger(value)) {
      ctx.errors.push({ path: p, message: '期望整数' });
    }
    if (this.positiveOnly && value <= 0) {
      ctx.errors.push({ path: p, message: '必须为正数' });
    }
    if (this.minVal && value < this.minVal.n) {
      ctx.errors.push({ path: p, message: this.minVal.msg ?? `不能小于 ${this.minVal.n}` });
    }
    if (this.maxVal && value > this.maxVal.n) {
      ctx.errors.push({ path: p, message: this.maxVal.msg ?? `不能大于 ${this.maxVal.n}` });
    }
    return value;
  }

  min(n: number, msg?: string): this {
    this.minVal = { n, msg };
    return this;
  }
  max(n: number, msg?: string): this {
    this.maxVal = { n, msg };
    return this;
  }
  integer(): this {
    this.intOnly = true;
    return this;
  }
  positive(): this {
    this.positiveOnly = true;
    return this;
  }
}

// ---------- 布尔 ----------
class BooleanSchema extends Schema<boolean> {
  protected _parse(value: unknown, p: string, ctx: Context): boolean {
    if (typeof value !== 'boolean') {
      ctx.errors.push({ path: p, message: '期望布尔值', expected: 'boolean', received: typeof value });
      return Boolean(value);
    }
    return value;
  }
}

// ---------- 日期 ----------
class DateSchema extends Schema<Date> {
  private after?: Date;
  private before?: Date;

  protected _parse(value: unknown, p: string, ctx: Context): Date {
    let d: Date;
    if (value instanceof Date) {
      d = value;
    } else if (typeof value === 'string' || typeof value === 'number') {
      d = new Date(value);
    } else {
      ctx.errors.push({ path: p, message: '期望日期', expected: 'date', received: typeof value });
      return new Date();
    }
    if (Number.isNaN(d.getTime())) {
      ctx.errors.push({ path: p, message: '无效的日期' });
    }
    if (this.after && d <= this.after) {
      ctx.errors.push({ path: p, message: `日期必须晚于 ${this.after.toISOString()}` });
    }
    if (this.before && d >= this.before) {
      ctx.errors.push({ path: p, message: `日期必须早于 ${this.before.toISOString()}` });
    }
    return d;
  }

  minDate(d: Date): this {
    this.after = d;
    return this;
  }
  maxDate(d: Date): this {
    this.before = d;
    return this;
  }
}

// ---------- 数组 ----------
class ArraySchema<T> extends Schema<T[]> {
  private minN?: number;
  private maxN?: number;
  constructor(private item: Schema<T>) {
    super();
  }
  protected _parse(value: unknown, p: string, ctx: Context): T[] {
    if (!Array.isArray(value)) {
      ctx.errors.push({ path: p, message: '期望数组', expected: 'array', received: typeof value });
      return [];
    }
    if (this.minN !== undefined && value.length < this.minN) {
      ctx.errors.push({ path: p, message: `数组长度不能小于 ${this.minN}` });
    }
    if (this.maxN !== undefined && value.length > this.maxN) {
      ctx.errors.push({ path: p, message: `数组长度不能大于 ${this.maxN}` });
    }
    return value.map((v, i) => this.item.validate(v).value as T);
  }
  min(n: number): this {
    this.minN = n;
    return this;
  }
  max(n: number): this {
    this.maxN = n;
    return this;
  }
}

// ---------- 对象 ----------
type Shape = Record<string, Schema<unknown>>;
type Inferred<T extends Shape> = { [K in keyof T]: T[K] extends Schema<infer U> ? U : never };

class ObjectSchema<T extends Shape> extends Schema<Inferred<T>> {
  private strictMode = false;
  constructor(private shape: T) {
    super();
  }
  protected _parse(value: unknown, p: string, ctx: Context): Inferred<T> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      ctx.errors.push({ path: p, message: '期望对象', expected: 'object', received: typeof value });
      return {} as Inferred<T>;
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      const r = schema.validate(obj[key]);
      if (!r.success) {
        for (const e of r.errors) {
          ctx.errors.push({ ...e, path: e.path ? `${p}${p ? '.' : ''}${key}.${e.path}` : `${p}${p ? '.' : ''}${key}` });
        }
      }
      out[key] = r.value;
    }
    if (this.strictMode) {
      for (const key of Object.keys(obj)) {
        if (!(key in this.shape)) {
          ctx.errors.push({ path: p, message: `存在未声明的字段: ${key}` });
        }
      }
    }
    return out as Inferred<T>;
  }
  strict(): this {
    this.strictMode = true;
    return this;
  }
}

// ---------- Any ----------
class AnySchema extends Schema<unknown> {
  protected _parse(value: unknown): unknown {
    return value;
  }
}

// ---------- Literal ----------
class LiteralSchema<T extends string | number | boolean> extends Schema<T> {
  constructor(private lit: T) {
    super();
  }
  protected _parse(value: unknown, p: string, ctx: Context): T {
    if (value !== this.lit) {
      ctx.errors.push({ path: p, message: `期望字面量 ${JSON.stringify(this.lit)}`, expected: String(this.lit), received: String(value) });
    }
    return value as T;
  }
}

// ---------- 工厂命名空间 ----------
export const v = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  date: () => new DateSchema(),
  array: <T>(item: Schema<T>) => new ArraySchema(item),
  object: <T extends Shape>(shape: T) => new ObjectSchema(shape),
  any: () => new AnySchema(),
  union: <T, U>(a: Schema<T>, b: Schema<U>) => new OrSchema(a, b),
  literal: <T extends string | number | boolean>(value: T) => new LiteralSchema(value),
  custom: <T>(fn: CustomValidator<T>) => {
    const s = new AnySchema() as unknown as Schema<T>;
    return s.ref(fn);
  },
};

// ===================== CLI 演示 =====================

function readJsonFile(file: string): unknown {
  const content = fs.readFileSync(path.resolve(file), 'utf8');
  return JSON.parse(content);
}

const schemas: Record<string, Schema<unknown>> = {
  user: v
    .object({
      name: v.string().min(2).max(50),
      age: v.number().integer().min(0).max(150),
      email: v.string().email(),
      role: v.string().enum(['admin', 'user', 'guest']),
      tags: v.array(v.string()).max(10),
    })
    .strict(),
  point: v.object({ x: v.number(), y: v.number() }),
};

function examples(): void {
  console.log('===== 验证库示例 =====\n');

  const userSchema = v.object({
    name: v.string().min(2, '姓名至少2个字符'),
    age: v.number().integer().positive(),
    email: v.string().email(),
    address: v
      .object({
        city: v.string(),
        zip: v.string().matches(/^\d{6}$/, '邮编必须是6位数字'),
      })
      .optional(),
    tags: v.array(v.string()).max(5),
    status: v.union(v.literal('active'), v.literal('inactive')),
  });

  const good = {
    name: '张三',
    age: 30,
    email: 'zhangsan@example.com',
    address: { city: '北京', zip: '100000' },
    tags: ['dev', 'admin'],
    status: 'active',
  };
  const bad = {
    name: 'A',
    age: -1,
    email: 'not-an-email',
    address: { city: '上海', zip: 'abc' },
    tags: Array(20).fill('x'),
    status: 'unknown',
  };

  console.log('--- 合法数据 ---');
  console.log(JSON.stringify(userSchema.validate(good), null, 2));
  console.log('\n--- 非法数据 ---');
  console.log(JSON.stringify(userSchema.validate(bad), null, 2));

  // assert
  console.log('\n--- assert 用法 ---');
  try {
    const v1 = userSchema.assert(good);
    console.log('assert 通过:', v1.name);
  } catch (e) {
    console.log('assert 失败:', (e as Error).message);
  }

  // transform & default
  console.log('\n--- transform & default ---');
  const s = v
    .string()
    .default('hello')
    .transform((s) => s.toUpperCase());
  console.log(JSON.stringify(s.validate(undefined), null, 2));
  console.log(JSON.stringify(s.validate('world'), null, 2));

  // and / or / not
  console.log('\n--- and / or / not ---');
  const evenStr = v.string().and(v.custom<string>((val) => (val.length % 2 === 0 ? null : { path: '', message: '字符串长度必须为偶数' })));
  console.log('evenStr("ab):', JSON.stringify(evenStr.validate('ab')));
  const numOrStr = v.union(v.number(), v.string());
  console.log('numOrStr(123):', JSON.stringify(numOrStr.validate(123)));
  console.log('numOrStr("x"):', JSON.stringify(numOrStr.validate('x')));
  console.log('notNumber("x"):', JSON.stringify(v.number().not().validate('x')));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'validate': {
      const schemaName = process.argv[3];
      const dataFile = process.argv[4];
      if (!schemaName || !dataFile) {
        console.log('用法: validate <schema.json|preset> <data.json>');
        return;
      }
      let schema: Schema<unknown>;
      if (schemas[schemaName]) {
        schema = schemas[schemaName];
      } else {
        // 从 JSON 文件加载简化 schema 描述 (此处仅支持 preset)
        console.log(`未知 schema: ${schemaName}, 可用: ${Object.keys(schemas).join(', ')}`);
        return;
      }
      const data = readJsonFile(dataFile);
      const result = schema.validate(data);
      console.log('验证结果:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }
    case 'interactive': {
      console.log('===== 交互式验证 (使用内置 user schema) =====');
      console.log('内置 schema: user, point');
      console.log('请在控制台输入 JSON 数据 (输入 EOF 结束):\n');
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const data = await new Promise<string>((resolve) => {
        let buf = '';
        rl.on('line', (line) => (buf += line + '\n'));
        rl.on('close', () => resolve(buf));
      });
      try {
        const obj = JSON.parse(data);
        const r = schemas.user.validate(obj);
        console.log(JSON.stringify(r, null, 2));
      } catch (e) {
        console.log('JSON 解析失败:', (e as Error).message);
      }
      break;
    }
    case 'examples':
      examples();
      break;
    default:
      console.log(`
数据验证库 - 命令行演示

用法:
  validate <schema.json|preset> <data.json>    验证数据文件
  interactive                                  从标准输入读取 JSON 并验证
  examples                                     展示示例

可用 preset schema: ${Object.keys(schemas).join(', ')}

示例:
  examples
  validate user ./data.json
`);
  }
}

main();
