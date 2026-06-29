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

import {
  Plugin,
  PluginContext,
  Command,
  CommandArgs,
  CommandResult,
  HookType,
  HookCallback,
  HookPayload,
  Logger,
  EventHandler,
  PluginStatus,
  ResultKind,
  describePayload,
  describeResult,
  isSuccessResult,
  isErrorResult,
  isNotFoundResult,
  isPlugin,
  isDefined,
  Mutable,
  PluginNameVersion,
} from "./types";
import {
  PluginAlreadyRegisteredError,
  PluginDependencyMissingError,
  PluginAlreadyInitializedError,
  toError,
} from "./errors";
import { EventBus } from "./event-bus";
import { CommandRegistry } from "./command-registry";

/** 钩子注册记录 */
interface HookRecord {
  readonly pluginName: string;
  readonly callback: HookCallback;
}

/**
 * 插件管理器
 * - 核心调度中心，管理插件生命周期
 * - 协调事件总线与命令注册表
 * - 执行钩子链和命令分发
 */
export class PluginManager {
  /** 已加载的插件: name -> plugin */
  private readonly plugins: Map<string, Plugin> = new Map();
  /** 插件初始化顺序 */
  private loadOrder: string[] = [];
  /** 钩子注册表: hookType -> records */
  private readonly hooks: Map<HookType, HookRecord[]> = new Map();
  /** 事件总线 */
  private readonly eventBus: EventBus;
  /** 命令注册表 */
  private readonly commandRegistry: CommandRegistry;
  /** 是否已初始化 (内部可变, 通过 getter 暴露) */
  private _initialized = false;
  /** 内部状态 */
  private _status: PluginStatus = PluginStatus.Registered;

  constructor() {
    this.eventBus = new EventBus();
    this.commandRegistry = new CommandRegistry();
  }

  /* ---------------------------- Getters / Setters ---------------------------- */

  /** 是否已初始化 (getter) */
  public get initialized(): boolean {
    return this._initialized;
  }

  /** 管理器状态 (getter) */
  public get status(): PluginStatus {
    return this._status;
  }

  /** 已加载插件数量 (getter) */
  public get pluginCount(): number {
    return this.plugins.size;
  }

  /** 已注册命令数量 (getter) */
  public get commandCount(): number {
    return this.commandRegistry.count;
  }

  /* ---------------------------- 访问器 ---------------------------- */

  /** 获取命令注册表 */
  public getCommandRegistry(): CommandRegistry {
    return this.commandRegistry;
  }

  /** 获取事件总线 */
  public getEventBus(): EventBus {
    return this.eventBus;
  }

  /* ---------------------------- 函数重载: getPlugin ---------------------------- */

  /** 获取插件 (基础) */
  public getPlugin(name: string): Plugin | undefined;
  /** 获取插件并通过谓词窄化类型 (重载, 泛型 + 约束) */
  public getPlugin<T extends Plugin>(
    name: string,
    predicate: (p: Plugin) => p is T,
  ): T | undefined;
  /** getPlugin 实现 */
  public getPlugin<T extends Plugin>(
    name: string,
    predicate?: (p: Plugin) => p is T,
  ): Plugin | T | undefined {
    const plugin = this.plugins.get(name);
    if (plugin === undefined) return undefined;
    if (predicate !== undefined) {
      return predicate(plugin) ? plugin : undefined;
    }
    return plugin;
  }

  /* ---------------------------- 注册 ---------------------------- */

  /** 注册一个插件 */
  public register(plugin: Plugin): void {
    if (this.plugins.has(plugin.meta.name)) {
      throw new PluginAlreadyRegisteredError(plugin.meta.name);
    }

    // 检查依赖
    if (plugin.meta.dependencies) {
      for (const dep of plugin.meta.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new PluginDependencyMissingError(plugin.meta.name, dep);
        }
      }
    }

