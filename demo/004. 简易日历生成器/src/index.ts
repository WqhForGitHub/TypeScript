#!/usr/bin/env node
/**
 * 简易日历生成器
 * ---------------------------
 * 使用方式：
 *   cal-cli                  → 显示当前月份日历
 *   cal-cli 2026             → 显示 2026 年全年日历
 *   cal-cli 2026 6           → 显示 2026 年 6 月日历
 *   cal-cli --help           → 显示帮助
 */

// ===================== 类型定义 =====================

/** 月份数字 (1-12) */
type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** 星期数字 (0=周日 ... 6=周六) */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 日历单元格：null 表示空白占位 */
type CalendarCell = number | null;

/** 一周 7 天 */
type CalendarWeek = CalendarCell[];

/** 解析命令行参数后的结果 */
interface ParsedArgs {
    year: number;
    month?: Month;
    showHelp: boolean;
}

// ===================== 常量 =====================

const MONTH_NAMES_CN: readonly string[] = [
    "一月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
];

const WEEKDAY_HEADER_CN: readonly string[] = [
    "日",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
];

// ===================== 工具函数 =====================

/**
 * 判断闰年
 *  - 能被 4 整除但不能被 100 整除
 *  - 或者能被 400 整除
 */
function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 获取指定月份的天数
 */
function getDaysInMonth(year: number, month: Month): number {
    const daysTable: readonly number[] = [
        31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    if (month === 2 && isLeapYear(year)) {
        return 29;
    }
    return daysTable[month - 1];
}

/**
 * 获取指定月 1 号是周几 (0=周日 ... 6=周六)
 */
function getFirstWeekday(year: number, month: Month): Weekday {
    const date = new Date(year, month - 1, 1);
    return date.getDay() as Weekday;
}

/**
 * 构建月份的二维表格 (按周分行)
 */
function buildMonthMatrix(year: number, month: Month): CalendarWeek[] {
    const totalDays = getDaysInMonth(year, month);
    const firstWeekday = getFirstWeekday(year, month);

    const cells: CalendarCell[] = [];

    // 前置空白
    for (let i = 0; i < firstWeekday; i++) {
        cells.push(null);
    }

    // 填入日期
    for (let day = 1; day <= totalDays; day++) {
        cells.push(day);
    }

    // 末尾补齐到 7 的倍数
    while (cells.length % 7 !== 0) {
        cells.push(null);
    }

    // 切分成周
    const weeks: CalendarWeek[] = [];
    for (let i = 0; i < cells.length; i += 7) {
        weeks.push(cells.slice(i, i + 7));
    }

    return weeks;
}

// ===================== 渲染函数 =====================

/**
 * 将单元格渲染为 2 位宽字符串
 */
function renderCell(cell: CalendarCell): string {
    if (cell === null) return "  ";
    return cell.toString().padStart(2, " ");
}

/**
 * 渲染单个月份为字符串
 */
function renderMonth(year: number, month: Month): string {
    const matrix = buildMonthMatrix(year, month);
    const title = `${year} 年 ${MONTH_NAMES_CN[month - 1]}`;
    const header = WEEKDAY_HEADER_CN.join(" ");

    const lines: string[] = [];
    // 标题居中 (整行宽 20 字符左右)
    const totalWidth = header.length;
    const padLeft = Math.max(0, Math.floor((totalWidth - title.length) / 2));
    lines.push(" ".repeat(padLeft) + title);
    lines.push(header);

    for (const week of matrix) {
        lines.push(week.map(renderCell).join(" "));
    }

    return lines.join("\n");
}

/**
 * 渲染整年日历
 */
function renderYear(year: number): string {
    const blocks: string[] = [];
    blocks.push(`========== ${year} 年日历 ==========\n`);

    for (let m = 1; m <= 12; m++) {
        blocks.push(renderMonth(year, m as Month));
        blocks.push("");
    }

    return blocks.join("\n");
}

// ===================== CLI 参数解析 =====================

function printHelp(): void {
    const help = `
简易日历生成器 (TypeScript 版)

用法:
  cal-cli                  显示当前月份日历
  cal-cli <year>           显示指定年份的全年日历
  cal-cli <year> <month>   显示指定年月的日历
  cal-cli --help, -h       显示帮助信息

示例:
  cal-cli
  cal-cli 2026
  cal-cli 2026 6
`.trim();
    console.log(help);
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    const now = new Date();

    // 帮助
    if (args.includes("--help") || args.includes("-h")) {
        return { year: now.getFullYear(), showHelp: true };
    }

    // 无参数：显示当前月
    if (args.length === 0) {
        return {
            year: now.getFullYear(),
            month: (now.getMonth() + 1) as Month,
            showHelp: false,
        };
    }

    // 解析年份
    const yearNum = Number(args[0]);
    if (!Number.isInteger(yearNum) || yearNum < 1 || yearNum > 9999) {
        throw new Error(`无效年份: "${args[0]}" (应为 1-9999 之间的整数)`);
    }

    // 仅年份
    if (args.length === 1) {
        return { year: yearNum, showHelp: false };
    }

    // 年份 + 月份
    const monthNum = Number(args[1]);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new Error(`无效月份: "${args[1]}" (应为 1-12 之间的整数)`);
    }

    return {
        year: yearNum,
        month: monthNum as Month,
        showHelp: false,
    };
}

// ===================== 主入口 =====================

function main(): void {
    try {
        const parsed = parseArgs(process.argv);

        if (parsed.showHelp) {
            printHelp();
            return;
        }

        if (parsed.month !== undefined) {
            console.log(renderMonth(parsed.year, parsed.month));
        } else {
            console.log(renderYear(parsed.year));
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`错误: ${msg}\n`);
        printHelp();
        process.exit(1);
    }
}

main();
