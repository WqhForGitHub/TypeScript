#!/usr/bin/env node

/**
 * 图像模糊处理 (Image Blur & Convolution)
 * 一个使用纯 TypeScript 编写的图像卷积/模糊命令行工具。
 * 实现 PPM(P6) 与 BMP(24 位) 读写，支持 box/gaussian/motion/radial 模糊、
 * 锐化(unsharp mask)、Sobel 边缘检测、浮雕等基于卷积的运算。
 * 仅使用 Node.js 内置模块（fs, path）。
 */

import * as fs from "fs";
import * as path from "path";

interface RgbImage {
    width: number;
    height: number;
    data: Uint8Array; // width*height*3, RGB 行优先
}

type BlurMethod = "box" | "gaussian" | "motion" | "radial";

function clamp8(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function detectFormat(filePath: string): "ppm" | "bmp" {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".bmp") return "bmp";
    if (ext === ".ppm") return "ppm";
    throw new Error(`不支持的扩展名: ${ext}（仅 .ppm/.bmp）`);
}

/** ============ PPM(P6) 读写 ============ */
function readPpm(buf: Buffer): RgbImage {
    if (buf.length < 2 || buf[0] !== 0x50) throw new Error("无效 PPM");
    const magic = String.fromCharCode(buf[0], buf[1]);
    if (magic !== "P6") throw new Error(`仅支持 P6 二进制 PPM，得到 ${magic}`);
    let pos = 2;
    const readToken = (): string => {
        let token = "";
        while (pos < buf.length) {
            const c = buf[pos];
            if (c === 0x23) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; continue; }
            if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
                if (token.length > 0) break; pos++; continue;
            }
            token += String.fromCharCode(c); pos++;
        }
        return token;
    };
    const width = parseInt(readToken(), 10);
    const height = parseInt(readToken(), 10);
    const maxval = parseInt(readToken(), 10);
    if (!width || !height || !maxval) throw new Error("PPM 头解析失败");
    const need = width * height * 3;
    if (buf.length - pos < need) throw new Error("PPM 像素数据不足");
    const data = new Uint8Array(need);
    for (let i = 0; i < need; i++) {
        data[i] = maxval === 255 ? buf[pos + i] : Math.round((buf[pos + i] / maxval) * 255);
    }
    return { width, height, data };
}

function writePpm(img: RgbImage): Buffer {
    const header = `P6\n${img.width} ${img.height}\n255\n`;
    return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(img.data)]);
}

/** ============ BMP(24 位) 读写 ============ */
function readBmp(buf: Buffer): RgbImage {
    if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("无效 BMP");
    const dataOffset = buf.readUInt32LE(10);
    const width = buf.readInt32LE(18);
    const heightRaw = buf.readInt32LE(22);
    const bpp = buf.readUInt16LE(28);
    if (bpp !== 24) throw new Error(`仅支持 24 位 BMP（得到 ${bpp}）`);
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
            data[dst] = buf[off + 2];     // R
            data[dst + 1] = buf[off + 1]; // G
            data[dst + 2] = buf[off];     // B
        }
    }
    return { width, height, data };
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

function readImage(filePath: string): RgbImage {
    const buf = fs.readFileSync(filePath);
    return detectFormat(filePath) === "ppm" ? readPpm(buf) : readBmp(buf);
}

function writeImage(filePath: string, img: RgbImage): void {
    const buf = detectFormat(filePath) === "ppm" ? writePpm(img) : writeBmp(img);
    fs.writeFileSync(filePath, buf);
}

/** ============ 卷积核心 ============ */

/** 通用 3 通道卷积，kernel 大小 size x size，归一化系数 divisor */
function convolve(img: RgbImage, kernel: Float64Array, size: number, divisor: number, bias: number): RgbImage {
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    const half = Math.floor(size / 2);
    const w = img.width, h = img.height;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sr = 0, sg = 0, sb = 0;
            for (let ky = 0; ky < size; ky++) {
                for (let kx = 0; kx < size; kx++) {
                    const sx = Math.min(w - 1, Math.max(0, x + kx - half));
                    const sy = Math.min(h - 1, Math.max(0, y + ky - half));
                    const k = kernel[ky * size + kx];
                    const off = (sy * w + sx) * 3;
                    sr += img.data[off] * k;
                    sg += img.data[off + 1] * k;
                    sb += img.data[off + 2] * k;
                }
            }
            const d = (y * w + x) * 3;
            out.data[d] = clamp8(sr / divisor + bias);
            out.data[d + 1] = clamp8(sg / divisor + bias);
            out.data[d + 2] = clamp8(sb / divisor + bias);
        }
    }
    return out;
}

