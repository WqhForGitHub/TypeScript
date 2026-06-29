#!/usr/bin/env node
/**
 * 60. 网络延迟测试工具 (Enhanced TS Edition)
 * ping/httping/trace/speedtest + 统计 min/avg/max/stddev + 彩色输出。
 * 仅用 Node 内置模块 net/dns/http/https/url/zlib。
 * 演示：枚举/判别联合/泛型类/抽象类/映射&条件&模板字面量类型/重载/
 *      错误层级/satisfies/as const/Symbol/生成器/类型守卫/元组。
 */

import * as net from "net";
import * as dns from "dns";
import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";

// === 数字枚举（常规 enum，便于 Object.values 反射） ========================

enum TestType {
  TCP = 1,
  HTTP = 2,
  Trace = 3,
  Speed = 4,
}

enum ErrorCode {
  None = 0,
  Timeout = 1,
  DnsFailure = 2,
  ConnectionRefused = 3,
  HostUnreachable = 4,
  NetworkUnreachable = 5,
  InvalidArgument = 6,
  Unknown = 99,
}

enum HopType {
  Reached = "reached",
  Timeout = "timeout",
  Error = "error",
}

// === 字符串枚举 ===========================================================

enum CommandName {
  Ping = "ping",
  Httping = "httping",
  Trace = "trace",
  Speedtest = "speedtest",
  Help = "help",
}
enum Protocol {
  Http = "http",
  Https = "https",
}
enum ResultStatus {
  Ok = "ok",
  Fail = "fail",
  Partial = "partial",
}

// === 模板字面量 / 条件 / 映射类型 ========================================

type HostPort = `${string}:${number}`;
type ProtocolUrl = `${Protocol}://${string}`;

type MsOf<T> = T extends { ms: infer M } ? M : never; // 条件类型
type IsOkResult<T> = T extends { ok: true } ? true : false; // 条件类型

type ReadonlyAll<T> = { readonly [K in keyof T]: T[K] }; // 映射类型
type OptionalKeys<T> = { [K in keyof T]?: T[K] }; // 映射类型
type NumericFields<T> = {
  // 映射类型（键过滤）
  [K in keyof T as T[K] extends number ? K : never]: T[K];
};

// === 元组 / 只读元组 =====================================================

type Range = readonly [min: number, max: number];
type HttpTimings = readonly [
  dns: number,
  connect: number,
  ttfb: number,
  total: number,
];
type StatField = readonly [label: string, value: number];

// === 接口（含可选 / 只读 / 索引签名） ====================================

interface Sample {
  readonly ok: boolean;
  ms?: number;
  error?: string;
  [extra: string]: unknown;
}

interface HttpSample extends Sample {
  dns?: number;
  connect?: number;
  ttfb?: number;
  total?: number;
  status?: number;
  bytes?: number;
}

interface TraceSample extends Sample {
  ttl: number;
  hopType: HopType;
  host?: string;
}

interface SpeedtestSample extends Sample {
  bytes: number;
  total: number;
  mbps: number;
  source: string;
  status: number;
}

interface TraceHop {
  readonly ttl: number;
  readonly type: HopType;
  host?: string;
  ms?: number;
  error?: string;
}

interface Stats {
  n: number;
  ok: number;
  fail: number;
  min: number;
  max: number;
  avg: number;
  stddev: number;
}

type ReadonlyStats = ReadonlyAll<Stats>;
type NumericStats = NumericFields<Stats>;

// === 判别联合（Discriminated Unions） ====================================

interface PingResult {
  readonly type: TestType.TCP;
  readonly status: ResultStatus;
  samples: Sample[];
  stats: Stats;
}
interface HttpingResult {
  readonly type: TestType.HTTP;
  readonly status: ResultStatus;
  samples: HttpSample[];
  stats: Stats;
}
interface TraceResult {
  readonly type: TestType.Trace;
  readonly status: ResultStatus;
  hops: TraceHop[];
}
interface SpeedtestOutcome {
  readonly type: TestType.Speed;
  readonly status: ResultStatus;
  sample?: SpeedtestSample;
}
type TestResult = PingResult | HttpingResult | TraceResult | SpeedtestOutcome;

