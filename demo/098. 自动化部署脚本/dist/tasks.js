"use strict";
/**
 * 部署任务模块
 * - 每个部署步骤封装为独立的 Task
 * - 统一的 Task 接口，便于 Pipeline 编排
 * - 支持 pre/post hook 钩子
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
exports.CleanupTask = exports.HealthCheckTask = exports.SwitchVersionTask = exports.UploadTask = exports.RemotePrepareTask = exports.CompressTask = exports.BuildTask = exports.RunTestsTask = exports.CheckEnvTask = void 0;
exports.setDemoMode = setDemoMode;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process = __importStar(require("child_process"));
const logger_1 = require("./logger");
// ─── 辅助函数 ─────────────────────────────────────────────────
function execCommand(cmd, log, timeout) {
    log.command(cmd);
    try {
        const result = child_process.execSync(cmd, {
            encoding: "utf-8",
            timeout: timeout ?? 120000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { code: 0, stdout: result, stderr: "" };
    }
    catch (err) {
        const execErr = err;
        return {
            code: execErr.status ?? 1,
            stdout: execErr.stdout ?? "",
            stderr: execErr.stderr ?? "",
        };
    }
}
function simulateExec(cmd, log) {
    log.command(cmd);
    // 在 demo 模式下，不实际执行，仅模拟输出
    return { code: 0, stdout: "完成" };
}
// 是否处于 demo 模式（不执行真实命令）
let DEMO_MODE = true;
function setDemoMode(mode) {
    DEMO_MODE = mode;
}
// ─── 任务 1: 环境检查 ────────────────────────────────────────
class CheckEnvTask {
    constructor() {
        this.name = "环境检查";
        this.description = "检查本地构建环境与依赖是否就绪";
    }
    async execute(env, log) {
        const start = Date.now();
        log.substep("检查 Node.js 版本...");
        if (DEMO_MODE) {
            const result = simulateExec("node --version", log);
            log.substep(`Node.js v20.11.0`);
        }
        else {
            const result = execCommand("node --version", log);
            if (result.code !== 0) {
                return { success: false, message: "Node.js 未安装或不在 PATH 中", duration: Date.now() - start };
            }
            log.substep(`Node.js ${result.stdout.trim()}`);
        }
        log.substep("检查 npm 版本...");
        if (DEMO_MODE) {
            simulateExec("npm --version", log);
            log.substep(`npm 10.2.4`);
        }
        else {
            const result = execCommand("npm --version", log);
            if (result.code !== 0) {
                return { success: false, message: "npm 未安装或不在 PATH 中", duration: Date.now() - start };
            }
            log.substep(`npm ${result.stdout.trim()}`);
        }
        log.substep("检查项目依赖...");
        const nodeModulesPath = path.resolve(env.build.outputDir, "..", "node_modules");
        if (DEMO_MODE || fs.existsSync(nodeModulesPath)) {
            log.substep(`依赖已安装 ✓`);
        }
        else {
            log.substep(`依赖未安装，请先运行 npm install`);
            return { success: false, message: "项目依赖未安装", duration: Date.now() - start };
        }
        return { success: true, message: "环境检查通过", duration: Date.now() - start };
    }
}
exports.CheckEnvTask = CheckEnvTask;
// ─── 任务 2: 运行测试 ────────────────────────────────────────
class RunTestsTask {
    constructor() {
        this.name = "运行测试";
        this.description = "运行项目测试套件，确保代码质量";
    }
    async execute(env, log) {
        const start = Date.now();
        if (!env.runTests) {
            log.substep("跳过测试（配置已禁用）");
            return { success: true, message: "测试已跳过", duration: Date.now() - start };
        }
        log.substep(`运行: ${env.testCommand}`);
        if (DEMO_MODE) {
            simulateExec(env.testCommand, log);
            // 模拟测试输出
            await new Promise((r) => setTimeout(r, 500));
            log.substep(`测试通过: 12 个测试用例全部通过 (${(0, logger_1.formatDuration)(1200)})`);
            return { success: true, message: "12/12 测试通过", duration: Date.now() - start };
        }
        const result = execCommand(env.testCommand, log, env.timeout);
        if (result.code !== 0) {
            log.substep(`测试失败:\n${result.stderr}`);
            return { success: false, message: "测试未通过", duration: Date.now() - start };
        }
        log.substep("测试通过 ✓");
        return { success: true, message: "测试通过", duration: Date.now() - start };
    }
}
exports.RunTestsTask = RunTestsTask;
// ─── 任务 3: 构建 ────────────────────────────────────────────
class BuildTask {
    constructor() {
        this.name = "项目构建";
        this.description = "执行构建命令，生成部署产物";
    }
    async execute(env, log) {
        const start = Date.now();
        const outputDir = path.resolve(env.build.outputDir);
        log.substep(`运行: ${env.build.command}`);
        if (DEMO_MODE) {
            simulateExec(env.build.command, log);
            await new Promise((r) => setTimeout(r, 800));
            log.substep(`构建完成，输出目录: ${env.build.outputDir}`);
            // 模拟构建产物
            const files = ["index.js", "vendor.js", "styles.css", "index.html"];
            files.forEach((f) => log.substep(`  生成: ${f}`));
            return {
                success: true,
                message: `构建成功，生成 ${files.length} 个文件`,
                duration: Date.now() - start,
                artifacts: files.map((f) => path.join(outputDir, f)),
            };
        }
        const result = execCommand(env.build.command, log, env.timeout);
        if (result.code !== 0) {
            log.substep(`构建失败:\n${result.stderr}`);
            return { success: false, message: "构建失败", duration: Date.now() - start };
        }
        // 列出构建产物
        if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir, { recursive: true });
            log.substep(`构建完成，输出 ${files.length} 个文件`);
            return {
                success: true,
                message: `构建成功，生成 ${files.length} 个文件`,
                duration: Date.now() - start,
                artifacts: files.map((f) => path.join(outputDir, f)),
            };
        }
        return { success: true, message: "构建完成", duration: Date.now() - start };
    }
}
exports.BuildTask = BuildTask;
// ─── 任务 4: 打包压缩 ────────────────────────────────────────
class CompressTask {
    constructor() {
        this.name = "打包压缩";
        this.description = "将构建产物打包为 tar.gz 压缩包";
    }
    async execute(env, log) {
        const start = Date.now();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const archiveName = `deploy-${env.name}-${timestamp}.tar.gz`;
        const archivePath = path.resolve(env.build.outputDir, "..", archiveName);
        log.substep(`打包: ${archiveName}`);
        log.substep(`包含: ${env.include.join(", ")}`);
        log.substep(`排除: ${env.exclude.join(", ")}`);
        if (DEMO_MODE) {
            await new Promise((r) => setTimeout(r, 600));
            log.substep(`压缩包大小: 2.4 MB`);
            return { success: true, message: `打包完成: ${archiveName}`, duration: Date.now() - start, artifacts: [archivePath] };
        }
        const includeArgs = env.include.map((p) => `--include="${p}"`).join(" ");
        const excludeArgs = env.exclude.map((p) => `--exclude="${p}"`).join(" ");
        const cmd = `tar -czf ${archivePath} ${excludeArgs} ${includeArgs} -C . .`;
        const result = execCommand(cmd, log);
        if (result.code !== 0) {
            return { success: false, message: "打包失败", duration: Date.now() - start };
        }
        const stat = fs.statSync(archivePath);
        log.substep(`压缩包大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
        return { success: true, message: `打包完成: ${archiveName}`, duration: Date.now() - start, artifacts: [archivePath] };
    }
}
exports.CompressTask = CompressTask;
// ─── 任务 5: SSH 连接与远程准备 ───────────────────────────────
class RemotePrepareTask {
    constructor() {
        this.name = "远程准备";
        this.description = "连接远程服务器，创建部署目录与备份";
    }
    async execute(env, log, ssh) {
        const start = Date.now();
        // 连接
        await ssh.connect();
        // 创建版本目录
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const releaseDir = `${env.target.remotePath}/releases/${timestamp}`;
        await ssh.exec(`mkdir -p ${releaseDir}`);
        log.substep(`创建版本目录: ${releaseDir}`);
        // 备份当前版本
        const currentLink = `${env.target.remotePath}/current`;
        const backupResult = await ssh.exec(`ls -L ${currentLink} 2>/dev/null`);
        if (backupResult.exitCode === 0) {
            log.substep("发现当前版本，创建备份...");
            await ssh.exec(`cp -aL ${currentLink} ${env.target.remotePath}/backups/backup-${Date.now()}`);
        }
        // 清理旧备份
        if (env.backupCount > 0) {
            log.substep(`清理旧备份（保留 ${env.backupCount} 个）...`);
            await ssh.exec(`cd ${env.target.remotePath}/backups && ls -t | tail -n +${env.backupCount + 1} | xargs rm -rf`);
        }
        return { success: true, message: `远程准备完成: ${releaseDir}`, duration: Date.now() - start, artifacts: [releaseDir] };
    }
}
exports.RemotePrepareTask = RemotePrepareTask;
// ─── 任务 6: 上传部署 ────────────────────────────────────────
class UploadTask {
    constructor() {
        this.name = "上传部署";
        this.description = "将构建产物上传到远程服务器";
    }
    setArchive(path) {
        this.archivePath = path;
    }
    setReleaseDir(_dir) {
        // 保存远程发布目录，供上传使用
    }
    async execute(env, log, ssh) {
        const start = Date.now();
        // 上传压缩包
        await ssh.uploadDirectory(env.build.outputDir, `${env.target.remotePath}/releases/latest`, 2400000 // 模拟 2.4MB
        );
        // 远程解压
        log.substep("远程解压...");
        await ssh.exec(`cd ${env.target.remotePath}/releases/latest && tar -xzf *.tar.gz && rm *.tar.gz`);
        // 安装远程依赖
        log.substep("安装生产依赖...");
        await ssh.exec(`cd ${env.target.remotePath}/releases/latest && npm install --production`);
        return { success: true, message: "上传并部署完成", duration: Date.now() - start };
    }
}
exports.UploadTask = UploadTask;
// ─── 任务 7: 切换版本 & 重启服务 ─────────────────────────────
class SwitchVersionTask {
    constructor() {
        this.name = "切换版本";
        this.description = "切换符号链接并重启服务";
    }
    async execute(env, log, ssh) {
        const start = Date.now();
        // 更新 current 符号链接
        log.substep("切换 current 符号链接...");
        await ssh.exec(`ln -sfn ${env.target.remotePath}/releases/latest ${env.target.remotePath}/current`);
        // 重启服务
        log.substep("重启应用服务...");
        await ssh.exec(`cd ${env.target.remotePath}/current && pm2 restart app || systemctl restart app`);
        // 等待服务启动
        log.substep("等待服务启动...");
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true, message: "版本切换完成，服务已重启", duration: Date.now() - start };
    }
}
exports.SwitchVersionTask = SwitchVersionTask;
// ─── 任务 8: 健康检查 ────────────────────────────────────────
class HealthCheckTask {
    constructor() {
        this.name = "健康检查";
        this.description = "验证部署后的服务是否正常运行";
    }
    async execute(env, log, ssh) {
        const start = Date.now();
        const maxRetries = 3;
        for (let i = 1; i <= maxRetries; i++) {
            log.substep(`健康检查 (${i}/${maxRetries})...`);
            const result = await ssh.exec(`node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1))"`);
            if (result.exitCode === 0) {
                log.substep("服务运行正常 ✓");
                return { success: true, message: "健康检查通过", duration: Date.now() - start };
            }
            if (i < maxRetries) {
                log.substep("服务未就绪，2s 后重试...");
                await new Promise((r) => setTimeout(r, 2000));
            }
        }
        return { success: false, message: "健康检查失败，服务未响应", duration: Date.now() - start };
    }
}
exports.HealthCheckTask = HealthCheckTask;
// ─── 任务 9: 清理 ────────────────────────────────────────────
class CleanupTask {
    constructor() {
        this.name = "清理";
        this.description = "清理本地临时文件与远程旧版本";
    }
    async execute(env, log, ssh) {
        const start = Date.now();
        // 清理本地压缩包
        log.substep("清理本地临时文件...");
        if (DEMO_MODE) {
            simulateExec("rm -f deploy-*.tar.gz", log);
        }
        else {
            execCommand("rm -f deploy-*.tar.gz", log);
        }
        // 清理远程旧版本
        log.substep("清理远程旧版本...");
        await ssh.exec(`cd ${env.target.remotePath}/releases && ls -t | tail -n +6 | xargs rm -rf`);
        return { success: true, message: "清理完成", duration: Date.now() - start };
    }
}
exports.CleanupTask = CleanupTask;
//# sourceMappingURL=tasks.js.map