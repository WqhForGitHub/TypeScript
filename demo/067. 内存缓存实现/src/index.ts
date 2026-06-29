#!/usr/bin/env node
/**
 * 内存缓存实现
 * - 多种淘汰策略：LRU / LFU / FIFO / TTL
 * - 可配置最大容量
 * - 方法：get / set / delete / clear / has / size / stats
 * - 支持：优先级、标签（按标签失效）、指标（命中/未命中/淘汰）、基准与压测
 *
 * 高级 TypeScript 特性：
 * - 字符串枚举（EvictionPolicy / ErrorCode / EntryState / BenchmarkMetric）
 * - 判别联合（CacheHit | CacheMiss | CacheExpired）
 * - 泛型类与约束（Cache<V>、StatsRecorder<T extends number>）
 * - 抽象类 AbstractEvictionStrategy<V> 及具体子类
 * - 映射类型 Mutable<T>
 * - 自定义错误层级 CacheError extends Error
 * - 含可选 / readonly / 索引签名的接口
 * - satisfies 操作符、as const 断言
 * - getter / setter、生成器、Symbol 唯一键、类型守卫、函数重载
 *
 * 仅使用 Node.js 内置模块。
 */

// ===================== 枚举 =====================

export enum EvictionPolicy {
  LRU = "lru",
  LFU = "lfu",
  FIFO = "fifo",
  TTL = "ttl",
}

export enum ErrorCode {
  NotFound = "NOT_FOUND",
  Expired = "EXPIRED",
  CapacityExceeded = "CAPACITY_EXCEEDED",
  InvalidKey = "INVALID_KEY",
  InvalidPolicy = "INVALID_POLICY",
}

export enum EntryState {
  Active = "ACTIVE",
  Expired = "EXPIRED",
  Evicted = "EVICTED",
}

export enum BenchmarkMetric {
  DurationMs = "durationMs",
  OpsPerSec = "opsPerSec",
  HitRate = "hitRate",
  Evictions = "evictions",
}

// ===================== 映射类型 =====================

/** 去除 readonly 修饰符 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ===================== 接口 =====================

export interface Entry<V> {
  readonly value: V;
  priority: number;
  tags: Set<string>;
  readonly createdAt: number;
  lastAccess: number;
  accessCount: number;
  expireAt: number | null;
  state: EntryState;
}

export interface CacheOptions {
  readonly maxSize: number;
  readonly policy: EvictionPolicy;
  readonly defaultTtl?: number;
  readonly [key: string]: unknown;
}

export interface CacheStats {
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly sets: number;
  readonly deletes: number;
  readonly hitRate: number;
}

export interface SetOptions {
  readonly ttl?: number;
  readonly priority?: number;
  readonly tags?: readonly string[];
}

export interface BenchmarkResult {
  readonly policy: EvictionPolicy;
  readonly operations: number;
  readonly durationMs: number;
  readonly opsPerSec: number;
  readonly stats: CacheStats;
}

// ===================== 判别联合 =====================

export interface CacheHit<V> {
  readonly kind: "hit";
  readonly key: string;
  readonly value: V;
  readonly accessCount: number;
}

export interface CacheMiss {
  readonly kind: "miss";
  readonly key: string;
  readonly reason: "not_found";
}

export interface CacheExpired {
  readonly kind: "miss";
  readonly key: string;
  readonly reason: "expired";
}

export type CacheResult<V> = CacheHit<V> | CacheMiss | CacheExpired;

// ===================== 类型守卫 =====================

export function isCacheHit<V>(r: CacheResult<V>): r is CacheHit<V> {
  return r.kind === "hit";
}

export function isCacheMiss<V>(
  r: CacheResult<V>,
): r is CacheMiss | CacheExpired {
  return r.kind === "miss";
}

export function isCacheExpired<V>(r: CacheResult<V>): r is CacheExpired {
  return r.kind === "miss" && r.reason === "expired";
}

// ===================== 自定义错误层级 =====================

export class CacheError extends Error {
  readonly code: ErrorCode;
  readonly key?: string;

  constructor(code: ErrorCode, message: string, key?: string) {
    super(message);
    this.name = "CacheError";
    this.code = code;
    if (key !== undefined) this.key = key;
  }
}

export class CapacityExceededError extends CacheError {
  constructor(maxSize: number) {
    super(ErrorCode.CapacityExceeded, `capacity exceeded: maxSize=${maxSize}`);
    this.name = "CapacityExceededError";
  }
}

// ===================== Symbol 唯一键 =====================

const statsKey: unique symbol = Symbol("stats");
const versionKey: unique symbol = Symbol("version");

interface InternalStats {
  hits: number;
  misses: number;
  evictions: number;
  sets: number;
  deletes: number;
}

// ===================== 抽象淘汰策略 =====================

export abstract class AbstractEvictionStrategy<V> {
  abstract readonly name: string;
  /** 选择应被淘汰的键（返回 null 表示无法选出） */
  abstract selectEvictKey(
    entries: ReadonlyMap<string, Entry<V>>,
  ): string | null;
  /** 访问时的钩子（LRU 需要重新插入以保持顺序） */
  onAccess(_key: string, _entry: Entry<V>, _map: Map<string, Entry<V>>): void {
    /* 默认无操作 */
  }
}

