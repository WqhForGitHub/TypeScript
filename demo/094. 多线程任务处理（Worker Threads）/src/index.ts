#!/usr/bin/env node

/**
 * 多线程任务处理（Worker Threads）演示
 *
 * 功能：
 * 1. 使用 Node.js Worker Threads 创建多线程任务处理
 * 2. 实现 Worker 线程池，自动分发和调度任务（带优先级队列）
 * 3. 支持 main ↔ worker 双向消息通信
 * 4. CPU 密集型任务对比：单线程 vs 多线程性能测试
 * 5. 支持 SharedArrayBuffer 共享内存方式通信
 * 6. 完善的错误处理和优雅退出机制
 *
 * 使用方式：npm run dev
 */

import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
  MessageChannel,
  MessagePort,
} from "worker_threads";
import * as os from "os";

// ========== 枚举 ==========

enum TaskType {
  FindPrimes = "findPrimes",
  Fibonacci = "fibonacci",
  MatrixMultiply = "matrixMultiply",
}
enum ErrorCode {
  WorkerCrashed = "WORKER_CRASHED",
  TaskRejected = "TASK_REJECTED",
  Timeout = "TIMEOUT",
  Cancelled = "CANCELLED",
  Unknown = "UNKNOWN",
}
enum WorkerState {
  Idle = "idle",
  Busy = "busy",
  Terminated = "terminated",
}
enum TaskPriority {
  Low = "low",
  Normal = "normal",
  High = "high",
  Critical = "critical",
}

const PRIORITY_WEIGHT = {
  [TaskPriority.Low]: 1,
  [TaskPriority.Normal]: 2,
  [TaskPriority.High]: 3,
  [TaskPriority.Critical]: 4,
} as const satisfies Record<TaskPriority, number>;

// ========== 类型与接口 ==========

interface Identifiable {
  readonly id: number;
}
interface Range {
  readonly start: number;
  readonly end: number;
}
interface FibonacciInput {
  readonly n: number;
}
interface MatrixInput {
  readonly a: number[][];
  readonly b: number[][];
}

interface Task<T = unknown> {
  readonly id: number;
  readonly type: TaskType;
  readonly data: T;
}

/** 线程池选项：含可选 / readonly / 模板字面量索引签名 */
interface WorkerPoolOptions {
  readonly size?: number;
  readonly workerPath: string;
  readonly workerData?: Readonly<Record<string, unknown>>;
  readonly defaultPriority?: TaskPriority;
  readonly timeoutMs?: number;
  [extra: `opt_${string}`]: unknown;
}

interface PoolStatus {
  readonly total: number;
  readonly busy: number;
  readonly idle: number;
  readonly queued: number;
}
interface PoolMetrics {
  totalSubmitted: number;
  totalCompleted: number;
  totalErrors: number;
}
interface PoolDefaults {
  readonly size: number;
  readonly defaultPriority: TaskPriority;
  readonly timeoutMs: number;
}

// ========== 判别联合：任务结果 ==========

interface TaskSuccess<R = unknown> {
  readonly status: "success";
  readonly taskId: number;
  readonly result: R;
  readonly duration: number;
}
interface TaskError {
  readonly status: "error";
  readonly taskId: number;
  readonly error: string;
  readonly code: ErrorCode;
  readonly duration: number;
}
interface TaskTimeout {
  readonly status: "timeout";
  readonly taskId: number;
  readonly duration: number;
}
interface TaskCancelled {
  readonly status: "cancelled";
  readonly taskId: number;
  readonly reason: string;
}
type TaskOutcome<R = unknown> =
  TaskSuccess<R> | TaskError | TaskTimeout | TaskCancelled;

// ========== 映射类型 ==========

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ========== Worker 消息 ==========

interface WorkerTaskMessage {
  readonly type: "task";
  readonly task: Task;
}
interface WorkerResultMessage {
  readonly type: "result";
  readonly outcome: TaskOutcome;
}
interface WorkerLogMessage {
  readonly type: "log";
  readonly message: string;
}

