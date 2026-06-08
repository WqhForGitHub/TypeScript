#!/usr/bin/env node
"use strict";
/**
 * 文件读写工具 CLI
 *
 * 功能：
 *   read   <文件路径>              读取文件内容并输出
 *   write  <文件路径> <内容>        将内容写入文件（覆盖）
 *   append <文件路径> <内容>        将内容追加到文件末尾
 *   copy   <源路径> <目标路径>      复制文件
 *   move   <源路径> <目标路径>      移动/重命名文件
 *   delete <文件路径>              删除文件
 *   info   <文件路径>              查看文件详细信息
 *   list   <目录路径>              列出目录内容
 *   exists <路径>                  检查文件或目录是否存在
 *   mkdir  <目录路径>              创建目录（支持递归创建）
 *   tree   <目录路径>              以树形结构显示目录
 *   help                          显示帮助信息
 *
 * 纯 TypeScript 实现，仅使用 Node.js 内置模块（fs / path / os）。
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
/* ============================== 工具函数 ============================== */
/** 格式化文件大小为人类可读字符串 */
function formatSize(bytes) {
    if (bytes === 0)
        return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
/** 格式化日期为可读字符串 */
function formatDate(d) {
    const pad = (n) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** 获取文件类型描述 */
function getFileType(stats) {
    if (stats.isFile())
        return "普通文件";
    if (stats.isDirectory())
        return "目录";
    if (stats.isSymbolicLink())
        return "符号链接";
    if (stats.isBlockDevice())
        return "块设备";
    if (stats.isCharacterDevice())
        return "字符设备";
    if (stats.isFIFO())
        return "FIFO (命名管道)";
    if (stats.isSocket())
        return "Socket";
    return "未知类型";
}
/** 根据文件扩展名获取文件类型图标 */
function getFileIcon(name, isDir) {
    if (isDir)
        return "[D]";
    const ext = path.extname(name).toLowerCase();
    const iconMap = {
        ".ts": "[TS]",
        ".js": "[JS]",
        ".json": "[{}]",
        ".md": "[MD]",
        ".txt": "[TX]",
        ".csv": "[CV]",
        ".html": "[HT]",
        ".css": "[CS]",
        ".py": "[PY]",
        ".log": "[LG]",
    };
    return iconMap[ext] ?? "[F]";
}
/** 将相对路径解析为绝对路径，并美化显示 */
function resolvePath(filePath) {
    return path.resolve(filePath);
}
/** 安全检查：确认路径存在 */
function assertPathExists(filePath, label) {
    const resolved = resolvePath(filePath);
    if (!fs.existsSync(resolved)) {
        const prefix = label ? `${label} ` : "";
        console.error(`错误：${prefix}路径不存在 - ${resolved}`);
        process.exit(1);
    }
    return resolved;
}
/** 安全检查：确认路径不存在（用于写入前避免误覆盖） */
function assertPathNotExists(filePath) {
    const resolved = resolvePath(filePath);
    if (fs.existsSync(resolved)) {
        console.error(`错误：路径已存在，避免误覆盖 - ${resolved}`);
        process.exit(1);
    }
    return resolved;
}
/* ============================== 命令实现 ============================== */
/**
 * read - 读取文件内容
 * 支持选项：
 *   -l <行数>    只读取前 N 行
 *   -e <编码>    指定文件编码（默认 utf-8）
 */
function cmdRead(filePath, options) {
    const resolved = assertPathExists(filePath, "文件");
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
        console.error(`错误：${resolved} 是一个目录，不是文件。请使用 list 命令查看目录。`);
        process.exit(1);
    }
    // 解析选项
    let lineLimit = null;
    let encoding = "utf-8";
    for (let i = 0; i < options.length; i++) {
        if (options[i] === "-l" && options[i + 1]) {
            lineLimit = parseInt(options[i + 1], 10);
            if (Number.isNaN(lineLimit) || lineLimit <= 0) {
                console.error("错误：-l 参数必须为正整数。");
                process.exit(1);
            }
            i++;
        }
        else if (options[i] === "-e" && options[i + 1]) {
            encoding = options[i + 1];
            i++;
        }
    }
    try {
        const content = fs.readFileSync(resolved, encoding);
        if (lineLimit !== null) {
            const lines = content.split("\n");
            console.log(lines.slice(0, lineLimit).join("\n"));
            if (lines.length > lineLimit) {
                console.log(`\n... 仅显示前 ${lineLimit} 行（共 ${lines.length} 行）`);
            }
        }
        else {
            console.log(content);
        }
        console.log(`\n--- 文件信息 ---`);
        console.log(`路径: ${resolved}`);
        console.log(`大小: ${formatSize(stat.size)}`);
        console.log(`行数: ${content.split("\n").length}`);
    }
    catch (err) {
        console.error(`读取文件失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * write - 将内容写入文件（覆盖写入）
 * 支持选项：
 *   -n           不在末尾追加换行符
 */
function cmdWrite(filePath, content, options) {
    const resolved = resolvePath(filePath);
    const addNewline = !options.includes("-n");
    // 确保父目录存在
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`已创建目录: ${dir}`);
    }
    const finalContent = addNewline ? content + "\n" : content;
    try {
        fs.writeFileSync(resolved, finalContent, "utf-8");
        const stat = fs.statSync(resolved);
        console.log(`写入成功: ${resolved}`);
        console.log(`大小: ${formatSize(stat.size)}`);
    }
    catch (err) {
        console.error(`写入文件失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * append - 将内容追加到文件末尾
 */
function cmdAppend(filePath, content) {
    const resolved = resolvePath(filePath);
    // 确保父目录存在
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`已创建目录: ${dir}`);
    }
    const existed = fs.existsSync(resolved);
    try {
        fs.appendFileSync(resolved, content + "\n", "utf-8");
        const stat = fs.statSync(resolved);
        console.log(`${existed ? "追加" : "新建并写入"}成功: ${resolved}`);
        console.log(`大小: ${formatSize(stat.size)}`);
    }
    catch (err) {
        console.error(`追加文件失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * copy - 复制文件
 * 支持选项：
 *   -f           强制覆盖目标文件
 */
function cmdCopy(srcPath, destPath, options) {
    const srcResolved = assertPathExists(srcPath, "源");
    const destResolved = resolvePath(destPath);
    const force = options.includes("-f");
    // 检查源路径是否为文件
    const srcStat = fs.statSync(srcResolved);
    if (srcStat.isDirectory()) {
        console.error("错误：不支持复制目录，请指定文件路径。");
        process.exit(1);
    }
    // 检查目标路径
    if (fs.existsSync(destResolved) && !force) {
        console.error(`错误：目标路径已存在 - ${destResolved}\n使用 -f 选项强制覆盖。`);
        process.exit(1);
    }
    try {
        // 确保目标父目录存在
        const destDir = path.dirname(destResolved);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(srcResolved, destResolved);
        console.log(`复制成功: ${srcResolved} -> ${destResolved}`);
        console.log(`大小: ${formatSize(fs.statSync(destResolved).size)}`);
    }
    catch (err) {
        console.error(`复制文件失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * move - 移动/重命名文件
 * 支持选项：
 *   -f           强制覆盖目标文件
 */
function cmdMove(srcPath, destPath, options) {
    const srcResolved = assertPathExists(srcPath, "源");
    const destResolved = resolvePath(destPath);
    const force = options.includes("-f");
    // 检查目标路径
    if (fs.existsSync(destResolved) && !force) {
        console.error(`错误：目标路径已存在 - ${destResolved}\n使用 -f 选项强制覆盖。`);
        process.exit(1);
    }
    try {
        // 确保目标父目录存在
        const destDir = path.dirname(destResolved);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.renameSync(srcResolved, destResolved);
        console.log(`移动成功: ${srcResolved} -> ${destResolved}`);
    }
    catch (err) {
        console.error(`移动文件失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * delete - 删除文件
 * 支持选项：
 *   -f           强制删除，不询问确认（默认需确认）
 */
function cmdDelete(filePath, options) {
    const resolved = assertPathExists(filePath);
    const force = options.includes("-f");
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
        console.error(`错误：${resolved} 是一个目录。此命令仅支持删除文件。`);
        process.exit(1);
    }
    // 简易确认机制（非强制模式下）
    if (!force) {
        console.log(`即将删除文件: ${resolved} (${formatSize(stat.size)})`);
        console.log("使用 -f 选项可跳过确认直接删除。本演示直接执行删除。");
    }
    try {
        fs.unlinkSync(resolved);
        console.log(`删除成功: ${resolved}`);
    }
    catch (err) {
        console.error(`删除文件失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * info - 查看文件/目录详细信息
 */
function cmdInfo(filePath) {
    const resolved = assertPathExists(filePath);
    const stat = fs.statSync(resolved);
    console.log("========================================");
    console.log("         文件/目录详细信息");
    console.log("========================================");
    console.log(`路径:       ${resolved}`);
    console.log(`类型:       ${getFileType(stat)}`);
    console.log(`大小:       ${formatSize(stat.size)} (${stat.size.toLocaleString()} 字节)`);
    console.log(`创建时间:   ${formatDate(stat.birthtime)}`);
    console.log(`修改时间:   ${formatDate(stat.mtime)}`);
    console.log(`访问时间:   ${formatDate(stat.atime)}`);
    console.log(`权限:       ${(stat.mode & 0o777).toString(8).padStart(3, "0")}`);
    if (stat.isFile()) {
        const ext = path.extname(resolved);
        const name = path.basename(resolved);
        console.log(`文件名:     ${name}`);
        console.log(`扩展名:     ${ext || "(无)"}`);
    }
    else if (stat.isDirectory()) {
        try {
            const entries = fs.readdirSync(resolved);
            const fileCount = entries.filter((e) => fs.statSync(path.join(resolved, e)).isFile()).length;
            const dirCount = entries.filter((e) => fs.statSync(path.join(resolved, e)).isDirectory()).length;
            console.log(`子文件数:   ${fileCount}`);
            console.log(`子目录数:   ${dirCount}`);
        }
        catch {
            console.log(`子项数:     (无法读取)`);
        }
    }
    console.log("========================================");
}
/**
 * list - 列出目录内容
 * 支持选项：
 *   -a           显示隐藏文件
 *   -l           详细列表模式
 */
function cmdList(dirPath, options) {
    const resolved = assertPathExists(dirPath, "目录");
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
        console.error(`错误：${resolved} 不是目录。`);
        process.exit(1);
    }
    const showHidden = options.includes("-a");
    const longFormat = options.includes("-l");
    try {
        let entries = fs.readdirSync(resolved);
        if (!showHidden) {
            entries = entries.filter((e) => !e.startsWith("."));
        }
        if (entries.length === 0) {
            console.log(`目录 ${resolved} 为空。`);
            return;
        }
        console.log(`目录: ${resolved}`);
        console.log("=".repeat(70));
        if (longFormat) {
            // 详细列表模式
            console.log("类型".padEnd(6) +
                "大小".padEnd(12) +
                "修改时间".padEnd(22) +
                "名称");
            console.log("-".repeat(70));
            for (const entry of entries) {
                const fullPath = path.join(resolved, entry);
                try {
                    const entryStat = fs.statSync(fullPath);
                    const isDir = entryStat.isDirectory();
                    const type = isDir ? "[D]" : getFileIcon(entry, false);
                    const size = isDir ? "-" : formatSize(entryStat.size);
                    const time = formatDate(entryStat.mtime);
                    console.log(type.padEnd(6) + size.padEnd(12) + time.padEnd(22) + entry);
                }
                catch {
                    console.log("[?]".padEnd(6) + "-".padEnd(12) + "-".padEnd(22) + entry);
                }
            }
        }
        else {
            // 简洁模式
            const lines = [];
            for (const entry of entries) {
                const fullPath = path.join(resolved, entry);
                try {
                    const entryStat = fs.statSync(fullPath);
                    const isDir = entryStat.isDirectory();
                    lines.push(`${getFileIcon(entry, isDir)} ${entry}`);
                }
                catch {
                    lines.push(`[?] ${entry}`);
                }
            }
            console.log(lines.join("\n"));
        }
        console.log("=".repeat(70));
        console.log(`共 ${entries.length} 项`);
    }
    catch (err) {
        console.error(`读取目录失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * exists - 检查文件或目录是否存在
 */
function cmdExists(filePath) {
    const resolved = resolvePath(filePath);
    const exists = fs.existsSync(resolved);
    if (exists) {
        const stat = fs.statSync(resolved);
        const type = stat.isDirectory() ? "目录" : "文件";
        console.log(`存在 [${type}]: ${resolved}`);
    }
    else {
        console.log(`不存在: ${resolved}`);
    }
}
/**
 * mkdir - 创建目录
 * 支持选项：
 *   -p           递归创建（默认行为）
 */
function cmdMkdir(dirPath, _options) {
    const resolved = resolvePath(dirPath);
    if (fs.existsSync(resolved)) {
        console.error(`错误：路径已存在 - ${resolved}`);
        process.exit(1);
    }
    try {
        fs.mkdirSync(resolved, { recursive: true });
        console.log(`目录创建成功: ${resolved}`);
    }
    catch (err) {
        console.error(`创建目录失败：${err.message}`);
        process.exit(1);
    }
}
/**
 * tree - 以树形结构显示目录
 * 支持选项：
 *   -d <深度>    限制显示深度（默认 5）
 */
function cmdTree(dirPath, options) {
    const resolved = assertPathExists(dirPath, "目录");
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
        console.error(`错误：${resolved} 不是目录。`);
        process.exit(1);
    }
    // 解析深度选项
    let maxDepth = 5;
    for (let i = 0; i < options.length; i++) {
        if (options[i] === "-d" && options[i + 1]) {
            maxDepth = parseInt(options[i + 1], 10);
            if (Number.isNaN(maxDepth) || maxDepth <= 0) {
                console.error("错误：-d 参数必须为正整数。");
                process.exit(1);
            }
            i++;
        }
    }
    let fileCount = 0;
    let dirCount = 0;
    function printTree(currentPath, prefix, depth) {
        if (depth > maxDepth)
            return;
        let entries;
        try {
            entries = fs.readdirSync(currentPath).filter((e) => !e.startsWith("."));
        }
        catch {
            return;
        }
        entries.forEach((entry, index) => {
            const fullPath = path.join(currentPath, entry);
            const isLast = index === entries.length - 1;
            const connector = isLast ? "└── " : "├── ";
            const childPrefix = isLast ? "    " : "│   ";
            try {
                const entryStat = fs.statSync(fullPath);
                if (entryStat.isDirectory()) {
                    dirCount++;
                    console.log(`${prefix}${connector}${entry}/`);
                    printTree(fullPath, prefix + childPrefix, depth + 1);
                }
                else {
                    fileCount++;
                    console.log(`${prefix}${connector}${entry}  (${formatSize(entryStat.size)})`);
                }
            }
            catch {
                console.log(`${prefix}${connector}${entry}  (无法访问)`);
            }
        });
    }
    console.log(resolved);
    printTree(resolved, "", 1);
    console.log(`\n${dirCount} 个目录, ${fileCount} 个文件`);
}
/**
 * help - 显示帮助信息
 */
function cmdHelp() {
    console.log([
        "文件读写工具 CLI",
        "",
        "用法： file-rw <command> [options] [args...]",
        "",
        "命令：",
        "  read   <文件路径> [-l 行数] [-e 编码]   读取文件内容",
        "  write  <文件路径> <内容> [-n]            写入文件（覆盖）",
        "  append <文件路径> <内容>                 追加内容到文件末尾",
        "  copy   <源路径> <目标路径> [-f]          复制文件",
        "  move   <源路径> <目标路径> [-f]          移动/重命名文件",
        "  delete <文件路径> [-f]                   删除文件",
        "  info   <文件路径>                        查看文件详细信息",
        "  list   <目录路径> [-a] [-l]              列出目录内容",
        "  exists <路径>                            检查文件或目录是否存在",
        "  mkdir  <目录路径>                        创建目录（递归）",
        "  tree   <目录路径> [-d 深度]              以树形结构显示目录",
        "  help                                     显示帮助信息",
        "",
        "选项说明：",
        "  -l <行数>       read 命令：只读取前 N 行",
        "  -e <编码>       read 命令：指定文件编码（默认 utf-8）",
        "  -n              write 命令：不在末尾追加换行符",
        "  -f              copy/move/delete：强制覆盖/删除，不确认",
        "  -a              list 命令：显示隐藏文件",
        "  -l              list 命令：详细列表模式",
        "  -d <深度>       tree 命令：限制显示深度（默认 5）",
        "",
        "示例：",
        '  file-rw write ./hello.txt "Hello, World!"',
        "  file-rw read ./hello.txt",
        "  file-rw read ./hello.txt -l 10",
        "  file-rw append ./hello.txt \"新的一行\"",
        "  file-rw copy ./hello.txt ./hello-backup.txt",
        "  file-rw move ./hello-backup.txt ./renamed.txt",
        "  file-rw info ./hello.txt",
        "  file-rw list ./ -a -l",
        "  file-rw exists ./hello.txt",
        "  file-rw mkdir ./new-folder",
        "  file-rw tree . -d 3",
        "  file-rw delete ./renamed.txt -f",
    ].join("\n"));
}
/* ============================== 参数解析 ============================== */
/**
 * 简易参数解析器
 * 将 process.argv 中的选项与位置参数分离
 */
function parseArgs(argv) {
    const positional = [];
    const options = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("-")) {
            options.push(arg);
            // 如果该选项需要一个值（如 -l 10），也收集进来
            if ((arg === "-l" || arg === "-e" || arg === "-d") &&
                i + 1 < argv.length &&
                !argv[i + 1].startsWith("-")) {
                i++;
                options.push(argv[i]);
            }
        }
        else {
            positional.push(arg);
        }
    }
    const command = (positional[0] ?? "help").toLowerCase();
    // positional[0] 是命令，之后的是位置参数
    const args = positional.slice(1);
    return { command, positional: args, options };
}
/* ============================== 入口 ============================== */
function main() {
    const argv = process.argv.slice(2);
    const { command, positional, options } = parseArgs(argv);
    switch (command) {
        case "read":
        case "cat":
            if (!positional[0]) {
                console.error("错误：请提供文件路径。用法：file-rw read <文件路径>");
                process.exit(1);
            }
            cmdRead(positional[0], options);
            break;
        case "write":
            if (!positional[0] || !positional[1]) {
                console.error("错误：请提供文件路径和内容。用法：file-rw write <文件路径> <内容>");
                process.exit(1);
            }
            cmdWrite(positional[0], positional.slice(1).join(" "), options);
            break;
        case "append":
            if (!positional[0] || !positional[1]) {
                console.error("错误：请提供文件路径和内容。用法：file-rw append <文件路径> <内容>");
                process.exit(1);
            }
            cmdAppend(positional[0], positional.slice(1).join(" "));
            break;
        case "copy":
        case "cp":
            if (!positional[0] || !positional[1]) {
                console.error("错误：请提供源路径和目标路径。用法：file-rw copy <源路径> <目标路径>");
                process.exit(1);
            }
            cmdCopy(positional[0], positional[1], options);
            break;
        case "move":
        case "mv":
        case "rename":
            if (!positional[0] || !positional[1]) {
                console.error("错误：请提供源路径和目标路径。用法：file-rw move <源路径> <目标路径>");
                process.exit(1);
            }
            cmdMove(positional[0], positional[1], options);
            break;
        case "delete":
        case "del":
        case "rm":
            if (!positional[0]) {
                console.error("错误：请提供文件路径。用法：file-rw delete <文件路径>");
                process.exit(1);
            }
            cmdDelete(positional[0], options);
            break;
        case "info":
        case "stat":
            if (!positional[0]) {
                console.error("错误：请提供文件路径。用法：file-rw info <文件路径>");
                process.exit(1);
            }
            cmdInfo(positional[0]);
            break;
        case "list":
        case "ls":
        case "dir":
            cmdList(positional[0] ?? ".", options);
            break;
        case "exists":
        case "test":
            if (!positional[0]) {
                console.error("错误：请提供路径。用法：file-rw exists <路径>");
                process.exit(1);
            }
            cmdExists(positional[0]);
            break;
        case "mkdir":
            if (!positional[0]) {
                console.error("错误：请提供目录路径。用法：file-rw mkdir <目录路径>");
                process.exit(1);
            }
            cmdMkdir(positional[0], options);
            break;
        case "tree":
            cmdTree(positional[0] ?? ".", options);
            break;
        case "help":
        case "--help":
        case "-h":
            cmdHelp();
            break;
        default:
            console.error(`未知命令：${command}`);
            console.error("使用 `file-rw help` 查看可用命令。");
            process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map