/**
 * 部署流水线模块
 * - 将多个 Task 串联为有序的流水线
 * - 支持 pre/post hooks（钩子）
 * - 支持错误回滚
 * - 支持断点续跑
 */

import { Logger, formatDuration } from "./logger";
import { DeployEnvironment, DeployConfig } from "./config";
import { SSHClient } from "./ssh";
import { Task, TaskResult } from "./tasks";

// ─── 流水线阶段 ───────────────────────────────────────────────

export interface PipelineStage {
  task: Task;
  /** 是否可跳过（非关键步骤） */
  optional?: boolean;
}

// ─── Hook 类型 ────────────────────────────────────────────────

export type HookFn = (env: DeployEnvironment, log: Logger) => Promise<void>;

export interface PipelineHooks {
  beforeAll?: HookFn;
  afterAll?: HookFn;
  beforeEach?: (task: Task, env: DeployEnvironment, log: Logger) => Promise<void>;
  afterEach?: (task: Task, result: TaskResult, env: DeployEnvironment, log: Logger) => Promise<void>;
  onFailure?: (task: Task, result: TaskResult, env: DeployEnvironment, log: Logger) => Promise<void>;
}

// ─── 流水线执行结果 ───────────────────────────────────────────

export interface PipelineResult {
  success: boolean;
  totalSteps: number;
  completedSteps: number;
  failedStep?: string;
  results: Array<{ task: string; result: TaskResult }>;
  duration: number;
  rolledBack: boolean;
}

// ─── Pipeline 类 ──────────────────────────────────────────────

export class Pipeline {
  private stages: PipelineStage[] = [];
  private hooks: PipelineHooks = {};
  private log: Logger;
  private config: DeployConfig;
  private sshClient: SSHClient;

  constructor(config: DeployConfig, log: Logger) {
    this.config = config;
    this.log = log;
    const env = this.getActiveEnv();
    this.sshClient = new SSHClient(env.target.ssh, log);
  }

  private getActiveEnv(): DeployEnvironment {
    const env = this.config.envs[this.config.environment];
    if (!env) throw new Error(`未找到环境 "${this.config.environment}" 的配置`);
    return env;
  }

  /** 添加一个阶段 */
  addStage(task: Task, optional: boolean = false): Pipeline {
    this.stages.push({ task, optional });
    return this;
  }

  /** 设置 hooks */
  setHooks(hooks: PipelineHooks): Pipeline {
    this.hooks = hooks;
    return this;
  }

  /** 获取 SSH 客户端 */
  getSSHClient(): SSHClient {
    return this.sshClient;
  }

