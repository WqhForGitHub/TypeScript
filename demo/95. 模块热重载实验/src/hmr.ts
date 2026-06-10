/**
 * 模块热重载运行时 (HMR Runtime) - 核心实现
 *
 * 纯 TypeScript 实现的模块热重载系统，不依赖任何第三方库。
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                     核心原理                             │
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │  1. TypeScript Compiler API                             │
 * │     使用 ts.transpileModule 实时编译 .ts 文件           │
 * │                                                         │
 * │  2. vm.Script 沙箱执行                                  │
 * │     在受控环境中执行编译后的代码，模拟 CommonJS 模块系统 │
 * │                                                         │
 * │  3. Proxy 代理导出                                      │
 * │     hmr.import() 返回 Proxy 对象，始终指向最新版本       │
 * │     当模块热重载后，所有引用自动切换到新的导出           │
 * │                                                         │
 * │  4. fs.watch 文件监听                                   │
 * │     监听源文件变化，自动触发重新编译和加载               │
 * │                                                         │
 * │  5. 状态保留机制                                        │
 * │     通过 __hmr_dispose__ / __hmr_data__ 跨重载保留状态  │
 * │                                                         │
 * └─────────────────────────────────────────────────────────┘
 *
 * 使用示例:
 *
 *   const hmr = new HMR({ rootDir: process.cwd() });
 *
 *   // 导入模块（返回 Proxy，自动指向最新版本）
 *   const counter = hmr.import('./src/modules/counter');
 *   counter.increment(); // 始终调用最新版本
 *
 *   // 监听更新
 *   hmr.on('update', (id) => console.log('Updated:', id));
 *
 *   // 开始监听文件变化
 *   hmr.watch('src/modules');
 */

import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as ts from "typescript";
import { EventEmitter } from "events";

// ─── 类型定义 ─────────────────────────────────────────────

/** 模块条目 - 跟踪已加载的模块及其元数据 */
interface ModuleEntry {
    /** 模块绝对路径 */
    id: string;
    /** 导出代理目标：{ exports: 当前导出对象 }，可整体替换 */
    target: { exports: Record<string, any> };
    /** Proxy 代理对象（外部持有） */
    proxy: any;
    /** 模块内部状态（跨重载保留） */
    state: Record<string, any>;
    /** 上次修改时间 */
    lastModified: Date;
    /** 热更新接受回调 */
    acceptCallback?: () => void;
    /** 销毁前回调（用于保存状态） */
    disposeCallback?: (state: Record<string, any>) => void;
}

/** HMR 运行时配置 */
interface HMROptions {
    /** 项目根目录，用于解析相对路径 */
    rootDir: string;
    /** TypeScript 编译选项（可选，有默认值） */
    compilerOptions?: ts.CompilerOptions;
}

// ─── HMR 运行时 ──────────────────────────────────────────

export class HMR extends EventEmitter {
    /** 已加载的模块注册表 */
    private modules = new Map<string, ModuleEntry>();
    /** 文件监听器列表 */
    private watchers: fs.FSWatcher[] = [];
    /** 项目根目录 */
    private rootDir: string;
    /** TypeScript 编译选项 */
    private compilerOptions: ts.CompilerOptions;
    /** 防抖定时器（避免编辑器保存触发多次重载） */
    private debounceTimers = new Map<string, NodeJS.Timeout>();

    constructor(options: HMROptions) {
        super();
        this.rootDir = path.resolve(options.rootDir);
        this.compilerOptions = {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
            strict: false,
            ...options.compilerOptions,
        };
    }

    // ─── 公共 API ────────────────────────────────────────

    /**
     * 导入一个模块，支持热重载。
     *
     * 返回的 Proxy 对象始终指向最新版本的模块导出。
     * 即使模块被热重载，通过 Proxy 访问的属性也是最新的。
     *
     * ⚠️ 注意：解构赋值会破坏 Proxy 的代理效果：
     *   const { increment } = hmr.import('./counter');  // ❌ 不会更新
     *   const counter = hmr.import('./counter');         // ✅ 会更新
     *   counter.increment();                              // ✅ 始终最新
     *
     * @param modulePath 模块路径（相对于 rootDir）
     */
    import<T = any>(modulePath: string): T {
        const resolved = this.resolveModule(modulePath);

        // 已加载的模块直接返回 Proxy
        if (this.modules.has(resolved)) {
            return this.modules.get(resolved)!.proxy as T;
        }

        const entry = this.loadModule(resolved);
        return entry.proxy as T;
    }

