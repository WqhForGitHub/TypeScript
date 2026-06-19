#!/usr/bin/env node
/**
 * 数据备份工具
 * - 全量备份：复制所有文件
 * - 增量备份：基于上次备份的 manifest，仅备份变更文件
 * - 差异备份：基于全量备份的 manifest，备份自全量后变更的文件
 * - 自定义归档格式：每个文件由 header(name/size/mtime/mode)+content 拼接
 * - 支持 zlib 压缩
 * - 命令：create / incremental / restore / list / verify / schedule
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import * as readline from "readline";

export type BackupType = "full" | "incremental" | "differential";

/** 归档中的文件条目 */
export interface ArchiveEntry {
  name: string;
  size: number;
  mtime: number;
  mode: number;
  hash: string;
  compressed: boolean;
  offset: number; // 数据起始偏移
}

/** 归档元信息（写入归档尾部） */
export interface ArchiveManifest {
  version: number;
  type: BackupType;
  createdAt: string;
  baseArchive?: string; // 增量/差异基于的归档
  entries: ArchiveEntry[];
}

/** 文件元信息（用于 manifest 比对） */
export interface FileMeta {
  path: string;
  size: number;
  mtime: number;
  mode: number;
  hash: string;
}

const MAGIC = "TSBK"; // TypeScript Backup
const VERSION = 1;

