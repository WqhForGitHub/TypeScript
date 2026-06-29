#!/usr/bin/env node
/**
 * 简易计算器 CLI (增强版)
 * 支持运算符：+  -  *  /  %  ^  (  )
 * 新增功能：变量、常量(pi/e)、函数(sqrt/sin/cos/tan/log/ln/abs)、阶乘(!)、历史记录、AST 求值
 */

import * as readline from "readline";

// ============================================================
// 1. 枚举
// ============================================================

enum TokenType {
    Number = "number",
    Operator = "operator",
    LParen = "lparen",
    RParen = "rparen",
    Function = "function",
    Constant = "constant",
    Variable = "variable",
    EOF = "eof",
}

enum Operator {
    Add = "+",
    Sub = "-",
    Mul = "*",
    Div = "/",
    Mod = "%",
    Pow = "^",
    Factorial = "!",
}

enum Associativity {
    Left = "left",
    Right = "right",
}

enum EvalMode {
    RPN = "rpn",
    AST = "ast",
}

// ============================================================
// 2. 接口（含 readonly / optional）
// ============================================================

interface Token {
    readonly type: TokenType;
    readonly value: string;
    readonly position: readonly [number, number];
}

interface OperatorInfo {
    readonly precedence: number;
    readonly associativity: Associativity;
    readonly apply: (a: number, b: number) => number;
    readonly arity: 1 | 2;
}

interface SessionOptions {
    readonly mode: EvalMode;
    readonly precision: number;
    readonly color: boolean;
    readonly verbose: boolean;
}

