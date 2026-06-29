#!/usr/bin/env node
/**
 * 数据备份工具 (Data Backup Tool)
 * 全量/增量/差异备份；自定义归档格式 + zlib 压缩；还原/列出/校验/定时。
 * 仅使用 Node.js 内置模块。
 * 刻意使用大量高级 TS 特性：string enums / 判别联合 / 泛型类与约束 /
 * 抽象类与子类 / 映射类型 / 自定义错误层级 / 只读+可选+索引签名接口 /
 * satisfies / getter+setter / 生成器与迭代器 / Symbol 唯一键 / as const /
 * 类型守卫 / 函数重载。
 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";

/* ----------------------- String Enums ----------------------- */

export enum BackupType {
  Full = "full",
  Incremental = "incremental",
  Differential = "differential",
}

export enum Command {
  Create = "create",
  Incremental = "incremental",
  Differential = "differential",
  Restore = "restore",
  List = "list",
  Verify = "verify",
  Schedule = "schedule",
  Demo = "demo",
}

export enum ErrorCode {
  InvalidArchive = "INVALID_ARCHIVE",
  UnsupportedVersion = "UNSUPPORTED_VERSION",
  HashMismatch = "HASH_MISMATCH",
  NoBaseBackup = "NO_BASE_BACKUP",
  MissingSource = "MISSING_SOURCE",
  MissingArchive = "MISSING_ARCHIVE",
  UnknownCommand = "UNKNOWN_COMMAND",
  DecompressFailed = "DECOMPRESS_FAILED",
}

export enum VerifyResult {
  Valid = "valid",
  Invalid = "invalid",
  Unreadable = "unreadable",
}

export enum ArchiveVersion {
  V1 = 1,
}

/* ----------------------- Constants & `as const` ----------------------- */

const MAGIC = "TSBK" as const;
const VERSION = ArchiveVersion.V1;
const TYPE_FIELD_WIDTH = 12;

/** 归档头各字段字节宽度（只读元组）。 */
const HEADER_WIDTHS = [4, 1, TYPE_FIELD_WIDTH] as const;
const DATA_START = HEADER_WIDTHS[0] + HEADER_WIDTHS[1] + HEADER_WIDTHS[2];

const ARCHIVE_HEADER = {
  magic: MAGIC,
  version: VERSION,
  typeFieldWidth: TYPE_FIELD_WIDTH,
} satisfies {
  magic: string;
  version: ArchiveVersion;
  typeFieldWidth: number;
};

/** Symbol 唯一属性键。 */
const STORE_META = Symbol("store-meta");
const STRATEGY_TAG = Symbol("strategy-tag");

/* ----------------------- Interfaces ----------------------- */

/** 归档中的文件条目（只读）。 */
export interface ArchiveEntry {
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
  readonly mode: number;
  readonly hash: string;
  readonly compressed: boolean;
  readonly offset: number;
}

/** 归档元信息（写入归档尾部），含索引签名以便前向兼容。 */
export interface ArchiveManifest {
  readonly version: ArchiveVersion;
  readonly type: BackupType;
  readonly createdAt: string;
  readonly baseArchive?: string;
  readonly entries: readonly ArchiveEntry[];
  readonly [extra: string]: unknown;
}

/** 文件元信息（用于 manifest 比对）。 */
export interface FileMeta {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
  readonly mode: number;
  readonly hash: string;
}

/** 备份可选项（只读 + 可选 + 索引签名）。 */
export interface BackupOptions {
  readonly type: BackupType;
  readonly baseArchive?: string;
  readonly compress?: boolean;
  readonly [extra: string]: unknown;
}

/* ----------------------- Mapped Types ----------------------- */

/** 去除所有只读修饰符。 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/* ----------------------- Discriminated Unions ----------------------- */

export interface BackupSuccess {
  readonly status: "success";
  readonly manifest: ArchiveManifest;
}
export interface BackupEmpty {
  readonly status: "empty";
  readonly manifest: ArchiveManifest;
}

/** BackupError 既是错误类，也作为联合的 error 成员（通过 status 判别）。 */
export type BackupResult = BackupSuccess | BackupError | BackupEmpty;

