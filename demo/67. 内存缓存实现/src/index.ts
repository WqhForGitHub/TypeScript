#!/usr/bin/env node
/**
 * 内存缓存实现
 * - 多种淘汰策略：LRU / LFU / FIFO / TTL
 * - 可配置最大容量
 * - 方法：get / set / delete / clear / has / size / stats
 * - 支持：优先级、标签（按标签失效）、指标（命中/未命中/淘汰）
 *
 * 仅使用 Node.js 内置模块。
 */

export type EvictionPolicy = "lru" | "lfu" | "fifo" | "ttl";

interface Entry<V> {
  value: V;
  priority: number;
  tags: Set<string>;
  createdAt: number;
  lastAccess: number;
  accessCount: number;
  expireAt: number | null;
}

export interface CacheOptions {
  maxSize: number;
  policy: EvictionPolicy;
  defaultTtl?: number; // 默认 TTL（ms）
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

/** 缓存基类 */
export abstract class Cache<V = unknown> {
  protected map = new Map<string, Entry<V>>();
  protected opts: CacheOptions;
  protected stats = { hits: 0, misses: 0, evictions: 0, sets: 0, deletes: 0 };

  constructor(opts: CacheOptions) {
    this.opts = opts;
  }

  /** 设置键值 */
  set(key: string, value: V, opts: { ttl?: number; priority?: number; tags?: string[] } = {}): void {
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
    };
    // 如果已存在，先删除（以便重新插入到末尾等）
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    this.stats.sets++;
    this.ensureCapacity();
  }

  /** 获取值 */
  get(key: string): V | null {
    const e = this.map.get(key);
    if (!e) {
      this.stats.misses++;
      return null;
    }
    if (e.expireAt !== null && e.expireAt < Date.now()) {
      this.map.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }
    e.lastAccess = Date.now();
    e.accessCount++;
    this.onAccess(key, e);
    this.stats.hits++;
    return e.value;
  }

  /** 子类钩子：访问时调整结构 */
  protected onAccess(_key: string, _entry: Entry<V>): void {
    // 默认无操作
  }

  /** 是否存在 */
  has(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    if (e.expireAt !== null && e.expireAt < Date.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /** 删除 */
  delete(key: string): boolean {
    const had = this.map.delete(key);
    if (had) this.stats.deletes++;
    return had;
  }

  /** 清空 */
  clear(): void {
    this.map.clear();
  }

  /** 当前大小 */
  size(): number {
    return this.map.size;
  }

  /** 按标签失效 */
  invalidateByTag(tag: string): number {
    let n = 0;
    for (const [k, e] of this.map) {
      if (e.tags.has(tag)) {
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }

  /** 统计 */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.map.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
    };
  }

  /** 确保容量，必要时淘汰 */
  protected ensureCapacity(): void {
    while (this.map.size > this.opts.maxSize) {
      this.evict();
    }
  }

  /** 由子类实现具体淘汰策略 */
  protected abstract evict(): void;

  /** 通用：找出最小优先级中最该被淘汰的键 */
  protected findEvictKey(compare: (a: Entry<V>, b: Entry<V>) => number): string | null {
    let target: string | null = null;
    let targetEntry: Entry<V> | null = null;
    for (const [k, e] of this.map) {
      if (targetEntry === null) {
        target = k;
        targetEntry = e;
        continue;
      }
      // 优先级低的先被淘汰
      if (e.priority < targetEntry.priority) {
        target = k;
        targetEntry = e;
      } else if (e.priority === targetEntry.priority) {
        if (compare(e, targetEntry) < 0) {
          target = k;
          targetEntry = e;
        }
      }
    }
    return target;
  }
}

/** LRU 缓存：最近最少使用 */
export class LRUCache<V = unknown> extends Cache<V> {
  protected onAccess(key: string, _entry: Entry<V>): void {
    // 重新插入到 Map 末尾（Map 保持插入顺序）
    const e = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, e);
  }
  protected evict(): void {
    const key = this.findEvictKey((a, b) => a.lastAccess - b.lastAccess);
    if (key !== null) {
      this.map.delete(key);
      this.stats.evictions++;
    }
  }
}

/** LFU 缓存：最少使用频次 */
export class LFUCache<V = unknown> extends Cache<V> {
  protected evict(): void {
    const key = this.findEvictKey((a, b) => a.accessCount - b.accessCount);
    if (key !== null) {
      this.map.delete(key);
      this.stats.evictions++;
    }
  }
}

/** FIFO 缓存：先进先出 */
export class FIFOCache<V = unknown> extends Cache<V> {
  protected evict(): void {
    const key = this.findEvictKey((a, b) => a.createdAt - b.createdAt);
    if (key !== null) {
      this.map.delete(key);
      this.stats.evictions++;
    }
  }
}

/** TTL 缓存：优先淘汰最接近过期的 */
export class TTLCache<V = unknown> extends Cache<V> {
  protected evict(): void {
    // 先清理已过期的
    const now = Date.now();
    for (const [k, e] of this.map) {
      if (e.expireAt !== null && e.expireAt < now) {
        this.map.delete(k);
        this.stats.evictions++;
        return;
      }
    }
    // 否则淘汰 expireAt 最近的
    const key = this.findEvictKey((a, b) => {
      const ea = a.expireAt ?? Infinity;
      const eb = b.expireAt ?? Infinity;
      return ea - eb;
    });
    if (key !== null) {
      this.map.delete(key);
      this.stats.evictions++;
    }
  }
}

/** 缓存工厂 */
export function createCache<V = unknown>(opts: CacheOptions): Cache<V> {
  switch (opts.policy) {
    case "lru": return new LRUCache<V>(opts);
    case "lfu": return new LFUCache<V>(opts);
    case "fifo": return new FIFOCache<V>(opts);
    case "ttl": return new TTLCache<V>(opts);
  }
}

/* ----------------------- 基准与压测 ----------------------- */

export interface BenchmarkResult {
  policy: EvictionPolicy;
  operations: number;
  durationMs: number;
  opsPerSec: number;
  stats: CacheStats;
}

/** 基准测试：比较不同策略 */
export function benchmark(maxSize: number, ops: number): BenchmarkResult[] {
  const policies: EvictionPolicy[] = ["lru", "lfu", "fifo", "ttl"];
  const results: BenchmarkResult[] = [];
  for (const policy of policies) {
    const cache = createCache<number>({ maxSize, policy, defaultTtl: policy === "ttl" ? 1000 : undefined });
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
    });
  }
  return results;
}

