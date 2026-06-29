#!/usr/bin/env node

/**
 * 模块热重载实验 (Module Hot Reloading Experiment)
 * 纯 TypeScript 实现的模块热重载系统，仅使用 Node.js 内置模块
 * (fs, path, module, vm, crypto)。
 * 功能：fs.watch/轮询双模式监听、vm.Script 沙箱执行、Proxy 代理导出、
 * crypto 内容哈希、依赖图级联重载、__hmr_data__ 状态保留、防抖。
 */

import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as crypto from "crypto";
import { createRequire } from "module";

const nodeRequire = createRequire(__filename);

// ── String Enums ──────────────────────────────────────────

enum ReloadEvent {
  Update = "update",
  Dispose = "dispose",
  Error = "error",
  Ready = "ready",
}
enum ErrorCode {
  ModuleNotFound = "MODULE_NOT_FOUND",
  CompileFailed = "COMPILE_FAILED",
  ExecutionFailed = "EXECUTION_FAILED",
  WatchFailed = "WATCH_FAILED",
  CircularDependency = "CIRCULAR_DEPENDENCY",
}
enum ModuleState {
  Loading = "loading",
  Loaded = "loaded",
  Reloading = "reloading",
  Disposed = "disposed",
  Errored = "errored",
}
enum WatchMode {
  Native = "native",
  Polling = "polling",
}

// ── as const Assertions ───────────────────────────────────

const SUPPORTED_EXTENSIONS = [".js", ".json"] as const;
type FileExtension = (typeof SUPPORTED_EXTENSIONS)[number];

// ── Symbols for Unique Property Keys ──────────────────────

const HMR_DATA_KEY = Symbol("hmrData");
const HMR_ACCEPT_KEY = Symbol("hmrAccept");
const HMR_DISPOSE_KEY = Symbol("hmrDispose");

// ── Interfaces (optional / readonly / index signatures) ───

interface Identifiable {
  readonly id: string;
}

interface ModuleRecord extends Identifiable {
  readonly id: string;
  readonly filePath: string;
  exports: Record<string, unknown>;
  hmrData: Record<string, unknown>;
  status: ModuleState;
  lastModified: Date;
  contentHash: string;
  dependencies: ReadonlySet<string>;
  acceptCallback?: () => void;
  disposeCallback?: (data: Record<string, unknown>) => void;
  reloadCount: number;
  [key: string]: unknown;
}

interface HMRConfig {
  readonly rootDir: string;
  readonly watchMode?: WatchMode;
  readonly debounceMs?: number;
  readonly recursive?: boolean;
  readonly extensions?: readonly FileExtension[];
  readonly pollIntervalMs?: number;
}

interface ExecutionResult {
  readonly exports: Record<string, unknown>;
  readonly acceptCallback?: () => void;
  readonly disposeCallback?: (data: Record<string, unknown>) => void;
}

interface HMRContext {
  [HMR_DATA_KEY]: Record<string, unknown>;
  [HMR_ACCEPT_KEY]?: () => void;
  [HMR_DISPOSE_KEY]?: (data: Record<string, unknown>) => void;
}

// ── Mapped Types ──────────────────────────────────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableModuleRecord = Mutable<ModuleRecord>;
type ReadonlyPartial<T> = { readonly [K in keyof T]?: T[K] };

// ── Discriminated Unions ──────────────────────────────────

interface ReloadSuccess {
  readonly type: "success";
  readonly moduleId: string;
  readonly durationMs: number;
  readonly reloadCount: number;
}

interface ReloadErrorResult {
  readonly type: "error";
  readonly moduleId: string;
  readonly error: HotReloadError;
}

interface ReloadSkipped {
  readonly type: "skipped";
  readonly moduleId: string;
  readonly reason: string;
}

type ReloadResult = ReloadSuccess | ReloadErrorResult | ReloadSkipped;

// ── Custom Error Hierarchy ────────────────────────────────

