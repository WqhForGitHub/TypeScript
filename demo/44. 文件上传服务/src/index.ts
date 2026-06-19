#!/usr/bin/env node
/**
 * 44. 文件上传服务
 * ----------------------------------------------------
 * HTTP 服务器，接收 multipart/form-data 上传，手动解析边界、头部、二进制内容。
 *   - 支持 GET / 返回 HTML 上传表单
 *   - 支持 POST /upload 接收多文件上传
 *   - 保存到 ./uploads 目录
 *   - 返回 JSON 上传结果 (filename, size, path)
 *   - 限制文件大小 (--max-size bytes)
 *
 * 仅使用 Node.js 内置模块。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface ServerOptions {
  port: number;
  uploadDir: string;
  maxSize: number; // 单文件最大字节数
}

interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}

interface UploadField {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

interface UploadResultItem {
  field: string;
  filename: string;
  savedAs: string;
  size: number;
  path: string;
  contentType: string;
}

const Logger = {
  info(msg: string): void {
    console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  },
  warn(msg: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  },
  error(msg: string): void {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  },
  req(method: string, url: string, status: number): void {
    const color = status < 300 ? 32 : status < 400 ? 36 : status < 500 ? 33 : 31;
    const time = new Date().toISOString();
    console.log(`${time} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${color}m${status}\x1b[0m`);
  },
};

/** 解析命令行参数 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: 'start',
    options: {
      port: 5000,
      uploadDir: path.resolve(process.cwd(), 'uploads'),
      maxSize: 20 * 1024 * 1024, // 20MB
    },
    help: false,
  };

  if (args.length === 0) return result;

  if (args[0] === '--help' || args[0] === '-h') {
    result.help = true;
    return result;
  }

  if (args[0] === 'start') {
    args.shift();
  }

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '-p':
      case '--port': {
        const p = parseInt(value, 10);
        if (!Number.isNaN(p) && p > 0 && p < 65536) {
          result.options.port = p;
          i++;
        }
        break;
      }
      case '-d':
      case '--dir':
      case '--uploaddir': {
        if (value) {
          result.options.uploadDir = path.resolve(value);
          i++;
        }
        break;
      }
      case '--max-size': {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n > 0) {
          result.options.maxSize = n;
          i++;
        }
        break;
      }
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        break;
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`
文件上传服务 - 使用说明

用法:
  file-upload-service start [-p port] [-d uploaddir] [--max-size bytes]

选项:
  start                 启动服务器 (默认命令)
  -p, --port <n>        监听端口 (默认 5000)
  -d, --dir <path>      上传保存目录 (默认 ./uploads)
  --max-size <bytes>    单文件最大字节数 (默认 20MB)
  -h, --help            显示帮助

路由:
  GET  /                HTML 上传表单
  POST /upload          接收 multipart/form-data 上传
  GET  /files           列出已上传文件 (JSON)
`);
}

/** 生成唯一的保存文件名 */
function uniqueFilename(original: string): string {
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  const safeBase = base.replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 40) || 'file';
  const hash = crypto.randomBytes(6).toString('hex');
  const ts = Date.now();
  return `${safeBase}_${ts}_${hash}${ext.toLowerCase()}`;
}

