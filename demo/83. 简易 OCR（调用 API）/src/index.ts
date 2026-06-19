#!/usr/bin/env node

/**
 * 简易 OCR（调用 API）
 * 一个使用纯 TypeScript 编写的命令行 OCR 工具。
 * 调用可配置的外部 HTTP OCR API（multipart 上传图片，解析 JSON 响应）。
 * 当未配置 API（无 URL/Key）时进入"演示模式"：返回基于文件特征的模拟识别结果。
 * 仅使用 Node.js 内置模块（fs, path, os, http, https, crypto, url）。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import { URL } from "url";

/** OCR 配置 */
interface OcrConfig {
    apiUrl: string;
    apiKey: string;
    demoMode: boolean;
    timeoutMs: number;
}

/** OCR 识别结果 */
interface OcrResult {
    source: string;
    success: boolean;
    mode: "live" | "demo";
    text: string;
    confidence: number;
    raw?: string;
    error?: string;
    elapsedMs: number;
}

const CONFIG_PATH: string = path.join(os.homedir(), ".simple-ocr-config.json");

/** 加载配置：环境变量优先于配置文件，默认进入演示模式 */
function loadConfig(): OcrConfig {
    const fileConfig: Partial<OcrConfig> = fs.existsSync(CONFIG_PATH)
        ? safeParseJSON(fs.readFileSync(CONFIG_PATH, "utf-8"))
        : {};
    const apiUrl = process.env.OCR_API_URL ?? fileConfig.apiUrl ?? "";
    const apiKey = process.env.OCR_API_KEY ?? fileConfig.apiKey ?? "";
    const demoMode = apiUrl.length === 0;
    return {
        apiUrl,
        apiKey,
        demoMode,
        timeoutMs: fileConfig.timeoutMs ?? 30000,
    };
}

function safeParseJSON(s: string): Partial<OcrConfig> {
    try {
        return JSON.parse(s) as Partial<OcrConfig>;
    } catch {
        return {};
    }
}

/** 保存配置到文件 */
function saveConfig(cfg: OcrConfig): void {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

/** 构建 multipart/form-data 请求体 */
function buildMultipart(fields: Record<string, string>, fileField: string, fileName: string, fileData: Buffer): { body: Buffer; contentType: string } {
    const boundary = "----SimpleOcrBoundary" + crypto.randomBytes(8).toString("hex");
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
            "utf-8"
        ));
    }
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        "utf-8"
    ));
    parts.push(fileData);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 调用真实 OCR API（multipart 上传） */
function callLiveOcr(cfg: OcrConfig, imagePath: string): Promise<OcrResult> {
    return new Promise((resolve) => {
        const start = Date.now();
        const fileName = path.basename(imagePath);
        const fileData = fs.readFileSync(imagePath);
        const { body, contentType } = buildMultipart(
            { api_key: cfg.apiKey, lang: "auto" },
            "image",
            fileName,
            fileData
        );

        const url = new URL(cfg.apiUrl);
        const lib = url.protocol === "https:" ? https : http;
        const reqOptions: http.RequestOptions = {
            method: "POST",
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            headers: {
                "Content-Type": contentType,
                "Content-Length": Buffer.byteLength(body),
                "User-Agent": "simple-ocr/1.0",
            },
            timeout: cfg.timeoutMs,
        };

        const req = lib.request(reqOptions, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
                const elapsedMs = Date.now() - start;
                const raw = Buffer.concat(chunks).toString("utf-8");
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(raw);
                        // 兼容多种常见字段
                        const text = parsed.text ?? parsed.result ?? parsed.recognized_text ?? JSON.stringify(parsed);
                        const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.85;
                        resolve({
                            source: imagePath,
                            success: true,
                            mode: "live",
                            text: String(text),
                            confidence,
                            raw,
                            elapsedMs,
                        });
                    } catch {
                        resolve({
                            source: imagePath, success: false, mode: "live",
                            text: "", confidence: 0, raw, elapsedMs,
                            error: "响应不是有效 JSON",
                        });
                    }
                } else {
                    resolve({
                        source: imagePath, success: false, mode: "live",
                        text: "", confidence: 0, raw, elapsedMs,
                        error: `HTTP ${res.statusCode}`,
                    });
                }
            });
        });

        req.on("timeout", () => {
            req.destroy();
            resolve({
                source: imagePath, success: false, mode: "live",
                text: "", confidence: 0, elapsedMs: Date.now() - start,
                error: "请求超时",
            });
        });
        req.on("error", (err: NodeJS.ErrnoException) => {
            resolve({
                source: imagePath, success: false, mode: "live",
                text: "", confidence: 0, elapsedMs: Date.now() - start,
                error: err.message,
            });
        });
        req.write(body);
        req.end();
    });
}

