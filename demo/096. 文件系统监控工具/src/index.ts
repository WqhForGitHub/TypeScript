#!/usr/bin/env node

/**
 * 文件系统监控工具
 * 功能：监控目录的文件创建/修改/删除/重命名事件，支持递归、glob 过滤、
 *   内容差异、事件防抖、实时统计、日志输出、彩色终端。
 * 用法：node dist/index.js <监控目录> [选项]
 *   -r/--recursive, --no-recursive, -i/--include <glob>, -e/--exclude <glob>,
 *   -d/--debounce <ms>, -o/--output <file>, --diff, --stats, -h/--help
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// 1. String Enum (regular enum, not const, to support Object.values)
enum FileEventType {
  Create = "create",
  Update = "update",
  Delete = "delete",
  Rename = "rename",
}

// 9. Interfaces with optional / readonly / index signature
interface WatcherConfig {
  readonly targetDir: string;
  readonly recursive: boolean;
  readonly includePatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly debounceMs: number;
  readonly outputFile?: string;
  readonly showDiff: boolean;
  readonly showStats: boolean;
  [key: string]: unknown;
}

interface EventStats {
  readonly create: number;
  readonly update: number;
  readonly delete: number;
  readonly rename: number;
  readonly total: number;
  readonly startTime: Date;
}

// 3. Discriminated Unions (common `kind` discriminant field)
interface BaseEvent {
  readonly kind: FileEventType;
  readonly timestamp: Date;
  readonly filePath: string;
}

interface CreateEvent extends BaseEvent {
  readonly kind: FileEventType.Create;
  readonly size: number;
}

interface UpdateEvent extends BaseEvent {
  readonly kind: FileEventType.Update;
  readonly size: number;
  readonly previousSize?: number;
  diff?: string;
}

interface DeleteEvent extends BaseEvent {
  readonly kind: FileEventType.Delete;
}

interface RenameEvent extends BaseEvent {
  readonly kind: FileEventType.Rename;
  readonly oldPath: string;
}

type FileEvent = CreateEvent | UpdateEvent | DeleteEvent | RenameEvent;

// 15. Type Guards (custom `is` functions)
function isCreateEvent(e: FileEvent): e is CreateEvent {
  return e.kind === FileEventType.Create;
}
function isUpdateEvent(e: FileEvent): e is UpdateEvent {
  return e.kind === FileEventType.Update;
}
function isDeleteEvent(e: FileEvent): e is DeleteEvent {
  return e.kind === FileEventType.Delete;
}
function isRenameEvent(e: FileEvent): e is RenameEvent {
  return e.kind === FileEventType.Rename;
}

// 5. Conditional Types
type EventData<E extends FileEvent> = E extends CreateEvent
  ? { size: number }
  : E extends UpdateEvent
    ? { size: number; diff?: string }
    : E extends RenameEvent
      ? { oldPath: string }
      : Record<string, never>;

// 4. Mapped Types (-readonly removes readonly)
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type WritableStats = Mutable<EventStats>;

// 8. Custom Error Hierarchy with `code` property
abstract class WatcherError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class DirectoryNotFoundError extends WatcherError {
  readonly code = "DIR_NOT_FOUND";
  constructor(dirPath: string) {
    super(`目录不存在: ${dirPath}`);
  }
}
class NotADirectoryError extends WatcherError {
  readonly code = "NOT_A_DIR";
  constructor(filePath: string) {
    super(`不是目录: ${filePath}`);
  }
}
class WatcherInitError extends WatcherError {
  readonly code = "INIT_FAILED";
  constructor(message: string) {
    super(message);
  }
}

// 13. Symbols for unique property keys
const PAUSED = Symbol("paused");

// 16. Tuples and readonly tuples
type SizeTuple = readonly [bytes: number, formatted: string];
type DiffResult = readonly [changedLines: number, diff: string];

// 14. as const assertions (only on literal expressions)
const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "*.log",
] as const;
const ANSI_CODES = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
} as const;

// 10. satisfies operator
const EVENT_ICONS = {
  [FileEventType.Create]: "+",
  [FileEventType.Update]: "~",
  [FileEventType.Delete]: "-",
  [FileEventType.Rename]: ">",
} satisfies Record<FileEventType, string>;

const ANSI_RESET = ANSI_CODES.reset;
const ANSI_BOLD = ANSI_CODES.bold;
const ANSI_DIM = ANSI_CODES.dim;

const COLOR = {
  green: (s: string) => `\x1b[32m${s}${ANSI_RESET}`,
  yellow: (s: string) => `\x1b[33m${s}${ANSI_RESET}`,
  red: (s: string) => `\x1b[31m${s}${ANSI_RESET}`,
  blue: (s: string) => `\x1b[34m${s}${ANSI_RESET}`,
  cyan: (s: string) => `\x1b[36m${s}${ANSI_RESET}`,
  magenta: (s: string) => `\x1b[35m${s}${ANSI_RESET}`,
  gray: (s: string) => `${ANSI_DIM}${s}${ANSI_RESET}`,
  bold: (s: string) => `${ANSI_BOLD}${s}${ANSI_RESET}`,
};

const EVENT_COLORS = {
  [FileEventType.Create]: COLOR.green,
  [FileEventType.Update]: COLOR.yellow,
  [FileEventType.Delete]: COLOR.red,
  [FileEventType.Rename]: COLOR.magenta,
} satisfies Record<FileEventType, (s: string) => string>;

// 7. Function Overloads
function formatSize(bytes: number): string;
function formatSize(bytes: number, asTuple: true): SizeTuple;
function formatSize(bytes: number, asTuple?: boolean): string | SizeTuple {
  let formatted: string;
  if (bytes < 1024) {
    formatted = `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    formatted = `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    formatted = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (asTuple) {
    return [bytes, formatted] as SizeTuple;
  }
  return formatted;
}

// 2. Generics with constraints
function collectValues<K extends string, V, R>(
  source: ReadonlyMap<K, V>,
  fn: (value: V, key: K) => R,
): R[] {
  const out: R[] = [];
  for (const [k, v] of source) {
    out.push(fn(v, k));
  }
  return out;
}

function getEventData<E extends FileEvent>(event: E): EventData<E> {
  if (isCreateEvent(event)) {
    return { size: event.size } as EventData<E>;
  }
  if (isUpdateEvent(event)) {
    return { size: event.size, diff: event.diff } as EventData<E>;
  }
  if (isRenameEvent(event)) {
    return { oldPath: event.oldPath } as EventData<E>;
  }
  return {} as EventData<E>;
}

// ==================== 工具函数 ====================

function matchGlob(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(normalizedPath);
}

function shouldWatch(
  filePath: string,
  includePatterns: readonly string[],
  excludePatterns: readonly string[],
): boolean {
  const relativePath = filePath.replace(/\\/g, "/");
  for (const pattern of excludePatterns) {
    if (matchGlob(relativePath, pattern)) return false;
  }
  if (includePatterns.length > 0) {
    return includePatterns.some((p) => matchGlob(relativePath, p));
  }
  return true;
}

function getFileSize(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return undefined;
  }
}

function getFileHash(filePath: string): string | undefined {
  try {
    return crypto
      .createHash("md5")
      .update(fs.readFileSync(filePath))
      .digest("hex");
  } catch {
    return undefined;
  }
}

function readFileHead(filePath: string, maxLines: number = 20): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").slice(0, maxLines);
  } catch {
    return [];
  }
}

function computeDiff(
  oldLines: readonly string[],
  newLines: readonly string[],
): DiffResult {
  const maxContext = 5;
  const result: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  let changeCount = 0;
  for (let i = 0; i < maxLen && changeCount < maxContext; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine !== newLine) {
      if (oldLine !== undefined)
        result.push(COLOR.red(`  - ${i + 1}: ${oldLine}`));
      if (newLine !== undefined)
        result.push(COLOR.green(`  + ${i + 1}: ${newLine}`));
      changeCount++;
    }
  }
  if (maxLen > maxContext) {
    result.push(COLOR.gray(`  ... 共 ${maxLen} 行`));
  }
  return [changeCount, result.join("\n")] as DiffResult;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m ${remainSeconds}s`;
}

// Object.values on regular enum (demonstrates non-const enum)
function getAllEventTypes(): FileEventType[] {
  return Object.values(FileEventType);
}

// ==================== 参数解析 ====================

function parseArgs(args: string[]): WatcherConfig {
  const includePatterns: string[] = [];
  const excludePatterns: string[] = [...DEFAULT_EXCLUDE_PATTERNS];
  let targetDir = ".",
    recursive = true,
    debounceMs = 100;
  let outputFile: string | undefined;
  let showDiff = false,
    showStats = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      case "-r":
      case "--recursive":
        recursive = true;
        break;
      case "--no-recursive":
        recursive = false;
        break;
      case "-i":
      case "--include":
        i++;
        if (i < args.length) includePatterns.push(args[i]);
        break;
      case "-e":
      case "--exclude":
        i++;
        if (i < args.length) excludePatterns.push(args[i]);
        break;
      case "-d":
      case "--debounce":
        i++;
        if (i < args.length) debounceMs = parseInt(args[i], 10);
        break;
      case "-o":
      case "--output":
        i++;
        if (i < args.length) outputFile = args[i];
        break;
      case "--diff":
        showDiff = true;
        break;
      case "--stats":
        showStats = true;
        break;
      default:
        if (!arg.startsWith("-")) targetDir = arg;
        break;
    }
    i++;
  }

  return {
    targetDir,
    recursive,
    includePatterns,
    excludePatterns,
    debounceMs,
    outputFile,
    showDiff,
    showStats,
  } satisfies WatcherConfig;
}

function printHelp(): void {
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

// 6. Abstract class with concrete subclasses
abstract class AbstractWatcher {
  protected readonly config: WatcherConfig;
  protected readonly stats: WritableStats;
  protected readonly watchers: Map<string, fs.FSWatcher> = new Map();
  protected readonly fileHashes: Map<string, string> = new Map();
  protected readonly fileContents: Map<string, string[]> = new Map();
  protected readonly fileSizes: Map<string, number> = new Map();
  protected readonly debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  protected readonly knownFiles: Set<string> = new Set();
  protected outputStream: fs.WriteStream | null = null;
  protected [PAUSED] = false;

  constructor(config: WatcherConfig) {
    this.config = config;
    this.stats = {
      create: 0,
      update: 0,
      delete: 0,
      rename: 0,
      total: 0,
      startTime: new Date(),
    };
  }

  // 11. Getters
  get watcherCount(): number {
    return this.watchers.size;
  }
  get fileCount(): number {
    return this.knownFiles.size;
  }
  get isRunning(): boolean {
    return this.watchers.size > 0 && !this[PAUSED];
  }

  // 11. Setter
  set outputFile(filePath: string | undefined) {
    this.outputStream = filePath
      ? fs.createWriteStream(filePath, { flags: "a" })
      : null;
  }

  // 12. Iterator via Symbol.iterator (generator)
  *[Symbol.iterator](): Iterator<string> {
    for (const file of this.knownFiles) {
      yield file;
    }
  }

  // 12. Generator method
  *filterFiles(pattern: string): Generator<string> {
    for (const file of this.knownFiles) {
      if (matchGlob(file, pattern)) {
        yield file;
      }
    }
  }

  abstract watch(target: string): void;
  abstract stop(): void;

  async start(targetDir: string): Promise<void> {
    const resolved = path.resolve(targetDir);
    if (!fs.existsSync(resolved)) {
      throw new DirectoryNotFoundError(resolved);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new NotADirectoryError(resolved);
    }
    if (this.config.outputFile) {
      this.outputFile = this.config.outputFile;
    }
    this.printBanner(resolved);
    this.scanDirectory(resolved);
    this.watch(resolved);
    if (this.config.showStats) {
      this.startStatsInterval();
    }
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  protected printBanner(targetDir: string): void {
    console.log("");
    console.log(
      COLOR.bold(COLOR.cyan("  ╔══════════════════════════════════════════╗")),
    );
    console.log(
      COLOR.bold(COLOR.cyan("  ║       文件系统监控工具 v1.0.0           ║")),
    );
    console.log(
      COLOR.bold(COLOR.cyan("  ╚══════════════════════════════════════════╝")),
    );
    console.log("");
    console.log(`  ${COLOR.bold("监控目录:")} ${COLOR.cyan(targetDir)}`);
    console.log(
      `  ${COLOR.bold("递归监控:")} ${this.config.recursive ? "是" : "否"}`,
    );
    if (this.config.includePatterns.length > 0) {
      console.log(
        `  ${COLOR.bold("包含模式:")} ${this.config.includePatterns.map((p) => COLOR.green(p)).join(", ")}`,
      );
    }
    console.log(
      `  ${COLOR.bold("排除模式:")} ${this.config.excludePatterns.map((p) => COLOR.red(p)).join(", ")}`,
    );
    console.log(`  ${COLOR.bold("防抖时间:")} ${this.config.debounceMs}ms`);
    console.log(
      `  ${COLOR.bold("内容差异:")} ${this.config.showDiff ? "开启" : "关闭"}`,
    );
    console.log(
      `  ${COLOR.bold("统计信息:")} ${this.config.showStats ? "开启" : "关闭"}`,
    );
    if (this.config.outputFile) {
      console.log(`  ${COLOR.bold("日志文件:")} ${this.config.outputFile}`);
    }
    console.log(`  ${COLOR.bold("已发现文件:")} ${this.fileCount} 个`);
    console.log("");
    console.log(COLOR.gray(`  按 Ctrl+C 停止监控`));
    console.log(COLOR.gray("  ────────────────────────────────────────────"));
    console.log("");
  }

  protected scanDirectory(dirPath: string): void {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (
            this.config.recursive &&
            shouldWatch(fullPath, [], this.config.excludePatterns)
          ) {
            this.scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          if (
            shouldWatch(
              fullPath,
              this.config.includePatterns,
              this.config.excludePatterns,
            )
          ) {
            this.knownFiles.add(fullPath);
            const hash = getFileHash(fullPath);
            if (hash) this.fileHashes.set(fullPath, hash);
            const size = getFileSize(fullPath);
            if (size !== undefined) this.fileSizes.set(fullPath, size);
            if (this.config.showDiff) {
              this.fileContents.set(fullPath, readFileHead(fullPath));
            }
          }
        }
      }
    } catch {
      /* 权限不足等情况忽略 */
    }
  }

  protected handleFsEvent(
    eventType: string,
    filename: string,
    baseDir: string,
  ): void {
    const fullPath = path.join(baseDir, filename);
    if (
      !shouldWatch(
        fullPath,
        this.config.includePatterns,
        this.config.excludePatterns,
      )
    ) {
      return;
    }
    if (this[PAUSED]) return;
    const existingTimer = this.debounceTimers.get(fullPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    this.debounceTimers.set(
      fullPath,
      setTimeout(() => {
        this.debounceTimers.delete(fullPath);
        this.processEvent(eventType, fullPath);
      }, this.config.debounceMs),
    );
  }

  protected processEvent(eventType: string, fullPath: string): void {
    const exists = fs.existsSync(fullPath);
    const wasKnown = this.knownFiles.has(fullPath);
    let fileEvent: FileEvent | null = null;

    if (eventType === "rename") {
      if (exists && !wasKnown) {
        fileEvent = {
          kind: FileEventType.Create,
          timestamp: new Date(),
          filePath: fullPath,
          size: getFileSize(fullPath) ?? 0,
        };
        this.knownFiles.add(fullPath);
        this.recordFileState(fullPath);
      } else if (!exists && wasKnown) {
        fileEvent = {
          kind: FileEventType.Delete,
          timestamp: new Date(),
          filePath: fullPath,
        };
        this.knownFiles.delete(fullPath);
        this.fileHashes.delete(fullPath);
        this.fileContents.delete(fullPath);
        this.fileSizes.delete(fullPath);
      } else if (exists && wasKnown) {
        const newHash = getFileHash(fullPath);
        const oldHash = this.fileHashes.get(fullPath);
        if (newHash && newHash !== oldHash) {
          fileEvent = this.buildUpdateEvent(fullPath);
          this.recordFileState(fullPath);
        }
      }
    } else if (eventType === "change") {
      if (!exists) return;
      const newHash = getFileHash(fullPath);
      const oldHash = this.fileHashes.get(fullPath);
      if (newHash === oldHash) return;
      if (!wasKnown) {
        fileEvent = {
          kind: FileEventType.Create,
          timestamp: new Date(),
          filePath: fullPath,
          size: getFileSize(fullPath) ?? 0,
        };
        this.knownFiles.add(fullPath);
      } else {
        fileEvent = this.buildUpdateEvent(fullPath);
      }
      this.recordFileState(fullPath);
    }

    if (fileEvent) {
      this.emitEvent(fileEvent);
    }
  }

  private buildUpdateEvent(fullPath: string): UpdateEvent {
    const event: UpdateEvent = {
      kind: FileEventType.Update,
      timestamp: new Date(),
      filePath: fullPath,
      size: getFileSize(fullPath) ?? 0,
      previousSize: this.fileSizes.get(fullPath),
    };
    if (this.config.showDiff) {
      const [, diffStr] = this.computeFileDiff(fullPath);
      if (diffStr) event.diff = diffStr;
    }
    return event;
  }

  protected recordFileState(fullPath: string): void {
    const hash = getFileHash(fullPath);
    if (hash) this.fileHashes.set(fullPath, hash);
    const size = getFileSize(fullPath);
    if (size !== undefined) this.fileSizes.set(fullPath, size);
    if (this.config.showDiff) {
      this.fileContents.set(fullPath, readFileHead(fullPath));
    }
  }

  protected computeFileDiff(fullPath: string): DiffResult {
    const oldLines = this.fileContents.get(fullPath) ?? [];
    const newLines = readFileHead(fullPath);
    return computeDiff(oldLines, newLines);
  }

  protected emitEvent(event: FileEvent): void {
    // 15. Type guards to narrow discriminated union before accessing variant fields
    if (isCreateEvent(event)) {
      this.stats.create++;
    } else if (isUpdateEvent(event)) {
      this.stats.update++;
    } else if (isDeleteEvent(event)) {
      this.stats.delete++;
    } else if (isRenameEvent(event)) {
      this.stats.rename++;
    }
    this.stats.total++;

    const icon = EVENT_ICONS[event.kind];
    const colorFn = EVENT_COLORS[event.kind];
    const typeLabel = colorFn(`${icon} ${event.kind.toUpperCase().padEnd(6)}`);
    const timeStr = COLOR.gray(formatTime(event.timestamp));
    const relativePath = path.relative(
      path.resolve(this.config.targetDir),
      event.filePath,
    );

    let line = `  ${timeStr}  ${typeLabel}  ${relativePath}`;
    if (isCreateEvent(event) || isUpdateEvent(event)) {
      line += COLOR.gray(` (${formatSize(event.size)})`);
    }
    if (isRenameEvent(event)) {
      line += COLOR.gray(` ← ${event.oldPath}`);
    }
    console.log(line);

    if (isUpdateEvent(event) && event.diff) {
      console.log(event.diff);
    }

    // Demonstrate conditional type generic + constrained generic
    const _data = getEventData(event);
    const _watchedDirs = collectValues(this.watchers, (_w, dir) => dir);

    this.writeLog(
      `[${formatTime(event.timestamp)}] ${event.kind.toUpperCase()} ${relativePath}` +
        (isCreateEvent(event) || isUpdateEvent(event)
          ? ` (${formatSize(event.size)})`
          : ""),
    );
  }

  protected writeLog(message: string): void {
    if (this.outputStream) {
      this.outputStream.write(message + "\n");
    }
  }

  protected startStatsInterval(): void {
    setInterval(() => {
      const duration = Date.now() - this.stats.startTime.getTime();
      console.log("");
      console.log(COLOR.cyan("  ── 统计信息 ──"));
      console.log(`  运行时间: ${formatDuration(duration)}`);
      const parts = getAllEventTypes().map(
        (t) => `${EVENT_ICONS[t]} ${EVENT_COLORS[t](String(this.stats[t]))}`,
      );
      console.log(`  ${parts.join("  ")}`);
      console.log(
        `  总事件数: ${COLOR.bold(String(this.stats.total))}  监控文件: ${this.fileCount}`,
      );
      console.log("");
    }, 10000);
  }

  protected shutdown(): void {
    console.log("");
    console.log(COLOR.cyan("  正在停止监控..."));
    this.stop();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.outputStream) {
      this.outputStream.end();
    }

    const duration = Date.now() - this.stats.startTime.getTime();
    console.log("");
    console.log(COLOR.cyan("  ══════════════════════════════════════════"));
    console.log(COLOR.bold("  监控摘要"));
    console.log(COLOR.cyan("  ══════════════════════════════════════════"));
    console.log(`  运行时间: ${formatDuration(duration)}`);
    const summary = getAllEventTypes().map(
      (t) => `${EVENT_ICONS[t]} ${EVENT_COLORS[t](String(this.stats[t]))}`,
    );
    console.log(`  ${summary.join("  ")}`);
    console.log(`  总事件数: ${COLOR.bold(String(this.stats.total))}`);
    console.log("");
    process.exit(0);
  }
}