// --- 类型守卫 ---
function isPingResult(r: TestResult): r is PingResult {
  return r.type === TestType.TCP;
}
function isHttpingResult(r: TestResult): r is HttpingResult {
  return r.type === TestType.HTTP;
}
function isTraceResult(r: TestResult): r is TraceResult {
  return r.type === TestType.Trace;
}
function isSpeedtestResult(r: TestResult): r is SpeedtestOutcome {
  return r.type === TestType.Speed;
}

// === Symbol 唯一键 =======================================================

const SYM_RAW = Symbol("rawData");
const SYM_SEQ = Symbol("sequence");
interface Sequenced {
  [SYM_SEQ]?: number;
}

// === as const 断言 =======================================================

const DEFAULTS = {
  count: 4,
  interval: 1,
  maxhops: 20,
  timeout: 5000,
  httpTimeout: 10000,
  hopTimeout: 3000,
  speedTimeout: 20000,
} as const;

// === satisfies 运算符 ====================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
} satisfies Record<string, string>;

const BOUNDS = {
  count: [1, 100] as Range,
  interval: [0.2, 60] as Range,
  maxhops: [1, 64] as Range,
} satisfies Record<string, Range>;

const SPEED_SOURCES = [
  "https://speed.cloudflare.com/__down?bytes=10000000",
  "https://www.google.com/",
  "https://www.example.com/",
] as const;

// === 自定义错误层级（带 code 属性） ======================================

class LatencyError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode = ErrorCode.Unknown) {
    super(message);
    this.name = "LatencyError";
    this.code = code;
  }
}
class TimeoutError extends LatencyError {
  constructor(message = "timeout") {
    super(message, ErrorCode.Timeout);
    this.name = "TimeoutError";
  }
}
class DnsLookupError extends LatencyError {
  constructor(host: string, message: string) {
    super(`dns(${host}): ${message}`, ErrorCode.DnsFailure);
    this.name = "DnsLookupError";
  }
}
class ConnectionError extends LatencyError {
  constructor(message: string) {
    super(message, ErrorCode.ConnectionRefused);
    this.name = "ConnectionError";
  }
}

function classifyError(err: Error): ErrorCode {
  if (err instanceof LatencyError) return err.code;
  if (/timeout/i.test(err.message)) return ErrorCode.Timeout;
  if (/ECONNREFUSED/.test(err.message)) return ErrorCode.ConnectionRefused;
  if (/EHOSTUNREACH/.test(err.message)) return ErrorCode.HostUnreachable;
  if (/ENETUNREACH/.test(err.message)) return ErrorCode.NetworkUnreachable;
  if (/dns/i.test(err.message)) return ErrorCode.DnsFailure;
  return ErrorCode.Unknown;
}

// === 通用工具 ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function clamp(v: number, [min, max]: Range): number {
  return Math.min(Math.max(v, min), max);
}

function colorMs(ms: number): string {
  if (ms < 100) return C.green + ms.toFixed(2) + "ms" + C.reset;
  if (ms < 300) return C.yellow + ms.toFixed(2) + "ms" + C.reset;
  return C.red + ms.toFixed(2) + "ms" + C.reset;
}

/** 函数重载：根据是否带协议返回不同类型 */
function parseTarget(input: string): HostPort;
function parseTarget(input: string, withProtocol: true): ProtocolUrl;
function parseTarget(input: string, withProtocol = false): string {
  const withProto = /^https?:\/\//.test(input) ? input : `http://${input}`;
  if (withProtocol) return withProto as ProtocolUrl;
  const parsed = url.parse(withProto);
  const host = parsed.hostname || input;
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  return `${host}:${port}` as HostPort;
}

function pickProtocol(u: string): Protocol {
  return u.startsWith("https://") ? Protocol.Https : Protocol.Http;
}

