#!/usr/bin/env node
/**
 * 文件操作工具库 (File Utils) - Enhanced TypeScript Edition
 * -------------------------------------------------------------
 * 基于 fs 的高级文件操作函数集合,展示枚举 / 可辨识联合 / 泛型类 /
 * 抽象类 / 映射类型 / 自定义错误 / satisfies / 生成器 / Symbol /
 * as const / 类型守卫 / 函数重载等高级 TypeScript 特性。
 *
 * 公开 API:
 *   - JSON/行/CSV: readJson, writeJson, readLines, writeLines, readCsv, writeCsv
 *   - 目录:  ensureDir, ensureFile, copyDir, removeDir, moveDir, emptyDir, pathExists
 *   - 临时:  tempFile, tempDir
 *   - 哈希:  fileHash (overloaded), fileEquals
 *   - 遍历:  walkDir (async generator), SyncWalker, AsyncWalker
 *   - 其他:  globMatch, atomicWrite, watch (防抖), FileStore<T extends FileEntry>
 *
 * 仅依赖 Node.js 内置模块: fs, path, os, crypto.
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

// ============ 枚举 String Enums ============

export enum FileOperation {
  Copy = "copy",
  Move = "move",
  Delete = "delete",
  Read = "read",
  Write = "write",
  Walk = "walk",
  Watch = "watch",
  Hash = "hash",
}

export enum ErrorCode {
  NotFound = "NOT_FOUND",
  Permission = "PERMISSION_DENIED",
  AlreadyExists = "ALREADY_EXISTS",
  InvalidArgument = "INVALID_ARGUMENT",
  IOFailure = "IO_FAILURE",
  Unknown = "UNKNOWN",
}

export enum EntryType {
  File = "file",
  Directory = "directory",
  Symlink = "symlink",
  Other = "other",
}

export enum WatchEvent {
  Change = "change",
  Rename = "rename",
}

// ============ Symbol 唯一属性键 ============

const STORE_ENTRIES = Symbol("storeEntries");
const STORE_LIMIT = Symbol("storeLimit");

// ============ 接口 Interfaces (readonly / optional / index signature) ============

export interface WalkEntry {
  readonly path: string;
  readonly relative: string;
  readonly type: EntryType;
  readonly size: number;
  readonly mtime: Date;
}

export interface FileEntry {
  readonly path: string;
  readonly size: number;
  readonly mtime: Date;
}

export interface WatchOptions {
  readonly debounceMs?: number;
  readonly recursive?: boolean;
  readonly ignore?: readonly string[];
  [key: string]: unknown;
}

interface CsvOptions {
  readonly delimiter?: string;
  readonly header?: boolean;
}

interface WalkOptions {
  readonly maxDepth?: number;
}

// ============ 映射类型 Mapped Types ============

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ============ 自定义错误 Error Hierarchy ============

export class FileError extends Error {
  readonly code: ErrorCode;
  readonly operation: FileOperation;
  constructor(code: ErrorCode, operation: FileOperation, message: string) {
    super(message);
    this.name = "FileError";
    this.code = code;
    this.operation = operation;
  }
}

export class FileNotFoundError extends FileError {
  constructor(p: string, op: FileOperation) {
    super(ErrorCode.NotFound, op, `Path not found: ${p}`);
    this.name = "FileNotFoundError";
  }
}

export class FileIOError extends FileError {
  readonly innerError?: Error;
  constructor(op: FileOperation, message: string, innerError?: Error) {
    super(ErrorCode.IOFailure, op, message);
    this.name = "FileIOError";
    this.innerError = innerError;
  }
}

// ============ 可辨识联合 Discriminated Unions ============

export interface OpSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly operation: FileOperation;
}

export interface OpError {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly message: string;
  readonly operation: FileOperation;
}

export interface OpSkipped {
  readonly ok: "skipped";
  readonly reason: string;
  readonly operation: FileOperation;
}

export type OpResult<T> = OpSuccess<T> | OpError | OpSkipped;

// ============ 类型守卫 Type Guards ============

export function isOpSuccess<T>(r: OpResult<T>): r is OpSuccess<T> {
  return r.ok === true;
}

export function isOpError(r: OpResult<unknown>): r is OpError {
  return r.ok === false;
}

export function isOpSkipped(r: OpResult<unknown>): r is OpSkipped {
  return r.ok === "skipped";
}

export function isFileEntry(
  e: WalkEntry,
): e is WalkEntry & { type: EntryType.File } {
  return e.type === EntryType.File;
}

export function isDirEntry(
  e: WalkEntry,
): e is WalkEntry & { type: EntryType.Directory } {
  return e.type === EntryType.Directory;
}

// ============ as const 断言 / Hash Algo ============

export const HASH_ALGOS = ["md5", "sha1", "sha256", "sha512"] as const;
export type HashAlgo = (typeof HASH_ALGOS)[number];

export function isHashAlgo(s: string): s is HashAlgo {
  return (HASH_ALGOS as readonly string[]).includes(s);
}

type JsonSchemaValidator = (data: unknown) => Error | null;

// ============ 存在与目录 Existence & Directory ============

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export async function ensureFile(file: string): Promise<void> {
  await ensureDir(path.dirname(file));
  if (!(await pathExists(file))) {
    await fs.promises.writeFile(file, "");
  }
}

export async function emptyDir(dir: string): Promise<void> {
  if (!(await pathExists(dir))) {
    await ensureDir(dir);
    return;
  }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeDir(full);
    } else {
      await fs.promises.unlink(full);
    }
  }
}

export async function removeDir(dir: string): Promise<void> {
  if (!(await pathExists(dir))) return;
  await fs.promises.rm(dir, { recursive: true, force: true });
}

export async function copyDir(
  src: string,
  dst: string,
): Promise<OpResult<number>> {
  try {
    if (!(await pathExists(src))) {
      return {
        ok: false,
        code: ErrorCode.NotFound,
        message: `源目录不存在: ${src}`,
        operation: FileOperation.Copy,
      };
    }
    await ensureDir(dst);
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        const sub = await copyDir(s, d);
        if (isOpSuccess(sub)) count += sub.value;
      } else if (entry.isSymbolicLink()) {
        const link = await fs.promises.readlink(s);
        await fs.promises.symlink(link, d);
        count++;
      } else {
        await fs.promises.copyFile(s, d);
        count++;
      }
    }
    return { ok: true, value: count, operation: FileOperation.Copy };
  } catch (e) {
    return {
      ok: false,
      code: ErrorCode.IOFailure,
      message: (e as Error).message,
      operation: FileOperation.Copy,
    };
  }
}

export async function moveDir(src: string, dst: string): Promise<void> {
  await ensureDir(path.dirname(dst));
  await fs.promises.rename(src, dst);
}

// ============ JSON ============

export async function readJson(
  file: string,
  validator?: JsonSchemaValidator,
): Promise<unknown> {
  const content = await fs.promises.readFile(file, "utf8");
  const data = JSON.parse(content);
  if (validator) {
    const err = validator(data);
    if (err) throw err;
  }
  return data;
}

export async function writeJson(
  file: string,
  data: unknown,
  pretty = true,
): Promise<void> {
  await ensureDir(path.dirname(file));
  const content = JSON.stringify(data, null, pretty ? 2 : 0);
  await fs.promises.writeFile(file, content, "utf8");
}

export function readJsonSync(
  file: string,
  validator?: JsonSchemaValidator,
): unknown {
  const content = fs.readFileSync(file, "utf8");
  const data = JSON.parse(content);
  if (validator) {
    const err = validator(data);
    if (err) throw err;
  }
  return data;
}

export function writeJsonSync(
  file: string,
  data: unknown,
  pretty = true,
): void {
  ensureDirSync(path.dirname(file));
  const content = JSON.stringify(data, null, pretty ? 2 : 0);
  fs.writeFileSync(file, content, "utf8");
}

// ============ 行 Lines ============

export async function readLines(
  file: string,
  encoding: BufferEncoding = "utf8",
): Promise<string[]> {
  const content = await fs.promises.readFile(file, encoding);
  return content.split(/\r?\n/);
}

export async function writeLines(
  file: string,
  lines: string[],
  eol = "\n",
): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.promises.writeFile(file, lines.join(eol), "utf8");
}

// ============ CSV ============

export async function readCsv(
  file: string,
  options: CsvOptions = {},
): Promise<string[][]> {
  const delim = options.delimiter ?? ",";
  const content = await fs.promises.readFile(file, "utf8");
  return parseCsv(content, delim);
}

function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // 忽略 \r
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function writeCsv(
  file: string,
  rows: string[][],
  delimiter = ",",
): Promise<void> {
  await ensureDir(path.dirname(file));
  const content = rows
    .map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter))
    .join("\n");
  await fs.promises.writeFile(file, content + "\n", "utf8");
}

function csvEscape(cell: string, delim: string): string {
  if (cell.includes(delim) || cell.includes('"') || cell.includes("\n")) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

// ============ 临时文件 Temp Files ============

export async function tempFile(ext = ".tmp", prefix = "fu-"): Promise<string> {
  const name = prefix + crypto.randomBytes(8).toString("hex") + ext;
  const file = path.join(os.tmpdir(), name);
  await fs.promises.writeFile(file, "");
  return file;
}

export async function tempDir(prefix = "fu-"): Promise<string> {
  const name = prefix + crypto.randomBytes(8).toString("hex");
  const dir = path.join(os.tmpdir(), name);
  await ensureDir(dir);
  return dir;
}

// ============ 哈希 Hash (函数重载 overloads) ============

export async function fileHash(file: string): Promise<string>;
export async function fileHash(file: string, algo: HashAlgo): Promise<string>;
export async function fileHash(file: string, algo?: HashAlgo): Promise<string> {
  const hash = crypto.createHash(algo ?? "sha256");
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function fileEquals(
  fileA: string,
  fileB: string,
  algo: "md5" | "sha256" = "md5",
): Promise<boolean> {
  const [a, b] = await Promise.all([
    fileHash(fileA, algo),
    fileHash(fileB, algo),
  ]);
  return a === b;
}

// ============ Walk: 抽象类 + 具体子类 ============

export abstract class AbstractFileWalker {
  protected readonly root: string;
  readonly maxDepth: number;

  constructor(root: string, maxDepth: number = Infinity) {
    this.root = root;
    this.maxDepth = maxDepth;
  }

  abstract walk(): AsyncGenerator<WalkEntry> | Generator<WalkEntry>;

  protected entryType(dirent: fs.Dirent): EntryType {
    if (dirent.isFile()) return EntryType.File;
    if (dirent.isDirectory()) return EntryType.Directory;
    if (dirent.isSymbolicLink()) return EntryType.Symlink;
    return EntryType.Other;
  }

  protected shouldRecurse(type: EntryType, depth: number): boolean {
    return type === EntryType.Directory && depth + 1 < this.maxDepth;
  }
}

export class SyncWalker extends AbstractFileWalker {
  *walk(): Generator<WalkEntry> {
    yield* this.walkInner(this.root, this.root, 0);
  }

  private *walkInner(
    dir: string,
    root: string,
    depth: number,
  ): Generator<WalkEntry> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      const stat = fs.statSync(full);
      const type = this.entryType(entry);
      yield {
        path: full,
        relative: rel,
        type,
        size: stat.size,
        mtime: stat.mtime,
      };
      if (this.shouldRecurse(type, depth)) {
        yield* this.walkInner(full, root, depth + 1);
      }
    }
  }
}

export class AsyncWalker extends AbstractFileWalker {
  async *walk(): AsyncGenerator<WalkEntry> {
    yield* this.walkInner(this.root, this.root, 0);
  }

  private async *walkInner(
    dir: string,
    root: string,
    depth: number,
  ): AsyncGenerator<WalkEntry> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      const stat = await fs.promises.stat(full);
      const type = this.entryType(entry);
      yield {
        path: full,
        relative: rel,
        type,
        size: stat.size,
        mtime: stat.mtime,
      };
      if (this.shouldRecurse(type, depth)) {
        yield* this.walkInner(full, root, depth + 1);
      }
    }
  }
}

export async function* walkDir(
  dir: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkEntry> {
  const walker = new AsyncWalker(dir, options.maxDepth ?? Infinity);
  yield* walker.walk();
}

// ============ Glob ============

export function globMatch(pattern: string, target: string): boolean {
  const regexStr =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/{{GLOBSTAR}}/g, ".*") +
    "$";
  return new RegExp(regexStr).test(target.replace(/\\/g, "/"));
}

// ============ 原子写入 Atomic Write ============

export async function atomicWrite(
  file: string,
  data: string | Buffer,
): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = file + ".tmp." + crypto.randomBytes(4).toString("hex");
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
}

// ============ 防抖监视 Watch (satisfies) ============

const DEFAULT_WATCH_OPTIONS = {
  debounceMs: 200,
  recursive: true,
} satisfies WatchOptions;

export function watch(
  dir: string,
  callback: (event: WatchEvent, filename: string | null) => void,
  options: WatchOptions = {},
): fs.FSWatcher {
  const debounce = options.debounceMs ?? DEFAULT_WATCH_OPTIONS.debounceMs;
  const timers = new Map<string, NodeJS.Timeout>();
  const watcher = fs.watch(
    dir,
    { recursive: options.recursive ?? DEFAULT_WATCH_OPTIONS.recursive },
    (event, filename) => {
      const key = `${event}:${filename}`;
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.delete(key);
        callback(event as WatchEvent, filename);
      }, debounce);
      timers.set(key, timer);
    },
  );
  return watcher;
}

// ============ 泛型类 Generic FileStore<T extends FileEntry> ============

export class FileStore<T extends FileEntry> {
  private readonly [STORE_ENTRIES]: Map<string, T> = new Map();
  private [STORE_LIMIT]: number = Infinity;
  readonly createdAt: Date = new Date();

  constructor(entries: Iterable<T> = []) {
    for (const e of entries) this.add(e);
  }

  get count(): number {
    return this[STORE_ENTRIES].size;
  }

  get limit(): number {
    return this[STORE_LIMIT];
  }

  set limit(v: number) {
    if (!Number.isFinite(v) || v < 0) {
      throw new FileError(
        ErrorCode.InvalidArgument,
        FileOperation.Write,
        `limit must be non-negative finite, got: ${v}`,
      );
    }
    this[STORE_LIMIT] = v;
  }

  add(entry: T): void {
    if (this[STORE_ENTRIES].size >= this[STORE_LIMIT]) {
      throw new FileError(
        ErrorCode.AlreadyExists,
        FileOperation.Write,
        `store reached limit ${this[STORE_LIMIT]}`,
      );
    }
    this[STORE_ENTRIES].set(entry.path, entry);
  }

  get(p: string): T | undefined {
    return this[STORE_ENTRIES].get(p);
  }

  remove(p: string): boolean {
    return this[STORE_ENTRIES].delete(p);
  }

  *values(): Generator<T> {
    yield* this[STORE_ENTRIES].values();
  }

  filter(predicate: (e: T) => boolean): T[] {
    const out: T[] = [];
    for (const e of this[STORE_ENTRIES].values()) {
      if (predicate(e)) out.push(e);
    }
    return out;
  }

  toMutableArray(): Mutable<T>[] {
    const out: Mutable<T>[] = [];
    for (const e of this[STORE_ENTRIES].values()) {
      out.push({ ...e } as Mutable<T>);
    }
    return out;
  }
}

// ===================== CLI 演示 =====================

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "copy": {
      const src = process.argv[3];
      const dst = process.argv[4];
      if (!src || !dst) {
        console.log("用法: copy <src> <dst>");
        return;
      }
      console.log(`复制目录 ${src} -> ${dst}`);
      const result = await copyDir(src, dst);
      if (isOpSuccess(result)) {
        console.log(`完成, 共复制 ${result.value} 个条目。`);
      } else if (isOpError(result)) {
        console.log(`失败 [${result.code}]: ${result.message}`);
      } else {
        console.log(`跳过: ${result.reason}`);
      }
      break;
    }
    case "walk": {
      const dir = process.argv[3];
      if (!dir) {
        console.log("用法: walk <dir>");
        return;
      }
      if (!(await pathExists(dir))) {
        console.log(`目录不存在: ${dir}`);
        return;
      }
      console.log(`遍历 ${dir}:`);
      let count = 0;
      let totalSize = 0;
      for await (const entry of walkDir(dir)) {
        const indent =
          "  " + "  ".repeat(entry.relative.split(path.sep).length - 1);
        const tag = entry.type === EntryType.Directory ? "[D]" : "   ";
        const size =
          entry.type === EntryType.File ? ` (${formatBytes(entry.size)})` : "";
        console.log(`${indent}${tag} ${entry.relative}${size}`);
        count++;
        if (entry.type === EntryType.File) totalSize += entry.size;
      }
      console.log(`\n共 ${count} 个条目, 文件总大小 ${formatBytes(totalSize)}`);
      break;
    }
    case "hash": {
      const file = process.argv[3];
      const algoFlag = process.argv.indexOf("-a");
      const rawAlgo = algoFlag >= 0 ? process.argv[algoFlag + 1] : "sha256";
      if (!file) {
        console.log("用法: hash <file> [-a algo]");
        return;
      }
      const algo: HashAlgo = isHashAlgo(rawAlgo) ? rawAlgo : "sha256";
      const hash = await fileHash(file, algo);
      console.log(`${algo}: ${hash}`);
      break;
    }
    case "json": {
      const file = process.argv[3];
      const key = process.argv[4];
      if (!file) {
        console.log("用法: json <file> [key]");
        return;
      }
      const data = await readJson(file);
      if (!key) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        let cur: unknown = data;
        for (const p of key.split(".")) {
          if (cur && typeof cur === "object" && p in (cur as object)) {
            cur = (cur as Record<string, unknown>)[p];
          } else {
            console.log(`键不存在: ${key}`);
            return;
          }
        }
        console.log(JSON.stringify(cur, null, 2));
      }
      break;
    }
    case "watch": {
      const dir = process.argv[3];
      if (!dir) {
        console.log("用法: watch <dir>");
        return;
      }
      console.log(`监视 ${dir} (Ctrl+C 退出)...`);
      watch(dir, (event, filename) => {
        console.log(`[${new Date().toISOString()}] ${event}: ${filename}`);
      });
      break;
    }
    default:
      console.log(`
文件操作工具库 - 命令行演示

用法:
  copy <src> <dst>           递归复制目录
  walk <dir>                 遍历目录树
  hash <file> [-a algo]      文件哈希 (md5|sha1|sha256|sha512)
  json <file> [key]          读取 JSON (支持点分 key)
  watch <dir>                防抖监视目录变化

示例:
  copy ./src ./backup
  walk .
  hash ./package.json -a md5
  json ./data.json user.name
  watch ./src
`);
  }
}
main();
