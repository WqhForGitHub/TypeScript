#!/usr/bin/env node
"use strict";
/**
 * WebSocket 聊天室演示
 *
 * 功能：
 *   - 多用户实时聊天，消息广播
 *   - 昵称设置与变更
 *   - 用户加入/离开通知
 *   - 在线用户列表
 *   - 内置 HTTP 服务提供网页客户端
 *
 * 使用方法：
 *   npm run dev          启动服务器
 *   浏览器打开 http://localhost:3000 即可聊天
 *
 * 消息协议 (JSON)：
 *   客户端 -> 服务器:
 *     { type: "message",  content: string }
 *     { type: "nickname", name: string }
 *
 *   服务器 -> 客户端:
 *     { type: "message",  from: string, content: string, time: string }
 *     { type: "system",   content: string, time: string }
 *     { type: "users",    users: string[] }
 *     { type: "welcome",  name: string }
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
const url = __importStar(require("url"));
const ws_1 = require("ws");
// ==================== 配置 ====================
const PORT = 3000;
// ==================== 聊天室核心 ====================
const clients = new Map();
let userCounter = 0;
/** 生成默认昵称 */
function generateName() {
    userCounter++;
    return `用户${userCounter}`;
}
/** 获取当前时间字符串 */
function now() {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}
/** 获取在线用户列表 */
function getOnlineUsers() {
    return Array.from(clients.values()).map((c) => c.name);
}
/** 向所有客户端广播消息 */
function broadcast(message) {
    const data = JSON.stringify(message);
    for (const [ws] of clients) {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(data);
        }
    }
}
/** 广播在线用户列表 */
function broadcastUserList() {
    broadcast({ type: "users", users: getOnlineUsers() });
}
/** 处理客户端消息 */
function handleMessage(ws, raw) {
    const client = clients.get(ws);
    if (!client)
        return;
    let msg;
    try {
        msg = JSON.parse(raw);
    }
    catch {
        ws.send(JSON.stringify({
            type: "system",
            content: "消息格式错误，请发送 JSON",
            time: now(),
        }));
        return;
    }
    switch (msg.type) {
        case "message": {
            const content = (msg.content || "").trim();
            if (!content)
                break;
            broadcast({
                type: "message",
                from: client.name,
                content,
                time: now(),
            });
            break;
        }
        case "nickname": {
            const newName = (msg.name || "").trim();
            if (!newName)
                break;
            // 检查昵称是否已存在
            const exists = Array.from(clients.values()).some((c) => c.name === newName && c.ws !== ws);
            if (exists) {
                ws.send(JSON.stringify({
                    type: "system",
                    content: `昵称 "${newName}" 已被占用，请选择其他昵称`,
                    time: now(),
                }));
                break;
            }
            const oldName = client.name;
            client.name = newName;
            broadcast({
                type: "system",
                content: `${oldName} 已更名为 ${newName}`,
                time: now(),
            });
            broadcastUserList();
            ws.send(JSON.stringify({ type: "welcome", name: newName }));
            break;
        }
        default:
            ws.send(JSON.stringify({
                type: "system",
                content: `未知消息类型: ${msg.type}`,
                time: now(),
            }));
    }
}
// ==================== HTML 客户端 ====================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WebSocket 聊天室</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a2e; color: #e0e0e0;
    height: 100vh; display: flex; flex-direction: column;
  }
  header {
    background: #16213e; padding: 12px 20px;
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid #0f3460;
  }
  header h1 { font-size: 18px; color: #e94560; }
  #status { font-size: 13px; color: #8a8a8a; }
  #status.connected { color: #4ecca3; }
  .container { display: flex; flex: 1; overflow: hidden; }
  .sidebar {
    width: 200px; background: #16213e;
    border-right: 1px solid #0f3460;
    display: flex; flex-direction: column;
  }
  .sidebar h2 {
    font-size: 13px; color: #8a8a8a; padding: 12px 16px 8px;
    text-transform: uppercase; letter-spacing: 1px;
  }
  #user-list {
    list-style: none; padding: 0 16px; overflow-y: auto; flex: 1;
  }
  #user-list li {
    padding: 6px 0; font-size: 14px; color: #4ecca3;
    border-bottom: 1px solid #1a1a3e;
  }
  #user-list li::before { content: "● "; font-size: 8px; }
  #chat-area { flex: 1; display: flex; flex-direction: column; }
  #messages {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .msg { max-width: 70%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; word-break: break-word; }
  .msg.user { background: #0f3460; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg.other { background: #222244; align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg.system { background: transparent; align-self: center; color: #8a8a8a; font-size: 12px; padding: 4px; }
  .msg .meta { font-size: 11px; color: #6a6a8a; margin-top: 4px; }
  .msg .name { font-weight: bold; margin-bottom: 2px; }
  .msg.user .name { color: #e94560; }
  .msg.other .name { color: #4ecca3; }
  .input-area {
    padding: 12px 16px; background: #16213e;
    border-top: 1px solid #0f3460;
    display: flex; gap: 8px;
  }
  .input-area input {
    flex: 1; padding: 10px 14px; border: 1px solid #0f3460;
    border-radius: 8px; background: #1a1a2e; color: #e0e0e0;
    font-size: 14px; outline: none;
  }
  .input-area input:focus { border-color: #e94560; }
  .input-area button {
    padding: 10px 20px; background: #e94560; color: white;
    border: none; border-radius: 8px; cursor: pointer;
    font-size: 14px; font-weight: bold; transition: background 0.2s;
  }
  .input-area button:hover { background: #c73652; }
  .nick-bar {
    padding: 8px 16px; background: #0f3460;
    display: flex; gap: 8px; align-items: center;
  }
  .nick-bar span { font-size: 13px; color: #8a8a8a; white-space: nowrap; }
  .nick-bar input {
    flex: 1; padding: 6px 10px; border: 1px solid #16213e;
    border-radius: 6px; background: #1a1a2e; color: #e0e0e0;
    font-size: 13px; outline: none;
  }
  .nick-bar input:focus { border-color: #4ecca3; }
  .nick-bar button {
    padding: 6px 14px; background: #4ecca3; color: #1a1a2e;
    border: none; border-radius: 6px; cursor: pointer;
    font-size: 13px; font-weight: bold;
  }
  .nick-bar button:hover { background: #3baa8a; }
  @media (max-width: 600px) {
    .sidebar { display: none; }
    .msg { max-width: 85%; }
  }
</style>
</head>
<body>
<header>
  <h1>WebSocket 聊天室</h1>
  <span id="status">未连接</span>
</header>
<div class="container">
  <aside class="sidebar">
    <h2>在线用户</h2>
    <ul id="user-list"></ul>
  </aside>
  <div id="chat-area">
    <div id="messages"></div>
    <div class="nick-bar">
      <span>昵称:</span>
      <input id="nick-input" placeholder="输入新昵称..." maxlength="16">
      <button onclick="changeNick()">修改</button>
    </div>
    <div class="input-area">
      <input id="msg-input" placeholder="输入消息..." maxlength="500">
      <button onclick="sendMessage()">发送</button>
    </div>
  </div>
</div>
<script>
const msgBox = document.getElementById("messages");
const msgInput = document.getElementById("msg-input");
const nickInput = document.getElementById("nick-input");
const userList = document.getElementById("user-list");
const statusEl = document.getElementById("status");

let myName = "";
let ws;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host);

  ws.onopen = () => {
    statusEl.textContent = "已连接";
    statusEl.className = "connected";
  };

  ws.onclose = () => {
    statusEl.textContent = "已断开，3秒后重连...";
    statusEl.className = "";
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    statusEl.textContent = "连接错误";
    statusEl.className = "";
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "welcome":
        myName = msg.name;
        nickInput.value = myName;
        addSystem("你已加入聊天室，昵称: " + myName);
        break;
      case "message":
        if (msg.from === myName) {
          addMsg("user", msg.from, msg.content, msg.time);
        } else {
          addMsg("other", msg.from, msg.content, msg.time);
        }
        break;
      case "system":
        addSystem(msg.content);
        break;
      case "users":
        userList.innerHTML = msg.users.map(u => "<li>" + escHtml(u) + "</li>").join("");
        break;
    }
  };
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function addMsg(cls, from, text, time) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.innerHTML = '<div class="name">' + escHtml(from) + '</div>'
    + '<div>' + escHtml(text) + '</div>'
    + '<div class="meta">' + escHtml(time || "") + '</div>';
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function sendMessage() {
  const content = msgInput.value.trim();
  if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "message", content }));
  msgInput.value = "";
  msgInput.focus();
}

function changeNick() {
  const name = nickInput.value.trim();
  if (!name || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "nickname", name }));
}

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") changeNick();
});

