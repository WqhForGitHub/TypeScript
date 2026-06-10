import {
  Plugin,
  PluginContext,
  Command,
  HookType,
  HookCallback,
  HookPayload,
  Logger,
  EventHandler,
} from './types';
import { EventBus } from './event-bus';
import { CommandRegistry } from './command-registry';

/* ============================== 插件管理器 ============================== */

/**
 * 插件管理器
 * - 核心调度中心，管理插件生命周期
 * - 协调事件总线与命令注册表
 * - 执行钩子链和命令分发
 */
export class PluginManager {
  /** 已加载的插件 */
  private plugins: Map<string, Plugin> = new Map();
  /** 插件初始化顺序 */
  private loadOrder: string[] = [];
  /** 钩子注册表: hookType -> [{pluginName, callback}] */
  private hooks: Map<HookType, Array<{ pluginName: string; callback: HookCallback }>> = new Map();
  /** 事件总线 */
  private eventBus: EventBus;
  /** 命令注册表 */
  private commandRegistry: CommandRegistry;
  /** 是否已初始化 */
  private initialized = false;

  constructor() {
    this.eventBus = new EventBus();
    this.commandRegistry = new CommandRegistry();
  }

  /** 获取命令注册表 */
  getCommandRegistry(): CommandRegistry {
    return this.commandRegistry;
  }

  /** 获取事件总线 */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /** 创建日志工具 */
  private createLogger(pluginName: string): Logger {
    const prefix = `\x1b[90m[${pluginName}]\x1b[0m`;
    return {
      info: (msg: string) => console.log(`${prefix} \x1b[36mINFO\x1b[0m ${msg}`),
      warn: (msg: string) => console.log(`${prefix} \x1b[33mWARN\x1b[0m ${msg}`),
      error: (msg: string) => console.log(`${prefix} \x1b[31mERROR\x1b[0m ${msg}`),
      debug: (msg: string) => console.log(`${prefix} \x1b[90mDEBUG\x1b[0m ${msg}`),
    };
  }

  /** 创建插件上下文 */
  private createContext(pluginName: string): PluginContext {
    return {
      registerCommand: (command: Command) => {
        this.commandRegistry.register(command, pluginName);
      },
      registerHook: (type: HookType, callback: HookCallback) => {
        if (!this.hooks.has(type)) {
          this.hooks.set(type, []);
        }
        this.hooks.get(type)!.push({ pluginName, callback });
      },
      emit: (event: string, data?: unknown) => {
        this.eventBus.emit(event, data);
      },
      on: (event: string, handler: EventHandler) => {
        this.eventBus.on(event, handler);
      },
      getPlugin: (name: string) => {
        return this.plugins.get(name);
      },
      write: (data: string) => {
        process.stdout.write(data);
      },
      writeError: (data: string) => {
        process.stderr.write(data);
      },
      logger: this.createLogger(pluginName),
    };
  }

  /** 注册一个插件 */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.meta.name)) {
      throw new Error(`插件 "${plugin.meta.name}" 已注册，无法重复注册`);
    }

    // 检查依赖
    if (plugin.meta.dependencies) {
      for (const dep of plugin.meta.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(
            `插件 "${plugin.meta.name}" 依赖 "${dep}"，但该依赖尚未注册`
          );
        }
      }
    }

    this.plugins.set(plugin.meta.name, plugin);
    this.loadOrder.push(plugin.meta.name);
  }

  /** 初始化所有已注册的插件 */
  async init(): Promise<void> {
    if (this.initialized) {
      throw new Error('插件管理器已初始化，不可重复初始化');
    }

    console.log('\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m\x1b[35m           CLI 插件化架构 Demo                \x1b[0m');
    console.log('\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m');
    console.log();

    // 按注册顺序初始化
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name)!;
      const context = this.createContext(name);

      try {
        console.log(`\x1b[90m▸ 初始化插件: ${name} v${plugin.meta.version}\x1b[0m`);
        await plugin.init(context);
      } catch (err) {
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
    console.log(
      `\x1b[32m✓ 初始化完成: ${pluginCount} 个插件已加载, ${commandCount} 条命令已注册\x1b[0m`
    );
    console.log();
  }

  /** 执行某类钩子 */
  private async executeHooks(type: HookType, basePayload: HookPayload): Promise<void> {
    const hookList = this.hooks.get(type);
    if (!hookList) return;

    for (const { pluginName, callback } of hookList) {
      try {
        const payload: HookPayload = { ...basePayload, source: pluginName };
        await callback(payload);
      } catch (err) {
        console.error(`\x1b[31m✗ 钩子 "${type}" 在插件 "${pluginName}" 中执行出错:\x1b[0m`, err);
      }
    }
  }

  /** 执行命令 */
  async executeCommand(nameOrAlias: string, args: import('./types').CommandArgs): Promise<void> {
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
      const source = this.commandRegistry.getSource(command.name)!;
      const context = this.createContext(source);

      // 执行命令
      await command.handler(args, context);

      // 执行 afterCommand 钩子
      await this.executeHooks('afterCommand', {
        type: 'afterCommand',
        command: command.name,
        args,
      });
    } catch (err) {
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
  async destroy(): Promise<void> {
    // 执行 onDestroy 钩子
    await this.executeHooks('onDestroy', { type: 'onDestroy' });

    // 按注册逆序销毁
    for (let i = this.loadOrder.length - 1; i >= 0; i--) {
      const name = this.loadOrder[i];
      const plugin = this.plugins.get(name)!;
      if (plugin.destroy) {
        try {
          await plugin.destroy();
          console.log(`\x1b[90m▸ 插件 "${name}" 已销毁\x1b[0m`);
        } catch (err) {
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
  getPluginInfo(): Array<{ name: string; version: string; description: string; dependencies?: string[] }> {
    return this.loadOrder.map((name) => {
      const plugin = this.plugins.get(name)!;
      return {
        name: plugin.meta.name,
        version: plugin.meta.version,
        description: plugin.meta.description,
        dependencies: plugin.meta.dependencies,
      };
    });
  }
}
