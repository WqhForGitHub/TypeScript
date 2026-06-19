#!/usr/bin/env node
/**
 * 简单事件总线 (Simple Event Bus)
 * -------------------------------------------------------------
 * 基于 Node.js EventEmitter 的事件总线实现，支持：
 *   - on / off / once / emit
 *   - 通配符订阅 (例如 "user.*")
 *   - 命名空间事件
 *   - 优先级监听 (数字越大越先执行)
 *   - 异步监听 (await 所有监听器完成)
 *   - 错误处理
 *   - 事件拦截 / 取消
 *   - 中间件 (before / after)
 *   - 泛型类型化事件
 *   - 事件历史 / 回放
 *   - 调试日志
 *
 * 公开 API:
 *   class EventBus<TMap extends Record<string, unknown> = DefaultEvents>
 *     on(event, listener, opts?) -> () => void (取消订阅)
 *     once(event, listener, opts?)
 *     off(event, listener?)
 *     emitSync(event, ...args) -> boolean
 *     emit(event, ...args) -> Promise<boolean>      // 异步等待
 *     use(middleware)                                // 注册中间件
 *     intercept(event, fn)                           // 拦截器，可取消事件
 *     history: EventRecord[]
 *     replay(event?)                                 // 回放历史
 *     clear()
 *     listenerCount(event?)
 *
 * 仅依赖 Node.js 内置模块: events.
 */

import { EventEmitter } from 'events';

/** 默认事件映射 */
export interface DefaultEvents {
  [key: string]: unknown[];
}

export interface ListenerOptions {
  priority?: number; // 数字越大越先执行，默认 0
  once?: boolean;
}

export interface ListenerEntry {
  event: string;
  listener: (...args: unknown[]) => unknown | Promise<unknown>;
  priority: number;
  once: boolean;
}

export interface EventRecord {
  event: string;
  args: unknown[];
  timestamp: number;
}

export type Middleware<TMap extends Record<string, unknown> = DefaultEvents> = (
  ctx: { event: keyof TMap & string; args: unknown[]; cancelled: boolean }
) => void | Promise<void>;

export type Interceptor = (event: string, args: unknown[]) => boolean; // 返回 false 取消

export type DebugLogger = (level: 'log' | 'warn' | 'error', msg: string) => void;

/** 事件总线类（泛型化事件映射） */
export class EventBus<TMap extends Record<string, unknown[]> = DefaultEvents> {
  private emitter = new EventEmitter();
  private listeners: Map<string, ListenerEntry[]> = new Map();
  private middlewares: Middleware<TMap>[] = [];
  private interceptors: Map<string, Interceptor[]> = new Map();
  public history: EventRecord[] = [];
  private maxHistory = 100;
  private debug = false;
  private logger: DebugLogger;

  constructor(options: { maxHistory?: number; debug?: boolean; logger?: DebugLogger } = {}) {
    if (options.maxHistory !== undefined) this.maxHistory = options.maxHistory;
    this.debug = options.debug ?? false;
    this.logger = options.logger ?? ((level, msg) => console[level](`[EventBus] ${msg}`));
    this.emitter.setMaxListeners(0); // 不限制监听器数量
  }

  /** 订阅事件，返回取消订阅函数 */
  on<K extends keyof TMap & string>(
    event: K,
    listener: (...args: TMap[K]) => unknown | Promise<unknown>,
    opts: ListenerOptions = {}
  ): () => void {
    return this.addListener(event, listener as (...args: unknown[]) => unknown | Promise<unknown>, opts.priority ?? 0, opts.once ?? false);
  }

  /** 仅订阅一次 */
  once<K extends keyof TMap & string>(
    event: K,
    listener: (...args: TMap[K]) => unknown | Promise<unknown>,
    opts: ListenerOptions = {}
  ): () => void {
    return this.addListener(event, listener as (...args: unknown[]) => unknown | Promise<unknown>, opts.priority ?? 0, true);
  }

