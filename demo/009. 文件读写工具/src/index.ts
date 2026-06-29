#!/usr/bin/env node

/**
 * 文件读写工具 CLI (增强版)
 * 支持 read/write/append/copy/move/delete/info/list/exists/mkdir/tree
 * 以及 hash/watch/compare/search/batch 等高级操作。
 * 仅使用 Node.js 内置模块 (fs / path / os / crypto)。
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

/* ============================== 枚举 ============================== */
enum FileOperation {
  Read = "READ",
  Write = "WRITE",
  Append = "APPEND",
  Copy = "COPY",
  Move = "MOVE",
  Delete = "DELETE",
  Info = "INFO",
  List = "LIST",
  Exists = "EXISTS",
  Mkdir = "MKDIR",
  Tree = "TREE",
  Hash = "HASH",
  Watch = "WATCH",
  Compare = "COMPARE",
  Search = "SEARCH",
  Batch = "BATCH",
}

enum FileType {
  File = "FILE",
  Directory = "DIRECTORY",
  Symlink = "SYMLINK",
  BlockDevice = "BLOCK_DEVICE",
  CharDevice = "CHAR_DEVICE",
  Fifo = "FIFO",
  Socket = "SOCKET",
  Unknown = "UNKNOWN",
}

enum Permission {
  Read = 0o400,
  Write = 0o200,
  Execute = 0o100,
  All = 0o700,
}
enum SortBy {
  Name = "NAME",
  Size = "SIZE",
  Modified = "MODIFIED",
  Type = "TYPE",
}
enum Encoding {
  Utf8 = "utf-8",
  Ascii = "ascii",
  Latin1 = "latin1",
  Base64 = "base64",
  Hex = "hex",
  Binary = "binary",
}

/* ============================== 模板字面量 / 条件类型 ============================== */
type FilePath = `./${string}` | `../${string}` | `/${string}` | string;
type FileExtension = `.${string}`;
type GlobPattern = `${string}${"*" | "?"}${string}` | string;
type EncodingResult<E extends string> = E extends "base64" | "hex"
  ? string
  : string;
type ResolvedResult<T> = Awaited<ReturnType<() => Promise<T>>>;
type UnwrapResult<R> = R extends Result<infer U, infer _E> ? U : never;
type IsNumeric<T> = T extends number ? true : false;

/* ============================== 判别联合 ============================== */
interface Success<T> {
  readonly success: true;
  readonly value: T;
  readonly elapsedMs: number;
}
interface Failure<E> {
  readonly success: false;
  readonly error: E;
  readonly elapsedMs: number;
}
type Result<T, E = Error> = Success<T> | Failure<E>;
type OperationResult<T> = Result<T, FileOperationError>;
type FileEvent =
  | { readonly type: "change"; readonly path: string; readonly size: number }
  | {
      readonly type: "rename";
      readonly path: string;
      readonly filename: string;
    }
  | { readonly type: "error"; readonly path: string; readonly error: Error };

/* ============================== 自定义错误层次结构 ============================== */
abstract class FileOperationError extends Error {
  abstract readonly code: string;
  abstract readonly kind: FileOperation;
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class NotFoundError extends FileOperationError {
  readonly code = "ENOENT";
  readonly kind = FileOperation.Read;
}
class PermissionError extends FileOperationError {
  readonly code = "EACCES";
  readonly kind = FileOperation.Read;
}
class IsDirectoryError extends FileOperationError {
  readonly code = "EISDIR";
  readonly kind = FileOperation.Read;
}
class NotADirectoryError extends FileOperationError {
  readonly code = "ENOTDIR";
  readonly kind = FileOperation.Read;
}
class AlreadyExistsError extends FileOperationError {
  readonly code = "EEXIST";
  readonly kind = FileOperation.Write;
}
class InvalidOperationError extends FileOperationError {
  readonly code = "EINVAL";
  readonly kind = FileOperation.Read;
}

/* ============================== 映射类型 ============================== */
type NumericStatKey =
  | "size"
  | "mode"
  | "uid"
  | "gid"
  | "blksize"
  | "blocks"
  | "ino"
  | "dev"
  | "nlink"
  | "rdev";
type DateStatKey = "atime" | "mtime" | "ctime" | "birthtime";
type MsStatKey = "atimeMs" | "mtimeMs" | "ctimeMs" | "birthtimeMs";
type FileStats = {
  readonly [K in keyof fs.Stats]: K extends NumericStatKey
    ? number
    : K extends DateStatKey
      ? Date
      : K extends MsStatKey
        ? number
        : unknown;
};

/* ============================== 接口 ============================== */
interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: FileType;
  readonly size: number;
  readonly modified: Date;
  readonly created: Date;
  readonly permissions: number;
}
interface FileMetadata {
  readonly name: string;
  readonly dir: string;
  readonly ext: FileExtension | "";
  readonly base: string;
  readonly size: readonly [number, string];
  readonly created: Date;
  readonly modified: Date;
  readonly hash?: string;
  readonly [extra: string]:
    string | Date | readonly [number, string] | undefined;
}
interface OperationOptions {
  readonly force?: boolean;
  readonly recursive?: boolean;
  readonly encoding?: Encoding;
  readonly maxDepth?: number;
  readonly showHidden?: boolean;
  readonly sortBy?: SortBy;
  readonly onProgress?: (current: number, total: number) => void;
}
interface WatchOptions extends OperationOptions {
  readonly persistent?: boolean;
  readonly interval?: number;
}
interface SearchMatch {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}
interface BatchResult {
  readonly succeeded: ReadonlyArray<readonly [string, string]>;
  readonly failed: ReadonlyArray<readonly [string, Error]>;
}
interface FileIconRegistry {
  readonly [ext: string]: string;
}
interface CompareResult {
  readonly identical: boolean;
  readonly diffAt: number | null;
  readonly sizeA: number;
  readonly sizeB: number;
}
interface TreeReport {
  readonly lines: string[];
  readonly dirCount: number;
  readonly fileCount: number;
}

