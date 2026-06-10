/**
 * 计数器模块 - 有状态模块的热重载示例
 *
 * 此模块演示有状态的模块如何支持热重载：
 *
 *   __hmr_data__   - 读取上一次重载保存的状态
 *   __hmr_dispose__ - 在重载前保存当前状态
 *   __hmr_accept__  - 在重载后接收通知
 *
 * 尝试修改 increment() 的步长，保存后观察效果！
 * 计数值会通过 __hmr_data__ 跨重载保留。
 */

// HMR 运行时注入的全局变量（由 vm.Script 沙箱提供）
declare const __hmr_data__: Record<string, any>;
declare const __hmr_dispose__: (
    cb: (data: Record<string, any>) => void,
) => void;
declare const __hmr_accept__: (cb?: () => void) => void;

// 从上次重载的状态恢复，或初始化为 0
let count = __hmr_data__?.count ?? 0;

// 注册状态保存回调：重载前保存当前计数
__hmr_dispose__((data) => {
    data.count = count;
});

// 注册更新接受回调：重载后打印通知
__hmr_accept__(() => {
    console.log("[Counter] 模块已热重载，当前计数:", count);
});

/** 增加计数并返回新值 */
export function increment(): number {
    count++;
    return count;
}

/** 减少计数并返回新值 */
export function decrement(): number {
    count--;
    return count;
}

/** 获取当前计数 */
export function getCount(): number {
    return count;
}

/** 重置计数 */
export function reset(): number {
    count = 0;
    return count;
}
