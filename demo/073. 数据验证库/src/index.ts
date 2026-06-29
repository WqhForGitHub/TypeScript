#!/usr/bin/env node
/**
 * 数据验证库 (Data Validation Library) - Enhanced Edition
 * 模式化数据验证库 (精简版 Joi/Zod)，使用大量高级 TypeScript 特性。
 *
 * 公开 API:
 *   - 抽象基类 AbstractValidator<T> + 具体子类 (String/Number/Boolean/Array/Object/Date/Any/Literal)
 *       validate / assert / check / optional / nullable / default / transform / ref / and / or / not
 *   - 容器类 SchemaValidator<T extends Record<string, unknown>>
 *   - 工厂 v.* / 枚举 (ValueType, ErrorCode, ValidationPhase, Severity)
 *   - 错误 ValidationError extends Error (带 code, 可迭代 issues)
 *   - 工具: Mutable<T>, InferValidator<V>, 类型守卫, 函数重载, 生成器
 * 仅依赖 Node.js 内置模块.
 */

import fs from "fs";
import path from "path";

// ==================== 枚举 Enums ====================

export enum ValueType {
  String = "string",
  Number = "number",
  Boolean = "boolean",
  Array = "array",
  Object = "object",
  Date = "date",
  Any = "any",
  Literal = "literal",
  Union = "union",
}
export enum ErrorCode {
  TypeMismatch = "TYPE_MISMATCH",
  OutOfRange = "OUT_OF_RANGE",
  InvalidFormat = "INVALID_FORMAT",
  MissingRequired = "MISSING_REQUIRED",
  UnexpectedField = "UNEXPECTED_FIELD",
  CustomFailure = "CUSTOM_FAILURE",
  LengthMismatch = "LENGTH_MISMATCH",
  ParseError = "PARSE_ERROR",
}
export enum ValidationPhase {
  Parse = "parse",
  Transform = "transform",
  Custom = "custom",
  Finalize = "finalize",
}
export enum Severity {
  Error = "error",
  Warning = "warning",
  Info = "info",
}

// ==================== Symbols (唯一属性键) ====================

const VALIDATOR_TYPE = Symbol("validatorType");
const SCHEMA_REGISTRY = Symbol("schemaRegistry");

// ==================== 映射类型 / 条件类型 ====================

/** 移除 readonly 修饰符 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** 从校验器推断被校验类型 (条件类型 + infer) */
export type InferValidator<V> =
  V extends AbstractValidator<infer U> ? U : never;
/** 从 shape 推断对象类型 (映射类型 + 条件类型) */
export type InferShape<S extends Record<string, AbstractValidator<unknown>>> = {
  [K in keyof S]: InferValidator<S[K]>;
};
/** 判断是否为 Error 子类 */
export type IsError<T> = T extends Error ? true : false;

// ==================== 接口 (含可选/只读/索引签名) ====================

export interface ValidationIssue {
  readonly id: number;
  readonly path: string;
  readonly message: string;
  readonly code: ErrorCode;
  readonly severity: Severity;
  readonly phase: ValidationPhase;
  readonly expected?: string;
  readonly received?: string;
  readonly timestamp: number;
  [key: string]: unknown; // 索引签名
}

/** 用于构造 issue 的输入 (无 id/timestamp, 无索引签名, 便于 Omit/赋值) */
export interface IssueInput {
  path: string;
  message: string;
  code: ErrorCode;
  severity: Severity;
  phase: ValidationPhase;
  expected?: string;
  received?: string;
}

export interface ValidationContext {
  readonly root: unknown;
  readonly issues: ValidationIssue[];
  readonly warnings: ValidationIssue[];
  addIssue(issue: IssueInput): void;
  addWarning(issue: IssueInput): void;
}

/** 判别联合: 验证成功 */
export interface ValidationSuccess<T> {
  readonly success: true;
  readonly kind: "success";
  readonly value: T;
  readonly issues: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}
