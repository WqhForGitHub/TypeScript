#!/usr/bin/env node
/**
 * 60. 网络延迟测试工具
 * ------------------------------------------------------------------
 * 演示一个网络延迟测试工具：
 *   - ping:   TCP 连接延迟（net.Socket + 计时）
 *   - httping: HTTP 延迟（DNS / connect / TTFB / total）
 *   - trace:  基本 traceroute（设置 TTL，捕获 ICMP 不可达）
 *   - speedtest: 下载已知文件测速
 *   - 统计：min / avg / max / stddev，结果着色
 *
 * 仅使用 Node.js 内置模块：net、dns、http、https、url、zlib、buffer、timers。
 */

import * as net from "net";
import * as dns from "dns";
import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface Sample {
  ok: boolean;
  ms?: number;
  error?: string;
}

interface HttpSample {
  ok: boolean;
  dns?: number;
  connect?: number;
  ttfb?: number;
  total?: number;
  status?: number;
  bytes?: number;
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

// ---------------------------------------------------------------------------
// 颜色
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m",
  red: "\x1b[31m", cyan: "\x1b[36m", gray: "\x1b[90m", magenta: "\x1b[35m",
};

function colorMs(ms: number): string {
  if (ms < 100) return C.green + ms.toFixed(2) + "ms" + C.reset;
  if (ms < 300) return C.yellow + ms.toFixed(2) + "ms" + C.reset;
  return C.red + ms.toFixed(2) + "ms" + C.reset;
}

// ---------------------------------------------------------------------------
// TCP Ping
// ---------------------------------------------------------------------------

function tcpPing(host: string, port: number, timeoutMs = 5000): Promise<Sample> {
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
    sock.once("error", (err: Error) => finish({ ok: false, error: err.message }));
    sock.connect({ host, port });
  });
}

// ---------------------------------------------------------------------------
// HTTP Ping（带 DNS / connect / TTFB / total 计时）
// ---------------------------------------------------------------------------

function httpPing(target: string, timeoutMs = 10000): Promise<HttpSample> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let tDns = 0;
    let tConnect = 0;
    let tTtfb = 0;
    const parsed = url.parse(target);
    const lib = parsed.protocol === "https:" ? https : http;
    const host = parsed.hostname || "";
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);

    const doRequest = (): void => {
      const req = lib.request(
        {
          hostname: host,
          port,
          path: parsed.path || "/",
          method: "GET",
          headers: { "User-Agent": "net-latency/1.0", "Accept-Encoding": "gzip, deflate" },
          timeout: timeoutMs,
        },
        (res) => {
          tTtfb = Date.now() - t0;
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            resolve({
              ok: true,
              dns: tDns,
              connect: tConnect,
              ttfb: tTtfb,
              total: Date.now() - t0,
              status: res.statusCode,
              bytes: Buffer.concat(chunks).length,
            });
          });
          stream.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
        }
      );
      req.on("socket", (sock: net.Socket) => {
        sock.on("lookup", () => { tDns = Date.now() - t0; });
        sock.on("connect", () => { tConnect = Date.now() - t0; });
      });
      req.on("timeout", () => { req.destroy(new Error("timeout")); });
      req.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
      req.end();
    };

    // 如果目标已是 IP，跳过 DNS；否则解析
    if (net.isIP(host)) {
      tDns = 0;
      doRequest();
    } else {
      dns.lookup(host, (err) => {
        if (err) { resolve({ ok: false, error: `dns: ${err.message}` }); return; }
        tDns = Date.now() - t0;
        doRequest();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 基本 Traceroute（设置 TTL，捕获错误或超时）
// ---------------------------------------------------------------------------

interface TraceHop {
  ttl: number;
  reached: boolean;
  host?: string;
  ms?: number;
  error?: string;
}

function traceHop(host: string, port: number, ttl: number, timeoutMs = 3000): Promise<TraceHop> {
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
    sock.once("connect", () => finish({ ttl, reached: true, host, ms: Date.now() - t0 }));
    sock.once("timeout", () => finish({ ttl, reached: false, error: "timeout" }));
    sock.once("error", (err: Error) => {
      // ICMP 不可达通常会触发 ECONNREFUSED，表示该跳到达但端口关闭
      const ms = Date.now() - t0;
      if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(err.message)) {
        finish({ ttl, reached: true, host: "(icmp)", ms });
      } else {
        finish({ ttl, reached: false, error: err.message });
      }
    });
    // 设置 TTL（setTTL 在 @types/node 各版本中签名可能不同，这里以可选方法处理）
    type SocketWithTTL = net.Socket & { setTTL?: (ttl: number) => void };
    try {
      const s = sock as SocketWithTTL;
      if (typeof s.setTTL === "function") s.setTTL(ttl);
    } catch {
      // setTTL 在某些平台可能不可用，忽略
    }
    sock.connect({ host, port, family: 4 });
  });
}

