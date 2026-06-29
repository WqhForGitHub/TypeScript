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

/* ---------------------------- 字符串枚举 ---------------------------- */

/** 钩子类型 (string enum) */
export enum HookType {
  BeforeCommand = "beforeCommand",
  AfterCommand = "afterCommand",
  OnInit = "onInit",
  OnDestroy = "onDestroy",
  OnError = "onError",
}

/** 日志级别 (string enum) */
export enum LogLevel {
  Info = "info",
  Warn = "warn",
  Error = "error",
  Debug = "debug",
}

/** 插件生命周期状态 (string enum) */
export enum PluginStatus {
  Registered = "registered",
  Initialized = "initialized",
  Destroyed = "destroyed",
}

/** 命令来源分类 (string enum，用作判别联合 tag) */
export enum CommandKind {
  Builtin = "builtin",
  Plugin = "plugin",
}

/** 命令执行结果分类 (string enum，用作判别联合 tag) */
export enum ResultKind {
  Success = "success",
  Error = "error",
  NotFound = "notfound",
}

/* ---------------------- 接口: optional/readonly/index ---------------------- */

/** 命令参数 (readonly 字段 + readonly 数组) */
export interface CommandArgs {
  /** 位置参数 (只读数组) */
  readonly positional: readonly string[];
  /** 命名参数 / 选项 (只读 record，等价于 index signature) */
  readonly options: Readonly<Record<string, string | boolean>>;
}

/** 命令定义 */
export interface Command {
  /** 命令名称 */
  readonly name: string;
  /** 命令别名 (只读数组) */
  readonly aliases?: readonly string[];
  /** 命令描述 */
  readonly description: string;
  /** 用法说明 (可选) */
  readonly usage?: string;
  /** 命令处理函数 */
  readonly handler: (
    args: CommandArgs,
    context: PluginContext,
  ) => void | Promise<void>;
}

/** 插件元信息 (含可选字段 + readonly + index signature) */
export interface PluginMeta {
  /** 插件名称 (唯一标识) */
  readonly name: string;
  /** 插件版本 */
  readonly version: string;
  /** 插件描述 */
  readonly description: string;
  /** 依赖的其他插件 (可选, 只读数组) */
  readonly dependencies?: readonly string[];
  /** 作者 (可选) */
  readonly author?: string;
  /** 额外元数据 (index signature) */
  readonly [key: string]: unknown;
}

/** 日志接口 */
export interface Logger {
  readonly info: (msg: string) => void;
  readonly warn: (msg: string) => void;
  readonly error: (msg: string) => void;
  readonly debug: (msg: string) => void;
}

/** 事件处理函数 */
export type EventHandler = (data?: unknown) => void;

/** 插件上下文 - 插件与宿主交互的接口 */
export interface PluginContext {
  readonly registerCommand: (command: Command) => void;
  readonly registerHook: (type: HookType, callback: HookCallback) => void;
  readonly emit: (event: string, data?: unknown) => void;
  readonly on: (event: string, handler: EventHandler) => void;
  readonly once: (event: string, handler: EventHandler) => void;
  readonly getPlugin: (name: string) => Plugin | undefined;
  readonly write: (data: string) => void;
  readonly writeError: (data: string) => void;
  readonly logger: Logger;
}

/** 插件接口 */
export interface Plugin {
  /** 插件元信息 */
  readonly meta: PluginMeta;
  /** 初始化 */
  init: (context: PluginContext) => void | Promise<void>;
  /** 销毁 (可选) */
  destroy?: () => void | Promise<void>;
}

/** 插件注册函数类型 —— 约定每个插件模块导出一个 register 函数 */
export type PluginRegister = () => Plugin;

/* ---------------------------- 判别联合 ---------------------------- */

/** beforeCommand 钩子载荷 */
export interface BeforeCommandPayload {
  readonly type: HookType.BeforeCommand;
  readonly source?: string;
  readonly command: string;
  readonly args: CommandArgs;
}

/** afterCommand 钩子载荷 */
export interface AfterCommandPayload {
  readonly type: HookType.AfterCommand;
  readonly source?: string;
  readonly command: string;
  readonly args: CommandArgs;
  readonly result?: unknown;
}

/** onInit 钩子载荷 */
export interface OnInitPayload {
  readonly type: HookType.OnInit;
  readonly source?: string;
}

/** onDestroy 钩子载荷 */
export interface OnDestroyPayload {
  readonly type: HookType.OnDestroy;
  readonly source?: string;
}

/** onError 钩子载荷 */
export interface OnErrorPayload {
  readonly type: HookType.OnError;
  readonly source?: string;
  readonly command?: string;
  readonly args?: CommandArgs;
  readonly error: Error;
}

/** 钩子载荷 (判别联合，以 type 字段判别) */
export type HookPayload =
  | BeforeCommandPayload
  | AfterCommandPayload
  | OnInitPayload
  | OnDestroyPayload
  | OnErrorPayload;

/** 命令执行结果 (判别联合，以 kind 字段判别) */
export type CommandResult =
  | {
      readonly kind: ResultKind.Success;
      readonly command: string;
      readonly value?: unknown;
    }
  | {
      readonly kind: ResultKind.Error;
      readonly command: string;
      readonly error: Error;
    }
  | { readonly kind: ResultKind.NotFound; readonly command: string };

/** 命令条目 (判别联合，以 kind 字段判别) */
export type CommandEntry =
  | {
      readonly kind: CommandKind.Builtin;
      readonly command: Command;
      readonly source: "builtin";
    }
  | {
      readonly kind: CommandKind.Plugin;
      readonly command: Command;
      readonly source: string;
    };

