"use strict";
/* ============================== 计算器插件 ============================== */
/*
 * 演示:
 *   - 抽象基类的具体子类 (CalcPlugin extends BasePlugin)
 *   - 字符串枚举 (CalcOperation)
 *   - 判别联合 + 类型守卫 (CalcResultEntry)
 *   - 函数重载 (compute / parseNumber)
 *   - 泛型与约束 (generic reducer)
 *   - Getter
 *   - satisfies 操作符
 *   - as const 断言 (仅用于字面量)
 *   - 自定义错误层次结构 (InvalidArgumentError)
 *   - 条件类型 (本地定义)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalcOperation = void 0;
exports.register = register;
exports.isValidOperation = isValidOperation;
exports.isOkResult = isOkResult;
exports.isDivZeroResult = isDivZeroResult;
exports.sumBy = sumBy;
const base_plugin_1 = require("../core/base-plugin");
const errors_1 = require("../core/errors");
/** 计算器运算 (string enum) */
var CalcOperation;
(function (CalcOperation) {
    CalcOperation["Add"] = "add";
    CalcOperation["Sub"] = "sub";
    CalcOperation["Mul"] = "mul";
    CalcOperation["Div"] = "div";
})(CalcOperation || (exports.CalcOperation = CalcOperation = {}));
/** 运算符符号映射 */
const OPERATION_SYMBOLS = {
    [CalcOperation.Add]: '+',
    [CalcOperation.Sub]: '-',
    [CalcOperation.Mul]: '×',
    [CalcOperation.Div]: '÷',
};
/** 合法运算列表 (as const, 仅字面量) */
const VALID_OPERATIONS = ['add', 'sub', 'mul', 'div'];
/** 类型守卫: 判断结果是否为 ok */
function isOkResult(r) {
    return r.kind === 'ok';
}
/** 类型守卫: 判断结果是否为 div-zero */
function isDivZeroResult(r) {
    return r.kind === 'div-zero';
}
/** 类型守卫: 判断字符串是否为合法运算 */
function isValidOperation(value) {
    return VALID_OPERATIONS.includes(value);
}
/**
 * CalcPlugin
 * - 提供基础数学计算命令
 * - 演示带参数解析的命令实现
 * - 依赖 logger 插件进行操作日志记录
 */
