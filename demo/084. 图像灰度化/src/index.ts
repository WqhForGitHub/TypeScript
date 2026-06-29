#!/usr/bin/env node

/**
 * 图像灰度化 (Image Grayscale) - 增强版
 * 纯 TypeScript 图像处理命令行工具：PPM(P3/P6) 与 BMP(24位) 读写，
 * 支持亮度法/平均法/明度法/去色法/自定义权重/sepia/阈值/反色等像素操作。
 * 仅使用 Node.js 内置模块（fs, path）。
 *
 * 演示高级 TS 特性：字符串枚举、判别联合、泛型类与约束、抽象类与继承、
 * 映射类型、自定义错误层级、接口(可选/只读/索引签名)、satisfies、as const、
 * Symbol 唯一键、生成器/迭代器、类型守卫、函数重载、getter/setter。
 */

import * as fs from "fs";
import * as path from "path";

// ===== 1. 字符串枚举 (String Enums，非 const enum) =====
enum GrayAlgorithm {
  Luminance = "luminance",
  Average = "average",
  Lightness = "lightness",
  Desaturation = "desaturation",
  Custom = "custom",
}

enum ImageFormat {
  Ppm = "ppm",
  Bmp = "bmp",
}

enum ErrorCode {
  InvalidHeader = "INVALID_HEADER",
  UnsupportedFormat = "UNSUPPORTED_FORMAT",
  UnsupportedBpp = "UNSUPPORTED_BPP",
  ParseFailed = "PARSE_FAILED",
  InsufficientData = "INSUFFICIENT_DATA",
  FileIO = "FILE_IO",
  InvalidArgument = "INVALID_ARGUMENT",
}

enum Channel {
  Red = "red",
  Green = "green",
  Blue = "blue",
}

enum ProcessState {
  Pending = "pending",
  Running = "running",
  Success = "success",
  Error = "error",
  Skipped = "skipped",
}

// ===== 2. as const 断言 & satisfies 操作符 =====
/** 亮度法权重（满足 Record<Channel, number>，同时保留字面量类型） */
const LUMA_WEIGHTS = {
  [Channel.Red]: 0.299,
  [Channel.Green]: 0.587,
  [Channel.Blue]: 0.114,
} as const satisfies Record<Channel, number>;

const SEPIA_MATRIX = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
] as const;

const SUPPORTED_EXTENSIONS = [".ppm", ".bmp"] as const;

// ===== 3. Symbol 唯一属性键 =====
const SOURCE_PATH = Symbol("sourcePath");
const PROCESSOR_TAG = Symbol("processorTag");
const CREATION_TIME = Symbol("creationTime");

// ===== 4. 映射类型 (Mapped Types) =====
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type PixelTuple = readonly [number, number, number];

// ===== 5. 接口（含 optional / readonly / index signature） =====
interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly format?: ImageFormat;
  readonly [key: string]: unknown;
}

interface ImageMetadata {
  readonly sourceSize?: number;
  readonly bitDepth?: number;
  readonly createdAt?: string;
  readonly [key: string]: unknown;
}

interface ProcessorOptions {
  readonly algorithm?: GrayAlgorithm;
  readonly weights?: PixelTuple;
  readonly threshold?: number;
  readonly [key: string]: unknown;
}

interface PixelCoord {
  readonly x: number;
  readonly y: number;
  readonly offset: number;
}

interface HistogramResult {
  readonly buckets: readonly number[];
  readonly total: number;
  readonly mean: number;
}

// ===== 6. 判别联合 (Discriminated Unions) =====
interface ProcessSuccess {
  readonly state: ProcessState.Success;
  readonly image: RgbImage;
  readonly durationMs: number;
  readonly tag: string;
}

interface ProcessError {
  readonly state: ProcessState.Error;
  readonly code: ErrorCode;
  readonly message: string;
}

interface ProcessSkipped {
  readonly state: ProcessState.Skipped;
  readonly reason: string;
}

type ProcessResult = ProcessSuccess | ProcessError | ProcessSkipped;

