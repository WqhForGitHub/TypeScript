#!/usr/bin/env node

/**
 * 图像模糊处理 (Image Blur & Convolution) - 增强版
 * 使用大量高级 TypeScript 特性重写：字符串枚举、判别联合、泛型类、抽象类、
 * 映射类型、自定义错误层级、符号、生成器、类型守卫、函数重载、satisfies、as const 等。
 * 功能：PPM(P6)/BMP(24 位) 读写，box/gaussian/motion/radial 模糊、锐化、Sobel 边缘、浮雕。
 * 仅使用 Node.js 内置模块（fs, path）。
 */

import * as fs from "fs";
import * as path from "path";

// ===================== String Enums =====================
enum BlurAlgorithm {
  Box = "box",
  Gaussian = "gaussian",
  Motion = "motion",
  Radial = "radial",
}
enum ImageFormat {
  Ppm = "ppm",
  Bmp = "bmp",
}
enum ErrorCode {
  InvalidFormat = "INVALID_FORMAT",
  InvalidHeader = "INVALID_HEADER",
  UnsupportedBpp = "UNSUPPORTED_BPP",
  DataTruncated = "DATA_TRUNCATED",
  InvalidArgs = "INVALID_ARGS",
  UnknownCommand = "UNKNOWN_COMMAND",
  MissingInput = "MISSING_INPUT",
  Cancelled = "CANCELLED",
}
enum KernelType {
  Average = "average",
  Gaussian = "gaussian",
  Motion = "motion",
  Emboss = "emboss",
  SobelX = "sobelX",
  SobelY = "sobelY",
}
enum BorderMode {
  Clamp = "clamp",
  Wrap = "wrap",
  Mirror = "mirror",
  Zero = "zero",
}

// ===================== Symbols =====================
const SYM_META = Symbol("imageMeta");
const SYM_FILTER_TAG = Symbol("filterTag");

// ===================== Mapped Types =====================
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ===================== Interfaces =====================
interface KernelDef {
  readonly type: KernelType;
  readonly size: number;
  readonly divisor: number;
  readonly bias: number;
  readonly data: Float64Array;
}
interface BlurOptions {
  readonly algorithm: BlurAlgorithm;
  readonly radius: number;
  readonly sigma: number;
  readonly border: BorderMode;
  readonly amount?: number;
}
interface Pixel {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
interface ImageMeta {
  format?: ImageFormat;
  source?: string;
  createdAt?: number;
  [key: string]: string | number | undefined;
}
interface ParsedArgs {
  readonly command: string;
  readonly input: string;
  readonly output: string;
  readonly method: BlurAlgorithm;
  readonly radius: number;
  readonly sigma: number;
  readonly amount: number;
}

// ===================== Custom Error Hierarchy =====================
class ImageError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ImageError";
    this.code = code;
    Object.setPrototypeOf(this, ImageError.prototype);
  }
}
class FormatError extends ImageError {
  constructor(message: string) {
    super(ErrorCode.InvalidFormat, message);
    this.name = "FormatError";
    Object.setPrototypeOf(this, FormatError.prototype);
  }
}

// ===================== Discriminated Unions =====================
interface BlurSuccess {
  readonly status: "success";
  readonly image: ImageBuffer<3>;
  readonly algorithm: BlurAlgorithm;
  readonly elapsedMs: number;
}
interface BlurError {
  readonly status: "error";
  readonly code: ErrorCode;
  readonly message: string;
}
interface BlurCancelled {
  readonly status: "cancelled";
  readonly reason: string;
}
type BlurResult = BlurSuccess | BlurError | BlurCancelled;

// ===================== Type Guards =====================
function isBlurSuccess(r: BlurResult): r is BlurSuccess {
  return r.status === "success";
}
function isBlurError(r: BlurResult): r is BlurError {
  return r.status === "error";
}
function isBlurCancelled(r: BlurResult): r is BlurCancelled {
  return r.status === "cancelled";
}
function isImageError(e: unknown): e is ImageError {
  return e instanceof ImageError;
}
function isRgbImage(o: unknown): o is RgbImage {
  return o instanceof ImageBuffer && (o as ImageBuffer<number>).channels === 3;
}

