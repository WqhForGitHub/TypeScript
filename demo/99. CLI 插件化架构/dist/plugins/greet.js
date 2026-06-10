"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
/* ============================== 问候插件 ============================== */
/**
 * greet 插件
 * - 提供简单的问候命令
 * - 演示最基本的命令注册方式
 */
function register() {
    return {
        meta: {
            name: 'greet',
            version: '1.0.0',
            description: '问候插件 - 提供友好的问候功能',
        },
        init(context) {
            context.registerCommand({
                name: 'greet',
                aliases: ['hello', 'hi'],
                description: '向某人问候',
                usage: 'greet <name> [--formal]',
                handler: (args) => {
                    const name = args.positional[0] ?? '世界';
                    const formal = args.options.formal === true;
                    if (formal) {
                        console.log(`\x1b[33m尊敬的 ${name}，您好！很高兴为您服务。\x1b[0m`);
                    }
                    else {
                        console.log(`\x1b[32m你好, ${name}! 👋\x1b[0m`);
                    }
                },
            });
            context.registerCommand({
                name: 'bye',
                aliases: ['goodbye', 'farewell'],
                description: '告别',
                usage: 'bye <name>',
                handler: (args) => {
                    const name = args.positional[0] ?? '朋友';
                    console.log(`\x1b[36m再见, ${name}! 期待下次见面~\x1b[0m`);
                },
            });
            // 注册 beforeCommand 钩子 - 记录命令执行
            context.registerHook('beforeCommand', (payload) => {
                if (payload.command === 'greet') {
                    context.logger.debug(`准备向某人问候...`);
                }
            });
            // 监听自定义事件
            context.on('user:login', (data) => {
                const userData = data;
                console.log(`\x1b[32m欢迎回来, ${userData.name}!\x1b[0m`);
            });
        },
    };
}
//# sourceMappingURL=greet.js.map