/** 钩子回调函数 */
export type HookCallback = (payload: HookPayload) => void | Promise<void>;

/* ---------------------------- 条件类型 ---------------------------- */

/** 提取指定钩子类型对应的载荷类型 (条件类型 + Extract) */
export type HookPayloadFor<T extends HookType> = Extract<
  HookPayload,
  { readonly type: T }
>;

/** 判断类型是否为插件 (条件类型) */
export type IsPlugin<T> = T extends Plugin ? true : false;

/** 判断结果是否为错误结果 (条件类型) */
export type IsErrorResult<R extends CommandResult> = R extends {
  readonly kind: ResultKind.Error;
}
  ? true
  : false;

/** 解包 Promise 结果 (条件类型 + infer) */
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

/* ---------------------------- 映射类型 ---------------------------- */

/** 移除 readonly 修饰符 (mapped type with -readonly) */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/** 深度可选 (递归 mapped type) */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** 将所有属性变为 readonly (mapped type with +readonly) */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/* ---------------------------- 元组与只读元组 ---------------------------- */

/** 命令名 + 来源插件名 (只读元组) */
export type CommandSourceTuple = readonly [commandName: string, source: string];

/** 解析后的命令行 (只读元组) */
export type ParsedCommandTuple = readonly [command: string, args: CommandArgs];

/** 插件名 + 版本 (只读元组) */
export type PluginNameVersion = readonly [name: string, version: string];

/* ---------------------------- Symbol 唯一键 ---------------------------- */

/** 插件内部状态 symbol 键 (unique symbol) */
export const PLUGIN_INTERNAL: unique symbol = Symbol("pluginInternal");

/** 插件内部状态接口 */
export interface PluginInternalState {
  initialized: boolean;
  readonly registeredAt: number;
  status: PluginStatus;
}

/** 事件总线内部 symbol 键 (unique symbol) */
export const EVENT_BUS_VERSION: unique symbol = Symbol("eventBusVersion");

/* ---------------------------- 类型守卫 ---------------------------- */

export function isBeforeCommandPayload(
  p: HookPayload,
): p is BeforeCommandPayload {
  return p.type === HookType.BeforeCommand;
}

export function isAfterCommandPayload(
  p: HookPayload,
): p is AfterCommandPayload {
  return p.type === HookType.AfterCommand;
}

export function isOnInitPayload(p: HookPayload): p is OnInitPayload {
  return p.type === HookType.OnInit;
}

export function isOnDestroyPayload(p: HookPayload): p is OnDestroyPayload {
  return p.type === HookType.OnDestroy;
}

export function isOnErrorPayload(p: HookPayload): p is OnErrorPayload {
  return p.type === HookType.OnError;
}

export function isSuccessResult(
  r: CommandResult,
): r is Extract<CommandResult, { readonly kind: ResultKind.Success }> {
  return r.kind === ResultKind.Success;
}

export function isErrorResult(
  r: CommandResult,
): r is Extract<CommandResult, { readonly kind: ResultKind.Error }> {
  return r.kind === ResultKind.Error;
}

export function isNotFoundResult(
  r: CommandResult,
): r is Extract<CommandResult, { readonly kind: ResultKind.NotFound }> {
  return r.kind === ResultKind.NotFound;
}

export function isPluginEntry(
  e: CommandEntry,
): e is Extract<CommandEntry, { readonly kind: CommandKind.Plugin }> {
  return e.kind === CommandKind.Plugin;
}

export function isBuiltinEntry(
  e: CommandEntry,
): e is Extract<CommandEntry, { readonly kind: CommandKind.Builtin }> {
  return e.kind === CommandKind.Builtin;
}

/** 通用非空类型守卫 (泛型 + 约束) */
export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/** 判断对象是否为 Plugin (类型守卫) */
export function isPlugin(value: unknown): value is Plugin {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Plugin>;
  return (
    typeof candidate.meta === "object" &&
    candidate.meta !== null &&
    typeof (candidate.meta as PluginMeta).name === "string" &&
    typeof candidate.init === "function"
  );
}

/** 判断值是否为指定枚举成员 (泛型类型守卫) */
export function isEnumMember<T extends string, E extends Record<string, T>>(
  value: string,
  enumObj: E,
): value is E[keyof E] {
  return Object.values(enumObj).includes(value as E[keyof E]);
}

/* ---------------------------- 工具: describe payload ---------------------------- */

/** 使用类型守卫将载荷转换为可读字符串 (演示判别联合的窄化) */
export function describePayload(payload: HookPayload): string {
  if (isBeforeCommandPayload(payload)) {
    const argsStr = payload.args.positional.join(" ");
    return `beforeCommand(${payload.command}${argsStr ? " " + argsStr : ""})`;
  }
  if (isAfterCommandPayload(payload)) {
    return `afterCommand(${payload.command})`;
  }
  if (isOnInitPayload(payload)) {
    return "onInit";
  }
  if (isOnDestroyPayload(payload)) {
    return "onDestroy";
  }
  if (isOnErrorPayload(payload)) {
    return `onError(${payload.error.message})`;
  }
  return "unknown";
}

/** 使用类型守卫将命令结果转换为可读字符串 */
export function describeResult(result: CommandResult): string {
  if (isSuccessResult(result)) {
    return `success(${result.command})`;
  }
  if (isErrorResult(result)) {
    return `error(${result.command}: ${result.error.message})`;
  }
  if (isNotFoundResult(result)) {
    return `notfound(${result.command})`;
  }
  return "unknown";
}
