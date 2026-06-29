"use strict";
/* ============================== 抽象插件基类 ============================== */
/*
 * 演示: 抽象类 (abstract class) 与具体子类。
 * BasePlugin 实现了 Plugin 接口的通用生命周期管理，
 * 各具体插件 (LoggerPlugin / GreetPlugin / TimePlugin / CalcPlugin)
 * 继承 BasePlugin 并实现抽象方法 onInit / onDestroy。
 */
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasePlugin = void 0;
const types_1 = require("./types");
const errors_1 = require("./errors");
/**
 * 抽象插件基类
 * - 封装通用的生命周期: init / destroy / 状态管理
 * - 暴露 protected getter/setter 给子类访问上下文
 * - 使用 symbol 作为内部状态属性键
 */
class BasePlugin {
    constructor() {
        /** 内部上下文 (私有) */
        this._context = null;
        /** 内部状态 (私有) */
        this._status = types_1.PluginStatus.Registered;
        /** 使用 unique symbol 作为内部状态属性键 (字段初始化器) */
        this[_a] = {
            initialized: false,
            registeredAt: Date.now(),
            status: types_1.PluginStatus.Registered,
        };
    }
    /* ---------------------------- Getters / Setters ---------------------------- */
    /** 插件当前状态 (getter) */
    get status() {
        return this._status;
    }
    /** 插件是否已初始化 (getter) */
    get initialized() {
        return this._context !== null;
    }
    /** 受保护的上下文访问器 (getter) —— 子类通过 this.context 访问 */
    get context() {
        if (this._context === null) {
            throw new errors_1.PluginNotInitializedError(this.meta.name);
        }
        return this._context;
    }
    /** 受保护的上下文设置器 (setter) */
    set context(ctx) {
        this._context = ctx;
    }
    /* ---------------------------- 生命周期 ---------------------------- */
    /** 初始化 (模板方法: 记录状态后调用子类 onInit) */
    async init(context) {
        this._context = context;
        this._status = types_1.PluginStatus.Initialized;
        this[types_1.PLUGIN_INTERNAL].initialized = true;
        this[types_1.PLUGIN_INTERNAL].status = types_1.PluginStatus.Initialized;
        await this.onInit(context);
    }
    /** 销毁 (模板方法: 调用子类 onDestroy 后清理) */
    async destroy() {
        await this.onDestroy?.();
        this._context = null;
        this._status = types_1.PluginStatus.Destroyed;
        this[types_1.PLUGIN_INTERNAL].initialized = false;
        this[types_1.PLUGIN_INTERNAL].status = types_1.PluginStatus.Destroyed;
    }
    /* ---------------------------- 便捷方法 (供子类使用) ---------------------------- */
    /** 注册命令 (转发到上下文) */
    registerCommand(command) {
        this.context.registerCommand(command);
    }
    /** 注册钩子 (转发到上下文) */
    registerHook(type, callback) {
        this.context.registerHook(type, callback);
    }
    /** 监听事件 (转发到上下文) */
    on(event, handler) {
        this.context.on(event, handler);
    }
    /** 一次性监听事件 (转发到上下文) */
    once(event, handler) {
        this.context.once(event, handler);
    }
    /** 发送事件 (转发到上下文) */
    emit(event, data) {
        this.context.emit(event, data);
    }
    /** 获取其它插件 (转发到上下文) */
    getPlugin(name) {
        return this.context.getPlugin(name);
    }
    /** 获取日志工具 (转发到上下文) */
    get logger() {
        return this.context.logger;
    }
}
exports.BasePlugin = BasePlugin;
_a = types_1.PLUGIN_INTERNAL;
//# sourceMappingURL=base-plugin.js.map