/** 高斯核（预计算） */
function gaussianKernel(radius: number, sigma: number): { kernel: Float64Array; size: number; divisor: number } {
    const size = radius * 2 + 1;
    const kernel = new Float64Array(size * size);
    const s2 = 2 * sigma * sigma;
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
            const v = Math.exp(-(x * x + y * y) / s2);
            kernel[(y + radius) * size + (x + radius)] = v;
            sum += v;
        }
    }
    return { kernel, size, divisor: sum };
}

/** Box 模糊核（均值） */
function boxKernel(radius: number): { kernel: Float64Array; size: number; divisor: number } {
    const size = radius * 2 + 1;
    const kernel = new Float64Array(size * size).fill(1);
    return { kernel, size, divisor: size * size };
}

/** Motion 模糊核（沿主对角线） */
function motionKernel(size: number): { kernel: Float64Array; size: number; divisor: number } {
    const kernel = new Float64Array(size * size).fill(0);
    for (let i = 0; i < size; i++) kernel[i * size + i] = 1;
    return { kernel, size, divisor: size };
}

/** Radial 模糊（径向，沿到中心的直线累加，近似） */
function radialBlur(img: RgbImage, samples: number, strength: number): RgbImage {
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    const cx = img.width / 2;
    const cy = img.height / 2;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            let r = 0, g = 0, b = 0;
            const dx = x - cx, dy = y - cy;
            for (let s = 0; s < samples; s++) {
                const t = s / samples;
                const sx = Math.round(x - dx * t * strength);
                const sy = Math.round(y - dy * t * strength);
                const cx2 = Math.min(img.width - 1, Math.max(0, sx));
                const cy2 = Math.min(img.height - 1, Math.max(0, sy));
                const off = (cy2 * img.width + cx2) * 3;
                r += img.data[off];
                g += img.data[off + 1];
                b += img.data[off + 2];
            }
            const d = (y * img.width + x) * 3;
            out.data[d] = clamp8(r / samples);
            out.data[d + 1] = clamp8(g / samples);
            out.data[d + 2] = clamp8(b / samples);
        }
    }
    return out;
}

function blurImage(img: RgbImage, method: BlurMethod, radius: number, sigma: number): RgbImage {
    if (method === "radial") return radialBlur(img, Math.max(4, radius * 2 + 1), 0.5);
    let k;
    if (method === "box") k = boxKernel(radius);
    else if (method === "gaussian") k = gaussianKernel(radius, sigma);
    else k = motionKernel(radius * 2 + 1);
    return convolve(img, k.kernel, k.size, k.divisor, 0);
}

/** 锐化（unsharp mask = 原 + amount*(原 - 模糊)） */
function sharpenImage(img: RgbImage, amount: number): RgbImage {
    const blurred = blurImage(img, "gaussian", 1, 1.0);
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    for (let i = 0; i < img.data.length; i++) {
        out.data[i] = clamp8(img.data[i] + amount * (img.data[i] - blurred.data[i]));
    }
    return out;
}

/** Sobel 边缘检测 */
function sobelEdge(img: RgbImage): RgbImage {
    // 先转灰度
    const gray = new Float64Array(img.width * img.height);
    for (let i = 0, j = 0; i < img.data.length; i += 3, j++) {
        gray[j] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    }
    const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
    const w = img.width, h = img.height;
    const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let gx = 0, gy = 0;
            for (let ky = 0; ky < 3; ky++) {
                for (let kx = 0; kx < 3; kx++) {
                    const px = gray[(y + ky - 1) * w + (x + kx - 1)];
                    gx += px * gxK[ky * 3 + kx];
                    gy += px * gyK[ky * 3 + kx];
                }
            }
            const mag = clamp8(Math.sqrt(gx * gx + gy * gy));
            const off = (y * w + x) * 3;
            out.data[off] = mag;
            out.data[off + 1] = mag;
            out.data[off + 2] = mag;
        }
    }
    return out;
}

/** 浮雕 */
function embossImage(img: RgbImage): RgbImage {
    const kernel = new Float64Array([
        -2, -1, 0,
        -1,  1, 1,
         0,  1, 2,
    ]);
    return convolve(img, kernel, 3, 1, 128);
}