export interface VerifyValid {
  readonly status: VerifyResult.Valid;
  readonly errors: readonly string[];
}
export interface VerifyInvalid {
  readonly status: VerifyResult.Invalid;
  readonly errors: readonly string[];
}
export interface VerifyUnreadable {
  readonly status: VerifyResult.Unreadable;
  readonly errors: readonly string[];
}
export type VerifyOutcome = VerifyValid | VerifyInvalid | VerifyUnreadable;

/* ----------------------- Custom Error Hierarchy ----------------------- */

/** 所有备份相关错误的基类，携带机器可读 code 与判别字段 status。 */
export class BackupError extends Error {
  readonly code: ErrorCode;
  readonly status = "error" as const;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

export class ArchiveError extends BackupError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "ArchiveError";
  }
}

export class VerifyError extends BackupError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "VerifyError";
  }
}

/* ----------------------- Type Guards ----------------------- */

export function isBackupSuccess(r: BackupResult): r is BackupSuccess {
  return r.status === "success";
}

export function isBackupError(r: BackupResult): r is BackupError {
  return r.status === "error";
}

export function isFileMeta(x: unknown): x is FileMeta {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.path === "string" &&
    typeof m.hash === "string" &&
    typeof m.size === "number"
  );
}

/* ----------------------- Core Utilities ----------------------- */

