#!/usr/bin/env node
/**
 * 简易 key-value 存储 (增强 TypeScript 版)
 * 功能: get/set/delete/exists/keys/values/count/clear, TTL, 命名空间,
 *       incr/decr, mset/mget, 前缀扫描, 防抖写入, compact。
 * 仅使用 Node.js 内置模块 (fs, path)。
 *
 * 演示 TS 特性: 字符串枚举、可辨识联合、带约束泛型类、抽象类、映射类型、
 * 自定义错误层级、接口(可选/只读/索引签名)、satisfies、getter/setter、
 * 生成器、Symbol、as const、类型守卫、函数重载、模板字面量类型。
 */
import * as fs from "fs";
import * as path from "path";

/* ===================== 枚举 ===================== */

enum Command {
  Set = "set",
  Get = "get",
  Del = "del",
  Exists = "exists",
  Keys = "keys",
  Values = "values",
  Incr = "incr",
  Decr = "decr",
  Expire = "expire",
  Persist = "persist",
  Mset = "mset",
  Mget = "mget",
  Stats = "stats",
  Compact = "compact",
  Clear = "clear",
  Demo = "demo",
}

enum ErrorCode {
  NotFound = "NOT_FOUND",
  InvalidType = "INVALID_TYPE",
  CorruptFile = "CORRUPT_FILE",
  UnknownCommand = "UNKNOWN_COMMAND",
  Expired = "EXPIRED",
  OutOfRange = "OUT_OF_RANGE",
}

enum EntryState {
  Active = "active",
  Expired = "expired",
  Pending = "pending",
}

enum EvictionReason {
  Manual = "manual",
  TtlExpired = "ttl_expired",
  Compacted = "compacted",
  Cleared = "cleared",
}

/* ===================== 映射类型 / 模板字面量类型 ===================== */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type NamespacedKey<N extends string, K extends string> = `${N}:${K}`;

/* ===================== 可辨识联合 ===================== */

interface OpSuccess<T = unknown> {
  readonly ok: true;
  readonly value: T;
}
interface OpError {
  readonly ok: false;
  readonly kind: "error";
  readonly code: ErrorCode;
  readonly message: string;
}
interface OpNotFound {
  readonly ok: false;
  readonly kind: "not_found";
  readonly key: string;
}
type OpResult<T = unknown> = OpSuccess<T> | OpError | OpNotFound;

/* ===================== 接口 ===================== */

interface Identifiable {
  readonly id: string;
}

interface Entry extends Identifiable {
  value: unknown;
  expireAt: number | null;
  state: EntryState;
}

interface StoreFile {
  readonly version: number;
  readonly data: Record<string, Entry>;
  readonly createdAt?: number;
  [extra: string]: unknown; // 索引签名
}

interface StorageOptions {
  readonly debounceMs?: number;
  readonly namespace?: string;
  readonly compactOnLoad?: boolean;
}

interface StatsReport {
  readonly total: number;
  readonly expired: number;
  readonly namespaced: number;
  readonly active: number;
}

interface EvictionRecord {
  readonly key: string;
  readonly reason: EvictionReason;
  readonly at: number;
}

interface StoreMeta {
  readonly createdAt: number;
  lastWrite: number | null;
}

/* ===================== 自定义错误层级 ===================== */

class KVError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "KVError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class KeyNotFoundError extends KVError {
  readonly key: string;
  constructor(key: string) {
    super(ErrorCode.NotFound, `key not found: ${key}`);
    this.name = "KeyNotFoundError";
    this.key = key;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class TypeMismatchError extends KVError {
  constructor(message: string) {
    super(ErrorCode.InvalidType, message);
    this.name = "TypeMismatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/* ===================== Symbol 唯一属性键 ===================== */

const EVICTION_LOG = Symbol("evictionLog");
const META = Symbol("meta");
const KV_BRAND = Symbol("kvBrand");

/* ===================== 类型守卫 ===================== */

function isOpSuccess<T>(r: OpResult<T>): r is OpSuccess<T> {
  return r.ok === true;
}
function isOpError(r: OpResult<unknown>): r is OpError {
  return r.ok === false && r.kind === "error";
}
function isOpNotFound(r: OpResult<unknown>): r is OpNotFound {
  return r.ok === false && r.kind === "not_found";
}
function isNumberValue(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isEntry(v: unknown): v is Entry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    "value" in e &&
    (e.expireAt === null || typeof e.expireAt === "number") &&
    typeof e.state === "string"
  );
}
function isKVStore(v: unknown): v is KVStore<string> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<symbol, unknown>)[KV_BRAND] === true
  );
}

