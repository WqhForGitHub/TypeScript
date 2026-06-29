"use strict";
/* ============================== 问候插件 ============================== */
/*
 * 演示:
 *   - 抽象基类的具体子类 (GreetPlugin extends BasePlugin)
 *   - 字符串枚举 (GreetStyle)
 *   - 判别联合 + 类型守卫 (GreetEvent)
 *   - 函数重载 (greet)
 *   - Getter
 *   - satisfies 操作符
 *   - as const 断言 (仅用于字面量)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
const types_1 = require("../core/types");
const base_plugin_1 = require("../core/base-plugin");
const logger_1 = require("./logger");
/** 问候风格 (string enum) */
var GreetStyle;
(function (GreetStyle) {
    GreetStyle["Casual"] = "casual";
    GreetStyle["Formal"] = "formal";
})(GreetStyle || (GreetStyle = {}));
/** 类型守卫: 判断事件是否为 greet */
function isGreetEvent(ev) {
    return ev.kind === 'greet';
}
/** 问候语模板 (as const, 仅字面量) */
const GREET_TEMPLATES = {
    [GreetStyle.Casual]: '你好, {name}! \u{1F44B}',
    [GreetStyle.Formal]: '尊敬的 {name}，您好！很高兴为您服务。',
};
/** 告别语模板 (as const, 仅字面量) */
const BYE_TEMPLATE = '再见, {name}! 期待下次见面~';
/** 别名列表 (as const, 仅字面量) */
const GREET_ALIASES = ['hello', 'hi'];
const BYE_ALIASES = ['goodbye', 'farewell'];
/**
 * GreetPlugin
 * - 提供简单的问候命令
 * - 演示最基本的命令注册方式
 */
class GreetPlugin extends base_plugin_1.BasePlugin {
    constructor() {
        super(...arguments);
        /** 问候计数器 (私有) */
        this.counters = { greet: 0, bye: 0 };
        /** 元信息 (satisfies 校验) */
        this.meta = {
            name: 'greet',
            version: '1.0.0',
            description: '问候插件 - 提供友好的问候功能',
            author: 'demo',
        };
    }
    /* ---------------------------- Getters ---------------------------- */
    /** 问候次数 (getter) */
    get greetCount() {
        return this.counters.greet;
    }
    /** 告别次数 (getter) */
    get byeCount() {
        return this.counters.bye;
    }
    /** greet 实现 */
    greet(name, style = GreetStyle.Casual) {
        const template = GREET_TEMPLATES[style];
        return template.replace('{name}', name);
    }
    /* ---------------------------- 生命周期 ---------------------------- */
    /** 初始化 */
    onInit(_context) {
        // 注册 greet 命令 (satisfies 校验)
        const greetCommand = {
            name: 'greet',
            aliases: [...GREET_ALIASES],
            description: '向某人问候',
            usage: 'greet <name> [--formal]',
            handler: (args) => {
                const name = args.positional[0] ?? '世界';
                const style = args.options.formal === true ? GreetStyle.Formal : GreetStyle.Casual;
                this.counters.greet += 1;
                const message = this.greet(name, style);
                if (style === GreetStyle.Formal) {
                    console.log(`\x1b[33m${message}\x1b[0m`);
                }
                else {
                    console.log(`\x1b[32m${message}\x1b[0m`);
                }
                // 发出问候事件
                this.emit('greet:occurred', { kind: 'greet', name, style });
            },
        };
        this.registerCommand(greetCommand);
        // 注册 bye 命令 (satisfies 校验)
        const byeCommand = {
            name: 'bye',
            aliases: [...BYE_ALIASES],
            description: '告别',
            usage: 'bye <name>',
            handler: (args) => {
                const name = args.positional[0] ?? '朋友';
                this.counters.bye += 1;
                console.log(`\x1b[36m${BYE_TEMPLATE.replace('{name}', name)}\x1b[0m`);
                this.emit('greet:occurred', { kind: 'bye', name });
            },
        };
        this.registerCommand(byeCommand);
        // 注册 beforeCommand 钩子 - 调试日志 (使用类型守卫窄化)
        this.registerHook(types_1.HookType.BeforeCommand, (payload) => {
            if (!(0, types_1.isBeforeCommandPayload)(payload))
                return;
            if (payload.command === 'greet') {
                this.logger.debug('准备向某人问候...');
            }
        });
        // 监听用户登录事件 (使用类型守卫, 复用 logger 导出的守卫)
        this.on('user:login', (data) => {
            if (!(0, logger_1.isUserLoginEvent)(data))
                return;
            console.log(`\x1b[32m欢迎回来, ${data.name}!\x1b[0m`);
        });
        // 监听自身的问候事件 (使用判别联合 + 类型守卫)
        this.on('greet:occurred', (data) => {
            if (!isGreetEventRecord(data))
                return;
            if (isGreetEvent(data)) {
                this.logger.debug(`已问候 ${data.name} (${data.style})`);
            }
            else {
                this.logger.debug(`已告别 ${data.name}`);
            }
        });
    }
}
/** 类型守卫: 判断数据是否为 GreetEvent (对外部 unknown 数据进行窄化) */
function isGreetEventRecord(data) {
    if (typeof data !== 'object' || data === null)
        return false;
    const d = data;
    return d.kind === 'greet' || d.kind === 'bye';
}
/* ---------------------------- 模块导出 ---------------------------- */
/** 插件注册函数 (约定导出) */
function register() {
    return new GreetPlugin();
}
//# sourceMappingURL=greet.js.map