#!/usr/bin/env node
/**
 * 48. 简单聊天室 (WebSocket) — 增强版
 * 手动实现 WebSocket 协议 (RFC 6455)，聊天室含命令系统、房间、广播。
 * 仅使用 Node.js 内置模块 (http, crypto, net, url)。
 */

import * as http from "http";
import * as crypto from "crypto";
import * as net from "net";

// ============================================================
// 1. 枚举
// ============================================================

enum Opcode {
  Continuation = 0x0,
  Text = 0x1,
  Binary = 0x2,
  Close = 0x8,
  Ping = 0x9,
  Pong = 0xa,
}

enum CloseCode {
  Normal = 1000,
  GoingAway = 1001,
  ProtocolError = 1002,
  Unsupported = 1003,
  InvalidData = 1007,
  PolicyViolation = 1008,
  MessageTooBig = 1009,
  InternalError = 1011,
}

enum MessageType {
  Chat = "chat",
  System = "system",
  Private = "private",
  Join = "join",
  Leave = "leave",
  NickChange = "nickchange",
  Error = "error",
  Room = "room",
}

enum CommandType {
  Who = "/who",
  Nick = "/nick",
  Msg = "/msg",
  Quit = "/quit",
  Help = "/help",
  Room = "/room",
  ListRooms = "/rooms",
}

enum ErrorCode {
  UnknownCommand = "unknown_command",
  InvalidArgs = "invalid_args",
  NickTaken = "nick_taken",
  NoSuchUser = "no_such_user",
  NoSuchRoom = "no_such_room",
  ProtocolError = "protocol_error",
}

// ============================================================
// 2. 类型定义与工具类型
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ReadonlyTuple<T extends unknown[]> = readonly [...T];

interface ParsedFrame {
  readonly fin: boolean;
  readonly opcode: Opcode;
  readonly payload: Buffer;
}

interface ClientCore {
  readonly socket: net.Socket;
  readonly id: string;
  nick: string;
  room: string;
  alive: boolean;
  fragBuffer: Buffer[];
  fragOpcode: Opcode | null;
  rxBuffer: Buffer[];
  joinedAt: Date;
  messageCount: number;
}

type ChatMessage = {
  readonly type: MessageType.Chat;
  readonly from: string;
  readonly data: string;
  readonly room: string;
  readonly time: string;
};

type SystemMessage = {
  readonly type: MessageType.System;
  readonly data: string;
  readonly time: string;
};

type PrivateMessage = {
  readonly type: MessageType.Private;
  readonly from: string;
  readonly to: string;
  readonly data: string;
  readonly time: string;
};

type ErrorMessage = {
  readonly type: MessageType.Error;
  readonly code: ErrorCode;
  readonly data: string;
  readonly time: string;
};

type RoomMessage = {
  readonly type: MessageType.Room;
  readonly room: string;
  readonly data: string;
  readonly time: string;
};

type WireMessage =
  ChatMessage | SystemMessage | PrivateMessage | ErrorMessage | RoomMessage;

type CommandArgs = ReadonlyTuple<string[]>;

interface ServerOptions {
  readonly port: number;
}

interface ParsedArgs {
  readonly command: string;
  readonly options: ServerOptions;
  readonly help: boolean;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

abstract class ChatError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly closeCode: CloseCode;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class ProtocolErrorX extends ChatError {
  readonly code = ErrorCode.ProtocolError;
  readonly closeCode = CloseCode.ProtocolError;
}

// ============================================================
// 4. 常量与 as const
// ============================================================

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const COMMAND_MAP = {
  [CommandType.Who]: CommandType.Who,
  [CommandType.Nick]: CommandType.Nick,
  [CommandType.Msg]: CommandType.Msg,
  [CommandType.Quit]: CommandType.Quit,
  [CommandType.Help]: CommandType.Help,
  [CommandType.Room]: CommandType.Room,
  [CommandType.ListRooms]: CommandType.ListRooms,
} as const;

const DEFAULT_ROOM = "大厅";

// ============================================================
// 5. Logger (satisfies)
// ============================================================

interface LoggerShape {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const Logger: LoggerShape = {
  info: (m) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  warn: (m) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  error: (m) => console.log(`\x1b[31m[ERROR]\x1b[0m ${m}`),
};

// ============================================================
// 6. Symbol 与 客户端管理
// ============================================================

const SYM_META = Symbol("clientMeta");

interface ClientMeta {
  readonly ip: string;
  bytesReceived: number;
  bytesSent: number;
}

type Client = ClientCore & { [SYM_META]: ClientMeta };

class ClientRegistry {
  private readonly clients = new Map<string, Client>();

