#!/usr/bin/env node
/**
 * 简易二维码生成器 (QR Code Generator)
 *
 * 纯 TypeScript 实现的二维码生成器，支持版本 1-3、字节模式编码、
 * Reed-Solomon 纠错、8 种数据掩码及惩罚评分选择，并以 ASCII 字符在终端输出。
 *
 * 命令:
 *   generate <text> [-l L|M] [-v 1|2|3]   生成二维码并在终端显示
 *   save <text> <file> [-l L|M] [-v 1|2|3] 生成二维码并保存为 ASCII 文本文件
 *   help                                  显示帮助信息
 *
 * 选项:
 *   -l, --level <L|M>      纠错等级 (默认 M)
 *   -v, --version <1|2|3>  指定版本 (默认自动选择最小可用版本)
 *   -i, --invert           反转显示 (深色背景用)
 *
 * 说明: 实现 ISO/IEC 18004 标准的核心流程，仅使用 Node.js 内置模块。
 */

import * as fs from "fs";
import * as path from "path";

type EccLevel = "L" | "M";

/** GF(256) 指数表与对数表，使用本原多项式 0x11D */
class GaloisField {
  readonly exp: number[] = new Array(512);
  readonly log: number[] = new Array(256);
  constructor() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      this.exp[i] = x;
      this.log[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) this.exp[i] = this.exp[i - 255];
  }
  mul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return this.exp[this.log[a] + this.log[b]];
  }
  pow(a: number, n: number): number {
    if (a === 0) return 0;
    return this.exp[(this.log[a] * n) % 255];
  }
}

const GF = new GaloisField();

/** 多项式乘法 (系数数组，高位在前) */
function polyMultiply(a: number[], b: number[]): number[] {
  const result = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= GF.mul(a[i], b[j]);
    }
  }
  return result;
}

/** 生成 Reed-Solomon 生成多项式，长度为 ecCount + 1 */
function generatorPoly(ecCount: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    poly = polyMultiply(poly, [1, GF.pow(2, i)]);
  }
  return poly;
}

/** 计算 Reed-Solomon 纠错码字 */
function rsEncode(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const buf = data.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        buf[i + j] ^= GF.mul(gen[j], coef);
      }
    }
  }
  return buf.slice(data.length);
}

interface VersionInfo {
  version: number;
  size: number;
  dataCodewords: number;
  ecCodewords: number;
  alignCenters: number[];
  byteCapacity: number;
}

/** 版本信息表 (仅 L/M 等级，V1-V3) */
const VERSION_TABLE: Record<string, VersionInfo> = {
  "1-L": { version: 1, size: 21, dataCodewords: 19, ecCodewords: 7, alignCenters: [], byteCapacity: 17 },
  "1-M": { version: 1, size: 21, dataCodewords: 16, ecCodewords: 10, alignCenters: [], byteCapacity: 14 },
  "2-L": { version: 2, size: 25, dataCodewords: 34, ecCodewords: 10, alignCenters: [18], byteCapacity: 32 },
  "2-M": { version: 2, size: 25, dataCodewords: 28, ecCodewords: 16, alignCenters: [18], byteCapacity: 26 },
  "3-L": { version: 3, size: 29, dataCodewords: 55, ecCodewords: 15, alignCenters: [22], byteCapacity: 53 },
  "3-M": { version: 3, size: 29, dataCodewords: 44, ecCodewords: 26, alignCenters: [22], byteCapacity: 42 },
};

/** 字节模式编码：生成最终码字序列 (数据 + 纠错) */
function encodeData(text: string, version: number, level: EccLevel): number[] {
  const info = VERSION_TABLE[`${version}-${level}`];
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > info.byteCapacity) {
    throw new Error(`文本过长: 需要 ${bytes.length} 字节，版本 ${version}-${level} 最多支持 ${info.byteCapacity} 字节`);
  }
  const bits: number[] = [];
  const pushBits = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4); // 字节模式指示符
  pushBits(bytes.length, 8); // 字符计数 (V1-9 用 8 位)
  for (const b of bytes) pushBits(b, 8);
  // 终止符 (最多 4 位 0)
  const totalBits = info.dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < totalBits; i++) bits.push(0);
  // 对齐到字节边界
  while (bits.length % 8 !== 0) bits.push(0);
  // 转为码字
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  // 填充码字 0xEC, 0xED
  let pad = 0xec;
  while (data.length < info.dataCodewords) {
    data.push(pad);
    pad = pad === 0xec ? 0xed : 0xec;
  }
  const ec = rsEncode(data, info.ecCodewords);
  return data.concat(ec);
}

