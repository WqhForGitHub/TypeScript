"use strict";
/* ============================== 自定义错误层次结构 ============================== */
/*
 * 演示: 自定义 Error 类层次结构，每个错误均带 code 属性。
 * 抽象基类 PluginError 派生出多个具体错误子类。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationFailedError = exports.InvalidOperationError = exports.InvalidArgumentError = exports.CommandNotFoundError = exports.CommandAliasConflictError = exports.CommandAlreadyRegisteredError = exports.PluginNotFoundError = exports.PluginAlreadyInitializedError = exports.PluginNotInitializedError = exports.PluginDependencyMissingError = exports.PluginAlreadyRegisteredError = exports.PluginError = exports.ErrorCode = void 0;
exports.isPluginError = isPluginError;
exports.hasErrorCode = hasErrorCode;
exports.describePluginStatus = describePluginStatus;
exports.toError = toError;
const types_1 = require("./types");
/** 错误代码枚举 (string enum) */
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["PluginAlreadyRegistered"] = "PLUGIN_ALREADY_REGISTERED";
    ErrorCode["PluginDependencyMissing"] = "PLUGIN_DEPENDENCY_MISSING";
    ErrorCode["PluginNotInitialized"] = "PLUGIN_NOT_INITIALIZED";
    ErrorCode["PluginAlreadyInitialized"] = "PLUGIN_ALREADY_INITIALIZED";
    ErrorCode["PluginNotFound"] = "PLUGIN_NOT_FOUND";
    ErrorCode["CommandAlreadyRegistered"] = "COMMAND_ALREADY_REGISTERED";
    ErrorCode["CommandAliasConflict"] = "COMMAND_ALIAS_CONFLICT";
    ErrorCode["CommandNotFound"] = "COMMAND_NOT_FOUND";
    ErrorCode["InvalidArgument"] = "INVALID_ARGUMENT";
    ErrorCode["InvalidOperation"] = "INVALID_OPERATION";
    ErrorCode["OperationFailed"] = "OPERATION_FAILED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
/** 所有插件系统错误的抽象基类 (abstract class) */
class PluginError extends Error {
    constructor(message, pluginName) {
        super(message);
        this.name = new.target.name;
        this.timestamp = Date.now();
        this.pluginName = pluginName;
        // 恢复原型链 (保证 instanceof 在编译为 ES5 时仍可用)
        Object.setPrototypeOf(this, new.target.prototype);
    }
    /** 格式化错误信息 (getter 演示) */
    get formatted() {
        const plugin = this.pluginName ? `[${this.pluginName}] ` : '';
        return `${plugin}${this.code}: ${this.message}`;
    }
}
exports.PluginError = PluginError;
/** 插件重复注册错误 */
class PluginAlreadyRegisteredError extends PluginError {
    constructor(pluginName) {
        super(`插件 "${pluginName}" 已注册，无法重复注册`, pluginName);
        this.code = ErrorCode.PluginAlreadyRegistered;
    }
}
exports.PluginAlreadyRegisteredError = PluginAlreadyRegisteredError;
/** 插件依赖缺失错误 */
class PluginDependencyMissingError extends PluginError {
    constructor(pluginName, dependencyName) {
        super(`插件 "${pluginName}" 依赖 "${dependencyName}"，但该依赖尚未注册`, pluginName);
        this.code = ErrorCode.PluginDependencyMissing;
    }
}
exports.PluginDependencyMissingError = PluginDependencyMissingError;
/** 插件未初始化错误 */
class PluginNotInitializedError extends PluginError {
    constructor(pluginName) {
        super(`插件 "${pluginName}" 尚未初始化，无法访问其上下文`, pluginName);
        this.code = ErrorCode.PluginNotInitialized;
    }
}
exports.PluginNotInitializedError = PluginNotInitializedError;
/** 插件管理器已初始化错误 */
class PluginAlreadyInitializedError extends PluginError {
    constructor() {
        super('插件管理器已初始化，不可重复初始化');
        this.code = ErrorCode.PluginAlreadyInitialized;
    }
}
exports.PluginAlreadyInitializedError = PluginAlreadyInitializedError;
/** 插件未找到错误 */
class PluginNotFoundError extends PluginError {
    constructor(pluginName) {
        super(`插件 "${pluginName}" 未找到`, pluginName);
        this.code = ErrorCode.PluginNotFound;
    }
}
exports.PluginNotFoundError = PluginNotFoundError;
/** 命令重复注册错误 */
class CommandAlreadyRegisteredError extends PluginError {
    constructor(commandName, existingSource, pluginName) {
        super(`命令 "${commandName}" 已被插件 "${existingSource}" 注册，插件 "${pluginName}" 无法重复注册`, pluginName);
        this.code = ErrorCode.CommandAlreadyRegistered;
    }
}
exports.CommandAlreadyRegisteredError = CommandAlreadyRegisteredError;
/** 命令别名冲突错误 */
class CommandAliasConflictError extends PluginError {
    constructor(alias, existingCommand, commandName, pluginName) {
        super(`别名 "${alias}" 已被命令 "${existingCommand}" 使用，命令 "${commandName}" 无法使用该别名`, pluginName);
        this.code = ErrorCode.CommandAliasConflict;
    }
}
exports.CommandAliasConflictError = CommandAliasConflictError;
/** 命令未找到错误 */
class CommandNotFoundError extends PluginError {
    constructor(commandName) {
        super(`未知命令: "${commandName}"`);
        this.code = ErrorCode.CommandNotFound;
    }
}
exports.CommandNotFoundError = CommandNotFoundError;
/** 参数无效错误 */
class InvalidArgumentError extends PluginError {
    constructor(message, pluginName) {
        super(message, pluginName);
        this.code = ErrorCode.InvalidArgument;
    }
}
exports.InvalidArgumentError = InvalidArgumentError;
/** 操作无效错误 (用于非法的子命令等) */
class InvalidOperationError extends PluginError {
    constructor(operation, validOperations, pluginName) {
        super(`未知操作: "${operation}"，可用操作: ${validOperations.join(', ')}`, pluginName);
        this.code = ErrorCode.InvalidOperation;
    }
}
exports.InvalidOperationError = InvalidOperationError;
/** 操作失败错误 (通用) */
class OperationFailedError extends PluginError {
    constructor(message, pluginName) {
        super(message, pluginName);
        this.code = ErrorCode.OperationFailed;
    }
}
exports.OperationFailedError = OperationFailedError;
/* ---------------------------- 类型守卫 ---------------------------- */
/** 判断错误是否为 PluginError (类型守卫) */
function isPluginError(err) {
    return err instanceof PluginError;
}
/** 判断错误是否为指定错误码 (泛型类型守卫) */
function hasErrorCode(err, code) {
    return err instanceof PluginError && err.code === code;
}
/** 根据插件状态生成可读描述 (使用枚举) */
function describePluginStatus(status) {
    switch (status) {
        case types_1.PluginStatus.Registered:
            return '已注册 (尚未初始化)';
        case types_1.PluginStatus.Initialized:
            return '已初始化 (运行中)';
        case types_1.PluginStatus.Destroyed:
            return '已销毁';
        default:
            return '未知状态';
    }
}
/** 从未知错误中提取 Error 实例 (类型守卫 + 兜底) */
function toError(err) {
    if (err instanceof Error)
        return err;
    if (typeof err === 'string')
        return new Error(err);
    return new Error(String(err));
}
//# sourceMappingURL=errors.js.map