/** 解析 multipart/form-data 原始字节流 */
function parseMultipart(buffer: Buffer, boundary: string): UploadField[] {
  const fields: UploadField[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');

  // 找到所有边界位置
  const positions: number[] = [];
  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    positions.push(idx);
    start = idx + boundaryBuf.length;
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const partStart = positions[i] + boundaryBuf.length;
    // 跳过边界后的 \r\n
    let cursor = partStart;
    if (cursor + 2 <= buffer.length && buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) {
      cursor += 2;
    } else {
      // 可能是结尾边界 --\r\n，跳过
      continue;
    }

    // 找到 \r\n\r\n 头部结束
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) continue;

    const headerBuf = buffer.slice(cursor, headerEnd);
    const contentStart = headerEnd + 4;

    // 计算内容结束位置 = 下一个边界位置 - \r\n
    const nextBoundary = positions[i + 1];
    // 内容末尾的 \r\n 在边界之前
    let contentEnd = nextBoundary;
    if (contentEnd >= 2 && buffer[contentEnd - 2] === 0x0d && buffer[contentEnd - 1] === 0x0a) {
      contentEnd -= 2;
    }

    const content = buffer.slice(contentStart, contentEnd);
    const headers = parsePartHeaders(headerBuf.toString('utf8'));

    if (headers.filename !== null) {
      fields.push({
        name: headers.name,
        filename: headers.filename,
        contentType: headers.contentType,
        data: content,
      });
    } else {
      // 普通字段也保留
      fields.push({
        name: headers.name,
        filename: null,
        contentType: headers.contentType || 'text/plain',
        data: content,
      });
    }
  }

  return fields;
}

/** 解析单个 part 的头部 */
function parsePartHeaders(raw: string): {
  name: string;
  filename: string | null;
  contentType: string;
} {
  const lines = raw.split('\r\n');
  let name = '';
  let filename: string | null = null;
  let contentType = 'text/plain';

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('content-disposition:')) {
      const disp = line.substring(line.indexOf(':') + 1).trim();
      // 解析 name="..." filename="..."
      const nameMatch = disp.match(/name="([^"]*)"/);
      if (nameMatch) name = nameMatch[1];
      const fileMatch = disp.match(/filename="([^"]*)"/);
      if (fileMatch) filename = fileMatch[1];
    } else if (lower.startsWith('content-type:')) {
      contentType = line.substring(line.indexOf(':') + 1).trim();
    }
  }

  return { name, filename, contentType };
}

/** 提取 boundary */
function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  if (match) return match[1] ?? match[2] ?? null;
  return null;
}

