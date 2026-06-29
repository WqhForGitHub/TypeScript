#!/usr/bin/env node

/*
 * CLI 插件化架构 - 入口文件
 *
 * 演示:
 *   - 函数重载 (parseArgs)
 *   - 判别联合 + 类型守卫 (ClassifiedCommand)
 *   - 生成器 / 迭代器 (pluginRegistrations)
 *   - as const 断言 (仅用于字面量)
 *   - 元组与只读元组 (ParsedCommandTuple)
 *   - 字符串枚举 (CommandKind)
 */

import { PluginManager } from "./core/plugin-manager";
import {
  CommandArgs,
  CommandKind,
  PluginRegister,
  ParsedCommandTuple,
} from "./core/types";
import { register as registerLogger } from "./plugins/logger";
import { register as registerGreet } from "./plugins/greet";
import { register as registerTime } from "./plugins/time";
import { register as registerCalc } from "./plugins/calc";

/* ============================== 内置命令 ============================== */

/** 内置命令名 (as const, 仅字面量) —— 用于 main 中的判别联合分类 */
const BUILTIN_NAMES = ["help", "h", "version"] as const;
type BuiltinName = (typeof BUILTIN_NAMES)[number];

/** 类型守卫: 判断字符串是否为内置命令名 */
function isBuiltinName(name: string): name is BuiltinName {
  return (BUILTIN_NAMES as readonly string[]).includes(name);
}

/** 命令分类 (判别联合, 以 kind 字段判别) */
type ClassifiedCommand =
  | {
      readonly kind: CommandKind.Builtin;
      readonly name: BuiltinName;
      readonly args: CommandArgs;
    }
  | {
      readonly kind: CommandKind.Plugin;
      readonly name: string;
      readonly args: CommandArgs;
    };

/** 类型守卫: 判断分类是否为内置命令 */
function isBuiltinClassified(
  c: ClassifiedCommand,
): c is Extract<ClassifiedCommand, { readonly kind: CommandKind.Builtin }> {
  return c.kind === CommandKind.Builtin;
}

/** 将命令名分类为内置或插件 (返回判别联合) */
function classifyCommand(
  command: string,
  args: CommandArgs,
): ClassifiedCommand {
  if (isBuiltinName(command)) {
    return { kind: CommandKind.Builtin, name: command, args };
  }
  return { kind: CommandKind.Plugin, name: command, args };
}

/** 内置 help 命令 */
function builtinHelp(manager: PluginManager): void {
  const registry = manager.getCommandRegistry();
  console.log(registry.generateHelp());
  console.log();
  console.log("\x1b[1m内置命令:\x1b[0m");
  console.log("─".repeat(60));
  console.log("  \x1b[36mhelp\x1b[0m                      显示帮助信息");
  console.log("  \x1b[36mversion\x1b[0m  (-v, --version)  显示版本号");
  console.log("  \x1b[36mplugins\x1b[0m                   列出已加载插件");
  console.log("─".repeat(60));
  console.log();
  console.log(
    "\x1b[90m提示: 每个命令可通过 <command> --help 查看详细用法\x1b[0m",
  );
}

/** 内置 version 命令 */
function builtinVersion(): void {
  console.log("\x1b[36mCLI 插件化架构 Demo v1.0.0\x1b[0m");
}

/* ============================== 参数解析 (函数重载) ============================== */

/**
 * 简易命令行参数解析器
 * - 第一个非选项参数为命令名
 * - --flag 形式的布尔选项
 * - --key value 形式的字符串选项
 * - 其余为位置参数
 */
function parseArgs(argv: readonly string[]): {
  command: string;
  args: CommandArgs;
};
function parseArgs(argv: readonly string[], asTuple: true): ParsedCommandTuple;
function parseArgs(
  argv: readonly string[],
  asTuple?: true,
): { command: string; args: CommandArgs } | ParsedCommandTuple {
  // 可变的内部构建结构 (CommandArgs 的字段是 readonly, 内部用可变副本构建)
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // 检查下一个参数是否是值（而非另一个选项）
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        options[key] = argv[i + 1];
        i += 2;
      } else {
        options[key] = true;
        i += 1;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      options[key] = true;
      i += 1;
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  const command = positional.shift() ?? "";
  const args: CommandArgs = { positional, options };

  if (asTuple === true) {
    return [command, args] as const;
  }
  return { command, args };
}

/* ============================== 生成器: 插件注册顺序 ============================== */

/** 生成器: 按顺序产出插件注册函数 (保证注册顺序: logger 最先) */
function* pluginRegistrations(): Generator<PluginRegister> {
  yield registerLogger;
  yield registerGreet;
  yield registerTime;
  yield registerCalc;
}

/* ============================== REPL 模式 ============================== */

/** 交互式 REPL */
function startRepl(manager: PluginManager): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[35mpluggy> \x1b[0m",
  });

  console.log(
    "\x1b[90m输入命令进行交互，输入 help 查看帮助，输入 exit 退出\x1b[0m",
  );
  console.log();

  rl.prompt();

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === "exit" || trimmed === "quit") {
      console.log("\x1b[36m再见!\x1b[0m");
      await manager.destroy();
      process.exit(0);
    }

    const tokens = trimmed.split(/\s+/);
    const { command, args } = parseArgs(tokens);

    // REPL 内置命令 (保持与原版一致: help / version / v)
    if (command === "help") {
      builtinHelp(manager);
    } else if (command === "version" || command === "v") {
      builtinVersion();
    } else {
      await manager.executeCommand(command, args);
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", async () => {
    console.log();
    await manager.destroy();
    process.exit(0);
  });
}

/* ============================== 入口 ============================== */

async function main(): Promise<void> {
  const manager = new PluginManager();

  // 通过生成器按顺序注册内置插件 (logger 最先, calc 依赖 logger)
  for (const register of pluginRegistrations()) {
    manager.register(register());
  }

  // 初始化所有插件
  await manager.init();

  // 解析命令行参数
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    // 无参数时进入 REPL 模式
    startRepl(manager);
    return;
  }

  const { command, args } = parseArgs(argv);

  // --help 标志: 优先级最高, 任意命令均可触发
  if (args.options.help === true) {
    builtinHelp(manager);
    await manager.destroy();
    return;
  }

  // --version / -v 标志
  if (args.options.v === true || args.options.version === true) {
    builtinVersion();
    await manager.destroy();
    return;
  }

  // 使用判别联合分类命令 (演示类型守卫窄化)
  const classified = classifyCommand(command, args);

  if (isBuiltinClassified(classified)) {
    // 内置命令: help / h / version
    if (classified.name === "help" || classified.name === "h") {
      builtinHelp(manager);
    } else {
      builtinVersion();
    }
  } else {
    // 插件命令
    await manager.executeCommand(classified.name, classified.args);
  }

  // 销毁
  await manager.destroy();
}

main().catch((err) => {
  console.error("\x1b[31m致命错误:\x1b[0m", err);
  process.exit(1);
});
