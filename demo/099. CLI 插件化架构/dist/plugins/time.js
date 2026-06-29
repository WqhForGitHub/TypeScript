"use strict";
/* ============================== 时间插件 ============================== */
/*
 * 演示:
 *   - 抽象基类的具体子类 (TimePlugin extends BasePlugin)
 *   - 字符串枚举 (TimeFormat / TimerAction)
 *   - 判别联合 + 类型守卫 (TimerCommand / TimerState)
 *   - 函数重载 (formatTime)
 *   - 生成器 / 迭代器
 *   - Getter / Setter
 *   - satisfies 操作符
 *   - as const 断言 (仅用于字面量)
 *   - 元组 (TimerRecord)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
const base_plugin_1 = require("../core/base-plugin");
const errors_1 = require("../core/errors");
/** 时间格式 (string enum) */
var TimeFormat;
(function (TimeFormat) {
    TimeFormat["Iso"] = "iso";
    TimeFormat["Locale"] = "locale";
    TimeFormat["Unix"] = "unix";
})(TimeFormat || (TimeFormat = {}));
/** 计时器操作 (string enum) */
var TimerAction;
(function (TimerAction) {
    TimerAction["Start"] = "start";
    TimerAction["Stop"] = "stop";
    TimerAction["List"] = "list";
})(TimerAction || (TimerAction = {}));
/** 类型守卫: 判断命令是否为 start */
function isStartCommand(cmd) {
    return cmd.kind === TimerAction.Start;
}
/** 类型守卫: 判断命令是否为 stop */
function isStopCommand(cmd) {
    return cmd.kind === TimerAction.Stop;
}
/** 类型守卫: 判断命令是否为 list */
function isListCommand(cmd) {
    return cmd.kind === TimerAction.List;
}
/** 合法的计时器操作 (as const, 仅字面量) */
const VALID_TIMER_ACTIONS = ['start', 'stop', 'list'];
/** 合法的时间格式 (as const, 仅字面量) */
const VALID_TIME_FORMATS = ['iso', 'locale', 'unix'];
/** 类型守卫: 判断字符串是否为合法时间格式 */
function isValidTimeFormat(value) {
    return VALID_TIME_FORMATS.includes(value);
}
/**
 * TimePlugin
 * - 提供时间查询与格式化命令
 * - 演示无依赖插件的实现
 * - 演示定时器事件触发
 */
