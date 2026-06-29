#!/usr/bin/env node
/**
 * 自动化部署脚本 - 入口文件（增强版）
 *
 * 纯 TypeScript 实现的自动化部署工具 Demo
 * 支持: 多环境部署、流水线编排、SSH 远程操作、回滚机制
 *
 * 用法:
 *   node dist/index.js [选项]
 *   node dist/index.js --env staging
 *   node dist/index.js --env production --dry-run
 *   node dist/index.js --init               # 生成配置文件
 */

import * as fs from "fs";
import * as path from "path";
import { Logger, formatDuration } from "./logger";
import {
  CliArgs,
  DeployConfig,
  loadConfigFromFile,
  buildConfigFromArgs,
  validateConfig,
  printConfigSummary,
  generateDefaultConfig,
} from "./config";
import {
  Pipeline,
  createDefaultPipeline,
  isPipelineSuccess,
  isPipelineFailure,
  isPipelineDryRun,
} from "./pipeline";
import type { PipelineResult } from "./pipeline";
import { setDemoMode } from "./tasks";

// ─── 枚举 ─────────────────────────────────────────────────────
enum CLIErrorCode {
  InvalidArgs = "INVALID_ARGS",
  ConfigMissing = "CONFIG_MISSING",
  DeployFailed = "DEPLOY_FAILED",
  RollbackNeeded = "ROLLBACK_NEEDED",
}

// ─── 工具类型 ─────────────────────────────────────────────────
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// 条件类型
type ParseResultFor<V extends boolean> = V extends true
  ? { readonly ok: true; readonly args: CliArgs }
  : { readonly ok: false; readonly error: string; readonly arg?: string };

// 元组
type ParsedArg = readonly [
  key: string,
  value: string | boolean | string[] | number,
];

// ─── 判别联合: 解析结果 ───────────────────────────────────────
interface ParseSuccess {
  readonly kind: "success";
  readonly args: CliArgs;
}

interface ParseFailure {
  readonly kind: "failure";
  readonly error: string;
  readonly arg?: string;
}

interface ParseExit {
  readonly kind: "exit";
  readonly code: number;
}

type ParseResult = ParseSuccess | ParseFailure | ParseExit;

// 类型守卫
function isParseSuccess(r: ParseResult): r is ParseSuccess {
  return r.kind === "success";
}
function isParseFailure(r: ParseResult): r is ParseFailure {
  return r.kind === "failure";
}
function isParseExit(r: ParseResult): r is ParseExit {
  return r.kind === "exit";
}

// ─── 自定义错误 ───────────────────────────────────────────────
abstract class CLIError extends Error {
  abstract readonly code: CLIErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "CLIError";
  }
}

class InvalidArgsError extends CLIError {
  readonly code = CLIErrorCode.InvalidArgs;
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgsError";
  }
}

class ConfigMissingError extends CLIError {
  readonly code = CLIErrorCode.ConfigMissing;
  constructor(path: string) {
    super(`配置文件不存在: ${path}`);
    this.name = "ConfigMissingError";
  }
}

// ─── 符号 ─────────────────────────────────────────────────────
const PARSED_ARGS: unique symbol = Symbol("parsedArgs");

// ─── 版本 ─────────────────────────────────────────────────────
const VERSION = "1.0.0" as const;

// ─── 函数重载: parseArgs ──────────────────────────────────────
function parseArgs(argv: readonly string[]): ParseResult;
function parseArgs(argv: readonly string[], startIndex: number): ParseResult;
function parseArgs(
  argv: readonly string[],
  startIndex: number = 2,
): ParseResult {
  const args: Mutable<CliArgs> = {
    env: "staging",
    skipTest: false,
    dryRun: false,
    verbose: false,
    init: false,
  };

  let i = startIndex;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "-e":
      case "--env":
        args.env = argv[++i] ?? "staging";
        break;
      case "-p":
      case "--project":
        args.project = argv[++i];
        break;
      case "--host":
        args.host = argv[++i];
        break;
      case "--port":
        args.port = parseInt(argv[++i] ?? "22", 10);
        break;
      case "--user":
        args.user = argv[++i];
        break;
      case "--remote-path":
        args.remotePath = argv[++i];
        break;
      case "--build-cmd":
        args.buildCmd = argv[++i];
        break;
      case "--output-dir":
        args.outputDir = argv[++i];
        break;
      case "--test-cmd":
        args.testCmd = argv[++i];
        break;
      case "--skip-test":
        args.skipTest = true;
        break;
      case "--include":
        args.include = (argv[++i] ?? "").split(",").map((s) => s.trim());
        break;
      case "--exclude":
        args.exclude = (argv[++i] ?? "").split(",").map((s) => s.trim());
        break;
      case "--backups":
        args.backups = parseInt(argv[++i] ?? "3", 10);
        break;
      case "--timeout":
        args.timeout = parseInt(argv[++i] ?? "300000", 10);
        break;
      case "-c":
      case "--config":
        args.config = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--init":
        args.init = true;
        break;
      case "-v":
      case "--verbose":
        args.verbose = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        return { kind: "exit", code: 0 };
      case "--version":
        console.log(`auto-deploy v${VERSION}`);
        return { kind: "exit", code: 0 };
      default:
        if (!arg.startsWith("-")) {
          args.env = arg;
        } else {
          return { kind: "failure", error: `未知选项: ${arg}`, arg };
        }
    }
    i++;
  }
  return { kind: "success", args: args as CliArgs };
}