  /** 执行流水线 */
  async run(dryRun: boolean = false): Promise<PipelineResult> {
    const startTime = Date.now();
    const env = this.getActiveEnv();
    const results: Array<{ task: string; result: TaskResult }> = [];
    let completedSteps = 0;
    let failed = false;
    let failedStepName: string | undefined;

    this.log.setTotalSteps(this.stages.length);

    // beforeAll hook
    if (this.hooks.beforeAll) {
      await this.hooks.beforeAll(env, this.log);
    }

    // ─── 干跑模式 ──────────────────────────────────────────
    if (dryRun) {
      this.log.info("=== 干跑模式 (Dry Run) ===");
      this.log.info("以下步骤将被执行:\n");
      for (const stage of this.stages) {
        this.log.step(`${stage.task.name} - ${stage.task.description}`);
        this.log.substep(`可选: ${stage.optional ? "是" : "否"}`);
      }
      this.log.blank();
      this.log.success("干跑完成，未执行任何实际操作");
      return {
        success: true,
        totalSteps: this.stages.length,
        completedSteps: 0,
        results: [],
        duration: Date.now() - startTime,
        rolledBack: false,
      };
    }

    // ─── 逐步执行 ──────────────────────────────────────────
    for (const stage of this.stages) {
      const { task, optional } = stage;

      // beforeEach hook
      if (this.hooks.beforeEach) {
        await this.hooks.beforeEach(task, env, this.log);
      }

      this.log.step(task.name);
      this.log.debug(task.description);

      let result: TaskResult;
      try {
        result = await task.execute(env, this.log, this.sshClient);
      } catch (err) {
        result = {
          success: false,
          message: `异常: ${(err as Error).message}`,
          duration: 0,
        };
      }

      results.push({ task: task.name, result });

      // afterEach hook
      if (this.hooks.afterEach) {
        await this.hooks.afterEach(task, result, env, this.log);
      }

      if (result.success) {
        this.log.success(`${task.name} 完成 (${formatDuration(result.duration)})`);
        completedSteps++;
      } else {
        if (optional) {
          this.log.warn(`${task.name} 失败（可选步骤，已跳过）: ${result.message}`);
          completedSteps++;
        } else {
          this.log.error(`${task.name} 失败: ${result.message}`);
          failed = true;
          failedStepName = task.name;

          // onFailure hook
          if (this.hooks.onFailure) {
            await this.hooks.onFailure(task, result, env, this.log);
          }

          break;
        }
      }
    }

    // ─── 回滚处理 ──────────────────────────────────────────
    let rolledBack = false;
    if (failed) {
      this.log.warn("部署失败，开始回滚...");
      rolledBack = await this.rollback(env);
    }

    // afterAll hook
    if (this.hooks.afterAll) {
      await this.hooks.afterAll(env, this.log);
    }

    // 断开 SSH
    await this.sshClient.disconnect();

    return {
      success: !failed,
      totalSteps: this.stages.length,
      completedSteps,
      failedStep: failedStepName,
      results,
      duration: Date.now() - startTime,
      rolledBack,
    };
  }

  /** 回滚 */
  private async rollback(env: DeployEnvironment): Promise<boolean> {
    this.log.step("回滚");
    try {
      await this.sshClient.exec(`ln -sfn ${env.target.remotePath}/backups/latest ${env.target.remotePath}/current`);
      await this.sshClient.exec(`cd ${env.target.remotePath}/current && pm2 restart app || systemctl restart app`);
      this.log.success("回滚完成，已恢复至上一版本");
      return true;
    } catch (err) {
      this.log.error(`回滚失败: ${(err as Error).message}`);
      return false;
    }
  }
}

// ─── 工厂函数：创建默认部署流水线 ─────────────────────────────

export function createDefaultPipeline(config: DeployConfig, log: Logger): Pipeline {
  // 延迟导入，避免循环依赖
  const {
    CheckEnvTask,
    RunTestsTask,
    BuildTask,
    CompressTask,
    RemotePrepareTask,
    UploadTask,
    SwitchVersionTask,
    HealthCheckTask,
    CleanupTask,
  } = require("./tasks");

  const pipeline = new Pipeline(config, log);

  pipeline
    .addStage(new CheckEnvTask())              // 1. 环境检查
    .addStage(new RunTestsTask())               // 2. 运行测试（可选）
    .addStage(new BuildTask())                  // 3. 项目构建
    .addStage(new CompressTask())               // 4. 打包压缩
    .addStage(new RemotePrepareTask())          // 5. 远程准备
    .addStage(new UploadTask())                 // 6. 上传部署
    .addStage(new SwitchVersionTask())          // 7. 切换版本
    .addStage(new HealthCheckTask())            // 8. 健康检查
    .addStage(new CleanupTask(), true);         // 9. 清理（可选）

  // 设置 hooks
  const env = config.envs[config.environment];
  pipeline.setHooks({
    beforeAll: async (_env, log) => {
      log.info(`开始部署 ${config.project} → ${config.environment}`);
    },
    afterAll: async (_env, log) => {
      log.blank();
    },
    onFailure: async (task, result, _env, log) => {
      log.error(`步骤 "${task.name}" 失败: ${result.message}`);
      log.warn("将执行自动回滚...");
    },
  });

  return pipeline;
}
