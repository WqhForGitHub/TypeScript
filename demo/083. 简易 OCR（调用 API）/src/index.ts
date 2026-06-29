#!/usr/bin/env node
/**
 * 简易 OCR（调用 API） — Advanced TypeScript Edition
 * 调用可配置 HTTP OCR API（multipart 上传、JSON 解析、批量处理）；未配置时进入演示模式。
 * 仅使用 Node.js 内置模块（fs, path, http, https, crypto）。
 * 展示：字符串枚举、判别联合、泛型类+约束、抽象类+子类、映射类型、错误层级、
 *       satisfies、getter/setter、生成器/迭代器、Symbol 唯一键、as const、类型守卫、函数重载。
 */
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";

// 1. 字符串枚举（非 const enum）
enum OcrProvider {
  Mock = "mock",
  Tencent = "tencent",
  Baidu = "baidu",
}
enum ErrorCode {
  FileNotFound = "FILE_NOT_FOUND",
  HttpError = "HTTP_ERROR",
  Timeout = "TIMEOUT",
  InvalidResponse = "INVALID_RESPONSE",
  AuthFailed = "AUTH_FAILED",
  Unknown = "UNKNOWN",
}
enum ImageFormat {
  Jpeg = "JPEG",
  Png = "PNG",
  Bmp = "BMP",
  Ppm = "PPM/PGM",
  Tiff = "TIFF",
  Unknown = "UNKNOWN",
}
enum OcrStatus {
  Success = "SUCCESS",
  Error = "ERROR",
  Pending = "PENDING",
  Timeout = "TIMEOUT",
}
enum RequestState {
  Idle = "IDLE",
  InFlight = "IN_FLIGHT",
  Completed = "COMPLETED",
  Failed = "FAILED",
}

// 2. Symbol 唯一属性键
const PROVIDER_ID = Symbol("providerId");
const QUEUE_TICKET = Symbol("queueTicket");
const INTERNAL_META = Symbol("internalMeta");

// 3. 接口（含可选 / 只读 / 索引签名）
interface OcrConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly demoMode: boolean;
  readonly timeoutMs: number;
  readonly provider: OcrProvider;
  readonly maxRetries?: number;
  [key: string]: string | boolean | number | undefined;
}
interface OcrRequest {
  readonly source: string;
  readonly fileName: string;
  readonly fileData: Buffer;
  readonly format: ImageFormat;
  readonly lang?: string;
  [key: string]: unknown;
}
interface ProviderResponse {
  readonly ok: boolean;
  readonly text: string;
  readonly confidence: number;
  readonly raw?: string;
  readonly errorCode?: ErrorCode;
  readonly errorMessage?: string;
}
interface ProviderCapabilities {
  readonly supportsBatch: boolean;
  readonly maxImageBytes: number;
  readonly languages: readonly string[];
}
interface QueueStats {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
}

// 4. 判别联合（OcrOutcome）。OcrError 既是错误类（第 6 节）也是错误变体，通过 status 判别。
interface OcrSuccess {
  readonly status: OcrStatus.Success;
  readonly source: string;
  readonly mode: "live" | "demo";
  readonly text: string;
  readonly confidence: number;
  readonly raw?: string;
  readonly elapsedMs: number;
}
interface OcrPending {
  readonly status: OcrStatus.Pending;
  readonly source: string;
  readonly queuedAt: number;
}
interface OcrTimeout {
  readonly status: OcrStatus.Timeout;
  readonly source: string;
  readonly mode: "live" | "demo";
  readonly elapsedMs: number;
}
type OcrOutcome = OcrSuccess | OcrError | OcrPending | OcrTimeout;

// 5. 映射类型
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type OutcomeOfStatus<S extends OcrStatus> = Extract<
  OcrOutcome,
  { readonly status: S }
>;

