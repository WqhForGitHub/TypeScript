#!/usr/bin/env node
"use strict";
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
/**
 * 文件读写工具 CLI (增强版)
 * 支持 read/write/append/copy/move/delete/info/list/exists/mkdir/tree
 * 以及 hash/watch/compare/search/batch 等高级操作。
 * 仅使用 Node.js 内置模块 (fs / path / os / crypto)。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/* ============================== 枚举 ============================== */
var FileOperation;
(function (FileOperation) {
    FileOperation["Read"] = "READ";
    FileOperation["Write"] = "WRITE";
    FileOperation["Append"] = "APPEND";
    FileOperation["Copy"] = "COPY";
    FileOperation["Move"] = "MOVE";
    FileOperation["Delete"] = "DELETE";
    FileOperation["Info"] = "INFO";
    FileOperation["List"] = "LIST";
    FileOperation["Exists"] = "EXISTS";
    FileOperation["Mkdir"] = "MKDIR";
    FileOperation["Tree"] = "TREE";
    FileOperation["Hash"] = "HASH";
    FileOperation["Watch"] = "WATCH";
    FileOperation["Compare"] = "COMPARE";
    FileOperation["Search"] = "SEARCH";
    FileOperation["Batch"] = "BATCH";
})(FileOperation || (FileOperation = {}));
var FileType;
(function (FileType) {
    FileType["File"] = "FILE";
    FileType["Directory"] = "DIRECTORY";
    FileType["Symlink"] = "SYMLINK";
    FileType["BlockDevice"] = "BLOCK_DEVICE";
    FileType["CharDevice"] = "CHAR_DEVICE";
    FileType["Fifo"] = "FIFO";
    FileType["Socket"] = "SOCKET";
    FileType["Unknown"] = "UNKNOWN";
})(FileType || (FileType = {}));
var Permission;
(function (Permission) {
    Permission[Permission["Read"] = 256] = "Read";
    Permission[Permission["Write"] = 128] = "Write";
    Permission[Permission["Execute"] = 64] = "Execute";
    Permission[Permission["All"] = 448] = "All";
})(Permission || (Permission = {}));
var SortBy;
(function (SortBy) {
    SortBy["Name"] = "NAME";
    SortBy["Size"] = "SIZE";
    SortBy["Modified"] = "MODIFIED";
    SortBy["Type"] = "TYPE";
})(SortBy || (SortBy = {}));
var Encoding;
(function (Encoding) {
    Encoding["Utf8"] = "utf-8";
    Encoding["Ascii"] = "ascii";
    Encoding["Latin1"] = "latin1";
    Encoding["Base64"] = "base64";
    Encoding["Hex"] = "hex";
    Encoding["Binary"] = "binary";
})(Encoding || (Encoding = {}));
/* ============================== 自定义错误层次结构 ============================== */
class FileOperationError extends Error {
    constructor(message, path) {
        super(message);
        this.path = path;
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
class NotFoundError extends FileOperationError {
    constructor() {
        super(...arguments);
        this.code = "ENOENT";
        this.kind = FileOperation.Read;
    }
}
class PermissionError extends FileOperationError {
    constructor() {
        super(...arguments);
        this.code = "EACCES";
        this.kind = FileOperation.Read;
    }
}
class IsDirectoryError extends FileOperationError {
    constructor() {
        super(...arguments);
        this.code = "EISDIR";
        this.kind = FileOperation.Read;
    }
}
class NotADirectoryError extends FileOperationError {
    constructor() {
        super(...arguments);
        this.code = "ENOTDIR";
        this.kind = FileOperation.Read;
    }
}
class AlreadyExistsError extends FileOperationError {
    constructor() {
        super(...arguments);
        this.code = "EEXIST";
        this.kind = FileOperation.Write;
    }
}
class InvalidOperationError extends FileOperationError {
    constructor() {
        super(...arguments);
        this.code = "EINVAL";
        this.kind = FileOperation.Read;
    }
}
/* ============================== as const + satisfies ============================== */
const ICON_MAP = {
    ".ts": "[TS]", ".js": "[JS]", ".json": "[{}]", ".md": "[MD]", ".txt": "[TX]",
    ".csv": "[CV]", ".html": "[HT]", ".css": "[CS]", ".py": "[PY]", ".log": "[LG]",
};
const UNIT_LIST = ["B", "KB", "MB", "GB", "TB"];
const FILE_TYPE_NAMES = {
    [FileType.File]: "普通文件", [FileType.Directory]: "目录", [FileType.Symlink]: "符号链接",
    [FileType.BlockDevice]: "块设备", [FileType.CharDevice]: "字符设备",
    [FileType.Fifo]: "FIFO (命名管道)", [FileType.Socket]: "Socket", [FileType.Unknown]: "未知类型",
};
/* ============================== 类型守卫 ============================== */
function isSuccess(r) { return r.success === true; }
function isFailure(r) { return r.success === false; }
function isFile(stat) { return stat.isFile(); }
function isDirectory(stat) { return stat.isDirectory(); }
/* ============================== 工具函数 ============================== */
function formatSize(bytes) {
    if (bytes === 0)
        return "0 B";
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNIT_LIST.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${UNIT_LIST[i]}`;
}
function formatDate(d) {
    const p = (n) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function detectFileType(stat) {
    if (stat.isFile())
        return FileType.File;
    if (stat.isDirectory())
        return FileType.Directory;
    if (stat.isSymbolicLink())
        return FileType.Symlink;
    if (stat.isBlockDevice())
        return FileType.BlockDevice;
    if (stat.isCharacterDevice())
        return FileType.CharDevice;
    if (stat.isFIFO())
        return FileType.Fifo;
    if (stat.isSocket())
        return FileType.Socket;
    return FileType.Unknown;
}
function getFileIcon(name, isDir) {
    if (isDir)
        return "[D]";
    return ICON_MAP[path.extname(name).toLowerCase()] ?? "[F]";
}
function resolvePath(p) { return path.resolve(p); }
function detectEncoding(buf) {
    if (buf.length === 0)
        return Encoding.Utf8;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
        return Encoding.Utf8;
    if (buf[0] === 0xff && buf[1] === 0xfe)
        return Encoding.Utf8;
    let isAscii = true;
    const limit = Math.min(buf.length, 4096);
    for (let i = 0; i < limit; i++) {
        const b = buf[i];
        if (b === 0)
            return Encoding.Binary;
        if (b > 127)
            isAscii = false;
    }
    return isAscii ? Encoding.Ascii : Encoding.Utf8;
}
function matchGlob(pattern, name) {
    const r = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${r}$`).test(name);
}
/* ============================== Result 构造器 ============================== */
function ok(value, elapsedMs = 0) { return { success: true, value, elapsedMs }; }
function fail(error, elapsedMs = 0) { return { success: false, error, elapsedMs }; }
function wrapOperation(op) {
    const start = Date.now();
    try {
        return ok(op(), Date.now() - start);
    }
    catch (err) {
        const elapsed = Date.now() - start;
        if (err instanceof FileOperationError)
            return fail(err, elapsed);
        const e = err;
        let fe;
        switch (e.code) {
            case "ENOENT":
                fe = new NotFoundError(e.message);
                break;
            case "EACCES":
                fe = new PermissionError(e.message);
                break;
            case "EISDIR":
                fe = new IsDirectoryError(e.message);
                break;
            case "ENOTDIR":
                fe = new NotADirectoryError(e.message);
                break;
            case "EEXIST":
                fe = new AlreadyExistsError(e.message);
                break;
            default: fe = new InvalidOperationError(e.message);
        }
        return fail(fe, elapsed);
    }
}
/* ============================== 文件哈希 ============================== */
function hashFile(filePath, algorithm = "sha256") {
    return wrapOperation(() => {
        const h = crypto.createHash(algorithm);
        const fd = fs.openSync(filePath, "r");
        try {
            const buf = Buffer.alloc(64 * 1024);
            const totalSize = fs.statSync(filePath).size;
            let bytesRead, total = 0;
            while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
                h.update(buf.subarray(0, bytesRead));
                total += bytesRead;
                if (totalSize > 0)
                    process.stderr.write(`\r${Math.floor((total / totalSize) * 100)}%`);
            }
            process.stderr.write("\r");
            return h.digest("hex");
        }
        finally {
            fs.closeSync(fd);
        }
    });
}
/* ============================== 抽象类与具体实现 ============================== */
class AbstractFileOperation {
    constructor(options) { this.options = (options ?? {}); }
    reportProgress(current, total) {
        if (this.options.onProgress)
            this.options.onProgress(current, total);
    }
    ensureDir(dir) { if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true }); }
    get description() { return `Operation[${this.operation}]`; }
}
class ReadOperation extends AbstractFileOperation {
    constructor() {
        super(...arguments);
        this.operation = FileOperation.Read;
    }
    execute(filePath, arg2, arg3) {
        return this.perform(filePath, arg2, arg3);
    }
    perform(...args) {
        return wrapOperation(() => {
            const filePath = args[0];
            const resolved = resolvePath(filePath);
            if (!fs.existsSync(resolved))
                throw new NotFoundError(`文件不存在: ${resolved}`, resolved);
            const stat = fs.statSync(resolved);
            if (stat.isDirectory())
                throw new IsDirectoryError(`是目录: ${resolved}`, resolved);
            const arg2 = args[1];
            const arg3 = args[2];
            const encoding = typeof arg2 === "string" ? arg2 : Encoding.Utf8;
            const lineLimit = typeof arg2 === "number" ? arg2 : (typeof arg3 === "number" ? arg3 : null);
            const content = fs.readFileSync(resolved, encoding);
            if (lineLimit !== null && lineLimit > 0)
                return content.split("\n").slice(0, lineLimit).join("\n");
            return content;
        });
    }
}
class WriteOperation extends AbstractFileOperation {
    constructor() {
        super(...arguments);
        this.operation = FileOperation.Write;
        this._bytesWritten = 0;
    }
    get bytesWritten() { return this._bytesWritten; }
    set bytesWritten(v) { if (v < 0)
        throw new RangeError("bytesWritten 不能为负数"); this._bytesWritten = v; }
    execute(filePath, content) {
        return this.perform(filePath, content);
    }
    perform(...args) {
        return wrapOperation(() => {
            const filePath = args[0], content = args[1];
            const resolved = resolvePath(filePath);
            this.ensureDir(path.dirname(resolved));
            const finalContent = this.options.force ? content : content + "\n";
            fs.writeFileSync(resolved, finalContent, "utf-8");
            this._bytesWritten = Buffer.byteLength(finalContent);
            return this._bytesWritten;
        });
    }
}
class CopyOperation extends AbstractFileOperation {
    constructor() {
        super(...arguments);
        this.operation = FileOperation.Copy;
    }
    execute(src, dest) { return this.perform(src, dest); }
    perform(...args) {
        return wrapOperation(() => {
            const src = args[0], dest = args[1];
            if (!fs.existsSync(src))
                throw new NotFoundError(`源不存在: ${src}`, src);
            if (fs.existsSync(dest) && !this.options.force)
                throw new AlreadyExistsError(`目标已存在: ${dest} (使用 -f)`, dest);
            this.ensureDir(path.dirname(dest));
            fs.copyFileSync(src, dest);
        });
    }
}
class DeleteOperation extends AbstractFileOperation {
    constructor() {
        super(...arguments);
        this.operation = FileOperation.Delete;
    }
    execute(filePath) { return this.perform(filePath); }
    perform(...args) {
        return wrapOperation(() => {
            const filePath = args[0];
            if (!fs.existsSync(filePath))
                throw new NotFoundError(`不存在: ${filePath}`, filePath);
            const stat = fs.statSync(filePath);
            if (isDirectory(stat)) {
                if (!this.options.recursive)
                    throw new InvalidOperationError(`是目录: ${filePath} (使用 -r)`, filePath);
                fs.rmSync(filePath, { recursive: true, force: !!this.options.force });
            }
            else {
                fs.unlinkSync(filePath);
            }
        });
    }
}
class HashOperation extends AbstractFileOperation {
    constructor() {
        super(...arguments);
        this.operation = FileOperation.Hash;
    }
    execute(filePath, algorithm = "sha256") {
        return this.perform(filePath, algorithm);
    }
    perform(...args) {
        return hashFile(args[0], args[1] ?? "sha256");
    }
}
/* ============================== 批量操作 ============================== */
function batchCopy(pairs, opts) {
    const op = new CopyOperation({ force: true, ...opts });
    const succeeded = [];
    const failed = [];
    pairs.forEach((pair, idx) => {
        const [src, dest] = pair;
        const r = op.execute(src, dest);
        if (isSuccess(r))
            succeeded.push([src, dest]);
        else
            failed.push([src, r.error]);
        opts?.onProgress?.(idx + 1, pairs.length);
    });
    return { succeeded, failed };
}
function deleteByPattern(dir, pattern, opts) {
    const succeeded = [];
    const failed = [];
    if (!fs.existsSync(dir))
        return { succeeded, failed };
    const entries = fs.readdirSync(dir);
    entries.forEach((entry, idx) => {
        if (matchGlob(pattern, entry)) {
            const full = path.join(dir, entry);
            const r = new DeleteOperation({ force: true, ...opts }).execute(full);
            if (isSuccess(r))
                succeeded.push([full, "deleted"]);
            else
                failed.push([full, r.error]);
        }
        opts?.onProgress?.(idx + 1, entries.length);
    });
    return { succeeded, failed };
}
/* ============================== 目录遍历器 (Generator) ============================== */
function* walkDirectory(root, maxDepth = Infinity, currentDepth = 0) {
    if (currentDepth > maxDepth)
        return;
    let entries;
    try {
        entries = fs.readdirSync(root);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(root, entry);
        let stat;
        try {
            stat = fs.statSync(full);
        }
        catch {
            continue;
        }
        yield [full, stat, currentDepth];
        if (stat.isDirectory())
            yield* walkDirectory(full, maxDepth, currentDepth + 1);
    }
}
/* ============================== 文件比较 / 内容搜索 / 元数据 / 树 / 监视 ============================== */
function compareFiles(a, b) {
    return wrapOperation(() => {
        const bufA = fs.readFileSync(a), bufB = fs.readFileSync(b);
        let diffAt = null;
        const minLen = Math.min(bufA.length, bufB.length);
        for (let i = 0; i < minLen; i++) {
            if (bufA[i] !== bufB[i]) {
                diffAt = i;
                break;
            }
        }
        return { identical: diffAt === null && bufA.length === bufB.length, diffAt, sizeA: bufA.length, sizeB: bufB.length };
    });
}
function searchInFiles(dir, pattern, opts) {
    const matches = [];
    const maxResults = opts?.maxResults ?? 100;
    const regex = new RegExp(pattern, opts?.caseInsensitive ? "i" : "");
    for (const [full, stat] of walkDirectory(dir, 10)) {
        if (!stat.isFile())
            continue;
        try {
            const lines = fs.readFileSync(full, "utf-8").split("\n");
            for (let i = 0; i < lines.length; i++) {
                const m = regex.exec(lines[i]);
                if (m) {
                    matches.push({ file: full, line: i + 1, column: m.index + 1, text: lines[i].trim().slice(0, 80) });
                    if (matches.length >= maxResults)
                        return matches;
                }
            }
        }
        catch { /* 跳过二进制/不可读 */ }
    }
    return matches;
}
function extractMetadata(filePath) {
    return wrapOperation(() => {
        const resolved = resolvePath(filePath);
        const stat = fs.statSync(resolved);
        const parsed = path.parse(resolved);
        return {
            name: parsed.name, dir: parsed.dir, ext: (parsed.ext || ""), base: parsed.base,
            size: [stat.size, formatSize(stat.size)],
            created: stat.birthtime, modified: stat.mtime,
        };
    });
}
function renderTree(root, maxDepth = 5) {
    const lines = [root];
    let dirCount = 0, fileCount = 0;
    function walk(dir, prefix, depth) {
        if (depth > maxDepth)
            return;
        let entries;
        try {
            entries = fs.readdirSync(dir).filter((e) => !e.startsWith(".")).sort();
        }
        catch {
            return;
        }
        entries.forEach((entry, idx) => {
            const full = path.join(dir, entry);
            const isLast = idx === entries.length - 1;
            const connector = isLast ? "└── " : "├── ";
            const childPrefix = isLast ? "    " : "│   ";
            try {
                const stat = fs.statSync(full);
                if (stat.isDirectory()) {
                    dirCount++;
                    lines.push(`${prefix}${connector}${entry}/`);
                    walk(full, prefix + childPrefix, depth + 1);
                }
                else {
                    fileCount++;
                    lines.push(`${prefix}${connector}${entry}  (${formatSize(stat.size)})`);
                }
            }
            catch {
                lines.push(`${prefix}${connector}${entry}  (无法访问)`);
            }
        });
    }
    walk(root, "", 1);
    return { lines, dirCount, fileCount };
}
function watchPath(target, onEvent) {
    return fs.watch(target, { recursive: false }, (eventType, filename) => {
        if (!filename)
            return;
        const fullPath = path.join(target, filename);
        try {
            const stat = fs.statSync(fullPath);
            onEvent(eventType === "rename"
                ? { type: "rename", path: fullPath, filename }
                : { type: "change", path: fullPath, size: stat.size });
        }
        catch {
            onEvent({ type: "rename", path: fullPath, filename });
        }
    });
}
/* ============================== CLI 命令实现 ============================== */
function die(msg, code) {
    console.error(code ? `${msg} [${code}]` : msg);
    process.exit(1);
}
function cmdRead(filePath, options) {
    let lineLimit = null, encoding = Encoding.Utf8;
    for (let i = 0; i < options.length; i++) {
        if (options[i] === "-l" && options[i + 1]) {
            lineLimit = parseInt(options[i + 1], 10);
            if (Number.isNaN(lineLimit) || lineLimit <= 0)
                die("错误：-l 参数必须为正整数。");
            i++;
        }
        else if (options[i] === "-e" && options[i + 1]) {
            encoding = options[i + 1];
            i++;
        }
    }
    const op = new ReadOperation();
    const r = lineLimit !== null ? op.execute(filePath, lineLimit) : op.execute(filePath, encoding);
    if (isFailure(r))
        die(`读取失败: ${r.error.message}`, r.error.code);
    console.log(r.value);
    try {
        const stat = fs.statSync(resolvePath(filePath));
        console.log(`\n--- 文件信息 ---\n大小: ${formatSize(stat.size)}\n耗时: ${r.elapsedMs}ms`);
    }
    catch { /* ignore */ }
}
function cmdWrite(filePath, content, options) {
    const op = new WriteOperation({ force: options.includes("-n") });
    const r = op.execute(filePath, content);
    if (isFailure(r))
        die(`写入失败: ${r.error.message}`, r.error.code);
    console.log(`写入成功: ${resolvePath(filePath)} (${formatSize(op.bytesWritten)}, ${r.elapsedMs}ms)`);
}
function cmdAppend(filePath, content) {
    const resolved = resolvePath(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(resolved);
    const r = wrapOperation(() => { fs.appendFileSync(resolved, content + "\n", "utf-8"); return fs.statSync(resolved).size; });
    if (isFailure(r))
        die(`追加失败: ${r.error.message}`, r.error.code);
    console.log(`${existed ? "追加" : "新建"}成功: ${resolved} (${formatSize(r.value)})`);
}
function cmdCopy(src, dest, options) {
    const r = new CopyOperation({ force: options.includes("-f") }).execute(src, dest);
    if (isFailure(r))
        die(`复制失败: ${r.error.message}`, r.error.code);
    console.log(`复制成功: ${resolvePath(src)} -> ${resolvePath(dest)} (${r.elapsedMs}ms)`);
}
function cmdMove(src, dest, options) {
    const force = options.includes("-f");
    const r = wrapOperation(() => {
        const s = resolvePath(src), d = resolvePath(dest);
        if (!fs.existsSync(s))
            throw new NotFoundError(`源不存在: ${s}`, s);
        if (fs.existsSync(d) && !force)
            throw new AlreadyExistsError(`目标已存在: ${d}`, d);
        const dd = path.dirname(d);
        if (!fs.existsSync(dd))
            fs.mkdirSync(dd, { recursive: true });
        fs.renameSync(s, d);
    });
    if (isFailure(r))
        die(`移动失败: ${r.error.message}`, r.error.code);
    console.log(`移动成功 (${r.elapsedMs}ms)`);
}
function cmdDelete(filePath, options) {
    if (!options.includes("-f"))
        console.log("提示：使用 -f 跳过确认。本演示直接执行删除。");
    const r = new DeleteOperation({ force: options.includes("-f"), recursive: options.includes("-r") }).execute(filePath);
    if (isFailure(r))
        die(`删除失败: ${r.error.message}`, r.error.code);
    console.log(`删除成功: ${resolvePath(filePath)} (${r.elapsedMs}ms)`);
}
function cmdInfo(filePath) {
    const meta = extractMetadata(filePath);
    if (isFailure(meta))
        die(`信息获取失败: ${meta.error.message}`, meta.error.code);
    const stat = fs.statSync(resolvePath(filePath));
    console.log("========================================\n         文件/目录详细信息\n========================================");
    console.log(`路径:       ${path.resolve(filePath)}`);
    console.log(`类型:       ${FILE_TYPE_NAMES[detectFileType(stat)]}`);
    console.log(`大小:       ${meta.value.size[1]} (${meta.value.size[0].toLocaleString()} 字节)`);
    console.log(`创建时间:   ${formatDate(meta.value.created)}`);
    console.log(`修改时间:   ${formatDate(meta.value.modified)}`);
    console.log(`权限:       ${(stat.mode & 0o777).toString(8).padStart(3, "0")}`);
    if (isFile(stat)) {
        console.log(`文件名:     ${meta.value.base}\n扩展名:     ${meta.value.ext || "(无)"}`);
    }
    else if (isDirectory(stat)) {
        try {
            const entries = fs.readdirSync(resolvePath(filePath));
            let fc = 0, dc = 0;
            for (const e of entries) {
                const s = fs.statSync(path.join(resolvePath(filePath), e));
                if (s.isFile())
                    fc++;
                else if (s.isDirectory())
                    dc++;
            }
            console.log(`子文件数:   ${fc}\n子目录数:   ${dc}`);
        }
        catch {
            console.log(`子项数:     (无法读取)`);
        }
    }
    console.log("========================================");
}
function cmdList(dirPath, options) {
    const resolved = resolvePath(dirPath);
    if (!fs.existsSync(resolved))
        die(`错误：路径不存在 - ${resolved}`);
    if (!fs.statSync(resolved).isDirectory())
        die(`错误：${resolved} 不是目录。`);
    const showHidden = options.includes("-a"), longFormat = options.includes("-l");
    let sortBy = SortBy.Name;
    for (let i = 0; i < options.length; i++) {
        if (options[i] === "--sort" && options[i + 1]) {
            sortBy = (options[i + 1].toUpperCase() in SortBy ? options[i + 1].toUpperCase() : "NAME");
            i++;
        }
    }
    let entries = fs.readdirSync(resolved);
    if (!showHidden)
        entries = entries.filter((e) => !e.startsWith("."));
    const fileEntries = entries.map((name) => {
        const stat = fs.statSync(path.join(resolved, name));
        return { name, path: path.join(resolved, name), type: detectFileType(stat), size: stat.size,
            modified: stat.mtime, created: stat.birthtime, permissions: stat.mode & 0o777 };
    });
    const cmp = (a, b) => {
        switch (sortBy) {
            case SortBy.Size: return a.size - b.size;
            case SortBy.Modified: return a.modified.getTime() - b.modified.getTime();
            case SortBy.Type: return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
            default: return a.name.localeCompare(b.name);
        }
    };
    fileEntries.sort(cmp);
    console.log(`目录: ${resolved}\n${"=".repeat(70)}`);
    if (longFormat) {
        console.log("类型".padEnd(6) + "大小".padEnd(12) + "修改时间".padEnd(22) + "名称");
        console.log("-".repeat(70));
        for (const e of fileEntries) {
            const isDir = e.type === FileType.Directory;
            console.log((isDir ? "[D]" : getFileIcon(e.name, false)).padEnd(6)
                + (isDir ? "-" : formatSize(e.size)).padEnd(12) + formatDate(e.modified).padEnd(22) + e.name);
        }
    }
    else {
        console.log(fileEntries.map((e) => `${getFileIcon(e.name, e.type === FileType.Directory)} ${e.name}`).join("\n"));
    }
    console.log(`${"=".repeat(70)}\n共 ${fileEntries.length} 项 (按 ${sortBy} 排序)`);
}
function cmdExists(filePath) {
    const resolved = resolvePath(filePath);
    if (fs.existsSync(resolved))
        console.log(`存在 [${FILE_TYPE_NAMES[detectFileType(fs.statSync(resolved))]}]: ${resolved}`);
    else
        console.log(`不存在: ${resolved}`);
}
function cmdMkdir(dirPath) {
    const resolved = resolvePath(dirPath);
    if (fs.existsSync(resolved))
        die(`错误：路径已存在 - ${resolved}`);
    fs.mkdirSync(resolved, { recursive: true });
    console.log(`目录创建成功: ${resolved}`);
}
function cmdTree(dirPath, options) {
    const resolved = resolvePath(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory())
        die(`错误：${resolved} 不是目录。`);
    let maxDepth = 5;
    for (let i = 0; i < options.length; i++) {
        if (options[i] === "-d" && options[i + 1]) {
            maxDepth = parseInt(options[i + 1], 10);
            if (Number.isNaN(maxDepth) || maxDepth <= 0)
                die("错误：-d 参数必须为正整数。");
            i++;
        }
    }
    const report = renderTree(resolved, maxDepth);
    console.log(report.lines.join("\n"));
    console.log(`\n${report.dirCount} 个目录, ${report.fileCount} 个文件`);
}
function cmdHash(filePath, options) {
    let algo = "sha256";
    for (let i = 0; i < options.length; i++) {
        if (options[i] === "--algo" && options[i + 1]) {
            const v = options[i + 1];
            if (v === "md5" || v === "sha256")
                algo = v;
            i++;
        }
    }
    const r = new HashOperation().execute(filePath, algo);
    if (isFailure(r))
        die(`哈希失败: ${r.error.message}`, r.error.code);
    console.log(`${algo.toUpperCase()}: ${r.value}  (${r.elapsedMs}ms)`);
}
function cmdWatch(dirPath) {
    const resolved = resolvePath(dirPath);
    if (!fs.existsSync(resolved))
        die(`错误：路径不存在 - ${resolved}`);
    console.log(`监视中: ${resolved}  (Ctrl+C 退出)`);
    watchPath(resolved, (e) => {
        const ts = new Date().toISOString();
        if (e.type === "change")
            console.log(`[${ts}] CHANGE  ${e.path}  (${formatSize(e.size)})`);
        else if (e.type === "rename")
            console.log(`[${ts}] RENAME  ${e.path}`);
        else
            console.log(`[${ts}] ERROR   ${e.path}  ${e.error.message}`);
    });
}
function cmdCompare(a, b) {
    const r = compareFiles(a, b);
    if (isFailure(r))
        die(`比较失败: ${r.error.message}`, r.error.code);
    const res = r.value;
    console.log(`A: ${resolvePath(a)} (${formatSize(res.sizeA)})`);
    console.log(`B: ${resolvePath(b)} (${formatSize(res.sizeB)})`);
    console.log(`结果: ${res.identical ? "完全相同" : "不同"}`);
    if (!res.identical) {
        console.log(`大小差异: ${res.sizeB - res.sizeA} 字节`);
        if (res.diffAt !== null)
            console.log(`首个差异位置: 字节 ${res.diffAt}`);
    }
    console.log(`耗时: ${r.elapsedMs}ms`);
}
function cmdSearch(dir, pattern, options) {
    const matches = searchInFiles(dir, pattern, { caseInsensitive: options.includes("-i"), maxResults: 100 });
    if (matches.length === 0) {
        console.log("未找到匹配项。");
        return;
    }
    for (const m of matches)
        console.log(`${m.file}:${m.line}:${m.column}: ${m.text}`);
    console.log(`\n共 ${matches.length} 处匹配`);
}
function cmdBatch(args) {
    const sub = args[0];
    if (sub === "copy") {
        const [, dir, destDir, pattern] = args;
        if (!dir || !destDir || !pattern)
            die("用法：batch copy <源目录> <目标目录> <模式>");
        const entries = fs.readdirSync(resolvePath(dir)).filter((e) => matchGlob(pattern, e));
        const pairs = entries.map((e) => [path.join(resolvePath(dir), e), path.join(resolvePath(destDir), e)]);
        const result = batchCopy(pairs, { onProgress: (c, t) => process.stderr.write(`\r复制进度: ${c}/${t}`) });
        process.stderr.write("\r");
        console.log(`成功: ${result.succeeded.length}, 失败: ${result.failed.length}`);
        for (const [p, err] of result.failed)
            console.log(`  失败: ${p} -> ${err.message}`);
    }
    else if (sub === "rm") {
        const [, dir, pattern] = args;
        if (!dir || !pattern)
            die("用法：batch rm <目录> <模式>");
        const result = deleteByPattern(resolvePath(dir), pattern);
        console.log(`成功: ${result.succeeded.length}, 失败: ${result.failed.length}`);
        for (const [p, err] of result.failed)
            console.log(`  失败: ${p} -> ${err.message}`);
    }
    else
        die("未知批量子命令：使用 copy 或 rm");
}
function cmdHelp() {
    console.log([
        "文件读写工具 CLI (增强版)", "", "用法： file-rw <command> [options] [args...]", "", "命令：",
        "  read    <文件路径> [-l 行数] [-e 编码]    读取文件内容",
        "  write   <文件路径> <内容> [-n]             写入文件（覆盖）",
        "  append  <文件路径> <内容>                  追加内容到文件末尾",
        "  copy    <源> <目标> [-f]                   复制文件",
        "  move    <源> <目标> [-f]                   移动/重命名文件",
        "  delete  <文件路径> [-f] [-r]               删除文件",
        "  info    <文件路径>                         查看文件详细信息",
        "  list    <目录> [-a] [-l] [--sort X]        列出目录内容",
        "  exists  <路径>                             检查路径是否存在",
        "  mkdir   <目录路径>                         创建目录（递归）",
        "  tree    <目录> [-d 深度]                   以树形结构显示目录",
        "  hash    <文件路径> [--algo md5|sha256]     计算文件哈希",
        "  watch   <目录路径>                         监视目录变化",
        "  compare <A> <B>                            二进制比较两个文件",
        "  search  <目录> <正则> [-i]                 搜索文件内容 (grep)",
        "  batch   copy <dir> <destDir> <pattern>     批量复制",
        "  batch   rm   <dir> <pattern>               按模式批量删除",
        "  help                                      显示帮助信息", "", "选项：",
        "  -l <行数>      read：只读取前 N 行",
        "  -e <编码>      read：指定文件编码（默认 utf-8）",
        "  -n             write：不追加末尾换行符",
        "  -f             copy/move/delete：强制覆盖/删除",
        "  -r             delete：递归删除目录",
        "  -a             list：显示隐藏文件",
        "  --sort <字段>  list：排序字段 (NAME/SIZE/MODIFIED/TYPE)",
        "  -d <深度>      tree：限制显示深度（默认 5）",
        "  --algo <算法>  hash：md5 或 sha256（默认 sha256）",
        "  -i             search：忽略大小写", "", "示例：",
        '  file-rw write ./hello.txt "Hello, World!"',
        "  file-rw read ./hello.txt -l 10",
        "  file-rw hash ./hello.txt --algo md5",
        "  file-rw compare ./a.txt ./b.txt",
        "  file-rw search ./src \"TODO\" -i",
        "  file-rw batch copy ./src ./backup *.ts",
        "  file-rw tree . -d 3",
    ].join("\n"));
}
function parseArgs(argv) {
    const positional = [], options = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("-")) {
            options.push(arg);
            if ((arg === "-l" || arg === "-e" || arg === "-d" || arg === "--sort" || arg === "--algo")
                && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
                i++;
                options.push(argv[i]);
            }
        }
        else
            positional.push(arg);
    }
    return { command: (positional[0] ?? "help").toLowerCase(), positional: positional.slice(1), options };
}
/* ============================== 入口 ============================== */
function main() {
    const { command, positional, options } = parseArgs(process.argv.slice(2));
    const need = (cond, msg) => { if (!cond) {
        console.error(msg);
        process.exit(1);
    } };
    switch (command) {
        case "read":
        case "cat":
            need(!!positional[0], "错误：请提供文件路径。用法：file-rw read <文件路径>");
            cmdRead(positional[0], options);
            break;
        case "write":
            need(!!positional[0] && !!positional[1], "错误：用法：file-rw write <文件路径> <内容>");
            cmdWrite(positional[0], positional.slice(1).join(" "), options);
            break;
        case "append":
            need(!!positional[0] && !!positional[1], "错误：用法：file-rw append <文件路径> <内容>");
            cmdAppend(positional[0], positional.slice(1).join(" "));
            break;
        case "copy":
        case "cp":
            need(!!positional[0] && !!positional[1], "错误：用法：file-rw copy <源> <目标>");
            cmdCopy(positional[0], positional[1], options);
            break;
        case "move":
        case "mv":
        case "rename":
            need(!!positional[0] && !!positional[1], "错误：用法：file-rw move <源> <目标>");
            cmdMove(positional[0], positional[1], options);
            break;
        case "delete":
        case "del":
        case "rm":
            need(!!positional[0], "错误：用法：file-rw delete <文件路径>");
            cmdDelete(positional[0], options);
            break;
        case "info":
        case "stat":
            need(!!positional[0], "错误：用法：file-rw info <文件路径>");
            cmdInfo(positional[0]);
            break;
        case "list":
        case "ls":
        case "dir":
            cmdList(positional[0] ?? ".", options);
            break;
        case "exists":
        case "test":
            need(!!positional[0], "错误：用法：file-rw exists <路径>");
            cmdExists(positional[0]);
            break;
        case "mkdir":
            need(!!positional[0], "错误：用法：file-rw mkdir <目录路径>");
            cmdMkdir(positional[0]);
            break;
        case "tree":
            cmdTree(positional[0] ?? ".", options);
            break;
        case "hash":
            need(!!positional[0], "错误：用法：file-rw hash <文件路径>");
            cmdHash(positional[0], options);
            break;
        case "watch":
            need(!!positional[0], "错误：用法：file-rw watch <目录路径>");
            cmdWatch(positional[0]);
            break;
        case "compare":
        case "diff":
            need(!!positional[0] && !!positional[1], "错误：用法：file-rw compare <A> <B>");
            cmdCompare(positional[0], positional[1]);
            break;
        case "search":
        case "grep":
            need(!!positional[0] && !!positional[1], "错误：用法：file-rw search <目录> <正则> [-i]");
            cmdSearch(positional[0], positional[1], options);
            break;
        case "batch":
            need(!!positional[0], "错误：用法：file-rw batch <copy|rm> ...");
            cmdBatch(positional);
            break;
        case "help":
        case "--help":
        case "-h":
            cmdHelp();
            break;
        default:
            console.error(`未知命令：${command}\n使用 \`file-rw help\` 查看可用命令。`);
            process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map