class HotReloadError extends Error {
  readonly code: ErrorCode;
  readonly moduleId?: string;
  constructor(message: string, code: ErrorCode, moduleId?: string) {
    super(message);
    this.name = "HotReloadError";
    this.code = code;
    this.moduleId = moduleId;
    Object.setPrototypeOf(this, HotReloadError.prototype);
  }
}

// ── satisfies Operator ────────────────────────────────────

const defaultConfig = {
  watchMode: WatchMode.Native,
  debounceMs: 100,
  recursive: true,
  extensions: SUPPORTED_EXTENSIONS,
  pollIntervalMs: 1000,
} satisfies Partial<HMRConfig>;

// ── Type Guards ───────────────────────────────────────────

function isReloadSuccess(r: ReloadResult): r is ReloadSuccess {
  return r.type === "success";
}
function isReloadError(r: ReloadResult): r is ReloadErrorResult {
  return r.type === "error";
}
function isReloadSkipped(r: ReloadResult): r is ReloadSkipped {
  return r.type === "skipped";
}

function isModuleRecord(value: unknown): value is ModuleRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ModuleRecord).id === "string" &&
    typeof (value as ModuleRecord).filePath === "string" &&
    typeof (value as ModuleRecord).contentHash === "string"
  );
}

// ── Generic Class with Constraints ────────────────────────

class ModuleStore<T extends Identifiable> {
  private readonly items = new Map<string, T>();
  private _version = 0;

  add(item: T): T {
    this.items.set(item.id, item);
    this._version++;
    return item;
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  has(id: string): boolean {
    return this.items.has(id);
  }
  get size(): number {
    return this.items.size;
  }
  get version(): number {
    return this._version;
  }
  set version(value: number) {
    if (value < 0) throw new RangeError("version must be non-negative");
    this._version = value;
  }

  delete(id: string): boolean {
    const removed = this.items.delete(id);
    if (removed) this._version++;
    return removed;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const item of this.items.values()) yield item;
  }
  *ids(): Generator<string, void, unknown> {
    for (const id of this.items.keys()) yield id;
  }

  clear(): void {
    this.items.clear();
    this._version++;
  }
}

// ── Abstract Watcher + Concrete Subclasses ────────────────

type FileChangeHandler = (filePath: string) => void;

abstract class AbstractWatcher {
  protected readonly directory: string;
  protected readonly onChange: FileChangeHandler;
  protected readonly recursive: boolean;
  protected readonly extensions: readonly FileExtension[];
  protected _running = false;

  constructor(
    directory: string,
    onChange: FileChangeHandler,
    recursive: boolean,
    extensions: readonly FileExtension[],
  ) {
    this.directory = directory;
    this.onChange = onChange;
    this.recursive = recursive;
    this.extensions = extensions;
  }

  abstract start(): void;
  abstract stop(): void;
  get isRunning(): boolean {
    return this._running;
  }

  protected shouldWatch(filePath: string): boolean {
    const ext = path.extname(filePath);
    return (this.extensions as readonly string[]).includes(ext);
  }
}

class FsWatcher extends AbstractWatcher {
  private watcher: fs.FSWatcher | null = null;

  start(): void {
    try {
      this.watcher = fs.watch(
        this.directory,
        { recursive: this.recursive },
        (_event, filename) => {
          if (!filename) return;
          const filePath = path.join(this.directory, filename);
          if (this.shouldWatch(filePath)) this.onChange(filePath);
        },
      );
      this._running = true;
    } catch (err) {
      throw new HotReloadError(
        `Failed to watch ${this.directory}: ${(err as Error).message}`,
        ErrorCode.WatchFailed,
      );
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this._running = false;
  }
}

class PollingWatcher extends AbstractWatcher {
  private interval: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private snapshots = new Map<string, number>();

  constructor(
    directory: string,
    onChange: FileChangeHandler,
    recursive: boolean,
    extensions: readonly FileExtension[],
    intervalMs: number,
  ) {
    super(directory, onChange, recursive, extensions);
    this.intervalMs = intervalMs;
  }