// 6. 自定义错误类层级（OcrError extends Error，含 code 属性）
class OcrError extends Error {
  public readonly status: OcrStatus.Error = OcrStatus.Error;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly source: string = "",
    public readonly mode: "live" | "demo" = "live",
    public readonly elapsedMs: number = 0,
  ) {
    super(message);
    this.name = "OcrError";
    Object.setPrototypeOf(this, OcrError.prototype);
  }
}
class OcrAuthError extends OcrError {
  constructor(source: string, mode: "live" | "demo", elapsedMs: number) {
    super(ErrorCode.AuthFailed, "认证失败", source, mode, elapsedMs);
    this.name = "OcrAuthError";
    Object.setPrototypeOf(this, OcrAuthError.prototype);
  }
}
class OcrHttpError extends OcrError {
  constructor(
    message: string,
    source: string,
    mode: "live" | "demo",
    elapsedMs: number,
  ) {
    super(ErrorCode.HttpError, message, source, mode, elapsedMs);
    this.name = "OcrHttpError";
    Object.setPrototypeOf(this, OcrHttpError.prototype);
  }
}

// 7. 类型守卫
function isOcrSuccess(o: OcrOutcome): o is OcrSuccess {
  return o.status === OcrStatus.Success;
}
function isOcrError(o: OcrOutcome): o is OcrError {
  return o.status === OcrStatus.Error;
}
function isOcrPending(o: OcrOutcome): o is OcrPending {
  return o.status === OcrStatus.Pending;
}
function isOcrTimeout(o: OcrOutcome): o is OcrTimeout {
  return o.status === OcrStatus.Timeout;
}
function isOcrErrorInstance(e: unknown): e is OcrError {
  return e instanceof OcrError;
}
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

