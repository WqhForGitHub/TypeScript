#!/usr/bin/env node
/**
 * 简单事件总线 (Simple Event Bus) - Enhanced TypeScript Edition
 * -------------------------------------------------------------
 * 基于 Node.js EventEmitter 的事件总线，支持 on/off/once/emit(sync+async)、
 * 通配符订阅、命名空间、优先级监听、异步监听、拦截/取消、中间件、历史回放。
 * 仅依赖 Node.js 内置模块: events, util.
 */
import { EventEmitter } from "events";
import { inspect } from "util";

// ===================== String Enums =====================
export enum ErrorCode {
  ListenerNotFound = "LISTENER_NOT_FOUND",
  EventCancelled = "EVENT_CANCELLED",
  MiddlewareError = "MIDDLEWARE_ERROR",
  InvalidEvent = "INVALID_EVENT",
  MaxListenersExceeded = "MAX_LISTENERS_EXCEEDED",
}
export enum ListenerState {
  Active = "ACTIVE",
  Removed = "REMOVED",
  Paused = "PAUSED",
}
export enum EmitPhase {
  Before = "BEFORE",
  During = "DURING",
  After = "AFTER",
}
export enum Priority {
  Low = 1,
  Normal = 5,
  High = 10,
  Critical = 100,
}

// ===================== Symbols (unique property keys) =====================
export const LISTENER_ID: unique symbol = Symbol("LISTENER_ID");
export const BUS_VERSION: unique symbol = Symbol("BUS_VERSION");
const INTERNAL: unique symbol = Symbol("INTERNAL");

// ===================== Mapped & Template Literal Types =====================
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type NormalizeArgs<T> = T extends unknown[] ? T : [T];
export type NamespacedEvent<N extends string, E extends string> = `${N}.${E}`;
export type WildcardEvent<N extends string> = `${N}.*`;
export type DeepWildcard<N extends string> = `${N}.#`;
export type EventPattern = string;

// ===================== Interfaces =====================
export interface ListenerMeta {
  readonly [key: string]: unknown;
  readonly createdAt: number;
  readonly tag?: string;
}
export interface ListenerEntry {
  readonly event: string;
  readonly listener: (...args: unknown[]) => unknown | Promise<unknown>;
  readonly priority: number;
  readonly once: boolean;
  state: ListenerState;
  readonly [LISTENER_ID]: number;
  readonly meta?: ListenerMeta;
}
export interface ListenerOptions {
  readonly priority?: number;
  readonly once?: boolean;
  readonly tag?: string;
}
export interface EventRecord {
  readonly event: string;
  readonly args: readonly unknown[];
  readonly timestamp: number;
  readonly phase: EmitPhase;
}
export interface BusOptions {
  readonly maxHistory?: number;
  readonly debug?: boolean;
  readonly maxListeners?: number;
  readonly logger?: DebugLogger;
}
export interface MiddlewareContext<E extends Record<string, unknown>> {
  event: keyof E & string;
  args: unknown[];
  cancelled: boolean;
  phase: EmitPhase;
}
export type Interceptor = (event: string, args: unknown[]) => boolean;
export type DebugLogger = (
  level: "log" | "warn" | "error",
  msg: string,
) => void;

// ===================== Discriminated Unions =====================
export interface EmitSuccess {
  readonly ok: true;
  readonly event: string;
  readonly phase: EmitPhase;
  readonly executed: number;
  readonly timestamp: number;
}
export interface EmitError {
  readonly ok: false;
  readonly event: string;
  readonly error: EventError;
  readonly timestamp: number;
}
export interface EmitCancelled {
  readonly ok: false;
  readonly cancelled: true;
  readonly event: string;
  readonly reason: string;
  readonly timestamp: number;
}
export type EmitResult = EmitSuccess | EmitError | EmitCancelled;

// ===================== Type Guards =====================
export function isEmitSuccess(r: EmitResult): r is EmitSuccess {
  return r.ok === true;
}
export function isEmitError(r: EmitResult): r is EmitError {
  return r.ok === false && "error" in r;
}
export function isEmitCancelled(r: EmitResult): r is EmitCancelled {
  return r.ok === false && "cancelled" in r;
}
export function isEventError(err: unknown): err is EventError {
  return err instanceof EventError;
}
export function isListenerEntry(v: unknown): v is ListenerEntry {
  return typeof v === "object" && v !== null && LISTENER_ID in v;
}