/* ===================== 抽象存储类 ===================== */

abstract class AbstractStorage<T extends Identifiable> {
  protected readonly items = new Map<string, T>();
  abstract serialize(item: T): string;
  abstract deserialize(raw: string): T | null;

  put(item: T): void {
    this.items.set(item.id, item);
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  remove(id: string): boolean {
    return this.items.delete(id);
  }
  clearAll(): void {
    this.items.clear();
  }
  count(): number {
    return this.items.size;
  }

  *iterate(): IterableIterator<T> {
    for (const v of this.items.values()) yield v;
  }
  *iterateIds(): IterableIterator<string> {
    for (const k of this.items.keys()) yield k;
  }
  *iterateEntries(): IterableIterator<[string, T]> {
    for (const e of this.items.entries()) yield e;
  }
}

class EntryStorage extends AbstractStorage<Entry> {
  serialize(item: Entry): string {
    return JSON.stringify(item);
  }
  deserialize(raw: string): Entry | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isEntry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

/* ===================== 辅助函数 / 常量 ===================== */

function buildNamespacedKey<N extends string, K extends string>(
  ns: N,
  key: K,
): NamespacedKey<N, K> {
  return `${ns}:${key}`;
}

const DEFAULT_OPTIONS = { debounceMs: 200 } satisfies StorageOptions;
const FORMAT_VERSION = 1 as const;
const STORE_FORMAT = { version: 1, encoding: "utf8" } as const;

const EVICTION_LABEL: Record<EvictionReason, string> = {
  [EvictionReason.Manual]: "手动删除",
  [EvictionReason.TtlExpired]: "TTL 过期",
  [EvictionReason.Compacted]: "压缩清理",
  [EvictionReason.Cleared]: "清空",
};

function assertKey(k: string | undefined): asserts k is string {
  if (!k) throw new KVError(ErrorCode.InvalidType, "缺少 key 参数");
}

/* ===================== KVStore ===================== */

class KVStore<T extends string = string> {
  [EVICTION_LOG]: EvictionRecord[];
  [META]: StoreMeta;
  [KV_BRAND]: boolean = true;

  private _file: string;
  private _storage: EntryStorage;
  private _ns: string;
  private _parent: KVStore<string> | null;
  private _writeTimer: NodeJS.Timeout | null = null;
  private _dirty = false;
  private _debounceMs: number;

  get filePath(): string {
    return this._file;
  }
  get namespacePrefix(): string {
    return this._ns;
  }
  get debounceMs(): number {
    return this._debounceMs;
  }
  set debounceMs(ms: number) {
    if (!isNumberValue(ms) || ms < 0)
      throw new KVError(ErrorCode.InvalidType, "debounceMs 必须为非负数");
    this._debounceMs = ms;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get size(): number {
    return this.count();
  }
  get createdAt(): number {
    return this.rootMeta().createdAt;
  }

  constructor(file: string, debounceMs = DEFAULT_OPTIONS.debounceMs) {
    this._file = path.resolve(file);
    this._storage = new EntryStorage();
    this._ns = "";
    this._parent = null;
    this._debounceMs = debounceMs;
    this[EVICTION_LOG] = [];
    this[META] = { createdAt: Date.now(), lastWrite: null };
    this.load();
  }

  private static forChild<U extends string>(
    parent: KVStore<U>,
    ns: string,
  ): KVStore<U> {
    const child = Object.create(KVStore.prototype) as KVStore<U>;
    child._file = parent._file;
    child._storage = parent._storage;
    child._ns = ns;
    child._parent = parent as KVStore<string>;
    child._writeTimer = null;
    child._dirty = false;
    child._debounceMs = parent._debounceMs;
    child[EVICTION_LOG] = parent[EVICTION_LOG];
    child[META] = parent[META];
    child[KV_BRAND] = true;
    return child;
  }

  /** 切换命名空间 (返回共享底层存储的子实例) */
  namespace<N extends string>(ns: N): KVStore<T> {
    const prefix = this._ns ? `${this._ns}:${ns}` : ns;
    return KVStore.forChild<T>(this, prefix);
  }

  private root(): KVStore<string> {
    return this._parent ? this._parent.root() : (this as KVStore<string>);
  }
  private rootMeta(): StoreMeta {
    return this.root()[META];
  }
  private fullKey(k: T): string {
    return this._ns ? buildNamespacedKey(this._ns, k) : k;
  }
  private stripNs(k: string): string {
    return this._ns ? k.slice(this._ns.length + 1) : k;
  }
  private recordEviction(key: string, reason: EvictionReason): void {
    this[EVICTION_LOG].push({ key, reason, at: Date.now() });
    if (this[EVICTION_LOG].length > 1000) this[EVICTION_LOG].shift();
  }
  private isExpired(e: Entry): boolean {
    return e.expireAt !== null && e.expireAt < Date.now();
  }

  private load(): void {
    if (!fs.existsSync(this._file)) return;
    try {
      const raw = JSON.parse(
        fs.readFileSync(this._file, STORE_FORMAT.encoding),
      ) as StoreFile;
      const data = raw.data ?? {};
      for (const k of Object.keys(data)) {
        const rec = data[k] as Partial<Entry>;
        this._storage.put({
          id: k,
          value: rec.value,
          expireAt: rec.expireAt ?? null,
          state: (rec.state as EntryState) ?? EntryState.Active,
        });
      }
    } catch {
      /* 损坏文件忽略 */
    }
  }

  private schedule(): void {
    if (this._parent) {
      this._parent.schedule();
      return;
    }
    this._dirty = true;
    if (this._writeTimer) clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this.flush(), this._debounceMs);
  }