// ===== 7. 自定义错误类层级 =====
class ImageError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ImageError";
    this.code = code;
    Object.setPrototypeOf(this, ImageError.prototype);
  }
}
class HeaderError extends ImageError {
  constructor(message: string) {
    super(ErrorCode.InvalidHeader, message);
    this.name = "HeaderError";
    Object.setPrototypeOf(this, HeaderError.prototype);
  }
}
class ParseError extends ImageError {
  constructor(message: string) {
    super(ErrorCode.ParseFailed, message);
    this.name = "ParseError";
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

// ===== 8. 类型守卫 (Type Guards) =====
function isProcessSuccess(r: ProcessResult): r is ProcessSuccess {
  return r.state === ProcessState.Success;
}
function isProcessError(r: ProcessResult): r is ProcessError {
  return r.state === ProcessState.Error;
}
function isImageFormat(s: string): s is ImageFormat {
  return s === ImageFormat.Ppm || s === ImageFormat.Bmp;
}
function isGrayAlgorithm(s: string): s is GrayAlgorithm {
  return (Object.values(GrayAlgorithm) as string[]).includes(s);
}
function isRgbImage(o: unknown): o is RgbImage {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    r.data instanceof Uint8Array
  );
}

// ===== 9. 工具函数 & 函数重载 =====
function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** 计算单像素灰度值（重载：默认亮度法 / 指定算法 / 自定义权重） */
function grayOf(r: number, g: number, b: number): number;
function grayOf(
  r: number,
  g: number,
  b: number,
  algorithm: GrayAlgorithm,
): number;
function grayOf(
  r: number,
  g: number,
  b: number,
  algorithm: GrayAlgorithm.Custom,
  weights: PixelTuple,
): number;
function grayOf(
  r: number,
  g: number,
  b: number,
  algorithm: GrayAlgorithm = GrayAlgorithm.Luminance,
  weights?: PixelTuple,
): number {
  switch (algorithm) {
    case GrayAlgorithm.Luminance:
      return clamp8(
        r * LUMA_WEIGHTS.red + g * LUMA_WEIGHTS.green + b * LUMA_WEIGHTS.blue,
      );
    case GrayAlgorithm.Average:
      return clamp8((r + g + b) / 3);
    case GrayAlgorithm.Lightness:
    case GrayAlgorithm.Desaturation:
      return clamp8((Math.max(r, g, b) + Math.min(r, g, b)) / 2);
    case GrayAlgorithm.Custom: {
      const w =
        weights ??
        ([
          LUMA_WEIGHTS.red,
          LUMA_WEIGHTS.green,
          LUMA_WEIGHTS.blue,
        ] as PixelTuple);
      return clamp8(r * w[0] + g * w[1] + b * w[2]);
    }
  }
}

/** 默认输出路径（重载：默认扩展名 / 指定格式） */
function defaultOutput(input: string, suffix: string): string;
function defaultOutput(input: string, suffix: string, ext: ImageFormat): string;
function defaultOutput(
  input: string,
  suffix: string,
  ext: ImageFormat = ImageFormat.Ppm,
): string {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, `${base}-${suffix}.${ext}`);
}

// ===== 10. 泛型类（带约束）& 生成器/迭代器 & Symbol 属性 =====
/** 通用像素缓冲区。泛型参数 T 约束为 number，表示每像素字节数（如 3 = RGB）。 */
class PixelBuffer<T extends number> {
  readonly bytesPerPixel: T;
  readonly width: number;
  readonly height: number;
  private readonly _data: Uint8Array;
  [SOURCE_PATH]?: string;
  [PROCESSOR_TAG]?: string;
  [CREATION_TIME]?: number;

  constructor(
    width: number,
    height: number,
    bytesPerPixel: T,
    data?: Uint8Array,
  ) {
    this.width = width;
    this.height = height;
    this.bytesPerPixel = bytesPerPixel;
    this._data = data ?? new Uint8Array(width * height * bytesPerPixel);
  }

  get data(): Uint8Array {
    return this._data;
  }
  get length(): number {
    return this._data.length;
  }
  get pixelCount(): number {
    return this.width * this.height;
  }

  getPixel(x: number, y: number): number[] {
    const off = (y * this.width + x) * this.bytesPerPixel;
    const out: number[] = [];
    for (let i = 0; i < this.bytesPerPixel; i++) out.push(this._data[off + i]);
    return out;
  }

  setPixel(x: number, y: number, ...values: number[]): void {
    const off = (y * this.width + x) * this.bytesPerPixel;
    for (let i = 0; i < this.bytesPerPixel; i++) {
      this._data[off + i] = clamp8(values[i] ?? 0);
    }
  }