// Concrete subclass 1: directory watcher (main implementation)
class DirectoryWatcher extends AbstractWatcher {
  watch(target: string): void {
    try {
      const watcher = fs.watch(
        target,
        { recursive: this.config.recursive },
        (eventType, filename) => {
          if (!filename) return;
          this.handleFsEvent(eventType, filename, target);
        },
      );
      watcher.on("error", (err) => {
        const msg = `监控错误 (${target}): ${err.message}`;
        console.error(COLOR.red(msg));
        this.writeLog(msg);
      });
      this.watchers.set(target, watcher);
    } catch (err) {
      throw new WatcherInitError(
        `无法监控目录 ${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

// Concrete subclass 2: single file watcher (alternative implementation)
class SingleFileWatcher extends AbstractWatcher {
  watch(target: string): void {
    this.knownFiles.add(target);
    const hash = getFileHash(target);
    if (hash) this.fileHashes.set(target, hash);
    const size = getFileSize(target);
    if (size !== undefined) this.fileSizes.set(target, size);

    try {
      const watcher = fs.watch(target, (eventType, filename) => {
        this.handleFsEvent(eventType, filename ?? target, path.dirname(target));
      });
      watcher.on("error", (err) => {
        const msg = `监控错误 (${target}): ${err.message}`;
        console.error(COLOR.red(msg));
        this.writeLog(msg);
      });
      this.watchers.set(target, watcher);
    } catch (err) {
      throw new WatcherInitError(
        `无法监控文件 ${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

// ==================== 主函数 ====================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = parseArgs(args);
  const watcher: AbstractWatcher = new DirectoryWatcher(config);
  await watcher.start(config.targetDir);
}

main().catch((err) => {
  if (err instanceof WatcherError) {
    console.error(`${COLOR.red("错误")} [${err.code}]: ${err.message}`);
  } else {
    console.error(
      `发生错误: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  process.exit(1);
});
