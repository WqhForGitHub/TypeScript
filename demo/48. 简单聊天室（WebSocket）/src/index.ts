#!/usr/bin/env node
/**
 * 48. 简单聊天室 (WebSocket)
 * ----------------------------------------------------
 * 手动实现 WebSocket 协议 (RFC 6455)：
 *   - HTTP 升级握手: Sec-WebSocket-Key + base64(sha1(key + GUID))
 *   - 帧解析: opcode (text/binary/close/ping/pong), 掩码解码, 分片 (FIN=0 时缓存)
 *   - 帧编码: 服务器到客户端不掩码
 *   - 心跳 (ping/pong)
 *   - 关闭握手
 *
 * 聊天功能:
 *   - 昵称系统
 *   - 广播消息
 *   - /msg <nick> <text>  私聊
 *   - /who                在线列表
 *   - /nick <new>         修改昵称
 *   - /quit               退出
 *
 * 不使用任何 WebSocket 库，仅用 net/http/crypto。
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import { URL } from 'url';

interface ServerOptions {
  port: number;
}

interface ParsedArgs {
  command: string;
  options: ServerOptions;
  help: boolean;
}

type Opcode = 0x0 | 0x1 | 0x2 | 0x8 | 0x9 | 0xa;

interface ParsedFrame {
  fin: boolean;
  opcode: Opcode;
  payload: Buffer;
}

interface Client {
  socket: net.Socket;
  id: string;
  nick: string;
  alive: boolean;
  // 分片缓冲
  fragBuffer: Buffer[];
  fragOpcode: Opcode | null;
  // 原始字节缓冲 (用于半帧)
  rxBuffer: Buffer[];
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

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
};

/** 客户端列表 */
const clients: Map<string, Client> = new Map();

/** 解析命令行参数 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: 'start',
    options: { port: 8080 },
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
    } else if (flag === '-h' || flag === '--help') {
      result.help = true;
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`
WebSocket 聊天室 - 使用说明

用法:
  websocket-chat-room start [-p port]

选项:
  start            启动服务器 (默认命令)
  -p, --port <n>   监听端口 (默认 8080)
  -h, --help       显示帮助

客户端:
  打开浏览器访问 http://localhost:<port>/ 即可使用网页客户端。

聊天命令:
  /msg <nick> <text>   私聊
  /who                 在线列表
  /nick <new>          修改昵称
  /quit                退出
`);
}

/** 计算 Sec-WebSocket-Accept */
function computeAcceptKey(key: string): string {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

/** 解析一个 WebSocket 帧 */
function parseFrame(buf: Buffer): { frame: ParsedFrame; bytesConsumed: number } | null {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = (b0 & 0x0f) as Opcode;
  const masked = (b1 & 0x80) !== 0;
  let payloadLen = b1 & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    const high = buf.readUInt32BE(2);
    const low = buf.readUInt32BE(6);
    if (high !== 0) return null; // 超过 4GB，拒绝
    payloadLen = low;
    offset = 10;
  }

  let mask: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + payloadLen) return null;
  let payload = buf.subarray(offset, offset + payloadLen);
  if (masked && mask) {
    const unmasked = Buffer.allocUnsafe(payloadLen);
    for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i % 4];
    payload = unmasked;
  }

  return { frame: { fin, opcode, payload }, bytesConsumed: offset + payloadLen };
}

/** 编码服务器 -> 客户端帧 (不掩码) */
function encodeFrame(opcode: Opcode, payload: Buffer | string): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, data]);
}

/** 发送文本帧 */
function sendText(client: Client, text: string): void {
  try { client.socket.write(encodeFrame(0x1, text)); }
  catch (err) { Logger.error('发送失败: ' + (err instanceof Error ? err.message : String(err))); }
}

/** 发送 close 帧 */
function sendClose(client: Client, code = 1000, reason = ''): void {
  const payload = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2, 'utf8');
  try { client.socket.write(encodeFrame(0x8, payload)); } catch { /* 忽略 */ }
}

/** 发送 ping */
function sendPing(client: Client): void {
  try { client.socket.write(encodeFrame(0x9, 'ping')); } catch { /* 忽略 */ }
}

/** 广播消息给所有客户端 (可排除某个) */
function broadcast(text: string, except?: Client): void {
  const msg = JSON.stringify({ type: 'message', data: text, time: new Date().toISOString() });
  for (const c of clients.values()) { if (c === except) continue; sendText(c, msg); }
}

/** 系统消息 */
function systemMessage(client: Client, text: string): void {
  sendText(client, JSON.stringify({ type: 'system', data: text, time: new Date().toISOString() }));
}

/** 处理收到的完整消息 (文本帧) */
function handleTextMessage(client: Client, text: string): void {
  let content = text;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && typeof obj.data === 'string') content = obj.data;
  } catch { /* 不是 JSON，按纯文本处理 */ }
  Logger.info(`<${client.nick}> ${content}`);
  if (content.startsWith('/')) { handleCommand(client, content); return; }
  broadcast(`[${client.nick}] ${content}`);
}

