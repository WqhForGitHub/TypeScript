#!/usr/bin/env node

/**
 * 图像灰度化 (Image Grayscale)
 * 一个使用纯 TypeScript 编写的图像处理命令行工具。
 * 实现 PPM(P3/P6) 与 BMP(24 位) 格式的纯 TS 读写器，
 * 支持亮度法/平均法/明度法/去色法/自定义权重/sepia/阈值/反色等多种像素操作。
 * 仅使用 Node.js 内置模块（fs, path）。
 */

import * as fs from "fs";
import * as path from "path";

/** RGB 图像数据（每像素 3 字节，行优先，从上到下） */
interface RgbImage {
    width: number;
    height: number;
    data: Uint8Array; // length = width * height * 3
}

/** 支持的图像格式 */
type ImageFormat = "ppm" | "bmp";

/** 灰度方法 */
type GrayMethod = "luminance" | "average" | "lightness" | "desaturation" | "custom";

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

function clamp8(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** 根据扩展名推断格式 */
function detectFormat(filePath: string): ImageFormat {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".bmp") return "bmp";
    if (ext === ".ppm") return "ppm";
    throw new Error(`不支持的文件扩展名: ${ext}（仅支持 .ppm/.bmp）`);
}

/** ============ PPM 读取器（P3 ASCII 与 P6 二进制） ============ */