  start(): void {
    this.scanDirectory();
    this.interval = setInterval(() => this.scanDirectory(), this.intervalMs);
    this._running = true;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this._running = false;
  }

  private scanDirectory(): void {
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && this.recursive) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile() || !this.shouldWatch(fullPath)) continue;
        try {
          const stat = fs.statSync(fullPath);
          const prev = this.snapshots.get(fullPath) ?? 0;
          if (stat.mtimeMs > prev) {
            this.snapshots.set(fullPath, stat.mtimeMs);
            if (prev > 0) this.onChange(fullPath);
          }
        } catch {
          /* ignore */
        }
      }
    };
    walk(this.directory);
  }
}

// ── Function Overloads ────────────────────────────────────

function createWatcher(
  directory: string,
  onChange: FileChangeHandler,
): AbstractWatcher;
function createWatcher(
  directory: string,
  onChange: FileChangeHandler,
  options: ReadonlyPartial<HMRConfig>,
): AbstractWatcher;
function createWatcher(
  directory: string,
  onChange: FileChangeHandler,
  options?: ReadonlyPartial<HMRConfig>,
): AbstractWatcher {
  const mode = options?.watchMode ?? defaultConfig.watchMode;
  const recursive = options?.recursive ?? defaultConfig.recursive;
  const extensions = options?.extensions ?? defaultConfig.extensions;
  const pollMs = options?.pollIntervalMs ?? defaultConfig.pollIntervalMs;
  if (mode === WatchMode.Polling) {
    return new PollingWatcher(
      directory,
      onChange,
      recursive,
      extensions,
      pollMs,
    );
  }
  return new FsWatcher(directory, onChange, recursive, extensions);
}

// ── Hot Reloader (Core HMR Runtime) ───────────────────────

type EventListener = (moduleId: string, ...args: unknown[]) => void;

type ModuleFunction = (
  exports: Record<string, unknown>,
  require: (id: string) => unknown,
  module: { exports: Record<string, unknown> },
  filename: string,
  dirname: string,
  hmrData: Record<string, unknown>,
  accept: (cb: () => void) => void,
  dispose: (cb: (data: Record<string, unknown>) => void) => void,
) => void;

class HotReloader {
  private readonly store = new ModuleStore<ModuleRecord>();
  private readonly rootDir: string;
  private readonly debounceMs: number;
  private readonly config: HMRConfig;
  private watcher: AbstractWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private listeners = new Map<ReloadEvent, Set<EventListener>>();
  private dependents = new Map<string, Set<string>>();

  constructor(config: HMRConfig) {
    this.config = config;
    this.rootDir = path.resolve(config.rootDir);
    this.debounceMs = config.debounceMs ?? defaultConfig.debounceMs;
  }

  // Function Overloads: import
  import(modulePath: string): unknown;
  import<T extends Record<string, unknown>>(modulePath: string): T;
  import<T = unknown>(modulePath: string): T {
    const resolved = this.resolveModule(modulePath);
    const existing = this.store.get(resolved);
    if (existing) return this.createProxy(existing) as T;
    return this.createProxy(this.loadModule(resolved)) as T;
  }

  on(event: ReloadEvent, listener: EventListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  private emit(event: ReloadEvent, moduleId: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set) for (const listener of set) listener(moduleId, ...args);
  }

  accept(modulePath: string, callback: () => void): void {
    const record = this.store.get(this.resolveModule(modulePath));
    if (record) (record as MutableModuleRecord).acceptCallback = callback;
  }

  dispose(
    modulePath: string,
    callback: (data: Record<string, unknown>) => void,
  ): void {
    const record = this.store.get(this.resolveModule(modulePath));
    if (record) (record as MutableModuleRecord).disposeCallback = callback;
  }