/** 处理命令 */
function handleCommand(client: Client, content: string): void {
  const parts = content.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case '/who': {
      const list = Array.from(clients.values()).map((c) => c.nick).join(', ');
      systemMessage(client, `在线用户 (${clients.size}): ${list}`);
      break;
    }
    case '/nick': {
      const newNick = parts[1];
      if (!newNick) { systemMessage(client, '用法: /nick <新昵称>'); break; }
      if (Array.from(clients.values()).some((c) => c.nick === newNick && c !== client)) {
        systemMessage(client, '该昵称已被使用'); break;
      }
      const old = client.nick;
      client.nick = newNick;
      broadcast(`系统: ${old} 改名为 ${newNick}`);
      break;
    }
    case '/msg': {
      const target = parts[1];
      const msg = parts.slice(2).join(' ');
      if (!target || !msg) { systemMessage(client, '用法: /msg <昵称> <内容>'); break; }
      const targetClient = Array.from(clients.values()).find((c) => c.nick === target);
      if (!targetClient) { systemMessage(client, `用户 ${target} 不在线`); break; }
      sendText(targetClient, JSON.stringify({ type: 'private', from: client.nick, data: msg, time: new Date().toISOString() }));
      systemMessage(client, `(私聊给 ${target}) ${msg}`);
      break;
    }
    case '/quit': {
      systemMessage(client, '再见！');
      sendClose(client, 1000, 'bye');
      client.socket.end();
      break;
    }
    case '/help': {
      systemMessage(client, '可用命令: /who /nick <name> /msg <nick> <text> /quit /help');
      break;
    }
    default: {
      systemMessage(client, `未知命令: ${cmd}，输入 /help 查看`);
      break;
    }
  }
}

/** 移除客户端 */
function removeClient(client: Client, reason: string): void {
  if (!client.alive) return;
  client.alive = false;
  clients.delete(client.id);
  Logger.info(`客户端断开: ${client.nick} (${client.id}) - ${reason}`);
  broadcast(`系统: ${client.nick} 离开了聊天室 (当前 ${clients.size} 人在线)`);
}

/** 处理 WebSocket 数据流 */
function handleWebSocketData(client: Client, chunk: Buffer): void {
  client.rxBuffer.push(chunk);
  let buf = Buffer.concat(client.rxBuffer);
  client.rxBuffer = [];

  while (buf.length > 0) {
    const parsed = parseFrame(buf);
    if (!parsed) { client.rxBuffer.push(buf); return; } // 数据不完整，等待更多
    const { frame, bytesConsumed } = parsed;
    buf = buf.subarray(bytesConsumed);

    switch (frame.opcode) {
      case 0x0: { // 分片续帧
        if (client.fragOpcode === null) {
          Logger.warn('收到非预期的续帧，关闭连接');
          sendClose(client, 1002, 'protocol error');
          client.socket.destroy();
          return;
        }
        client.fragBuffer.push(frame.payload);
        if (frame.fin) {
          handleTextMessage(client, Buffer.concat(client.fragBuffer).toString('utf8'));
          client.fragBuffer = [];
          client.fragOpcode = null;
        }
        break;
      }
      case 0x1: { // 文本帧
        if (frame.fin) handleTextMessage(client, frame.payload.toString('utf8'));
        else { client.fragBuffer = [frame.payload]; client.fragOpcode = 0x1; }
        break;
      }
      case 0x2: { // 二进制 (按分片处理)
        if (frame.fin) Logger.info(`收到二进制帧 (${frame.payload.length} 字节)`);
        else { client.fragBuffer = [frame.payload]; client.fragOpcode = 0x2; }
        break;
      }
      case 0x8: { // 关闭
        const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000;
        Logger.info(`客户端发起关闭: code=${code}`);
        sendClose(client, 1000, '');
        client.socket.end();
        return;
      }
      case 0x9: { // ping -> pong
        try { client.socket.write(encodeFrame(0xa, frame.payload)); } catch { /* 忽略 */ }
        break;
      }
      case 0xa: { // pong，忽略
        break;
      }
      default: {
        Logger.warn('未知 opcode: ' + frame.opcode);
        break;
      }
    }
  }
}

