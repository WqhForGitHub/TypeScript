#!/usr/bin/env node
/**
 * 倒计时计时器 (增强版)
 * ---------------------------
 * 使用方式：
 *   countdown-cli 30                    → 倒计时 30 秒
 *   countdown-cli 1m30s                 → 倒计时 1 分 30 秒
 *   countdown-cli 1h                    → 倒计时 1 小时
 *   countdown-cli 1d2h3m4s              → 倒计时 1 天 2 小时 3 分 4 秒
 *   countdown-cli --to "2026-01-01 00:00:00"   → 倒计时到指定时间
 *   countdown-cli --stopwatch           → 秒表模式
 *   countdown-cli --pomodoro            → 番茄钟模式
 *   countdown-cli --help                → 显示帮助
 */

// ============================================================
// 1. 枚举
// ============================================================

enum TimeUnit {
  Days = "d",
  Hours = "h",
  Minutes = "m",
  Seconds = "s",
}

enum TimerState {
  Idle = "idle",
  Running = "running",
  Paused = "paused",
  Finished = "finished",
}

enum TimerMode {
  Countdown = "countdown",
  Stopwatch = "stopwatch",
  Pomodoro = "pomodoro",
}

enum PomodoroPhase {
  Work = "work",
  ShortBreak = "short_break",
  LongBreak = "long_break",
}

enum AnsiColor {
  Reset = "\x1b[0m",
  Red = "\x1b[31m",
  Green = "\x1b[32m",
  Yellow = "\x1b[33m",
  Blue = "\x1b[34m",
  Cyan = "\x1b[36m",
  Bold = "\x1b[1m",
}

// ============================================================
// 2. 接口（含 readonly / optional）
// ============================================================

interface TimeParts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

interface ParsedArgs {
  readonly totalMs: number;
  readonly mode: TimerMode;
  readonly targetTime: Date | null;
  readonly verbose: boolean;
  readonly color: boolean;
  readonly pomodoroCycles: number;
}

interface LapRecord {
  readonly id: number;
  readonly label: string;
  readonly elapsedMs: number;
  readonly timestamp: Date;
}

interface TimerEvent {
  readonly type: TimerState;
  readonly timestamp: Date;
  readonly remainingMs: number;
}

interface PomodoroConfig {
  readonly workMinutes: number;
  readonly shortBreakMinutes: number;
  readonly longBreakMinutes: number;
  readonly cyclesBeforeLongBreak: number;
}

// ============================================================
// 3. 映射类型
// ============================================================

type ReadonlyTimeParts = { readonly [K in keyof TimeParts]: TimeParts[K] };
type TimerStateTransition = {
  readonly [K in TimerState]: readonly TimerState[];
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type PartialParsedArgs = Partial<Mutable<ParsedArgs>>;

// ============================================================
// 4. 条件类型
// ============================================================

type FormattedDuration<T extends "short" | "long"> = T extends "short"
  ? `${number}:${number}:${number}`
  : `${number}天 ${number}时 ${number}分 ${number}秒`;

// ============================================================
// 5. 模板字面量类型
// ============================================================

type DurationString = `${number}${TimeUnit}`;
type IsoDateTime =
  `${number}-${number}-${number} ${number}:${number}:${number}`;

// ============================================================
// 6. 判别联合 (事件系统)
// ============================================================

type CountdownEvent =
  | { readonly type: "tick"; readonly remainingMs: number }
  | {
      readonly type: "state_change";
      readonly from: TimerState;
      readonly to: TimerState;
    }
  | { readonly type: "lap"; readonly lap: LapRecord }
  | { readonly type: "finished"; readonly totalElapsed: number }
  | { readonly type: "error"; readonly message: string };

// ============================================================
// 7. 自定义错误类层级
// ============================================================

class TimerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class InvalidDurationError extends TimerError {
  constructor(value: string) {
    super(`无效的持续时间格式: "${value}"`, "INVALID_DURATION");
  }
}

class InvalidDateTimeError extends TimerError {
  constructor(value: string) {
    super(`无效的日期时间: "${value}"`, "INVALID_DATETIME");
  }
}

class InvalidStateTransitionError extends TimerError {
  constructor(from: TimerState, to: TimerState) {
    super(`非法状态转换: ${from} → ${to}`, "INVALID_TRANSITION");
  }
}

// ============================================================
// 8. 状态转换表 (as const + satisfies)
// ============================================================

const STATE_TRANSITIONS = {
  [TimerState.Idle]: [TimerState.Running] as readonly TimerState[],
  [TimerState.Running]: [
    TimerState.Paused,
    TimerState.Finished,
  ] as readonly TimerState[],
  [TimerState.Paused]: [
    TimerState.Running,
    TimerState.Finished,
  ] as readonly TimerState[],
  [TimerState.Finished]: [TimerState.Idle] as readonly TimerState[],
} as const satisfies TimerStateTransition;

const POMODORO_CONFIG: PomodoroConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
} as const;