  /** 立即写入磁盘 (原子写入) */
  flush(): void {
    if (this._parent) {
      this._parent.flush();
      return;
    }
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    if (!this._dirty) return;
    const obj: Mutable<StoreFile> = {
      version: FORMAT_VERSION,
      createdAt: this[META].createdAt,
      data: {},
    };
    for (const [k, v] of this._storage.iterateEntries()) obj.data[k] = v;
    const tmp = this._file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj), STORE_FORMAT.encoding);
    fs.renameSync(tmp, this._file);
    this._dirty = false;
    this[META].lastWrite = Date.now();
  }

  /* ----- 核心操作 (含函数重载) ----- */

  set(k: T, value: unknown): void;
  set(k: T, value: unknown, ttlSeconds: number): void;
  set(k: T, value: unknown, ttlSeconds?: number): void {
    const expireAt =
      ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    this._storage.put({
      id: this.fullKey(k),
      value,
      expireAt,
      state: EntryState.Active,
    });
    this.schedule();
  }

  get<U = unknown>(k: T): U | null {
    const key = this.fullKey(k);
    const e = this._storage.get(key);
    if (!e) return null;
    if (this.isExpired(e)) {
      this.deleteInternal(key, EvictionReason.TtlExpired);
      return null;
    }
    return e.value as U;
  }

  /** 安全获取，返回判别联合 */
  tryGet<U = unknown>(k: T): OpResult<U> {
    const key = this.fullKey(k);
    const e = this._storage.get(key);
    if (!e) return { ok: false, kind: "not_found", key };
    if (this.isExpired(e)) {
      this.deleteInternal(key, EvictionReason.TtlExpired);
      return { ok: false, kind: "not_found", key };
    }
    return { ok: true, value: e.value as U };
  }

  /** 获取或抛出 KeyNotFoundError */
  getOrThrow<U = unknown>(k: T): U {
    const r = this.tryGet<U>(k);
    if (isOpSuccess(r)) return r.value;
    throw new KeyNotFoundError(k);
  }

  private deleteInternal(key: string, reason: EvictionReason): boolean {
    const had = this._storage.remove(key);
    if (had) {
      this.recordEviction(key, reason);
      this.schedule();
    }
    return had;
  }

  delete(k: T): boolean {
    return this.deleteInternal(this.fullKey(k), EvictionReason.Manual);
  }

  exists(k: T): boolean {
    const key = this.fullKey(k);
    const e = this._storage.get(key);
    if (!e) return false;
    if (this.isExpired(e)) {
      this.deleteInternal(key, EvictionReason.TtlExpired);
      return false;
    }
    return true;
  }

  expire(k: T, ttlSeconds: number): boolean {
    const key = this.fullKey(k);
    const e = this._storage.get(key);
    if (!e || this.isExpired(e)) return false;
    e.expireAt = Date.now() + ttlSeconds * 1000;
    e.state = EntryState.Active;
    this.schedule();
    return true;
  }

  persist(k: T): boolean {
    const key = this.fullKey(k);
    const e = this._storage.get(key);
    if (!e) return false;
    e.expireAt = null;
    this.schedule();
    return true;
  }