// 8. 抽象类与具体子类
abstract class AbstractOcrProvider {
  protected readonly providerName: string;
  protected state: RequestState = RequestState.Idle;
  [PROVIDER_ID]!: OcrProvider;
  constructor(providerName: string) {
    this.providerName = providerName;
  }
  abstract get capabilities(): ProviderCapabilities;
  abstract recognize(
    req: OcrRequest,
    cfg: OcrConfig,
  ): Promise<ProviderResponse>;
  get currentState(): RequestState {
    return this.state;
  }
  protected setState(next: RequestState): void {
    this.state = next;
  }
  /** 模板方法：前置校验 -> recognize -> 后置状态 */
  async execute(req: OcrRequest, cfg: OcrConfig): Promise<ProviderResponse> {
    this.setState(RequestState.InFlight);
    try {
      if (!req.fileData || req.fileData.length === 0) {
        this.setState(RequestState.Failed);
        return {
          ok: false,
          text: "",
          confidence: 0,
          errorCode: ErrorCode.Unknown,
          errorMessage: "空文件数据",
        };
      }
      if (req.fileData.length > this.capabilities.maxImageBytes) {
        this.setState(RequestState.Failed);
        return {
          ok: false,
          text: "",
          confidence: 0,
          errorCode: ErrorCode.Unknown,
          errorMessage: "文件过大",
        };
      }
      const res = await this.recognize(req, cfg);
      this.setState(res.ok ? RequestState.Completed : RequestState.Failed);
      return res;
    } catch (err) {
      this.setState(RequestState.Failed);
      return {
        ok: false,
        text: "",
        confidence: 0,
        errorCode: ErrorCode.Unknown,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

class MockProvider extends AbstractOcrProvider {
  constructor() {
    super("Mock");
    this[PROVIDER_ID] = OcrProvider.Mock;
  }
  get capabilities(): ProviderCapabilities {
    return {
      supportsBatch: true,
      maxImageBytes: 50 * 1024 * 1024,
      languages: ["auto", "zh", "en"],
    } satisfies ProviderCapabilities;
  }
  async recognize(req: OcrRequest, _cfg: OcrConfig): Promise<ProviderResponse> {
    const hash = crypto.createHash("md5").update(req.fileData).digest("hex");
    const sizeKB = (req.fileData.length / 1024).toFixed(2);
    const headHex = req.fileData.subarray(0, 8).toString("hex");
    const lines = [
      "[演示模式] 此为模拟识别结果，未调用真实 OCR API。",
      `文件: ${req.fileName}  格式: ${req.format}  大小: ${sizeKB} KB`,
      `指纹(md5): ${hash}`,
      `头字节: ${headHex}`,
      `建议: 设置 OCR_API_URL 与 OCR_API_KEY 环境变量后启用真实识别。`,
    ];
    return { ok: true, text: lines.join("\n"), confidence: 0.0 };
  }
}

class TencentProvider extends AbstractOcrProvider {
  constructor() {
    super("Tencent");
    this[PROVIDER_ID] = OcrProvider.Tencent;
  }
  get capabilities(): ProviderCapabilities {
    return {
      supportsBatch: false,
      maxImageBytes: 7 * 1024 * 1024,
      languages: ["zh", "en", "auto"],
    } satisfies ProviderCapabilities;
  }
  async recognize(req: OcrRequest, cfg: OcrConfig): Promise<ProviderResponse> {
    return callHttpOcr(req, cfg, { vendor: "tencent" });
  }
}

class BaiduProvider extends AbstractOcrProvider {
  constructor() {
    super("Baidu");
    this[PROVIDER_ID] = OcrProvider.Baidu;
  }
  get capabilities(): ProviderCapabilities {
    return {
      supportsBatch: true,
      maxImageBytes: 10 * 1024 * 1024,
      languages: ["zh", "en", "auto", "jp", "kor"],
    } satisfies ProviderCapabilities;
  }
  async recognize(req: OcrRequest, cfg: OcrConfig): Promise<ProviderResponse> {
    return callHttpOcr(req, cfg, { vendor: "baidu" });
  }
}

function createProvider(p: OcrProvider): AbstractOcrProvider {
  switch (p) {
    case OcrProvider.Tencent:
      return new TencentProvider();
    case OcrProvider.Baidu:
      return new BaiduProvider();
    case OcrProvider.Mock:
    default:
      return new MockProvider();
  }
}

// 9. HTTP OCR 调用 + multipart 构建
interface HttpOcrOptions {
  readonly vendor: "tencent" | "baidu";
}

function buildMultipart(
  fields: Record<string, string>,
  fileField: string,
  fileName: string,
  fileData: Buffer,
): { body: Buffer; contentType: string } {
  const boundary =
    "----SimpleOcrBoundary" + crypto.randomBytes(8).toString("hex");
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf-8",
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      "utf-8",
    ),
  );
  parts.push(fileData);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function callHttpOcr(
  req: OcrRequest,
  cfg: OcrConfig,
  opts: HttpOcrOptions,
): Promise<ProviderResponse> {
  return new Promise((resolve) => {
    const { body, contentType } = buildMultipart(
      { api_key: cfg.apiKey, lang: req.lang ?? "auto", vendor: opts.vendor },
      "image",
      req.fileName,
      req.fileData,
    );
    let url: URL;
    try {
      url = new URL(cfg.apiUrl);
    } catch {
      resolve({
        ok: false,
        text: "",
        confidence: 0,
        errorCode: ErrorCode.InvalidResponse,
        errorMessage: "API URL 无效",
      });
      return;
    }
    const reqOptions: http.RequestOptions = {
      method: "POST",
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": contentType,
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "simple-ocr/2.0",
      },
      timeout: cfg.timeoutMs,
    };
    const makeRequest: (
      o: http.RequestOptions,
      cb: (res: http.IncomingMessage) => void,
    ) => http.ClientRequest =
      url.protocol === "https:"
        ? (o, cb) => https.request(o, cb)
        : (o, cb) => http.request(o, cb);
    const r = makeRequest(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const text =
              parsed.text ??
              parsed.result ??
              parsed.recognized_text ??
              JSON.stringify(parsed);
            const confidence =
              typeof parsed.confidence === "number" ? parsed.confidence : 0.85;
            resolve({ ok: true, text: String(text), confidence, raw });
          } catch {
            resolve({
              ok: false,
              text: "",
              confidence: 0,
              raw,
              errorCode: ErrorCode.InvalidResponse,
              errorMessage: "响应不是有效 JSON",
            });
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({
            ok: false,
            text: "",
            confidence: 0,
            raw,
            errorCode: ErrorCode.AuthFailed,
            errorMessage: `HTTP ${res.statusCode}`,
          });
        } else {
          resolve({
            ok: false,
            text: "",
            confidence: 0,
            raw,
            errorCode: ErrorCode.HttpError,
            errorMessage: `HTTP ${res.statusCode}`,
          });
        }
      });
    });
    r.on("timeout", () => {
      r.destroy();
      resolve({
        ok: false,
        text: "",
        confidence: 0,
        errorCode: ErrorCode.Timeout,
        errorMessage: "请求超时",
      });
    });
    r.on("error", (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        text: "",
        confidence: 0,
        errorCode: ErrorCode.HttpError,
        errorMessage: err.message,
      });
    });
    r.write(body);
    r.end();
  });
}

