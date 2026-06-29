"use strict";
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
exports.isOnceHandlerEntry = isOnceHandlerEntry;
const types_1 = require("./types");
/** 判断条目是否为 once (类型守卫) */
function isOnceEntry(entry) {
    return entry.kind === 'once';
}
/**
 * 发布/订阅事件总线
 * - 用于插件间松耦合通信
 * - 支持 on / once / off / emit
 */
class EventBus {
    constructor() {
        /** 持久处理器: event -> handlers */
        this.handlers = new Map();
        /** 一次性处理器: event -> handlers */
        this.onceHandlers = new Map();
        /** 事件触发计数 */
        this.emitCounts = new Map();
        /** 已触发的事件总数 (getter 用) */
        this._totalEmits = 0;
        /** Symbol 标记的版本号属性 */
        this[_a] = 1;
    }
    /* ---------------------------- Getters ---------------------------- */
    /** 已注册的事件名数量 (getter) */
    get eventCount() {
        const all = new Set([...this.handlers.keys(), ...this.onceHandlers.keys()]);
        return all.size;
    }
    /** 总触发次数 (getter) */
    get totalEmits() {
        return this._totalEmits;
    }
    /** 是否为空 (getter) */
    get empty() {
        return this.eventCount === 0;
    }
    /** on 实现 */
    on(eventOrEvents, handler) {
        if (typeof eventOrEvents === 'string') {
            this.addHandler(this.handlers, eventOrEvents, handler);
        }
        else {
            for (const ev of eventOrEvents) {
                this.addHandler(this.handlers, ev, handler);
            }
        }
    }
    /** once 实现 */
    once(eventOrEvents, handler) {
        if (typeof eventOrEvents === 'string') {
            this.addHandler(this.onceHandlers, eventOrEvents, handler);
        }
        else {
            for (const ev of eventOrEvents) {
                this.addHandler(this.onceHandlers, ev, handler);
            }
        }
    }
    /** 取消监听 */
    off(event, handler) {
        this.handlers.get(event)?.delete(handler);
        this.onceHandlers.get(event)?.delete(handler);
    }
    /** 触发事件 */
    emit(event, data) {
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
    removeAllListeners(event) {
        if (event) {
            this.handlers.delete(event);
            this.onceHandlers.delete(event);
            this.emitCounts.delete(event);
        }
        else {
            this.handlers.clear();
            this.onceHandlers.clear();
            this.emitCounts.clear();
        }
    }
    /** 获取所有事件的总监听器数量 (重载) */
    listenerCount(event) {
        if (event === undefined) {
            let total = 0;
            for (const ev of this.allEventNames()) {
                total += this.listenerCount(ev);
            }
            return total;
        }
        return ((this.handlers.get(event)?.size ?? 0) + (this.onceHandlers.get(event)?.size ?? 0));
    }
    /** 获取某事件被触发的次数 */
    emitCount(event) {
        return this.emitCounts.get(event) ?? 0;
    }
    /* ---------------------------- 生成器 / 迭代器 ---------------------------- */
    /** 生成器: 迭代所有事件名 (去重) */
    *allEventNames() {
        const seen = new Set();
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
    *entries(event) {
        const persistent = this.handlers.get(event);
        if (persistent) {
            for (const h of persistent) {
                yield { kind: 'persistent', handler: h };
            }
        }
        const once = this.onceHandlers.get(event);
        if (once) {
            for (const h of once) {
                yield { kind: 'once', handler: h };
            }
        }
    }
    /** 生成器: 迭代所有事件名及其监听器数量 (元组) */
    *eventStats() {
        for (const name of this.allEventNames()) {
            yield [name, this.listenerCount(name)];
        }
    }
    /** 实现 Iterable 协议: 迭代所有事件名 */
    *[(_a = types_1.EVENT_BUS_VERSION, Symbol.iterator)]() {
        yield* this.allEventNames();
    }
    /* ---------------------------- 私有工具 ---------------------------- */
    /** 向指定 map 添加处理器 */
    addHandler(store, event, handler) {
        let set = store.get(event);
        if (!set) {
            set = new Set();
            store.set(event, set);
        }
        set.add(handler);
    }
    /** 安全调用处理器 (捕获异常) */
    invoke(handler, event, data) {
        try {
            handler(data);
        }
        catch (err) {
            console.error(`[EventBus] 事件 "${event}" 处理器执行出错:`, err);
        }
    }
    /** 复制集合后迭代 (允许处理器中 off / on 自身) */
    *safeIterate(set) {
        for (const handler of Array.from(set)) {
            yield handler;
        }
    }
}
exports.EventBus = EventBus;
/** 模块级类型守卫导出: 判断条目是否为 once (使用判别联合) */
function isOnceHandlerEntry(entry) {
    return isOnceEntry(entry);
}
//# sourceMappingURL=event-bus.js.map