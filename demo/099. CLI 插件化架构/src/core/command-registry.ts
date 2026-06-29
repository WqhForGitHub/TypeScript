/* ============================== 命令注册表 ============================== */
/*
 * 演示:
 *   - 泛型与约束 (generics with constraints)
 *   - 函数重载 (function overloads)
 *   - 生成器 / 迭代器 (generators / Iterable)
 *   - 元组与只读元组 (tuple / readonly tuple)
 *   - 判别联合 + 类型守卫
 *   - Getter
 *   - 自定义错误层次结构
 */

import {
  Command,
  CommandArgs,
  CommandEntry,
  CommandKind,
  CommandSourceTuple,
  isBuiltinEntry,
  isPluginEntry,
} from "./types";
import {
  CommandAlreadyRegisteredError,
  CommandAliasConflictError,
  CommandNotFoundError,
} from "./errors";

/** 命令查找结果 (判别联合) */
type ResolveResult =
  | {
      readonly kind: CommandKind.Builtin;
      readonly entry: Extract<
        CommandEntry,
        { readonly kind: CommandKind.Builtin }
      >;
    }
  | {
      readonly kind: CommandKind.Plugin;
      readonly entry: Extract<
        CommandEntry,
        { readonly kind: CommandKind.Plugin }
      >;
    }
  | { readonly kind: "missing"; readonly name: string };

/**
 * 命令注册表
 * - 管理所有插件注册的命令
 * - 支持命令名称与别名查找
 * - 提供命令列表与帮助信息
 */
export class CommandRegistry implements Iterable<Command> {
  /** 命令名称 -> 命令定义 */
  private readonly commands: Map<string, Command> = new Map();
  /** 别名 -> 命令名称 */
  private readonly aliases: Map<string, string> = new Map();
  /** 命令名称 -> 注册来源插件 */
  private readonly sources: Map<string, string> = new Map();
  /** 命令名称 -> 来源分类 (builtin / plugin) */
  private readonly kinds: Map<string, CommandKind> = new Map();

  /* ---------------------------- Getters ---------------------------- */

  /** 已注册命令数量 (getter) */
  public get count(): number {
    return this.commands.size;
  }

  /** 是否为空 (getter) */
  public get empty(): boolean {
    return this.commands.size === 0;
  }

  /* ---------------------------- 注册 ---------------------------- */

