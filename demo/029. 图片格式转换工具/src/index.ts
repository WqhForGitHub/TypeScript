#!/usr/bin/env node
/**
 * 图片格式转换工具 (Image Format Converter) — Enhanced Edition
 *
 * 纯 TypeScript 实现，支持 PPM (P3/P6)、PGM (P2/P5)、PBM (P1/P4) 与
 * BMP (24 位) 格式的读取、写入、相互转换、缩放、旋转、翻转、亮度/对比度、
 * 通道提取、直方图与均衡化、缩略图、图片对比以及批量转换。
 * 仅使用 Node.js 内置模块 (fs / path)，无第三方图像库依赖。
 */

import * as fs from "fs";
import * as path from "path";

// ============================ Enums ============================
enum ImageFormat {
  PPM = "ppm",
  PGM = "pgm",
  PBM = "pbm",
  BMP = "bmp",
}
enum ColorDepth {
  Bit1 = 1,
  Gray8 = 8,
  Rgb24 = 24,
}
enum ScaleAlgorithm {
  Nearest = "nearest",
  Bilinear = "bilinear",
  Bicubic = "bicubic",
}
enum ConversionMode {
  Auto = "auto",
  Force = "force",
}
enum PixelChannel {
  Red = 0,
  Green = 1,
  Blue = 2,
}
enum Rotation {
  Deg90 = 90,
  Deg180 = 180,
  Deg270 = 270,
}
enum FlipAxis {
  Horizontal = "h",
  Vertical = "v",
}

// ============ Template literal & conditional types ============
type PnmMagic = `P${number}`;
type ChannelCount<T extends ImageFormat> = T extends
  ImageFormat.PBM | ImageFormat.PGM
  ? 1
  : 3;

// ===================== Discriminated unions =====================
interface RgbPixel {
  readonly kind: "rgb";
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
interface GrayPixel {
  readonly kind: "gray";
  readonly v: number;
}
interface BitPixel {
  readonly kind: "bit";
  readonly on: boolean;
}
type Pixel = RgbPixel | GrayPixel | BitPixel;
type PixelOf<T extends ImageFormat> = T extends ImageFormat.PBM
  ? BitPixel
  : T extends ImageFormat.PGM
    ? GrayPixel
    : RgbPixel;

interface PpmHeader {
  readonly format: ImageFormat.PPM;
  readonly magic: PnmMagic;
  readonly width: number;
  readonly height: number;
  readonly maxval: number;
  readonly binary: boolean;
}
interface PgmHeader {
  readonly format: ImageFormat.PGM;
  readonly magic: PnmMagic;
  readonly width: number;
  readonly height: number;
  readonly maxval: number;
  readonly binary: boolean;
}
interface PbmHeader {
  readonly format: ImageFormat.PBM;
  readonly magic: PnmMagic;
  readonly width: number;
  readonly height: number;
  readonly binary: boolean;
}
interface BmpHeader {
  readonly format: ImageFormat.BMP;
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
  readonly topDown: boolean;
  readonly dataOffset: number;
}
type ImageHeader = PpmHeader | PgmHeader | PbmHeader | BmpHeader;

// ===================== Tuples / readonly tuples =====================
type RgbTriple = readonly [number, number, number];
type Coord = readonly [number, number];

// ===================== Type guards =====================
const isImageFormat = (v: unknown): v is ImageFormat =>
  typeof v === "string" &&
  (Object.values(ImageFormat) as readonly string[]).includes(v);
const isPpm = (h: ImageHeader): h is PpmHeader => h.format === ImageFormat.PPM;
const isPgm = (h: ImageHeader): h is PgmHeader => h.format === ImageFormat.PGM;
const isPbm = (h: ImageHeader): h is PbmHeader => h.format === ImageFormat.PBM;
const isBmp = (h: ImageHeader): h is BmpHeader => h.format === ImageFormat.BMP;
const isRgbPixel = (p: Pixel): p is RgbPixel => p.kind === "rgb";
const isGrayPixel = (p: Pixel): p is GrayPixel => p.kind === "gray";

// ===================== Custom error hierarchy =====================
class ImageError extends Error {
  constructor(
    message: string,
    public readonly code: string = "IMAGE_ERROR",
  ) {
    super(message);
    this.name = "ImageError";
  }
}
class FormatError extends ImageError {
  constructor(m: string) {
    super(m, "FORMAT");
    this.name = "FormatError";
  }
}
class CorruptImageError extends ImageError {
  constructor(m: string) {
    super(m, "CORRUPT");
    this.name = "CorruptImageError";
  }
}
class UnsupportedFormatError extends ImageError {
  constructor(m: string) {
    super(m, "UNSUPPORTED");
    this.name = "UnsupportedFormatError";
  }
}

// ===================== Symbol protocols =====================
const PIXEL_ITERATOR = Symbol("pixelIterator");
const LINE_SCANNER = Symbol("lineScanner");

// ===================== Interfaces / utility types =====================
interface WriteOptions {
  readonly quality?: number;
  readonly binary?: boolean;
  readonly comment?: string;
}
interface ImageMeta {
  readonly createdAt: number;
  readonly source?: string;
  [key: string]: string | number | undefined;
}

interface ImageBuffer<T extends ImageFormat = ImageFormat> {
  readonly format: T;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array; // length = width * height * 3, 顺序 RGB
  readonly colorDepth: ColorDepth;
  readonly header?: ImageHeader;
  [PIXEL_ITERATOR](): IterableIterator<RgbPixel>;
  [LINE_SCANNER](): IterableIterator<Uint8Array>;
}
interface PixelAccessor<T extends ImageFormat> {
  get(x: number, y: number): PixelOf<T>;
  set(x: number, y: number, p: PixelOf<T>): void;
}
type ImageDims = Pick<ImageBuffer, "width" | "height">;
type ImageCore = Omit<ImageBuffer, "data">;
type ReaderResult = ReturnType<AbstractImageReader["read"]>;

// ===================== Mapped type + satisfies =====================
interface FormatHandlerInfo<T extends ImageFormat> {
  readonly format: T;
  readonly exts: readonly string[];
  readonly desc: string;
  readonly channels: ChannelCount<T>;
  readonly depth: ColorDepth;
}
type FormatHandler = { [K in ImageFormat]: FormatHandlerInfo<K> };

const FORMAT_HANDLERS = {
  ppm: {
    format: ImageFormat.PPM,
    exts: [".ppm"],
    desc: "PPM P3/P6",
    channels: 3,
    depth: ColorDepth.Rgb24,
  },
  pgm: {
    format: ImageFormat.PGM,
    exts: [".pgm"],
    desc: "PGM P2/P5",
    channels: 1,
    depth: ColorDepth.Gray8,
  },
  pbm: {
    format: ImageFormat.PBM,
    exts: [".pbm"],
    desc: "PBM P1/P4",
    channels: 1,
    depth: ColorDepth.Bit1,
  },
  bmp: {
    format: ImageFormat.BMP,
    exts: [".bmp"],
    desc: "BMP 24-bit",
    channels: 3,
    depth: ColorDepth.Rgb24,
  },
} as const satisfies FormatHandler;

// ===================== Helpers =====================
function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
function rgbToGray(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
function cubicKernel(x: number): number {
  const a = Math.abs(x);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}
function defaultDepth(f: ImageFormat): ColorDepth {
  return f === ImageFormat.PBM
    ? ColorDepth.Bit1
    : f === ImageFormat.PGM
      ? ColorDepth.Gray8
      : ColorDepth.Rgb24;
}
function formatSize(bytes: number): string {
  const u = ["B", "KB", "MB", "GB"] as const;
  const i = Math.min(
    u.length - 1,
    Math.floor(Math.log(bytes || 1) / Math.log(1024)),
  );
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + u[i];
}
const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;
type ColorName = keyof typeof COLORS;
function color(s: string, c: ColorName): string {
  return `${COLORS[c]}${s}${COLORS.reset}`;
}
function die(msg: string): never {
  console.error(color(`错误: ${msg}`, "red"));
  process.exit(1);
}
function summarize(img: ImageCore): string {
  return `${img.width}x${img.height} ${FORMAT_HANDLERS[img.format].desc} (${img.colorDepth}bit)`;
}

// ===================== Token reader (PNM) =====================
class TokenReader {
  private pos = 0;
  constructor(private buf: Buffer) {}
  nextToken(): string {
    const n = this.buf.length;
    while (this.pos < n) {
      const c = this.buf[this.pos];
      if (c === 0x23) {
        while (this.pos < n && this.buf[this.pos] !== 0x0a) this.pos++;
      } else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d)
        this.pos++;
      else break;
    }
    const start = this.pos;
    while (this.pos < n) {
      const c = this.buf[this.pos];
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x23)
        break;
      this.pos++;
    }
    return this.buf.toString("latin1", start, this.pos);
  }
  nextInt(): number {
    return parseInt(this.nextToken(), 10);
  }
  consumeOneWhitespace(): void {
    if (this.pos < this.buf.length) this.pos++;
  }
  rest(): Buffer {
    return this.buf.subarray(this.pos);
  }
}

