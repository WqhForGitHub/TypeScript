#!/usr/bin/env node
/**
 * 49. Todo Web 应用
 * ----------------------------------------------------
 * 完整的 Todo CRUD Web 应用：
 *   - HTML UI (添加/列表/切换完成/删除/过滤 all|active|completed)
 *   - REST API (/api/todos GET/POST/PUT/DELETE)
 *   - JSON 文件持久化 (防抖保存)
 *   - 单一 index.ts 内联 HTML/CSS/JS
 *
 * 命令: start [-p port] [-d datafile]
 * 仅使用 Node.js 内置模块。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ServerOptions {
  port: number;
  dataFile: string;
}

interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}

let todos: Todo[] = [];
let nextId = 1;
let saveTimer: NodeJS.Timeout | null = null;

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

/** 解析命令行 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: 'start',
    options: {
      port: 3000,
      dataFile: path.resolve(process.cwd(), 'todos.json'),
    },
    help: false,
  };
  if (args.length === 0) return result;
  if (args[0] === '-h' || args[0] === '--help') {
    result.help = true;
    return result;
  }
  if (args[0] === 'start') args.shift();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '-p' || flag === '--port') {
      const p = parseInt(value, 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) {
        result.options.port = p;
        i++;
      }
    } else if (flag === '-d' || flag === '--data') {
      if (value) {
        result.options.dataFile = path.resolve(value);
        i++;
      }
    } else if (flag === '-h' || flag === '--help') {
      result.help = true;
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`
Todo Web 应用 - 使用说明

用法:
  todo-web-app start [-p port] [-d datafile]

选项:
  start            启动服务器 (默认命令)
  -p, --port <n>   监听端口 (默认 3000)
  -d, --data <f>   数据文件路径 (默认 ./todos.json)
  -h, --help       显示帮助

API:
  GET    /api/todos            获取所有 (支持 ?filter=all|active|completed)
  POST   /api/todos            新建 (body: { title })
  PUT    /api/todos/:id        更新 (body: { title?, completed? })
  DELETE /api/todos/:id        删除
  DELETE /api/todos            清空所有 (或 ?completed=true 仅清已完成)

页面:
  GET /                        Todo 应用 HTML
`);
}

/** 加载数据 */
function loadData(file: string): void {
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        todos = data.filter((x) => x && typeof x === 'object');
        nextId = todos.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
      }
    } else {
      // 初始化示例数据
      todos = [
        { id: 1, title: '学习 TypeScript', completed: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 2, title: '完成 Demo 49', completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
      nextId = 3;
      saveData(file);
    }
  } catch (err) {
    Logger.warn('数据加载失败: ' + (err instanceof Error ? err.message : String(err)) + '，使用空数据');
    todos = [];
    nextId = 1;
  }
}

/** 保存数据 (防抖) */
function saveDataDebounced(file: string): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveData(file), 300);
}