// ===================== Generic ImageBuffer =====================
class ImageBuffer<T extends number> {
  readonly width: number;
  readonly height: number;
  readonly channels: T;
  readonly data: Uint8Array;
  [SYM_META]: ImageMeta;

  constructor(width: number, height: number, channels: T, data?: Uint8Array) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new ImageError(
        ErrorCode.InvalidArgs,
        `图像尺寸必须为正整数: ${width}x${height}`,
      );
    }
    this.width = width;
    this.height = height;
    this.channels = channels;
    const need = width * height * channels;
    this.data = data ?? new Uint8Array(need);
    if (this.data.length < need) {
      throw new ImageError(
        ErrorCode.DataTruncated,
        `数据长度 ${this.data.length} < 需要 ${need}`,
      );
    }
    this[SYM_META] = {};
  }

  get pixelCount(): number {
    return this.width * this.height;
  }
  get byteLength(): number {
    return this.data.length;
  }

  private _label = "untitled";
  get label(): string {
    return this._label;
  }
  set label(v: string) {
    if (typeof v !== "string" || v.length === 0)
      throw new ImageError(ErrorCode.InvalidArgs, "label 不能为空");
    this._label = v;
  }

  pixelAt(x: number, y: number): Pixel {
    const off = (y * this.width + x) * this.channels;
    return {
      x,
      y,
      r: this.data[off],
      g: this.data[off + 1],
      b: this.data[off + 2],
    };
  }
  setPixel(x: number, y: number, r: number, g: number, b: number): void {
    const off = (y * this.width + x) * this.channels;
    this.data[off] = clamp8(r);
    this.data[off + 1] = clamp8(g);
    this.data[off + 2] = clamp8(b);
  }

  *pixels(): Generator<Pixel, void, unknown> {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) yield this.pixelAt(x, y);
  }
  *rows(): Generator<
    { readonly y: number; readonly row: Uint8Array },
    void,
    unknown
  > {
    const rowLen = this.width * this.channels;
    for (let y = 0; y < this.height; y++)
      yield { y, row: this.data.subarray(y * rowLen, (y + 1) * rowLen) };
  }
  [Symbol.iterator](): Generator<Pixel> {
    return this.pixels();
  }

  clone(): ImageBuffer<T> {
    const c = new ImageBuffer<T>(
      this.width,
      this.height,
      this.channels,
      new Uint8Array(this.data),
    );
    c[SYM_META] = { ...this[SYM_META] };
    c._label = this._label;
    return c;
  }
}
type RgbImage = ImageBuffer<3>;

// ===================== Helpers / Overloads =====================
function clamp8(v: number): number;
function clamp8(v: number, round: boolean): number;
function clamp8(v: number, round: boolean = true): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return round ? Math.round(v) : v;
}
function clampCoord(v: number, max: number): number {
  return v < 0 ? 0 : v >= max ? max - 1 : v;
}
function detectFormat(filePath: string): ImageFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".bmp") return ImageFormat.Bmp;
  if (ext === ".ppm") return ImageFormat.Ppm;
  throw new FormatError(`不支持的扩展名: ${ext}（仅 .ppm/.bmp）`);
}

// ===================== PPM(P6) 读写 =====================
function readPpm(buf: Buffer): RgbImage {
  if (buf.length < 2 || buf[0] !== 0x50)
    throw new ImageError(ErrorCode.InvalidHeader, "无效 PPM");
  const magic = String.fromCharCode(buf[0], buf[1]);
  if (magic !== "P6")
    throw new ImageError(
      ErrorCode.InvalidHeader,
      `仅支持 P6 二进制 PPM，得到 ${magic}`,
    );
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
  if (!width || !height || !maxval)
    throw new ImageError(ErrorCode.InvalidHeader, "PPM 头解析失败");
  const need = width * height * 3;
  if (buf.length - pos < need)
    throw new ImageError(ErrorCode.DataTruncated, "PPM 像素数据不足");
  const data = new Uint8Array(need);
  for (let i = 0; i < need; i++) {
    data[i] =
      maxval === 255 ? buf[pos + i] : Math.round((buf[pos + i] / maxval) * 255);
  }
  const img = new ImageBuffer<3>(width, height, 3, data);
  img[SYM_META].format = ImageFormat.Ppm;
  return img;
}
function writePpm(img: RgbImage): Buffer {
  const header = `P6\n${img.width} ${img.height}\n255\n`;
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(img.data)]);
}