const UNIT_MS: Record<TimeUnit, number> = {
  [TimeUnit.Days]: 86400000,
  [TimeUnit.Hours]: 3600000,
  [TimeUnit.Minutes]: 60000,
  [TimeUnit.Seconds]: 1000,
} as const satisfies Record<TimeUnit, number>;

// ============================================================
// 9. 类型守卫
// ============================================================

function isTimeUnit(value: string): value is TimeUnit {
  return Object.values(TimeUnit).includes(value as TimeUnit);
}

function isTimerMode(value: string): value is TimerMode {
  return Object.values(TimerMode).includes(value as TimerMode);
}

function isTimerState(value: string): value is TimerState {
  return Object.values(TimerState).includes(value as TimerState);
}

function canTransition(from: TimerState, to: TimerState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

// ============================================================
// 10. 泛型事件发射器
// ============================================================

type EventHandler<T extends CountdownEvent["type"]> = (
  event: Extract<CountdownEvent, { readonly type: T }>,
) => void;

class EventEmitter {
  private readonly handlers = new Map<
    CountdownEvent["type"],
    Set<EventHandler<CountdownEvent["type"]>>
  >();

  on<T extends CountdownEvent["type"]>(
    type: T,
    handler: EventHandler<T>,
  ): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers
      .get(type)!
      .add(handler as unknown as EventHandler<CountdownEvent["type"]>);
  }

  emit(event: CountdownEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        (handler as (e: CountdownEvent) => void)(event);
      }
    }
  }
}

// ============================================================
// 11. 泛型栈
// ============================================================

class Stack<T> {
  private readonly items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}

// ============================================================
// 12. 时间解析与格式化
// ============================================================

function parseDuration(input: string): number {
  if (/^\d+$/.test(input.trim())) {
    return parseInt(input, 10) * UNIT_MS[TimeUnit.Seconds];
  }

  const regex = /(\d+)([dhms])/g;
  let totalMs = 0;
  let matched = false;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    matched = true;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (isTimeUnit(unit)) {
      totalMs += value * UNIT_MS[unit];
    }
  }

  if (!matched) throw new InvalidDurationError(input);
  return totalMs;
}

function parseDateTime(input: string): Date {
  const date = new Date(input.replace(" ", "T"));
  if (isNaN(date.getTime())) throw new InvalidDateTimeError(input);
  return date;
}

function msToTimeParts(ms: number): TimeParts {
  const absMs = Math.abs(ms);
  const days = Math.floor(absMs / UNIT_MS[TimeUnit.Days]);
  const hours = Math.floor(
    (absMs % UNIT_MS[TimeUnit.Days]) / UNIT_MS[TimeUnit.Hours],
  );
  const minutes = Math.floor(
    (absMs % UNIT_MS[TimeUnit.Hours]) / UNIT_MS[TimeUnit.Minutes],
  );
  const seconds = Math.floor(
    (absMs % UNIT_MS[TimeUnit.Minutes]) / UNIT_MS[TimeUnit.Seconds],
  );
  return { days, hours, minutes, seconds };
}