// 10. 泛型类（带约束） OcrQueue<T extends OcrRequest> + 生成器/迭代器
class OcrQueue<T extends OcrRequest> {
  private readonly items: T[] = [];
  private readonly provider: AbstractOcrProvider;
  private _cfg: OcrConfig;
  private head = 0;
  private _stats: Mutable<QueueStats> = {
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
  };
  [INTERNAL_META]: { readonly createdAt: number; tag?: string } = {
    createdAt: Date.now(),
  };

  constructor(provider: AbstractOcrProvider, cfg: OcrConfig) {
    this.provider = provider;
    this._cfg = cfg;
  }

  get length(): number {
    return this.items.length - this.head;
  }
  get stats(): QueueStats {
    return { ...this._stats };
  }
  get config(): OcrConfig {
    return this._cfg;
  }
  set config(next: OcrConfig) {
    this._cfg = next;
  }

  enqueue(req: T): number {
    this.items.push(req);
    this._stats.total++;
    this._stats.pending++;
    return this.items.length;
  }
  enqueueMany(reqs: readonly T[]): number {
    for (const r of reqs) this.enqueue(r);
    return this.length;
  }

  /** 同步生成器：逐个产出待处理请求 */
  *drain(): Generator<T, void, unknown> {
    while (this.head < this.items.length) yield this.items[this.head++];
  }
  /** 异步生成器：逐个处理并产出 OcrOutcome */
  async *process(): AsyncGenerator<OcrOutcome, void, unknown> {
    for (const req of this.drain()) {
      const outcome = await this.runOne(req);
      if (isOcrSuccess(outcome)) this._stats.completed++;
      else if (isOcrError(outcome) || isOcrTimeout(outcome))
        this._stats.failed++;
      this._stats.pending = Math.max(0, this._stats.pending - 1);
      yield outcome;
    }
  }
  /** 快照当前排队中的请求为 OcrPending 列表 */
  pendingSnapshot(): OcrPending[] {
    const out: OcrPending[] = [];
    const now = Date.now();
    for (let i = this.head; i < this.items.length; i++) {
      out.push({
        status: OcrStatus.Pending,
        source: this.items[i].source,
        queuedAt: now,
      });
    }
    return out;
  }
  private async runOne(req: T): Promise<OcrOutcome> {
    const start = Date.now();
    const mode: "live" | "demo" = this._cfg.demoMode ? "demo" : "live";
    try {
      const resp = await this.provider.execute(req, this._cfg);
      const elapsedMs = Date.now() - start;
      if (resp.ok) {
        return {
          status: OcrStatus.Success,
          source: req.source,
          mode,
          text: resp.text,
          confidence: resp.confidence,
          raw: resp.raw,
          elapsedMs,
        } satisfies OcrSuccess;
      }
      const code = resp.errorCode ?? ErrorCode.Unknown;
      if (code === ErrorCode.Timeout) {
        return {
          status: OcrStatus.Timeout,
          source: req.source,
          mode,
          elapsedMs,
        } satisfies OcrTimeout;
      }
      if (code === ErrorCode.AuthFailed)
        return new OcrAuthError(req.source, mode, elapsedMs);
      if (code === ErrorCode.HttpError)
        return new OcrHttpError(
          resp.errorMessage ?? "HTTP 错误",
          req.source,
          mode,
          elapsedMs,
        );
      return new OcrError(
        code,
        resp.errorMessage ?? "未知错误",
        req.source,
        mode,
        elapsedMs,
      );
    } catch (err) {
      const elapsedMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return new OcrError(
        ErrorCode.Unknown,
        message,
        req.source,
        mode,
        elapsedMs,
      );
    }
  }
  [QUEUE_TICKET](n: number): T | undefined {
    return this.items[n];
  }
  [Symbol.iterator](): Iterator<T> {
    let i = 0;
    const arr = this.items;
    return {
      next(): IteratorResult<T> {
        if (i < arr.length) return { value: arr[i++], done: false };
        return { value: undefined as unknown as T, done: true };
      },
    };
  }
}

function expectSuccess(o: OcrOutcome): OutcomeOfStatus<OcrStatus.Success> {
  if (!isOcrSuccess(o)) throw new OcrError(ErrorCode.Unknown, "期望成功结果");
  return o;
}

