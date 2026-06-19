#!/usr/bin/env node
/**
 * 简单 HTTP 请求库 (Simple HTTP Client)
 * -------------------------------------------------------------
 * 基于 Node.js 内置 http/https 模块封装的 Promise 风格 HTTP 客户端。
 *
 * 公开 API：
 *   - class HttpClient
 *       constructor(options?: HttpClientOptions)
 *       get(url, config?) / post(url, body?, config?)
 *       put(url, body?, config?) / delete(url, config?)
 *       patch(url, body?, config?)
 *       request(config): Promise<HttpResponse>
 *       stream(url, config): Promise<IncomingMessage>   // 流式响应
 *       download(url, file, config?): Promise<void>      // 下载到文件
 *       useInterceptor(req?, res?)                        // 注册拦截器
 *       benchmark(url, count): Promise<BenchmarkResult>
 *
 *   - 拦截器: RequestInterceptor / ResponseInterceptor
 *   - 配置: RequestConfig (headers, query, body, json, form, timeout,
 *           retry, retryDelay, maxRedirects, auth, gzip, onProgress)
 *   - 工具函数: queryString(obj), basicAuth(user, pass)
 *
 * 仅依赖 Node.js 内置模块: http, https, url, querystring, zlib, fs, stream, crypto.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import qs from 'querystring';
import zlib from 'zlib';
import fs from 'fs';
import { Duplex, PassThrough } from 'stream';

/** 请求配置 */
export interface RequestConfig {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | string[]>;
  body?: string | Buffer | object;
  json?: boolean; // 自动序列化 body 为 JSON
  form?: Record<string, string | number>; // 表单编码
  timeout?: number; // 毫秒
  retry?: number; // 重试次数
  retryDelay?: number; // 重试间隔毫秒
  maxRedirects?: number; // 最大重定向次数，默认 5
  auth?: { username: string; password: string };
  gzip?: boolean; // 是否自动解压 gzip，默认 true
  responseType?: 'text' | 'json' | 'buffer';
  onProgress?: (received: number, total: number | null) => void;
}

/** 响应对象 */
export interface HttpResponse {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  data: string | Buffer | unknown;
  config: RequestConfig;
}

export interface HttpClientOptions {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  retry?: number;
  maxRedirects?: number;
}

export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
export type ResponseInterceptor = (resp: HttpResponse) => HttpResponse | Promise<HttpResponse>;

export interface BenchmarkResult {
  url: string;
  total: number;
  success: number;
  failed: number;
  totalTimeMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  rps: number;
}

/** 将对象编码为查询字符串 */
export function queryString(obj: Record<string, string | number | boolean | string[]>): string {
  return qs.encode(obj as qs.ParsedUrlQueryInput);
}

/** 生成 Basic Auth 头 */
export function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** 简易 sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP 客户端类 */
export class HttpClient {
  private baseURL: string | undefined;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;
  private defaultRetry: number;
  private defaultMaxRedirects: number;
  private reqInterceptors: RequestInterceptor[] = [];
  private resInterceptors: ResponseInterceptor[] = [];

  constructor(options: HttpClientOptions = {}) {
    this.baseURL = options.baseURL;
    this.defaultHeaders = options.defaultHeaders || {};
    this.defaultTimeout = options.timeout ?? 15000;
    this.defaultRetry = options.retry ?? 0;
    this.defaultMaxRedirects = options.maxRedirects ?? 5;
  }

  useInterceptor(req?: RequestInterceptor, res?: ResponseInterceptor): this {
    if (req) this.reqInterceptors.push(req);
    if (res) this.resInterceptors.push(res);
    return this;
  }

  /** GET 请求 */
  get(url: string, config: Partial<RequestConfig> = {}): Promise<HttpResponse> {
    return this.request({ ...config, url, method: 'GET' });
  }
  /** POST 请求 */
  post(url: string, body?: unknown, config: Partial<RequestConfig> = {}): Promise<HttpResponse> {
    return this.request({ ...config, url, method: 'POST', body: body as RequestConfig['body'] });
  }
  put(url: string, body?: unknown, config: Partial<RequestConfig> = {}): Promise<HttpResponse> {
    return this.request({ ...config, url, method: 'PUT', body: body as RequestConfig['body'] });
  }
  delete(url: string, config: Partial<RequestConfig> = {}): Promise<HttpResponse> {
    return this.request({ ...config, url, method: 'DELETE' });
  }
  patch(url: string, body?: unknown, config: Partial<RequestConfig> = {}): Promise<HttpResponse> {
    return this.request({ ...config, url, method: 'PATCH', body: body as RequestConfig['body'] });
  }