/** 生成示例图（含几何形状便于观察卷积效果） */
function generateSample(width: number, height: number): RgbImage {
    const img: RgbImage = { width, height, data: new Uint8Array(width * height * 3) };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const off = (y * width + x) * 3;
            // 背景：渐变
            let r = Math.round((x / width) * 80);
            let g = Math.round((y / height) * 80);
            let b = 40;
            // 中心圆
            const dx = x - width / 2, dy = y - height / 2;
            if (Math.sqrt(dx * dx + dy * dy) < Math.min(width, height) * 0.25) {
                r = 240; g = 120; b = 40;
            }
            // 顶部矩形
            if (y < height * 0.2 && x > width * 0.2 && x < width * 0.8) {
                r = 40; g = 180; b = 220;
            }
            img.data[off] = r;
            img.data[off + 1] = g;
            img.data[off + 2] = b;
        }
    }
    return img;
}

interface ParsedArgs {
    command: string;
    input: string;
    output: string;
    method: BlurMethod;
    radius: number;
    sigma: number;
    amount: number;
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
    let method: BlurMethod = "gaussian";
    let radius = 2;
    let sigma = 1.5;
    let amount = 1.5;

    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-o": case "--out": output = rest[++i] ?? output; break;
            case "-m": case "--method": {
                const v = rest[++i] as BlurMethod;
                if (v === "box" || v === "gaussian" || v === "motion" || v === "radial") method = v;
                break;
            }
            case "-r": case "--radius": {
                const v = parseInt(rest[++i] ?? "", 10);
                if (!isNaN(v) && v > 0) radius = v;
                break;
            }
            case "-s": case "--sigma": {
                const v = parseFloat(rest[++i] ?? "");
                if (!isNaN(v) && v > 0) sigma = v;
                break;
            }
            case "-a": case "--amount": {
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
图像模糊处理 (Image Blur & Convolution)

用法:
  blur <input> [-o output] [-m method] [-r radius] [-s sigma]   模糊处理
  sharpen <input> [-o output] [-a amount]                       锐化(unsharp mask)
  edge <input> [-o output]                                      Sobel 边缘检测
  emboss <input> [-o output]                                    浮雕
  info <image>                                                  查看图像信息
  sample [-o output]                                            生成示例图（无输入时演示用）

模糊方法 (-m): gaussian(默认) | box | motion | radial
  -r radius: 核半径(默认2)   -s sigma: 高斯 sigma(默认1.5)   -a amount: 锐化强度(默认1.5)

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
    console.log(`  像素数: ${img.width * img.height}`);
    console.log(`  数据字节: ${img.data.length}`);
}

function main(): void {
    const opts = parseArgs(process.argv);

    switch (opts.command) {
        case "sample": {
            const out = opts.output || "./sample.ppm";
            const img = generateSample(160, 160);
            writeImage(out, img);
            console.log(`已生成示例图像: ${out}`);
            break;
        }
        case "info": {
            if (!opts.input) { console.error("错误：缺少 <image>"); process.exit(1); }
            printInfo(readImage(opts.input), opts.input);
            break;
        }
        case "blur": {
            // 若未提供 input，自动生成示例
            let img: RgbImage;
            if (!opts.input) {
                img = generateSample(160, 160);
                console.log("(未提供输入，使用生成的示例图)");
            } else {
                img = readImage(opts.input);
            }
            const out = blurImage(img, opts.method, opts.radius, opts.sigma);
            const target = opts.output || (opts.input ? defaultOutput(opts.input, `blur-${opts.method}`) : "./blur-out.ppm");
            writeImage(target, out);
            console.log(`模糊(${opts.method}, r=${opts.radius})完成: ${target}`);
            break;
        }
        case "sharpen": {
            let img: RgbImage;
            if (!opts.input) { img = generateSample(160, 160); console.log("(使用示例图)"); }
            else img = readImage(opts.input);
            const out = sharpenImage(img, opts.amount);
            const target = opts.output || (opts.input ? defaultOutput(opts.input, "sharpen") : "./sharpen-out.ppm");
            writeImage(target, out);
            console.log(`锐化(amount=${opts.amount})完成: ${target}`);
            break;
        }
        case "edge": {
            let img: RgbImage;
            if (!opts.input) { img = generateSample(160, 160); console.log("(使用示例图)"); }
            else img = readImage(opts.input);
            const out = sobelEdge(img);
            const target = opts.output || (opts.input ? defaultOutput(opts.input, "edge") : "./edge-out.ppm");
            writeImage(target, out);
            console.log(`Sobel 边缘检测完成: ${target}`);
            break;
        }
        case "emboss": {
            let img: RgbImage;
            if (!opts.input) { img = generateSample(160, 160); console.log("(使用示例图)"); }
            else img = readImage(opts.input);
            const out = embossImage(img);
            const target = opts.output || (opts.input ? defaultOutput(opts.input, "emboss") : "./emboss-out.ppm");
            writeImage(target, out);
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
