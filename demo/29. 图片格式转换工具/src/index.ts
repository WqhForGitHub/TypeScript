#!/usr/bin/env node
/**
 * 图片格式转换工具 (Image Format Converter)
 *
 * 纯 TypeScript 实现，支持 PPM (P3/P6)、PGM (P2/P5)、PBM (P1/P4) 与
 * BMP (24 位) 格式的读取、写入、相互转换与最近邻缩放。
 *
 * 命令:
 *   info <file>                               显示图片格式、尺寸、像素数等信息
 *   convert <input> <output>                  按输出扩展名自动转换格式
 *   resize <input> <output> <WxH>             最近邻缩放并转换格式
 *   help                                      显示帮助
 *
 * 支持的扩展名: .ppm .pgm .pbm .bmp
 * 说明: 仅使用 Node.js 内置模块，无第三方图像库依赖。
 */

import * as fs from "fs";
import * as path from "path";

/** 统一的 RGB 图像表示 */
interface Image {
  width: number;
  height: number;
  data: Uint8Array; // 长度 = width * height * 3, 顺序 RGB
}

/** PNM 头部 token 读取器：跳过空白与注释 (# 到行尾) */
class TokenReader {
  private pos = 0;
  constructor(private buf: Buffer) {}
  nextToken(): string {
    const n = this.buf.length;
    // 跳过空白与注释
    while (this.pos < n) {
      const c = this.buf[this.pos];
      if (c === 0x23) { // '#'
        while (this.pos < n && this.buf[this.pos] !== 0x0a) this.pos++;
      } else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        this.pos++;
      } else break;
    }
    const start = this.pos;
    while (this.pos < n) {
      const c = this.buf[this.pos];
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x23) break;
      this.pos++;
    }
    return this.buf.toString("latin1", start, this.pos);
  }
  /** 读取 ASCII 整数 */
  nextInt(): number { return parseInt(this.nextToken(), 10); }
  /** 消费恰好一个空白字节 (用于二进制数据前的分隔符) */
  consumeOneWhitespace(): void { if (this.pos < this.buf.length) this.pos++; }
  get position(): number { return this.pos; }
  rest(): Buffer { return this.buf.subarray(this.pos); }
}

function rgbToGray(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

// ============ PNM 读取 ============

function readPnm(buf: Buffer): Image {
  const magic = buf.toString("latin1", 0, 2);
  const tr = new TokenReader(buf.subarray(2));
  const width = tr.nextInt();
  const height = tr.nextInt();
  let maxval = 1;
  if (magic === "P1" || magic === "P4") {
    // PBM 无 maxval
  } else {
    maxval = tr.nextInt();
  }
  const data = new Uint8Array(width * height * 3);
  const scale = maxval !== 255 && maxval > 0 ? 255 / maxval : 1;
  if (magic === "P3") { // ASCII RGB
    for (let i = 0; i < width * height; i++) {
      data[i * 3] = clampByte(tr.nextInt() * scale);
      data[i * 3 + 1] = clampByte(tr.nextInt() * scale);
      data[i * 3 + 2] = clampByte(tr.nextInt() * scale);
    }
  } else if (magic === "P6") { // 二进制 RGB
    tr.consumeOneWhitespace();
    const raw = tr.rest();
    for (let i = 0; i < width * height; i++) {
      data[i * 3] = clampByte(raw[i * 3] * scale);
      data[i * 3 + 1] = clampByte(raw[i * 3 + 1] * scale);
      data[i * 3 + 2] = clampByte(raw[i * 3 + 2] * scale);
    }
  } else if (magic === "P2") { // ASCII 灰度
    for (let i = 0; i < width * height; i++) {
      const g = clampByte(tr.nextInt() * scale);
      data[i * 3] = g; data[i * 3 + 1] = g; data[i * 3 + 2] = g;
    }
  } else if (magic === "P5") { // 二进制灰度
    tr.consumeOneWhitespace();
    const raw = tr.rest();
    for (let i = 0; i < width * height; i++) {
      const g = clampByte(raw[i] * scale);
      data[i * 3] = g; data[i * 3 + 1] = g; data[i * 3 + 2] = g;
    }
  } else if (magic === "P1") { // ASCII 位图 (1=黑, 0=白)
    for (let i = 0; i < width * height; i++) {
      const v = tr.nextInt();
      const c = v === 1 ? 0 : 255;
      data[i * 3] = c; data[i * 3 + 1] = c; data[i * 3 + 2] = c;
    }
  } else if (magic === "P4") { // 二进制位图
    tr.consumeOneWhitespace();
    const raw = tr.rest();
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIdx = y * rowBytes + Math.floor(x / 8);
        const bit = (raw[byteIdx] >> (7 - (x % 8))) & 1;
        const c = bit === 1 ? 0 : 255;
        const i = (y * width + x) * 3;
        data[i] = c; data[i + 1] = c; data[i + 2] = c;
      }
    }
  } else {
    throw new Error(`不支持的 PNM 类型: ${magic}`);
  }
  return { width, height, data };
}