// 11. 配置与工具函数（含函数重载、as const、satisfies）
const SUPPORTED_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".ppm",
  ".pgm",
  ".tif",
  ".tiff",
] as const;
type SupportedExt = (typeof SUPPORTED_EXTS)[number];
const DEFAULT_TIMEOUT = 30000 as const;

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || ".";
}
function tmpDir(): string {
  return process.env.TMPDIR || process.env.TEMP || process.env.TMP || ".";
}
const CONFIG_PATH: string = path.join(homeDir(), ".simple-ocr-config.json");

function safeParseJSON(s: string): Partial<OcrConfig> {
  try {
    return JSON.parse(s) as Partial<OcrConfig>;
  } catch {
    return {};
  }
}
function pickProvider(apiUrl: string, hinted?: OcrProvider): OcrProvider {
  if (hinted) return hinted;
  const u = apiUrl.toLowerCase();
  if (u.includes("tencent")) return OcrProvider.Tencent;
  if (u.includes("baidu")) return OcrProvider.Baidu;
  return OcrProvider.Mock;
}
function loadConfig(): OcrConfig {
  const fileConfig: Partial<OcrConfig> = fs.existsSync(CONFIG_PATH)
    ? safeParseJSON(fs.readFileSync(CONFIG_PATH, "utf-8"))
    : {};
  const apiUrl = process.env.OCR_API_URL ?? fileConfig.apiUrl ?? "";
  const apiKey = process.env.OCR_API_KEY ?? fileConfig.apiKey ?? "";
  const demoMode = apiUrl.length === 0;
  const provider = pickProvider(apiUrl, fileConfig.provider);
  return {
    apiUrl,
    apiKey,
    demoMode,
    timeoutMs: fileConfig.timeoutMs ?? DEFAULT_TIMEOUT,
    provider,
    maxRetries: fileConfig.maxRetries ?? 1,
  } satisfies OcrConfig;
}
function saveConfig(cfg: OcrConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}
function validateConfig(cfg: OcrConfig): void {
  if (cfg.timeoutMs < 0)
    throw new OcrError(ErrorCode.Unknown, "超时不能为负数");
  if (!cfg.demoMode && cfg.apiUrl.length === 0)
    throw new OcrError(ErrorCode.Unknown, "非演示模式必须配置 API URL");
}
function isSupportedExt(ext: string): ext is SupportedExt {
  return (SUPPORTED_EXTS as readonly string[]).includes(ext.toLowerCase());
}

// 函数重载：detectFormat
function detectFormat(buf: Buffer): ImageFormat;
function detectFormat(filePath: string, data: Buffer): ImageFormat;
function detectFormat(bufOrPath: Buffer | string, data?: Buffer): ImageFormat {
  const buf =
    typeof bufOrPath === "string" ? (data ?? Buffer.alloc(0)) : bufOrPath;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return ImageFormat.Jpeg;
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).toString("ascii").startsWith("\x89PNG")
  )
    return ImageFormat.Png;
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d)
    return ImageFormat.Bmp;
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] >= 0x31 && buf[1] <= 0x36)
    return ImageFormat.Ppm;
  if (buf.length >= 4) {
    const sig = buf.subarray(0, 4).toString("ascii");
    if (sig === "II*\x00" || sig === "MM\x00*") return ImageFormat.Tiff;
  }
  return ImageFormat.Unknown;
}

// 函数重载：buildRequest
function buildRequest(imagePath: string): OcrRequest | OcrError;
function buildRequest(
  imagePath: string,
  strict: boolean,
): OcrRequest | OcrError;
function buildRequest(
  imagePath: string,
  _strict?: boolean,
): OcrRequest | OcrError {
  if (!fs.existsSync(imagePath))
    return new OcrError(
      ErrorCode.FileNotFound,
      "文件不存在",
      imagePath,
      "demo",
      0,
    );
  const fileData = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const format = detectFormat(imagePath, fileData);
  return { source: imagePath, fileName, fileData, format } satisfies OcrRequest;
}

