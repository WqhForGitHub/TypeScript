#!/usr/bin/env node
/**
 * 41. 简易 HTTP 服务器
 * ----------------------------------------------------
 * 功能：
 *   - 可配置端口与根目录
 *   - 支持 GET / POST 请求
 *   - 路由：/ (信息页), /time (当前时间 JSON), /echo (回显请求), /api/status (服务器状态)
 *   - 控制台请求日志
 *   - SIGINT 优雅关闭
 *   - CLI 子命令: start [-p port] [-r root], --help
 *
 * 仅使用 Node.js 内置模块。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';

interface ServerOptions {
  port: number;
  root: string;
}

interface ServerStats {
  startedAt: Date;
  totalRequests: number;
  totalBytesSent: number;
  routes: Record<string, number>;
  errors: number;
}

interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}

const STATS: ServerStats = {
  startedAt: new Date(),
  totalRequests: 0,
  totalBytesSent: 0,
  routes: {},
  errors: 0,
};

/** 解析命令行参数 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: 'start',
    options: { port: 3000, root: process.cwd() },
    help: false,
  };

  if (args.length === 0) {
    return result;
  }

  if (args[0] === '--help' || args[0] === '-h') {
    result.help = true;
    return result;
  }

  if (args[0] === 'start') {
    result.command = 'start';
    args.shift();
  }

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '-p':
      case '--port': {
        const port = parseInt(value, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
          result.options.port = port;
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

/** 显示帮助信息 */
function printHelp(): void {
  const help = `
简易 HTTP 服务器 - 使用说明

用法:
  simple-http-server start [-p port] [-r root]
  simple-http-server --help

选项:
  start              启动 HTTP 服务器 (默认命令)
  -p, --port <n>     监听端口 (默认: 3000)
  -r, --root <dir>   根目录 (默认: 当前工作目录)
  -h, --help         显示帮助信息

路由:
  GET  /             服务器信息页面
  GET  /time         返回当前时间 (JSON)
  POST /echo         回显请求体
  GET  /api/status   服务器运行状态 (JSON)
  GET  /api/headers  返回请求头 (JSON)
`;
  console.log(help);
}

/** 颜色化日志输出 (ANSI) */
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
  request(method: string, url: string, status: number): void {
    const statusColor =
      status < 300 ? '32' : status < 400 ? '36' : status < 500 ? '33' : '31';
    const time = new Date().toISOString();
    console.log(
      `${time} \x1b[35m${method.padEnd(6)}\x1b[0m ${url} \x1b[${statusColor}m${status}\x1b[0m`
    );
  },
};

/** 读取请求体 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const limit = 5 * 1024 * 1024; // 5MB 限制
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('请求体超过 5MB 限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status = 200
): void {
  const body = JSON.stringify(data, null, 2);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
  STATS.totalBytesSent += buf.length;
}

/** 发送 HTML 响应 */
function sendHtml(res: http.ServerResponse, html: string, status = 200): void {
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
  STATS.totalBytesSent += buf.length;
}