/* ============================== 工具类型 ============================== */
type ReadonlyFileEntry = Readonly<FileEntry>;
type FileEntrySummary = Pick<FileEntry, "name" | "type" | "size">;
type MutableOperationOptions = Partial<OperationOptions>;
type WatchConfig = Omit<WatchOptions, "onProgress">;
type EntryComparator = (a: FileEntry, b: FileEntry) => number;

/* ============================== as const + satisfies ============================== */
const ICON_MAP = {
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
} as const satisfies FileIconRegistry;
const UNIT_LIST = ["B", "KB", "MB", "GB", "TB"] as const;
type FileUnit = (typeof UNIT_LIST)[number];
const FILE_TYPE_NAMES: Readonly<Record<FileType, string>> = {
  [FileType.File]: "普通文件",
  [FileType.Directory]: "目录",
  [FileType.Symlink]: "符号链接",
  [FileType.BlockDevice]: "块设备",
  [FileType.CharDevice]: "字符设备",
  [FileType.Fifo]: "FIFO (命名管道)",
  [FileType.Socket]: "Socket",
  [FileType.Unknown]: "未知类型",
};

/* ============================== 类型守卫 ============================== */
function isSuccess<T, E>(r: Result<T, E>): r is Success<T> {
  return r.success === true;
}
function isFailure<T, E>(r: Result<T, E>): r is Failure<E> {
  return r.success === false;
}
function isFile(stat: fs.Stats): stat is fs.Stats {
  return stat.isFile();
}
function isDirectory(stat: fs.Stats): stat is fs.Stats {
  return stat.isDirectory();
}

/* ============================== 工具函数 ============================== */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const i: number = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNIT_LIST.length - 1,
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${UNIT_LIST[i]}`;
}
function formatDate(d: Date): string {
  const p = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function detectFileType(stat: fs.Stats): FileType {
  if (stat.isFile()) return FileType.File;
  if (stat.isDirectory()) return FileType.Directory;
  if (stat.isSymbolicLink()) return FileType.Symlink;
  if (stat.isBlockDevice()) return FileType.BlockDevice;
  if (stat.isCharacterDevice()) return FileType.CharDevice;
  if (stat.isFIFO()) return FileType.Fifo;
  if (stat.isSocket()) return FileType.Socket;
  return FileType.Unknown;
}
function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return "[D]";
  return (
    (ICON_MAP as Record<string, string>)[path.extname(name).toLowerCase()] ??
    "[F]"
  );
}
function resolvePath(p: FilePath): string {
  return path.resolve(p);
}
function detectEncoding(buf: Buffer): Encoding {
  if (buf.length === 0) return Encoding.Utf8;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return Encoding.Utf8;
  if (buf[0] === 0xff && buf[1] === 0xfe) return Encoding.Utf8;
  let isAscii = true;
  const limit = Math.min(buf.length, 4096);
  for (let i = 0; i < limit; i++) {
    const b = buf[i]!;
    if (b === 0) return Encoding.Binary;
    if (b > 127) isAscii = false;
  }
  return isAscii ? Encoding.Ascii : Encoding.Utf8;
}
function matchGlob(pattern: GlobPattern, name: string): boolean {
  const r = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${r}$`).test(name);
}

/* ============================== Result 构造器 ============================== */
function ok<T>(value: T, elapsedMs: number = 0): Success<T> {
  return { success: true as const, value, elapsedMs };
}
function fail<E>(error: E, elapsedMs: number = 0): Failure<E> {
  return { success: false as const, error, elapsedMs };
}
function wrapOperation<T>(op: () => T): OperationResult<T> {
  const start = Date.now();
  try {
    return ok<T>(op(), Date.now() - start);
  } catch (err) {
    const elapsed = Date.now() - start;
    if (err instanceof FileOperationError)
      return fail<FileOperationError>(err, elapsed);
    const e = err as NodeJS.ErrnoException;
    let fe: FileOperationError;
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
      default:
        fe = new InvalidOperationError(e.message);
    }
    return fail<FileOperationError>(fe, elapsed);
  }
}