/** 判别联合: 验证失败 */
export interface ValidationFailure<T> {
  readonly success: false;
  readonly kind: "failure";
  readonly value: T;
  readonly issues: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly errorCode: ErrorCode;
}
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure<T>;

// ==================== 自定义错误层级 ====================

/** 验证错误: 继承 Error, 带 code 属性, 可迭代 issues */
export class ValidationError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly ValidationIssue[];
  readonly path: string;
  constructor(
    message: string,
    opts?: {
      readonly code?: ErrorCode;
      readonly issues?: readonly ValidationIssue[];
      readonly path?: string;
    },
  ) {
    super(message);
    this.name = "ValidationError";
    this.code = opts?.code ?? ErrorCode.CustomFailure;
    this.issues = opts?.issues ?? [];
    this.path = opts?.path ?? "";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
  /** 迭代器: 遍历所有 issue */
  *[Symbol.iterator](): Iterator<ValidationIssue> {
    for (const issue of this.issues) yield issue;
  }
}

export class SchemaError extends ValidationError {
  constructor(
    message: string,
    opts?: {
      readonly code?: ErrorCode;
      readonly issues?: readonly ValidationIssue[];
      readonly path?: string;
    },
  ) {
    super(message, opts);
    this.name = "SchemaError";
    Object.setPrototypeOf(this, SchemaError.prototype);
  }
}

// ==================== 类型守卫 ====================

export function isValidationSuccess<T>(
  r: ValidationResult<T>,
): r is ValidationSuccess<T> {
  return r.success === true;
}
export function isValidationFailure<T>(
  r: ValidationResult<T>,
): r is ValidationFailure<T> {
  return r.success === false;
}
export function isString(value: unknown): value is string {
  return typeof value === "string";
}
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isValidationError(err: unknown): err is ValidationError {
  return err instanceof Error && (err as ValidationError).code !== undefined;
}

// ==================== 函数重载 ====================

/** 将值强制转换为指定类型 */
export function coerce(value: string, type: "number"): number;
export function coerce(value: string, type: "boolean"): boolean;
export function coerce(value: string, type: "date"): Date;
export function coerce(value: unknown, type: ValueType): unknown;
export function coerce(
  value: unknown,
  type: ValueType | "number" | "boolean" | "date",
): unknown {
  switch (type) {
    case "number":
    case ValueType.Number: {
      const n = Number(value);
      return Number.isNaN(n) ? 0 : n;
    }
    case "boolean":
    case ValueType.Boolean:
      return Boolean(value);
    case "date":
    case ValueType.Date:
      return new Date(value as string);
    default:
      return value;
  }
}

// ==================== 生成器辅助 ====================

/** 生成器: 按顺序产出 warnings 然后 issues */
export function* iterateIssues<T>(
  result: ValidationResult<T>,
): Generator<ValidationIssue> {
  for (const w of result.warnings) yield w;
  for (const i of result.issues) yield i;
}

// ==================== 抽象校验器基类 ====================

export type CustomIssue = {
  path: string;
  message: string;
  code?: ErrorCode;
  severity?: Severity;
  phase?: ValidationPhase;
  expected?: string;
  received?: string;
};
export type CustomValidator<T> = (
  value: T,
  ctx: ValidationContext,
) => CustomIssue | null;

interface ValidatorOptions {
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
}

const DEFAULT_OPTIONS = {
  optional: false,
  nullable: false,
  hasDefault: false,
  defaultValue: undefined,
} as const satisfies ValidatorOptions;

export abstract class AbstractValidator<T> {
  protected options: Mutable<ValidatorOptions> = { ...DEFAULT_OPTIONS };
  // 使用 any 元素类型以避免 T 的不变性 (invariance), 使子类可赋值给 AbstractValidator<unknown>
  protected transforms: Array<(v: any) => any> = [];
  protected customs: Array<
    (value: any, ctx: ValidationContext) => CustomIssue | null
  > = [];
  private _label?: string;
  private _id: number;
  [VALIDATOR_TYPE]: ValueType;