type Matrix = Uint8Array; // 0=空,1=暗,2=预留(将填充格式信息)
type Reserved = Uint8Array;

function makeMatrix(size: number): { m: Matrix; r: Reserved } {
  return { m: new Uint8Array(size * size), r: new Uint8Array(size * size) };
}
const idx = (size: number, x: number, y: number) => y * size + x;

/** 放置三个角的探测图形 (7x7) 及分隔符 */
function placeFinder(m: Matrix, r: Reserved, size: number, ox: number, oy: number): void {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = ox + dx, y = oy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      r[idx(size, x, y)] = 1;
      const outer = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      m[idx(size, x, y)] = outer || inner ? 1 : 0;
    }
  }
}

/** 放置时序图形 */
function placeTiming(m: Matrix, r: Reserved, size: number): void {
  for (let i = 8; i < size - 8; i++) {
    r[idx(size, i, 6)] = 1;
    r[idx(size, 6, i)] = 1;
    m[idx(size, i, 6)] = i % 2 === 0 ? 1 : 0;
    m[idx(size, 6, i)] = i % 2 === 0 ? 1 : 0;
  }
}

/** 放置对齐图形 */
function placeAlignment(m: Matrix, r: Reserved, size: number, centers: number[]): void {
  for (const cy of centers) {
    for (const cx of centers) {
      if ((cx === 6 && cy === 6) || (cx === size - 7 && cy === 6) || (cx === 6 && cy === size - 7)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = cx + dx, y = cy + dy;
          r[idx(size, x, y)] = 1;
          const edge = Math.max(Math.abs(dx), Math.abs(dy));
          m[idx(size, x, y)] = edge !== 1 ? 1 : 0;
        }
      }
    }
  }
}

/** 预留格式信息区域 (含暗模块) */
function reserveFormat(m: Matrix, r: Reserved, size: number): void {
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { r[idx(size, 8, i)] = 1; r[idx(size, i, 8)] = 1; }
    if (i < 8) { r[idx(size, size - 1 - i, 8)] = 1; r[idx(size, 8, size - 1 - i)] = 1; }
  }
  m[idx(size, 8, size - 8)] = 1; // 暗模块
  r[idx(size, 8, size - 8)] = 1;
}

/** 以之字形放置数据位 */
function placeData(m: Matrix, size: number, codewords: number[]): void {
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // 跳过时序列
    for (let i = 0; i < size; i++) {
      const y = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (m[idx(size, x, y)] === 0 && bitIdx < bits.length) {
          m[idx(size, x, y)] = bits[bitIdx++] ? 1 : 0;
        }
      }
    }
    upward = !upward;
  }
}

/** 8 种掩码条件函数 */
function maskCondition(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

/** 对数据模块应用掩码 (函数图形不动) */
function applyMask(base: Matrix, r: Reserved, size: number, mask: number): Matrix {
  const out = new Uint8Array(base);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (r[idx(size, x, y)] === 0 && maskCondition(mask, x, y)) {
        out[idx(size, x, y)] = base[idx(size, x, y)] ^ 1;
      }
    }
  }
  return out;
}