/* ============================== 文件哈希 ============================== */
function hashFile(
  filePath: string,
  algorithm: "md5" | "sha256" = "sha256",
): OperationResult<string> {
  return wrapOperation(() => {
    const h = crypto.createHash(algorithm);
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const totalSize = fs.statSync(filePath).size;
      let bytesRead: number,
        total = 0;
      while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        h.update(buf.subarray(0, bytesRead));
        total += bytesRead;
        if (totalSize > 0)
          process.stderr.write(`\r${Math.floor((total / totalSize) * 100)}%`);
      }
      process.stderr.write("\r");
      return h.digest("hex");
    } finally {
      fs.closeSync(fd);
    }
  });
}

/* ============================== 抽象类与具体实现 ============================== */
abstract class AbstractFileOperation<
  TOpts extends OperationOptions = OperationOptions,
> {
  protected readonly options: TOpts;
  abstract readonly operation: FileOperation;
  constructor(options?: TOpts) {
    this.options = (options ?? {}) as TOpts;
  }
  abstract perform(...args: unknown[]): OperationResult<unknown>;
  protected reportProgress(current: number, total: number): void {
    if (this.options.onProgress) this.options.onProgress(current, total);
  }
  protected ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  get description(): string {
    return `Operation[${this.operation}]`;
  }
}

class ReadOperation extends AbstractFileOperation {
  readonly operation = FileOperation.Read;
  execute(filePath: string): OperationResult<string>;
  execute(filePath: string, encoding: Encoding): OperationResult<string>;
  execute(filePath: string, lineLimit: number): OperationResult<string>;
  execute(
    filePath: string,
    encoding: Encoding,
    lineLimit: number,
  ): OperationResult<string>;
  execute(
    filePath: string,
    arg2?: Encoding | number,
    arg3?: number,
  ): OperationResult<string> {
    return this.perform(filePath, arg2, arg3) as OperationResult<string>;
  }
  perform(...args: unknown[]): OperationResult<unknown> {
    return wrapOperation(() => {
      const filePath = args[0] as string;
      const resolved = resolvePath(filePath);
      if (!fs.existsSync(resolved))
        throw new NotFoundError(`文件不存在: ${resolved}`, resolved);
      const stat = fs.statSync(resolved);
      if (stat.isDirectory())
        throw new IsDirectoryError(`是目录: ${resolved}`, resolved);
      const arg2 = args[1];
      const arg3 = args[2];
      const encoding: Encoding =
        typeof arg2 === "string" ? (arg2 as Encoding) : Encoding.Utf8;
      const lineLimit: number | null =
        typeof arg2 === "number"
          ? arg2
          : typeof arg3 === "number"
            ? arg3
            : null;
      const content = fs.readFileSync(resolved, encoding as BufferEncoding);
      if (lineLimit !== null && lineLimit > 0)
        return content.split("\n").slice(0, lineLimit).join("\n");
      return content;
    });
  }
}