  constructor(type: ValueType) {
    this[VALIDATOR_TYPE] = type;
    this._id = Math.floor(Math.random() * 1e9);
  }

  /** 子类实现的核心解析 */
  protected abstract _parse(
    value: unknown,
    path: string,
    ctx: ValidationContext,
  ): T;

  // ---- getter / setter ----
  get label(): string | undefined {
    return this._label;
  }
  set label(val: string | undefined) {
    if (val !== undefined && typeof val !== "string")
      throw new TypeError("label 必须为字符串");
    this._label = val;
  }
  get id(): number {
    return this._id;
  }
  get valueType(): ValueType {
    return this[VALIDATOR_TYPE];
  }
  get isOptional(): boolean {
    return this.options.optional;
  }
  get isNullable(): boolean {
    return this.options.nullable;
  }

  /** 验证入口 */
  validate(input: unknown): ValidationResult<T> {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    let nextId = 1;
    const ctx: ValidationContext = {
      root: input,
      issues,
      warnings,
      addIssue(i) {
        issues.push({ ...i, id: nextId++, timestamp: Date.now() });
      },
      addWarning(i) {
        warnings.push({ ...i, id: nextId++, timestamp: Date.now() });
      },
    };

    let value = input;
    if (value === undefined) {
      if (this.options.hasDefault) value = this.options.defaultValue;
      else if (this.options.optional)
        return {
          success: true,
          kind: "success",
          value: undefined as T,
          issues,
          warnings,
        };
      else {
        ctx.addIssue({
          path: "",
          message: "值不能为 undefined",
          code: ErrorCode.MissingRequired,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
          expected: "defined",
          received: "undefined",
        });
        return {
          success: false,
          kind: "failure",
          value: undefined as T,
          issues,
          warnings,
          errorCode: ErrorCode.MissingRequired,
        };
      }
    }
    if (value === null) {
      if (this.options.nullable)
        return {
          success: true,
          kind: "success",
          value: null as T,
          issues,
          warnings,
        };
      ctx.addIssue({
        path: "",
        message: "值不能为 null",
        code: ErrorCode.MissingRequired,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "non-null",
        received: "null",
      });
      return {
        success: false,
        kind: "failure",
        value: null as T,
        issues,
        warnings,
        errorCode: ErrorCode.MissingRequired,
      };
    }

    let parsed: T;
    try {
      parsed = this._parse(value, "", ctx);
    } catch (err) {
      ctx.addIssue({
        path: "",
        message: `解析异常: ${(err as Error).message}`,
        code: ErrorCode.ParseError,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
      });
      return {
        success: false,
        kind: "failure",
        value: undefined as T,
        issues,
        warnings,
        errorCode: ErrorCode.ParseError,
      };
    }

    for (const fn of this.customs) {
      const e = fn(parsed, ctx);
      if (e)
        ctx.addIssue({
          path: e.path,
          message: e.message,
          code: e.code ?? ErrorCode.CustomFailure,
          severity: e.severity ?? Severity.Error,
          phase: e.phase ?? ValidationPhase.Custom,
          expected: e.expected,
          received: e.received,
        });
    }
    for (const t of this.transforms) parsed = t(parsed);

    if (issues.length > 0)
      return {
        success: false,
        kind: "failure",
        value: parsed,
        issues,
        warnings,
        errorCode: issues[0].code,
      };
    return { success: true, kind: "success", value: parsed, issues, warnings };
  }

  assert(input: unknown): T {
    const r = this.validate(input);
    if (!r.success)
      throw new ValidationError(
        `验证失败: ${r.issues.map((e) => `${e.path || "(root)"}: ${e.message}`).join("; ")}`,
        { code: r.errorCode, issues: [...r.issues], path: "" },
      );
    return r.value;
  }
  check(input: unknown): input is T {
    return this.validate(input).success;
  }