// ===================== BMP(24 位) 读写 =====================
function readBmp(buf: Buffer): RgbImage {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d)
    throw new ImageError(ErrorCode.InvalidHeader, "无效 BMP");
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24)
    throw new ImageError(
      ErrorCode.UnsupportedBpp,
      `仅支持 24 位 BMP（得到 ${bpp}）`,
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
      data[dst] = buf[off + 2];
      data[dst + 1] = buf[off + 1];
      data[dst + 2] = buf[off];
    }
  }
  const img = new ImageBuffer<3>(width, height, 3, data);
  img[SYM_META].format = ImageFormat.Bmp;
  return img;
}
function writeBmp(img: RgbImage): Buffer {
  const { width, height } = img;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const fileSize = 54 + rowSize * height;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const src = (srcRow * width + x) * 3;
      const off = rowStart + x * 3;
      buf[off] = img.data[src + 2];
      buf[off + 1] = img.data[src + 1];
      buf[off + 2] = img.data[src];
    }
  }
  return buf;
}

// ===================== Function Overloads: readImage =====================
function readImage(filePath: string): RgbImage;
function readImage(filePath: string, format: ImageFormat): RgbImage;
function readImage(filePath: string, format?: ImageFormat): RgbImage {
  const fmt = format ?? detectFormat(filePath);
  const buf = fs.readFileSync(filePath);
  const img = fmt === ImageFormat.Ppm ? readPpm(buf) : readBmp(buf);
  img[SYM_META].source = filePath;
  img[SYM_META].createdAt = Date.now();
  img.label = path.basename(filePath);
  return img;
}
function writeImage(filePath: string, img: RgbImage): void {
  const buf =
    detectFormat(filePath) === ImageFormat.Ppm ? writePpm(img) : writeBmp(img);
  fs.writeFileSync(filePath, buf);
}

// ===================== Abstract Blur Filter =====================
abstract class AbstractBlurFilter {
  protected _radius!: number;
  protected _border: BorderMode;
  [SYM_FILTER_TAG]: string;

  constructor(radius: number, border: BorderMode = BorderMode.Clamp) {
    this.setRadius(radius);
    this._border = border;
    this[SYM_FILTER_TAG] = this.constructor.name;
  }
  get radius(): number {
    return this._radius;
  }
  protected setRadius(r: number): void {
    if (!Number.isInteger(r) || r <= 0)
      throw new ImageError(ErrorCode.InvalidArgs, `radius 必须为正整数: ${r}`);
    this._radius = r;
  }
  get border(): BorderMode {
    return this._border;
  }
  set border(b: BorderMode) {
    this._border = b;
  }

  abstract readonly kernelType: KernelType;
  abstract buildKernel(): KernelDef;

