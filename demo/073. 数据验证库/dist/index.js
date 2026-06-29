#!/usr/bin/env node
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.v = exports.SchemaValidator = exports.LiteralValidator = exports.AnyValidator = exports.ObjectValidator = exports.ArrayValidator = exports.DateValidator = exports.BooleanValidator = exports.NumberValidator = exports.StringValidator = exports.AbstractValidator = exports.SchemaError = exports.ValidationError = exports.Severity = exports.ValidationPhase = exports.ErrorCode = exports.ValueType = void 0;
exports.isValidationSuccess = isValidationSuccess;
exports.isValidationFailure = isValidationFailure;
exports.isString = isString;
exports.isNumber = isNumber;
exports.isBoolean = isBoolean;
exports.isObject = isObject;
exports.isValidationError = isValidationError;
exports.coerce = coerce;
exports.iterateIssues = iterateIssues;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ==================== 枚举 Enums ====================
var ValueType;
(function (ValueType) {
    ValueType["String"] = "string";
    ValueType["Number"] = "number";
    ValueType["Boolean"] = "boolean";
    ValueType["Array"] = "array";
    ValueType["Object"] = "object";
    ValueType["Date"] = "date";
    ValueType["Any"] = "any";
    ValueType["Literal"] = "literal";
    ValueType["Union"] = "union";
})(ValueType || (exports.ValueType = ValueType = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["TypeMismatch"] = "TYPE_MISMATCH";
    ErrorCode["OutOfRange"] = "OUT_OF_RANGE";
    ErrorCode["InvalidFormat"] = "INVALID_FORMAT";
    ErrorCode["MissingRequired"] = "MISSING_REQUIRED";
    ErrorCode["UnexpectedField"] = "UNEXPECTED_FIELD";
    ErrorCode["CustomFailure"] = "CUSTOM_FAILURE";
    ErrorCode["LengthMismatch"] = "LENGTH_MISMATCH";
    ErrorCode["ParseError"] = "PARSE_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
var ValidationPhase;
(function (ValidationPhase) {
    ValidationPhase["Parse"] = "parse";
    ValidationPhase["Transform"] = "transform";
    ValidationPhase["Custom"] = "custom";
    ValidationPhase["Finalize"] = "finalize";
})(ValidationPhase || (exports.ValidationPhase = ValidationPhase = {}));
var Severity;
(function (Severity) {
    Severity["Error"] = "error";
    Severity["Warning"] = "warning";
    Severity["Info"] = "info";
})(Severity || (exports.Severity = Severity = {}));
// ==================== Symbols (唯一属性键) ====================
const VALIDATOR_TYPE = Symbol('validatorType');
const SCHEMA_REGISTRY = Symbol('schemaRegistry');
// ==================== 自定义错误层级 ====================
/** 验证错误: 继承 Error, 带 code 属性, 可迭代 issues */
class ValidationError extends Error {
    constructor(message, opts) {
        super(message);
        this.name = 'ValidationError';
        this.code = opts?.code ?? ErrorCode.CustomFailure;
        this.issues = opts?.issues ?? [];
        this.path = opts?.path ?? '';
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
    /** 迭代器: 遍历所有 issue */
    *[Symbol.iterator]() { for (const issue of this.issues)
        yield issue; }
}
exports.ValidationError = ValidationError;
class SchemaError extends ValidationError {
    constructor(message, opts) {
        super(message, opts);
        this.name = 'SchemaError';
        Object.setPrototypeOf(this, SchemaError.prototype);
    }
}
exports.SchemaError = SchemaError;
// ==================== 类型守卫 ====================
function isValidationSuccess(r) { return r.success === true; }
function isValidationFailure(r) { return r.success === false; }
function isString(value) { return typeof value === 'string'; }
function isNumber(value) { return typeof value === 'number' && !Number.isNaN(value); }
function isBoolean(value) { return typeof value === 'boolean'; }
function isObject(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isValidationError(err) { return err instanceof Error && err.code !== undefined; }
function coerce(value, type) {
    switch (type) {
        case 'number':
        case ValueType.Number: {
            const n = Number(value);
            return Number.isNaN(n) ? 0 : n;
        }
        case 'boolean':
        case ValueType.Boolean: return Boolean(value);
        case 'date':
        case ValueType.Date: return new Date(value);
        default: return value;
    }
}
// ==================== 生成器辅助 ====================
/** 生成器: 按顺序产出 warnings 然后 issues */
function* iterateIssues(result) {
    for (const w of result.warnings)
        yield w;
    for (const i of result.issues)
        yield i;
}
const DEFAULT_OPTIONS = { optional: false, nullable: false, hasDefault: false, defaultValue: undefined };
class AbstractValidator {
    constructor(type) {
        this.options = { ...DEFAULT_OPTIONS };
        // 使用 any 元素类型以避免 T 的不变性 (invariance), 使子类可赋值给 AbstractValidator<unknown>
        this.transforms = [];
        this.customs = [];
        this[VALIDATOR_TYPE] = type;
        this._id = Math.floor(Math.random() * 1e9);
    }
    // ---- getter / setter ----
    get label() { return this._label; }
    set label(val) {
        if (val !== undefined && typeof val !== 'string')
            throw new TypeError('label 必须为字符串');
        this._label = val;
    }
    get id() { return this._id; }
    get valueType() { return this[VALIDATOR_TYPE]; }
    get isOptional() { return this.options.optional; }
    get isNullable() { return this.options.nullable; }
    /** 验证入口 */
    validate(input) {
        const issues = [];
        const warnings = [];
        let nextId = 1;
        const ctx = {
            root: input, issues, warnings,
            addIssue(i) { issues.push({ ...i, id: nextId++, timestamp: Date.now() }); },
            addWarning(i) { warnings.push({ ...i, id: nextId++, timestamp: Date.now() }); },
        };
        let value = input;
        if (value === undefined) {
            if (this.options.hasDefault)
                value = this.options.defaultValue;
            else if (this.options.optional)
                return { success: true, kind: 'success', value: undefined, issues, warnings };
            else {
                ctx.addIssue({ path: '', message: '值不能为 undefined', code: ErrorCode.MissingRequired, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'defined', received: 'undefined' });
                return { success: false, kind: 'failure', value: undefined, issues, warnings, errorCode: ErrorCode.MissingRequired };
            }
        }
        if (value === null) {
            if (this.options.nullable)
                return { success: true, kind: 'success', value: null, issues, warnings };
            ctx.addIssue({ path: '', message: '值不能为 null', code: ErrorCode.MissingRequired, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'non-null', received: 'null' });
            return { success: false, kind: 'failure', value: null, issues, warnings, errorCode: ErrorCode.MissingRequired };
        }
        let parsed;
        try {
            parsed = this._parse(value, '', ctx);
        }
        catch (err) {
            ctx.addIssue({ path: '', message: `解析异常: ${err.message}`, code: ErrorCode.ParseError, severity: Severity.Error, phase: ValidationPhase.Parse });
            return { success: false, kind: 'failure', value: undefined, issues, warnings, errorCode: ErrorCode.ParseError };
        }
        for (const fn of this.customs) {
            const e = fn(parsed, ctx);
            if (e)
                ctx.addIssue({ path: e.path, message: e.message, code: e.code ?? ErrorCode.CustomFailure, severity: e.severity ?? Severity.Error, phase: e.phase ?? ValidationPhase.Custom, expected: e.expected, received: e.received });
        }
        for (const t of this.transforms)
            parsed = t(parsed);
        if (issues.length > 0)
            return { success: false, kind: 'failure', value: parsed, issues, warnings, errorCode: issues[0].code };
        return { success: true, kind: 'success', value: parsed, issues, warnings };
    }
    assert(input) {
        const r = this.validate(input);
        if (!r.success)
            throw new ValidationError(`验证失败: ${r.issues.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ')}`, { code: r.errorCode, issues: [...r.issues], path: '' });
        return r.value;
    }
    check(input) { return this.validate(input).success; }
    optional() { this.options.optional = true; return this; }
    nullable() { this.options.nullable = true; return this; }
    default(value) { this.options.hasDefault = true; this.options.defaultValue = value; return this; }
    transform(fn) { this.transforms.push(fn); return this; }
    ref(fn) { this.customs.push(fn); return this; }
    and(other) { return new AndValidator(this, other); }
    or(other) { return new OrValidator(this, other); }
    not() { return new NotValidator(this); }
}
exports.AbstractValidator = AbstractValidator;
// ==================== 复合校验器 ====================
class AndValidator extends AbstractValidator {
    constructor(a, b) {
        super(ValueType.Union);
        this.a = a;
        this.b = b;
    }
    _parse(value, p, ctx) {
        const ra = this.a.validate(value);
        for (const e of ra.issues)
            ctx.addIssue({ ...e, path: p + (e.path ? '.' + e.path : '') });
        const rb = this.b.validate(value);
        for (const e of rb.issues)
            ctx.addIssue({ ...e, path: p + (e.path ? '.' + e.path : '') });
        return { ...ra.value, ...rb.value };
    }
}
class OrValidator extends AbstractValidator {
    constructor(a, b) {
        super(ValueType.Union);
        this.a = a;
        this.b = b;
    }
    _parse(value, p, ctx) {
        const ra = this.a.validate(value);
        if (ra.success)
            return ra.value;
        const rb = this.b.validate(value);
        if (rb.success)
            return rb.value;
        ctx.addIssue({ path: p, message: '所有联合类型均验证失败', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'union match', received: typeof value });
        return value;
    }
}
class NotValidator extends AbstractValidator {
    constructor(a) {
        super(ValueType.Union);
        this.a = a;
    }
    _parse(value, p, ctx) {
        const r = this.a.validate(value);
        if (r.success)
            ctx.addIssue({ path: p, message: '值不应匹配该 schema', code: ErrorCode.CustomFailure, severity: Severity.Error, phase: ValidationPhase.Custom, expected: 'not match', received: typeof value });
        return value;
    }
}
class StringValidator extends AbstractValidator {
    constructor() {
        super(ValueType.String);
        this.rules = [];
    }
    _parse(value, p, ctx) {
        if (typeof value !== 'string') {
            ctx.addIssue({ path: p, message: '期望字符串', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'string', received: typeof value });
            return String(value);
        }
        for (const rule of this.rules) {
            if (rule.kind === 'min' && value.length < (rule.n ?? 0))
                ctx.addIssue({ path: p, message: rule.msg ?? `长度不能小于 ${rule.n}`, code: ErrorCode.LengthMismatch, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'max' && value.length > (rule.n ?? Infinity))
                ctx.addIssue({ path: p, message: rule.msg ?? `长度不能大于 ${rule.n}`, code: ErrorCode.LengthMismatch, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'length' && value.length !== (rule.n ?? -1))
                ctx.addIssue({ path: p, message: rule.msg ?? `长度必须为 ${rule.n}`, code: ErrorCode.LengthMismatch, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'pattern' && rule.re && !rule.re.test(value))
                ctx.addIssue({ path: p, message: rule.msg ?? `不匹配模式 ${rule.re}`, code: ErrorCode.InvalidFormat, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'enum' && rule.values && !rule.values.includes(value))
                ctx.addIssue({ path: p, message: rule.msg ?? `值必须是 ${rule.values.join(', ')} 之一`, code: ErrorCode.OutOfRange, severity: Severity.Error, phase: ValidationPhase.Parse });
        }
        return value;
    }
    min(n, msg) { this.rules.push({ kind: 'min', n, msg }); return this; }
    max(n, msg) { this.rules.push({ kind: 'max', n, msg }); return this; }
    length(n, msg) { this.rules.push({ kind: 'length', n, msg }); return this; }
    matches(re, msg) { this.rules.push({ kind: 'pattern', re, msg }); return this; }
    email(msg) { return this.matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg ?? '无效的邮箱格式'); }
    url(msg) { return this.matches(/^https?:\/\/.+/, msg ?? '无效的 URL 格式'); }
    enum(values, msg) { this.rules.push({ kind: 'enum', values, msg }); return this; }
}
exports.StringValidator = StringValidator;
class NumberValidator extends AbstractValidator {
    constructor() {
        super(ValueType.Number);
        this.rules = [];
    }
    _parse(value, p, ctx) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            ctx.addIssue({ path: p, message: '期望数字', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'number', received: typeof value });
            return 0;
        }
        for (const rule of this.rules) {
            if (rule.kind === 'integer' && !Number.isInteger(value))
                ctx.addIssue({ path: p, message: rule.msg ?? '期望整数', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'positive' && value <= 0)
                ctx.addIssue({ path: p, message: rule.msg ?? '必须为正数', code: ErrorCode.OutOfRange, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'min' && value < (rule.n ?? -Infinity))
                ctx.addIssue({ path: p, message: rule.msg ?? `不能小于 ${rule.n}`, code: ErrorCode.OutOfRange, severity: Severity.Error, phase: ValidationPhase.Parse });
            else if (rule.kind === 'max' && value > (rule.n ?? Infinity))
                ctx.addIssue({ path: p, message: rule.msg ?? `不能大于 ${rule.n}`, code: ErrorCode.OutOfRange, severity: Severity.Error, phase: ValidationPhase.Parse });
        }
        return value;
    }
    min(n, msg) { this.rules.push({ kind: 'min', n, msg }); return this; }
    max(n, msg) { this.rules.push({ kind: 'max', n, msg }); return this; }
    integer(msg) { this.rules.push({ kind: 'integer', msg }); return this; }
    positive(msg) { this.rules.push({ kind: 'positive', msg }); return this; }
}
exports.NumberValidator = NumberValidator;
// ==================== BooleanValidator ====================
class BooleanValidator extends AbstractValidator {
    constructor() { super(ValueType.Boolean); }
    _parse(value, p, ctx) {
        if (typeof value !== 'boolean') {
            ctx.addIssue({ path: p, message: '期望布尔值', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'boolean', received: typeof value });
            return Boolean(value);
        }
        return value;
    }
}
exports.BooleanValidator = BooleanValidator;
// ==================== DateValidator ====================
class DateValidator extends AbstractValidator {
    constructor() { super(ValueType.Date); }
    _parse(value, p, ctx) {
        let d;
        if (value instanceof Date)
            d = value;
        else if (typeof value === 'string' || typeof value === 'number')
            d = new Date(value);
        else {
            ctx.addIssue({ path: p, message: '期望日期', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'date', received: typeof value });
            return new Date();
        }
        if (Number.isNaN(d.getTime()))
            ctx.addIssue({ path: p, message: '无效的日期', code: ErrorCode.InvalidFormat, severity: Severity.Error, phase: ValidationPhase.Parse });
        if (this.after && d <= this.after)
            ctx.addIssue({ path: p, message: `日期必须晚于 ${this.after.toISOString()}`, code: ErrorCode.OutOfRange, severity: Severity.Error, phase: ValidationPhase.Parse });
        if (this.before && d >= this.before)
            ctx.addIssue({ path: p, message: `日期必须早于 ${this.before.toISOString()}`, code: ErrorCode.OutOfRange, severity: Severity.Error, phase: ValidationPhase.Parse });
        return d;
    }
    minDate(d) { this.after = d; return this; }
    maxDate(d) { this.before = d; return this; }
}
exports.DateValidator = DateValidator;
// ==================== ArrayValidator ====================
class ArrayValidator extends AbstractValidator {
    constructor(item) {
        super(ValueType.Array);
        this.item = item;
    }
    _parse(value, p, ctx) {
        if (!Array.isArray(value)) {
            ctx.addIssue({ path: p, message: '期望数组', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'array', received: typeof value });
            return [];
        }
        if (this.minN !== undefined && value.length < this.minN)
            ctx.addIssue({ path: p, message: `数组长度不能小于 ${this.minN}`, code: ErrorCode.LengthMismatch, severity: Severity.Error, phase: ValidationPhase.Parse });
        if (this.maxN !== undefined && value.length > this.maxN)
            ctx.addIssue({ path: p, message: `数组长度不能大于 ${this.maxN}`, code: ErrorCode.LengthMismatch, severity: Severity.Error, phase: ValidationPhase.Parse });
        return value.map((v, i) => {
            const r = this.item.validate(v);
            for (const e of r.issues)
                ctx.addIssue({ ...e, path: `${p ? p + '.' : ''}[${i}]${e.path ? '.' + e.path : ''}` });
            return r.value;
        });
    }
    min(n) { this.minN = n; return this; }
    max(n) { this.maxN = n; return this; }
}
exports.ArrayValidator = ArrayValidator;
class ObjectValidator extends AbstractValidator {
    constructor(shape) {
        super(ValueType.Object);
        this.shape = shape;
        this.strictMode = false;
    }
    _parse(value, p, ctx) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            ctx.addIssue({ path: p, message: '期望对象', code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: 'object', received: typeof value });
            return {};
        }
        const obj = value;
        const out = {};
        for (const [key, schema] of Object.entries(this.shape)) {
            const r = schema.validate(obj[key]);
            for (const e of r.issues) {
                const sub = e.path ? `${p}${p ? '.' : ''}${key}.${e.path}` : `${p}${p ? '.' : ''}${key}`;
                ctx.addIssue({ ...e, path: sub });
            }
            out[key] = r.value;
        }
        if (this.strictMode) {
            for (const key of Object.keys(obj)) {
                if (!(key in this.shape))
                    ctx.addIssue({ path: p, message: `存在未声明的字段: ${key}`, code: ErrorCode.UnexpectedField, severity: Severity.Warning, phase: ValidationPhase.Finalize });
            }
        }
        return out;
    }
    strict() { this.strictMode = true; return this; }
}
exports.ObjectValidator = ObjectValidator;
// ==================== AnyValidator / LiteralValidator ====================
class AnyValidator extends AbstractValidator {
    constructor() { super(ValueType.Any); }
    _parse(value) { return value; }
}
exports.AnyValidator = AnyValidator;
class LiteralValidator extends AbstractValidator {
    constructor(lit) {
        super(ValueType.Literal);
        this.lit = lit;
    }
    _parse(value, p, ctx) {
        if (value !== this.lit)
            ctx.addIssue({ path: p, message: `期望字面量 ${JSON.stringify(this.lit)}`, code: ErrorCode.TypeMismatch, severity: Severity.Error, phase: ValidationPhase.Parse, expected: String(this.lit), received: String(value) });
        return value;
    }
}
exports.LiteralValidator = LiteralValidator;
// ==================== SchemaValidator (带约束的泛型容器) ====================
class SchemaValidator {
    constructor(root) {
        this[_a] = new Map();
        this.rootValidator = root;
    }
    register(name, validator) { this[SCHEMA_REGISTRY].set(name, validator); return this; }
    get(name) { return this[SCHEMA_REGISTRY].get(name); }
    validate(data) { return this.rootValidator.validate(data); }
    assert(data) { return this.rootValidator.assert(data); }
    get root() { return this.rootValidator; }
    /** 生成器: 遍历已注册的 schema 名称 */
    *registeredNames() { for (const name of this[SCHEMA_REGISTRY].keys())
        yield name; }
}
exports.SchemaValidator = SchemaValidator;
_a = SCHEMA_REGISTRY;
// ==================== 工厂 ====================
exports.v = {
    string: () => new StringValidator(),
    number: () => new NumberValidator(),
    boolean: () => new BooleanValidator(),
    date: () => new DateValidator(),
    array: (item) => new ArrayValidator(item),
    object: (shape) => new ObjectValidator(shape),
    any: () => new AnyValidator(),
    union: (a, b) => new OrValidator(a, b),
    literal: (value) => new LiteralValidator(value),
    custom: (fn) => {
        const s = new AnyValidator();
        return s.ref(fn);
    },
};
// ===================== CLI 演示 =====================
function readJsonFile(file) {
    return JSON.parse(fs_1.default.readFileSync(path_1.default.resolve(file), 'utf8'));
}
const userSchema = exports.v.object({
    name: exports.v.string().min(2).max(50),
    age: exports.v.number().integer().min(0).max(150),
    email: exports.v.string().email(),
    role: exports.v.string().enum(['admin', 'user', 'guest']),
    tags: exports.v.array(exports.v.string()).max(10),
}).strict();
const pointSchema = exports.v.object({ x: exports.v.number(), y: exports.v.number() });
const schemas = { user: userSchema, point: pointSchema };
// 使用 SchemaValidator 容器演示
const registry = new SchemaValidator(userSchema);
registry.register('user', userSchema).register('point', pointSchema);
const PRESET_NAMES = ['user', 'point'];
function examples() {
    console.log('===== 验证库示例 =====\n');
    const userObj = exports.v.object({
        name: exports.v.string().min(2, '姓名至少2个字符'),
        age: exports.v.number().integer().positive(),
        email: exports.v.string().email(),
        address: exports.v.object({ city: exports.v.string(), zip: exports.v.string().matches(/^\d{6}$/, '邮编必须是6位数字') }).optional(),
        tags: exports.v.array(exports.v.string()).max(5),
        status: exports.v.union(exports.v.literal('active'), exports.v.literal('inactive')),
    });
    const good = { name: '张三', age: 30, email: 'zhangsan@example.com', address: { city: '北京', zip: '100000' }, tags: ['dev', 'admin'], status: 'active' };
    const bad = { name: 'A', age: -1, email: 'not-an-email', address: { city: '上海', zip: 'abc' }, tags: Array(20).fill('x'), status: 'unknown' };
    console.log('--- 合法数据 ---');
    const goodRes = userObj.validate(good);
    console.log(JSON.stringify(goodRes, null, 2));
    console.log('\n--- 非法数据 ---');
    const badRes = userObj.validate(bad);
    console.log(JSON.stringify(badRes, null, 2));
    // 使用生成器迭代 issues
    console.log('\n--- 迭代 badRes 的 issues (生成器) ---');
    for (const issue of iterateIssues(badRes))
        console.log(`  [${issue.code}] ${issue.path || '(root)'}: ${issue.message}`);
    // 类型守卫演示
    console.log('\n--- 类型守卫 ---');
    if (isValidationSuccess(goodRes))
        console.log('goodRes 是成功结果, value.name =', goodRes.value.name);
    if (isValidationFailure(badRes))
        console.log('badRes 是失败结果, errorCode =', badRes.errorCode);
    // assert
    console.log('\n--- assert 用法 ---');
    try {
        const v1 = userObj.assert(good);
        console.log('assert 通过:', v1.name);
    }
    catch (e) {
        if (isValidationError(e))
            console.log('assert 失败 (code=' + e.code + '):', e.message);
        else
            console.log('assert 失败:', e.message);
    }
    // transform & default
    console.log('\n--- transform & default ---');
    const s = exports.v.string().default('hello').transform((s) => s.toUpperCase());
    console.log(JSON.stringify(s.validate(undefined), null, 2));
    console.log(JSON.stringify(s.validate('world'), null, 2));
    // and / or / not
    console.log('\n--- and / or / not ---');
    const evenStr = exports.v.string().and(exports.v.custom((val) => (val.length % 2 === 0 ? null : { path: '', message: '字符串长度必须为偶数' })));
    console.log('evenStr("ab"):', JSON.stringify(evenStr.validate('ab')));
    const numOrStr = exports.v.union(exports.v.number(), exports.v.string());
    console.log('numOrStr(123):', JSON.stringify(numOrStr.validate(123)));
    console.log('numOrStr("x"):', JSON.stringify(numOrStr.validate('x')));
    console.log('notNumber("x"):', JSON.stringify(exports.v.number().not().validate('x')));
    // coerce 函数重载演示
    console.log('\n--- coerce (函数重载) ---');
    const n = coerce('42', 'number');
    const b = coerce('true', 'boolean');
    const d = coerce('2024-01-01', 'date');
    console.log(`coerce('42','number') =`, n);
    console.log(`coerce('true','boolean') =`, b);
    console.log(`coerce('2024-01-01','date') =`, d.toISOString());
    // SchemaValidator 容器演示
    console.log('\n--- SchemaValidator 容器 ---');
    console.log('已注册 schema:', [...registry.registeredNames()]);
    console.log('registry.validate(good).success =', registry.validate(good).success);
    // getter/setter 演示
    console.log('\n--- getter/setter ---');
    const labeled = exports.v.string().min(3);
    labeled.label = 'username';
    console.log(`label = ${labeled.label}, valueType = ${labeled.valueType}, isOptional = ${labeled.isOptional}`);
}
async function main() {
    const cmd = process.argv[2];
    switch (cmd) {
        case 'validate': {
            const schemaName = process.argv[3];
            const dataFile = process.argv[4];
            if (!schemaName || !dataFile) {
                console.log('用法: validate <preset> <data.json>');
                return;
            }
            const schema = schemas[schemaName];
            if (!schema) {
                console.log(`未知 schema: ${schemaName}, 可用: ${PRESET_NAMES.join(', ')}`);
                return;
            }
            const result = schema.validate(readJsonFile(dataFile));
            console.log('验证结果:');
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        }
        case 'interactive': {
            console.log('===== 交互式验证 (使用内置 user schema) =====');
            console.log('内置 schema: user, point');
            console.log('请在控制台输入 JSON 数据 (输入 EOF 结束):\n');
            const readline = await Promise.resolve().then(() => __importStar(require('readline')));
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const data = await new Promise((resolve) => {
                let buf = '';
                rl.on('line', (line) => (buf += line + '\n'));
                rl.on('close', () => resolve(buf));
            });
            try {
                console.log(JSON.stringify(schemas.user.validate(JSON.parse(data)), null, 2));
            }
            catch (e) {
                console.log('JSON 解析失败:', e.message);
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
  validate <preset> <data.json>    验证数据文件
  interactive                      从标准输入读取 JSON 并验证
  examples                         展示示例

可用 preset schema: ${PRESET_NAMES.join(', ')}

示例:
  examples
  validate user ./data.json
`);
    }
}
main();
//# sourceMappingURL=index.js.map