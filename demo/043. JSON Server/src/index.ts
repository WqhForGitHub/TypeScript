#!/usr/bin/env node
/**
 * 43. JSON Server
 * ----------------------------------------------------
 * 加载 JSON 文件作为内存数据库，对外提供 RESTful CRUD API。
 *
 *   GET    /resource                列表 (支持 ?limit&offset&filter)
 *   GET    /resource/:id            单条
 *   POST   /resource                新建 (自增 ID)
 *   PUT    /resource/:id            全量更新
 *   PATCH  /resource/:id            部分更新
 *   DELETE /resource/:id            删除
 *
 * 选项:
 *   --port <n>     端口 (默认 4000)
 *   --file <path>  JSON 数据库文件 (默认 ./db.json)
 *   --watch        监听源文件变更并自动重载
 *
 * 仅使用 Node.js 内置模块。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

type Resource = Record<string, unknown>;
type Database = Record<string, Resource[]>;

interface ServerOptions {
  port: number;
  file: string;
  watch: boolean;
}

interface ParsedArgs {
  options: ServerOptions;
  help: boolean;
}

const DEFAULT_DB: Database = {
  posts: [
    { id: 1, title: '欢迎使用 JSON Server', author: 'demo', views: 0 },
    { id: 2, title: 'TypeScript 入门', author: 'demo', views: 10 },
    { id: 3, title: 'REST API 设计', author: 'demo', views: 5 },
  ],
  users: [
    { id: 1, name: '张三', age: 28 },
    { id: 2, name: '李四', age: 34 },
  ],
  comments: [
    { id: 1, postId: 1, body: '很好用！' },
    { id: 2, postId: 1, body: '谢谢分享' },
  ],
};

/** 全局数据库 (内存) */
let DB: Database = loadDatabase();
let ID_COUNTERS: Record<string, number> = computeIdCounters(DB);
let saveTimer: NodeJS.Timeout | null = null;

/** 解析命令行参数 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    options: {
      port: 4000,
      file: path.resolve(process.cwd(), 'db.json'),
      watch: false,
    },
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '--port':
        if (value) {
          const p = parseInt(value, 10);
          if (!Number.isNaN(p) && p > 0 && p < 65536) {
            result.options.port = p;
            i++;
          }
        }
        break;
      case '--file':
        if (value) {
          result.options.file = path.resolve(value);
          i++;
        }
        break;
      case '--watch':
        result.options.watch = true;
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
JSON Server - 模拟 REST API

用法:
  json-server [--port <n>] [--file <path>] [--watch]

选项:
  --port <n>      监听端口 (默认 4000)
  --file <path>   JSON 数据库文件 (默认 ./db.json，若不存在会自动创建)
  --watch         监听源文件变更，自动重载数据库
  -h, --help      显示帮助

API:
  GET    /<resource>                  列表 (?limit&offset&<field>=<value>)
  GET    /<resource>/:id              单条
  POST   /<resource>                  新建
  PUT    /<resource>/:id              全量更新
  PATCH  /<resource>/:id              部分更新
  DELETE /<resource>/:id              删除
  GET    /                            数据库总览
`);
}

/** 加载数据库文件 */
function loadDatabase(): Database {
  const opts = parseArgs(process.argv).options;
  const file = opts.file;
  try {
    if (!fs.existsSync(file)) {
      // 首次启动写入默认数据
      fs.writeFileSync(file, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
      Logger.info(`未发现数据库文件，已创建默认数据库: ${file}`);
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('数据库根节点必须是对象');
    }
    Logger.info(`数据库已加载: ${file}`);
    return data as Database;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error(`加载数据库失败: ${msg}，使用默认数据`);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

/** 计算每个资源集合的 ID 计数器 */
function computeIdCounters(db: Database): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const key of Object.keys(db)) {
    const arr = db[key];
    if (Array.isArray(arr)) {
      let max = 0;
      for (const item of arr) {
        const id = (item as Resource).id;
        if (typeof id === 'number' && id > max) max = id;
      }
      counters[key] = max;
    }
  }
  return counters;
}

/** 防抖持久化到磁盘 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow();
  }, 300);
}

function saveNow(): void {
  const opts = parseArgs(process.argv).options;
  try {
    fs.writeFileSync(opts.file, JSON.stringify(DB, null, 2), 'utf8');
    Logger.info(`数据库已保存到 ${opts.file}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error(`保存数据库失败: ${msg}`);
  }
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

/** 发送 JSON 响应 */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data, null, 2);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(buf);
}

/** 读取请求体并解析为 JSON */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const limit = 10 * 1024 * 1024;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 路径解析：返回 [资源名, id?] */
function parsePath(pathname: string): [string, string | null] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return ['', null];
  if (parts.length === 1) return [decodeURIComponent(parts[0]), null];
  return [decodeURIComponent(parts[0]), decodeURIComponent(parts[1])];
}

/** 列表过滤与分页 */
function listResource(
  collection: Resource[],
  search: URLSearchParams
): { data: Resource[]; total: number; limit: number | null; offset: number } {
  let result = collection.slice();

  // 过滤 (除 limit/offset 外的字段都视为等值过滤)
  const filterKeys = Array.from(search.keys()).filter(
    (k) => k !== 'limit' && k !== 'offset'
  );
  for (const key of filterKeys) {
    const expected = search.get(key);
    if (expected === null) continue;
    result = result.filter((item) => {
      const val = item[key];
      if (val === undefined) return false;
      return String(val) === expected;
    });
  }

  const total = result.length;
  let limit: number | null = null;
  let offset = 0;

  if (search.has('limit')) {
    const l = parseInt(search.get('limit') ?? '0', 10);
    if (!Number.isNaN(l) && l >= 0) limit = l;
  }
  if (search.has('offset')) {
    const o = parseInt(search.get('offset') ?? '0', 10);
    if (!Number.isNaN(o) && o >= 0) offset = o;
  }

  if (limit !== null) {
    result = result.slice(offset, offset + limit);
  } else if (offset > 0) {
    result = result.slice(offset);
  }

  return { data: result, total, limit, offset };
}