/** 计算惩罚分 */
function penaltyScore(m: Matrix, size: number): number {
  let score = 0;
  // 规则 1: 连续 5 个相同
  const runs = (line: number[]) => {
    let run = 1, s = 0;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) { run++; }
      else { if (run >= 5) s += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) s += 3 + (run - 5);
    return s;
  };
  for (let y = 0; y < size; y++) { const row: number[] = []; for (let x = 0; x < size; x++) row.push(m[idx(size, x, y)]); score += runs(row); }
  for (let x = 0; x < size; x++) { const col: number[] = []; for (let y = 0; y < size; y++) col.push(m[idx(size, x, y)]); score += runs(col); }
  // 规则 2: 2x2 同色块
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const v = m[idx(size, x, y)];
    if (v === m[idx(size, x + 1, y)] && v === m[idx(size, x, y + 1)] && v === m[idx(size, x + 1, y + 1)]) score += 3;
  }
  // 规则 3: 1:1:3:1:1 模式
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pattern2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matchAt = (line: number[], start: number) => pattern.every((v, i) => line[start + i] === v) || pattern2.every((v, i) => line[start + i] === v);
  for (let y = 0; y < size; y++) { const row: number[] = []; for (let x = 0; x < size; x++) row.push(m[idx(size, x, y)]); for (let i = 0; i + 11 <= size; i++) if (matchAt(row, i)) score += 40; }
  for (let x = 0; x < size; x++) { const col: number[] = []; for (let y = 0; y < size; y++) col.push(m[idx(size, x, y)]); for (let i = 0; i + 11 <= size; i++) if (matchAt(col, i)) score += 40; }
  // 规则 4: 暗模块比例
  let dark = 0;
  for (let i = 0; i < m.length; i++) if (m[i] === 1) dark++;
  const pct = (dark * 100) / m.length;
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** BCH(15,5) 编码格式信息并写入 */
function placeFormatInfo(m: Matrix, size: number, level: EccLevel, mask: number): void {
  const levelBits = level === "L" ? 0b01 : 0b00;
  let data = (levelBits << 3) | mask;
  let bch = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((bch >> i) & 1) bch ^= gen << (i - 10);
  }
  const format = ((data << 10) | bch) ^ 0b101010000010010;
  const bit = (i: number) => (format >> i) & 1;
  for (let i = 0; i <= 5; i++) m[idx(size, 8, i)] = bit(i) ? 1 : 0;
  m[idx(size, 8, 7)] = bit(6) ? 1 : 0;
  m[idx(size, 8, 8)] = bit(7) ? 1 : 0;
  m[idx(size, 7, 8)] = bit(8) ? 1 : 0;
  for (let i = 9; i < 15; i++) m[idx(size, 14 - i, 8)] = bit(i) ? 1 : 0;
  for (let i = 0; i < 8; i++) m[idx(size, size - 1 - i, 8)] = bit(i) ? 1 : 0;
  for (let i = 8; i < 15; i++) m[idx(size, 8, size - 15 + i)] = bit(i) ? 1 : 0;
  m[idx(size, 8, size - 8)] = 1; // 暗模块
}

/** 生成完整二维码矩阵 */
function generateMatrix(text: string, level: EccLevel, fixedVersion?: number): { matrix: Matrix; size: number; version: number } {
  const versions = fixedVersion ? [fixedVersion] : [1, 2, 3];
  let chosen: VersionInfo | null = null;
  for (const v of versions) {
    const info = VERSION_TABLE[`${v}-${level}`];
    if (Buffer.from(text, "utf8").length <= info.byteCapacity) { chosen = info; break; }
  }
  if (!chosen) {
    throw new Error(`文本过长，版本 1-3 等级 ${level} 无法容纳 (最多 ${VERSION_TABLE[`3-${level}`].byteCapacity} 字节)`);
  }
  const codewords = encodeData(text, chosen.version, level);
  const { m, r } = makeMatrix(chosen.size);
  placeFinder(m, r, chosen.size, 0, 0);
  placeFinder(m, r, chosen.size, chosen.size - 7, 0);
  placeFinder(m, r, chosen.size, 0, chosen.size - 7);
  placeAlignment(m, r, chosen.size, chosen.alignCenters);
  placeTiming(m, r, chosen.size);
  reserveFormat(m, r, chosen.size);
  placeData(m, chosen.size, codewords);
  // 选择最佳掩码
  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix = m;
  for (let mk = 0; mk < 8; mk++) {
    const masked = applyMask(m, r, chosen.size, mk);
    placeFormatInfo(masked, chosen.size, level, mk);
    const sc = penaltyScore(masked, chosen.size);
    if (sc < bestScore) { bestScore = sc; bestMask = mk; bestMatrix = masked; }
  }
  placeFormatInfo(bestMatrix, chosen.size, level, bestMask);
  return { matrix: bestMatrix, size: chosen.size, version: chosen.version };
}