class WriteOperation extends AbstractFileOperation {
  readonly operation = FileOperation.Write;
  private _bytesWritten = 0;
  get bytesWritten(): number {
    return this._bytesWritten;
  }
  set bytesWritten(v: number) {
    if (v < 0) throw new RangeError("bytesWritten 不能为负数");
    this._bytesWritten = v;
  }
  execute(filePath: string, content: string): OperationResult<number> {
    return this.perform(filePath, content) as OperationResult<number>;
  }
  perform(...args: unknown[]): OperationResult<unknown> {
    return wrapOperation(() => {
      const filePath = args[0] as string,
        content = args[1] as string;
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
  readonly operation = FileOperation.Copy;
  execute(src: string, dest: string): OperationResult<void> {
    return this.perform(src, dest) as OperationResult<void>;
  }
  perform(...args: unknown[]): OperationResult<unknown> {
    return wrapOperation(() => {
      const src = args[0] as string,
        dest = args[1] as string;
      if (!fs.existsSync(src)) throw new NotFoundError(`源不存在: ${src}`, src);
      if (fs.existsSync(dest) && !this.options.force)
        throw new AlreadyExistsError(`目标已存在: ${dest} (使用 -f)`, dest);
      this.ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
    });
  }
}

class DeleteOperation extends AbstractFileOperation {
  readonly operation = FileOperation.Delete;
  execute(filePath: string): OperationResult<void> {
    return this.perform(filePath) as OperationResult<void>;
  }
  perform(...args: unknown[]): OperationResult<unknown> {
    return wrapOperation(() => {
      const filePath = args[0] as string;
      if (!fs.existsSync(filePath))
        throw new NotFoundError(`不存在: ${filePath}`, filePath);
      const stat = fs.statSync(filePath);
      if (isDirectory(stat)) {
        if (!this.options.recursive)
          throw new InvalidOperationError(
            `是目录: ${filePath} (使用 -r)`,
            filePath,
          );
        fs.rmSync(filePath, { recursive: true, force: !!this.options.force });
      } else {
        fs.unlinkSync(filePath);
      }
    });
  }
}

class HashOperation extends AbstractFileOperation {
  readonly operation = FileOperation.Hash;
  execute(
    filePath: string,
    algorithm: "md5" | "sha256" = "sha256",
  ): OperationResult<string> {
    return this.perform(filePath, algorithm) as OperationResult<string>;
  }
  perform(...args: unknown[]): OperationResult<unknown> {
    return hashFile(
      args[0] as string,
      (args[1] as "md5" | "sha256") ?? "sha256",
    );
  }
}

/* ============================== 批量操作 ============================== */
function batchCopy(
  pairs: ReadonlyArray<readonly [string, string]>,
  opts?: MutableOperationOptions,
): BatchResult {
  const op = new CopyOperation({ force: true, ...opts });
  const succeeded: Array<readonly [string, string]> = [];
  const failed: Array<readonly [string, Error]> = [];
  pairs.forEach((pair, idx) => {
    const [src, dest] = pair;
    const r = op.execute(src, dest);
    if (isSuccess(r)) succeeded.push([src, dest] as const);
    else failed.push([src, r.error] as const);
    opts?.onProgress?.(idx + 1, pairs.length);
  });
  return { succeeded, failed };
}

function deleteByPattern(
  dir: string,
  pattern: GlobPattern,
  opts?: MutableOperationOptions,
): BatchResult {
  const succeeded: Array<readonly [string, string]> = [];
  const failed: Array<readonly [string, Error]> = [];
  if (!fs.existsSync(dir)) return { succeeded, failed };
  const entries = fs.readdirSync(dir);
  entries.forEach((entry, idx) => {
    if (matchGlob(pattern, entry)) {
      const full = path.join(dir, entry);
      const r = new DeleteOperation({ force: true, ...opts }).execute(full);
      if (isSuccess(r)) succeeded.push([full, "deleted"] as const);
      else failed.push([full, r.error] as const);
    }
    opts?.onProgress?.(idx + 1, entries.length);
  });
  return { succeeded, failed };
}

/* ============================== 目录遍历器 (Generator) ============================== */
function* walkDirectory(
  root: string,
  maxDepth: number = Infinity,
  currentDepth: number = 0,
): Generator<readonly [string, fs.Stats, number], void, unknown> {
  if (currentDepth > maxDepth) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    yield [full, stat, currentDepth] as const;
    if (stat.isDirectory())
      yield* walkDirectory(full, maxDepth, currentDepth + 1);
  }
}
type WalkResult = ReturnType<typeof walkDirectory>;

/* ============================== 文件比较 / 内容搜索 / 元数据 / 树 / 监视 ============================== */
function compareFiles(a: string, b: string): OperationResult<CompareResult> {
  return wrapOperation(() => {
    const bufA = fs.readFileSync(a),
      bufB = fs.readFileSync(b);
    let diffAt: number | null = null;
    const minLen = Math.min(bufA.length, bufB.length);
    for (let i = 0; i < minLen; i++) {
      if (bufA[i] !== bufB[i]) {
        diffAt = i;
        break;
      }
    }
    return {
      identical: diffAt === null && bufA.length === bufB.length,
      diffAt,
      sizeA: bufA.length,
      sizeB: bufB.length,
    } as CompareResult;
  });
}

function searchInFiles(
  dir: string,
  pattern: string,
  opts?: { readonly maxResults?: number; readonly caseInsensitive?: boolean },
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const maxResults = opts?.maxResults ?? 100;
  const regex = new RegExp(pattern, opts?.caseInsensitive ? "i" : "");
  for (const [full, stat] of walkDirectory(dir, 10)) {
    if (!stat.isFile()) continue;
    try {
      const lines = fs.readFileSync(full, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = regex.exec(lines[i]!);
        if (m) {
          matches.push({
            file: full,
            line: i + 1,
            column: m.index + 1,
            text: lines[i]!.trim().slice(0, 80),
          });
          if (matches.length >= maxResults) return matches;
        }
      }
    } catch {
      /* 跳过二进制/不可读 */
    }
  }
  return matches;
}

function extractMetadata(filePath: string): OperationResult<FileMetadata> {
  return wrapOperation(() => {
    const resolved = resolvePath(filePath);
    const stat = fs.statSync(resolved);
    const parsed = path.parse(resolved);
    return {
      name: parsed.name,
      dir: parsed.dir,
      ext: (parsed.ext || "") as FileExtension | "",
      base: parsed.base,
      size: [stat.size, formatSize(stat.size)] as readonly [number, string],
      created: stat.birthtime,
      modified: stat.mtime,
    } as FileMetadata;
  });
}

function renderTree(root: string, maxDepth: number = 5): TreeReport {
  const lines: string[] = [root];
  let dirCount = 0,
    fileCount = 0;
  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = fs
        .readdirSync(dir)
        .filter((e) => !e.startsWith("."))
        .sort();
    } catch {
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
        } else {
          fileCount++;
          lines.push(
            `${prefix}${connector}${entry}  (${formatSize(stat.size)})`,
          );
        }
      } catch {
        lines.push(`${prefix}${connector}${entry}  (无法访问)`);
      }
    });
  }
  walk(root, "", 1);
  return { lines, dirCount, fileCount };
}

