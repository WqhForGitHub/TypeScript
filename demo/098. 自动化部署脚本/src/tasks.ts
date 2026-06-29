/**
 * 部署任务模块（增强版）
 * - 枚举/判别联合/抽象任务基类/泛型存储/自定义错误/符号/生成器
 */

import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { Logger, formatDuration } from "./logger";
import type { DeployEnvironment } from "./config";
import { SSHClient } from "./ssh";

// ─── 枚举 ─────────────────────────────────────────────────────
export enum TaskState {
  Pending = "pending",
  Running = "running",
  Success = "success",
  Failed = "failed",
  Skipped = "skipped",
}

export enum TaskCategory {
  Check = "check",
  Test = "test",
  Build = "build",
  Package = "package",
  Remote = "remote",
  Upload = "upload",
  Switch = "switch",
  Health = "health",
  Cleanup = "cleanup",
}

export enum TaskErrorCode {
  ExecutionFailed = "EXECUTION_FAILED",
  Timeout = "TIMEOUT",
  MissingDependency = "MISSING_DEP",
  BuildError = "BUILD_ERROR",
  TestError = "TEST_ERROR",
  UploadError = "UPLOAD_ERROR",
  HealthCheckFailed = "HEALTH_FAILED",
}

// ─── 工具类型 ─────────────────────────────────────────────────
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// 条件类型
type TaskResultFor<S extends TaskState> = S extends TaskState.Success
  ? {
      readonly success: true;
      readonly message: string;
      readonly duration: number;
      readonly artifacts?: readonly string[];
    }
  : S extends TaskState.Failed
    ? {
        readonly success: false;
        readonly message: string;
        readonly duration: number;
        readonly errorCode?: TaskErrorCode;
      }
    : S extends TaskState.Skipped
      ? {
          readonly success: true;
          readonly message: string;
          readonly duration: number;
          readonly skipped: true;
        }
      : {
          readonly success: boolean;
          readonly message: string;
          readonly duration: number;
        };

// 元组
type TaskStep = readonly [
  name: string,
  description: string,
  category: TaskCategory,
];
type TaskRecord = readonly [name: string, state: TaskState, duration: number];

// ─── 判别联合: 任务结果 ───────────────────────────────────────
interface TaskSuccess {
  readonly kind: "success";
  readonly message: string;
  readonly duration: number;
  readonly artifacts?: readonly string[];
}

interface TaskFailure {
  readonly kind: "failure";
  readonly message: string;
  readonly duration: number;
  readonly errorCode: TaskErrorCode;
}

interface TaskSkipped {
  readonly kind: "skipped";
  readonly message: string;
  readonly duration: number;
}

export type TaskOutcome = TaskSuccess | TaskFailure | TaskSkipped;

// 类型守卫
export function isTaskSuccess(o: TaskOutcome): o is TaskSuccess {
  return o.kind === "success";
}
export function isTaskFailure(o: TaskOutcome): o is TaskFailure {
  return o.kind === "failure";
}
export function isTaskSkipped(o: TaskOutcome): o is TaskSkipped {
  return o.kind === "skipped";
}

export interface TaskResult {
  readonly success: boolean;
  readonly message: string;
  readonly duration: number;
  readonly artifacts?: readonly string[];
  readonly errorCode?: TaskErrorCode;
}

// ─── 自定义错误 ───────────────────────────────────────────────
export abstract class TaskError extends Error {
  abstract readonly code: TaskErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

export class BuildTaskError extends TaskError {
  readonly code = TaskErrorCode.BuildError;
  constructor(message: string) {
    super(message);
    this.name = "BuildTaskError";
  }
}

export class TestTaskError extends TaskError {
  readonly code = TaskErrorCode.TestError;
  constructor(message: string) {
    super(message);
    this.name = "TestTaskError";
  }
}

export class HealthCheckError extends TaskError {
  readonly code = TaskErrorCode.HealthCheckFailed;
  constructor(message: string) {
    super(message);
    this.name = "HealthCheckError";
  }
}

// ─── 符号 ─────────────────────────────────────────────────────
const TASK_STATE: unique symbol = Symbol("taskState");
const TASK_HISTORY: unique symbol = Symbol("taskHistory");

// ─── 泛型任务存储 ─────────────────────────────────────────────
interface TaskRecordEntry {
  readonly name: string;
  readonly category: TaskCategory;
  state: TaskState;
  duration: number;
  readonly timestamp: number;
}

class TaskStore<T extends TaskRecordEntry> {
  private readonly [TASK_HISTORY]: T[] = [];

  add(entry: T): void {
    this[TASK_HISTORY].push(entry);
  }

  *iter(): Generator<T> {
    for (const e of this[TASK_HISTORY]) yield e;
  }

