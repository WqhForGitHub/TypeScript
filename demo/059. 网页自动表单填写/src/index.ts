#!/usr/bin/env node
/**
 * 59. 网页自动表单填写
 * ------------------------------------------------------------------
 * 演示一个网页表单自动填写工具：
 *   - 解析 HTML 中的 <form> 与 <input>/<select>/<textarea>
 *   - 按用户提供的数据填充并提交（GET/POST、URL 编码）
 *   - 简易 cookie jar（跨请求保持 cookie）
 *   - 支持命令：inspect、fill、fill-file、batch
 *
 * 仅使用 Node.js 内置模块：fs、path、url、http、https、zlib、buffer、querystring。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as querystring from "querystring";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface FetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  finalUrl: string;
}

interface FormField {
  name: string;
  type: string;       // text/password/hidden/email/submit/checkbox/radio/...
  value: string;
  required: boolean;
  placeholder?: string;
  options?: string[]; // for <select>
}

interface HtmlForm {
  action: string;
  method: string;     // GET / POST
  enctype: string;
  fields: FormField[];
}

// ---------------------------------------------------------------------------
// Cookie Jar
// ---------------------------------------------------------------------------

class CookieJar {
  private store = new Map<string, string>();

  setFromHeader(setCookie: string | string[] | undefined, domain: string): void {
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of arr) {
      const pair = c.split(";", 2)[0];
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      this.store.set(`${domain}::${name}`, value);
    }
  }

  headerFor(domain: string): string {
    const out: string[] = [];
    for (const [key, val] of this.store) {
      if (key.startsWith(`${domain}::`)) {
        out.push(`${key.split("::")[1]}=${val}`);
      }
    }
    return out.join("; ");
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

// ---------------------------------------------------------------------------
// HTTP 助手
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchHttp(rawUrl: string, opts: FetchOptions = {}, jar?: CookieJar): Promise<FetchResult> {
  const timeout = opts.timeout ?? 12000;
  const method = (opts.method || "GET").toUpperCase();
  const parsed = url.parse(rawUrl);
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9",
    ...opts.headers,
  };
  if (jar) {
    const cookie = jar.headerFor(parsed.hostname || "");
    if (cookie) headers["Cookie"] = cookie;
  }
  if (opts.body) {
    headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
    headers["Content-Length"] = Buffer.byteLength(opts.body).toString();
  }

  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const p = url.parse(target);
      const lib = p.protocol === "https:" ? https : http;
      if (!p.hostname) { reject(new Error(`无效 URL: ${target}`)); return; }
      const req = lib.request(
        {
          hostname: p.hostname,
          port: p.port ? Number(p.port) : undefined,
          path: p.path || "/",
          method,
          headers,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects >= 5) { reject(new Error("重定向次数过多")); res.resume(); return; }
            redirects++;
            const next = url.resolve(target, res.headers.location);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }
          // 保存 cookie
          if (jar) jar.setFromHeader(res.headers["set-cookie"], p.hostname || "");
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => resolve({
            status: res.statusCode || 200,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: currentUrl,
          }));
          stream.on("error", (err: Error) => reject(err));
        }
      );
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时 (${timeout}ms)`)));
      req.on("error", (err: Error) => reject(err));
      if (opts.body) req.write(opts.body);
      req.end();
    };
    attempt(currentUrl);
  });
}

// ---------------------------------------------------------------------------
// HTML 表单解析
// ---------------------------------------------------------------------------

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? "";
    attrs[name] = value;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return attrs;
}

function parseForms(html: string, baseUrl: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  const formRe = /<form\s+([^>]*?)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRe.exec(html)) !== null) {
    const attrs = parseAttrs(fm[1]);
    const inner = fm[2];
    const action = attrs.action || "";
    const method = (attrs.method || "GET").toUpperCase();
    const enctype = attrs.enctype || "application/x-www-form-urlencoded";
    const fields: FormField[] = [];

    // <input>
    const inputRe = /<input\s+([^>]*?)\/?>/gi;
    let im: RegExpExecArray | null;
    while ((im = inputRe.exec(inner)) !== null) {
      const a = parseAttrs(im[1]);
      const type = (a.type || "text").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") continue;
      fields.push({
        name: a.name || a.id || "",
        type,
        value: a.value || "",
        required: a.required !== undefined,
        placeholder: a.placeholder,
      });
    }

    // <textarea>
    const taRe = /<textarea\s+([^>]*?)>([\s\S]*?)<\/textarea>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = taRe.exec(inner)) !== null) {
      const a = parseAttrs(tm[1]);
      fields.push({
        name: a.name || a.id || "",
        type: "textarea",
        value: stripTags(tm[2]),
        required: a.required !== undefined,
        placeholder: a.placeholder,
      });
    }

    // <select>
    const selRe = /<select\s+([^>]*?)>([\s\S]*?)<\/select>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = selRe.exec(inner)) !== null) {
      const a = parseAttrs(sm[1]);
      const options: string[] = [];
      const optRe = /<option\s+[^>]*?value=["']([^"']*)["'][^>]*>/gi;
      let om: RegExpExecArray | null;
      while ((om = optRe.exec(sm[2])) !== null) options.push(om[1]);
      fields.push({
        name: a.name || a.id || "",
        type: "select",
        value: "",
        required: a.required !== undefined,
        options,
      });
    }

    forms.push({
      action: action ? url.resolve(baseUrl, action) : baseUrl,
      method,
      enctype,
      fields,
    });
  }
  return forms;
}

// ---------------------------------------------------------------------------
// 表单填充与提交
// ---------------------------------------------------------------------------

function fillForm(form: HtmlForm, data: Record<string, string>): Record<string, string> {
  const filled: Record<string, string> = {};
  for (const f of form.fields) {
    if (!f.name) continue;
    if (data[f.name] !== undefined) {
      filled[f.name] = data[f.name];
    } else if (f.value) {
      filled[f.name] = f.value;
    } else {
      filled[f.name] = "";
    }
  }
  return filled;
}

async function submitForm(form: HtmlForm, data: Record<string, string>, jar: CookieJar): Promise<FetchResult> {
  const filled = fillForm(form, data);
  const body = querystring.stringify(filled);
  if (form.method === "GET") {
    const u = `${form.action}${form.action.includes("?") ? "&" : "?"}${body}`;
    return fetchHttp(u, { method: "GET" }, jar);
  }
  return fetchHttp(form.action, {
    method: "POST",
    body,
    headers: { "Content-Type": form.enctype },
  }, jar);
}

// ---------------------------------------------------------------------------
// 显示
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m",
  yellow: "\x1b[33m", gray: "\x1b[90m", red: "\x1b[31m",
};

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}

function printForms(forms: HtmlForm[]): void {
  if (forms.length === 0) {
    console.log("  页面未发现 <form>。");
    return;
  }
  forms.forEach((f, i) => {
    console.log("");
    console.log(`  ${C.bold}表单 #${i + 1}${C.reset}`);
    console.log("  " + "─".repeat(64));
    console.log(`  action: ${f.action}`);
    console.log(`  method: ${C.cyan}${f.method}${C.reset}    enctype: ${f.enctype}`);
    console.log(`  字段数: ${f.fields.length}`);
    console.log("");
    const widths = [20, 12, 8, 18, 22];
    const header = ["名称", "类型", "必填", "默认值", "占位符/选项"];
    console.log("  " + header.map((h, i2) => pad(h, widths[i2])).join(" "));
    console.log("  " + "─".repeat(80));
    for (const fd of f.fields) {
      const req = fd.required ? C.red + "是" + C.reset : "否";
      const extra = fd.placeholder || (fd.options ? fd.options.join(" | ") : "");
      const row = [fd.name || "(无name)", fd.type, req, fd.value.slice(0, 18), extra.slice(0, 22)];
      console.log("  " + row.map((r, i2) => pad(r, widths[i2])).join(" "));
    }
  });
  console.log("");
}

function printResponse(res: FetchResult, label: string): void {
  console.log("");
  console.log(`  ${C.bold}${label}${C.reset}`);
  console.log("  " + "─".repeat(64));
  console.log(`  状态:     ${res.status}`);
  console.log(`  最终URL:  ${res.finalUrl}`);
  console.log(`  大小:     ${res.body.length} 字节`);
  console.log(`  服务器:   ${res.headers.server || "-"}`);
  console.log(`  内容类型: ${res.headers["content-type"] || "-"}`);
  console.log("");
  console.log(`  响应正文前 500 字:`);
  console.log("  " + "─".repeat(64));
  console.log(res.body.slice(0, 500).replace(/\n/g, "\n  "));
  console.log("");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function cmdInspect(targetUrl: string): Promise<void> {
  console.log(`[inspect] ${targetUrl}`);
  try {
    const res = await fetchHttp(targetUrl);
    console.log(`[inspect] HTTP ${res.status}, ${res.body.length} 字节`);
    const forms = parseForms(res.body, res.finalUrl);
    printForms(forms);
  } catch (err) {
    console.log(`[inspect] 失败: ${(err as Error).message}`);
    console.log("[inspect] 演示用：使用内置表单示例。");
    printForms([demoForm(targetUrl)]);
  }
}

function demoForm(baseUrl: string): HtmlForm {
  return {
    action: baseUrl,
    method: "POST",
    enctype: "application/x-www-form-urlencoded",
    fields: [
      { name: "username", type: "text", value: "", required: true, placeholder: "用户名" },
      { name: "password", type: "password", value: "", required: true, placeholder: "密码" },
      { name: "remember", type: "checkbox", value: "1", required: false },
      { name: "csrf_token", type: "hidden", value: "demo-csrf-12345", required: false },
    ],
  };
}

async function cmdFill(targetUrl: string, dataPairs: string[]): Promise<void> {
  console.log(`[fill] ${targetUrl}`);
  const data: Record<string, string> = {};
  for (const p of dataPairs) {
    const idx = p.indexOf("=");
    if (idx === -1) { console.log(`[fill] 忽略无效参数: ${p}`); continue; }
    data[p.slice(0, idx)] = p.slice(idx + 1);
  }
  console.log(`[fill] 提供数据: ${JSON.stringify(data)}`);
  const jar = new CookieJar();
  // 1. GET 表单页（拿 cookie 与表单）
  let form: HtmlForm;
  try {
    const res = await fetchHttp(targetUrl, {}, jar);
    const forms = parseForms(res.body, res.finalUrl);
    if (forms.length === 0) {
      console.log("[fill] 页面无表单，使用演示表单。");
      form = demoForm(res.finalUrl);
    } else {
      form = forms[0];
    }
  } catch (err) {
    console.log(`[fill] 抓取表单失败: ${(err as Error).message}，使用演示表单。`);
    form = demoForm(targetUrl);
  }
  // 2. 提交
  try {
    const res = await submitForm(form, data, jar);
    printResponse(res, "提交结果");
    console.log(`[fill] 当前 cookie: ${JSON.stringify(jar.toJSON())}`);
  } catch (err) {
    console.log(`[fill] 提交失败: ${(err as Error).message}`);
  }
}

async function cmdFillFile(targetUrl: string, dataFile: string): Promise<void> {
  console.log(`[fill-file] ${targetUrl}  数据文件: ${dataFile}`);
  let data: Record<string, string>;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), dataFile), "utf8");
    data = JSON.parse(raw) as Record<string, string>;
  } catch (err) {
    console.log(`[fill-file] 读取数据文件失败: ${(err as Error).message}`);
    return;
  }
  const pairs = Object.entries(data).map(([k, v]) => `${k}=${v}`);
  await cmdFill(targetUrl, pairs);
}

async function cmdBatch(targetUrl: string, dataFile: string): Promise<void> {
  console.log(`[batch] ${targetUrl}  批量数据: ${dataFile}`);
  let arr: Array<Record<string, string>>;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), dataFile), "utf8");
    const parsed = JSON.parse(raw);
    arr = Array.isArray(parsed) ? (parsed as Array<Record<string, string>>) : [parsed as Record<string, string>];
  } catch (err) {
    console.log(`[batch] 读取数据文件失败: ${(err as Error).message}`);
    return;
  }
  console.log(`[batch] 共 ${arr.length} 组数据`);
  for (let i = 0; i < arr.length; i++) {
    console.log(`\n========== 第 ${i + 1}/${arr.length} 组 ==========`);
    const pairs = Object.entries(arr[i]).map(([k, v]) => `${k}=${v}`);
    await cmdFill(targetUrl, pairs);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
网页自动表单填写 - 用法:
  node dist/index.js inspect <url>                       解析页面表单与字段
  node dist/index.js fill <url> -d key=value -d k2=v2    按数据提交一次
  node dist/index.js fill-file <url> <data.json>         从 JSON 读取数据提交
  node dist/index.js batch <url> <data.json>             批量提交（数组）
  node dist/index.js help                                显示本帮助

说明:
  - 支持 GET / POST，自动 URL 编码
  - 简易 cookie jar，跨请求保持 cookie
  - <input>/<select>/<textarea> 均可解析
`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string[]> } {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-d" || a === "--data") {
      if (!flags.data) flags.data = [];
      flags.data.push(args[++i]);
    } else if (a.startsWith("--")) {
      flags[a.slice(2)] = [args[++i]];
    } else {
      positional.push(a);
    }
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

  try {
    switch (cmd) {
      case "inspect":
        if (!positional[0]) { console.log("请提供 URL。"); return; }
        await cmdInspect(positional[0]);
        break;
      case "fill":
        if (!positional[0]) { console.log("请提供 URL。"); return; }
        await cmdFill(positional[0], flags.data || []);
        break;
      case "fill-file":
        if (!positional[0] || !positional[1]) { console.log("用法: fill-file <url> <data.json>"); return; }
        await cmdFillFile(positional[0], positional[1]);
        break;
      case "batch":
        if (!positional[0] || !positional[1]) { console.log("用法: batch <url> <data.json>"); return; }
        await cmdBatch(positional[0], positional[1]);
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