/** 读取整个请求体到 Buffer */
function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      total += c.length;
      if (total > limit) {
        aborted = true;
        reject(new Error(`请求体超过限制 ${limit} 字节`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** HTML 上传表单 */
function uploadForm(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>文件上传</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 640px; margin: 40px auto; padding: 20px; background: #f5f7fa; color: #333; }
    h1 { color: #2c3e50; }
    .card { background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .form-row { margin-bottom: 16px; }
    label { display: block; margin-bottom: 6px; font-weight: 600; color: #555; }
    input[type="file"] { width: 100%; padding: 8px; border: 1px dashed #aaa; border-radius: 4px; }
    button { background: #3498db; color: #fff; border: none; padding: 10px 20px; border-radius: 4px; font-size: 14px; cursor: pointer; }
    button:hover { background: #2980b9; }
    .result { margin-top: 24px; padding: 16px; background: #eaf7ea; border-radius: 4px; display: none; }
    .result.error { background: #fdecea; }
    pre { white-space: pre-wrap; word-break: break-all; }
    .note { font-size: 12px; color: #888; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>文件上传服务</h1>
  <div class="card">
    <form id="form" action="/upload" method="POST" enctype="multipart/form-data">
      <div class="form-row">
        <label for="files">选择文件 (可多选)</label>
        <input type="file" id="files" name="files" multiple required />
      </div>
      <div class="form-row">
        <label for="desc">描述 (可选)</label>
        <input type="text" id="desc" name="desc" placeholder="备注信息" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;" />
      </div>
      <button type="submit">上传</button>
    </form>
    <div class="note">单文件最大 20MB，仅使用 Node 内置模块实现 multipart 解析。</div>
    <div id="result" class="result"><pre id="output"></pre></div>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const resultEl = document.getElementById('result');
      const outputEl = document.getElementById('output');
      resultEl.style.display = 'block';
      resultEl.classList.remove('error');
      outputEl.textContent = '上传中...';
      try {
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const json = await res.json();
        outputEl.textContent = JSON.stringify(json, null, 2);
        if (!res.ok) resultEl.classList.add('error');
      } catch (err) {
        resultEl.classList.add('error');
        outputEl.textContent = '上传失败: ' + err.message;
      }
    });
  </script>
</body>
</html>`;
}

/** 发送 JSON */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data, null, 2);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

/** 发送 HTML */
function sendHtml(res: http.ServerResponse, html: string, status = 200): void {
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

/** 处理请求 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    sendHtml(res, uploadForm());
    return;
  }

  if (method === 'GET' && url === '/files') {
    const list = listUploadedFiles(options.uploadDir);
    sendJson(res, { files: list, count: list.length });
    return;
  }

  if (method === 'POST' && (url === '/upload' || url === '/')) {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      sendJson(res, { error: 'Content-Type 必须是 multipart/form-data' }, 400);
      return;
    }
    const boundary = extractBoundary(contentType);
    if (!boundary) {
      sendJson(res, { error: '缺少 boundary' }, 400);
      return;
    }

    // 估算总大小限制 = 单文件限制 * 16 + 1MB 头部
    const totalLimit = options.maxSize * 16 + 1024 * 1024;
    let buffer: Buffer;
    try {
      buffer = await readBody(req, totalLimit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 413);
      return;
    }

    let fields: UploadField[];
    try {
      fields = parseMultipart(buffer, boundary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: '解析 multipart 失败: ' + msg }, 400);
      return;
    }

    const results: UploadResultItem[] = [];
    const errors: string[] = [];

    for (const field of fields) {
      if (field.filename === null) continue; // 跳过非文件字段
      if (field.data.length > options.maxSize) {
        errors.push(`文件 ${field.filename} 超过 ${options.maxSize} 字节限制`);
        continue;
      }
      if (field.filename === '') {
        // 空文件名 (用户未选择)
        continue;
      }
      const savedName = uniqueFilename(field.filename);
      const fullPath = path.join(options.uploadDir, savedName);
      try {
        fs.writeFileSync(fullPath, field.data);
        results.push({
          field: field.name,
          filename: field.filename,
          savedAs: savedName,
          size: field.data.length,
          path: fullPath,
          contentType: field.contentType,
        });
        Logger.info(`已保存 ${field.filename} -> ${savedName} (${field.data.length} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`保存 ${field.filename} 失败: ${msg}`);
      }
    }

    sendJson(res, {
      success: results.length > 0,
      uploaded: results,
      errors,
      count: results.length,
    });
    return;
  }

  sendJson(res, { error: '未找到', method, url }, 404);
}

/** 列出已上传文件 */
function listUploadedFiles(dir: string): Array<{
  name: string;
  size: number;
  mtime: string;
}> {
  if (!fs.existsSync(dir)) return [];
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return {
          name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

/** 启动服务器 */
function startServer(options: ServerOptions): http.Server {
  // 确保上传目录存在
  if (!fs.existsSync(options.uploadDir)) {
    fs.mkdirSync(options.uploadDir, { recursive: true });
    Logger.info(`已创建上传目录: ${options.uploadDir}`);
  }

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    handleRequest(req, res, options).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`处理失败: ${msg}`);
      if (!res.headersSent) {
        sendJson(res, { error: '内部错误', message: msg }, 500);
      }
    });
    res.on('finish', () => Logger.req(method, url, res.statusCode));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      Logger.error(`端口 ${options.port} 已被占用`);
    } else {
      Logger.error(err.message);
    }
    process.exit(1);
  });

  server.listen(options.port, () => {
    Logger.info(`文件上传服务运行于 http://localhost:${options.port}`);
    Logger.info(`上传目录: ${options.uploadDir}`);
    Logger.info(`单文件限制: ${options.maxSize} 字节`);
  });

  return server;
}

/** 主函数 */
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }

  const server = startServer(parsed.options);

  const shutdown = (sig: string) => {
    Logger.warn(`收到 ${sig}，关闭服务器...`);
    server.close(() => {
      Logger.info('已退出');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
