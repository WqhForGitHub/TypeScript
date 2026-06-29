/* ============================== 日志插件 ============================== */
/*
 * 演示:
 *   - 抽象基类的具体子类 (LoggerPlugin extends BasePlugin)
 *   - 判别联合 + 类型守卫 (HookPayload / LogEntry)
 *   - 字符串枚举 (LogCategory)
 *   - 生成器 / 迭代器
 *   - Getter
 *   - satisfies 操作符
 *   - as const 断言 (仅用于字面量)
 */

import {
  Plugin,
  PluginContext,
  PluginMeta,
  Command,
  HookType,
  HookPayload,
  isBeforeCommandPayload,
  isOnErrorPayload,
  isDefined,
  isPlugin,
} from "../core/types";
import { BasePlugin } from "../core/base-plugin";

/** 日志分类 (string enum) */
enum LogCategory {
  Command = "COMMAND",
  Error = "ERROR",
  Calc = "CALC",
  Timer = "TIMER",
  System = "SYSTEM",
}

/** 日志条目 (判别联合) */
type LogEntry =
  | {
      readonly kind: "simple";
      readonly time: string;
      readonly category: LogCategory;
      readonly message: string;
    }
  | {
      readonly kind: "detailed";
      readonly time: string;
      readonly category: LogCategory;
      readonly message: string;
      readonly detail: Record<string, unknown>;
    };

/** 类型守卫: 判断日志是否为 detailed */
function isDetailedLog(
  entry: LogEntry,
): entry is Extract<LogEntry, { readonly kind: "detailed" }> {
  return entry.kind === "detailed";
}

/** calc 运算事件载荷 */
interface CalcOperationEvent {
  readonly operation: string;
  readonly a: number;
  readonly b: number;
  readonly result: number;
}

/** 计时器启动事件载荷 */
interface TimerStartedEvent {
  readonly name: string;
  readonly timestamp?: number;
}

/** 计时器停止事件载荷 */
interface TimerStoppedEvent {
  readonly name: string;
  readonly elapsed: number;
  readonly timestamp?: number;
}

/** 类型守卫: 判断数据是否为 calc 运算事件 */
function isCalcOperationEvent(data: unknown): data is CalcOperationEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.operation === "string" &&
    typeof d.a === "number" &&
    typeof d.b === "number" &&
    typeof d.result === "number"
  );
}

/** 类型守卫: 判断数据是否为计时器启动事件 */
function isTimerStartedEvent(data: unknown): data is TimerStartedEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.name === "string";
}

/** 类型守卫: 判断数据是否为计时器停止事件 */
function isTimerStoppedEvent(data: unknown): data is TimerStoppedEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.name === "string" && typeof d.elapsed === "number";
}

/** 用户登录事件载荷 */
interface UserLoginEvent {
  readonly name: string;
}

/** 类型守卫: 判断数据是否为用户登录事件 */
function isUserLoginEvent(data: unknown): data is UserLoginEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.name === "string";
}

/** 各分类对应的颜色 (as const 断言, 仅字面量) */
const CATEGORY_COLORS = {
  [LogCategory.Command]: "\x1b[90m",
  [LogCategory.Error]: "\x1b[31m",
  [LogCategory.Calc]: "\x1b[33m",
  [LogCategory.Timer]: "\x1b[36m",
  [LogCategory.System]: "\x1b[90m",
} as const;

/** 已知插件名 (as const 断言) */
const KNOWN_PLUGIN_NAMES = ["logger", "greet", "time", "calc"] as const;
type KnownPluginName = (typeof KNOWN_PLUGIN_NAMES)[number];

/**
 * LoggerPlugin
 * - 提供全局日志记录功能
 * - 通过钩子监听所有命令执行，记录操作日志
 * - 监听 calc 插件事件记录运算日志
 * - 其他插件可声明对 logger 的依赖
 */
class LoggerPlugin extends BasePlugin {
  /** 操作日志缓存 (私有) */
  private readonly logs: LogEntry[] = [];

  /** 日志数量上限 */
  private readonly maxLogs = 500;

  /** 元信息 (satisfies 校验) */
  public readonly meta: PluginMeta = {
    name: "logger",
    version: "1.0.0",
    description: "日志插件 - 记录所有命令执行与操作日志",
  } satisfies PluginMeta;

  /* ---------------------------- Getters ---------------------------- */

  /** 当前日志条数 (getter) */
  public get logCount(): number {
    return this.logs.length;
  }

  /** 是否有日志 (getter) */
  public get hasLogs(): boolean {
    return this.logs.length > 0;
  }

  /* ---------------------------- 生命周期 ---------------------------- */