  protected sampleOffset(img: RgbImage, x: number, y: number): number {
    const w = img.width,
      h = img.height;
    switch (this._border) {
      case BorderMode.Wrap: {
        const sx = ((x % w) + w) % w;
        const sy = ((y % h) + h) % h;
        return (sy * w + sx) * 3;
      }
      case BorderMode.Mirror: {
        let sx = x,
          sy = y;
        if (sx < 0) sx = -sx - 1;
        if (sy < 0) sy = -sy - 1;
        if (sx >= w) sx = 2 * w - sx - 1;
        if (sy >= h) sy = 2 * h - sy - 1;
        return (clampCoord(sy, h) * w + clampCoord(sx, w)) * 3;
      }
      case BorderMode.Zero:
        if (x < 0 || y < 0 || x >= w || y >= h) return -1;
        return (y * w + x) * 3;
      case BorderMode.Clamp:
      default:
        return (clampCoord(y, h) * w + clampCoord(x, w)) * 3;
    }
  }
  apply(img: RgbImage): RgbImage {
    const k = this.buildKernel();
    const out = new ImageBuffer<3>(img.width, img.height, 3);
    out.label = img.label + ":" + this.kernelType;
    const half = Math.floor(k.size / 2);
    const w = img.width,
      h = img.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sr = 0,
          sg = 0,
          sb = 0;
        for (let ky = 0; ky < k.size; ky++) {
          for (let kx = 0; kx < k.size; kx++) {
            const weight = k.data[ky * k.size + kx];
            if (weight === 0) continue;
            const off = this.sampleOffset(img, x + kx - half, y + ky - half);
            if (off < 0) continue;
            sr += img.data[off] * weight;
            sg += img.data[off + 1] * weight;
            sb += img.data[off + 2] * weight;
          }
        }
        const d = (y * w + x) * 3;
        out.data[d] = clamp8(sr / k.divisor + k.bias);
        out.data[d + 1] = clamp8(sg / k.divisor + k.bias);
        out.data[d + 2] = clamp8(sb / k.divisor + k.bias);
      }
    }
    return out;
  }
}

class BoxBlurFilter extends AbstractBlurFilter {
  readonly kernelType = KernelType.Average;
  buildKernel(): KernelDef {
    const size = this._radius * 2 + 1;
    const data = new Float64Array(size * size).fill(1);
    return { type: this.kernelType, size, divisor: size * size, bias: 0, data };
  }
}
class GaussianBlurFilter extends AbstractBlurFilter {
  readonly kernelType = KernelType.Gaussian;
  private _sigma!: number;
  constructor(
    radius: number,
    sigma: number,
    border: BorderMode = BorderMode.Clamp,
  ) {
    super(radius, border);
    this.sigma = sigma;
  }
  get sigma(): number {
    return this._sigma;
  }
  set sigma(v: number) {
    if (v <= 0)
      throw new ImageError(ErrorCode.InvalidArgs, `sigma 必须 > 0: ${v}`);
    this._sigma = v;
  }
  buildKernel(): KernelDef {
    const size = this._radius * 2 + 1;
    const data = new Float64Array(size * size);
    const s2 = 2 * this._sigma * this._sigma;
    let sum = 0;
    for (let y = -this._radius; y <= this._radius; y++) {
      for (let x = -this._radius; x <= this._radius; x++) {
        const v = Math.exp(-(x * x + y * y) / s2);
        data[(y + this._radius) * size + (x + this._radius)] = v;
        sum += v;
      }
    }
    return { type: this.kernelType, size, divisor: sum, bias: 0, data };
  }
}
class MotionBlurFilter extends AbstractBlurFilter {
  readonly kernelType = KernelType.Motion;
  buildKernel(): KernelDef {
    const size = this._radius * 2 + 1;
    const data = new Float64Array(size * size).fill(0);
    for (let i = 0; i < size; i++) data[i * size + i] = 1;
    return { type: this.kernelType, size, divisor: size, bias: 0, data };
  }
}

// ===================== Radial Blur (非核卷积) =====================
function radialBlur(
  img: RgbImage,
  samples: number,
  strength: number,
): RgbImage {
  const out = new ImageBuffer<3>(img.width, img.height, 3);
  const cx = img.width / 2,
    cy = img.height / 2;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      let r = 0,
        g = 0,
        b = 0;
      const dx = x - cx,
        dy = y - cy;
      for (let s = 0; s < samples; s++) {
        const t = s / samples;
        const sx = Math.round(x - dx * t * strength);
        const sy = Math.round(y - dy * t * strength);
        const off =
          (clampCoord(sy, img.height) * img.width + clampCoord(sx, img.width)) *
          3;
        r += img.data[off];
        g += img.data[off + 1];
        b += img.data[off + 2];
      }
      out.setPixel(x, y, r / samples, g / samples, b / samples);
    }
  }
  return out;
}

