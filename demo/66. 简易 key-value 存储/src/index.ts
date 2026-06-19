#!/usr/bin/env node
/**
 * 简易 key-value 存储
 * - 持久化 KV 存储：get / set / delete / exists / keys / values / count / clear
 * - TTL 过期（懒过期 + 主动检查）
 * - 命名空间（namespace）
 * - 原子操作：incr / decr
 * - 批量操作：mset / mget
 * - 前缀扫描
 * - 文件存储 + compact（重建文件）
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";

interface Entry {
  value: unknown;
  expireAt: number | null; // 时间戳(ms)，null 表示永不过期
}

interface StoreFile {
  version: number;
  data: Record<string, Entry>;
}

/** KV 存储主类 */
export class KVStore {
  private file: string;
  private data = new Map<string, Entry>();
  private ns = "";
  private writeTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private debounceMs: number;

  constructor(file: string, debounceMs = 200) {
    this.file = path.resolve(file);
    this.debounceMs = debounceMs;
    this.load();
  }

  /** 切换命名空间 */
  namespace(ns: string): KVStore {
    const child = Object.create(KVStore.prototype) as KVStore;
    child.file = this.file;
    child.data = this.data; // 共享底层 map
    child.ns = this.ns ? this.ns + ":" + ns : ns;
    child.writeTimer = null;
    child.dirty = false;
    child.debounceMs = this.debounceMs;
    // 共享写入逻辑：使用父实例的 schedule
    (child as unknown as { _parent: KVStore })._parent = this;
    return child;
  }

  private key(k: string): string {
    return this.ns ? this.ns + ":" + k : k;
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as StoreFile;
      for (const k of Object.keys(raw.data)) this.data.set(k, raw.data[k]);
    } catch {
      // 损坏则忽略
    }
  }

  private schedule(): void {
    if ((this as unknown as { _parent?: KVStore })._parent) {
      (this as unknown as { _parent: KVStore })._parent.schedule();
      return;
    }
    this.dirty = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** 立即写入磁盘（原子） */
  flush(): void {
    if ((this as unknown as { _parent?: KVStore })._parent) {
      (this as unknown as { _parent: KVStore })._parent.flush();
      return;
    }
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.dirty) return;
    const obj: StoreFile = { version: 1, data: {} };
    for (const [k, v] of this.data) obj.data[k] = v;
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  /** 检查并清理过期键（懒过期） */
  private isExpired(e: Entry): boolean {
    return e.expireAt !== null && e.expireAt < Date.now();
  }

  private purge(k: string): void {
    const e = this.data.get(k);
    if (e && this.isExpired(e)) {
      this.data.delete(k);
      this.schedule();
    }
  }

  /** 设置键值 */
  set(k: string, value: unknown, ttlSeconds?: number): void {
    const expireAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    this.data.set(this.key(k), { value, expireAt });
    this.schedule();
  }

  /** 获取键值 */
  get<T = unknown>(k: string): T | null {
    const key = this.key(k);
    const e = this.data.get(key);
    if (!e) return null;
    if (this.isExpired(e)) {
      this.data.delete(key);
      this.schedule();
      return null;
    }
    return e.value as T;
  }

  /** 删除 */
  delete(k: string): boolean {
    const key = this.key(k);
    const had = this.data.delete(key);
    if (had) this.schedule();
    return had;
  }

  /** 是否存在 */
  exists(k: string): boolean {
    const key = this.key(k);
    const e = this.data.get(key);
    if (!e) return false;
    if (this.isExpired(e)) {
      this.data.delete(key);
      this.schedule();
      return false;
    }
    return true;
  }

  /** 设置过期时间 */
  expire(k: string, ttlSeconds: number): boolean {
    const key = this.key(k);
    const e = this.data.get(key);
    if (!e || this.isExpired(e)) return false;
    e.expireAt = Date.now() + ttlSeconds * 1000;
    this.schedule();
    return true;
  }

  /** 移除过期时间 */
  persist(k: string): boolean {
    const key = this.key(k);
    const e = this.data.get(key);
    if (!e) return false;
    e.expireAt = null;
    this.schedule();
    return true;
  }

  /** 原子自增 */
  incr(k: string, by = 1): number {
    const key = this.key(k);
    const e = this.data.get(key);
    let cur = 0;
    if (e && !this.isExpired(e) && typeof e.value === "number") cur = e.value;
    const next = cur + by;
    this.data.set(key, { value: next, expireAt: e && !this.isExpired(e) ? e.expireAt : null });
    this.schedule();
    return next;
  }

  /** 原子自减 */
  decr(k: string, by = 1): number {
    return this.incr(k, -by);
  }

  /** 批量设置 */
  mset(pairs: Record<string, unknown>, ttlSeconds?: number): void {
    for (const k of Object.keys(pairs)) this.set(k, pairs[k], ttlSeconds);
  }

  /** 批量获取 */
  mget(keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = this.get(k);
    return out;
  }

  /** 列出键（带前缀扫描） */
  keys(prefix?: string): string[] {
    const fullPrefix = this.key(prefix || "");
    const out: string[] = [];
    for (const k of this.data.keys()) {
      if (fullPrefix && !k.startsWith(fullPrefix)) continue;
      const e = this.data.get(k)!;
      if (this.isExpired(e)) continue;
      // 去掉命名空间前缀
      out.push(this.ns ? k.slice(this.ns.length + 1) : k);
    }
    return out;
  }

  /** 列出值 */
  values(prefix?: string): unknown[] {
    return this.keys(prefix).map((k) => this.get(k));
  }

  /** 计数 */
  count(prefix?: string): number {
    return this.keys(prefix).length;
  }

  /** 清空（命名空间内） */
  clear(): void {
    if (!this.ns) {
      this.data.clear();
    } else {
      const p = this.ns + ":";
      for (const k of Array.from(this.data.keys())) {
        if (k.startsWith(p)) this.data.delete(k);
      }
    }
    this.schedule();
  }

  /** 统计信息 */
  stats(): { total: number; expired: number; namespaced: number } {
    let expired = 0;
    let total = 0;
    let namespaced = 0;
    const p = this.ns ? this.ns + ":" : "";
    for (const [k, e] of this.data) {
      if (p && !k.startsWith(p)) continue;
      total++;
      if (this.isExpired(e)) expired++;
      if (k.includes(":")) namespaced++;
    }
    return { total, expired, namespaced };
  }

  /** 清理所有过期键 */
  purgeExpired(): number {
    let n = 0;
    for (const [k, e] of Array.from(this.data.entries())) {
      if (this.isExpired(e)) {
        this.data.delete(k);
        n++;
      }
    }
    if (n > 0) this.schedule();
    return n;
  }

  /** 重建文件（去除已删除/过期条目） */
  compact(): void {
    this.purgeExpired();
    this.dirty = true;
    this.flush();
  }
}

