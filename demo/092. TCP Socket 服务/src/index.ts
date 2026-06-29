#!/usr/bin/env node

/**
 * TCP Socket 服务演示（TypeScript 高级特性增强版）
 *
 * 功能：多客户端连接、消息广播、私聊、房间系统、昵称管理、
 * 在线用户/服务器统计、心跳检测，简易文本协议（/ 开头命令）。
 *
 * 命令：/nick /msg /join /leave /room /rooms /users /echo /time /stats /help /quit
 * 用法：npm run dev，然后 telnet 127.0.0.1 3000 或 nc 127.0.0.1 3000
 */

import * as net from "net";
import * as os from "os";

// ============================================================
// 枚举 Enums（字符串枚举，非 const enum）
// ============================================================

enum Command {
  Nick = "nick",
  Msg = "msg",
  Join = "join",
  Leave = "leave",
  Room = "room",
  Rooms = "rooms",
  Users = "users",
  Echo = "echo",
  Time = "time",
  Stats = "stats",
  Help = "help",
  Quit = "quit",
}

enum ErrorCode {
  UnknownCommand = "UNKNOWN_COMMAND",
  NickTaken = "NICK_TAKEN",
  UserNotFound = "USER_NOT_FOUND",
  NotInRoom = "NOT_IN_ROOM",
  Timeout = "TIMEOUT",
  Protocol = "PROTOCOL",
  Internal = "INTERNAL",
}

enum SocketState {
  Connecting = "CONNECTING",
  Connected = "CONNECTED",
  Disconnecting = "DISCONNECTING",
  Closed = "CLOSED",
}

enum ProtocolVersion {
  V1 = "1.0",
  V2 = "2.0",
}

// ============================================================
// Symbols（唯一属性键）
// ============================================================

const sessionIdKey = Symbol("sessionId");
const createdAtKey = Symbol("createdAt");

// ============================================================
// 接口 Interfaces（optional / readonly / index signature）
// ============================================================

interface Identifiable {
  readonly id: number;
}

interface Room {
  readonly name: string;
  readonly members: Set<number>;
  readonly createdAt: number;
  readonly topic?: string;
}

interface Client extends Identifiable {
  readonly socket: net.Socket;
  nickname: string;
  room: string | null;
  lastActive: number;
  state: SocketState;
  readonly [sessionIdKey]: string;
  readonly [createdAtKey]: number;
  [extra: string]: unknown;
}

interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly protocol: ProtocolVersion;
  readonly heartbeatInterval?: number;
  readonly clientTimeout?: number;
}

interface ServerStats {
  readonly clientCount: number;
  readonly roomCount: number;
  readonly uptimeSeconds: number;
  readonly platform: string;
  readonly loadAverage: readonly number[];
}

interface HandlerContext {
  readonly server: ChatServer;
  readonly client: Client;
  readonly args: readonly string[];
}

// ============================================================
// 判别联合 Discriminated Unions（TcpRequest | TcpResponse | TcpError）
// ============================================================

interface TcpRequest {
  readonly type: "request";
  readonly command: Command;
  readonly args: readonly string[];
  readonly clientId: number;
}

interface TcpResponse {
  readonly type: "response";
  readonly message: string;
  readonly clientId?: number;
}

/** 自定义错误类层次结构：TcpError extends Error，带 code 属性 */
class TcpError extends Error {
  readonly type = "error" as const;
  readonly code: ErrorCode;
  readonly clientId?: number;

  constructor(code: ErrorCode, message: string, clientId?: number) {
    super(message);
    this.name = "TcpError";
    this.code = code;
    if (clientId !== undefined) this.clientId = clientId;
  }
}

class ProtocolError extends TcpError {
  constructor(message: string, clientId?: number) {
    super(ErrorCode.Protocol, message, clientId);
    this.name = "ProtocolError";
  }
}

class UserNotFoundError extends TcpError {
  constructor(nickname: string, clientId?: number) {
    super(ErrorCode.UserNotFound, `找不到用户「${nickname}」`, clientId);
    this.name = "UserNotFoundError";
  }
}

class TimeoutError extends TcpError {
  constructor(clientId?: number) {
    super(ErrorCode.Timeout, "连接超时，自动断开", clientId);
    this.name = "TimeoutError";
  }
}