// ===================== Defaults (as const + satisfies) =====================
const DEFAULT_BLUR_OPTIONS = {
  algorithm: BlurAlgorithm.Gaussian,
  radius: 2,
  sigma: 1.5,
  border: BorderMode.Clamp,
} as const satisfies BlurOptions;
const DEFAULT_SHARPEN_AMOUNT = 1.5 as const;

function makeOptions(overrides: Partial<Mutable<BlurOptions>>): BlurOptions {
  const base: Mutable<BlurOptions> = {
    algorithm: DEFAULT_BLUR_OPTIONS.algorithm,
    radius: DEFAULT_BLUR_OPTIONS.radius,
    sigma: DEFAULT_BLUR_OPTIONS.sigma,
    border: DEFAULT_BLUR_OPTIONS.border,
  };
  return { ...base, ...overrides };
}

// ===================== Filter Factory =====================
function createFilter(
  algo: BlurAlgorithm,
  radius: number,
  sigma: number,
  border: BorderMode,
): AbstractBlurFilter {
  switch (algo) {
    case BlurAlgorithm.Box:
      return new BoxBlurFilter(radius, border);
    case BlurAlgorithm.Gaussian:
      return new GaussianBlurFilter(radius, sigma, border);
    case BlurAlgorithm.Motion:
      return new MotionBlurFilter(radius, border);
    case BlurAlgorithm.Radial:
      return new BoxBlurFilter(radius, border);
  }
}

// ===================== Blur with Discriminated Result =====================
function blurImage(img: RgbImage, options: BlurOptions): BlurResult {
  try {
    const start = Date.now();
    let out: RgbImage;
    if (options.algorithm === BlurAlgorithm.Radial) {
      out = radialBlur(img, Math.max(4, options.radius * 2 + 1), 0.5);
    } else {
      const filter = createFilter(
        options.algorithm,
        options.radius,
        options.sigma,
        options.border,
      );
      out = filter.apply(img);
    }
    return {
      status: "success",
      image: out,
      algorithm: options.algorithm,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    if (isImageError(e))
      return { status: "error", code: e.code, message: e.message };
    return { status: "error", code: ErrorCode.InvalidArgs, message: String(e) };
  }
}

// ===================== Sharpen (unsharp mask) =====================
function sharpenImage(img: RgbImage, amount: number): RgbImage {
  const result = blurImage(
    img,
    makeOptions({ algorithm: BlurAlgorithm.Gaussian, radius: 1, sigma: 1.0 }),
  );
  if (!isBlurSuccess(result)) {
    throw isBlurError(result)
      ? new ImageError(result.code, result.message)
      : new ImageError(ErrorCode.Cancelled, result.reason);
  }
  const blurred = result.image;
  const out = new ImageBuffer<3>(img.width, img.height, 3);
  for (let i = 0; i < img.data.length; i++) {
    out.data[i] = clamp8(
      img.data[i] + amount * (img.data[i] - blurred.data[i]),
    );
  }
  return out;
}

// ===================== Sobel Edge =====================
function sobelEdge(img: RgbImage): RgbImage {
  const gray = new Float64Array(img.width * img.height);
  let j = 0;
  for (const p of img.pixels())
    gray[j++] = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
  const gxDef: KernelDef = {
    type: KernelType.SobelX,
    size: 3,
    divisor: 1,
    bias: 0,
    data: new Float64Array([-1, 0, 1, -2, 0, 2, -1, 0, 1]),
  };
  const gyDef: KernelDef = {
    type: KernelType.SobelY,
    size: 3,
    divisor: 1,
    bias: 0,
    data: new Float64Array([-1, -2, -1, 0, 0, 0, 1, 2, 1]),
  };
  const out = new ImageBuffer<3>(img.width, img.height, 3);
  const w = img.width,
    h = img.height;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let gx = 0,
        gy = 0;
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const px = gray[(y + ky - 1) * w + (x + kx - 1)];
          gx += px * gxDef.data[ky * 3 + kx];
          gy += px * gyDef.data[ky * 3 + kx];
        }
      }
      const mag = clamp8(Math.sqrt(gx * gx + gy * gy));
      out.setPixel(x, y, mag, mag, mag);
    }
  }
  return out;
}

