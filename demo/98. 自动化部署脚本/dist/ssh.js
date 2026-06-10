"use strict";
/**
 * SSH 远程执行模拟模块
 * - 本 demo 不使用真实 SSH 库，而是模拟远程操作
 * - 展示自动化部署中 SSH 相关操作的抽象层设计
 * - 真实项目中可替换为 ssh2 / node-ssh 等库实现
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSHClient = void 0;
// ─── 模拟延迟 ─────────────────────────────────────────────────
function simulateDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, delay));
}
// ─── SSHClient 模拟实现 ───────────────────────────────────────
class SSHClient {
    constructor(config, log) {
        this.connected = false;
        this.host = config.host;
        this.port = config.port;
        this.username = config.username;
        this.log = log;
    }
    /** 连接到远程服务器 (模拟) */
    async connect() {
        this.log.substep(`正在连接 ${this.username}@${this.host}:${this.port}...`);
        await simulateDelay(300, 800);
        this.connected = true;
        this.log.substep(`SSH 连接已建立 ✓`);
    }
    /** 执行远程命令 (模拟) */
    async exec(command) {
        this.assertConnected();
        this.log.command(`ssh ${this.username}@${this.host} "${command}"`);
        await simulateDelay(200, 600);
        // 模拟不同命令的输出
        if (command.includes("mkdir")) {
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.includes("ls") || command.includes("pwd")) {
            return { exitCode: 0, stdout: `/var/www/app\n`, stderr: "" };
        }
        if (command.includes("tar")) {
            return { exitCode: 0, stdout: "解压完成\n", stderr: "" };
        }
        if (command.includes("pm2") || command.includes("systemctl")) {
            return { exitCode: 0, stdout: "服务重启成功\n", stderr: "" };
        }
        if (command.includes("rm")) {
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.includes("mv")) {
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.includes("ln")) {
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.includes("cp")) {
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.includes("node") && command.includes("health")) {
            return { exitCode: 0, stdout: "OK - 服务运行正常, 响应时间: 45ms\n", stderr: "" };
        }
        if (command.includes("df")) {
            return { exitCode: 0, stdout: "Filesystem  Size  Used  Avail  Use%\n/dev/sda1   50G   23G   25G    48%\n", stderr: "" };
        }
        return { exitCode: 0, stdout: `命令 "${command}" 执行成功\n`, stderr: "" };
    }
    /** 上传文件 (模拟) */
    async uploadFile(transfer) {
        this.assertConnected();
        this.log.substep(`上传 ${transfer.local} → ${transfer.remote} (${formatSize(transfer.size)})`);
        await simulateDelay(500, 1500);
        this.log.substep(`上传完成 ✓`);
    }
    /** 上传目录 (模拟) */
    async uploadDirectory(localDir, remoteDir, totalSize) {
        this.assertConnected();
        this.log.substep(`上传目录 ${localDir}/ → ${remoteDir}/`);
        // 模拟分批上传
        const batches = 5;
        for (let i = 1; i <= batches; i++) {
            await simulateDelay(300, 700);
            this.log.progress("上传进度", i, batches);
        }
        this.log.substep(`目录上传完成 (${formatSize(totalSize)}) ✓`);
    }
    /** 断开连接 */
    async disconnect() {
        if (this.connected) {
            this.log.substep(`断开 SSH 连接`);
            this.connected = false;
        }
    }
    assertConnected() {
        if (!this.connected) {
            throw new Error("SSH 未连接，请先调用 connect()");
        }
    }
}
exports.SSHClient = SSHClient;
// ─── 辅助函数 ─────────────────────────────────────────────────
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
//# sourceMappingURL=ssh.js.map