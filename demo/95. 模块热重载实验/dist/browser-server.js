"use strict";
/**
 * 浏览器 HMR 开发服务器
 *
 * 一个轻量级的开发服务器，实现浏览器端的模块热重载。
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                   架构设计                               │
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │  Server (Node.js)              Client (Browser)         │
 * │  ┌──────────────┐              ┌──────────────┐         │
 * │  │ HTTP Server  │─── HTML ───→ │ 页面渲染     │         │
 * │  │              │              │              │         │
 * │  │ fs.watch     │              │ HMR Runtime  │         │
 * │  │ (监听 .ts)   │              │ (模块注册表) │         │
 * │  │      ↓       │              │      ↑       │         │
 * │  │ ts.compile   │   SSE push   │ eval(newCode)│         │
 * │  │ (编译 TS→JS) │─────────────→│ (执行新代码) │         │
 * │  └──────────────┘              └──────────────┘         │
 * │                                                         │
 * │  关键技术：                                             │
 * │  - SSE (Server-Sent Events)：服务器→客户端单向推送       │
 * │  - ts.transpileModule：将 TS 编译为 CommonJS JS          │
 * │  - 模块注册表：客户端维护 __hmr_modules__ 全局对象      │
 * │  - 动态执行：eval() 执行新模块代码，替换注册表条目       │
 * │                                                         │
 * └─────────────────────────────────────────────────────────┘
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBrowserServer = startBrowserServer;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
// ─── 配置 ────────────────────────────────────────────────
const PORT = 3000;
const ROOT_DIR = process.cwd();
const MODULES_DIR = path.join(ROOT_DIR, 'src/modules');
// ─── SSE 客户端管理 ─────────────────────────────────────
/** 已连接的 SSE 客户端列表 */
const sseClients = [];
/** 向所有客户端广播 SSE 事件 */
function broadcast(event, data) {
    const payload = JSON.stringify(data);
    for (const client of sseClients) {
        client.write(`event: ${event}\ndata: ${payload}\n\n`);
    }
}
// ─── TypeScript 编译 ────────────────────────────────────
/**
 * 将 TypeScript 模块编译为浏览器可执行的 JavaScript。
 *
 * 编译产物被包装在 __hmr_register__ 调用中，
 * 客户端执行时会将模块注册到 HMR 模块注册表中。
 */
function compileModule(name, source) {
    const result = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
    });
    // 包装为 HMR 注册调用
    return [
        `__hmr_register__('${name}', function(exports, require, module) {`,
        result.outputText,
        '});',
    ].join('\n');
}
// ─── HTML 页面生成 ───────────────────────────────────────
/**
 * 生成包含 HMR 客户端运行时和初始模块的 HTML 页面。
 *
 * 页面结构：
 * 1. 样式定义
 * 2. DOM 结构（计数器、按钮、日志面板）
 * 3. HMR 客户端运行时（模块注册表 + SSE 连接）
 * 4. 初始模块代码（服务器编译后注入）
 * 5. 应用逻辑
 */