/** 信息页面 */
function infoPage(): string {
  const uptime = Math.floor((Date.now() - STATS.startedAt.getTime()) / 1000);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>简易 HTTP 服务器</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
    ul { line-height: 1.8; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    .footer { margin-top: 40px; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>简易 HTTP 服务器</h1>
  <p>欢迎使用 TypeScript 编写的简易 HTTP 服务器。可用路由：</p>
  <ul>
    <li><code>GET /</code> - 本信息页</li>
    <li><code>GET /time</code> - 当前时间 (JSON)</li>
    <li><code>POST /echo</code> - 回显请求体</li>
    <li><code>GET /api/status</code> - 服务器状态 (JSON)</li>
    <li><code>GET /api/headers</code> - 请求头 (JSON)</li>
  </ul>
  <p>已运行：<strong>${uptime}</strong> 秒</p>
  <div class="footer">Powered by Node.js ${process.version} - TypeScript Demo 41</div>
</body>
</html>`;
}

/** 路由处理 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions
): Promise<void> {
  const method = req.method ?? 'GET';
  const fullUrl = req.url ?? '/';
  const urlObj = new URL(fullUrl, `http://localhost:${options.port}`);
  const pathname = urlObj.pathname;

  STATS.totalRequests++;
  STATS.routes[pathname] = (STATS.routes[pathname] ?? 0) + 1;

  try {
    if (method === 'GET' && pathname === '/') {
      sendHtml(res, infoPage());
      return;
    }

    if (method === 'GET' && pathname === '/time') {
      sendJson(res, {
        iso: new Date().toISOString(),
        local: new Date().toLocaleString('zh-CN'),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: Date.now(),
      });
      return;
    }

    if (method === 'POST' && pathname === '/echo') {
      const body = await readBody(req);
      let parsed: unknown = body;
      const contentType = req.headers['content-type'] ?? '';
      if (contentType.includes('application/json')) {
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
      }
      sendJson(res, {
        method,
        url: fullUrl,
        headers: req.headers,
        body: parsed,
        receivedAt: new Date().toISOString(),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/status') {
      const uptime = Date.now() - STATS.startedAt.getTime();
      sendJson(res, {
        status: 'running',
        startedAt: STATS.startedAt.toISOString(),
        uptimeMs: uptime,
        uptimeSeconds: Math.floor(uptime / 1000),
        totalRequests: STATS.totalRequests,
        totalBytesSent: STATS.totalBytesSent,
        errors: STATS.errors,
        routeCounts: STATS.routes,
        memory: process.memoryUsage(),
        cpus: os.cpus().length,
        platform: process.platform,
        nodeVersion: process.version,
        root: options.root,
        port: options.port,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/headers') {
      sendJson(res, {
        headers: req.headers,
        method,
        url: fullUrl,
        httpVersion: req.httpVersion,
      });
      return;
    }

    // 404
    sendJson(
      res,
      {
        error: '未找到',
        message: `路由 ${method} ${pathname} 不存在`,
        available: ['GET /', 'GET /time', 'POST /echo', 'GET /api/status', 'GET /api/headers'],
      },
      404
    );
  } catch (err) {
    STATS.errors++;
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`处理请求失败: ${message}`);
    sendJson(
      res,
      { error: '内部错误', message },
      500
    );
  }
}

/** 启动服务器 */
function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const startTime = Date.now();
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    res.on('finish', () => {
      Logger.request(method, url, res.statusCode);
      const elapsed = Date.now() - startTime;
      if (elapsed > 500) {
        Logger.warn(`请求处理耗时 ${elapsed}ms: ${method} ${url}`);
      }
    });

    handleRequest(req, res, options).catch((err) => {
      STATS.errors++;
      const message = err instanceof Error ? err.message : String(err);
      Logger.error(`未捕获异常: ${message}`);
      if (!res.headersSent) {
        sendJson(res, { error: '内部错误', message }, 500);
      }
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      Logger.error(`端口 ${options.port} 已被占用`);
    } else {
      Logger.error(`服务器错误: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(options.port, () => {
    Logger.info(`服务器已启动: http://localhost:${options.port}`);
    Logger.info(`根目录: ${options.root}`);
    Logger.info(`按 Ctrl+C 优雅关闭`);
  });

  return server;
}

/** 优雅关闭 */
function setupGracefulShutdown(server: http.Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    Logger.warn(`收到 ${signal} 信号，正在关闭服务器...`);

    server.close(() => {
      Logger.info('所有连接已关闭，服务器退出');
      process.exit(0);
    });

    // 强制退出超时
    setTimeout(() => {
      Logger.error('强制退出（部分连接未关闭）');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    Logger.error(`未捕获异常: ${err.message}`);
    STATS.errors++;
  });
  process.on('unhandledRejection', (reason) => {
    Logger.error(`未处理的 Promise 拒绝: ${String(reason)}`);
  });
}

/** 主函数 */
function main(): void {
  const parsed = parseArgs(process.argv);

  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }

  if (parsed.command !== 'start') {
    printHelp();
    process.exit(1);
    return;
  }

  // 确保根目录存在
  if (!fs.existsSync(parsed.options.root)) {
    Logger.error(`根目录不存在: ${parsed.options.root}`);
    process.exit(1);
  }

  const server = startServer(parsed.options);
  setupGracefulShutdown(server);
}

main();