  /** 初始化 */
  protected onInit(context: PluginContext): void {
    // 注册 beforeCommand 钩子 - 记录命令调用 (使用类型守卫窄化)
    this.registerHook(HookType.BeforeCommand, (payload: HookPayload) => {
      if (!isBeforeCommandPayload(payload)) return;
      const argsStr = payload.args.positional.join(" ");
      this.addLog(
        LogCategory.Command,
        `执行命令: ${payload.command}${argsStr ? " " + argsStr : ""}`.trim(),
      );
    });

    // 注册 onError 钩子 - 记录错误 (使用类型守卫窄化)
    this.registerHook(HookType.OnError, (payload: HookPayload) => {
      if (!isOnErrorPayload(payload)) return;
      this.addLog(LogCategory.Error, `错误: ${payload.error.message}`);
    });

    // 监听 calc 插件的运算事件 (使用类型守卫)
    this.on("calc:operation", (data: unknown) => {
      if (!isCalcOperationEvent(data)) return;
      this.addLog(
        LogCategory.Calc,
        `${data.a} ${data.operation} ${data.b} = ${data.result}`,
      );
    });

    // 监听计时器事件 (使用类型守卫)
    this.on("timer:started", (data: unknown) => {
      if (!isTimerStartedEvent(data)) return;
      this.addLog(LogCategory.Timer, `计时器 "${data.name}" 已启动`);
    });

    this.on("timer:stopped", (data: unknown) => {
      if (!isTimerStoppedEvent(data)) return;
      this.addLog(
        LogCategory.Timer,
        `计时器 "${data.name}" 已停止, 耗时 ${(data.elapsed / 1000).toFixed(2)}s`,
      );
    });

    // 注册日志查看命令 (satisfies 校验)
    const logsCommand = {
      name: "logs",
      aliases: ["history"],
      description: "查看操作日志",
      usage: "logs [--clear]",
      handler: (args: {
        readonly options: Readonly<Record<string, string | boolean>>;
      }): void => {
        const shouldClear = args.options.clear === true;
        if (shouldClear) {
          const count = this.logs.length;
          this.logs.length = 0;
          console.log(`\x1b[33m已清除 ${count} 条日志\x1b[0m`);
          return;
        }
        this.printLogs();
      },
    } satisfies Command;
    this.registerCommand(logsCommand);

    // 注册插件信息命令 (satisfies 校验)
    const pluginsCommand = {
      name: "plugins",
      aliases: ["list-plugins", "ls-plugins"],
      description: "列出所有已加载插件",
      handler: (): void => {
        this.printPlugins(context);
      },
    } satisfies Command;
    this.registerCommand(pluginsCommand);
  }

  /* ---------------------------- 日志操作 ---------------------------- */

  /** 添加日志条目 */
  private addLog(
    category: LogCategory,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const entry: LogEntry =
      detail !== undefined
        ? { kind: "detailed", time, category, message, detail }
        : { kind: "simple", time, category, message };

    this.logs.push(entry);

    // 超过上限时丢弃最旧的日志
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /** 打印日志 (使用生成器迭代) */
  private printLogs(): void {
    if (this.logs.length === 0) {
      console.log("\x1b[33m暂无日志记录\x1b[0m");
      return;
    }

    console.log(`\x1b[1m操作日志 (${this.logs.length} 条):\x1b[0m`);
    console.log("─".repeat(60));

    for (const log of this.iterateLogs()) {
      const color = CATEGORY_COLORS[log.category] ?? "\x1b[90m";
      const detailSuffix = isDetailedLog(log)
        ? ` ${JSON.stringify(log.detail)}`
        : "";
      console.log(
        `  \x1b[90m${log.time}\x1b[0m ${color}[${log.category}]\x1b[0m ${log.message}${detailSuffix}`,
      );
    }

    console.log("─".repeat(60));
  }

  /** 生成器: 迭代所有日志条目 */
  public *iterateLogs(): Generator<LogEntry> {
    for (const entry of this.logs) {
      yield entry;
    }
  }

  /** 生成器: 按分类迭代日志 */
  public *iterateLogsByCategory(category: LogCategory): Generator<LogEntry> {
    for (const entry of this.logs) {
      if (entry.category === category) {
        yield entry;
      }
    }
  }

  /** 打印已加载插件列表 (使用类型守卫过滤) */
  private printPlugins(context: PluginContext): void {
    console.log("\x1b[1m已加载插件:\x1b[0m");
    console.log("─".repeat(50));

    // 迭代已知插件名 (as const 数组 -> name 为 KnownPluginName 字面量联合)
    for (const name of KNOWN_PLUGIN_NAMES) {
      const plugin = context.getPlugin(name);
      // 使用 isDefined 类型守卫排除 undefined
      if (!isDefined(plugin)) continue;
      // 使用 isPlugin 类型守卫确保类型安全
      if (!isPlugin(plugin)) continue;

      const deps = plugin.meta.dependencies?.length
        ? `\x1b[90m (依赖: ${plugin.meta.dependencies.join(", ")})\x1b[0m`
        : "";
      console.log(
        `  \x1b[36m${plugin.meta.name}\x1b[0m v${plugin.meta.version} - ${plugin.meta.description}${deps}`,
      );
    }

    console.log("─".repeat(50));
  }
}

/* ---------------------------- 模块导出 ---------------------------- */

/** 插件注册函数 (约定导出) */
export function register(): Plugin {
  return new LoggerPlugin();
}

/** 重新导出类型守卫以供其它模块复用 */
export {
  isCalcOperationEvent,
  isTimerStartedEvent,
  isTimerStoppedEvent,
  isUserLoginEvent,
  isDetailedLog,
};
export type {
  CalcOperationEvent,
  TimerStartedEvent,
  TimerStoppedEvent,
  UserLoginEvent,
  LogEntry,
};