/** 查找单条 */
function findById(collection: Resource[], id: string): Resource | undefined {
  return collection.find((item) => String(item.id) === id);
}

/** 处理请求 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServerOptions
): Promise<void> {
  const method = req.method ?? 'GET';
  const fullUrl = req.url ?? '/';
  const urlObj = new URL(fullUrl, `http://localhost:${options.port}`);
  const pathname = urlObj.pathname;

  // CORS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // 根路径返回数据库总览
  if (pathname === '/' && method === 'GET') {
    const overview: Record<string, number> = {};
    for (const key of Object.keys(DB)) {
      const arr = DB[key];
      overview[key] = Array.isArray(arr) ? arr.length : 0;
    }
    sendJson(res, {
      message: 'JSON Server 正在运行',
      resources: Object.keys(DB),
      counts: overview,
      endpoints: Object.keys(DB).map((k) => `/${k}`),
    });
    return;
  }

  const [resource, idStr] = parsePath(pathname);

  // 校验资源是否存在
  if (!resource || !DB[resource] || !Array.isArray(DB[resource])) {
    sendJson(res, { error: '资源不存在', resource, available: Object.keys(DB) }, 404);
    return;
  }

  const collection = DB[resource];

  // GET 列表
  if (method === 'GET' && idStr === null) {
    const result = listResource(collection, urlObj.searchParams);
    sendJson(res, {
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      count: result.data.length,
    });
    return;
  }

  // GET 单条
  if (method === 'GET' && idStr !== null) {
    const item = findById(collection, idStr);
    if (!item) {
      sendJson(res, { error: '未找到', id: idStr }, 404);
      return;
    }
    sendJson(res, item);
    return;
  }

  // POST 新建
  if (method === 'POST' && idStr === null) {
    const body = (await readJsonBody(req)) as Resource;
    if (Array.isArray(body) || typeof body !== 'object' || body === null) {
      sendJson(res, { error: '请求体必须是对象' }, 400);
      return;
    }
    ID_COUNTERS[resource] = (ID_COUNTERS[resource] ?? 0) + 1;
    const newItem: Resource = { ...body, id: ID_COUNTERS[resource] };
    collection.push(newItem);
    scheduleSave();
    sendJson(res, newItem, 201);
    return;
  }

  // PUT / PATCH
  if ((method === 'PUT' || method === 'PATCH') && idStr !== null) {
    const body = (await readJsonBody(req)) as Resource;
    const index = collection.findIndex((item) => String(item.id) === idStr);
    if (index === -1) {
      sendJson(res, { error: '未找到', id: idStr }, 404);
      return;
    }
    const existing = collection[index];
    let updated: Resource;
    if (method === 'PUT') {
      // 全量更新 (保留 id)
      updated = { ...body, id: existing.id };
    } else {
      // 部分更新 (保留 id)
      updated = { ...existing, ...body, id: existing.id };
    }
    collection[index] = updated;
    scheduleSave();
    sendJson(res, updated);
    return;
  }

  // DELETE
  if (method === 'DELETE' && idStr !== null) {
    const index = collection.findIndex((item) => String(item.id) === idStr);
    if (index === -1) {
      sendJson(res, { error: '未找到', id: idStr }, 404);
      return;
    }
    const [removed] = collection.splice(index, 1);
    scheduleSave();
    sendJson(res, { success: true, deleted: removed });
    return;
  }

  sendJson(res, { error: '方法或路径不匹配', method, path: pathname }, 404);
}

/** 启动服务器 */
function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    Logger.req(method, url, res.statusCode);

    handleRequest(req, res, options).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`处理失败: ${msg}`);
      if (!res.headersSent) {
        sendJson(res, { error: '内部错误', message: msg }, 500);
      }
    });

    res.on('finish', () => {
      Logger.req(method, url, res.statusCode);
    });
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
    Logger.info(`JSON Server 运行于 http://localhost:${options.port}`);
    Logger.info(`数据库文件: ${options.file}`);
    Logger.info(`可用资源: ${Object.keys(DB).join(', ')}`);
    if (options.watch) {
      Logger.info('已开启 --watch，源文件变更将自动重载');
    }
  });

  return server;
}

/** 监听数据库文件变化（外部编辑） */
function watchDatabaseFile(options: ServerOptions): void {
  try {
    fs.watchFile(options.file, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      Logger.warn('检测到数据库文件外部变更，重新加载...');
      try {
        const raw = fs.readFileSync(options.file, 'utf8');
        const data = JSON.parse(raw);
        DB = data;
        ID_COUNTERS = computeIdCounters(DB);
        Logger.info('数据库重新加载完成');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.error(`重载失败: ${msg}`);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`无法监听文件: ${msg}`);
  }
}

/** 主函数 */
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }

  // 由于 loadDatabase 在模块加载时被调用，需在解析后再次确认 file 路径一致
  // 此处重新加载以使用最终参数
  DB = loadDatabase();
  ID_COUNTERS = computeIdCounters(DB);

  const server = startServer(parsed.options);
  if (parsed.options.watch) {
    watchDatabaseFile(parsed.options);
  }

  // 优雅关闭
  const shutdown = (sig: string) => {
    Logger.warn(`收到 ${sig}，正在保存并关闭...`);
    saveNow();
    server.close(() => {
      Logger.info('服务器已退出');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