/** 提取 ms（条件类型 MsOf 演示） */
function extractMs<T extends Sample & { ms: number }>(s: T): MsOf<T> {
  return s.ms as MsOf<T>;
}

// === 泛型样本仓库（带约束 + 生成器/迭代器 + getter/setter） =============

class SampleStore<T extends Sample> implements Iterable<T> {
  private readonly _samples: T[] = [];
  private _label: string;
  [SYM_RAW]: unknown = null;

  constructor(label: string) {
    this._label = label;
  }

  get label(): string {
    return this._label;
  }
  set label(v: string) {
    if (!v)
      throw new LatencyError(
        "label cannot be empty",
        ErrorCode.InvalidArgument,
      );
    this._label = v;
  }
  get count(): number {
    return this._samples.length;
  }
  get okCount(): number {
    return this._samples.reduce((n, s) => (s.ok ? n + 1 : n), 0);
  }
  get failCount(): number {
    return this.count - this.okCount;
  }

  add(s: T): this {
    this._samples.push(s);
    return this;
  }
  get(i: number): T | undefined {
    return this._samples[i];
  }
  toArray(): readonly T[] {
    return this._samples;
  }

  /** 生成器：迭代所有样本 */
  *[Symbol.iterator](): Iterator<T> {
    for (const s of this._samples) yield s;
  }
  /** 生成器：带序号迭代 */
  *entries(): IterableIterator<[number, T]> {
    for (let i = 0; i < this._samples.length; i++) yield [i, this._samples[i]];
  }
}

// === 抽象测试器 + 具体子类 ===============================================

abstract class AbstractTester<T extends Sample, R extends TestResult> {
  public readonly store: SampleStore<T>;
  protected onSample?: (sample: T, seq: number) => void;

  constructor(
    protected readonly target: string,
    label: string,
  ) {
    this.store = new SampleStore<T>(label);
  }

  abstract run(): Promise<R>;

  onProgress(cb: (sample: T, seq: number) => void): this {
    this.onSample = cb;
    return this;
  }

  protected async repeat(
    count: number,
    intervalMs: number,
    fn: () => Promise<T>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < count; i++) {
      const s = await fn();
      const seqTagged = s as T & Sequenced;
      seqTagged[SYM_SEQ] = i + 1;
      this.store.add(s);
      out.push(s);
      this.onSample?.(s, i + 1);
      if (i < count - 1) await sleep(intervalMs);
    }
    return out;
  }

  protected deriveStatus(stats: Stats): ResultStatus {
    if (stats.ok === 0) return ResultStatus.Fail;
    return stats.fail > 0 ? ResultStatus.Partial : ResultStatus.Ok;
  }
}

// --- TCP Ping 底层 ---

function tcpPing(
  host: string,
  port: number,
  timeoutMs = DEFAULTS.timeout,
): Promise<Sample> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (s: Sample): void => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(s);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish({ ok: true, ms: Date.now() - t0 }));
    sock.once("timeout", () => finish({ ok: false, error: "timeout" }));
    sock.once("error", (err: Error) =>
      finish({ ok: false, error: err.message }),
    );
    sock.connect({ host, port });
  });
}

class PingTester extends AbstractTester<Sample, PingResult> {
  constructor(
    host: string,
    private readonly port: number,
    private readonly count: number,
    private readonly interval: number,
  ) {
    super(host, `TCP Ping ${host}:${port}`);
  }

  async run(): Promise<PingResult> {
    const samples = await this.repeat(this.count, this.interval * 1000, () =>
      tcpPing(this.target, this.port),
    );
    const stats = computeStats(samples);
    return {
      type: TestType.TCP,
      status: this.deriveStatus(stats),
      samples,
      stats,
    };
  }
}

// --- HTTP Ping 底层 ---

