"use strict";
/* ============================== 插件管理器 ============================== */
/*
 * 演示:
 *   - 泛型与约束 (generics with constraints)
 *   - 函数重载 (function overloads)
 *   - 生成器 / 迭代器 (generators)
 *   - Getter / Setter
 *   - 判别联合 + 类型守卫 (HookPayload / CommandResult)
 *   - 自定义错误层次结构
 *   - satisfies 操作符
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManager = void 0;
exports.assertPlugin = assertPlugin;
exports.collectDefinedPlugins = collectDefinedPlugins;
exports.freezeContext = freezeContext;
const types_1 = require("./types");
const errors_1 = require("./errors");
const event_bus_1 = require("./event-bus");
const command_registry_1 = require("./command-registry");
/**
 * 插件管理器
 * - 核心调度中心，管理插件生命周期
 * - 协调事件总线与命令注册表
 * - 执行钩子链和命令分发
 */
class PluginManager {
    constructor() {
        /** 已加载的插件: name -> plugin */
        this.plugins = new Map();
        /** 插件初始化顺序 */
        this.loadOrder = [];
        /** 钩子注册表: hookType -> records */
        this.hooks = new Map();
        /** 是否已初始化 (内部可变, 通过 getter 暴露) */
        this._initialized = false;
        /** 内部状态 */
        this._status = types_1.PluginStatus.Registered;
        this.eventBus = new event_bus_1.EventBus();
        this.commandRegistry = new command_registry_1.CommandRegistry();
    }
    /* ---------------------------- Getters / Setters ---------------------------- */
    /** 是否已初始化 (getter) */
    get initialized() {
        return this._initialized;
    }
    /** 管理器状态 (getter) */
    get status() {
        return this._status;
    }
    /** 已加载插件数量 (getter) */
    get pluginCount() {
        return this.plugins.size;
    }
    /** 已注册命令数量 (getter) */
    get commandCount() {
        return this.commandRegistry.count;
    }
    /* ---------------------------- 访问器 ---------------------------- */
    /** 获取命令注册表 */
    getCommandRegistry() {
        return this.commandRegistry;
    }
    /** 获取事件总线 */
    getEventBus() {
        return this.eventBus;
    }
    /** getPlugin 实现 */
    getPlugin(name, predicate) {
        const plugin = this.plugins.get(name);
        if (plugin === undefined)
            return undefined;
        if (predicate !== undefined) {
            return predicate(plugin) ? plugin : undefined;
        }
        return plugin;
    }
    /* ---------------------------- 注册 ---------------------------- */
    /** 注册一个插件 */
    register(plugin) {
        if (this.plugins.has(plugin.meta.name)) {
            throw new errors_1.PluginAlreadyRegisteredError(plugin.meta.name);
        }
        // 检查依赖
        if (plugin.meta.dependencies) {
            for (const dep of plugin.meta.dependencies) {
                if (!this.plugins.has(dep)) {
                    throw new errors_1.PluginDependencyMissingError(plugin.meta.name, dep);
                }
            }
        }
        this.plugins.set(plugin.meta.name, plugin);
        this.loadOrder.push(plugin.meta.name);
    }
    /* ---------------------------- 初始化 ---------------------------- */
    /** 初始化所有已注册的插件 */
    async init() {
        if (this._initialized) {
            throw new errors_1.PluginAlreadyInitializedError();
        }
        console.log('\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m');
        console.log('\x1b[1m\x1b[35m           CLI 插件化架构 Demo                \x1b[0m');
        console.log('\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m');
        console.log();
        // 按注册顺序初始化 (使用生成器遍历)
        for (const { name, plugin } of this.iteratePluginsInOrder()) {
            const context = this.createContext(name);
            try {
                console.log(`\x1b[90m▸ 初始化插件: ${name} v${plugin.meta.version}\x1b[0m`);
                await plugin.init(context);
            }
            catch (err) {
                const error = (0, errors_1.toError)(err);
                console.error(`\x1b[31m✗ 插件 "${name}" 初始化失败:\x1b[0m`, error);
                await this.executeHooks(types_1.HookType.OnError, {
                    type: types_1.HookType.OnError,
                    source: name,
                    error,
                });
            }
        }
        // 执行 onInit 钩子
        await this.executeHooks(types_1.HookType.OnInit, { type: types_1.HookType.OnInit });
        this._initialized = true;
        this._status = types_1.PluginStatus.Initialized;
        console.log();
        console.log(`\x1b[32m✓ 初始化完成: ${this.pluginCount} 个插件已加载, ${this.commandCount} 条命令已注册\x1b[0m`);
        console.log();
    }
    /* ---------------------------- 钩子执行 ---------------------------- */
    /** 执行某类钩子 (使用判别联合 payload) */
    async executeHooks(type, basePayload) {
        const hookList = this.hooks.get(type);
        if (!hookList)
            return;
        for (const { pluginName, callback } of hookList) {
            try {
                const payload = { ...basePayload, source: pluginName };
                await callback(payload);
            }
            catch (err) {
                console.error(`\x1b[31m✗ 钩子 "${(0, types_1.describePayload)(basePayload)}" 在插件 "${pluginName}" 中执行出错:\x1b[0m`, err);
            }
        }
    }
    /* ---------------------------- 命令执行 ---------------------------- */
    /** 执行命令 (返回判别联合 CommandResult) */
    async executeCommand(nameOrAlias, args) {
        const command = this.commandRegistry.resolve(nameOrAlias);
        if (!command) {
            console.error(`\x1b[31m✗ 未知命令: "${nameOrAlias}"\x1b[0m`);
            console.log('运行 \x1b[36mhelp\x1b[0m 查看可用命令');
            const notFound = { kind: types_1.ResultKind.NotFound, command: nameOrAlias };
            return notFound;
        }
        // 执行 beforeCommand 钩子
        await this.executeHooks(types_1.HookType.BeforeCommand, {
            type: types_1.HookType.BeforeCommand,
            command: command.name,
            args,
        });
        try {
            // 获取来源插件，创建上下文
            const source = this.commandRegistry.getSource(command.name) ?? 'unknown';
            const context = this.createContext(source);
            // 执行命令
            await command.handler(args, context);
            // 执行 afterCommand 钩子
            await this.executeHooks(types_1.HookType.AfterCommand, {
                type: types_1.HookType.AfterCommand,
                command: command.name,
                args,
            });
            const success = { kind: types_1.ResultKind.Success, command: command.name };
            return success;
        }
        catch (err) {
            const error = (0, errors_1.toError)(err);
            console.error(`\x1b[31m✗ 命令执行出错: ${error.message}\x1b[0m`);
            await this.executeHooks(types_1.HookType.OnError, {
                type: types_1.HookType.OnError,
                command: command.name,
                args,
                error,
            });
            const errorResult = { kind: types_1.ResultKind.Error, command: command.name, error };
            return errorResult;
        }
    }
    /* ---------------------------- 销毁 ---------------------------- */
    /** 销毁所有插件 (按注册逆序) */
    async destroy() {
        // 执行 onDestroy 钩子
        await this.executeHooks(types_1.HookType.OnDestroy, { type: types_1.HookType.OnDestroy });
        // 按注册逆序销毁 (使用生成器遍历)
        for (const { name, plugin } of this.iteratePluginsInReverse()) {
            if (plugin.destroy) {
                try {
                    await plugin.destroy();
                    console.log(`\x1b[90m▸ 插件 "${name}" 已销毁\x1b[0m`);
                }
                catch (err) {
                    console.error(`\x1b[31m✗ 插件 "${name}" 销毁失败:\x1b[0m`, err);
                }
            }
        }
        this.eventBus.removeAllListeners();
        this.plugins.clear();
        this.loadOrder = [];
        this.hooks.clear();
        this._initialized = false;
        this._status = types_1.PluginStatus.Destroyed;
    }
    /* ---------------------------- 信息查询 ---------------------------- */
    /** 获取插件信息列表 */
    getPluginInfo() {
        return this.loadOrder.map((name) => {
            const plugin = this.plugins.get(name);
            if (!plugin) {
                throw new Error(`内部错误: 插件 "${name}" 不在 map 中`);
            }
            const meta = plugin.meta;
            return {
                name: meta.name,
                version: meta.version,
                description: meta.description,
                dependencies: meta.dependencies,
            };
        });
    }
    /** 获取插件名 + 版本列表 (只读元组) */
    getPluginNameVersions() {
        const result = [];
        for (const { plugin } of this.iteratePluginsInOrder()) {
            result.push([plugin.meta.name, plugin.meta.version]);
        }
        return result;
    }
    /** 打印上次命令结果 (使用类型守卫窄化判别联合) */
    describeLastResult(result) {
        if ((0, types_1.isSuccessResult)(result)) {
            return `命令 "${result.command}" 执行成功`;
        }
        if ((0, types_1.isErrorResult)(result)) {
            return `命令 "${result.command}" 执行失败: ${result.error.message}`;
        }
        if ((0, types_1.isNotFoundResult)(result)) {
            return `命令 "${result.command}" 未找到`;
        }
        return (0, types_1.describeResult)(result);
    }
    /* ---------------------------- 生成器 ---------------------------- */
    /** 生成器: 按注册顺序迭代插件 */
    *iteratePluginsInOrder() {
        for (const name of this.loadOrder) {
            const plugin = this.plugins.get(name);
            if (plugin) {
                yield { name, plugin };
            }
        }
    }
    /** 生成器: 按注册逆序迭代插件 */
    *iteratePluginsInReverse() {
        for (let i = this.loadOrder.length - 1; i >= 0; i--) {
            const name = this.loadOrder[i];
            const plugin = this.plugins.get(name);
            if (plugin) {
                yield { name, plugin };
            }
        }
    }
    /* ---------------------------- 私有: 上下文 / 日志 ---------------------------- */
    /** 创建日志工具 (使用 satisfies 校验) */
    createLogger(pluginName) {
        const prefix = `\x1b[90m[${pluginName}]\x1b[0m`;
        const logger = {
            info: (msg) => {
                console.log(`${prefix} \x1b[36mINFO\x1b[0m ${msg}`);
            },
            warn: (msg) => {
                console.log(`${prefix} \x1b[33mWARN\x1b[0m ${msg}`);
            },
            error: (msg) => {
                console.log(`${prefix} \x1b[31mERROR\x1b[0m ${msg}`);
            },
            debug: (msg) => {
                console.log(`${prefix} \x1b[90mDEBUG\x1b[0m ${msg}`);
            },
        };
        return logger;
    }
    /** 创建插件上下文 */
    createContext(pluginName) {
        const manager = this;
        const context = {
            registerCommand: (command) => {
                manager.commandRegistry.register(command, pluginName);
            },
            registerHook: (type, callback) => {
                let list = manager.hooks.get(type);
                if (!list) {
                    list = [];
                    manager.hooks.set(type, list);
                }
                list.push({ pluginName, callback });
            },
            emit: (event, data) => {
                manager.eventBus.emit(event, data);
            },
            on: (event, handler) => {
                manager.eventBus.on(event, handler);
            },
            once: (event, handler) => {
                manager.eventBus.once(event, handler);
            },
            getPlugin: (name) => {
                return manager.plugins.get(name);
            },
            write: (data) => {
                process.stdout.write(data);
            },
            writeError: (data) => {
                process.stderr.write(data);
            },
            logger: this.createLogger(pluginName),
        };
        return context;
    }
}
exports.PluginManager = PluginManager;
/* ---------------------------- 模块级工具函数 ---------------------------- */
/** 泛型: 将任意值断言为插件 (泛型 + 约束 + 类型守卫) */
function assertPlugin(value, predicate) {
    if (!(0, types_1.isPlugin)(value)) {
        throw new Error('给定的值不是一个合法的 Plugin');
    }
    if (predicate !== undefined && !predicate(value)) {
        throw new Error('插件类型断言失败');
    }
    return value;
}
/** 过滤掉 undefined/null 并返回插件列表 (使用 isDefined 类型守卫) */
function collectDefinedPlugins(plugins) {
    return plugins.filter(types_1.isDefined);
}
/** 将可变上下文转为只读上下文 (使用 Mutable 映射类型) */
function freezeContext(context) {
    return Object.freeze({ ...context });
}
//# sourceMappingURL=plugin-manager.js.map