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

import {
  Plugin,
  PluginContext,
  PluginMeta,
  Command,
  CommandArgs,
} from "../core/types";
import { BasePlugin } from "../core/base-plugin";
import { InvalidArgumentError, OperationFailedError } from "../core/errors";

/** 计算器运算 (string enum) */
enum CalcOperation {
  Add = "add",
  Sub = "sub",
  Mul = "mul",
  Div = "div",
}

/** 运算符符号映射 */
const OPERATION_SYMBOLS: Readonly<Record<CalcOperation, string>> = {
  [CalcOperation.Add]: "+",
  [CalcOperation.Sub]: "-",
  [CalcOperation.Mul]: "×",
  [CalcOperation.Div]: "÷",
};

/** 合法运算列表 (as const, 仅字面量) */
const VALID_OPERATIONS = ["add", "sub", "mul", "div"] as const;
type ValidOperation = (typeof VALID_OPERATIONS)[number];

/** 运算结果条目 (判别联合) */
type CalcResultEntry =
  | {
      readonly kind: "ok";
      readonly operation: CalcOperation;
      readonly a: number;
      readonly b: number;
      readonly result: number;
    }
  | {
      readonly kind: "div-zero";
      readonly operation: CalcOperation.Div;
      readonly a: number;
      readonly b: number;
    }
  | { readonly kind: "invalid"; readonly raw: string };

/** 类型守卫: 判断结果是否为 ok */
function isOkResult(
  r: CalcResultEntry,
): r is Extract<CalcResultEntry, { readonly kind: "ok" }> {
  return r.kind === "ok";
}

/** 类型守卫: 判断结果是否为 div-zero */
function isDivZeroResult(
  r: CalcResultEntry,
): r is Extract<CalcResultEntry, { readonly kind: "div-zero" }> {
  return r.kind === "div-zero";
}

/** 类型守卫: 判断字符串是否为合法运算 */
function isValidOperation(value: string): value is ValidOperation {
  return (VALID_OPERATIONS as readonly string[]).includes(value);
}

/** 条件类型: 根据运算返回不同结果类型 (本地演示) */
type OperationResult<T extends CalcOperation> = T extends CalcOperation.Div
  ? number | "div-zero"
  : number;

/** 运算历史记录 (只读元组) */
type CalcHistoryEntry = readonly [
  operation: CalcOperation,
  a: number,
  b: number,
  result: number,
];

/**
 * CalcPlugin
 * - 提供基础数学计算命令
 * - 演示带参数解析的命令实现
 * - 依赖 logger 插件进行操作日志记录
 */
class CalcPlugin extends BasePlugin {
  /** 运算历史 (元组列表) */
  private readonly history: CalcHistoryEntry[] = [];

  /** 运算次数统计 */
  private readonly counts: Readonly<Record<CalcOperation, number>> =
    this.emptyCounts();

  /** 元信息 (satisfies 校验) */
  public readonly meta: PluginMeta = {
    name: "calc",
    version: "1.0.0",
    description: "计算器插件 - 提供基础数学运算",
    dependencies: ["logger"],
  } satisfies PluginMeta;

  /* ---------------------------- Getters ---------------------------- */

  /** 历史记录数 (getter) */
  public get historyCount(): number {
    return this.history.length;
  }

  /** 总运算次数 (getter) */
  public get totalCount(): number {
    return (
      this.counts[CalcOperation.Add] +
      this.counts[CalcOperation.Sub] +
      this.counts[CalcOperation.Mul] +
      this.counts[CalcOperation.Div]
    );
  }

  /* ---------------------------- 函数重载: parseNumber ---------------------------- */

  /** 解析数字, 失败返回 null */
  private parseNumber(raw: string | undefined): number | null;
  /** 解析数字, 失败返回默认值 (重载) */
  private parseNumber(raw: string | undefined, fallback: number): number;
  /** parseNumber 实现 */
  private parseNumber(
    raw: string | undefined,
    fallback?: number,
  ): number | null {
    if (raw === undefined) {
      return fallback !== undefined ? fallback : null;
    }
    const n = parseFloat(raw);
    return isNaN(n) ? (fallback !== undefined ? fallback : null) : n;
  }

  /* ---------------------------- 函数重载: compute ---------------------------- */