function httpPing(
  target: string,
  timeoutMs = DEFAULTS.httpTimeout,
): Promise<HttpSample> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let tDns = 0;
    let tConnect = 0;
    let tTtfb = 0;
    const parsed = url.parse(target);
    const lib = pickProtocol(target) === Protocol.Https ? https : http;
    const host = parsed.hostname || "";
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;

    const doRequest = (): void => {
      const req = lib.request(
        {
          hostname: host,
          port,
          path: parsed.path || "/",
          method: "GET",
          headers: {
            "User-Agent": "net-latency/1.0",
            "Accept-Encoding": "gzip, deflate",
          },
          timeout: timeoutMs,
        },
        (res) => {
          tTtfb = Date.now() - t0;
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br")
            stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const timings: HttpTimings = [
              tDns,
              tConnect,
              tTtfb,
              Date.now() - t0,
            ];
            resolve({
              ok: true,
              dns: timings[0],
              connect: timings[1],
              ttfb: timings[2],
              total: timings[3],
              status: res.statusCode,
              bytes: Buffer.concat(chunks).length,
            });
          });
          stream.on("error", (err: Error) =>
            resolve({ ok: false, error: err.message }),
          );
        },
      );
      req.on("socket", (sock: net.Socket) => {
        sock.on("lookup", () => {
          tDns = Date.now() - t0;
        });
        sock.on("connect", () => {
          tConnect = Date.now() - t0;
        });
      });
      req.on("timeout", () => {
        req.destroy(new TimeoutError());
      });
      req.on("error", (err: Error) =>
        resolve({ ok: false, error: err.message }),
      );
      req.end();
    };

    if (net.isIP(host)) {
      tDns = 0;
      doRequest();
    } else {
      dns.lookup(host, (err) => {
        if (err) {
          resolve({ ok: false, error: `dns: ${err.message}` });
          return;
        }
        tDns = Date.now() - t0;
        doRequest();
      });
    }
  });
}

class HttpingTester extends AbstractTester<HttpSample, HttpingResult> {
  constructor(
    target: string,
    private readonly count: number,
  ) {
    super(target, `HTTP Ping ${target}`);
  }

  async run(): Promise<HttpingResult> {
    const samples = await this.repeat(this.count, 1000, () =>
      httpPing(this.target),
    );
    const totals: Sample[] = samples.map((s) =>
      s.ok ? { ok: true, ms: s.total } : { ok: false, error: s.error },
    );
    const stats = computeStats(totals);
    return {
      type: TestType.HTTP,
      status: this.deriveStatus(stats),
      samples,
      stats,
    };
  }
}

// --- Traceroute 底层 ---

function traceHop(
  host: string,
  port: number,
  ttl: number,
  timeoutMs = DEFAULTS.hopTimeout,
): Promise<TraceHop> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (h: TraceHop): void => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(h);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () =>
      finish({ ttl, type: HopType.Reached, host, ms: Date.now() - t0 }),
    );
    sock.once("timeout", () =>
      finish({ ttl, type: HopType.Timeout, error: "timeout" }),
    );
    sock.once("error", (err: Error) => {
      const ms = Date.now() - t0;
      if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(err.message)) {
        finish({ ttl, type: HopType.Reached, host: "(icmp)", ms });
      } else {
        finish({ ttl, type: HopType.Error, error: err.message });
      }
    });
    type SocketWithTTL = net.Socket & { setTTL?: (ttl: number) => void };
    try {
      const s = sock as SocketWithTTL;
      if (typeof s.setTTL === "function") s.setTTL(ttl);
    } catch {
      /* setTTL 在某些平台不可用 */
    }
    sock.connect({ host, port, family: 4 });
  });
}

class TraceTester extends AbstractTester<TraceSample, TraceResult> {
  private ttl = 0;
  constructor(
    host: string,
    private readonly port: number,
    private readonly maxHops: number,
  ) {
    super(host, `Trace ${host}:${port}`);
  }

  private async nextHop(): Promise<TraceSample> {
    this.ttl++;
    const hop = await traceHop(this.target, this.port, this.ttl);
    return {
      ok: hop.type === HopType.Reached,
      ms: hop.ms,
      error: hop.error,
      ttl: hop.ttl,
      hopType: hop.type,
      host: hop.host,
    };
  }