/** 演示模式：基于文件字节特征生成模拟识别文本 */
function demoOcr(imagePath: string): OcrResult {
    const start = Date.now();
    const buf = fs.readFileSync(imagePath);
    // 用文件大小与若干字节哈希派生"识别文本"
    const hash = crypto.createHash("md5").update(buf).digest("hex");
    const sizeKB = (buf.length / 1024).toFixed(2);
    const headHex = buf.subarray(0, 8).toString("hex");
    // 检测常见图片格式特征
    let format = "未知";
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) format = "JPEG";
    else if (buf.length >= 8 && buf.subarray(0, 8).toString("ascii").startsWith("\x89PNG")) format = "PNG";
    else if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) format = "BMP";
    else if (buf.length >= 2 && buf[0] === 0x50 && (buf[1] >= 0x31 && buf[1] <= 0x36)) format = "PPM/PGM";

    const mockLines = [
        "[演示模式] 此为模拟识别结果，未调用真实 OCR API。",
        `文件: ${path.basename(imagePath)}  格式: ${format}  大小: ${sizeKB} KB`,
        `指纹(md5): ${hash}`,
        `头字节: ${headHex}`,
        `建议: 设置 OCR_API_URL 与 OCR_API_KEY 环境变量后启用真实识别。`,
    ];
    return {
        source: imagePath,
        success: true,
        mode: "demo",
        text: mockLines.join("\n"),
        confidence: 0.0,
        elapsedMs: Date.now() - start,
    };
}

/** 单张图片 OCR，自动选择演示或真实模式 */
async function ocrImage(cfg: OcrConfig, imagePath: string): Promise<OcrResult> {
    if (!fs.existsSync(imagePath)) {
        return {
            source: imagePath, success: false, mode: cfg.demoMode ? "demo" : "live",
            text: "", confidence: 0, elapsedMs: 0, error: "文件不存在",
        };
    }
    if (cfg.demoMode) return demoOcr(imagePath);
    return callLiveOcr(cfg, imagePath);
}

/** 批量 OCR 一个目录中的图片 */
async function batchOcr(cfg: OcrConfig, dir: string, outDir: string): Promise<void> {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.error(`错误：目录不存在 ${dir}`);
        process.exit(1);
    }
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const exts = [".jpg", ".jpeg", ".png", ".bmp", ".ppm", ".pgm", ".tif", ".tiff"];
    const files = fs
        .readdirSync(dir)
        .filter((f) => exts.includes(path.extname(f).toLowerCase()))
        .map((f) => path.join(dir, f));

    if (files.length === 0) {
        console.log("未找到图片文件。");
        return;
    }
    console.log(`找到 ${files.length} 张图片，模式: ${cfg.demoMode ? "演示" : "真实"}...`);
    let okCount = 0;
    for (const f of files) {
        const result = await ocrImage(cfg, f);
        if (result.success) okCount++;
        printResult(result);
        const outPath = path.join(outDir, path.basename(f) + ".txt");
        fs.writeFileSync(outPath, result.text + (result.error ? `\n[ERROR] ${result.error}` : ""), "utf-8");
        console.log(`  已写入: ${outPath}\n`);
    }
    console.log(`完成: ${okCount}/${files.length} 成功。`);
}

function printResult(r: OcrResult): void {
    console.log(`--- ${path.basename(r.source)} ---`);
    console.log(`模式: ${r.mode}  耗时: ${r.elapsedMs}ms  置信度: ${(r.confidence * 100).toFixed(1)}%`);
    if (r.error) console.log(`错误: ${r.error}`);
    console.log("识别文本:");
    console.log(r.text || "(空)");
}

interface ParsedArgs {
    command: string;
    image: string;
    dir: string;
    outDir: string;
    apiUrl: string;
    apiKey: string;
    setUrl: string;
    setKey: string;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    const out: ParsedArgs = {
        command, image: "", dir: "", outDir: "./ocr-out",
        apiUrl: "", apiKey: "", setUrl: "", setKey: "",
    };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-u": case "--url": out.apiUrl = rest[++i] ?? ""; break;
            case "-k": case "--key": out.apiKey = rest[++i] ?? ""; break;
            case "-o": case "--out": out.outDir = rest[++i] ?? out.outDir; break;
            case "--set-url": out.setUrl = rest[++i] ?? ""; break;
            case "--set-key": out.setKey = rest[++i] ?? ""; break;
            default:
                if (!a.startsWith("-")) {
                    if (command === "ocr" && out.image === "") out.image = a;
                    else if (command === "batch" && out.dir === "") out.dir = a;
                }
        }
    }
    return out;
}