function readPpm(buf: Buffer): RgbImage {
    if (buf.length < 2 || buf[0] !== 0x50) throw new Error("无效 PPM 文件头");
    const magic = String.fromCharCode(buf[0], buf[1]);
    if (magic !== "P3" && magic !== "P6") throw new Error(`仅支持 P3/P6 PPM，得到 ${magic}`);

    let pos = 2;
    // 读取三个整数：width, height, maxval，跳过注释与空白
    const readToken = (): string => {
        let token = "";
        while (pos < buf.length) {
            const c = buf[pos];
            if (c === 0x23) {
                // # 注释，跳过到行尾
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
    if (!width || !height || !maxval) throw new Error("PPM 头解析失败");

    const data = new Uint8Array(width * height * 3);

    if (magic === "P6") {
        // 单个空白分隔 maxval 与二进制像素数据
        // 当前 pos 指向 maxval 之后的第一个空白已被消费，下一字节开始是像素
        const bytesPerSample = maxval > 255 ? 2 : 1;
        if (bytesPerSample !== 1) throw new Error("暂不支持 16 位 PPM");
        const need = width * height * 3;
        if (buf.length - pos < need) throw new Error("PPM 像素数据不足");
        for (let i = 0; i < need; i++) {
            data[i] = maxval === 255 ? buf[pos + i] : Math.round((buf[pos + i] / maxval) * 255);
        }
    } else {
        // P3 ASCII
        let idx = 0;
        while (idx < data.length) {
            const t = readToken();
            if (t.length === 0) break;
            const v = parseInt(t, 10);
            data[idx++] = maxval === 255 ? v : Math.round((v / maxval) * 255);
        }
        if (idx !== data.length) throw new Error("P3 像素数据不足");
    }
    return { width, height, data };
}

/** 写入 P6 二进制 PPM */
function writePpm(img: RgbImage): Buffer {
    const header = `P6\n${img.width} ${img.height}\n255\n`;
    const headBuf = Buffer.from(header, "ascii");
    return Buffer.concat([headBuf, Buffer.from(img.data)]);
}

/** ============ BMP 24 位读取器/写入器 ============ */

function readBmp(buf: Buffer): RgbImage {
    if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("无效 BMP 文件头");
    const dataOffset = buf.readUInt32LE(10);
    const dibSize = buf.readUInt32LE(14);
    const width = buf.readInt32LE(18);
    const heightRaw = buf.readInt32LE(22);
    const bpp = buf.readUInt16LE(28);
    if (bpp !== 24) throw new Error(`仅支持 24 位 BMP，得到 ${bpp} 位`);
    const height = Math.abs(heightRaw);
    const topDown = heightRaw < 0;
    const rowSize = Math.floor((24 * width + 31) / 32) * 4;
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        const srcRow = topDown ? y : height - 1 - y;
        const rowStart = dataOffset + srcRow * rowSize;
        for (let x = 0; x < width; x++) {
            const off = rowStart + x * 3;
            const b = buf[off];
            const g = buf[off + 1];
            const r = buf[off + 2];
            const dst = (y * width + x) * 3;
            data[dst] = r;
            data[dst + 1] = g;
            data[dst + 2] = b;
        }
    }
    return { width, height, data };
}

function writeBmp(img: RgbImage): Buffer {
    const width = img.width;
    const height = img.height;
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
        const srcRow = height - 1 - y; // 自下而上
        const rowStart = 54 + y * rowSize;
        for (let x = 0; x < width; x++) {
            const src = (srcRow * width + x) * 3;
            const off = rowStart + x * 3;
            buf[off] = img.data[src + 2];     // B
            buf[off + 1] = img.data[src + 1]; // G
            buf[off + 2] = img.data[src];     // R
        }
    }
    return buf;
}

/** 读取图像（自动识别格式） */
function readImage(filePath: string): RgbImage {
    const buf = fs.readFileSync(filePath);
    const fmt = detectFormat(filePath);
    return fmt === "ppm" ? readPpm(buf) : readBmp(buf);
}

/** 写入图像（按目标扩展名） */
function writeImage(filePath: string, img: RgbImage): void {
    const fmt = detectFormat(filePath);
    const buf = fmt === "ppm" ? writePpm(img) : writeBmp(img);
    fs.writeFileSync(filePath, buf);
}

/** ============ 像素操作 ============ */

function getPixel(img: RgbImage, x: number, y: number): [number, number, number] {
    const off = (y * img.width + x) * 3;
    return [img.data[off], img.data[off + 1], img.data[off + 2]];
}

function setPixel(img: RgbImage, x: number, y: number, r: number, g: number, b: number): void {
    const off = (y * img.width + x) * 3;
    img.data[off] = clamp8(r);
    img.data[off + 1] = clamp8(g);
    img.data[off + 2] = clamp8(b);
}

/** 计算单个像素的灰度值 */
function grayOf(r: number, g: number, b: number, method: GrayMethod, weights: [number, number, number]): number {
    switch (method) {
        case "luminance":
            return clamp8(r * LUMA_R + g * LUMA_G + b * LUMA_B);
        case "average":
            return clamp8((r + g + b) / 3);
        case "lightness":
            return clamp8((Math.max(r, g, b) + Math.min(r, g, b)) / 2);
        case "desaturation":
            return clamp8((Math.max(r, g, b) + Math.min(r, g, b)) / 2);
        case "custom":
            return clamp8(r * weights[0] + g * weights[1] + b * weights[2]);
    }
}

/** 灰度化（生成灰度 RGB 图） */
function toGrayscale(img: RgbImage, method: GrayMethod, weights: [number, number, number]): RgbImage {
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    for (let i = 0; i < img.data.length; i += 3) {
        const v = grayOf(img.data[i], img.data[i + 1], img.data[i + 2], method, weights);
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
    }
    return out;
}

/** Sepia 棕褐色调 */
function toSepia(img: RgbImage): RgbImage {
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    for (let i = 0; i < img.data.length; i += 3) {
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        out.data[i] = clamp8(0.393 * r + 0.769 * g + 0.189 * b);
        out.data[i + 1] = clamp8(0.349 * r + 0.686 * g + 0.168 * b);
        out.data[i + 2] = clamp8(0.272 * r + 0.534 * g + 0.131 * b);
    }
    return out;
}

/** 阈值二值化 */
function thresholdImage(img: RgbImage, level: number): RgbImage {
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    for (let i = 0; i < img.data.length; i += 3) {
        const v = grayOf(img.data[i], img.data[i + 1], img.data[i + 2], "luminance", [0, 0, 0]);
        const t = v >= level ? 255 : 0;
        out.data[i] = t;
        out.data[i + 1] = t;
        out.data[i + 2] = t;
    }
    return out;
}

/** 反色 */
function invertImage(img: RgbImage): RgbImage {
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    for (let i = 0; i < img.data.length; i++) {
        out.data[i] = 255 - img.data[i];
    }
    return out;
}

/** 计算直方图（256 个亮度桶） */
function histogram(img: RgbImage): { buckets: number[]; total: number } {
    const buckets = new Array<number>(256).fill(0);
    let total = 0;
    for (let i = 0; i < img.data.length; i += 3) {
        const v = grayOf(img.data[i], img.data[i + 1], img.data[i + 2], "luminance", [0, 0, 0]);
        buckets[v]++;
        total++;
    }
    return { buckets, total };
}

/** 生成一张示例渐变图像用于演示 */
function generateSample(width: number, height: number): RgbImage {
    const img: RgbImage = { width, height, data: new Uint8Array(width * height * 3) };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const r = Math.round((x / width) * 255);
            const g = Math.round((y / height) * 255);
            const b = Math.round(((x + y) / (width + height)) * 255);
            setPixel(img, x, y, r, g, b);
        }
    }
    return img;
}