export class LRUEvictionStrategy<V> extends AbstractEvictionStrategy<V> {
  readonly name = "LRU";
  selectEvictKey(entries: ReadonlyMap<string, Entry<V>>): string | null {
    let target: string | null = null;
    let minAccess = Infinity;
    let minPriority = Infinity;
    for (const [k, e] of entries) {
      if (e.priority < minPriority) {
        target = k;
        minPriority = e.priority;
        minAccess = e.lastAccess;
      } else if (e.priority === minPriority && e.lastAccess < minAccess) {
        target = k;
        minAccess = e.lastAccess;
      }
    }
    return target;
  }
  onAccess(key: string, _entry: Entry<V>, map: Map<string, Entry<V>>): void {
    const e = map.get(key);
    if (e) {
      map.delete(key);
      map.set(key, e);
    }
  }
}

export class LFUEvictionStrategy<V> extends AbstractEvictionStrategy<V> {
  readonly name = "LFU";
  selectEvictKey(entries: ReadonlyMap<string, Entry<V>>): string | null {
    let target: string | null = null;
    let minCount = Infinity;
    let minPriority = Infinity;
    for (const [k, e] of entries) {
      if (e.priority < minPriority) {
        target = k;
        minPriority = e.priority;
        minCount = e.accessCount;
      } else if (e.priority === minPriority && e.accessCount < minCount) {
        target = k;
        minCount = e.accessCount;
      }
    }
    return target;
  }
}

export class FIFOEvictionStrategy<V> extends AbstractEvictionStrategy<V> {
  readonly name = "FIFO";
  selectEvictKey(entries: ReadonlyMap<string, Entry<V>>): string | null {
    let target: string | null = null;
    let minCreated = Infinity;
    let minPriority = Infinity;
    for (const [k, e] of entries) {
      if (e.priority < minPriority) {
        target = k;
        minPriority = e.priority;
        minCreated = e.createdAt;
      } else if (e.priority === minPriority && e.createdAt < minCreated) {
        target = k;
        minCreated = e.createdAt;
      }
    }
    return target;
  }
}

export class TTLEvictionStrategy<V> extends AbstractEvictionStrategy<V> {
  readonly name = "TTL";
  selectEvictKey(entries: ReadonlyMap<string, Entry<V>>): string | null {
    const now = Date.now();
    // 优先淘汰已过期的
    for (const [k, e] of entries) {
      if (e.expireAt !== null && e.expireAt < now) return k;
    }
    // 否则淘汰 expireAt 最近的（在同优先级内）
    let target: string | null = null;
    let minExpire = Infinity;
    let minPriority = Infinity;
    for (const [k, e] of entries) {
      const ea = e.expireAt ?? Infinity;
      if (e.priority < minPriority) {
        target = k;
        minPriority = e.priority;
        minExpire = ea;
      } else if (e.priority === minPriority && ea < minExpire) {
        target = k;
        minExpire = ea;
      }
    }
    return target;
  }
}

const STRATEGY_REGISTRY: Readonly<
  Record<EvictionPolicy, () => AbstractEvictionStrategy<unknown>>
> = {
  [EvictionPolicy.LRU]: () => new LRUEvictionStrategy(),
  [EvictionPolicy.LFU]: () => new LFUEvictionStrategy(),
  [EvictionPolicy.FIFO]: () => new FIFOEvictionStrategy(),
  [EvictionPolicy.TTL]: () => new TTLEvictionStrategy(),
} satisfies Readonly<
  Record<EvictionPolicy, () => AbstractEvictionStrategy<unknown>>