  get count(): number {
    return this[TASK_HISTORY].length;
  }
  get successful(): number {
    return this[TASK_HISTORY].filter((e) => e.state === TaskState.Success)
      .length;
  }
  get failed(): number {
    return this[TASK_HISTORY].filter((e) => e.state === TaskState.Failed)
      .length;
  }
}

// ─── Task 接口 ────────────────────────────────────────────────
export interface Task {
  readonly name: string;
  readonly description: string;
  readonly category: TaskCategory;
  execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult>;
}

// ─── 抽象任务基类 ─────────────────────────────────────────────
export abstract class AbstractDeployTask implements Task {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: TaskCategory;
  protected [TASK_STATE]: TaskState = TaskState.Pending;

  get state(): TaskState {
    return this[TASK_STATE];
  }

  abstract execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult>;

  protected ok(
    message: string,
    duration: number,
    artifacts?: readonly string[],
  ): TaskResult {
    this[TASK_STATE] = TaskState.Success;
    return { success: true, message, duration, artifacts };
  }

  protected fail(
    message: string,
    duration: number,
    errorCode?: TaskErrorCode,
  ): TaskResult {
    this[TASK_STATE] = TaskState.Failed;
    return { success: false, message, duration, errorCode };
  }

  protected skip(message: string, duration: number = 0): TaskResult {
    this[TASK_STATE] = TaskState.Skipped;
    return { success: true, message, duration };
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────
function execCommand(
  cmd: string,
  log: Logger,
  timeout?: number,
): { code: number; stdout: string; stderr: string } {
  log.command(cmd);
  try {
    const result = child_process.execSync(cmd, {
      encoding: "utf-8",
      timeout: timeout ?? 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout: result, stderr: "" };
  } catch (err: unknown) {
    const execErr = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: execErr.status ?? 1,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
    };
  }
}

function simulateExec(
  cmd: string,
  log: Logger,
): { code: number; stdout: string } {
  log.command(cmd);
  return { code: 0, stdout: "完成" };
}

let DEMO_MODE = true;

export function setDemoMode(mode: boolean): void {
  DEMO_MODE = mode;
}
export function isDemoMode(): boolean {
  return DEMO_MODE;
}

// ─── 任务 1: 环境检查 ────────────────────────────────────────
export class CheckEnvTask extends AbstractDeployTask {
  readonly name = "环境检查";
  readonly description = "检查本地构建环境与依赖是否就绪";
  readonly category = TaskCategory.Check;

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    log.substep("检查 Node.js 版本...");

    if (DEMO_MODE) {
      simulateExec("node --version", log);
      log.substep("Node.js v20.11.0");
    } else {
      const result = execCommand("node --version", log);
      if (result.code !== 0)
        return this.fail(
          "Node.js 未安装或不在 PATH 中",
          Date.now() - start,
          TaskErrorCode.MissingDependency,
        );
      log.substep(`Node.js ${result.stdout.trim()}`);
    }

    log.substep("检查 npm 版本...");
    if (DEMO_MODE) {
      simulateExec("npm --version", log);
      log.substep("npm 10.2.4");
    } else {
      const result = execCommand("npm --version", log);
      if (result.code !== 0)
        return this.fail(
          "npm 未安装或不在 PATH 中",
          Date.now() - start,
          TaskErrorCode.MissingDependency,
        );
      log.substep(`npm ${result.stdout.trim()}`);
    }

    log.substep("检查项目依赖...");
    const nodeModulesPath = path.resolve(
      env.build.outputDir,
      "..",
      "node_modules",
    );
    if (DEMO_MODE || fs.existsSync(nodeModulesPath)) {
      log.substep("依赖已安装 ✓");
    } else {
      return this.fail(
        "项目依赖未安装",
        Date.now() - start,
        TaskErrorCode.MissingDependency,
      );
    }
    return this.ok("环境检查通过", Date.now() - start);
  }
}

// ─── 任务 2: 运行测试 ────────────────────────────────────────
export class RunTestsTask extends AbstractDeployTask {
  readonly name = "运行测试";
  readonly description = "运行项目测试套件，确保代码质量";
  readonly category = TaskCategory.Test;

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;

    if (!env.runTests) {
      log.substep("跳过测试（配置已禁用）");
      return this.skip("测试已跳过");
    }

    log.substep(`运行: ${env.testCommand}`);
    if (DEMO_MODE) {
      simulateExec(env.testCommand, log);
      await new Promise((r) => setTimeout(r, 500));
      log.substep(`测试通过: 12 个测试用例全部通过 (${formatDuration(1200)})`);
      return this.ok("12/12 测试通过", Date.now() - start);
    }