// ============ PNM 写入 ============

function writePpm6(img: Image): Buffer {
  const header = Buffer.from(`P6\n${img.width} ${img.height}\n255\n`, "latin1");
  return Buffer.concat([header, Buffer.from(img.data)]);
}

function writePgm5(img: Image): Buffer {
  const gray = Buffer.alloc(img.width * img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    gray[i] = rgbToGray(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
  }
  const header = Buffer.from(`P5\n${img.width} ${img.height}\n255\n`, "latin1");
  return Buffer.concat([header, gray]);
}

function writePbm4(img: Image): Buffer {
  const rowBytes = Math.ceil(img.width / 8);
  const data = Buffer.alloc(rowBytes * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 3;
      const g = rgbToGray(img.data[idx], img.data[idx + 1], img.data[idx + 2]);
      const bit = g < 128 ? 1 : 0; // 1=黑
      if (bit) data[y * rowBytes + Math.floor(x / 8)] |= (0x80 >> (x % 8));
    }
  }
  const header = Buffer.from(`P4\n${img.width} ${img.height}\n`, "latin1");
  return Buffer.concat([header, data]);
}

// ============ BMP 24 位 读取/写入 ============

function readBmp(buf: Buffer): Image {
  if (buf.length < 54 || buf.toString("latin1", 0, 2) !== "BM") throw new Error("无效的 BMP 文件");
  const dataOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  let height = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (bpp !== 24) throw new Error(`仅支持 24 位 BMP，当前为 ${bpp} 位`);
  if (compression !== 0) throw new Error("不支持压缩 BMP");
  const topDown = height < 0;
  height = Math.abs(height);
  const rowSize = Math.floor((24 * width + 31) / 32) * 4; // 每行补齐到 4 字节
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : (height - 1 - y);
    const rowStart = dataOffset + srcY * rowSize;
    for (let x = 0; x < width; x++) {
      const off = rowStart + x * 3;
      const i = (y * width + x) * 3;
      data[i + 2] = buf[off];     // B
      data[i + 1] = buf[off + 1]; // G
      data[i] = buf[off + 2];     // R
    }
  }
  return { width, height, data };
}

function writeBmp(img: Image): Buffer {
  const rowSize = Math.floor((24 * img.width + 31) / 32) * 4;
  const padding = rowSize - img.width * 3;
  const imageSize = rowSize * img.height;
  const fileSize = 54 + imageSize;
  const buf = Buffer.alloc(fileSize, 0);
  buf.write("BM", 0, "latin1");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(dataOffset(), 10); // data offset = 54
  buf.writeUInt32LE(40, 14); // DIB size
  buf.writeInt32LE(img.width, 18);
  buf.writeInt32LE(img.height, 22); // 正数 = 自下而上
  buf.writeUInt16LE(1, 26);  // planes
  buf.writeUInt16LE(24, 28); // bpp
  buf.writeUInt32LE(0, 30);  // compression
  buf.writeUInt32LE(imageSize, 34);
  buf.writeUInt32LE(2835, 38); // x ppm (72 DPI)
  buf.writeUInt32LE(2835, 42); // y ppm
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);
  // 像素数据，自下而上 BGR
  let p = 54;
  for (let y = img.height - 1; y >= 0; y--) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      buf[p] = img.data[i + 2];     // B
      buf[p + 1] = img.data[i + 1]; // G
      buf[p + 2] = img.data[i];     // R
      p += 3;
    }
    p += padding;
  }
  return buf;
}
function dataOffset(): number { return 54; }

