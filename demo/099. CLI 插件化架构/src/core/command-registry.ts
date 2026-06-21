import { Command, CommandArgs } from './types';

/* ============================== 命令注册表 ============================== */

/**
 * 命令注册表
 * - 管理所有插件注册的命令
 * - 支持命令名称和别名查找
 * - 提供命令列表与帮助信息
 */
export class CommandRegistry {
  /** 命令名称 -> 命令定义 */
  private commands: Map<string, Command> = new Map();
  /** 别名 -> 命令名称 */
  private aliases: Map<string, string> = new Map();
  /** 命令名称 -> 注册来源插件 */
  private sources: Map<string, string> = new Map();

  /** 注册一条命令 */
  register(command: Command, pluginName: string): void {
    // 检查命令名称是否已存在
    if (this.commands.has(command.name)) {
      throw new Error(
        `命令 "${command.name}" 已被插件 "${this.sources.get(command.name)}" 注册，` +
        `插件 "${pluginName}" 无法重复注册`
      );
    }

    // 检查别名是否冲突
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.aliases.has(alias)) {
          const existingCmd = this.aliases.get(alias)!;
          throw new Error(
            `别名 "${alias}" 已被命令 "${existingCmd}" 使用，` +
            `插件 "${pluginName}" 的命令 "${command.name}" 无法使用该别名`
          );
        }
        this.aliases.set(alias, command.name);
      }
    }

    this.commands.set(command.name, command);
    this.sources.set(command.name, pluginName);
  }

  /** 注销一条命令 */
  unregister(commandName: string): boolean {
    const command = this.commands.get(commandName);
    if (!command) return false;

    // 清除别名映射
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.delete(alias);
      }
    }

    this.commands.delete(commandName);
    this.sources.delete(commandName);
    return true;
  }

  /** 查找命令（支持别名） */
  resolve(nameOrAlias: string): Command | undefined {
    const direct = this.commands.get(nameOrAlias);
    if (direct) return direct;

    const aliasTarget = this.aliases.get(nameOrAlias);
    if (aliasTarget) return this.commands.get(aliasTarget);

    return undefined;
  }

  /** 获取所有已注册命令 */
  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /** 获取命令的来源插件 */
  getSource(commandName: string): string | undefined {
    return this.sources.get(commandName);
  }

  /** 生成帮助文本 */
  generateHelp(): string {
    const lines: string[] = [];
    lines.push('\x1b[1m可用命令:\x1b[0m');
    lines.push('─'.repeat(60));

    const commands = this.getAll();
    if (commands.length === 0) {
      lines.push('  (无已注册命令)');
      return lines.join('\n');
    }

    // 计算最大命令名宽度用于对齐
    let maxNameLen = 0;
    for (const cmd of commands) {
      const nameStr = cmd.aliases?.length
        ? `${cmd.name} (${cmd.aliases.join(', ')})`
        : cmd.name;
      maxNameLen = Math.max(maxNameLen, nameStr.length);
    }

    for (const cmd of commands) {
      const nameStr = cmd.aliases?.length
        ? `${cmd.name} (${cmd.aliases.join(', ')})`
        : cmd.name;
      const source = this.sources.get(cmd.name) ?? '';
      const padded = nameStr.padEnd(maxNameLen + 2);
      lines.push(`  \x1b[36m${padded}\x1b[0m ${cmd.description}  \x1b[90m[${source}]\x1b[0m`);
    }

    lines.push('─'.repeat(60));
    return lines.join('\n');
  }
}