  /** 生成器：逐像素迭代坐标 */
  *pixels(): IterableIterator<PixelCoord> {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        yield { x, y, offset: (y * this.width + x) * this.bytesPerPixel };
      }
    }
  }

  [Symbol.iterator](): IterableIterator<PixelCoord> {
    return this.pixels();
  }

  toRgbImage(): RgbImage {
    return { width: this.width, height: this.height, data: this._data };
  }
}

// ===== 11. 抽象类 & 具体子类（含 getter/setter） =====
abstract class AbstractImageProcessor {
  abstract readonly name: string;
  protected _state: ProcessState = ProcessState.Pending;
  [PROCESSOR_TAG]?: string;

  get state(): ProcessState {
    return this._state;
  }

  abstract process(image: RgbImage, options?: ProcessorOptions): RgbImage;

  protected begin(): void {
    this._state = ProcessState.Running;
  }

  protected finish(ok: boolean): void {
    this._state = ok ? ProcessState.Success : ProcessState.Error;
  }

  /** 模板方法：执行处理并返回判别联合结果 */
  run(image: RgbImage, options?: ProcessorOptions): ProcessResult {
    this.begin();
    const start = Date.now();
    try {
      if (!isRgbImage(image)) {
        this.finish(false);
        return {
          state: ProcessState.Error,
          code: ErrorCode.InvalidArgument,
          message: "无效的图像对象",
        };
      }
      const result = this.process(image, options);
      this.finish(true);
      return {
        state: ProcessState.Success,
        image: result,
        durationMs: Date.now() - start,
        tag: this.name,
      };
    } catch (e) {
      this.finish(false);
      if (e instanceof ImageError) {
        return { state: ProcessState.Error, code: e.code, message: e.message };
      }
      return {
        state: ProcessState.Error,
        code: ErrorCode.ParseFailed,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

class GrayscaleProcessor extends AbstractImageProcessor {
  readonly name = "grayscale";
  private _algorithm: GrayAlgorithm = GrayAlgorithm.Luminance;
  private _weights: PixelTuple = [
    LUMA_WEIGHTS.red,
    LUMA_WEIGHTS.green,
    LUMA_WEIGHTS.blue,
  ];

  get algorithm(): GrayAlgorithm {
    return this._algorithm;
  }
  set algorithm(a: GrayAlgorithm) {
    this._algorithm = a;
  }
  get weights(): PixelTuple {
    return this._weights;
  }
  set weights(w: PixelTuple) {
    this._weights = w;
  }

  process(image: RgbImage, options?: ProcessorOptions): RgbImage {
    if (options?.algorithm) this._algorithm = options.algorithm;
    if (options?.weights) this._weights = options.weights;
    const buf = new PixelBuffer<3>(image.width, image.height, 3);
    const algo = this._algorithm;
    const w = this._weights;
    for (const p of buf.pixels()) {
      const v =
        algo === GrayAlgorithm.Custom
          ? grayOf(
              image.data[p.offset],
              image.data[p.offset + 1],
              image.data[p.offset + 2],
              algo,
              w,
            )
          : grayOf(
              image.data[p.offset],
              image.data[p.offset + 1],
              image.data[p.offset + 2],
              algo,
            );
      buf.data[p.offset] = v;
      buf.data[p.offset + 1] = v;
      buf.data[p.offset + 2] = v;
    }
    return buf.toRgbImage();
  }
}

class ThresholdProcessor extends AbstractImageProcessor {
  readonly name = "threshold";
  private _level: number = 128;

  get level(): number {
    return this._level;
  }
  set level(v: number) {
    this._level = clamp8(v);
  }

  process(image: RgbImage, options?: ProcessorOptions): RgbImage {
    if (options?.threshold !== undefined)
      this._level = clamp8(options.threshold);
    const buf = new PixelBuffer<3>(image.width, image.height, 3);
    for (const p of buf.pixels()) {
      const v = grayOf(
        image.data[p.offset],
        image.data[p.offset + 1],
        image.data[p.offset + 2],
        GrayAlgorithm.Luminance,
      );
      const t = v >= this._level ? 255 : 0;
      buf.data[p.offset] = t;
      buf.data[p.offset + 1] = t;
      buf.data[p.offset + 2] = t;
    }
    return buf.toRgbImage();
  }
}

class InvertProcessor extends AbstractImageProcessor {
  readonly name = "invert";

  process(image: RgbImage, _options?: ProcessorOptions): RgbImage {
    const buf = new PixelBuffer<3>(image.width, image.height, 3);
    for (let i = 0; i < image.data.length; i++) {
      buf.data[i] = 255 - image.data[i];
    }
    return buf.toRgbImage();
  }
}

// ===== 12. 格式检测 & 读写入口 =====
function detectFormat(filePath: string): ImageFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".bmp") return ImageFormat.Bmp;
  if (ext === ".ppm") return ImageFormat.Ppm;
  throw new ImageError(
    ErrorCode.UnsupportedFormat,
    `不支持的文件扩展名: ${ext}（仅支持 ${SUPPORTED_EXTENSIONS.join("/")}）`,
  );
}

function readImage(filePath: string): RgbImage {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    throw new ImageError(
      ErrorCode.FileIO,
      `读取文件失败: ${filePath} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const fmt = detectFormat(filePath);
  return fmt === ImageFormat.Ppm ? readPpm(buf) : readBmp(buf);
}

function writeImage(filePath: string, img: RgbImage): void {
  const fmt = detectFormat(filePath);
  const buf = fmt === ImageFormat.Ppm ? writePpm(img) : writeBmp(img);
  try {
    fs.writeFileSync(filePath, buf);
  } catch (e) {
    throw new ImageError(
      ErrorCode.FileIO,
      `写入文件失败: ${filePath} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

// ===== 13. PPM 读写 (P3 ASCII / P6 二进制) =====
function readPpm(buf: Buffer): RgbImage {
  if (buf.length < 2 || buf[0] !== 0x50)
    throw new HeaderError("无效 PPM 文件头");
  const magic = String.fromCharCode(buf[0], buf[1]);
  if (magic !== "P3" && magic !== "P6")
    throw new HeaderError(`仅支持 P3/P6 PPM，得到 ${magic}`);

  let pos = 2;
  const readToken = (): string => {
    let token = "";
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x23) {
        while (pos < buf.length && buf[pos] !== 0x0a) pos++;
        continue;
      }
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        if (token.length > 0) break;
        pos++;
        continue;
      }
      token += String.fromCharCode(c);
      pos++;
    }
    return token;
  };

  const width = parseInt(readToken(), 10);
  const height = parseInt(readToken(), 10);
  const maxval = parseInt(readToken(), 10);
  if (!width || !height || !maxval) throw new ParseError("PPM 头解析失败");

  const data = new Uint8Array(width * height * 3);
  if (magic === "P6") {
    const bytesPerSample = maxval > 255 ? 2 : 1;
    if (bytesPerSample !== 1)
      throw new ImageError(ErrorCode.UnsupportedBpp, "暂不支持 16 位 PPM");
    const need = width * height * 3;
    if (buf.length - pos < need)
      throw new ImageError(ErrorCode.InsufficientData, "PPM 像素数据不足");
    for (let i = 0; i < need; i++) {
      data[i] =
        maxval === 255
          ? buf[pos + i]
          : Math.round((buf[pos + i] / maxval) * 255);
    }
  } else {
    let idx = 0;
    while (idx < data.length) {
      const t = readToken();
      if (t.length === 0) break;
      const v = parseInt(t, 10);
      data[idx++] = maxval === 255 ? v : Math.round((v / maxval) * 255);
    }
    if (idx !== data.length)
      throw new ImageError(ErrorCode.InsufficientData, "P3 像素数据不足");
  }
  return { width, height, data, format: ImageFormat.Ppm };
}

function writePpm(img: RgbImage): Buffer {
  const header = `P6\n${img.width} ${img.height}\n255\n`;
  const headBuf = Buffer.from(header, "ascii");
  return Buffer.concat([headBuf, Buffer.from(img.data)]);
}

// ===== 14. BMP 24 位读写 =====
function readBmp(buf: Buffer): RgbImage {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d)
    throw new HeaderError("无效 BMP 文件头");
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24)
    throw new ImageError(
      ErrorCode.UnsupportedBpp,
      `仅支持 24 位 BMP，得到 ${bpp} 位`,
    );
  const height = Math.abs(heightRaw);
  const topDown = heightRaw < 0;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      const off = rowStart + x * 3;
      const dst = (y * width + x) * 3;
      data[dst] = buf[off + 2]; // R
      data[dst + 1] = buf[off + 1]; // G
      data[dst + 2] = buf[off]; // B
    }
  }
  return { width, height, data, format: ImageFormat.Bmp };
}

