/**
 * 部署配置模块
 * - 定义部署配置的类型约束
 * - 支持从 deploy.config.json 文件加载配置
 * - 支持环境变量覆盖
 * - 支持配置校验
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "./logger";

// ─── 类型定义 ─────────────────────────────────────────────────

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface DeployTarget {
  name: string;
  remotePath: string;
  ssh: SSHConfig;
}

export interface BuildConfig {
  command: string;
  outputDir: string;
}

export interface DeployHooks {
  preBuild?: string[];
  postBuild?: string[];
  preDeploy?: string[];
  postDeploy?: string[];
}

export interface DeployEnvironment {
  name: string;
  build: BuildConfig;
  target: DeployTarget;
  hooks?: DeployHooks;
  /** 部署前是否运行测试 */
  runTests: boolean;
  /** 测试命令 */
  testCommand: string;
  /** 需要压缩上传的文件/目录 */
  include: string[];
  /** 排除的文件/目录 */
  exclude: string[];
  /** 远程备份保留数量 */
  backupCount: number;
  /** 部署超时时间(ms) */
  timeout: number;
}

export interface DeployConfig {
  /** 项目名称 */
  project: string;
  /** 当前部署环境 */
  environment: string;
  /** 环境配置列表 */
  envs: Record<string, DeployEnvironment>;
}

// ─── 默认配置 ─────────────────────────────────────────────────

const DEFAULT_ENV: DeployEnvironment = {
  name: "staging",
  build: {
    command: "npm run build",
    outputDir: "./dist",
  },
  target: {
    name: "staging-server",
    remotePath: "/var/www/app",
    ssh: {
      host: "192.168.1.100",
      port: 22,
      username: "deployer",
    },
  },
  runTests: true,
  testCommand: "npm test",
  include: ["dist/**", "package.json", "node_modules/**"],
  exclude: ["*.log", ".env", ".git/**"],
  backupCount: 3,
  timeout: 300000,
};

// ─── 配置加载 ─────────────────────────────────────────────────

/**
 * 从文件加载配置
 */
export function loadConfigFromFile(configPath: string): DeployConfig | null {
  const fullPath = path.resolve(configPath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(raw) as DeployConfig;
  } catch (err) {
    throw new Error(`配置文件解析失败: ${(err as Error).message}`);
  }
}

/**
 * 生成默认配置文件
 */
export function generateDefaultConfig(writePath: string): void {
  const config: DeployConfig = {
    project: "my-project",
    environment: "staging",
    envs: {
      staging: { ...DEFAULT_ENV },
      production: {
        ...DEFAULT_ENV,
        name: "production",
        build: { command: "npm run build:prod", outputDir: "./dist" },
        target: {
          name: "prod-server",
          remotePath: "/var/www/app",
          ssh: { host: "10.0.0.1", port: 22, username: "deployer" },
        },
        runTests: true,
        testCommand: "npm test",
        backupCount: 5,
        timeout: 600000,
      },
    },
  };
  fs.writeFileSync(writePath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * 从命令行参数构造配置 (demo 模式)
 */
export function buildConfigFromArgs(args: CliArgs): DeployConfig {
  const envName = args.env;
  const env: DeployEnvironment = {
    name: envName,
    build: {
      command: args.buildCmd ?? "npm run build",
      outputDir: args.outputDir ?? "./dist",
    },
    target: {
      name: `${envName}-server`,
      remotePath: args.remotePath ?? "/var/www/app",
      ssh: {
        host: args.host ?? "192.168.1.100",
        port: args.port ?? 22,
        username: args.user ?? "deployer",
      },
    },
    runTests: !args.skipTest,
    testCommand: args.testCmd ?? "npm test",
    include: args.include ?? ["dist/**", "package.json"],
    exclude: args.exclude ?? ["*.log", ".env", ".git/**"],
    backupCount: args.backups ?? 3,
    timeout: args.timeout ?? 300000,
  };

  return {
    project: args.project ?? "demo-project",
    environment: envName,
    envs: { [envName]: env },
  };
}

// ─── 配置校验 ─────────────────────────────────────────────────

interface ValidationError {
  field: string;
  message: string;
}

export function validateConfig(config: DeployConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const envName = config.environment;

  if (!config.project || config.project.trim() === "") {
    errors.push({ field: "project", message: "项目名称不能为空" });
  }

  if (!config.envs[envName]) {
    errors.push({ field: "environment", message: `未找到环境 "${envName}" 的配置` });
    return errors;
  }

  const env = config.envs[envName];

  if (!env.build.command) {
    errors.push({ field: "build.command", message: "构建命令不能为空" });
  }

  if (!env.build.outputDir) {
    errors.push({ field: "build.outputDir", message: "构建输出目录不能为空" });
  }

  if (!env.target.ssh.host) {
    errors.push({ field: "target.ssh.host", message: "SSH 主机地址不能为空" });
  }

  if (!env.target.ssh.username) {
    errors.push({ field: "target.ssh.username", message: "SSH 用户名不能为空" });
  }

  if (!env.target.remotePath) {
    errors.push({ field: "target.remotePath", message: "远程部署路径不能为空" });
  }

  if (env.backupCount < 0) {
    errors.push({ field: "backupCount", message: "备份数量不能为负数" });
  }

  if (env.timeout <= 0) {
    errors.push({ field: "timeout", message: "超时时间必须大于 0" });
  }

  return errors;
}

/**
 * 打印当前使用的配置信息
 */
export function printConfigSummary(config: DeployConfig, log: Logger): void {
  const env = config.envs[config.environment];
  if (!env) return;

  log.info(`项目: ${config.project}`);
  log.info(`环境: ${env.name}`);
  log.info(`构建: ${env.build.command} → ${env.build.outputDir}`);
  log.info(`目标: ${env.target.ssh.username}@${env.target.ssh.host}:${env.target.ssh.port}`);
  log.info(`路径: ${env.target.remotePath}`);
  log.info(`测试: ${env.runTests ? env.testCommand : "跳过"}`);
  log.info(`备份: 保留最近 ${env.backupCount} 个版本`);
  log.info(`超时: ${env.timeout / 1000}s`);
}

// ─── CLI 参数类型 ─────────────────────────────────────────────

export interface CliArgs {
  env: string;
  project?: string;
  host?: string;
  port?: number;
  user?: string;
  remotePath?: string;
  buildCmd?: string;
  outputDir?: string;
  testCmd?: string;
  skipTest: boolean;
  dryRun: boolean;
  verbose: boolean;
  include?: string[];
  exclude?: string[];
  backups?: number;
  timeout?: number;
  config?: string;
  init: boolean;
}
