#!/usr/bin/env node
/**
 * WebSocket 聊天室演示（增强版）
 *
 * 功能：
 *   - 多用户实时聊天，消息广播
 *   - 昵称设置与变更
 *   - 用户加入/离开通知
 *   - 在线用户列表
 *   - 内置 HTTP 服务提供网页客户端
 *   - 房间/频道机制
 *   - 消息历史记录
 *   - 速率限制与封禁
 *
 * 使用方法：
 *   npm run dev          启动服务器
 *   浏览器打开 http://localhost:3000 即可聊天
 */

import * as http from "http";
import * as url from "url";
import { WebSocketServer, WebSocket } from "ws";

// ==================== 枚举 ====================
enum MessageType {
  Chat = "message",
  Nickname = "nickname",
  System = "system",
  UserList = "users",
  Welcome = "welcome",
  JoinRoom = "join",
  LeaveRoom = "leave",
  History = "history",
  Error = "error",
  Whisper = "whisper",
}

enum ClientState {
  Connected = "connected",
  Named = "named",
  InRoom = "in_room",
  Disconnected = "disconnected",
  Banned = "banned",
}

enum ErrorCode {
  InvalidMessage = "INVALID_MESSAGE",
  NameTaken = "NAME_TAKEN",
  NameInvalid = "NAME_INVALID",
  RoomNotFound = "ROOM_NOT_FOUND",
  RateLimited = "RATE_LIMITED",
  Banned = "BANNED",
  UnknownType = "UNKNOWN_TYPE",
  InternalError = "INTERNAL_ERROR",
  RoomFull = "ROOM_FULL",
}

enum RoomEvent {
  Created = "created",
  Removed = "removed",
  Joined = "joined",
  Left = "left",
}

// ==================== 工具类型 ====================
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type EventName = `${RoomEvent}` | `${ClientState}` | `${MessageType}`;

type RequireAtLeastOne<T, K extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, K>
> &
  { [P in K]-?: Required<Pick<T, P>> }[K];

// ==================== 消息协议 ====================
interface BaseMessage {
  readonly time: string;
}

interface ChatMessageOut extends BaseMessage {
  readonly type: MessageType.Chat;
  readonly from: string;
  readonly content: string;
  readonly room?: string;
}

interface ChatMessageIn {
  readonly type: MessageType.Chat;
  readonly content: string;
  readonly room?: string;
}

interface NicknameMessage {
  readonly type: MessageType.Nickname;
  readonly name: string;
}

interface JoinRoomMessage {
  readonly type: MessageType.JoinRoom;
  readonly room: string;
}

interface WhisperMessage {
  readonly type: MessageType.Whisper;
  readonly to: string;
  readonly content: string;
}

interface SystemMessage extends BaseMessage {
  readonly type: MessageType.System;
  readonly content: string;
}

interface UserListMessage extends BaseMessage {
  readonly type: MessageType.UserList;
  readonly users: readonly string[];
  readonly room?: string;
}

interface WelcomeMessage extends BaseMessage {
  readonly type: MessageType.Welcome;
  readonly name: string;
}

interface HistoryMessage extends BaseMessage {
  readonly type: MessageType.History;
  readonly messages: readonly ChatMessageOut[];
}

interface ErrorMessage extends BaseMessage {
  readonly type: MessageType.Error;
  readonly code: ErrorCode;
  readonly message: string;
}

type ServerMessage =
  | ChatMessageOut
  | SystemMessage
  | UserListMessage
  | WelcomeMessage
  | HistoryMessage
  | ErrorMessage;

type ClientMessage =
  ChatMessageIn | NicknameMessage | JoinRoomMessage | WhisperMessage;

// ==================== 操作结果 ====================
type OpResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

function isOk<T>(r: OpResult<T>): r is Extract<OpResult<T>, { ok: true }> {
  return r.ok;
}

function isErr<T>(r: OpResult<T>): r is Extract<OpResult<T>, { ok: false }> {
  return !r.ok;
}

// ==================== 自定义错误 ====================
class ChatError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ChatError";
    this.code = code;
  }
}

class NameError extends ChatError {
  constructor(
    code: ErrorCode.NameTaken | ErrorCode.NameInvalid,
    message: string,
  ) {
    super(code, message);
    this.name = "NameError";
  }
}