  async run(): Promise<TraceResult> {
    const hops: TraceHop[] = [];
    for (let i = 0; i < this.maxHops; i++) {
      const sample = await this.nextHop();
      const seqTagged = sample as TraceSample & Sequenced;
      seqTagged[SYM_SEQ] = i + 1;
      this.store.add(sample);
      this.onSample?.(sample, i + 1);
      hops.push({
        ttl: sample.ttl,
        type: sample.hopType,
        host: sample.host,
        ms: sample.ms,
        error: sample.error,
      });
      if (sample.hopType === HopType.Reached && sample.host === this.target)
        break;
    }
    const status = hops.length > 0 ? ResultStatus.Ok : ResultStatus.Fail;
    return { type: TestType.Trace, status, hops };
  }
}

// --- Speedtest ---

class SpeedtestTester extends AbstractTester<
  SpeedtestSample,
  SpeedtestOutcome
> {
  private readonly sources: readonly string[] = SPEED_SOURCES;

  private download(
    u: string,
  ): Promise<{ bytes: number; total: number; mbps: number; status: number }> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const parsed = url.parse(u);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname || "",
          port: parsed.port ? Number(parsed.port) : undefined,
          path: parsed.path || "/",
          method: "GET",
          headers: {
            "User-Agent": "net-latency/1.0",
            "Accept-Encoding": "identity",
          },
          timeout: DEFAULTS.speedTimeout,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const total = Date.now() - t0;
            const bytes = Buffer.concat(chunks).length;
            const mbps = total > 0 ? (bytes * 8) / 1e6 / (total / 1000) : 0;
            resolve({ bytes, total, mbps, status: res.statusCode || 0 });
          });
          res.on("error", (err: Error) => reject(err));
        },
      );
      req.on("timeout", () => req.destroy(new TimeoutError()));
      req.on("error", (err: Error) => reject(err));
      req.end();
    });
  }

  async run(): Promise<SpeedtestOutcome> {
    for (const u of this.sources) {
      try {
        const r = await this.download(u);
        const sample: SpeedtestSample = {
          ok: true,
          bytes: r.bytes,
          total: r.total,
          mbps: r.mbps,
          source: u,
          status: r.status,
        };
        this.store.add(sample);
        this.onSample?.(sample, 1);
        return { type: TestType.Speed, status: ResultStatus.Ok, sample };
      } catch (err) {
        this.store.add({
          ok: false,
          error: (err as Error).message,
          bytes: 0,
          total: 0,
          mbps: 0,
          source: u,
          status: 0,
        });
      }
    }
    return { type: TestType.Speed, status: ResultStatus.Fail };
  }
}

// === 统计 ================================================================

function computeStats(samples: readonly Sample[]): ReadonlyStats {
  const ok = samples
    .filter((s): s is Sample & { ms: number } => s.ok && s.ms !== undefined)
    .map((s) => extractMs(s));
  const fail = samples.length - ok.length;
  if (ok.length === 0) {
    return {
      n: samples.length,
      ok: 0,
      fail,
      min: 0,
      max: 0,
      avg: 0,
      stddev: 0,
    };
  }
  const min = Math.min(...ok);
  const max = Math.max(...ok);
  const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
  const variance = ok.reduce((a, b) => a + (b - avg) ** 2, 0) / ok.length;
  const stddev = Math.sqrt(variance);
  return { n: samples.length, ok: ok.length, fail, min, max, avg, stddev };
}

function printStats(label: string, st: Stats): void {
  console.log("");
  console.log(`  ${C.bold}${label}${C.reset}`);
  console.log("  " + "─".repeat(50));
  console.log(
    `  发送: ${st.n}    成功: ${C.green}${st.ok}${C.reset}    失败: ${C.red}${st.fail}${C.reset}`,
  );
  if (st.ok > 0) {
    const fields: readonly StatField[] = [
      ["最小", st.min],
      ["平均", st.avg],
      ["最大", st.max],
      ["标准差", st.stddev],
    ];
    for (const [name, val] of fields) console.log(`  ${name}: ${colorMs(val)}`);
  }
  console.log("");
}