// ===================== Generic image buffer =====================
class BasicImage<T extends ImageFormat> implements ImageBuffer<T> {
  readonly format: T;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly colorDepth: ColorDepth;
  readonly header?: ImageHeader;
  constructor(
    format: T,
    width: number,
    height: number,
    data: Uint8Array,
    colorDepth?: ColorDepth,
    header?: ImageHeader,
  ) {
    this.format = format;
    this.width = width;
    this.height = height;
    this.data = data;
    this.colorDepth = colorDepth ?? defaultDepth(format);
    this.header = header;
  }
  *[PIXEL_ITERATOR](): IterableIterator<RgbPixel> {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 3;
        yield {
          kind: "rgb",
          r: this.data[i],
          g: this.data[i + 1],
          b: this.data[i + 2],
        };
      }
  }
  *[LINE_SCANNER](): IterableIterator<Uint8Array> {
    for (let y = 0; y < this.height; y++)
      yield this.data.subarray(y * this.width * 3, (y + 1) * this.width * 3);
  }
}

function makeAccessor<T extends ImageFormat>(
  img: ImageBuffer<T>,
): PixelAccessor<T> {
  return {
    get: (x, y) => {
      const i = (y * img.width + x) * 3;
      return {
        kind: "rgb",
        r: img.data[i],
        g: img.data[i + 1],
        b: img.data[i + 2],
      } as PixelOf<T>;
    },
    set: (x, y, p) => {
      const i = (y * img.width + x) * 3;
      if (isRgbPixel(p)) {
        img.data[i] = p.r;
        img.data[i + 1] = p.g;
        img.data[i + 2] = p.b;
      } else if (isGrayPixel(p)) {
        img.data[i] = p.v;
        img.data[i + 1] = p.v;
        img.data[i + 2] = p.v;
      } else {
        const c = p.on ? 0 : 255;
        img.data[i] = c;
        img.data[i + 1] = c;
        img.data[i + 2] = c;
      }
    },
  };
}

// ===================== Abstract readers =====================
abstract class AbstractImageReader {
  abstract canRead(buf: Buffer): boolean;
  abstract read(buf: Buffer): ImageBuffer;
  protected require(cond: boolean, msg: string): void {
    if (!cond) throw new CorruptImageError(msg);
  }
}