/** 渲染为 ASCII 字符串 */
function renderAscii(matrix: Matrix, size: number, invert: boolean): string {
  const dark = invert ? " " : "##";
  const light = invert ? "##" : "  ";
  const lines: string[] = [];
  // 顶部留白边
  lines.push(light.repeat(size + 4));
  for (let y = 0; y < size; y++) {
    let row = light;
    for (let x = 0; x < size; x++) {
      row += matrix[idx(size, x, y)] === 1 ? dark : light;
    }
    row += light;
    lines.push(row);
  }
  lines.push(light.repeat(size + 4));
  return lines.join("\n");
}

interface Options { level: EccLevel; version?: number; invert: boolean; }

function parseOpts(args: string[]): Options {
  const opts: Options = { level: "M", invert: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-l" || a === "--level") { const v = args[++i]?.toUpperCase(); if (v !== "L" && v !== "M") throw new Error("纠错等级仅支持 L 或 M"); opts.level = v; }
    else if (a === "-v" || a === "--version") { const v = parseInt(args[++i] ?? "", 10); if (v < 1 || v > 3) throw new Error("版本仅支持 1-3"); opts.version = v; }
    else if (a === "-i" || a === "--invert") opts.invert = true;
  }
  return opts;
}

function printHelp(): void {
  console.log(`
简易二维码生成器 (QR Code Generator)
====================================
纯 TypeScript 实现的二维码生成器，支持版本 1-3、字节模式、Reed-Solomon 纠错。

用法:
  qr-gen generate <text> [-l L|M] [-v 1|2|3] [-i]   生成二维码并在终端显示
  qr-gen save <text> <file> [-l L|M] [-v 1|2|3] [-i]  保存二维码为 ASCII 文本
  qr-gen help                                       显示本帮助

选项:
  -l, --level <L|M>      纠错等级 (默认 M)
  -v, --version <1|2|3>  指定版本 (默认自动选择最小可用版本)
  -i, --invert           反转黑白 (深色终端背景使用)

示例:
  qr-gen generate "Hello QR"
  qr-gen generate "你好，二维码" -l L
  qr-gen save "https://example.com" qrcode.txt -v 2
`);
}

function cmdGenerate(args: string[]): void {
  if (args.length === 0) { console.error("错误: 请提供要编码的文本"); process.exit(1); }
  const text = args[0];
  const opts = parseOpts(args.slice(1));
  const { matrix, size, version } = generateMatrix(text, opts.level, opts.version);
  console.log(`\n版本: ${version} | 等级: ${opts.level} | 尺寸: ${size}x${size}\n`);
  console.log(renderAscii(matrix, size, opts.invert));
}

function cmdSave(args: string[]): void {
  if (args.length < 2) { console.error("错误: 用法 save <text> <file> [选项]"); process.exit(1); }
  const text = args[0];
  const file = args[1];
  const opts = parseOpts(args.slice(2));
  const { matrix, size, version } = generateMatrix(text, opts.level, opts.version);
  const content = `# 二维码: "${text}"\n# 版本: ${version} | 等级: ${opts.level} | 尺寸: ${size}x${size}\n\n${renderAscii(matrix, size, opts.invert)}\n`;
  const outPath = path.resolve(file);
  fs.writeFileSync(outPath, content, "utf8");
  console.log(`已保存二维码到: ${outPath} (版本 ${version}, 等级 ${opts.level})`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "generate": cmdGenerate(rest); break;
      case "save": cmdSave(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'qr-gen help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