function watchPath(
  target: string,
  onEvent: (e: FileEvent) => void,
): fs.FSWatcher {
  return fs.watch(target, { recursive: false }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(target, filename);
    try {
      const stat = fs.statSync(fullPath);
      onEvent(
        eventType === "rename"
          ? { type: "rename", path: fullPath, filename }
          : { type: "change", path: fullPath, size: stat.size },
      );
    } catch {
      onEvent({ type: "rename", path: fullPath, filename });
    }
  });
}

/* ============================== CLI 命令实现 ============================== */
function die(msg: string, code?: string): never {
  console.error(code ? `${msg} [${code}]` : msg);
  process.exit(1);
}

function cmdRead(filePath: string, options: string[]): void {
  let lineLimit: number | null = null,
    encoding: Encoding = Encoding.Utf8;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "-l" && options[i + 1]) {
      lineLimit = parseInt(options[i + 1]!, 10);
      if (Number.isNaN(lineLimit) || lineLimit <= 0)
        die("错误：-l 参数必须为正整数。");
      i++;
    } else if (options[i] === "-e" && options[i + 1]) {
      encoding = options[i + 1]! as Encoding;
      i++;
    }
  }
  const op = new ReadOperation();
  const r =
    lineLimit !== null
      ? op.execute(filePath, lineLimit)
      : op.execute(filePath, encoding);
  if (isFailure(r)) die(`读取失败: ${r.error.message}`, r.error.code);
  console.log(r.value);
  try {
    const stat = fs.statSync(resolvePath(filePath));
    console.log(
      `\n--- 文件信息 ---\n大小: ${formatSize(stat.size)}\n耗时: ${r.elapsedMs}ms`,
    );
  } catch {
    /* ignore */
  }
}

function cmdWrite(filePath: string, content: string, options: string[]): void {
  const op = new WriteOperation({ force: options.includes("-n") });
  const r = op.execute(filePath, content);
  if (isFailure(r)) die(`写入失败: ${r.error.message}`, r.error.code);
  console.log(
    `写入成功: ${resolvePath(filePath)} (${formatSize(op.bytesWritten)}, ${r.elapsedMs}ms)`,
  );
}

