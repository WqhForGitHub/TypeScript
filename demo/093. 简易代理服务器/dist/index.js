#!/usr/bin/env node
"use strict";
/**
 * 简易 HTTP 代理服务器演示
 *
 * 功能：
 * - HTTP 请求代理转发（支持 GET/POST/PUT/DELETE 等）
 * - CONNECT 方法支持（HTTPS 隧道代理）
 * - 请求/响应日志记录
 * - 域名黑名单拦截
 * - 域名白名单模式
 * - 简易响应缓存
 * - 请求头修改（如添加 X-Forwarded-For）
 * - 请求统计（总请求数、各域名请求计数）
 * - 代理认证（Basic Auth）
 * - 管理面板（Web 界面查看代理状态）
 * - 优雅关闭
 *
 * 使用方法：
 *   1. 启动代理服务器：npm run dev
 *   2. 配置浏览器或系统代理为 127.0.0.1:8888
 *   3. 浏览器访问网页，代理服务器将转发请求
 *   4. 访问 http://127.0.0.1:8888/_proxy_admin 查看管理面板
 *
 * 管理面板命令（查询参数）：
 *   ?action=stats    - 查看请求统计
 *   ?action=cache    - 查看缓存内容
 *   ?action=cache_clear - 清除缓存
 *   ?action=blocklist - 查看黑名单
 *   ?action=allowlist - 查看白名单
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
const http = __importStar(require("http"));
const net = __importStar(require("net"));
const url = __importStar(require("url"));
// ============================================================
// 配置与全局状态
// ============================================================
const config = {
    port: 8888,
    host: "127.0.0.1",
    auth: null, // 设置为 { username: "admin", password: "123456" } 启用认证
    cacheEnabled: true,
    cacheTTL: 60000, // 1 分钟缓存
    cacheMaxSize: 100,
    blocklist: new Set([
        "ads.example.com",
        "tracker.example.com",
        "malware.example.com",
    ]),
    allowlist: new Set(),
    allowlistMode: false,
    adminPath: "/_proxy_admin",
};
const stats = {
    totalRequests: 0,
    blockedRequests: 0,
    cachedHits: 0,
    domainCounts: new Map(),
};
const requestLogs = [];
const MAX_LOGS = 200;
const cache = new Map();
let logIdCounter = 0;
// ============================================================
// 工具函数
// ============================================================
function now() {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}
function getDomain(requestUrl) {
    try {
        const parsed = new URL(requestUrl);
        return parsed.hostname;
    }
    catch {
        return requestUrl;
    }
}
/** 判断域名是否被拦截 */
function isBlocked(hostname) {
    if (config.allowlistMode) {
        // 白名单模式：只有白名单中的域名才允许通过
        if (config.allowlist.size > 0 && !config.allowlist.has(hostname)) {
            return true;
        }
    }
    // 黑名单检查
    if (config.blocklist.has(hostname)) {
        return true;
    }
    // 通配符匹配（*.example.com 格式）
    for (const pattern of config.blocklist) {
        if (pattern.startsWith("*.")) {
            const suffix = pattern.slice(1); // .example.com
            if (hostname.endsWith(suffix)) {
                return true;
            }
        }
    }
    return false;
}
/** 生成缓存 key */
function cacheKey(method, requestUrl) {
    return `${method}:${requestUrl}`;
}
/** 检查缓存是否有效 */
function getFromCache(key) {
    if (!config.cacheEnabled)
        return null;
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry;
}
/** 存入缓存 */
function setCache(key, statusCode, headers, body) {
    if (!config.cacheEnabled)
        return;
    // 仅缓存 GET 请求和 200 响应
    if (statusCode !== 200)
        return;
    // 不缓存过大响应（> 1MB）
    if (body.length > 1024 * 1024)
        return;
    // 超出最大缓存数时淘汰最早的
    if (cache.size >= config.cacheMaxSize) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined)
            cache.delete(firstKey);
    }
    cache.set(key, {
        statusCode,
        headers,
        body,
        cachedAt: Date.now(),
        expiresAt: Date.now() + config.cacheTTL,
    });
}
/** 记录请求日志 */
function addLog(log) {
    logIdCounter++;
    requestLogs.push({ ...log, id: logIdCounter });
    if (requestLogs.length > MAX_LOGS) {
        requestLogs.shift();
    }
}
/** 更新统计 */
function updateStats(hostname, blocked, cached) {
    stats.totalRequests++;
    if (blocked)
        stats.blockedRequests++;
    if (cached)
        stats.cachedHits++;
    const count = stats.domainCounts.get(hostname) || 0;
    stats.domainCounts.set(hostname, count + 1);
}
/** Basic Auth 校验 */
function checkAuth(req) {
    if (!config.auth)
        return true;
    const authHeader = req.headers["proxy-authorization"];
    if (!authHeader)
        return false;
    const parts = String(authHeader).split(" ");
    if (parts.length !== 2 || parts[0] !== "Basic")
        return false;
    const decoded = Buffer.from(parts[1], "base64").toString("utf-8");
    const [username, password] = decoded.split(":");
    return username === config.auth.username && password === config.auth.password;
}
// ============================================================
// 代理请求处理
// ============================================================
/** 处理 HTTP 代理请求 */
function handleHttpRequest(req, res) {
    const startTime = Date.now();
    const requestUrl = req.url || "";
    // 检查是否是管理面板请求
    if (requestUrl.startsWith(config.adminPath)) {
        handleAdmin(req, res);
        return;
    }
    // 认证检查
    if (!checkAuth(req)) {
        res.writeHead(407, {
            "Proxy-Authenticate": 'Basic realm="Proxy Server"',
        });
        res.end("Proxy Authentication Required");
        return;
    }
    const hostname = getDomain(requestUrl);
    // 域名拦截检查
    if (isBlocked(hostname)) {
        const duration = Date.now() - startTime;
        addLog({
            method: req.method || "GET",
            url: requestUrl,
            timestamp: now(),
            statusCode: 403,
            duration,
            blocked: true,
            cached: false,
        });
        updateStats(hostname, true, false);
        console.log(`[${now()}] 拦截: ${req.method} ${requestUrl} (域名已被屏蔽)`);
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body><h1>403 禁止访问</h1><p>域名 ${hostname} 已被代理服务器屏蔽</p></body></html>`);
        return;
    }
    // 检查缓存
    const cKey = cacheKey(req.method || "GET", requestUrl);
    const cached = getFromCache(cKey);
    if (cached) {
        const duration = Date.now() - startTime;
        addLog({
            method: req.method || "GET",
            url: requestUrl,
            timestamp: now(),
            statusCode: cached.statusCode,
            duration,
            blocked: false,
            cached: true,
        });
        updateStats(hostname, false, true);
        console.log(`[${now()}] 缓存命中: ${req.method} ${requestUrl} (${duration}ms)`);
        res.writeHead(cached.statusCode, cached.headers);
        res.end(cached.body);
        return;
    }
    // 解析目标 URL
    let targetUrl;
    try {
        targetUrl = new URL(requestUrl);
    }
    catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("400 Bad Request: 无法解析目标 URL");
        return;
    }
    // 构造代理请求选项
    const proxyHeaders = { ...req.headers };
    delete proxyHeaders["proxy-connection"];
    delete proxyHeaders["proxy-authorization"];
    // 添加 X-Forwarded-For
    const clientIp = req.socket.remoteAddress || "unknown";
    proxyHeaders["x-forwarded-for"] = clientIp;
    proxyHeaders["x-forwarded-proto"] = targetUrl.protocol.replace(":", "");
    const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: proxyHeaders,
    };
    // 发起代理请求
    const proxyReq = http.request(options, (proxyRes) => {
        const duration = Date.now() - startTime;
        // 收集响应体用于缓存
        const chunks = [];
        proxyRes.on("data", (chunk) => {
            chunks.push(chunk);
        });
        proxyRes.on("end", () => {
            const body = Buffer.concat(chunks);
            addLog({
                method: req.method || "GET",
                url: requestUrl,
                timestamp: now(),
                statusCode: proxyRes.statusCode || 0,
                duration,
                blocked: false,
                cached: false,
            });
            updateStats(hostname, false, false);
            console.log(`[${now()}] 代理: ${req.method} ${requestUrl} → ${proxyRes.statusCode} (${duration}ms)`);
            // 存入缓存
            setCache(cKey, proxyRes.statusCode || 0, proxyRes.headers, body);
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            res.end(body);
        });
    });
    proxyReq.on("error", (err) => {
        const duration = Date.now() - startTime;
        addLog({
            method: req.method || "GET",
            url: requestUrl,
            timestamp: now(),
            statusCode: 502,
            duration,
            blocked: false,
            cached: false,
        });
        console.error(`[${now()}] 代理错误: ${err.message}`);
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`502 Bad Gateway: ${err.message}`);
    });
    // 将客户端请求体转发给目标服务器
    req.on("data", (chunk) => {
        proxyReq.write(chunk);
    });
    req.on("end", () => {
        proxyReq.end();
    });
}
/** 处理 HTTPS CONNECT 隧道代理 */
function handleConnect(req, socket, head) {
    const startTime = Date.now();
    const [hostname, portStr] = (req.url || "").split(":");
    const port = parseInt(portStr, 10) || 443;
    // 认证检查
    if (!checkAuth(req)) {
        socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n");
        socket.write('Proxy-Authenticate: Basic realm="Proxy Server"\r\n');
        socket.write("\r\n");
        socket.end();
        return;
    }
    // 域名拦截
    if (isBlocked(hostname)) {
        const duration = Date.now() - startTime;
        addLog({
            method: "CONNECT",
            url: req.url || "",
            timestamp: now(),
            statusCode: 403,
            duration,
            blocked: true,
            cached: false,
        });
        updateStats(hostname, true, false);
        console.log(`[${now()}] 拦截: CONNECT ${req.url} (域名已被屏蔽)`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.end();
        return;
    }
    console.log(`[${now()}] 隧道: CONNECT ${hostname}:${port}`);
    // 建立到目标服务器的连接
    const targetSocket = net.connect(port, hostname, () => {
        const duration = Date.now() - startTime;
        addLog({
            method: "CONNECT",
            url: req.url || "",
            timestamp: now(),
            statusCode: 200,
            duration,
            blocked: false,
            cached: false,
        });
        updateStats(hostname, false, false);
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) {
            targetSocket.write(head);
        }
        // 双向数据转发
        targetSocket.pipe(socket);
        socket.pipe(targetSocket);
    });
    targetSocket.on("error", (err) => {
        console.error(`[${now()}] 隧道错误: ${err.message}`);
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.end();
    });
    socket.on("error", (err) => {
        console.error(`[${now()}] 客户端隧道错误: ${err.message}`);
        targetSocket.destroy();
    });
}
// ============================================================
// 管理面板
// ============================================================
function handleAdmin(req, res) {
    const parsedUrl = url.parse(req.url || "", true);
    const action = parsedUrl.query.action || "index";
    let html = "";
    switch (action) {
        case "stats":
            html = renderStats();
            break;
        case "cache":
            html = renderCache();
            break;
        case "cache_clear":
            cache.clear();
            html = renderMessage("缓存已清除", "cache");
            break;
        case "blocklist":
            html = renderList("黑名单", config.blocklist);
            break;
        case "allowlist":
            html = renderList("白名单", config.allowlist);
            break;
        case "logs":
            html = renderLogs();
            break;
        default:
            html = renderIndex();
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
}
function renderIndex() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>代理服务器管理面板</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; }
    h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
    h2 { color: #555; }
    .card { background: white; border-radius: 8px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat { display: inline-block; width: 22%; text-align: center; margin: 10px 1%; }
    .stat .number { font-size: 2em; font-weight: bold; color: #4CAF50; }
    .stat .label { color: #666; font-size: 0.9em; }
    nav a { display: inline-block; padding: 8px 16px; margin: 4px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
    nav a:hover { background: #45a049; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f0f0f0; }
    .blocked { color: #f44336; }
    .cached { color: #2196F3; }
    footer { text-align: center; color: #999; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>代理服务器管理面板</h1>
  <nav>
    <a href="?action=stats">请求统计</a>
    <a href="?action=logs">请求日志</a>
    <a href="?action=cache">缓存内容</a>
    <a href="?action=blocklist">黑名单</a>
    <a href="?action=allowlist">白名单</a>
    <a href="?action=cache_clear">清除缓存</a>
  </nav>
  <div class="card">
    <h2>服务器概览</h2>
    <div class="stat"><div class="number">${stats.totalRequests}</div><div class="label">总请求数</div></div>
    <div class="stat"><div class="number">${stats.blockedRequests}</div><div class="label">拦截请求</div></div>
    <div class="stat"><div class="number">${stats.cachedHits}</div><div class="label">缓存命中</div></div>
    <div class="stat"><div class="number">${cache.size}</div><div class="label">缓存条目</div></div>
  </div>
  <div class="card">
    <h2>最近请求</h2>
    ${renderRecentLogsTable(10)}
  </div>
  <footer>简易代理服务器 | 端口 ${config.port}</footer>
</body>
</html>`;
}
function renderStats() {
    const topDomains = Array.from(stats.domainCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
    let domainRows = "";
    for (const [domain, count] of topDomains) {
        domainRows += `<tr><td>${domain}</td><td>${count}</td></tr>`;
    }
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>请求统计 - 代理服务器</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .card { background: white; border-radius: 8px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    nav a { display: inline-block; padding: 8px 16px; margin: 4px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f0f0f0; }
  </style>
</head>
<body>
  <h1>请求统计</h1>
  <nav><a href="?action=index">返回首页</a></nav>
  <div class="card">
    <h2>总览</h2>
    <p>总请求数: ${stats.totalRequests}</p>
    <p>拦截请求: ${stats.blockedRequests}</p>
    <p>缓存命中: ${stats.cachedHits}</p>
    <p>缓存条目: ${cache.size}</p>
  </div>
  <div class="card">
    <h2>域名请求排行 (Top 20)</h2>
    <table>
      <tr><th>域名</th><th>请求次数</th></tr>
      ${domainRows || '<tr><td colspan="2">暂无数据</td></tr>'}
    </table>
  </div>
</body>
</html>`;
}
function renderCache() {
    let rows = "";
    for (const [key, entry] of cache.entries()) {
        const remaining = Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
        rows += `<tr>
      <td>${key.substring(0, 60)}${key.length > 60 ? "..." : ""}</td>
      <td>${entry.statusCode}</td>
      <td>${(entry.body.length / 1024).toFixed(1)} KB</td>
      <td>${remaining}s</td>
    </tr>`;
    }
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>缓存内容 - 代理服务器</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .card { background: white; border-radius: 8px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    nav a { display: inline-block; padding: 8px 16px; margin: 4px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; font-size: 0.9em; }
    th { background: #f0f0f0; }
  </style>
</head>
<body>
  <h1>缓存内容</h1>
  <nav><a href="?action=index">返回首页</a> <a href="?action=cache_clear">清除缓存</a></nav>
  <div class="card">
    <p>缓存条目: ${cache.size} / ${config.cacheMaxSize} | 缓存有效期: ${config.cacheTTL / 1000}s</p>
    <table>
      <tr><th>缓存 Key</th><th>状态码</th><th>大小</th><th>剩余有效期</th></tr>
      ${rows || '<tr><td colspan="4">缓存为空</td></tr>'}
    </table>
  </div>
</body>
</html>`;
}
function renderList(title, list) {
    let items = "";
    for (const item of list) {
        items += `<tr><td>${item}</td></tr>`;
    }
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title} - 代理服务器</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .card { background: white; border-radius: 8px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    nav a { display: inline-block; padding: 8px 16px; margin: 4px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f0f0f0; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <nav><a href="?action=index">返回首页</a></nav>
  <div class="card">
    <table>
      <tr><th>域名</th></tr>
      ${items || '<tr><td>列表为空</td></tr>'}
    </table>
  </div>
</body>
</html>`;
}
function renderLogs() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>请求日志 - 代理服务器</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; max-width: 1000px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .card { background: white; border-radius: 8px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    nav a { display: inline-block; padding: 8px 16px; margin: 4px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #ddd; font-size: 0.85em; }
    th { background: #f0f0f0; }
    .blocked { color: #f44336; font-weight: bold; }
    .cached { color: #2196F3; }
  </style>
</head>
<body>
  <h1>请求日志</h1>
  <nav><a href="?action=index">返回首页</a></nav>
  <div class="card">
    ${renderRecentLogsTable(50)}
  </div>
</body>
</html>`;
}
function renderRecentLogsTable(count) {
    const recentLogs = requestLogs.slice(-count).reverse();
    let rows = "";
    for (const log of recentLogs) {
        const flags = [];
        if (log.blocked)
            flags.push('<span class="blocked">已拦截</span>');
        if (log.cached)
            flags.push('<span class="cached">缓存</span>');
        const truncatedUrl = log.url.length > 60 ? log.url.substring(0, 60) + "..." : log.url;
        rows += `<tr>
      <td>${log.timestamp}</td>
      <td>${log.method}</td>
      <td title="${log.url}">${truncatedUrl}</td>
      <td>${log.statusCode}</td>
      <td>${log.duration}ms</td>
      <td>${flags.join(" ") || "-"}</td>
    </tr>`;
    }
    return `<table>
    <tr><th>时间</th><th>方法</th><th>URL</th><th>状态码</th><th>耗时</th><th>标记</th></tr>
    ${rows || '<tr><td colspan="6">暂无日志</td></tr>'}
  </table>`;
}
function renderMessage(message, backAction) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>操作结果 - 代理服务器</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .card { background: white; border-radius: 8px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    nav a { display: inline-block; padding: 8px 16px; margin: 4px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
    .success { color: #4CAF50; font-size: 1.2em; }
  </style>
</head>
<body>
  <h1>操作结果</h1>
  <div class="card">
    <p class="success">${message}</p>
  </div>
  <nav><a href="?action=${backAction}">返回</a> <a href="?action=index">首页</a></nav>
</body>
</html>`;
}
// ============================================================
// 主函数
// ============================================================
function main() {
    const server = http.createServer((req, res) => {
        handleHttpRequest(req, res);
    });
    // 处理 HTTPS CONNECT 请求
    server.on("connect", (req, socket, head) => {
        handleConnect(req, socket, head);
    });
    server.listen(config.port, config.host, () => {
        console.log("========================================");
        console.log("  简易 HTTP 代理服务器已启动");
        console.log(`  代理地址: ${config.host}:${config.port}`);
        console.log(`  管理面板: http://${config.host}:${config.port}${config.adminPath}`);
        console.log("========================================");
        console.log(`  缓存: ${config.cacheEnabled ? "已启用" : "已禁用"} (TTL: ${config.cacheTTL / 1000}s)`);
        console.log(`  黑名单: ${config.blocklist.size} 个域名`);
        console.log(`  白名单模式: ${config.allowlistMode ? "已启用" : "已禁用"}`);
        console.log(`  认证: ${config.auth ? "已启用" : "已禁用"}`);
        console.log("========================================");
        console.log("  使用方法:");
        console.log("  1. 配置浏览器代理为 127.0.0.1:8888");
        console.log("  2. 或使用 curl 测试:");
        console.log(`     curl -x http://${config.host}:${config.port} http://example.com`);
        console.log("========================================");
    });
    server.on("error", (err) => {
        console.error(`[${now()}] 服务器错误: ${err.message}`);
        process.exit(1);
    });
    // 优雅关闭
    process.on("SIGINT", () => {
        console.log(`\n[${now()}] 正在关闭代理服务器...`);
        server.close(() => {
            console.log(`[${now()}] 代理服务器已关闭`);
            process.exit(0);
        });
        setTimeout(() => {
            console.error(`[${now()}] 强制退出`);
            process.exit(1);
        }, 5000);
    });
}
main();
//# sourceMappingURL=index.js.map