function printHelp(): void {
    console.log(`
简易 OCR（调用 API）

用法:
  ocr <image> [-u apiurl] [-k apikey]       识别单张图片
  batch <dir> [-o outdir] [-u url] [-k key] 批量识别目录中的图片
  config [--set-url url] [--set-key key]    查看/设置配置
  test                                       运行内置自检（演示模式）

选项:
  -u, --url <url>    OCR API 端点 URL（覆盖配置）
  -k, --key <key>    OCR API Key（覆盖配置）
  -o, --out <dir>    批量结果输出目录（默认 ./ocr-out）
  -h, --help         显示帮助

环境变量:
  OCR_API_URL    OCR API 端点
  OCR_API_KEY    OCR API 密钥

模式说明:
  - 演示模式: 未配置 API URL/Key 时启用，返回模拟识别文本，便于本地测试。
  - 真实模式: 配置了 OCR_API_URL 后启用，使用 multipart/form-data 上传图片到 API，
              并解析返回的 JSON（兼容 text / result / recognized_text 字段）。

示例:
  node dist/index.js ocr ./sample.png
  node dist/index.js config --set-url http://localhost:9000/ocr --set-key secret
  node dist/index.js batch ./images -o ./out
`);
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv);
    const cfg = loadConfig();
    // 命令行参数临时覆盖配置
    if (opts.apiUrl) cfg.apiUrl = opts.apiUrl;
    if (opts.apiKey) cfg.apiKey = opts.apiKey;
    cfg.demoMode = cfg.apiUrl.length === 0;

    switch (opts.command) {
        case "ocr": {
            if (!opts.image) {
                console.error("错误：未提供图片路径。");
                process.exit(1);
            }
            const r = await ocrImage(cfg, opts.image);
            printResult(r);
            break;
        }
        case "batch": {
            if (!opts.dir) {
                console.error("错误：未提供目录路径。");
                process.exit(1);
            }
            await batchOcr(cfg, opts.dir, opts.outDir);
            break;
        }
        case "config": {
            if (opts.setUrl || opts.setKey) {
                if (opts.setUrl) cfg.apiUrl = opts.setUrl;
                if (opts.setKey) cfg.apiKey = opts.setKey;
                cfg.demoMode = cfg.apiUrl.length === 0;
                saveConfig(cfg);
                console.log("配置已保存。");
            }
            console.log("当前配置:");
            console.log(`  API URL : ${cfg.apiUrl || "(未配置)"}`);
            console.log(`  API Key : ${cfg.apiKey ? "*".repeat(cfg.apiKey.length) : "(未配置)"}`);
            console.log(`  模式    : ${cfg.demoMode ? "演示模式" : "真实模式"}`);
            console.log(`  超时    : ${cfg.timeoutMs}ms`);
            console.log(`  配置文件: ${CONFIG_PATH}`);
            break;
        }
        case "test": {
            console.log("运行内置自检（演示模式）...");
            // 生成一张临时 BMP 文件用于测试
            const tmp = path.join(os.tmpdir(), "simple-ocr-test.bmp");
            const bmp = createMinimalBmp(16, 16, 0x123456);
            fs.writeFileSync(tmp, bmp);
            const r = await ocrImage({ ...cfg, demoMode: true }, tmp);
            printResult(r);
            fs.unlinkSync(tmp);
            console.log("自检完成。");
            break;
        }
        default:
            console.error(`未知命令: ${opts.command}`);
            printHelp();
            process.exit(1);
    }
}

/** 生成一个最小化的 24 位 BMP（用于自检） */
function createMinimalBmp(width: number, height: number, color: number): Buffer {
    const rowSize = Math.floor((24 * width + 31) / 32) * 4;
    const pixelArraySize = rowSize * height;
    const fileSize = 54 + pixelArraySize;
    const buf = Buffer.alloc(fileSize);
    buf.write("BM", 0);
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(54, 10);      // pixel data offset
    buf.writeUInt32LE(40, 14);      // DIB header size
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);       // planes
    buf.writeUInt16LE(24, 28);      // bpp
    buf.writeUInt32LE(pixelArraySize, 34);
    const b = color & 0xff;
    const g = (color >> 8) & 0xff;
    const r = (color >> 16) & 0xff;
    for (let y = 0; y < height; y++) {
        const rowStart = 54 + y * rowSize;
        for (let x = 0; x < width; x++) {
            const off = rowStart + x * 3;
            buf.writeUInt8(b, off);
            buf.writeUInt8(g, off + 1);
            buf.writeUInt8(r, off + 2);
        }
    }
    return buf;
}

main().catch((err: NodeJS.ErrnoException) => {
    console.error("致命错误:", err.message);
    process.exit(1);
});
