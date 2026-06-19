#!/usr/bin/env node
/**
 * PDF 合并工具 (PDF Merge Tool)
 *
 * 纯 TypeScript 实现的 PDF 结构解析与合并工具。解析 PDF 的版本、页数、元数据，
 * 并通过对象重编号与交叉引用重写实现多个 PDF 的合并与页面范围提取。
 *
 * 命令:
 *   info <file>                              显示 PDF 版本、页数、元数据等信息
 *   merge <file1> <file2> ... [-o output]    合并多个 PDF (默认输出 merged.pdf)
 *   extract <file> <pageRange> [-o output]   提取页面范围 (如 1-3,5)
 *   help                                     显示帮助
 *
 * 限制说明:
 *   - 仅支持经典 xref 表结构的 PDF (不支持 xref 流/对象流的 PDF，如部分新版生成的 PDF)
 *   - 不支持加密 PDF
 *   - 交叉引用重写基于间接引用模式 "N G R"，极少数二进制流中包含该模式时可能出错
 *   - 以上为学习演示实现，复杂场景请使用 pdf-lib/qpdf 等专业库
 */

import * as fs from "fs";
import * as path from "path";

/** 用 latin1 编码读写 Buffer，保证字节一一对应 (便于正则操作) */
function bufToStr(buf: Buffer): string { return buf.toString("latin1"); }
function strToBuf(s: string): Buffer { return Buffer.from(s, "latin1"); }

/** 解析 PDF 版本号 */
function parseVersion(buf: Buffer): string {
  const head = bufToStr(buf.slice(0, 20));
  const m = head.match(/%PDF-(\d+\.\d+)/);
  return m ? m[1] : "未知";
}

/** 找到最后一个 startxref 的偏移 */
function findStartxref(buf: Buffer): number {
  const s = bufToStr(buf);
  const idx = s.lastIndexOf("startxref");
  if (idx < 0) return -1;
  const rest = s.slice(idx + 9).trim();
  const m = rest.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

/** 解析 xref 表，返回 对象号 -> 字节偏移 的映射 */
function parseXref(buf: Buffer, xrefOffset: number): Map<number, number> {
  const offsets = new Map<number, number>();
  const s = bufToStr(buf);
  // 跳过 "xref" 关键字
  let pos = s.indexOf("xref", xrefOffset);
  if (pos < 0) {
    // 可能是 xref 流，不支持
    return offsets;
  }
  pos += 4;
  // 跳过空白与换行
  while (pos < s.length && /\s/.test(s[pos])) pos++;
  const trailerIdx = s.indexOf("trailer", pos);
  if (trailerIdx < 0) return offsets;
  const body = s.slice(pos, trailerIdx);
  const lines = body.split(/\r?\n/);
  let currentObj = 0;
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (line === "") continue;
    const header = line.match(/^(\d+)\s+(\d+)$/);
    if (header) {
      currentObj = parseInt(header[1], 10);
      continue;
    }
    // 形如 "0000000000 00000 n" 或 "... f"
    const entry = line.match(/^(\d{10})\s+(\d{5})\s+([nf])$/);
    if (entry) {
      if (entry[3] === "n") offsets.set(currentObj, parseInt(entry[1], 10));
      currentObj++;
    }
  }
  return offsets;
}

/** 解析 trailer 字典，返回 Root 对象号等 */
function parseTrailer(buf: Buffer, xrefOffset: number): { root?: [number, number]; size?: number; encrypt: boolean; info?: [number, number] } {
  const s = bufToStr(buf);
  const trailerIdx = s.indexOf("trailer", xrefOffset);
  if (trailerIdx < 0) return { encrypt: false };
  const dictStart = s.indexOf("<<", trailerIdx);
  const dictEnd = s.indexOf(">>", dictStart);
  if (dictStart < 0 || dictEnd < 0) return { encrypt: false };
  const dict = s.slice(dictStart, dictEnd + 2);
  const result: { root?: [number, number]; size?: number; encrypt: boolean; info?: [number, number] } = { encrypt: /\/Encrypt\b/.test(dict) };
  const rootM = dict.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (rootM) result.root = [parseInt(rootM[1], 10), parseInt(rootM[2], 10)];
  const sizeM = dict.match(/\/Size\s+(\d+)/);
  if (sizeM) result.size = parseInt(sizeM[1], 10);
  const infoM = dict.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);
  if (infoM) result.info = [parseInt(infoM[1], 10), parseInt(infoM[2], 10)];
  return result;
}

/** 读取指定偏移处的对象原始文本 (从对象号到 endobj) */
function readRawObject(buf: Buffer, offset: number): string {
  const s = bufToStr(buf);
  const endIdx = s.indexOf("endobj", offset);
  if (endIdx < 0) return s.slice(offset);
  return s.slice(offset, endIdx + 6);
}