  get(id: string): Client | undefined {
    return this.clients.get(id);
  }
  get size(): number {
    return this.clients.size;
  }

  add(c: Client): void {
    this.clients.set(c.id, c);
  }
  remove(id: string): void {
    this.clients.delete(id);
  }

  *byRoom(room: string): Generator<Client> {
    for (const c of this.clients.values()) if (c.room === room) yield c;
  }

  *all(): Generator<Client> {
    for (const c of this.clients.values()) yield c;
  }

  *rooms(): Generator<string> {
    const seen = new Set<string>();
    for (const c of this.clients.values()) {
      if (!seen.has(c.room)) {
        seen.add(c.room);
        yield c.room;
      }
    }
  }

  findByNick(nick: string): Client | undefined {
    for (const c of this.clients.values()) if (c.nick === nick) return c;
    return undefined;
  }

  [Symbol.iterator](): Iterator<Client> {
    return this.all();
  }
}

const registry = new ClientRegistry();

// ============================================================
// 7. WebSocket 帧编解码
// ============================================================

function computeAcceptKey(key: string): string {
  return crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

function parseFrame(
  buf: Buffer,
): { frame: ParsedFrame; bytesConsumed: number } | null {
  if (buf.length < 2) return null;
  const b0 = buf[0]!;
  const b1 = buf[1]!;
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
    if (high !== 0) return null;
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
    for (let i = 0; i < payloadLen; i++)
      unmasked[i] = payload[i]! ^ mask[i % 4]!;
    payload = unmasked;
  }
  return {
    frame: { fin, opcode, payload },
    bytesConsumed: offset + payloadLen,
  };
}

function encodeFrame(opcode: Opcode, payload: Buffer | string): Buffer {
  const data =
    typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
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

// ============================================================
// 8. 消息发送
// ============================================================

function sendRaw(client: Client, msg: WireMessage): void {
  const json = JSON.stringify(msg);
  try {
    const buf = encodeFrame(Opcode.Text, json);
    client.socket.write(buf);
    client[SYM_META].bytesSent += buf.length;
  } catch (err) {
    Logger.error(
      "发送失败: " + (err instanceof Error ? err.message : String(err)),
    );
  }
}

function sendText(client: Client, text: string): void {
  sendRaw(client, {
    type: MessageType.System,
    data: text,
    time: new Date().toISOString(),
  });
}

function sendError(client: Client, code: ErrorCode, data: string): void {
  sendRaw(client, {
    type: MessageType.Error,
    code,
    data,
    time: new Date().toISOString(),
  });
}

function sendClose(
  client: Client,
  code: CloseCode = CloseCode.Normal,
  reason = "",
): void {
  const payload = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2, "utf8");
  try {
    client.socket.write(encodeFrame(Opcode.Close, payload));
  } catch {
    /* ignore */
  }
}

function sendPing(client: Client): void {
  try {
    client.socket.write(encodeFrame(Opcode.Ping, "ping"));
  } catch {
    /* ignore */
  }
}

function broadcastRoom(room: string, msg: WireMessage, except?: Client): void {
  for (const c of registry.byRoom(room)) {
    if (c === except) continue;
    sendRaw(c, msg);
  }
}

// ============================================================
// 9. 命令系统 (抽象类 + 子类)
// ============================================================

abstract class AbstractCommand {
  abstract readonly name: CommandType;
  abstract readonly usage: string;
  abstract execute(client: Client, args: CommandArgs): void;
  protected validate(args: CommandArgs): boolean {
    return args.length >= 0;
  }
}

class WhoCommand extends AbstractCommand {
  readonly name = CommandType.Who;
  readonly usage = "/who — 列出当前房间在线用户";
  execute(client: Client, _args: CommandArgs): void {
    const list = Array.from(registry.byRoom(client.room))
      .map((c) => c.nick)
      .join(", ");
    sendText(client, `[${client.room}] 在线 (${registry.size}): ${list}`);
  }
}

class NickCommand extends AbstractCommand {
  readonly name = CommandType.Nick;
  readonly usage = "/nick <新昵称> — 修改昵称";
  execute(client: Client, args: CommandArgs): void {
    const newNick = args[0];
    if (!newNick) {
      sendError(client, ErrorCode.InvalidArgs, this.usage);
      return;
    }
    const existing = registry.findByNick(newNick);
    if (existing && existing !== client) {
      sendError(client, ErrorCode.NickTaken, "该昵称已被使用");
      return;
    }
    const old = client.nick;
    client.nick = newNick;
    broadcastRoom(client.room, {
      type: MessageType.System,
      data: `${old} 改名为 ${newNick}`,
      time: new Date().toISOString(),
    });
  }
}

class MsgCommand extends AbstractCommand {
  readonly name = CommandType.Msg;
  readonly usage = "/msg <昵称> <内容> — 私聊";
  execute(client: Client, args: CommandArgs): void {
    const target = args[0];
    const msg = args.slice(1).join(" ");
    if (!target || !msg) {
      sendError(client, ErrorCode.InvalidArgs, this.usage);
      return;
    }
    const targetClient = registry.findByNick(target);
    if (!targetClient) {
      sendError(client, ErrorCode.NoSuchUser, `用户 ${target} 不在线`);
      return;
    }
    sendRaw(targetClient, {
      type: MessageType.Private,
      from: client.nick,
      to: targetNickLabel(targetClient),
      data: msg,
      time: new Date().toISOString(),
    });
    sendRaw(client, {
      type: MessageType.Private,
      from: client.nick,
      to: target,
      data: msg,
      time: new Date().toISOString(),
    });
  }
}

function targetNickLabel(c: Client): string {
  return c.nick;
}

class RoomCommand extends AbstractCommand {
  readonly name = CommandType.Room;
  readonly usage = "/room <房间名> — 切换房间";
  execute(client: Client, args: CommandArgs): void {
    const newRoom = args[0];
    if (!newRoom) {
      sendError(client, ErrorCode.InvalidArgs, this.usage);
      return;
    }
    const oldRoom = client.room;
    if (oldRoom === newRoom) {
      sendText(client, `你已经在房间 ${newRoom}`);
      return;
    }
    broadcastRoom(
      oldRoom,
      {
        type: MessageType.System,
        data: `${client.nick} 离开了房间 ${oldRoom}`,
        time: new Date().toISOString(),
      },
      client,
    );
    client.room = newRoom;
    sendText(client, `已切换到房间 ${newRoom}`);
    broadcastRoom(
      newRoom,
      {
        type: MessageType.System,
        data: `${client.nick} 加入了房间 ${newRoom}`,
        time: new Date().toISOString(),
      },
      client,
    );
  }
}

class ListRoomsCommand extends AbstractCommand {
  readonly name = CommandType.ListRooms;
  readonly usage = "/rooms — 列出所有房间";
  execute(client: Client, _args: CommandArgs): void {
    const rooms = Array.from(registry.rooms());
    const lines = rooms.map((r) => {
      const count = Array.from(registry.byRoom(r)).length;
      return `  ${r} (${count} 人)`;
    });
    sendText(client, `房间列表:\n${lines.join("\n")}`);
  }
}

class QuitCommand extends AbstractCommand {
  readonly name = CommandType.Quit;
  readonly usage = "/quit — 退出聊天室";
  execute(client: Client, _args: CommandArgs): void {
    sendText(client, "再见！");
    sendClose(client, CloseCode.Normal, "bye");
    client.socket.end();
  }
}

class HelpCommand extends AbstractCommand {
  readonly name = CommandType.Help;
  readonly usage = "/help — 显示帮助";
  execute(client: Client, _args: CommandArgs): void {
    const cmds = Array.from(commandRegistry.all());
    const lines = cmds.map((c) => `  ${c.usage}`);
    sendText(client, `可用命令:\n${lines.join("\n")}`);
  }
}

class CommandRegistry {
  private readonly map = new Map<CommandType, AbstractCommand>();
  register(cmd: AbstractCommand): void {
    this.map.set(cmd.name, cmd);
  }
  get(name: string): AbstractCommand | undefined {
    return this.map.get(name as CommandType);
  }
  *all(): Generator<AbstractCommand> {
    for (const c of this.map.values()) yield c;
  }
  [Symbol.iterator](): Iterator<AbstractCommand> {
    return this.all();
  }
}

const commandRegistry = new CommandRegistry();
commandRegistry.register(new WhoCommand());
commandRegistry.register(new NickCommand());
commandRegistry.register(new MsgCommand());
commandRegistry.register(new RoomCommand());
commandRegistry.register(new ListRoomsCommand());
commandRegistry.register(new QuitCommand());
commandRegistry.register(new HelpCommand());

// ============================================================
// 10. 消息处理
// ============================================================

function isCommand(text: string): text is CommandType {
  return text.startsWith("/");
}

function handleTextMessage(client: Client, text: string): void {
  client.messageCount++;
  let content = text;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && typeof obj.data === "string")
      content = obj.data;
  } catch {
    /* 纯文本 */
  }

