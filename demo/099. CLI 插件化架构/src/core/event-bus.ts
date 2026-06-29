/* ============================== 事件总线 ============================== */
/*
 * 演示:
 *   - 泛型与约束 (generics with constraints)
 *   - 函数重载 (function overloads)
 *   - 生成器 / 迭代器 (generators / iterators)
 *   - Getter / Setter
 *   - Symbol 作为属性键
 *   - 判别联合 + 类型守卫
 */

import { EventHandler, EVENT_BUS_VERSION } from "./types";

/** 事件处理器条目 (判别联合) */
type HandlerEntry =
  | { readonly kind: "persistent"; readonly handler: EventHandler }
  | { readonly kind: "once"; readonly handler: EventHandler };

/** 判断条目是否为 once (类型守卫) */
function isOnceEntry(
  entry: HandlerEntry,
): entry is Extract<HandlerEntry, { readonly kind: "once" }> {
  return entry.kind === "once";
}

/**
 * 发布/订阅事件总线
 * - 用于插件间松耦合通信
 * - 支持 on / once / off / emit
 */
export class EventBus {
  /** 持久处理器: event -> handlers */
  private readonly handlers: Map<string, Set<EventHandler>> = new Map();
  /** 一次性处理器: event -> handlers */
  private readonly onceHandlers: Map<string, Set<EventHandler>> = new Map();
  /** 事件触发计数 */
  private emitCounts: Map<string, number> = new Map();
  /** 已触发的事件总数 (getter 用) */
  private _totalEmits = 0;

  /** Symbol 标记的版本号属性 */
  public readonly [EVENT_BUS_VERSION]: number = 1;

  /* ---------------------------- Getters ---------------------------- */

  /** 已注册的事件名数量 (getter) */
  public get eventCount(): number {
    const all = new Set<string>([
      ...this.handlers.keys(),
      ...this.onceHandlers.keys(),
    ]);
    return all.size;
  }

  /** 总触发次数 (getter) */
  public get totalEmits(): number {
    return this._totalEmits;
  }

  /** 是否为空 (getter) */
  public get empty(): boolean {
    return this.eventCount === 0;
  }

  /* ---------------------------- 函数重载: on ---------------------------- */

  /** 监听单个事件 */
  public on(event: string, handler: EventHandler): void;
  /** 监听多个事件 (重载) */
  public on(events: readonly string[], handler: EventHandler): void;
  /** on 实现 */
  public on(
    eventOrEvents: string | readonly string[],
    handler: EventHandler,
  ): void {
    if (typeof eventOrEvents === "string") {
      this.addHandler(this.handlers, eventOrEvents, handler);
    } else {
      for (const ev of eventOrEvents) {
        this.addHandler(this.handlers, ev, handler);
      }
    }
  }

  /* ---------------------------- 函数重载: once ---------------------------- */

  /** 仅监听一次: 单个事件 */
  public once(event: string, handler: EventHandler): void;
  /** 仅监听一次: 多个事件 (重载) */
  public once(events: readonly string[], handler: EventHandler): void;
  /** once 实现 */
  public once(
    eventOrEvents: string | readonly string[],
    handler: EventHandler,
  ): void {
    if (typeof eventOrEvents === "string") {
      this.addHandler(this.onceHandlers, eventOrEvents, handler);
    } else {
      for (const ev of eventOrEvents) {
        this.addHandler(this.onceHandlers, ev, handler);
      }
    }
  }

  /** 取消监听 */
  public off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
    this.onceHandlers.get(event)?.delete(handler);
  }

  /** 触发事件 */
  public emit(event: string, data?: unknown): void {
    this._totalEmits += 1;
    this.emitCounts.set(event, (this.emitCounts.get(event) ?? 0) + 1);

    // 持久处理器
    const handlerSet = this.handlers.get(event);
    if (handlerSet) {
      for (const handler of this.safeIterate(handlerSet)) {
        this.invoke(handler, event, data);
      }
    }

    // 一次性处理器 (触发后清空)
    const onceSet = this.onceHandlers.get(event);
    if (onceSet) {
      for (const handler of this.safeIterate(onceSet)) {
        this.invoke(handler, event, data);
      }
      this.onceHandlers.delete(event);
    }
  }

  /** 移除某事件的所有监听器 (或全部) */
  public removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      this.onceHandlers.delete(event);
      this.emitCounts.delete(event);
    } else {
      this.handlers.clear();
      this.onceHandlers.clear();
      this.emitCounts.clear();
    }
  }

  /* ---------------------------- 函数重载: listenerCount ---------------------------- */

  /** 获取某事件的监听器数量 */
  public listenerCount(event: string): number;
  /** 获取所有事件的总监听器数量 (重载) */
  public listenerCount(event?: string): number {
    if (event === undefined) {
      let total = 0;
      for (const ev of this.allEventNames()) {
        total += this.listenerCount(ev);
      }
      return total;
    }
    return (
      (this.handlers.get(event)?.size ?? 0) +
      (this.onceHandlers.get(event)?.size ?? 0)
    );
  }

  /** 获取某事件被触发的次数 */
  public emitCount(event: string): number {
    return this.emitCounts.get(event) ?? 0;
  }

  /* ---------------------------- 生成器 / 迭代器 ---------------------------- */

  /** 生成器: 迭代所有事件名 (去重) */
  public *allEventNames(): Generator<string> {
    const seen = new Set<string>();
    for (const name of this.handlers.keys()) {
      if (!seen.has(name)) {
        seen.add(name);
        yield name;
      }
    }
    for (const name of this.onceHandlers.keys()) {
      if (!seen.has(name)) {
        seen.add(name);
        yield name;
      }
    }
  }

  /** 生成器: 迭代某事件的所有处理器条目 (判别联合) */
  public *entries(event: string): Generator<HandlerEntry> {
    const persistent = this.handlers.get(event);
    if (persistent) {
      for (const h of persistent) {
        yield { kind: "persistent" as const, handler: h };
      }
    }
    const once = this.onceHandlers.get(event);
    if (once) {
      for (const h of once) {
        yield { kind: "once" as const, handler: h };
      }
    }
  }

  /** 生成器: 迭代所有事件名及其监听器数量 (元组) */
  public *eventStats(): Generator<readonly [eventName: string, count: number]> {
    for (const name of this.allEventNames()) {
      yield [name, this.listenerCount(name)] as const;
    }
  }

  /** 实现 Iterable 协议: 迭代所有事件名 */
  public *[Symbol.iterator](): Generator<string> {
    yield* this.allEventNames();
  }

  /* ---------------------------- 私有工具 ---------------------------- */

  /** 向指定 map 添加处理器 */
  private addHandler(
    store: Map<string, Set<EventHandler>>,
    event: string,
    handler: EventHandler,
  ): void {
    let set = store.get(event);
    if (!set) {
      set = new Set<EventHandler>();
      store.set(event, set);
    }
    set.add(handler);
  }

  /** 安全调用处理器 (捕获异常) */
  private invoke(handler: EventHandler, event: string, data: unknown): void {
    try {
      handler(data);
    } catch (err) {
      console.error(`[EventBus] 事件 "${event}" 处理器执行出错:`, err);
    }
  }

  /** 复制集合后迭代 (允许处理器中 off / on 自身) */
  private *safeIterate(set: Set<EventHandler>): Generator<EventHandler> {
    for (const handler of Array.from(set)) {
      yield handler;
    }
  }
}

/** 模块级类型守卫导出: 判断条目是否为 once (使用判别联合) */
export function isOnceHandlerEntry(entry: HandlerEntry): boolean {
  return isOnceEntry(entry);
}
