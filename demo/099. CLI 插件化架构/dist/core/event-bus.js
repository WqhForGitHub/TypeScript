"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
/* ============================== 事件总线 ============================== */
/**
 * 发布/订阅事件总线
 * - 用于插件间松耦合通信
 * - 支持 on / off / emit / once 四种操作
 */
class EventBus {
    constructor() {
        this.handlers = new Map();
        this.onceHandlers = new Map();
    }
    /** 监听事件 */
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
    }
    /** 取消监听 */
    off(event, handler) {
        this.handlers.get(event)?.delete(handler);
        this.onceHandlers.get(event)?.delete(handler);
    }
    /** 触发事件 */
    emit(event, data) {
        const handlers = this.handlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                }
                catch (err) {
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
                }
                catch (err) {
                    console.error(`[EventBus] 事件 "${event}" 一次性处理器执行出错:`, err);
                }
            }
            this.onceHandlers.delete(event);
        }
    }
    /** 仅监听一次 */
    once(event, handler) {
        if (!this.onceHandlers.has(event)) {
            this.onceHandlers.set(event, new Set());
        }
        this.onceHandlers.get(event).add(handler);
    }
    /** 移除某事件的所有监听器 */
    removeAllListeners(event) {
        if (event) {
            this.handlers.delete(event);
            this.onceHandlers.delete(event);
        }
        else {
            this.handlers.clear();
            this.onceHandlers.clear();
        }
    }
    /** 获取某事件的监听器数量 */
    listenerCount(event) {
        return (this.handlers.get(event)?.size ?? 0) + (this.onceHandlers.get(event)?.size ?? 0);
    }
}
exports.EventBus = EventBus;
//# sourceMappingURL=event-bus.js.map