class RoomError extends ChatError {
  constructor(
    code: ErrorCode.RoomNotFound | ErrorCode.RoomFull,
    message: string,
  ) {
    super(code, message);
    this.name = "RoomError";
  }
}

class RateLimitError extends ChatError {
  constructor(message: string) {
    super(ErrorCode.RateLimited, message);
    this.name = "RateLimitError";
  }
}

// ==================== 符号 ====================
const CLIENT_ID = Symbol("clientId");
const CONNECTED_AT = Symbol("connectedAt");
const RATE_TOKENS = Symbol("rateTokens");
const LAST_REFILL = Symbol("lastRefill");
const RATE_TOKENS_BUCKET = Symbol("rateBucket");

// ==================== 客户端 ====================
interface ClientMeta {
  readonly [CLIENT_ID]: number;
  readonly [CONNECTED_AT]: number;
  [RATE_TOKENS]: number;
  [LAST_REFILL]: number;
  [RATE_TOKENS_BUCKET]: TokenBucket;
}

interface ClientInfo {
  readonly ws: WebSocket;
  name: string;
  state: ClientState;
  currentRoom: string | null;
  meta: ClientMeta;
  readonly banReason?: string;
}

// ==================== 房间 ====================
interface RoomInfo {
  readonly name: string;
  readonly createdAt: number;
  readonly clients: Set<WebSocket>;
  readonly history: ChatMessageOut[];
  readonly maxSize: number;
}

// ==================== 速率限制器 ====================
interface RateLimiterConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(private readonly config: RateLimiterConfig) {
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.config.capacity,
      this.tokens + elapsed * this.config.refillPerSecond,
    );
    this.lastRefill = now;
  }
  get available(): number {
    return Math.floor(this.tokens);
  }
}

// ==================== 抽象处理器 ====================
abstract class AbstractMessageHandler<T extends ClientMessage> {
  abstract readonly handledType: MessageType;
  abstract handle(client: ClientInfo, msg: T, ctx: ChatContext): OpResult<void>;
  protected validate(msg: unknown): msg is T {
    return (
      typeof msg === "object" &&
      msg !== null &&
      (msg as { type?: string }).type === this.handledType
    );
  }
}

class ChatHandler extends AbstractMessageHandler<ChatMessageIn> {
  readonly handledType = MessageType.Chat;
  handle(
    client: ClientInfo,
    msg: ChatMessageIn,
    ctx: ChatContext,
  ): OpResult<void> {
    if (client.state === ClientState.Banned) {
      return {
        ok: false,
        code: ErrorCode.Banned,
        message: client.banReason || "您已被封禁",
      };
    }
    if (!client.meta[RATE_TOKENS_BUCKET].tryConsume()) {
      return {
        ok: false,
        code: ErrorCode.RateLimited,
        message: "消息发送过于频繁，请稍后再试",
      };
    }
    const content = (msg.content || "").trim();
    if (!content) {
      return {
        ok: false,
        code: ErrorCode.InvalidMessage,
        message: "消息内容不能为空",
      };
    }
    if (content.length > 500) {
      return {
        ok: false,
        code: ErrorCode.InvalidMessage,
        message: "消息长度不能超过 500 字符",
      };
    }
    const outMsg: ChatMessageOut = {
      type: MessageType.Chat,
      from: client.name,
      content,
      time: ctx.now(),
      room: client.currentRoom || undefined,
    };
    ctx.broadcast(outMsg, client.currentRoom);
    ctx.recordHistory(outMsg, client.currentRoom);
    return { ok: true, value: undefined };
  }
}