// ===================== as const assertions =====================
export const DEFAULT_BUS_OPTIONS = {
  maxHistory: 100,
  debug: false,
  maxListeners: 0,
} as const;
export const PHASE_ORDER = [
  EmitPhase.Before,
  EmitPhase.During,
  EmitPhase.After,
] as const;

// ===================== Custom Error Hierarchy =====================
export class EventError extends Error {
  readonly code: ErrorCode;
  readonly event?: string;
  constructor(code: ErrorCode, message: string, event?: string) {
    super(message);
    this.name = "EventError";
    this.code = code;
    this.event = event;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export class ListenerError extends EventError {
  constructor(code: ErrorCode, message: string, event?: string) {
    super(code, message, event);
    this.name = "ListenerError";
  }
}
export class MiddlewareError extends EventError {
  readonly cause?: Error;
  constructor(code: ErrorCode, message: string, event?: string, cause?: Error) {
    super(code, message, event);
    this.name = "MiddlewareError";
    this.cause = cause;
  }
}

// ===================== Abstract Middleware + concrete subclasses =====================
export abstract class AbstractMiddleware<E extends Record<string, unknown>> {
  abstract readonly name: string;
  abstract readonly phase: EmitPhase;
  abstract process(ctx: MiddlewareContext<E>): void | Promise<void>;
  protected beforeProcess(_ctx: MiddlewareContext<E>): void {
    /* hook */
  }
}
export class LoggingMiddleware<
  E extends Record<string, unknown>,
> extends AbstractMiddleware<E> {
  readonly name = "LoggingMiddleware";
  readonly phase = EmitPhase.Before;
  constructor(
    private readonly logger: DebugLogger = (lvl, m) => console[lvl](m),
  ) {
    super();
  }
  async process(ctx: MiddlewareContext<E>): Promise<void> {
    this.beforeProcess(ctx);
    this.logger(
      "log",
      `[MW:${this.name}] ${ctx.event} args=${inspect(ctx.args)}`,
    );
  }
}
export class CancelMiddleware<
  E extends Record<string, unknown>,
> extends AbstractMiddleware<E> {
  readonly name = "CancelMiddleware";
  readonly phase = EmitPhase.Before;
  constructor(private readonly matcher: (event: string) => boolean) {
    super();
  }
  async process(ctx: MiddlewareContext<E>): Promise<void> {
    if (this.matcher(ctx.event)) ctx.cancelled = true;
  }
}

// ===================== EventBus (generic class with constraints) =====================
export class EventBus<
  E extends Record<string, unknown> = Record<string, unknown[]>,
> {
  private readonly emitter = new EventEmitter();
  private readonly listeners: Map<string, ListenerEntry[]> = new Map();
  private readonly middlewares: AbstractMiddleware<E>[] = [];
  private readonly interceptors: Map<string, Interceptor[]> = new Map();
  private _history: EventRecord[] = [];
  private _maxHistory: number;
  private _debug: boolean;
  private readonly logger: DebugLogger;
  private nextId = 1;
  private _paused = false;
  public readonly [BUS_VERSION] = "2.0.0";
  private readonly [INTERNAL]: true = true;

  constructor(options: BusOptions = {}) {
    const opts = { ...DEFAULT_BUS_OPTIONS, ...options };
    this._maxHistory = opts.maxHistory;
    this._debug = opts.debug;
    this.logger =
      opts.logger ?? ((level, msg) => console[level](`[EventBus] ${msg}`));
    this.emitter.setMaxListeners(opts.maxListeners);
  }

  // ---------- Getters / Setters ----------
  get history(): readonly EventRecord[] {
    return this._history;
  }
  get maxHistory(): number {
    return this._maxHistory;
  }
  set maxHistory(value: number) {
    if (value < 0)
      throw new EventError(ErrorCode.InvalidEvent, "maxHistory must be >= 0");
    this._maxHistory = value;
    this.trimHistory();
  }
  get debug(): boolean {
    return this._debug;
  }
  set debug(value: boolean) {
    this._debug = value;
  }
  get paused(): boolean {
    return this._paused;
  }
  get listenerMap(): ReadonlyMap<string, readonly ListenerEntry[]> {
    return this.listeners;
  }
  get version(): string {
    return this[BUS_VERSION];
  }
  pause(): void {
    this._paused = true;
  }
  resume(): void {
    this._paused = false;
  }

  // ---------- Function overloads: on ----------
  on<K extends keyof E & string>(
    event: K,
    listener: (...args: NormalizeArgs<E[K]>) => unknown | Promise<unknown>,
    opts?: ListenerOptions,
  ): () => void;
  on(
    event: EventPattern,
    listener: (...args: unknown[]) => unknown | Promise<unknown>,
    opts?: ListenerOptions,
  ): () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- impl signature must be bivalent to accept typed overload listeners
  on(
    event: string,
    listener: (...args: any[]) => unknown | Promise<unknown>,
    opts?: ListenerOptions,
  ): () => void {
    const priority = opts?.priority ?? Priority.Normal;
    return this.addListener(
      event,
      listener,
      priority,
      opts?.once ?? false,
      opts?.tag,
    );
  }

  once<K extends keyof E & string>(
    event: K,
    listener: (...args: NormalizeArgs<E[K]>) => unknown | Promise<unknown>,
    opts?: ListenerOptions,
  ): () => void {
    return this.addListener(
      event,
      listener as (...args: unknown[]) => unknown | Promise<unknown>,
      opts?.priority ?? Priority.Normal,
      true,
      opts?.tag,
    );
  }

  off<K extends keyof E & string>(
    event: K,
    listener?: (...args: unknown[]) => unknown | Promise<unknown>,
  ): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    if (!listener) {
      for (const e of arr) e.state = ListenerState.Removed;
      this.listeners.delete(event);
    } else {
      const next = arr.filter((e) => {
        if (e.listener === listener) {
          e.state = ListenerState.Removed;
          return false;
        }
        return true;
      });
      if (next.length === 0) this.listeners.delete(event);
      else this.listeners.set(event, next);
    }
  }

  emitSync<K extends keyof E & string>(
    event: K,
    ...args: NormalizeArgs<E[K]>
  ): boolean {
    return this.emitSyncResult(event, args).ok;
  }

  private emitSyncResult(event: string, args: unknown[]): EmitResult {
    if (this._paused)
      return {
        ok: false,
        cancelled: true,
        event,
        reason: "paused",
        timestamp: Date.now(),
      };
    if (this._debug) this.logger("log", `sync emit: ${event}`);
    if (!this.runInterceptor(event, args)) {
      if (this._debug) this.logger("warn", `intercepted: ${event}`);
      return {
        ok: false,
        cancelled: true,
        event,
        reason: "interceptor",
        timestamp: Date.now(),
      };
    }
    this.recordHistory(event, args, EmitPhase.During);
    const entries = this.collectListeners(event);
    if (entries.length === 0)
      return {
        ok: true,
        event,
        phase: EmitPhase.During,
        executed: 0,
        timestamp: Date.now(),
      };
    let hadError = false;
    let executed = 0;
    for (const entry of entries) {
      if (entry.state !== ListenerState.Active) continue;
      try {
        const ret = entry.listener(...args);
        executed++;
        if (ret instanceof Promise)
          ret.catch((e) =>
            this.logger(
              "error",
              `async listener error: ${(e as Error).message}`,
            ),
          );
      } catch (err) {
        hadError = true;
        this.logger(
          "error",
          `listener error [${event}]: ${(err as Error).message}`,
        );
      }
      if (entry.once) this.removeListenerEntry(event, entry);
    }
    if (hadError)
      return {
        ok: false,
        event,
        error: new ListenerError(
          ErrorCode.ListenerNotFound,
          `error in listeners for ${event}`,
          event,
        ),
        timestamp: Date.now(),
      };
    return {
      ok: true,
      event,
      phase: EmitPhase.During,
      executed,
      timestamp: Date.now(),
    };
  }

  async emit<K extends keyof E & string>(
    event: K,
    ...args: NormalizeArgs<E[K]>
  ): Promise<boolean> {
    return (await this.emitAsyncResult(event, args)).ok;
  }
  emitDetailed<K extends keyof E & string>(
    event: K,
    ...args: NormalizeArgs<E[K]>
  ): Promise<EmitResult> {
    return this.emitAsyncResult(event, args);
  }

  private async emitAsyncResult(
    event: string,
    args: unknown[],
  ): Promise<EmitResult> {
    if (this._paused)
      return {
        ok: false,
        cancelled: true,
        event,
        reason: "paused",
        timestamp: Date.now(),
      };
    if (this._debug) this.logger("log", `async emit: ${event}`);
    if (!this.runInterceptor(event, args)) {
      if (this._debug) this.logger("warn", `intercepted: ${event}`);
      return {
        ok: false,
        cancelled: true,
        event,
        reason: "interceptor",
        timestamp: Date.now(),
      };
    }
    const ctx: MiddlewareContext<E> = {
      event: event as keyof E & string,
      args: [...args],
      cancelled: false,
      phase: EmitPhase.Before,
    };
    for (const mw of this.middlewares) {
      try {
        ctx.phase = mw.phase;
        await mw.process(ctx);
      } catch (err) {
        return {
          ok: false,
          event,
          error: new MiddlewareError(
            ErrorCode.MiddlewareError,
            `middleware error: ${(err as Error).message}`,
            event,
            err as Error,
          ),
          timestamp: Date.now(),
        };
      }
      if (ctx.cancelled) {
        if (this._debug)
          this.logger("warn", `cancelled by middleware: ${event}`);
        return {
          ok: false,
          cancelled: true,
          event,
          reason: "middleware",
          timestamp: Date.now(),
        };
      }
    }
    ctx.phase = EmitPhase.During;
    this.recordHistory(event, args, EmitPhase.During);
    const entries = this.collectListeners(event);
    if (entries.length === 0)
      return {
        ok: true,
        event,
        phase: EmitPhase.During,
        executed: 0,
        timestamp: Date.now(),
      };
    let hadError = false;
    let executed = 0;
    const promises: Promise<void>[] = [];
    for (const entry of entries) {
      if (entry.state !== ListenerState.Active) continue;
      promises.push(
        (async (): Promise<void> => {
          try {
            await entry.listener(...args);
            executed++;
          } catch (err) {
            hadError = true;
            this.logger(
              "error",
              `listener error [${event}]: ${(err as Error).message}`,
            );
          } finally {
            if (entry.once) this.removeListenerEntry(event, entry);
          }
        })(),
      );
    }
    await Promise.all(promises);
    if (hadError)
      return {
        ok: false,
        event,
        error: new ListenerError(
          ErrorCode.ListenerNotFound,
          `error in listeners for ${event}`,
          event,
        ),
        timestamp: Date.now(),
      };
    return {
      ok: true,
      event,
      phase: EmitPhase.During,
      executed,
      timestamp: Date.now(),
    };
  }

  use<M extends AbstractMiddleware<E>>(mw: M): this {
    this.middlewares.push(mw);
    return this;
  }

  intercept(event: string, fn: Interceptor): () => void {
    if (!this.interceptors.has(event)) this.interceptors.set(event, []);
    this.interceptors.get(event)!.push(fn);
    return () => {
      const arr = this.interceptors.get(event);
      if (!arr) return;
      const next = arr.filter((x) => x !== fn);
      if (next.length === 0) this.interceptors.delete(event);
      else this.interceptors.set(event, next);
    };
  }

  // ---------- Function overloads: listenerCount ----------
  listenerCount(): number;
  listenerCount(event: string): number;
  listenerCount(event?: string): number {
    if (event) return this.collectListeners(event).length;
    let total = 0;
    for (const arr of this.listeners.values()) total += arr.length;
    return total;
  }

  clear(): void {
    for (const arr of this.listeners.values())
      for (const e of arr) e.state = ListenerState.Removed;
    this.listeners.clear();
    this.interceptors.clear();
    this.middlewares.length = 0;
    this._history = [];
  }

  replay(filter?: string): EventRecord[] {
    const records = filter
      ? this._history.filter((r) => this.matchPattern(r.event, filter))
      : [...this._history];
    for (const r of records) {
      const entries = this.collectListeners(r.event);
      for (const entry of entries) {
        try {
          entry.listener(...r.args);
        } catch (err) {
          this.logger("error", `replay error: ${(err as Error).message}`);
        }
      }
    }
    return records;
  }

  // ---------- Generators / Iterators ----------
  *listenersFor(event: string): Generator<ListenerEntry> {
    for (const e of this.collectListeners(event))
      if (e.state === ListenerState.Active) yield e;
  }
  *allListeners(): Generator<ListenerEntry> {
    for (const arr of this.listeners.values())
      for (const e of arr) if (e.state === ListenerState.Active) yield e;
  }
  *[Symbol.iterator](): Generator<[string, readonly ListenerEntry[]]> {
    for (const [k, v] of this.listeners.entries()) yield [k, v];
  }

  // ---------- satisfies operator ----------
  get config(): BusOptions {
    return {
      maxHistory: this._maxHistory,
      debug: this._debug,
      maxListeners: this.emitter.getMaxListeners(),
      logger: this.logger,
    } satisfies BusOptions;
  }

  hasListener(
    event: string,
    listener?: (...args: unknown[]) => unknown,
  ): boolean {
    const arr = this.listeners.get(event);
    if (!arr) return false;
    if (!listener) return arr.some((e) => e.state === ListenerState.Active);
    return arr.some(
      (e) => e.listener === listener && e.state === ListenerState.Active,
    );
  }

  // ---------- Internal ----------
  private addListener(
    event: string,
    listener: (...args: unknown[]) => unknown | Promise<unknown>,
    priority: number,
    once: boolean,
    tag?: string,
  ): () => void {
    const entry: ListenerEntry = {
      event,
      listener,
      priority,
      once,
      state: ListenerState.Active,
      [LISTENER_ID]: this.nextId++,
      meta: { createdAt: Date.now(), tag },
    };
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(entry);
    this.listeners.get(event)!.sort((a, b) => b.priority - a.priority);
    return () => this.removeListenerEntry(event, entry);
  }

  private removeListenerEntry(event: string, entry: ListenerEntry): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) {
      arr[idx].state = ListenerState.Removed;
      arr.splice(idx, 1);
    }
    if (arr.length === 0) this.listeners.delete(event);
  }

  private collectListeners(event: string): ListenerEntry[] {
    const result: ListenerEntry[] = [];
    for (const [pattern, entries] of this.listeners.entries()) {
      if (this.matchPattern(event, pattern))
        for (const e of entries)
          if (e.state === ListenerState.Active) result.push(e);
    }
    result.sort((a, b) => b.priority - a.priority);
    return result;
  }

  /** 通配符匹配："*" 单层任意，"#" 多层任意 */
  private matchPattern(event: string, pattern: string): boolean {
    if (pattern === "*" || pattern === event) return true;
    if (!pattern.includes("*") && !pattern.includes("#"))
      return pattern === event;
    const evParts = event.split(".");
    const paParts = pattern.split(".");
    let i = 0;
    let j = 0;
    while (i < evParts.length && j < paParts.length) {
      if (paParts[j] === "#") {
        if (j === paParts.length - 1) return true;
        const rest = paParts.slice(j + 1).join(".");
        for (let k = i; k < evParts.length; k++)
          if (this.matchPattern(evParts.slice(k).join("."), rest)) return true;
        return false;
      } else if (paParts[j] === "*" || paParts[j] === evParts[i]) {
        i++;
        j++;
      } else return false;
    }
    return i === evParts.length && j === paParts.length;
  }

  private runInterceptor(event: string, args: unknown[]): boolean {
    const arr = this.interceptors.get(event);
    if (!arr) return true;
    for (const fn of arr) if (fn(event, args) === false) return false;
    return true;
  }

  private recordHistory(
    event: string,
    args: unknown[],
    phase: EmitPhase,
  ): void {
    this._history.push({
      event,
      args: Object.freeze([...args]),
      timestamp: Date.now(),
      phase,
    });
    this.trimHistory();
  }

  private trimHistory(): void {
    while (this._history.length > this._maxHistory) this._history.shift();
  }
}

