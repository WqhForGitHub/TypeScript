/**
 * 彩色终端日志模块
 * - 支持多级别日志 (info / success / warn / error / debug)
 * - 支持进度条与步骤指示
 * - 支持时间戳与耗时统计
 */

// ─── ANSI 颜色工具 ───────────────────────────────────────────
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
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
} as const;

function colorize(text: string, ...codes: string[]): string {
  return codes.join("") + text + ANSI.reset;
}

// ─── 图标 ─────────────────────────────────────────────────────
const ICONS = {
  info: colorize("i", ANSI.cyan),
  success: colorize("√", ANSI.green),
  warn: colorize("!", ANSI.yellow),
  error: colorize("×", ANSI.red),
  debug: colorize("·", ANSI.dim),
  step: colorize("→", ANSI.blue),
  rocket: colorize(">>", ANSI.magenta),
} as const;

// ─── 时间工具 ─────────────────────────────────────────────────
function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return colorize(`${h}:${m}:${s}`, ANSI.dim);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m${sec}s`;
}

// ─── Logger 类 ────────────────────────────────────────────────
export class Logger {
  private startTime: number = Date.now();
  private stepIndex: number = 0;
  private totalSteps: number = 0;
  private debugMode: boolean;

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
  }

  setTotalSteps(n: number): void {
    this.totalSteps = n;
  }

  resetTimer(): void {
    this.startTime = Date.now();
  }

  elapsed(): number {
    return Date.now() - this.startTime;
  }

  // ─── 基础日志 ────────────────────────────────────────────
  info(message: string): void {
    console.log(`${timestamp()} ${ICONS.info}  ${message}`);
  }

  success(message: string): void {
    console.log(`${timestamp()} ${ICONS.success}  ${colorize(message, ANSI.green)}`);
  }

  warn(message: string): void {
    console.log(`${timestamp()} ${ICONS.warn}  ${colorize(message, ANSI.yellow)}`);
  }

  error(message: string): void {
    console.log(`${timestamp()} ${ICONS.error}  ${colorize(message, ANSI.red, ANSI.bold)}`);
  }

  debug(message: string): void {
    if (this.debugMode) {
      console.log(`${timestamp()} ${ICONS.debug}  ${colorize(message, ANSI.dim)}`);
    }
  }

  // ─── 步骤日志 ────────────────────────────────────────────
  step(name: string): void {
    this.stepIndex++;
    const prefix = this.totalSteps > 0
      ? colorize(`[${this.stepIndex}/${this.totalSteps}]`, ANSI.bold, ANSI.cyan)
      : colorize(`[${this.stepIndex}]`, ANSI.bold, ANSI.cyan);
    console.log(`\n${timestamp()} ${ICONS.step}  ${prefix} ${colorize(name, ANSI.bold)}`);
  }

  // ─── 子步骤日志 ──────────────────────────────────────────
  substep(message: string): void {
    console.log(`${timestamp()}    ${colorize("├─", ANSI.dim)} ${message}`);
  }

  // ─── 命令输出 ────────────────────────────────────────────
  command(cmd: string): void {
    console.log(`${timestamp()}    ${colorize("$", ANSI.dim)} ${colorize(cmd, ANSI.dim)}`);
  }

  // ─── Banner ─────────────────────────────────────────────
  banner(title: string, version: string): void {
    const line = "═".repeat(44);
    const centered = title.padStart(Math.floor((44 + title.length) / 2)).padEnd(44);
    console.log(`\n  ${colorize("╔" + line + "╗", ANSI.cyan)}`);
    console.log(`  ${colorize("║", ANSI.cyan)}${colorize(centered, ANSI.bold, ANSI.white)}${colorize("║", ANSI.cyan)}`);
    console.log(`  ${colorize("╚" + line + "╝", ANSI.cyan)}`);
    console.log(`  ${colorize(`v${version}`, ANSI.dim)}`);
    console.log();
  }

  // ─── 部署摘要 ────────────────────────────────────────────
  summary(stats: {
    environment: string;
    totalSteps: number;
    successSteps: number;
    failedSteps: number;
    elapsed: number;
  }): void {
    const line = "─".repeat(48);
    console.log(`\n  ${colorize(line, ANSI.dim)}`);
    console.log(`  ${colorize("部署摘要", ANSI.bold, ANSI.white)}`);
    console.log(`  ${colorize(line, ANSI.dim)}`);
    console.log(`  环境:     ${colorize(stats.environment, ANSI.cyan)}`);
    console.log(`  总步骤:   ${stats.totalSteps}`);
    console.log(`  成功:     ${colorize(String(stats.successSteps), ANSI.green)}`);
    console.log(`  失败:     ${stats.failedSteps > 0 ? colorize(String(stats.failedSteps), ANSI.red) : colorize("0", ANSI.green)}`);
    console.log(`  耗时:     ${colorize(formatDuration(stats.elapsed), ANSI.yellow)}`);
    console.log(`  ${colorize(line, ANSI.dim)}`);
  }

  // ─── 进度条 ──────────────────────────────────────────────
  progress(label: string, current: number, total: number): void {
    const percent = Math.round((current / total) * 100);
    const barWidth = 30;
    const filled = Math.round((current / total) * barWidth);
    const bar = colorize("█".repeat(filled), ANSI.green)
      + colorize("░".repeat(barWidth - filled), ANSI.dim);
    process.stdout.write(`\r  ${label} ${bar} ${percent}%`);
    if (current >= total) {
      process.stdout.write("\n");
    }
  }

  // ─── 分隔线 ──────────────────────────────────────────────
  separator(): void {
    console.log(`  ${colorize("─".repeat(48), ANSI.dim)}`);
  }

  blank(): void {
    console.log();
  }
}

// 全局单例
export const logger = new Logger();
