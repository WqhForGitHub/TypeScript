#!/usr/bin/env node
"use strict";
/**
 * 多线程任务处理（Worker Threads）演示
 *
 * 功能：
 * 1. 使用 Node.js Worker Threads 创建多线程任务处理
 * 2. 实现 Worker 线程池，自动分发和调度任务
 * 3. 支持 main ↔ worker 双向消息通信
 * 4. CPU 密集型任务对比：单线程 vs 多线程性能测试
 * 5. 支持 SharedArrayBuffer 共享内存方式通信
 * 6. 完善的错误处理和优雅退出机制
 *
 * 使用方式：
 *   npm run dev
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
const worker_threads_1 = require("worker_threads");
const os = __importStar(require("os"));
// ========== 通用工具函数 ==========
/** 判断质数 */
function isPrime(n) {
    if (n < 2)
        return false;
    if (n < 4)
        return true;
    if (n % 2 === 0 || n % 3 === 0)
        return false;
    for (let i = 5; i * i <= n; i += 6) {
        if (n % i === 0 || n % (i + 2) === 0)
            return false;
    }
    return true;
}
/** 在指定范围内查找质数 */
function findPrimes(start, end) {
    const primes = [];
    for (let i = start; i <= end; i++) {
        if (isPrime(i))
            primes.push(i);
    }
    return primes;
}
/** 计算 Fibonacci（递归，故意低效以模拟 CPU 密集任务） */
function fibonacci(n) {
    if (n <= 1)
        return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}