connect();
</script>
</body>
</html>`;
// ==================== HTTP 服务器 ====================
const server = http.createServer((req, res) => {
    const pathname = url.parse(req.url || "/", true).pathname;
    if (pathname === "/" || pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML_PAGE);
    }
    else {
        res.writeHead(404);
        res.end("Not Found");
    }
});
// ==================== WebSocket 服务器 ====================
const wss = new ws_1.WebSocketServer({ server });
wss.on("connection", (ws) => {
    const name = generateName();
    clients.set(ws, { ws, name });
    // 发送欢迎消息
    ws.send(JSON.stringify({ type: "welcome", name }));
    // 广播加入通知
    broadcast({
        type: "system",
        content: `${name} 加入了聊天室`,
        time: now(),
    });
    // 广播用户列表
    broadcastUserList();
    console.log(`[+] ${name} 已连接 (当前在线: ${clients.size} 人)`);
    // 处理消息
    ws.on("message", (raw) => {
        handleMessage(ws, raw.toString());
    });
    // 处理断开
    ws.on("close", () => {
        const client = clients.get(ws);
        if (client) {
            console.log(`[-] ${client.name} 已断开 (当前在线: ${clients.size - 1} 人)`);
            clients.delete(ws);
            broadcast({
                type: "system",
                content: `${client.name} 离开了聊天室`,
                time: now(),
            });
            broadcastUserList();
        }
    });
    ws.on("error", () => {
        // 错误时也会触发 close，无需额外处理
    });
});
// ==================== 启动 ====================
function main() {
    server.listen(PORT, () => {
        console.log("=======================================");
        console.log("  WebSocket 聊天室已启动");
        console.log(`  地址: http://localhost:${PORT}`);
        console.log("  按 Ctrl+C 停止服务器");
        console.log("=======================================");
    });
}
main();
//# sourceMappingURL=index.js.map