class PnmReader extends AbstractImageReader {
  canRead(buf: Buffer): boolean {
    return buf.length >= 2 && /^P[1-6]$/.test(buf.toString("latin1", 0, 2));
  }
  read(buf: Buffer): ImageBuffer {
    const magic = buf.toString("latin1", 0, 2) as PnmMagic;
    const tr = new TokenReader(buf.subarray(2));
    const width = tr.nextInt();
    const height = tr.nextInt();
    let maxval = 1;
    if (magic !== "P1" && magic !== "P4") maxval = tr.nextInt();
    const binary = magic === "P4" || magic === "P5" || magic === "P6";
    const base = { magic, width, height, binary };
    let header: ImageHeader;
    if (magic === "P1" || magic === "P4")
      header = { format: ImageFormat.PBM, ...base } as PbmHeader;
    else if (magic === "P2" || magic === "P5")
      header = { format: ImageFormat.PGM, ...base, maxval } as PgmHeader;
    else header = { format: ImageFormat.PPM, ...base, maxval } as PpmHeader;
    if (isPpm(header)) return this.decodePpm(header, tr);
    if (isPgm(header)) return this.decodePgm(header, tr);
    return this.decodePbm(header as PbmHeader, tr);
  }
  private decodePpm(h: PpmHeader, tr: TokenReader): ImageBuffer {
    const { width: w, height: ht, maxval } = h;
    const data = new Uint8Array(w * ht * 3);
    const scale = maxval !== 255 && maxval > 0 ? 255 / maxval : 1;
    if (h.binary) {
      tr.consumeOneWhitespace();
      const raw = tr.rest();
      for (let i = 0; i < w * ht; i++) {
        data[i * 3] = clampByte(raw[i * 3] * scale);
        data[i * 3 + 1] = clampByte(raw[i * 3 + 1] * scale);
        data[i * 3 + 2] = clampByte(raw[i * 3 + 2] * scale);
      }
    } else {
      for (let i = 0; i < w * ht; i++) {
        data[i * 3] = clampByte(tr.nextInt() * scale);
        data[i * 3 + 1] = clampByte(tr.nextInt() * scale);
        data[i * 3 + 2] = clampByte(tr.nextInt() * scale);
      }
    }
    return new BasicImage(h.format, w, ht, data, undefined, h);
  }
  private decodePgm(h: PgmHeader, tr: TokenReader): ImageBuffer {
    const { width: w, height: ht, maxval } = h;
    const data = new Uint8Array(w * ht * 3);
    const scale = maxval !== 255 && maxval > 0 ? 255 / maxval : 1;
    if (h.binary) {
      tr.consumeOneWhitespace();
      const raw = tr.rest();
      for (let i = 0; i < w * ht; i++) {
        const g = clampByte(raw[i] * scale);
        data[i * 3] = g;
        data[i * 3 + 1] = g;
        data[i * 3 + 2] = g;
      }
    } else {
      for (let i = 0; i < w * ht; i++) {
        const g = clampByte(tr.nextInt() * scale);
        data[i * 3] = g;
        data[i * 3 + 1] = g;
        data[i * 3 + 2] = g;
      }
    }
    return new BasicImage(h.format, w, ht, data, undefined, h);
  }
  private decodePbm(h: PbmHeader, tr: TokenReader): ImageBuffer {
    const { width: w, height: ht, binary } = h;
    const data = new Uint8Array(w * ht * 3);
    if (binary) {
      tr.consumeOneWhitespace();
      const raw = tr.rest();
      const rowBytes = Math.ceil(w / 8);
      for (let y = 0; y < ht; y++)
        for (let x = 0; x < w; x++) {
          const bit =
            (raw[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
          const c = bit === 1 ? 0 : 255,
            i = (y * w + x) * 3;
          data[i] = c;
          data[i + 1] = c;
          data[i + 2] = c;
        }
    } else {
      for (let i = 0; i < w * ht; i++) {
        const c = tr.nextInt() === 1 ? 0 : 255;
        data[i * 3] = c;
        data[i * 3 + 1] = c;
        data[i * 3 + 2] = c;
      }
    }
    return new BasicImage(h.format, w, ht, data, undefined, h);
  }
}

class BmpReader extends AbstractImageReader {
  canRead(buf: Buffer): boolean {
    return buf.length >= 2 && buf.toString("latin1", 0, 2) === "BM";
  }
  read(buf: Buffer): ImageBuffer {
    this.require(buf.length >= 54, "BMP 文件过小");
    this.require(buf.toString("latin1", 0, 2) === "BM", "无效的 BMP 签名");
    const dataOffset = buf.readUInt32LE(10);
    const width = buf.readInt32LE(18);
    let height = buf.readInt32LE(22);
    const bpp = buf.readUInt16LE(28);
    const compression = buf.readUInt32LE(30);
    if (bpp !== 24)
      throw new UnsupportedFormatError(`仅支持 24 位 BMP，当前为 ${bpp} 位`);
    if (compression !== 0) throw new UnsupportedFormatError("不支持压缩 BMP");
    const topDown = height < 0;
    height = Math.abs(height);
    const header: BmpHeader = {
      format: ImageFormat.BMP,
      width,
      height,
      bpp,
      topDown,
      dataOffset,
    };
    if (!isBmp(header)) throw new CorruptImageError("BMP 头解析失败");
    const rowSize = Math.floor((24 * width + 31) / 32) * 4;
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : height - 1 - y;
      const rowStart = dataOffset + srcY * rowSize;
      for (let x = 0; x < width; x++) {
        const off = rowStart + x * 3,
          i = (y * width + x) * 3;
        data[i + 2] = buf[off];
        data[i + 1] = buf[off + 1];
        data[i] = buf[off + 2];
      }
    }
    return new BasicImage(
      ImageFormat.BMP,
      width,
      height,
      data,
      undefined,
      header,
    );
  }
}

// ===================== Abstract writers =====================
abstract class AbstractImageWriter {
  abstract readonly format: ImageFormat;
  abstract write(img: ImageBuffer, opts?: Partial<WriteOptions>): Buffer;
}
class PpmWriter extends AbstractImageWriter {
  readonly format = ImageFormat.PPM;
  write(img: ImageBuffer): Buffer {
    return Buffer.concat([
      Buffer.from(`P6\n${img.width} ${img.height}\n255\n`, "latin1"),
      Buffer.from(img.data),
    ]);
  }
}
class PgmWriter extends AbstractImageWriter {
  readonly format = ImageFormat.PGM;
  write(img: ImageBuffer): Buffer {
    const gray = Buffer.alloc(img.width * img.height);
    for (let i = 0; i < img.width * img.height; i++)
      gray[i] = rgbToGray(
        img.data[i * 3],
        img.data[i * 3 + 1],
        img.data[i * 3 + 2],
      );
    return Buffer.concat([
      Buffer.from(`P5\n${img.width} ${img.height}\n255\n`, "latin1"),
      gray,
    ]);
  }
}
class PbmWriter extends AbstractImageWriter {
  readonly format = ImageFormat.PBM;
  write(img: ImageBuffer): Buffer {
    const rowBytes = Math.ceil(img.width / 8);
    const data = Buffer.alloc(rowBytes * img.height);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const idx = (y * img.width + x) * 3;
        const g = rgbToGray(
          img.data[idx],
          img.data[idx + 1],
          img.data[idx + 2],
        );
        if (g < 128) data[y * rowBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    return Buffer.concat([
      Buffer.from(`P4\n${img.width} ${img.height}\n`, "latin1"),
      data,
    ]);
  }
}
class BmpWriter extends AbstractImageWriter {
  readonly format = ImageFormat.BMP;
  write(img: ImageBuffer): Buffer {
    const rowSize = Math.floor((24 * img.width + 31) / 32) * 4;
    const padding = rowSize - img.width * 3;
    const imageSize = rowSize * img.height;
    const buf = Buffer.alloc(54 + imageSize, 0);
    buf.write("BM", 0, "latin1");
    buf.writeUInt32LE(54 + imageSize, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(img.width, 18);
    buf.writeInt32LE(img.height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(0, 30);
    buf.writeUInt32LE(imageSize, 34);
    buf.writeUInt32LE(2835, 38);
    buf.writeUInt32LE(2835, 42);
    let p = 54;
    for (let y = img.height - 1; y >= 0; y--) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 3;
        buf[p] = img.data[i + 2];
        buf[p + 1] = img.data[i + 1];
        buf[p + 2] = img.data[i];
        p += 3;
      }
      p += padding;
    }
    return buf;
  }
}

// ===================== Abstract scalers =====================
abstract class AbstractScaler {
  abstract readonly algorithm: ScaleAlgorithm;
  abstract scale(img: ImageBuffer, newW: number, newH: number): ImageBuffer;
  protected sample(img: ImageBuffer, x: number, y: number): RgbTriple {
    const xi = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
    const yi = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
    const i = (yi * img.width + xi) * 3;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }
}
class NearestNeighborScaler extends AbstractScaler {
  readonly algorithm = ScaleAlgorithm.Nearest;
  scale(img: ImageBuffer, nw: number, nh: number): ImageBuffer {
    const out = new Uint8Array(nw * nh * 3);
    for (let y = 0; y < nh; y++) {
      const sy = Math.min(img.height - 1, Math.floor((y / nh) * img.height));
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(img.width - 1, Math.floor((x / nw) * img.width));
        const si = (sy * img.width + sx) * 3,
          di = (y * nw + x) * 3;
        out[di] = img.data[si];
        out[di + 1] = img.data[si + 1];
        out[di + 2] = img.data[si + 2];
      }
    }
    return new BasicImage(img.format, nw, nh, out, img.colorDepth);
  }
}
class BilinearScaler extends AbstractScaler {
  readonly algorithm = ScaleAlgorithm.Bilinear;
  scale(img: ImageBuffer, nw: number, nh: number): ImageBuffer {
    const out = new Uint8Array(nw * nh * 3);
    const sx = (img.width - 1) / Math.max(1, nw - 1),
      sy = (img.height - 1) / Math.max(1, nh - 1);
    for (let y = 0; y < nh; y++) {
      const fy = y * sy,
        y0 = Math.floor(fy),
        y1 = Math.min(img.height - 1, y0 + 1),
        wy = fy - y0;
      for (let x = 0; x < nw; x++) {
        const fx = x * sx,
          x0 = Math.floor(fx),
          x1 = Math.min(img.width - 1, x0 + 1),
          wx = fx - x0;
        const c00 = this.sample(img, x0, y0),
          c10 = this.sample(img, x1, y0);
        const c01 = this.sample(img, x0, y1),
          c11 = this.sample(img, x1, y1);
        const di = (y * nw + x) * 3;
        for (let c = 0; c < 3; c++) {
          const top = c00[c] * (1 - wx) + c10[c] * wx,
            bot = c01[c] * (1 - wx) + c11[c] * wx;
          out[di + c] = clampByte(top * (1 - wy) + bot * wy);
        }
      }
    }
    return new BasicImage(img.format, nw, nh, out, img.colorDepth);
  }
}
class BicubicScaler extends AbstractScaler {
  readonly algorithm = ScaleAlgorithm.Bicubic;
  scale(img: ImageBuffer, nw: number, nh: number): ImageBuffer {
    const out = new Uint8Array(nw * nh * 3);
    const sx = img.width / nw,
      sy = img.height / nh;
    for (let y = 0; y < nh; y++) {
      const fy = (y + 0.5) * sy - 0.5,
        iy = Math.floor(fy);
      for (let x = 0; x < nw; x++) {
        const fx = (x + 0.5) * sx - 0.5,
          ix = Math.floor(fx);
        let r = 0,
          g = 0,
          b = 0;
        for (let m = -1; m <= 2; m++) {
          const wy = cubicKernel(fy - (iy + m));
          for (let n = -1; n <= 2; n++) {
            const w = cubicKernel(fx - (ix + n)) * wy;
            const [pr, pg, pb] = this.sample(img, ix + n, iy + m);
            r += pr * w;
            g += pg * w;
            b += pb * w;
          }
        }
        const di = (y * nw + x) * 3;
        out[di] = clampByte(r);
        out[di + 1] = clampByte(g);
        out[di + 2] = clampByte(b);
      }
    }
    return new BasicImage(img.format, nw, nh, out, img.colorDepth);
  }
}

// ===================== Registries =====================
const READERS: readonly AbstractImageReader[] = [
  new PnmReader(),
  new BmpReader(),
];
const WRITERS = {
  ppm: new PpmWriter(),
  pgm: new PgmWriter(),
  pbm: new PbmWriter(),
  bmp: new BmpWriter(),
} satisfies Record<ImageFormat, AbstractImageWriter>;
const SCALERS = {
  nearest: new NearestNeighborScaler(),
  bilinear: new BilinearScaler(),
  bicubic: new BicubicScaler(),
} satisfies Record<ScaleAlgorithm, AbstractScaler>;

// ===================== Image operations =====================
function convert<T extends ImageFormat>(
  img: ImageBuffer,
  target: T,
  mode?: ConversionMode,
): ImageBuffer<T>;
function convert(
  img: ImageBuffer,
  target: ImageFormat,
  mode?: ConversionMode,
): ImageBuffer;
function convert(
  img: ImageBuffer,
  target: ImageFormat,
  _mode: ConversionMode = ConversionMode.Auto,
): ImageBuffer {
  return new BasicImage(target, img.width, img.height, img.data);
}
function scale(img: ImageBuffer, w: number, h: number): ImageBuffer;
function scale(
  img: ImageBuffer,
  w: number,
  h: number,
  algo: ScaleAlgorithm,
): ImageBuffer;
function scale(
  img: ImageBuffer,
  w: number,
  h: number,
  algo: ScaleAlgorithm = ScaleAlgorithm.Nearest,
): ImageBuffer {
  return SCALERS[algo].scale(img, w, h);
}
function flip(img: ImageBuffer, axis: FlipAxis): ImageBuffer {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = axis === FlipAxis.Horizontal ? w - 1 - x : x;
      const sy = axis === FlipAxis.Vertical ? h - 1 - y : y;
      const si = (sy * w + sx) * 3,
        di = (y * w + x) * 3;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
    }
  return new BasicImage(img.format, w, h, out, img.colorDepth);
}
function rotate(img: ImageBuffer, deg: Rotation): ImageBuffer {
  if (deg === Rotation.Deg180)
    return flip(flip(img, FlipAxis.Horizontal), FlipAxis.Vertical);
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(h * w * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = deg === Rotation.Deg90 ? h - 1 - y : y;
      const ny = deg === Rotation.Deg90 ? x : w - 1 - x;
      const si = (y * w + x) * 3,
        di = (ny * h + nx) * 3;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
    }
  return new BasicImage(img.format, h, w, out, img.colorDepth);
}
function adjustBrightness(img: ImageBuffer, delta: number): ImageBuffer {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i++)
    out[i] = clampByte(img.data[i] + delta);
  return new BasicImage(img.format, img.width, img.height, out, img.colorDepth);
}
function adjustContrast(img: ImageBuffer, factor: number): ImageBuffer {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i++)
    out[i] = clampByte((img.data[i] - 128) * factor + 128);
  return new BasicImage(img.format, img.width, img.height, out, img.colorDepth);
}
function extractChannel(img: ImageBuffer, ch: PixelChannel): ImageBuffer {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const v = img.data[i * 3 + ch];
    out[i * 3] = ch === PixelChannel.Red ? v : 0;
    out[i * 3 + 1] = ch === PixelChannel.Green ? v : 0;
    out[i * 3 + 2] = ch === PixelChannel.Blue ? v : 0;
  }
  return new BasicImage(img.format, img.width, img.height, out, img.colorDepth);
}
function histogram(img: ImageBuffer): Record<number, number> {
  const h: Record<number, number> = {};
  for (let g = 0; g < 256; g++) h[g] = 0;
  for (const p of img[PIXEL_ITERATOR]()) h[rgbToGray(p.r, p.g, p.b)]++;
  return h;
}
function equalize(img: ImageBuffer): ImageBuffer {
  const hist = histogram(img);
  const total = img.width * img.height;
  const cdf: number[] = new Array(256).fill(0);
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += hist[i] ?? 0;
    cdf[i] = sum;
  }
  const cdfMin = cdf.find((v) => v > 0) ?? 0;
  const denom = total - cdfMin;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++)
    lut[i] =
      denom > 0 ? clampByte(Math.round(((cdf[i] - cdfMin) / denom) * 255)) : i;
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) out[i] = lut[img.data[i]];
  return new BasicImage(img.format, img.width, img.height, out, img.colorDepth);
}
function compare(
  a: ImageBuffer,
  b: ImageBuffer,
): { dimMatch: boolean; diffPercent: number } {
  const dimMatch = a.width === b.width && a.height === b.height;
  if (!dimMatch) return { dimMatch: false, diffPercent: 100 };
  let diff = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i++) if (a.data[i] !== b.data[i]) diff++;
  return { dimMatch: true, diffPercent: n === 0 ? 0 : (diff / n) * 100 };
}
function makeThumbnail(img: ImageBuffer, max: number): ImageBuffer {
  const r = Math.min(max / img.width, max / img.height);
  return scale(
    img,
    Math.max(1, Math.round(img.width * r)),
    Math.max(1, Math.round(img.height * r)),
    ScaleAlgorithm.Bilinear,
  );
}
function describeHeader(h: ImageHeader): string {
  if (isPpm(h))
    return `PPM ${h.binary ? "bin" : "asc"} ${h.width}x${h.height} max=${h.maxval}`;
  if (isPgm(h))
    return `PGM ${h.binary ? "bin" : "asc"} ${h.width}x${h.height} max=${h.maxval}`;
  if (isPbm(h)) return `PBM ${h.binary ? "bin" : "asc"} ${h.width}x${h.height}`;
  if (isBmp(h))
    return `BMP ${h.width}x${h.height} ${h.bpp}bpp ${h.topDown ? "top-down" : "bottom-up"}`;
  throw new ImageError("未知头部");
}