// ===================== module-level `satisfies` + mapped-type usage =====================
export const DEFAULT_RESULT: EmitResult = {
  ok: true,
  event: "",
  phase: EmitPhase.During,
  executed: 0,
  timestamp: 0,
} satisfies EmitResult;

/** 将只读事件记录转为可变副本 (使用 Mutable 映射类型) */
export function toMutableRecord(r: EventRecord): Mutable<EventRecord> {
  return { ...r, args: [...r.args] };
}

// ===================== CLI 演示 =====================

interface DemoEvents extends Record<string, unknown> {
  "user.login": [string];
  "user.logout": [string];
  "order.created": [number, number];
}

async function demoInteractive(): Promise<void> {
  console.log("===== 事件总线交互式演示 =====\n");
  const bus = new EventBus<DemoEvents>({ debug: true, maxHistory: 50 });
  bus.on("user.login", (name) => console.log(`  [日志] 用户登录: ${name}`), {
    priority: Priority.High,
  });
  bus.on(
    "user.login",
    async (name) => {
      await new Promise((r) => setTimeout(r, 50));
      console.log(`  [异步] 已发送欢迎邮件给 ${name}`);
    },
    { priority: Priority.Normal },
  );
  bus.on("user.*", (name: unknown) =>
    console.log(`  [审计] 用户事件触发: ${String(name)}`),
  );
  bus.use(new LoggingMiddleware<DemoEvents>());
  bus.intercept("user.login", (_e, args) => {
    if (args[0] === "blocked") {
      console.log(`  [拦截] 拒绝 ${args[0]}`);
      return false;
    }
    return true;
  });

  console.log("1) 触发 user.login (Alice):");
  await bus.emit("user.login", "Alice");
  console.log("\n2) 触发 user.login (blocked):");
  console.log(`  emit 返回: ${await bus.emit("user.login", "blocked")}`);
  console.log("\n3) emitDetailed + 类型守卫 (discriminated union):");
  const detail = await bus.emitDetailed("user.login", "Charlie");
  if (isEmitSuccess(detail))
    console.log(
      `  success: executed=${detail.executed}, phase=${detail.phase}`,
    );
  else if (isEmitCancelled(detail))
    console.log(`  cancelled: reason=${detail.reason}`);
  else if (isEmitError(detail))
    console.log(`  error: ${detail.error.message} (code=${detail.error.code})`);
  console.log("\n4) 历史记录:");
  for (const r of bus.history)
    console.log(
      `  ${new Date(r.timestamp).toISOString()} ${r.event} ${JSON.stringify(r.args)}`,
    );
  console.log("\n5) 迭代 (Symbol.iterator + generator):");
  for (const [evt, list] of bus)
    console.log(`  ${evt}: ${list.length} 个监听器`);
  console.log("\n6) listenersFor 生成器:");
  for (const entry of bus.listenersFor("user.login"))
    console.log(
      `  id=${entry[LISTENER_ID]} priority=${entry.priority} once=${entry.once}`,
    );
  console.log(`\n监听器总数: ${bus.listenerCount()}  版本: ${bus.version}`);
  console.log("===== 演示结束 =====\n");
}