  optional(): AbstractValidator<T | undefined> {
    this.options.optional = true;
    return this as unknown as AbstractValidator<T | undefined>;
  }
  nullable(): AbstractValidator<T | null> {
    this.options.nullable = true;
    return this as unknown as AbstractValidator<T | null>;
  }
  default(value: T): this {
    this.options.hasDefault = true;
    this.options.defaultValue = value;
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
  and<U>(other: AbstractValidator<U>): AbstractValidator<T & U> {
    return new AndValidator(this, other);
  }
  or<U>(other: AbstractValidator<U>): AbstractValidator<T | U> {
    return new OrValidator(this, other);
  }
  not(): AbstractValidator<unknown> {
    return new NotValidator(this);
  }
}

// ==================== 复合校验器 ====================

class AndValidator<T, U> extends AbstractValidator<T & U> {
  constructor(
    private a: AbstractValidator<T>,
    private b: AbstractValidator<U>,
  ) {
    super(ValueType.Union);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): T & U {
    const ra = this.a.validate(value);
    for (const e of ra.issues)
      ctx.addIssue({ ...e, path: p + (e.path ? "." + e.path : "") });
    const rb = this.b.validate(value);
    for (const e of rb.issues)
      ctx.addIssue({ ...e, path: p + (e.path ? "." + e.path : "") });
    return { ...(ra.value as object), ...(rb.value as object) } as T & U;
  }
}

class OrValidator<T, U> extends AbstractValidator<T | U> {
  constructor(
    private a: AbstractValidator<T>,
    private b: AbstractValidator<U>,
  ) {
    super(ValueType.Union);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): T | U {
    const ra = this.a.validate(value);
    if (ra.success) return ra.value;
    const rb = this.b.validate(value);
    if (rb.success) return rb.value;
    ctx.addIssue({
      path: p,
      message: "所有联合类型均验证失败",
      code: ErrorCode.TypeMismatch,
      severity: Severity.Error,
      phase: ValidationPhase.Parse,
      expected: "union match",
      received: typeof value,
    });
    return value as T | U;
  }
}

class NotValidator<T> extends AbstractValidator<unknown> {
  constructor(private a: AbstractValidator<T>) {
    super(ValueType.Union);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): unknown {
    const r = this.a.validate(value);
    if (r.success)
      ctx.addIssue({
        path: p,
        message: "值不应匹配该 schema",
        code: ErrorCode.CustomFailure,
        severity: Severity.Error,
        phase: ValidationPhase.Custom,
        expected: "not match",
        received: typeof value,
      });
    return value;
  }
}

// ==================== StringValidator ====================

interface StringRule {
  readonly kind: "min" | "max" | "length" | "pattern" | "enum";
  readonly n?: number;
  readonly re?: RegExp;
  readonly values?: readonly string[];
  readonly msg?: string;
}

export class StringValidator extends AbstractValidator<string> {
  private rules: StringRule[] = [];
  constructor() {
    super(ValueType.String);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): string {
    if (typeof value !== "string") {
      ctx.addIssue({
        path: p,
        message: "期望字符串",
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "string",
        received: typeof value,
      });
      return String(value);
    }
    for (const rule of this.rules) {
      if (rule.kind === "min" && value.length < (rule.n ?? 0))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `长度不能小于 ${rule.n}`,
          code: ErrorCode.LengthMismatch,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (rule.kind === "max" && value.length > (rule.n ?? Infinity))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `长度不能大于 ${rule.n}`,
          code: ErrorCode.LengthMismatch,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (rule.kind === "length" && value.length !== (rule.n ?? -1))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `长度必须为 ${rule.n}`,
          code: ErrorCode.LengthMismatch,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (rule.kind === "pattern" && rule.re && !rule.re.test(value))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `不匹配模式 ${rule.re}`,
          code: ErrorCode.InvalidFormat,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (
        rule.kind === "enum" &&
        rule.values &&
        !rule.values.includes(value)
      )
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `值必须是 ${rule.values.join(", ")} 之一`,
          code: ErrorCode.OutOfRange,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
    }
    return value;
  }
  min(n: number, msg?: string): this {
    this.rules.push({ kind: "min", n, msg } satisfies StringRule);
    return this;
  }
  max(n: number, msg?: string): this {
    this.rules.push({ kind: "max", n, msg } satisfies StringRule);
    return this;
  }
  length(n: number, msg?: string): this {
    this.rules.push({ kind: "length", n, msg } satisfies StringRule);
    return this;
  }
  matches(re: RegExp, msg?: string): this {
    this.rules.push({ kind: "pattern", re, msg } satisfies StringRule);
    return this;
  }
  email(msg?: string): this {
    return this.matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg ?? "无效的邮箱格式");
  }
  url(msg?: string): this {
    return this.matches(/^https?:\/\/.+/, msg ?? "无效的 URL 格式");
  }
  enum(values: readonly string[], msg?: string): this {
    this.rules.push({ kind: "enum", values, msg } satisfies StringRule);
    return this;
  }
}

