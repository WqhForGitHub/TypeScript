#!/usr/bin/env node

/**
 * 简易计算器 CLI
 * 一个使用纯 TypeScript 编写的命令行计算器演示。
 *
 * 支持两种用法：
 *   1. 直接传入表达式：calc-cli "1 + 2 * 3"
 *   2. 进入交互模式：  calc-cli
 *
 * 支持的运算符：+  -  *  /  %  ^  (  )
 * 支持小数、负数与括号嵌套。
 */

import * as readline from "readline";

// ============================================================
// 类型定义
// ============================================================

type TokenType = "number" | "operator" | "lparen" | "rparen";

interface Token {
  type: TokenType;
  value: string;
}

type Operator = "+" | "-" | "*" | "/" | "%" | "^";

interface OperatorInfo {
  precedence: number;
  associativity: "left" | "right";
  apply: (a: number, b: number) => number;
}

const OPERATORS: Record<Operator, OperatorInfo> = {
  "+": { precedence: 1, associativity: "left", apply: (a, b) => a + b },
  "-": { precedence: 1, associativity: "left", apply: (a, b) => a - b },
  "*": { precedence: 2, associativity: "left", apply: (a, b) => a * b },
  "/": {
    precedence: 2,
    associativity: "left",
    apply: (a, b) => {
      if (b === 0) throw new Error("除数不能为 0");
      return a / b;
    },
  },
  "%": {
    precedence: 2,
    associativity: "left",
    apply: (a, b) => {
      if (b === 0) throw new Error("取模运算的除数不能为 0");
      return a % b;
    },
  },
  "^": {
    precedence: 3,
    associativity: "right",
    apply: (a, b) => Math.pow(a, b),
  },
};

// ============================================================
// 词法分析（Tokenizer）
// ============================================================

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // 跳过空白
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // 数字（包含小数）
    if (/[0-9.]/.test(ch)) {
      let num = "";
      let dotCount = 0;
      while (i < input.length && /[0-9.]/.test(input[i])) {
        if (input[i] === ".") {
          dotCount++;
          if (dotCount > 1) {
            throw new Error(`非法的数字格式：包含多个小数点`);
          }
        }
        num += input[i];
        i++;
      }
      tokens.push({ type: "number", value: num });
      continue;
    }

    // 括号
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i++;
      continue;
    }

    // 运算符
    if (ch in OPERATORS) {
      // 处理一元负号 / 正号：当 - 或 + 出现在开头，或上一个 token 是运算符 / 左括号时
      if ((ch === "-" || ch === "+") && isUnaryContext(tokens)) {
        // 读取后续数字并附加正负号
        let num = ch === "-" ? "-" : "";
        i++;
        // 跳过紧随其后的空白
        while (i < input.length && /\s/.test(input[i])) i++;

        if (i >= input.length || !/[0-9.(]/.test(input[i])) {
          throw new Error(`一元运算符 '${ch}' 后缺少操作数`);
        }

        if (input[i] === "(") {
          // -(...)  转换为 (0 - (...))
          if (ch === "-") {
            tokens.push({ type: "number", value: "0" });
            tokens.push({ type: "operator", value: "-" });
          }
          continue;
        }

        let dotCount = 0;
        while (i < input.length && /[0-9.]/.test(input[i])) {
          if (input[i] === ".") {
            dotCount++;
            if (dotCount > 1) throw new Error(`非法的数字格式：包含多个小数点`);
          }
          num += input[i];
          i++;
        }
        tokens.push({ type: "number", value: num });
        continue;
      }

      tokens.push({ type: "operator", value: ch });
      i++;
      continue;
    }

    throw new Error(`非法字符：'${ch}'`);
  }

  return tokens;
}

function isUnaryContext(tokens: Token[]): boolean {
  if (tokens.length === 0) return true;
  const last = tokens[tokens.length - 1];
  return last.type === "operator" || last.type === "lparen";
}