// ─── 帮助信息 ─────────────────────────────────────────────────
function printHelp(): void {
  console.log(`
自动部署工具 v${VERSION}

用法:
  deploy [环境名] [选项]
  deploy --env staging --dry-run
  deploy --init

选项:
  -e, --env <name>        部署环境 (默认: staging)
  -p, --project <name>    项目名称
  --host <host>           SSH 主机地址
  --port <port>           SSH 端口 (默认: 22)
  --user <username>       SSH 用户名
  --remote-path <path>    远程部署路径
  --build-cmd <cmd>       构建命令
  --output-dir <dir>      构建输出目录
  --test-cmd <cmd>        测试命令
  --skip-test             跳过测试
  --include <patterns>    包含文件模式（逗号分隔）
  --exclude <patterns>    排除文件模式（逗号分隔）
  --backups <n>           保留备份数量 (默认: 3)
  --timeout <ms>          部署超时时间 (默认: 300000)
  -c, --config <path>     配置文件路径
  --dry-run               干跑模式，只显示步骤不执行
  --init                  生成默认配置文件
  -v, --verbose           详细输出模式
  -h, --help              显示帮助信息
  --version               显示版本号

示例:
  deploy staging                       部署到 staging 环境
  deploy --env production --dry-run    干跑 production 部署
  deploy --init                        生成 deploy.config.json
  deploy --config ./deploy.json        使用指定配置文件部署
`);
}

// ─── 倒计时工具 ───────────────────────────────────────────────
async function countdown(seconds: number): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`  ${i}...`);
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write("\r");
  }
  process.stdout.write("         \r");
}

// ─── 生成器: 遍历步骤结果 ─────────────────────────────────────
function* iterStepResults(
  results: readonly {
    task: string;
    result: { success: boolean; message: string; duration: number };
  }[],
): Generator<ParsedArg> {
  for (const r of results) {
    yield [
      r.task,
      `${r.result.success ? "√" : "×"} ${formatDuration(r.result.duration)} - ${r.result.message}`,
    ] as const;
  }
}

// ─── 主流程 ───────────────────────────────────────────────────
async function main(): Promise<void> {
  const parseResult = parseArgs(process.argv);
  if (isParseExit(parseResult)) process.exit(parseResult.code);
  if (isParseFailure(parseResult)) {
    console.error(parseResult.error);
    printHelp();
    process.exit(1);
  }
  const args = parseResult.args;
  const log = new Logger(args.verbose);

  // 初始化配置文件
  if (args.init) {
    const configPath = path.resolve("deploy.config.json");
    if (fs.existsSync(configPath)) {
      log.warn(`配置文件已存在: ${configPath}`);
      process.exit(1);
    }
    generateDefaultConfig(configPath);
    log.success(`配置文件已生成: ${configPath}`);
    process.exit(0);
  }

  // Banner
  log.banner("自动化部署工具", VERSION);

  // 加载配置
  let config: DeployConfig;
  if (args.config) {
    const loaded = loadConfigFromFile(args.config);
    if (!loaded) {
      log.error(`配置文件不存在: ${args.config}`);
      process.exit(1);
    }
    config = { ...loaded, environment: args.env };
    log.info(`从配置文件加载: ${args.config}`);
  } else {
    config = buildConfigFromArgs(args);
    log.info("使用命令行参数构建配置");
  }

  // 配置校验
  const errors = validateConfig(config);
  if (errors.length > 0) {
    log.error("配置校验失败:");
    errors.forEach((e) => log.substep(`${e.field}: ${e.message}`));
    process.exit(1);
  }

  // 显示配置摘要
  log.separator();
  printConfigSummary(config, log);
  log.separator();

  // 确认部署
  if (!args.dryRun) {
    log.warn(`即将部署 ${config.project} 到 ${config.environment} 环境`);
    log.info("3 秒后开始部署，按 Ctrl+C 取消...");
    await countdown(3);
  }

  // 设置 demo 模式
  const realMode = process.env["DEPLOY_REAL"] === "1";
  setDemoMode(!realMode);
  if (!realMode && !args.dryRun) {
    log.info("当前为 Demo 模式 (模拟执行)，设置 DEPLOY_REAL=1 启用真实执行");
  }

  // 创建并运行流水线
  log.resetTimer();
  const pipeline = createDefaultPipeline(config, log);
  const outcome = await pipeline.run(args.dryRun);

  // 处理判别联合结果
  let result: PipelineResult;
  if (isPipelineDryRun(outcome)) {
    result = {
      success: true,
      totalSteps: outcome.stages.length,
      completedSteps: 0,
      results: [],
      duration: outcome.duration,
      rolledBack: false,
    };
  } else {
    result = {
      success: outcome.kind === "success",
      totalSteps: outcome.totalSteps,
      completedSteps: outcome.completedSteps,
      failedStep: isPipelineFailure(outcome) ? outcome.failedStep : undefined,
      results: outcome.results,
      duration: outcome.duration,
      rolledBack: outcome.rolledBack,
    };
  }

  // 输出部署摘要
  log.summary({
    environment: config.environment,
    totalSteps: result.totalSteps,
    successSteps: result.completedSteps - (result.failedStep ? 1 : 0),
    failedSteps: result.failedStep ? 1 : 0,
    elapsed: result.duration,
  });

  // 详细步骤耗时
  if (args.verbose && result.results.length > 0) {
    log.blank();
    log.info("步骤耗时明细:");
    for (const [task, info] of iterStepResults(
      result.results.map((r) => ({ task: r[0], result: r[1] })),
    )) {
      log.substep(`${info} [${task}]`);
    }
  }

  // 退出
  if (result.rolledBack) {
    log.warn("部署已回滚，请检查错误后重试");
    process.exit(1);
  }
  if (!result.success) {
    log.error("部署失败!");
    process.exit(1);
  }
  log.success("部署完成!");
  process.exit(0);
}

// ─── 启动 ─────────────────────────────────────────────────────
main().catch((err) => {
  console.error("部署异常:", err);
  process.exit(1);
});