type TcpPacket = TcpRequest | TcpResponse | TcpError;

// ============================================================
// 映射类型 / 类型守卫
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function isTcpRequest(packet: TcpPacket): packet is TcpRequest {
  return packet.type === "request";
}
function isTcpResponse(packet: TcpPacket): packet is TcpResponse {
  return packet.type === "response";
}
function isTcpError(packet: TcpPacket): packet is TcpError {
  return packet.type === "error";
}
function isCommand(value: string): value is Command {
  return (Object.values(Command) as readonly string[]).includes(value);
}

// ============================================================
// 工具与常量
// ============================================================

function now(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

const DEFAULT_ROOMS = ["大厅", "技术交流", "闲聊"] as const;

const WELCOME_LINES = [
  "========================================",
  "  欢迎来到 TCP Socket 聊天服务！",
  "  输入 /help 查看可用命令",
  "========================================",
] as const;

const HELP_LINES = [
  "可用命令:",
  "  /nick <名称>        修改昵称",
  "  /msg <昵称> <消息>  发送私聊",
  "  /join <房间名>      加入房间",
  "  /leave              离开当前房间",
  "  /room <消息>        向当前房间发送消息",
  "  /rooms              列出所有房间",
  "  /users              列出在线用户",
  "  /echo <消息>        回显消息",
  "  /time               查看服务器时间",
  "  /stats              查看服务器统计",
  "  /help               显示帮助",
  "  /quit               断开连接",
  "  其他文本             广播/房间聊天",
] as const;

const SERVER_CONFIG = {
  port: 3000,
  host: "127.0.0.1",
  protocol: ProtocolVersion.V2,
  heartbeatInterval: 30000,
  clientTimeout: 60000,
} satisfies ServerConfig;

function makeResponse(message: string, clientId?: number): TcpResponse {
  return { type: "response", message, clientId };
}

function collectStats(server: ChatServer): ServerStats {
  const stats: Mutable<ServerStats> = {
    clientCount: 0,
    roomCount: 0,
    uptimeSeconds: 0,
    platform: "",
    loadAverage: [],
  };
  stats.clientCount = server.clientCount;
  stats.roomCount = server.roomCount;
  stats.uptimeSeconds = server.uptime;
  stats.platform = os.platform();
  stats.loadAverage = os.loadavg();
  return stats;
}

// ============================================================
// ConnectionStore<T extends Identifiable> 泛型类（含生成器/迭代器）
// ============================================================

class ConnectionStore<T extends Identifiable> implements Iterable<T> {
  private readonly store = new Map<number, T>();
  private idCounter = 0;

  add(item: T): void {
    this.store.set(item.id, item);
  }
  get(id: number): T | undefined {
    return this.store.get(id);
  }
  has(id: number): boolean {
    return this.store.has(id);
  }
  delete(id: number): boolean {
    return this.store.delete(id);
  }
  get size(): number {
    return this.store.size;
  }
  nextId(): number {
    return ++this.idCounter;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items();
  }

  private *items(): Generator<T> {
    for (const value of this.store.values()) yield value;
  }

  *filter(predicate: (item: T) => boolean): Generator<T> {
    for (const item of this) if (predicate(item)) yield item;
  }

  find(predicate: (item: T) => boolean): T | undefined {
    for (const item of this) if (predicate(item)) return item;
    return undefined;
  }

  some(predicate: (item: T) => boolean): boolean {
    for (const item of this) if (predicate(item)) return true;
    return false;
  }

  map<U>(selector: (item: T) => U): U[] {
    const result: U[] = [];
    for (const item of this) result.push(selector(item));
    return result;
  }

  toArray(): T[] {
    return Array.from(this);
  }
}

// ============================================================
// 抽象处理器 AbstractHandler 与具体子类
// ============================================================

abstract class AbstractHandler {
  abstract readonly command: Command;
  abstract handle(ctx: HandlerContext): void;

  protected reply(ctx: HandlerContext, message: string): void {
    ctx.server.sendTo(ctx.client, message);
  }
  protected replyLines(ctx: HandlerContext, lines: readonly string[]): void {
    ctx.server.sendTo(ctx.client, lines);
  }
  protected ts(): string {
    return now();
  }
}

class EchoHandler extends AbstractHandler {
  readonly command = Command.Echo;
  handle(ctx: HandlerContext): void {
    const message = ctx.args.join(" ");
    if (!message) {
      this.reply(ctx, `[${this.ts()}] 系统: 用法 /echo <消息>`);
      return;
    }
    const { client, server } = ctx;
    if (client.room) {
      server.broadcastToRoom(
        client.room,
        `[${this.ts()}] [${client.room}] ${client.nickname}: ${message}`,
        client.id,
      );
      this.reply(ctx, `[${this.ts()}] [${client.room}] 我: ${message}`);
    } else {
      server.broadcast(
        `[${this.ts()}] ${client.nickname}: ${message}`,
        client.id,
      );
      this.reply(ctx, `[${this.ts()}] 我: ${message}`);
    }
  }
}

class TimeHandler extends AbstractHandler {
  readonly command = Command.Time;
  handle(ctx: HandlerContext): void {
    this.reply(
      ctx,
      `[${this.ts()}] 当前服务器时间: ${new Date().toISOString()}`,
    );
  }
}

class StatsHandler extends AbstractHandler {
  readonly command = Command.Stats;
  handle(ctx: HandlerContext): void {
    const s = collectStats(ctx.server);
    this.reply(ctx, `[${this.ts()}] 服务器统计:`);
    this.reply(ctx, `  在线用户: ${s.clientCount} 人`);
    this.reply(ctx, `  房间数量: ${s.roomCount} 个`);
    this.reply(ctx, `  运行平台: ${s.platform}`);
    this.reply(ctx, `  已运行: ${s.uptimeSeconds.toFixed(0)} 秒`);
    this.reply(ctx, `  系统负载(1/5/15min): ${s.loadAverage.join(", ")}`);
  }
}

class NickHandler extends AbstractHandler {
  readonly command = Command.Nick;
  handle(ctx: HandlerContext): void {
    const newNick = ctx.args[0];
    if (!newNick) {
      this.reply(ctx, `[${this.ts()}] 系统: 用法 /nick <新昵称>`);
      return;
    }
    const taken = ctx.server.findClient(
      (c) => c.nickname === newNick && c.id !== ctx.client.id,
    );
    if (taken) {
      this.reply(
        ctx,
        `[${this.ts()}] 系统: 昵称「${newNick}」已被使用，请换一个`,
      );
      return;
    }
    const oldNick = ctx.client.nickname;
    ctx.client.nickname = newNick;
    this.reply(ctx, `[${this.ts()}] 系统: 昵称已修改为「${newNick}」`);
    ctx.server.broadcast(
      `[${this.ts()}] 系统: 「${oldNick}」已更名为「${newNick}」`,
      ctx.client.id,
    );
  }
}

class MsgHandler extends AbstractHandler {
  readonly command = Command.Msg;
  handle(ctx: HandlerContext): void {
    if (ctx.args.length < 2) {
      this.reply(ctx, `[${this.ts()}] 系统: 用法 /msg <昵称> <消息>`);
      return;
    }
    const targetNick = ctx.args[0];
    const message = ctx.args.slice(1).join(" ");
    const target = ctx.server.findClient((c) => c.nickname === targetNick);
    if (!target) {
      this.reply(
        ctx,
        `[${this.ts()}] 系统: ${new UserNotFoundError(targetNick, ctx.client.id).message}`,
      );
      return;
    }
    ctx.server.sendTo(
      target,
      `[${this.ts()}] [私聊] ${ctx.client.nickname}: ${message}`,
    );
    this.reply(ctx, `[${this.ts()}] [私聊→${targetNick}]: ${message}`);
  }
}

class JoinHandler extends AbstractHandler {
  readonly command = Command.Join;
  handle(ctx: HandlerContext): void {
    const roomName = ctx.args[0];
    if (!roomName) {
      this.reply(ctx, `[${this.ts()}] 系统: 用法 /join <房间名>`);
      return;
    }
    ctx.server.joinRoom(ctx.client, roomName);
    this.reply(ctx, `[${this.ts()}] 系统: 你已加入房间「${roomName}」`);
    ctx.server.broadcastToRoom(
      roomName,
      `[${this.ts()}] 系统: ${ctx.client.nickname} 加入了房间`,
      ctx.client.id,
    );
  }
}

class LeaveHandler extends AbstractHandler {
  readonly command = Command.Leave;
  handle(ctx: HandlerContext): void {
    if (!ctx.client.room) {
      this.reply(ctx, `[${this.ts()}] 系统: 你当前不在任何房间中`);
      return;
    }
    const roomName = ctx.client.room;
    ctx.server.leaveCurrentRoom(ctx.client);
    this.reply(ctx, `[${this.ts()}] 系统: 你已离开房间「${roomName}」`);
  }
}

class RoomHandler extends AbstractHandler {
  readonly command = Command.Room;
  handle(ctx: HandlerContext): void {
    if (!ctx.client.room) {
      this.reply(
        ctx,
        `[${this.ts()}] 系统: 你当前不在任何房间中，请先 /join <房间名>`,
      );
      return;
    }
    const message = ctx.args.join(" ");
    if (!message) {
      this.reply(ctx, `[${this.ts()}] 系统: 用法 /room <消息>`);
      return;
    }
    const room = ctx.client.room;
    ctx.server.broadcastToRoom(
      room,
      `[${this.ts()}] [${room}] ${ctx.client.nickname}: ${message}`,
      ctx.client.id,
    );
    this.reply(ctx, `[${this.ts()}] [${room}] 我: ${message}`);
  }
}

class RoomsHandler extends AbstractHandler {
  readonly command = Command.Rooms;
  handle(ctx: HandlerContext): void {
    const info = ctx.server.getRoomsInfo();
    if (info.length === 0) {
      this.reply(ctx, `[${this.ts()}] 系统: 当前没有房间`);
      return;
    }
    this.reply(ctx, `[${this.ts()}] 系统: 房间列表:`);
    this.replyLines(ctx, info);
  }
}

class UsersHandler extends AbstractHandler {
  readonly command = Command.Users;
  handle(ctx: HandlerContext): void {
    const users = ctx.server.getOnlineUsers();
    this.reply(ctx, `[${this.ts()}] 系统: 在线用户 (${users.length} 人):`);
    for (const line of users) this.reply(ctx, `  ${line}`);
  }
}

class HelpHandler extends AbstractHandler {
  readonly command = Command.Help;
  handle(ctx: HandlerContext): void {
    this.reply(ctx, `[${this.ts()}] 系统: ${HELP_LINES[0]}`);
    for (let i = 1; i < HELP_LINES.length; i++) this.reply(ctx, HELP_LINES[i]);
  }
}

class QuitHandler extends AbstractHandler {
  readonly command = Command.Quit;
  handle(ctx: HandlerContext): void {
    this.reply(ctx, `[${this.ts()}] 系统: 再见！`);
    ctx.client.state = SocketState.Disconnecting;
    ctx.client.socket.end();
  }
}

// ============================================================
// 协议解析与分发
// ============================================================

function parsePacket(raw: string, clientId: number): TcpPacket {
  const trimmed = raw.trim();
  if (!trimmed) return new ProtocolError("空消息", clientId);
  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    if (!isCommand(cmd)) {
      return new ProtocolError(
        `未知命令 /${cmd}，输入 /help 查看帮助`,
        clientId,
      );
    }
    const request: TcpRequest = {
      type: "request",
      command: cmd,
      args,
      clientId,
    };
    return request;
  }
  const request: TcpRequest = {
    type: "request",
    command: Command.Echo,
    args: [trimmed],
    clientId,
  };
  return request;
}

