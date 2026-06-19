#!/usr/bin/env node
/**
 * 网络请求测试 CLI (Network Request Testing CLI)
 *
 * 类似简易版 curl/HTTPie，支持 GET/POST/PUT/DELETE/HEAD 请求、文件下载、
 * 主机 Ping (TCP 连通性)，显示状态码、响应头、响应正文与请求计时，
 * 并对 application/json 响应自动美化输出。
 *
 * 命令:
 *   get <url> [-H header...] [-v]                       发送 GET 请求
 *   post <url> [-d data] [-t type] [-H header...] [-v]  发送 POST 请求
 *   put <url> [-d data] [-t type] [-H header...] [-v]   发送 PUT 请求
 *   delete <url> [-H header...] [-v]                    发送 DELETE 请求
 *   head <url> [-H header...] [-v]                      发送 HEAD 请求
 *   download <url> [-o file]                            下载文件到本地
 *   ping <host> [-c count] [-p port]                    TCP 连通性测试 (默认 4 次, 端口 80)
 *   help                                                显示帮助
 *
 * 选项:
 *   -H, --header <k:v>   自定义请求头 (可多次)
 *   -d, --data <data>    请求体
 *   -t, --type <type>    Content-Type (默认 application/json)
 *   -o, --output <file>  输出文件路径
 *   -v, --verbose        显示请求详情
 *   -c, --count <n>      Ping 次数
 *   -p, --port <n>       Ping 端口
 */

import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as url from "url";
import * as fs from "fs";
import * as path from "path";

interface RequestOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: string;
  verbose?: boolean;
}

interface ResponseInfo {
  statusCode: number;
  statusMessage: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  elapsedMs: number;
}

/** 执行 HTTP/HTTPS 请求 */
function request(opts: RequestOptions): Promise<ResponseInfo> {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(opts.url);
    if (!parsed.hostname) { reject(new Error(`无效的 URL: ${opts.url}`)); return; }
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.data && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (opts.data) headers["Content-Length"] = Buffer.byteLength(opts.data).toString();
    if (!headers["User-Agent"]) headers["User-Agent"] = "nettest/1.0";
    const reqOpts: https.RequestOptions = {
      method: opts.method,
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80),
      path: (parsed.pathname || "/") + (parsed.search || ""),
      headers,
    };
    const start = process.hrtime.bigint();
    const req = lib.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
        resolve({
          statusCode: res.statusCode ?? 0,
          statusMessage: res.statusMessage ?? "",
          headers: res.headers,
          body: Buffer.concat(chunks),
          elapsedMs,
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (opts.data) req.write(opts.data);
    req.end();
  });
}

/** 解析公共选项 (-H, -d, -t, -v) */
function parseCommonArgs(args: string[]): { url: string; headers: Record<string, string>; data?: string; verbose: boolean; rest: string[] } {
  const headers: Record<string, string> = {};
  let data: string | undefined;
  let contentType = "application/json";
  let verbose = false;
  let urlVal = "";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-H" || a === "--header") {
      const h = args[++i] ?? "";
      const sep = h.indexOf(":");
      if (sep < 0) throw new Error(`无效的请求头格式: ${h} (应为 Key: Value)`);
      headers[h.slice(0, sep).trim()] = h.slice(sep + 1).trim();
    } else if (a === "-d" || a === "--data") {
      data = args[++i];
    } else if (a === "-t" || a === "--type") {
      contentType = args[++i] ?? "application/json";
      headers["Content-Type"] = contentType;
    } else if (a === "-v" || a === "--verbose") {
      verbose = true;
    } else if (!urlVal && !a.startsWith("-")) {
      urlVal = a;
    } else {
      rest.push(a);
    }
  }
  return { url: urlVal, headers, data, verbose, rest };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function colorStatus(code: number): string {
  if (code >= 200 && code < 300) return `\x1b[32m${code}\x1b[0m`;
  if (code >= 300 && code < 400) return `\x1b[36m${code}\x1b[0m`;
  if (code >= 400 && code < 500) return `\x1b[33m${code}\x1b[0m`;
  if (code >= 500) return `\x1b[31m${code}\x1b[0m`;
  return String(code);
}

/** 美化输出响应 */
function printResponse(res: ResponseInfo, verbose: boolean, reqOpts: RequestOptions): void {
  if (verbose) {
    console.log(`\n\x1b[90m> ${reqOpts.method} ${reqOpts.url}\x1b[0m`);
    for (const [k, v] of Object.entries(reqOpts.headers)) console.log(`\x1b[90m> ${k}: ${v}\x1b[0m`);
    if (reqOpts.data) console.log(`\x1b[90m>\n> ${reqOpts.data}\x1b[0m`);
  }
  console.log(`\n状态:     ${colorStatus(res.statusCode)} ${res.statusMessage}`);
  console.log(`耗时:     ${res.elapsedMs.toFixed(2)} ms`);
  console.log(`大小:     ${formatBytes(res.body.length)}`);
  console.log(`\n响应头:`);
  for (const [k, v] of Object.entries(res.headers)) console.log(`  ${k}: ${v}`);
  if (res.body.length === 0) { console.log("\n(无响应体)\n"); return; }
  console.log(`\n响应体:`);
  const ct = (res.headers["content-type"] ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      const json = JSON.parse(res.body.toString("utf8"));
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(res.body.toString("utf8"));
    }
  } else if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || ct.includes("html") || ct.includes("javascript")) {
    console.log(res.body.toString("utf8"));
  } else {
    console.log(`(二进制数据 ${formatBytes(res.body.length)}，未显示)`);
  }
  console.log("");
}

