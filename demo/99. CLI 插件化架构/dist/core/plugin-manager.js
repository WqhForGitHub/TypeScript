"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManager = void 0;
const event_bus_1 = require("./event-bus");
const command_registry_1 = require("./command-registry");
/* ============================== 插件管理器 ============================== */
/**
 * 插件管理器
 * - 核心调度中心，管理插件生命周期
 * - 协调事件总线与命令注册表
 * - 执行钩子链和命令分发
 */
class PluginManager {
    constructor() {
        /** 已加载的插件 */
        this.plugins = new Map();
        /** 插件初始化顺序 */
        this.loadOrder = [];
        /** 钩子注册表: hookType -> [{pluginName, callback}] */
        this.hooks = new Map();
        /** 是否已初始化 */
        this.initialized = false;
        this.eventBus = new event_bus_1.EventBus();
        this.commandRegistry = new command_registry_1.CommandRegistry();
    }
    /** 获取命令注册表 */
    getCommandRegistry() {
        return this.commandRegistry;
    }
    /** 获取事件总线 */
    getEventBus() {
        return this.eventBus;
    }
    /** 创建日志工具 */
    createLogger(pluginName) {
        const prefix = `\x1b[90m[${pluginName}]\x1b[0m`;
        return {
            info: (msg) => console.log(`${prefix} \x1b[36mINFO\x1b[0m ${msg}`),
            warn: (msg) => console.log(`${prefix} \x1b[33mWARN\x1b[0m ${msg}`),
            error: (msg) => console.log(`${prefix} \x1b[31mERROR\x1b[0m ${msg}`),
            debug: (msg) => console.log(`${prefix} \x1b[90mDEBUG\x1b[0m ${msg}`),
        };
    }
    /** 创建插件上下文 */
    createContext(pluginName) {
        return {
            registerCommand: (command) => {
                this.commandRegistry.register(command, pluginName);
            },
            registerHook: (type, callback) => {
                if (!this.hooks.has(type)) {
                    this.hooks.set(type, []);
                }
                this.hooks.get(type).push({ pluginName, callback });
            },
            emit: (event, data) => {
                this.eventBus.emit(event, data);
            },
            on: (event, handler) => {
                this.eventBus.on(event, handler);
            },
            getPlugin: (name) => {
                return this.plugins.get(name);
            },
            write: (data) => {
                process.stdout.write(data);
            },
            writeError: (data) => {
                process.stderr.write(data);
            },
            logger: this.createLogger(pluginName),
        };
    }
    /** 注册一个插件 */
    register(plugin) {
        if (this.plugins.has(plugin.meta.name)) {
            throw new Error(`插件 "${plugin.meta.name}" 已注册，无法重复注册`);
        }
        // 检查依赖
        if (plugin.meta.dependencies) {
            for (const dep of plugin.meta.dependencies) {
                if (!this.plugins.has(dep)) {
                    throw new Error(`插件 "${plugin.meta.name}" 依赖 "${dep}"，但该依赖尚未注册`);
                }
            }
        }
        this.plugins.set(plugin.meta.name, plugin);
        this.loadOrder.push(plugin.meta.name);
    }
    /** 初始化所有已注册的插件 */
    async init() {
        if (this.initialized) {
            throw new Error('插件管理器已初始化，不可重复初始化');
        }
        console.log('\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m');
        console.log('\x1b[1m\x1b[35m           CLI 插件化架构 Demo                \x1b[0m');
        console.log('\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m');
        console.log();
        // 按注册顺序初始化
        for (const name of this.loadOrder) {
            const plugin = this.plugins.get(name);
            const context = this.createContext(name);
            try {
                console.log(`\x1b[90m▸ 初始化插件: ${name} v${plugin.meta.version}\x1b[0m`);
                await plugin.init(context);
            }
            catch (err) {
                console.error(`\x1b[31m✗ 插件 "${name}" 初始化失败:\x1b[0m`, err);
                await this.executeHooks('onError', {
                    type: 'onError',
                    source: name,
                    error: err instanceof Error ? err : new Error(String(err)),
                });
            }
        }
        // 执行 onInit 钩子
        await this.executeHooks('onInit', { type: 'onInit' });
        this.initialized = true;
        const commandCount = this.commandRegistry.getAll().length;
        const pluginCount = this.plugins.size;
        console.log();
        console.log(`\x1b[32m✓ 初始化完成: ${pluginCount} 个插件已加载, ${commandCount} 条命令已注册\x1b[0m`);
        console.log();
    }
    /** 执行某类钩子 */
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
                console.error(`\x1b[31m✗ 钩子 "${type}" 在插件 "${pluginName}" 中执行出错:\x1b[0m`, err);
            }
        }
    }
    /** 执行命令 */
    async executeCommand(nameOrAlias, args) {
        const command = this.commandRegistry.resolve(nameOrAlias);
        if (!command) {
            console.error(`\x1b[31m✗ 未知命令: "${nameOrAlias}"\x1b[0m`);
            console.log('运行 \x1b[36mhelp\x1b[0m 查看可用命令');
            return;
        }
        // 执行 beforeCommand 钩子
        await this.executeHooks('beforeCommand', {
            type: 'beforeCommand',
            command: command.name,
            args,
        });
        try {
            // 获取来源插件，创建上下文
            const source = this.commandRegistry.getSource(command.name);
            const context = this.createContext(source);
            // 执行命令
            await command.handler(args, context);
            // 执行 afterCommand 钩子
            await this.executeHooks('afterCommand', {
                type: 'afterCommand',
                command: command.name,
                args,
            });
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error(`\x1b[31m✗ 命令执行出错: ${error.message}\x1b[0m`);
            await this.executeHooks('onError', {
                type: 'onError',
                command: command.name,
                args,
                error,
            });
        }
    }
    /** 销毁所有插件 */
    async destroy() {
        // 执行 onDestroy 钩子
        await this.executeHooks('onDestroy', { type: 'onDestroy' });
        // 按注册逆序销毁
        for (let i = this.loadOrder.length - 1; i >= 0; i--) {
            const name = this.loadOrder[i];
            const plugin = this.plugins.get(name);
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
        this.initialized = false;
    }
    /** 获取插件信息列表 */
    getPluginInfo() {
        return this.loadOrder.map((name) => {
            const plugin = this.plugins.get(name);
            return {
                name: plugin.meta.name,
                version: plugin.meta.version,
                description: plugin.meta.description,
                dependencies: plugin.meta.dependencies,
            };
        });
    }
}
exports.PluginManager = PluginManager;
//# sourceMappingURL=plugin-manager.js.map