// ===================== Emboss =====================
function embossImage(img: RgbImage): RgbImage {
  const k: KernelDef = {
    type: KernelType.Emboss,
    size: 3,
    divisor: 1,
    bias: 128,
    data: new Float64Array([-2, -1, 0, -1, 1, 1, 0, 1, 2]),
  };
  const out = new ImageBuffer<3>(img.width, img.height, 3);
  const w = img.width,
    h = img.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0,
        sg = 0,
        sb = 0;
      for (let ky = 0; ky < k.size; ky++) {
        for (let kx = 0; kx < k.size; kx++) {
          const weight = k.data[ky * k.size + kx];
          const off =
            (clampCoord(y + ky - 1, h) * w + clampCoord(x + kx - 1, w)) * 3;
          sr += img.data[off] * weight;
          sg += img.data[off + 1] * weight;
          sb += img.data[off + 2] * weight;
        }
      }
      out.setPixel(
        x,
        y,
        sr / k.divisor + k.bias,
        sg / k.divisor + k.bias,
        sb / k.divisor + k.bias,
      );
    }
  }
  return out;
}

// ===================== Sample Generator =====================
function generateSample(width: number, height: number): RgbImage {
  const img = new ImageBuffer<3>(width, height, 3);
  img.label = "sample";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = Math.round((x / width) * 80);
      let g = Math.round((y / height) * 80);
      let b = 40;
      const dx = x - width / 2,
        dy = y - height / 2;
      if (Math.sqrt(dx * dx + dy * dy) < Math.min(width, height) * 0.25) {
        r = 240;
        g = 120;
        b = 40;
      }
      if (y < height * 0.2 && x > width * 0.2 && x < width * 0.8) {
        r = 40;
        g = 180;
        b = 220;
      }
      img.setPixel(x, y, r, g, b);
    }
  }
  return img;
}

// ===================== CLI Helpers =====================
const BLUR_ALGO_VALUES: readonly BlurAlgorithm[] = [
  BlurAlgorithm.Box,
  BlurAlgorithm.Gaussian,
  BlurAlgorithm.Motion,
  BlurAlgorithm.Radial,
];
function isBlurAlgorithm(v: unknown): v is BlurAlgorithm {
  if (typeof v !== "string") return false;
  return BLUR_ALGO_VALUES.some((a) => a === v);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  let input = "",
    output = "";
  let method: BlurAlgorithm = DEFAULT_BLUR_OPTIONS.algorithm;
  let radius: number = DEFAULT_BLUR_OPTIONS.radius;
  let sigma: number = DEFAULT_BLUR_OPTIONS.sigma;
  let amount: number = DEFAULT_SHARPEN_AMOUNT;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case "-o":
      case "--out":
        output = rest[++i] ?? output;
        break;
      case "-m":
      case "--method": {
        const v = rest[++i];
        if (isBlurAlgorithm(v)) method = v;
        break;
      }
      case "-r":
      case "--radius": {
        const v = parseInt(rest[++i] ?? "", 10);
        if (!isNaN(v) && v > 0) radius = v;
        break;
      }
      case "-s":
      case "--sigma": {
        const v = parseFloat(rest[++i] ?? "");
        if (!isNaN(v) && v > 0) sigma = v;
        break;
      }
      case "-a":
      case "--amount": {
        const v = parseFloat(rest[++i] ?? "");
        if (!isNaN(v)) amount = v;
        break;
      }
      default:
        if (!a.startsWith("-")) {
          if (input === "") input = a;
          else if (output === "") output = a;
        }
    }
  }
  return { command, input, output, method, radius, sigma, amount };
}