  incr(k: T): number;
  incr(k: T, by: number): number;
  incr(k: T, by = 1): number {
    if (!isNumberValue(by))
      throw new TypeMismatchError("incr 的步长必须为数字");
    const key = this.fullKey(k);
    const e = this._storage.get(key);
    let cur = 0;
    let expireAt: number | null = null;
    if (e && !this.isExpired(e)) {
      expireAt = e.expireAt;
      if (isNumberValue(e.value as unknown)) cur = e.value as number;
    }
    const next = cur + by;
    this._storage.put({
      id: key,
      value: next,
      expireAt,
      state: EntryState.Active,
    });
    this.schedule();
    return next;
  }

  decr(k: T): number;
  decr(k: T, by: number): number;
  decr(k: T, by = 1): number {
    return this.incr(k, -by);
  }

  mset(pairs: Record<string, unknown>, ttlSeconds?: number): void {
    for (const k of Object.keys(pairs)) {
      if (ttlSeconds !== undefined) this.set(k as T, pairs[k], ttlSeconds);
      else this.set(k as T, pairs[k]);
    }
  }

  mget(keys: T[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = this.get(k);
    return out;
  }

  /* ----- 迭代 (生成器) ----- */

  *iterKeys(prefix?: T): IterableIterator<string> {
    const fullPrefix =
      prefix !== undefined
        ? this.fullKey(prefix)
        : this._ns
          ? this._ns + ":"
          : "";
    for (const k of this._storage.iterateIds()) {
      if (fullPrefix && !k.startsWith(fullPrefix)) continue;
      const e = this._storage.get(k);
      if (!e || this.isExpired(e)) continue;
      yield this.stripNs(k);
    }
  }

  *iterValues(prefix?: T): IterableIterator<unknown> {
    for (const k of this.iterKeys(prefix)) yield this.get(k as T);
  }

  *entries(): IterableIterator<[string, unknown]> {
    for (const k of this.iterKeys())
      yield [k, this.get(k as T)] as [string, unknown];
  }

  [Symbol.iterator](): IterableIterator<[string, unknown]> {
    return this.entries();
  }

  scan(): IterableIterator<string>;
  scan(prefix: T): IterableIterator<string>;
  *scan(prefix?: T): IterableIterator<string> {
    yield* this.iterKeys(prefix);
  }

  /* ----- 列表 / 计数 ----- */

  keys(prefix?: T): string[] {
    return Array.from(this.iterKeys(prefix));
  }
  values(prefix?: T): unknown[] {
    return Array.from(this.iterValues(prefix));
  }
  count(prefix?: T): number {
    return this.keys(prefix).length;
  }

  /* ----- 命名空间 / 清理操作 ----- */

  clear(): void {
    const p = this._ns ? this._ns + ":" : "";
    for (const k of Array.from(this._storage.iterateIds())) {
      if (!p || k.startsWith(p)) this.deleteInternal(k, EvictionReason.Cleared);
    }
    this.schedule();
  }

  stats(): StatsReport {
    let expired = 0,
      total = 0,
      namespaced = 0;
    const p = this._ns ? this._ns + ":" : "";
    for (const [k, e] of this._storage.iterateEntries()) {
      if (p && !k.startsWith(p)) continue;
      total++;
      if (this.isExpired(e)) {
        expired++;
        continue;
      }
      if (k.includes(":")) namespaced++;
    }
    return { total, expired, namespaced, active: total - expired };
  }

  purgeExpired(): number {
    let n = 0;
    for (const [k, e] of Array.from(this._storage.iterateEntries())) {
      if (this.isExpired(e)) {
        this.deleteInternal(k, EvictionReason.Compacted);
        n++;
      }
    }
    return n;
  }

  /** 重建文件 (去除已删除/过期条目) */
  compact(): void {
    this.purgeExpired();
    this._dirty = true;
    this.flush();
  }

  evictionLog(): ReadonlyArray<EvictionRecord> {
    return this[EVICTION_LOG];
  }
}

/* ===================== CLI ===================== */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatValue(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
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
  exists <key>                 是否存在
  keys [prefix]                列出键
  values [prefix]              列出值
  incr <key> [by] / decr       自增/自减
  expire <key> <seconds>       设置过期
  persist <key>                移除过期
  mset <k1>=<v1> <k2>=<v2>     批量设置
  stats / compact / clear / demo`);
    return;
  }

  const command = cmd as Command;
  switch (command) {
    case Command.Set: {
      const [k, v] = rest;
      assertKey(k);
      const ttl = getOpt(rest, "-t");
      if (ttl) db.set(k, parseValue(v ?? "null"), parseInt(ttl, 10));
      else db.set(k, parseValue(v ?? "null"));
      db.flush();
      console.log("OK");
      break;
    }
    case Command.Get: {
      const [k] = rest;
      assertKey(k);
      const result: OpResult = db.tryGet(k);
      if (isOpSuccess(result)) console.log(formatValue(result.value));
      else if (isOpNotFound(result)) console.log("(nil)");
      else if (isOpError(result)) console.log("(error)", result.message);
      break;
    }
    case Command.Del: {
      const [k] = rest;
      assertKey(k);
      console.log(db.delete(k) ? "OK" : "(nil)");
      db.flush();
      break;
    }
    case Command.Exists: {
      const [k] = rest;
      assertKey(k);
      console.log(db.exists(k) ? 1 : 0);
      break;
    }
    case Command.Keys: {
      const [prefix] = rest;
      const keys = db.keys(prefix);
      console.log(keys.length === 0 ? "(empty)" : keys.join("\n"));
      break;
    }
    case Command.Values: {
      const [prefix] = rest;
      const vals = db.values(prefix);
      console.log(
        vals.length === 0 ? "(empty)" : vals.map(formatValue).join("\n"),
      );
      break;
    }
    case Command.Incr: {
      const [k, by] = rest;
      assertKey(k);
      const r = db.incr(k, by ? parseInt(by, 10) : 1);
      db.flush();
      console.log("(integer)", r);
      break;
    }
    case Command.Decr: {
      const [k, by] = rest;
      assertKey(k);
      const r = db.decr(k, by ? parseInt(by, 10) : 1);
      db.flush();
      console.log("(integer)", r);
      break;
    }
    case Command.Expire: {
      const [k, sec] = rest;
      assertKey(k);
      if (!sec)
        throw new KVError(
          ErrorCode.InvalidType,
          "用法: expire <key> <seconds>",
        );
      console.log(db.expire(k, parseInt(sec, 10)) ? "OK" : "(nil)");
      db.flush();
      break;
    }
    case Command.Persist: {
      const [k] = rest;
      assertKey(k);
      console.log(db.persist(k) ? "OK" : "(nil)");
      db.flush();
      break;
    }
    case Command.Mset: {
      const pairs: Record<string, unknown> = {};
      for (const pair of rest) {
        const idx = pair.indexOf("=");
        if (idx < 0) continue;
        pairs[pair.slice(0, idx)] = parseValue(pair.slice(idx + 1));
      }
      db.mset(pairs);
      db.flush();
      console.log("OK");
      break;
    }
    case Command.Stats: {
      console.log(db.stats());
      break;
    }
    case Command.Compact: {
      const before = db.stats().total;
      db.compact();
      const after = db.stats().total;
      console.log(`压缩完成: ${before} -> ${after}`);
      break;
    }
    case Command.Clear: {
      db.clear();
      db.flush();
      console.log("OK");
      break;
    }
    case Command.Demo: {
      db.set("counter", 0);
      console.log("初始 counter:", db.get("counter"));
      for (let i = 0; i < 5; i++) db.incr("counter");
      console.log("自增 5 次后:", db.get<number>("counter"));
      db.set("temp", "短期数据", 2);
      console.log("temp (2 秒 TTL):", db.get("temp"));
      const sess = db.namespace("session");
      sess.set("user1", { name: "Alice" });
      sess.set("user2", { name: "Bob" });
      console.log("session 命名空间键:", sess.keys());
      console.log("user1:", formatValue(sess.get("user1")));
      console.log("全部键:", db.keys());
      console.log("mget:", db.mget(["counter", "temp"]));
      console.log(
        "scan 演示:",
        Array.from(db.scan()),
        Array.from(db.scan("counter")),
      );
      console.log("迭代器演示:");
      for (const [k, v] of db) console.log(`  ${k} = ${formatValue(v)}`);
      console.log("sess 是 KVStore:", isKVStore(sess));
      console.log("getOrThrow:", db.getOrThrow("counter"));
      console.log("驱逐标签示例:", EVICTION_LABEL[EvictionReason.TtlExpired]);
      db.flush();
      break;
    }
    default:
      throw new KVError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("错误:", msg);
    process.exit(1);
  });
}