  Logger.info(`<${client.nick}@${client.room}> ${content}`);

  if (isCommand(content)) {
    const parts = content.split(/\s+/);
    const cmdName = parts[0]!.toLowerCase();
    const cmd = commandRegistry.get(cmdName);
    if (cmd) {
      cmd.execute(client, parts.slice(1));
    } else {
      sendError(
        client,
        ErrorCode.UnknownCommand,
        `未知命令: ${cmdName}，输入 /help 查看`,
      );
    }
    return;
  }

  broadcastRoom(client.room, {
    type: MessageType.Chat,
    from: client.nick,
    data: content,
    room: client.room,
    time: new Date().toISOString(),
  });
}

function handleWebSocketData(client: Client, chunk: Buffer): void {
  client[SYM_META].bytesReceived += chunk.length;
  client.rxBuffer.push(chunk);
  let buf = Buffer.concat(client.rxBuffer);
  client.rxBuffer = [];

  while (buf.length > 0) {
    const parsed = parseFrame(buf);
    if (!parsed) {
      client.rxBuffer.push(buf);
      return;
    }
    const { frame, bytesConsumed } = parsed;
    buf = buf.subarray(bytesConsumed);

    switch (frame.opcode) {
      case Opcode.Continuation: {
        if (client.fragOpcode === null) {
          sendClose(client, CloseCode.ProtocolError, "unexpected continuation");
          client.socket.destroy();
          return;
        }
        client.fragBuffer.push(frame.payload);
        if (frame.fin) {
          handleTextMessage(
            client,
            Buffer.concat(client.fragBuffer).toString("utf8"),
          );
          client.fragBuffer = [];
          client.fragOpcode = null;
        }
        break;
      }
      case Opcode.Text: {
        if (frame.fin)
          handleTextMessage(client, frame.payload.toString("utf8"));
        else {
          client.fragBuffer = [frame.payload];
          client.fragOpcode = Opcode.Text;
        }
        break;
      }
      case Opcode.Binary: {
        if (frame.fin)
          Logger.info(`收到二进制帧 (${frame.payload.length} 字节)`);
        else {
          client.fragBuffer = [frame.payload];
          client.fragOpcode = Opcode.Binary;
        }
        break;
      }
      case Opcode.Close: {
        const code =
          frame.payload.length >= 2
            ? frame.payload.readUInt16BE(0)
            : CloseCode.Normal;
        Logger.info(`客户端关闭: code=${code}`);
        sendClose(client, CloseCode.Normal, "");
        client.socket.end();
        return;
      }
      case Opcode.Ping: {
        try {
          client.socket.write(encodeFrame(Opcode.Pong, frame.payload));
        } catch {
          /* ignore */
        }
        break;
      }
      case Opcode.Pong:
        break;
      default:
        Logger.warn("未知 opcode: " + frame.opcode);
        break;
    }
  }
}

