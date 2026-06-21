#!/usr/bin/env node
/**
 * 45. 静态文件服务器
 * ----------------------------------------------------
 *   - MIME 类型识别 (html/css/js/json/png/jpg/gif/svg/pdf/...)
 *   - Range 请求 (HTTP 206 部分内容)
 *   - ETag 缓存 (HTTP 304)
 *   - gzip 压缩 (zlib)
 *   - 目录列表 (HTML)
 *   - 默认 index.html
 *   - 路径安全 (防止目录穿越)
 *
 * 选项:
 *   start [-p port] [-r root] [--no-listing] [--no-gzip]
 *
 * 仅使用 Node.js 内置模块。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

interface ServerOptions {
  port: number;
  root: string;
  listing: boolean;
  gzip: boolean;
}

interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}

/** MIME 类型映射 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.csv': 'text/csv; charset=utf-8',
  '.wasm': 'application/wasm',
};

const DEFAULT_MIME = 'application/octet-stream';

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? DEFAULT_MIME;
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
      port: 8080,
      root: process.cwd(),
      listing: true,
      gzip: true,
    },
    help: false,
  };

  if (args.length === 0) return result;
  if (args[0] === '--help' || args[0] === '-h') {
    result.help = true;
    return result;
  }
  if (args[0] === 'start') args.shift();

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
      case '-r':
      case '--root': {
        if (value) {
          result.options.root = path.resolve(value);
          i++;
        }
        break;
      }
      case '--no-listing':
        result.options.listing = false;
        break;
      case '--no-gzip':
        result.options.gzip = false;
        break;
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
静态文件服务器 - 使用说明

用法:
  static-file-server start [-p port] [-r root] [--no-listing] [--no-gzip]

选项:
  start            启动服务器 (默认命令)
  -p, --port <n>   监听端口 (默认 8080)
  -r, --root <dir> 根目录 (默认当前目录)
  --no-listing     禁用目录列表
  --no-gzip        禁用 gzip 压缩
  -h, --help       显示帮助

特性:
  - MIME 类型识别
  - Range 请求 (206 部分内容)
  - ETag 缓存 (304)
  - gzip 压缩
  - 目录列表
  - 路径安全 (防穿越)
`);
}

/** 计算文件 ETag */
function computeEtag(stat: fs.Stats, file: string): string {
  const raw = `${file}-${stat.size}-${stat.mtimeMs}`;
  return '"' + crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16) + '"';
}