/** 计算文件 SHA-256。 */
function fileHash(file: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

/** 递归收集目录下所有文件。 */
export function collectFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** 计算文件元信息。 */
export function fileMeta(root: string, file: string): FileMeta {
  const st = fs.statSync(file);
  const rel = path.relative(root, file).replace(/\\/g, "/");
  return {
    path: rel,
    size: st.size,
    mtime: st.mtimeMs,
    mode: st.mode,
    hash: fileHash(file),
  };
}

/** 迭代 manifest 中的条目（生成器）。 */
export function* iterateManifest(
  manifest: ArchiveManifest,
): Generator<ArchiveEntry> {
  for (const e of manifest.entries) yield e;
}

/* ----------------------- Generic ArchiveStore ----------------------- */

/**
 * 泛型归档存储，约束 T 必须是 ArchiveEntry（或其子类型）。
 * 演示：泛型约束、getter/setter、Symbol 唯一键、生成器迭代器。
 */
export class ArchiveStore<T extends ArchiveEntry> {
  private readonly _entries: T[];
  private _compress: boolean;
  [STORE_META]: { readonly createdAt: string };

  constructor(entries: readonly T[] = [], compress = false) {
    this._entries = [...entries];
    this._compress = compress;
    this[STORE_META] = { createdAt: new Date().toISOString() };
  }

  get count(): number {
    return this._entries.length;
  }

  get compress(): boolean {
    return this._compress;
  }

  set compress(value: boolean) {
    this._compress = value;
  }

  get createdAt(): string {
    return this[STORE_META].createdAt;
  }

  add(entry: T): void {
    this._entries.push(entry);
  }

  at(index: number): T | undefined {
    return this._entries[index];
  }

  toArray(): T[] {
    return [...this._entries];
  }

  /** 生成器迭代器，使 store 可被 for...of 消费。 */
  *[Symbol.iterator](): Generator<T> {
    for (const e of this._entries) yield e;
  }
}

/* ----------------------- Archive Read/Write ----------------------- */

/** 写入归档（自定义格式）。 */
export function writeArchive(
  outFile: string,
  root: string,
  files: readonly FileMeta[],
  opts: BackupOptions = { type: BackupType.Full },
): ArchiveManifest {
  const compress = opts.compress ?? false;
  const entries: ArchiveEntry[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const full = path.join(root, f.path);
    let content: Buffer = fs.readFileSync(full);
    let compressed = false;
    if (compress) {
      const z = zlib.gzipSync(content);
      if (z.length < content.length) {
        content = z;
        compressed = true;
      }
    }
    // 使用 Mutable<ArchiveEntry> 构造可变条目后再放入只读数组。
    const entry: Mutable<ArchiveEntry> = {
      name: f.path,
      size: content.length,
      mtime: f.mtime,
      mode: f.mode,
      hash: f.hash,
      compressed,
      offset,
    };
    entries.push(entry);
    chunks.push(content);
    offset += content.length;
  }

  const fd = fs.openSync(outFile, "w");
  let pos = 0;
  const writeBuf = (b: Buffer) => {
    fs.writeSync(fd, b, 0, b.length, pos);
    pos += b.length;
  };
  writeBuf(Buffer.from(ARCHIVE_HEADER.magic, "utf8"));
  writeBuf(Buffer.from([ARCHIVE_HEADER.version]));
  writeBuf(
    Buffer.from(opts.type.padEnd(ARCHIVE_HEADER.typeFieldWidth, "\0"), "utf8"),
  );
  for (const c of chunks) writeBuf(c);

  const manifest: ArchiveManifest = {
    version: VERSION,
    type: opts.type,
    createdAt: new Date().toISOString(),
    baseArchive: opts.baseArchive,
    entries,
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64BE(BigInt(manifestBuf.length), 0);
  writeBuf(manifestBuf);
  writeBuf(sizeBuf);
  writeBuf(Buffer.from(MAGIC, "utf8"));
  fs.closeSync(fd);
  return manifest;
}

/** 读取归档 manifest。 */
export function readManifest(file: string): ArchiveManifest {
  const fd = fs.openSync(file, "r");
  const st = fs.statSync(file);
  const tail = Buffer.alloc(12);
  fs.readSync(fd, tail, 0, 12, st.size - 12);
  const magic = tail.slice(8, 12).toString("utf8");
  if (magic !== MAGIC) {
    throw new ArchiveError(
      ErrorCode.InvalidArchive,
      "归档格式错误（尾部 magic 不匹配）",
    );
  }
  const manifestSize = Number(tail.readBigUInt64BE(0));
  const manifestBuf = Buffer.alloc(manifestSize);
  fs.readSync(fd, manifestBuf, 0, manifestSize, st.size - 12 - manifestSize);
  fs.closeSync(fd);
  return JSON.parse(manifestBuf.toString("utf8")) as ArchiveManifest;
}

/** 读取归档头部信息。 */
function readHeader(file: string): {
  magic: string;
  version: number;
  type: string;
} {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(4 + 1 + 12);
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return {
    magic: buf.toString("utf8", 0, 4),
    version: buf[4],
    type: buf.toString("utf8", 5, 17).replace(/\0+$/, ""),
  };
}

/** 列出归档内容。 */
export function listArchive(file: string): ArchiveManifest {
  const header = readHeader(file);
  if (header.magic !== MAGIC) {
    throw new ArchiveError(ErrorCode.InvalidArchive, "不是有效的归档文件");
  }
  if (header.version !== VERSION) {
    throw new ArchiveError(
      ErrorCode.UnsupportedVersion,
      `不支持的版本: ${header.version}`,
    );
  }
  return readManifest(file);
}

/** 提取归档中的某个文件。 */
export function extractFile(
  archiveFile: string,
  entry: ArchiveEntry,
  destDir: string,
): void {
  const fd = fs.openSync(archiveFile, "r");
  const buf = Buffer.alloc(entry.size);
  fs.readSync(fd, buf, 0, entry.size, DATA_START + entry.offset);
  fs.closeSync(fd);
  let content: Buffer = buf;
  if (entry.compressed) content = zlib.gunzipSync(buf);
  const out = path.join(destDir, entry.name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  fs.chmodSync(out, entry.mode & 0o777);
  fs.utimesSync(out, entry.mtime / 1000, entry.mtime / 1000);
}

/** 还原整个归档。 */
export function restoreArchive(archiveFile: string, destDir: string): number {
  const manifest = readManifest(archiveFile);
  for (const e of iterateManifest(manifest)) {
    extractFile(archiveFile, e, destDir);
  }
  return manifest.entries.length;
}

/** 校验归档（hash 比对），返回判别联合。 */
export function verifyArchive(archiveFile: string): VerifyOutcome {
  let manifest: ArchiveManifest;
  try {
    manifest = readManifest(archiveFile);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: VerifyResult.Unreadable,
      errors: [`无法读取 manifest: ${msg}`],
    };
  }
  const errors: string[] = [];
  const fd = fs.openSync(archiveFile, "r");
  for (const e of iterateManifest(manifest)) {
    const buf = Buffer.alloc(e.size);
    fs.readSync(fd, buf, 0, e.size, DATA_START + e.offset);
    let content: Buffer = buf;
    if (e.compressed) {
      try {
        content = zlib.gunzipSync(buf);
      } catch {
        errors.push(`${e.name}: 解压失败`);
        continue;
      }
    }
    const h = crypto.createHash("sha256").update(content).digest("hex");
    if (h !== e.hash) errors.push(`${e.name}: 哈希不匹配`);
  }
  fs.closeSync(fd);
  return errors.length === 0
    ? { status: VerifyResult.Valid, errors }
    : { status: VerifyResult.Invalid, errors };
}

/* ----------------------- Backup Strategies (Abstract Class) ----------------------- */

/** 备份策略抽象基类。 */
export abstract class AbstractBackupStrategy {
  abstract readonly type: BackupType;
  protected readonly [STRATEGY_TAG] = true;
  abstract collect(src: string, base: ArchiveManifest | null): FileMeta[];

  execute(
    src: string,
    outFile: string,
    compress: boolean,
    baseArchive?: string,
  ): ArchiveManifest {
    const base = baseArchive ? readManifest(baseArchive) : null;
    const metas = this.collect(src, base);
    return writeArchive(outFile, src, metas, {
      type: this.type,
      baseArchive,
      compress,
    });
  }
}

export class FullBackupStrategy extends AbstractBackupStrategy {
  readonly type = BackupType.Full;
  collect(src: string): FileMeta[] {
    return collectFiles(src).map((f) => fileMeta(src, f));
  }
}

export class IncrementalBackupStrategy extends AbstractBackupStrategy {
  readonly type = BackupType.Incremental;
  collect(src: string, base: ArchiveManifest | null): FileMeta[] {
    return diffMetas(src, base);
  }
}

export class DifferentialBackupStrategy extends AbstractBackupStrategy {
  readonly type = BackupType.Differential;
  collect(src: string, base: ArchiveManifest | null): FileMeta[] {
    return diffMetas(src, base);
  }
}

/** 计算相对于 base 的变更文件。 */
function diffMetas(src: string, base: ArchiveManifest | null): FileMeta[] {
  const baseMap = new Map<string, FileMeta>();
  if (base) {
    for (const e of base.entries) {
      baseMap.set(e.name, {
        path: e.name,
        size: e.size,
        mtime: e.mtime,
        mode: e.mode,
        hash: e.hash,
      });
    }
  }
  const metas = collectFiles(src).map((f) => fileMeta(src, f));
  return metas.filter((m) => {
    const b = baseMap.get(m.path);
    return !b || b.hash !== m.hash;
  });
}

/** 用策略执行备份并包装为判别联合结果。 */
export function tryBackup(
  strategy: AbstractBackupStrategy,
  src: string,
  outFile: string,
  compress: boolean,
  baseArchive?: string,
): BackupResult {
  try {
    const manifest = strategy.execute(src, outFile, compress, baseArchive);
    if (manifest.entries.length === 0) {
      return { status: "empty" as const, manifest };
    }
    return { status: "success" as const, manifest };
  } catch (e) {
    if (e instanceof BackupError) return e;
    return new BackupError(
      ErrorCode.UnknownCommand,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/* ----------------------- Public Backup API ----------------------- */

/** 创建全量备份。 */
export function createFullBackup(
  src: string,
  outFile: string,
  compress = false,
): ArchiveManifest {
  return new FullBackupStrategy().execute(src, outFile, compress);
}

/** 创建增量/差异备份。 */
export function createBackup(
  src: string,
  outFile: string,
  baseArchive: string,
  mode: BackupType,
  compress = false,
): ArchiveManifest {
  const strategy =
    mode === BackupType.Incremental
      ? new IncrementalBackupStrategy()
      : new DifferentialBackupStrategy();
  return strategy.execute(src, outFile, compress, baseArchive);
}

/** 找到最近的全量备份（基于文件名约定）。 */
export function findLatestFullBackup(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tbk"));
  let latest: string | null = null;
  let latestTime = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const header = readHeader(full);
      if (header.type !== BackupType.Full) continue;
      const st = fs.statSync(full);
      if (st.mtimeMs > latestTime) {
        latestTime = st.mtimeMs;
        latest = full;
      }
    } catch {
      // 跳过无效归档
    }
  }
  return latest;
}

/* ----------------------- CLI Helpers (Function Overloads) ----------------------- */

function getOpt(args: string[], name: string): string | undefined;
function getOpt(args: string[], name: string, fallback: string): string;
function getOpt(
  args: string[],
  name: string,
  fallback?: string,
): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return fallback;
}

function hasOpt(args: string[], name: string): boolean {
  return args.includes(name);
}

/* ----------------------- CLI ----------------------- */

async function main(): Promise<void> {
  const [, , rawCmd, ...rest] = process.argv;
  const cmd = rawCmd as Command;
  if (!rawCmd) {
    console.log(`数据备份工具 CLI
用法:
  create <src> [-o archive] [--compress]            全量备份
  incremental <src> [-o archive] [--compress]       增量备份（基于最近全量）
  differential <src> [-o archive] [--compress]      差异备份
  restore <archive> [-d dest]                       还原
  list <archive>                                    列出内容
  verify <archive>                                  校验完整性
  schedule <src> <intervalSeconds>                  定时备份
  demo                                              运行演示`);
    return;
  }

  switch (cmd) {
    case Command.Create: {
      const [src] = rest;
      if (!src) throw new BackupError(ErrorCode.MissingSource, "缺少源路径");
      const out =
        getOpt(rest, "-o") ??
        path.join(process.cwd(), `backup-${Date.now()}.tbk`);
      const compress = hasOpt(rest, "--compress");
      const result = tryBackup(new FullBackupStrategy(), src, out, compress);
      if (isBackupError(result)) throw result;
      console.log(`全量备份完成: ${out}`);
      console.log(
        `文件数: ${result.manifest.entries.length}, 类型: ${result.manifest.type}`,
      );
      break;
    }
    case Command.Incremental:
    case Command.Differential: {
      const [src] = rest;
      if (!src) throw new BackupError(ErrorCode.MissingSource, "缺少源路径");
      const out =
        getOpt(rest, "-o") ??
        path.join(process.cwd(), `backup-${cmd}-${Date.now()}.tbk`);
      const compress = hasOpt(rest, "--compress");
      const dir = path.dirname(out);
      const base = findLatestFullBackup(dir);
      if (!base) {
        console.log("未找到全量备份，将创建全量备份");
        const result = tryBackup(new FullBackupStrategy(), src, out, compress);
        if (isBackupError(result)) throw result;
        console.log(
          `全量备份完成: ${out} (${result.manifest.entries.length} 个文件)`,
        );
        break;
      }
      const strategy =
        cmd === Command.Incremental
          ? new IncrementalBackupStrategy()
          : new DifferentialBackupStrategy();
      const result = tryBackup(strategy, src, out, compress, base);
      if (isBackupError(result)) throw result;
      console.log(`${cmd} 备份完成: ${out}`);
      console.log(`文件数: ${result.manifest.entries.length}, 基准: ${base}`);
      break;
    }
    case Command.Restore: {
      const [archive] = rest;
      if (!archive)
        throw new BackupError(ErrorCode.MissingArchive, "缺少归档文件");
      const dest = getOpt(rest, "-d") ?? path.join(process.cwd(), "restored");
      const n = restoreArchive(archive, dest);
      console.log(`还原 ${n} 个文件到 ${dest}`);
      break;
    }
    case Command.List: {
      const [archive] = rest;
      if (!archive)
        throw new BackupError(ErrorCode.MissingArchive, "缺少归档文件");
      const m = listArchive(archive);
      console.log(`类型: ${m.type}, 创建于: ${m.createdAt}`);
      if (m.baseArchive) console.log(`基准: ${m.baseArchive}`);
      console.log(`文件数: ${m.entries.length}`);
      console.log(
        "名称                                        大小      压缩  修改时间",
      );
      const store = new ArchiveStore<ArchiveEntry>(m.entries);
      for (const e of store) {
        console.log(
          `${e.name.padEnd(42)} ${String(e.size).padStart(8)} ${e.compressed ? "  是" : "  否"}  ${new Date(e.mtime).toISOString()}`,
        );
      }
      break;
    }
    case Command.Verify: {
      const [archive] = rest;
      if (!archive)
        throw new BackupError(ErrorCode.MissingArchive, "缺少归档文件");
      const r = verifyArchive(archive);
      if (r.status === VerifyResult.Valid) {
        console.log("校验通过：所有文件哈希匹配");
      } else if (r.status === VerifyResult.Unreadable) {
        console.log("无法读取归档:");
        for (const e of r.errors) console.log("  " + e);
      } else {
        console.log("校验失败:");
        for (const e of r.errors) console.log("  " + e);
      }
      break;
    }
    case Command.Schedule: {
      const [src, intervalStr] = rest;
      if (!src || !intervalStr) {
        throw new BackupError(
          ErrorCode.MissingSource,
          "用法: schedule <src> <intervalSeconds>",
        );
      }
      const interval = parseInt(intervalStr, 10) * 1000;
      const outDir = path.join(process.cwd(), "backups");
      fs.mkdirSync(outDir, { recursive: true });
      console.log(
        `开始定时备份：源=${src}, 间隔=${intervalStr}s, 输出=${outDir}`,
      );
      console.log("按 Ctrl+C 停止");
      let round = 0;
      const run = () => {
        round++;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outFile = path.join(outDir, `backup-${stamp}.tbk`);
        const base = findLatestFullBackup(outDir);
        try {
          let m: ArchiveManifest;
          if (!base || round % 5 === 1) {
            m = createFullBackup(src, outFile, false);
            console.log(
              `[${new Date().toISOString()}] 全量备份 #${round}: ${m.entries.length} 文件`,
            );
          } else {
            m = createBackup(src, outFile, base, BackupType.Incremental, false);
            console.log(
              `[${new Date().toISOString()}] 增量备份 #${round}: ${m.entries.length} 文件`,
            );
          }
        } catch (e) {
          console.error(`备份失败: ${(e as Error).message}`);
        }
      };
      run();
      setInterval(run, interval);
      await new Promise<void>(() => {});
      break;
    }
    case Command.Demo: {
      const demoDir = path.join(process.cwd(), "demo-src");
      fs.mkdirSync(path.join(demoDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(demoDir, "a.txt"), "Hello Backup");
      fs.writeFileSync(path.join(demoDir, "b.txt"), "Second file");
      fs.writeFileSync(path.join(demoDir, "sub", "c.txt"), "Nested file");
      const archive = path.join(process.cwd(), "demo-full.tbk");
      console.log("=== 创建全量备份（含压缩） ===");
      const m1 = createFullBackup(demoDir, archive, true);
      console.log(`文件数: ${m1.entries.length}`);
      console.log("\n=== 列出归档 ===");
      const listed = listArchive(archive);
      for (const e of listed.entries) {
        console.log(`  ${e.name} (${e.size} bytes, 压缩=${e.compressed})`);
      }
      console.log("\n=== 校验 ===");
      const v = verifyArchive(archive);
      console.log(
        v.status === VerifyResult.Valid
          ? "校验通过"
          : "校验失败: " + v.errors.join(", "),
      );
      fs.writeFileSync(path.join(demoDir, "a.txt"), "Hello Backup MODIFIED");
      fs.writeFileSync(path.join(demoDir, "d.txt"), "New file");
      const incArchive = path.join(process.cwd(), "demo-inc.tbk");
      console.log("\n=== 创建增量备份 ===");
      const m2 = createBackup(
        demoDir,
        incArchive,
        archive,
        BackupType.Incremental,
        true,
      );
      console.log(`变更文件数: ${m2.entries.length}`);
      const restoreDir = path.join(process.cwd(), "demo-restored");
      console.log("\n=== 还原全量备份 ===");
      restoreArchive(archive, restoreDir);
      console.log(
        "还原后 a.txt:",
        fs.readFileSync(path.join(restoreDir, "a.txt"), "utf8"),
      );
      console.log("\n=== 应用增量备份 ===");
      restoreArchive(incArchive, restoreDir);
      console.log(
        "应用后 a.txt:",
        fs.readFileSync(path.join(restoreDir, "a.txt"), "utf8"),
      );
      console.log(
        "应用后 d.txt:",
        fs.readFileSync(path.join(restoreDir, "d.txt"), "utf8"),
      );
      break;
    }
    default:
      throw new BackupError(ErrorCode.UnknownCommand, `未知命令: ${rawCmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
