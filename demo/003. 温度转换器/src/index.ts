#!/usr/bin/env node

/**
 * 温度转换器 CLI
 * 一个使用纯 TypeScript 编写的命令行温度转换器演示。
 *
 * 支持单位：
 *   C  摄氏度 (Celsius)
 *   F  华氏度 (Fahrenheit)
 *   K  开尔文 (Kelvin)
 *
 * 两种用法：
 *   1. 直接传入参数：temp-cli 100 C F
 *      （把 100 摄氏度转换为华氏度）
 *   2. 进入交互模式：  temp-cli
 */

import * as readline from "readline";

// ============================================================
// 类型定义
// ============================================================

type Unit = "C" | "F" | "K";

interface ConversionResult {
    value: number;
    from: Unit;
    to: Unit;
    result: number;
}

const UNIT_NAMES: Record<Unit, string> = {
    C: "摄氏度 (Celsius)",
    F: "华氏度 (Fahrenheit)",
    K: "开尔文 (Kelvin)",
};

const UNIT_SYMBOLS: Record<Unit, string> = {
    C: "°C",
    F: "°F",
    K: "K",
};

// 各单位的绝对零度（用于校验）
const ABSOLUTE_ZERO: Record<Unit, number> = {
    C: -273.15,
    F: -459.67,
    K: 0,
};

// ============================================================
// 转换核心：先转为开尔文，再从开尔文转目标单位
// ============================================================

function toKelvin(value: number, from: Unit): number {
    switch (from) {
        case "C":
            return value + 273.15;
        case "F":
            return (value - 32) * (5 / 9) + 273.15;
        case "K":
            return value;
    }
}

function fromKelvin(kelvin: number, to: Unit): number {
    switch (to) {
        case "C":
            return kelvin - 273.15;
        case "F":
            return (kelvin - 273.15) * (9 / 5) + 32;
        case "K":
            return kelvin;
    }
}

function convert(value: number, from: Unit, to: Unit): ConversionResult {
    if (value < ABSOLUTE_ZERO[from]) {
        throw new Error(
            `输入温度低于绝对零度：${UNIT_NAMES[from]} 不能小于 ${ABSOLUTE_ZERO[from]} ${UNIT_SYMBOLS[from]}`,
        );
    }
    const kelvin = toKelvin(value, from);
    const result = fromKelvin(kelvin, to);
    return { value, from, to, result };
}

// ============================================================
// 输入解析
// ============================================================

function parseUnit(s: string): Unit {
    const u = s.trim().toUpperCase();
    // 允许形如 C、°C、celsius 等输入
    switch (u) {
        case "C":
        case "°C":
        case "CELSIUS":
        case "摄氏度":
        case "摄氏":
            return "C";
        case "F":
        case "°F":
        case "FAHRENHEIT":
        case "华氏度":
        case "华氏":
            return "F";
        case "K":
        case "°K":
        case "KELVIN":
        case "开尔文":
        case "开氏度":
            return "K";
        default:
            throw new Error(`未知的温度单位：'${s}'（支持 C / F / K）`);
    }
}

function parseNumber(s: string): number {
    const n = Number(s.trim());
    if (!isFinite(n) || isNaN(n)) {
        throw new Error(`无效的数字：'${s}'`);
    }
    return n;
}

/**
 * 解析交互模式下的一行输入。
 * 支持格式：
 *   100 C F
 *   100C F
 *   100C to F
 *   100C->F
 *   100摄氏度 转 华氏度
 */