async function cmdSimple(method: string, args: string[]): Promise<void> {
  const { url: u, headers, data, verbose } = parseCommonArgs(args);
  if (!u) { console.error(`错误: 请提供 URL，例如 ${method.toLowerCase()} https://example.com`); process.exit(1); }
  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    // 这些方法一般无 body
  }
  try {
    const res = await request({ method, url: u, headers, data, verbose });
    printResponse(res, verbose, { method, url: u, headers, data, verbose });
  } catch (err) {
    console.error(`\x1b[31m请求失败: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    process.exit(1);
  }
}

async function cmdDownload(args: string[]): Promise<void> {
  if (!args[0]) { console.error("错误: 用法 download <url> [-o file]"); process.exit(1); }
  const u = args[0];
  let outPath = "";
  for (let i = 1; i < args.length; i++) if (args[i] === "-o" || args[i] === "--output") outPath = args[++i] ?? "";
  if (!outPath) {
    const parsed = url.parse(u);
    const base = path.basename(parsed.pathname || "") || "download.bin";
    outPath = base;
  }
  console.log(`正在下载: ${u}`);
  try {
    const res = await request({ method: "GET", url: u, headers: {} });
    if (res.statusCode >= 400) { console.error(`\x1b[31m下载失败，状态码: ${res.statusCode}\x1b[0m`); process.exit(1); }
    fs.writeFileSync(outPath, res.body);
    console.log(`\x1b[32m下载完成: ${path.resolve(outPath)}\x1b[0m`);
    console.log(`大小: ${formatBytes(res.body.length)}  耗时: ${res.elapsedMs.toFixed(2)} ms  速度: ${(res.body.length / 1024 / (res.elapsedMs / 1000)).toFixed(2)} KB/s`);
  } catch (err) {
    console.error(`\x1b[31m下载失败: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    process.exit(1);
  }
}

async function cmdPing(args: string[]): Promise<void> {
  if (!args[0]) { console.error("错误: 用法 ping <host> [-c count] [-p port]"); process.exit(1); }
  const host = args[0];
  let count = 4;
  let port = 80;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "-c" || args[i] === "--count") count = parseInt(args[++i] ?? "4", 10);
    else if (args[i] === "-p" || args[i] === "--port") port = parseInt(args[++i] ?? "80", 10);
  }
  console.log(`PING ${host}:${port} (${count} 次 TCP 连通性测试)\n`);
  let success = 0;
  let totalMs = 0;
  let minMs = Infinity, maxMs = 0;
  for (let i = 0; i < count; i++) {
    const start = process.hrtime.bigint();
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        socket.once("connect", () => { socket.destroy(); resolve(); });
        socket.once("timeout", () => { socket.destroy(); reject(new Error("超时")); });
        socket.once("error", reject);
        socket.connect(port, host);
      });
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      success++;
      totalMs += ms;
      minMs = Math.min(minMs, ms);
      maxMs = Math.max(maxMs, ms);
      console.log(`  来自 ${host}:${port}: 连接成功 time=${ms.toFixed(2)} ms`);
    } catch (err) {
      console.log(`  来自 ${host}:${port}: \x1b[31m连接失败 (${err instanceof Error ? err.message : "错误"})\x1b[0m`);
    }
    if (i < count - 1) await new Promise(r => setTimeout(r, 500));
  }
  console.log(`\n--- ${host}:${port} 统计 ---`);
  console.log(`发送: ${count}, 成功: ${success}, 失败: ${count - success}, 丢包率: ${(((count - success) / count) * 100).toFixed(0)}%`);
  if (success > 0) {
    console.log(`最小: ${minMs.toFixed(2)} ms, 最大: ${maxMs.toFixed(2)} ms, 平均: ${(totalMs / success).toFixed(2)} ms`);
  }
  console.log("");
}

function printHelp(): void {
  console.log(`
网络请求测试 CLI (Network Request Testing CLI)
=============================================
类似简易版 curl/HTTPie 的网络请求测试工具。

用法:
  nettest get <url> [-H header...] [-v]                       GET 请求
  nettest post <url> [-d data] [-t type] [-H header...] [-v]  POST 请求
  nettest put <url> [-d data] [-t type] [-H header...] [-v]   PUT 请求
  nettest delete <url> [-H header...] [-v]                    DELETE 请求
  nettest head <url> [-H header...] [-v]                      HEAD 请求
  nettest download <url> [-o file]                            下载文件
  nettest ping <host> [-c count] [-p port]                    TCP 连通性测试
  nettest help                                                显示本帮助

选项:
  -H, --header <k:v>   自定义请求头 (可多次使用)
  -d, --data <data>    请求体
  -t, --type <type>    Content-Type (默认 application/json)
  -o, --output <file>  输出文件路径
  -v, --verbose        显示请求详情
  -c, --count <n>      Ping 次数 (默认 4)
  -p, --port <n>       Ping 端口 (默认 80)

示例:
  nettest get https://httpbin.org/get
  nettest get https://api.github.com -H "Accept: application/vnd.github.v3+json"
  nettest post https://httpbin.org/post -d '{"name":"test"}' -t application/json
  nettest put https://httpbin.org/put -d 'updated' -H "Authorization: Bearer token"
  nettest head https://example.com
  nettest download https://example.com/file.zip -o file.zip
  nettest ping example.com -c 5 -p 443
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "get": await cmdSimple("GET", rest); break;
      case "post": await cmdSimple("POST", rest); break;
      case "put": await cmdSimple("PUT", rest); break;
      case "delete": await cmdSimple("DELETE", rest); break;
      case "head": await cmdSimple("HEAD", rest); break;
      case "download": await cmdDownload(rest); break;
      case "ping": await cmdPing(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'nettest help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