/** 解析 Range 头 */
function parseRange(range: string, size: number): { start: number; end: number } | null {
  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  let start: number;
  let end: number;
  if (match[1] === '' && match[2] === '') return null;
  if (match[1] === '') {
    // 后缀范围
    const suffix = parseInt(match[2], 10);
    if (Number.isNaN(suffix)) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : parseInt(match[2], 10);
    if (Number.isNaN(start)) return null;
    if (start >= size) return null;
    if (end >= size) end = size - 1;
  }
  if (start > end) return null;
  return { start, end };
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 生成目录列表 HTML */
function renderDirectoryListing(
  dirPath: string,
  urlPath: string
): string {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<!DOCTYPE html><html><body><h1>无法读取目录</h1><p>${escapeHtml(msg)}</p></body></html>`;
  }

  const items = entries
    .filter((e) => e.name !== '.' && !(e.name === '..' && urlPath === '/'))
    .map((e) => {
      const name = e.name + (e.isDirectory() ? '/' : '');
      const icon = e.isDirectory() ? '\u{1F4C1}' : '\u{1F4C4}';
      let size = '';
      let mtime = '';
      try {
        const stat = fs.statSync(path.join(dirPath, e.name));
        if (e.isFile()) size = formatSize(stat.size);
        mtime = stat.mtime.toISOString().slice(0, 19).replace('T', ' ');
      } catch {
        // 忽略
      }
      return `
        <tr>
          <td>${icon}</td>
          <td><a href="${escapeHtml(name)}">${escapeHtml(name)}</a></td>
          <td>${size}</td>
          <td>${mtime}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>索引: ${escapeHtml(urlPath)}</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 900px; margin: 30px auto; padding: 0 20px; color: #333; }
    h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; word-break: break-all; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; color: #555; font-weight: 600; }
    td a { color: #3498db; text-decoration: none; }
    td a:hover { text-decoration: underline; }
    .path { font-family: monospace; background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>索引: <span class="path">${escapeHtml(urlPath)}</span></h1>
  <table>
    <thead>
      <tr><th></th><th>名称</th><th>大小</th><th>修改时间</th></tr>
    </thead>
    <tbody>
      ${urlPath !== '/' ? '<tr><td>\u{1F519}</td><td><a href="../">../</a></td><td></td><td></td></tr>' : ''}
      ${items}
    </tbody>
  </table>
</body>
</html>`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 路径安全：禁止目录穿越 */
function safeJoin(root: string, urlPath: string): string | null {
  // 解码 URL
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // 规范化路径
  const target = path.normalize(path.join(root, decoded));
  // 确保 target 在 root 下
  if (target !== root && !target.startsWith(root + path.sep)) {
    return null;
  }
  return target;
}

/** 发送简单文本响应 */
function sendText(
  res: http.ServerResponse,
  text: string,
  status: number,
  contentType = 'text/plain; charset=utf-8'
): void {
  const buf = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
  });
  res.end(buf);
}

/** 判断客户端是否接受 gzip */
function acceptsGzip(req: http.IncomingMessage): boolean {
  const enc = req.headers['accept-encoding'] ?? '';
  return enc.toLowerCase().includes('gzip');
}

/** 判断该 MIME 是否值得压缩 */
function shouldCompress(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('xml') ||
    mime.includes('svg') ||
    mime.includes('wasm')
  );
}

/** 处理静态文件请求 */
function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions
): void {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, '方法不允许', 405);
    return;
  }

  const target = safeJoin(options.root, url.split('?')[0]);
  if (!target) {
    sendText(res, '禁止访问', 403);
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    sendText(res, '未找到', 404);
    return;
  }

  // 目录：尝试 index.html，否则目录列表
  if (stat.isDirectory()) {
    const indexPath = path.join(target, 'index.html');
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      serveFile(req, res, indexPath, fs.statSync(indexPath), options);
      return;
    }
    if (options.listing) {
      const html = renderDirectoryListing(target, url.split('?')[0]);
      const buf = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
      });
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(buf);
      }
      return;
    }
    sendText(res, '禁止目录列表', 403);
    return;
  }

  if (!stat.isFile()) {
    sendText(res, '不支持的内容', 404);
    return;
  }

  serveFile(req, res, target, stat, options);
}

/** 发送文件，支持 ETag/Range/gzip */
function serveFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  stat: fs.Stats,
  options: ServerOptions
): void {
  const mime = getMimeType(filePath);
  const etag = computeEtag(stat, filePath);

  // ETag 命中 -> 304
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }

  const rangeHeader = req.headers['range'];
  let useGzip = false;
  let useRange = false;
  let rangeStart = 0;
  let rangeEnd = stat.size - 1;

  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (range) {
      useRange = true;
      rangeStart = range.start;
      rangeEnd = range.end;
    }
  } else if (
    options.gzip &&
    acceptsGzip(req) &&
    shouldCompress(mime) &&
    stat.size > 1024
  ) {
    useGzip = true;
  }

  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': mime,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Accept-Ranges': 'bytes',
  };

  if (useRange) {
    const length = rangeEnd - rangeStart + 1;
    headers['Content-Range'] = `bytes ${rangeStart}-${rangeEnd}/${stat.size}`;
    headers['Content-Length'] = length;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start: rangeStart, end: rangeEnd });
    stream.on('error', (err) => {
      Logger.error(`读取失败: ${err.message}`);
      if (!res.headersSent) sendText(res, '读取失败', 500);
      res.destroy();
    });
    stream.pipe(res);
    return;
  }

  if (useGzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const raw = fs.createReadStream(filePath);
    const gzip = zlib.createGzip({ level: 6 });
    raw.on('error', (err) => {
      Logger.error(`读取失败: ${err.message}`);
      res.destroy();
    });
    gzip.on('error', (err) => {
      Logger.error(`压缩失败: ${err.message}`);
      res.destroy();
    });
    raw.pipe(gzip).pipe(res);
    return;
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    Logger.error(`读取失败: ${err.message}`);
    if (!res.headersSent) sendText(res, '读取失败', 500);
    res.destroy();
  });
  stream.pipe(res);
}

/** 启动服务器 */
function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    serveStatic(req, res, options);
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
    Logger.info(`静态文件服务器运行于 http://localhost:${options.port}`);
    Logger.info(`根目录: ${options.root}`);
    Logger.info(`目录列表: ${options.listing ? '开启' : '关闭'}`);
    Logger.info(`gzip 压缩: ${options.gzip ? '开启' : '关闭'}`);
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
  if (!fs.existsSync(parsed.options.root)) {
    Logger.error(`根目录不存在: ${parsed.options.root}`);
    process.exit(1);
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
