/* ============================== 抽象插件基类 ============================== */
/*
 * 演示: 抽象类 (abstract class) 与具体子类。
 * BasePlugin 实现了 Plugin 接口的通用生命周期管理，
 * 各具体插件 (LoggerPlugin / GreetPlugin / TimePlugin / CalcPlugin)
 * 继承 BasePlugin 并实现抽象方法 onInit / onDestroy。
 */

import {
  Plugin,
  PluginContext,
  PluginMeta,
  PluginStatus,
  PLUGIN_INTERNAL,
  PluginInternalState,
  Command,
  HookType,
  HookCallback,
  EventHandler,
  Logger,
} from "./types";
import { PluginNotInitializedError } from "./errors";

/**
 * 抽象插件基类
 * - 封装通用的生命周期: init / destroy / 状态管理
 * - 暴露 protected getter/setter 给子类访问上下文
 * - 使用 symbol 作为内部状态属性键
 */
export abstract class BasePlugin implements Plugin {
  /** 抽象: 子类必须声明插件元信息 */
  public abstract readonly meta: PluginMeta;

  /** 内部上下文 (私有) */
  private _context: PluginContext | null = null;

  /** 内部状态 (私有) */
  private _status: PluginStatus = PluginStatus.Registered;

  /** 使用 unique symbol 作为内部状态属性键 (字段初始化器) */
  public readonly [PLUGIN_INTERNAL]: PluginInternalState = {
    initialized: false,
    registeredAt: Date.now(),
    status: PluginStatus.Registered,
  };

  /* ---------------------------- Getters / Setters ---------------------------- */

  /** 插件当前状态 (getter) */
  public get status(): PluginStatus {
    return this._status;
  }

  /** 插件是否已初始化 (getter) */
  public get initialized(): boolean {
    return this._context !== null;
  }

  /** 受保护的上下文访问器 (getter) —— 子类通过 this.context 访问 */
  protected get context(): PluginContext {
    if (this._context === null) {
      throw new PluginNotInitializedError(this.meta.name);
    }
    return this._context;
  }

  /** 受保护的上下文设置器 (setter) */
  protected set context(ctx: PluginContext | null) {
    this._context = ctx;
  }

  /* ---------------------------- 生命周期 ---------------------------- */

  /** 初始化 (模板方法: 记录状态后调用子类 onInit) */
  public async init(context: PluginContext): Promise<void> {
    this._context = context;
    this._status = PluginStatus.Initialized;
    this[PLUGIN_INTERNAL].initialized = true;
    this[PLUGIN_INTERNAL].status = PluginStatus.Initialized;
    await this.onInit(context);
  }

  /** 销毁 (模板方法: 调用子类 onDestroy 后清理) */
  public async destroy(): Promise<void> {
    await this.onDestroy?.();
    this._context = null;
    this._status = PluginStatus.Destroyed;
    this[PLUGIN_INTERNAL].initialized = false;
    this[PLUGIN_INTERNAL].status = PluginStatus.Destroyed;
  }

  /** 抽象: 子类实现具体的初始化逻辑 */
  protected abstract onInit(context: PluginContext): void | Promise<void>;

  /** 钩子: 子类可选实现销毁逻辑 */
  protected onDestroy?(): void | Promise<void>;

  /* ---------------------------- 便捷方法 (供子类使用) ---------------------------- */

  /** 注册命令 (转发到上下文) */
  protected registerCommand(command: Command): void {
    this.context.registerCommand(command);
  }

  /** 注册钩子 (转发到上下文) */
  protected registerHook(type: HookType, callback: HookCallback): void {
    this.context.registerHook(type, callback);
  }

  /** 监听事件 (转发到上下文) */
  protected on(event: string, handler: EventHandler): void {
    this.context.on(event, handler);
  }

  /** 一次性监听事件 (转发到上下文) */
  protected once(event: string, handler: EventHandler): void {
    this.context.once(event, handler);
  }

  /** 发送事件 (转发到上下文) */
  protected emit(event: string, data?: unknown): void {
    this.context.emit(event, data);
  }

  /** 获取其它插件 (转发到上下文) */
  protected getPlugin(name: string): Plugin | undefined {
    return this.context.getPlugin(name);
  }

  /** 获取日志工具 (转发到上下文) */
  protected get logger(): Logger {
    return this.context.logger;
  }
}
