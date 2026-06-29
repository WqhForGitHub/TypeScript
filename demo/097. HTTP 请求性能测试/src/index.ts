#!/usr/bin/env node
/**
 * HTTP 请求性能测试工具
 * 支持并发 HTTP 请求测试、多种 HTTP 方法、实时进度、延迟统计（P50/P90/P95/P99）、
 * 吞吐量、错误率、延迟直方图、自定义请求头/请求体、超时配置、彩色输出、JSON 报告。
 *
 * 用法: node dist/index.js <URL> [选项]
 *   -n <num> 总请求数   -c <num> 并发数   -m <method> HTTP 方法
 *   -H <k:v> 请求头     -d <body> 请求体  -t <ms> 超时
 *   --json JSON 报告    -h 帮助
 */
import * as http from "http";
import * as https from "https";
import { URL } from "url";

// ==================== 枚举 ====================
enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}
enum BenchErrorCode {
  Config = "CONFIG_ERROR",
  Network = "NETWORK_ERROR",
  Timeout = "TIMEOUT_ERROR",
  InvalidUrl = "INVALID_URL",
  UnsupportedMethod = "UNSUPPORTED_METHOD",
}

// ==================== Symbols（唯一属性键） ====================
const RESULT_META: unique symbol = Symbol("resultMeta");
const INTERNAL_STATE: unique symbol = Symbol("internalState");