>;

function createStrategy<V>(
  policy: EvictionPolicy,
): AbstractEvictionStrategy<V> {
  const factory = STRATEGY_REGISTRY[policy];
  if (!factory)
    throw new CacheError(ErrorCode.InvalidPolicy, `unknown policy: ${policy}`);
  return factory() as AbstractEvictionStrategy<V>;
}

const ALL_POLICIES = [
  EvictionPolicy.LRU,
  EvictionPolicy.LFU,
  EvictionPolicy.FIFO,
  EvictionPolicy.TTL,
] as const;

// ===================== StatsRecorder（泛型 + 约束） =====================

export class StatsRecorder<T extends number> {
  private readonly data = new Map<string, T>();
  private _count = 0;

  record(name: string, value: T): void {
    this.data.set(name, value);
    this._count++;
  }

  get(name: string): T | undefined {
    return this.data.get(name);
  }

  get count(): number {
    return this._count;
  }

  sum(): number {
    let s = 0;
    for (const v of this.data.values()) s += v;
    return s;
  }

  *entries(): IterableIterator<[string, T]> {
    yield* this.data.entries();
  }
}

// ===================== Cache（泛型类） =====================

export class Cache<V = unknown> {
  protected readonly map = new Map<string, Entry<V>>();
  protected readonly opts: CacheOptions;
  protected readonly strategy: AbstractEvictionStrategy<V>;
  protected readonly [statsKey]: InternalStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0,
    deletes: 0,
  };
  protected [versionKey] = 0;

  constructor(opts: CacheOptions) {
    this.opts = opts;
    this.strategy = createStrategy<V>(opts.policy);
  }

  // ---- getter / setter ----

  get capacity(): number {
    return this.opts.maxSize;
  }

  get policy(): EvictionPolicy {
    return this.opts.policy;
  }

  get version(): number {
    return this[versionKey];
  }

  set maxSize(value: number) {
    if (value <= 0) throw new CapacityExceededError(value);
    (this.opts as Mutable<CacheOptions>).maxSize = value;
    this.ensureCapacity();
  }

  // ---- set ----

  set(key: string, value: V, opts: SetOptions = {}): void {
    if (!key)
      throw new CacheError(ErrorCode.InvalidKey, "key must be non-empty", key);
    const now = Date.now();
    const ttl = opts.ttl !== undefined ? opts.ttl : this.opts.defaultTtl;
    const entry: Entry<V> = {
      value,
      priority: opts.priority ?? 0,
      tags: new Set(opts.tags ?? []),
      createdAt: now,
      lastAccess: now,
      accessCount: 0,
      expireAt: ttl !== undefined ? now + ttl : null,
      state: EntryState.Active,
    };
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    this[statsKey].sets++;
    this[versionKey]++;
    this.ensureCapacity();
  }

  // ---- get（简版） ----

  get(key: string): V | null {
    const result = this.getDetailed(key);
    return isCacheHit(result) ? result.value : null;
  }

  // ---- getDetailed（返回判别联合） ----

  getDetailed(key: string): CacheResult<V> {
    const e = this.map.get(key);
    if (!e) {
      this[statsKey].misses++;
      return { kind: "miss", key, reason: "not_found" } satisfies CacheMiss;
    }
    if (e.expireAt !== null && e.expireAt < Date.now()) {
      this.map.delete(key);
      e.state = EntryState.Expired;
      this[statsKey].misses++;
      this[statsKey].evictions++;
      this[versionKey]++;
      return { kind: "miss", key, reason: "expired" } satisfies CacheExpired;
    }
    e.lastAccess = Date.now();
    e.accessCount++;
    this.strategy.onAccess(key, e, this.map);
    this[statsKey].hits++;
    return {
      kind: "hit",
      key,
      value: e.value,
      accessCount: e.accessCount,
    } satisfies CacheHit<V>;
  }

  // ---- has ----

  has(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    if (e.expireAt !== null && e.expireAt < Date.now()) {
      this.map.delete(key);
      e.state = EntryState.Expired;
      return false;
    }
    return true;
  }

  // ---- delete ----

  delete(key: string): boolean {
    const e = this.map.get(key);
    const had = this.map.delete(key);
    if (had) {
      if (e) e.state = EntryState.Evicted;
      this[statsKey].deletes++;
      this[versionKey]++;
    }
    return had;
  }

  // ---- clear ----

  clear(): void {
    for (const e of this.map.values()) e.state = EntryState.Evicted;
    this.map.clear();
    this[versionKey]++;
  }

  // ---- size ----

  size(): number {
    return this.map.size;
  }

  // ---- 按标签失效 ----

  invalidateByTag(tag: string): number {
    let n = 0;
    for (const [k, e] of this.map) {
      if (e.tags.has(tag)) {
        e.state = EntryState.Evicted;
        this.map.delete(k);
        n++;
      }
    }
    if (n > 0) this[versionKey]++;
    return n;
  }

  // ---- 统计 ----

  getStats(): CacheStats {
    const s = this[statsKey];
    const total = s.hits + s.misses;
    return {
      size: this.map.size,
      hits: s.hits,
      misses: s.misses,
      evictions: s.evictions,
      sets: s.sets,
      deletes: s.deletes,
      hitRate: total === 0 ? 0 : s.hits / total,
    } satisfies CacheStats;
  }

  // ---- 生成器：迭代条目 ----

  *entries(): IterableIterator<[string, V]> {
    const now = Date.now();
    for (const [k, e] of this.map) {
      if (e.expireAt !== null && e.expireAt < now) continue;
      yield [k, e.value];
    }
  }

  *keys(): IterableIterator<string> {
    for (const [k] of this.entries()) yield k;
  }

  *values(): IterableIterator<V> {
    for (const [, v] of this.entries()) yield v;
  }

  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.entries();
  }

  // ---- 容量管理 ----

  protected ensureCapacity(): void {
    while (this.map.size > this.opts.maxSize) {
      const key = this.strategy.selectEvictKey(this.map);
      if (key === null) break;
      const e = this.map.get(key);
      if (e) e.state = EntryState.Evicted;
      this.map.delete(key);
      this[statsKey].evictions++;
      this[versionKey]++;
    }
  }
}