// ========== 自定义错误层级 ==========

class WorkerError extends Error {
  readonly code: ErrorCode;
  readonly taskId?: number;
  constructor(message: string, code: ErrorCode, taskId?: number) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.taskId = taskId;
  }
}

class TaskTimeoutError extends WorkerError {
  constructor(taskId: number, timeoutMs: number) {
    super(
      `Task ${taskId} timed out after ${timeoutMs}ms`,
      ErrorCode.Timeout,
      taskId,
    );
    this.name = "TaskTimeoutError";
  }
}

class TaskCancelledError extends WorkerError {
  constructor(taskId: number, reason: string) {
    super(`Task ${taskId} cancelled: ${reason}`, ErrorCode.Cancelled, taskId);
    this.name = "TaskCancelledError";
  }
}

// ========== 工具函数 ==========

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

function findPrimes(start: number, end: number): number[] {
  const primes: number[] = [];
  for (let i = start; i <= end; i++) if (isPrime(i)) primes.push(i);
  return primes;
}

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  const rowsA = a.length,
    colsA = a[0].length,
    colsB = b[0].length;
  const result: number[][] = [];
  for (let i = 0; i < rowsA; i++) {
    result[i] = [];
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) sum += a[i][k] * b[k][j];
      result[i][j] = sum;
    }
  }
  return result;
}

// ========== 类型守卫 ==========

const isTaskSuccess = <R>(o: TaskOutcome<R>): o is TaskSuccess<R> =>
  o.status === "success";
const isTaskError = (o: TaskOutcome): o is TaskError => o.status === "error";
const isTaskTimeout = (o: TaskOutcome): o is TaskTimeout =>
  o.status === "timeout";
const isTaskCancelled = (o: TaskOutcome): o is TaskCancelled =>
  o.status === "cancelled";
const isAbstractTask = (x: unknown): x is AbstractTask =>
  x instanceof AbstractTask;
const isComputeTask = (x: AbstractTask): x is ComputeTask =>
  x instanceof ComputeTask;

// ========== 抽象任务类与具体子类 ==========

abstract class AbstractTask<T = unknown> implements Identifiable {
  readonly id: number;
  readonly data: T;
  priority: TaskPriority;
  readonly createdAt: number;
  constructor(
    id: number,
    data: T,
    priority: TaskPriority = TaskPriority.Normal,
  ) {
    this.id = id;
    this.data = data;
    this.priority = priority;
    this.createdAt = Date.now();
  }
  abstract readonly type: TaskType;
  abstract get description(): string;
  toMessage(): Task<T> {
    return { id: this.id, type: this.type, data: this.data };
  }
}

class ComputeTask<T = unknown> extends AbstractTask<T> {
  readonly type: TaskType;
  constructor(id: number, type: TaskType, data: T, priority?: TaskPriority) {
    super(id, data, priority);
    this.type = type;
  }
  get description(): string {
    return `Compute[${this.type}]#${this.id}`;
  }
  get estimatedComplexity(): number {
    return this.type === TaskType.Fibonacci
      ? (this.data as FibonacciInput).n
      : (this.data as Range).end - (this.data as Range).start;
  }
}

class TransformTask<T = unknown> extends AbstractTask<T> {
  readonly type: TaskType;
  constructor(id: number, type: TaskType, data: T, priority?: TaskPriority) {
    super(id, data, priority);
    this.type = type;
  }
  get description(): string {
    return `Transform[${this.type}]#${this.id}`;
  }
  get inputSize(): number {
    const d = this.data as MatrixInput;
    return d.a.length * (d.a[0]?.length ?? 0);
  }
}

class IoTask<T = unknown> extends AbstractTask<T> {
  readonly type: TaskType;
  constructor(id: number, type: TaskType, data: T, priority?: TaskPriority) {
    super(id, data, priority);
    this.type = type;
  }
  get description(): string {
    return `IO[${this.type}]#${this.id}`;
  }
}