class CalcPlugin extends base_plugin_1.BasePlugin {
    constructor() {
        super(...arguments);
        /** 运算历史 (元组列表) */
        this.history = [];
        /** 运算次数统计 */
        this.counts = this.emptyCounts();
        /** 元信息 (satisfies 校验) */
        this.meta = {
            name: 'calc',
            version: '1.0.0',
            description: '计算器插件 - 提供基础数学运算',
            dependencies: ['logger'],
        };
    }
    /* ---------------------------- Getters ---------------------------- */
    /** 历史记录数 (getter) */
    get historyCount() {
        return this.history.length;
    }
    /** 总运算次数 (getter) */
    get totalCount() {
        return this.counts[CalcOperation.Add] +
            this.counts[CalcOperation.Sub] +
            this.counts[CalcOperation.Mul] +
            this.counts[CalcOperation.Div];
    }
    /** parseNumber 实现 */
    parseNumber(raw, fallback) {
        if (raw === undefined) {
            return fallback !== undefined ? fallback : null;
        }
        const n = parseFloat(raw);
        return isNaN(n) ? (fallback !== undefined ? fallback : null) : n;
    }
    /** compute 实现 */
    compute(op, a, b, detailed) {
        if (op === CalcOperation.Div && b === 0) {
            if (detailed === true) {
                return { kind: 'div-zero', operation: op, a, b };
            }
            throw new errors_1.OperationFailedError('除数不能为零', this.meta.name);
        }
        let result;
        switch (op) {
            case CalcOperation.Add:
                result = a + b;
                break;
            case CalcOperation.Sub:
                result = a - b;
                break;
            case CalcOperation.Mul:
                result = a * b;
                break;
            case CalcOperation.Div:
                result = a / b;
                break;
            default: {
                // 穷尽性检查
                const exhaustive = op;
                throw new errors_1.OperationFailedError(`未知运算: ${String(exhaustive)}`, this.meta.name);
            }
        }
        if (detailed === true) {
            return { kind: 'ok', operation: op, a, b, result };
        }
        return result;
    }
    /* ---------------------------- 生命周期 ---------------------------- */
    /** 初始化 */
    onInit(_context) {
        // 注册 calc 命令 (satisfies 校验)
        const calcCommand = {
            name: 'calc',
            aliases: ['compute', 'math'],
            description: '执行数学计算',
            usage: 'calc <add|sub|mul|div> <a> <b>',
            handler: (args) => {
                const operationRaw = args.positional[0];
                if (operationRaw === undefined || !isValidOperation(operationRaw)) {
                    console.error('\x1b[31m✗ 请提供有效的运算: add(加), sub(减), mul(乘), div(除)\x1b[0m');
                    return;
                }
                const operation = operationRaw;
                const a = this.parseNumber(args.positional[1], 0);
                const b = this.parseNumber(args.positional[2], 0);
                if (a === null || b === null) {
                    throw new errors_1.InvalidArgumentError('请提供有效的数字参数', this.meta.name);
                }
                // 调用重载的 compute, 获取判别联合结果
                const entry = this.compute(operation, a, b, true);
                this.handleCalcResult(entry);
            },
        };
        this.registerCommand(calcCommand);
        // 注册 sqrt 命令 (satisfies 校验)
        const sqrtCommand = {
            name: 'sqrt',
            description: '计算平方根',
            usage: 'sqrt <number>',
            handler: (args) => {
                const n = this.parseNumber(args.positional[0]);
                if (n === null) {
                    throw new errors_1.InvalidArgumentError('请提供有效的数字', this.meta.name);
                }
                if (n < 0) {
                    console.error('\x1b[31m✗ 无法计算负数的平方根\x1b[0m');
                    return;
                }
                const result = Math.sqrt(n);
                console.log(`\x1b[33m√${n} = ${result.toFixed(4)}\x1b[0m`);
            },
        };
        this.registerCommand(sqrtCommand);
        // 注册 history 命令 (satisfies 校验)
        const historyCommand = {
            name: 'calc-history',
            aliases: ['math-history'],
            description: '查看计算历史',
            handler: () => {
                this.printHistory();
            },
        };
        this.registerCommand(historyCommand);
    }
    /* ---------------------------- 结果处理 (使用类型守卫) ---------------------------- */
    /** 处理运算结果 (根据判别联合分派) */
    handleCalcResult(entry) {
        if (isOkResult(entry)) {
            // 累加统计
            this.incrementCount(entry.operation);
            this.history.push([entry.operation, entry.a, entry.b, entry.result]);
            // 通知 logger 插件
            this.emit('calc:operation', {
                operation: entry.operation,
                a: entry.a,
                b: entry.b,
                result: entry.result,
            });
            const symbol = OPERATION_SYMBOLS[entry.operation];
            const resultStr = Number.isInteger(entry.result)
                ? String(entry.result)
                : entry.result.toFixed(4);
            console.log(`\x1b[33m${entry.a} ${symbol} ${entry.b} = ${resultStr}\x1b[0m`);
            return;
        }
        if (isDivZeroResult(entry)) {
            console.error('\x1b[31m✗ 除数不能为零\x1b[0m');
            return;
        }
        // invalid 分支
        console.error(`\x1b[31m✗ 未知运算: "${entry.raw}"\x1b[0m`);
        console.log('支持的运算: add(加), sub(减), mul(乘), div(除)');
    }
    /* ---------------------------- 统计 ---------------------------- */
    /** 创建空的计数对象 */
    emptyCounts() {
        return {
            [CalcOperation.Add]: 0,
            [CalcOperation.Sub]: 0,
            [CalcOperation.Mul]: 0,
            [CalcOperation.Div]: 0,
        };
    }
    /** 累加某运算的次数 */
    incrementCount(op) {
        // counts 声明为 Readonly, 内部需要可变, 使用 -readonly 映射类型去除只读修饰符
        const mutable = this.counts;
        mutable[op] += 1;
    }
    /** 打印历史 (使用生成器) */
    printHistory() {
        if (this.history.length === 0) {
            console.log('\x1b[33m暂无计算历史\x1b[0m');
            return;
        }
        console.log(`\x1b[1m计算历史 (${this.history.length} 条):\x1b[0m`);
        console.log('─'.repeat(60));
        for (const [op, a, b, result] of this.iterateHistory()) {
            const symbol = OPERATION_SYMBOLS[op];
            console.log(`  \x1b[33m${a} ${symbol} ${b} = ${result}\x1b[0m`);
        }
        console.log('─'.repeat(60));
    }
    /* ---------------------------- 生成器 ---------------------------- */
    /** 生成器: 迭代历史记录 (元组) */
    *iterateHistory() {
        for (const entry of this.history) {
            yield entry;
        }
    }
    /* ---------------------------- 泛型工具 ---------------------------- */
    /** 泛型: 对历史结果进行归约 (泛型 + 约束) */
    reduceHistory(reducer, initial) {
        let acc = initial;
        for (const entry of this.iterateHistory()) {
            acc = reducer(acc, entry);
        }
        return acc;
    }
    /** 泛型: 查找首个满足谓词的历史记录 (泛型类型守卫) */
    findInHistory(predicate) {
        for (const entry of this.iterateHistory()) {
            if (predicate(entry)) {
                return entry;
            }
        }
        return undefined;
    }
}
/* ---------------------------- 模块级泛型工具 ---------------------------- */
/** 泛型: 安全累加数组 (泛型 + 约束) */
function sumBy(items, selector) {
    let total = 0;
    for (const item of items) {
        total += selector(item);
    }
    return total;
}
/* ---------------------------- 模块导出 ---------------------------- */
/** 插件注册函数 (约定导出) */
function register() {
    return new CalcPlugin();
}
//# sourceMappingURL=calc.js.map