    this.plugins.set(plugin.meta.name, plugin);
    this.loadOrder.push(plugin.meta.name);
  }

  /* ---------------------------- 初始化 ---------------------------- */

  /** 初始化所有已注册的插件 */
  public async init(): Promise<void> {
    if (this._initialized) {
      throw new PluginAlreadyInitializedError();
    }

    console.log(
      "\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m",
    );
    console.log(
      "\x1b[1m\x1b[35m           CLI 插件化架构 Demo                \x1b[0m",
    );
    console.log(
      "\x1b[1m\x1b[35m═══════════════════════════════════════════════\x1b[0m",
    );
    console.log();

    // 按注册顺序初始化 (使用生成器遍历)
    for (const { name, plugin } of this.iteratePluginsInOrder()) {
      const context = this.createContext(name);
      try {
        console.log(
          `\x1b[90m▸ 初始化插件: ${name} v${plugin.meta.version}\x1b[0m`,
        );
        await plugin.init(context);
      } catch (err) {
        const error = toError(err);
        console.error(`\x1b[31m✗ 插件 "${name}" 初始化失败:\x1b[0m`, error);
        await this.executeHooks(HookType.OnError, {
          type: HookType.OnError,
          source: name,
          error,
        });
      }
    }

    // 执行 onInit 钩子
    await this.executeHooks(HookType.OnInit, { type: HookType.OnInit });

    this._initialized = true;
    this._status = PluginStatus.Initialized;

    console.log();
    console.log(
      `\x1b[32m✓ 初始化完成: ${this.pluginCount} 个插件已加载, ${this.commandCount} 条命令已注册\x1b[0m`,
    );
    console.log();
  }

  /* ---------------------------- 钩子执行 ---------------------------- */

  /** 执行某类钩子 (使用判别联合 payload) */
  private async executeHooks(
    type: HookType,
    basePayload: HookPayload,
  ): Promise<void> {
    const hookList = this.hooks.get(type);
    if (!hookList) return;

    for (const { pluginName, callback } of hookList) {
      try {
        const payload: HookPayload = { ...basePayload, source: pluginName };
        await callback(payload);
      } catch (err) {
        console.error(
          `\x1b[31m✗ 钩子 "${describePayload(basePayload)}" 在插件 "${pluginName}" 中执行出错:\x1b[0m`,
          err,
        );
      }
    }
  }

  /* ---------------------------- 命令执行 ---------------------------- */

  /** 执行命令 (返回判别联合 CommandResult) */
  public async executeCommand(
    nameOrAlias: string,
    args: CommandArgs,
  ): Promise<CommandResult> {
    const command = this.commandRegistry.resolve(nameOrAlias);

    if (!command) {
      console.error(`\x1b[31m✗ 未知命令: "${nameOrAlias}"\x1b[0m`);
      console.log("运行 \x1b[36mhelp\x1b[0m 查看可用命令");
      const notFound: CommandResult = {
        kind: ResultKind.NotFound,
        command: nameOrAlias,
      };
      return notFound;
    }

    // 执行 beforeCommand 钩子
    await this.executeHooks(HookType.BeforeCommand, {
      type: HookType.BeforeCommand,
      command: command.name,
      args,
    });

    try {
      // 获取来源插件，创建上下文
      const source = this.commandRegistry.getSource(command.name) ?? "unknown";
      const context = this.createContext(source);

      // 执行命令
      await command.handler(args, context);

      // 执行 afterCommand 钩子
      await this.executeHooks(HookType.AfterCommand, {
        type: HookType.AfterCommand,
        command: command.name,
        args,
      });

      const success: CommandResult = {
        kind: ResultKind.Success,
        command: command.name,
      };
      return success;
    } catch (err) {
      const error = toError(err);
      console.error(`\x1b[31m✗ 命令执行出错: ${error.message}\x1b[0m`);

      await this.executeHooks(HookType.OnError, {
        type: HookType.OnError,
        command: command.name,
        args,
        error,
      });

      const errorResult: CommandResult = {
        kind: ResultKind.Error,
        command: command.name,
        error,
      };
      return errorResult;
    }
  }

  /* ---------------------------- 销毁 ---------------------------- */

  /** 销毁所有插件 (按注册逆序) */
  public async destroy(): Promise<void> {
    // 执行 onDestroy 钩子
    await this.executeHooks(HookType.OnDestroy, { type: HookType.OnDestroy });

    // 按注册逆序销毁 (使用生成器遍历)
    for (const { name, plugin } of this.iteratePluginsInReverse()) {
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
    this._initialized = false;
    this._status = PluginStatus.Destroyed;
  }

  /* ---------------------------- 信息查询 ---------------------------- */

  /** 获取插件信息列表 */
  public getPluginInfo(): Array<{
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly dependencies?: readonly string[];
  }> {
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
  public getPluginNameVersions(): PluginNameVersion[] {
    const result: PluginNameVersion[] = [];
    for (const { plugin } of this.iteratePluginsInOrder()) {
      result.push([plugin.meta.name, plugin.meta.version] as const);
    }
    return result;
  }

  /** 打印上次命令结果 (使用类型守卫窄化判别联合) */
  public describeLastResult(result: CommandResult): string {
    if (isSuccessResult(result)) {
      return `命令 "${result.command}" 执行成功`;
    }
    if (isErrorResult(result)) {
      return `命令 "${result.command}" 执行失败: ${result.error.message}`;
    }
    if (isNotFoundResult(result)) {
      return `命令 "${result.command}" 未找到`;
    }
    return describeResult(result);
  }

  /* ---------------------------- 生成器 ---------------------------- */

  /** 生成器: 按注册顺序迭代插件 */
  public *iteratePluginsInOrder(): Generator<{
    readonly name: string;
    readonly plugin: Plugin;
  }> {
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name);
      if (plugin) {
        yield { name, plugin };
      }
    }
  }

  /** 生成器: 按注册逆序迭代插件 */
  public *iteratePluginsInReverse(): Generator<{
    readonly name: string;
    readonly plugin: Plugin;
  }> {
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
  private createLogger(pluginName: string): Logger {
    const prefix = `\x1b[90m[${pluginName}]\x1b[0m`;
    const logger = {
      info: (msg: string): void => {
        console.log(`${prefix} \x1b[36mINFO\x1b[0m ${msg}`);
      },
      warn: (msg: string): void => {
        console.log(`${prefix} \x1b[33mWARN\x1b[0m ${msg}`);
      },
      error: (msg: string): void => {
        console.log(`${prefix} \x1b[31mERROR\x1b[0m ${msg}`);
      },
      debug: (msg: string): void => {
        console.log(`${prefix} \x1b[90mDEBUG\x1b[0m ${msg}`);
      },
    } satisfies Logger;
    return logger;
  }

  /** 创建插件上下文 */
  private createContext(pluginName: string): PluginContext {
    const manager = this;
    const context: PluginContext = {
      registerCommand: (command: Command): void => {
        manager.commandRegistry.register(command, pluginName);
      },
      registerHook: (type: HookType, callback: HookCallback): void => {
        let list = manager.hooks.get(type);
        if (!list) {
          list = [];
          manager.hooks.set(type, list);
        }
        list.push({ pluginName, callback });
      },
      emit: (event: string, data?: unknown): void => {
        manager.eventBus.emit(event, data);
      },
      on: (event: string, handler: EventHandler): void => {
        manager.eventBus.on(event, handler);
      },
      once: (event: string, handler: EventHandler): void => {
        manager.eventBus.once(event, handler);
      },
      getPlugin: (name: string): Plugin | undefined => {
        return manager.plugins.get(name);
      },
      write: (data: string): void => {
        process.stdout.write(data);
      },
      writeError: (data: string): void => {
        process.stderr.write(data);
      },
      logger: this.createLogger(pluginName),
    };
    return context;
  }
}

/* ---------------------------- 模块级工具函数 ---------------------------- */

/** 泛型: 将任意值断言为插件 (泛型 + 约束 + 类型守卫) */
export function assertPlugin<T extends Plugin>(
  value: unknown,
  predicate?: (p: Plugin) => p is T,
): T {
  if (!isPlugin(value)) {
    throw new Error("给定的值不是一个合法的 Plugin");
  }
  if (predicate !== undefined && !predicate(value)) {
    throw new Error("插件类型断言失败");
  }
  return value as T;
}

/** 过滤掉 undefined/null 并返回插件列表 (使用 isDefined 类型守卫) */
export function collectDefinedPlugins(
  plugins: Array<Plugin | undefined | null>,
): Plugin[] {
  return plugins.filter(isDefined);
}

/** 将可变上下文转为只读上下文 (使用 Mutable 映射类型) */
export function freezeContext(
  context: PluginContext,
): Readonly<Mutable<PluginContext>> {
  return Object.freeze({ ...context }) as Readonly<Mutable<PluginContext>>;
}
