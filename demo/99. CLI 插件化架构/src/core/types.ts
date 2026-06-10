/* ============================== 核心类型定义 ============================== */

/** 命令参数 */
export interface CommandArgs {
  /** 位置参数 */
  positional: string[];
  /** 命名参数/选项 */
  options: Record<string, string | boolean>;
}

/** 命令定义 */
export interface Command {
  /** 命令名称 */
  name: string;
  /** 命令别名 */
  aliases?: string[];
  /** 命令描述 */
  description: string;
  /** 用法说明 */
  usage?: string;
  /** 命令处理函数 */
  handler: (args: CommandArgs, context: PluginContext) => void | Promise<void>;
}

/** 钩子类型 */
export type HookType = 'beforeCommand' | 'afterCommand' | 'onInit' | 'onDestroy' | 'onError';

/** 钩子回调函数 */
export type HookCallback = (payload: HookPayload) => void | Promise<void>;

/** 钩子载荷 */
export interface HookPayload {
  /** 钩子类型 */
  type: HookType;
  /** 触发来源插件 */
  source?: string;
  /** 命令名称（command相关钩子） */
  command?: string;
  /** 命令参数（command相关钩子） */
  args?: CommandArgs;
  /** 执行结果（afterCommand） */
  result?: unknown;
  /** 错误信息（onError） */
  error?: Error;
  /** 额外数据 */
  data?: Record<string, unknown>;
}

/** 插件元信息 */
export interface PluginMeta {
  /** 插件名称（唯一标识） */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description: string;
  /** 依赖的其他插件 */
  dependencies?: string[];
}

/** 插件上下文 - 插件与宿主交互的接口 */
export interface PluginContext {
  /** 注册命令 */
  registerCommand: (command: Command) => void;
  /** 注册钩子 */
  registerHook: (type: HookType, callback: HookCallback) => void;
  /** 发送事件 */
  emit: (event: string, data?: unknown) => void;
  /** 监听事件 */
  on: (event: string, handler: EventHandler) => void;
  /** 获取其他插件 */
  getPlugin: (name: string) => Plugin | undefined;
  /** 写入标准输出 */
  write: (data: string) => void;
  /** 写入标准错误 */
  writeError: (data: string) => void;
  /** 日志工具 */
  logger: Logger;
}

/** 事件处理函数 */
export type EventHandler = (data?: unknown) => void;

/** 日志接口 */
export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** 插件接口 */
export interface Plugin {
  /** 插件元信息 */
  meta: PluginMeta;
  /** 初始化 */
  init: (context: PluginContext) => void | Promise<void>;
  /** 销毁 */
  destroy?: () => void | Promise<void>;
}

/** 插件注册函数类型 - 约定每个插件模块导出一个 register 函数 */
export type PluginRegister = () => Plugin;