class NicknameHandler extends AbstractMessageHandler<NicknameMessage> {
  readonly handledType = MessageType.Nickname;
  handle(
    client: ClientInfo,
    msg: NicknameMessage,
    ctx: ChatContext,
  ): OpResult<void> {
    const newName = (msg.name || "").trim();
    if (!newName) {
      return {
        ok: false,
        code: ErrorCode.NameInvalid,
        message: "昵称不能为空",
      };
    }
    if (newName.length > 16) {
      return {
        ok: false,
        code: ErrorCode.NameInvalid,
        message: "昵称长度不能超过 16 字符",
      };
    }
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(newName)) {
      return {
        ok: false,
        code: ErrorCode.NameInvalid,
        message: "昵称只能包含中文、字母、数字和下划线",
      };
    }
    const exists = ctx.findClientByName(newName);
    if (exists && exists !== client) {
      return {
        ok: false,
        code: ErrorCode.NameTaken,
        message: `昵称 "${newName}" 已被占用`,
      };
    }
    const oldName = client.name;
    client.name = newName;
    if (client.state === ClientState.Connected) {
      client.state = ClientState.Named;
    }
    ctx.broadcast(
      {
        type: MessageType.System,
        content: `${oldName} 已更名为 ${newName}`,
        time: ctx.now(),
      },
      client.currentRoom,
    );
    ctx.broadcastUserList();
    ctx.sendTo(client.ws, {
      type: MessageType.Welcome,
      name: newName,
      time: ctx.now(),
    });
    return { ok: true, value: undefined };
  }
}

class JoinRoomHandler extends AbstractMessageHandler<JoinRoomMessage> {
  readonly handledType = MessageType.JoinRoom;
  handle(
    client: ClientInfo,
    msg: JoinRoomMessage,
    ctx: ChatContext,
  ): OpResult<void> {
    const roomName = (msg.room || "").trim();
    if (!roomName) {
      return {
        ok: false,
        code: ErrorCode.RoomNotFound,
        message: "房间名不能为空",
      };
    }
    const room = ctx.getOrCreateRoom(roomName);
    if (room.clients.size >= room.maxSize) {
      return {
        ok: false,
        code: ErrorCode.RoomFull,
        message: `房间 "${roomName}" 已满`,
      };
    }
    if (client.currentRoom) {
      ctx.leaveRoom(client, client.currentRoom);
    }
    ctx.joinRoom(client, roomName);
    return { ok: true, value: undefined };
  }
}

class WhisperHandler extends AbstractMessageHandler<WhisperMessage> {
  readonly handledType = MessageType.Whisper;
  handle(
    client: ClientInfo,
    msg: WhisperMessage,
    ctx: ChatContext,
  ): OpResult<void> {
    const to = (msg.to || "").trim();
    const content = (msg.content || "").trim();
    if (!to || !content) {
      return {
        ok: false,
        code: ErrorCode.InvalidMessage,
        message: "私聊目标和内容不能为空",
      };
    }
    const target = ctx.findClientByName(to);
    if (!target) {
      return {
        ok: false,
        code: ErrorCode.InvalidMessage,
        message: `用户 "${to}" 不在线`,
      };
    }
    ctx.sendTo(target.ws, {
      type: MessageType.Whisper,
      from: client.name,
      content,
      time: ctx.now(),
    } as never);
    return { ok: true, value: undefined };
  }
}

// ==================== 聊天上下文 ====================
interface ChatContext {
  readonly now: () => string;
  readonly broadcast: (msg: ServerMessage, room?: string | null) => void;
  readonly broadcastUserList: () => void;
  readonly sendTo: (ws: WebSocket, msg: ServerMessage) => void;
  readonly recordHistory: (msg: ChatMessageOut, room?: string | null) => void;
  readonly findClientByName: (name: string) => ClientInfo | undefined;
  readonly getOrCreateRoom: (name: string) => RoomInfo;
  readonly joinRoom: (client: ClientInfo, room: string) => void;
  readonly leaveRoom: (client: ClientInfo, room: string) => void;
}

// ==================== 聊天室核心 ====================
const DEFAULT_ROOM = "大厅";
const MAX_HISTORY = 50;

class ChatRoom {
  private readonly clients = new Map<WebSocket, ClientInfo>();
  private readonly rooms = new Map<string, RoomInfo>();
  private nextId = 1;
  private userCounter = 0;

  constructor() {
    this.rooms.set(DEFAULT_ROOM, {
      name: DEFAULT_ROOM,
      createdAt: Date.now(),
      clients: new Set(),
      history: [],
      maxSize: 100,
    });
  }

  private now(): string {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }

