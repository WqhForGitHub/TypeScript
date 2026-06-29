"use strict";
/* ============================== 核心类型定义 ============================== */
/*
 * 本文件集中定义插件系统的核心类型，演示以下高级 TypeScript 特性：
 *   1. 字符串枚举 (string enum)
 *   2. 判别联合 (discriminated union) —— 以 type / kind 字段区分
 *   3. 条件类型 (conditional type)
 *   4. 映射类型 (mapped type，含 -readonly)
 *   5. 元组与只读元组 (tuple / readonly tuple)
 *   6. 接口的 optional / readonly / index signature
 *   7. Symbol 作为唯一属性键
 *   8. 类型守卫 (type guard)
 *   9. 泛型与约束 (generics with constraints)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_BUS_VERSION = exports.PLUGIN_INTERNAL = exports.ResultKind = exports.CommandKind = exports.PluginStatus = exports.LogLevel = exports.HookType = void 0;
exports.isBeforeCommandPayload = isBeforeCommandPayload;
exports.isAfterCommandPayload = isAfterCommandPayload;
exports.isOnInitPayload = isOnInitPayload;
exports.isOnDestroyPayload = isOnDestroyPayload;
exports.isOnErrorPayload = isOnErrorPayload;
exports.isSuccessResult = isSuccessResult;
exports.isErrorResult = isErrorResult;
exports.isNotFoundResult = isNotFoundResult;
exports.isPluginEntry = isPluginEntry;
exports.isBuiltinEntry = isBuiltinEntry;
exports.isDefined = isDefined;
exports.isPlugin = isPlugin;
exports.isEnumMember = isEnumMember;
exports.describePayload = describePayload;
exports.describeResult = describeResult;
/* ---------------------------- 字符串枚举 ---------------------------- */
/** 钩子类型 (string enum) */
var HookType;
(function (HookType) {
    HookType["BeforeCommand"] = "beforeCommand";
    HookType["AfterCommand"] = "afterCommand";
    HookType["OnInit"] = "onInit";
    HookType["OnDestroy"] = "onDestroy";
    HookType["OnError"] = "onError";
})(HookType || (exports.HookType = HookType = {}));
/** 日志级别 (string enum) */
var LogLevel;
(function (LogLevel) {
    LogLevel["Info"] = "info";
    LogLevel["Warn"] = "warn";
    LogLevel["Error"] = "error";
    LogLevel["Debug"] = "debug";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/** 插件生命周期状态 (string enum) */
var PluginStatus;
(function (PluginStatus) {
    PluginStatus["Registered"] = "registered";
    PluginStatus["Initialized"] = "initialized";
    PluginStatus["Destroyed"] = "destroyed";
})(PluginStatus || (exports.PluginStatus = PluginStatus = {}));
/** 命令来源分类 (string enum，用作判别联合 tag) */
var CommandKind;
(function (CommandKind) {
    CommandKind["Builtin"] = "builtin";
    CommandKind["Plugin"] = "plugin";
})(CommandKind || (exports.CommandKind = CommandKind = {}));
/** 命令执行结果分类 (string enum，用作判别联合 tag) */
var ResultKind;
(function (ResultKind) {
    ResultKind["Success"] = "success";
    ResultKind["Error"] = "error";
    ResultKind["NotFound"] = "notfound";
})(ResultKind || (exports.ResultKind = ResultKind = {}));
/* ---------------------------- Symbol 唯一键 ---------------------------- */
/** 插件内部状态 symbol 键 (unique symbol) */
exports.PLUGIN_INTERNAL = Symbol('pluginInternal');
/** 事件总线内部 symbol 键 (unique symbol) */
exports.EVENT_BUS_VERSION = Symbol('eventBusVersion');
/* ---------------------------- 类型守卫 ---------------------------- */
function isBeforeCommandPayload(p) {
    return p.type === HookType.BeforeCommand;
}
function isAfterCommandPayload(p) {
    return p.type === HookType.AfterCommand;
}
function isOnInitPayload(p) {
    return p.type === HookType.OnInit;
}
function isOnDestroyPayload(p) {
    return p.type === HookType.OnDestroy;
}
function isOnErrorPayload(p) {
    return p.type === HookType.OnError;
}
function isSuccessResult(r) {
    return r.kind === ResultKind.Success;
}
function isErrorResult(r) {
    return r.kind === ResultKind.Error;
}
function isNotFoundResult(r) {
    return r.kind === ResultKind.NotFound;
}
function isPluginEntry(e) {
    return e.kind === CommandKind.Plugin;
}
function isBuiltinEntry(e) {
    return e.kind === CommandKind.Builtin;
}
/** 通用非空类型守卫 (泛型 + 约束) */
function isDefined(value) {
    return value !== undefined && value !== null;
}
/** 判断对象是否为 Plugin (类型守卫) */
function isPlugin(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.meta === 'object' &&
        candidate.meta !== null &&
        typeof candidate.meta.name === 'string' &&
        typeof candidate.init === 'function');
}
/** 判断值是否为指定枚举成员 (泛型类型守卫) */
function isEnumMember(value, enumObj) {
    return Object.values(enumObj).includes(value);
}
/* ---------------------------- 工具: describe payload ---------------------------- */
/** 使用类型守卫将载荷转换为可读字符串 (演示判别联合的窄化) */
function describePayload(payload) {
    if (isBeforeCommandPayload(payload)) {
        const argsStr = payload.args.positional.join(' ');
        return `beforeCommand(${payload.command}${argsStr ? ' ' + argsStr : ''})`;
    }
    if (isAfterCommandPayload(payload)) {
        return `afterCommand(${payload.command})`;
    }
    if (isOnInitPayload(payload)) {
        return 'onInit';
    }
    if (isOnDestroyPayload(payload)) {
        return 'onDestroy';
    }
    if (isOnErrorPayload(payload)) {
        return `onError(${payload.error.message})`;
    }
    return 'unknown';
}
/** 使用类型守卫将命令结果转换为可读字符串 */
function describeResult(result) {
    if (isSuccessResult(result)) {
        return `success(${result.command})`;
    }
    if (isErrorResult(result)) {
        return `error(${result.command}: ${result.error.message})`;
    }
    if (isNotFoundResult(result)) {
        return `notfound(${result.command})`;
    }
    return 'unknown';
}
//# sourceMappingURL=types.js.map