    /**
     * 注册模块更新时的回调。
     * 当模块被热重载后，回调函数会被调用。
     */
    accept(modulePath: string, callback: () => void): void {
        const resolved = this.resolveModule(modulePath);
        const entry = this.modules.get(resolved);
        if (entry) {
            entry.acceptCallback = callback;
        }
    }

    /**
     * 注册模块销毁前的回调，用于保存状态。
     * 保存的数据会通过 __hmr_data__ 传递给重载后的新模块。
     */
    dispose(
        modulePath: string,
        callback: (state: Record<string, any>) => void,
    ): void {
        const resolved = this.resolveModule(modulePath);
        const entry = this.modules.get(resolved);
        if (entry) {
            entry.disposeCallback = callback;
        }
    }

    /**
     * 开始监听目录中的 .ts 文件变化。
     * 当文件变化时，自动重新编译和加载对应模块。
     */
    watch(dir: string): void {
        const absDir = path.resolve(this.rootDir, dir);

        try {
            const watcher = fs.watch(
                absDir,
                { recursive: true },
                (event, filename) => {
                    if (filename && filename.endsWith(".ts")) {
                        const filePath = path.join(absDir, filename);
                        this.scheduleReload(filePath);
                    }
                },
            );
            this.watchers.push(watcher);
            console.log(
                `[HMR] 正在监听: ${path.relative(this.rootDir, absDir)}/`,
            );
        } catch (err) {
            console.error(`[HMR] 监听失败 ${absDir}:`, err);
        }
    }

    /**
     * 停止所有监听器，清理资源。
     */
    close(): void {
        this.watchers.forEach((w) => w.close());
        this.watchers = [];
        this.debounceTimers.forEach((t) => clearTimeout(t));
        this.debounceTimers.clear();
        this.modules.clear();
        this.removeAllListeners();
        console.log("[HMR] 已停止");
    }

    /**
     * 获取已注册模块的相对路径列表。
     */
    getModuleIds(): string[] {
        return Array.from(this.modules.keys()).map((id) =>
            path.relative(this.rootDir, id),
        );
    }

    // ─── 模块加载 ────────────────────────────────────────

    /**
     * 加载模块：读取源码 → 编译 → 执行 → 注册
     */
    private loadModule(resolvedPath: string): ModuleEntry {
        const source = fs.readFileSync(resolvedPath, "utf-8");
        const compiledSource = this.compile(source, resolvedPath);

        // 准备模块执行环境
        const moduleExports: Record<string, any> = {};
        const state: Record<string, any> = {};
        let acceptCallback: (() => void) | undefined;
        let disposeCallback: ((data: Record<string, any>) => void) | undefined;

        // 执行编译后的代码，填充 exports
        const finalExports = this.executeModule(
            compiledSource,
            resolvedPath,
            moduleExports,
            state,
            {
                onAccept: (cb) => {
                    acceptCallback = cb;
                },
                onDispose: (cb) => {
                    disposeCallback = cb;
                },
            },
        );

        // 创建代理目标（包装 exports，便于整体替换）
        const target = { exports: finalExports };
        const proxy = this.createProxy(target);

        const stat = fs.statSync(resolvedPath);

        const entry: ModuleEntry = {
            id: resolvedPath,
            target,
            proxy,
            state,
            lastModified: stat.mtime,
            acceptCallback,
            disposeCallback,
        };

        this.modules.set(resolvedPath, entry);
        return entry;
    }

    // ─── TypeScript 编译 ─────────────────────────────────