// 12. 高层 OCR 流程
async function ocrImage(
  cfg: OcrConfig,
  imagePath: string,
): Promise<OcrOutcome> {
  const start = Date.now();
  const built = buildRequest(imagePath);
  if (isOcrErrorInstance(built)) return built;
  const provider = createProvider(cfg.provider);
  const queue = new OcrQueue<OcrRequest>(provider, cfg);
  queue.enqueue(built);
  const gen = queue.process();
  const first = await gen.next();
  return (
    first.value ??
    new OcrError(
      ErrorCode.Unknown,
      "无结果",
      imagePath,
      cfg.demoMode ? "demo" : "live",
      Date.now() - start,
    )
  );
}

async function batchOcr(
  cfg: OcrConfig,
  dir: string,
  outDir: string,
): Promise<void> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`错误：目录不存在 ${dir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const files = fs
    .readdirSync(dir)
    .filter((f) => isSupportedExt(path.extname(f)))
    .map((f) => path.join(dir, f));
  if (files.length === 0) {
    console.log("未找到图片文件。");
    return;
  }
  console.log(
    `找到 ${files.length} 张图片，模式: ${cfg.demoMode ? "演示" : "真实"}...`,
  );
  const provider = createProvider(cfg.provider);
  const queue = new OcrQueue<OcrRequest>(provider, cfg);
  const requests: OcrRequest[] = [];
  for (const f of files) {
    const built = buildRequest(f);
    if (!isOcrErrorInstance(built)) requests.push(built);
  }
  queue.enqueueMany(requests);
  let okCount = 0;
  for await (const outcome of queue.process()) {
    const outPath = path.join(outDir, path.basename(outcome.source) + ".txt");
    if (isOcrSuccess(outcome)) {
      okCount++;
      printResult(outcome);
      fs.writeFileSync(outPath, outcome.text, "utf-8");
    } else if (isOcrError(outcome)) {
      printResult(outcome);
      fs.writeFileSync(outPath, `[ERROR] ${outcome.message}`, "utf-8");
    } else if (isOcrTimeout(outcome)) {
      printResult(outcome);
      fs.writeFileSync(
        outPath,
        `[TIMEOUT] 请求超时 (${outcome.elapsedMs}ms)`,
        "utf-8",
      );
    } else {
      printResult(outcome);
    }
    console.log(`  已写入: ${outPath}\n`);
  }
  console.log(`完成: ${okCount}/${files.length} 成功。`);
}

function printResult(o: OcrOutcome): void {
  console.log(`--- ${path.basename(o.source)} ---`);
  if (isOcrSuccess(o)) {
    console.log(
      `状态: 成功  模式: ${o.mode}  耗时: ${o.elapsedMs}ms  置信度: ${(o.confidence * 100).toFixed(1)}%`,
    );
    console.log("识别文本:");
    console.log(o.text || "(空)");
  } else if (isOcrTimeout(o)) {
    console.log(`状态: 超时  模式: ${o.mode}  耗时: ${o.elapsedMs}ms`);
  } else if (isOcrError(o)) {
    console.log(`状态: 失败  代码: ${o.code}  消息: ${o.message}`);
  } else if (isOcrPending(o)) {
    console.log(
      `状态: 等待中  排队时间: ${new Date(o.queuedAt).toISOString()}`,
    );
  } else {
    assertNever(o);
  }
}

// 13. CLI
interface ParsedArgs {
  readonly command: string;
  readonly image: string;
  readonly dir: string;
  readonly outDir: string;
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly setUrl: string;
  readonly setKey: string;
}
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  const out: Mutable<ParsedArgs> = {
    command,
    image: "",
    dir: "",
    outDir: "./ocr-out",
    apiUrl: "",
    apiKey: "",
    setUrl: "",
    setKey: "",
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case "-u":
      case "--url":
        out.apiUrl = rest[++i] ?? "";
        break;
      case "-k":
      case "--key":
        out.apiKey = rest[++i] ?? "";
        break;
      case "-o":
      case "--out":
        out.outDir = rest[++i] ?? out.outDir;
        break;
      case "--set-url":
        out.setUrl = rest[++i] ?? "";
        break;
      case "--set-key":
        out.setKey = rest[++i] ?? "";
        break;
      default:
        if (!a.startsWith("-")) {
          if (command === "ocr" && out.image === "") out.image = a;
          else if (command === "batch" && out.dir === "") out.dir = a;
        }
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`
简易 OCR（调用 API）