// ============================================================
// 11. 升级握手
// ============================================================

function handleUpgrade(
  socket: net.Socket,
  head: Buffer,
  headers: Record<string, string>,
): void {
  const key = headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\nMissing Sec-WebSocket-Key");
    socket.destroy();
    return;
  }
  const accept = computeAcceptKey(key);
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const clientId = crypto.randomBytes(8).toString("hex");
  const ip = socket.remoteAddress ?? "unknown";
  const client: Client = {
    socket,
    id: clientId,
    nick: "用户" + clientId.substring(0, 4),
    room: DEFAULT_ROOM,
    alive: true,
    fragBuffer: [],
    fragOpcode: null,
    rxBuffer: [],
    joinedAt: new Date(),
    messageCount: 0,
    [SYM_META]: { ip, bytesReceived: 0, bytesSent: 0 },
  };
  registry.add(client);

  Logger.info(`新连接: ${client.id} (ip=${ip})`);
  sendText(
    client,
    `欢迎！昵称: ${client.nick}，房间: ${client.room}。输入 /help 查看命令。`,
  );
  broadcastRoom(
    client.room,
    {
      type: MessageType.System,
      data: `${client.nick} 加入了房间 ${client.room}`,
      time: new Date().toISOString(),
    },
    client,
  );

  if (head.length > 0) handleWebSocketData(client, head);

  socket.on("data", (chunk: Buffer) => handleWebSocketData(client, chunk));
  socket.on("error", (err) => {
    Logger.error(`socket 错误 (${client.nick}): ${err.message}`);
    removeClient(client, "error");
  });
  socket.on("close", () => removeClient(client, "closed"));

  const pingInterval = setInterval(() => {
    if (!client.alive) {
      clearInterval(pingInterval);
      return;
    }
    sendPing(client);
  }, 30000);
  socket.on("close", () => clearInterval(pingInterval));
}