  /** 取消订阅 */
  off<K extends keyof TMap & string>(
    event: K,
    listener?: (...args: TMap[K]) => unknown | Promise<unknown>
  ): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    if (!listener) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(
        event,
        arr.filter((e) => e.listener !== listener)
      );
    }
  }

  /** 同步触发事件（不等待异步监听器，监听器返回 Promise 会被忽略） */
  emitSync<K extends keyof TMap & string>(event: K, ...args: TMap[K]): boolean {
    if (this.debug) this.logger('log', `同步触发: ${String(event)}`);
    if (!this.runInterceptor(event, args)) {
      if (this.debug) this.logger('warn', `事件被拦截: ${String(event)}`);
      return false;
    }
    this.recordHistory(event, args);
    const entries = this.collectListeners(event);
    if (entries.length === 0) return false;
    let hadError = false;
    for (const entry of entries) {
      try {
        const ret = entry.listener(...args);
        if (ret instanceof Promise) {
          ret.catch((e) => this.logger('error', `异步监听器错误: ${(e as Error).message}`));
        }
      } catch (err) {
        hadError = true;
        this.logger('error', `监听器错误 [${String(event)}]: ${(err as Error).message}`);
      }
      if (entry.once) this.removeListenerEntry(event, entry);
    }
    return !hadError;
  }

  /** 异步触发事件，等待所有监听器完成 */
  async emit<K extends keyof TMap & string>(event: K, ...args: TMap[K]): Promise<boolean> {
    if (this.debug) this.logger('log', `异步触发: ${String(event)}`);
    if (!this.runInterceptor(event, args)) {
      if (this.debug) this.logger('warn', `事件被拦截: ${String(event)}`);
      return false;
    }
    // before 中间件
    const ctx = { event: event as string, args: args as unknown[], cancelled: false };
    for (const mw of this.middlewares) {
      await mw(ctx);
      if (ctx.cancelled) {
        if (this.debug) this.logger('warn', `事件被中间件取消: ${String(event)}`);
        return false;
      }
    }
    this.recordHistory(event, args);
    const entries = this.collectListeners(event);
    if (entries.length === 0) return false;
    let hadError = false;
    const promises: Promise<void>[] = [];
    for (const entry of entries) {
      const run = async (): Promise<void> => {
        try {
          await entry.listener(...args);
        } catch (err) {
          hadError = true;
          this.logger('error', `监听器错误 [${String(event)}]: ${(err as Error).message}`);
        } finally {
          if (entry.once) this.removeListenerEntry(event, entry);
        }
      };
      const ret = run();
      if (ret instanceof Promise) promises.push(ret);
    }
    await Promise.all(promises);
    return !hadError;
  }

  /** 注册中间件 */
  use(mw: Middleware<TMap>): this {
    this.middlewares.push(mw);
    return this;
  }

  /** 注册拦截器，返回 false 可取消事件 */
  intercept(event: string, fn: Interceptor): () => void {
    if (!this.interceptors.has(event)) this.interceptors.set(event, []);
    this.interceptors.get(event)!.push(fn);
    return () => {
      const arr = this.interceptors.get(event);
      if (!arr) return;
      this.interceptors.set(event, arr.filter((x) => x !== fn));
    };
  }

  /** 获取监听器数量 */
  listenerCount(event?: string): number {
    if (event) return this.collectListeners(event).length;
    let total = 0;
    for (const arr of this.listeners.values()) total += arr.length;
    return total;
  }

  /** 清空所有监听器与历史 */
  clear(): void {
    this.listeners.clear();
    this.interceptors.clear();
    this.middlewares = [];
    this.history = [];
  }

  /** 回放历史事件 */
  replay(filter?: string): EventRecord[] {
    const records = filter ? this.history.filter((r) => this.matchPattern(r.event, filter)) : this.history;
    for (const r of records) {
      const entries = this.collectListeners(r.event);
      for (const entry of entries) {
        try {
          entry.listener(...r.args);
        } catch (err) {
          this.logger('error', `回放错误: ${(err as Error).message}`);
        }
      }
    }
    return records;
  }

  // ---------- 内部方法 ----------

  private addListener(
    event: string,
    listener: (...args: unknown[]) => unknown | Promise<unknown>,
    priority: number,
    once: boolean
  ): () => void {
    const entry: ListenerEntry = { event, listener, priority, once };
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(entry);
    // 按优先级降序排序
    this.listeners.get(event)!.sort((a, b) => b.priority - a.priority);
    return () => this.removeListenerEntry(event, entry);
  }

  private removeListenerEntry(event: string, entry: ListenerEntry): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) arr.splice(idx, 1);
    if (arr.length === 0) this.listeners.delete(event);
  }

  /** 收集匹配监听器（含通配符） */
  private collectListeners(event: string): ListenerEntry[] {
    const result: ListenerEntry[] = [];
    for (const [pattern, entries] of this.listeners.entries()) {
      if (this.matchPattern(event, pattern)) {
        result.push(...entries);
      }
    }
    // 稳定排序：先按 priority 降序，同优先级保持插入顺序
    result.sort((a, b) => b.priority - a.priority);
    return result;
  }

  /** 简单通配符匹配，支持 "*" (单层任意) 与 "#" (多层任意) */
  private matchPattern(event: string, pattern: string): boolean {
    if (pattern === '*' || pattern === event) return true;
    if (!pattern.includes('*') && !pattern.includes('#')) return pattern === event;
    const evParts = event.split('.');
    const paParts = pattern.split('.');
    // # 匹配多层
    let i = 0;
    let j = 0;
    while (i < evParts.length && j < paParts.length) {
      if (paParts[j] === '#') {
        // # 必须是最后一部分
        if (j === paParts.length - 1) return true;
        // 否则尝试匹配后续
        const restPattern = paParts.slice(j + 1).join('.');
        for (let k = i; k < evParts.length; k++) {
          if (this.matchPattern(evParts.slice(k).join('.'), restPattern)) return true;
        }
        return false;
      } else if (paParts[j] === '*' || paParts[j] === evParts[i]) {
        i++;
        j++;
      } else {
        return false;
      }
    }
    return i === evParts.length && j === paParts.length;
  }

  private runInterceptor(event: string, args: unknown[]): boolean {
    const arr = this.interceptors.get(event);
    if (!arr) return true;
    for (const fn of arr) {
      if (fn(event, args) === false) return false;
    }
    return true;
  }

  private recordHistory(event: string, args: unknown[]): void {
    this.history.push({ event, args, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }
}

// ===================== CLI 演示 =====================

async function demoInteractive(): Promise<void> {
  console.log('===== 事件总线交互式演示 =====\n');
  const bus = new EventBus<{
    'user.login': [string];
    'user.logout': [string];
    'user.*': [string];
    'order.created': [number, number];
  }>({ debug: true, maxHistory: 50 });

  // 订阅具体事件
  const off1 = bus.on('user.login', (name) => {
    console.log(`  [日志] 用户登录: ${name}`);
  }, { priority: 10 });

  bus.on('user.login', async (name) => {
    await new Promise((r) => setTimeout(r, 50));
    console.log(`  [异步] 已发送欢迎邮件给 ${name}`);
  }, { priority: 5 });

  // 通配符订阅
  bus.on('user.*' as 'user.login', (name: string) => {
    console.log(`  [审计] 用户事件触发: ${name}`);
  });

  // 中间件
  bus.use((ctx) => {
    console.log(`  [中间件] 事件: ${ctx.event}, 参数: ${JSON.stringify(ctx.args)}`);
  });

  // 拦截器
  bus.intercept('user.login', (event, args) => {
    if (args[0] === 'blocked') {
      console.log(`  [拦截] 拒绝用户 ${args[0]} 登录`);
      return false;
    }
    return true;
  });

  console.log('1) 触发 user.login (Alice):');
  await bus.emit('user.login', 'Alice');

  console.log('\n2) 触发 user.login (blocked):');
  const ok = await bus.emit('user.login', 'blocked');
  console.log(`  emit 返回: ${ok}`);

  console.log('\n3) 取消第一个订阅后再次触发:');
  off1();
  await bus.emit('user.login', 'Bob');

  console.log('\n4) 历史记录:');
  for (const r of bus.history) {
    console.log(`  ${new Date(r.timestamp).toISOString()} ${r.event} ${JSON.stringify(r.args)}`);
  }

  console.log('\n5) 回放历史:');
  bus.replay('user.login');

  console.log(`\n当前监听器总数: ${bus.listenerCount()}`);
  console.log('===== 演示结束 =====\n');
}

async function runTests(): Promise<void> {
  console.log('===== 事件总线测试套件 =====\n');
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      passed++;
      console.log(`  [PASS] ${msg}`);
    } else {
      failed++;
      console.log(`  [FAIL] ${msg}`);
    }
  };

  // 测试1: 基本订阅与触发
  {
    const bus = new EventBus<{ a: [number] }>();
    let got = 0;
    bus.on('a', (n) => (got = n));
    bus.emitSync('a', 42);
    assert(got === 42, '基本订阅与触发');
  }

  // 测试2: once
  {
    const bus = new EventBus<{ a: [] }>();
    let count = 0;
    bus.once('a', () => count++);
    bus.emitSync('a');
    bus.emitSync('a');
    assert(count === 1, 'once 只触发一次');
  }

  // 测试3: 优先级
  {
    const bus = new EventBus<{ a: [] }>();
    const order: number[] = [];
    bus.on('a', () => order.push(1), { priority: 1 });
    bus.on('a', () => order.push(2), { priority: 10 });
    bus.on('a', () => order.push(3), { priority: 5 });
    bus.emitSync('a');
    assert(order.join(',') === '2,3,1', '优先级排序正确');
  }

  // 测试4: 通配符
  {
    const bus = new EventBus();
    let matched = '';
    bus.on('user.*' as never, (n: unknown) => (matched = String(n)));
    bus.emitSync('user.login', 'x');
    assert(matched === 'x', '通配符 user.* 匹配 user.login');
    bus.emitSync('user.logout', 'y');
    assert(matched === 'y', '通配符 user.* 匹配 user.logout');
  }

  // 测试5: 拦截
  {
    const bus = new EventBus<{ a: [] }>();
    let called = false;
    bus.on('a', () => (called = true));
    bus.intercept('a', () => false);
    const ok = bus.emitSync('a');
    assert(ok === false, '拦截器取消事件');
    assert(called === false, '拦截后监听器未执行');
  }

  // 测试6: 异步触发等待
  {
    const bus = new EventBus<{ a: [] }>();
    let done: boolean = false;
    bus.on('a', async () => {
      await new Promise((r) => setTimeout(r, 30));
      done = true;
    });
    await bus.emit('a');
    assert((done as boolean) === true, '异步 emit 等待监听器完成');
  }

  // 测试7: 中间件取消
  {
    const bus = new EventBus<{ a: [] }>();
    let called = false;
    bus.on('a', () => (called = true));
    bus.use((ctx) => {
      ctx.cancelled = true;
    });
    await bus.emit('a');
    assert(called === false, '中间件取消事件');
  }

  // 测试8: off 取消订阅
  {
    const bus = new EventBus<{ a: [] }>();
    let count = 0;
    const fn = (): void => {
      count++;
    };
    bus.on('a', fn);
    bus.emitSync('a');
    bus.off('a', fn);
    bus.emitSync('a');
    assert(count === 1, 'off 取消订阅生效');
  }

  // 测试9: 历史回放
  {
    const bus = new EventBus<{ a: [number] }>();
    let sum = 0;
    bus.on('a', (n) => (sum += n));
    bus.emitSync('a', 1);
    bus.emitSync('a', 2);
    sum = 0;
    bus.replay('a');
    assert(sum === 3, '历史回放重新执行监听器');
  }

  console.log(`\n测试结果: ${passed} 通过, ${failed} 失败\n`);
}

