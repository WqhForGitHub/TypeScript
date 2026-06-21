/**
 * 格式化模块 - 无状态模块的热重载示例
 *
 * 此模块是纯函数，没有内部状态，热重载不会丢失任何数据。
 *
 * 尝试修改 format 函数的返回格式，保存后观察输出变化！
 *
 * 示例修改：
 *   return `✨ 计数: ${count} ✨`;
 *   return `>>> ${count} <<<`;
 *   return `[${count}] ⭐`;
 *   return `Counter = ${count}`;
 */

declare const __hmr_accept__: (cb?: () => void) => void;

__hmr_accept__(() => {
    console.log("[Formatter] 模块已热重载");
});

/** 格式化计数器值 */
export function format(count: number): string {
    return `[计数器] 当前值: ${count}`;
}