  addClient(ws: WebSocket): ClientInfo {
    const id = this.nextId++;
    const name = this.generateName();
    const client: ClientInfo = {
      ws,
      name,
      state: ClientState.Connected,
      currentRoom: DEFAULT_ROOM,
      meta: {
        [CLIENT_ID]: id,
        [CONNECTED_AT]: Date.now(),
        [RATE_TOKENS]: 0,
        [LAST_REFILL]: Date.now(),
        [RATE_TOKENS_BUCKET]: new TokenBucket({
          capacity: 10,
          refillPerSecond: 2,
        }),
      },
    };
    this.clients.set(ws, client);
    const room = this.rooms.get(DEFAULT_ROOM)!;
    room.clients.add(ws);
    return client;
  }

  removeClient(ws: WebSocket): ClientInfo | undefined {
    const client = this.clients.get(ws);
    if (!client) return undefined;
    if (client.currentRoom) {
      const room = this.rooms.get(client.currentRoom);
      room?.clients.delete(ws);
    }
    client.state = ClientState.Disconnected;
    this.clients.delete(ws);
    return client;
  }

  private generateName(): string {
    this.userCounter++;
    return `用户${this.userCounter}`;
  }

  getOnlineUsers(room?: string): readonly string[] {
    const list: string[] = [];
    for (const c of this.clients.values()) {
      if (!room || c.currentRoom === room) list.push(c.name);
    }
    return list;
  }

  findClientByName(name: string): ClientInfo | undefined {
    for (const c of this.clients.values()) {
      if (c.name === name) return c;
    }
    return undefined;
  }

  *iterClients(): Generator<ClientInfo> {
    for (const c of this.clients.values()) yield c;
  }

  *iterRooms(): Generator<RoomInfo> {
    for (const r of this.rooms.values()) yield r;
  }