// ==================== 自定义错误层级（带 code 属性） ====================
abstract class BenchError extends Error {
  abstract readonly code: BenchErrorCode;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class ConfigError extends BenchError {
  readonly code: BenchErrorCode;
  constructor(message: string, code: BenchErrorCode = BenchErrorCode.Config) {
    super(message);
    this.code = code;
  }
}
class RequestError extends BenchError {
  readonly code: BenchErrorCode;
  constructor(message: string, code: BenchErrorCode = BenchErrorCode.Network) {
    super(message);
    this.code = code;
  }
}

// ==================== 判别联合类型 ====================
interface SuccessOutcome {
  readonly kind: "success";
  readonly statusCode: number;
  readonly duration: number;
  readonly bytesReceived: number;
}
interface ErrorOutcome {
  readonly kind: "error";
  readonly duration: number;
  readonly error: string;
  readonly statusCode: number | null;
}
interface TimeoutOutcome {
  readonly kind: "timeout";
  readonly duration: number;
  readonly error: string;
}
type RequestOutcome = SuccessOutcome | ErrorOutcome | TimeoutOutcome;

// ==================== 类型守卫 ====================
function isSuccessOutcome(o: RequestOutcome): o is SuccessOutcome {
  return o.kind === "success";
}
function isHttpMethod(value: string): value is HttpMethod {
  return Object.values(HttpMethod).includes(value as HttpMethod);
}

// ==================== 接口（含可选 / 只读 / 索引签名） ====================
interface RequestResult {
  readonly statusCode: number | null;
  readonly duration: number;
  readonly error: string | null;
  readonly bytesReceived: number;
  readonly timestamp: number;
  readonly outcome: RequestOutcome;
  [RESULT_META]?: { index: number };
}
interface BenchConfig {
  readonly url: string;
  readonly totalRequests: number;
  readonly concurrency: number;
  readonly method: HttpMethod;
  readonly headers: Record<string, string>;
  readonly body: string | null;
  readonly timeout: number;
  readonly outputJson: boolean;
  [key: string]: string | number | boolean | Record<string, string> | null;
}
interface BenchStats {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  totalDuration: number;
  requestsPerSec: number;
  totalBytes: number;
  statusCodes: Map<number, number>;
  errors: Map<string, number>;
  latencies: readonly number[];
  minLatency: number;
  maxLatency: number;
  avgLatency: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

// ==================== Mapped Types 与 Conditional Types ====================
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type JsonPrimitive = string | number | boolean | null;
type JsonSerializable<T> =
  T extends Map<infer K, infer V>
    ? Record<string, JsonSerializable<V>>
    : T extends JsonPrimitive
      ? T
      : T extends readonly (infer U)[]
        ? JsonSerializable<U>[]
        : T extends object
          ? { [K in keyof T]: JsonSerializable<T[K]> }
          : never;

// ==================== 元组与只读元组 ====================
type LatencyRange = readonly [min: number, max: number, label: string];

// ==================== 常量 ====================
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_CLEAR_LINE = "\x1b[2K";
const ANSI_CURSOR_LEFT = "\x1b[G";
const COLOR = {
  green: (s: string) => `\x1b[32m${s}${ANSI_RESET}`,
  yellow: (s: string) => `\x1b[33m${s}${ANSI_RESET}`,
  red: (s: string) => `\x1b[31m${s}${ANSI_RESET}`,
  blue: (s: string) => `\x1b[34m${s}${ANSI_RESET}`,
  cyan: (s: string) => `\x1b[36m${s}${ANSI_RESET}`,
  magenta: (s: string) => `\x1b[35m${s}${ANSI_RESET}`,
  gray: (s: string) => `${ANSI_DIM}${s}${ANSI_RESET}`,
  bold: (s: string) => `${ANSI_BOLD}${s}${ANSI_RESET}`,
} satisfies Record<string, (s: string) => string>;
const DEFAULTS = {
  totalRequests: 100,
  concurrency: 10,
  method: HttpMethod.GET,
  timeout: 10000,
} as const;
const HISTOGRAM_THRESHOLDS = [
  [50, 5],
  [200, 20],
  [500, 50],
  [2000, 200],
  [10000, 1000],
] as const;

// ==================== 工具函数（泛型约束 + 函数重载） ====================
function clamp<T extends number>(value: T, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
// 函数重载
function formatLatency(ms: number): string;
function formatLatency(ms: number, withUnit: true): string;
function formatLatency(ms: number, withUnit: false): number;
function formatLatency(ms: number, withUnit?: boolean): string | number;
function formatLatency(ms: number, withUnit: boolean = true): string | number {
  if (withUnit === false) return ms;
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ==================== 抽象统计计算器（抽象类 + 具体子类） ====================
abstract class StatCalculator<T extends number> {
  constructor(protected readonly values: readonly T[]) {}
  abstract compute(): number;
  abstract readonly name: string;
  protected get safeValues(): readonly T[] {
    return this.values.length > 0 ? this.values : ([0] as T[]);
  }
}
class MinCalculator extends StatCalculator<number> {
  readonly name = "Min";
  compute(): number {
    return Math.min(...this.safeValues);
  }
}
class MaxCalculator extends StatCalculator<number> {
  readonly name = "Max";
  compute(): number {
    return Math.max(...this.safeValues);
  }
}
class AvgCalculator extends StatCalculator<number> {
  readonly name = "Avg";
  compute(): number {
    const v = this.safeValues;
    return v.reduce((s, x) => s + x, 0) / v.length;
  }
}
class PercentileCalculator extends StatCalculator<number> {
  readonly name: string;
  constructor(
    values: readonly number[],
    private readonly p: number,
    name?: string,
  ) {
    super(values);
    this.name = name ?? `P${p}`;
  }
  compute(): number {
    const sorted = [...this.safeValues].sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const index = (this.p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower]!;
    const weight = index - lower;
    return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
  }
}

// ==================== 可迭代结果集合（生成器 / 迭代器 / Symbol 键 / Getter） ====================
class ResultCollection implements Iterable<RequestResult> {
  private readonly _results: RequestResult[] = [];
  [INTERNAL_STATE] = { completed: 0, failed: 0 };
  add(result: RequestResult): void {
    this._results.push(result);
    this[INTERNAL_STATE].completed++;
    if (
      result.error ||
      (result.statusCode !== null && result.statusCode >= 400)
    ) {
      this[INTERNAL_STATE].failed++;
    }
  }
  get length(): number {
    return this._results.length;
  }
  get completed(): number {
    return this[INTERNAL_STATE].completed;
  }
  get failed(): number {
    return this[INTERNAL_STATE].failed;
  }
  get latencies(): number[] {
    return this._results.map((r) => r.duration);
  }
  *[Symbol.iterator](): Iterator<RequestResult> {
    for (const r of this._results) yield r;
  }
  *successful(): Generator<RequestResult> {
    for (const r of this._results) if (!r.error) yield r;
  }
}

// ==================== 配置构建器（Getter / Setter） ====================
class ConfigBuilder {
  private _url = "";
  private _method: HttpMethod = DEFAULTS.method;
  private _totalRequests: number = DEFAULTS.totalRequests;
  private _concurrency: number = DEFAULTS.concurrency;
  private _timeout: number = DEFAULTS.timeout;
  private _body: string | null = null;
  private _outputJson = false;
  private _headers: Record<string, string> = {};
  get url(): string {
    return this._url;
  }
  set url(v: string) {
    if (!v) throw new ConfigError("URL 不能为空", BenchErrorCode.InvalidUrl);
    let n = v;
    if (!n.startsWith("http://") && !n.startsWith("https://"))
      n = `http://${n}`;
    try {
      new URL(n);
    } catch {
      throw new ConfigError(`无效的 URL: ${v}`, BenchErrorCode.InvalidUrl);
    }
    this._url = n;
  }
  get method(): HttpMethod {
    return this._method;
  }
  set method(v: HttpMethod) {
    if (!isHttpMethod(v))
      throw new ConfigError(
        `不支持的 HTTP 方法: ${v}`,
        BenchErrorCode.UnsupportedMethod,
      );
    this._method = v;
  }
  get totalRequests(): number {
    return this._totalRequests;
  }
  set totalRequests(v: number) {
    if (v <= 0) throw new ConfigError("请求数必须大于 0");
    this._totalRequests = Math.floor(v);
  }
  get concurrency(): number {
    return this._concurrency;
  }
  set concurrency(v: number) {
    if (v <= 0) throw new ConfigError("并发数必须大于 0");
    this._concurrency = Math.floor(v);
  }
  get timeout(): number {
    return this._timeout;
  }
  set timeout(v: number) {
    if (v <= 0) throw new ConfigError("超时时间必须大于 0");
    this._timeout = v;
  }
  get body(): string | null {
    return this._body;
  }
  set body(v: string | null) {
    this._body = v;
  }
  get outputJson(): boolean {
    return this._outputJson;
  }
  set outputJson(v: boolean) {
    this._outputJson = v;
  }
  get headers(): Record<string, string> {
    return this._headers;
  }
  addHeader(key: string, value: string): void {
    this._headers[key] = value;
  }
  build(): BenchConfig {
    return {
      url: this._url,
      totalRequests: this._totalRequests,
      concurrency: this._concurrency,
      method: this._method,
      headers: { ...this._headers },
      body: this._body,
      timeout: this._timeout,
      outputJson: this._outputJson,
    } satisfies BenchConfig;
  }
}

// ==================== 参数解析 ====================
function parseArgs(args: string[]): BenchConfig {
  const builder = new ConfigBuilder();
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      case "-n":
      case "--requests":
        i++;
        if (i < args.length) builder.totalRequests = parseInt(args[i]!, 10);
        break;
      case "-c":
      case "--concurrency":
        i++;
        if (i < args.length) builder.concurrency = parseInt(args[i]!, 10);
        break;
      case "-m":
      case "--method":
        i++;
        if (i < args.length) {
          const m = args[i]!.toUpperCase();
          if (!isHttpMethod(m)) {
            console.error(COLOR.red(`错误: 不支持的 HTTP 方法: ${m}`));
            console.error(
              COLOR.gray(`支持的方法: ${Object.values(HttpMethod).join(", ")}`),
            );
            process.exit(1);
          }
          builder.method = m;
        }
        break;
      case "-H":
      case "--header": {
        i++;
        if (i < args.length) {
          const parts = args[i]!.split(":");
          if (parts.length >= 2) {
            builder.addHeader(
              parts[0]!.trim(),
              parts.slice(1).join(":").trim(),
            );
          }
        }
        break;
      }
      case "-d":
      case "--data":
        i++;
        if (i < args.length) builder.body = args[i]!;
        break;
      case "-t":
      case "--timeout":
        i++;
        if (i < args.length) builder.timeout = parseInt(args[i]!, 10);
        break;
      case "--json":
        builder.outputJson = true;
        break;
      default:
        if (arg && !arg.startsWith("-")) builder.url = arg;
        break;
    }
    i++;
  }
  try {
    if (!builder.url) {
      console.error(COLOR.red("错误: 请提供目标 URL"));
      console.error(COLOR.gray("使用 --help 查看帮助信息"));
      process.exit(1);
    }
    return builder.build();
  } catch (e) {
    console.error(
      COLOR.red(`错误: ${e instanceof BenchError ? e.message : String(e)}`),
    );
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
${COLOR.bold("HTTP 请求性能测试工具")}

${COLOR.cyan("用法:")}
  node dist/index.js <URL> [选项]

${COLOR.cyan("选项:")}
  -n, --requests <num>    总请求数（默认 100）
  -c, --concurrency <num> 并发数（默认 10）
  -m, --method <method>   HTTP 方法（默认 GET）
  -H, --header <k:v>      自定义请求头（可多次指定）
  -d, --data <body>       请求体内容
  -t, --timeout <ms>      单请求超时时间（默认 10000ms）
  --json                  输出 JSON 格式报告
  -h, --help              显示帮助信息

${COLOR.cyan("示例:")}
  node dist/index.js http://localhost:3000/api
  node dist/index.js http://localhost:3000/api -n 500 -c 20
  node dist/index.js http://localhost:3000/api -m POST -d '{"key":"value"}'
  node dist/index.js http://localhost:3000/api -H "Authorization: Bearer token"
  node dist/index.js http://localhost:3000/api -n 1000 -c 50 --json
`);
}

// ==================== HTTP 请求 ====================
/** 发送单次 HTTP 请求并返回结果（判别联合 + 类型守卫处理不同结果） */
function sendRequest(
  config: BenchConfig,
  index: number,
): Promise<RequestResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    let bytesReceived = 0;
    let resolved = false;
    const finalize = (outcome: RequestOutcome): void => {
      if (resolved) return;
      resolved = true;
      // 使用类型守卫在访问变体特有属性前进行窄化
      const result: RequestResult = {
        statusCode: isSuccessOutcome(outcome)
          ? outcome.statusCode
          : outcome.kind === "error"
            ? outcome.statusCode
            : null,
        duration: outcome.duration,
        error: isSuccessOutcome(outcome) ? null : outcome.error,
        bytesReceived: isSuccessOutcome(outcome)
          ? outcome.bytesReceived
          : bytesReceived,
        timestamp: Date.now(),
        outcome,
        [RESULT_META]: { index },
      };
      resolve(result);
    };
    try {
      const parsedUrl = new URL(config.url);
      const isHttps = parsedUrl.protocol === "https:";
      const httpModule = isHttps ? https : http;
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: config.method,
        headers: {
          "User-Agent": "HttpBench/1.0",
          Accept: "*/*",
          ...config.headers,
        },
        timeout: config.timeout,
      };
      if (config.body) {
        const bodyBuffer = Buffer.from(config.body);
        const headers = options.headers as Record<string, string>;
        headers["Content-Length"] = String(bodyBuffer.length);
        if (!headers["Content-Type"])
          headers["Content-Type"] = "application/json";
      }
      const req = httpModule.request(options, (res) => {
        res.on("data", (chunk: Buffer) => {
          bytesReceived += chunk.length;
        });
        res.on("end", () => {
          const duration = performance.now() - startTime;
          const sc = res.statusCode ?? 0;
          if (sc >= 400) {
            finalize({
              kind: "error",
              duration,
              error: new RequestError(`HTTP ${sc}`).message,
              statusCode: res.statusCode ?? null,
            });
          } else {
            finalize({
              kind: "success",
              statusCode: sc,
              duration,
              bytesReceived,
            });
          }
        });
        res.on("error", (err) => {
          finalize({
            kind: "error",
            duration: performance.now() - startTime,
            error: err.message,
            statusCode: res.statusCode ?? null,
          });
        });
      });
      req.on("error", (err) => {
        finalize({
          kind: "error",
          duration: performance.now() - startTime,
          error: err.message,
          statusCode: null,
        });
      });
      req.on("timeout", () => {
        req.destroy();
        finalize({
          kind: "timeout",
          duration: performance.now() - startTime,
          error: "ETIMEDOUT",
        });
      });
      if (config.body) req.write(config.body);
      req.end();
    } catch (err) {
      finalize({
        kind: "error",
        duration: performance.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
        statusCode: null,
      });
    }
  });
}

// ==================== 性能测试器 ====================
class HttpBenchmarker {
  private readonly config: BenchConfig;
  private readonly results: ResultCollection;
  private startTime: number;
  private progressInterval: NodeJS.Timeout | null;
  constructor(config: BenchConfig) {
    this.config = config;
    this.results = new ResultCollection();
    this.startTime = 0;
    this.progressInterval = null;
  }
  async run(): Promise<void> {
    this.startTime = performance.now();
    if (!this.config.outputJson) {
      this.printBanner();
      this.progressInterval = setInterval(() => this.updateProgress(), 200);
    }
    const { totalRequests, concurrency } = this.config;
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < totalRequests) {
        this.results.add(await sendRequest(this.config, nextIndex++));
      }
    };
    const workerCount = Math.min(concurrency, totalRequests);
    const workers = Array.from({ length: workerCount }, () => worker());
    process.on("SIGINT", () => {
      if (this.progressInterval) clearInterval(this.progressInterval);
      console.log("\n" + COLOR.yellow("测试已中断"));
      this.printResults();
      process.exit(0);
    });
    await Promise.all(workers);
    if (this.progressInterval) clearInterval(this.progressInterval);
    if (this.config.outputJson) this.printJsonResults();
    else this.printResults();
  }
  private printBanner(): void {
    const u = new URL(this.config.url);
    const hdrs = Object.entries(this.config.headers);
    const headers = hdrs.length
      ? `\n  ${COLOR.bold("自定义头:")}   ${hdrs.map(([k, v]) => `${k}: ${v}`).join("; ")}`
      : "";
    const body = this.config.body
      ? `\n  ${COLOR.bold("请求体:")}     ${COLOR.gray(this.config.body.length > 50 ? this.config.body.slice(0, 50) + "..." : this.config.body)}`
      : "";
    console.log(`
${COLOR.bold(COLOR.cyan("  ╔══════════════════════════════════════════╗"))}
${COLOR.bold(COLOR.cyan("  ║     HTTP 请求性能测试工具 v1.0.0        ║"))}
${COLOR.bold(COLOR.cyan("  ╚══════════════════════════════════════════╝"))}

  ${COLOR.bold("目标 URL:")}   ${COLOR.cyan(this.config.url)}
  ${COLOR.bold("主机:")}       ${COLOR.cyan(u.hostname)}${u.port ? `:${u.port}` : ""}
  ${COLOR.bold("方法:")}       ${COLOR.green(this.config.method)}
  ${COLOR.bold("总请求数:")}   ${COLOR.bold(String(this.config.totalRequests))}
  ${COLOR.bold("并发数:")}     ${COLOR.bold(String(this.config.concurrency))}
  ${COLOR.bold("超时时间:")}   ${this.config.timeout}ms${headers}${body}

${COLOR.gray("  测试进行中...")}
`);
  }
  private updateProgress(): void {
    const elapsed = performance.now() - this.startTime;
    const completed = this.results.completed;
    const failed = this.results.failed;
    const rps =
      completed > 0 ? (completed / (elapsed / 1000)).toFixed(1) : "0.0";
    const percent = ((completed / this.config.totalRequests) * 100).toFixed(1);
    const barWidth = 30;
    const filled = Math.round(
      (completed / this.config.totalRequests) * barWidth,
    );
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    process.stdout.write(
      `${ANSI_CLEAR_LINE}${ANSI_CURSOR_LEFT}  ${COLOR.cyan(bar)} ${percent}% | ` +
        `${COLOR.bold(String(completed))}/${this.config.totalRequests} | ` +
        `${COLOR.green(rps)} req/s | ` +
        `${failed > 0 ? COLOR.red(`${failed} failed`) : COLOR.green("0 failed")}`,
    );
  }
  private computeStats(): BenchStats {
    const latencies = this.results.latencies.sort((a, b) => a - b);
    const totalDuration = performance.now() - this.startTime;
    let completedRequests = 0;
    let failedRequests = 0;
    const statusCodes = new Map<number, number>();
    const errors = new Map<string, number>();
    let totalBytes = 0;
    for (const result of this.results) {
      if (result.error) failedRequests++;
      else completedRequests++;
      if (result.statusCode !== null) {
        statusCodes.set(
          result.statusCode,
          (statusCodes.get(result.statusCode) ?? 0) + 1,
        );
      }
      if (result.error)
        errors.set(result.error, (errors.get(result.error) ?? 0) + 1);
      totalBytes += result.bytesReceived;
    }
    // 通过抽象计算器子类计算各项统计
    return {
      totalRequests: this.config.totalRequests,
      completedRequests,
      failedRequests,
      totalDuration,
      requestsPerSec: completedRequests / (totalDuration / 1000),
      totalBytes,
      statusCodes,
      errors,
      latencies,
      minLatency: new MinCalculator(latencies).compute(),
      maxLatency: new MaxCalculator(latencies).compute(),
      avgLatency: new AvgCalculator(latencies).compute(),
      p50: new PercentileCalculator(latencies, 50).compute(),
      p90: new PercentileCalculator(latencies, 90).compute(),
      p95: new PercentileCalculator(latencies, 95).compute(),
      p99: new PercentileCalculator(latencies, 99).compute(),
    };
  }
  private printResults(): void {
    const s = this.computeStats();
    const failed =
      s.failedRequests > 0
        ? COLOR.red(String(s.failedRequests))
        : COLOR.green("0");
    const errRate =
      s.failedRequests > 0
        ? COLOR.red(
            `${((s.failedRequests / s.totalRequests) * 100).toFixed(2)}%`,
          )
        : COLOR.green("0.00%");
    console.log(`
${COLOR.cyan("  ══════════════════════════════════════════")}
${COLOR.bold("  测试结果摘要")}
${COLOR.cyan("  ══════════════════════════════════════════")}

  ${COLOR.bold("总请求数:")}     ${s.totalRequests}
  ${COLOR.bold("成功请求:")}     ${COLOR.green(String(s.completedRequests))}
  ${COLOR.bold("失败请求:")}     ${failed}
  ${COLOR.bold("错误率:")}       ${errRate}

${COLOR.cyan("  ── 性能指标 ──────────────────────────────")}
  ${COLOR.bold("吞吐量:")}       ${COLOR.green(s.requestsPerSec.toFixed(2))} req/s
  ${COLOR.bold("总耗时:")}       ${formatDuration(s.totalDuration)} (${s.totalDuration.toFixed(0)} ms)
  ${COLOR.bold("数据传输:")}     ${formatBytes(s.totalBytes)}
  ${COLOR.bold("平均吞吐:")}     ${formatBytes(s.totalBytes / (s.totalDuration / 1000))}/s

${COLOR.cyan("  ── 延迟分布 ──────────────────────────────")}
  ${COLOR.bold("最小值:")}       ${formatLatency(s.minLatency)}
  ${COLOR.bold("最大值:")}       ${formatLatency(s.maxLatency)}
  ${COLOR.bold("平均值:")}       ${formatLatency(s.avgLatency)}
  ${COLOR.bold("P50:")}          ${formatLatency(s.p50)}
  ${COLOR.bold("P90:")}          ${COLOR.yellow(formatLatency(s.p90))}
  ${COLOR.bold("P95:")}          ${COLOR.yellow(formatLatency(s.p95))}
  ${COLOR.bold("P99:")}          ${COLOR.red(formatLatency(s.p99))}
`);
    this.printLatencyHistogram(s);
    if (s.statusCodes.size > 0) {
      const lines = [...s.statusCodes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([code, count]) => {
          const colorFn =
            code < 300
              ? COLOR.green
              : code < 400
                ? COLOR.cyan
                : code < 500
                  ? COLOR.yellow
                  : COLOR.red;
          const percent = ((count / s.totalRequests) * 100).toFixed(1);
          return `  ${colorFn(String(code))}  ${count.toString().padStart(6)} 次  (${percent}%)`;
        })
        .join("\n");
      console.log(
        `${COLOR.cyan("  ── 状态码分布 ────────────────────────────")}\n${lines}\n`,
      );
    }
    if (s.errors.size > 0) {
      const lines = [...s.errors.entries()]
        .map(([error, count]) => `  ${COLOR.red(error)}  ×${count}`)
        .join("\n");
      console.log(
        `${COLOR.cyan("  ── 错误统计 ──────────────────────────────")}\n${lines}\n`,
      );
    }
  }
  private printLatencyHistogram(stats: BenchStats): void {
    if (stats.latencies.length === 0) return;
    const ranges = this.buildHistogramRanges(stats.maxLatency);
    const counts = ranges.map(
      (r) => stats.latencies.filter((l) => l >= r[0] && l < r[1]).length,
    );
    const maxCount = Math.max(...counts);
    const maxBarWidth = 30;
    const lines: string[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const count = counts[i]!;
      if (count === 0) continue;
      const barWidth =
        maxCount > 0 ? Math.round((count / maxCount) * maxBarWidth) : 0;
      const percent = ((count / stats.latencies.length) * 100).toFixed(1);
      lines.push(
        `  ${COLOR.gray(ranges[i]![2].padEnd(12))} ${COLOR.cyan("▓".repeat(barWidth))} ${count} (${percent}%)`,
      );
    }
    if (lines.length > 0) {
      console.log(
        `${COLOR.cyan("  ── 延迟直方图 ────────────────────────────")}\n${lines.join("\n")}\n`,
      );
    }
  }
  private buildHistogramRanges(max: number): LatencyRange[] {
    const ranges: LatencyRange[] = [];
    let bucketSize = 5000;
    for (const [threshold, size] of HISTOGRAM_THRESHOLDS) {
      if (max <= threshold) {
        bucketSize = size;
        break;
      }
    }
    let current = 0;
    while (current < max) {
      const next = current + bucketSize;
      const minLabel =
        current < 1000 ? `${current}ms` : `${(current / 1000).toFixed(1)}s`;
      const maxLabel =
        next < 1000 ? `${next}ms` : `${(next / 1000).toFixed(1)}s`;
      ranges.push([current, next, `${minLabel}-${maxLabel}`] as LatencyRange);
      current = next;
    }
    return ranges;
  }
  private printJsonResults(): void {
    const s = this.computeStats();
    const statusCodesObj: Record<number, number> = {};
    for (const [code, count] of s.statusCodes.entries())
      statusCodesObj[code] = count;
    const errorsObj: Record<string, number> = {};
    for (const [error, count] of s.errors.entries()) errorsObj[error] = count;
    const output = {
      url: this.config.url,
      method: this.config.method,
      concurrency: this.config.concurrency,
      totalRequests: s.totalRequests,
      completedRequests: s.completedRequests,
      failedRequests: s.failedRequests,
      errorRate: ((s.failedRequests / s.totalRequests) * 100).toFixed(2) + "%",
      totalDurationMs: s.totalDuration,
      requestsPerSec: parseFloat(s.requestsPerSec.toFixed(2)),
      totalBytes: s.totalBytes,
      latency: {
        min: parseFloat(s.minLatency.toFixed(3)),
        max: parseFloat(s.maxLatency.toFixed(3)),
        avg: parseFloat(s.avgLatency.toFixed(3)),
        p50: parseFloat(s.p50.toFixed(3)),
        p90: parseFloat(s.p90.toFixed(3)),
        p95: parseFloat(s.p95.toFixed(3)),
        p99: parseFloat(s.p99.toFixed(3)),
      },
      statusCodes: statusCodesObj,
      errors: errorsObj,
    };
    console.log(JSON.stringify(output, null, 2));
  }
}

// ==================== 主函数 ====================
async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  await new HttpBenchmarker(config).run();
}
main().catch((err) => {
  const msg =
    err instanceof BenchError
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`发生错误: ${msg}`);
  process.exit(1);
});
