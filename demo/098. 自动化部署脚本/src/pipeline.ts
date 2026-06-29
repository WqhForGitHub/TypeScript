/**
 * 部署流水线模块（增强版）
 * - 枚举/判别联合/抽象流水线/泛型/自定义错误/符号/生成器
 */

import { Logger, formatDuration } from "./logger";
import type { DeployEnvironment, DeployConfig } from "./config";
import { SSHClient } from "./ssh";
import type { Task, TaskResult } from "./tasks";

// ─── 枚举 ─────────────────────────────────────────────────────
export enum PipelineState {
  Idle = "idle",
  Running = "running",
  Success = "success",
  Failed = "failed",
  RolledBack = "rolled_back",
  DryRun = "dry_run",
}

export enum PipelineErrorCode {
  NoStages = "NO_STAGES",
  ExecutionError = "EXECUTION_ERROR",
  RollbackFailed = "ROLLBACK_FAILED",
  EnvNotFound = "ENV_NOT_FOUND",
}

// ─── 工具类型 ─────────────────────────────────────────────────
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// 条件类型
type PipelineOutcomeFor<S extends PipelineState> =
  S extends PipelineState.Success
    ? {
        readonly success: true;
        readonly totalSteps: number;
        readonly completedSteps: number;
        readonly duration: number;
      }
    : S extends PipelineState.Failed
      ? {
          readonly success: false;
          readonly failedStep: string;
          readonly duration: number;
          readonly rolledBack: boolean;
        }
      : S extends PipelineState.DryRun
        ? {
            readonly success: true;
            readonly dryRun: true;
            readonly stages: readonly string[];
          }
        : { readonly success: boolean; readonly duration: number };

// 元组
type PipelineStep = readonly [index: number, task: Task, optional: boolean];
type StageResult = readonly [taskName: string, result: TaskResult];

// ─── 判别联合: 流水线结果 ─────────────────────────────────────
interface PipelineSuccess {
  readonly kind: "success";
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly results: readonly StageResult[];
  readonly duration: number;
  readonly rolledBack: boolean;
}

interface PipelineFailure {
  readonly kind: "failure";
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly failedStep: string;
  readonly results: readonly StageResult[];
  readonly duration: number;
  readonly rolledBack: boolean;
}

interface PipelineDryRun {
  readonly kind: "dry_run";
  readonly stages: readonly string[];
  readonly duration: number;
}

export type PipelineOutcome =
  PipelineSuccess | PipelineFailure | PipelineDryRun;

// 类型守卫
export function isPipelineSuccess(o: PipelineOutcome): o is PipelineSuccess {
  return o.kind === "success";
}
export function isPipelineFailure(o: PipelineOutcome): o is PipelineFailure {
  return o.kind === "failure";
}
export function isPipelineDryRun(o: PipelineOutcome): o is PipelineDryRun {
  return o.kind === "dry_run";
}

// ─── 接口 ─────────────────────────────────────────────────────
export interface PipelineStage {
  readonly task: Task;
  readonly optional?: boolean;
}

export type HookFn = (env: DeployEnvironment, log: Logger) => Promise<void>;

export interface PipelineHooks {
  readonly beforeAll?: HookFn;
  readonly afterAll?: HookFn;
  readonly beforeEach?: (
    task: Task,
    env: DeployEnvironment,
    log: Logger,
  ) => Promise<void>;
  readonly afterEach?: (
    task: Task,
    result: TaskResult,
    env: DeployEnvironment,
    log: Logger,
  ) => Promise<void>;
  readonly onFailure?: (
    task: Task,
    result: TaskResult,
    env: DeployEnvironment,
    log: Logger,
  ) => Promise<void>;
}

// ─── 自定义错误 ───────────────────────────────────────────────
export abstract class PipelineError extends Error {
  abstract readonly code: PipelineErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

export class NoStagesError extends PipelineError {
  readonly code = PipelineErrorCode.NoStages;
  constructor() {
    super("流水线没有添加任何阶段");
    this.name = "NoStagesError";
  }
}

export class PipelineExecutionError extends PipelineError {
  readonly code = PipelineErrorCode.ExecutionError;
  constructor(message: string) {
    super(message);
    this.name = "PipelineExecutionError";
  }
}

export class PipelineRollbackError extends PipelineError {
  readonly code = PipelineErrorCode.RollbackFailed;
  constructor(message: string) {
    super(message);
    this.name = "PipelineRollbackError";
  }
}

// ─── 符号 ─────────────────────────────────────────────────────
const PIPELINE_STATE: unique symbol = Symbol("pipelineState");
const STAGES: unique symbol = Symbol("stages");
const HOOKS: unique symbol = Symbol("hooks");

// ─── 抽象流水线 ───────────────────────────────────────────────
abstract class AbstractPipeline {
  protected [PIPELINE_STATE]: PipelineState = PipelineState.Idle;
  protected readonly [STAGES]: PipelineStage[] = [];
  protected [HOOKS]: PipelineHooks = {};
  protected readonly log: Logger;
  protected readonly config: DeployConfig;

  constructor(config: DeployConfig, log: Logger) {
    this.config = config;
    this.log = log;
  }

  get state(): PipelineState {
    return this[PIPELINE_STATE];
  }
  get stageCount(): number {
    return this[STAGES].length;
  }
  get isIdle(): boolean {
    return this[PIPELINE_STATE] === PipelineState.Idle;
  }

  addStage(task: Task, optional: boolean = false): this {
    this[STAGES].push({ task, optional });
    return this;
  }

