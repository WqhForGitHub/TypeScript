#!/usr/bin/env node
/**
 * 50. 图片上传与展示 Web App
 * ----------------------------------------------------
 * 多图上传 + 画廊展示 Web 应用：
 *   - multipart/form-data 手动解析边界
 *   - 图片保存到 ./gallery
 *   - 元数据 (文件名、上传时间、大小、尺寸) 存储到 JSON
 *   - 缩略图网格 + 点击查看大图
 *   - 图片删除
 *   - 图片列表 API
 *   - 以正确 MIME 类型提供图片
 *
 * 命令: start [-p port] [-d gallerydir]
 * 仅使用 Node.js 内置模块。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { URL } from 'url';

interface ServerOptions {
  port: number;
  galleryDir: string;
}

interface ImageMeta {
  id: string;
  filename: string;     // 原始文件名
  savedAs: string;      // 实际保存的文件名
  size: number;
  contentType: string;
  uploadedAt: string;
  width: number | null;
  height: number | null;
}

interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];

const Logger = {
  info(msg: string): void { console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`); },
  warn(msg: string): void { console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`); },
  error(msg: string): void { console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`); },
  req(method: string, url: string, status: number): void {
    const color = status < 300 ? 32 : status < 400 ? 36 : status < 500 ? 33 : 31;
    console.log(`${new Date().toISOString()} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${color}m${status}\x1b[0m`);
  },
};

/** 解析命令行 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: 'start',
    options: { port: 5000, galleryDir: path.resolve(process.cwd(), 'gallery') },
    help: false,
  };
  if (args.length === 0) return result;
  if (args[0] === '-h' || args[0] === '--help') { result.help = true; return result; }
  if (args[0] === 'start') args.shift();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '-p' || flag === '--port') {
      const p = parseInt(value, 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) { result.options.port = p; i++; }
    } else if (flag === '-d' || flag === '--dir' || flag === '--gallery') {
      if (value) { result.options.galleryDir = path.resolve(value); i++; }
    } else if (flag === '-h' || flag === '--help') {
      result.help = true;
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`
图片上传与展示 Web App - 使用说明

用法:
  image-gallery-web-app start [-p port] [-d gallerydir]

选项:
  start             启动服务器 (默认命令)
  -p, --port <n>    监听端口 (默认 5000)
  -d, --dir <path>  图片存储目录 (默认 ./gallery)
  -h, --help        显示帮助

API:
  GET    /api/images           获取所有图片元数据
  DELETE /api/images/:id       删除图片
  POST   /upload               上传图片 (multipart/form-data)
  GET /                        画廊 HTML
  GET /images/:file            访问图片
`);
}

/** 元数据 JSON 文件路径 */
function metaFile(options: ServerOptions): string {
  return path.join(options.galleryDir, 'metadata.json');
}