function deliver(
  server: ChatServer,
  client: Client,
  packet: TcpResponse | TcpError,
): void {
  if (isTcpError(packet)) {
    server.sendTo(
      client,
      `[${now()}] 系统: [${packet.code}] ${packet.message}`,
    );
  } else if (isTcpResponse(packet)) {
    server.sendTo(client, packet.message);
  }
}

function routePacket(
  server: ChatServer,
  client: Client,
  packet: TcpPacket,
): void {
  if (isTcpError(packet)) {
    deliver(server, client, packet);
    return;
  }
  if (isTcpRequest(packet)) {
    const handler = server.getHandler(packet.command);
    if (handler) {
      handler.handle({ server, client, args: packet.args });
    } else {
      deliver(
        server,
        client,
        makeResponse(`[${now()}] 系统: 未知命令 /${packet.command}`),
      );
    }
    return;
  }
  // packet 为 TcpResponse（客户端通常不会发送）
  deliver(server, client, packet);
}

// ============================================================
// ChatServer 服务类（含 getters/setters、连接管理、广播）
// ============================================================

class ChatServer {
  private readonly clients = new ConnectionStore<Client>();
  private readonly rooms = new Map<string, Room>();
  private readonly handlers = new Map<Command, AbstractHandler>();
  private server: net.Server | null = null;
  private readonly startTime: number;
  private _port: number;
  private _host: string;
  private readonly heartbeatInterval: number;
  private readonly clientTimeout: number;