function formatTime(ms: number, showDays: boolean = false): string {
  const parts = msToTimeParts(ms);
  if (showDays || parts.days > 0) {
    return `${parts.days}d ${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}:${String(parts.seconds).padStart(2, "0")}`;
  }
  return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}:${String(parts.seconds).padStart(2, "0")}`;
}

function formatLong(ms: number): string {
  const parts = msToTimeParts(ms);
  const segments: string[] = [];
  if (parts.days > 0) segments.push(`${parts.days}天`);
  if (parts.hours > 0) segments.push(`${parts.hours}时`);
  if (parts.minutes > 0) segments.push(`${parts.minutes}分`);
  segments.push(`${parts.seconds}秒`);
  return segments.join(" ");
}

// ============================================================
// 13. 抽象计时器基类
// ============================================================

abstract class BaseTimer {
  protected state: TimerState = TimerState.Idle;
  protected startTime: number = 0;
  protected pausedElapsed: number = 0;
  protected readonly emitter = new EventEmitter();
  protected readonly events: TimerEvent[] = [];
  protected readonly maxEvents: number;

  constructor(maxEvents: number = 500) {
    this.maxEvents = maxEvents;
  }

  get currentState(): TimerState {
    return this.state;
  }

  protected transitionTo(newState: TimerState): void {
    if (this.state === newState) return;
    if (!canTransition(this.state, newState)) {
      throw new InvalidStateTransitionError(this.state, newState);
    }
    const event: TimerEvent = {
      type: newState,
      timestamp: new Date(),
      remainingMs: this.getRemainingMs(),
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();

    this.emitter.emit({ type: "state_change", from: this.state, to: newState });
    this.state = newState;
  }

  abstract getElapsedMs(): number;
  abstract getRemainingMs(): number;

  start(): void {
    if (this.state === TimerState.Running) return;
    this.transitionTo(TimerState.Running);
    this.startTime = Date.now();
  }

  pause(): void {
    if (this.state !== TimerState.Running) return;
    this.pausedElapsed += Date.now() - this.startTime;
    this.transitionTo(TimerState.Paused);
  }

  resume(): void {
    if (this.state !== TimerState.Paused) return;
    this.transitionTo(TimerState.Running);
    this.startTime = Date.now();
  }

  stop(): void {
    if (this.state === TimerState.Idle) return;
    if (this.state === TimerState.Running) {
      this.pausedElapsed += Date.now() - this.startTime;
    }
    this.transitionTo(TimerState.Finished);
  }

  reset(): void {
    this.state = TimerState.Idle;
    this.startTime = 0;
    this.pausedElapsed = 0;
    this.events.length = 0;
  }

  on<T extends CountdownEvent["type"]>(
    type: T,
    handler: EventHandler<T>,
  ): void {
    this.emitter.on(type, handler);
  }

  getHistory(): readonly TimerEvent[] {
    return [...this.events];
  }
}

// ============================================================
// 14. 倒计时计时器
// ============================================================

class CountdownTimer extends BaseTimer {
  private readonly durationMs: number;
  private finishedAt: number | null = null;

  constructor(durationMs: number) {
    super();
    if (durationMs <= 0)
      throw new TimerError("持续时间必须大于 0", "INVALID_DURATION");
    this.durationMs = durationMs;
  }

  getElapsedMs(): number {
    if (this.state === TimerState.Idle) return 0;
    if (this.state === TimerState.Running) {
      return this.pausedElapsed + (Date.now() - this.startTime);
    }
    return this.pausedElapsed;
  }

  getRemainingMs(): number {
    if (this.finishedAt !== null) return 0;
    return Math.max(0, this.durationMs - this.getElapsedMs());
  }

  start(): void {
    super.start();
    this.finishedAt = null;
  }

  tick(): void {
    if (this.state !== TimerState.Running) return;
    const remaining = this.getRemainingMs();
    this.emitter.emit({ type: "tick", remainingMs: remaining });

    if (remaining <= 0) {
      this.pausedElapsed = this.durationMs;
      this.finishedAt = Date.now();
      this.transitionTo(TimerState.Finished);
      this.emitter.emit({ type: "finished", totalElapsed: this.durationMs });
    }
  }
}

// ============================================================
// 15. 秒表计时器（含圈速）
// ============================================================

class StopwatchTimer extends BaseTimer {
  private readonly laps: LapRecord[] = [];
  private lapId = 1;
  private lastLapMs: number = 0;

  getElapsedMs(): number {
    if (this.state === TimerState.Idle) return 0;
    if (this.state === TimerState.Running) {
      return this.pausedElapsed + (Date.now() - this.startTime);
    }
    return this.pausedElapsed;
  }

  getRemainingMs(): number {
    return -this.getElapsedMs();
  }

  recordLap(label?: string): LapRecord {
    const elapsed = this.getElapsedMs();
    const lap: LapRecord = {
      id: this.lapId++,
      label: label ?? `圈 ${this.lapId - 1}`,
      elapsedMs: elapsed - this.lastLapMs,
      timestamp: new Date(),
    };
    this.lastLapMs = elapsed;
    this.laps.push(lap);
    this.emitter.emit({ type: "lap", lap });
    return lap;
  }

  getLaps(): readonly LapRecord[] {
    return [...this.laps];
  }

  getFastestLap(): LapRecord | undefined {
    return this.laps.length > 0
      ? this.laps.reduce((min, lap) =>
          lap.elapsedMs < min.elapsedMs ? lap : min,
        )
      : undefined;
  }

  getSlowestLap(): LapRecord | undefined {
    return this.laps.length > 0
      ? this.laps.reduce((max, lap) =>
          lap.elapsedMs > max.elapsedMs ? lap : max,
        )
      : undefined;
  }
}

// ============================================================
// 16. 番茄钟计时器
// ============================================================

class PomodoroTimer {
  private readonly config: PomodoroConfig;
  private currentPhase: PomodoroPhase = PomodoroPhase.Work;
  private completedWorkCycles = 0;
  private readonly emitter = new EventEmitter();
  private intervalId: NodeJS.Timeout | null = null;
  private currentTimer: CountdownTimer | null = null;

  constructor(config: PomodoroConfig = POMODORO_CONFIG) {
    this.config = config;
  }

  get phase(): PomodoroPhase {
    return this.currentPhase;
  }

  get completedCycles(): number {
    return this.completedWorkCycles;
  }

  private phaseDurationMs(phase: PomodoroPhase): number {
    switch (phase) {
      case PomodoroPhase.Work:
        return this.config.workMinutes * UNIT_MS[TimeUnit.Minutes];
      case PomodoroPhase.ShortBreak:
        return this.config.shortBreakMinutes * UNIT_MS[TimeUnit.Minutes];
      case PomodoroPhase.LongBreak:
        return this.config.longBreakMinutes * UNIT_MS[TimeUnit.Minutes];
    }
  }

  private nextPhase(): PomodoroPhase {
    if (this.currentPhase === PomodoroPhase.Work) {
      this.completedWorkCycles++;
      if (this.completedWorkCycles % this.config.cyclesBeforeLongBreak === 0) {
        return PomodoroPhase.LongBreak;
      }
      return PomodoroPhase.ShortBreak;
    }
    return PomodoroPhase.Work;
  }

  start(): void {
    this.runPhase(this.currentPhase);
  }

  private runPhase(phase: PomodoroPhase): void {
    this.currentPhase = phase;
    const duration = this.phaseDurationMs(phase);
    this.currentTimer = new CountdownTimer(duration);

    const label =
      phase === PomodoroPhase.Work
        ? "工作"
        : phase === PomodoroPhase.ShortBreak
          ? "短休息"
          : "长休息";
    console.log(
      colorize(
        `\n[番茄钟] ${label}阶段开始 (${formatTime(duration)})`,
        AnsiColor.Cyan,
        true,
      ),
    );

    this.intervalId = setInterval(() => {
      if (this.currentTimer) {
        this.currentTimer.tick();
        const remaining = this.currentTimer.getRemainingMs();
        process.stdout.write(`\r  剩余: ${formatTime(remaining)}   `);

        if (this.currentTimer.currentState === TimerState.Finished) {
          if (this.intervalId) clearInterval(this.intervalId);
          console.log(colorize("\n  阶段完成! 🔔", AnsiColor.Green, true));
          const next = this.nextPhase();
          setTimeout(() => this.runPhase(next), 1000);
        }
      }
    }, 100);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(colorize("\n[番茄钟] 已停止", AnsiColor.Yellow, true));
  }
}

// ============================================================
// 17. 工具函数
// ============================================================

function colorize(text: string, color: AnsiColor, enabled: boolean): string {
  return enabled ? `${color}${text}${AnsiColor.Reset}` : text;
}

function renderProgressBar(progress: number, width: number = 30): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${(progress * 100).toFixed(1)}%`;
}