function writeBmp(img: RgbImage): Buffer {
  const { width, height } = img;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // 自下而上
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelArraySize, 34);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const src = (srcRow * width + x) * 3;
      const off = rowStart + x * 3;
      buf[off] = img.data[src + 2]; // B
      buf[off + 1] = img.data[src + 1]; // G
      buf[off + 2] = img.data[src]; // R
    }
  }
  return buf;
}

// ===== 15. 其他像素操作 & Mutable 映射类型使用 =====
function toSepia(img: RgbImage): RgbImage {
  const buf = new PixelBuffer<3>(img.width, img.height, 3);
  for (const p of buf.pixels()) {
    const r = img.data[p.offset];
    const g = img.data[p.offset + 1];
    const b = img.data[p.offset + 2];
    buf.data[p.offset] = clamp8(
      SEPIA_MATRIX[0][0] * r + SEPIA_MATRIX[0][1] * g + SEPIA_MATRIX[0][2] * b,
    );
    buf.data[p.offset + 1] = clamp8(
      SEPIA_MATRIX[1][0] * r + SEPIA_MATRIX[1][1] * g + SEPIA_MATRIX[1][2] * b,
    );
    buf.data[p.offset + 2] = clamp8(
      SEPIA_MATRIX[2][0] * r + SEPIA_MATRIX[2][1] * g + SEPIA_MATRIX[2][2] * b,
    );
  }
  return buf.toRgbImage();
}