function parseLine(line: string): { value: number; from: Unit; to: Unit } {
    // 统一分隔符：把常见的连接词/箭头替换为空格
    const normalized = line
        .replace(/->|=>|→/g, " ")
        .replace(/\bto\b/gi, " ")
        .replace(/\b转\b|\b转为\b|\b转换为\b|\b转成\b/g, " ")
        // 在数字与字母/中文之间插入空格，便于 "100C" 这种写法
        .replace(/(-?\d+(?:\.\d+)?)/g, " $1 ")
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0);

    if (normalized.length !== 3) {
        throw new Error(
            `无法解析输入。期望格式：<数值> <源单位> <目标单位>，例如：100 C F`,
        );
    }

    const [valStr, fromStr, toStr] = normalized;
    return {
        value: parseNumber(valStr),
        from: parseUnit(fromStr),
        to: parseUnit(toStr),
    };
}

// ============================================================
// 输出格式化
// ============================================================

function formatNumber(value: number): string {
    if (!isFinite(value)) return value.toString();
    // 最多 4 位小数，去掉末尾多余 0
    const fixed = value.toFixed(4);
    return parseFloat(fixed).toString();
}

function formatResult(r: ConversionResult): string {
    return `${formatNumber(r.value)} ${UNIT_SYMBOLS[r.from]}  =  ${formatNumber(
        r.result,
    )} ${UNIT_SYMBOLS[r.to]}`;
}

// ============================================================
// 命令行帮助 & 横幅
// ============================================================

function printBanner(): void {
    console.log("==========================================");
    console.log("   TypeScript 温度转换器  (temp-cli)");
    console.log("==========================================");
    console.log("支持单位：C (摄氏度)  F (华氏度)  K (开尔文)");
    console.log("示例输入：100 C F   或   32F to C   或   300 K C");
    console.log("输入 'help' 查看帮助，输入 'exit' 退出。");
    console.log("");
}

function printHelp(): void {
    console.log(`
Usage:
  temp-cli                          进入交互式模式
  temp-cli <value> <from> <to>      直接进行单次转换
  temp-cli --help | -h              显示帮助
  temp-cli --table <value> <from>   打印该温度的全部单位换算表

Units:
  C    摄氏度  (Celsius)
  F    华氏度  (Fahrenheit)
  K    开尔文  (Kelvin)

Examples:
  temp-cli 100 C F          # 100 摄氏度 → 华氏度
  temp-cli 32 F C           # 32 华氏度 → 摄氏度
  temp-cli 0 C K            # 0 摄氏度 → 开尔文
  temp-cli --table 25 C     # 打印 25°C 对应的 C / F / K 三种结果
`);
}

function printTable(value: number, from: Unit): void {
    const units: Unit[] = ["C", "F", "K"];
    console.log(`输入：${formatNumber(value)} ${UNIT_SYMBOLS[from]}`);
    console.log("-----------------------------------");
    for (const u of units) {
        const r = convert(value, from, u);
        const tag = u === from ? "  (原值)" : "";
        console.log(
            `  ${UNIT_NAMES[u].padEnd(22)} : ${formatNumber(r.result)} ${
                UNIT_SYMBOLS[u]
            }${tag}`,
        );
    }
}

// ============================================================
// 交互模式
// ============================================================

function runInteractive(): void {
    printBanner();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "temp> ",
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

        if (input === "help" || input === "?") {
            printHelp();
            rl.prompt();
            return;
        }

        try {
            const { value, from, to } = parseLine(input);
            const r = convert(value, from, to);
            console.log(`= ${formatResult(r)}`);
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

    try {
        if (args[0] === "--table") {
            if (args.length !== 3) {
                throw new Error(
                    "--table 用法：temp-cli --table <value> <from>",
                );
            }
            const value = parseNumber(args[1]);
            const from = parseUnit(args[2]);
            printTable(value, from);
            return;
        }

        if (args.length !== 3) {
            throw new Error(
                "参数数量错误。用法：temp-cli <value> <from> <to>，例如：temp-cli 100 C F",
            );
        }

        const value = parseNumber(args[0]);
        const from = parseUnit(args[1]);
        const to = parseUnit(args[2]);
        const r = convert(value, from, to);
        console.log(formatResult(r));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`错误：${msg}`);
        process.exit(1);
    }
}

main();