// ===================== 工厂 =====================

export function createCache<V = unknown>(opts: CacheOptions): Cache<V> {
  return new Cache<V>(opts);
}

// ===================== 函数重载 =====================

export function lookup<V>(cache: Cache<V>, key: string): V | null;
export function lookup<V>(
  cache: Cache<V>,
  key: string,
  detailed: true,
): CacheResult<V>;
export function lookup<V>(
  cache: Cache<V>,
  key: string,
  detailed?: boolean,
): V | null | CacheResult<V> {
  if (detailed) return cache.getDetailed(key);
  return cache.get(key);
}

// ===================== 基准与压测 =====================

export function benchmark(maxSize: number, ops: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  for (const policy of ALL_POLICIES) {
    const cache = createCache<number>({
      maxSize,
      policy,
      defaultTtl: policy === EvictionPolicy.TTL ? 1000 : undefined,
    });
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      const key = "k" + (i % (maxSize * 2));
      if (i % 3 === 0) cache.set(key, i);
      else cache.get(key);
    }
    const dur = Date.now() - start;
    results.push({
      policy,
      operations: ops,
      durationMs: dur,
      opsPerSec: dur === 0 ? Infinity : Math.round((ops / dur) * 1000),
      stats: cache.getStats(),
    } satisfies BenchmarkResult);
  }
  return results;
}

export interface StressResult {
  readonly policy: EvictionPolicy;
  readonly evictions: number;
  readonly finalSize: number;
  readonly hitRate: number;
}

export function stress(maxSize: number, ops: number): StressResult[] {
  return ALL_POLICIES.map((policy): StressResult => {
    const cache = createCache<number>({ maxSize, policy });
    // 模拟访问模式：80% 访问热键，20% 访问冷键
    for (let i = 0; i < ops; i++) {
      const hot = i % 5 !== 0;
      const key = hot ? "hot" + (i % 10) : "cold" + i;
      cache.set(key, i);
      cache.get(key);
    }
    const s = cache.getStats();
    return {
      policy,
      evictions: s.evictions,
      finalSize: s.size,
      hitRate: s.hitRate,
    } satisfies StressResult;
  });
}

