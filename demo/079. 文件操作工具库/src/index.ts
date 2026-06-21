#!/usr/bin/env node
/**
 * 文件操作工具库 (File Utils)
 * -------------------------------------------------------------
 * 基于 fs 的高级文件操作函数集合。
 *
 * 公开 API:
 *   - JSON: readJson, writeJson (支持 schema 验证 hook), readJsonSync, writeJsonSync
 *   - 行: readLines, writeLines
 *   - CSV: readCsv, writeCsv
 *   - 目录: ensureDir, ensureFile, copyDir, removeDir, moveDir, emptyDir
 *   - 存在: pathExists
 *   - 临时: tempFile, tempDir
 *   - 哈希: fileHash, fileEquals
 *   - 遍历: walkDir (async generator)
 *   - glob: globMatch
 *   - 原子: atomicWrite
 *   - 监视: watch (防抖)
 *
 * 仅依赖 Node.js 内置模块: fs, path, os, crypto.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

type JsonSchemaValidator = (data: unknown) => Error | null;

// ---------- 存在与目录 ----------

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

export async function ensureFile(file: string): Promise<void> {
  await ensureDir(path.dirname(file));
  if (!(await pathExists(file))) {
    await fs.promises.writeFile(file, '');
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

export async function copyDir(src: string, dst: string): Promise<void> {
  await ensureDir(dst);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.promises.readlink(s);
      await fs.promises.symlink(link, d);
    } else {
      await fs.promises.copyFile(s, d);
    }
  }
}

export async function moveDir(src: string, dst: string): Promise<void> {
  await ensureDir(path.dirname(dst));
  await fs.promises.rename(src, dst);
}

// ---------- JSON ----------

export async function readJson(file: string, validator?: JsonSchemaValidator): Promise<unknown> {
  const content = await fs.promises.readFile(file, 'utf8');
  const data = JSON.parse(content);
  if (validator) {
    const err = validator(data);
    if (err) throw err;
  }
  return data;
}

export async function writeJson(file: string, data: unknown, pretty = true): Promise<void> {
  await ensureDir(path.dirname(file));
  const content = JSON.stringify(data, null, pretty ? 2 : 0);
  await fs.promises.writeFile(file, content, 'utf8');
}

export function readJsonSync(file: string, validator?: JsonSchemaValidator): unknown {
  const content = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(content);
  if (validator) {
    const err = validator(data);
    if (err) throw err;
  }
  return data;
}

export function writeJsonSync(file: string, data: unknown, pretty = true): void {
  ensureDirSync(path.dirname(file));
  const content = JSON.stringify(data, null, pretty ? 2 : 0);
  fs.writeFileSync(file, content, 'utf8');
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------- 行 ----------

export async function readLines(file: string, encoding: BufferEncoding = 'utf8'): Promise<string[]> {
  const content = await fs.promises.readFile(file, encoding);
  return content.split(/\r?\n/);
}

export async function writeLines(file: string, lines: string[], eol = '\n'): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.promises.writeFile(file, lines.join(eol), 'utf8');
}

// ---------- CSV ----------

export async function readCsv(file: string, options: { delimiter?: string; header?: boolean } = {}): Promise<string[][]> {
  const delim = options.delimiter ?? ',';
  const content = await fs.promises.readFile(file, 'utf8');
  return parseCsv(content, delim);
}

function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
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
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // 忽略
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

export async function writeCsv(file: string, rows: string[][], delimiter = ','): Promise<void> {
  await ensureDir(path.dirname(file));
  const content = rows
    .map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter))
    .join('\n');
  await fs.promises.writeFile(file, content + '\n', 'utf8');
}

function csvEscape(cell: string, delim: string): string {
  if (cell.includes(delim) || cell.includes('"') || cell.includes('\n')) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

// ---------- 临时文件 ----------

export async function tempFile(ext = '.tmp', prefix = 'fu-'): Promise<string> {
  const name = prefix + crypto.randomBytes(8).toString('hex') + ext;
  const file = path.join(os.tmpdir(), name);
  await fs.promises.writeFile(file, '');
  return file;
}

export async function tempDir(prefix = 'fu-'): Promise<string> {
  const name = prefix + crypto.randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), name);
  await ensureDir(dir);
  return dir;
}

// ---------- 哈希 ----------

export async function fileHash(file: string, algo: 'md5' | 'sha1' | 'sha256' | 'sha512' = 'sha256'): Promise<string> {
  const hash = crypto.createHash(algo);
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function fileEquals(fileA: string, fileB: string, algo: 'md5' | 'sha256' = 'md5'): Promise<boolean> {
  const [a, b] = await Promise.all([fileHash(fileA, algo), fileHash(fileB, algo)]);
  return a === b;
}

// ---------- walk ----------

export interface WalkEntry {
  path: string;
  relative: string;
  isDirectory: boolean;
  size: number;
  mtime: Date;
}

export async function* walkDir(dir: string, options: { maxDepth?: number } = {}): AsyncGenerator<WalkEntry> {
  const maxDepth = options.maxDepth ?? Infinity;
  yield* walkInner(dir, dir, 0, maxDepth);
}

async function* walkInner(dir: string, root: string, depth: number, maxDepth: number): AsyncGenerator<WalkEntry> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      const stat = await fs.promises.stat(full);
      yield { path: full, relative: rel, isDirectory: true, size: stat.size, mtime: stat.mtime };
      if (depth + 1 < maxDepth) {
        yield* walkInner(full, root, depth + 1, maxDepth);
      }
    } else if (entry.isFile()) {
      const stat = await fs.promises.stat(full);
      yield { path: full, relative: rel, isDirectory: false, size: stat.size, mtime: stat.mtime };
    }
  }
}

// ---------- glob ----------

export function globMatch(pattern: string, target: string): boolean {
  // 支持 *, **, ?
  const regexStr =
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/{{GLOBSTAR}}/g, '.*') +
    '$';
  return new RegExp(regexStr).test(target.replace(/\\/g, '/'));
}

// ---------- 原子写入 ----------

export async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = file + '.tmp.' + crypto.randomBytes(4).toString('hex');
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
}

// ---------- 防抖监视 ----------

export interface WatchOptions {
  debounceMs?: number;
  recursive?: boolean;
}

export function watch(
  dir: string,
  callback: (event: string, filename: string | null) => void,
  options: WatchOptions = {}
): fs.FSWatcher {
  const debounce = options.debounceMs ?? 200;
  const timers = new Map<string, NodeJS.Timeout>();
  const watcher = fs.watch(dir, { recursive: options.recursive ?? true }, (event, filename) => {
    const key = `${event}:${filename}`;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(key);
      callback(event, filename);
    }, debounce);
    timers.set(key, timer);
  });
  return watcher;
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
    case 'copy': {
      const src = process.argv[3];
      const dst = process.argv[4];
      if (!src || !dst) {
        console.log('用法: copy <src> <dst>');
        return;
      }
      console.log(`复制目录 ${src} -> ${dst}`);
      await copyDir(src, dst);
      console.log('完成。');
      break;
    }
    case 'walk': {
      const dir = process.argv[3];
      if (!dir) {
        console.log('用法: walk <dir>');
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
        const indent = '  ' + '  '.repeat(entry.relative.split(path.sep).length - 1);
        const tag = entry.isDirectory ? '[D]' : '   ';
        const size = entry.isDirectory ? '' : ` (${formatBytes(entry.size)})`;
        console.log(`${indent}${tag} ${entry.relative}${size}`);
        count++;
        if (!entry.isDirectory) totalSize += entry.size;
      }
      console.log(`\n共 ${count} 个条目, 文件总大小 ${formatBytes(totalSize)}`);
      break;
    }
    case 'hash': {
      const file = process.argv[3];
      const algoFlag = process.argv.indexOf('-a');
      const algo = (algoFlag >= 0 ? process.argv[algoFlag + 1] : 'sha256') as 'md5' | 'sha1' | 'sha256' | 'sha512';
      if (!file) {
        console.log('用法: hash <file> [-a algo]');
        return;
      }
      const hash = await fileHash(file, algo);
      console.log(`${algo}: ${hash}`);
      break;
    }
    case 'json': {
      const file = process.argv[3];
      const key = process.argv[4];
      if (!file) {
        console.log('用法: json <file> [key]');
        return;
      }
      const data = await readJson(file);
      if (!key) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        let cur: unknown = data;
        for (const p of key.split('.')) {
          if (cur && typeof cur === 'object' && p in (cur as object)) {
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
    case 'watch': {
      const dir = process.argv[3];
      if (!dir) {
        console.log('用法: watch <dir>');
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