    const result = execCommand(env.testCommand, log, env.timeout);
    if (result.code !== 0) {
      log.substep(`测试失败:\n${result.stderr}`);
      return this.fail(
        "测试未通过",
        Date.now() - start,
        TaskErrorCode.TestError,
      );
    }
    log.substep("测试通过 ✓");
    return this.ok("测试通过", Date.now() - start);
  }
}

// ─── 任务 3: 构建 ────────────────────────────────────────────
export class BuildTask extends AbstractDeployTask {
  readonly name = "项目构建";
  readonly description = "执行构建命令，生成部署产物";
  readonly category = TaskCategory.Build;

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    const outputDir = path.resolve(env.build.outputDir);

    log.substep(`运行: ${env.build.command}`);
    if (DEMO_MODE) {
      simulateExec(env.build.command, log);
      await new Promise((r) => setTimeout(r, 800));
      log.substep(`构建完成，输出目录: ${env.build.outputDir}`);
      const files = ["index.js", "vendor.js", "styles.css", "index.html"];
      files.forEach((f) => log.substep(`  生成: ${f}`));
      return this.ok(
        `构建成功，生成 ${files.length} 个文件`,
        Date.now() - start,
        files.map((f) => path.join(outputDir, f)),
      );
    }

    const result = execCommand(env.build.command, log, env.timeout);
    if (result.code !== 0) {
      log.substep(`构建失败:\n${result.stderr}`);
      return this.fail(
        "构建失败",
        Date.now() - start,
        TaskErrorCode.BuildError,
      );
    }

    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir, { recursive: true }) as string[];
      log.substep(`构建完成，输出 ${files.length} 个文件`);
      return this.ok(
        `构建成功，生成 ${files.length} 个文件`,
        Date.now() - start,
        files.map((f) => path.join(outputDir, f)),
      );
    }
    return this.ok("构建完成", Date.now() - start);
  }
}

// ─── 任务 4: 打包压缩 ────────────────────────────────────────
export class CompressTask extends AbstractDeployTask {
  readonly name = "打包压缩";
  readonly description = "将构建产物打包为 tar.gz 压缩包";
  readonly category = TaskCategory.Package;

  async execute(env: DeployEnvironment, log: Logger): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const archiveName = `deploy-${env.name}-${timestamp}.tar.gz`;
    const archivePath = path.resolve(env.build.outputDir, "..", archiveName);

    log.substep(`打包: ${archiveName}`);
    log.substep(`包含: ${env.include.join(", ")}`);
    log.substep(`排除: ${env.exclude.join(", ")}`);

    if (DEMO_MODE) {
      await new Promise((r) => setTimeout(r, 600));
      log.substep("压缩包大小: 2.4 MB");
      return this.ok(`打包完成: ${archiveName}`, Date.now() - start, [
        archivePath,
      ]);
    }

