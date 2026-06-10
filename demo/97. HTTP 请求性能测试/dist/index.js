#!/usr/bin/env node
"use strict";
/**
 * HTTP 请求性能测试工具
 *
 * 功能：
 *   - 支持并发 HTTP 请求测试
 *   - 支持 GET / POST / PUT / DELETE 方法
 *   - 实时显示测试进度与吞吐量
 *   - 统计响应时间（Min / Max / Avg / P50 / P90 / P95 / P99）
 *   - 统计吞吐量（Requests/sec）、错误率
 *   - 延迟分布直方图
 *   - 支持自定义请求头和请求体
 *   - 支持超时配置
 *   - 彩色终端输出
 *   - 支持输出 JSON 报告
 *
 * 用法：
 *   node dist/index.js <URL> [选项]
 *
 * 选项：
 *   -n, --requests <num>    总请求数（默认 100）
 *   -c, --concurrency <num> 并发数（默认 10）
 *   -m, --method <method>   HTTP 方法（默认 GET）
 *   -H, --header <k:v>      自定义请求头（可多次指定）
 *   -d, --data <body>       请求体内容
 *   -t, --timeout <ms>      单请求超时时间（默认 10000ms）
 *   --json                  输出 JSON 格式报告
 *   -h, --help              显示帮助信息
 *
 * 示例：
 *   node dist/index.js http://localhost:3000/api
 *   node dist/index.js http://localhost:3000/api -n 500 -c 20
 *   node dist/index.js http://localhost:3000/api -m POST -d '{"key":"value"}'
 *   node dist/index.js http://localhost:3000/api -H "Authorization: Bearer token"
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
// ==================== 常量 ====================
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_CLEAR_LINE = "\x1b[2K";
const ANSI_CURSOR_LEFT = "\x1b[G";
const COLOR = {
    green: (s) => `\x1b[32m${s}${ANSI_RESET}`,
    yellow: (s) => `\x1b[33m${s}${ANSI_RESET}`,
    red: (s) => `\x1b[31m${s}${ANSI_RESET}`,
    blue: (s) => `\x1b[34m${s}${ANSI_RESET}`,
    cyan: (s) => `\x1b[36m${s}${ANSI_RESET}`,
    magenta: (s) => `\x1b[35m${s}${ANSI_RESET}`,
    gray: (s) => `${ANSI_DIM}${s}${ANSI_RESET}`,
    bold: (s) => `${ANSI_BOLD}${s}${ANSI_RESET}`,
};
// ==================== 工具函数 ====================
/** 格式化字节数 */
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
/** 格式化毫秒数 */
function formatMs(ms) {
    if (ms < 1)
        return `${ms.toFixed(3)} ms`;
    if (ms < 1000)
        return `${ms.toFixed(2)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}
/** 格式化持续时间 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return `${minutes}m ${remainSeconds}s`;
}
/** 计算百分位值 */
function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper)
        return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
// ==================== 参数解析 ====================
function parseArgs(args) {
    const config = {
        url: "",
        totalRequests: 100,
        concurrency: 10,
        method: "GET",
        headers: {},
        body: null,
        timeout: 10000,
        outputJson: false,
    };
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        switch (arg) {
            case "-h":
            case "--help":
                printHelp();
                process.exit(0);
            case "-n":
            case "--requests":
                i++;
                if (i < args.length)
                    config.totalRequests = parseInt(args[i], 10);
                break;
            case "-c":
            case "--concurrency":
                i++;
                if (i < args.length)
                    config.concurrency = parseInt(args[i], 10);
                break;
            case "-m":
            case "--method":
                i++;
                if (i < args.length)
                    config.method = args[i].toUpperCase();
                break;
            case "-H":
            case "--header": {
                i++;
                if (i < args.length) {
                    const parts = args[i].split(":");
                    if (parts.length >= 2) {
                        const key = parts[0].trim();
                        const value = parts.slice(1).join(":").trim();
                        config.headers[key] = value;
                    }
                }
                break;
            }
            case "-d":
            case "--data":
                i++;
                if (i < args.length)
                    config.body = args[i];
                break;
            case "-t":
            case "--timeout":
                i++;
                if (i < args.length)
                    config.timeout = parseInt(args[i], 10);
                break;
            case "--json":
                config.outputJson = true;
                break;
            default:
                if (!arg.startsWith("-")) {
                    config.url = arg;
                }
                break;
        }
        i++;
    }
    // 参数校验
    if (!config.url) {
        console.error(COLOR.red("错误: 请提供目标 URL"));
        console.error(COLOR.gray("使用 --help 查看帮助信息"));
        process.exit(1);
    }
    if (!config.url.startsWith("http://") && !config.url.startsWith("https://")) {
        config.url = `http://${config.url}`;
    }
    if (config.totalRequests <= 0) {
        console.error(COLOR.red("错误: 请求数必须大于 0"));
        process.exit(1);
    }
    if (config.concurrency <= 0) {
        console.error(COLOR.red("错误: 并发数必须大于 0"));
        process.exit(1);
    }
    const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    if (!validMethods.includes(config.method)) {
        console.error(COLOR.red(`错误: 不支持的 HTTP 方法: ${config.method}`));
        console.error(COLOR.gray(`支持的方法: ${validMethods.join(", ")}`));
        process.exit(1);
    }
    return config;
}
function printHelp() {
    console.log(`
${COLOR.bold("HTTP 请求性能测试工具")}

${COLOR.cyan("用法:")}
  node dist/index.js <URL> [选项]

${COLOR.cyan("选项:")}
  -n, --requests <num>    总请求数（默认 100）
  -c, --concurrency <num> 并发数（默认 10）
  -m, --method <method>   HTTP 方法（默认 GET）
  -H, --header <k:v>      自定义请求头（可多次指定）
  -d, --data <body>       请求体内容
  -t, --timeout <ms>      单请求超时时间（默认 10000ms）
  --json                  输出 JSON 格式报告
  -h, --help              显示帮助信息

${COLOR.cyan("示例:")}
  node dist/index.js http://localhost:3000/api
  node dist/index.js http://localhost:3000/api -n 500 -c 20
  node dist/index.js http://localhost:3000/api -m POST -d '{"key":"value"}'
  node dist/index.js http://localhost:3000/api -H "Authorization: Bearer token"
  node dist/index.js http://localhost:3000/api -n 1000 -c 50 --json
`);
}
// ==================== HTTP 请求 ====================
/** 发送单次 HTTP 请求并返回结果 */
function sendRequest(config) {
    return new Promise((resolve) => {
        const startTime = performance.now();
        let bytesReceived = 0;
        let resolved = false;
        const done = (result) => {
            if (resolved)
                return;
            resolved = true;
            resolve({
                ...result,
                timestamp: Date.now(),
            });
        };
        try {
            const parsedUrl = new url_1.URL(config.url);
            const isHttps = parsedUrl.protocol === "https:";
            const httpModule = isHttps ? https : http;
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: config.method,
                headers: {
                    "User-Agent": "HttpBench/1.0",
                    Accept: "*/*",
                    ...config.headers,
                },
                timeout: config.timeout,
            };
            // 如果有请求体，添加 Content-Length
            if (config.body) {
                const bodyBuffer = Buffer.from(config.body);
                const headers = options.headers;
                headers["Content-Length"] = String(bodyBuffer.length);
                if (!headers["Content-Type"]) {
                    headers["Content-Type"] = "application/json";
                }
            }
            const req = httpModule.request(options, (res) => {
                res.on("data", (chunk) => {
                    bytesReceived += chunk.length;
                });
                res.on("end", () => {
                    const duration = performance.now() - startTime;
                    done({
                        statusCode: res.statusCode ?? null,
                        duration,
                        error: null,
                        bytesReceived,
                    });
                });
                res.on("error", (err) => {
                    const duration = performance.now() - startTime;
                    done({
                        statusCode: res.statusCode ?? null,
                        duration,
                        error: err.message,
                        bytesReceived,
                    });
                });
            });
            req.on("error", (err) => {
                const duration = performance.now() - startTime;
                done({
                    statusCode: null,
                    duration,
                    error: err.message,
                    bytesReceived,
                });
            });
            req.on("timeout", () => {
                req.destroy();
                const duration = performance.now() - startTime;
                done({
                    statusCode: null,
                    duration,
                    error: "ETIMEDOUT",
                    bytesReceived,
                });
            });
            if (config.body) {
                req.write(config.body);
            }
            req.end();
        }
        catch (err) {
            const duration = performance.now() - startTime;
            done({
                statusCode: null,
                duration,
                error: err instanceof Error ? err.message : String(err),
                bytesReceived,
            });
        }
    });
}
// ==================== 性能测试器 ====================
class HttpBenchmarker {
    constructor(config) {
        this.config = config;
        this.results = [];
        this.completedCount = 0;
        this.failedCount = 0;
        this.startTime = 0;
        this.lastProgressTime = 0;
        this.progressInterval = null;
    }
    /** 运行性能测试 */
    async run() {
        this.startTime = performance.now();
        this.lastProgressTime = this.startTime;
        if (!this.config.outputJson) {
            this.printBanner();
        }
        // 启动进度更新定时器
        if (!this.config.outputJson) {
            this.progressInterval = setInterval(() => this.updateProgress(), 200);
        }
        // 并发执行请求
        const { totalRequests, concurrency } = this.config;
        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < totalRequests) {
                const index = nextIndex++;
                const result = await sendRequest(this.config);
                this.results.push(result);
                this.completedCount++;
                if (result.error || (result.statusCode !== null && result.statusCode >= 400)) {
                    this.failedCount++;
                }
            }
        };
        const workerCount = Math.min(concurrency, totalRequests);
        const workers = Array.from({ length: workerCount }, () => worker());
        // 优雅退出
        process.on("SIGINT", () => {
            if (this.progressInterval)
                clearInterval(this.progressInterval);
            console.log("\n" + COLOR.yellow("测试已中断"));
            this.printResults();
            process.exit(0);
        });
        await Promise.all(workers);
        // 停止进度更新
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
        // 输出结果
        if (this.config.outputJson) {
            this.printJsonResults();
        }
        else {
            this.printResults();
        }
    }
    /** 打印启动横幅 */
    printBanner() {
        const parsedUrl = new url_1.URL(this.config.url);
        console.log("");
        console.log(COLOR.bold(COLOR.cyan("  ╔══════════════════════════════════════════╗")));
        console.log(COLOR.bold(COLOR.cyan("  ║     HTTP 请求性能测试工具 v1.0.0        ║")));
        console.log(COLOR.bold(COLOR.cyan("  ╚══════════════════════════════════════════╝")));
        console.log("");
        console.log(`  ${COLOR.bold("目标 URL:")}   ${COLOR.cyan(this.config.url)}`);
        console.log(`  ${COLOR.bold("主机:")}       ${COLOR.cyan(parsedUrl.hostname)}${parsedUrl.port ? `:${parsedUrl.port}` : ""}`);
        console.log(`  ${COLOR.bold("方法:")}       ${COLOR.green(this.config.method)}`);
        console.log(`  ${COLOR.bold("总请求数:")}   ${COLOR.bold(String(this.config.totalRequests))}`);
        console.log(`  ${COLOR.bold("并发数:")}     ${COLOR.bold(String(this.config.concurrency))}`);
        console.log(`  ${COLOR.bold("超时时间:")}   ${this.config.timeout}ms`);
        if (Object.keys(this.config.headers).length > 0) {
            const headerStrs = Object.entries(this.config.headers)
                .map(([k, v]) => `${k}: ${v}`);
            console.log(`  ${COLOR.bold("自定义头:")}   ${headerStrs.join("; ")}`);
        }
        if (this.config.body) {
            const preview = this.config.body.length > 50
                ? this.config.body.slice(0, 50) + "..."
                : this.config.body;
            console.log(`  ${COLOR.bold("请求体:")}     ${COLOR.gray(preview)}`);
        }
        console.log("");
        console.log(COLOR.gray("  测试进行中..."));
        console.log("");
    }
    /** 更新进度条 */
    updateProgress() {
        const elapsed = performance.now() - this.startTime;
        const rps = this.completedCount > 0 ? (this.completedCount / (elapsed / 1000)).toFixed(1) : "0.0";
        const percent = ((this.completedCount / this.config.totalRequests) * 100).toFixed(1);
        const barWidth = 30;
        const filled = Math.round((this.completedCount / this.config.totalRequests) * barWidth);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
        process.stdout.write(`${ANSI_CLEAR_LINE}${ANSI_CURSOR_LEFT}  ${COLOR.cyan(bar)} ${percent}% | ` +
            `${COLOR.bold(String(this.completedCount))}/${this.config.totalRequests} | ` +
            `${COLOR.green(rps)} req/s | ` +
            `${this.failedCount > 0 ? COLOR.red(`${this.failedCount} failed`) : COLOR.green("0 failed")}`);
    }
    /** 计算统计数据 */
    computeStats() {
        const latencies = this.results
            .map((r) => r.duration)
            .sort((a, b) => a - b);
        const totalDuration = performance.now() - this.startTime;
        const completedRequests = this.results.filter((r) => !r.error).length;
        const failedRequests = this.results.filter((r) => r.error !== null).length;
        const statusCodes = new Map();
        const errors = new Map();
        let totalBytes = 0;
        for (const result of this.results) {
            if (result.statusCode !== null) {
                statusCodes.set(result.statusCode, (statusCodes.get(result.statusCode) ?? 0) + 1);
            }
            if (result.error) {
                errors.set(result.error, (errors.get(result.error) ?? 0) + 1);
            }
            totalBytes += result.bytesReceived;
        }
        const minLatency = latencies.length > 0 ? latencies[0] : 0;
        const maxLatency = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
        const avgLatency = latencies.length > 0
            ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
            : 0;
        const p50 = percentile(latencies, 50);
        const p90 = percentile(latencies, 90);
        const p95 = percentile(latencies, 95);
        const p99 = percentile(latencies, 99);
        return {
            totalRequests: this.config.totalRequests,
            completedRequests,
            failedRequests,
            totalDuration,
            requestsPerSec: completedRequests / (totalDuration / 1000),
            totalBytes,
            statusCodes,
            errors,
            latencies,
            minLatency,
            maxLatency,
            avgLatency,
            p50,
            p90,
            p95,
            p99,
        };
    }
    /** 打印文本格式结果 */
    printResults() {
        const stats = this.computeStats();
        console.log("");
        console.log(COLOR.cyan("  ══════════════════════════════════════════"));
        console.log(COLOR.bold("  测试结果摘要"));
        console.log(COLOR.cyan("  ══════════════════════════════════════════"));
        console.log("");
        // 基本统计
        console.log(`  ${COLOR.bold("总请求数:")}     ${stats.totalRequests}`);
        console.log(`  ${COLOR.bold("成功请求:")}     ${COLOR.green(String(stats.completedRequests))}`);
        console.log(`  ${COLOR.bold("失败请求:")}     ${stats.failedRequests > 0 ? COLOR.red(String(stats.failedRequests)) : COLOR.green("0")}`);
        console.log(`  ${COLOR.bold("错误率:")}       ${stats.failedRequests > 0 ? COLOR.red(`${((stats.failedRequests / stats.totalRequests) * 100).toFixed(2)}%`) : COLOR.green("0.00%")}`);
        console.log("");
        // 性能指标
        console.log(COLOR.cyan("  ── 性能指标 ──────────────────────────────"));
        console.log(`  ${COLOR.bold("吞吐量:")}       ${COLOR.green(stats.requestsPerSec.toFixed(2))} req/s`);
        console.log(`  ${COLOR.bold("总耗时:")}       ${formatDuration(stats.totalDuration)} (${stats.totalDuration.toFixed(0)} ms)`);
        console.log(`  ${COLOR.bold("数据传输:")}     ${formatBytes(stats.totalBytes)}`);
        console.log(`  ${COLOR.bold("平均吞吐:")}     ${formatBytes(stats.totalBytes / (stats.totalDuration / 1000))}/s`);
        console.log("");
        // 延迟分布
        console.log(COLOR.cyan("  ── 延迟分布 ──────────────────────────────"));
        console.log(`  ${COLOR.bold("最小值:")}       ${formatMs(stats.minLatency)}`);
        console.log(`  ${COLOR.bold("最大值:")}       ${formatMs(stats.maxLatency)}`);
        console.log(`  ${COLOR.bold("平均值:")}       ${formatMs(stats.avgLatency)}`);
        console.log(`  ${COLOR.bold("P50:")}          ${formatMs(stats.p50)}`);
        console.log(`  ${COLOR.bold("P90:")}          ${COLOR.yellow(formatMs(stats.p90))}`);
        console.log(`  ${COLOR.bold("P95:")}          ${COLOR.yellow(formatMs(stats.p95))}`);
        console.log(`  ${COLOR.bold("P99:")}          ${COLOR.red(formatMs(stats.p99))}`);
        console.log("");
        // 延迟直方图
        this.printLatencyHistogram(stats);
        // 状态码分布
        if (stats.statusCodes.size > 0) {
            console.log(COLOR.cyan("  ── 状态码分布 ────────────────────────────"));
            const sortedCodes = [...stats.statusCodes.entries()].sort(([a], [b]) => a - b);
            for (const [code, count] of sortedCodes) {
                const colorFn = code < 300
                    ? COLOR.green
                    : code < 400
                        ? COLOR.cyan
                        : code < 500
                            ? COLOR.yellow
                            : COLOR.red;
                const percent = ((count / stats.totalRequests) * 100).toFixed(1);
                console.log(`  ${colorFn(String(code))}  ${count.toString().padStart(6)} 次  (${percent}%)`);
            }
            console.log("");
        }
        // 错误统计
        if (stats.errors.size > 0) {
            console.log(COLOR.cyan("  ── 错误统计 ──────────────────────────────"));
            for (const [error, count] of stats.errors.entries()) {
                console.log(`  ${COLOR.red(error)}  ×${count}`);
            }
            console.log("");
        }
    }
    /** 打印延迟直方图 */
    printLatencyHistogram(stats) {
        if (stats.latencies.length === 0)
            return;
        console.log(COLOR.cyan("  ── 延迟直方图 ────────────────────────────"));
        // 定义区间
        const ranges = this.buildHistogramRanges(stats);
        for (const range of ranges) {
            const count = stats.latencies.filter((l) => l >= range.min && l < range.max).length;
            if (count === 0)
                continue;
            const maxBarWidth = 30;
            const maxCount = Math.max(...ranges.map((r) => stats.latencies.filter((l) => l >= r.min && l < r.max).length));
            const barWidth = maxCount > 0 ? Math.round((count / maxCount) * maxBarWidth) : 0;
            const bar = "▓".repeat(barWidth);
            const percent = ((count / stats.latencies.length) * 100).toFixed(1);
            const label = range.label.padEnd(12);
            console.log(`  ${COLOR.gray(label)} ${COLOR.cyan(bar)} ${count} (${percent}%)`);
        }
        console.log("");
    }
    /** 构建直方图区间 */
    buildHistogramRanges(stats) {
        const ranges = [];
        const max = stats.maxLatency;
        // 根据最大延迟动态选择区间大小
        let bucketSize;
        if (max <= 50)
            bucketSize = 5;
        else if (max <= 200)
            bucketSize = 20;
        else if (max <= 500)
            bucketSize = 50;
        else if (max <= 2000)
            bucketSize = 200;
        else if (max <= 10000)
            bucketSize = 1000;
        else
            bucketSize = 5000;
        let current = 0;
        while (current < max) {
            const next = current + bucketSize;
            const minLabel = current < 1000 ? `${current}ms` : `${(current / 1000).toFixed(1)}s`;
            const maxLabel = next < 1000 ? `${next}ms` : `${(next / 1000).toFixed(1)}s`;
            ranges.push({
                min: current,
                max: next,
                label: `${minLabel}-${maxLabel}`,
            });
            current = next;
        }
        return ranges;
    }
    /** 输出 JSON 格式结果 */
    printJsonResults() {
        const stats = this.computeStats();
        const statusCodesObj = {};
        for (const [code, count] of stats.statusCodes.entries()) {
            statusCodesObj[code] = count;
        }
        const errorsObj = {};
        for (const [error, count] of stats.errors.entries()) {
            errorsObj[error] = count;
        }
        const output = {
            url: this.config.url,
            method: this.config.method,
            concurrency: this.config.concurrency,
            totalRequests: stats.totalRequests,
            completedRequests: stats.completedRequests,
            failedRequests: stats.failedRequests,
            errorRate: ((stats.failedRequests / stats.totalRequests) * 100).toFixed(2) + "%",
            totalDurationMs: stats.totalDuration,
            requestsPerSec: parseFloat(stats.requestsPerSec.toFixed(2)),
            totalBytes: stats.totalBytes,
            latency: {
                min: parseFloat(stats.minLatency.toFixed(3)),
                max: parseFloat(stats.maxLatency.toFixed(3)),
                avg: parseFloat(stats.avgLatency.toFixed(3)),
                p50: parseFloat(stats.p50.toFixed(3)),
                p90: parseFloat(stats.p90.toFixed(3)),
                p95: parseFloat(stats.p95.toFixed(3)),
                p99: parseFloat(stats.p99.toFixed(3)),
            },
            statusCodes: statusCodesObj,
            errors: errorsObj,
        };
        console.log(JSON.stringify(output, null, 2));
    }
}
// ==================== 主函数 ====================
async function main() {
    const args = process.argv.slice(2);
    const config = parseArgs(args);
    const benchmarker = new HttpBenchmarker(config);
    await benchmarker.run();
}
main().catch((err) => {
    console.error(`发生错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map