async function runTests(): Promise<void> {
  console.log("===== 事件总线测试套件 =====\n");
  let passed = 0,
    failed = 0;
  const assert = (cond: boolean, msg: string): void => {
    cond
      ? (passed++, console.log(`  [PASS] ${msg}`))
      : (failed++, console.log(`  [FAIL] ${msg}`));
  };

  {
    const bus = new EventBus<{ a: [number] }>();
    let got = 0;
    bus.on("a", (n) => (got = n));
    bus.emitSync("a", 42);
    assert(got === 42, "基本订阅与触发");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    let c = 0;
    bus.once("a", () => c++);
    bus.emitSync("a");
    bus.emitSync("a");
    assert(c === 1, "once 只触发一次");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    const o: number[] = [];
    bus.on("a", () => o.push(1), { priority: 1 });
    bus.on("a", () => o.push(2), { priority: 10 });
    bus.on("a", () => o.push(3), { priority: 5 });
    bus.emitSync("a");
    assert(o.join(",") === "2,3,1", "优先级排序正确");
  }
  {
    const bus = new EventBus();
    let m = "";
    bus.on("user.*", (n: unknown) => (m = String(n)));
    bus.emitSync("user.login", "x");
    assert(m === "x", "通配符 user.* 匹配 user.login");
    bus.emitSync("user.logout", "y");
    assert(m === "y", "通配符 user.* 匹配 user.logout");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    let called = false;
    bus.on("a", () => (called = true));
    bus.intercept("a", () => false);
    assert(bus.emitSync("a") === false, "拦截器取消事件");
    assert(called === false, "拦截后监听器未执行");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    const done = { value: false };
    bus.on("a", async () => {
      await new Promise((r) => setTimeout(r, 30));
      done.value = true;
    });
    await bus.emit("a");
    assert(done.value === true, "异步 emit 等待监听器完成");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    let called = false;
    bus.on("a", () => (called = true));
    bus.use(new CancelMiddleware<{ a: [] }>(() => true));
    await bus.emit("a");
    assert(called === false, "中间件取消事件");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    let c = 0;
    const fn = (): void => {
      c++;
    };
    bus.on("a", fn);
    bus.emitSync("a");
    bus.off("a", fn);
    bus.emitSync("a");
    assert(c === 1, "off 取消订阅生效");
  }
  {
    const bus = new EventBus<{ a: [number] }>();
    let sum = 0;
    bus.on("a", (n) => (sum += n));
    bus.emitSync("a", 1);
    bus.emitSync("a", 2);
    sum = 0;
    bus.replay("a");
    assert(sum === 3, "历史回放重新执行监听器");
  }
  {
    const bus = new EventBus<{ a: [] }>();
    bus.on("a", () => undefined);
    const res = await bus.emitDetailed("a");
    assert(
      isEmitSuccess(res) && res.executed === 1,
      "EmitResult 类型守卫 (success)",
    );
  }
  {
    const err = new EventError(ErrorCode.InvalidEvent, "bad");
    assert(
      isEventError(err) && err.code === ErrorCode.InvalidEvent,
      "EventError 与类型守卫",
    );
  }
  {
    const bus = new EventBus<{ a: [] }>();
    bus.maxHistory = 5;
    assert(bus.maxHistory === 5, "maxHistory getter/setter");
    bus.pause();
    assert(bus.paused === true, "pause 标记");
    assert(bus.emitSync("a") === false, "暂停时 emit 失败");
    bus.resume();
  }

  console.log(`\n测试结果: ${passed} 通过, ${failed} 失败\n`);
}

