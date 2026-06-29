/* ============================== 自定义错误层次结构 ============================== */
/*
 * 演示: 自定义 Error 类层次结构，每个错误均带 code 属性。
 * 抽象基类 PluginError 派生出多个具体错误子类。
 */

import { PluginStatus } from "./types";

/** 错误代码枚举 (string enum) */
export enum ErrorCode {
  PluginAlreadyRegistered = "PLUGIN_ALREADY_REGISTERED",
  PluginDependencyMissing = "PLUGIN_DEPENDENCY_MISSING",
  PluginNotInitialized = "PLUGIN_NOT_INITIALIZED",
  PluginAlreadyInitialized = "PLUGIN_ALREADY_INITIALIZED",
  PluginNotFound = "PLUGIN_NOT_FOUND",
  CommandAlreadyRegistered = "COMMAND_ALREADY_REGISTERED",
  CommandAliasConflict = "COMMAND_ALIAS_CONFLICT",
  CommandNotFound = "COMMAND_NOT_FOUND",
  InvalidArgument = "INVALID_ARGUMENT",
  InvalidOperation = "INVALID_OPERATION",
  OperationFailed = "OPERATION_FAILED",
}

/** 所有插件系统错误的抽象基类 (abstract class) */
export abstract class PluginError extends Error {
  /** 抽象: 子类必须提供错误代码 */
  public abstract readonly code: ErrorCode;
  /** 错误发生时间戳 */
  public readonly timestamp: number;
  /** 关联的插件名 (可选) */
  public readonly pluginName?: string;

  constructor(message: string, pluginName?: string) {
    super(message);
    this.name = new.target.name;
    this.timestamp = Date.now();
    this.pluginName = pluginName;
    // 恢复原型链 (保证 instanceof 在编译为 ES5 时仍可用)
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** 格式化错误信息 (getter 演示) */
  get formatted(): string {
    const plugin = this.pluginName ? `[${this.pluginName}] ` : "";
    return `${plugin}${this.code}: ${this.message}`;
  }
}

/** 插件重复注册错误 */
export class PluginAlreadyRegisteredError extends PluginError {
  public readonly code = ErrorCode.PluginAlreadyRegistered;
  constructor(pluginName: string) {
    super(`插件 "${pluginName}" 已注册，无法重复注册`, pluginName);
  }
}

/** 插件依赖缺失错误 */
export class PluginDependencyMissingError extends PluginError {
  public readonly code = ErrorCode.PluginDependencyMissing;
  constructor(pluginName: string, dependencyName: string) {
    super(
      `插件 "${pluginName}" 依赖 "${dependencyName}"，但该依赖尚未注册`,
      pluginName,
    );
  }
}

/** 插件未初始化错误 */
export class PluginNotInitializedError extends PluginError {
  public readonly code = ErrorCode.PluginNotInitialized;
  constructor(pluginName: string) {
    super(`插件 "${pluginName}" 尚未初始化，无法访问其上下文`, pluginName);
  }
}

/** 插件管理器已初始化错误 */
export class PluginAlreadyInitializedError extends PluginError {
  public readonly code = ErrorCode.PluginAlreadyInitialized;
  constructor() {
    super("插件管理器已初始化，不可重复初始化");
  }
}

/** 插件未找到错误 */
export class PluginNotFoundError extends PluginError {
  public readonly code = ErrorCode.PluginNotFound;
  constructor(pluginName: string) {
    super(`插件 "${pluginName}" 未找到`, pluginName);
  }
}

/** 命令重复注册错误 */
export class CommandAlreadyRegisteredError extends PluginError {
  public readonly code = ErrorCode.CommandAlreadyRegistered;
  constructor(commandName: string, existingSource: string, pluginName: string) {
    super(
      `命令 "${commandName}" 已被插件 "${existingSource}" 注册，插件 "${pluginName}" 无法重复注册`,
      pluginName,
    );
  }
}

/** 命令别名冲突错误 */
export class CommandAliasConflictError extends PluginError {
  public readonly code = ErrorCode.CommandAliasConflict;
  constructor(
    alias: string,
    existingCommand: string,
    commandName: string,
    pluginName: string,
  ) {
    super(
      `别名 "${alias}" 已被命令 "${existingCommand}" 使用，命令 "${commandName}" 无法使用该别名`,
      pluginName,
    );
  }
}

/** 命令未找到错误 */
export class CommandNotFoundError extends PluginError {
  public readonly code = ErrorCode.CommandNotFound;
  constructor(commandName: string) {
    super(`未知命令: "${commandName}"`);
  }
}

/** 参数无效错误 */
export class InvalidArgumentError extends PluginError {
  public readonly code = ErrorCode.InvalidArgument;
  constructor(message: string, pluginName?: string) {
    super(message, pluginName);
  }
}

/** 操作无效错误 (用于非法的子命令等) */
export class InvalidOperationError extends PluginError {
  public readonly code = ErrorCode.InvalidOperation;
  constructor(
    operation: string,
    validOperations: readonly string[],
    pluginName?: string,
  ) {
    super(
      `未知操作: "${operation}"，可用操作: ${validOperations.join(", ")}`,
      pluginName,
    );
  }
}

/** 操作失败错误 (通用) */
export class OperationFailedError extends PluginError {
  public readonly code = ErrorCode.OperationFailed;
  constructor(message: string, pluginName?: string) {
    super(message, pluginName);
  }
}

/* ---------------------------- 类型守卫 ---------------------------- */

/** 判断错误是否为 PluginError (类型守卫) */
export function isPluginError(err: unknown): err is PluginError {
  return err instanceof PluginError;
}

/** 判断错误是否为指定错误码 (泛型类型守卫) */
export function hasErrorCode<T extends ErrorCode>(
  err: unknown,
  code: T,
): err is PluginError & { readonly code: T } {
  return err instanceof PluginError && err.code === code;
}

/** 根据插件状态生成可读描述 (使用枚举) */
export function describePluginStatus(status: PluginStatus): string {
  switch (status) {
    case PluginStatus.Registered:
      return "已注册 (尚未初始化)";
    case PluginStatus.Initialized:
      return "已初始化 (运行中)";
    case PluginStatus.Destroyed:
      return "已销毁";
    default:
      return "未知状态";
  }
}

/** 从未知错误中提取 Error 实例 (类型守卫 + 兜底) */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  return new Error(String(err));
}