// ===================== CLI =====================

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.log(`内存缓存 CLI
用法:
  demo       交互式演示，比较各策略
  benchmark  性能基准测试
  stress     压力测试
选项可通过环境变量:
  CACHE_SIZE (默认 100)
  CACHE_OPS  (默认 10000)
`);
    return;
  }

  const size = parseInt(process.env.CACHE_SIZE || "100", 10);
  const ops = parseInt(process.env.CACHE_OPS || "10000", 10);

  switch (cmd) {
    case "demo": {
      console.log("=== 缓存策略对比演示 ===\n");
      console.log(`容量上限: ${size}\n`);
      for (const policy of ALL_POLICIES) {
        const cache = createCache<string>({
          maxSize: 3,
          policy,
          defaultTtl: policy === EvictionPolicy.TTL ? 500 : undefined,
        });
        console.log(`--- ${policy.toUpperCase()} ---`);
        cache.set("a", "A");
        cache.set("b", "B");
        cache.set("c", "C");
        console.log("访问 a:", cache.get("a"));
        cache.set("d", "D"); // 触发淘汰
        console.log("插入 d 后:");
        console.log("  a =", cache.get("a"));
        console.log("  b =", cache.get("b"));
        console.log("  c =", cache.get("c"));
        console.log("  d =", cache.get("d"));
        console.log("  统计:", cache.getStats(), "\n");
      }
      // 标签示例
      console.log("--- 标签失效 ---");
      const c = createCache<number>({
        maxSize: 10,
        policy: EvictionPolicy.LRU,
      });
      c.set("u1", 1, { tags: ["user"] });
      c.set("u2", 2, { tags: ["user"] });
      c.set("p1", 3, { tags: ["post"] });
      console.log("失效 user 标签:", c.invalidateByTag("user"), "项");
      console.log("剩余大小:", c.size());

      // 判别联合 + 类型守卫示例
      console.log("--- 判别联合查询 ---");
      const r = lookup(c, "p1", true);
      if (isCacheHit(r)) {
        console.log(
          `命中: key=${r.key}, value=${r.value}, accessCount=${r.accessCount}`,
        );
      } else if (isCacheExpired(r)) {
        console.log(`过期: key=${r.key}`);
      } else {
        console.log(`未命中: key=${r.key}, reason=${r.reason}`);
      }

      // 生成器迭代示例
      console.log("--- 生成器迭代 ---");
      const g = createCache<number>({
        maxSize: 5,
        policy: EvictionPolicy.FIFO,
      });
      g.set("x", 10);
      g.set("y", 20);
      g.set("z", 30);
      for (const [k, v] of g) console.log(`  ${k} => ${v}`);

      // StatsRecorder 示例
      const recorder = new StatsRecorder<number>();
      recorder.record(BenchmarkMetric.DurationMs, 12);
      recorder.record(BenchmarkMetric.OpsPerSec, 83000);
      console.log(
        "StatsRecorder count:",
        recorder.count,
        "sum:",
        recorder.sum(),
      );
      break;
    }
    case "benchmark": {
      console.log(`基准测试：size=${size}, ops=${ops}\n`);
      const results = benchmark(size, ops);
      console.log("策略     | 耗时(ms) | ops/sec  | 命中率 | 淘汰");
      console.log("---------+----------+----------+--------+------");
      for (const r of results) {
        console.log(
          `${r.policy.padEnd(8)} | ${String(r.durationMs).padStart(8)} | ${String(r.opsPerSec).padStart(8)} | ${(r.stats.hitRate * 100).toFixed(1).padStart(5)}% | ${r.stats.evictions}`,
        );
      }
      break;
    }
    case "stress": {
      console.log(`压力测试：size=${size}, ops=${ops}\n`);
      const results = stress(size, ops);
      console.log("策略  | 最终大小 | 淘汰数  | 命中率");
      console.log("------+----------+---------+--------");
      for (const r of results) {
        console.log(
          `${r.policy.padEnd(4)} | ${String(r.finalSize).padStart(8)} | ${String(r.evictions).padStart(7)} | ${(r.hitRate * 100).toFixed(1)}%`,
        );
      }
      break;
    }
    default:
      throw new CacheError(ErrorCode.InvalidPolicy, `未知命令: ${cmd}`);
  }
  // rest 保留以避免未使用参数告警
  void rest;
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("错误:", msg);
    process.exit(1);
  });
}
