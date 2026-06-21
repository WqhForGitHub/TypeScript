#!/usr/bin/env node
"use strict";
/**
 * 模块热重载实验 (Module Hot Reloading Experiment)
 *
 * 纯 TypeScript 实现的模块热重载系统，不依赖任何第三方库。
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                     功能特性                             │
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │  🔹 Node.js 模式（默认）                                │
 * │     - 使用 ts.transpileModule 实时编译 .ts 文件         │
 * │     - 使用 vm.Script 在沙箱中执行模块代码               │
 * │     - 使用 ES6 Proxy 代理导出，引用自动指向最新版本     │
 * │     - 使用 fs.watch 监听文件变化                        │
 * │     - 支持 __hmr_data__ 跨重载保留模块状态              │
 * │                                                         │
 * │  🔹 浏览器模式                                          │
 * │     - 启动 HTTP 开发服务器                              │
 * │     - 使用 SSE (Server-Sent Events) 推送更新            │
 * │     - 客户端 HMR 运行时自动更新模块                     │
 * │     - 页面无需刷新即可看到变化                          │
 * │                                                         │
 * └─────────────────────────────────────────────────────────┘
 *
 * 使用方式：
 *   npm run dev            → Node.js 模式
 *   npm run dev -- browser → 浏览器模式
 *
 * Node.js 模式下，编辑 src/modules/ 中的文件即可看到热重载效果。
 * 浏览器模式下，编辑同样的文件，浏览器页面会自动更新。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const hmr_1 = require("./hmr");
// ─── Node.js HMR 演示 ────────────────────────────────────
function runNodeDemo() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║         模块热重载实验 - Node.js 模式            ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log('纯 TypeScript 实现的模块热重载系统。');
    console.log('应用每秒输出计数器值，编辑模块文件后自动热重载。');
    console.log('');
    console.log('核心原理：');
    console.log('  1. ts.transpileModule   → 实时编译 TypeScript');
    console.log('  2. vm.Script            → 沙箱执行模块代码');
    console.log('  3. Proxy                → 代理导出，自动指向最新版本');
    console.log('  4. fs.watch             → 监听文件变化');
    console.log('  5. __hmr_data__         → 跨重载保留模块状态');
    console.log('');
    console.log('💡 尝试编辑以下文件（保存后观察终端输出变化）：');
    console.log('   src/modules/formatter.ts  → 修改输出格式');
    console.log('   src/modules/counter.ts    → 修改计数步长');
    console.log('');
    console.log('按 Ctrl+C 退出');
    console.log('─'.repeat(52));
    // 创建 HMR 运行时
    const hmr = new hmr_1.HMR({
        rootDir: process.cwd(),
    });
    // 导入模块（返回 Proxy，始终指向最新版本）
    // ⚠️ 不要解构！使用 counter.increment() 而非 const { increment } = counter
    const counter = hmr.import('./src/modules/counter');
    const formatter = hmr.import('./src/modules/formatter');
    // 监听模块更新事件
    hmr.on('update', (moduleId) => {
        const relPath = path.relative(process.cwd(), moduleId);
        console.log(`\n🔄 [App] 检测到模块更新: ${relPath}`);
    });
    // 开始监听模块目录
    hmr.watch('src/modules');
    // 每秒输出计数器值
    const timer = setInterval(() => {
        const count = counter.increment();
        const message = formatter.format(count);
        console.log(message);
    }, 1000);
    // 优雅退出
    process.on('SIGINT', () => {
        clearInterval(timer);
        hmr.close();
        console.log('\n再见！');
        process.exit(0);
    });
}
// ─── 浏览器 HMR 演示 ────────────────────────────────────
function runBrowserDemo() {
    try {
        const { startBrowserServer } = require('./browser-server');
        startBrowserServer();
    }
    catch (err) {
        console.error('启动浏览器服务器失败:', err);
        process.exit(1);
    }
}
// ─── 主入口 ──────────────────────────────────────────────
function main() {
    const mode = process.argv[2];
    if (mode === 'browser') {
        runBrowserDemo();
    }
    else {
        runNodeDemo();
    }
}
main();
//# sourceMappingURL=index.js.map