// ============================================================
// 18. 参数解析
// ============================================================

function parseArgs(args: string[]): ParsedArgs {
  const options: PartialParsedArgs = {
    mode: TimerMode.Countdown,
    verbose: false,
    color: true,
    pomodoroCycles: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--to":
      case "-t": {
        const val = args[++i];
        if (!val) throw new InvalidDateTimeError("缺少时间参数");
        options.targetTime = parseDateTime(val);
        options.mode = TimerMode.Countdown;
        break;
      }
      case "--stopwatch":
        options.mode = TimerMode.Stopwatch;
        break;
      case "--pomodoro":
        options.mode = TimerMode.Pomodoro;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      default: {
        if (!arg.startsWith("-")) {
          options.totalMs = parseDuration(arg);
        }
        break;
      }
    }
  }

  return options as ParsedArgs;
}

// ============================================================
// 19. 帮助信息
// ============================================================

function printHelp(): void {
  console.log(`
Usage: countdown-cli [options] [duration]

Duration:
  30                    30 秒
  1m30s                 1 分 30 秒
  1h                    1 小时
  1d2h3m4s              1 天 2 时 3 分 4 秒

Options:
  -t, --to <datetime>   倒计时到指定时间 (如 "2026-01-01 00:00:00")
  --stopwatch           秒表模式（正计时）
  --pomodoro            番茄钟模式 (25分钟工作 / 5分钟休息)
  -v, --verbose         详细输出
  --no-color            禁用彩色输出
  -h, --help            显示此帮助信息

Interactive Commands (during timer):
  Enter                 暂停/继续
  l                     记录圈速 (秒表模式)
  q                     退出
`);
}