  constructor(config: ServerConfig) {
    this._port = config.port;
    this._host = config.host;
    this.startTime = Date.now();
    this.heartbeatInterval = config.heartbeatInterval ?? 30000;
    this.clientTimeout = config.clientTimeout ?? 60000;
    this.registerHandlers();
    this.initDefaultRooms();
  }

  // Getters / Setters
  get port(): number {
    return this._port;
  }
  set port(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new TcpError(ErrorCode.Internal, `无效端口: ${value}`);
    }
    this._port = value;
  }
  get host(): string {
    return this._host;
  }
  get clientCount(): number {
    return this.clients.size;
  }
  get roomCount(): number {
    return this.rooms.size;
  }
  get uptime(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  private registerHandlers(): void {
    const list: AbstractHandler[] = [
      new EchoHandler(),
      new TimeHandler(),
      new StatsHandler(),
      new NickHandler(),
      new MsgHandler(),
      new JoinHandler(),
      new LeaveHandler(),
      new RoomHandler(),
      new RoomsHandler(),
      new UsersHandler(),
      new HelpHandler(),
      new QuitHandler(),
    ];
    for (const h of list) this.handlers.set(h.command, h);
  }

  getHandler(command: Command): AbstractHandler | undefined {
    return this.handlers.get(command);
  }

  private initDefaultRooms(): void {
    for (const name of DEFAULT_ROOMS) {
      this.rooms.set(name, { name, members: new Set(), createdAt: Date.now() });
    }
  }

  // 函数重载：发送单条或多条消息
  sendTo(client: Client, message: string): void;
  sendTo(client: Client, messages: readonly string[]): void;
  sendTo(client: Client, message: string | readonly string[]): void {
    if (!client.socket.writable) return;
    if (typeof message === "string") {
      client.socket.write(message + "\r\n");
    } else {
      for (const line of message) client.socket.write(line + "\r\n");
    }
  }

  broadcast(message: string, excludeId?: number): void {
    for (const client of this.clients) {
      if (client.id !== excludeId) this.sendTo(client, message);
    }
  }

  broadcastToRoom(roomName: string, message: string, excludeId?: number): void {
    const room = this.rooms.get(roomName);
    if (!room) return;
    for (const cid of room.members) {
      if (cid !== excludeId) {
        const c = this.clients.get(cid);
        if (c) this.sendTo(c, message);
      }
    }
  }

  findClient(predicate: (c: Client) => boolean): Client | undefined {
    return this.clients.find(predicate);
  }

  getOnlineUsers(): string[] {
    return this.clients.map((c) => {
      const roomInfo = c.room ? ` [房间: ${c.room}]` : "";
      return `${c.nickname}${roomInfo}`;
    });
  }

  getRoomsInfo(): string[] {
    const info: string[] = [];
    for (const room of this.rooms.values()) {
      info.push(`  ${room.name} (${room.members.size} 人)`);
    }
    return info;
  }

  joinRoom(client: Client, roomName: string): void {
    this.leaveCurrentRoom(client);
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, {
        name: roomName,
        members: new Set(),
        createdAt: Date.now(),
      });
    }
    const room = this.rooms.get(roomName)!;
    room.members.add(client.id);
    client.room = roomName;
  }

  leaveCurrentRoom(client: Client): void {
    if (!client.room) return;
    const room = this.rooms.get(client.room);
    if (room) {
      room.members.delete(client.id);
      this.broadcastToRoom(
        room.name,
        `[${now()}] 系统: ${client.nickname} 离开了房间「${room.name}」`,
      );
      const defaultRooms = DEFAULT_ROOMS as readonly string[];
      if (room.members.size === 0 && !defaultRooms.includes(room.name)) {
        this.rooms.delete(room.name);
      }
    }
    client.room = null;
  }

  handleConnection(socket: net.Socket): void {
    const id = this.clients.nextId();
    const nickname = `Guest_${String(id).padStart(3, "0")}`;
    const client: Client = {
      id,
      socket,
      nickname,
      room: null,
      lastActive: Date.now(),
      state: SocketState.Connected,
      [sessionIdKey]: `${id}-${Date.now()}`,
      [createdAtKey]: Date.now(),
    };
    this.clients.add(client);

    this.sendTo(client, WELCOME_LINES);
    this.sendTo(client, `  你的昵称: ${nickname}`);
    this.joinRoom(client, "大厅");
    this.sendTo(client, `[${now()}] 系统: 你已自动加入房间「大厅」`);
    this.broadcast(`[${now()}] 系统: ${nickname} 加入了聊天`, id);
    console.log(
      `[${now()}] 连接: ${nickname} (${socket.remoteAddress}:${socket.remotePort})`,
    );

    let buffer = "";
    socket.on("data", (data: Buffer) => {
      client.lastActive = Date.now();
      buffer += data.toString("utf-8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const packet = parsePacket(trimmed, client.id);
        routePacket(this, client, packet);
      }
    });

    socket.on("close", () => this.disconnectClient(client));
    socket.on("error", (err: Error) => {
      console.error(`[${now()}] 客户端 ${nickname} 错误: ${err.message}`);
      this.disconnectClient(client);
    });
  }

  disconnectClient(client: Client): void {
    if (!this.clients.has(client.id)) return;
    client.state = SocketState.Disconnecting;
    this.leaveCurrentRoom(client);
    this.clients.delete(client.id);
    client.state = SocketState.Closed;
    this.broadcast(`[${now()}] 系统: ${client.nickname} 离开了聊天`);
    console.log(`[${now()}] 断开: ${client.nickname}`);
  }

  startHeartbeat(): void {
    setInterval(() => {
      const ts = Date.now();
      for (const client of this.clients) {
        if (ts - client.lastActive > this.clientTimeout) {
          const err = new TimeoutError(client.id);
          this.sendTo(client, `[${now()}] 系统: ${err.message}`);
          client.socket.destroy();
          this.disconnectClient(client);
        }
      }
    }, this.heartbeatInterval);
  }

  printStatus(): void {
    console.log(
      `[${now()}] 状态: 在线 ${this.clientCount} 人, 房间 ${this.roomCount} 个`,
    );
  }

  start(): void {
    this.server = net.createServer((s) => this.handleConnection(s));
    this.startHeartbeat();
    setInterval(() => this.printStatus(), 60000);
    this.server.listen(this._port, this._host, () => {
      console.log("========================================");
      console.log("  TCP Socket 聊天服务已启动");
      console.log(`  监听地址: ${this._host}:${this._port}`);
      console.log("  连接方式: telnet 127.0.0.1 3000");
      console.log("         或: nc 127.0.0.1 3000");
      console.log("========================================");
    });
    this.server.on("error", (err: Error) => {
      console.error(`[${now()}] 服务器错误: ${err.message}`);
      process.exit(1);
    });
    process.on("SIGINT", () => this.shutdown());
  }

  shutdown(): void {
    console.log(`\n[${now()}] 正在关闭服务器...`);
    for (const client of this.clients) {
      this.sendTo(client, `[${now()}] 系统: 服务器正在关闭，连接即将断开`);
    }
    for (const client of this.clients) client.socket.destroy();
    this.server?.close(() => {
      console.log(`[${now()}] 服务器已关闭`);
      process.exit(0);
    });
    setTimeout(() => {
      console.error(`[${now()}] 强制退出`);
      process.exit(1);
    }, 5000);
  }
}

// ============================================================
// CLI 主入口
// ============================================================

function main(): void {
  const server = new ChatServer(SERVER_CONFIG);
  server.start();
}

main();