  watch(dir: string): void {
    const absDir = path.resolve(this.rootDir, dir);
    this.watcher = createWatcher(
      absDir,
      (fp) => this.scheduleReload(fp),
      this.config,
    );
    this.watcher.start();
    console.log(`[HMR] 正在监听: ${path.relative(this.rootDir, absDir)}/`);
    this.emit(ReloadEvent.Ready, absDir);
  }

  // Generator: iterate modules
  *modules(): Generator<ModuleRecord, void, unknown> {
    for (const record of this.store) yield record;
  }

  get moduleCount(): number {
    return this.store.size;
  }
  get isWatching(): boolean {
    return this.watcher?.isRunning ?? false;
  }
  get storeVersion(): number {
    return this.store.version;
  }

  getModuleIds(): string[] {
    return Array.from(this.store.ids()).map((id) =>
      path.relative(this.rootDir, id),
    );
  }

  close(): void {
    this.watcher?.stop();
    this.watcher = null;
    this.debounceTimers.forEach((t) => clearTimeout(t));
    this.debounceTimers.clear();
    for (const record of this.store)
      (record as MutableModuleRecord).status = ModuleState.Disposed;
    this.listeners.clear();
    this.dependents.clear();
    this.store.clear();
    console.log("[HMR] 已停止");
  }