/** 压力测试：写入直到容量上限并观察淘汰 */
export function stress(maxSize: number, ops: number): {
  policy: EvictionPolicy;
  evictions: number;
  finalSize: number;
  hitRate: number;
}[] {
  const policies: EvictionPolicy[] = ["lru", "lfu", "fifo", "ttl"];
  return policies.map((policy) => {
    const cache = createCache<number>({ maxSize, policy });
    // 模拟访问模式：80% 访问热键，20% 访问冷键
    for (let i = 0; i < ops; i++) {
      const hot = i % 5 !== 0;
      const key = hot ? "hot" + (i % 10) : "cold" + i;
      cache.set(key, i);
      cache.get(key);
    }
    const s = cache.getStats();
    return { policy, evictions: s.evictions, finalSize: s.size, hitRate: s.hitRate };
  });
}

/* ----------------------- CLI ----------------------- */

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
      for (const policy of ["lru", "lfu", "fifo", "ttl"] as EvictionPolicy[]) {
        const cache = createCache<string>({ maxSize: 3, policy, defaultTtl: policy === "ttl" ? 500 : undefined });
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
      const c = createCache<number>({ maxSize: 10, policy: "lru" });
      c.set("u1", 1, { tags: ["user"] });
      c.set("u2", 2, { tags: ["user"] });
      c.set("p1", 3, { tags: ["post"] });
      console.log("失效 user 标签:", c.invalidateByTag("user"), "项");
      console.log("剩余大小:", c.size());
      break;
    }
    case "benchmark": {
      console.log(`基准测试：size=${size}, ops=${ops}\n`);
      const results = benchmark(size, ops);
      console.log("策略     | 耗时(ms) | ops/sec  | 命中率 | 淘汰");
      console.log("---------+----------+----------+--------+------");
      for (const r of results) {
        console.log(
          `${r.policy.padEnd(8)} | ${String(r.durationMs).padStart(8)} | ${String(r.opsPerSec).padStart(8)} | ${(r.stats.hitRate * 100).toFixed(1).padStart(5)}% | ${r.stats.evictions}`
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
          `${r.policy.padEnd(4)} | ${String(r.finalSize).padStart(8)} | ${String(r.evictions).padStart(7)} | ${(r.hitRate * 100).toFixed(1)}%`
        );
      }
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