function computeHistogram(img: RgbImage): HistogramResult {
  const buckets = new Array<number>(256).fill(0);
  let total = 0;
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 3) {
    const v = grayOf(
      img.data[i],
      img.data[i + 1],
      img.data[i + 2],
      GrayAlgorithm.Luminance,
    );
    buckets[v]++;
    total++;
    sum += v;
  }
  return { buckets, total, mean: total > 0 ? sum / total : 0 };
}

/** 生成示例渐变图（演示 Mutable<T> 映射类型） */
function generateSample(width: number, height: number): RgbImage {
  const mutable: Mutable<RgbImage> = {
    width,
    height,
    data: new Uint8Array(width * height * 3),
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 3;
      mutable.data[off] = Math.round((x / width) * 255);
      mutable.data[off + 1] = Math.round((y / height) * 255);
      mutable.data[off + 2] = Math.round(((x + y) / (width + height)) * 255);
    }
  }
  return mutable;
}

// ===== 16. CLI 参数解析 =====
interface ParsedArgs {
  readonly command: string;
  readonly input: string;
  readonly output: string;
  readonly method: GrayAlgorithm;
  readonly weights: PixelTuple;
  readonly level: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  let input = "";
  let output = "";
  let method: GrayAlgorithm = GrayAlgorithm.Luminance;
  let weights: PixelTuple = [
    LUMA_WEIGHTS.red,
    LUMA_WEIGHTS.green,
    LUMA_WEIGHTS.blue,
  ];
  let level = 128;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case "-o":
      case "--out":
        output = rest[++i] ?? output;
        break;
      case "-m":
      case "--method": {
        const v = rest[++i] ?? "";
        if (isGrayAlgorithm(v)) method = v;
        break;
      }
      case "-w":
      case "--weights": {
        const s = rest[++i] ?? "";
        const parts = s.split(",").map((n) => parseFloat(n));
        if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
          weights = [parts[0], parts[1], parts[2]];
        }
        break;
      }
      case "-l":
      case "--level": {
        const v = parseInt(rest[++i] ?? "", 10);
        if (!isNaN(v)) level = Math.max(0, Math.min(255, v));
        break;
      }
      default:
        if (!a.startsWith("-")) {
          if (input === "") input = a;
          else if (output === "") output = a;
        }
    }
  }
  return { command, input, output, method, weights, level };
}

function printHelp(): void {
  console.log(`
图像灰度化 (Image Grayscale) - 增强版
用法:
  gray <input> [-o output] [-m method] [-w r,g,b]   灰度化处理
  info <image>                                       查看图像信息与直方图摘要
  convert <input> <output>                           格式转换 (PPM <-> BMP)
  threshold <input> <level> [-o output]              阈值二值化 (0-255)
  sepia <input> [-o output]                          棕褐色调
  invert <input> [-o output]                         反色
  sample [-o output]                                 生成示例渐变图
方法 (-m): luminance(默认) | average | lightness | desaturation | custom
自定义权重 (-w): 如 -w 0.3,0.59,0.11
示例:
  node dist/index.js sample -o ./in.ppm
  node dist/index.js gray ./in.ppm -o ./gray.bmp -m average
  node dist/index.js threshold ./in.ppm 100 -o ./bin.ppm
  node dist/index.js info ./gray.bmp
`);
}

