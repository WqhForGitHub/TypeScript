#!/usr/bin/env node
"use strict";
/**
 * 文件系统监控工具
 *
 * 功能：
 *   - 监控指定目录的文件创建、修改、删除、重命名事件
 *   - 支持递归监控子目录
 *   - 支持通过 glob 模式过滤监控目标（包含/排除）
 *   - 支持文件内容变化差异提示
 *   - 支持事件防抖，避免频繁触发
 *   - 支持实时统计监控数据（事件计数、监控文件数等）
 *   - 支持将监控日志输出到文件
 *   - 彩色终端输出
 *
 * 用法：
 *   node dist/index.js <监控目录> [选项]
 *
 * 选项：
 *   -r, --recursive        递归监控子目录（默认开启）
 *   --no-recursive         不递归监控子目录
 *   -i, --include <glob>   只监控匹配 glob 模式的文件（可多次指定）
 *   -e, --exclude <glob>   排除匹配 glob 模式的文件（可多次指定）
 *   -d, --debounce <ms>    事件防抖时间（毫秒，默认 100）
 *   -o, --output <file>    将日志输出到文件
 *   --diff                 显示文件内容变化差异
 *   --stats                显示实时统计信息
 *   -h, --help             显示帮助信息
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// ==================== 常量 ====================
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
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
const EVENT_ICONS = {
    create: "+",
    update: "~",
    delete: "-",
    rename: ">",
};
const EVENT_COLORS = {
    create: COLOR.green,
    update: COLOR.yellow,
    delete: COLOR.red,
    rename: COLOR.magenta,
};
// 默认排除模式
const DEFAULT_EXCLUDE_PATTERNS = [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "*.log",
];
// ==================== 工具函数 ====================
/** 简易 glob 匹配器（支持 *, **, ?） */
function matchGlob(filePath, pattern) {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\{\{DOUBLESTAR\}\}/g, ".*");
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(normalizedPath);
}
/** 判断文件路径是否应该被监控 */
function shouldWatch(filePath, includePatterns, excludePatterns) {
    const relativePath = filePath.replace(/\\/g, "/");
    // 排除模式优先
    for (const pattern of excludePatterns) {
        if (matchGlob(relativePath, pattern)) {
            return false;
        }
    }
    // 如果有包含模式，则必须匹配其一
    if (includePatterns.length > 0) {
        return includePatterns.some((p) => matchGlob(relativePath, p));
    }
    return true;
}
/** 获取文件大小 */
function getFileSize(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return stat.size;
    }
    catch {
        return undefined;
    }
}
/** 获取文件内容的哈希值（用于判断内容是否真的变化） */
function getFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath);
        return crypto.createHash("md5").update(content).digest("hex");
    }
    catch {
        return undefined;
    }
}
/** 读取文件内容（前 N 行） */
function readFileHead(filePath, maxLines = 20) {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        return content.split("\n").slice(0, maxLines);
    }
    catch {
        return [];
    }
}
/** 计算简易差异 */
function computeDiff(oldLines, newLines) {
    const maxContext = 5;
    const result = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    let changeCount = 0;
    for (let i = 0; i < maxLen && changeCount < maxContext; i++) {
        const oldLine = oldLines[i] ?? undefined;
        const newLine = newLines[i] ?? undefined;
        if (oldLine !== newLine) {
            if (oldLine !== undefined) {
                result.push(COLOR.red(`  - ${i + 1}: ${oldLine}`));
            }
            if (newLine !== undefined) {
                result.push(COLOR.green(`  + ${i + 1}: ${newLine}`));
            }
            changeCount++;
        }
    }
    if (maxLen > maxContext) {
        result.push(COLOR.gray(`  ... 共 ${maxLen} 行`));
    }
    return result.join("\n");
}
/** 格式化文件大小 */
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** 格式化时间 */
function formatTime(date) {
    return date.toLocaleTimeString("zh-CN", { hour12: false });
}
/** 格式化持续时间 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (minutes < 60)
        return `${minutes}m ${remainSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainMinutes = minutes % 60;
    return `${hours}h ${remainMinutes}m ${remainSeconds}s`;
}
// ==================== 参数解析 ====================
function parseArgs(args) {
    const config = {
        targetDir: ".",
        recursive: true,
        includePatterns: [],
        excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
        debounceMs: 100,
        showDiff: false,
        showStats: false,
    };
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        switch (arg) {
            case "-h":
            case "--help":
                printHelp();
                process.exit(0);
                break;
            case "-r":
            case "--recursive":
                config.recursive = true;
                break;
            case "--no-recursive":
                config.recursive = false;
                break;
            case "-i":
            case "--include":
                i++;
                if (i < args.length)
                    config.includePatterns.push(args[i]);
                break;
            case "-e":
            case "--exclude":
                i++;
                if (i < args.length)
                    config.excludePatterns.push(args[i]);
                break;
            case "-d":
            case "--debounce":
                i++;
                if (i < args.length)
                    config.debounceMs = parseInt(args[i], 10);
                break;
            case "-o":
            case "--output":
                i++;
                if (i < args.length)
                    config.outputFile = args[i];
                break;
            case "--diff":
                config.showDiff = true;
                break;
            case "--stats":
                config.showStats = true;
                break;
            default:
                if (!arg.startsWith("-")) {
                    config.targetDir = arg;
                }
                break;
        }
        i++;
    }
    return config;
}
function printHelp() {
    console.log(`
${COLOR.bold("文件系统监控工具")}

${COLOR.cyan("用法:")}
  node dist/index.js <监控目录> [选项]

${COLOR.cyan("选项:")}
  -r, --recursive        递归监控子目录（默认开启）
  --no-recursive         不递归监控子目录
  -i, --include <glob>   只监控匹配 glob 模式的文件（可多次指定）
  -e, --exclude <glob>   排除匹配 glob 模式的文件（可多次指定）
  -d, --debounce <ms>    事件防抖时间（毫秒，默认 100）
  -o, --output <file>    将日志输出到文件
  --diff                 显示文件内容变化差异
  --stats                显示实时统计信息
  -h, --help             显示帮助信息

${COLOR.cyan("示例:")}
  node dist/index.js ./src
  node dist/index.js ./src -i "*.ts" -i "*.js"
  node dist/index.js ./project -e "*.log" --diff --stats
  node dist/index.js ./src -o watch.log
`);
}
// ==================== 文件系统监控器 ====================
class FileSystemWatcher {
    constructor(config) {
        this.outputStream = null;
        this.config = config;
        this.stats = {
            create: 0,
            update: 0,
            delete: 0,
            rename: 0,
            total: 0,
            startTime: new Date(),
        };
        this.watchers = new Map();
        this.fileHashes = new Map();
        this.fileContents = new Map();
        this.debounceTimers = new Map();
        this.knownFiles = new Set();
    }
    /** 启动监控 */
    async start() {
        const targetDir = path.resolve(this.config.targetDir);
        if (!fs.existsSync(targetDir)) {
            throw new Error(`目录不存在: ${targetDir}`);
        }
        const stat = fs.statSync(targetDir);
        if (!stat.isDirectory()) {
            throw new Error(`不是目录: ${targetDir}`);
        }
        // 打开日志输出文件
        if (this.config.outputFile) {
            this.outputStream = fs.createWriteStream(this.config.outputFile, {
                flags: "a",
            });
        }
        this.printBanner(targetDir);
        // 扫描已有文件，记录初始哈希
        this.scanDirectory(targetDir);
        // 开始监控
        this.watchDirectory(targetDir);
        // 显示统计信息定时器
        if (this.config.showStats) {
            this.startStatsInterval();
        }
        // 优雅退出
        process.on("SIGINT", () => this.shutdown());
        process.on("SIGTERM", () => this.shutdown());
    }
    /** 打印启动横幅 */
    printBanner(targetDir) {
        console.log("");
        console.log(COLOR.bold(COLOR.cyan("  ╔══════════════════════════════════════════╗")));
        console.log(COLOR.bold(COLOR.cyan("  ║       文件系统监控工具 v1.0.0           ║")));
        console.log(COLOR.bold(COLOR.cyan("  ╚══════════════════════════════════════════╝")));
        console.log("");
        console.log(`  ${COLOR.bold("监控目录:")} ${COLOR.cyan(targetDir)}`);
        console.log(`  ${COLOR.bold("递归监控:")} ${this.config.recursive ? "是" : "否"}`);
        if (this.config.includePatterns.length > 0) {
            console.log(`  ${COLOR.bold("包含模式:")} ${this.config.includePatterns.map((p) => COLOR.green(p)).join(", ")}`);
        }
        console.log(`  ${COLOR.bold("排除模式:")} ${this.config.excludePatterns.map((p) => COLOR.red(p)).join(", ")}`);
        console.log(`  ${COLOR.bold("防抖时间:")} ${this.config.debounceMs}ms`);
        console.log(`  ${COLOR.bold("内容差异:")} ${this.config.showDiff ? "开启" : "关闭"}`);
        console.log(`  ${COLOR.bold("统计信息:")} ${this.config.showStats ? "开启" : "关闭"}`);
        if (this.config.outputFile) {
            console.log(`  ${COLOR.bold("日志文件:")} ${this.config.outputFile}`);
        }
        const fileCount = this.knownFiles.size;
        console.log(`  ${COLOR.bold("已发现文件:")} ${fileCount} 个`);
        console.log("");
        console.log(COLOR.gray(`  按 Ctrl+C 停止监控`));
        console.log(COLOR.gray("  ────────────────────────────────────────────"));
        console.log("");
    }
    /** 扫描目录，记录已有文件的哈希 */
    scanDirectory(dirPath) {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    if (this.config.recursive && shouldWatch(fullPath, [], this.config.excludePatterns)) {
                        this.scanDirectory(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    if (shouldWatch(fullPath, this.config.includePatterns, this.config.excludePatterns)) {
                        this.knownFiles.add(fullPath);
                        const hash = getFileHash(fullPath);
                        if (hash)
                            this.fileHashes.set(fullPath, hash);
                        if (this.config.showDiff) {
                            this.fileContents.set(fullPath, readFileHead(fullPath));
                        }
                    }
                }
            }
        }
        catch (err) {
            // 权限不足等情况忽略
        }
    }
    /** 监控目录 */
    watchDirectory(dirPath) {
        try {
            const watcher = fs.watch(dirPath, { recursive: this.config.recursive }, (eventType, filename) => {
                if (!filename)
                    return;
                this.handleFsEvent(eventType, filename, dirPath);
            });
            watcher.on("error", (err) => {
                const msg = `监控错误 (${dirPath}): ${err.message}`;
                console.error(COLOR.red(msg));
                this.writeLog(msg);
            });
            this.watchers.set(dirPath, watcher);
        }
        catch (err) {
            console.error(COLOR.red(`无法监控目录 ${dirPath}: ${err instanceof Error ? err.message : String(err)}`));
        }
    }
    /** 处理文件系统事件 */
    handleFsEvent(eventType, filename, baseDir) {
        const fullPath = path.join(baseDir, filename);
        // 检查是否应该监控此文件
        if (!shouldWatch(fullPath, this.config.includePatterns, this.config.excludePatterns)) {
            return;
        }
        // 防抖处理
        const timerKey = fullPath;
        const existingTimer = this.debounceTimers.get(timerKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        this.debounceTimers.set(timerKey, setTimeout(() => {
            this.debounceTimers.delete(timerKey);
            this.processEvent(eventType, fullPath);
        }, this.config.debounceMs));
    }
    /** 处理防抖后的事件 */
    processEvent(eventType, fullPath) {
        const exists = fs.existsSync(fullPath);
        const wasKnown = this.knownFiles.has(fullPath);
        let fileEvent;
        if (eventType === "rename") {
            if (exists && !wasKnown) {
                // 新文件创建
                fileEvent = {
                    type: "create",
                    filePath: fullPath,
                    timestamp: new Date(),
                    size: getFileSize(fullPath),
                };
                this.knownFiles.add(fullPath);
                this.recordFileState(fullPath);
            }
            else if (!exists && wasKnown) {
                // 文件删除
                fileEvent = {
                    type: "delete",
                    filePath: fullPath,
                    timestamp: new Date(),
                };
                this.knownFiles.delete(fullPath);
                this.fileHashes.delete(fullPath);
                this.fileContents.delete(fullPath);
            }
            else if (exists && wasKnown) {
                // 可能是重命名或内容变化，检查哈希
                const newHash = getFileHash(fullPath);
                const oldHash = this.fileHashes.get(fullPath);
                if (newHash && newHash !== oldHash) {
                    fileEvent = {
                        type: "update",
                        filePath: fullPath,
                        timestamp: new Date(),
                        size: getFileSize(fullPath),
                        previousSize: this.getPreviousSize(fullPath),
                    };
                    if (this.config.showDiff) {
                        fileEvent.diff = this.computeFileDiff(fullPath);
                    }
                    this.fileHashes.set(fullPath, newHash);
                    if (this.config.showDiff) {
                        this.fileContents.set(fullPath, readFileHead(fullPath));
                    }
                }
                else {
                    // 无实际变化
                    return;
                }
            }
            else {
                // 不存在且不认识，忽略
                return;
            }
        }
        else if (eventType === "change") {
            if (!exists)
                return;
            const newHash = getFileHash(fullPath);
            const oldHash = this.fileHashes.get(fullPath);
            if (newHash === oldHash)
                return; // 无实际变化
            if (!wasKnown) {
                fileEvent = {
                    type: "create",
                    filePath: fullPath,
                    timestamp: new Date(),
                    size: getFileSize(fullPath),
                };
                this.knownFiles.add(fullPath);
            }
            else {
                fileEvent = {
                    type: "update",
                    filePath: fullPath,
                    timestamp: new Date(),
                    size: getFileSize(fullPath),
                    previousSize: this.getPreviousSize(fullPath),
                };
                if (this.config.showDiff) {
                    fileEvent.diff = this.computeFileDiff(fullPath);
                }
            }
            this.recordFileState(fullPath);
        }
        else {
            return;
        }
        this.emitEvent(fileEvent);
    }
    /** 记录文件状态（哈希和内容） */
    recordFileState(fullPath) {
        const hash = getFileHash(fullPath);
        if (hash)
            this.fileHashes.set(fullPath, hash);
        if (this.config.showDiff) {
            this.fileContents.set(fullPath, readFileHead(fullPath));
        }
    }
    /** 获取之前文件大小 */
    getPreviousSize(fullPath) {
        try {
            // 简易方式：通过哈希记录没有存大小，这里返回 undefined
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    /** 计算文件差异 */
    computeFileDiff(fullPath) {
        const oldLines = this.fileContents.get(fullPath) ?? [];
        const newLines = readFileHead(fullPath);
        return computeDiff(oldLines, newLines);
    }
    /** 输出事件 */
    emitEvent(event) {
        // 更新统计
        this.stats[event.type]++;
        this.stats.total++;
        const icon = EVENT_ICONS[event.type];
        const colorFn = EVENT_COLORS[event.type];
        const typeLabel = colorFn(`${icon} ${event.type.toUpperCase().padEnd(6)}`);
        const timeStr = COLOR.gray(formatTime(event.timestamp));
        const relativePath = path.relative(path.resolve(this.config.targetDir), event.filePath);
        let line = `  ${timeStr}  ${typeLabel}  ${relativePath}`;
        if (event.size !== undefined) {
            line += COLOR.gray(` (${formatSize(event.size)})`);
        }
        if (event.type === "rename" && event.oldPath) {
            line += COLOR.gray(` ← ${event.oldPath}`);
        }
        console.log(line);
        // 输出差异
        if (event.diff) {
            console.log(event.diff);
        }
        // 写入日志文件
        this.writeLog(`[${formatTime(event.timestamp)}] ${event.type.toUpperCase()} ${relativePath}${event.size !== undefined ? ` (${formatSize(event.size)})` : ""}`);
    }
    /** 写入日志文件 */
    writeLog(message) {
        if (this.outputStream) {
            this.outputStream.write(message + "\n");
        }
    }
    /** 启动统计信息定时显示 */
    startStatsInterval() {
        setInterval(() => {
            const duration = Date.now() - this.stats.startTime.getTime();
            console.log("");
            console.log(COLOR.cyan("  ── 统计信息 ──"));
            console.log(`  运行时间: ${formatDuration(duration)}`);
            console.log(`  创建: ${COLOR.green(String(this.stats.create))}  修改: ${COLOR.yellow(String(this.stats.update))}  删除: ${COLOR.red(String(this.stats.delete))}  重命名: ${COLOR.magenta(String(this.stats.rename))}`);
            console.log(`  总事件数: ${COLOR.bold(String(this.stats.total))}  监控文件: ${this.knownFiles.size}`);
            console.log("");
        }, 10000);
    }
    /** 优雅退出 */
    shutdown() {
        console.log("");
        console.log(COLOR.cyan("  正在停止监控..."));
        // 关闭所有监控器
        for (const [dir, watcher] of this.watchers) {
            watcher.close();
        }
        this.watchers.clear();
        // 清除防抖定时器
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        // 关闭日志文件
        if (this.outputStream) {
            this.outputStream.end();
        }
        // 显示最终统计
        const duration = Date.now() - this.stats.startTime.getTime();
        console.log("");
        console.log(COLOR.cyan("  ══════════════════════════════════════════"));
        console.log(COLOR.bold("  监控摘要"));
        console.log(COLOR.cyan("  ══════════════════════════════════════════"));
        console.log(`  运行时间: ${formatDuration(duration)}`);
        console.log(`  创建: ${COLOR.green(String(this.stats.create))}  修改: ${COLOR.yellow(String(this.stats.update))}  删除: ${COLOR.red(String(this.stats.delete))}  重命名: ${COLOR.magenta(String(this.stats.rename))}`);
        console.log(`  总事件数: ${COLOR.bold(String(this.stats.total))}`);
        console.log("");
        process.exit(0);
    }
}
// ==================== 主函数 ====================
async function main() {
    const args = process.argv.slice(2);
    const config = parseArgs(args);
    const watcher = new FileSystemWatcher(config);
    await watcher.start();
}
main().catch((err) => {
    console.error(`发生错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map