// ============================================================
// 20. 运行器
// ============================================================

function runCountdown(
  durationMs: number,
  verbose: boolean,
  color: boolean,
): void {
  const timer = new CountdownTimer(durationMs);
  const totalMs = durationMs;

  timer.on("finished", () => {
    console.log(colorize("\n\n倒计时结束! 🎉", AnsiColor.Green, color));
    process.stdout.write("\x07");
  });

  if (verbose) {
    timer.on("state_change", (e) => {
      console.error(
        colorize(`[state] ${e.from} → ${e.to}`, AnsiColor.Yellow, color),
      );
    });
  }

  timer.start();

  const intervalId = setInterval(() => {
    timer.tick();
    const remaining = timer.getRemainingMs();
    const elapsed = timer.getElapsedMs();
    const progress = elapsed / totalMs;

    const bar = colorize(renderProgressBar(progress), AnsiColor.Cyan, color);
    const time = colorize(formatTime(remaining, true), AnsiColor.Bold, color);
    process.stdout.write(`\r  ${bar}  ${time}  `);

    if (timer.currentState === TimerState.Finished) {
      clearInterval(intervalId);
    }
  }, 100);
}

function runStopwatch(verbose: boolean, color: boolean): void {
  const timer = new StopwatchTimer();

  timer.on("lap", (e) => {
    console.log(
      colorize(
        `\n  圈 ${e.lap.id}: ${formatLong(e.lap.elapsedMs)} (${e.lap.label})`,
        AnsiColor.Cyan,
        color,
      ),
    );
  });

  timer.start();
  console.log(
    colorize(
      "秒表已启动。按 Enter 记录圈速，按 q 退出。",
      AnsiColor.Green,
      color,
    ),
  );

  const intervalId = setInterval(() => {
    const elapsed = timer.getElapsedMs();
    process.stdout.write(
      `\r  已用时: ${colorize(formatTime(elapsed, true), AnsiColor.Bold, color)}  圈速数: ${timer.getLaps().length}  `,
    );
  }, 100);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    const key = data.toString();
    if (key === "q" || key === "\x03") {
      clearInterval(intervalId);
      timer.stop();
      const laps = timer.getLaps();
      console.log(colorize("\n\n=== 秒表结果 ===", AnsiColor.Bold, color));
      laps.forEach((lap) => {
        console.log(
          `  圈 ${lap.id}: ${formatLong(lap.elapsedMs)} (${lap.label})`,
        );
      });
      const fastest = timer.getFastestLap();
      const slowest = timer.getSlowestLap();
      if (fastest)
        console.log(
          colorize(
            `  最快圈: 圈 ${fastest.id} (${formatLong(fastest.elapsedMs)})`,
            AnsiColor.Green,
            color,
          ),
        );
      if (slowest)
        console.log(
          colorize(
            `  最慢圈: 圈 ${slowest.id} (${formatLong(slowest.elapsedMs)})`,
            AnsiColor.Red,
            color,
          ),
        );
      process.exit(0);
    }
    if (key === "\r" || key === "\n") {
      timer.recordLap();
    }
  });
}

