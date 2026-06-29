/**
 * SSH 远程执行模拟模块（增强版）
 * - 枚举/判别联合/抽象SSH Provider/自定义错误/符号/生成器
 */

import { Logger, formatSize } from "./logger";

// ─── 枚举 ─────────────────────────────────────────────────────
export enum SSHState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Error = "error",
}

export enum SSHCommandType {
  Mkdir = "mkdir",
  Ls = "ls",
  Tar = "tar",
  Service = "service",
  Remove = "rm",
  Move = "mv",
  Link = "ln",
  Copy = "cp",
  Health = "health",
  Disk = "df",
  Unknown = "unknown",
}

export enum SSHErrorCode {
  NotConnected = "NOT_CONNECTED",
  CommandFailed = "COMMAND_FAILED",
  TransferFailed = "TRANSFER_FAILED",
  Timeout = "TIMEOUT",
  AuthFailed = "AUTH_FAILED",
}

// ─── 工具类型 ─────────────────────────────────────────────────
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// 条件类型
type CommandResultFor<C extends SSHCommandType> =
  C extends SSHCommandType.Health
    ? { exitCode: 0; stdout: string; stderr: "" }
    : C extends SSHCommandType.Disk
      ? { exitCode: 0; stdout: string; stderr: "" }
      : { exitCode: number; stdout: string; stderr: string };

// 元组
type SSHCommand = readonly [command: string, type: SSHCommandType];
type TransferRecord = readonly [local: string, remote: string, size: number];

// ─── 判别联合 ─────────────────────────────────────────────────
interface SSHSuccess {
  readonly kind: "success";
  readonly exitCode: 0;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: string;
  readonly duration: number;
}

interface SSHFailure {
  readonly kind: "failure";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: string;
  readonly duration: number;
  readonly errorCode: SSHErrorCode;
}

interface SSHTimeout {
  readonly kind: "timeout";
  readonly command: string;
  readonly duration: number;
}

export type SSHResult = SSHSuccess | SSHFailure | SSHTimeout;

// 类型守卫
export function isSSHSuccess(r: SSHResult): r is SSHSuccess {
  return r.kind === "success";
}
export function isSSHFailure(r: SSHResult): r is SSHFailure {
  return r.kind === "failure";
}
export function isSSHTimeout(r: SSHResult): r is SSHTimeout {
  return r.kind === "timeout";
}

// ─── 接口 ─────────────────────────────────────────────────────
export interface SSHExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SSHFileTransfer {
  readonly local: string;
  readonly remote: string;
  readonly size: number;
}

export interface SSHConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
}

// ─── 自定义错误 ───────────────────────────────────────────────
export abstract class SSHError extends Error {
  abstract readonly code: SSHErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "SSHError";
  }
}

export class SSHConnectionError extends SSHError {
  readonly code = SSHErrorCode.NotConnected;
  constructor(message: string) {
    super(message);
    this.name = "SSHConnectionError";
  }
}

export class SSHCommandError extends SSHError {
  readonly code = SSHErrorCode.CommandFailed;
  constructor(
    readonly command: string,
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "SSHCommandError";
  }
}

export class SSHTransferError extends SSHError {
  readonly code = SSHErrorCode.TransferFailed;
  constructor(message: string) {
    super(message);
    this.name = "SSHTransferError";
  }
}

// ─── 符号 ─────────────────────────────────────────────────────
const COMMAND_HISTORY: unique symbol = Symbol("commandHistory");
const TRANSFER_HISTORY: unique symbol = Symbol("transferHistory");
const STATE: unique symbol = Symbol("state");

// ─── 命令分类器 ───────────────────────────────────────────────
function classifyCommand(cmd: string): SSHCommandType {
  const lower = cmd.toLowerCase();
  if (lower.includes("mkdir")) return SSHCommandType.Mkdir;
  if (lower.includes("ls") || lower.includes("pwd")) return SSHCommandType.Ls;
  if (lower.includes("tar")) return SSHCommandType.Tar;
  if (lower.includes("pm2") || lower.includes("systemctl"))
    return SSHCommandType.Service;
  if (lower.includes("rm")) return SSHCommandType.Remove;
  if (lower.includes("mv")) return SSHCommandType.Move;
  if (lower.includes("ln")) return SSHCommandType.Link;
  if (lower.includes("cp")) return SSHCommandType.Copy;
  if (lower.includes("health")) return SSHCommandType.Health;
  if (lower.includes("df")) return SSHCommandType.Disk;
  return SSHCommandType.Unknown;
}

// ─── 模拟延迟 ─────────────────────────────────────────────────
function simulateDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ─── 抽象 SSH Provider ────────────────────────────────────────
abstract class AbstractSSHProvider {
  protected [STATE]: SSHState = SSHState.Disconnected;
  protected readonly [COMMAND_HISTORY]: SSHResult[] = [];
  protected readonly [TRANSFER_HISTORY]: TransferRecord[] = [];
  protected readonly host: string;
  protected readonly port: number;
  protected readonly username: string;
  protected readonly log: Logger;

  constructor(config: SSHConfig, log: Logger) {
    this.host = config.host;
    this.port = config.port;
    this.username = config.username;
    this.log = log;
  }