// ===================== Stats / progress (getters & setters) =====================
class ImageStats {
  private _brightness: number;
  readonly histogram: Readonly<Record<number, number>>;
  readonly count: number;
  constructor(hist: Record<number, number>) {
    this.histogram = hist;
    let sum = 0,
      n = 0;
    for (let g = 0; g < 256; g++) {
      sum += g * (hist[g] ?? 0);
      n += hist[g] ?? 0;
    }
    this.count = n;
    this._brightness = n > 0 ? sum / n : 0;
  }
  get brightness(): number {
    return this._brightness;
  }
  set brightness(v: number) {
    this._brightness = Math.max(0, Math.min(255, v));
  }
  get entropy(): number {
    let e = 0;
    for (let g = 0; g < 256; g++) {
      const p = (this.histogram[g] ?? 0) / (this.count || 1);
      if (p > 0) e -= p * Math.log2(p);
    }
    return e;
  }
}
class ProgressReporter {
  private _total = 0;
  private _current = 0;
  private readonly _onProgress?: (
    cur: number,
    total: number,
    msg?: string,
  ) => void;
  constructor(onProgress?: (cur: number, total: number, msg?: string) => void) {
    this._onProgress = onProgress;
  }
  get total(): number {
    return this._total;
  }
  set total(v: number) {
    this._total = v;
  }
  get current(): number {
    return this._current;
  }
  get progress(): number {
    return this._total === 0 ? 0 : this._current / this._total;
  }
  tick(msg?: string): void {
    this._current++;
    this._onProgress?.(this._current, this._total, msg);
  }
  reset(): void {
    this._current = 0;
    this._total = 0;
  }
}

