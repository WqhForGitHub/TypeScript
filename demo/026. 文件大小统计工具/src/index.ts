#!/usr/bin/env node
/**
 * 文件大小统计工具 (增强版)
 * 递归扫描目录，统计文件大小、扩展名分布、最大文件、大小分布、目录树
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// 1. 枚举
// ============================================================

enum SizeUnit {
  B = "B",
  KB = "KB",
  MB = "MB",
  GB = "GB",
  TB = "TB",
}

enum NodeType {
  File = "file",
  Directory = "directory",
  Symlink = "symlink",
}

enum SortField {
  Name = "name",
  Size = "size",
  Modified = "modified",
  Extension = "extension",
}

enum OutputFormat {
  Text = "text",
  Json = "json",
}

enum DistributionBucket {
  Tiny = "< 1KB",
  Small = "1-10KB",
  Medium = "10-100KB",
  Large = "100KB-1MB",
  Huge = "1-10MB",
  Massive = "> 10MB",
}

// ============================================================
// 2. 接口（含 readonly / optional）
// ============================================================

interface ScanOptions {
  readonly rootPath: string;
  readonly maxDepth: number;
  readonly followSymlinks: boolean;
  readonly includeHidden: boolean;
  readonly topN: number;
  readonly sortBy: SortField;
  readonly format: OutputFormat;
}

interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly extension: string;
  readonly modified: Date;
  readonly isSymlink: boolean;
}

interface ScanResult {
  readonly root: string;
  readonly totalSize: number;
  readonly fileCount: number;
  readonly dirCount: number;
  readonly symlinkCount: number;
  readonly extensions: Readonly<
    Record<string, { count: number; size: number }>
  >;
  readonly largestFiles: readonly FileEntry[];
  readonly distribution: Readonly<Record<DistributionBucket, number>>;
  readonly tree: TreeNode;
}

interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly type: NodeType;
  readonly size: number;
  readonly children: readonly TreeNode[];
}

interface Stats {
  readonly totalFiles: number;
  readonly totalDirs: number;
  readonly totalSize: number;
  readonly emptyDirs: readonly string[];
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

class ScanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class PathNotFoundError extends ScanError {
  constructor(p: string) {
    super(`路径不存在: ${p}`, "PATH_NOT_FOUND");
  }
}

class AccessDeniedError extends ScanError {
  constructor(p: string) {
    super(`无访问权限: ${p}`, "ACCESS_DENIED");
  }
}

// ============================================================
// 4. 映射类型 + 条件类型 + 模板字面量类型
// ============================================================

type SizeUnitMap = { readonly [K in SizeUnit]: number };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type PartialScan = Partial<Mutable<ScanOptions>>;
type SizeString = `${number} ${SizeUnit}`;

// ============================================================
// 5. 判别联合 (扫描事件)
// ============================================================

type ScanEvent =
  | { readonly type: "enter"; readonly path: string; readonly depth: number }
  | { readonly type: "file"; readonly entry: FileEntry }
  | { readonly type: "dir"; readonly path: string }
  | { readonly type: "error"; readonly path: string; readonly message: string }
  | { readonly type: "done"; readonly stats: Stats };

// ============================================================
// 6. 常量表 (as const + satisfies)
// ============================================================

const UNIT_MULTIPLIERS = {
  [SizeUnit.B]: 1,
  [SizeUnit.KB]: 1024,
  [SizeUnit.MB]: 1024 ** 2,
  [SizeUnit.GB]: 1024 ** 3,
  [SizeUnit.TB]: 1024 ** 4,
} as const satisfies SizeUnitMap;

const BUCKET_RANGES: Readonly<
  Record<DistributionBucket, readonly [number, number]>
> = {
  [DistributionBucket.Tiny]: [0, 1024],
  [DistributionBucket.Small]: [1024, 10240],
  [DistributionBucket.Medium]: [10240, 102400],
  [DistributionBucket.Large]: [102400, 1048576],
  [DistributionBucket.Huge]: [1048576, 10485760],
  [DistributionBucket.Massive]: [10485760, Infinity],
} as const satisfies Record<DistributionBucket, readonly [number, number]>;

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
} as const satisfies Record<string, string>;

// ============================================================
// 7. 类型守卫
// ============================================================

function isSizeUnit(value: string): value is SizeUnit {
  return Object.values(SizeUnit).includes(value as SizeUnit);
}

function isSortField(value: string): value is SortField {
  return Object.values(SortField).includes(value as SortField);
}

function isOutputFormat(value: string): value is OutputFormat {
  return Object.values(OutputFormat).includes(value as OutputFormat);
}

// ============================================================
// 8. 泛型 Result 类型
// ============================================================

type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

function isSuccess<T, E>(
  r: Result<T, E>,
): r is { ok: true; readonly value: T } {
  return r.ok;
}

// ============================================================
// 9. 抽象类
// ============================================================

abstract class AbstractScanner {
  protected readonly files: FileEntry[] = [];
  protected readonly emptyDirs: string[] = [];
  protected totalSize = 0;
  protected dirCount = 0;
  protected symlinkCount = 0;

  abstract scan(dirPath: string, options: ScanOptions): ScanResult;

  protected getStats(): Stats {
    return {
      totalFiles: this.files.length,
      totalDirs: this.dirCount,
      totalSize: this.totalSize,
      emptyDirs: [...this.emptyDirs],
    };
  }

  protected reset(): void {
    this.files.length = 0;
    this.emptyDirs.length = 0;
    this.totalSize = 0;
    this.dirCount = 0;
    this.symlinkCount = 0;
  }
}

// ============================================================
// 10. 目录扫描器
// ============================================================

class DirectoryScanner extends AbstractScanner {
  private readonly extensions: Map<string, { count: number; size: number }> =
    new Map();
  private readonly distribution: Record<DistributionBucket, number> = {
    [DistributionBucket.Tiny]: 0,
    [DistributionBucket.Small]: 0,
    [DistributionBucket.Medium]: 0,
    [DistributionBucket.Large]: 0,
    [DistributionBucket.Huge]: 0,
    [DistributionBucket.Massive]: 0,
  };

  scan(dirPath: string, options: ScanOptions): ScanResult {
    this.reset();
    this.extensions.clear();
    for (const key of Object.keys(this.distribution) as DistributionBucket[]) {
      this.distribution[key] = 0;
    }

    const resolvedPath = path.resolve(dirPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new PathNotFoundError(resolvedPath);
    }

    const tree = this.scanDir(resolvedPath, "", 0, options);

    const extObj = Object.fromEntries(this.extensions) as Record<
      string,
      { count: number; size: number }
    >;
    const sortedFiles = this.sortFiles([...this.files], options.sortBy);
    const largestFiles = sortedFiles.slice(0, options.topN);

    return {
      root: resolvedPath,
      totalSize: this.totalSize,
      fileCount: this.files.length,
      dirCount: this.dirCount,
      symlinkCount: this.symlinkCount,
      extensions: extObj,
      largestFiles,
      distribution: { ...this.distribution },
      tree,
    };
  }

  private scanDir(
    dirPath: string,
    _relativePath: string,
    depth: number,
    options: ScanOptions,
  ): TreeNode {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const children: TreeNode[] = [];
    let dirSize = 0;
    let hasFiles = false;

    for (const entry of entries) {
      if (!options.includeHidden && entry.name.startsWith(".")) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isSymbolicLink()) {
        this.symlinkCount++;
        const stat = this.safeStat(fullPath, options.followSymlinks);
        const size = stat?.size ?? 0;
        dirSize += size;
        children.push({
          name: entry.name,
          path: fullPath,
          type: NodeType.Symlink,
          size,
          children: [],
        });
      } else if (entry.isDirectory()) {
        this.dirCount++;
        const childNode =
          depth < options.maxDepth
            ? this.scanDir(fullPath, entry.name, depth + 1, options)
            : {
                name: entry.name,
                path: fullPath,
                type: NodeType.Directory as const,
                size: 0,
                children: [] as TreeNode[],
              };
        dirSize += childNode.size;
        children.push(childNode);
      } else if (entry.isFile()) {
        hasFiles = true;
        const stat = fs.statSync(fullPath);
        const ext = path.extname(entry.name).toLowerCase() || "(无扩展名)";
        const fileEntry: FileEntry = {
          path: fullPath,
          name: entry.name,
          size: stat.size,
          extension: ext,
          modified: stat.mtime,
          isSymlink: false,
        };
        this.files.push(fileEntry);
        this.totalSize += stat.size;
        dirSize += stat.size;

        const extData = this.extensions.get(ext) ?? { count: 0, size: 0 };
        extData.count++;
        extData.size += stat.size;
        this.extensions.set(ext, extData);

        this.addToBucket(stat.size);
        children.push({
          name: entry.name,
          path: fullPath,
          type: NodeType.File,
          size: stat.size,
          children: [],
        });
      }
    }

    if (!hasFiles && children.length === 0) {
      this.emptyDirs.push(dirPath);
    }

    children.sort((a, b) => b.size - a.size);

    return {
      name: path.basename(dirPath),
      path: dirPath,
      type: NodeType.Directory,
      size: dirSize,
      children,
    };
  }

  private safeStat(filePath: string, followSymlinks: boolean): fs.Stats | null {
    try {
      return followSymlinks ? fs.statSync(filePath) : fs.lstatSync(filePath);
    } catch {
      return null;
    }
  }

  private addToBucket(size: number): void {
    for (const key of Object.keys(BUCKET_RANGES) as DistributionBucket[]) {
      const [min, max] = BUCKET_RANGES[key];
      if (size >= min && size < max) {
        this.distribution[key]++;
        return;
      }
    }
  }

  private sortFiles(files: FileEntry[], sortBy: SortField): FileEntry[] {
    const sorted = [...files];
    switch (sortBy) {
      case SortField.Name:
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case SortField.Size:
        return sorted.sort((a, b) => b.size - a.size);
      case SortField.Modified:
        return sorted.sort(
          (a, b) => b.modified.getTime() - a.modified.getTime(),
        );
      case SortField.Extension:
        return sorted.sort((a, b) => a.extension.localeCompare(b.extension));
    }
  }
}

// ============================================================
// 11. 抽象报告器
// ============================================================

abstract class AbstractReporter {
  constructor(protected readonly useColor: boolean = true) {}

  abstract report(result: ScanResult, options: ScanOptions): string;

  protected color(text: string, color: keyof typeof COLORS): string {
    return this.useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
  }

  protected formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = Object.values(SizeUnit);
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

// ============================================================
// 12. 文本报告器
// ============================================================

class TextReporter extends AbstractReporter {
  report(result: ScanResult, options: ScanOptions): string {
    const lines: string[] = [];

    lines.push(this.color("╔══════════════════════════════════════╗", "cyan"));
    lines.push(this.color("║       文件大小统计报告               ║", "cyan"));
    lines.push(this.color("╚══════════════════════════════════════╝", "cyan"));
    lines.push("");

    lines.push(this.color("【基本信息】", "bold"));
    lines.push(`  根目录:   ${result.root}`);
    lines.push(
      `  总大小:   ${this.color(this.formatSize(result.totalSize), "green")}`,
    );
    lines.push(`  文件数:   ${result.fileCount}`);
    lines.push(`  目录数:   ${result.dirCount}`);
    lines.push(`  符号链接: ${result.symlinkCount}`);
    lines.push("");

    lines.push(this.color("【大小分布】", "bold"));
    const distKeys = Object.keys(result.distribution) as DistributionBucket[];
    const maxCount = Math.max(
      ...distKeys.map((k) => result.distribution[k]),
      1,
    );
    for (const bucket of distKeys) {
      const count = result.distribution[bucket];
      const bar = "█".repeat(Math.ceil((count / maxCount) * 30));
      const pct = ((count / Math.max(result.fileCount, 1)) * 100).toFixed(1);
      lines.push(
        `  ${bucket.padEnd(14)} ${this.color(bar, "blue")} ${count} (${pct}%)`,
      );
    }
    lines.push("");

    lines.push(this.color("【扩展名统计】", "bold"));
    const extEntries = Object.entries(result.extensions)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 15);
    for (const [ext, data] of extEntries) {
      const pct = ((data.size / Math.max(result.totalSize, 1)) * 100).toFixed(
        1,
      );
      lines.push(
        `  ${ext.padEnd(12)} ${String(data.count).padStart(6)} 个  ${this.formatSize(data.size).padStart(12)}  (${pct}%)`,
      );
    }
    lines.push("");

    lines.push(this.color("【最大文件 Top 10】", "bold"));
    for (let i = 0; i < Math.min(result.largestFiles.length, 10); i++) {
      const f = result.largestFiles[i];
      lines.push(
        `  ${String(i + 1).padStart(2)}. ${this.color(this.formatSize(f.size), "yellow")}  ${f.path}`,
      );
    }
    lines.push("");

    lines.push(this.color("【目录树】", "bold"));
    this.renderTree(result.tree, "", true, lines, 0, options.maxDepth);
    lines.push("");

    if (result.fileCount > 0 && result.largestFiles.length > 0) {
      const avgSize = result.totalSize / result.fileCount;
      lines.push(this.color("【附加统计】", "bold"));
      lines.push(`  平均文件大小: ${this.formatSize(avgSize)}`);
      lines.push(
        `  最大文件:     ${this.formatSize(result.largestFiles[0].size)}`,
      );
      lines.push(
        `  最小文件:     ${this.formatSize(Math.min(...result.largestFiles.map((f) => f.size)))}`,
      );
    }

    return lines.join("\n");
  }

  private renderTree(
    node: TreeNode,
    prefix: string,
    isLast: boolean,
    lines: string[],
    depth: number,
    maxDepth: number,
  ): void {
    if (depth > maxDepth) return;

    const connector = isLast ? "└── " : "├── ";
    const typeIcon =
      node.type === NodeType.Directory
        ? "📁"
        : node.type === NodeType.Symlink
          ? "🔗"
          : "📄";
    const sizeStr =
      node.type === NodeType.Directory
        ? ` (${this.formatSize(node.size)})`
        : ` [${this.formatSize(node.size)}]`;
    const colorKey: keyof typeof COLORS =
      node.type === NodeType.Directory
        ? "blue"
        : node.type === NodeType.Symlink
          ? "cyan"
          : "dim";

    lines.push(
      `${prefix}${connector}${typeIcon} ${this.color(node.name, colorKey)}${this.color(sizeStr, "dim")}`,
    );

    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const visibleChildren = node.children.slice(0, 20);

    for (let i = 0; i < visibleChildren.length; i++) {
      this.renderTree(
        visibleChildren[i],
        childPrefix,
        i === visibleChildren.length - 1,
        lines,
        depth + 1,
        maxDepth,
      );
    }

    if (node.children.length > 20) {
      lines.push(
        `${childPrefix}└── ${this.color(`... 还有 ${node.children.length - 20} 项`, "dim")}`,
      );
    }
  }
}

// ============================================================
// 13. JSON 报告器
// ============================================================

class JsonReporter extends AbstractReporter {
  report(result: ScanResult, _options: ScanOptions): string {
    return JSON.stringify(result, null, 2);
  }
}

// ============================================================
// 14. 函数重载
// ============================================================

function formatSize(bytes: number): string;
function formatSize(bytes: number, unit: SizeUnit): string;
function formatSize(bytes: number, unit?: SizeUnit): string {
  if (unit !== undefined) {
    return `${(bytes / UNIT_MULTIPLIERS[unit]).toFixed(2)} ${unit}`;
  }
  if (bytes === 0) return "0 B";
  const units = Object.values(SizeUnit);
  let idx = 0;
  let size = bytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  return `${size.toFixed(2)} ${units[idx]}`;
}

// ============================================================
// 15. 生成器 (懒遍历)
// ============================================================

function* walkTree(
  node: TreeNode,
  depth: number = 0,
): Generator<{ node: TreeNode; depth: number }, void, unknown> {
  yield { node, depth };
  for (const child of node.children) {
    yield* walkTree(child, depth + 1);
  }
}

function* iterateFiles(
  entries: readonly FileEntry[],
): Generator<FileEntry, void, unknown> {
  for (const entry of entries) yield entry;
}

// ============================================================
// 16. 参数解析
// ============================================================

function parseArgs(args: string[]): ScanOptions {
  const opts: PartialScan = {
    rootPath: ".",
    maxDepth: 5,
    followSymlinks: false,
    includeHidden: false,
    topN: 10,
    sortBy: SortField.Size,
    format: OutputFormat.Text,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--depth":
      case "-d":
        opts.maxDepth = parseInt(args[++i] ?? "5", 10);
        break;
      case "--top":
      case "-n":
        opts.topN = parseInt(args[++i] ?? "10", 10);
        break;
      case "--sort":
      case "-s": {
        const val = args[++i] ?? "";
        if (isSortField(val)) opts.sortBy = val;
        break;
      }
      case "--format":
      case "-f": {
        const val = args[++i] ?? "";
        if (isOutputFormat(val)) opts.format = val;
        break;
      }
      case "--follow-symlinks":
        opts.followSymlinks = true;
        break;
      case "--include-hidden":
        opts.includeHidden = true;
        break;
      default:
        if (!arg.startsWith("-")) opts.rootPath = arg;
        break;
    }
  }

  return opts as ScanOptions;
}

// ============================================================
// 17. 帮助
// ============================================================

function printHelp(): void {
  console.log(`
Usage: file-stats [options] [path]

Options:
  -d, --depth <n>             最大扫描深度 (默认: 5)
  -n, --top <n>               显示最大文件数量 (默认: 10)
  -s, --sort <field>          排序字段: name|size|modified|extension (默认: size)
  -f, --format <fmt>          输出格式: text|json (默认: text)
      --follow-symlinks       跟随符号链接
      --include-hidden        包含隐藏文件
      --no-color              禁用彩色输出
  -h, --help                  显示帮助

Examples:
  file-stats .
  file-stats /home/user --depth 3 --top 20
  file-stats . --format json
`);
}

// ============================================================
// 18. 主入口
// ============================================================

const SYMBOL_INTERNAL = Symbol("internal");

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const useColor = !process.argv.includes("--no-color");

  try {
    const scanner = new DirectoryScanner();
    const result = scanner.scan(options.rootPath, options);

    const reporter: AbstractReporter =
      options.format === OutputFormat.Json
        ? new JsonReporter(useColor)
        : new TextReporter(useColor);

    console.log(reporter.report(result, options));

    // 使用生成器遍历做额外统计
    let maxDepthFound = 0;
    for (const { depth } of walkTree(result.tree)) {
      if (depth > maxDepthFound) maxDepthFound = depth;
    }
    if (options.format === OutputFormat.Text) {
      console.error(
        `${useColor ? "\x1b[2m" : ""}[verbose] 最大树深度: ${maxDepthFound}${useColor ? "\x1b[0m" : ""}`,
      );
    }
  } catch (err) {
    const msg =
      err instanceof ScanError ? `[${err.code}] ${err.message}` : String(err);
    console.error(`错误: ${msg}`);
    process.exit(1);
  }
}

main();