async function runBench(): Promise<void> {
  console.log('===== 事件总线性能测试 =====\n');
  const bus = new EventBus<{ a: [number] }>();
  let sum = 0;
  bus.on('a', (n) => (sum += n));
  bus.on('a', (n) => (sum += n * 2));
  bus.on('a', (n) => (sum -= n));

  const N = 100000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    bus.emitSync('a', i);
  }
  const elapsed = Date.now() - t0;
  console.log(`同步触发 ${N} 次 (3 个监听器): ${elapsed} ms`);
  console.log(`平均每次: ${(elapsed / N).toFixed(4)} ms`);
  console.log(`吞吐量: ${Math.round((N / elapsed) * 1000)} 次/秒`);
  console.log(`sum = ${sum}\n`);

  // 异步性能
  const bus2 = new EventBus<{ a: [number] }>();
  bus2.on('a', (n) => n);
  const M = 5000;
  const t1 = Date.now();
  for (let i = 0; i < M; i++) {
    await bus2.emit('a', i);
  }
  const elapsed2 = Date.now() - t1;
  console.log(`异步触发 ${M} 次 (1 个监听器): ${elapsed2} ms`);
  console.log(`吞吐量: ${Math.round((M / elapsed2) * 1000)} 次/秒\n`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'demo':
      await demoInteractive();
      break;
    case 'test':
      await runTests();
      break;
    case 'bench':
      await runBench();
      break;
    default:
      console.log(`
简单事件总线 - 命令行演示

用法:
  demo    交互式演示（多订阅者、中间件、拦截、历史回放）
  test    运行测试套件
  bench   性能测试

示例:
  node dist/index.js demo
  node dist/index.js test
  node dist/index.js bench
`);
  }
}

main();