用法:
  ocr <image> [-u apiurl] [-k apikey]       识别单张图片
  batch <dir> [-o outdir] [-u url] [-k key] 批量识别目录中的图片
  config [--set-url url] [--set-key key]    查看/设置配置
  test                                       运行内置自检（演示模式）

选项:
  -u, --url <url>    OCR API 端点 URL（覆盖配置）
  -k, --key <key>    OCR API Key（覆盖配置）
  -o, --out <dir>    批量结果输出目录（默认 ./ocr-out）
  -h, --help         显示帮助

环境变量:
  OCR_API_URL    OCR API 端点
  OCR_API_KEY    OCR API 密钥

模式说明:
  - 演示模式: 未配置 API URL/Key 时启用，返回模拟识别文本，便于本地测试。
  - 真实模式: 配置了 OCR_API_URL 后启用，使用 multipart/form-data 上传图片到 API，
              并解析返回的 JSON（兼容 text / result / recognized_text 字段）。

示例:
  node dist/index.js ocr ./sample.png
  node dist/index.js config --set-url http://localhost:9000/ocr --set-key secret
  node dist/index.js batch ./images -o ./out
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  let cfg = loadConfig();
  if (opts.apiUrl) cfg = { ...cfg, apiUrl: opts.apiUrl };
  if (opts.apiKey) cfg = { ...cfg, apiKey: opts.apiKey };
  cfg = { ...cfg, demoMode: cfg.apiUrl.length === 0 };
  validateConfig(cfg);
  switch (opts.command) {
    case "ocr": {
      if (!opts.image) {
        console.error("错误：未提供图片路径。");
        process.exit(1);
      }
      const r = await ocrImage(cfg, opts.image);
      printResult(r);
      break;
    }
    case "batch": {
      if (!opts.dir) {
        console.error("错误：未提供目录路径。");
        process.exit(1);
      }
      await batchOcr(cfg, opts.dir, opts.outDir);
      break;
    }
    case "config": {
      if (opts.setUrl || opts.setKey) {
        if (opts.setUrl) cfg = { ...cfg, apiUrl: opts.setUrl };
        if (opts.setKey) cfg = { ...cfg, apiKey: opts.setKey };
        cfg = { ...cfg, demoMode: cfg.apiUrl.length === 0 };
        saveConfig(cfg);
        console.log("配置已保存。");
      }
      console.log("当前配置:");
      console.log(`  API URL : ${cfg.apiUrl || "(未配置)"}`);
      console.log(
        `  API Key : ${cfg.apiKey ? "*".repeat(cfg.apiKey.length) : "(未配置)"}`,
      );
      console.log(`  Provider: ${cfg.provider}`);
      console.log(`  模式    : ${cfg.demoMode ? "演示模式" : "真实模式"}`);
      console.log(`  超时    : ${cfg.timeoutMs}ms`);
      console.log(`  配置文件: ${CONFIG_PATH}`);
      break;
    }
    case "test": {
      console.log("运行内置自检（演示模式）...");
      const tmp = path.join(tmpDir(), "simple-ocr-test.bmp");
      const bmp = createMinimalBmp(16, 16, 0x123456);
      fs.writeFileSync(tmp, bmp);
      const r = await ocrImage(
        { ...cfg, demoMode: true, provider: OcrProvider.Mock },
        tmp,
      );
      printResult(r);
      fs.unlinkSync(tmp);
      console.log("自检完成。");
      break;
    }
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

/** 生成一个最小化的 24 位 BMP（用于自检） */
function createMinimalBmp(
  width: number,
  height: number,
  color: number,
): Buffer {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelArraySize, 34);
  const b = color & 0xff;
  const g = (color >> 8) & 0xff;
  const r = (color >> 16) & 0xff;
  for (let y = 0; y < height; y++) {
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const off = rowStart + x * 3;
      buf.writeUInt8(b, off);
      buf.writeUInt8(g, off + 1);
      buf.writeUInt8(r, off + 2);
    }
  }
  return buf;
}

main().catch((err: unknown) => {
  if (isOcrErrorInstance(err))
    console.error(`致命错误 [${err.code}]:`, err.message);
  else if (err instanceof Error) console.error("致命错误:", err.message);
  else console.error("致命错误:", String(err));
  process.exit(1);
});