function cmdAppend(filePath: string, content: string): void {
  const resolved = resolvePath(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existed = fs.existsSync(resolved);
  const r = wrapOperation(() => {
    fs.appendFileSync(resolved, content + "\n", "utf-8");
    return fs.statSync(resolved).size;
  });
  if (isFailure(r)) die(`追加失败: ${r.error.message}`, r.error.code);
  console.log(
    `${existed ? "追加" : "新建"}成功: ${resolved} (${formatSize(r.value)})`,
  );
}

function cmdCopy(src: string, dest: string, options: string[]): void {
  const r = new CopyOperation({ force: options.includes("-f") }).execute(
    src,
    dest,
  );
  if (isFailure(r)) die(`复制失败: ${r.error.message}`, r.error.code);
  console.log(
    `复制成功: ${resolvePath(src)} -> ${resolvePath(dest)} (${r.elapsedMs}ms)`,
  );
}

function cmdMove(src: string, dest: string, options: string[]): void {
  const force = options.includes("-f");
  const r = wrapOperation(() => {
    const s = resolvePath(src),
      d = resolvePath(dest);
    if (!fs.existsSync(s)) throw new NotFoundError(`源不存在: ${s}`, s);
    if (fs.existsSync(d) && !force)
      throw new AlreadyExistsError(`目标已存在: ${d}`, d);
    const dd = path.dirname(d);
    if (!fs.existsSync(dd)) fs.mkdirSync(dd, { recursive: true });
    fs.renameSync(s, d);
  });
  if (isFailure(r)) die(`移动失败: ${r.error.message}`, r.error.code);
  console.log(`移动成功 (${r.elapsedMs}ms)`);
}

function cmdDelete(filePath: string, options: string[]): void {
  if (!options.includes("-f"))
    console.log("提示：使用 -f 跳过确认。本演示直接执行删除。");
  const r = new DeleteOperation({
    force: options.includes("-f"),
    recursive: options.includes("-r"),
  }).execute(filePath);
  if (isFailure(r)) die(`删除失败: ${r.error.message}`, r.error.code);
  console.log(`删除成功: ${resolvePath(filePath)} (${r.elapsedMs}ms)`);
}

function cmdInfo(filePath: string): void {
  const meta = extractMetadata(filePath);
  if (isFailure(meta))
    die(`信息获取失败: ${meta.error.message}`, meta.error.code);
  const stat = fs.statSync(resolvePath(filePath));
  console.log(
    "========================================\n         文件/目录详细信息\n========================================",
  );
  console.log(`路径:       ${path.resolve(filePath)}`);
  console.log(`类型:       ${FILE_TYPE_NAMES[detectFileType(stat)]}`);
  console.log(
    `大小:       ${meta.value.size[1]} (${meta.value.size[0].toLocaleString()} 字节)`,
  );
  console.log(`创建时间:   ${formatDate(meta.value.created)}`);
  console.log(`修改时间:   ${formatDate(meta.value.modified)}`);
  console.log(
    `权限:       ${(stat.mode & 0o777).toString(8).padStart(3, "0")}`,
  );
  if (isFile(stat)) {
    console.log(
      `文件名:     ${meta.value.base}\n扩展名:     ${meta.value.ext || "(无)"}`,
    );
  } else if (isDirectory(stat)) {
    try {
      const entries = fs.readdirSync(resolvePath(filePath));
      let fc = 0,
        dc = 0;
      for (const e of entries) {
        const s = fs.statSync(path.join(resolvePath(filePath), e));
        if (s.isFile()) fc++;
        else if (s.isDirectory()) dc++;
      }
      console.log(`子文件数:   ${fc}\n子目录数:   ${dc}`);
    } catch {
      console.log(`子项数:     (无法读取)`);
    }
  }
  console.log("========================================");
}

function cmdList(dirPath: string, options: string[]): void {
  const resolved = resolvePath(dirPath);
  if (!fs.existsSync(resolved)) die(`错误：路径不存在 - ${resolved}`);
  if (!fs.statSync(resolved).isDirectory()) die(`错误：${resolved} 不是目录。`);
  const showHidden = options.includes("-a"),
    longFormat = options.includes("-l");
  let sortBy: SortBy = SortBy.Name;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "--sort" && options[i + 1]) {
      sortBy = (
        options[i + 1]!.toUpperCase() in SortBy
          ? options[i + 1]!.toUpperCase()
          : "NAME"
      ) as SortBy;
      i++;
    }
  }
  let entries = fs.readdirSync(resolved);
  if (!showHidden) entries = entries.filter((e) => !e.startsWith("."));
  const fileEntries: FileEntry[] = entries.map((name) => {
    const stat = fs.statSync(path.join(resolved, name));
    return {
      name,
      path: path.join(resolved, name),
      type: detectFileType(stat),
      size: stat.size,
      modified: stat.mtime,
      created: stat.birthtime,
      permissions: stat.mode & 0o777,
    } as FileEntry;
  });
  const cmp: EntryComparator = (a, b) => {
    switch (sortBy) {
      case SortBy.Size:
        return a.size - b.size;
      case SortBy.Modified:
        return a.modified.getTime() - b.modified.getTime();
      case SortBy.Type:
        return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name);
    }
  };
  fileEntries.sort(cmp);
  console.log(`目录: ${resolved}\n${"=".repeat(70)}`);
  if (longFormat) {
    console.log(
      "类型".padEnd(6) + "大小".padEnd(12) + "修改时间".padEnd(22) + "名称",
    );
    console.log("-".repeat(70));
    for (const e of fileEntries) {
      const isDir = e.type === FileType.Directory;
      console.log(
        (isDir ? "[D]" : getFileIcon(e.name, false)).padEnd(6) +
          (isDir ? "-" : formatSize(e.size)).padEnd(12) +
          formatDate(e.modified).padEnd(22) +
          e.name,
      );
    }
  } else {
    console.log(
      fileEntries
        .map(
          (e) =>
            `${getFileIcon(e.name, e.type === FileType.Directory)} ${e.name}`,
        )
        .join("\n"),
    );
  }
  console.log(
    `${"=".repeat(70)}\n共 ${fileEntries.length} 项 (按 ${sortBy} 排序)`,
  );
}

function cmdExists(filePath: string): void {
  const resolved = resolvePath(filePath);
  if (fs.existsSync(resolved))
    console.log(
      `存在 [${FILE_TYPE_NAMES[detectFileType(fs.statSync(resolved))]}]: ${resolved}`,
    );
  else console.log(`不存在: ${resolved}`);
}

function cmdMkdir(dirPath: string): void {
  const resolved = resolvePath(dirPath);
  if (fs.existsSync(resolved)) die(`错误：路径已存在 - ${resolved}`);
  fs.mkdirSync(resolved, { recursive: true });
  console.log(`目录创建成功: ${resolved}`);
}