/** 使用生成器迭代样本仓库并打印序列摘要 */
function printSequence<T extends Sample>(store: SampleStore<T>): void {
  const parts: string[] = [];
  for (const [i, s] of store.entries()) {
    parts.push(s.ok ? `${i + 1}:ok` : `${i + 1}:x`);
  }
  if (parts.length > 0) console.log(`  序列: ${parts.join("  ")}`);
}

// === 结果打印（判别联合 + 类型守卫） =====================================

function printPingResult(r: PingResult): void {
  printStats(`TCP Ping`, r.stats);
}

function printHttpingResult(r: HttpingResult): void {
  printStats(`HTTP Ping`, r.stats);
}

function printTraceResult(r: TraceResult): void {
  console.log("  " + "─".repeat(50));
  for (const hop of r.hops) {
    const msStr =
      hop.ms !== undefined ? colorMs(hop.ms) : C.gray + "-" + C.reset;
    const hostStr = hop.host || (hop.error ? C.red + hop.error + C.reset : "*");
    console.log(
      `  ${String(hop.ttl).padStart(3, " ")}  ${hostStr.padEnd(20)}  ${msStr}`,
    );
  }
  const reached = r.hops.find((h) => h.type === HopType.Reached);
  if (reached) console.log(`\n[trace] 到达目标，共 ${reached.ttl} 跳。`);
  else console.log(`\n[trace] 未在 ${r.hops.length} 跳内到达目标。`);
}

function printSpeedtestResult(r: SpeedtestOutcome): void {
  if (r.sample) {
    const s = r.sample;
    console.log(`[speedtest] 源: ${s.source}`);
    console.log(`  状态: ${s.status}`);
    console.log(`  下载: ${(s.bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  耗时: ${s.total} ms`);
    console.log(
      `  速度: ${C.bold}${C.cyan}${s.mbps.toFixed(2)} Mbps${C.reset}`,
    );
  } else {
    console.log("[speedtest] 所有测速源均不可用。");
  }
}

function printResult(r: TestResult): void {
  if (isPingResult(r)) printPingResult(r);
  else if (isHttpingResult(r)) printHttpingResult(r);
  else if (isTraceResult(r)) printTraceResult(r);
  else if (isSpeedtestResult(r)) printSpeedtestResult(r);
}

// === 命令行解析 ==========================================================

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

function parseFlags(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-c" || a === "--count") flags.count = args[++i];
    else if (a === "-i" || a === "--interval") flags.interval = args[++i];
    else if (a === "-m" || a === "--maxhops") flags.maxhops = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i] ?? "";
    else positional.push(a);
  }
  return { positional, flags };
}

function toCommand(s: string): CommandName | undefined {
  const values = Object.values(CommandName);
  return (values as string[]).includes(s) ? (s as CommandName) : undefined;
}

function printHelp(): void {
  console.log(`
网络延迟测试工具 - 用法:
  node dist/index.js ping <host> [-c count] [-i interval]    TCP 连接 ping
  node dist/index.js httping <url> [-c count]                HTTP 延迟 ping
  node dist/index.js trace <host> [-m maxhops]               基本 traceroute
  node dist/index.js speedtest                                下载测速
  node dist/index.js help                                     显示本帮助

选项:
  -c, --count <n>       次数（默认 ${DEFAULTS.count}）
  -i, --interval <s>    间隔秒数（默认 ${DEFAULTS.interval}）
  -m, --maxhops <n>     最大跳数（默认 ${DEFAULTS.maxhops}）

说明:
  - ping 使用 TCP 连接计时（无需 ICMP 权限）
  - httping 报告 DNS / connect / TTFB / total 四个阶段
  - trace 通过 setTTL 实现（部分平台可能受限）
  - speedtest 尝试 Cloudflare 测速文件
`);
}