function generateHTML() {
    // 读取并编译初始模块
    let counterCode = '';
    let formatterCode = '';
    try {
        const counterSrc = fs.readFileSync(path.join(MODULES_DIR, 'counter.ts'), 'utf-8');
        counterCode = compileModule('counter', counterSrc);
    }
    catch {
        counterCode = `__hmr_register__('counter', function(exports) {
      var count = 0;
      exports.increment = function() { return ++count; };
      exports.decrement = function() { return --count; };
      exports.getCount = function() { return count; };
      exports.reset = function() { count = 0; return 0; };
    });`;
    }
    try {
        const formatterSrc = fs.readFileSync(path.join(MODULES_DIR, 'formatter.ts'), 'utf-8');
        formatterCode = compileModule('formatter', formatterSrc);
    }
    catch {
        formatterCode = `__hmr_register__('formatter', function(exports) {
      exports.format = function(count) { return '[计数器] 当前值: ' + count; };
    });`;
    }
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>模块热重载实验</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', 'Consolas', monospace;
      max-width: 600px; margin: 0 auto; padding: 30px;
      background: #0d1117; color: #c9d1d9;
    }
    h1 { text-align: center; margin-bottom: 8px; font-size: 1.5em; }
    .subtitle { text-align: center; color: #8b949e; font-size: 0.85em; margin-bottom: 24px; }
    .card {
      background: #161b22; border: 1px solid #30363d; border-radius: 10px;
      padding: 24px; margin: 16px 0;
    }
    .counter {
      font-size: 2.8em; text-align: center; color: #58a6ff;
      font-weight: bold; margin: 10px 0;
      font-variant-numeric: tabular-nums;
    }
    .buttons { text-align: center; margin: 16px 0; }
    .buttons button {
      font-size: 1em; padding: 10px 28px; margin: 4px; cursor: pointer;
      border: 1px solid #30363d; border-radius: 6px;
      color: #c9d1d9; background: #21262d; transition: all 0.15s;
    }
    .buttons button:hover { background: #30363d; border-color: #8b949e; }
    .buttons .inc { border-color: #238636; }
    .buttons .inc:hover { background: #238636; }
    .buttons .dec { border-color: #da3633; }
    .buttons .dec:hover { background: #da3633; }
    .buttons .rst:hover { background: #484f58; }
    .status {
      text-align: center; margin: 10px 0; font-size: 0.85em;
    }
    .status.ok { color: #3fb950; }
    .status.err { color: #f85149; }
    .log {
      background: #010409; color: #3fb950; padding: 16px;
      border-radius: 8px; font-family: 'Consolas', monospace;
      font-size: 0.8em; max-height: 260px; overflow-y: auto;
      border: 1px solid #21262d;
    }
    .log div { padding: 2px 0; border-bottom: 1px solid #161b22; }
    .log .hmr { color: #d29922; }
    .log .err { color: #f85149; }
    .hint {
      color: #8b949e; font-size: 0.8em; margin-top: 16px;
      line-height: 1.7;
    }
    code { background: #1c2128; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Module Hot Reloading</h1>
  <p class="subtitle">纯 TypeScript 实现 | 编辑文件 → 自动更新</p>

  <div class="card">
    <div class="counter" id="display">-</div>
    <div class="buttons">
      <button class="inc" id="btn-inc">+1</button>
      <button class="dec" id="btn-dec">-1</button>
      <button class="rst" id="btn-rst">Reset</button>
    </div>
    <div class="status" id="status">连接中...</div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:12px;color:#8b949e;font-size:0.9em">HMR LOG</h3>
    <div class="log" id="log"></div>
  </div>

  <div class="hint">
    编辑 <code>src/modules/formatter.ts</code> 修改输出格式，
    或编辑 <code>src/modules/counter.ts</code> 修改计数逻辑，<br>
    保存后浏览器自动更新，无需刷新页面。
  </div>

  <!-- ===== HMR 客户端运行时 ===== -->
  <script>
  // 模块注册表
  var __hmr_modules__ = {};
  // 模块更新监听器
  var __hmr_listeners__ = {};

  /**
   * 注册/更新模块。
   * 首次调用时创建模块条目，后续调用时替换导出并通知监听器。
   */
  function __hmr_register__(name, factory) {
    var isNew = !__hmr_modules__[name];
    var mod = __hmr_modules__[name] || { exports: {} };
    var moduleObj = { exports: mod.exports };

    // 清除旧导出
    Object.keys(mod.exports).forEach(function(k) { delete mod.exports[k]; });

    // 执行工厂函数
    factory(mod.exports, function(id) {
      return __hmr_modules__[id] ? __hmr_modules__[id].exports : {};
    }, moduleObj);

    // 处理 module.exports = xxx 模式
    if (moduleObj.exports !== mod.exports) {
      Object.keys(mod.exports).forEach(function(k) { delete mod.exports[k]; });
      Object.assign(mod.exports, moduleObj.exports);
    }

    __hmr_modules__[name] = mod;

    // 通知监听器
    if (!isNew) {
      (__hmr_listeners__[name] || []).forEach(function(cb) { cb(mod.exports); });
      addLog('[HMR] 模块更新: ' + name, 'hmr');
    } else {
      addLog('[HMR] 模块加载: ' + name);
    }
  }

  /** 导入模块（返回当前导出） */
  function __hmr_import__(name) {
    return __hmr_modules__[name] ? __hmr_modules__[name].exports : {};
  }

  /** 监听模块更新 */
  function __hmr_accept__(name, callback) {
    if (!__hmr_listeners__[name]) __hmr_listeners__[name] = [];
    __hmr_listeners__[name].push(callback);
  }

  // ===== 日志 =====
  function addLog(msg, cls) {
    var log = document.getElementById('log');
    var div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    log.insertBefore(div, log.firstChild);
    // 限制日志条数
    while (log.children.length > 50) log.removeChild(log.lastChild);
  }

  // ===== SSE 连接 =====
  var statusEl = document.getElementById('status');
  var evtSource = new EventSource('/hmr');

  evtSource.onopen = function() {
    statusEl.textContent = '● 已连接到 HMR 服务器';
    statusEl.className = 'status ok';
    addLog('[SSE] 已连接到开发服务器');
  };

  evtSource.onerror = function() {
    statusEl.textContent = '○ 连接断开，正在重连...';
    statusEl.className = 'status err';
    addLog('[SSE] 连接断开', 'err');
  };

  evtSource.addEventListener('update', function(e) {
    var data = JSON.parse(e.data);
    try {
      // 动态执行新模块代码
      eval(data.code);
    } catch (err) {
      addLog('[HMR] 执行失败: ' + err.message, 'err');
    }
  });

  // ===== 初始模块加载 =====
  ${counterCode}
  ${formatterCode}

  // ===== 应用逻辑 =====
  var display = document.getElementById('display');
  var count = 0;

  function updateDisplay() {
    var formatter = __hmr_import__('formatter');
    display.textContent = formatter.format(count);
  }

  document.getElementById('btn-inc').onclick = function() {
    count++;
    updateDisplay();
  };
  document.getElementById('btn-dec').onclick = function() {
    count--;
    updateDisplay();
  };
  document.getElementById('btn-rst').onclick = function() {
    count = 0;
    updateDisplay();
  };

  // 监听格式化模块更新，自动刷新显示
  __hmr_accept__('formatter', function() {
    updateDisplay();
  });

  // 监听计数器模块更新
  __hmr_accept__('counter', function() {
    addLog('[App] counter 模块已更新');
  });

  // 初始显示
  updateDisplay();
  addLog('[App] 应用已启动');
  </script>
</body>
</html>`;
}
// ─── HTTP 服务器 ─────────────────────────────────────────
const server = http.createServer((req, res) => {
    const urlPath = req.url || '/';
    if (urlPath === '/') {
        // 首页：返回 HTML
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateHTML());
    }
    else if (urlPath === '/hmr') {
        // SSE 端点：建立长连接，推送模块更新
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        // 发送连接确认
        res.write('event: connected\ndata: {}\n\n');
        sseClients.push(res);
        // 客户端断开时清理
        req.on('close', () => {
            const idx = sseClients.indexOf(res);
            if (idx >= 0)
                sseClients.splice(idx, 1);
        });
    }
    else {
        res.writeHead(404);
        res.end('Not Found');
    }
});
// ─── 文件监听 ────────────────────────────────────────────
/**
 * 监听 src/modules/ 目录的 .ts 文件变化。
 * 检测到变化后，重新编译模块并通过 SSE 推送给浏览器。
 */
function watchModules() {
    console.log('[HMR] 正在监听: src/modules/');
    let debounceTimer = null;
    fs.watch(MODULES_DIR, { recursive: true }, (event, filename) => {
        if (!filename || !filename.endsWith('.ts'))
            return;
        // 防抖：避免编辑器保存触发多次事件
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            handleModuleChange(filename);
        }, 100);
    });
}
/** 处理模块文件变化 */
function handleModuleChange(filename) {
    const filePath = path.join(MODULES_DIR, filename);
    const moduleName = path.basename(filename, '.ts');
    try {
        const source = fs.readFileSync(filePath, 'utf-8');
        const compiled = compileModule(moduleName, source);
        // 通过 SSE 推送更新到所有浏览器客户端
        broadcast('update', { name: moduleName, code: compiled });
        console.log(`[HMR] 模块已推送: ${filename} → ${sseClients.length} 个客户端`);
    }
    catch (err) {
        console.error(`[HMR] 编译失败 ${filename}:`, err);
    }
}
// ─── 启动 ────────────────────────────────────────────────
function startBrowserServer() {
    server.listen(PORT, () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════════╗');
        console.log('║         模块热重载实验 - 浏览器模式              ║');
        console.log('╚══════════════════════════════════════════════════╝');
        console.log('');
        console.log('  浏览器地址: http://localhost:' + PORT);
        console.log('');
        console.log('  编辑 src/modules/ 下的文件并保存，');
        console.log('  浏览器页面会自动更新，无需刷新。');
        console.log('');
        console.log('  架构:');
        console.log('    Server: fs.watch → ts.transpileModule → SSE push');
        console.log('    Client: SSE → eval() → __hmr_register__ → UI 更新');
        console.log('');
        console.log('按 Ctrl+C 退出');
        console.log('─'.repeat(52));
        watchModules();
    });
    process.on('SIGINT', () => {
        sseClients.forEach(c => c.end());
        server.close();
        console.log('\n再见！');
        process.exit(0);
    });
}
//# sourceMappingURL=browser-server.js.map