function clampByte(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

// ============ 格式识别与读写分发 ============

type Fmt = "ppm" | "pgm" | "pbm" | "bmp";

function detectFormatByExt(file: string): Fmt {
  const ext = path.extname(file).toLowerCase().slice(1);
  if (ext === "ppm" || ext === "pgm" || ext === "pbm" || ext === "bmp") return ext;
  throw new Error(`不支持的扩展名 .${ext}，仅支持 .ppm .pgm .pbm .bmp`);
}

function detectFormatByMagic(buf: Buffer): { fmt: Fmt; desc: string } {
  if (buf.length >= 2 && buf.toString("latin1", 0, 2) === "BM") return { fmt: "bmp", desc: "BMP 24位" };
  const m = buf.toString("latin1", 0, 2);
  const map: Record<string, { fmt: Fmt; desc: string }> = {
    P1: { fmt: "pbm", desc: "PBM ASCII (P1)" },
    P4: { fmt: "pbm", desc: "PBM 二进制 (P4)" },
    P2: { fmt: "pgm", desc: "PGM ASCII (P2)" },
    P5: { fmt: "pgm", desc: "PGM 二进制 (P5)" },
    P3: { fmt: "ppm", desc: "PPM ASCII (P3)" },
    P6: { fmt: "ppm", desc: "PPM 二进制 (P6)" },
  };
  if (map[m]) return map[m];
  throw new Error("无法识别的图片格式");
}

function readImage(buf: Buffer): Image {
  const { fmt } = detectFormatByMagic(buf);
  if (fmt === "bmp") return readBmp(buf);
  return readPnm(buf);
}

function writeImage(img: Image, fmt: Fmt): Buffer {
  switch (fmt) {
    case "ppm": return writePpm6(img);
    case "pgm": return writePgm5(img);
    case "pbm": return writePbm4(img);
    case "bmp": return writeBmp(img);
  }
}

/** 最近邻缩放 */
function resizeImage(img: Image, newW: number, newH: number): Image {
  const data = new Uint8Array(newW * newH * 3);
  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(img.height - 1, Math.floor((y / newH) * img.height));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(img.width - 1, Math.floor((x / newW) * img.width));
      const si = (srcY * img.width + srcX) * 3;
      const di = (y * newW + x) * 3;
      data[di] = img.data[si];
      data[di + 1] = img.data[si + 1];
      data[di + 2] = img.data[si + 2];
    }
  }
  return { width: newW, height: newH, data };
}

function formatSize(bytes: number): string {
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + u[i];
}

function cmdInfo(args: string[]): void {
  if (!args[0]) { console.error("错误: 用法 info <file>"); process.exit(1); }
  const file = args[0];
  if (!fs.existsSync(file)) { console.error(`错误: 文件不存在: ${file}`); process.exit(1); }
  const buf = fs.readFileSync(file);
  const { desc } = detectFormatByMagic(buf);
  const img = readImage(buf);
  console.log(`\n图片信息: ${path.resolve(file)}`);
  console.log("=".repeat(40));
  console.log(`格式:      ${desc}`);
  console.log(`尺寸:      ${img.width} x ${img.height} 像素`);
  console.log(`总像素:    ${img.width * img.height}`);
  console.log(`文件大小:  ${formatSize(buf.length)} (${buf.length} 字节)`);
  console.log(`原始数据:  ${formatSize(img.data.length)} (未压缩 RGB)`);
  // 采样几个像素
  console.log(`\n像素采样 (左上、中心、右下):`);
  const sample = (x: number, y: number) => {
    const i = (y * img.width + x) * 3;
    return `RGB(${img.data[i]}, ${img.data[i + 1]}, ${img.data[i + 2]})`;
  };
  console.log(`  左上 (0,0):       ${sample(0, 0)}`);
  console.log(`  中心 (${Math.floor(img.width / 2)},${Math.floor(img.height / 2)}): ${sample(Math.floor(img.width / 2), Math.floor(img.height / 2))}`);
  console.log(`  右下 (${img.width - 1},${img.height - 1}): ${sample(img.width - 1, img.height - 1)}`);
  console.log("");
}