function printHelp(): void {
  console.log(`
图像模糊处理 (Image Blur & Convolution) - 增强版
用法:
  blur <input> [-o output] [-m method] [-r radius] [-s sigma]   模糊处理
  sharpen <input> [-o output] [-a amount]                       锐化(unsharp mask)
  edge <input> [-o output]                                      Sobel 边缘检测
  emboss <input> [-o output]                                    浮雕
  info <image>                                                  查看图像信息
  sample [-o output]                                            生成示例图
模糊方法 (-m): gaussian(默认) | box | motion | radial
  -r radius(默认2)  -s sigma(默认1.5)  -a amount(默认1.5)
示例:
  node dist/index.js sample -o ./in.ppm
  node dist/index.js blur ./in.ppm -o ./b.ppm -m gaussian -r 3
  node dist/index.js sharpen ./in.ppm -o ./s.ppm -a 2.0
  node dist/index.js edge ./in.ppm -o ./e.ppm
  node dist/index.js emboss ./in.ppm -o ./m.ppm
`);
}

function defaultOutput(input: string, suffix: string): string {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, `${base}-${suffix}${path.extname(input)}`);
}

function printInfo(img: RgbImage, name: string): void {
  console.log(`图像: ${name}`);
  console.log(`  尺寸: ${img.width} x ${img.height}`);
  console.log(`  通道: ${img.channels}`);
  console.log(`  像素数: ${img.pixelCount}`);
  console.log(`  数据字节: ${img.byteLength}`);
  console.log(`  标签: ${img.label}`);
  const fmt = img[SYM_META].format;
  if (fmt) console.log(`  格式: ${fmt}`);
  const src = img[SYM_META].source;
  if (src) console.log(`  来源: ${src}`);
}

function ensureInput(opts: ParsedArgs): RgbImage {
  if (!opts.input) {
    console.log("(未提供输入，使用生成的示例图)");
    return generateSample(160, 160);
  }
  return readImage(opts.input);
}
function resolveOutput(
  opts: ParsedArgs,
  suffix: string,
  fallback: string,
): string {
  return (
    opts.output || (opts.input ? defaultOutput(opts.input, suffix) : fallback)
  );
}

// ===================== CLI Main =====================
function main(): void {
  const opts = parseArgs(process.argv);
  switch (opts.command) {
    case "sample": {
      const out = opts.output || "./sample.ppm";
      writeImage(out, generateSample(160, 160));
      console.log(`已生成示例图像: ${out}`);
      break;
    }
    case "info": {
      if (!opts.input) {
        console.error("错误：缺少 <image>");
        process.exit(1);
      }
      printInfo(readImage(opts.input), opts.input);
      break;
    }
    case "blur": {
      const img = ensureInput(opts);
      const result = blurImage(
        img,
        makeOptions({
          algorithm: opts.method,
          radius: opts.radius,
          sigma: opts.sigma,
        }),
      );
      if (isBlurSuccess(result)) {
        const target = resolveOutput(
          opts,
          `blur-${opts.method}`,
          "./blur-out.ppm",
        );
        writeImage(target, result.image);
        console.log(
          `模糊(${opts.method}, r=${opts.radius})完成 [${result.elapsedMs}ms]: ${target}`,
        );
      } else if (isBlurError(result)) {
        console.error(`模糊失败 [${result.code}]: ${result.message}`);
        process.exit(1);
      } else if (isBlurCancelled(result)) {
        console.warn(`已取消: ${result.reason}`);
      }
      break;
    }
    case "sharpen": {
      const img = ensureInput(opts);
      const target = resolveOutput(opts, "sharpen", "./sharpen-out.ppm");
      writeImage(target, sharpenImage(img, opts.amount));
      console.log(`锐化(amount=${opts.amount})完成: ${target}`);
      break;
    }
    case "edge": {
      const img = ensureInput(opts);
      const target = resolveOutput(opts, "edge", "./edge-out.ppm");
      writeImage(target, sobelEdge(img));
      console.log(`Sobel 边缘检测完成: ${target}`);
      break;
    }
    case "emboss": {
      const img = ensureInput(opts);
      const target = resolveOutput(opts, "emboss", "./emboss-out.ppm");
      writeImage(target, embossImage(img));
      console.log(`浮雕完成: ${target}`);
      break;
    }
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main();
