/**
 * 彩色终端日志模块（增强版）
 * - 支持多级别日志 (info / success / warn / error / debug)
 * - 支持进度条与步骤指示
 * - 支持时间戳与耗时统计
 * - 使用枚举/判别联合/抽象类/符号/生成器等 TS 特性
 */

// ─── 枚举 ─────────────────────────────────────────────────────
export enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
  Success = "success",
  Step = "step",
}

export enum LogCategory {
  System = "system",
  Build = "build",
  Deploy = "deploy",
  Test = "test",
  Network = "network",
  Rollback = "rollback",
}

export enum LogErrorCode {
  InvalidLevel = "INVALID_LEVEL",
  HandlerError = "HANDLER_ERROR",
  FormatError = "FORMAT_ERROR",
}

// ─── 工具类型 ─────────────────────────────────────────────────
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type LogPrefix<L extends LogLevel> = L extends LogLevel.Error
  ? "[ERROR] "
  : L extends LogLevel.Warn
    ? "[WARN] "
    : L extends LogLevel.Success
      ? "[OK] "
      : "";

type LogEventName = `${LogLevel}` | `${LogCategory}`;

// Tuples
type LogTimestamp = readonly [h: string, m: string, s: string];
type LogEntryTuple = readonly [
  level: LogLevel,
  message: string,
  timestamp: number,
];

// ─── 判别联合 ─────────────────────────────────────────────────
interface TextLogEntry {
  readonly kind: "text";
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: number;
  readonly category: LogCategory;
}

interface StepLogEntry {
  readonly kind: "step";
  readonly level: LogLevel.Step;
  readonly message: string;
  readonly timestamp: number;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

interface ProgressLogEntry {
  readonly kind: "progress";
  readonly label: string;
  readonly current: number;
  readonly total: number;
  readonly timestamp: number;
}

interface BannerLogEntry {
  readonly kind: "banner";
  readonly title: string;
  readonly version: string;
  readonly timestamp: number;
}

interface SummaryLogEntry {
  readonly kind: "summary";
  readonly environment: string;
  readonly totalSteps: number;
  readonly successSteps: number;
  readonly failedSteps: number;
  readonly elapsed: number;
  readonly timestamp: number;
}

export type AnyLogEntry =
  | TextLogEntry
  | StepLogEntry
  | ProgressLogEntry
  | BannerLogEntry
  | SummaryLogEntry;

// ─── 类型守卫 ─────────────────────────────────────────────────
export function isTextLog(e: AnyLogEntry): e is TextLogEntry {
  return e.kind === "text";
}
export function isStepLog(e: AnyLogEntry): e is StepLogEntry {
  return e.kind === "step";
}
export function isProgressLog(e: AnyLogEntry): e is ProgressLogEntry {
  return e.kind === "progress";
}
export function isBannerLog(e: AnyLogEntry): e is BannerLogEntry {
  return e.kind === "banner";
}
export function isSummaryLog(e: AnyLogEntry): e is SummaryLogEntry {
  return e.kind === "summary";
}

// ─── 自定义错误层级 ───────────────────────────────────────────
export abstract class LogError extends Error {
  abstract readonly code: LogErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "LogError";
  }
}

export class InvalidLogLevelError extends LogError {
  readonly code = LogErrorCode.InvalidLevel;
  constructor(level: string) {
    super(`无效的日志级别: ${level}`);
    this.name = "InvalidLogLevelError";
  }
}

export class LogHandlerError extends LogError {
  readonly code = LogErrorCode.HandlerError;
  constructor(
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = "LogHandlerError";
  }
}

// ─── 符号 ─────────────────────────────────────────────────────
const LOG_HISTORY: unique symbol = Symbol("logHistory");
const START_TIME: unique symbol = Symbol("startTime");
const STEP_INDEX: unique symbol = Symbol("stepIndex");

// ─── ANSI ─────────────────────────────────────────────────────
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
} as const;

function colorize(text: string, ...codes: readonly string[]): string {
  return codes.join("") + text + ANSI.reset;
}

// ─── 图标 (satisfies) ────────────────────────────────────────
const ICONS = {
  [LogLevel.Info]: colorize("i", ANSI.cyan),
  [LogLevel.Success]: colorize("√", ANSI.green),
  [LogLevel.Warn]: colorize("!", ANSI.yellow),
  [LogLevel.Error]: colorize("×", ANSI.red),
  [LogLevel.Debug]: colorize("·", ANSI.dim),
  [LogLevel.Step]: colorize("→", ANSI.blue),
} satisfies Record<LogLevel, string>;

