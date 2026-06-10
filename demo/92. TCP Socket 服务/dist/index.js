#!/usr/bin/env node
"use strict";
/**
 * TCP Socket 服务演示
 *
 * 功能：
 * - 多客户端同时连接与通信
 * - 消息广播（公共聊天）
 * - 私聊消息
 * - 房间/频道系统（加入、离开、房间内广播）
 * - 用户昵称设置
 * - 在线用户列表查询
 * - 心跳检测（保活与超时断开）
 * - 简易文本协议（命令以 / 开头）
 *
 * 协议说明：
 * - 连接后系统自动分配昵称（如 Guest_001）
 * - /nick <名称>       - 修改昵称
 * - /msg <昵称> <消息>  - 发送私聊
 * - /join <房间名>      - 加入房间
 * - /leave <房间名>     - 离开房间
 * - /room <消息>        - 向当前所在房间发送消息
 * - /rooms              - 列出所有房间
 * - /users              - 列出在线用户
 * - /help               - 显示帮助
 * - /quit               - 断开连接
 * - 其他文本             - 广播给所有人
 *
 * 用法：
 *   1. 启动服务端：npm run dev
 *   2. 使用 telnet 连接：telnet 127.0.0.1 3000
 *   3. 或使用 nc 连接：nc 127.0.0.1 3000
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
const net = __importStar(require("net"));
// ============================================================
// 常量与全局状态
// ============================================================
const PORT = 3000;
const HOST = "127.0.0.1";
const HEARTBEAT_INTERVAL = 30000; // 心跳检测间隔 30 秒
const CLIENT_TIMEOUT = 60000; // 客户端超时时间 60 秒
let clientIdCounter = 0;
const clients = new Map();
const rooms = new Map();
// 默认房间
const DEFAULT_ROOMS = ["大厅", "技术交流", "闲聊"];
// ============================================================
// 工具函数
// ============================================================
/** 获取当前时间字符串 */
function now() {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}
/** 生成自动昵称 */
function generateNickname() {
    clientIdCounter++;
    return `Guest_${String(clientIdCounter).padStart(3, "0")}`;
}
/** 向单个客户端发送消息 */
function sendTo(client, message) {
    if (client.socket.writable) {
        client.socket.write(message + "\r\n");
    }
}
/** 向所有客户端广播消息 */
function broadcast(message, excludeId) {
    for (const client of clients.values()) {
        if (client.id !== excludeId) {
            sendTo(client, message);
        }
    }
}
/** 向房间内所有成员广播消息 */
function broadcastToRoom(roomName, message, excludeId) {
    const room = rooms.get(roomName);
    if (!room)
        return;
    for (const cid of room.members) {
        if (cid !== excludeId) {
            const client = clients.get(cid);
            if (client) {
                sendTo(client, message);
            }
        }
    }
}
/** 获取在线用户列表 */
function getOnlineUsers() {
    return Array.from(clients.values()).map((c) => c.nickname);
}
/** 获取房间列表信息 */
function getRoomsInfo() {
    const info = [];
    for (const room of rooms.values()) {
        info.push(`  ${room.name} (${room.members.size} 人)`);
    }
    return info;
}
/** 将客户端从其当前房间移除 */
function leaveCurrentRoom(client) {
    if (!client.room)
        return;
    const room = rooms.get(client.room);
    if (room) {
        room.members.delete(client.id);
        broadcastToRoom(room.name, `[${now()}] 系统: ${client.nickname} 离开了房间「${room.name}」`);
        // 房间为空且不是默认房间则删除
        if (room.members.size === 0 && !DEFAULT_ROOMS.includes(room.name)) {
            rooms.delete(room.name);
        }
    }
    client.room = null;
}
// ============================================================
// 命令处理
// ============================================================
/** 处理 /nick 命令 */
function handleNick(client, args) {
    const newNick = args[0];
    if (!newNick) {
        sendTo(client, `[${now()}] 系统: 用法 /nick <新昵称>`);
        return;
    }
    // 检查昵称是否已被使用
    const exists = Array.from(clients.values()).some((c) => c.nickname === newNick && c.id !== client.id);
    if (exists) {
        sendTo(client, `[${now()}] 系统: 昵称「${newNick}」已被使用，请换一个`);
        return;
    }
    const oldNick = client.nickname;
    client.nickname = newNick;
    sendTo(client, `[${now()}] 系统: 昵称已修改为「${newNick}」`);
    broadcast(`[${now()}] 系统: 「${oldNick}」已更名为「${newNick}」`, client.id);
}
/** 处理 /msg 命令（私聊） */
function handleMsg(client, args) {
    if (args.length < 2) {
        sendTo(client, `[${now()}] 系统: 用法 /msg <昵称> <消息>`);
        return;
    }
    const targetNick = args[0];
    const message = args.slice(1).join(" ");
    const target = Array.from(clients.values()).find((c) => c.nickname === targetNick);
    if (!target) {
        sendTo(client, `[${now()}] 系统: 找不到用户「${targetNick}」`);
        return;
    }
    sendTo(target, `[${now()}] [私聊] ${client.nickname}: ${message}`);
    sendTo(client, `[${now()}] [私聊→${targetNick}]: ${message}`);
}
/** 处理 /join 命令（加入房间） */
function handleJoin(client, args) {
    const roomName = args[0];
    if (!roomName) {
        sendTo(client, `[${now()}] 系统: 用法 /join <房间名>`);
        return;
    }
    // 离开当前房间
    leaveCurrentRoom(client);
    // 创建房间（如果不存在）
    if (!rooms.has(roomName)) {
        rooms.set(roomName, { name: roomName, members: new Set() });
    }
    const room = rooms.get(roomName);
    room.members.add(client.id);
    client.room = roomName;
    sendTo(client, `[${now()}] 系统: 你已加入房间「${roomName}」`);
    broadcastToRoom(roomName, `[${now()}] 系统: ${client.nickname} 加入了房间`, client.id);
}
/** 处理 /leave 命令（离开房间） */
function handleLeave(client, args) {
    if (!client.room) {
        sendTo(client, `[${now()}] 系统: 你当前不在任何房间中`);
        return;
    }
    const roomName = client.room;
    leaveCurrentRoom(client);
    sendTo(client, `[${now()}] 系统: 你已离开房间「${roomName}」`);
}
/** 处理 /room 命令（房间内聊天） */
function handleRoomMsg(client, args) {
    if (!client.room) {
        sendTo(client, `[${now()}] 系统: 你当前不在任何房间中，请先 /join <房间名>`);
        return;
    }
    const message = args.join(" ");
    if (!message) {
        sendTo(client, `[${now()}] 系统: 用法 /room <消息>`);
        return;
    }
    broadcastToRoom(client.room, `[${now()}] [${client.room}] ${client.nickname}: ${message}`, client.id);
    sendTo(client, `[${now()}] [${client.room}] 我: ${message}`);
}
/** 处理 /rooms 命令 */
function handleRooms(client) {
    if (rooms.size === 0) {
        sendTo(client, `[${now()}] 系统: 当前没有房间`);
        return;
    }
    sendTo(client, `[${now()}] 系统: 房间列表:`);
    for (const line of getRoomsInfo()) {
        sendTo(client, line);
    }
}
/** 处理 /users 命令 */
function handleUsers(client) {
    const users = getOnlineUsers();
    sendTo(client, `[${now()}] 系统: 在线用户 (${users.length} 人):`);
    for (const name of users) {
        const c = Array.from(clients.values()).find((u) => u.nickname === name);
        const roomInfo = c.room ? ` [房间: ${c.room}]` : "";
        sendTo(client, `  ${name}${roomInfo}`);
    }
}
/** 处理 /help 命令 */
function handleHelp(client) {
    const helpText = [
        `[${now()}] 系统: 可用命令:`,
        "  /nick <名称>        - 修改昵称",
        "  /msg <昵称> <消息>   - 发送私聊",
        "  /join <房间名>       - 加入房间",
        "  /leave              - 离开当前房间",
        "  /room <消息>         - 向当前房间发送消息",
        "  /rooms              - 列出所有房间",
        "  /users              - 列出在线用户",
        "  /help               - 显示帮助",
        "  /quit               - 断开连接",
        "  其他文本             - 广播给所有人",
    ];
    for (const line of helpText) {
        sendTo(client, line);
    }
}
// ============================================================
// 客户端连接处理
// ============================================================
function handleConnection(socket) {
    const id = clientIdCounter + 1;
    const nickname = generateNickname();
    const client = {
        id,
        socket,
        nickname,
        room: null,
        lastActive: Date.now(),
    };
    clients.set(id, client);
    // 发送欢迎信息
    sendTo(client, "========================================");
    sendTo(client, "  欢迎来到 TCP Socket 聊天服务！");
    sendTo(client, `  你的昵称: ${nickname}`);
    sendTo(client, "  输入 /help 查看可用命令");
    sendTo(client, "========================================");
    // 自动加入大厅
    if (!rooms.has("大厅")) {
        rooms.set("大厅", { name: "大厅", members: new Set() });
    }
    const lobby = rooms.get("大厅");
    lobby.members.add(id);
    client.room = "大厅";
    sendTo(client, `[${now()}] 系统: 你已自动加入房间「大厅」`);
    // 通知其他用户
    broadcast(`[${now()}] 系统: ${nickname} 加入了聊天`, id);
    console.log(`[${now()}] 连接: ${nickname} (${socket.remoteAddress}:${socket.remotePort})`);
    // 接收数据
    let buffer = "";
    socket.on("data", (data) => {
        client.lastActive = Date.now();
        buffer += data.toString("utf-8");
        // 按行分割处理（支持 telnet/nc 的换行方式）
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || ""; // 保留不完整的行
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            handleMessage(client, trimmed);
        }
    });
    // 连接关闭
    socket.on("close", () => {
        disconnectClient(client);
    });
    // 连接错误
    socket.on("error", (err) => {
        console.error(`[${now()}] 客户端 ${nickname} 错误: ${err.message}`);
        disconnectClient(client);
    });
}
/** 处理客户端消息 */
function handleMessage(client, message) {
    // 命令处理
    if (message.startsWith("/")) {
        const parts = message.slice(1).split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        switch (command) {
            case "nick":
                handleNick(client, args);
                break;
            case "msg":
                handleMsg(client, args);
                break;
            case "join":
                handleJoin(client, args);
                break;
            case "leave":
                handleLeave(client, args);
                break;
            case "room":
                handleRoomMsg(client, args);
                break;
            case "rooms":
                handleRooms(client);
                break;
            case "users":
                handleUsers(client);
                break;
            case "help":
                handleHelp(client);
                break;
            case "quit":
                sendTo(client, `[${now()}] 系统: 再见！`);
                client.socket.end();
                break;
            default:
                sendTo(client, `[${now()}] 系统: 未知命令 /${command}，输入 /help 查看帮助`);
        }
        return;
    }
    // 普通消息：如果在房间中，发到房间；否则广播
    if (client.room) {
        broadcastToRoom(client.room, `[${now()}] [${client.room}] ${client.nickname}: ${message}`, client.id);
        sendTo(client, `[${now()}] [${client.room}] 我: ${message}`);
    }
    else {
        broadcast(`[${now()}] ${client.nickname}: ${message}`, client.id);
        sendTo(client, `[${now()}] 我: ${message}`);
    }
}
/** 断开客户端连接 */
function disconnectClient(client) {
    if (!clients.has(client.id))
        return;
    leaveCurrentRoom(client);
    clients.delete(client.id);
    broadcast(`[${now()}] 系统: ${client.nickname} 离开了聊天`);
    console.log(`[${now()}] 断开: ${client.nickname}`);
}
// ============================================================
// 心跳检测
// ============================================================
function startHeartbeat() {
    setInterval(() => {
        const nowTs = Date.now();
        for (const client of clients.values()) {
            if (nowTs - client.lastActive > CLIENT_TIMEOUT) {
                sendTo(client, `[${now()}] 系统: 连接超时，自动断开`);
                client.socket.destroy();
                disconnectClient(client);
            }
        }
    }, HEARTBEAT_INTERVAL);
}
// ============================================================
// 服务器状态监控
// ============================================================
function printStatus() {
    console.log(`[${now()}] 状态: 在线 ${clients.size} 人, 房间 ${rooms.size} 个`);
}
// ============================================================
// 主函数
// ============================================================
function main() {
    // 初始化默认房间
    for (const name of DEFAULT_ROOMS) {
        rooms.set(name, { name, members: new Set() });
    }
    // 创建 TCP 服务器
    const server = net.createServer(handleConnection);
    // 启动心跳检测
    startHeartbeat();
    // 定时打印状态
    setInterval(printStatus, 60000);
    // 启动服务器
    server.listen(PORT, HOST, () => {
        console.log("========================================");
        console.log("  TCP Socket 聊天服务已启动");
        console.log(`  监听地址: ${HOST}:${PORT}`);
        console.log("  连接方式: telnet 127.0.0.1 3000");
        console.log("         或: nc 127.0.0.1 3000");
        console.log("========================================");
    });
    // 服务器错误处理
    server.on("error", (err) => {
        console.error(`[${now()}] 服务器错误: ${err.message}`);
        process.exit(1);
    });
    // 优雅关闭
    process.on("SIGINT", () => {
        console.log(`\n[${now()}] 正在关闭服务器...`);
        // 通知所有客户端
        for (const client of clients.values()) {
            sendTo(client, `[${now()}] 系统: 服务器正在关闭，连接即将断开`);
        }
        // 关闭所有连接
        for (const client of clients.values()) {
            client.socket.destroy();
        }
        server.close(() => {
            console.log(`[${now()}] 服务器已关闭`);
            process.exit(0);
        });
        // 强制退出超时
        setTimeout(() => {
            console.error(`[${now()}] 强制退出`);
            process.exit(1);
        }, 5000);
    });
}
main();
//# sourceMappingURL=index.js.map