  /** 执行运算 (基础) */
  private compute(op: CalcOperation, a: number, b: number): number;
  /** 执行运算并返回详细结果条目 (重载, 返回判别联合) */
  private compute(
    op: CalcOperation,
    a: number,
    b: number,
    detailed: true,
  ): CalcResultEntry;
  /** compute 实现 */
  private compute(
    op: CalcOperation,
    a: number,
    b: number,
    detailed?: true,
  ): number | CalcResultEntry {
    if (op === CalcOperation.Div && b === 0) {
      if (detailed === true) {
        return { kind: "div-zero" as const, operation: op, a, b };
      }
      throw new OperationFailedError("除数不能为零", this.meta.name);
    }

    let result: number;
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
        const exhaustive: never = op;
        throw new OperationFailedError(
          `未知运算: ${String(exhaustive)}`,
          this.meta.name,
        );
      }
    }

    if (detailed === true) {
      return { kind: "ok" as const, operation: op, a, b, result };
    }
    return result;
  }

  /* ---------------------------- 生命周期 ---------------------------- */

  /** 初始化 */
  protected onInit(_context: PluginContext): void {
    // 注册 calc 命令 (satisfies 校验)
    const calcCommand = {
      name: "calc",
      aliases: ["compute", "math"],
      description: "执行数学计算",
      usage: "calc <add|sub|mul|div> <a> <b>",
      handler: (args: CommandArgs): void => {
        const operationRaw = args.positional[0];
        if (operationRaw === undefined || !isValidOperation(operationRaw)) {
          console.error(
            "\x1b[31m✗ 请提供有效的运算: add(加), sub(减), mul(乘), div(除)\x1b[0m",
          );
          return;
        }

        const operation = operationRaw as CalcOperation;
        const a = this.parseNumber(args.positional[1], 0);
        const b = this.parseNumber(args.positional[2], 0);
        if (a === null || b === null) {
          throw new InvalidArgumentError(
            "请提供有效的数字参数",
            this.meta.name,
          );
        }

        // 调用重载的 compute, 获取判别联合结果
        const entry = this.compute(operation, a, b, true);
        this.handleCalcResult(entry);
      },
    } satisfies Command;
    this.registerCommand(calcCommand);

    // 注册 sqrt 命令 (satisfies 校验)
    const sqrtCommand = {
      name: "sqrt",
      description: "计算平方根",
      usage: "sqrt <number>",
      handler: (args: CommandArgs): void => {
        const n = this.parseNumber(args.positional[0]);
        if (n === null) {
          throw new InvalidArgumentError("请提供有效的数字", this.meta.name);
        }
        if (n < 0) {
          console.error("\x1b[31m✗ 无法计算负数的平方根\x1b[0m");
          return;
        }
        const result = Math.sqrt(n);
        console.log(`\x1b[33m√${n} = ${result.toFixed(4)}\x1b[0m`);
      },
    } satisfies Command;
    this.registerCommand(sqrtCommand);

    // 注册 history 命令 (satisfies 校验)
    const historyCommand = {
      name: "calc-history",
      aliases: ["math-history"],
      description: "查看计算历史",
      handler: (): void => {
        this.printHistory();
      },
    } satisfies Command;
    this.registerCommand(historyCommand);
  }

  /* ---------------------------- 结果处理 (使用类型守卫) ---------------------------- */

  /** 处理运算结果 (根据判别联合分派) */
  private handleCalcResult(entry: CalcResultEntry): void {
    if (isOkResult(entry)) {
      // 累加统计
      this.incrementCount(entry.operation);
      this.history.push([
        entry.operation,
        entry.a,
        entry.b,
        entry.result,
      ] as const);

      // 通知 logger 插件
      this.emit("calc:operation", {
        operation: entry.operation,
        a: entry.a,
        b: entry.b,
        result: entry.result,
      });

      const symbol = OPERATION_SYMBOLS[entry.operation];
      const resultStr = Number.isInteger(entry.result)
        ? String(entry.result)
        : entry.result.toFixed(4);
      console.log(
        `\x1b[33m${entry.a} ${symbol} ${entry.b} = ${resultStr}\x1b[0m`,
      );
      return;
    }

    if (isDivZeroResult(entry)) {
      console.error("\x1b[31m✗ 除数不能为零\x1b[0m");
      return;
    }

    // invalid 分支
    console.error(`\x1b[31m✗ 未知运算: "${entry.raw}"\x1b[0m`);
    console.log("支持的运算: add(加), sub(减), mul(乘), div(除)");
  }

  /* ---------------------------- 统计 ---------------------------- */

  /** 创建空的计数对象 */
  private emptyCounts(): Record<CalcOperation, number> {
    return {
      [CalcOperation.Add]: 0,
      [CalcOperation.Sub]: 0,
      [CalcOperation.Mul]: 0,
      [CalcOperation.Div]: 0,
    };
  }

  /** 累加某运算的次数 */
  private incrementCount(op: CalcOperation): void {
    // counts 声明为 Readonly, 内部需要可变, 使用 -readonly 映射类型去除只读修饰符
    const mutable = this.counts as { -readonly [K in CalcOperation]: number };
    mutable[op] += 1;
  }

  /** 打印历史 (使用生成器) */
  private printHistory(): void {
    if (this.history.length === 0) {
      console.log("\x1b[33m暂无计算历史\x1b[0m");
      return;
    }
    console.log(`\x1b[1m计算历史 (${this.history.length} 条):\x1b[0m`);
    console.log("─".repeat(60));
    for (const [op, a, b, result] of this.iterateHistory()) {
      const symbol = OPERATION_SYMBOLS[op];
      console.log(`  \x1b[33m${a} ${symbol} ${b} = ${result}\x1b[0m`);
    }
    console.log("─".repeat(60));
  }

  /* ---------------------------- 生成器 ---------------------------- */

  /** 生成器: 迭代历史记录 (元组) */
  public *iterateHistory(): Generator<CalcHistoryEntry> {
    for (const entry of this.history) {
      yield entry;
    }
  }

  /* ---------------------------- 泛型工具 ---------------------------- */

  /** 泛型: 对历史结果进行归约 (泛型 + 约束) */
  public reduceHistory<T>(
    reducer: (acc: T, entry: CalcHistoryEntry) => T,
    initial: T,
  ): T {
    let acc = initial;
    for (const entry of this.iterateHistory()) {
      acc = reducer(acc, entry);
    }
    return acc;
  }

  /** 泛型: 查找首个满足谓词的历史记录 (泛型类型守卫) */
  public findInHistory<T extends CalcHistoryEntry>(
    predicate: (entry: CalcHistoryEntry) => entry is T,
  ): T | undefined {
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
function sumBy<T>(items: readonly T[], selector: (item: T) => number): number {
  let total = 0;
  for (const item of items) {
    total += selector(item);
  }
  return total;
}

/* ---------------------------- 模块导出 ---------------------------- */

/** 插件注册函数 (约定导出) */
export function register(): Plugin {
  return new CalcPlugin();
}

export type { CalcResultEntry, CalcHistoryEntry };
export { CalcOperation, isValidOperation, isOkResult, isDivZeroResult, sumBy };