function runCountdownToTarget(
  target: Date,
  verbose: boolean,
  color: boolean,
): void {
  const now = Date.now();
  const targetMs = target.getTime();
  const diff = targetMs - now;

  if (diff <= 0) {
    console.log(colorize("目标时间已过!", AnsiColor.Red, color));
    process.exit(1);
  }

  console.log(
    colorize(`目标时间: ${target.toLocaleString()}`, AnsiColor.Cyan, color),
  );
  runCountdown(diff, verbose, color);
}

function runPomodoro(color: boolean): void {
  console.log(colorize("=== 番茄钟模式 ===", AnsiColor.Bold, color));
  console.log(
    colorize(
      `工作: ${POMODORO_CONFIG.workMinutes}分钟 | 短休息: ${POMODORO_CONFIG.shortBreakMinutes}分钟 | 长休息: ${POMODORO_CONFIG.longBreakMinutes}分钟`,
      AnsiColor.Cyan,
      color,
    ),
  );
  console.log(colorize("按 Ctrl+C 退出\n", AnsiColor.Yellow, color));

  const pomodoro = new PomodoroTimer(POMODORO_CONFIG);
  pomodoro.start();

  process.on("SIGINT", () => {
    pomodoro.stop();
    process.exit(0);
  });
}

// ============================================================
// 21. 主入口
// ============================================================

function main(): void {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg =
      err instanceof TimerError ? `[${err.code}] ${err.message}` : String(err);
    console.error(`错误: ${msg}`);
    process.exit(1);
  }

  switch (args.mode) {
    case TimerMode.Stopwatch:
      runStopwatch(args.verbose, args.color);
      break;
    case TimerMode.Pomodoro:
      runPomodoro(args.color);
      break;
    case TimerMode.Countdown:
    default:
      if (args.targetTime) {
        runCountdownToTarget(args.targetTime, args.verbose, args.color);
      } else if (args.totalMs && args.totalMs > 0) {
        runCountdown(args.totalMs, args.verbose, args.color);
      } else {
        printHelp();
      }
      break;
  }
}

main();