/** 解析间接引用数组，如 [1 0 R 2 0 R] */
function parseRefArray(text: string, key: string): Array<[number, number]> {
  const m = text.match(new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  const refs: Array<[number, number]> = [];
  const re = /(\d+)\s+(\d+)\s+R/g;
  let match;
  while ((match = re.exec(m[1])) !== null) refs.push([parseInt(match[1], 10), parseInt(match[2], 10)]);
  return refs;
}

/** 解析单个间接引用 */
function parseSingleRef(text: string, key: string): [number, number] | null {
  const m = text.match(new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

/** 统计页数：遍历所有对象，统计 /Type /Page (非 /Pages) */
function countPages(buf: Buffer, offsets: Map<number, number>): number {
  let count = 0;
  for (const [, off] of offsets) {
    const raw = readRawObject(buf, off);
    if (/\/Type\s*\/Page\b(?!\s*s)/.test(raw)) count++;
  }
  return count;
}

/** 提取元数据字符串 */
function extractMetaString(raw: string, key: string): string | null {
  const m = raw.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`));
  if (m) return decodePdfString(m[1]);
  const m2 = raw.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f]+)>`));
  if (m2) return decodeHex(m2[1]);
  return null;
}

function decodePdfString(s: string): string {
  // 简单处理转义与 UTF-16BE
  try {
    if (/^\xFE\xFF/.test(s)) return Buffer.from(s.slice(2), "latin1").toString("utf16le");
  } catch { /* ignore */ }
  return s.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
}
function decodeHex(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return bytes.slice(2).toString("utf16le");
  return bytes.toString("latin1");
}

interface PdfDoc {
  buf: Buffer;
  version: string;
  offsets: Map<number, number>;
  root: [number, number] | null;
  size: number;
  encrypt: boolean;
  pageCount: number;
  pageSize: string | null;
  meta: { title?: string; author?: string; subject?: string; creator?: string; producer?: string; creationDate?: string };
}

/** 加载并解析 PDF */
function loadPdf(file: string): PdfDoc {
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
  const buf = fs.readFileSync(file);
  if (!bufToStr(buf.slice(0, 5)).startsWith("%PDF")) throw new Error(`不是有效的 PDF 文件: ${file}`);
  const version = parseVersion(buf);
  const xrefOffset = findStartxref(buf);
  if (xrefOffset < 0) throw new Error(`无法找到 startxref: ${file}`);
  const offsets = parseXref(buf, xrefOffset);
  if (offsets.size === 0) throw new Error(`无法解析 xref 表 (可能是 xref 流格式，本工具暂不支持): ${file}`);
  const trailer = parseTrailer(buf, xrefOffset);
  if (trailer.encrypt) throw new Error(`加密 PDF 不支持: ${file}`);
  const pageCount = countPages(buf, offsets);
  // 解析页面尺寸与元数据
  let pageSize: string | null = null;
  let meta: PdfDoc["meta"] = {};
  if (trailer.root) {
    const catalogRaw = readRawObject(buf, offsets.get(trailer.root[0]) ?? -1);
    const pagesRef = parseSingleRef(catalogRaw, "Pages");
    if (pagesRef) {
      const pagesRaw = readRawObject(buf, offsets.get(pagesRef[0]) ?? -1);
      const mb = pagesRaw.match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
      if (mb) {
        const w = parseFloat(mb[3]) - parseFloat(mb[1]);
        const h = parseFloat(mb[4]) - parseFloat(mb[2]);
        pageSize = `${w.toFixed(1)} x ${h.toFixed(1)} pt (${w > h ? "横向" : "纵向"})`;
      }
    }
  }
  if (trailer.info) {
    const infoRaw = readRawObject(buf, offsets.get(trailer.info[0]) ?? -1);
    for (const k of ["Title", "Author", "Subject", "Creator", "Producer", "CreationDate"] as const) {
      const v = extractMetaString(infoRaw, k);
      if (v) meta[k.toLowerCase() as "title"] = v;
    }
  }
  return { buf, version, offsets, root: trailer.root ?? null, size: trailer.size ?? offsets.size, encrypt: false, pageCount, pageSize, meta };
}

function formatSize(bytes: number): string {
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + u[i];
}

function cmdInfo(args: string[]): void {
  if (!args[0]) { console.error("错误: 用法 info <file>"); process.exit(1); }
  const doc = loadPdf(args[0]);
  const stat = fs.statSync(args[0]);
  console.log(`\nPDF 信息: ${path.resolve(args[0])}`);
  console.log("=".repeat(50));
  console.log(`版本:        PDF ${doc.version}`);
  console.log(`文件大小:    ${formatSize(stat.size)} (${stat.size} 字节)`);
  console.log(`页数:        ${doc.pageCount}`);
  console.log(`对象数:      ${doc.size}`);
  console.log(`页面尺寸:    ${doc.pageSize ?? "未检测 (各页可能不同)"}`);
  console.log(`加密:        ${doc.encrypt ? "是" : "否"}`);
  console.log(`\n--- 元数据 ---`);
  if (doc.meta.title) console.log(`标题:   ${doc.meta.title}`);
  if (doc.meta.author) console.log(`作者:   ${doc.meta.author}`);
  if (doc.meta.subject) console.log(`主题:   ${doc.meta.subject}`);
  if (doc.meta.creator) console.log(`创建者: ${doc.meta.creator}`);
  if (doc.meta.producer) console.log(`生成器: ${doc.meta.producer}`);
  if (doc.meta.creationDate) console.log(`创建日期: ${doc.meta.creationDate}`);
  if (!doc.meta.title && !doc.meta.author) console.log("(无元数据)");
  console.log("");
}

interface MergedObject { newNum: number; raw: string; }

/** 重写对象文本中的间接引用 (按映射表) */
function rewriteRefs(raw: string, map: Map<number, number>): string {
  return raw.replace(/(\d+)\s+(\d+)\s+R\b/g, (full, numStr, genStr) => {
    const num = parseInt(numStr, 10);
    if (map.has(num)) return `${map.get(num)} ${genStr} R`;
    return full;
  });
}

/** 合并多个 PDF 文档为一个新的 PDF Buffer */
function mergeDocs(docs: PdfDoc[], pageFilter?: (docIdx: number, pageObjNum: number) => boolean): Buffer {
  const newObjects: MergedObject[] = [];
  const objCounter = { n: 0 };
  const alloc = (): number => { objCounter.n++; return objCounter.n; };
  const allPages: number[] = []; // 新页面对象号
  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    // 建立本 doc 的旧号->新号映射
    const localMap = new Map<number, number>();
    for (const oldNum of doc.offsets.keys()) localMap.set(oldNum, alloc());
    // 读取所有对象并重写引用
    const written = new Set<number>();
    for (const [oldNum, off] of doc.offsets) {
      if (written.has(oldNum)) continue;
      written.add(oldNum);
      let raw = readRawObject(doc.buf, off);
      raw = rewriteRefs(raw, localMap);
      newObjects.push({ newNum: localMap.get(oldNum)!, raw });
    }
    // 找到本 doc 的 Catalog -> Pages -> Kids
    if (!doc.root) continue;
    const catalogOld = doc.root[0];
    const catalogNew = localMap.get(catalogOld);
    if (catalogNew === undefined) continue;
    const catalogRaw = readRawObject(doc.buf, doc.offsets.get(catalogOld) ?? -1);
    const pagesRef = parseSingleRef(catalogRaw, "Pages");
    if (!pagesRef) continue;
    const pagesOld = pagesRef[0];
    const pagesRaw = readRawObject(doc.buf, doc.offsets.get(pagesOld) ?? -1);
    const kids = parseRefArray(pagesRaw, "Kids");
    for (const [kidOld] of kids) {
      if (pageFilter && !pageFilter(di, kidOld)) continue;
      const kidNew = localMap.get(kidOld);
      if (kidNew !== undefined) allPages.push(kidNew);
    }
    // 修改本 doc 的 Pages 对象：/Kids 指向新收集的页，/Count 更新
    // (这里改为：把该 Pages 对象的 Kids/Count 重写为仅含本 doc 被选中的页)
    const selectedKids = kids.filter(([k]) => !pageFilter || pageFilter(di, k))
      .map(([k]) => `${localMap.get(k)} 0 R`).join(" ");
    for (const obj of newObjects) {
      if (obj.newNum === localMap.get(pagesOld)) {
        obj.raw = obj.raw.replace(/\/Kids\s*\[[^\]]*\]/, `/Kids [${selectedKids}]`);
        obj.raw = obj.raw.replace(/\/Count\s+\d+/, `/Count ${selectedKids ? kids.filter(([k]) => !pageFilter || pageFilter(di, k)).length : 0}`);
      }
    }
  }
  // 创建统一 Pages 对象与 Catalog
  const pagesObjNum = alloc();
  const catalogObjNum = alloc();
  const kidsStr = allPages.map(p => `${p} 0 R`).join(" ");
  newObjects.push({ newNum: pagesObjNum, raw: `${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${allPages.length} >>\nendobj` });
  newObjects.push({ newNum: catalogObjNum, raw: `${catalogObjNum} 0 obj\n<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\nendobj` });
  // 写出 PDF
  const parts: string[] = [];
  parts.push("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
  const xrefMap = new Map<number, number>();
  for (const obj of newObjects.sort((a, b) => a.newNum - b.newNum)) {
    xrefMap.set(obj.newNum, Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(obj.raw + "\n");
  }
  const xrefStart = Buffer.byteLength(parts.join(""), "latin1");
  const maxObj = objCounter.n;
  parts.push("xref\n");
  parts.push(`0 ${maxObj + 1}\n`);
  parts.push("0000000000 65535 f \n");
  for (let i = 1; i <= maxObj; i++) {
    const off = xrefMap.get(i) ?? 0;
    parts.push(`${String(off).padStart(10, "0")} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${maxObj + 1} /Root ${catalogObjNum} 0 R >>\n`);
  parts.push("startxref\n");
  parts.push(`${xrefStart}\n`);
  parts.push("%%EOF\n");
  return strToBuf(parts.join(""));
}

function cmdMerge(args: string[]): void {
  const files: string[] = [];
  let outPath = "merged.pdf";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") outPath = args[++i] ?? "merged.pdf";
    else files.push(args[i]);
  }
  if (files.length < 2) { console.error("错误: 至少需要两个 PDF 文件: merge <file1> <file2> ... [-o output]"); process.exit(1); }
  console.log(`正在合并 ${files.length} 个 PDF...`);
  const docs = files.map(f => { console.log(`  解析: ${f}`); return loadPdf(f); });
  const merged = mergeDocs(docs);
  fs.writeFileSync(outPath, merged);
  console.log(`\x1b[32m合并完成: ${path.resolve(outPath)} (${formatSize(merged.length)}, 共 ${docs.reduce((s, d) => s + d.pageCount, 0)} 页)\x1b[0m`);
  console.log("\x1b[33m注意: 本工具为简化实现，复杂 PDF 可能无法正确合并，请验证结果。\x1b[0m");
}

function cmdExtract(args: string[]): void {
  if (args.length < 2) { console.error("错误: 用法 extract <file> <pageRange> [-o output]"); process.exit(1); }
  const file = args[0];
  const range = args[1];
  let outPath = "extracted.pdf";
  for (let i = 2; i < args.length; i++) if (args[i] === "-o" || args[i] === "--output") outPath = args[++i] ?? "extracted.pdf";
  const doc = loadPdf(file);
  // 解析页面范围 (1-based)
  const wanted = new Set<number>();
  for (const part of range.split(",")) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) { console.error(`错误: 无法解析页面范围 "${part}"`); process.exit(1); }
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    for (let p = start; p <= end; p++) wanted.add(p);
  }
  // 收集所有页面对象号 (按偏移顺序)
  const pageObjNums: number[] = [];
  for (const [oldNum, off] of doc.offsets) {
    const raw = readRawObject(doc.buf, off);
    if (/\/Type\s*\/Page\b(?!\s*s)/.test(raw)) pageObjNums.push(oldNum);
  }
  pageObjNums.sort((a, b) => (doc.offsets.get(a)! - doc.offsets.get(b)!));
  const pageSeq = new Map<number, number>(); // oldPageObjNum -> 1-based index
  pageObjNums.forEach((n, i) => pageSeq.set(n, i + 1));
  const filter = (_di: number, kidOld: number) => {
    const idx = pageSeq.get(kidOld);
    return idx !== undefined && wanted.has(idx);
  };
  const merged = mergeDocs([doc], filter);
  fs.writeFileSync(outPath, merged);
  console.log(`\x1b[32m提取完成: ${path.resolve(outPath)} (${wanted.size} 页)\x1b[0m`);
}

function printHelp(): void {
  console.log(`
PDF 合并工具 (PDF Merge Tool)
=============================
解析 PDF 结构并实现合并与页面提取。

用法:
  pdfmerge info <file>                              显示 PDF 版本、页数、元数据
  pdfmerge merge <file1> <file2> ... [-o output]    合并多个 PDF (默认 merged.pdf)
  pdfmerge extract <file> <pageRange> [-o output]   提取页面范围 (如 1-3,5)
  pdfmerge help                                     显示本帮助

示例:
  pdfmerge info document.pdf
  pdfmerge merge a.pdf b.pdf c.pdf -o all.pdf
  pdfmerge extract report.pdf 1-3,5 -o part.pdf

限制: 仅支持经典 xref 表结构的非加密 PDF；学习演示用途，复杂场景请用专业库。
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "info": cmdInfo(rest); break;
      case "merge": cmdMerge(rest); break;
      case "extract": cmdExtract(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'pdfmerge help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