function saveData(file: string): void {
  try {
    fs.writeFileSync(file, JSON.stringify(todos, null, 2), 'utf8');
  } catch (err) {
    Logger.error('保存失败: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/** 读取 JSON 请求体 */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > 1 * 1024 * 1024) {
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
      } catch {
        reject(new Error('非法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 发送 JSON */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(buf);
}

/** 发送 HTML */
function sendHtml(res: http.ServerResponse, html: string): void {
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

/** HTML 页面 (内联 CSS + JS) */
function todoPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Todo 应用</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; padding: 20px; color: #333;
    }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); overflow: hidden; }
    header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 24px; text-align: center; }
    header h1 { font-size: 28px; margin-bottom: 4px; }
    header .sub { opacity: 0.85; font-size: 13px; }
    .input-row { display: flex; padding: 16px; border-bottom: 1px solid #eee; gap: 8px; }
    input[type="text"] { flex: 1; padding: 12px 14px; border: 2px solid #ddd; border-radius: 8px; font-size: 15px; transition: border 0.2s; }
    input[type="text"]:focus { outline: none; border-color: #667eea; }
    button { background: #667eea; color: #fff; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background 0.2s; }
    button:hover { background: #5568d3; }
    button:disabled { background: #aaa; cursor: not-allowed; }
    button.danger { background: #e74c3c; }
    button.danger:hover { background: #c0392b; }
    .filters { display: flex; padding: 12px 16px; gap: 8px; border-bottom: 1px solid #eee; }
    .filters button { background: #ecf0f1; color: #555; padding: 6px 14px; font-size: 13px; }
    .filters button.active { background: #667eea; color: #fff; }
    .list { list-style: none; max-height: 480px; overflow-y: auto; }
    .list li { display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid #f5f5f5; transition: background 0.15s; }
    .list li:hover { background: #f9f9f9; }
    .list li .checkbox { width: 22px; height: 22px; border: 2px solid #ddd; border-radius: 50%; margin-right: 14px; cursor: pointer; flex-shrink: 0; position: relative; transition: all 0.2s; }
    .list li .checkbox.checked { background: #2ecc71; border-color: #2ecc71; }
    .list li .checkbox.checked::after { content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .list li .title { flex: 1; font-size: 15px; word-break: break-all; }
    .list li.completed .title { color: #aaa; text-decoration: line-through; }
    .list li .delete { background: transparent; color: #e74c3c; padding: 4px 8px; font-size: 18px; opacity: 0; transition: opacity 0.2s; }
    .list li:hover .delete { opacity: 0.7; }
    .list li .delete:hover { opacity: 1; }
    .empty { padding: 40px; text-align: center; color: #aaa; }
    footer { padding: 12px 16px; background: #f8f9fa; color: #888; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
    footer .clear { background: transparent; color: #e74c3c; padding: 4px 8px; font-size: 12px; }
    footer .clear:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Todo 应用</h1>
      <div class="sub">TypeScript Demo 49 - 完整 CRUD</div>
    </header>
    <div class="input-row">
      <input type="text" id="newTodo" placeholder="添加一个新任务..." maxlength="200" />
      <button id="addBtn">添加</button>
    </div>
    <div class="filters">
      <button class="active" data-filter="all">全部</button>
      <button data-filter="active">未完成</button>
      <button data-filter="completed">已完成</button>
    </div>
    <ul class="list" id="list"></ul>
    <footer>
      <span id="count">0 项任务</span>
      <button class="clear" id="clearBtn">清除已完成</button>
    </footer>
  </div>
  <script>
    let currentFilter = 'all';
    const listEl = document.getElementById('list');
    const inputEl = document.getElementById('newTodo');
    const addBtn = document.getElementById('addBtn');
    const countEl = document.getElementById('count');
    const clearBtn = document.getElementById('clearBtn');
    const filterBtns = document.querySelectorAll('.filters button');

    async function api(method, url, body) {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }
    async function load() {
      const data = await api('GET', '/api/todos?filter=' + currentFilter);
      render(data);
    }
    function render(items) {
      listEl.innerHTML = '';
      if (items.length === 0) {
        listEl.innerHTML = '<li class="empty">暂无任务</li>';
      } else {
        for (const t of items) {
          const li = document.createElement('li');
          if (t.completed) li.classList.add('completed');
          li.innerHTML =
            '<div class="checkbox ' + (t.completed ? 'checked' : '') + '"></div>' +
            '<div class="title"></div>' +
            '<button class="delete">x</button>';
          li.querySelector('.title').textContent = t.title;
          li.querySelector('.checkbox').onclick = () => toggle(t);
          li.querySelector('.delete').onclick = () => remove(t.id);
          listEl.appendChild(li);
        }
      }
      updateCount();
    }
    async function updateCount() {
      const all = await api('GET', '/api/todos?filter=all');
      const active = all.filter((t) => !t.completed).length;
      countEl.textContent = active + ' 项未完成 / 共 ' + all.length + ' 项';
    }
    async function add() {
      const title = inputEl.value.trim();
      if (!title) return;
      await api('POST', '/api/todos', { title });
      inputEl.value = '';
      load();
    }
    async function toggle(t) {
      await api('PUT', '/api/todos/' + t.id, { completed: !t.completed });
      load();
    }
    async function remove(id) {
      await api('DELETE', '/api/todos/' + id);
      load();
    }
    async function clearCompleted() {
      await api('DELETE', '/api/todos?completed=true');
      load();
    }
    addBtn.onclick = add;
    inputEl.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    clearBtn.onclick = clearCompleted;
    filterBtns.forEach((btn) => {
      btn.onclick = () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        load();
      };
    });
    load();
  </script>
</body>
</html>`;
}

/** API 路由 */
async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  search: URLSearchParams,
  options: ServerOptions
): Promise<boolean> {
  if (!pathname.startsWith('/api/todos')) return false;

  // GET 列表
  if (method === 'GET' && (pathname === '/api/todos' || pathname === '/api/todos/')) {
    const filter = search.get('filter') ?? 'all';
    let result = todos.slice();
    if (filter === 'active') result = result.filter((t) => !t.completed);
    else if (filter === 'completed') result = result.filter((t) => t.completed);
    sendJson(res, result);
    return true;
  }

  // POST 新建
  if (method === 'POST' && (pathname === '/api/todos' || pathname === '/api/todos/')) {
    const body = (await readJsonBody(req)) as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      sendJson(res, { error: 'title 不能为空' }, 400);
      return true;
    }
    const now = new Date().toISOString();
    const todo: Todo = {
      id: nextId++,
      title: title.slice(0, 200),
      completed: false,
      createdAt: now,
      updatedAt: now,
    };
    todos.push(todo);
    saveDataDebounced(options.dataFile);
    sendJson(res, todo, 201);
    return true;
  }

  // PUT 更新
  const putMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
  if (method === 'PUT' && putMatch) {
    const id = parseInt(putMatch[1], 10);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) {
      sendJson(res, { error: '未找到' }, 404);
      return true;
    }
    const body = (await readJsonBody(req)) as { title?: unknown; completed?: unknown };
    const t = todos[idx];
    if (typeof body.title === 'string') {
      const newTitle = body.title.trim();
      if (newTitle) t.title = newTitle.slice(0, 200);
    }
    if (typeof body.completed === 'boolean') {
      t.completed = body.completed;
    }
    t.updatedAt = new Date().toISOString();
    saveDataDebounced(options.dataFile);
    sendJson(res, t);
    return true;
  }

  // DELETE 单条
  const delMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
  if (method === 'DELETE' && delMatch) {
    const id = parseInt(delMatch[1], 10);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) {
      sendJson(res, { error: '未找到' }, 404);
      return true;
    }
    const [removed] = todos.splice(idx, 1);
    saveDataDebounced(options.dataFile);
    sendJson(res, { success: true, deleted: removed });
    return true;
  }

  // DELETE 批量 (清除已完成)
  if (method === 'DELETE' && (pathname === '/api/todos' || pathname === '/api/todos/')) {
    const onlyCompleted = search.get('completed') === 'true';
    if (onlyCompleted) {
      const removed = todos.filter((t) => t.completed);
      todos = todos.filter((t) => !t.completed);
      saveDataDebounced(options.dataFile);
      sendJson(res, { success: true, count: removed.length });
    } else {
      todos = [];
      saveDataDebounced(options.dataFile);
      sendJson(res, { success: true, count: 0 });
    }
    return true;
  }

  sendJson(res, { error: '未找到' }, 404);
  return true;
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

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, pathname, method, urlObj.searchParams, options);
      if (!handled) {
        sendJson(res, { error: '未找到' }, 404);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error('API 错误: ' + msg);
      sendJson(res, { error: msg }, 500);
    }
    return;
  }

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendHtml(res, todoPage());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('未找到');
}

/** 启动服务器 */
function startServer(options: ServerOptions): http.Server {
  loadData(options.dataFile);

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
    if (err.code === 'EADDRINUSE') {
      Logger.error(`端口 ${options.port} 已被占用`);
    } else {
      Logger.error(err.message);
    }
    process.exit(1);
  });

  server.listen(options.port, () => {
    Logger.info(`Todo Web 应用运行于 http://localhost:${options.port}`);
    Logger.info(`数据文件: ${options.dataFile}`);
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
    Logger.warn(`收到 ${sig}，保存并关闭...`);
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveData(parsed.options.dataFile);
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