async function runBench(): Promise<void> {
  console.log("===== 事件总线性能测试 =====\n");
  const bus = new EventBus<{ a: [number] }>();
  let sum = 0;
  bus.on("a", (n) => (sum += n));
  bus.on("a", (n) => (sum += n * 2));
  bus.on("a", (n) => (sum -= n));
  const N = 100000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) bus.emitSync("a", i);
  const elapsed = Date.now() - t0;
  console.log(`同步触发 ${N} 次 (3 个监听器): ${elapsed} ms`);
  console.log(`平均每次: ${(elapsed / N).toFixed(4)} ms`);
  console.log(`吞吐量: ${Math.round((N / elapsed) * 1000)} 次/秒`);
  console.log(`sum = ${sum}\n`);
  const bus2 = new EventBus<{ a: [number] }>();
  bus2.on("a", (n) => n);
  const M = 5000;
  const t1 = Date.now();
  for (let i = 0; i < M; i++) await bus2.emit("a", i);
  const elapsed2 = Date.now() - t1;
  console.log(`异步触发 ${M} 次 (1 个监听器): ${elapsed2} ms`);
  console.log(`吞吐量: ${Math.round((M / elapsed2) * 1000)} 次/秒\n`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "demo":
      await demoInteractive();
      break;
    case "test":
      await runTests();
      break;
    case "bench":
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