  private scheduleReload(filePath: string): void {
    const resolved = path.resolve(filePath);
    const existing = this.debounceTimers.get(resolved);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      resolved,
      setTimeout(() => {
        this.debounceTimers.delete(resolved);
        const result = this.handleFileChange(resolved);
        if (isReloadError(result))
          console.error(`[HMR] 重载失败: ${result.error.message}`);
        else if (isReloadSkipped(result))
          console.log(`[HMR] 跳过: ${result.reason}`);
      }, this.debounceMs),
    );
  }

  private handleFileChange(resolvedPath: string): ReloadResult {
    const entry = this.store.get(resolvedPath);
    if (!entry)
      return {
        type: "skipped" as const,
        moduleId: resolvedPath,
        reason: "模块未加载，跳过重载",
      };

    const startTime = Date.now();
    try {
      const source = fs.readFileSync(resolvedPath, "utf-8");
      const hash = crypto.createHash("sha256").update(source).digest("hex");
      if (hash === entry.contentHash)
        return {
          type: "skipped" as const,
          moduleId: resolvedPath,
          reason: "内容未变化",
        };

      const stat = fs.statSync(resolvedPath);
      const relPath = path.relative(this.rootDir, resolvedPath);
      console.log(`\n[HMR] 文件变化: ${relPath}`);

      const mutable = entry as MutableModuleRecord;
      mutable.status = ModuleState.Reloading;
      if (entry.disposeCallback) {
        entry.disposeCallback(entry.hmrData);
        this.emit(ReloadEvent.Dispose, resolvedPath);
      }

      const result = this.executeModule(source, resolvedPath, entry.hmrData);
      mutable.exports = result.exports;
      mutable.acceptCallback = result.acceptCallback;
      mutable.disposeCallback = result.disposeCallback;
      mutable.lastModified = stat.mtime;
      mutable.contentHash = hash;
      mutable.status = ModuleState.Loaded;
      mutable.reloadCount = entry.reloadCount + 1;

      if (result.acceptCallback) result.acceptCallback();
      this.cascadeReload(resolvedPath);
      this.emit(ReloadEvent.Update, resolvedPath);

      const duration = Date.now() - startTime;
      console.log(`[HMR] 模块已更新: ${relPath} (${duration}ms)`);
      return {
        type: "success" as const,
        moduleId: resolvedPath,
        durationMs: duration,
        reloadCount: mutable.reloadCount,
      };
    } catch (err) {
      const error =
        err instanceof HotReloadError
          ? err
          : new HotReloadError(
              (err as Error).message,
              ErrorCode.ExecutionFailed,
              resolvedPath,
            );
      (entry as MutableModuleRecord).status = ModuleState.Errored;
      this.emit(ReloadEvent.Error, resolvedPath, error);
      return { type: "error" as const, moduleId: resolvedPath, error };
    }
  }

  private cascadeReload(moduleId: string): void {
    const deps = this.dependents.get(moduleId);
    if (!deps) return;
    for (const depId of deps) {
      const depRecord = this.store.get(depId);
      if (depRecord && depRecord.status === ModuleState.Loaded) {
        console.log(
          `[HMR] 级联重载依赖者: ${path.relative(this.rootDir, depId)}`,
        );
        this.handleFileChange(depId);
      }
    }
  }

  private loadModule(resolvedPath: string): ModuleRecord {
    if (!fs.existsSync(resolvedPath))
      throw new HotReloadError(
        `模块不存在: ${resolvedPath}`,
        ErrorCode.ModuleNotFound,
        resolvedPath,
      );

    const source = fs.readFileSync(resolvedPath, "utf-8");
    const hash = crypto.createHash("sha256").update(source).digest("hex");
    const stat = fs.statSync(resolvedPath);
    const result = this.executeModule(source, resolvedPath, {});

    const record: ModuleRecord = {
      id: resolvedPath,
      filePath: resolvedPath,
      exports: result.exports,
      hmrData: {},
      status: ModuleState.Loaded,
      lastModified: stat.mtime,
      contentHash: hash,
      dependencies: new Set<string>(),
      acceptCallback: result.acceptCallback,
      disposeCallback: result.disposeCallback,
      reloadCount: 0,
    };
    this.store.add(record);
    return record;
  }

  private executeModule(
    source: string,
    filePath: string,
    hmrData: Record<string, unknown>,
  ): ExecutionResult {
    const moduleExports: Record<string, unknown> = {};
    const moduleObj = { exports: moduleExports };
    const dirname = path.dirname(filePath);

    const wrappedCode = [
      "(function(exports, require, module, __filename, __dirname,",
      " __hmr_data__, __hmr_accept__, __hmr_dispose__) {",
      '"use strict";',
      source,
      "})",
    ].join("\n");

    const ctx: HMRContext = { [HMR_DATA_KEY]: hmrData };

    try {
      const script = new vm.Script(wrappedCode, {
        filename: filePath,
        lineOffset: 0,
      });
      const customRequire = (id: string): unknown => {
        if (id.startsWith(".")) {
          const resolved = this.resolveModule(id, dirname);
          this.trackDependency(resolved, filePath);
          return this.import(resolved);
        }
        return nodeRequire(id);
      };

      const fn = script.runInThisContext() as ModuleFunction;
      fn(
        moduleExports,
        customRequire,
        moduleObj,
        filePath,
        dirname,
        ctx[HMR_DATA_KEY],
        (cb: () => void) => {
          ctx[HMR_ACCEPT_KEY] = cb;
        },
        (cb: (data: Record<string, unknown>) => void) => {
          ctx[HMR_DISPOSE_KEY] = cb;
        },
      );

      const finalExports =
        moduleObj.exports !== moduleExports
          ? (moduleObj.exports as Record<string, unknown>)
          : moduleExports;
      return {
        exports: finalExports,
        acceptCallback: ctx[HMR_ACCEPT_KEY],
        disposeCallback: ctx[HMR_DISPOSE_KEY],
      };
    } catch (err) {
      throw new HotReloadError(
        `模块执行错误 ${path.relative(this.rootDir, filePath)}: ${(err as Error).message}`,
        ErrorCode.ExecutionFailed,
        filePath,
      );
    }
  }

  private trackDependency(moduleId: string, dependentId: string): void {
    if (!this.dependents.has(moduleId))
      this.dependents.set(moduleId, new Set());
    this.dependents.get(moduleId)!.add(dependentId);
    const record = this.store.get(dependentId);
    if (record) {
      (record as MutableModuleRecord).dependencies = new Set([
        ...record.dependencies,
        moduleId,
      ]);
    }
  }

  private createProxy(record: ModuleRecord): unknown {
    const target = { exports: record.exports };
    return new Proxy(target, {
      get(t, prop) {
        if (prop === "toJSON" || prop === Symbol.toPrimitive) return undefined;
        const value = t.exports[prop as string];
        if (typeof value === "function") return value.bind(t.exports);
        return value;
      },
      ownKeys(t) {
        return Reflect.ownKeys(t.exports);
      },
      getOwnPropertyDescriptor(t, prop) {
        return Reflect.getOwnPropertyDescriptor(t.exports, prop);
      },
      has(t, prop) {
        return prop in t.exports;
      },
    });
  }

  private resolveModule(modulePath: string, fromDir?: string): string {
    const base = fromDir ?? this.rootDir;
    let resolved: string;
    if (path.isAbsolute(modulePath)) {
      resolved = modulePath;
    } else if (modulePath.startsWith(".")) {
      resolved = path.resolve(base, modulePath);
    } else {
      return nodeRequire.resolve(modulePath, { paths: [base] });
    }

    if (path.extname(resolved)) return resolved;
    const candidates = [
      resolved + ".js",
      resolved + ".json",
      path.join(resolved, "index.js"),
      path.join(resolved, "index.json"),
    ];
    for (const candidate of candidates)
      if (fs.existsSync(candidate)) return candidate;
    throw new HotReloadError(
      `无法解析模块: ${modulePath} (from ${base})`,
      ErrorCode.ModuleNotFound,
      modulePath,
    );
  }
}