// ========== 任务工厂（函数重载） ==========

function createTask(
  id: number,
  type: TaskType.FindPrimes | TaskType.Fibonacci,
  data: unknown,
  priority?: TaskPriority,
): ComputeTask;
function createTask(
  id: number,
  type: TaskType.MatrixMultiply,
  data: unknown,
  priority?: TaskPriority,
): TransformTask;
function createTask(
  id: number,
  type: TaskType,
  data: unknown,
  priority?: TaskPriority,
): AbstractTask;
function createTask(
  id: number,
  type: TaskType,
  data: unknown,
  priority: TaskPriority = TaskPriority.Normal,
): AbstractTask {
  switch (type) {
    case TaskType.FindPrimes:
    case TaskType.Fibonacci:
      return new ComputeTask(id, type, data, priority);
    case TaskType.MatrixMultiply:
      return new TransformTask(id, type, data, priority);
    default:
      return new IoTask(id, type, data, priority);
  }
}

// ========== 泛型任务队列（带约束 + 生成器迭代） ==========

interface QueueEntry<T extends Identifiable> {
  readonly item: T;
  readonly priority: TaskPriority;
  readonly sequence: number;
}

class TaskQueue<T extends Identifiable> {
  private entries: QueueEntry<T>[] = [];
  private sequence = 0;

  enqueue(item: T, priority: TaskPriority = TaskPriority.Normal): void {
    this.entries.push({ item, priority, sequence: this.sequence++ });
    this.entries.sort((a, b) => {
      const w = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      return w !== 0 ? w : a.sequence - b.sequence;
    });
  }

  dequeue(): T | undefined {
    return this.entries.shift()?.item;
  }
  get length(): number {
    return this.entries.length;
  }

  remove(id: number): T | undefined {
    const idx = this.entries.findIndex((e) => e.item.id === id);
    if (idx === -1) return undefined;
    return this.entries.splice(idx, 1)[0]?.item;
  }

  *[Symbol.iterator](): Generator<T, void, unknown> {
    for (const e of this.entries) yield e.item;
  }
}

// ========== 默认配置（satisfies） ==========

const DEFAULT_POOL_CONFIG = {
  size: os.cpus().length,
  defaultPriority: TaskPriority.Normal,
  timeoutMs: 30_000,
} satisfies PoolDefaults;

const kMetrics = Symbol("metrics");

// ========== Worker 线程逻辑 ==========

