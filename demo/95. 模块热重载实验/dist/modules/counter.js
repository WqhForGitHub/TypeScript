"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.increment = increment;
exports.decrement = decrement;
exports.getCount = getCount;
exports.reset = reset;
// 从上次重载的状态恢复，或初始化为 0
let count = __hmr_data__?.count ?? 0;
// 注册状态保存回调：重载前保存当前计数
__hmr_dispose__((data) => {
    data.count = count;
});
// 注册更新接受回调：重载后打印通知
__hmr_accept__(() => {
    console.log('[Counter] 模块已热重载，当前计数:', count);
});
/** 增加计数并返回新值 */
function increment() {
    count++;
    return count;
}
/** 减少计数并返回新值 */
function decrement() {
    count--;
    return count;
}
/** 获取当前计数 */
function getCount() {
    return count;
}
/** 重置计数 */
function reset() {
    count = 0;
    return count;
}
//# sourceMappingURL=counter.js.map