// ============================================================
// Shunting Yard 算法：中缀转后缀（RPN）
// ============================================================

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const opStack: Token[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
    } else if (token.type === "operator") {
      const op = token.value as Operator;
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1];
        if (top.type !== "operator") break;
        const topOp = top.value as Operator;
        const cur = OPERATORS[op];
        const t = OPERATORS[topOp];
        if (
          t.precedence > cur.precedence ||
          (t.precedence === cur.precedence && cur.associativity === "left")
        ) {
          output.push(opStack.pop()!);
        } else {
          break;
        }
      }
      opStack.push(token);
    } else if (token.type === "lparen") {
      opStack.push(token);
    } else if (token.type === "rparen") {
      let foundLParen = false;
      while (opStack.length > 0) {
        const top = opStack.pop()!;
        if (top.type === "lparen") {
          foundLParen = true;
          break;
        }
        output.push(top);
      }
      if (!foundLParen) throw new Error("括号不匹配：缺少 '('");
    }
  }

  while (opStack.length > 0) {
    const top = opStack.pop()!;
    if (top.type === "lparen" || top.type === "rparen") {
      throw new Error("括号不匹配");
    }
    output.push(top);
  }

  return output;
}

// ============================================================
// 后缀表达式求值
// ============================================================

function evalRPN(rpn: Token[]): number {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === "number") {
      const n = Number(token.value);
      if (isNaN(n)) throw new Error(`无效的数字：${token.value}`);
      stack.push(n);
    } else if (token.type === "operator") {
      if (stack.length < 2)
        throw new Error(`运算符 '${token.value}' 缺少操作数`);
      const b = stack.pop()!;
      const a = stack.pop()!;
      const op = OPERATORS[token.value as Operator];
      stack.push(op.apply(a, b));
    }
  }

  if (stack.length !== 1) throw new Error("非法表达式");
  return stack[0];
}

// ============================================================
// 对外计算函数
// ============================================================

function calculate(expr: string): number {
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new Error("空表达式");
  const rpn = toRPN(tokens);
  return evalRPN(rpn);
}

// ============================================================
// 格式化输出
// ============================================================

function formatResult(value: number): string {
  if (!isFinite(value)) return value.toString();
  // 控制最多 10 位小数，去掉末尾多余的 0
  const fixed = value.toFixed(10);
  return parseFloat(fixed).toString();
}

function printBanner(): void {
  console.log("==========================================");
  console.log("   TypeScript 简易计算器  (calc-cli)");
  console.log("==========================================");
  console.log("支持运算符：+  -  *  /  %  ^  (  )");
  console.log("输入 'help' 查看帮助，输入 'exit' 退出。");
  console.log("");
}

function printHelp(): void {
  console.log(`
Usage:
  calc-cli                 进入交互式模式
  calc-cli "<expression>"  直接计算表达式
  calc-cli --help | -h     显示帮助

Examples:
  calc-cli "1 + 2 * 3"
  calc-cli "(1 + 2) * (3 - 4)"
  calc-cli "2 ^ 10"
  calc-cli "10 % 3"
`);
}

// ============================================================
// 交互模式
// ============================================================

function runInteractive(): void {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "calc> ",
  });

  rl.prompt();

  rl.on("line", (line) => {
    const input = line.trim();

    if (input === "") {
      rl.prompt();
      return;
    }

    if (input === "exit" || input === "quit") {
      console.log("再见！");
      rl.close();
      return;
    }

    if (input === "help") {
      printHelp();
      rl.prompt();
      return;
    }

    try {
      const result = calculate(input);
      console.log(`= ${formatResult(result)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`错误：${msg}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

// ============================================================
// 入口
// ============================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    runInteractive();
    return;
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  // 将剩余参数拼接为完整表达式
  const expr = args.join(" ");
  try {
    const result = calculate(expr);
    console.log(formatResult(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`错误：${msg}`);
    process.exit(1);
  }
}

main();
