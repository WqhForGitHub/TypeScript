#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_manager_1 = require("./core/plugin-manager");
/* ============================== 内置命令 ============================== */
/** 内置 help 命令 */
function builtinHelp(manager) {
    const registry = manager.getCommandRegistry();
    console.log(registry.generateHelp());
    console.log();
    console.log('\x1b[1m内置命令:\x1b[0m');
    console.log('─'.repeat(60));
    console.log('  \x1b[36mhelp\x1b[0m                      显示帮助信息');
    console.log('  \x1b[36mversion\x1b[0m  (-v, --version)  显示版本号');
    console.log('  \x1b[36mplugins\x1b[0m                   列出已加载插件');
    console.log('─'.repeat(60));
    console.log();
    console.log('\x1b[90m提示: 每个命令可通过 <command> --help 查看详细用法\x1b[0m');
}
/** 内置 version 命令 */
function builtinVersion() {
    console.log('\x1b[36mCLI 插件化架构 Demo v1.0.0\x1b[0m');
}
/* ============================== 参数解析 ============================== */
/**
 * 简易命令行参数解析器
 * - 第一个非选项参数为命令名
 * - --flag 形式的布尔选项
 * - --key value 形式的字符串选项
 * - 其余为位置参数
 */
function parseArgs(argv) {
    const positional = [];
    const options = {};
    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            // 检查下一个参数是否是值（而非另一个选项）
            if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
                options[key] = argv[i + 1];
                i += 2;
            }
            else {
                options[key] = true;
                i += 1;
            }
        }
        else if (arg.startsWith('-') && arg.length === 2) {
            const key = arg.slice(1);
            options[key] = true;
            i += 1;
        }
        else {
            positional.push(arg);
            i += 1;
        }
    }
    const command = positional.shift() ?? '';
    return { command, args: { positional, options } };
}
/* ============================== REPL 模式 ============================== */
/** 交互式 REPL */
function startRepl(manager) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\x1b[35mpluggy> \x1b[0m',
    });
    console.log('\x1b[90m输入命令进行交互，输入 help 查看帮助，输入 exit 退出\x1b[0m');
    console.log();
    rl.prompt();
    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }
        if (trimmed === 'exit' || trimmed === 'quit') {
            console.log('\x1b[36m再见!\x1b[0m');
            await manager.destroy();
            process.exit(0);
        }
        const tokens = trimmed.split(/\s+/);
        const { command, args } = parseArgs(tokens);
        if (command === 'help') {
            builtinHelp(manager);
        }
        else if (command === 'version' || command === 'v') {
            builtinVersion();
        }
        else {
            await manager.executeCommand(command, args);
        }
        console.log();
        rl.prompt();
    });
    rl.on('close', async () => {
        console.log();
        await manager.destroy();
        process.exit(0);
    });
}
/* ============================== 入口 ============================== */
async function main() {
    const manager = new plugin_manager_1.PluginManager();
    // 注册内置插件（注意顺序：logger 最先，因为 calc 依赖 logger）
    const { register: registerLogger } = require('./plugins/logger');
    const { register: registerGreet } = require('./plugins/greet');
    const { register: registerTime } = require('./plugins/time');
    const { register: registerCalc } = require('./plugins/calc');
    manager.register(registerLogger());
    manager.register(registerGreet());
    manager.register(registerTime());
    manager.register(registerCalc());
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
    // 内置命令
    if (command === 'help' || command === 'h' || args.options.help === true) {
        builtinHelp(manager);
        await manager.destroy();
        return;
    }
    if (command === 'version' || args.options.v === true || args.options.version === true) {
        builtinVersion();
        await manager.destroy();
        return;
    }
    // 插件命令
    await manager.executeCommand(command, args);
    // 销毁
    await manager.destroy();
}
main().catch((err) => {
    console.error('\x1b[31m致命错误:\x1b[0m', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map