interface HistoryEntry {
    readonly id: number;
    readonly expression: string;
    readonly result: number;
    readonly timestamp: Date;
    readonly mode: EvalMode;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

class CalculatorError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly position?: readonly [number, number],
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

class TokenizeError extends CalculatorError {
    constructor(message: string, position: readonly [number, number]) {
        super(message, "TOKENIZE_ERROR", position);
    }
}

class ParseError extends CalculatorError {
    constructor(message: string, position?: readonly [number, number]) {
        super(message, "PARSE_ERROR", position);
    }
}

class EvalError_ extends CalculatorError {
    constructor(message: string) {
        super(message, "EVAL_ERROR");
    }
}

// ============================================================
// 4. 泛型 + 约束
// ============================================================

type OperatorKey = keyof typeof OPERATORS_MAP;

function defineOperator<K extends Operator>(
    op: K,
    info: OperatorInfo,
): readonly [K, OperatorInfo] {
    return [op, info] as const;
}

// ============================================================
// 5. 映射类型
// ============================================================

type OperatorMap = { readonly [K in Operator]: OperatorInfo };

// ============================================================
// 6. 条件类型
// ============================================================

type UnaryFn = (x: number) => number;
type BinaryFn = (a: number, b: number) => number;
type FunctionArity<T extends "unary" | "binary"> = T extends "unary"
    ? UnaryFn
    : T extends "binary"
      ? BinaryFn
      : never;

// ============================================================
// 7. 判别联合 (AST 节点)
// ============================================================

type AstNode =
    | { readonly type: "Number"; readonly value: number; readonly token: Token }
    | {
          readonly type: "BinaryOp";
          readonly op: Operator;
          readonly left: AstNode;
          readonly right: AstNode;
      }
    | {
          readonly type: "UnaryOp";
          readonly op: Operator;
          readonly operand: AstNode;
      }
    | {
          readonly type: "FuncCall";
          readonly name: string;
          readonly arg: AstNode;
      }
    | {
          readonly type: "Constant";
          readonly name: string;
          readonly value: number;
      }
    | { readonly type: "Variable"; readonly name: string };

// ============================================================
// 8. 常量与函数表（as const + satisfies）
// ============================================================

const OPERATORS_MAP = {
    [Operator.Add]: {
        precedence: 1,
        associativity: Associativity.Left,
        apply: (a: number, b: number) => a + b,
        arity: 2 as const,
    },
    [Operator.Sub]: {
        precedence: 1,
        associativity: Associativity.Left,
        apply: (a: number, b: number) => a - b,
        arity: 2 as const,
    },
    [Operator.Mul]: {
        precedence: 2,
        associativity: Associativity.Left,
        apply: (a: number, b: number) => a * b,
        arity: 2 as const,
    },
    [Operator.Div]: {
        precedence: 2,
        associativity: Associativity.Left,
        apply: (a: number, b: number) => {
            if (b === 0) throw new EvalError_("除数不能为 0");
            return a / b;
        },
        arity: 2 as const,
    },
    [Operator.Mod]: {
        precedence: 2,
        associativity: Associativity.Left,
        apply: (a: number, b: number) => {
            if (b === 0) throw new EvalError_("取模运算的除数不能为 0");
            return a % b;
        },
        arity: 2 as const,
    },
    [Operator.Pow]: {
        precedence: 3,
        associativity: Associativity.Right,
        apply: (a: number, b: number) => Math.pow(a, b),
        arity: 2 as const,
    },
    [Operator.Factorial]: {
        precedence: 4,
        associativity: Associativity.Left,
        apply: (_a: number, b: number) => {
            if (b < 0 || !Number.isInteger(b))
                throw new EvalError_("阶乘需要非负整数");
            let result = 1;
            for (let i = 2; i <= b; i++) result *= i;
            return result;
        },
        arity: 1 as const,
    },
} as const satisfies OperatorMap;

const CONSTANTS = {
    pi: Math.PI,
    e: Math.E,
    tau: Math.PI * 2,
    inf: Infinity,
} as const satisfies Record<string, number>;

const FUNCTIONS: Record<
    string,
    { readonly fn: UnaryFn; readonly description: string }
> = {
    sqrt: { fn: (x) => Math.sqrt(x), description: "平方根" },
    abs: { fn: (x) => Math.abs(x), description: "绝对值" },
    sin: { fn: (x) => Math.sin(x), description: "正弦" },
    cos: { fn: (x) => Math.cos(x), description: "余弦" },
    tan: { fn: (x) => Math.tan(x), description: "正切" },
    log: { fn: (x) => Math.log10(x), description: "以 10 为底对数" },
    ln: { fn: (x) => Math.log(x), description: "自然对数" },
    exp: { fn: (x) => Math.exp(x), description: "指数 e^x" },
    floor: { fn: (x) => Math.floor(x), description: "向下取整" },
    ceil: { fn: (x) => Math.ceil(x), description: "向上取整" },
    round: { fn: (x) => Math.round(x), description: "四舍五入" },
};

const FUNCTION_NAMES = Object.keys(FUNCTIONS) as readonly string[];
const CONSTANT_NAMES = Object.keys(CONSTANTS) as readonly string[];

// ============================================================
// 9. 类型守卫
// ============================================================

function isOperatorChar(ch: string): ch is Operator {
    return ch in OPERATORS_MAP;
}

function isFunctionName(name: string): boolean {
    return name in FUNCTIONS;
}

function isConstantName(name: string): boolean {
    return name in CONSTANTS;
}

function isAlpha(ch: string): boolean {
    return /[a-zA-Z_]/.test(ch);
}

function isDigitOrDot(ch: string): boolean {
    return /[0-9.]/.test(ch);
}

// ============================================================
// 10. 泛型栈类
// ============================================================

class Stack<T> {
    private readonly items: T[] = [];

    push(item: T): void {
        this.items.push(item);
    }

    pop(): T {
        if (this.items.length === 0) throw new EvalError_("栈下溢");
        return this.items.pop()!;
    }

    peek(): T | undefined {
        return this.items[this.items.length - 1];
    }

    get size(): number {
        return this.items.length;
    }

    get isEmpty(): boolean {
        return this.items.length === 0;
    }

