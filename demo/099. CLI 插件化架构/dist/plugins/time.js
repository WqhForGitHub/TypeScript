"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
/* ============================== 时间插件 ============================== */
/**
 * time 插件
 * - 提供时间查询与格式化命令
 * - 演示无依赖插件的实现
 * - 演示定时器事件触发
 */
function register() {
    /** 计时器存储 */
    const timers = new Map();
    return {
        meta: {
            name: 'time',
            version: '1.0.0',
            description: '时间插件 - 提供时间查询与计时功能',
        },
        init(context) {
            context.registerCommand({
                name: 'time',
                aliases: ['now'],
                description: '显示当前时间',
                usage: 'time [--format <iso|locale|unix>]',
                handler: (args) => {
                    const now = new Date();
                    const format = args.options.format || 'locale';
                    let output;
                    switch (format) {
                        case 'iso':
                            output = now.toISOString();
                            break;
                        case 'unix':
                            output = String(Math.floor(now.getTime() / 1000));
                            break;
                        case 'locale':
                        default:
                            output = now.toLocaleString('zh-CN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false,
                            });
                            break;
                    }
                    console.log(`\x1b[36m🕐 ${output}\x1b[0m`);
                },
            });
            context.registerCommand({
                name: 'timer',
                aliases: ['stopwatch'],
                description: '计时器操作',
                usage: 'timer <start|stop|list> [name]',
                handler: (args) => {
                    const action = args.positional[0] ?? 'list';
                    const name = args.positional[1] ?? 'default';
                    switch (action) {
                        case 'start': {
                            if (timers.has(name)) {
                                console.log(`\x1b[33m计时器 "${name}" 已在运行，请先停止\x1b[0m`);
                                return;
                            }
                            timers.set(name, Date.now());
                            console.log(`\x1b[32m▶ 计时器 "${name}" 已启动\x1b[0m`);
                            // 发出事件
                            context.emit('timer:started', { name, timestamp: Date.now() });
                            break;
                        }
                        case 'stop': {
                            const startTime = timers.get(name);
                            if (startTime === undefined) {
                                console.log(`\x1b[33m计时器 "${name}" 不存在\x1b[0m`);
                                return;
                            }
                            const elapsed = Date.now() - startTime;
                            timers.delete(name);
                            const seconds = (elapsed / 1000).toFixed(2);
                            console.log(`\x1b[36m⏹ 计时器 "${name}" 已停止, 耗时: ${seconds}s\x1b[0m`);
                            context.emit('timer:stopped', { name, elapsed, timestamp: Date.now() });
                            break;
                        }
                        case 'list': {
                            if (timers.size === 0) {
                                console.log('\x1b[33m当前无运行中的计时器\x1b[0m');
                                return;
                            }
                            console.log('\x1b[1m运行中的计时器:\x1b[0m');
                            const now = Date.now();
                            for (const [timerName, startTime] of timers) {
                                const elapsed = ((now - startTime) / 1000).toFixed(2);
                                console.log(`  \x1b[36m${timerName}\x1b[0m: ${elapsed}s`);
                            }
                            break;
                        }
                        default:
                            console.error(`\x1b[31m✗ 未知操作: "${action}"\x1b[0m`);
                            console.log('可用操作: start, stop, list');
                    }
                },
            });
        },
    };
}
//# sourceMappingURL=time.js.map