  /** 注册一条命令 (默认为 plugin 来源) */
  public register(command: Command, pluginName: string): void;
  /** 注册一条命令并指定来源分类 (重载) */
  public register(
    command: Command,
    pluginName: string,
    kind: CommandKind,
  ): void;
  /** register 实现 */
  public register(
    command: Command,
    pluginName: string,
    kind: CommandKind = CommandKind.Plugin,
  ): void {
    // 检查命令名称是否已存在
    if (this.commands.has(command.name)) {
      const existingSource = this.sources.get(command.name) ?? "unknown";
      throw new CommandAlreadyRegisteredError(
        command.name,
        existingSource,
        pluginName,
      );
    }

    // 检查别名是否冲突
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.aliases.has(alias)) {
          const existingCmd = this.aliases.get(alias)!;
          throw new CommandAliasConflictError(
            alias,
            existingCmd,
            command.name,
            pluginName,
          );
        }
        this.aliases.set(alias, command.name);
      }
    }

    this.commands.set(command.name, command);
    this.sources.set(command.name, pluginName);
    this.kinds.set(command.name, kind);
  }

  /** 注销一条命令 */
  public unregister(commandName: string): boolean {
    const command = this.commands.get(commandName);
    if (!command) return false;

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.delete(alias);
      }
    }

    this.commands.delete(commandName);
    this.sources.delete(commandName);
    this.kinds.delete(commandName);
    return true;
  }

  /* ---------------------------- 函数重载: resolve ---------------------------- */

  /** 查找命令 (支持别名), 找不到返回 undefined */
  public resolve(nameOrAlias: string): Command | undefined;
  /** 查找命令, 找不到时抛出 (重载) */
  public resolve(nameOrAlias: string, throwIfMissing: true): Command;
  /** resolve 实现 */
  public resolve(
    nameOrAlias: string,
    throwIfMissing?: boolean,
  ): Command | undefined {
    const direct = this.commands.get(nameOrAlias);
    if (direct) return direct;

    const aliasTarget = this.aliases.get(nameOrAlias);
    if (aliasTarget) return this.commands.get(aliasTarget);

    if (throwIfMissing) {
      throw new CommandNotFoundError(nameOrAlias);
    }
    return undefined;
  }

  /** 解析命令条目 (返回判别联合, 含来源分类) */
  public resolveEntry(nameOrAlias: string): ResolveResult {
    const command = this.resolve(nameOrAlias);
    if (!command) {
      return { kind: "missing" as const, name: nameOrAlias };
    }
    const source = this.sources.get(command.name) ?? "unknown";
    const kind = this.kinds.get(command.name) ?? CommandKind.Plugin;
    if (kind === CommandKind.Builtin) {
      return {
        kind: CommandKind.Builtin,
        entry: { kind: CommandKind.Builtin, command, source: "builtin" },
      };
    }
    return {
      kind: CommandKind.Plugin,
      entry: { kind: CommandKind.Plugin, command, source },
    };
  }

  /* ---------------------------- 查询 ---------------------------- */

  /** 获取所有已注册命令 */
  public getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /** 获取命令的来源插件 */
  public getSource(commandName: string): string | undefined {
    return this.sources.get(commandName);
  }

  /** 获取命令来源分类 */
  public getKind(commandName: string): CommandKind | undefined {
    return this.kinds.get(commandName);
  }

  /** 判断命令是否存在 */
  public has(nameOrAlias: string): boolean {
    return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias);
  }

  /* ---------------------------- 生成器 / 迭代器 ---------------------------- */

  /** 实现 Iterable 协议: 迭代所有命令 */
  public *[Symbol.iterator](): Iterator<Command> {
    for (const cmd of this.commands.values()) {
      yield cmd;
    }
  }

  /** 生成器: 迭代所有命令条目 (判别联合) */
  public *entries(): Generator<CommandEntry> {
    for (const [name, command] of this.commands) {
      const source = this.sources.get(name) ?? "unknown";
      const kind = this.kinds.get(name) ?? CommandKind.Plugin;
      if (kind === CommandKind.Builtin) {
        yield {
          kind: CommandKind.Builtin,
          command,
          source: "builtin" as const,
        };
      } else {
        yield { kind: CommandKind.Plugin, command, source };
      }
    }
  }

  /** 生成器: 迭代命令名 + 来源 (只读元组) */
  public *sourcesEntries(): Generator<CommandSourceTuple> {
    for (const [name, source] of this.sources) {
      yield [name, source] as const;
    }
  }

  /** 生成器: 仅迭代 builtin 命令条目 (使用类型守卫) */
  public *builtinEntries(): Generator<
    Extract<CommandEntry, { readonly kind: CommandKind.Builtin }>
  > {
    for (const entry of this.entries()) {
      if (isBuiltinEntry(entry)) {
        yield entry;
      }
    }
  }

  /** 生成器: 仅迭代 plugin 命令条目 (使用类型守卫) */
  public *pluginEntries(): Generator<
    Extract<CommandEntry, { readonly kind: CommandKind.Plugin }>
  > {
    for (const entry of this.entries()) {
      if (isPluginEntry(entry)) {
        yield entry;
      }
    }
  }

  /* ---------------------------- 帮助文本 ---------------------------- */

  /** 生成帮助文本 */
  public generateHelp(): string {
    const lines: string[] = [];
    lines.push("\x1b[1m可用命令:\x1b[0m");
    lines.push("─".repeat(60));

    const commands = this.getAll();
    if (commands.length === 0) {
      lines.push("  (无已注册命令)");
      return lines.join("\n");
    }

    // 计算最大命令名宽度用于对齐
    let maxNameLen = 0;
    for (const cmd of commands) {
      const nameStr = this.formatCommandName(cmd);
      maxNameLen = Math.max(maxNameLen, nameStr.length);
    }

    for (const cmd of commands) {
      const nameStr = this.formatCommandName(cmd);
      const source = this.sources.get(cmd.name) ?? "";
      const padded = nameStr.padEnd(maxNameLen + 2);
      lines.push(
        `  \x1b[36m${padded}\x1b[0m ${cmd.description}  \x1b[90m[${source}]\x1b[0m`,
      );
    }

    lines.push("─".repeat(60));
    return lines.join("\n");
  }

  /* ---------------------------- 私有工具 ---------------------------- */

  /** 格式化命令名 (含别名) */
  private formatCommandName(cmd: Command): string {
    return cmd.aliases?.length
      ? `${cmd.name} (${cmd.aliases.join(", ")})`
      : cmd.name;
  }

  /** 泛型: 查找满足谓词的命令 (泛型 + 约束) */
  public findCommand<T extends Command>(
    predicate: (cmd: Command) => cmd is T,
  ): T | undefined {
    for (const cmd of this.commands.values()) {
      if (predicate(cmd)) return cmd;
    }
    return undefined;
  }

  /** 泛型: 过滤命令 (泛型 + 约束) */
  public filterCommands<T extends Command>(
    predicate: (cmd: Command) => cmd is T,
  ): T[] {
    const result: T[] = [];
    for (const cmd of this.commands.values()) {
      if (predicate(cmd)) result.push(cmd);
    }
    return result;
  }
}

/** 模块级类型守卫: 判断 ResolveResult 是否为 plugin 来源 */
export function isPluginResolveResult(
  r: ResolveResult,
): r is Extract<ResolveResult, { readonly kind: CommandKind.Plugin }> {
  return r.kind === CommandKind.Plugin;
}

/** 模块级类型守卫: 判断 ResolveResult 是否未找到 */
export function isMissingResolveResult(
  r: ResolveResult,
): r is Extract<ResolveResult, { readonly kind: "missing" }> {
  return r.kind === "missing";
}