// === 入口 ================================================================

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    return;
  }

  const cmdStr = argv[0];
  const cmd = toCommand(cmdStr);
  if (!cmd || cmd === CommandName.Help) {
    if (cmdStr !== CommandName.Help && cmdStr !== "-h")
      console.log(`未知命令: ${cmdStr}`);
    printHelp();
    return;
  }

  const { positional, flags } = parseFlags(argv.slice(1));
  const count = clamp(
    parseInt(flags.count || String(DEFAULTS.count), 10) || DEFAULTS.count,
    BOUNDS.count,
  );
  const interval = clamp(
    parseFloat(flags.interval || String(DEFAULTS.interval)) ||
      DEFAULTS.interval,
    BOUNDS.interval,
  );
  const maxhops = clamp(
    parseInt(flags.maxhops || String(DEFAULTS.maxhops), 10) || DEFAULTS.maxhops,
    BOUNDS.maxhops,
  );

  try {
    let result: TestResult;

    switch (cmd) {
      case CommandName.Ping: {
        const host = positional[0];
        if (!host)
          throw new LatencyError("请提供主机名", ErrorCode.InvalidArgument);
        const hp = parseTarget(host);
        const [h, portStr] = hp.split(":");
        const port = portStr ? Number(portStr) : 80;
        const tester = new PingTester(h, port, count, interval);
        console.log(
          `[ping] ${h}:${port}  count=${count}  interval=${interval}s`,
        );
        tester.onProgress((s, seq) => {
          if (s.ok)
            console.log(
              `  seq=${seq}  ${colorMs(s.ms!)}  ${C.gray}→ ${h}:${port}${C.reset}`,
            );
          else console.log(`  seq=${seq}  ${C.red}失败${C.reset}  ${s.error}`);
        });
        result = await tester.run();
        printSequence(tester.store);
        break;
      }

      case CommandName.Httping: {
        const target = positional[0];
        if (!target)
          throw new LatencyError("请提供 URL", ErrorCode.InvalidArgument);
        const u = parseTarget(target, true);
        const tester = new HttpingTester(u, count);
        console.log(`[httping] ${u}  count=${count}`);
        tester.onProgress((s, seq) => {
          if (s.ok) {
            console.log(
              `  seq=${seq}  status=${s.status}  total=${colorMs(s.total!)}  ` +
                `${C.gray}dns=${s.dns}ms connect=${s.connect}ms ttfb=${s.ttfb}ms${C.reset}`,
            );
          } else {
            console.log(`  seq=${seq}  ${C.red}失败${C.reset}  ${s.error}`);
          }
        });
        result = await tester.run();
        printSequence(tester.store);
        break;
      }

      case CommandName.Trace: {
        const host = positional[0];
        if (!host)
          throw new LatencyError("请提供主机名", ErrorCode.InvalidArgument);
        const hp = parseTarget(host);
        const [h, portStr] = hp.split(":");
        const port = portStr ? Number(portStr) : 80;
        const tester = new TraceTester(h, port, maxhops);
        console.log(`[trace] ${h}:${port}  最大 ${maxhops} 跳`);
        tester.onProgress((s) => {
          const msStr =
            s.ms !== undefined ? colorMs(s.ms) : C.gray + "-" + C.reset;
          const hostStr = s.host || (s.error ? C.red + s.error + C.reset : "*");
          console.log(
            `  ${String(s.ttl).padStart(3, " ")}  ${hostStr.padEnd(20)}  ${msStr}`,
          );
        });
        result = await tester.run();
        break;
      }

      case CommandName.Speedtest: {
        const tester = new SpeedtestTester("", "Speedtest");
        console.log("[speedtest] 尝试下载测速文件...");
        result = await tester.run();
        break;
      }

      default:
        printHelp();
        return;
    }

    printResult(result);
  } catch (err) {
    const e = err as Error;
    const code = classifyError(e);
    console.error(`运行出错 [code=${code}]:`, e.message);
    process.exit(1);
  }
}

void main();