async function traceroute(host: string, maxHops = 20, port = 80): Promise<void> {
  console.log(`[trace] ${host}:${port}  最大 ${maxHops} 跳`);
  console.log("  " + "─".repeat(50));
  for (let ttl = 1; ttl <= maxHops; ttl++) {
    const hop = await traceHop(host, port, ttl);
    const msStr = hop.ms !== undefined ? colorMs(hop.ms) : C.gray + "-" + C.reset;
    const hostStr = hop.host || (hop.error ? C.red + hop.error + C.reset : "*");
    console.log(`  ${String(ttl).padStart(3, " ")}  ${hostStr.padEnd(20)}  ${msStr}`);
    if (hop.reached && hop.host === host) {
      console.log(`\n[trace] 到达目标，共 ${ttl} 跳。`);
      return;
    }
  }
  console.log(`\n[trace] 未在 ${maxHops} 跳内到达目标。`);
}

// ---------------------------------------------------------------------------
// 下载测速
// ---------------------------------------------------------------------------

async function speedtest(): Promise<void> {
  // 使用 Cloudflare 的测速文件（无需 key）
  const candidates = [
    "https://speed.cloudflare.com/__down?bytes=10000000",  // 10MB
    "https://www.google.com/",
    "https://www.example.com/",
  ];
  console.log("[speedtest] 尝试下载测速文件...");
  for (const u of candidates) {
    try {
      const t0 = Date.now();
      const res = await new Promise<{ bytes: number; status: number; total: number }>((resolve, reject) => {
        const parsed = url.parse(u);
        const lib = parsed.protocol === "https:" ? https : http;
        const req = lib.request(
          {
            hostname: parsed.hostname || "",
            port: parsed.port ? Number(parsed.port) : undefined,
            path: parsed.path || "/",
            method: "GET",
            headers: { "User-Agent": "net-latency/1.0", "Accept-Encoding": "identity" },
            timeout: 20000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve({
              bytes: Buffer.concat(chunks).length,
              status: res.statusCode || 0,
              total: Date.now() - t0,
            }));
            res.on("error", (err: Error) => reject(err));
          }
        );
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", (err: Error) => reject(err));
        req.end();
      });
      const secs = res.total / 1000;
      const mbps = (res.bytes * 8) / 1e6 / secs;
      console.log(`[speedtest] 源: ${u}`);
      console.log(`  状态: ${res.status}`);
      console.log(`  下载: ${(res.bytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  耗时: ${res.total} ms`);
      console.log(`  速度: ${C.bold}${C.cyan}${mbps.toFixed(2)} Mbps${C.reset}`);
      return;
    } catch (err) {
      console.log(`[speedtest] ${u} 失败: ${(err as Error).message}`);
    }
  }
  console.log("[speedtest] 所有测速源均不可用。");
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

