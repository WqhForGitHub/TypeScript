/**
 * 部署配置模块（增强版）
 * - 枚举/判别联合/抽象加载器/自定义错误/映射类型/条件类型
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "./logger";

// ─── 枚举 ─────────────────────────────────────────────────────
export enum EnvironmentType {
  Staging = "staging",
  Production = "production",
  Development = "development",
}

export enum ConfigErrorCode {
  NotFound = "NOT_FOUND",
  ParseError = "PARSE_ERROR",
  ValidationFailed = "VALIDATION_FAILED",
  InvalidEnv = "INVALID_ENV",
}

export enum ConfigSource {
  File = "file",
  Args = "args",
  Default = "default",
}

// ─── 工具类型 ─────────────────────────────────────────────────
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// 条件类型
type ConfigLoaderResult<S extends ConfigSource> = S extends ConfigSource.File
  ? FileLoadResult
  : S extends ConfigSource.Args
    ? {
        readonly ok: true;
        readonly config: DeployConfig;
        readonly source: ConfigSource.Args;
      }
    : {
        readonly ok: true;
        readonly config: DeployConfig;
        readonly source: ConfigSource.Default;
      };

// 元组
type ValidationIssue = readonly [field: string, message: string];
type EnvEntry = readonly [name: string, env: DeployEnvironment];

// ─── 配置接口 ─────────────────────────────────────────────────
export interface SSHConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password?: string;
  readonly privateKeyPath?: string;
}

export interface DeployTarget {
  readonly name: string;
  readonly remotePath: string;
  readonly ssh: SSHConfig;
}

export interface BuildConfig {
  readonly command: string;
  readonly outputDir: string;
}

export interface DeployHooks {
  readonly preBuild?: readonly string[];
  readonly postBuild?: readonly string[];
  readonly preDeploy?: readonly string[];
  readonly postDeploy?: readonly string[];
}

export interface DeployEnvironment {
  readonly name: string;
  readonly build: BuildConfig;
  readonly target: DeployTarget;
  readonly hooks?: DeployHooks;
  readonly runTests: boolean;
  readonly testCommand: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly backupCount: number;
  readonly timeout: number;
  readonly [key: string]: unknown;
}

export interface DeployConfig {
  readonly project: string;
  readonly environment: string;
  readonly envs: Readonly<Record<string, DeployEnvironment>>;
}

// ─── 判别联合: 加载结果 ───────────────────────────────────────
type FileLoadResult =
  | {
      readonly ok: true;
      readonly config: DeployConfig;
      readonly source: ConfigSource;
    }
  | {
      readonly ok: false;
      readonly code: ConfigErrorCode;
      readonly message: string;
    };

type ValidationResult =
  | { readonly ok: true; readonly config: DeployConfig }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[] };

// 类型守卫
function isFileLoadOk(
  r: FileLoadResult,
): r is Extract<FileLoadResult, { ok: true }> {
  return r.ok;
}

// ─── 自定义错误 ───────────────────────────────────────────────
export abstract class ConfigError extends Error {
  abstract readonly code: ConfigErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ConfigNotFoundError extends ConfigError {
  readonly code = ConfigErrorCode.NotFound;
  constructor(path: string) {
    super(`配置文件不存在: ${path}`);
    this.name = "ConfigNotFoundError";
  }
}

export class ConfigParseError extends ConfigError {
  readonly code = ConfigErrorCode.ParseError;
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message);
    this.name = "ConfigParseError";
  }
}

export class ConfigValidationError extends ConfigError {
  readonly code = ConfigErrorCode.ValidationFailed;
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`配置校验失败: ${issues.map((i) => `${i[0]}(${i[1]})`).join("; ")}`);
    this.name = "ConfigValidationError";
  }
}

// ─── 符号 ─────────────────────────────────────────────────────
const CONFIG_META: unique symbol = Symbol("configMeta");
const VALIDATED: unique symbol = Symbol("validated");

interface ConfigMeta {
  readonly [CONFIG_META]?: {
    readonly source: ConfigSource;
    readonly loadedAt: number;
  };
  [VALIDATED]?: boolean;
}

// ─── 默认配置 ─────────────────────────────────────────────────
const DEFAULT_ENV: DeployEnvironment = {
  name: "staging",
  build: { command: "npm run build", outputDir: "./dist" },
  target: {
    name: "staging-server",
    remotePath: "/var/www/app",
    ssh: { host: "192.168.1.100", port: 22, username: "deployer" },
  },
  runTests: true,
  testCommand: "npm test",
  include: ["dist/**", "package.json", "node_modules/**"],
  exclude: ["*.log", ".env", ".git/**"],
  backupCount: 3,
  timeout: 300000,
} satisfies DeployEnvironment;

const DEFAULT_CONFIG: DeployConfig = {
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
      backupCount: 5,
      timeout: 600000,
    },
  },
} satisfies DeployConfig;

// ─── 抽象配置加载器 ───────────────────────────────────────────
abstract class AbstractConfigLoader {
  abstract readonly source: ConfigSource;
  abstract load(): FileLoadResult;
  protected stamp(
    config: DeployConfig,
    src: ConfigSource,
  ): DeployConfig & ConfigMeta {
    return { ...config, [CONFIG_META]: { source: src, loadedAt: Date.now() } };
  }
}

class FileConfigLoader extends AbstractConfigLoader {
  readonly source = ConfigSource.File;
  constructor(private readonly configPath: string) {
    super();
  }

  load(): FileLoadResult {
    const fullPath = path.resolve(this.configPath);
    if (!fs.existsSync(fullPath)) {
      return {
        ok: false,
        code: ConfigErrorCode.NotFound,
        message: `配置文件不存在: ${fullPath}`,
      };
    }
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      const config = JSON.parse(raw) as DeployConfig;
      return {
        ok: true,
        config: this.stamp(config, ConfigSource.File),
        source: ConfigSource.File,
      };
    } catch (err) {
      return {
        ok: false,
        code: ConfigErrorCode.ParseError,
        message: `配置文件解析失败: ${(err as Error).message}`,
      };
    }
  }
}

class ArgsConfigLoader extends AbstractConfigLoader {
  readonly source = ConfigSource.Args;
  constructor(private readonly args: CliArgs) {
    super();
  }

  load(): FileLoadResult {
    const config = buildConfigFromArgs(this.args);
    return {
      ok: true,
      config: this.stamp(config, ConfigSource.Args),
      source: ConfigSource.Args,
    };
  }
}

// ─── 公开加载函数 ─────────────────────────────────────────────
export function loadConfigFromFile(configPath: string): DeployConfig | null {
  const loader = new FileConfigLoader(configPath);
  const result = loader.load();
  if (isFileLoadOk(result)) return result.config;
  return null;
}

export function loadConfigOrThrow(configPath: string): DeployConfig {
  const loader = new FileConfigLoader(configPath);
  const result = loader.load();
  if (!isFileLoadOk(result)) {
    if (result.code === ConfigErrorCode.NotFound)
      throw new ConfigNotFoundError(configPath);
    throw new ConfigParseError(result.message);
  }
  return result.config;
}

// ─── 配置生成 ─────────────────────────────────────────────────
export function generateDefaultConfig(writePath: string): void {
  fs.writeFileSync(writePath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
}

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
  readonly field: string;
  readonly message: string;
}

export function validateConfig(config: DeployConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!config.project?.trim())
    errors.push({ field: "project", message: "项目名称不能为空" });
  if (!config.envs[config.environment]) {
    errors.push({
      field: "environment",
      message: `未找到环境 "${config.environment}" 的配置`,
    });
    return errors;
  }
  const env = config.envs[config.environment];
  if (!env.build.command)
    errors.push({ field: "build.command", message: "构建命令不能为空" });
  if (!env.build.outputDir)
    errors.push({ field: "build.outputDir", message: "构建输出目录不能为空" });
  if (!env.target.ssh.host)
    errors.push({ field: "target.ssh.host", message: "SSH 主机地址不能为空" });
  if (!env.target.ssh.username)
    errors.push({
      field: "target.ssh.username",
      message: "SSH 用户名不能为空",
    });
  if (!env.target.remotePath)
    errors.push({
      field: "target.remotePath",
      message: "远程部署路径不能为空",
    });
  if (env.backupCount < 0)
    errors.push({ field: "backupCount", message: "备份数量不能为负数" });
  if (env.timeout <= 0)
    errors.push({ field: "timeout", message: "超时时间必须大于 0" });
  return errors;
}

// 生成器: 遍历所有环境
export function* iterEnvironments(config: DeployConfig): Generator<EnvEntry> {
  for (const [name, env] of Object.entries(config.envs)) {
    yield [name, env] as const;
  }
}

// Getters
export function getActiveEnv(config: DeployConfig): DeployEnvironment {
  const env = config.envs[config.environment];
  if (!env)
    throw new ConfigNotFoundError(`未找到环境 "${config.environment}" 的配置`);
  return env;
}

export function printConfigSummary(config: DeployConfig, log: Logger): void {
  const env = config.envs[config.environment];
  if (!env) return;
  log.info(`项目: ${config.project}`);
  log.info(`环境: ${env.name}`);
  log.info(`构建: ${env.build.command} → ${env.build.outputDir}`);
  log.info(
    `目标: ${env.target.ssh.username}@${env.target.ssh.host}:${env.target.ssh.port}`,
  );
  log.info(`路径: ${env.target.remotePath}`);
  log.info(`测试: ${env.runTests ? env.testCommand : "跳过"}`);
  log.info(`备份: 保留最近 ${env.backupCount} 个版本`);
  log.info(`超时: ${env.timeout / 1000}s`);
}

// ─── CLI 参数类型 ─────────────────────────────────────────────
export interface CliArgs {
  readonly env: string;
  readonly project?: string;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly remotePath?: string;
  readonly buildCmd?: string;
  readonly outputDir?: string;
  readonly testCmd?: string;
  readonly skipTest: boolean;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly backups?: number;
  readonly timeout?: number;
  readonly config?: string;
  readonly init: boolean;
  readonly [key: string]: unknown;
}