  /** 流式响应，返回原始流 */
  async stream(url: string, config: Partial<RequestConfig> = {}): Promise<http.IncomingMessage> {
    const full = await this.prepareConfig({ ...config, url });
    return this.execStream(full, 0);
  }

  /** 下载文件到本地 */
  async download(url: string, file: string, config: Partial<RequestConfig> = {}): Promise<void> {
    const full = await this.prepareConfig({ ...config, url });
    const stream = await this.execStream(full, 0);
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      stream.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
      stream.on('error', reject);
    });
  }

  /** 基准测试 */
  async benchmark(url: string, count: number): Promise<BenchmarkResult> {
    const times: number[] = [];
    let success = 0;
    let failed = 0;
    const start = Date.now();
    for (let i = 0; i < count; i++) {
      const t0 = Date.now();
      try {
        await this.get(url, { retry: 0, maxRedirects: 3 });
        times.push(Date.now() - t0);
        success++;
      } catch {
        failed++;
      }
    }
    const total = Date.now() - start;
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const min = times.length ? Math.min(...times) : 0;
    const max = times.length ? Math.max(...times) : 0;
    return {
      url,
      total: count,
      success,
      failed,
      totalTimeMs: total,
      avgMs: Math.round(avg * 100) / 100,
      minMs: min,
      maxMs: max,
      rps: total > 0 ? Math.round((count / total) * 1000 * 100) / 100 : 0,
    };
  }

  /** 核心请求方法 */
  async request(config: RequestConfig): Promise<HttpResponse> {
    const full = await this.prepareConfig(config);
    const maxRetry = full.retry ?? this.defaultRetry;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        const resp = await this.execOnce(full, 0);
        const finalResp = await this.applyResponseInterceptors(resp);
        return finalResp;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < maxRetry) {
          await sleep(full.retryDelay ?? 500 * (attempt + 1));
        }
      }
    }
    throw lastErr ?? new Error('请求失败');
  }

  private async prepareConfig(config: RequestConfig): Promise<RequestConfig> {
    let full: RequestConfig = {
      method: config.method || 'GET',
      url: config.url,
      headers: { ...this.defaultHeaders, ...(config.headers || {}) },
      query: config.query,
      body: config.body,
      json: config.json,
      form: config.form,
      timeout: config.timeout ?? this.defaultTimeout,
      retry: config.retry ?? this.defaultRetry,
      retryDelay: config.retryDelay,
      maxRedirects: config.maxRedirects ?? this.defaultMaxRedirects,
      auth: config.auth,
      gzip: config.gzip ?? true,
      responseType: config.responseType,
      onProgress: config.onProgress,
    };
    // 合并 baseURL
    if (this.baseURL && !/^https?:\/\//i.test(full.url)) {
      full.url = this.baseURL.replace(/\/$/, '') + '/' + full.url.replace(/^\//, '');
    }
    // 应用请求拦截器
    for (const fn of this.reqInterceptors) {
      full = await fn(full);
    }
    return full;
  }

  private async applyResponseInterceptors(resp: HttpResponse): Promise<HttpResponse> {
    let r = resp;
    for (const fn of this.resInterceptors) {
      r = await fn(r);
    }
    return r;
  }

  /** 执行一次请求（含重定向处理） */
  private execOnce(config: RequestConfig, redirectCount: number): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(config.url);
      } catch (e) {
        return reject(new Error(`无效的 URL: ${config.url}`));
      }
      // 处理查询字符串
      if (config.query) {
        const q = queryString(config.query);
        if (q) target.search = target.search ? `${target.search}&${q}` : `?${q}`;
      }
      // 处理 body
      let bodyData: Buffer | null = null;
      const headers: Record<string, string> = { ...(config.headers || {}) };
      if (config.form) {
        bodyData = Buffer.from(queryString(config.form));
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = String(bodyData.length);
      } else if (config.json && config.body !== undefined) {
        bodyData = Buffer.from(JSON.stringify(config.body));
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(bodyData.length);
      } else if (typeof config.body === 'string') {
        bodyData = Buffer.from(config.body);
        headers['Content-Length'] = String(bodyData.length);
      } else if (Buffer.isBuffer(config.body)) {
        bodyData = config.body;
        headers['Content-Length'] = String(bodyData.length);
      }
      // 处理 Basic Auth
      if (config.auth) {
        headers['Authorization'] = basicAuth(config.auth.username, config.auth.password);
      }
      // gzip
      if (config.gzip !== false) {
        headers['Accept-Encoding'] = headers['Accept-Encoding'] || 'gzip, deflate';
      }

      const isHttps = target.protocol === 'https:';
      const transport = isHttps ? https : http;
      const reqOptions: https.RequestOptions = {
        method: config.method || 'GET',
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        headers,
      };

      const req = transport.request(reqOptions, (res) => {
        // 重定向处理
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume(); // 丢弃当前响应体
          if (redirectCount >= (config.maxRedirects ?? 5)) {
            return reject(new Error(`超过最大重定向次数: ${config.maxRedirects}`));
          }
          const nextUrl = new URL(res.headers.location, target).toString();
          const nextConfig = { ...config, url: nextUrl };
          // 303/301/302 通常转为 GET
          if (status === 301 || status === 302 || status === 303) {
            nextConfig.method = 'GET';
            nextConfig.body = undefined;
            delete nextConfig.form;
            delete nextConfig.json;
          }
          return resolve(this.execOnce(nextConfig, redirectCount + 1));
        }

        // 流处理 + gzip 解压
        let stream: NodeJS.ReadableStream = res;
        const encoding = res.headers['content-encoding'];
        if (config.gzip !== false) {
          if (encoding === 'gzip') {
            stream = res.pipe(zlib.createGunzip());
          } else if (encoding === 'deflate') {
            stream = res.pipe(zlib.createInflate());
          } else if (encoding === 'br') {
            stream = res.pipe(zlib.createBrotliDecompress());
          }
        }

        const chunks: Buffer[] = [];
        const totalHeader = res.headers['content-length'];
        const total = totalHeader ? parseInt(totalHeader, 10) : null;
        let received = 0;

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          received += chunk.length;
          if (config.onProgress) config.onProgress(received, total);
        });
        stream.on('end', () => {
          const buf = Buffer.concat(chunks);
          let data: string | Buffer | unknown = buf;
          const rt = config.responseType;
          const ct = (res.headers['content-type'] || '').toLowerCase();
          if (rt === 'json' || (ct.includes('application/json') && rt !== 'buffer')) {
            try {
              data = JSON.parse(buf.toString('utf8'));
            } catch {
              data = buf.toString('utf8');
            }
          } else if (rt === 'text') {
            data = buf.toString('utf8');
          } else if (rt === 'buffer') {
            data = buf;
          } else {
            data = buf.toString('utf8');
          }
          const resp: HttpResponse = {
            status,
            statusText: res.statusMessage || '',
            headers: res.headers,
            data,
            config,
          };
          if (status >= 400) {
            const err = new Error(`HTTP 错误: ${status} ${res.statusMessage}`) as Error & {
              response?: HttpResponse;
            };
            err.response = resp;
            return reject(err);
          }
          resolve(resp);
        });
        stream.on('error', reject);
      });

      req.on('error', reject);
      // 超时
      if (config.timeout && config.timeout > 0) {
        req.setTimeout(config.timeout, () => {
          req.destroy(new Error(`请求超时 (${config.timeout}ms)`));
        });
      }
      if (bodyData) req.write(bodyData);
      req.end();
    });
  }

  /** 仅返回原始流，不缓冲 */
  private execStream(config: RequestConfig, redirectCount: number): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(config.url);
      } catch {
        return reject(new Error(`无效的 URL: ${config.url}`));
      }
      if (config.query) {
        const q = queryString(config.query);
        if (q) target.search = target.search ? `${target.search}&${q}` : `?${q}`;
      }
      const headers: Record<string, string> = { ...(config.headers || {}) };
      if (config.auth) headers['Authorization'] = basicAuth(config.auth.username, config.auth.password);
      if (config.gzip !== false) headers['Accept-Encoding'] = headers['Accept-Encoding'] || 'gzip, deflate';
      const isHttps = target.protocol === 'https:';
      const transport = isHttps ? https : http;
      const req = transport.request(
        {
          method: config.method || 'GET',
          hostname: target.hostname,
          port: target.port || (isHttps ? 443 : 80),
          path: target.pathname + target.search,
          headers,
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectCount >= (config.maxRedirects ?? 5)) {
              return reject(new Error(`超过最大重定向次数`));
            }
            const nextUrl = new URL(res.headers.location, target).toString();
            return resolve(this.execStream({ ...config, url: nextUrl }, redirectCount + 1));
          }
          if (status >= 400) {
            return reject(new Error(`HTTP 错误: ${status}`));
          }
          resolve(res);
        }
      );
      req.on('error', reject);
      if (config.timeout && config.timeout > 0) {
        req.setTimeout(config.timeout, () => req.destroy(new Error('流式请求超时')));
      }
      req.end();
    });
  }
}