/** 加载元数据 */
function loadMeta(options: ServerOptions): ImageMeta[] {
  try {
    if (fs.existsSync(metaFile(options))) {
      const data = JSON.parse(fs.readFileSync(metaFile(options), 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    Logger.warn('元数据加载失败: ' + (err instanceof Error ? err.message : String(err)));
  }
  return [];
}

/** 保存元数据 */
function saveMeta(options: ServerOptions, list: ImageMeta[]): void {
  try { fs.writeFileSync(metaFile(options), JSON.stringify(list, null, 2), 'utf8'); }
  catch (err) { Logger.error('元数据保存失败: ' + (err instanceof Error ? err.message : String(err))); }
}

/** 生成唯一文件名 */
function uniqueFilename(original: string): string {
  const ext = path.extname(original).toLowerCase() || '.bin';
  const base = path.basename(original, ext).replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 30) || 'image';
  return `${base}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/** 从二进制头检测图片尺寸 (PNG/JPEG/GIF/WEBP/BMP 简易识别) */
function detectImageSize(buf: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && buf.length >= 24) {
      if (buf.toString('ascii', 12, 16) === 'IHDR') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (mime === 'image/gif' && buf.length >= 10) {
      if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      }
    }
    if (mime === 'image/bmp' && buf.length >= 26) {
      return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
    }
    if (mime === 'image/webp' && buf.length >= 30) {
      const vp = buf.toString('ascii', 12, 16);
      if (vp === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (vp === 'VP8L') {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (vp === 'VP8X') return { width: 1 + (buf.readUInt32LE(24) & 0xffffff), height: 1 + (buf.readUInt32LE(27) & 0xffffff) };
    }
  } catch { /* 忽略 */ }
  return { width: null, height: null };
}

/** 解析 multipart/form-data */
interface MultipartField {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

function extractBoundary(contentType: string): string | null {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function parsePartHeaders(raw: string): { name: string; filename: string | null; contentType: string } {
  let name = '';
  let filename: string | null = null;
  let contentType = 'text/plain';
  for (const line of raw.split('\r\n')) {
    const lower = line.toLowerCase();
    if (lower.startsWith('content-disposition:')) {
      const disp = line.substring(line.indexOf(':') + 1).trim();
      const nm = disp.match(/name="([^"]*)"/);
      if (nm) name = nm[1];
      const fm = disp.match(/filename="([^"]*)"/);
      if (fm) filename = fm[1];
    } else if (lower.startsWith('content-type:')) {
      contentType = line.substring(line.indexOf(':') + 1).trim();
    }
  }
  return { name, filename, contentType };
}

function parseMultipart(buffer: Buffer, boundary: string): MultipartField[] {
  const fields: MultipartField[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
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
    let cursor = partStart;
    if (cursor + 2 <= buffer.length && buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) cursor += 2;
    else continue;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) continue;
    const headerBuf = buffer.slice(cursor, headerEnd);
    const contentStart = headerEnd + 4;
    let contentEnd = positions[i + 1];
    if (contentEnd >= 2 && buffer[contentEnd - 2] === 0x0d && buffer[contentEnd - 1] === 0x0a) contentEnd -= 2;
    const content = buffer.slice(contentStart, contentEnd);
    const headers = parsePartHeaders(headerBuf.toString('utf8'));
    fields.push({ name: headers.name, filename: headers.filename, contentType: headers.contentType, data: content });
  }
  return fields;
}

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

function getMime(ext: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function sendHtml(res: http.ServerResponse, html: string): void {
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** HTML 画廊页面 */
function galleryPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>图片画廊</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif; background: #f5f7fa; color: #333; min-height: 100vh; padding: 20px; }
    h1 { color: #2c3e50; margin-bottom: 20px; text-align: center; }
    .upload-card { background: #fff; max-width: 880px; margin: 0 auto 24px; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .upload-area { border: 2px dashed #bbb; border-radius: 8px; padding: 28px; text-align: center; cursor: pointer; transition: all 0.2s; }
    .upload-area:hover, .upload-area.drag { border-color: #3498db; background: #ebf5fb; }
    .upload-area p { color: #7f8c8d; margin-top: 8px; }
    input[type="file"] { display: none; }
    .btn { background: #3498db; color: #fff; border: none; padding: 10px 22px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-top: 12px; }
    .btn:hover { background: #2980b9; } .btn:disabled { background: #aaa; cursor: not-allowed; }
    .gallery { max-width: 880px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
    .card { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.1); position: relative; }
    .card img { width: 100%; height: 160px; object-fit: cover; display: block; cursor: pointer; }
    .card .meta { padding: 8px 10px; font-size: 12px; color: #666; }
    .card .meta .name { color: #333; font-weight: 600; word-break: break-all; }
    .card .delete { position: absolute; top: 6px; right: 6px; background: rgba(231,76,60,0.9); color: #fff; border: none; width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 14px; }
    .card .delete:hover { background: #c0392b; }
    .empty { text-align: center; padding: 60px 20px; color: #aaa; grid-column: 1 / -1; }
    .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; z-index: 1000; }
    .modal.show { display: flex; }
    .modal img { max-width: 90%; max-height: 90%; border-radius: 8px; } .modal-close { position: absolute; top: 20px; right: 30px; color: #fff; font-size: 36px; cursor: pointer; user-select: none; }
    .status { text-align: center; color: #888; font-size: 13px; margin-top: 10px; }
    .status.error { color: #e74c3c; }
  </style>
</head>
<body>
  <h1>图片画廊</h1>
  <div class="upload-card">
    <div class="upload-area" id="dropZone">
      <div style="font-size: 36px;">\u{1F4F7}</div>
      <p>点击或拖拽图片到此处上传</p>
      <p style="font-size: 11px; color: #aaa;">支持 PNG / JPEG / GIF / WEBP / BMP / SVG，单图最大 20MB</p>
    </div>
    <input type="file" id="fileInput" accept="image/*" multiple />
    <div id="status" class="status"></div>
  </div>
  <div class="gallery" id="gallery"></div>
  <div class="modal" id="modal">
    <span class="modal-close" id="modalClose">&times;</span>
    <img id="modalImg" src="" alt="预览" />
  </div>
  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const galleryEl = document.getElementById('gallery');
    const statusEl = document.getElementById('status');
    const modal = document.getElementById('modal');
    const modalImg = document.getElementById('modalImg');
    const modalClose = document.getElementById('modalClose');

    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag'); };
    dropZone.ondragleave = () => dropZone.classList.remove('drag');
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag');
      uploadFiles(e.dataTransfer.files);
    };
    fileInput.onchange = () => uploadFiles(fileInput.files);

    async function uploadFiles(files) {
      if (!files || files.length === 0) return;
      statusEl.className = 'status';
      statusEl.textContent = '上传中... (' + files.length + ' 张)';
      const fd = new FormData();
      for (const f of files) fd.append('images', f);
      try {
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const json = await res.json();
        if (res.ok) {
          statusEl.textContent = '上传成功 ' + (json.uploaded ? json.uploaded.length : 0) + ' 张' + (json.errors && json.errors.length ? '，失败 ' + json.errors.length : '');
          loadGallery();
        } else {
          statusEl.className = 'status error';
          statusEl.textContent = '上传失败: ' + (json.error || res.status);
        }
      } catch (err) {
        statusEl.className = 'status error';
        statusEl.textContent = '上传失败: ' + err.message;
      }
    }

    async function loadGallery() {
      const res = await fetch('/api/images');
      const data = await res.json();
      galleryEl.innerHTML = '';
      if (!data.images || data.images.length === 0) {
        galleryEl.innerHTML = '<div class="empty">还没有图片，上传一张试试吧！</div>';
        return;
      }
      for (const img of data.images) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML =
          '<img src="/images/' + encodeURIComponent(img.savedAs) + '" alt="' + escapeHtml(img.filename) + '" loading="lazy" />' +
          '<button class="delete" title="删除">&times;</button>' +
          '<div class="meta"><div class="name"></div><div>' +
          (img.width && img.height ? img.width + 'x' + img.height + ' · ' : '') +
          formatSize(img.size) + ' · ' + new Date(img.uploadedAt).toLocaleString() +
          '</div></div>';
        card.querySelector('.name').textContent = img.filename;
        card.querySelector('img').onclick = () => openModal('/images/' + encodeURIComponent(img.savedAs));
        card.querySelector('.delete').onclick = () => del(img.id, card);
        galleryEl.appendChild(card);
      }
    }

    async function del(id, card) {
      if (!confirm('确定删除该图片？')) return;
      const res = await fetch('/api/images/' + id, { method: 'DELETE' });
      if (res.ok) {
        card.remove();
        statusEl.className = 'status';
        statusEl.textContent = '已删除';
      } else {
        alert('删除失败');
      }
    }

    function openModal(src) {
      modalImg.src = src;
      modal.classList.add('show');
    }
    modalClose.onclick = () => modal.classList.remove('show');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };

    function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function formatSize(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
      return (b/1048576).toFixed(1) + ' MB';
    }
    loadGallery();
  </script>
</body>
</html>`;
}

/** 处理请求 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const urlObj = new URL(url, `http://localhost:${options.port}`);
  const pathname = urlObj.pathname;

  // 首页
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendHtml(res, galleryPage());
    return;
  }

  // 图片列表 API
  if (method === 'GET' && pathname === '/api/images') {
    const list = loadMeta(options);
    sendJson(res, { images: list, count: list.length });
    return;
  }

  // 删除图片
  const delMatch = pathname.match(/^\/api\/images\/([\w-]+)$/);
  if (method === 'DELETE' && delMatch) {
    const id = delMatch[1];
    const list = loadMeta(options);
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) { sendJson(res, { error: '未找到' }, 404); return; }
    const [removed] = list.splice(idx, 1);
    saveMeta(options, list);
    try {
      const fp = path.join(options.galleryDir, removed.savedAs);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      Logger.warn('删除文件失败: ' + (err instanceof Error ? err.message : String(err)));
    }
    sendJson(res, { success: true, deleted: removed });
    return;
  }

  // 上传
  if (method === 'POST' && pathname === '/upload') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      sendJson(res, { error: 'Content-Type 必须是 multipart/form-data' }, 400); return;
    }
    const boundary = extractBoundary(contentType);
    if (!boundary) { sendJson(res, { error: '缺少 boundary' }, 400); return; }
    const totalLimit = MAX_IMAGE_SIZE * 20 + 2 * 1024 * 1024;
    let buffer: Buffer;
    try { buffer = await readBody(req, totalLimit); }
    catch (err) { sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 413); return; }
    let fields: MultipartField[];
    try { fields = parseMultipart(buffer, boundary); }
    catch (err) { sendJson(res, { error: '解析失败: ' + (err instanceof Error ? err.message : String(err)) }, 400); return; }

    const list = loadMeta(options);
    const uploaded: ImageMeta[] = [];
    const errors: string[] = [];

    for (const field of fields) {
      if (field.filename === null || field.filename === '') continue;
      if (!ALLOWED_MIME.includes(field.contentType)) {
        errors.push(`${field.filename} 不是允许的图片类型 (${field.contentType})`); continue;
      }
      if (field.data.length > MAX_IMAGE_SIZE) {
        errors.push(`${field.filename} 超过 ${MAX_IMAGE_SIZE} 字节`); continue;
      }
      const savedAs = uniqueFilename(field.filename);
      const fullPath = path.join(options.galleryDir, savedAs);
      try {
        fs.writeFileSync(fullPath, field.data);
        const { width, height } = detectImageSize(field.data, field.contentType);
        const meta: ImageMeta = {
          id: crypto.randomBytes(8).toString('hex'),
          filename: field.filename, savedAs, size: field.data.length,
          contentType: field.contentType, uploadedAt: new Date().toISOString(), width, height,
        };
        list.unshift(meta);
        uploaded.push(meta);
        Logger.info(`已上传 ${field.filename} -> ${savedAs} (${field.data.length} bytes)`);
      } catch (err) {
        errors.push(`保存 ${field.filename} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    saveMeta(options, list);
    sendJson(res, { success: uploaded.length > 0, uploaded, errors, count: uploaded.length });
    return;
  }

  // 提供图片文件
  const imgMatch = pathname.match(/^\/images\/(.+)$/);
  if (method === 'GET' && imgMatch) {
    const filename = path.basename(decodeURIComponent(imgMatch[1]));
    const filePath = path.join(options.galleryDir, filename);
    if (!filePath.startsWith(options.galleryDir + path.sep) && filePath !== options.galleryDir) {
      res.writeHead(403); res.end('禁止访问'); return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('未找到'); return;
    }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': getMime(path.extname(filename)),
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('未找到');
}

/** 启动服务器 */
function startServer(options: ServerOptions): http.Server {
  if (!fs.existsSync(options.galleryDir)) {
    fs.mkdirSync(options.galleryDir, { recursive: true });
    Logger.info(`已创建图片目录: ${options.galleryDir}`);
  }

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    handleRequest(req, res, options).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error('处理失败: ' + msg);
      if (!res.headersSent) sendJson(res, { error: msg }, 500);
    });
    res.on('finish', () => Logger.req(method, url, res.statusCode));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') Logger.error(`端口 ${options.port} 已被占用`);
    else Logger.error(err.message);
    process.exit(1);
  });

  server.listen(options.port, () => {
    Logger.info(`图片画廊应用运行于 http://localhost:${options.port}`);
    Logger.info(`图片目录: ${options.galleryDir}`);
    Logger.info(`单图限制: ${MAX_IMAGE_SIZE} 字节`);
  });

  return server;
}

/** 主函数 */
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) { printHelp(); process.exit(0); return; }
  const server = startServer(parsed.options);
  const shutdown = (sig: string) => {
    Logger.warn(`收到 ${sig}，关闭服务器...`);
    server.close(() => { Logger.info('已退出'); process.exit(0); });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