    toArray(): readonly T[] {
        return [...this.items];
    }

    *[Symbol.iterator](): Iterator<T> {
        for (const item of this.items) yield item;
    }
}

// ============================================================
// 11. 变量会话
// ============================================================

class VariableSession {
    private readonly vars = new Map<string, number>();

    set(name: string, value: number): void {
        if (CONSTANT_NAMES.includes(name)) {
            throw new EvalError_(`不能覆盖常量: ${name}`);
        }
        this.vars.set(name, value);
    }

    get(name: string): number | undefined {
        return this.vars.get(name);
    }

    has(name: string): boolean {
        return this.vars.has(name);
    }

    delete(name: string): boolean {
        return this.vars.delete(name);
    }

    clear(): void {
        this.vars.clear();
    }

    entries(): readonly { name: string; value: number }[] {
        return Array.from(this.vars.entries()).map(([name, value]) => ({
            name,
            value,
        }));
    }
}

// ============================================================
// 12. 历史记录
// ============================================================

class History {
    private readonly entries: HistoryEntry[] = [];
    private nextId = 1;
    private readonly maxSize: number;

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    add(expression: string, result: number, mode: EvalMode): void {
        this.entries.push({
            id: this.nextId++,
            expression,
            result,
            timestamp: new Date(),
            mode,
        });
        if (this.entries.length > this.maxSize) this.entries.shift();
    }

    get last(): HistoryEntry | undefined {
        return this.entries[this.entries.length - 1];
    }

    get count(): number {
        return this.entries.length;
    }

    *iterate(): Generator<HistoryEntry, void, unknown> {
        for (const e of this.entries) yield e;
    }

    clear(): void {
        this.entries.length = 0;
    }

    toSummary(): readonly string[] {
        return this.entries.map(
            (e) => `[${e.id}] ${e.expression} = ${e.result}  (${e.mode})`,
        );
    }
}

// ============================================================
// 13. 词法分析 (Tokenizer)
// ============================================================

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < input.length) {
        const ch = input[i];
        const pos: readonly [number, number] = [i, i + 1];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        // 数字
        if (isDigitOrDot(ch)) {
            let num = "";
            let dotCount = 0;
            const start = i;
            while (i < input.length && isDigitOrDot(input[i])) {
                if (input[i] === ".") {
                    dotCount++;
                    if (dotCount > 1)
                        throw new TokenizeError("非法数字格式：多个小数点", [
                            start,
                            i + 1,
                        ]);
                }
                num += input[i];
                i++;
            }
            tokens.push({
                type: TokenType.Number,
                value: num,
                position: [start, i],
            });
            continue;
        }

        // 标识符 (函数/常量/变量)
        if (isAlpha(ch)) {
            let name = "";
            const start = i;
            while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                name += input[i];
                i++;
            }
            if (isFunctionName(name)) {
                tokens.push({
                    type: TokenType.Function,
                    value: name,
                    position: [start, i],
                });
            } else if (isConstantName(name)) {
                tokens.push({
                    type: TokenType.Constant,
                    value: name,
                    position: [start, i],
                });
            } else {
                tokens.push({
                    type: TokenType.Variable,
                    value: name,
                    position: [start, i],
                });
            }
            continue;
        }

        // 括号
        if (ch === "(") {
            tokens.push({ type: TokenType.LParen, value: ch, position: pos });
            i++;
            continue;
        }
        if (ch === ")") {
            tokens.push({ type: TokenType.RParen, value: ch, position: pos });
            i++;
            continue;
        }

        // 阶乘
        if (ch === "!") {
            tokens.push({
                type: TokenType.Operator,
                value: Operator.Factorial,
                position: pos,
            });
            i++;
            continue;
        }

        // 运算符（含一元处理）
        if (isOperatorChar(ch as Operator)) {
            if ((ch === "-" || ch === "+") && isUnaryContext(tokens)) {
                if (ch === "-") {
                    // 读取后续数字
                    let num = "-";
                    i++;
                    while (i < input.length && /\s/.test(input[i])) i++;
                    if (i < input.length && isDigitOrDot(input[i])) {
                        while (i < input.length && isDigitOrDot(input[i])) {
                            num += input[i];
                            i++;
                        }
                        tokens.push({
                            type: TokenType.Number,
                            value: num,
                            position: [pos[0], i],
                        });
                        continue;
                    }
                    if (i < input.length && input[i] === "(") {
                        tokens.push({
                            type: TokenType.Number,
                            value: "0",
                            position: pos,
                        });
                        tokens.push({
                            type: TokenType.Operator,
                            value: Operator.Sub,
                            position: pos,
                        });
                        continue;
                    }
                    throw new TokenizeError(
                        `一元运算符 '${ch}' 后缺少操作数`,
                        pos,
                    );
                }
                // 一元正号，跳过
                i++;
                continue;
            }
            tokens.push({ type: TokenType.Operator, value: ch, position: pos });
            i++;
            continue;
        }

        throw new TokenizeError(`非法字符: '${ch}'`, pos);
    }

    tokens.push({ type: TokenType.EOF, value: "", position: [i, i] });
    return tokens;
}