const LEVEL_COLORS: Readonly<Record<LogLevel, readonly string[]>> = {
  [LogLevel.Info]: [ANSI.reset],
  [LogLevel.Success]: [ANSI.green],
  [LogLevel.Warn]: [ANSI.yellow],
  [LogLevel.Error]: [ANSI.red, ANSI.bold],
  [LogLevel.Debug]: [ANSI.dim],
  [LogLevel.Step]: [ANSI.reset],
} as const;

// ─── 抽象格式化器 ─────────────────────────────────────────────
abstract class AbstractLogFormatter {
  abstract format(entry: AnyLogEntry): string;
  protected makeTimestamp(ts: number): string {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return colorize(`${h}:${m}:${s}`, ANSI.dim);
  }
}

class ConsoleFormatter extends AbstractLogFormatter {
  format(entry: AnyLogEntry): string {
    const ts = this.makeTimestamp(entry.timestamp);
    if (isTextLog(entry)) {
      return `${ts} ${ICONS[entry.level]}  ${colorize(entry.message, ...LEVEL_COLORS[entry.level])}`;
    }
    if (isStepLog(entry)) {
      const prefix =
        entry.totalSteps > 0
          ? colorize(
              `[${entry.stepIndex}/${entry.totalSteps}]`,
              ANSI.bold,
              ANSI.cyan,
            )
          : colorize(`[${entry.stepIndex}]`, ANSI.bold, ANSI.cyan);
      return `\n${ts} ${ICONS[LogLevel.Step]}  ${prefix} ${colorize(entry.message, ANSI.bold)}`;
    }
    if (isProgressLog(entry)) {
      const percent = Math.round((entry.current / entry.total) * 100);
      const barWidth = 30;
      const filled = Math.round((entry.current / entry.total) * barWidth);
      const bar =
        colorize("█".repeat(filled), ANSI.green) +
        colorize("░".repeat(barWidth - filled), ANSI.dim);
      return `\r  ${entry.label} ${bar} ${percent}%`;
    }
    if (isBannerLog(entry)) {
      const line = "═".repeat(44);
      const centered = entry.title
        .padStart(Math.floor((44 + entry.title.length) / 2))
        .padEnd(44);
      return `\n  ${colorize("╔" + line + "╗", ANSI.cyan)}\n  ${colorize("║", ANSI.cyan)}${colorize(centered, ANSI.bold, ANSI.white)}${colorize("║", ANSI.cyan)}\n  ${colorize("╚" + line + "╝", ANSI.cyan)}\n  ${colorize(`v${entry.version}`, ANSI.dim)}\n`;
    }
    if (isSummaryLog(entry)) {
      const line = "─".repeat(48);
      return `\n  ${colorize(line, ANSI.dim)}\n  ${colorize("部署摘要", ANSI.bold, ANSI.white)}\n  ${colorize(line, ANSI.dim)}\n  环境:     ${colorize(entry.environment, ANSI.cyan)}\n  总步骤:   ${entry.totalSteps}\n  成功:     ${colorize(String(entry.successSteps), ANSI.green)}\n  失败:     ${entry.failedSteps > 0 ? colorize(String(entry.failedSteps), ANSI.red) : colorize("0", ANSI.green)}\n  耗时:     ${colorize(formatDuration(entry.elapsed), ANSI.yellow)}\n  ${colorize(line, ANSI.dim)}`;
    }
    return "";
  }
}

// ─── Logger 类 ────────────────────────────────────────────────
export class Logger {
  private [START_TIME] = Date.now();
  private [STEP_INDEX] = 0;
  private readonly [LOG_HISTORY]: AnyLogEntry[] = [];
  private _totalSteps = 0;
  private _debugMode: boolean;
  private _formatter: AbstractLogFormatter;

  constructor(debugMode: boolean = false, formatter?: AbstractLogFormatter) {
    this._debugMode = debugMode;
    this._formatter = formatter ?? new ConsoleFormatter();
  }

  // Getters
  get elapsed(): number {
    return Date.now() - this[START_TIME];
  }
  get history(): readonly AnyLogEntry[] {
    return this[LOG_HISTORY];
  }
  get historyCount(): number {
    return this[LOG_HISTORY].length;
  }
  get currentStep(): number {
    return this[STEP_INDEX];
  }
  get debugEnabled(): boolean {
    return this._debugMode;
  }

