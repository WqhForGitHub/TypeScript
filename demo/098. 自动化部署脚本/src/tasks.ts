/**
 * 部署任务模块
 * - 每个部署步骤封装为独立的 Task
 * - 统一的 Task 接口，便于 Pipeline 编排
 * - 支持 pre/post hook 钩子
 */

import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { Logger, formatDuration } from "./logger";
import { DeployEnvironment } from "./config";
import { SSHClient } from "./ssh";

// ─── Task 基础类型 ────────────────────────────────────────────

export interface TaskResult {
  success: boolean;
  message: string;
  duration: number;
  /** 任务产出物（如构建产物路径） */
  artifacts?: string[];
}

export interface Task {
  name: string;
  description: string;
  execute(env: DeployEnvironment, log: Logger, ssh: SSHClient): Promise<TaskResult>;
}

// ─── 辅助函数 ─────────────────────────────────────────────────

function execCommand(cmd: string, log: Logger, timeout?: number): { code: number; stdout: string; stderr: string } {
  log.command(cmd);
  try {
    const result = child_process.execSync(cmd, {
      encoding: "utf-8",
      timeout: timeout ?? 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout: result, stderr: "" };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: execErr.status ?? 1,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
    };
  }
}

function simulateExec(cmd: string, log: Logger): { code: number; stdout: string } {
  log.command(cmd);
  // 在 demo 模式下，不实际执行，仅模拟输出
  return { code: 0, stdout: "完成" };
}

// 是否处于 demo 模式（不执行真实命令）
let DEMO_MODE = true;

export function setDemoMode(mode: boolean): void {
  DEMO_MODE = mode;
}

// ─── 任务 1: 环境检查 ────────────────────────────────────────

export class CheckEnvTask implements Task {
  name = "环境检查";
  description = "检查本地构建环境与依赖是否就绪";

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
    const start = Date.now();
    log.substep("检查 Node.js 版本...");

    if (DEMO_MODE) {
      const result = simulateExec("node --version", log);
      log.substep(`Node.js v20.11.0`);
    } else {
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
    } else {
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
    } else {
      log.substep(`依赖未安装，请先运行 npm install`);
      return { success: false, message: "项目依赖未安装", duration: Date.now() - start };
    }

    return { success: true, message: "环境检查通过", duration: Date.now() - start };
  }
}

// ─── 任务 2: 运行测试 ────────────────────────────────────────

export class RunTestsTask implements Task {
  name = "运行测试";
  description = "运行项目测试套件，确保代码质量";

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
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
      log.substep(`测试通过: 12 个测试用例全部通过 (${formatDuration(1200)})`);
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

// ─── 任务 3: 构建 ────────────────────────────────────────────

export class BuildTask implements Task {
  name = "项目构建";
  description = "执行构建命令，生成部署产物";

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
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
      const files = fs.readdirSync(outputDir, { recursive: true }) as string[];
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

// ─── 任务 4: 打包压缩 ────────────────────────────────────────

export class CompressTask implements Task {
  name = "打包压缩";
  description = "将构建产物打包为 tar.gz 压缩包";

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
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

// ─── 任务 5: SSH 连接与远程准备 ───────────────────────────────

export class RemotePrepareTask implements Task {
  name = "远程准备";
  description = "连接远程服务器，创建部署目录与备份";

  async execute(env: DeployEnvironment, log: Logger, ssh: SSHClient): Promise<TaskResult> {
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
      await ssh.exec(
        `cd ${env.target.remotePath}/backups && ls -t | tail -n +${env.backupCount + 1} | xargs rm -rf`
      );
    }

    return { success: true, message: `远程准备完成: ${releaseDir}`, duration: Date.now() - start, artifacts: [releaseDir] };
  }
}

// ─── 任务 6: 上传部署 ────────────────────────────────────────

export class UploadTask implements Task {
  name = "上传部署";
  description = "将构建产物上传到远程服务器";

  private archivePath?: string;

  setArchive(path: string): void {
    this.archivePath = path;
  }

  setReleaseDir(_dir: string): void {
    // 保存远程发布目录，供上传使用
  }

  async execute(env: DeployEnvironment, log: Logger, ssh: SSHClient): Promise<TaskResult> {
    const start = Date.now();

    // 上传压缩包
    await ssh.uploadDirectory(
      env.build.outputDir,
      `${env.target.remotePath}/releases/latest`,
      2_400_000 // 模拟 2.4MB
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

// ─── 任务 7: 切换版本 & 重启服务 ─────────────────────────────

export class SwitchVersionTask implements Task {
  name = "切换版本";
  description = "切换符号链接并重启服务";

  async execute(env: DeployEnvironment, log: Logger, ssh: SSHClient): Promise<TaskResult> {
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

// ─── 任务 8: 健康检查 ────────────────────────────────────────

export class HealthCheckTask implements Task {
  name = "健康检查";
  description = "验证部署后的服务是否正常运行";

  async execute(env: DeployEnvironment, log: Logger, ssh: SSHClient): Promise<TaskResult> {
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

// ─── 任务 9: 清理 ────────────────────────────────────────────

export class CleanupTask implements Task {
  name = "清理";
  description = "清理本地临时文件与远程旧版本";

  async execute(env: DeployEnvironment, log: Logger, ssh: SSHClient): Promise<TaskResult> {
    const start = Date.now();

    // 清理本地压缩包
    log.substep("清理本地临时文件...");
    if (DEMO_MODE) {
      simulateExec("rm -f deploy-*.tar.gz", log);
    } else {
      execCommand("rm -f deploy-*.tar.gz", log);
    }

    // 清理远程旧版本
    log.substep("清理远程旧版本...");
    await ssh.exec(
      `cd ${env.target.remotePath}/releases && ls -t | tail -n +6 | xargs rm -rf`
    );

    return { success: true, message: "清理完成", duration: Date.now() - start };
  }
}