function isUnaryContext(tokens: Token[]): boolean {
    if (tokens.length === 0) return true;
    const last = tokens[tokens.length - 1];
    return last.type === TokenType.Operator || last.type === TokenType.LParen;
}

// ============================================================
// 14. Shunting Yard (中缀 → 后缀)
// ============================================================

function toRPN(tokens: Token[]): Token[] {
    const output: Token[] = [];
    const opStack = new Stack<Token>();

    for (const token of tokens) {
        switch (token.type) {
            case TokenType.Number:
            case TokenType.Constant:
            case TokenType.Variable:
                output.push(token);
                break;

            case TokenType.Function:
                opStack.push(token);
                break;

            case TokenType.Operator: {
                const op = token.value as Operator;
                const curInfo = OPERATORS_MAP[op];
                while (!opStack.isEmpty) {
                    const top = opStack.peek()!;
                    if (top.type === TokenType.Function) {
                        output.push(opStack.pop());
                        continue;
                    }
                    if (top.type === TokenType.Operator) {
                        const topOp = top.value as Operator;
                        const topInfo = OPERATORS_MAP[topOp];
                        if (
                            topInfo.precedence > curInfo.precedence ||
                            (topInfo.precedence === curInfo.precedence &&
                                curInfo.associativity === Associativity.Left)
                        ) {
                            output.push(opStack.pop());
                            continue;
                        }
                    }
                    break;
                }
                opStack.push(token);
                break;
            }

            case TokenType.LParen:
                opStack.push(token);
                break;

            case TokenType.RParen: {
                let found = false;
                while (!opStack.isEmpty) {
                    const top = opStack.pop();
                    if (top.type === TokenType.LParen) {
                        found = true;
                        break;
                    }
                    output.push(top);
                }
                if (!found)
                    throw new ParseError(
                        "括号不匹配：缺少 '('",
                        token.position,
                    );
                break;
            }

            case TokenType.EOF:
                break;
        }
    }

    while (!opStack.isEmpty) {
        const top = opStack.pop();
        if (top.type === TokenType.LParen || top.type === TokenType.RParen) {
            throw new ParseError("括号不匹配", top.position);
        }
        output.push(top);
    }

    return output;
}

// ============================================================
// 15. RPN 求值
// ============================================================