    const includeArgs = env.include.map((p) => `--include="${p}"`).join(" ");
    const excludeArgs = env.exclude.map((p) => `--exclude="${p}"`).join(" ");
    const cmd = `tar -czf ${archivePath} ${excludeArgs} ${includeArgs} -C . .`;
    const result = execCommand(cmd, log);
    if (result.code !== 0) return this.fail("打包失败", Date.now() - start);
    const stat = fs.statSync(archivePath);
    log.substep(`压缩包大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
    return this.ok(`打包完成: ${archiveName}`, Date.now() - start, [
      archivePath,
    ]);
  }
}

// ─── 任务 5: 远程准备 ────────────────────────────────────────
export class RemotePrepareTask extends AbstractDeployTask {
  readonly name = "远程准备";
  readonly description = "连接远程服务器，创建部署目录与备份";
  readonly category = TaskCategory.Remote;

  async execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    await ssh.connect();

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const releaseDir = `${env.target.remotePath}/releases/${timestamp}`;
    await ssh.exec(`mkdir -p ${releaseDir}`);
    log.substep(`创建版本目录: ${releaseDir}`);

    const currentLink = `${env.target.remotePath}/current`;
    const backupResult = await ssh.exec(`ls -L ${currentLink} 2>/dev/null`);
    if (backupResult.exitCode === 0) {
      log.substep("发现当前版本，创建备份...");
      await ssh.exec(
        `cp -aL ${currentLink} ${env.target.remotePath}/backups/backup-${Date.now()}`,
      );
    }

    if (env.backupCount > 0) {
      log.substep(`清理旧备份（保留 ${env.backupCount} 个）...`);
      await ssh.exec(
        `cd ${env.target.remotePath}/backups && ls -t | tail -n +${env.backupCount + 1} | xargs rm -rf`,
      );
    }
    return this.ok(`远程准备完成: ${releaseDir}`, Date.now() - start, [
      releaseDir,
    ]);
  }
}

// ─── 任务 6: 上传部署 ────────────────────────────────────────
export class UploadTask extends AbstractDeployTask {
  readonly name = "上传部署";
  readonly description = "将构建产物上传到远程服务器";
  readonly category = TaskCategory.Upload;

  async execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;

    await ssh.uploadDirectory(
      env.build.outputDir,
      `${env.target.remotePath}/releases/latest`,
      2_400_000,
    );
    log.substep("远程解压...");
    await ssh.exec(
      `cd ${env.target.remotePath}/releases/latest && tar -xzf *.tar.gz && rm *.tar.gz`,
    );
    log.substep("安装生产依赖...");
    await ssh.exec(
      `cd ${env.target.remotePath}/releases/latest && npm install --production`,
    );
    return this.ok("上传并部署完成", Date.now() - start);
  }
}

// ─── 任务 7: 切换版本 ────────────────────────────────────────
export class SwitchVersionTask extends AbstractDeployTask {
  readonly name = "切换版本";
  readonly description = "切换符号链接并重启服务";
  readonly category = TaskCategory.Switch;

  async execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    log.substep("切换 current 符号链接...");
    await ssh.exec(
      `ln -sfn ${env.target.remotePath}/releases/latest ${env.target.remotePath}/current`,
    );
    log.substep("重启应用服务...");
    await ssh.exec(
      `cd ${env.target.remotePath}/current && pm2 restart app || systemctl restart app`,
    );
    log.substep("等待服务启动...");
    await new Promise((r) => setTimeout(r, 1000));
    return this.ok("版本切换完成，服务已重启", Date.now() - start);
  }
}

// ─── 任务 8: 健康检查 ────────────────────────────────────────
export class HealthCheckTask extends AbstractDeployTask {
  readonly name = "健康检查";
  readonly description = "验证部署后的服务是否正常运行";
  readonly category = TaskCategory.Health;

  async execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    const maxRetries = 3;

    for (let i = 1; i <= maxRetries; i++) {
      log.substep(`健康检查 (${i}/${maxRetries})...`);
      const result = await ssh.exec(
        `node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1))"`,
      );
      if (result.exitCode === 0) {
        log.substep("服务运行正常 ✓");
        return this.ok("健康检查通过", Date.now() - start);
      }
      if (i < maxRetries) {
        log.substep("服务未就绪，2s 后重试...");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    return this.fail(
      "健康检查失败，服务未响应",
      Date.now() - start,
      TaskErrorCode.HealthCheckFailed,
    );
  }
}

// ─── 任务 9: 清理 ────────────────────────────────────────────
export class CleanupTask extends AbstractDeployTask {
  readonly name = "清理";
  readonly description = "清理本地临时文件与远程旧版本";
  readonly category = TaskCategory.Cleanup;

  async execute(
    env: DeployEnvironment,
    log: Logger,
    ssh: SSHClient,
  ): Promise<TaskResult> {
    const start = Date.now();
    this[TASK_STATE] = TaskState.Running;
    log.substep("清理本地临时文件...");
    if (DEMO_MODE) simulateExec("rm -f deploy-*.tar.gz", log);
    else execCommand("rm -f deploy-*.tar.gz", log);

    log.substep("清理远程旧版本...");
    await ssh.exec(
      `cd ${env.target.remotePath}/releases && ls -t | tail -n +6 | xargs rm -rf`,
    );
    return this.ok("清理完成", Date.now() - start);
  }
}

// ─── 生成器: 遍历所有任务类型 ─────────────────────────────────
export function* iterAllTaskTypes(): Generator<TaskStep> {
  yield [
    "环境检查",
    "检查本地构建环境与依赖是否就绪",
    TaskCategory.Check,
  ] as const;
  yield [
    "运行测试",
    "运行项目测试套件，确保代码质量",
    TaskCategory.Test,
  ] as const;
  yield ["项目构建", "执行构建命令，生成部署产物", TaskCategory.Build] as const;
  yield [
    "打包压缩",
    "将构建产物打包为 tar.gz 压缩包",
    TaskCategory.Package,
  ] as const;
  yield [
    "远程准备",
    "连接远程服务器，创建部署目录与备份",
    TaskCategory.Remote,
  ] as const;
  yield [
    "上传部署",
    "将构建产物上传到远程服务器",
    TaskCategory.Upload,
  ] as const;
  yield ["切换版本", "切换符号链接并重启服务", TaskCategory.Switch] as const;
  yield [
    "健康检查",
    "验证部署后的服务是否正常运行",
    TaskCategory.Health,
  ] as const;
  yield ["清理", "清理本地临时文件与远程旧版本", TaskCategory.Cleanup] as const;
}