  // Setters
  set debugEnabled(enabled: boolean) {
    this._debugMode = enabled;
  }
  setFormatter(f: AbstractLogFormatter): void {
    this._formatter = f;
  }

  setTotalSteps(n: number): void {
    this._totalSteps = n;
  }
  resetTimer(): void {
    this[START_TIME] = Date.now();
  }

  // 生成器: 遍历历史
  *iterHistory(level?: LogLevel): Generator<AnyLogEntry> {
    for (const entry of this[LOG_HISTORY]) {
      if (!level || ("level" in entry && entry.level === level)) yield entry;
    }
  }

  [Symbol.iterator](): Generator<AnyLogEntry> {
    return this.iterHistory();
  }

  private emit(entry: AnyLogEntry): void {
    this[LOG_HISTORY].push(entry);
    const output = this._formatter.format(entry);
    if (output.startsWith("\r")) {
      process.stdout.write(output);
      if (isProgressLog(entry) && entry.current >= entry.total)
        process.stdout.write("\n");
    } else {
      console.log(output);
    }
  }

  // ─── 基础日志 ────────────────────────────────────────────
  info(message: string, category: LogCategory = LogCategory.System): void {
    this.emit({
      kind: "text",
      level: LogLevel.Info,
      message,
      timestamp: Date.now(),
      category,
    });
  }
  success(message: string): void {
    this.emit({
      kind: "text",
      level: LogLevel.Success,
      message,
      timestamp: Date.now(),
      category: LogCategory.System,
    });
  }
  warn(message: string): void {
    this.emit({
      kind: "text",
      level: LogLevel.Warn,
      message,
      timestamp: Date.now(),
      category: LogCategory.System,
    });
  }
  error(message: string): void {
    this.emit({
      kind: "text",
      level: LogLevel.Error,
      message,
      timestamp: Date.now(),
      category: LogCategory.System,
    });
  }
  debug(message: string): void {
    if (this._debugMode) {
      this.emit({
        kind: "text",
        level: LogLevel.Debug,
        message,
        timestamp: Date.now(),
        category: LogCategory.System,
      });
    }
  }

  // ─── 步骤日志 ────────────────────────────────────────────
  step(name: string): void {
    this[STEP_INDEX]++;
    this.emit({
      kind: "step",
      level: LogLevel.Step,
      message: name,
      timestamp: Date.now(),
      stepIndex: this[STEP_INDEX],
      totalSteps: this._totalSteps,
    });
  }
  substep(message: string): void {
    this.emit({
      kind: "text",
      level: LogLevel.Info,
      message: `${colorize("├─", ANSI.dim)} ${message}`,
      timestamp: Date.now(),
      category: LogCategory.System,
    });
  }
  command(cmd: string): void {
    this.emit({
      kind: "text",
      level: LogLevel.Info,
      message: `${colorize("$", ANSI.dim)} ${colorize(cmd, ANSI.dim)}`,
      timestamp: Date.now(),
      category: LogCategory.System,
    });
  }

  // ─── Banner / 进度 / 摘要 ────────────────────────────────
  banner(title: string, version: string): void {
    this.emit({ kind: "banner", title, version, timestamp: Date.now() });
  }
  progress(label: string, current: number, total: number): void {
    this.emit({
      kind: "progress",
      label,
      current,
      total,
      timestamp: Date.now(),
    });
  }
  summary(stats: {
    environment: string;
    totalSteps: number;
    successSteps: number;
    failedSteps: number;
    elapsed: number;
  }): void {
    this.emit({ kind: "summary", ...stats, timestamp: Date.now() });
  }
  separator(): void {
    console.log(`  ${colorize("─".repeat(48), ANSI.dim)}`);
  }
  blank(): void {
    console.log();
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m${sec}s`;
}

// 函数重载
export function formatSize(bytes: number): string;
export function formatSize(
  bytes: number,
  asTuple: true,
): readonly [number, string];
export function formatSize(
  bytes: number,
  asTuple?: true,
): string | readonly [number, string] {
  const units = ["B", "KB", "MB", "GB"] as const;
  let idx = 0;
  let size = bytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  const formatted =
    idx === 0 ? `${size} ${units[idx]}` : `${size.toFixed(1)} ${units[idx]}`;
  if (asTuple) return [bytes, formatted] as const;
  return formatted;
}

// 全局单例
export const logger = new Logger();