/** 计算文件 SHA-256 */
function fileHash(file: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

/** 递归收集目录下所有文件 */
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

/** 计算文件元信息 */
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

/** 写入归档（自定义格式） */
export function writeArchive(
  outFile: string,
  root: string,
  files: FileMeta[],
  opts: { type: BackupType; baseArchive?: string; compress?: boolean } = { type: "full" }
): ArchiveManifest {
  const compress = opts.compress ?? false;
  const entries: ArchiveEntry[] = [];
  // 先把所有文件内容拼接到一个 buffer，再写到磁盘
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const full = path.join(root, f.path);
    let content = fs.readFileSync(full);
    let compressed = false;
    if (compress) {
      const z = zlib.gzipSync(content);
      if (z.length < content.length) {
        content = z;
        compressed = true;
      }
    }
    const entry: ArchiveEntry = {
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
  // 写入：MAGIC + VERSION + type + 内容 + manifest(json) + manifest size + magic trailer
  const fd = fs.openSync(outFile, "w");
  let pos = 0;
  const writeBuf = (b: Buffer) => {
    fs.writeSync(fd, b, 0, b.length, pos);
    pos += b.length;
  };
  writeBuf(Buffer.from(MAGIC, "utf8"));
  writeBuf(Buffer.from([VERSION]));
  writeBuf(Buffer.from(opts.type.padEnd(12, "\0"), "utf8"));
  for (const c of chunks) writeBuf(c);
  // 写 manifest
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

/** 读取归档 manifest */
export function readManifest(file: string): ArchiveManifest {
  const fd = fs.openSync(file, "r");
  const st = fs.statSync(file);
  // 读尾部 magic(4) + size(8)
  const tail = Buffer.alloc(12);
  fs.readSync(fd, tail, 0, 12, st.size - 12);
  const magic = tail.slice(8, 12).toString("utf8");
  if (magic !== MAGIC) throw new Error("归档格式错误（尾部 magic 不匹配）");
  const manifestSize = Number(tail.readBigUInt64BE(0));
  const manifestBuf = Buffer.alloc(manifestSize);
  fs.readSync(fd, manifestBuf, 0, manifestSize, st.size - 12 - manifestSize);
  fs.closeSync(fd);
  return JSON.parse(manifestBuf.toString("utf8")) as ArchiveManifest;
}

/** 读取归档头部信息 */
function readHeader(file: string): { magic: string; version: number; type: string } {
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

/** 列出归档内容 */
export function listArchive(file: string): ArchiveManifest {
  const header = readHeader(file);
  if (header.magic !== MAGIC) throw new Error("不是有效的归档文件");
  if (header.version !== VERSION) throw new Error(`不支持的版本: ${header.version}`);
  return readManifest(file);
}

/** 提取归档中的某个文件 */
export function extractFile(archiveFile: string, entry: ArchiveEntry, destDir: string): void {
  const fd = fs.openSync(archiveFile, "r");
  const dataStart = 4 + 1 + 12; // magic + version + type
  const buf = Buffer.alloc(entry.size);
  fs.readSync(fd, buf, 0, entry.size, dataStart + entry.offset);
  fs.closeSync(fd);
  let content = buf;
  if (entry.compressed) content = zlib.gunzipSync(buf);
  const out = path.join(destDir, entry.name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  fs.chmodSync(out, entry.mode & 0o777);
  fs.utimesSync(out, entry.mtime / 1000, entry.mtime / 1000);
}

/** 还原整个归档 */
export function restoreArchive(archiveFile: string, destDir: string): number {
  const manifest = readManifest(archiveFile);
  for (const e of manifest.entries) {
    extractFile(archiveFile, e, destDir);
  }
  return manifest.entries.length;
}

/** 校验归档（hash 比对） */
export function verifyArchive(archiveFile: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let manifest: ArchiveManifest;
  try {
    manifest = readManifest(archiveFile);
  } catch (e) {
    return { valid: false, errors: [`无法读取 manifest: ${(e as Error).message}`] };
  }
  const fd = fs.openSync(archiveFile, "r");
  const dataStart = 4 + 1 + 12;
  for (const e of manifest.entries) {
    const buf = Buffer.alloc(e.size);
    fs.readSync(fd, buf, 0, e.size, dataStart + e.offset);
    let content = buf;
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
  return { valid: errors.length === 0, errors };
}

/** 创建全量备份 */
export function createFullBackup(src: string, outFile: string, compress = false): ArchiveManifest {
  const all = collectFiles(src);
  const metas = all.map((f) => fileMeta(src, f));
  return writeArchive(outFile, src, metas, { type: "full", compress });
}

/** 创建增量/差异备份 */
export function createBackup(
  src: string,
  outFile: string,
  baseArchive: string,
  mode: "incremental" | "differential",
  compress = false
): ArchiveManifest {
  const baseManifest = readManifest(baseArchive);
  const baseMap = new Map<string, FileMeta>();
  for (const e of baseManifest.entries) {
    baseMap.set(e.name, {
      path: e.name,
      size: e.size,
      mtime: e.mtime,
      mode: e.mode,
      hash: e.hash,
    });
  }
  const all = collectFiles(src);
  const metas = all.map((f) => fileMeta(src, f));
  // 增量：相对于 baseArchive（上次增量/全量）
  // 差异：相对于上次全量备份
  const changed = metas.filter((m) => {
    const base = baseMap.get(m.path);
    if (!base) return true; // 新文件
    if (base.hash !== m.hash) return true; // 内容变更
    return false;
  });
  return writeArchive(outFile, src, changed, { type: mode, baseArchive, compress });
}

/** 找到最近的全量备份（基于文件名约定） */
export function findLatestFullBackup(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tbk"));
  let latest: string | null = null;
  let latestTime = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const header = readHeader(full);
      if (header.type !== "full") continue;
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

/* ----------------------- CLI ----------------------- */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasOpt(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.log(`数据备份工具 CLI
用法:
  create <src> [-o archive] [--compress]            全量备份
  incremental <src> [-o archive] [--compress]       增量备份（基于最近全量）
  differential <src> [-o archive] [--compress]      差异备份
  restore <archive> [-d dest]                       还原
  list <archive>                                    列出内容
  verify <archive>                                  校验完整性
  schedule <src> <intervalSeconds>                  定时备份
`);
    return;
  }

  switch (cmd) {
    case "create": {
      const [src] = rest;
      if (!src) throw new Error("缺少源路径");
      const out = getOpt(rest, "-o") || path.join(process.cwd(), `backup-${Date.now()}.tbk`);
      const compress = hasOpt(rest, "--compress");
      const m = createFullBackup(src, out, compress);
      console.log(`全量备份完成: ${out}`);
      console.log(`文件数: ${m.entries.length}, 类型: ${m.type}`);
      break;
    }
    case "incremental":
    case "differential": {
      const [src] = rest;
      if (!src) throw new Error("缺少源路径");
      const out = getOpt(rest, "-o") || path.join(process.cwd(), `backup-${cmd}-${Date.now()}.tbk`);
      const compress = hasOpt(rest, "--compress");
      // 找最近全量备份
      const dir = path.dirname(out);
      const base = findLatestFullBackup(dir);
      if (!base) {
        console.log("未找到全量备份，将创建全量备份");
        const m = createFullBackup(src, out, compress);
        console.log(`全量备份完成: ${out} (${m.entries.length} 个文件)`);
        break;
      }
      const m = createBackup(src, out, base, cmd, compress);
      console.log(`${cmd} 备份完成: ${out}`);
      console.log(`文件数: ${m.entries.length}, 基准: ${base}`);
      break;
    }
    case "restore": {
      const [archive] = rest;
      if (!archive) throw new Error("缺少归档文件");
      const dest = getOpt(rest, "-d") || path.join(process.cwd(), "restored");
      const n = restoreArchive(archive, dest);
      console.log(`还原 ${n} 个文件到 ${dest}`);
      break;
    }
    case "list": {
      const [archive] = rest;
      if (!archive) throw new Error("缺少归档文件");
      const m = listArchive(archive);
      console.log(`类型: ${m.type}, 创建于: ${m.createdAt}`);
      if (m.baseArchive) console.log(`基准: ${m.baseArchive}`);
      console.log(`文件数: ${m.entries.length}`);
      console.log("名称                                        大小      压缩  修改时间");
      for (const e of m.entries) {
        console.log(
          `${e.name.padEnd(42)} ${String(e.size).padStart(8)} ${e.compressed ? "  是" : "  否"}  ${new Date(e.mtime).toISOString()}`
        );
      }
      break;
    }
    case "verify": {
      const [archive] = rest;
      if (!archive) throw new Error("缺少归档文件");
      const r = verifyArchive(archive);
      if (r.valid) console.log("校验通过：所有文件哈希匹配");
      else {
        console.log("校验失败:");
        for (const e of r.errors) console.log("  " + e);
      }
      break;
    }
    case "schedule": {
      const [src, intervalStr] = rest;
      if (!src || !intervalStr) throw new Error("用法: schedule <src> <intervalSeconds>");
      const interval = parseInt(intervalStr, 10) * 1000;
      const outDir = path.join(process.cwd(), "backups");
      fs.mkdirSync(outDir, { recursive: true });
      console.log(`开始定时备份：源=${src}, 间隔=${intervalStr}s, 输出=${outDir}`);
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
            console.log(`[${new Date().toISOString()}] 全量备份 #${round}: ${m.entries.length} 文件`);
          } else {
            m = createBackup(src, outFile, base, "incremental", false);
            console.log(`[${new Date().toISOString()}] 增量备份 #${round}: ${m.entries.length} 文件`);
          }
        } catch (e) {
          console.error(`备份失败: ${(e as Error).message}`);
        }
      };
      run();
      setInterval(run, interval);
      // 等待信号
      await new Promise<void>(() => {});
      break;
    }
    case "demo": {
      // 创建临时源目录
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
      console.log(v.valid ? "校验通过" : "校验失败: " + v.errors.join(", "));
      // 修改文件，做增量
      fs.writeFileSync(path.join(demoDir, "a.txt"), "Hello Backup MODIFIED");
      fs.writeFileSync(path.join(demoDir, "d.txt"), "New file");
      const incArchive = path.join(process.cwd(), "demo-inc.tbk");
      console.log("\n=== 创建增量备份 ===");
      const m2 = createBackup(demoDir, incArchive, archive, "incremental", true);
      console.log(`变更文件数: ${m2.entries.length}`);
      // 还原
      const restoreDir = path.join(process.cwd(), "demo-restored");
      console.log("\n=== 还原全量备份 ===");
      restoreArchive(archive, restoreDir);
      console.log("还原后 a.txt:", fs.readFileSync(path.join(restoreDir, "a.txt"), "utf8"));
      // 增量还原
      console.log("\n=== 应用增量备份 ===");
      restoreArchive(incArchive, restoreDir);
      console.log("应用后 a.txt:", fs.readFileSync(path.join(restoreDir, "a.txt"), "utf8"));
      console.log("应用后 d.txt:", fs.readFileSync(path.join(restoreDir, "d.txt"), "utf8"));
      break;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