/** 处理升级握手 */
function handleUpgrade(socket: net.Socket, head: Buffer, headers: Record<string, string>): void {
  const key = headers['sec-websocket-key'];
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing Sec-WebSocket-Key');
    socket.destroy();
    return;
  }
  const accept = computeAcceptKey(key);

  const responseLines = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', '',
  ];
  socket.write(responseLines.join('\r\n'));

  const clientId = crypto.randomBytes(8).toString('hex');
  const client: Client = {
    socket,
    id: clientId,
    nick: '用户' + clientId.substring(0, 4),
    alive: true,
    fragBuffer: [],
    fragOpcode: null,
    rxBuffer: [],
  };
  clients.set(clientId, client);

  Logger.info(`新客户端连接: ${client.id} (昵称 ${client.nick})`);
  systemMessage(client, `欢迎来到聊天室！你的昵称是 ${client.nick}。输入 /help 查看命令。`);
  broadcast(`系统: ${client.nick} 加入了聊天室 (当前 ${clients.size} 人在线)`, client);

  // 如果 head 中有剩余数据
  if (head.length > 0) {
    handleWebSocketData(client, head);
  }

  socket.on('data', (chunk: Buffer) => {
    handleWebSocketData(client, chunk);
  });

  socket.on('error', (err) => {
    Logger.error(`socket 错误 (${client.nick}): ${err.message}`);
    removeClient(client, 'error');
  });

  socket.on('close', () => {
    removeClient(client, 'closed');
  });

  // 心跳
  const pingInterval = setInterval(() => {
    if (!client.alive) {
      clearInterval(pingInterval);
      return;
    }
    sendPing(client);
  }, 30000);
  socket.on('close', () => clearInterval(pingInterval));
}

/** 网页客户端 HTML */
function clientHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WebSocket 聊天室</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #333; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #2c3e50; margin: 0 0 16px 0; }
    .chat-box { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; }
    .messages { height: 400px; overflow-y: auto; padding: 16px; border-bottom: 1px solid #eee; }
    .msg { padding: 6px 0; word-break: break-all; }
    .msg.system { color: #888; font-style: italic; }
    .msg.private { color: #8e44ad; }
    .msg .time { color: #aaa; font-size: 11px; margin-right: 8px; }
    .input-area { display: flex; padding: 12px; }
    input[type="text"] { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
    button { background: #3498db; color: #fff; border: none; padding: 10px 20px; border-radius: 4px; margin-left: 8px; cursor: pointer; font-size: 14px; }
    button:hover { background: #2980b9; }
    .status { padding: 8px 16px; background: #ecf0f1; font-size: 12px; color: #555; }
    .status.online { background: #e8f5e9; color: #2e7d32; }
    .status.offline { background: #fdecea; color: #c62828; }
  </style>
</head>
<body>
  <div class="container">
    <h1>WebSocket 聊天室</h1>
    <div class="chat-box">
      <div class="status" id="status">连接中...</div>
      <div class="messages" id="messages"></div>
      <div class="input-area">
        <input type="text" id="input" placeholder="输入消息，回车发送 (输入 /help 查看命令)" autocomplete="off" />
        <button id="send">发送</button>
      </div>
    </div>
  </div>
  <script>
    const ws = new WebSocket('ws://' + location.host + '/ws');
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const statusEl = document.getElementById('status');
    const sendBtn = document.getElementById('send');

    ws.onopen = () => {
      statusEl.textContent = '已连接';
      statusEl.className = 'status online';
    };
    ws.onclose = () => {
      statusEl.textContent = '已断开';
      statusEl.className = 'status offline';
    };
    ws.onerror = () => {
      statusEl.textContent = '连接错误';
      statusEl.className = 'status offline';
    };
    ws.onmessage = (e) => {
      let obj;
      try { obj = JSON.parse(e.data); } catch { obj = { type: 'message', data: e.data }; }
      const div = document.createElement('div');
      div.className = 'msg ' + (obj.type || 'message');
      const time = obj.time ? new Date(obj.time).toLocaleTimeString() : '';
      let text;
      if (obj.type === 'private') {
        text = '[私聊 ' + obj.from + '] ' + obj.data;
      } else if (obj.type === 'system') {
        text = '[系统] ' + obj.data;
      } else {
        text = obj.data;
      }
      div.innerHTML = '<span class="time">' + time + '</span>' + escapeHtml(text);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      ws.send(JSON.stringify({ data: text }));
      inputEl.value = '';
    }
    sendBtn.onclick = send;
    inputEl.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  </script>
</body>
</html>`;
}

/** 启动 HTTP + WebSocket 服务器 */
function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url === '/index.html') {
      const buf = Buffer.from(clientHtml(), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
      res.end(buf);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const url = req.url ?? '';
    if (!url.startsWith('/ws') && url !== '/') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    // 直接使用 req 中的头部 (Node 已解析)
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
    }
    handleUpgrade(socket, head, headers);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') Logger.error(`端口 ${options.port} 已被占用`);
    else Logger.error(err.message);
    process.exit(1);
  });

  server.listen(options.port, () => {
    Logger.info(`WebSocket 聊天室运行于 http://localhost:${options.port}`);
    Logger.info(`WebSocket 端点: ws://localhost:${options.port}/ws`);
    Logger.info(`打开浏览器访问 http://localhost:${options.port}/ 使用网页客户端`);
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
    // 通知所有客户端
    for (const c of clients.values()) {
      sendClose(c, 1001, 'server shutdown');
      c.socket.end();
    }
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