function evalRPN(rpn: Token[], session: VariableSession): number {
    const stack = new Stack<number>();

    for (const token of rpn) {
        switch (token.type) {
            case TokenType.Number: {
                const n = Number(token.value);
                if (isNaN(n)) throw new EvalError_(`无效数字: ${token.value}`);
                stack.push(n);
                break;
            }
            case TokenType.Constant: {
                stack.push(CONSTANTS[token.value as keyof typeof CONSTANTS]);
                break;
            }
            case TokenType.Variable: {
                const val = session.get(token.value);
                if (val === undefined)
                    throw new EvalError_(`未定义变量: ${token.value}`);
                stack.push(val);
                break;
            }
            case TokenType.Function: {
                const fnDef = FUNCTIONS[token.value];
                if (!fnDef) throw new EvalError_(`未知函数: ${token.value}`);
                if (stack.size < 1)
                    throw new EvalError_(`函数 '${token.value}' 缺少参数`);
                stack.push(fnDef.fn(stack.pop()));
                break;
            }
            case TokenType.Operator: {
                const info = OPERATORS_MAP[token.value as Operator];
                if (info.arity === 1) {
                    if (stack.size < 1)
                        throw new EvalError_(
                            `运算符 '${token.value}' 缺少操作数`,
                        );
                    const a = stack.pop();
                    stack.push(info.apply(0, a));
                } else {
                    if (stack.size < 2)
                        throw new EvalError_(
                            `运算符 '${token.value}' 缺少操作数`,
                        );
                    const b = stack.pop();
                    const a = stack.pop();
                    stack.push(info.apply(a, b));
                }
                break;
            }
        }
    }

    if (stack.size !== 1) throw new EvalError_("非法表达式");
    return stack.pop();
}

// ============================================================
// 16. AST 解析器（递归下降）
// ============================================================

class Parser {
    private pos = 0;

    constructor(private readonly tokens: Token[]) {}

    private get current(): Token {
        return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
    }

    private advance(): Token {
        return this.tokens[this.pos++];
    }

    private expect(type: TokenType, value?: string): Token {
        const tok = this.current;
        if (tok.type !== type || (value && tok.value !== value)) {
            throw new ParseError(
                `期望 ${value ?? type} 但得到 '${tok.value}'`,
                tok.position,
            );
        }
        return this.advance();
    }

    parse(): AstNode {
        const node = this.parseExpression();
        if (this.current.type !== TokenType.EOF) {
            throw new ParseError("未预期的 token", this.current.position);
        }
        return node;
    }

    private parseExpression(): AstNode {
        return this.parseAddSub();
    }

    private parseAddSub(): AstNode {
        let left = this.parseMulDiv();
        while (
            this.current.type === TokenType.Operator &&
            (this.current.value === Operator.Add ||
                this.current.value === Operator.Sub)
        ) {
            const op = this.advance().value as Operator;
            const right = this.parseMulDiv();
            left = { type: "BinaryOp", op, left, right };
        }
        return left;
    }

    private parseMulDiv(): AstNode {
        let left = this.parsePow();
        while (
            this.current.type === TokenType.Operator &&
            (this.current.value === Operator.Mul ||
                this.current.value === Operator.Div ||
                this.current.value === Operator.Mod)
        ) {
            const op = this.advance().value as Operator;
            const right = this.parsePow();
            left = { type: "BinaryOp", op, left, right };
        }
        return left;
    }

    private parsePow(): AstNode {
        const left = this.parseUnary();
        if (
            this.current.type === TokenType.Operator &&
            this.current.value === Operator.Pow
        ) {
            const op = this.advance().value as Operator;
            const right = this.parsePow();
            return { type: "BinaryOp", op, left, right };
        }
        return left;
    }

    private parseUnary(): AstNode {
        if (
            this.current.type === TokenType.Operator &&
            this.current.value === Operator.Sub
        ) {
            this.advance();
            const operand = this.parseUnary();
            return { type: "UnaryOp", op: Operator.Sub, operand };
        }
        return this.parseFactorial();
    }

    private parseFactorial(): AstNode {
        let node = this.parsePrimary();
        while (
            this.current.type === TokenType.Operator &&
            this.current.value === Operator.Factorial
        ) {
            this.advance();
            node = { type: "UnaryOp", op: Operator.Factorial, operand: node };
        }
        return node;
    }