if (!isMainThread && parentPort) {
  const port = parentPort;
  const workerId: number = (workerData as { id?: number })?.id ?? -1;
  let channelPort: MessagePort | null = null;

  port.on("message", (msg: Record<string, unknown>) => {
    switch (msg.type as string) {
      case "task": {
        const task = (msg as unknown as WorkerTaskMessage).task;
        const startTime = Date.now();
        try {
          let result: unknown;
          switch (task.type) {
            case TaskType.FindPrimes: {
              const { start, end } = task.data as Range;
              result = findPrimes(start, end).length;
              break;
            }
            case TaskType.Fibonacci: {
              result = fibonacci((task.data as FibonacciInput).n);
              break;
            }
            case TaskType.MatrixMultiply: {
              const { a, b } = task.data as MatrixInput;
              result = multiplyMatrices(a, b);
              break;
            }
            default:
              throw new WorkerError(
                `未知任务类型: ${task.type}`,
                ErrorCode.Unknown,
                task.id,
              );
          }
          const outcome: TaskSuccess = {
            status: "success",
            taskId: task.id,
            result,
            duration: Date.now() - startTime,
          };
          port.postMessage({ type: "result", outcome } as WorkerResultMessage);
        } catch (err) {
          const outcome: TaskError = {
            status: "error",
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
            code: err instanceof WorkerError ? err.code : ErrorCode.Unknown,
            duration: Date.now() - startTime,
          };
          port.postMessage({ type: "result", outcome } as WorkerResultMessage);
        }
        break;
      }
      case "init-channel": {
        const { port: msgPort } = msg as { type: string; port: MessagePort };
        channelPort = msgPort;
        channelPort.on("message", (cm: Record<string, unknown>) => {
          if (cm.greeting) {
            channelPort?.postMessage({
              reply: `Worker-${workerId} 收到: "${cm.greeting}"`,
            });
          }
          if (cm.command === "compute" && typeof cm.value === "number") {
            const val = cm.value as number;
            channelPort?.postMessage({
              reply: `Worker-${workerId} 计算结果: fib(${val}) = ${fibonacci(val)}`,
            });
          }
        });
        channelPort.on("close", () => {
          channelPort = null;
        });
        port.postMessage({ type: "channel-ready" });
        break;
      }
      case "shared-task": {
        const { range, workerId: wid } = msg as {
          type: string;
          range: Range;
          workerId: number;
        };
        const count = findPrimes(range.start, range.end).length;
        const sharedBuffer = (
          workerData as { sharedBuffer?: SharedArrayBuffer }
        )?.sharedBuffer;
        if (sharedBuffer) {
          const sharedArray = new Int32Array(sharedBuffer);
          Atomics.add(sharedArray, wid + 1, count);
          Atomics.add(sharedArray, 0, count);
        }
        port.postMessage({ type: "shared-result", workerId: wid, count });
        port.postMessage({ type: "shared-done" });
        break;
      }
      default:
        break;
    }
  });

  port.postMessage({
    type: "log",
    message: `[Worker-${workerId}] 已就绪`,
  } as WorkerLogMessage);
}

// ========== 主线程：Worker 线程池 ==========