    /**
     * 使用 TypeScript Compiler API 将 .ts 源码编译为 CommonJS JavaScript。
     *
     * ts.transpileModule 只做转译（类型擦除 + 语法降级），
     * 不做类型检查，速度很快，适合 HMR 场景。
     */
    private compile(source: string, filePath: string): string {
        const result = ts.transpileModule(source, {
            compilerOptions: this.compilerOptions,
            fileName: filePath,
        });

        if (result.diagnostics && result.diagnostics.length > 0) {
            const errors = result.diagnostics.map((d) => {
                const msg = ts.flattenDiagnosticMessageText(
                    d.messageText,
                    "\n",
                );
                const line =
                    d.file && d.start
                        ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
                        : "?";
                return `  行 ${line}: ${msg}`;
            });
            throw new Error(
                `TypeScript 编译错误 (${path.relative(this.rootDir, filePath)}):\n${errors.join("\n")}`,
            );
        }

        return result.outputText;
    }

    // ─── 模块执行 ────────────────────────────────────────

    /**
     * 在 vm.Script 沙箱中执行编译后的模块代码。
     *
     * 模拟 Node.js 的 CommonJS 模块系统：
     *   - 提供 exports / require / module / __filename / __dirname
     *   - 相对导入通过 HMR 系统路由（实现依赖的热重载传播）
     *   - 提供 __hmr_data__ / __hmr_accept__ / __hmr_dispose__ HMR API
     *
     * @returns 模块的最终导出对象
     */
    private executeModule(
        compiledSource: string,
        filePath: string,
        moduleExports: Record<string, any>,
        hmrState: Record<string, any>,
        hmrCallbacks: {
            onAccept: (cb: () => void) => void;
            onDispose: (cb: (data: Record<string, any>) => void) => void;
        },
    ): Record<string, any> {
        const moduleObj = { exports: moduleExports };

        // 包装成 CommonJS 模块函数，注入 HMR API
        const wrappedCode = [
            "(function(exports, require, module, __filename, __dirname,",
            " __hmr_data__, __hmr_accept__, __hmr_dispose__) {",
            compiledSource,
            "})",
        ].join("\n");

        try {
            const script = new vm.Script(wrappedCode, {
                filename: filePath,
                lineOffset: 0,
            });

            // 自定义 require 函数：相对导入走 HMR，其他走原生 require
            const customRequire = (id: string) => {
                if (id.startsWith(".")) {
                    const resolved = this.resolveModule(
                        id,
                        path.dirname(filePath),
                    );
                    return this.import(resolved);
                }
                return require(id);
            };

            // 在当前 V8 上下文中执行
            const fn = script.runInThisContext();
            fn(
                moduleExports, // exports
                customRequire, // require
                moduleObj, // module
                filePath, // __filename
                path.dirname(filePath), // __dirname
                hmrState, // __hmr_data__
                hmrCallbacks.onAccept, // __hmr_accept__
                hmrCallbacks.onDispose, // __hmr_dispose__
            );

            // 处理 module.exports = xxx 的情况
            return moduleObj.exports !== moduleExports
                ? moduleObj.exports
                : moduleExports;
        } catch (err) {
            console.error(
                `[HMR] 模块执行错误 ${path.relative(this.rootDir, filePath)}:`,
                err,
            );
            throw err;
        }
    }

    // ─── Proxy 代理 ─────────────────────────────────────

    /**
     * 创建 ES6 Proxy 代理模块导出。
     *
     * 核心设计：Proxy 包装 { exports } 对象，
     * 当模块热重载时，只需替换 target.exports 即可。
     * 所有通过 Proxy 的属性访问自动指向新的导出。
     *
     *   target.exports = oldExports;  // 旧版本
     *   target.exports = newExports;  // 热重载后，Proxy 自动转发
     */
    private createProxy(target: { exports: Record<string, any> }): any {
        return new Proxy(target, {
            /** 属性读取 - 委托到当前 exports */
            get(t, prop, receiver) {
                // 跳过内部属性
                if (prop === "toJSON" || prop === Symbol.toPrimitive) {
                    return undefined;
                }
                const value = t.exports[prop as string];
                if (typeof value === "function") {
                    // 绑定 this 到 exports，确保方法内 this 指向正确
                    return value.bind(t.exports);
                }
                return value;
            },
            /** 枚举属性 - 返回 exports 的键 */
            ownKeys(t) {
                return Reflect.ownKeys(t.exports);
            },
            /** 属性描述符 - 委托到 exports */
            getOwnPropertyDescriptor(t, prop) {
                return Reflect.getOwnPropertyDescriptor(t.exports, prop);
            },
            /** in 操作符 - 检查 exports */
            has(t, prop) {
                return prop in t.exports;
            },
        });
    }