    private parsePrimary(): AstNode {
        const tok = this.current;

        switch (tok.type) {
            case TokenType.Number: {
                this.advance();
                return { type: "Number", value: Number(tok.value), token: tok };
            }
            case TokenType.Constant: {
                this.advance();
                return {
                    type: "Constant",
                    name: tok.value,
                    value: CONSTANTS[tok.value as keyof typeof CONSTANTS],
                };
            }
            case TokenType.Variable: {
                this.advance();
                return { type: "Variable", name: tok.value };
            }
            case TokenType.Function: {
                this.advance();
                this.expect(TokenType.LParen);
                const arg = this.parseExpression();
                this.expect(TokenType.RParen);
                return { type: "FuncCall", name: tok.value, arg };
            }
            case TokenType.LParen: {
                this.advance();
                const node = this.parseExpression();
                this.expect(TokenType.RParen);
                return node;
            }
            default:
                throw new ParseError(
                    `未预期的 token: '${tok.value}'`,
                    tok.position,
                );
        }
    }
}

// ============================================================
// 17. AST 求值（访问者模式）
// ============================================================

function evalAst(node: AstNode, session: VariableSession): number {
    switch (node.type) {
        case "Number":
            return node.value;
        case "Constant":
            return node.value;
        case "Variable": {
            const val = session.get(node.name);
            if (val === undefined)
                throw new EvalError_(`未定义变量: ${node.name}`);
            return val;
        }
        case "UnaryOp": {
            const v = evalAst(node.operand, session);
            if (node.op === Operator.Sub) return -v;
            if (node.op === Operator.Factorial) {
                if (v < 0 || !Number.isInteger(v))
                    throw new EvalError_("阶乘需要非负整数");
                let r = 1;
                for (let i = 2; i <= v; i++) r *= i;
                return r;
            }
            throw new EvalError_(`未知一元运算符: ${node.op}`);
        }
        case "BinaryOp": {
            const a = evalAst(node.left, session);
            const b = evalAst(node.right, session);
            return OPERATORS_MAP[node.op].apply(a, b);
        }
        case "FuncCall": {
            const fnDef = FUNCTIONS[node.name];
            if (!fnDef) throw new EvalError_(`未知函数: ${node.name}`);
            return fnDef.fn(evalAst(node.arg, session));
        }
    }
}

// ============================================================
// 18. 对外计算接口（函数重载）
// ============================================================

function calculate(expr: string, session: VariableSession): number;
function calculate(
    expr: string,
    session: VariableSession,
    mode: EvalMode,
): number;
function calculate(
    expr: string,
    session: VariableSession,
    mode: EvalMode = EvalMode.RPN,
): number {
    const tokens = tokenize(expr);
    if (tokens.length <= 1) throw new EvalError_("空表达式");

    if (mode === EvalMode.AST) {
        const parser = new Parser(tokens);
        const ast = parser.parse();
        return evalAst(ast, session);
    }

    const rpn = toRPN(tokens);
    return evalRPN(rpn, session);
}

// ============================================================
// 19. 格式化与输出
// ============================================================

const COLORS = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m",
    reset: "\x1b[0m",
} as const satisfies Record<string, string>;

function formatResult(value: number, precision: number): string {
    if (!isFinite(value)) return value.toString();
    const fixed = value.toFixed(precision);
    return parseFloat(fixed).toString();
}