  abstract connect(): Promise<void>;
  abstract exec(command: string): Promise<SSHExecResult>;
  abstract uploadFile(transfer: SSHFileTransfer): Promise<void>;
  abstract uploadDirectory(
    localDir: string,
    remoteDir: string,
    totalSize: number,
  ): Promise<void>;
  abstract disconnect(): Promise<void>;

  // Getters
  get state(): SSHState {
    return this[STATE];
  }
  get isConnected(): boolean {
    return this[STATE] === SSHState.Connected;
  }
  get commandCount(): number {
    return this[COMMAND_HISTORY].length;
  }
  get transferCount(): number {
    return this[TRANSFER_HISTORY].length;
  }

  // 生成器
  *iterHistory(): Generator<SSHResult> {
    for (const r of this[COMMAND_HISTORY]) yield r;
  }

  *iterTransfers(): Generator<TransferRecord> {
    for (const t of this[TRANSFER_HISTORY]) yield t;
  }

  protected assertConnected(): void {
    if (!this.isConnected) {
      throw new SSHConnectionError("SSH 未连接，请先调用 connect()");
    }
  }

  protected recordCommand(
    cmd: string,
    result: SSHExecResult,
    duration: number,
  ): void {
    const entry: SSHResult =
      result.exitCode === 0
        ? {
            kind: "success",
            exitCode: 0,
            stdout: result.stdout,
            stderr: result.stderr,
            command: cmd,
            duration,
          }
        : {
            kind: "failure",
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            command: cmd,
            duration,
            errorCode: SSHErrorCode.CommandFailed,
          };
    this[COMMAND_HISTORY].push(entry);
  }
}

// ─── 模拟 SSH Provider ────────────────────────────────────────
export class SimulatedSSHProvider extends AbstractSSHProvider {
  async connect(): Promise<void> {
    this.log.substep(`正在连接 ${this.username}@${this.host}:${this.port}...`);
    this[STATE] = SSHState.Connecting;
    await simulateDelay(300, 800);
    this[STATE] = SSHState.Connected;
    this.log.substep(`SSH 连接已建立 ✓`);
  }

  async exec(command: string): Promise<SSHExecResult> {
    this.assertConnected();
    this.log.command(`ssh ${this.username}@${this.host} "${command}"`);
    const start = Date.now();
    await simulateDelay(200, 600);

    const type = classifyCommand(command);
    let result: SSHExecResult;

    switch (type) {
      case SSHCommandType.Mkdir:
      case SSHCommandType.Remove:
      case SSHCommandType.Move:
      case SSHCommandType.Link:
      case SSHCommandType.Copy:
        result = { exitCode: 0, stdout: "", stderr: "" };
        break;
      case SSHCommandType.Ls:
        result = { exitCode: 0, stdout: `/var/www/app\n`, stderr: "" };
        break;
      case SSHCommandType.Tar:
        result = { exitCode: 0, stdout: "解压完成\n", stderr: "" };
        break;
      case SSHCommandType.Service:
        result = { exitCode: 0, stdout: "服务重启成功\n", stderr: "" };
        break;
      case SSHCommandType.Health:
        result = {
          exitCode: 0,
          stdout: "OK - 服务运行正常, 响应时间: 45ms\n",
          stderr: "",
        };
        break;
      case SSHCommandType.Disk:
        result = {
          exitCode: 0,
          stdout:
            "Filesystem  Size  Used  Avail  Use%\n/dev/sda1   50G   23G   25G    48%\n",
          stderr: "",
        };
        break;
      default:
        result = {
          exitCode: 0,
          stdout: `命令 "${command}" 执行成功\n`,
          stderr: "",
        };
    }

    this.recordCommand(command, result, Date.now() - start);
    return result;
  }

  async uploadFile(transfer: SSHFileTransfer): Promise<void> {
    this.assertConnected();
    this.log.substep(
      `上传 ${transfer.local} → ${transfer.remote} (${formatSize(transfer.size)})`,
    );
    await simulateDelay(500, 1500);
    this[TRANSFER_HISTORY].push([
      transfer.local,
      transfer.remote,
      transfer.size,
    ] as const);
    this.log.substep(`上传完成 ✓`);
  }

  async uploadDirectory(
    localDir: string,
    remoteDir: string,
    totalSize: number,
  ): Promise<void> {
    this.assertConnected();
    this.log.substep(`上传目录 ${localDir}/ → ${remoteDir}/`);
    const batches = 5;
    for (let i = 1; i <= batches; i++) {
      await simulateDelay(300, 700);
      this.log.progress("上传进度", i, batches);
    }
    this[TRANSFER_HISTORY].push([localDir, remoteDir, totalSize] as const);
    this.log.substep(`目录上传完成 (${formatSize(totalSize)}) ✓`);
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      this.log.substep(`断开 SSH 连接`);
      this[STATE] = SSHState.Disconnected;
    }
  }
}

// ─── 兼容别名 ─────────────────────────────────────────────────
export type SSHClient = SimulatedSSHProvider;
export const SSHClient = SimulatedSSHProvider;