  broadcast(msg: ServerMessage, room?: string | null): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (room && c.currentRoom !== room) continue;
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(data);
      }
    }
  }

  broadcastUserList(): void {
    this.broadcast({
      type: MessageType.UserList,
      users: this.getOnlineUsers(),
      time: this.now(),
    });
  }

  sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  recordHistory(msg: ChatMessageOut, room?: string | null): void {
    const targetRoom = room
      ? this.rooms.get(room)
      : this.rooms.get(DEFAULT_ROOM);
    if (!targetRoom) return;
    targetRoom.history.push(msg);
    if (targetRoom.history.length > MAX_HISTORY) {
      targetRoom.history.shift();
    }
  }

  getOrCreateRoom(name: string): RoomInfo {
    let room = this.rooms.get(name);
    if (!room) {
      room = {
        name,
        createdAt: Date.now(),
        clients: new Set(),
        history: [],
        maxSize: 50,
      };
      this.rooms.set(name, room);
    }
    return room;
  }

  joinRoom(client: ClientInfo, roomName: string): void {
    const room = this.getOrCreateRoom(roomName);
    room.clients.add(client.ws);
    client.currentRoom = roomName;
    client.state = ClientState.InRoom;
    this.broadcast(
      {
        type: MessageType.System,
        content: `${client.name} 加入了房间 ${roomName}`,
        time: this.now(),
      },
      roomName,
    );
    this.broadcastUserList();
    this.sendTo(client.ws, {
      type: MessageType.History,
      messages: room.history.slice(-20),
      time: this.now(),
    });
  }

  leaveRoom(client: ClientInfo, roomName: string): void {
    const room = this.rooms.get(roomName);
    if (!room) return;
    room.clients.delete(client.ws);
    this.broadcast(
      {
        type: MessageType.System,
        content: `${client.name} 离开了房间 ${roomName}`,
        time: this.now(),
      },
      roomName,
    );
    if (room.clients.size === 0 && roomName !== DEFAULT_ROOM) {
      this.rooms.delete(roomName);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}

// ==================== 消息分发 ====================
class MessageDispatcher {
  private readonly handlers = new Map<
    MessageType,
    AbstractMessageHandler<ClientMessage>
  >();
  private readonly room: ChatRoom;

  constructor(room: ChatRoom) {
    this.room = room;
    this.register(new ChatHandler());
    this.register(new NicknameHandler());
    this.register(new JoinRoomHandler());
    this.register(new WhisperHandler());
  }

  private register<H extends AbstractMessageHandler<ClientMessage>>(
    h: H,
  ): void {
    this.handlers.set(h.handledType, h);
  }

  dispatch(client: ClientInfo, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.room.sendTo(client.ws, {
        type: MessageType.Error,
        code: ErrorCode.InvalidMessage,
        message: "消息格式错误，请发送 JSON",
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      this.room.sendTo(client.ws, {
        type: MessageType.Error,
        code: ErrorCode.InvalidMessage,
        message: "消息必须为对象",
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      return;
    }

    const msg = parsed as { type?: string };
    const typeStr = typeof msg.type === "string" ? msg.type : "";
    let msgType: MessageType;
    try {
      msgType = typeStr as MessageType;
    } catch {
      this.room.sendTo(client.ws, {
        type: MessageType.Error,
        code: ErrorCode.UnknownType,
        message: `未知消息类型: ${typeStr}`,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      return;
    }

    const handler = this.handlers.get(msgType);
    if (!handler) {
      this.room.sendTo(client.ws, {
        type: MessageType.Error,
        code: ErrorCode.UnknownType,
        message: `未知消息类型: ${typeStr}`,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      return;
    }

    const ctx: ChatContext = {
      now: () => new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      broadcast: (m, r) => this.room.broadcast(m, r),
      broadcastUserList: () => this.room.broadcastUserList(),
      sendTo: (ws, m) => this.room.sendTo(ws, m),
      recordHistory: (m, r) => this.room.recordHistory(m, r),
      findClientByName: (n) => this.room.findClientByName(n),
      getOrCreateRoom: (n) => this.room.getOrCreateRoom(n),
      joinRoom: (c, n) => this.room.joinRoom(c, n),
      leaveRoom: (c, n) => this.room.leaveRoom(c, n),
    };

    const result = handler.handle(client, parsed as ClientMessage, ctx);
    if (isErr(result)) {
      this.room.sendTo(client.ws, {
        type: MessageType.Error,
        code: result.code,
        message: result.message,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
    }
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
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
  header { background: #16213e; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #0f3460; }
  header h1 { font-size: 18px; color: #e94560; }
  #status { font-size: 13px; color: #8a8a8a; }
  #status.connected { color: #4ecca3; }
  .container { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 200px; background: #16213e; border-right: 1px solid #0f3460; display: flex; flex-direction: column; }
  .sidebar h2 { font-size: 13px; color: #8a8a8a; padding: 12px 16px 8px; text-transform: uppercase; letter-spacing: 1px; }
  #user-list { list-style: none; padding: 0 16px; overflow-y: auto; flex: 1; }
  #user-list li { padding: 6px 0; font-size: 14px; color: #4ecca3; border-bottom: 1px solid #1a1a3e; }
  #user-list li::before { content: "● "; font-size: 8px; }
  #chat-area { flex: 1; display: flex; flex-direction: column; }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 70%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; word-break: break-word; }
  .msg.user { background: #0f3460; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg.other { background: #222244; align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg.system { background: transparent; align-self: center; color: #8a8a8a; font-size: 12px; padding: 4px; }
  .msg .meta { font-size: 11px; color: #6a6a8a; margin-top: 4px; }
  .msg .name { font-weight: bold; margin-bottom: 2px; }
  .msg.user .name { color: #e94560; }
  .msg.other .name { color: #4ecca3; }
  .input-area { padding: 12px 16px; background: #16213e; border-top: 1px solid #0f3460; display: flex; gap: 8px; }
  .input-area input { flex: 1; padding: 10px 14px; border: 1px solid #0f3460; border-radius: 8px; background: #1a1a2e; color: #e0e0e0; font-size: 14px; outline: none; }
  .input-area input:focus { border-color: #e94560; }
  .input-area button { padding: 10px 20px; background: #e94560; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; }
  .input-area button:hover { background: #c73652; }
  .nick-bar { padding: 8px 16px; background: #0f3460; display: flex; gap: 8px; align-items: center; }
  .nick-bar span { font-size: 13px; color: #8a8a8a; white-space: nowrap; }
  .nick-bar input { flex: 1; padding: 6px 10px; border: 1px solid #16213e; border-radius: 6px; background: #1a1a2e; color: #e0e0e0; font-size: 13px; outline: none; }
  .nick-bar button { padding: 6px 14px; background: #4ecca3; color: #1a1a2e; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; }
</style>
</head>
<body>
<header><h1>WebSocket 聊天室</h1><span id="status">未连接</span></header>
<div class="container">
  <aside class="sidebar"><h2>在线用户</h2><ul id="user-list"></ul></aside>
  <div id="chat-area">
    <div id="messages"></div>
    <div class="nick-bar"><span>昵称:</span><input id="nick-input" placeholder="输入新昵称..." maxlength="16"><button onclick="changeNick()">修改</button></div>
    <div class="input-area"><input id="msg-input" placeholder="输入消息..." maxlength="500"><button onclick="sendMessage()">发送</button></div>
  </div>
</div>
<script>
const msgBox = document.getElementById("messages"), msgInput = document.getElementById("msg-input"), nickInput = document.getElementById("nick-input"), userList = document.getElementById("user-list"), statusEl = document.getElementById("status");
let myName = "", ws;
function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host);
  ws.onopen = () => { statusEl.textContent = "已连接"; statusEl.className = "connected"; };
  ws.onclose = () => { statusEl.textContent = "已断开，3秒后重连..."; statusEl.className = ""; setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "welcome": myName = msg.name; nickInput.value = myName; addSystem("你已加入聊天室，昵称: " + myName); break;
      case "message": addMsg(msg.from === myName ? "user" : "other", msg.from, msg.content, msg.time); break;
      case "system": addSystem(msg.content); break;
      case "error": addSystem("[错误] " + msg.message); break;
      case "users": userList.innerHTML = msg.users.map(u => "<li>" + escHtml(u) + "</li>").join(""); break;
      case "history": msg.messages.forEach(m => addMsg("other", m.from, m.content, m.time)); break;
    }
  };
}
function escHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function addMsg(cls, from, text, time) { const div = document.createElement("div"); div.className = "msg " + cls; div.innerHTML = '<div class="name">' + escHtml(from) + '</div><div>' + escHtml(text) + '</div><div class="meta">' + escHtml(time || "") + '</div>'; msgBox.appendChild(div); msgBox.scrollTop = msgBox.scrollHeight; }
function addSystem(text) { const div = document.createElement("div"); div.className = "msg system"; div.textContent = text; msgBox.appendChild(div); msgBox.scrollTop = msgBox.scrollHeight; }
function sendMessage() { const c = msgInput.value.trim(); if (!c || !ws || ws.readyState !== 1) return; ws.send(JSON.stringify({ type: "message", content: c })); msgInput.value = ""; msgInput.focus(); }
function changeNick() { const n = nickInput.value.trim(); if (!n || !ws || ws.readyState !== 1) return; ws.send(JSON.stringify({ type: "nickname", name: n })); }
msgInput.addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });
nickInput.addEventListener("keydown", e => { if (e.key === "Enter") changeNick(); });
connect();
</script>
</body>
</html>`;

// ==================== 启动服务器 ====================
const PORT = 3000;
const room = new ChatRoom();
const dispatcher = new MessageDispatcher(room);

const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url || "/", true).pathname;
  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_PAGE);
  } else if (pathname === "/api/stats") {
    const stats = {
      online: room.size,
      rooms: room.roomCount,
      timestamp: Date.now(),
    } as const;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  const client = room.addClient(ws);
  room.sendTo(ws, {
    type: MessageType.Welcome,
    name: client.name,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  });
  room.broadcast(
    {
      type: MessageType.System,
      content: `${client.name} 加入了聊天室`,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    },
    client.currentRoom,
  );
  room.broadcastUserList();
  console.log(`[+] ${client.name} 已连接 (当前在线: ${room.size} 人)`);

  ws.on("message", (raw) => {
    dispatcher.dispatch(client, raw.toString());
  });

  ws.on("close", () => {
    const c = room.removeClient(ws);
    if (c) {
      console.log(`[-] ${c.name} 已断开 (当前在线: ${room.size} 人)`);
      room.broadcast(
        {
          type: MessageType.System,
          content: `${c.name} 离开了聊天室`,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        },
        c.currentRoom,
      );
      room.broadcastUserList();
    }
  });

  ws.on("error", () => {
    /* close 事件会处理 */
  });
});

function main(): void {
  server.listen(PORT, () => {
    console.log("=======================================");
    console.log("  WebSocket 聊天室已启动");
    console.log(`  地址: http://localhost:${PORT}`);
    console.log("  按 Ctrl+C 停止服务器");
    console.log("=======================================");
  });
}

main();