    // ─── 文件变化处理 ─────────────────────────────────────

    /**
     * 防抖调度：编辑器保存文件可能触发多次 fs.watch 事件，
     * 使用 100ms 防抖避免重复重载。
     */
    private scheduleReload(filePath: string): void {
        const resolvedPath = path.resolve(filePath);

        const existing = this.debounceTimers.get(resolvedPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
            resolvedPath,
            setTimeout(() => {
                this.debounceTimers.delete(resolvedPath);
                this.handleFileChange(resolvedPath);
            }, 100),
        );
    }

    /**
     * 处理文件变化：重新编译并热替换模块。
     *
     * 流程：
     * 1. 检查文件是否确实变化（比较 mtime）
     * 2. 调用 dispose 回调，保存模块状态
     * 3. 重新编译 TypeScript
     * 4. 执行新代码，获得新导出
     * 5. 替换 target.exports（Proxy 自动转发）
     * 6. 调用 accept 回调，通知模块已更新
     */
    private handleFileChange(resolvedPath: string): void {
        const entry = this.modules.get(resolvedPath);
        if (!entry) return;

        try {
            // 检查文件是否确实变化
            const stat = fs.statSync(resolvedPath);
            if (stat.mtime <= entry.lastModified) return;

            const relPath = path.relative(this.rootDir, resolvedPath);
            console.log(`\n[HMR] 文件变化: ${relPath}`);

            // 1. 调用 dispose 回调，保存状态
            if (entry.disposeCallback) {
                entry.disposeCallback(entry.state);
            }

            // 2. 重新编译
            const newSource = fs.readFileSync(resolvedPath, "utf-8");
            const newCompiled = this.compile(newSource, resolvedPath);

            // 3. 执行新代码
            const newExports: Record<string, any> = {};
            let newAcceptCallback: (() => void) | undefined;
            let newDisposeCallback:
                | ((data: Record<string, any>) => void)
                | undefined;

            this.executeModule(
                newCompiled,
                resolvedPath,
                newExports,
                entry.state,
                {
                    onAccept: (cb) => {
                        newAcceptCallback = cb;
                    },
                    onDispose: (cb) => {
                        newDisposeCallback = cb;
                    },
                },
            );

            // 4. 替换导出（Proxy 自动转发，无需更新引用）
            entry.target.exports = newExports;
            entry.acceptCallback = newAcceptCallback;
            entry.disposeCallback = newDisposeCallback;
            entry.lastModified = stat.mtime;

            // 5. 调用 accept 回调
            if (entry.acceptCallback) {
                entry.acceptCallback();
            }

            // 6. 发出更新事件
            this.emit("update", resolvedPath);

            console.log(`[HMR] 模块已更新: ${relPath}`);
        } catch (err) {
            console.error(`[HMR] 模块更新失败:`, err);
        }
    }

    // ─── 模块路径解析 ────────────────────────────────────

    /**
     * 解析模块路径为绝对路径。
     *
     * 支持以下形式：
     *   - 绝对路径: '/foo/bar'
     *   - 相对路径: './modules/counter', '../utils'
     *   - Node 模块: 'fs', 'typescript'
     *
     * 自动尝试添加 .ts / .js 扩展名和 /index.ts 回退。
     */
    private resolveModule(modulePath: string, fromDir?: string): string {
        const base = fromDir || this.rootDir;
        let resolved: string;

        if (path.isAbsolute(modulePath)) {
            resolved = modulePath;
        } else if (modulePath.startsWith(".")) {
            resolved = path.resolve(base, modulePath);
        } else {
            // 非相对路径：使用 Node.js 原生解析
            return require.resolve(modulePath, { paths: [base] });
        }

        // 已有扩展名，直接返回
        if (path.extname(resolved)) {
            return resolved;
        }

        // 自动尝试添加扩展名
        const candidates = [
            resolved + ".ts",
            resolved + ".js",
            path.join(resolved, "index.ts"),
            path.join(resolved, "index.js"),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        throw new Error(`无法解析模块: ${modulePath} (from ${base})`);
    }
}
