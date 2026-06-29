#!/usr/bin/env node
/**
 * 59. 网页自动表单填写 — 增强版
 * 网页表单自动填写工具：解析 HTML 表单、填充数据、提交、cookie 管理。
 * 仅使用 Node.js 内置模块 (fs, path, url, http, https, zlib, querystring)。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as querystring from "querystring";

// ============================================================
// 1. 枚举
// ============================================================

enum Command {
  Inspect = "inspect",
  Fill = "fill",
  FillFile = "fill-file",
  Batch = "batch",
  Help = "help",
}

enum HttpMethod {
  Get = "GET",
  Post = "POST",
}

enum ContentType {
  FormUrlencoded = "application/x-www-form-urlencoded",
  Multipart = "multipart/form-data",
  TextPlain = "text/plain",
}

enum FieldType {
  Text = "text",
  Password = "password",
  Hidden = "hidden",
  Email = "email",
  Checkbox = "checkbox",
  Radio = "radio",
  Select = "select",
  Textarea = "textarea",
  Number = "number",
  Tel = "tel",
  Url = "url",
}

enum ErrorCode {
  NetworkError = "network_error",
  TimeoutError = "timeout_error",
  ParseError = "parse_error",
  IoError = "io_error",
  NoForm = "no_form",
}

enum SubmitStatus {
  Success = "success",
  Redirect = "redirect",
  Error = "error",
}

// ============================================================
// 2. 类型与工具类型
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface FetchOptions {
  readonly timeout?: number;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface FetchResult {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  readonly finalUrl: string;
}

type TextField = {
  readonly kind: FieldType.Text;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
  readonly placeholder?: string;
};

type PasswordField = {
  readonly kind: FieldType.Password;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
  readonly placeholder?: string;
};

type HiddenField = {
  readonly kind: FieldType.Hidden;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
};

type SelectField = {
  readonly kind: FieldType.Select;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
  readonly options: readonly string[];
};

type TextareaField = {
  readonly kind: FieldType.Textarea;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
  readonly placeholder?: string;
};

type CheckboxField = {
  readonly kind: FieldType.Checkbox;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
};

type RadioField = {
  readonly kind: FieldType.Radio;
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
};

type FormFieldVariant =
  | TextField
  | PasswordField
  | HiddenField
  | SelectField
  | TextareaField
  | CheckboxField
  | RadioField;

interface HtmlForm {
  readonly action: string;
  readonly method: HttpMethod;
  readonly enctype: ContentType;
  readonly fields: readonly FormFieldVariant[];
}

interface Identifiable {
  readonly id: string;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

abstract class FormError extends Error {
  abstract readonly code: ErrorCode;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class NetworkErrorX extends FormError {
  readonly code = ErrorCode.NetworkError;
}

class TimeoutErrorX extends FormError {
  readonly code = ErrorCode.TimeoutError;
}

class ParseErrorX extends FormError {
  readonly code = ErrorCode.ParseError;
}

class NoFormError extends FormError {
  readonly code = ErrorCode.NoForm;
}

// ============================================================
// 4. 常量、Symbol、as const、satisfies
// ============================================================

const SYM_META = Symbol("formMeta");
const SYM_HASH = Symbol("formHash");

interface FormMeta {
  readonly parsedAt: Date;
  fieldCount: number;
}

interface LoggerShape {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const Logger: LoggerShape = {
  info: (m) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  warn: (m) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  error: (m) => console.error(`\x1b[31m[ERROR]\x1b[0m ${m}`),
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_UA,
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "zh-CN,zh;q=0.9",
} as const;

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
} as const;

// ============================================================
// 5. CookieJar (泛型 + Symbol)
// ============================================================

class CookieJar {
  private readonly store = new Map<string, string>();

  setFromHeader(
    setCookie: string | string[] | undefined,
    domain: string,
  ): void {
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of arr) {
      const pair = c.split(";", 2)[0];
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      this.store.set(
        `${domain}::${pair.slice(0, idx).trim()}`,
        pair.slice(idx + 1).trim(),
      );
    }
  }

  headerFor(domain: string): string {
    const out: string[] = [];
    for (const [key, val] of this.store) {
      if (key.startsWith(`${domain}::`))
        out.push(`${key.split("::")[1]}=${val}`);
    }
    return out.join("; ");
  }

  *[Symbol.iterator](): Generator<readonly [string, string]> {
    for (const [k, v] of this.store.entries()) yield [k, v] as const;
  }

  get count(): number {
    return this.store.size;
  }
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

// ============================================================
// 6. HTTP 助手
// ============================================================

function fetchHttp(
  rawUrl: string,
  opts: FetchOptions = {},
  jar?: CookieJar,
): Promise<FetchResult> {
  const timeout = opts.timeout ?? 12000;
  const method = (opts.method || "GET").toUpperCase();
  const parsed = url.parse(rawUrl);
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...opts.headers,
  };
  if (jar) {
    const cookie = jar.headerFor(parsed.hostname || "");
    if (cookie) headers["Cookie"] = cookie;
  }
  if (opts.body) {
    headers["Content-Type"] =
      headers["Content-Type"] || ContentType.FormUrlencoded;
    headers["Content-Length"] = Buffer.byteLength(opts.body).toString();
  }
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const p = url.parse(target);
      const lib = p.protocol === "https:" ? https : http;
      if (!p.hostname) {
        reject(new NetworkErrorX(`无效 URL: ${target}`));
        return;
      }
      const req = lib.request(
        {
          hostname: p.hostname,
          port: p.port ? Number(p.port) : undefined,
          path: p.path || "/",
          method,
          headers,
        },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= 5) {
              reject(new NetworkErrorX("重定向次数过多"));
              res.resume();
              return;
            }
            redirects++;
            const next = url.resolve(target, res.headers.location);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }
          if (jar)
            jar.setFromHeader(res.headers["set-cookie"], p.hostname || "");
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br")
            stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () =>
            resolve({
              status: res.statusCode || 200,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              finalUrl: currentUrl,
            }),
          );
          stream.on("error", (err: Error) =>
            reject(new NetworkErrorX(err.message)),
          );
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new TimeoutErrorX(`请求超时 (${timeout}ms)`)),
      );
      req.on("error", (err: Error) => reject(new NetworkErrorX(err.message)));
      if (opts.body) req.write(opts.body);
      req.end();
    };
    attempt(currentUrl);
  });
}

// ============================================================
// 7. HTML 表单解析
// ============================================================

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return attrs;
}

function classifyFieldType(type: string): FieldType {
  const t = type.toLowerCase();
  if (Object.values(FieldType).includes(t as FieldType)) return t as FieldType;
  return FieldType.Text;
}

function parseForms(html: string, baseUrl: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  const formRe = /<form\s+([^>]*?)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRe.exec(html)) !== null) {
    const attrs = parseAttrs(fm[1] || "");
    const inner = fm[2] || "";
    const action = attrs.action || "";
    const methodStr = (attrs.method || "GET").toUpperCase();
    const method: HttpMethod =
      methodStr === "POST" ? HttpMethod.Post : HttpMethod.Get;
    const enctypeStr = attrs.enctype || ContentType.FormUrlencoded;
    const enctype: ContentType =
      enctypeStr === ContentType.Multipart
        ? ContentType.Multipart
        : enctypeStr === ContentType.TextPlain
          ? ContentType.TextPlain
          : ContentType.FormUrlencoded;
    const fields: FormFieldVariant[] = [];

    const inputRe = /<input\s+([^>]*?)\/?>/gi;
    let im: RegExpExecArray | null;
    while ((im = inputRe.exec(inner)) !== null) {
      const a = parseAttrs(im[1] || "");
      const rawType = (a.type || "text").toLowerCase();
      if (
        rawType === "submit" ||
        rawType === "button" ||
        rawType === "reset" ||
        rawType === "image" ||
        rawType === "file"
      )
        continue;
      const type = classifyFieldType(rawType);
      const name = a.name || a.id || "";
      const value = a.value || "";
      const required = a.required !== undefined;
      const kind = type as FieldType;
      if (kind === FieldType.Select || kind === FieldType.Textarea) continue;
      if (kind === FieldType.Hidden) {
        fields.push({ kind: FieldType.Hidden, name, value, required });
      } else if (kind === FieldType.Password) {
        fields.push({
          kind: FieldType.Password,
          name,
          value,
          required,
          placeholder: a.placeholder,
        });
      } else if (kind === FieldType.Checkbox) {
        fields.push({ kind: FieldType.Checkbox, name, value, required });
      } else if (kind === FieldType.Radio) {
        fields.push({ kind: FieldType.Radio, name, value, required });
      } else {
        fields.push({
          kind: FieldType.Text,
          name,
          value,
          required,
          placeholder: a.placeholder,
        });
      }
    }

    const taRe = /<textarea\s+([^>]*?)>([\s\S]*?)<\/textarea>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = taRe.exec(inner)) !== null) {
      const a = parseAttrs(tm[1] || "");
      fields.push({
        kind: FieldType.Textarea,
        name: a.name || a.id || "",
        value: stripTags(tm[2] || ""),
        required: a.required !== undefined,
        placeholder: a.placeholder,
      });
    }

    const selRe = /<select\s+([^>]*?)>([\s\S]*?)<\/select>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = selRe.exec(inner)) !== null) {
      const a = parseAttrs(sm[1] || "");
      const options: string[] = [];
      const optRe = /<option\s+[^>]*?value=["']([^"']*)["'][^>]*>/gi;
      let om: RegExpExecArray | null;
      while ((om = optRe.exec(sm[2] || "")) !== null) options.push(om[1] ?? "");
      fields.push({
        kind: FieldType.Select,
        name: a.name || a.id || "",
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

// ============================================================
// 8. 表单填充与提交
// ============================================================

function fillForm(
  form: HtmlForm,
  data: Record<string, string>,
): Record<string, string> {
  const filled: Record<string, string> = {};
  for (const f of form.fields) {
    if (!f.name) continue;
    filled[f.name] = data[f.name] !== undefined ? data[f.name]! : f.value || "";
  }
  return filled;
}

async function submitForm(
  form: HtmlForm,
  data: Record<string, string>,
  jar: CookieJar,
): Promise<FetchResult> {
  const filled = fillForm(form, data);
  const body = querystring.stringify(filled);
  if (form.method === HttpMethod.Get) {
    const u = `${form.action}${form.action.includes("?") ? "&" : "?"}${body}`;
    return fetchHttp(u, { method: "GET" }, jar);
  }
  return fetchHttp(
    form.action,
    { method: "POST", body, headers: { "Content-Type": form.enctype } },
    jar,
  );
}

// ============================================================
// 9. 类型守卫
// ============================================================

function isTextField(f: FormFieldVariant): f is TextField {
  return f.kind === FieldType.Text;
}
function isSelectField(f: FormFieldVariant): f is SelectField {
  return f.kind === FieldType.Select;
}
function isHiddenField(f: FormFieldVariant): f is HiddenField {
  return f.kind === FieldType.Hidden;
}
function isFormError(err: unknown): err is FormError {
  return err instanceof FormError;
}

// ============================================================
// 10. 泛型表单存储
// ============================================================

class FormStore<T extends Identifiable> {
  private readonly items = new Map<string, T>();
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  get name(): string {
    return this._name;
  }
  set name(v: string) {
    this._name = v;
  }
  get count(): number {
    return this.items.size;
  }

  add(item: T): void {
    this.items.set(item.id, item);
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }

  *[Symbol.iterator](): Generator<T> {
    for (const v of this.items.values()) yield v;
  }
}

// ============================================================
// 11. 显示
// ============================================================

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  return w >= n ? s : s + " ".repeat(n - w);
}

function printForms(forms: readonly HtmlForm[]): void {
  if (forms.length === 0) {
    console.log("  页面未发现 <form>。");
    return;
  }
  for (const [i, f] of forms.entries()) {
    console.log("");
    console.log(`  ${C.bold}表单 #${i + 1}${C.reset}`);
    console.log("  " + "─".repeat(64));
    console.log(`  action: ${f.action}`);
    console.log(
      `  method: ${C.cyan}${f.method}${C.reset}    enctype: ${f.enctype}`,
    );
    console.log(`  字段数: ${f.fields.length}`);
    console.log("");
    const widths = [20, 12, 8, 18, 22];
    const header = ["名称", "类型", "必填", "默认值", "占位符/选项"];
    console.log("  " + header.map((h, i2) => pad(h, widths[i2]!)).join(" "));
    console.log("  " + "─".repeat(80));
    for (const fd of f.fields) {
      const req = fd.required ? C.red + "是" + C.reset : "否";
      const extra =
        "placeholder" in fd
          ? fd.placeholder || ""
          : "options" in fd
            ? fd.options.join(" | ")
            : "";
      const row = [
        fd.name || "(无name)",
        fd.kind,
        req,
        fd.value.slice(0, 18),
        extra.slice(0, 22),
      ];
      console.log(
        "  " + row.map((r, i2) => pad(String(r), widths[i2]!)).join(" "),
      );
    }
  }
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

// ============================================================
// 12. 抽象表单处理器
// ============================================================

abstract class AbstractFormHandler {
  abstract readonly name: string;
  abstract handle(
    targetUrl: string,
    data: Record<string, string>,
  ): Promise<FetchResult>;
}

class SimpleFormHandler extends AbstractFormHandler {
  readonly name = "SimpleFormHandler";

  async handle(
    targetUrl: string,
    data: Record<string, string>,
  ): Promise<FetchResult> {
    const jar = new CookieJar();
    let form: HtmlForm;
    try {
      const res = await fetchHttp(targetUrl, {}, jar);
      const forms = parseForms(res.body, res.finalUrl);
      if (forms.length === 0) {
        Logger.warn("页面无表单，使用演示表单。");
        form = demoForm(res.finalUrl);
      } else {
        form = forms[0]!;
      }
    } catch (err) {
      Logger.warn(
        `抓取表单失败: ${err instanceof Error ? err.message : String(err)}，使用演示表单。`,
      );
      form = demoForm(targetUrl);
    }
    return submitForm(form, data, jar);
  }
}

// ============================================================
// 13. 演示表单
// ============================================================

function demoForm(baseUrl: string): HtmlForm {
  return {
    action: baseUrl,
    method: HttpMethod.Post,
    enctype: ContentType.FormUrlencoded,
    fields: [
      {
        kind: FieldType.Text,
        name: "username",
        value: "",
        required: true,
        placeholder: "用户名",
      },
      {
        kind: FieldType.Password,
        name: "password",
        value: "",
        required: true,
        placeholder: "密码",
      },
      {
        kind: FieldType.Checkbox,
        name: "remember",
        value: "1",
        required: false,
      },
      {
        kind: FieldType.Hidden,
        name: "csrf_token",
        value: "demo-csrf-12345",
        required: false,
      },
    ],
  };
}

// ============================================================
// 14. 命令实现
// ============================================================

async function cmdInspect(targetUrl: string): Promise<void> {
  Logger.info(`inspect ${targetUrl}`);
  try {
    const res = await fetchHttp(targetUrl);
    Logger.info(`HTTP ${res.status}, ${res.body.length} 字节`);
    const forms = parseForms(res.body, res.finalUrl);
    printForms(forms);
  } catch (err) {
    Logger.warn(`失败: ${err instanceof Error ? err.message : String(err)}`);
    Logger.warn("演示用：使用内置表单示例。");
    printForms([demoForm(targetUrl)]);
  }
}

async function cmdFill(
  targetUrl: string,
  dataPairs: readonly string[],
): Promise<void> {
  Logger.info(`fill ${targetUrl}`);
  const data: Record<string, string> = {};
  for (const p of dataPairs) {
    const idx = p.indexOf("=");
    if (idx === -1) {
      Logger.warn(`忽略无效参数: ${p}`);
      continue;
    }
    data[p.slice(0, idx)] = p.slice(idx + 1);
  }
  Logger.info(`提供数据: ${JSON.stringify(data)}`);
  const handler = new SimpleFormHandler();
  try {
    const res = await handler.handle(targetUrl, data);
    printResponse(res, "提交结果");
  } catch (err) {
    Logger.error(
      `提交失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function cmdFillFile(targetUrl: string, dataFile: string): Promise<void> {
  Logger.info(`fill-file ${targetUrl}  数据文件: ${dataFile}`);
  let data: Record<string, string>;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), dataFile), "utf8");
    data = JSON.parse(raw) as Record<string, string>;
  } catch (err) {
    Logger.error(
      `读取数据文件失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const pairs = Object.entries(data).map(([k, v]) => `${k}=${v}`);
  await cmdFill(targetUrl, pairs);
}

async function cmdBatch(targetUrl: string, dataFile: string): Promise<void> {
  Logger.info(`batch ${targetUrl}  批量数据: ${dataFile}`);
  let arr: Array<Record<string, string>>;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), dataFile), "utf8");
    const parsed = JSON.parse(raw);
    arr = Array.isArray(parsed)
      ? (parsed as Array<Record<string, string>>)
      : [parsed as Record<string, string>];
  } catch (err) {
    Logger.error(
      `读取数据文件失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  Logger.info(`共 ${arr.length} 组数据`);
  for (let i = 0; i < arr.length; i++) {
    console.log(`\n========== 第 ${i + 1}/${arr.length} 组 ==========`);
    const pairs = Object.entries(arr[i]!).map(([k, v]) => `${k}=${v}`);
    await cmdFill(targetUrl, pairs);
  }
}

// ============================================================
// 15. CLI
// ============================================================

interface ParsedFlags {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string[]>>;
}

function parseFlags(args: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-d" || a === "--data") {
      if (!flags.data) flags.data = [];
      flags.data.push(args[++i] ?? "");
    } else if (a.startsWith("--")) {
      flags[a.slice(2)] = [args[++i] ?? ""];
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0] as Command;
  const { positional, flags } = parseFlags(argv.slice(1));

  try {
    switch (cmd) {
      case Command.Inspect:
        if (!positional[0]) {
          Logger.error("请提供 URL。");
          return;
        }
        await cmdInspect(positional[0]);
        break;
      case Command.Fill:
        if (!positional[0]) {
          Logger.error("请提供 URL。");
          return;
        }
        await cmdFill(positional[0], flags.data ?? []);
        break;
      case Command.FillFile:
        if (!positional[0] || !positional[1]) {
          Logger.error("用法: fill-file <url> <data.json>");
          return;
        }
        await cmdFillFile(positional[0], positional[1]);
        break;
      case Command.Batch:
        if (!positional[0] || !positional[1]) {
          Logger.error("用法: batch <url> <data.json>");
          return;
        }
        await cmdBatch(positional[0], positional[1]);
        break;
      default:
        Logger.error(`未知命令: ${cmd}`);
        printHelp();
    }
  } catch (err) {
    const msg = isFormError(err)
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    Logger.error(`运行出错: ${msg}`);
    process.exit(1);
  }
}

main();