function removeClient(client: Client, reason: string): void {
  if (!client.alive) return;
  client.alive = false;
  registry.remove(client.id);
  Logger.info(
    `断开: ${client.nick} (${client.id}) - ${reason} | 消息数=${client.messageCount}`,
  );
  broadcastRoom(client.room, {
    type: MessageType.System,
    data: `${client.nick} 离开了房间 ${client.room}`,
    time: new Date().toISOString(),
  });
}

// ============================================================
// 12. CLI 解析 (函数重载)
// ============================================================

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "start",
    options: { port: 8080 },
    help: false,
  };
  if (args.length === 0) return result;
  if (args[0] === "-h" || args[0] === "--help") {
    return { ...result, help: true };
  }
  let port = 8080;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "start") continue;
    if (flag === "-p" || flag === "--port") {
      const p = parseInt(value ?? "", 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) {
        port = p;
        i++;
      }
    } else if (flag === "-h" || flag === "--help") {
      return { ...result, help: true };
    }
  }
  return { command: "start", options: { port }, help: false };
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

聊天命令:
  /who              列出当前房间在线用户
  /nick <新昵称>     修改昵称
  /msg <昵称> <内容>  私聊
  /room <房间名>     切换房间
  /rooms            列出所有房间
  /quit             退出
  /help             显示帮助
`);
}

// ============================================================
// 13. 网页客户端
// ============================================================

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
.msg.error { color: #e74c3c; }
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
ws.onopen = () => { statusEl.textContent = '已连接'; statusEl.className = 'status online'; };
ws.onclose = () => { statusEl.textContent = '已断开'; statusEl.className = 'status offline'; };
ws.onerror = () => { statusEl.textContent = '连接错误'; statusEl.className = 'status offline'; };
ws.onmessage = (e) => {
  let obj; try { obj = JSON.parse(e.data); } catch { obj = { type: 'chat', data: e.data }; }
  const div = document.createElement('div');
  div.className = 'msg ' + (obj.type || 'chat');
  const time = obj.time ? new Date(obj.time).toLocaleTimeString() : '';
  let text;
  if (obj.type === 'private') text = '[私聊 ' + obj.from + '] ' + obj.data;
  else if (obj.type === 'system') text = '[系统] ' + obj.data;
  else if (obj.type === 'error') text = '[错误] ' + obj.data;
  else if (obj.type === 'nickchange') text = '[系统] ' + obj.data;
  else text = obj.from ? '[' + obj.from + '] ' + obj.data : obj.data;
  div.innerHTML = '<span class="time">' + time + '</span>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
};
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

// ============================================================
// 14. 服务器
// ============================================================

function startServer(options: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      const buf = Buffer.from(clientHtml(), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": buf.length,
      });
      res.end(buf);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.on(
    "upgrade",
    (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      const url = req.url ?? "";
      if (!url.startsWith("/ws") && url !== "/") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
      }
      handleUpgrade(socket, head, headers);
    },
  );

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE")
      Logger.error(`端口 ${options.port} 已被占用`);
    else Logger.error(err.message);
    process.exit(1);
  });

  server.listen(options.port, () => {
    Logger.info(`WebSocket 聊天室: http://localhost:${options.port}`);
    Logger.info(`WebSocket 端点: ws://localhost:${options.port}/ws`);
  });
  return server;
}

// ============================================================
// 15. 主函数
// ============================================================

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
    for (const c of registry.all()) {
      sendClose(c, CloseCode.GoingAway, "server shutdown");
      c.socket.end();
    }
    server.close(() => {
      Logger.info("已退出");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