interface ParsedArgs {
    command: string;
    input: string;
    output: string;
    method: GrayMethod;
    weights: [number, number, number];
    level: number;
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
    let method: GrayMethod = "luminance";
    let weights: [number, number, number] = [0.299, 0.587, 0.114];
    let level = 128;

    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-o": case "--out": output = rest[++i] ?? output; break;
            case "-m": case "--method": {
                const v = rest[++i] as GrayMethod;
                if (v === "luminance" || v === "average" || v === "lightness" || v === "desaturation" || v === "custom") method = v;
                break;
            }
            case "-w": case "--weights": {
                const s = rest[++i] ?? "";
                const parts = s.split(",").map((n) => parseFloat(n));
                if (parts.length === 3 && parts.every((n) => !isNaN(n))) weights = parts as [number, number, number];
                break;
            }
            case "-l": case "--level": {
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
图像灰度化 (Image Grayscale)

用法:
  gray <input> [-o output] [-m method] [-w r,g,b]   灰度化处理
  info <image>                                       查看图像信息与直方图摘要
  convert <input> <output>                           格式转换 (PPM <-> BMP)
  threshold <input> <level> [-o output]              阈值二值化 (0-255)
  sepia <input> [-o output]                          棕褐色调
  invert <input> [-o output]                         反色
  sample [-o output]                                 生成示例渐变图（不输入时用 sample）

方法 (-m): luminance(默认,0.299R+0.587G+0.114B) | average | lightness | desaturation | custom
自定义权重 (-w): 如 -w 0.3,0.59,0.11

示例:
  node dist/index.js sample -o ./in.ppm
  node dist/index.js gray ./in.ppm -o ./gray.bmp -m average
  node dist/index.js threshold ./in.ppm 100 -o ./bin.ppm
  node dist/index.js info ./gray.bmp
`);
}

function defaultOutput(input: string, suffix: string, ext: string): string {
    const dir = path.dirname(input);
    const base = path.basename(input, path.extname(input));
    return path.join(dir, `${base}-${suffix}.${ext}`);
}

function printImageInfo(img: RgbImage, name: string): void {
    const { buckets, total } = histogram(img);
    const maxBucket = Math.max(...buckets);
    console.log(`图像: ${name}`);
    console.log(`  尺寸: ${img.width} x ${img.height}`);
    console.log(`  像素数: ${total}`);
    console.log(`  字节数: ${img.data.length}`);
    console.log(`  平均亮度: ${(buckets.reduce((s, c, i) => s + c * i, 0) / Math.max(total, 1)).toFixed(2)}`);
    // 简易 ASCII 直方图（每 32 级一格）
    console.log("  直方图(每32级汇总):");
    for (let b = 0; b < 256; b += 32) {
        const sum = buckets.slice(b, b + 32).reduce((s, c) => s + c, 0);
        const bar = "#".repeat(Math.round((sum / maxBucket) * 40));
        console.log(`    ${b.toString().padStart(3)}-${(b + 31).toString().padStart(3)}: ${bar} (${sum})`);
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
        case "info": {
            if (!opts.input) { console.error("错误：缺少 <image>"); process.exit(1); }
            const img = readImage(opts.input);
            printImageInfo(img, opts.input);
            break;
        }
        case "convert": {
            if (!opts.input || !opts.output) { console.error("错误：用法 convert <input> <output>"); process.exit(1); }
            const img = readImage(opts.input);
            writeImage(opts.output, img);
            console.log(`已转换: ${opts.input} -> ${opts.output}`);
            break;
        }
        case "gray": {
            if (!opts.input) { console.error("错误：缺少 <input>"); process.exit(1); }
            const img = readImage(opts.input);
            const out = toGrayscale(img, opts.method, opts.weights);
            const target = opts.output || defaultOutput(opts.input, "gray", "ppm");
            writeImage(target, out);
            console.log(`灰度化(${opts.method})完成: ${target}`);
            break;
        }
        case "threshold": {
            if (!opts.input) { console.error("错误：缺少 <input>"); process.exit(1); }
            const img = readImage(opts.input);
            const out = thresholdImage(img, opts.level);
            const target = opts.output || defaultOutput(opts.input, `thr${opts.level}`, "ppm");
            writeImage(target, out);
            console.log(`阈值二值化(level=${opts.level})完成: ${target}`);
            break;
        }
        case "sepia": {
            if (!opts.input) { console.error("错误：缺少 <input>"); process.exit(1); }
            const img = readImage(opts.input);
            const out = toSepia(img);
            const target = opts.output || defaultOutput(opts.input, "sepia", "ppm");
            writeImage(target, out);
            console.log(`棕褐色调完成: ${target}`);
            break;
        }
        case "invert": {
            if (!opts.input) { console.error("错误：缺少 <input>"); process.exit(1); }
            const img = readImage(opts.input);
            const out = invertImage(img);
            const target = opts.output || defaultOutput(opts.input, "invert", "ppm");
            writeImage(target, out);
            console.log(`反色完成: ${target}`);
            break;
        }
        case "histogram": {
            if (!opts.input) { console.error("错误：缺少 <image>"); process.exit(1); }
            const img = readImage(opts.input);
            printImageInfo(img, opts.input);
            break;
        }
        default:
            console.error(`未知命令: ${opts.command}`);
            printHelp();
            process.exit(1);
    }
}

main();