/** 矩阵乘法 */
function multiplyMatrices(a, b) {
    const rowsA = a.length;
    const colsA = a[0].length;
    const colsB = b[0].length;
    const result = [];
    for (let i = 0; i < rowsA; i++) {
        result[i] = [];
        for (let j = 0; j < colsB; j++) {
            let sum = 0;
            for (let k = 0; k < colsA; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }
    return result;
}
// ========== Worker 线程逻辑 ==========
if (!worker_threads_1.isMainThread && worker_threads_1.parentPort) {
    const workerId = worker_threads_1.workerData?.id ?? -1;
    // MessageChannel 的专用端口
    let channelPort = null;
    worker_threads_1.parentPort.on("message", (msg) => {
        switch (msg.type) {
            // --- 常规任务处理 ---
            case "task": {
                const task = msg.task;
                const startTime = Date.now();
                try {
                    let result;
                    switch (task.type) {
                        case "findPrimes": {
                            const { start, end } = task.data;
                            const primes = findPrimes(start, end);
                            result = primes.length;
                            break;
                        }
                        case "fibonacci": {
                            const { n } = task.data;
                            result = fibonacci(n);
                            break;
                        }
                        case "matrixMultiply": {
                            const { a, b } = task.data;
                            result = multiplyMatrices(a, b);
                            break;
                        }
                        default:
                            throw new Error(`未知任务类型: ${task.type}`);
                    }
                    worker_threads_1.parentPort.postMessage({
                        type: "result",
                        result: {
                            taskId: task.id,
                            success: true,
                            result,
                            duration: Date.now() - startTime,
                        },
                    });
                }
                catch (err) {
                    worker_threads_1.parentPort.postMessage({
                        type: "result",
                        result: {
                            taskId: task.id,
                            success: false,
                            error: err.message,
                            duration: Date.now() - startTime,
                        },
                    });
                }
                break;
            }
            // --- MessageChannel 初始化 ---
            case "init-channel": {
                const { port } = msg;
                channelPort = port;
                channelPort.on("message", (channelMsg) => {
                    // 收到主线程通过专用通道发来的消息，处理后回复
                    if (channelMsg.greeting) {
                        channelPort.postMessage({
                            reply: `Worker-${workerId} 收到: "${channelMsg.greeting}"`,
                        });
                    }
                    if (channelMsg.command === "compute" && typeof channelMsg.value === "number") {
                        const val = channelMsg.value;
                        channelPort.postMessage({
                            reply: `Worker-${workerId} 计算结果: fib(${val}) = ${fibonacci(val)}`,
                        });
                    }
                });
                channelPort.on("close", () => {
                    channelPort = null;
                });
                worker_threads_1.parentPort.postMessage({ type: "channel-ready" });
                break;
            }
            // --- SharedArrayBuffer 共享内存任务 ---
            case "shared-task": {
                const { range, workerId: wid } = msg;
                const primes = findPrimes(range.start, range.end);
                const count = primes.length;
                // 直接写入共享内存
                const sharedBuffer = worker_threads_1.workerData
                    ?.sharedBuffer;
                if (sharedBuffer) {
                    const sharedArray = new Int32Array(sharedBuffer);
                    Atomics.add(sharedArray, wid + 1, count);
                    Atomics.add(sharedArray, 0, count);
                }
                worker_threads_1.parentPort.postMessage({ type: "shared-result", workerId: wid, count });
                worker_threads_1.parentPort.postMessage({ type: "shared-done" });
                break;
            }
        }
    });
    worker_threads_1.parentPort.postMessage({
        type: "log",
        message: `[Worker-${workerId}] 已就绪`,
    });
}
// ========== 主线程：Worker 线程池 ==========
if (worker_threads_1.isMainThread) {
    class WorkerPool {
        constructor(options) {
            this.workers = [];
            this.taskQueue = [];
            this.resultCallbacks = new Map();
            this.nextTaskId = 1;
            this.terminated = false;
            this.size = options.size ?? os.cpus().length;
            this.workerPath = options.workerPath;
            this.initData = options.workerData;
        }
        /** 初始化线程池 */
        async init() {
            const initPromises = [];
            for (let i = 0; i < this.size; i++) {
                initPromises.push(this.createWorker(i));
            }
            await Promise.all(initPromises);
            console.log(`✅ 线程池已初始化，共 ${this.size} 个 Worker 线程`);
        }
        /** 创建单个 Worker */
        createWorker(id) {
            return new Promise((resolve, reject) => {
                const worker = new worker_threads_1.Worker(this.workerPath, {
                    workerData: { ...(typeof this.initData === "object" && this.initData !== null ? this.initData : {}), id },
                });
                const poolWorker = {
                    worker,
                    busy: false,
                    currentTaskId: null,
                };
                worker.on("message", (msg) => {
                    if (msg.type === "log") {
                        console.log(msg.message);
                        return;
                    }
                    if (msg.type === "result") {
                        const { result } = msg;
                        poolWorker.busy = false;
                        poolWorker.currentTaskId = null;
                        const callback = this.resultCallbacks.get(result.taskId);
                        if (callback) {
                            this.resultCallbacks.delete(result.taskId);
                            callback(result);
                        }
                        // 尝试分配队列中的下一个任务
                        this.dispatchNextTask(poolWorker);
                    }
                });
                worker.on("error", (err) => {
                    console.error(`❌ Worker-${id} 发生错误:`, err.message);
                    poolWorker.busy = false;
                    poolWorker.currentTaskId = null;
                    this.dispatchNextTask(poolWorker);
                });
                worker.on("exit", (code) => {
                    if (code !== 0 && !this.terminated) {
                        console.error(`⚠️  Worker-${id} 退出，退出码: ${code}`);
                    }
                });
                this.workers.push(poolWorker);
                // 等待 Worker 就绪消息
                const readyHandler = (msg) => {
                    if (msg.type === "log") {
                        worker.off("message", readyHandler);
                        resolve();
                    }
                };
                worker.on("message", readyHandler);
            });
        }
        /** 提交任务 */
        submit(type, data) {
            return new Promise((resolve, reject) => {
                if (this.terminated) {
                    reject(new Error("线程池已关闭"));
                    return;
                }
                const task = {
                    id: this.nextTaskId++,
                    type,
                    data,
                };
                this.resultCallbacks.set(task.id, (result) => {
                    resolve(result);
                });
                // 优先分发给空闲的 Worker
                const idleWorker = this.workers.find((w) => !w.busy);
                if (idleWorker) {
                    this.dispatchTask(idleWorker, task);
                }
                else {
                    this.taskQueue.push(task);
                }
            });
        }
        /** 向指定 Worker 分发任务 */
        dispatchTask(worker, task) {
            worker.busy = true;
            worker.currentTaskId = task.id;
            worker.worker.postMessage({ type: "task", task });
        }
        /** 分发队列中的下一个任务 */
        dispatchNextTask(worker) {
            if (this.taskQueue.length > 0 && !worker.busy) {
                const nextTask = this.taskQueue.shift();
                this.dispatchTask(worker, nextTask);
            }
        }
        /** 关闭线程池 */
        async terminate() {
            this.terminated = true;
            const exitPromises = this.workers.map((w) => new Promise((resolve) => {
                w.worker.on("exit", () => resolve());
                w.worker.terminate();
            }));
            await Promise.all(exitPromises);
            console.log("🔒 线程池已关闭");
        }
        /** 获取线程池状态 */
        getStatus() {
            const busy = this.workers.filter((w) => w.busy).length;
            return {
                total: this.workers.length,
                busy,
                idle: this.workers.length - busy,
                queued: this.taskQueue.length,
            };
        }
    }
    // ========== 演示函数 ==========
    /** 单线程质数查找（用于对比） */
    function singleThreadFindPrimes(start, end, chunkSize) {
        const startTime = Date.now();
        let count = 0;
        for (let s = start; s <= end; s += chunkSize) {
            const e = Math.min(s + chunkSize - 1, end);
            const primes = findPrimes(s, e);
            count += primes.length;
        }
        return Date.now() - startTime;
    }
    /** 演示 1：Worker 线程池基础使用 */
    async function demo1_basicPool() {
        console.log("\n" + "=".repeat(60));
        console.log("📋 演示 1：Worker 线程池基础使用");
        console.log("=".repeat(60));
        const workerPath = __filename;
        const pool = new WorkerPool({ size: 4, workerPath });
        await pool.init();
        // 提交多个质数查找任务
        const tasks = [
            { type: "findPrimes", data: { start: 1, end: 100000 } },
            { type: "findPrimes", data: { start: 100001, end: 200000 } },
            { type: "findPrimes", data: { start: 200001, end: 300000 } },
            { type: "findPrimes", data: { start: 300001, end: 400000 } },
            { type: "findPrimes", data: { start: 400001, end: 500000 } },
            { type: "findPrimes", data: { start: 500001, end: 600000 } },
        ];
        console.log(`\n📤 提交 ${tasks.length} 个质数查找任务...`);
        const promises = tasks.map((t) => pool.submit(t.type, t.data));
        const results = await Promise.all(promises);
        console.log("\n📊 任务执行结果：");
        results.forEach((r) => {
            const status = r.success ? "✅" : "❌";
            console.log(`  ${status} 任务 #${r.taskId} | 耗时: ${r.duration}ms | 结果: 找到 ${r.result} 个质数`);
        });
        console.log(`\n📈 线程池状态:`, pool.getStatus());
        await pool.terminate();
    }
    /** 演示 2：单线程 vs 多线程性能对比 */
    async function demo2_performanceComparison() {
        console.log("\n" + "=".repeat(60));
        console.log("📋 演示 2：单线程 vs 多线程性能对比");
        console.log("=".repeat(60));
        const RANGE_START = 1;
        const RANGE_END = 2000000;
        const CHUNK_SIZE = 100000;
        const WORKER_COUNT = os.cpus().length;
        // 单线程测试
        console.log("\n🔄 单线程模式：查找 1 ~ 2,000,000 中的质数...");
        const singleTime = singleThreadFindPrimes(RANGE_START, RANGE_END, CHUNK_SIZE);
        console.log(`  ⏱️  单线程耗时: ${singleTime}ms`);
        // 多线程测试
        console.log(`\n🔄 多线程模式（${WORKER_COUNT} 个 Worker）：查找 1 ~ 2,000,000 中的质数...`);
        const workerPath = __filename;
        const pool = new WorkerPool({ size: WORKER_COUNT, workerPath });
        await pool.init();
        const tasks = [];
        for (let s = RANGE_START; s <= RANGE_END; s += CHUNK_SIZE) {
            const e = Math.min(s + CHUNK_SIZE - 1, RANGE_END);
            tasks.push({ type: "findPrimes", data: { start: s, end: e } });
        }
        const multiStart = Date.now();
        const promises = tasks.map((t) => pool.submit(t.type, t.data));
        await Promise.all(promises);
        const multiTime = Date.now() - multiStart;
        console.log(`  ⏱️  多线程耗时: ${multiTime}ms`);
        // 结果对比
        const speedup = (singleTime / multiTime).toFixed(2);
        console.log("\n📊 性能对比：");
        console.log(`  单线程: ${singleTime}ms`);
        console.log(`  多线程: ${multiTime}ms`);
        console.log(`  加速比: ${speedup}x`);
        await pool.terminate();
    }
    /** 演示 3：MessageChannel 双向通信 */
    async function demo3_messageChannel() {
        console.log("\n" + "=".repeat(60));
        console.log("📋 演示 3：MessageChannel 双向通信");
        console.log("=".repeat(60));
        const workerPath = __filename;
        const worker = new worker_threads_1.Worker(workerPath, { workerData: { id: 99 } });
        // 创建 MessageChannel 用于专用通信
        const { port1, port2 } = new worker_threads_1.MessageChannel();
        // 主线程的 port1 监听
        port1.on("message", (msg) => {
            console.log(`  📨 主线程收到: ${msg.reply}`);
        });
        // 将 port2 传递给 Worker
        worker.postMessage({ type: "init-channel", port: port2 }, [port2]);
        // 等待 Worker 确认通道已建立
        await new Promise((resolve) => {
            worker.on("message", (msg) => {
                if (msg.type === "channel-ready") {
                    console.log("  ✅ Worker 专用通道已建立");
                    resolve();
                }
            });
        });
        // 通过专用通道发送消息
        port1.postMessage({ greeting: "你好，Worker！" });
        await new Promise((resolve) => setTimeout(resolve, 200));
        port1.postMessage({ command: "compute", value: 30 });
        await new Promise((resolve) => setTimeout(resolve, 500));
        port1.close();
        await worker.terminate();
        console.log("  🔒 MessageChannel 通信演示完成");
    }
    /** 演示 4：SharedArrayBuffer 共享内存 */
    async function demo4_sharedArrayBuffer() {
        console.log("\n" + "=".repeat(60));
        console.log("📋 演示 4：SharedArrayBuffer 共享内存");
        console.log("=".repeat(60));
        // 创建共享内存
        const sharedBuffer = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
        const sharedArray = new Int32Array(sharedBuffer);
        // 初始化：[总数, Worker0, Worker1, Worker2]
        sharedArray[0] = 0;
        sharedArray[1] = 0;
        sharedArray[2] = 0;
        sharedArray[3] = 0;
        console.log("  📦 已创建 SharedArrayBuffer（4 个 Int32 位）");
        console.log(`  初始状态: [${Array.from(sharedArray).join(", ")}]`);
        const workerPath = __filename;
        const workerCount = 3;
        const ranges = [
            { start: 1, end: 500000 },
            { start: 500001, end: 1000000 },
            { start: 1000001, end: 1500000 },
        ];
        const workers = [];
        const startTime = Date.now();
        for (let i = 0; i < workerCount; i++) {
            const worker = new worker_threads_1.Worker(workerPath, {
                workerData: { id: i, sharedBuffer },
            });
            workers.push(worker);
            worker.on("message", (msg) => {
                if (msg.type === "shared-result") {
                    const { workerId, count } = msg;
                    console.log(`  📊 Worker-${workerId} 完成，找到 ${count} 个质数`);
                    console.log(`  共享数组: [${Array.from(sharedArray).join(", ")}]`);
                }
            });
        }
        // 向每个 Worker 发送共享内存任务
        workers.forEach((worker, i) => {
            worker.postMessage({
                type: "shared-task",
                range: ranges[i],
                workerId: i,
            });
        });
        // 等待所有 Worker 完成
        await new Promise((resolve) => {
            let completed = 0;
            workers.forEach((worker) => {
                worker.on("message", (msg) => {
                    if (msg.type === "shared-done") {
                        completed++;
                        if (completed === workerCount)
                            resolve();
                    }
                });
            });
        });
        const elapsed = Date.now() - startTime;
        console.log(`\n  ⏱️  共耗时: ${elapsed}ms`);
        console.log(`  🏁 最终共享数组: [${Array.from(sharedArray).join(", ")}]`);
        console.log(`  📈 总质数数量: ${sharedArray[0]}`);
        for (const w of workers)
            await w.terminate();
        console.log("  🔒 SharedArrayBuffer 演示完成");
    }
    /** 演示 5：Fibonacci 多线程计算 */
    async function demo5_fibonacci() {
        console.log("\n" + "=".repeat(60));
        console.log("📋 演示 5：Fibonacci 多线程计算");
        console.log("=".repeat(60));
        const workerPath = __filename;
        const pool = new WorkerPool({ size: 4, workerPath });
        await pool.init();
        const fibNumbers = [35, 36, 37, 38, 39, 40];
        console.log(`\n📤 提交 ${fibNumbers.length} 个 Fibonacci 计算任务...`);
        console.log(`  计算 fib(${fibNumbers.join("), fib(")})`);
        // 单线程基准
        const singleStart = Date.now();
        const singleResults = [];
        for (const n of fibNumbers) {
            const t0 = Date.now();
            const val = fibonacci(n);
            singleResults.push({ n, value: val, time: Date.now() - t0 });
        }
        const singleTotal = Date.now() - singleStart;
        console.log(`\n  单线程总耗时: ${singleTotal}ms`);
        // 多线程
        const multiStart = Date.now();
        const promises = fibNumbers.map((n) => pool.submit("fibonacci", { n }));
        const multiResults = await Promise.all(promises);
        const multiTotal = Date.now() - multiStart;
        console.log(`  多线程总耗时: ${multiTotal}ms`);
        console.log("\n📊 结果对比：");
        multiResults.forEach((r, i) => {
            const n = fibNumbers[i];
            const single = singleResults[i];
            console.log(`  fib(${n}) = ${r.result} | 单: ${single.time}ms | 多: ${r.duration}ms`);
        });
        console.log(`\n  🏎️  加速比: ${(singleTotal / multiTotal).toFixed(2)}x`);
        await pool.terminate();
    }
    // ========== 主函数 ==========
    async function main() {
        console.log("╔══════════════════════════════════════════════════════════╗");
        console.log("║     多线程任务处理（Worker Threads）演示                   ║");
        console.log("╚══════════════════════════════════════════════════════════╝");
        console.log(`\n🖥️  系统 CPU 核心数: ${os.cpus().length}`);
        console.log(`   Node.js 版本: ${process.version}`);
        try {
            await demo1_basicPool();
            await demo2_performanceComparison();
            await demo3_messageChannel();
            await demo4_sharedArrayBuffer();
            await demo5_fibonacci();
            console.log("\n" + "=".repeat(60));
            console.log("🎉 所有演示已完成！");
            console.log("=".repeat(60));
        }
        catch (err) {
            console.error("❌ 演示执行出错:", err);
        }
    }
    main().catch(console.error);
}
//# sourceMappingURL=index.js.map