// ===================== Format detection / IO =====================
function parseFormat(s: string): ImageFormat {
  const v = s.toLowerCase().replace(/^\./, "");
  if (isImageFormat(v)) return v;
  throw new UnsupportedFormatError(`不支持的格式: ${s}`);
}
function detectFormatByExt(file: string): ImageFormat {
  const ext = path.extname(file).toLowerCase();
  for (const k of Object.keys(FORMAT_HANDLERS) as ImageFormat[])
    if ((FORMAT_HANDLERS[k].exts as readonly string[]).includes(ext)) return k;
  throw new UnsupportedFormatError(`不支持的扩展名 ${ext || "(无)"}`);
}
function detectFormatByMagic(buf: Buffer): {
  format: ImageFormat;
  desc: string;
} {
  if (buf.length >= 2 && buf.toString("latin1", 0, 2) === "BM")
    return {
      format: ImageFormat.BMP,
      desc: FORMAT_HANDLERS[ImageFormat.BMP].desc,
    };
  const m = buf.length >= 2 ? buf.toString("latin1", 0, 2) : "";
  const map: Readonly<Record<string, ImageFormat>> = {
    P1: ImageFormat.PBM,
    P4: ImageFormat.PBM,
    P2: ImageFormat.PGM,
    P5: ImageFormat.PGM,
    P3: ImageFormat.PPM,
    P6: ImageFormat.PPM,
  };
  const fmt = map[m];
  if (!fmt) throw new UnsupportedFormatError("无法识别的图片格式");
  return { format: fmt, desc: `${FORMAT_HANDLERS[fmt].desc} (${m})` };
}
function readImage(buf: Buffer): ReaderResult {
  for (const reader of READERS)
    if (reader.canRead(buf)) return reader.read(buf);
  throw new UnsupportedFormatError("无法识别的图片格式");
}
function writeImage(img: ImageBuffer, fmt: ImageFormat): Buffer {
  return WRITERS[fmt].write(img);
}
function readBuffer(file: string): Buffer {
  if (!fs.existsSync(file)) die(`文件不存在: ${file}`);
  return fs.readFileSync(file);
}