class TimePlugin extends base_plugin_1.BasePlugin {
    constructor() {
        super(...arguments);
        /** 运行中的计时器: name -> 启动时间 */
        this.timers = new Map();
        /** 已停止计时器历史 (元组列表) */
        this.history = [];
        /** 元信息 (satisfies 校验) */
        this.meta = {
            name: 'time',
            version: '1.0.0',
            description: '时间插件 - 提供时间查询与计时功能',
        };
    }
    /* ---------------------------- Getters ---------------------------- */
    /** 运行中计时器数量 (getter) */
    get runningTimerCount() {
        return this.timers.size;
    }
    /** 历史记录数 (getter) */
    get historyCount() {
        return this.history.length;
    }
    /** formatTime 实现 */
    formatTime(date, format = TimeFormat.Locale) {
        switch (format) {
            case TimeFormat.Iso:
                return date.toISOString();
            case TimeFormat.Unix:
                return String(Math.floor(date.getTime() / 1000));
            case TimeFormat.Locale:
            default:
                return date.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                });
        }
    }
    /* ---------------------------- 生命周期 ---------------------------- */
    /** 初始化 */
    onInit(_context) {
        // 注册 time 命令 (satisfies 校验)
        const timeCommand = {
            name: 'time',
            aliases: ['now'],
            description: '显示当前时间',
            usage: 'time [--format <iso|locale|unix>]',
            handler: (args) => {
                const now = new Date();
                const rawFormat = args.options.format;
                const format = typeof rawFormat === 'string' && isValidTimeFormat(rawFormat)
                    ? rawFormat
                    : TimeFormat.Locale;
                const output = this.formatTime(now, format);
                console.log(`\x1b[36m🕐 ${output}\x1b[0m`);
            },
        };
        this.registerCommand(timeCommand);
        // 注册 timer 命令 (satisfies 校验)
        const timerCommand = {
            name: 'timer',
            aliases: ['stopwatch'],
            description: '计时器操作',
            usage: 'timer <start|stop|list> [name]',
            handler: (args) => {
                const cmd = this.parseTimerCommand(args);
                this.executeTimerCommand(cmd);
            },
        };
        this.registerCommand(timerCommand);
    }
    /* ---------------------------- 命令解析 ---------------------------- */
    /** 解析计时器子命令 (返回判别联合) */
    parseTimerCommand(args) {
        const actionRaw = args.positional[0] ?? 'list';
        const name = args.positional[1] ?? 'default';
        if (!this.isValidTimerAction(actionRaw)) {
            throw new errors_1.InvalidOperationError(actionRaw, VALID_TIMER_ACTIONS, this.meta.name);
        }
        switch (actionRaw) {
            case TimerAction.Start:
                return { kind: TimerAction.Start, name };
            case TimerAction.Stop:
                return { kind: TimerAction.Stop, name };
            case TimerAction.List:
            default:
                return { kind: TimerAction.List };
        }
    }
    /** 类型守卫: 判断是否为合法计时器操作 */
    isValidTimerAction(value) {
        return VALID_TIMER_ACTIONS.includes(value);
    }
    /* ---------------------------- 命令执行 (使用类型守卫窄化) ---------------------------- */
    /** 执行计时器命令 (根据判别联合分派) */
    executeTimerCommand(cmd) {
        if (isStartCommand(cmd)) {
            this.startTimer(cmd.name);
            return;
        }
        if (isStopCommand(cmd)) {
            this.stopTimer(cmd.name);
            return;
        }
        if (isListCommand(cmd)) {
            this.listTimers();
            return;
        }
    }
    /** 启动计时器 */
    startTimer(name) {
        if (this.timers.has(name)) {
            console.log(`\x1b[33m计时器 "${name}" 已在运行，请先停止\x1b[0m`);
            return;
        }
        const startedAt = Date.now();
        this.timers.set(name, startedAt);
        console.log(`\x1b[32m▶ 计时器 "${name}" 已启动\x1b[0m`);
        this.emit('timer:started', { name, timestamp: startedAt });
    }
    /** 停止计时器 */
    stopTimer(name) {
        const startedAt = this.timers.get(name);
        if (startedAt === undefined) {
            console.log(`\x1b[33m计时器 "${name}" 不存在\x1b[0m`);
            return;
        }
        const elapsed = Date.now() - startedAt;
        this.timers.delete(name);
        this.history.push([name, startedAt]);
        const seconds = (elapsed / 1000).toFixed(2);
        console.log(`\x1b[36m⏹ 计时器 "${name}" 已停止, 耗时: ${seconds}s\x1b[0m`);
        this.emit('timer:stopped', { name, elapsed, timestamp: Date.now() });
    }
    /** 列出运行中的计时器 (使用生成器) */
    listTimers() {
        if (this.timers.size === 0) {
            console.log('\x1b[33m当前无运行中的计时器\x1b[0m');
            return;
        }
        console.log('\x1b[1m运行中的计时器:\x1b[0m');
        const now = Date.now();
        for (const [timerName, startedAt] of this.iterateRunningTimers()) {
            const elapsed = ((now - startedAt) / 1000).toFixed(2);
            console.log(`  \x1b[36m${timerName}\x1b[0m: ${elapsed}s`);
        }
    }
    /* ---------------------------- 生成器 ---------------------------- */
    /** 生成器: 迭代运行中的计时器 (元组) */
    *iterateRunningTimers() {
        for (const [name, startedAt] of this.timers) {
            yield [name, startedAt];
        }
    }
    /** 生成器: 迭代计时器状态 (判别联合) */
    *iterateTimerStates() {
        const now = Date.now();
        for (const [name, startedAt] of this.timers) {
            yield { kind: 'running', name, startedAt };
        }
        for (const [name, startedAt] of this.history) {
            yield { kind: 'stopped', name, elapsed: now - startedAt };
        }
    }
}
/* ---------------------------- 模块导出 ---------------------------- */
/** 插件注册函数 (约定导出) */
function register() {
    return new TimePlugin();
}
//# sourceMappingURL=time.js.map