  setHooks(hooks: PipelineHooks): this {
    this[HOOKS] = hooks;
    return this;
  }

  *iterStages(): Generator<PipelineStep> {
    for (let i = 0; i < this[STAGES].length; i++) {
      const stage = this[STAGES][i];
      yield [i, stage.task, stage.optional ?? false] as const;
    }
  }

  protected getActiveEnv(): DeployEnvironment {
    const env = this.config.envs[this.config.environment];
    if (!env)
      throw new PipelineExecutionError(
        `未找到环境 "${this.config.environment}" 的配置`,
      );
    return env;
  }

  abstract run(dryRun?: boolean): Promise<PipelineOutcome>;
  protected abstract rollback(env: DeployEnvironment): Promise<boolean>;
}

// ─── 部署流水线 ───────────────────────────────────────────────
export class Pipeline extends AbstractPipeline {
  private sshClient: SSHClient;

  constructor(config: DeployConfig, log: Logger) {
    super(config, log);
    const env = this.getActiveEnv();
    this.sshClient = new SSHClient(env.target.ssh, log);
  }

  getSSHClient(): SSHClient {
    return this.sshClient;
  }

  async run(dryRun: boolean = false): Promise<PipelineOutcome> {
    const startTime = Date.now();
    const env = this.getActiveEnv();
    const results: StageResult[] = [];
    let completedSteps = 0;
    let failed = false;
    let failedStepName: string | undefined;

    this[PIPELINE_STATE] = PipelineState.Running;
    this.log.setTotalSteps(this.stageCount);

    if (this[HOOKS].beforeAll) await this[HOOKS].beforeAll(env, this.log);

    // 干跑模式
    if (dryRun) {
      this[PIPELINE_STATE] = PipelineState.DryRun;
      this.log.info("=== 干跑模式 (Dry Run) ===");
      this.log.info("以下步骤将被执行:\n");
      const stageNames: string[] = [];
      for (const stage of this[STAGES]) {
        this.log.step(`${stage.task.name} - ${stage.task.description}`);
        this.log.substep(`可选: ${stage.optional ? "是" : "否"}`);
        stageNames.push(stage.task.name);
      }
      this.log.blank();
      this.log.success("干跑完成，未执行任何实际操作");
      return {
        kind: "dry_run",
        stages: stageNames,
        duration: Date.now() - startTime,
      };
    }

    // 逐步执行
    for (const [, task, optional] of this.iterStages()) {
      if (this[HOOKS].beforeEach)
        await this[HOOKS].beforeEach(task, env, this.log);
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

      results.push([task.name, result] as const);

      if (this[HOOKS].afterEach)
        await this[HOOKS].afterEach(task, result, env, this.log);

      if (result.success) {
        this.log.success(
          `${task.name} 完成 (${formatDuration(result.duration)})`,
        );
        completedSteps++;
      } else {
        if (optional) {
          this.log.warn(
            `${task.name} 失败（可选步骤，已跳过）: ${result.message}`,
          );
          completedSteps++;
        } else {
          this.log.error(`${task.name} 失败: ${result.message}`);
          failed = true;
          failedStepName = task.name;
          if (this[HOOKS].onFailure)
            await this[HOOKS].onFailure(task, result, env, this.log);
          break;
        }
      }
    }

    // 回滚
    let rolledBack = false;
    if (failed) {
      this.log.warn("部署失败，开始回滚...");
      rolledBack = await this.rollback(env);
      this[PIPELINE_STATE] = rolledBack
        ? PipelineState.RolledBack
        : PipelineState.Failed;
    } else {
      this[PIPELINE_STATE] = PipelineState.Success;
    }

    if (this[HOOKS].afterAll) await this[HOOKS].afterAll(env, this.log);
    await this.sshClient.disconnect();

    if (failed) {
      return {
        kind: "failure",
        totalSteps: this.stageCount,
        completedSteps,
        failedStep: failedStepName!,
        results,
        duration: Date.now() - startTime,
        rolledBack,
      };
    }
    return {
      kind: "success",
      totalSteps: this.stageCount,
      completedSteps,
      results,
      duration: Date.now() - startTime,
      rolledBack,
    };
  }

  protected async rollback(env: DeployEnvironment): Promise<boolean> {
    this.log.step("回滚");
    try {
      await this.sshClient.exec(
        `ln -sfn ${env.target.remotePath}/backups/latest ${env.target.remotePath}/current`,
      );
      await this.sshClient.exec(
        `cd ${env.target.remotePath}/current && pm2 restart app || systemctl restart app`,
      );
      this.log.success("回滚完成，已恢复至上一版本");
      return true;
    } catch (err) {
      this.log.error(`回滚失败: ${(err as Error).message}`);
      return false;
    }
  }
}

// ─── 兼容接口 ─────────────────────────────────────────────────
export interface PipelineResult {
  readonly success: boolean;
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly failedStep?: string;
  readonly results: readonly StageResult[];
  readonly duration: number;
  readonly rolledBack: boolean;
}

// ─── 工厂函数 ─────────────────────────────────────────────────
export function createDefaultPipeline(
  config: DeployConfig,
  log: Logger,
): Pipeline {
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
    .addStage(new CheckEnvTask())
    .addStage(new RunTestsTask())
    .addStage(new BuildTask())
    .addStage(new CompressTask())
    .addStage(new RemotePrepareTask())
    .addStage(new UploadTask())
    .addStage(new SwitchVersionTask())
    .addStage(new HealthCheckTask())
    .addStage(new CleanupTask(), true);

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