function computeStats(samples: Sample[]): Stats {
  const ok = samples.filter((s) => s.ok && s.ms !== undefined).map((s) => s.ms!) ;
  const fail = samples.length - ok.length;
  if (ok.length === 0) {
    return { n: samples.length, ok: 0, fail, min: 0, max: 0, avg: 0, stddev: 0 };
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
  console.log(`  发送: ${st.n}    成功: ${C.green}${st.ok}${C.reset}    失败: ${C.red}${st.fail}${C.reset}`);
  if (st.ok > 0) {
    console.log(`  最小: ${colorMs(st.min)}`);
    console.log(`  平均: ${colorMs(st.avg)}`);
    console.log(`  最大: ${colorMs(st.max)}`);
    console.log(`  标准差: ${colorMs(st.stddev)}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function cmdPing(host: string, count: number, interval: number): Promise<void> {
  console.log(`[ping] ${host}:80  count=${count}  interval=${interval}s`);
  const port = 80;
  const samples: Sample[] = [];
  for (let i = 0; i < count; i++) {
    const s = await tcpPing(host, port);
    samples.push(s);
    if (s.ok) {
      console.log(`  seq=${i + 1}  ${colorMs(s.ms!)}  ${C.gray}→ ${host}:${port}${C.reset}`);
    } else {
      console.log(`  seq=${i + 1}  ${C.red}失败${C.reset}  ${s.error}`);
    }
    if (i < count - 1) await sleep(interval * 1000);
  }
  printStats(`TCP Ping ${host}:${port}`, computeStats(samples));
}

async function cmdHttping(target: string, count: number): Promise<void> {
  console.log(`[httping] ${target}  count=${count}`);
  // 确保 URL 带协议
  const u = target.startsWith("http") ? target : `http://${target}`;
  const samples: HttpSample[] = [];
  const totals: Sample[] = [];
  for (let i = 0; i < count; i++) {
    const s = await httpPing(u);
    samples.push(s);
    if (s.ok) {
      totals.push({ ok: true, ms: s.total });
      console.log(
        `  seq=${i + 1}  status=${s.status}  total=${colorMs(s.total!)}  ` +
        `${C.gray}dns=${s.dns}ms connect=${s.connect}ms ttfb=${s.ttfb}ms${C.reset}`
      );
    } else {
      totals.push({ ok: false, error: s.error });
      console.log(`  seq=${i + 1}  ${C.red}失败${C.reset}  ${s.error}`);
    }
    if (i < count - 1) await sleep(1000);
  }
  printStats(`HTTP Ping ${u}`, computeStats(totals));
}

async function cmdTrace(host: string, maxHops: number): Promise<void> {
  await traceroute(host, maxHops);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
网络延迟测试工具 - 用法:
  node dist/index.js ping <host> [-c count] [-i interval]    TCP 连接 ping
  node dist/index.js httping <url> [-c count]                HTTP 延迟 ping
  node dist/index.js trace <host> [-m maxhops]               基本 traceroute
  node dist/index.js speedtest                                下载测速
  node dist/index.js help                                     显示本帮助

选项:
  -c, --count <n>       次数（默认 4）
  -i, --interval <s>    间隔秒数（默认 1）
  -m, --maxhops <n>     最大跳数（默认 20）

说明:
  - ping 使用 TCP 连接计时（无需 ICMP 权限）
  - httping 报告 DNS / connect / TTFB / total 四个阶段
  - trace 通过 setTTL 实现（部分平台可能受限）
  - speedtest 尝试 Cloudflare 测速文件
`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-c" || a === "--count") flags.count = args[++i];
    else if (a === "-i" || a === "--interval") flags.interval = args[++i];
    else if (a === "-m" || a === "--maxhops") flags.maxhops = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const { positional, flags } = parseFlags(argv.slice(1));
  const count = parseInt(flags.count || "4", 10) || 4;
  const interval = parseFloat(flags.interval || "1") || 1;
  const maxhops = parseInt(flags.maxhops || "20", 10) || 20;

  try {
    switch (cmd) {
      case "ping":
        if (!positional[0]) { console.log("请提供主机名。"); return; }
        await cmdPing(positional[0], Math.min(Math.max(count, 1), 100), Math.min(Math.max(interval, 0.2), 60));
        break;
      case "httping":
        if (!positional[0]) { console.log("请提供 URL。"); return; }
        await cmdHttping(positional[0], Math.min(Math.max(count, 1), 100));
        break;
      case "trace":
        if (!positional[0]) { console.log("请提供主机名。"); return; }
        await cmdTrace(positional[0], Math.min(Math.max(maxhops, 1), 64));
        break;
      case "speedtest":
        await speedtest();
        break;
      default:
        console.log(`未知命令: ${cmd}`);
        printHelp();
    }
  } catch (err) {
    console.error("运行出错:", (err as Error).message);
    process.exit(1);
  }
}

main();