function cmdTree(dirPath: string, options: string[]): void {
  const resolved = resolvePath(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory())
    die(`错误：${resolved} 不是目录。`);
  let maxDepth = 5;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "-d" && options[i + 1]) {
      maxDepth = parseInt(options[i + 1]!, 10);
      if (Number.isNaN(maxDepth) || maxDepth <= 0)
        die("错误：-d 参数必须为正整数。");
      i++;
    }
  }
  const report = renderTree(resolved, maxDepth);
  console.log(report.lines.join("\n"));
  console.log(`\n${report.dirCount} 个目录, ${report.fileCount} 个文件`);
}

function cmdHash(filePath: string, options: string[]): void {
  let algo: "md5" | "sha256" = "sha256";
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "--algo" && options[i + 1]) {
      const v = options[i + 1]!;
      if (v === "md5" || v === "sha256") algo = v;
      i++;
    }
  }
  const r = new HashOperation().execute(filePath, algo);
  if (isFailure(r)) die(`哈希失败: ${r.error.message}`, r.error.code);
  console.log(`${algo.toUpperCase()}: ${r.value}  (${r.elapsedMs}ms)`);
}

function cmdWatch(dirPath: string): void {
  const resolved = resolvePath(dirPath);
  if (!fs.existsSync(resolved)) die(`错误：路径不存在 - ${resolved}`);
  console.log(`监视中: ${resolved}  (Ctrl+C 退出)`);
  watchPath(resolved, (e) => {
    const ts = new Date().toISOString();
    if (e.type === "change")
      console.log(`[${ts}] CHANGE  ${e.path}  (${formatSize(e.size)})`);
    else if (e.type === "rename") console.log(`[${ts}] RENAME  ${e.path}`);
    else console.log(`[${ts}] ERROR   ${e.path}  ${e.error.message}`);
  });
}

function cmdCompare(a: string, b: string): void {
  const r = compareFiles(a, b);
  if (isFailure(r)) die(`比较失败: ${r.error.message}`, r.error.code);
  const res = r.value;
  console.log(`A: ${resolvePath(a)} (${formatSize(res.sizeA)})`);
  console.log(`B: ${resolvePath(b)} (${formatSize(res.sizeB)})`);
  console.log(`结果: ${res.identical ? "完全相同" : "不同"}`);
  if (!res.identical) {
    console.log(`大小差异: ${res.sizeB - res.sizeA} 字节`);
    if (res.diffAt !== null) console.log(`首个差异位置: 字节 ${res.diffAt}`);
  }
  console.log(`耗时: ${r.elapsedMs}ms`);
}

function cmdSearch(dir: string, pattern: string, options: string[]): void {
  const matches = searchInFiles(dir, pattern, {
    caseInsensitive: options.includes("-i"),
    maxResults: 100,
  });
  if (matches.length === 0) {
    console.log("未找到匹配项。");
    return;
  }
  for (const m of matches)
    console.log(`${m.file}:${m.line}:${m.column}: ${m.text}`);
  console.log(`\n共 ${matches.length} 处匹配`);
}

function cmdBatch(args: string[]): void {
  const sub = args[0];
  if (sub === "copy") {
    const [, dir, destDir, pattern] = args;
    if (!dir || !destDir || !pattern)
      die("用法：batch copy <源目录> <目标目录> <模式>");
    const entries = fs
      .readdirSync(resolvePath(dir))
      .filter((e) => matchGlob(pattern as GlobPattern, e));
    const pairs: ReadonlyArray<readonly [string, string]> = entries.map(
      (e) =>
        [
          path.join(resolvePath(dir), e),
          path.join(resolvePath(destDir), e),
        ] as const,
    );
    const result = batchCopy(pairs, {
      onProgress: (c, t) => process.stderr.write(`\r复制进度: ${c}/${t}`),
    });
    process.stderr.write("\r");
    console.log(
      `成功: ${result.succeeded.length}, 失败: ${result.failed.length}`,
    );
    for (const [p, err] of result.failed)
      console.log(`  失败: ${p} -> ${err.message}`);
  } else if (sub === "rm") {
    const [, dir, pattern] = args;
    if (!dir || !pattern) die("用法：batch rm <目录> <模式>");
    const result = deleteByPattern(resolvePath(dir), pattern as GlobPattern);
    console.log(
      `成功: ${result.succeeded.length}, 失败: ${result.failed.length}`,
    );
    for (const [p, err] of result.failed)
      console.log(`  失败: ${p} -> ${err.message}`);
  } else die("未知批量子命令：使用 copy 或 rm");
}

