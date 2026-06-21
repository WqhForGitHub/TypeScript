#!/usr/bin/env node
"use strict";
/**
 * 倒计时计时器 (Countdown Timer)
 * ---------------------------
 * 使用方式：
 *   countdown-cli 30                  → 倒计时 30 秒
 *   countdown-cli 1m30s               → 倒计时 1 分 30 秒
 *   countdown-cli 1h                  → 倒计时 1 小时
 *   countdown-cli 1d2h3m4s            → 倒计时 1 天 2 小时 3 分 4 秒
 *   countdown-cli --to "2026-01-01 00:00:00"   → 倒计时到指定时间
 *   countdown-cli --help              → 显示帮助
 */
// ===================== 常量 =====================
/** 单位 → 毫秒的换算表 */
const UNIT_TO_MS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};
/** 渲染时使用的 ANSI 控制字符 */
const ANSI = {
    /** 清除当前行并将光标回到行首 */
    CLEAR_LINE: "\r\x1b[2K",
    /** 隐藏光标 */
    HIDE_CURSOR: "\x1b[?25l",
    /** 显示光标 */
    SHOW_CURSOR: "\x1b[?25h",
};
// ===================== 工具函数 =====================
/**
 * 将形如 "1d2h3m4s" / "90s" / "30" 的字符串解析为毫秒数。
 *  - 纯数字视为秒
 *  - 支持组合：天(d) 时(h) 分(m) 秒(s)
 */
function parseDuration(input) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.length === 0) {
        throw new Error("时长不能为空");
    }
    // 纯数字 → 视为秒
    if (/^\d+$/.test(trimmed)) {
        const sec = Number(trimmed);
        if (sec <= 0) {
            throw new Error("倒计时秒数必须大于 0");
        }
        return sec * UNIT_TO_MS.s;
    }
    // 组合格式：必须由 数字+单位 段组成
    const pattern = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
    const match = trimmed.match(pattern);
    if (!match) {
        throw new Error(`无法解析时长: "${input}" (示例: 30 / 90s / 1m30s / 1h / 1d2h3m4s)`);
    }
    const [, d, h, m, s] = match;
    const days = d ? Number(d) : 0;
    const hours = h ? Number(h) : 0;
    const minutes = m ? Number(m) : 0;
    const seconds = s ? Number(s) : 0;
    const totalMs = days * UNIT_TO_MS.d +
        hours * UNIT_TO_MS.h +
        minutes * UNIT_TO_MS.m +
        seconds * UNIT_TO_MS.s;
    if (totalMs <= 0) {
        throw new Error("倒计时时长必须大于 0");
    }
    return totalMs;
}
/**
 * 解析目标时间字符串为毫秒时间戳。
 * 支持: "YYYY-MM-DD" / "YYYY-MM-DD HH:mm" / "YYYY-MM-DD HH:mm:ss" / ISO
 */
function parseTargetTime(input) {
    const ts = Date.parse(input);
    if (Number.isNaN(ts)) {
        throw new Error(`无法解析目标时间: "${input}" (示例: 2026-01-01 00:00:00)`);
    }
    const diff = ts - Date.now();
    if (diff <= 0) {
        throw new Error(`目标时间已过去: ${new Date(ts).toLocaleString()}`);
    }
    return diff;
}
/**
 * 将毫秒数拆分为 天/时/分/秒
 */
function splitDuration(ms) {
    const safe = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(safe / (24 * 60 * 60));
    const hours = Math.floor((safe % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((safe % (60 * 60)) / 60);
    const seconds = safe % 60;
    return { days, hours, minutes, seconds };
}
/**
 * 将数字补 2 位 0
 */
function pad2(n) {
    return n.toString().padStart(2, "0");
}
/**
 * 将 TimeParts 渲染为 "DD天 HH:mm:ss" 或 "HH:mm:ss"
 */
function formatTimeParts(parts) {
    const hms = `${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`;
    if (parts.days > 0) {
        return `${parts.days} 天 ${hms}`;
    }
    return hms;
}
// ===================== 倒计时核心 =====================
/**
 * 启动倒计时。返回一个 Promise，在倒计时结束时 resolve。
 *  - 使用 setInterval 每 250ms 刷新一次显示
 *  - 基于 endTime - now() 计算剩余时间，避免累积漂移
 */
function startCountdown(totalMs, label) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const endTime = startTime + totalMs;
        process.stdout.write(ANSI.HIDE_CURSOR);
        const render = () => {
            const remain = endTime - Date.now();
            const parts = splitDuration(remain);
            const text = `⏳ ${label}  剩余: ${formatTimeParts(parts)}`;
            process.stdout.write(ANSI.CLEAR_LINE + text);
            return remain <= 0;
        };
        // 立即渲染一次
        render();
        const timer = setInterval(() => {
            const finished = render();
            if (finished) {
                clearInterval(timer);
                process.stdout.write(ANSI.CLEAR_LINE + `✅ ${label}  倒计时结束！\n` + ANSI.SHOW_CURSOR);
                resolve();
            }
        }, 250);
        // 处理 Ctrl+C 中断
        const onInterrupt = () => {
            clearInterval(timer);
            process.stdout.write(ANSI.CLEAR_LINE + `⛔ 已中断倒计时。\n` + ANSI.SHOW_CURSOR);
            process.exit(130);
        };
        process.once("SIGINT", onInterrupt);
    });
}
// ===================== CLI 参数解析 =====================
function printHelp() {
    const help = `
倒计时计时器 (TypeScript 版)

用法:
  countdown-cli <时长>                倒计时指定时长
  countdown-cli --to <目标时间>       倒计时到指定时间点
  countdown-cli --help, -h            显示帮助

时长格式:
  30          30 秒 (纯数字视为秒)
  90s         90 秒
  1m30s       1 分 30 秒
  1h          1 小时
  1d2h3m4s    1 天 2 小时 3 分 4 秒

目标时间格式:
  "2026-01-01"
  "2026-01-01 12:00"
  "2026-01-01 12:00:00"

示例:
  countdown-cli 30
  countdown-cli 1m30s
  countdown-cli 1d
  countdown-cli --to "2026-01-01 00:00:00"
`.trim();
    console.log(help);
}
function parseArgs(argv) {
    const args = argv.slice(2);
    // 帮助
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        return {
            totalMs: 0,
            rawInput: "",
            showHelp: true,
            isTargetMode: false,
        };
    }
    // 目标时间模式
    if (args[0] === "--to") {
        if (args.length < 2) {
            throw new Error('--to 需要一个目标时间参数, 例如: --to "2026-01-01"');
        }
        const target = args.slice(1).join(" ");
        const totalMs = parseTargetTime(target);
        return {
            totalMs,
            rawInput: `→ ${target}`,
            showHelp: false,
            isTargetMode: true,
        };
    }
    // 时长模式
    const raw = args[0];
    const totalMs = parseDuration(raw);
    return {
        totalMs,
        rawInput: raw,
        showHelp: false,
        isTargetMode: false,
    };
}
// ===================== 主入口 =====================
async function main() {
    try {
        const parsed = parseArgs(process.argv);
        if (parsed.showHelp) {
            printHelp();
            return;
        }
        const label = parsed.isTargetMode
            ? `目标时间 ${parsed.rawInput.replace(/^→\s*/, "")}`
            : `倒计时 ${parsed.rawInput} (共 ${formatTimeParts(splitDuration(parsed.totalMs))})`;
        console.log(`🚀 开始：${label}`);
        await startCountdown(parsed.totalMs, label);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`错误: ${msg}\n`);
        printHelp();
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map