if (isMainThread) {
  class PoolWorker {
    readonly id: number;
    readonly worker: Worker;
    private _busy = false;
    private _terminated = false;
    currentTaskId: number | null = null;

    constructor(id: number, worker: Worker) {
      this.id = id;
      this.worker = worker;
    }
    get busy(): boolean {
      return this._busy;
    }
    set busy(value: boolean) {
      this._busy = value;
    }
    get state(): WorkerState {
      if (this._terminated) return WorkerState.Terminated;
      return this._busy ? WorkerState.Busy : WorkerState.Idle;
    }
    async terminate(): Promise<number> {
      this._terminated = true;
      this._busy = false;
      return this.worker.terminate();
    }
  }

  class WorkerPool {
    private workers: PoolWorker[] = [];
    private taskQueue: TaskQueue<AbstractTask> = new TaskQueue();
    private resultCallbacks = new Map<number, (o: TaskOutcome) => void>();
    private nextTaskId = 1;
    private _size: number;
    private _terminated = false;
    private readonly workerPath: string;
    private readonly initData: Readonly<Record<string, unknown>>;
    private readonly defaultPriority: TaskPriority;
    readonly timeoutMs: number;
    [kMetrics]: PoolMetrics = {
      totalSubmitted: 0,
      totalCompleted: 0,
      totalErrors: 0,
    };

    constructor(options: WorkerPoolOptions) {
      this._size = options.size ?? DEFAULT_POOL_CONFIG.size;
      this.workerPath = options.workerPath;
      this.initData = options.workerData ?? {};
      this.defaultPriority =
        options.defaultPriority ?? DEFAULT_POOL_CONFIG.defaultPriority;
      this.timeoutMs = options.timeoutMs ?? DEFAULT_POOL_CONFIG.timeoutMs;
    }

    get size(): number {
      return this._size;
    }
    set size(value: number) {
      if (value < 1)
        throw new WorkerError("size 必须 >= 1", ErrorCode.TaskRejected);
      this._size = value;
    }
    get status(): PoolStatus {
      const busy = this.workers.filter((w) => w.busy).length;
      return {
        total: this.workers.length,
        busy,
        idle: this.workers.length - busy,
        queued: this.taskQueue.length,
      };
    }
    get metrics(): PoolMetrics {
      return { ...this[kMetrics] };
    }
    get terminated(): boolean {
      return this._terminated;
    }

    *iterateWorkers(): Generator<PoolWorker, void, unknown> {
      for (const w of this.workers) yield w;
    }

    async init(): Promise<void> {
      const initPromises: Promise<void>[] = [];
      for (let i = 0; i < this._size; i++)
        initPromises.push(this.createWorker(i));
      await Promise.all(initPromises);
      console.log(`✅ 线程池已初始化，共 ${this._size} 个 Worker 线程`);
    }

    private createWorker(id: number): Promise<void> {
      return new Promise((resolve) => {
        const worker = new Worker(this.workerPath, {
          workerData: { ...this.initData, id },
        });
        const poolWorker = new PoolWorker(id, worker);

        worker.on("message", (msg: WorkerResultMessage | WorkerLogMessage) => {
          if (msg.type === "log") {
            console.log(msg.message);
            return;
          }
          if (msg.type === "result") {
            const { outcome } = msg;
            poolWorker.busy = false;
            poolWorker.currentTaskId = null;
            if (isTaskError(outcome)) this[kMetrics].totalErrors++;
            else if (isTaskSuccess(outcome)) this[kMetrics].totalCompleted++;
            const cb = this.resultCallbacks.get(outcome.taskId);
            if (cb) {
              this.resultCallbacks.delete(outcome.taskId);
              cb(outcome);
            }
            this.dispatchNext(poolWorker);
          }
        });

        worker.on("error", (err) => {
          console.error(`❌ Worker-${id} 发生错误:`, err.message);
          poolWorker.busy = false;
          poolWorker.currentTaskId = null;
          this.dispatchNext(poolWorker);
        });

        worker.on("exit", (code) => {
          if (code !== 0 && !this._terminated)
            console.error(`⚠️  Worker-${id} 退出，退出码: ${code}`);
        });

        this.workers.push(poolWorker);
        const ready = (msg: WorkerLogMessage) => {
          if (msg.type === "log") {
            worker.off("message", ready);
            resolve();
          }
        };
        worker.on("message", ready);
      });
    }

    submit<R = unknown>(task: AbstractTask): Promise<TaskOutcome<R>>;
    submit<T = unknown, R = unknown>(
      type: TaskType,
      data: T,
      priority?: TaskPriority,
    ): Promise<TaskOutcome<R>>;
    submit<R = unknown>(
      taskOrType: AbstractTask | TaskType,
      data?: unknown,
      priority?: TaskPriority,
    ): Promise<TaskOutcome<R>> {
      return new Promise<TaskOutcome<R>>((resolve, reject) => {
        if (this._terminated) {
          reject(new WorkerError("线程池已关闭", ErrorCode.TaskRejected));
          return;
        }
        let task: AbstractTask;
        if (isAbstractTask(taskOrType)) {
          task = taskOrType;
        } else {
          task = createTask(
            this.nextTaskId++,
            taskOrType,
            data,
            priority ?? this.defaultPriority,
          );
        }
        this[kMetrics].totalSubmitted++;
        this.resultCallbacks.set(task.id, (o) => resolve(o as TaskOutcome<R>));
        const idle = this.workers.find((w) => !w.busy);
        if (idle) this.dispatch(idle, task);
        else this.taskQueue.enqueue(task, task.priority);
      });
    }

    private dispatch(worker: PoolWorker, task: AbstractTask): void {
      worker.busy = true;
      worker.currentTaskId = task.id;
      const msg: WorkerTaskMessage = { type: "task", task: task.toMessage() };
      worker.worker.postMessage(msg);
    }

    private dispatchNext(worker: PoolWorker): void {
      if (this.taskQueue.length > 0 && !worker.busy) {
        const next = this.taskQueue.dequeue();
        if (next) this.dispatch(worker, next);
      }
    }

    async terminate(): Promise<void> {
      this._terminated = true;
      await Promise.all(this.workers.map((w) => w.terminate()));
      console.log("🔒 线程池已关闭");
    }
  }

  // ========== TypeScript 高级特性展示 ==========

  function showcase_features(): void {
    console.log("\n" + "=".repeat(60));
    console.log("📋 TypeScript 高级特性展示");
    console.log("=".repeat(60));
    const t1 = createTask(1, TaskType.Fibonacci, { n: 10 }, TaskPriority.High);
    const t2 = createTask(2, TaskType.FindPrimes, { start: 1, end: 100 });
    const t3 = createTask(3, TaskType.MatrixMultiply, {
      a: [[1, 2]],
      b: [[3], [4]],
    });
    for (const t of [t1, t2, t3]) {
      if (isComputeTask(t))
        console.log(`  ${t.description} 复杂度=${t.estimatedComplexity}`);
      else if (t instanceof TransformTask)
        console.log(`  ${t.description} 输入规模=${t.inputSize}`);
    }
    const queue = new TaskQueue<AbstractTask>();
    queue.enqueue(t1, TaskPriority.Low);
    queue.enqueue(t2, TaskPriority.Critical);
    queue.enqueue(t3, TaskPriority.Normal);
    console.log("  队列按优先级排序（Critical → Normal → Low）：");
    for (const t of queue)
      console.log(`    - ${t.description} [${t.priority}]`);
    type MR = Mutable<Range>;
    const mr: MR = { start: 5, end: 10 };
    mr.start = 7;
    console.log(`  Mutable<Range>: start=${mr.start}, end=${mr.end}`);
    const fibNums = [35, 36, 37, 38, 39, 40] as const;
    console.log(`  as const 元组: [${fibNums.join(", ")}]`);
    const e1 = new TaskTimeoutError(42, 5000);
    const e2 = new TaskCancelledError(7, "用户主动取消");
    console.log(`  ${e1.name}: ${e1.message} code=${e1.code}`);
    console.log(`  ${e2.name}: ${e2.message} code=${e2.code}`);
  }

  // ========== 演示函数 ==========

  function singleThreadFindPrimesTime(
    start: number,
    end: number,
    chunkSize: number,
  ): number {
    const t0 = Date.now();
    for (let s = start; s <= end; s += chunkSize)
      findPrimes(s, Math.min(s + chunkSize - 1, end));
    return Date.now() - t0;
  }

  async function demo1_basicPool(): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("📋 演示 1：Worker 线程池基础使用");
    console.log("=".repeat(60));
    const pool = new WorkerPool({ size: 4, workerPath: __filename });
    await pool.init();
    const ranges: Range[] = [
      { start: 1, end: 100_000 },
      { start: 100_001, end: 200_000 },
      { start: 200_001, end: 300_000 },
      { start: 300_001, end: 400_000 },
      { start: 400_001, end: 500_000 },
      { start: 500_001, end: 600_000 },
    ];
    console.log(`\n📤 提交 ${ranges.length} 个质数查找任务...`);
    const promises = ranges.map((r, i) =>
      pool.submit<Range, number>(
        TaskType.FindPrimes,
        r,
        i < 3 ? TaskPriority.High : TaskPriority.Normal,
      ),
    );
    const outcomes = await Promise.all(promises);
    console.log("\n📊 任务执行结果：");
    for (const o of outcomes) {
      if (isTaskSuccess(o))
        console.log(
          `  ✅ 任务 #${o.taskId} | 耗时: ${o.duration}ms | 找到 ${o.result} 个质数`,
        );
      else if (isTaskError(o))
        console.log(`  ❌ 任务 #${o.taskId} 出错: ${o.error} (${o.code})`);
      else if (isTaskTimeout(o)) console.log(`  ⏰ 任务 #${o.taskId} 超时`);
      else if (isTaskCancelled(o))
        console.log(`  🚫 任务 #${o.taskId} 取消: ${o.reason}`);
    }
    console.log(`\n📈 线程池状态:`, pool.status);
    console.log(`📈 统计指标:`, pool.metrics);
    for (const w of pool.iterateWorkers())
      console.log(`  Worker-${w.id} state=${w.state}`);
    await pool.terminate();
  }

  async function demo2_performanceComparison(): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("📋 演示 2：单线程 vs 多线程性能对比");
    console.log("=".repeat(60));
    const RANGE_START = 1,
      RANGE_END = 2_000_000,
      CHUNK_SIZE = 100_000;
    const WORKER_COUNT = os.cpus().length;
    console.log("\n🔄 单线程模式：查找 1 ~ 2,000,000 中的质数...");
    const singleTime = singleThreadFindPrimesTime(
      RANGE_START,
      RANGE_END,
      CHUNK_SIZE,
    );
    console.log(`  ⏱️  单线程耗时: ${singleTime}ms`);
    console.log(
      `\n🔄 多线程模式（${WORKER_COUNT} 个 Worker）：查找 1 ~ 2,000,000 中的质数...`,
    );
    const pool = new WorkerPool({ size: WORKER_COUNT, workerPath: __filename });
    await pool.init();
    const tasks: { type: TaskType; data: Range }[] = [];
    for (let s = RANGE_START; s <= RANGE_END; s += CHUNK_SIZE) {
      tasks.push({
        type: TaskType.FindPrimes,
        data: { start: s, end: Math.min(s + CHUNK_SIZE - 1, RANGE_END) },
      });
    }
    const multiStart = Date.now();
    await Promise.all(
      tasks.map((t) => pool.submit<Range, number>(t.type, t.data)),
    );
    const multiTime = Date.now() - multiStart;
    console.log(`  ⏱️  多线程耗时: ${multiTime}ms`);
    console.log("\n📊 性能对比：");
    console.log(`  单线程: ${singleTime}ms`);
    console.log(`  多线程: ${multiTime}ms`);
    console.log(`  加速比: ${(singleTime / multiTime).toFixed(2)}x`);
    await pool.terminate();
  }

  async function demo3_messageChannel(): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("📋 演示 3：MessageChannel 双向通信");
    console.log("=".repeat(60));
    const worker = new Worker(__filename, { workerData: { id: 99 } });
    const { port1, port2 } = new MessageChannel();
    port1.on("message", (msg: { reply?: string }) =>
      console.log(`  📨 主线程收到: ${msg.reply}`),
    );
    worker.postMessage({ type: "init-channel", port: port2 }, [port2]);
    await new Promise<void>((resolve) => {
      worker.on("message", (msg: { type?: string }) => {
        if (msg.type === "channel-ready") {
          console.log("  ✅ Worker 专用通道已建立");
          resolve();
        }
      });
    });
    port1.postMessage({ greeting: "你好，Worker！" });
    await new Promise((r) => setTimeout(r, 200));
    port1.postMessage({ command: "compute", value: 30 });
    await new Promise((r) => setTimeout(r, 500));
    port1.close();
    await worker.terminate();
    console.log("  🔒 MessageChannel 通信演示完成");
  }

  async function demo4_sharedArrayBuffer(): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("📋 演示 4：SharedArrayBuffer 共享内存");
    console.log("=".repeat(60));
    const sharedBuffer = new SharedArrayBuffer(
      4 * Int32Array.BYTES_PER_ELEMENT,
    );
    const sharedArray = new Int32Array(sharedBuffer);
    sharedArray[0] = 0;
    sharedArray[1] = 0;
    sharedArray[2] = 0;
    sharedArray[3] = 0;
    console.log("  📦 已创建 SharedArrayBuffer（4 个 Int32 位）");
    console.log(`  初始状态: [${Array.from(sharedArray).join(", ")}]`);
    const workerCount = 3;
    const ranges: Range[] = [
      { start: 1, end: 500_000 },
      { start: 500_001, end: 1_000_000 },
      { start: 1_000_001, end: 1_500_000 },
    ];
    const workers: Worker[] = [];
    const startTime = Date.now();
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(__filename, {
        workerData: { id: i, sharedBuffer },
      });
      workers.push(worker);
      worker.on("message", (msg: Record<string, unknown>) => {
        if (msg.type === "shared-result") {
          const { workerId, count } = msg as {
            workerId: number;
            count: number;
          };
          console.log(`  📊 Worker-${workerId} 完成，找到 ${count} 个质数`);
          console.log(`  共享数组: [${Array.from(sharedArray).join(", ")}]`);
        }
      });
    }
    workers.forEach((worker, i) => {
      worker.postMessage({
        type: "shared-task",
        range: ranges[i],
        workerId: i,
      });
    });
    await new Promise<void>((resolve) => {
      let completed = 0;
      workers.forEach((worker) => {
        worker.on("message", (msg: Record<string, unknown>) => {
          if (msg.type === "shared-done") {
            completed++;
            if (completed === workerCount) resolve();
          }
        });
      });
    });
    const elapsed = Date.now() - startTime;
    console.log(`\n  ⏱️  共耗时: ${elapsed}ms`);
    console.log(`  🏁 最终共享数组: [${Array.from(sharedArray).join(", ")}]`);
    console.log(`  📈 总质数数量: ${sharedArray[0]}`);
    for (const w of workers) await w.terminate();
    console.log("  🔒 SharedArrayBuffer 演示完成");
  }

  async function demo5_fibonacci(): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("📋 演示 5：Fibonacci 多线程计算");
    console.log("=".repeat(60));
    const pool = new WorkerPool({ size: 4, workerPath: __filename });
    await pool.init();
    const fibNumbers = [35, 36, 37, 38, 39, 40] as const;
    console.log(`\n📤 提交 ${fibNumbers.length} 个 Fibonacci 计算任务...`);
    console.log(`  计算 fib(${fibNumbers.join("), fib(")})`);
    const singleStart = Date.now();
    const singleResults: { n: number; value: number; time: number }[] = [];
    for (const n of fibNumbers) {
      const t0 = Date.now();
      singleResults.push({ n, value: fibonacci(n), time: Date.now() - t0 });
    }
    const singleTotal = Date.now() - singleStart;
    console.log(`\n  单线程总耗时: ${singleTotal}ms`);
    const multiStart = Date.now();
    const promises = fibNumbers.map((n) =>
      pool.submit<FibonacciInput, number>(TaskType.Fibonacci, { n }),
    );
    const multiOutcomes = await Promise.all(promises);
    const multiTotal = Date.now() - multiStart;
    console.log(`  多线程总耗时: ${multiTotal}ms`);
    console.log("\n📊 结果对比：");
    multiOutcomes.forEach((o, i) => {
      const n = fibNumbers[i];
      const single = singleResults[i];
      if (isTaskSuccess(o))
        console.log(
          `  fib(${n}) = ${o.result} | 单: ${single.time}ms | 多: ${o.duration}ms`,
        );
      else if (isTaskError(o)) console.log(`  fib(${n}) 错误: ${o.error}`);
    });
    console.log(`\n  🏎️  加速比: ${(singleTotal / multiTotal).toFixed(2)}x`);
    await pool.terminate();
  }

  // ========== 主函数 ==========

  async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(
      "║     多线程任务处理（Worker Threads）演示                   ║",
    );
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log(`\n🖥️  系统 CPU 核心数: ${os.cpus().length}`);
    console.log(`   Node.js 版本: ${process.version}`);
    try {
      showcase_features();
      await demo1_basicPool();
      await demo2_performanceComparison();
      await demo3_messageChannel();
      await demo4_sharedArrayBuffer();
      await demo5_fibonacci();
      console.log("\n" + "=".repeat(60));
      console.log("🎉 所有演示已完成！");
      console.log("=".repeat(60));
    } catch (err) {
      console.error("❌ 演示执行出错:", err);
    }
  }

  main().catch(console.error);
}