function cmdConvert(args: string[]): void {
  if (args.length < 2) { console.error("错误: 用法 convert <input> <output>"); process.exit(1); }
  const [input, output] = args;
  if (!fs.existsSync(input)) { console.error(`错误: 文件不存在: ${input}`); process.exit(1); }
  const inBuf = fs.readFileSync(input);
  const inFmt = detectFormatByMagic(inBuf);
  const img = readImage(inBuf);
  const outFmt = detectFormatByExt(output);
  const outBuf = writeImage(img, outFmt);
  fs.writeFileSync(output, outBuf);
  console.log(`\x1b[32m转换完成: ${path.resolve(input)} (${inFmt.desc}) -> ${path.resolve(output)} (${outFmt.toUpperCase()})\x1b[0m`);
  console.log(`尺寸: ${img.width}x${img.height}, 输出大小: ${formatSize(outBuf.length)}`);
}

function cmdResize(args: string[]): void {
  if (args.length < 3) { console.error("错误: 用法 resize <input> <output> <WxH>"); process.exit(1); }
  const [input, output, sizeStr] = args;
  const m = sizeStr.match(/^(\d+)x(\d+)$/i);
  if (!m) { console.error(`错误: 尺寸格式应为 WxH，如 100x80`); process.exit(1); }
  const newW = parseInt(m[1], 10);
  const newH = parseInt(m[2], 10);
  if (newW < 1 || newH < 1) { console.error("错误: 尺寸必须为正整数"); process.exit(1); }
  if (!fs.existsSync(input)) { console.error(`错误: 文件不存在: ${input}`); process.exit(1); }
  const img = readImage(fs.readFileSync(input));
  const resized = resizeImage(img, newW, newH);
  const outFmt = detectFormatByExt(output);
  const outBuf = writeImage(resized, outFmt);
  fs.writeFileSync(output, outBuf);
  console.log(`\x1b[32m缩放完成: ${img.width}x${img.height} -> ${newW}x${newH}\x1b[0m`);
  console.log(`输出: ${path.resolve(output)} (${outFmt.toUpperCase()}, ${formatSize(outBuf.length)})`);
}

function printHelp(): void {
  console.log(`
图片格式转换工具 (Image Format Converter)
=========================================
支持 PPM (P3/P6)、PGM (P2/P5)、PBM (P1/P4) 与 BMP (24 位) 格式。

用法:
  imgconv info <file>                        显示图片格式、尺寸、像素信息
  imgconv convert <input> <output>           按扩展名转换格式
  imgconv resize <input> <output> <WxH>      最近邻缩放并转换格式
  imgconv help                               显示本帮助

支持的扩展名: .ppm .pgm .pbm .bmp

示例:
  imgconv info photo.bmp
  imgconv convert input.bmp output.ppm
  imgconv convert image.ppm thumb.pgm
  imgconv resize big.ppm small.bmp 100x80
  imgconv convert pic.pgm pic.pbm

说明: 输出 PPM 用 P6 (二进制)，PGM 用 P5，PBM 用 P4，BMP 为 24 位。
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "info": cmdInfo(rest); break;
      case "convert": cmdConvert(rest); break;
      case "resize": cmdResize(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'imgconv help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
