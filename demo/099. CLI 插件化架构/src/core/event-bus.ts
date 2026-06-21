import { EventHandler } from './types';

/* ============================== 事件总线 ============================== */

/**
 * 发布/订阅事件总线
 * - 用于插件间松耦合通信
 * - 支持 on / off / emit / once 四种操作
 */
export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private onceHandlers: Map<string, Set<EventHandler>> = new Map();

  /** 监听事件 */
  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /** 取消监听 */
  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
    this.onceHandlers.get(event)?.delete(handler);
  }

  /** 触发事件 */
  emit(event: string, data?: unknown): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[EventBus] 事件 "${event}" 处理器执行出错:`, err);
        }
      }
    }

    // 处理 once 注册的处理器
    const onceSet = this.onceHandlers.get(event);
    if (onceSet) {
      for (const handler of onceSet) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[EventBus] 事件 "${event}" 一次性处理器执行出错:`, err);
        }
      }
      this.onceHandlers.delete(event);
    }
  }

  /** 仅监听一次 */
  once(event: string, handler: EventHandler): void {
    if (!this.onceHandlers.has(event)) {
      this.onceHandlers.set(event, new Set());
    }
    this.onceHandlers.get(event)!.add(handler);
  }

  /** 移除某事件的所有监听器 */
  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      this.onceHandlers.delete(event);
    } else {
      this.handlers.clear();
      this.onceHandlers.clear();
    }
  }

  /** 获取某事件的监听器数量 */
  listenerCount(event: string): number {
    return (this.handlers.get(event)?.size ?? 0) + (this.onceHandlers.get(event)?.size ?? 0);
  }
}