function colorize(
    text: string,
    color: keyof typeof COLORS,
    enabled: boolean,
): string {
    return enabled ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

// ============================================================
// 20. 赋值解析
// ============================================================

interface Assignment {
    readonly variable: string;
    readonly expression: string;
}

function parseAssignment(input: string): Assignment | null {
    const match = input.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (!match) return null;
    return { variable: match[1], expression: match[2] };
}

// ============================================================
// 21. 交互模式
// ============================================================

function printBanner(): void {
    console.log(
        colorize("==========================================", "cyan", true),
    );
    console.log(colorize("   TypeScript 简易计算器 (增强版)", "bold", true));
    console.log(
        colorize("==========================================", "cyan", true),
    );
    console.log("运算符: +  -  *  /  %  ^  !  (  )");
    console.log(`函数:   ${FUNCTION_NAMES.join(", ")}`);
    console.log(`常量:   ${CONSTANT_NAMES.join(", ")}`);
    console.log(
        "命令:   help | vars | history | mode <rpn|ast> | clear | exit",
    );
    console.log("");
}

function printHelp(): void {
    console.log(`
Usage:
  calc-cli                    进入交互模式
  calc-cli "<expression>"     直接计算
  calc-cli --help | -h        显示帮助

Operators: + - * / % ^ ! ( )
Functions: ${FUNCTION_NAMES.join(", ")}
Constants: ${CONSTANT_NAMES.join(", ")}

Assignment:
  x = 5          赋值变量
  x + pi * 2     使用变量和常量

Commands (interactive):
  vars           查看所有变量
  history        查看历史记录
  mode rpn|ast   切换求值模式
  clear          清除变量和历史
  exit | quit    退出
`);
}

function runInteractive(): void {
    printBanner();

    const session = new VariableSession();
    const history = new History(50);
    let opts: SessionOptions = {
        mode: EvalMode.RPN,
        precision: 10,
        color: true,
        verbose: false,
    };

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

        if (input === "vars") {
            const entries = session.entries();
            if (entries.length === 0) console.log("  (无变量)");
            else
                entries.forEach((e) =>
                    console.log(
                        `  ${e.name} = ${formatResult(e.value, opts.precision)}`,
                    ),
                );
            rl.prompt();
            return;
        }

        if (input === "history") {
            const summary = history.toSummary();
            if (summary.length === 0) console.log("  (无历史记录)");
            else summary.forEach((s) => console.log(`  ${s}`));
            rl.prompt();
            return;
        }

        if (input.startsWith("mode ")) {
            const m = input.slice(5).trim();
            if (m === EvalMode.RPN || m === EvalMode.AST) {
                opts = { ...opts, mode: m };
                console.log(
                    colorize(`求值模式切换为: ${m}`, "green", opts.color),
                );
            } else {
                console.log(colorize(`未知模式: ${m}`, "red", opts.color));
            }
            rl.prompt();
            return;
        }

        if (input === "clear") {
            session.clear();
            history.clear();
            console.log(colorize("已清除所有变量和历史", "yellow", opts.color));
            rl.prompt();
            return;
        }

        // 赋值
        const assignment = parseAssignment(input);
        const expr = assignment ? assignment.expression : input;

        try {
            const result = calculate(expr, session, opts.mode);
            if (assignment) {
                session.set(assignment.variable, result);
                console.log(
                    colorize(
                        `${assignment.variable} = ${formatResult(result, opts.precision)}`,
                        "green",
                        opts.color,
                    ),
                );
            } else {
                console.log(
                    colorize(
                        `= ${formatResult(result, opts.precision)}`,
                        "bold",
                        opts.color,
                    ),
                );
            }
            history.add(input, result, opts.mode);
        } catch (err) {
            const msg =
                err instanceof CalculatorError
                    ? `[${err.code}] ${err.message}`
                    : String(err);
            console.error(colorize(`错误: ${msg}`, "red", opts.color));
        }

        rl.prompt();
    });

    rl.on("close", () => process.exit(0));
}

// ============================================================
// 22. 入口
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

    const expr = args.join(" ");
    const session = new VariableSession();

    try {
        const result = calculate(expr, session, EvalMode.RPN);
        console.log(formatResult(result, 10));
    } catch (err) {
        const msg =
            err instanceof CalculatorError
                ? `[${err.code}] ${err.message}`
                : String(err);
        console.error(`错误: ${msg}`);
        process.exit(1);
    }
}

main();