function cmdHelp(): void {
  console.log(
    [
      "文件读写工具 CLI (增强版)",
      "",
      "用法： file-rw <command> [options] [args...]",
      "",
      "命令：",
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
      "  help                                      显示帮助信息",
      "",
      "选项：",
      "  -l <行数>      read：只读取前 N 行",
      "  -e <编码>      read：指定文件编码（默认 utf-8）",
      "  -n             write：不追加末尾换行符",
      "  -f             copy/move/delete：强制覆盖/删除",
      "  -r             delete：递归删除目录",
      "  -a             list：显示隐藏文件",
      "  --sort <字段>  list：排序字段 (NAME/SIZE/MODIFIED/TYPE)",
      "  -d <深度>      tree：限制显示深度（默认 5）",
      "  --algo <算法>  hash：md5 或 sha256（默认 sha256）",
      "  -i             search：忽略大小写",
      "",
      "示例：",
      '  file-rw write ./hello.txt "Hello, World!"',
      "  file-rw read ./hello.txt -l 10",
      "  file-rw hash ./hello.txt --algo md5",
      "  file-rw compare ./a.txt ./b.txt",
      '  file-rw search ./src "TODO" -i',
      "  file-rw batch copy ./src ./backup *.ts",
      "  file-rw tree . -d 3",
    ].join("\n"),
  );
}

/* ============================== 参数解析 ============================== */
interface ParsedArgs {
  readonly command: string;
  readonly positional: string[];
  readonly options: string[];
}
function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [],
    options: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("-")) {
      options.push(arg);
      if (
        (arg === "-l" ||
          arg === "-e" ||
          arg === "-d" ||
          arg === "--sort" ||
          arg === "--algo") &&
        i + 1 < argv.length &&
        !argv[i + 1]!.startsWith("-")
      ) {
        i++;
        options.push(argv[i]!);
      }
    } else positional.push(arg);
  }
  return {
    command: (positional[0] ?? "help").toLowerCase(),
    positional: positional.slice(1),
    options,
  };
}

/* ============================== 入口 ============================== */
function main(): void {
  const { command, positional, options } = parseArgs(process.argv.slice(2));
  const need = (cond: boolean, msg: string): void => {
    if (!cond) {
      console.error(msg);
      process.exit(1);
    }
  };
  switch (command) {
    case "read":
    case "cat":
      need(
        !!positional[0],
        "错误：请提供文件路径。用法：file-rw read <文件路径>",
      );
      cmdRead(positional[0]!, options);
      break;
    case "write":
      need(
        !!positional[0] && !!positional[1],
        "错误：用法：file-rw write <文件路径> <内容>",
      );
      cmdWrite(positional[0]!, positional.slice(1).join(" "), options);
      break;
    case "append":
      need(
        !!positional[0] && !!positional[1],
        "错误：用法：file-rw append <文件路径> <内容>",
      );
      cmdAppend(positional[0]!, positional.slice(1).join(" "));
      break;
    case "copy":
    case "cp":
      need(
        !!positional[0] && !!positional[1],
        "错误：用法：file-rw copy <源> <目标>",
      );
      cmdCopy(positional[0]!, positional[1]!, options);
      break;
    case "move":
    case "mv":
    case "rename":
      need(
        !!positional[0] && !!positional[1],
        "错误：用法：file-rw move <源> <目标>",
      );
      cmdMove(positional[0]!, positional[1]!, options);
      break;
    case "delete":
    case "del":
    case "rm":
      need(!!positional[0], "错误：用法：file-rw delete <文件路径>");
      cmdDelete(positional[0]!, options);
      break;
    case "info":
    case "stat":
      need(!!positional[0], "错误：用法：file-rw info <文件路径>");
      cmdInfo(positional[0]!);
      break;
    case "list":
    case "ls":
    case "dir":
      cmdList(positional[0] ?? ".", options);
      break;
    case "exists":
    case "test":
      need(!!positional[0], "错误：用法：file-rw exists <路径>");
      cmdExists(positional[0]!);
      break;
    case "mkdir":
      need(!!positional[0], "错误：用法：file-rw mkdir <目录路径>");
      cmdMkdir(positional[0]!);
      break;
    case "tree":
      cmdTree(positional[0] ?? ".", options);
      break;
    case "hash":
      need(!!positional[0], "错误：用法：file-rw hash <文件路径>");
      cmdHash(positional[0]!, options);
      break;
    case "watch":
      need(!!positional[0], "错误：用法：file-rw watch <目录路径>");
      cmdWatch(positional[0]!);
      break;
    case "compare":
    case "diff":
      need(
        !!positional[0] && !!positional[1],
        "错误：用法：file-rw compare <A> <B>",
      );
      cmdCompare(positional[0]!, positional[1]!);
      break;
    case "search":
    case "grep":
      need(
        !!positional[0] && !!positional[1],
        "错误：用法：file-rw search <目录> <正则> [-i]",
      );
      cmdSearch(positional[0]!, positional[1]!, options);
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
      console.error(
        `未知命令：${command}\n使用 \`file-rw help\` 查看可用命令。`,
      );
      process.exit(1);
  }
}

main();