// ===================== Simple glob =====================
function globMatch(pattern: string, s: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(s);
}
function findFiles(pattern: string): string[] {
  const base = path.dirname(pattern) || ".";
  const file = path.basename(pattern);
  const results: string[] = [];
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return results;
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (globMatch(file, e.name)) results.push(full);
    }
  };
  walk(base);
  return results;
}

// ===================== CLI commands =====================
function cmdInfo([file]: string[]): void {
  if (!file) die("用法 info <file>");
  const buf = readBuffer(file);
  const detected = detectFormatByMagic(buf);
  const img = readImage(buf);
  const dims: ImageDims = { width: img.width, height: img.height };
  const meta: ImageMeta = {
    createdAt: fs.statSync(file).mtimeMs,
    source: path.resolve(file),
    format: detected.desc,
    width: img.width,
    height: img.height,
    bytes: buf.length,
  };
  console.log(color(`\n图片信息: ${meta.source}`, "bold"));
  console.log("=".repeat(56));
  console.log(
    `${color("格式", "cyan")}:      ${img.header ? describeHeader(img.header) : detected.desc}`,
  );
  console.log(
    `${color("尺寸", "cyan")}:      ${dims.width} x ${dims.height} 像素`,
  );
  console.log(`${color("色深", "cyan")}:      ${img.colorDepth} 位`);
  console.log(`${color("总像素", "cyan")}:    ${dims.width * dims.height}`);
  console.log(
    `${color("文件大小", "cyan")}:  ${formatSize(buf.length)} (${buf.length} 字节)`,
  );
  console.log(`${color("原始数据", "cyan")}:  ${formatSize(img.data.length)}`);
  const peak = Object.entries(histogram(img)).sort((a, b) => b[1] - a[1])[0];
  console.log(
    `${color("主灰度", "cyan")}:    ${peak?.[0] ?? "-"} (计数 ${peak?.[1] ?? 0})`,
  );
  console.log(`\n${color("像素采样", "cyan")}:`);
  const acc = makeAccessor(img);
  const samples: readonly Coord[] = [
    [0, 0],
    [Math.floor(dims.width / 2), Math.floor(dims.height / 2)],
    [dims.width - 1, dims.height - 1],
  ];
  for (const [x, y] of samples) {
    const p = acc.get(x, y);
    if (isRgbPixel(p))
      console.log(`  (${x},${y}) -> RGB(${p.r}, ${p.g}, ${p.b})`);
  }
  console.log("");
}
function cmdConvert([input, output]: string[]): void {
  if (!input || !output) die("用法 convert <input> <output>");
  const inBuf = readBuffer(input);
  const img = readImage(inBuf);
  const outFmt = detectFormatByExt(output);
  const out = writeImage(convert(img, outFmt), outFmt);
  fs.writeFileSync(output, out);
  console.log(
    color(
      `转换完成: ${path.basename(input)} (${detectFormatByMagic(inBuf).desc}) -> ${path.basename(output)} (${outFmt.toUpperCase()})`,
      "green",
    ),
  );
  console.log(`  ${summarize(img)} -> 输出 ${formatSize(out.length)}`);
}
function cmdResize([input, output, sizeStr, algoStr]: string[]): void {
  if (!input || !output || !sizeStr)
    die("用法 resize <input> <output> <WxH> [nearest|bilinear|bicubic]");
  const m = sizeStr.match(/^(\d+)x(\d+)$/i);
  if (!m) die("尺寸格式应为 WxH，如 100x80");
  const nw = parseInt(m[1], 10),
    nh = parseInt(m[2], 10);
  if (nw < 1 || nh < 1) die("尺寸必须为正整数");
  const algos = Object.values(SCALERS).map(
    (s) => s.algorithm,
  ) as readonly string[];
  const algoName = algoStr ?? ScaleAlgorithm.Nearest;
  if (!algos.includes(algoName)) die(`未知缩放算法: ${algoName}`);
  const img = readImage(readBuffer(input));
  const out = writeImage(
    scale(img, nw, nh, algoName as ScaleAlgorithm),
    detectFormatByExt(output),
  );
  fs.writeFileSync(output, out);
  console.log(
    color(
      `缩放 (${algoName}): ${img.width}x${img.height} -> ${nw}x${nh}`,
      "green",
    ),
  );
  console.log(`  输出: ${path.resolve(output)} (${formatSize(out.length)})`);
}
function cmdThumbnail([input, output, sizeStr]: string[]): void {
  if (!input || !output) die("用法 thumbnail <input> <output> [maxSize]");
  const max = parseInt(sizeStr ?? "128", 10);
  if (max < 1) die("maxSize 必须为正整数");
  const img = readImage(readBuffer(input));
  const thumb = makeThumbnail(img, max);
  fs.writeFileSync(output, writeImage(thumb, detectFormatByExt(output)));
  console.log(
    color(
      `缩略图: ${summarize(img)} -> ${thumb.width}x${thumb.height}`,
      "green",
    ),
  );
}
function cmdRotate([input, output, degStr]: string[]): void {
  if (!input || !output || !degStr)
    die("用法 rotate <input> <output> <90|180|270>");
  const deg = parseInt(degStr, 10);
  if (![90, 180, 270].includes(deg)) die("旋转角度必须为 90/180/270");
  const img = readImage(readBuffer(input));
  const rotated = rotate(img, deg as Rotation);
  fs.writeFileSync(output, writeImage(rotated, detectFormatByExt(output)));
  console.log(
    color(
      `旋转 ${deg}°: ${img.width}x${img.height} -> ${rotated.width}x${rotated.height}`,
      "green",
    ),
  );
}
function cmdFlip([input, output, axisStr]: string[]): void {
  if (!input || !output || !axisStr) die("用法 flip <input> <output> <h|v>");
  const axis =
    axisStr === "h"
      ? FlipAxis.Horizontal
      : axisStr === "v"
        ? FlipAxis.Vertical
        : undefined;
  if (!axis) die("翻转轴必须为 h 或 v");
  const img = readImage(readBuffer(input));
  fs.writeFileSync(
    output,
    writeImage(flip(img, axis), detectFormatByExt(output)),
  );
  console.log(color(`翻转 (${axis}): ${summarize(img)}`, "green"));
}
function cmdBrightness([input, output, valStr]: string[]): void {
  if (!input || !output || valStr === undefined)
    die("用法 brightness <input> <output> <delta>");
  const delta = parseInt(valStr, 10);
  if (Number.isNaN(delta)) die("delta 必须为整数");
  const img = readImage(readBuffer(input));
  fs.writeFileSync(
    output,
    writeImage(adjustBrightness(img, delta), detectFormatByExt(output)),
  );
  console.log(color(`亮度调整 ${delta >= 0 ? "+" : ""}${delta}`, "green"));
}
function cmdContrast([input, output, valStr]: string[]): void {
  if (!input || !output || valStr === undefined)
    die("用法 contrast <input> <output> <factor>");
  const factor = parseFloat(valStr);
  if (Number.isNaN(factor)) die("factor 必须为数字");
  const img = readImage(readBuffer(input));
  fs.writeFileSync(
    output,
    writeImage(adjustContrast(img, factor), detectFormatByExt(output)),
  );
  console.log(color(`对比度调整 x${factor}`, "green"));
}
function cmdChannel([input, output, chStr]: string[]): void {
  if (!input || !output || !chStr) die("用法 channel <input> <output> <r|g|b>");
  const ch =
    chStr === "r"
      ? PixelChannel.Red
      : chStr === "g"
        ? PixelChannel.Green
        : chStr === "b"
          ? PixelChannel.Blue
          : undefined;
  if (ch === undefined) die("通道必须为 r/g/b");
  const img = readImage(readBuffer(input));
  fs.writeFileSync(
    output,
    writeImage(extractChannel(img, ch), detectFormatByExt(output)),
  );
  console.log(color(`通道提取: ${chStr}`, "green"));
}
function cmdHistogram([input]: string[]): void {
  if (!input) die("用法 histogram <input>");
  const img = readImage(readBuffer(input));
  const stats = new ImageStats(histogram(img));
  const hist = stats.histogram as Record<number, number>;
  const max = Math.max(1, ...Object.values(hist));
  console.log(
    color(
      `\n灰度直方图: ${path.basename(input)} (${img.width}x${img.height})`,
      "bold",
    ),
  );
  console.log(
    `${color("平均亮度", "cyan")}: ${stats.brightness.toFixed(2)}   ${color("熵", "cyan")}: ${stats.entropy.toFixed(3)} bits`,
  );
  const bars = 40;
  for (let g = 0; g < 256; g += 4) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += hist[g + k] ?? 0;
    const len = Math.round((sum / max) * bars);
    console.log(
      `${String(g).padStart(3)}-${String(g + 3).padEnd(3)} ${color("#".repeat(len), "cyan")}${color("·".repeat(bars - len), "gray")} ${sum}`,
    );
  }
  console.log("");
}
function cmdEqualize([input, output]: string[]): void {
  if (!input || !output) die("用法 equalize <input> <output>");
  const img = readImage(readBuffer(input));
  fs.writeFileSync(
    output,
    writeImage(equalize(img), detectFormatByExt(output)),
  );
  console.log(color(`直方图均衡化完成: ${summarize(img)}`, "green"));
}
function cmdCompare([a, b]: string[]): void {
  if (!a || !b) die("用法 compare <a> <b>");
  const ia = readImage(readBuffer(a)),
    ib = readImage(readBuffer(b));
  const r = compare(ia, ib);
  console.log(color("\n图片对比", "bold"));
  console.log(`  A: ${summarize(ia)}`);
  console.log(`  B: ${summarize(ib)}`);
  console.log(
    `  尺寸匹配: ${r.dimMatch ? color("是", "green") : color("否", "red")}`,
  );
  console.log(`  像素差异: ${r.diffPercent.toFixed(2)}%`);
}
function cmdBatch([pattern, outDir, fmtStr]: string[]): void {
  if (!pattern || !outDir) die("用法 batch <pattern> <outputDir> [format]");
  const targetFmt = fmtStr ? parseFormat(fmtStr) : ImageFormat.PPM;
  const files = findFiles(pattern);
  if (files.length === 0) die(`没有匹配文件: ${pattern}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const reporter = new ProgressReporter((c, t, m) => {
    process.stdout.write(
      `\r${color(`[${c}/${t}]`, "cyan")} ${(m ?? "").slice(0, 40)}`.padEnd(60),
    );
  });
  reporter.total = files.length;
  let ok = 0;
  for (const f of files) {
    const name = path.basename(f);
    try {
      const img = readImage(fs.readFileSync(f));
      const outName =
        path.basename(f, path.extname(f)) + FORMAT_HANDLERS[targetFmt].exts[0];
      fs.writeFileSync(path.join(outDir, outName), writeImage(img, targetFmt));
      ok++;
      reporter.tick(color(`OK ${name}`, "green"));
    } catch {
      reporter.tick(color(`FAIL ${name}`, "red"));
    }
  }
  console.log(`\n${color(`批量完成: ${ok}/${files.length} 成功`, "green")}`);
}

// ===================== Help / dispatch =====================
function printHelp(_args: string[] = []): void {
  console.log(`
${color("图片格式转换工具 (Image Format Converter) — Enhanced", "bold")}
${"=".repeat(62)}
支持 PPM (P3/P6)、PGM (P2/P5)、PBM (P1/P4) 与 BMP (24 位) 格式。

${color("命令:", "cyan")}
  info <file>                              显示图片信息
  convert <input> <output>                 格式转换
  resize <input> <output> <WxH> [algo]     缩放 (algo: nearest|bilinear|bicubic)
  thumbnail <input> <output> [maxSize]     生成缩略图 (双线性)
  rotate <input> <output> <90|180|270>     旋转
  flip <input> <output> <h|v>              翻转
  brightness <input> <output> <delta>      亮度调整
  contrast <input> <output> <factor>       对比度调整
  channel <input> <output> <r|g|b>         通道提取
  histogram <input>                        灰度直方图
  equalize <input> <output>                直方图均衡化
  compare <a> <b>                          图片对比
  batch <pattern> <outputDir> [format]     批量转换 (glob)
  help                                     显示本帮助

${color("示例:", "cyan")}
  imgconv info photo.bmp
  imgconv convert in.bmp out.ppm
  imgconv resize big.ppm small.bmp 100x80 bilinear
  imgconv batch "./images/*.bmp" ./out ppm

${color("说明:", "yellow")} 输出 PPM=P6, PGM=P5, PBM=P4, BMP=24 位。仅使用 Node 内置模块。
`);
}
type CommandFn = (args: string[]) => void;
const COMMANDS: Record<string, CommandFn> = {
  info: cmdInfo,
  convert: cmdConvert,
  resize: cmdResize,
  thumbnail: cmdThumbnail,
  rotate: cmdRotate,
  flip: cmdFlip,
  brightness: cmdBrightness,
  contrast: cmdContrast,
  channel: cmdChannel,
  histogram: cmdHistogram,
  equalize: cmdEqualize,
  compare: cmdCompare,
  batch: cmdBatch,
  help: printHelp,
};
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const rest: Parameters<CommandFn>[0] = args.slice(1);
  try {
    const fn = COMMANDS[command];
    if (!fn) {
      console.error(color(`未知命令: ${command}`, "red"));
      printHelp();
      process.exit(1);
    }
    fn(rest);
  } catch (err) {
    console.error(
      color(`错误: ${err instanceof Error ? err.message : String(err)}`, "red"),
    );
    process.exit(1);
  }
}

main();