/** 简易命令行参数解析 */
function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let cmd = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-H')) {
      flags['H'] = argv[++i];
    } else if (a.startsWith('-q')) {
      flags['q'] = argv[++i];
    } else if (a.startsWith('-d')) {
      flags['d'] = argv[++i];
    } else if (a === '-j') {
      flags['j'] = true;
    } else if (a.startsWith('-o')) {
      flags['o'] = argv[++i];
    } else if (a.startsWith('-n')) {
      flags['n'] = argv[++i];
    } else if (!cmd) {
      cmd = a;
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    return;
  }
  const { cmd, positional, flags } = parseArgs(argv);
  const client = new HttpClient({ timeout: 20000, retry: 1 });

  try {
    switch (cmd) {
      case 'get': {
        const url = positional[0];
        if (!url) return printHelp();
        const headers: Record<string, string> = {};
        if (typeof flags['H'] === 'string') {
          const [k, v] = flags['H'].split(':');
          if (k && v) headers[k.trim()] = v.trim();
        }
        const query: Record<string, string> = {};
        if (typeof flags['q'] === 'string') {
          const [k, v] = flags['q'].split('=');
          if (k && v) query[k] = v;
        }
        const resp = await client.get(url, { headers, query });
        console.log(`状态: ${resp.status} ${resp.statusText}`);
        console.log('响应头:', resp.headers);
        console.log('响应体:');
        console.log(typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2));
        break;
      }
      case 'post': {
        const url = positional[0];
        if (!url) return printHelp();
        const data = typeof flags['d'] === 'string' ? flags['d'] : '';
        let body: unknown = data;
        if (flags['j']) {
          try {
            body = JSON.parse(data);
          } catch {
            // 保留原始字符串
          }
        }
        const resp = await client.post(url, body, { json: !!flags['j'] });
        console.log(`状态: ${resp.status}`);
        console.log('响应体:', typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2));
        break;
      }
      case 'download': {
        const url = positional[0];
        const out = typeof flags['o'] === 'string' ? flags['o'] : 'download.bin';
        if (!url) return printHelp();
        console.log(`正在下载 ${url} -> ${out}`);
        await client.download(url, out, {
          onProgress: (r, t) => {
            const pct = t ? Math.round((r / t) * 100) : 0;
            process.stdout.write(`\r已接收: ${r} bytes ${t ? `(${pct}%)` : ''}`);
          },
        });
        console.log('\n下载完成。');
        break;
      }
      case 'benchmark': {
        const url = positional[0];
        if (!url) return printHelp();
        const n = typeof flags['n'] === 'string' ? parseInt(flags['n'], 10) : 10;
        console.log(`对 ${url} 发起 ${n} 次请求...`);
        const result = await client.benchmark(url, n);
        console.log('基准测试结果:');
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      default:
        printHelp();
    }
  } catch (err) {
    console.error('请求出错:', (err as Error).message);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
简单 HTTP 请求库 - 命令行演示

用法:
  get <url> [-H header] [-q key=value]          发起 GET 请求
  post <url> [-d data] [-j]                     发起 POST 请求 (-j 表示 JSON)
  download <url> [-o file]                      下载文件
  benchmark <url> [-n requests]                 基准测试

示例:
  get https://httpbin.org/get -q foo=bar -H "X-Test:1"
  post https://httpbin.org/post -d '{"a":1}' -j
  download https://httpbin.org/bytes/1024 -o test.bin
  benchmark https://httpbin.org/get -n 20
`);
}

main();