/* ----------------------- CLI ----------------------- */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const file = path.join(process.cwd(), "kv.json");
  const db = new KVStore(file);

  if (!cmd) {
    console.log(`简易 key-value 存储 CLI
用法:
  set <key> <value> [-t ttl]   设置键值
  get <key>                    获取键值
  del <key>                    删除键
  keys [prefix]                列出键
  incr <key> [by]              自增
  expire <key> <seconds>       设置过期
  stats                        统计信息
  compact                      压缩重建文件
`);
    return;
  }

  switch (cmd) {
    case "set": {
      const [k, v] = rest;
      if (!k) throw new Error("缺少 key");
      const ttl = getOpt(rest, "-t");
      // 尝试解析为数字或 JSON
      let val: unknown = v;
      try {
        val = JSON.parse(v || "null");
      } catch {
        val = v;
      }
      db.set(k, val, ttl ? parseInt(ttl, 10) : undefined);
      db.flush();
      console.log("OK");
      break;
    }
    case "get": {
      const [k] = rest;
      if (!k) throw new Error("缺少 key");
      const v = db.get(k);
      console.log(v === null ? "(nil)" : typeof v === "string" ? v : JSON.stringify(v));
      break;
    }
    case "del": {
      const [k] = rest;
      if (!k) throw new Error("缺少 key");
      console.log(db.delete(k) ? "OK" : "(nil)");
      db.flush();
      break;
    }
    case "keys": {
      const [prefix] = rest;
      const keys = db.keys(prefix);
      console.log(keys.length === 0 ? "(empty)" : keys.join("\n"));
      break;
    }
    case "incr": {
      const [k, by] = rest;
      if (!k) throw new Error("缺少 key");
      const r = db.incr(k, by ? parseInt(by, 10) : 1);
      db.flush();
      console.log("(integer)", r);
      break;
    }
    case "expire": {
      const [k, sec] = rest;
      if (!k || !sec) throw new Error("用法: expire <key> <seconds>");
      console.log(db.expire(k, parseInt(sec, 10)) ? "OK" : "(nil)");
      db.flush();
      break;
    }
    case "stats": {
      console.log(db.stats());
      break;
    }
    case "compact": {
      const before = db.stats().total;
      db.compact();
      const after = db.stats().total;
      console.log(`压缩完成: ${before} -> ${after}`);
      break;
    }
    case "demo": {
      db.set("counter", 0);
      console.log("初始 counter:", db.get("counter"));
      for (let i = 0; i < 5; i++) db.incr("counter");
      console.log("自增 5 次后:", db.get("counter"));
      db.set("temp", "短期数据", 2);
      console.log("temp (设置 2 秒 TTL):", db.get("temp"));
      const sess = db.namespace("session");
      sess.set("user1", { name: "Alice" });
      sess.set("user2", { name: "Bob" });
      console.log("session 命名空间键:", sess.keys());
      console.log("user1:", sess.get("user1"));
      console.log("全部键:", db.keys());
      db.flush();
      break;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