// ── CLI / Demo Section ────────────────────────────────────

function runNodeDemo(usePolling: boolean): void {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║         模块热重载实验 - Node.js 模式            ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(
    "纯 TypeScript 实现的模块热重载系统（仅使用 Node.js 内置模块）。",
  );
  console.log(
    `监听模式: ${usePolling ? "轮询 (Polling)" : "原生 (fs.watch)"}  按 Ctrl+C 退出`,
  );
  console.log("─".repeat(52));

  const hmr = new HotReloader({
    rootDir: process.cwd(),
    watchMode: usePolling ? WatchMode.Polling : WatchMode.Native,
    debounceMs: 100,
    recursive: true,
    pollIntervalMs: 1000,
  });

  hmr.on(ReloadEvent.Update, (id: string) =>
    console.log(`\n[App] 检测到模块更新: ${path.relative(process.cwd(), id)}`),
  );
  hmr.on(ReloadEvent.Error, (id: string, err: unknown) =>
    console.error(`\n[App] 模块错误: ${id}`, err),
  );
  hmr.on(ReloadEvent.Ready, (id: string) =>
    console.log(`[App] HMR 就绪，监听目录: ${id}`),
  );

  hmr.watch("src/modules");

  const timer = setInterval(() => {
    const ids = hmr.getModuleIds();
    if (ids.length > 0)
      console.log(
        `[HMR] 已注册模块 (${hmr.moduleCount}, v${hmr.storeVersion}): ${ids.join(", ")}`,
      );
  }, 5000);

  process.on("SIGINT", () => {
    clearInterval(timer);
    hmr.close();
    console.log("\n再见！");
    process.exit(0);
  });
}

function main(): void {
  const usePolling = process.argv[2] === "polling";

  // Demonstrate type guards with discriminated union
  const demoResult: ReloadResult = {
    type: "success" as const,
    moduleId: "demo",
    durationMs: 0,
    reloadCount: 0,
  };
  if (isReloadSuccess(demoResult)) console.log("[HMR] 初始化成功，准备启动...");

  // Demonstrate isModuleRecord type guard
  const sample: unknown = { id: "test", filePath: "/test", contentHash: "abc" };
  if (isModuleRecord(sample))
    console.log(`[HMR] 模块记录验证通过: ${sample.id}`);

  runNodeDemo(usePolling);
}

main();