// ==================== NumberValidator ====================

interface NumberRule {
  readonly kind: "min" | "max" | "integer" | "positive";
  readonly n?: number;
  readonly msg?: string;
}

export class NumberValidator extends AbstractValidator<number> {
  private rules: NumberRule[] = [];
  constructor() {
    super(ValueType.Number);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      ctx.addIssue({
        path: p,
        message: "期望数字",
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "number",
        received: typeof value,
      });
      return 0;
    }
    for (const rule of this.rules) {
      if (rule.kind === "integer" && !Number.isInteger(value))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? "期望整数",
          code: ErrorCode.TypeMismatch,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (rule.kind === "positive" && value <= 0)
        ctx.addIssue({
          path: p,
          message: rule.msg ?? "必须为正数",
          code: ErrorCode.OutOfRange,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (rule.kind === "min" && value < (rule.n ?? -Infinity))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `不能小于 ${rule.n}`,
          code: ErrorCode.OutOfRange,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
      else if (rule.kind === "max" && value > (rule.n ?? Infinity))
        ctx.addIssue({
          path: p,
          message: rule.msg ?? `不能大于 ${rule.n}`,
          code: ErrorCode.OutOfRange,
          severity: Severity.Error,
          phase: ValidationPhase.Parse,
        });
    }
    return value;
  }
  min(n: number, msg?: string): this {
    this.rules.push({ kind: "min", n, msg } satisfies NumberRule);
    return this;
  }
  max(n: number, msg?: string): this {
    this.rules.push({ kind: "max", n, msg } satisfies NumberRule);
    return this;
  }
  integer(msg?: string): this {
    this.rules.push({ kind: "integer", msg } satisfies NumberRule);
    return this;
  }
  positive(msg?: string): this {
    this.rules.push({ kind: "positive", msg } satisfies NumberRule);
    return this;
  }
}

// ==================== BooleanValidator ====================

export class BooleanValidator extends AbstractValidator<boolean> {
  constructor() {
    super(ValueType.Boolean);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): boolean {
    if (typeof value !== "boolean") {
      ctx.addIssue({
        path: p,
        message: "期望布尔值",
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "boolean",
        received: typeof value,
      });
      return Boolean(value);
    }
    return value;
  }
}

// ==================== DateValidator ====================

export class DateValidator extends AbstractValidator<Date> {
  private after?: Date;
  private before?: Date;
  constructor() {
    super(ValueType.Date);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): Date {
    let d: Date;
    if (value instanceof Date) d = value;
    else if (typeof value === "string" || typeof value === "number")
      d = new Date(value);
    else {
      ctx.addIssue({
        path: p,
        message: "期望日期",
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "date",
        received: typeof value,
      });
      return new Date();
    }
    if (Number.isNaN(d.getTime()))
      ctx.addIssue({
        path: p,
        message: "无效的日期",
        code: ErrorCode.InvalidFormat,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
      });
    if (this.after && d <= this.after)
      ctx.addIssue({
        path: p,
        message: `日期必须晚于 ${this.after.toISOString()}`,
        code: ErrorCode.OutOfRange,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
      });
    if (this.before && d >= this.before)
      ctx.addIssue({
        path: p,
        message: `日期必须早于 ${this.before.toISOString()}`,
        code: ErrorCode.OutOfRange,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
      });
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

// ==================== ArrayValidator ====================

export class ArrayValidator<T> extends AbstractValidator<T[]> {
  private minN?: number;
  private maxN?: number;
  constructor(private item: AbstractValidator<T>) {
    super(ValueType.Array);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): T[] {
    if (!Array.isArray(value)) {
      ctx.addIssue({
        path: p,
        message: "期望数组",
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "array",
        received: typeof value,
      });
      return [];
    }
    if (this.minN !== undefined && value.length < this.minN)
      ctx.addIssue({
        path: p,
        message: `数组长度不能小于 ${this.minN}`,
        code: ErrorCode.LengthMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
      });
    if (this.maxN !== undefined && value.length > this.maxN)
      ctx.addIssue({
        path: p,
        message: `数组长度不能大于 ${this.maxN}`,
        code: ErrorCode.LengthMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
      });
    return value.map((v, i) => {
      const r = this.item.validate(v);
      for (const e of r.issues)
        ctx.addIssue({
          ...e,
          path: `${p ? p + "." : ""}[${i}]${e.path ? "." + e.path : ""}`,
        });
      return r.value;
    });
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

// ==================== ObjectValidator ====================

type Shape = Record<string, AbstractValidator<unknown>>;

export class ObjectValidator<T extends Shape> extends AbstractValidator<
  InferShape<T>
> {
  private strictMode = false;
  constructor(private shape: T) {
    super(ValueType.Object);
  }
  protected _parse(
    value: unknown,
    p: string,
    ctx: ValidationContext,
  ): InferShape<T> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      ctx.addIssue({
        path: p,
        message: "期望对象",
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: "object",
        received: typeof value,
      });
      return {} as InferShape<T>;
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      const r = schema.validate(obj[key]);
      for (const e of r.issues) {
        const sub = e.path
          ? `${p}${p ? "." : ""}${key}.${e.path}`
          : `${p}${p ? "." : ""}${key}`;
        ctx.addIssue({ ...e, path: sub });
      }
      out[key] = r.value;
    }
    if (this.strictMode) {
      for (const key of Object.keys(obj)) {
        if (!(key in this.shape))
          ctx.addIssue({
            path: p,
            message: `存在未声明的字段: ${key}`,
            code: ErrorCode.UnexpectedField,
            severity: Severity.Warning,
            phase: ValidationPhase.Finalize,
          });
      }
    }
    return out as InferShape<T>;
  }
  strict(): this {
    this.strictMode = true;
    return this;
  }
}

// ==================== AnyValidator / LiteralValidator ====================

export class AnyValidator extends AbstractValidator<unknown> {
  constructor() {
    super(ValueType.Any);
  }
  protected _parse(value: unknown): unknown {
    return value;
  }
}

export class LiteralValidator<
  T extends string | number | boolean,
> extends AbstractValidator<T> {
  constructor(private lit: T) {
    super(ValueType.Literal);
  }
  protected _parse(value: unknown, p: string, ctx: ValidationContext): T {
    if (value !== this.lit)
      ctx.addIssue({
        path: p,
        message: `期望字面量 ${JSON.stringify(this.lit)}`,
        code: ErrorCode.TypeMismatch,
        severity: Severity.Error,
        phase: ValidationPhase.Parse,
        expected: String(this.lit),
        received: String(value),
      });
    return value as T;
  }
}

// ==================== SchemaValidator (带约束的泛型容器) ====================

export class SchemaValidator<T extends Record<string, unknown>> {
  private [SCHEMA_REGISTRY] = new Map<string, AbstractValidator<unknown>>();
  private rootValidator: AbstractValidator<T>;
  constructor(root: AbstractValidator<T>) {
    this.rootValidator = root;
  }
  register<K extends string>(
    name: K,
    validator: AbstractValidator<unknown>,
  ): this {
    this[SCHEMA_REGISTRY].set(name, validator);
    return this;
  }
  get<K extends string>(name: K): AbstractValidator<unknown> | undefined {
    return this[SCHEMA_REGISTRY].get(name);
  }
  validate(data: unknown): ValidationResult<T> {
    return this.rootValidator.validate(data);
  }
  assert(data: unknown): T {
    return this.rootValidator.assert(data);
  }
  get root(): AbstractValidator<T> {
    return this.rootValidator;
  }
  /** 生成器: 遍历已注册的 schema 名称 */
  *registeredNames(): Generator<string> {
    for (const name of this[SCHEMA_REGISTRY].keys()) yield name;
  }
}

// ==================== 工厂 ====================

export const v = {
  string: () => new StringValidator(),
  number: () => new NumberValidator(),
  boolean: () => new BooleanValidator(),
  date: () => new DateValidator(),
  array: <T>(item: AbstractValidator<T>) => new ArrayValidator<T>(item),
  object: <T extends Shape>(shape: T) => new ObjectValidator<T>(shape),
  any: () => new AnyValidator(),
  union: <T, U>(a: AbstractValidator<T>, b: AbstractValidator<U>) =>
    new OrValidator(a, b),
  literal: <T extends string | number | boolean>(value: T) =>
    new LiteralValidator<T>(value),
  custom: <T>(fn: CustomValidator<T>): AbstractValidator<T> => {
    const s = new AnyValidator() as unknown as AbstractValidator<T>;
    return s.ref(fn);
  },
};

// ===================== CLI 演示 =====================

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

const userSchema = v
  .object({
    name: v.string().min(2).max(50),
    age: v.number().integer().min(0).max(150),
    email: v.string().email(),
    role: v.string().enum(["admin", "user", "guest"]),
    tags: v.array(v.string()).max(10),
  })
  .strict();

const pointSchema = v.object({ x: v.number(), y: v.number() });

const schemas: Record<string, AbstractValidator<unknown>> = {
  user: userSchema,
  point: pointSchema,
};

// 使用 SchemaValidator 容器演示
const registry = new SchemaValidator<Record<string, unknown>>(
  userSchema as AbstractValidator<Record<string, unknown>>,
);
registry.register("user", userSchema).register("point", pointSchema);

const PRESET_NAMES = ["user", "point"] as const satisfies readonly string[];

function examples(): void {
  console.log("===== 验证库示例 =====\n");

  const userObj = v.object({
    name: v.string().min(2, "姓名至少2个字符"),
    age: v.number().integer().positive(),
    email: v.string().email(),
    address: v
      .object({
        city: v.string(),
        zip: v.string().matches(/^\d{6}$/, "邮编必须是6位数字"),
      })
      .optional(),
    tags: v.array(v.string()).max(5),
    status: v.union(v.literal("active"), v.literal("inactive")),
  });

  const good = {
    name: "张三",
    age: 30,
    email: "zhangsan@example.com",
    address: { city: "北京", zip: "100000" },
    tags: ["dev", "admin"],
    status: "active",
  };
  const bad = {
    name: "A",
    age: -1,
    email: "not-an-email",
    address: { city: "上海", zip: "abc" },
    tags: Array(20).fill("x"),
    status: "unknown",
  };

  console.log("--- 合法数据 ---");
  const goodRes = userObj.validate(good);
  console.log(JSON.stringify(goodRes, null, 2));

  console.log("\n--- 非法数据 ---");
  const badRes = userObj.validate(bad);
  console.log(JSON.stringify(badRes, null, 2));

  // 使用生成器迭代 issues
  console.log("\n--- 迭代 badRes 的 issues (生成器) ---");
  for (const issue of iterateIssues(badRes))
    console.log(
      `  [${issue.code}] ${issue.path || "(root)"}: ${issue.message}`,
    );

  // 类型守卫演示
  console.log("\n--- 类型守卫 ---");
  if (isValidationSuccess(goodRes))
    console.log("goodRes 是成功结果, value.name =", goodRes.value.name);
  if (isValidationFailure(badRes))
    console.log("badRes 是失败结果, errorCode =", badRes.errorCode);

  // assert
  console.log("\n--- assert 用法 ---");
  try {
    const v1 = userObj.assert(good);
    console.log("assert 通过:", v1.name);
  } catch (e) {
    if (isValidationError(e))
      console.log("assert 失败 (code=" + e.code + "):", e.message);
    else console.log("assert 失败:", (e as Error).message);
  }

  // transform & default
  console.log("\n--- transform & default ---");
  const s = v
    .string()
    .default("hello")
    .transform((s) => s.toUpperCase());
  console.log(JSON.stringify(s.validate(undefined), null, 2));
  console.log(JSON.stringify(s.validate("world"), null, 2));

  // and / or / not
  console.log("\n--- and / or / not ---");
  const evenStr = v
    .string()
    .and(
      v.custom<string>((val) =>
        val.length % 2 === 0
          ? null
          : { path: "", message: "字符串长度必须为偶数" },
      ),
    );
  console.log('evenStr("ab"):', JSON.stringify(evenStr.validate("ab")));
  const numOrStr = v.union(v.number(), v.string());
  console.log("numOrStr(123):", JSON.stringify(numOrStr.validate(123)));
  console.log('numOrStr("x"):', JSON.stringify(numOrStr.validate("x")));
  console.log(
    'notNumber("x"):',
    JSON.stringify(v.number().not().validate("x")),
  );

  // coerce 函数重载演示
  console.log("\n--- coerce (函数重载) ---");
  const n: number = coerce("42", "number");
  const b: boolean = coerce("true", "boolean");
  const d: Date = coerce("2024-01-01", "date");
  console.log(`coerce('42','number') =`, n);
  console.log(`coerce('true','boolean') =`, b);
  console.log(`coerce('2024-01-01','date') =`, d.toISOString());

  // SchemaValidator 容器演示
  console.log("\n--- SchemaValidator 容器 ---");
  console.log("已注册 schema:", [...registry.registeredNames()]);
  console.log(
    "registry.validate(good).success =",
    registry.validate(good).success,
  );

  // getter/setter 演示
  console.log("\n--- getter/setter ---");
  const labeled = v.string().min(3);
  labeled.label = "username";
  console.log(
    `label = ${labeled.label}, valueType = ${labeled.valueType}, isOptional = ${labeled.isOptional}`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "validate": {
      const schemaName = process.argv[3];
      const dataFile = process.argv[4];
      if (!schemaName || !dataFile) {
        console.log("用法: validate <preset> <data.json>");
        return;
      }
      const schema = schemas[schemaName];
      if (!schema) {
        console.log(
          `未知 schema: ${schemaName}, 可用: ${PRESET_NAMES.join(", ")}`,
        );
        return;
      }
      const result = schema.validate(readJsonFile(dataFile));
      console.log("验证结果:");
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }
    case "interactive": {
      console.log("===== 交互式验证 (使用内置 user schema) =====");
      console.log("内置 schema: user, point");
      console.log("请在控制台输入 JSON 数据 (输入 EOF 结束):\n");
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const data = await new Promise<string>((resolve) => {
        let buf = "";
        rl.on("line", (line) => (buf += line + "\n"));
        rl.on("close", () => resolve(buf));
      });
      try {
        console.log(
          JSON.stringify(schemas.user.validate(JSON.parse(data)), null, 2),
        );
      } catch (e) {
        console.log("JSON 解析失败:", (e as Error).message);
      }
      break;
    }
    case "examples":
      examples();
      break;
    default:
      console.log(`
数据验证库 - 命令行演示

用法:
  validate <preset> <data.json>    验证数据文件
  interactive                      从标准输入读取 JSON 并验证
  examples                         展示示例

可用 preset schema: ${PRESET_NAMES.join(", ")}

示例:
  examples
  validate user ./data.json
`);
  }
}

main();