function printImageInfo(img: RgbImage, name: string): void {
  const { buckets, total, mean } = computeHistogram(img);
  const maxBucket = Math.max(...buckets);
  console.log(`图像: ${name}`);
  console.log(`  尺寸: ${img.width} x ${img.height}`);
  console.log(`  像素数: ${total}`);
  console.log(`  字节数: ${img.data.length}`);
  console.log(`  平均亮度: ${mean.toFixed(2)}`);
  console.log("  直方图(每32级汇总):");
  for (let b = 0; b < 256; b += 32) {
    const sum = buckets.slice(b, b + 32).reduce((s, c) => s + c, 0);
    const bar = "#".repeat(Math.round((sum / Math.max(maxBucket, 1)) * 40));
    console.log(
      `    ${b.toString().padStart(3)}-${(b + 31).toString().padStart(3)}: ${bar} (${sum})`,
    );
  }
}

// ===== 17. 主入口（CLI） =====
function runProcessorAndReport(
  proc: AbstractImageProcessor,
  img: RgbImage,
  opts?: ProcessorOptions,
): RgbImage {
  const result = proc.run(img, opts);
  if (isProcessSuccess(result)) {
    console.log(`  [${proc.name}] 处理完成 (${result.durationMs}ms)`);
    return result.image;
  }
  if (isProcessError(result)) {
    throw new ImageError(result.code, result.message);
  }
  throw new ImageError(
    ErrorCode.InvalidArgument,
    `处理被跳过: ${result.reason}`,
  );
}

/** 断言必需的 CLI 参数；不满足时打印错误并退出 */
function requireArg(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

function main(): void {
  const opts = parseArgs(process.argv);
  switch (opts.command) {
    case "sample": {
      const out = opts.output || "./sample.ppm";
      const img = generateSample(128, 128);
      writeImage(out, img);
      console.log(`已生成示例图像: ${out} (${img.width}x${img.height})`);
      break;
    }
    case "info":
    case "histogram":
      requireArg(!!opts.input, "错误：缺少 <image>");
      printImageInfo(readImage(opts.input), opts.input);
      break;
    case "convert":
      requireArg(
        !!opts.input && !!opts.output,
        "错误：用法 convert <input> <output>",
      );
      writeImage(opts.output, readImage(opts.input));
      console.log(`已转换: ${opts.input} -> ${opts.output}`);
      break;
    case "gray": {
      requireArg(!!opts.input, "错误：缺少 <input>");
      const proc = new GrayscaleProcessor();
      proc.algorithm = opts.method;
      proc.weights = opts.weights;
      const out = runProcessorAndReport(proc, readImage(opts.input));
      const target =
        opts.output || defaultOutput(opts.input, "gray", ImageFormat.Ppm);
      writeImage(target, out);
      console.log(`灰度化(${opts.method})完成: ${target}`);
      break;
    }
    case "threshold": {
      requireArg(!!opts.input, "错误：缺少 <input>");
      const proc = new ThresholdProcessor();
      proc.level = opts.level;
      const out = runProcessorAndReport(proc, readImage(opts.input));
      const target =
        opts.output ||
        defaultOutput(opts.input, `thr${opts.level}`, ImageFormat.Ppm);
      writeImage(target, out);
      console.log(`阈值二值化(level=${opts.level})完成: ${target}`);
      break;
    }
    case "sepia": {
      requireArg(!!opts.input, "错误：缺少 <input>");
      const out = toSepia(readImage(opts.input));
      const target =
        opts.output || defaultOutput(opts.input, "sepia", ImageFormat.Ppm);
      writeImage(target, out);
      console.log(`棕褐色调完成: ${target}`);
      break;
    }
    case "invert": {
      requireArg(!!opts.input, "错误：缺少 <input>");
      const proc = new InvertProcessor();
      const out = runProcessorAndReport(proc, readImage(opts.input));
      const target =
        opts.output || defaultOutput(opts.input, "invert", ImageFormat.Ppm);
      writeImage(target, out);
      console.log(`反色完成: ${target}`);
      break;
    }
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main();
