#!/usr/bin/env node

/**
 * Todo CLI — 高级命令行 Todo 管理工具
 * 增删改查、优先级（带颜色）、标签、分类、截止日期（逾期检测）、子任务、
 * 带相关性评分的搜索、统计面板、导出/导入（JSON/CSV）、多字段排序、批量操作、撤销/重做。
 * 存储：~/.todo-cli/todos.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================== 枚举 ==============================
enum TodoPriority {
  Low = "low",
  Medium = "medium",
  High = "high",
  Urgent = "urgent",
}
enum TodoStatus {
  Pending = "pending",
  InProgress = "in_progress",
  Completed = "completed",
  Cancelled = "cancelled",
}
enum SortField {
  CreatedAt = "createdAt",
  DueDate = "dueDate",
  Priority = "priority",
  Content = "content",
  Status = "status",
}
enum SortOrder {
  Asc = "asc",
  Desc = "desc",
}
enum FilterType {
  All = "all",
  Pending = "pending",
  Completed = "completed",
  Overdue = "overdue",
  ByTag = "by_tag",
  ByPriority = "by_priority",
  ByCategory = "by_category",
}

// ============================== 模板字面量 / 条件 / 映射类型 ==============================
type TodoId = `todo_${string}`;
type ISODate = string;
type Unwrap<T> = T extends Array<infer U> ? U : T; // 条件类型
type Maybe<T> = T | null | undefined;

interface Subtask {
  readonly id: string;
  title: string;
  done: boolean;
}

interface Todo {
  readonly id: TodoId;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  tags: string[];
  category: string | null;
  dueDate: ISODate | null;
  subtasks: Subtask[];
  createdAt: ISODate;
  updatedAt: ISODate;
  completedAt: ISODate | null;
}

/** 映射类型 + Partial/Pick */
type TodoUpdate = Partial<
  Pick<
    Todo,
    "content" | "status" | "priority" | "tags" | "category" | "dueDate"
  >
>;
/** Omit + Partial + 交叉 */
type AddTodoOptions = Partial<
  Omit<
    Todo,
    "id" | "status" | "subtasks" | "createdAt" | "updatedAt" | "completedAt"
  >
> & { content: string };
type NewTodoInput = Omit<
  Todo,
  "id" | "createdAt" | "updatedAt" | "completedAt"
>;

// ============================== 判别联合 ==============================
type Command =
  | {
      readonly type: "add";
      content: string;
      priority?: TodoPriority;
      tags?: string[];
      category?: string | null;
      dueDate?: string | null;
    }
  | { readonly type: "list"; filter?: FilterType; value?: string }
  | { readonly type: "done"; id: string }
  | { readonly type: "undone"; id: string }
  | { readonly type: "edit"; id: string; content: string }
  | { readonly type: "delete"; id: string }
  | { readonly type: "clear" }
  | { readonly type: "stats" }
  | { readonly type: "tag"; id: string; tag: string; action: "add" | "remove" }
  | {
      readonly type: "subtask";
      id: string;
      action: "add" | "done" | "remove";
      title: string;
    }
  | { readonly type: "search"; query: string }
  | { readonly type: "sort"; field: SortField; order: SortOrder }
  | { readonly type: "export"; format: "json" | "csv" }
  | { readonly type: "import"; format: "json"; file: string }
  | { readonly type: "batch-complete" }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "help" };

type TodoEvent =
  | { readonly kind: "added"; todo: Todo }
  | { readonly kind: "updated"; todo: Todo; changes: TodoUpdate }
  | { readonly kind: "deleted"; todo: Todo }
  | { readonly kind: "completed"; todo: Todo }
  | { readonly kind: "batch"; count: number };

// ============================== 自定义错误层级 ==============================
class TodoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "TodoError";
  }
}
class NotFoundError extends TodoError {
  constructor(id: string) {
    super(`未找到 ID 为 '${id}' 的任务。`, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}
class ValidationError extends TodoError {
  constructor(message: string) {
    super(message, "VALIDATION");
    this.name = "ValidationError";
  }
}
class DuplicateError extends TodoError {
  constructor(field: string, value: string) {
    super(`字段 ${field} 重复：'${value}'。`, "DUPLICATE");
    this.name = "DuplicateError";
  }
}

// ============================== 类型守卫 ==============================
function isTodoPriority(v: unknown): v is TodoPriority {
  return (
    typeof v === "string" &&
    Object.values(TodoPriority).includes(v as TodoPriority)
  );
}
function isTodoStatus(v: unknown): v is TodoStatus {
  return (
    typeof v === "string" && Object.values(TodoStatus).includes(v as TodoStatus)
  );
}
function isTodo(v: unknown): v is Todo {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    t.id.startsWith("todo_") &&
    typeof t.content === "string" &&
    isTodoStatus(t.status) &&
    isTodoPriority(t.priority) &&
    Array.isArray(t.tags) &&
    Array.isArray(t.subtasks) &&
    typeof t.createdAt === "string"
  );
}

// ============================== Symbol & as const ==============================
const INTERNAL = Symbol("internal");
const VERSION = Symbol("version");

const PRIORITY_RANK = {
  [TodoPriority.Urgent]: 4,
  [TodoPriority.High]: 3,
  [TodoPriority.Medium]: 2,
  [TodoPriority.Low]: 1,
} as const;
const PRIORITY_COLOR: Readonly<Record<TodoPriority, string>> = {
  [TodoPriority.Urgent]: "\x1b[31m",
  [TodoPriority.High]: "\x1b[33m",
  [TodoPriority.Medium]: "\x1b[36m",
  [TodoPriority.Low]: "\x1b[37m",
};
const STATUS_COLOR: Readonly<Record<TodoStatus, string>> = {
  [TodoStatus.Pending]: "\x1b[37m",
  [TodoStatus.InProgress]: "\x1b[34m",
  [TodoStatus.Completed]: "\x1b[32m",
  [TodoStatus.Cancelled]: "\x1b[90m",
};
const RESET = "\x1b[0m";
const COMMAND_ALIASES = {
  add: "add",
  new: "add",
  list: "list",
  ls: "list",
  done: "done",
  complete: "done",
  undone: "undone",
  incomplete: "undone",
  edit: "edit",
  update: "edit",
  delete: "delete",
  del: "delete",
  rm: "delete",
  clear: "clear",
  clean: "clear",
  stats: "stats",
  stat: "stats",
  tag: "tag",
  tags: "tag",
  subtask: "subtask",
  st: "subtask",
  search: "search",
  find: "search",
  sort: "sort",
  export: "export",
  exp: "export",
  import: "import",
  imp: "import",
  "batch-complete": "batch-complete",
  bc: "batch-complete",
  undo: "undo",
  redo: "redo",
  help: "help",
  "--help": "help",
  "-h": "help",
} as const;

const DATA_DIR: string = path.join(os.homedir(), ".todo-cli");
const DATA_FILE: string = path.join(DATA_DIR, "todos.json");

interface TodoStoreData {
  nextSeq: number;
  todos: Todo[];
  [key: string]: unknown;
}

// ============================== 生成器 ==============================
function* iterateTodos(
  todos: readonly Todo[],
): Generator<Todo, void, undefined> {
  for (const t of todos) yield t;
}
function* iterateFiltered(
  todos: readonly Todo[],
  pred: (t: Todo) => boolean,
): Generator<Todo> {
  for (const t of todos) if (pred(t)) yield t;
}

// ============================== 泛型集合 ==============================
class Collection<T extends { id: string }> implements Iterable<T> {
  protected readonly items: Map<string, T> = new Map();
  [Symbol.iterator](): Iterator<T> {
    let i = 0;
    const arr = [...this.items.values()];
    return {
      next: (): IteratorResult<T> =>
        i < arr.length
          ? { value: arr[i++]!, done: false }
          : { value: undefined as unknown as T, done: true },
    };
  }
  get size(): number {
    return this.items.size;
  }
  add(item: T): void {
    if (this.items.has(item.id)) throw new DuplicateError("id", item.id);
    this.items.set(item.id, item);
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  remove(id: string): boolean {
    return this.items.delete(id);
  }
  toArray(): T[] {
    return [...this.items.values()];
  }
}

// ============================== 泛型仓库接口 ==============================
interface Repository<T extends { id: string }> {
  findAll(): readonly T[];
  findById(id: string): T | undefined;
  save(item: T): T;
  delete(id: string): boolean;
}

// ============================== 抽象类 + 过滤器 ==============================
abstract class AbstractTodoStore {
  protected abstract data: TodoStoreData;
  abstract load(): void;
  abstract persist(): void;
  abstract snapshot(): readonly Todo[];
  get count(): number {
    return this.data.todos.length;
  }
}

abstract class AbstractTodoFilter {
  abstract match(todo: Todo): boolean;
  and(other: AbstractTodoFilter): AbstractTodoFilter {
    const self = this;
    return new (class extends AbstractTodoFilter {
      match(t: Todo): boolean {
        return self.match(t) && other.match(t);
      }
    })();
  }
}
class TagFilter extends AbstractTodoFilter {
  constructor(private readonly tag: string) {
    super();
  }
  match(t: Todo): boolean {
    return t.tags.includes(this.tag);
  }
}
class PriorityFilter extends AbstractTodoFilter {
  constructor(private readonly p: TodoPriority) {
    super();
  }
  match(t: Todo): boolean {
    return t.priority === this.p;
  }
}
class CategoryFilter extends AbstractTodoFilter {
  constructor(private readonly c: string) {
    super();
  }
  match(t: Todo): boolean {
    return t.category === this.c;
  }
}
class StatusFilter extends AbstractTodoFilter {
  constructor(private readonly s: TodoStatus) {
    super();
  }
  match(t: Todo): boolean {
    return t.status === this.s;
  }
}
class OverdueFilter extends AbstractTodoFilter {
  match(t: Todo): boolean {
    return (
      !!t.dueDate &&
      t.status !== TodoStatus.Completed &&
      new Date(t.dueDate).getTime() < Date.now()
    );
  }
}
class AllFilter extends AbstractTodoFilter {
  match(): boolean {
    return true;
  }
}

// ============================== 历史栈（撤销/重做） ==============================
interface HistoryEntry {
  readonly todos: readonly Todo[];
  readonly nextSeq: number;
  readonly label: string;
}
class HistoryStack {
  private readonly undo: HistoryEntry[] = [];
  private readonly redo: HistoryEntry[] = [];
  constructor(private readonly capacity = 50) {}
  push(entry: HistoryEntry): void {
    this.undo.push(entry);
    if (this.undo.length > this.capacity) this.undo.shift();
    this.redo.length = 0;
  }
  canUndo(): boolean {
    return this.undo.length > 0;
  }
  canRedo(): boolean {
    return this.redo.length > 0;
  }
  popUndo(): HistoryEntry | undefined {
    return this.undo.pop();
  }
  pushRedo(entry: HistoryEntry): void {
    this.redo.push(entry);
  }
  popRedo(): HistoryEntry | undefined {
    return this.redo.pop();
  }
}

// ============================== 主存储实现 ==============================
class TodoStore extends AbstractTodoStore implements Repository<Todo> {
  protected data: TodoStoreData;
  private readonly history = new HistoryStack(50);
  [INTERNAL] = true as const;
  [VERSION] = 2 as const;

  constructor() {
    super();
    this.data = { nextSeq: 1, todos: [] };
  }
  get totalCount(): number {
    return this.data.todos.length;
  }
  get overdueCount(): number {
    const now = Date.now();
    return this.data.todos.filter(
      (t) =>
        !!t.dueDate &&
        t.status !== TodoStatus.Completed &&
        new Date(t.dueDate).getTime() < now,
    ).length;
  }
  load(): void {
    this.ensureFile();
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw) as TodoStoreData;
      if (typeof parsed.nextSeq !== "number" || !Array.isArray(parsed.todos))
        throw new ValidationError("数据文件格式不正确。");
      this.data = {
        nextSeq: parsed.nextSeq,
        todos: parsed.todos.filter(isTodo),
      };
    } catch (err) {
      console.error("读取数据失败，使用空数据：", (err as Error).message);
      this.data = { nextSeq: 1, todos: [] };
    }
  }
  persist(): void {
    this.ensureFile();
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }
  snapshot(): readonly Todo[] {
    return this.data.todos;
  }
  private ensureFile(): void {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE))
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ nextSeq: 1, todos: [] }, null, 2),
        "utf-8",
      );
  }
  private cloneTodos(todos: readonly Todo[]): Todo[] {
    return todos.map((t) => ({
      ...t,
      tags: [...t.tags],
      subtasks: t.subtasks.map((s) => ({ ...s })),
    }));
  }
  private checkpoint(label: string): void {
    this.history.push({
      todos: this.cloneTodos(this.data.todos),
      nextSeq: this.data.nextSeq,
      label,
    });
  }
  nextId(): TodoId {
    return `todo_${this.data.nextSeq++}`;
  }
  findAll(): readonly Todo[] {
    return this.data.todos;
  }
  findById(id: string): Todo | undefined {
    return this.data.todos.find((t) => t.id === id);
  }
  save(item: Todo): Todo {
    const idx = this.data.todos.findIndex((t) => t.id === item.id);
    if (idx === -1) this.data.todos.push(item);
    else this.data.todos[idx] = item;
    return item;
  }
  delete(id: string): boolean {
    const idx = this.data.todos.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.data.todos.splice(idx, 1);
    return true;
  }
  require(id: string): Todo {
    const t = this.findById(id);
    if (!t) throw new NotFoundError(id);
    return t;
  }
  mutate(id: string, label: string, fn: (t: Todo) => void): Todo {
    const t = this.require(id);
    this.checkpoint(label);
    fn(t);
    t.updatedAt = new Date().toISOString();
    this.persist();
    return t;
  }
  commit(label: string, fn: () => void): void {
    this.checkpoint(label);
    fn();
    this.persist();
  }
  undo(): boolean {
    if (!this.history.canUndo()) return false;
    const entry = this.history.popUndo()!;
    this.history.pushRedo({
      todos: this.cloneTodos(this.data.todos),
      nextSeq: this.data.nextSeq,
      label: entry.label,
    });
    this.data.todos = this.cloneTodos(entry.todos);
    this.data.nextSeq = entry.nextSeq;
    this.persist();
    return true;
  }
  redo(): boolean {
    if (!this.history.canRedo()) return false;
    const entry = this.history.popRedo()!;
    this.history.push({
      todos: this.cloneTodos(this.data.todos),
      nextSeq: this.data.nextSeq,
      label: entry.label,
    });
    this.data.todos = this.cloneTodos(entry.todos);
    this.data.nextSeq = entry.nextSeq;
    this.persist();
    return true;
  }
}

// ============================== 排序 ==============================
type SortSpec = readonly [SortField, SortOrder];
type SortSpecs = Parameters<typeof sortTodos>[1];
function compareTodos(a: Todo, b: Todo, field: SortField): number {
  switch (field) {
    case SortField.CreatedAt:
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case SortField.DueDate: {
      const ad = a.dueDate
        ? new Date(a.dueDate).getTime()
        : Number.POSITIVE_INFINITY;
      const bd = b.dueDate
        ? new Date(b.dueDate).getTime()
        : Number.POSITIVE_INFINITY;
      return ad - bd;
    }
    case SortField.Priority:
      return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    case SortField.Content:
      return a.content.localeCompare(b.content);
    case SortField.Status:
      return a.status.localeCompare(b.status);
  }
}
function sortTodos(todos: readonly Todo[], specs: readonly SortSpec[]): Todo[] {
  const arr = [...todos];
  arr.sort((a, b) => {
    for (const [field, order] of specs) {
      const cmp = compareTodos(a, b, field);
      if (cmp !== 0) return order === SortOrder.Asc ? cmp : -cmp;
    }
    return 0;
  });
  return arr;
}

// ============================== 带相关性的搜索 ==============================
type SearchResult = readonly [Todo, number];
function searchTodos(todos: readonly Todo[], query: string): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results: SearchResult[] = [];
  for (const t of iterateTodos(todos)) {
    let score = 0;
    const content = t.content.toLowerCase();
    if (content === q) score += 100;
    if (content.includes(q)) score += 50;
    if (t.tags.some((tag) => tag.toLowerCase().includes(q))) score += 20;
    if (t.category?.toLowerCase().includes(q)) score += 15;
    for (const st of t.subtasks)
      if (st.title.toLowerCase().includes(q)) score += 5;
    if (score > 0) results.push([t, score] as const);
  }
  results.sort((a, b) => b[1] - a[1]);
  return results;
}

// ============================== 统计 ==============================
type StatsTuple = readonly [number, number, number, number];
interface StatsDashboard {
  readonly total: number;
  readonly byPriority: Readonly<Record<TodoPriority, number>>;
  readonly byStatus: Readonly<Record<TodoStatus, number>>;
  readonly byCategory: Record<string, number>;
  readonly byTag: Record<string, number>;
  readonly overdueCount: number;
  readonly completionTuple: StatsTuple;
}
function computeStats(todos: readonly Todo[]): StatsDashboard {
  const byPriority = {
    [TodoPriority.Low]: 0,
    [TodoPriority.Medium]: 0,
    [TodoPriority.High]: 0,
    [TodoPriority.Urgent]: 0,
  } as Record<TodoPriority, number>;
  const byStatus = {
    [TodoStatus.Pending]: 0,
    [TodoStatus.InProgress]: 0,
    [TodoStatus.Completed]: 0,
    [TodoStatus.Cancelled]: 0,
  } as Record<TodoStatus, number>;
  const byCategory: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  let overdue = 0;
  let done = 0;
  for (const t of iterateTodos(todos)) {
    byPriority[t.priority]++;
    byStatus[t.status]++;
    if (t.category) byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    for (const tag of t.tags) byTag[tag] = (byTag[tag] ?? 0) + 1;
    if (t.status === TodoStatus.Completed) done++;
    if (
      t.dueDate &&
      t.status !== TodoStatus.Completed &&
      new Date(t.dueDate).getTime() < Date.now()
    )
      overdue++;
  }
  const total = todos.length;
  const pending = total - done;
  return {
    total,
    byPriority,
    byStatus,
    byCategory,
    byTag,
    overdueCount: overdue,
    completionTuple: [total, done, pending, overdue] as const,
  };
}

// ============================== 搜索会话（getter/setter） ==============================
class SearchSession {
  private _query = "";
  get query(): string {
    return this._query;
  }
  set query(v: string) {
    this._query = v.trim().toLowerCase();
  }
  constructor(initial?: string) {
    if (initial) this.query = initial;
  }
}

// ============================== 格式化 / 显示 ==============================
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function divider(char = "─", len = 60): string {
  return char.repeat(len);
}
function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}
function priorityBadge(p: TodoPriority): string {
  return colorize(`[${p.toUpperCase()}]`, PRIORITY_COLOR[p]);
}
function statusBadge(s: TodoStatus): string {
  return colorize(`(${s})`, STATUS_COLOR[s]);
}

// ============================== 导出 / 导入 ==============================
function exportJSON(todos: readonly Todo[]): string {
  return JSON.stringify(todos, null, 2);
}
function exportCSV(todos: readonly Todo[]): string {
  const header = [
    "id",
    "content",
    "status",
    "priority",
    "tags",
    "category",
    "dueDate",
    "createdAt",
    "completedAt",
  ];
  const escape = (v: unknown): string =>
    `"${(v === null ? "" : String(v)).replace(/"/g, '""')}"`;
  const rows = todos.map((t) =>
    [
      t.id,
      t.content,
      t.status,
      t.priority,
      t.tags.join("|"),
      t.category,
      t.dueDate,
      t.createdAt,
      t.completedAt,
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
function importJSON(text: string): Todo[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new ValidationError("导入数据应为数组。");
  return parsed.filter(isTodo);
}

// ============================== 函数重载 ==============================
function parsePriority(v: string | undefined): TodoPriority;
function parsePriority(
  v: string | undefined,
  fallback: TodoPriority,
): TodoPriority;
function parsePriority(
  v?: string,
  fallback: TodoPriority = TodoPriority.Medium,
): TodoPriority {
  if (v && isTodoPriority(v)) return v;
  return fallback;
}
function parseDueDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`无效的日期：${v}`);
  return d.toISOString();
}
function parseTags(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ============================== 命令实现 ==============================
function cmdAdd(store: TodoStore, opts: AddTodoOptions): void {
  const content = opts.content.trim();
  if (!content) throw new ValidationError("任务内容不能为空。");
  const now = new Date().toISOString();
  const todo: Todo = {
    id: store.nextId(),
    content,
    status: TodoStatus.Pending,
    priority: opts.priority ?? TodoPriority.Medium,
    tags: opts.tags ?? [],
    category: opts.category ?? null,
    dueDate: opts.dueDate ?? null,
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  store.commit("add", () => store.save(todo));
  console.log(
    `已添加任务 ${todo.id}：${todo.content} ${priorityBadge(todo.priority)}`,
  );
}

function cmdList(
  store: TodoStore,
  filter: AbstractTodoFilter = new AllFilter(),
): void {
  const filtered = [
    ...iterateFiltered(store.findAll(), (t) => filter.match(t)),
  ];
  if (filtered.length === 0) {
    console.log("暂无任务。使用 `todo-cli add <内容>` 添加一条新任务。");
    return;
  }
  console.log();
  console.log(`  Todo 列表 (共 ${filtered.length} 项)`);
  console.log(`  ${divider()}`);
  for (const t of filtered) {
    const check =
      t.status === TodoStatus.Completed
        ? "x"
        : t.status === TodoStatus.InProgress
          ? "~"
          : " ";
    const text =
      t.status === TodoStatus.Completed
        ? `\x1b[9m${t.content}\x1b[0m`
        : t.content;
    const overdue =
      t.dueDate &&
      t.status !== TodoStatus.Completed &&
      new Date(t.dueDate).getTime() < Date.now()
        ? colorize(" (逾期)", "\x1b[31m")
        : "";
    const tags = t.tags.length
      ? colorize(` #${t.tags.join(" #")}`, "\x1b[35m")
      : "";
    const cat = t.category ? colorize(` [${t.category}]`, "\x1b[34m") : "";
    console.log(
      `  [${check}] ${t.id}  ${text} ${priorityBadge(t.priority)}${statusBadge(t.status)}${cat}${tags}${overdue}`,
    );
  }
  console.log(`  ${divider()}`);
  console.log();
}

function cmdDone(store: TodoStore, id: string): void {
  const existing = store.findById(id);
  if (!existing) throw new NotFoundError(id);
  if (existing.status === TodoStatus.Completed) {
    console.log(`任务 ${existing.id} 已经是完成状态。`);
    return;
  }
  const t = store.mutate(id, "done", (todo) => {
    todo.status = TodoStatus.Completed;
    todo.completedAt = new Date().toISOString();
  });
  console.log(`已完成任务 ${t.id}：${t.content}`);
}
function cmdUndone(store: TodoStore, id: string): void {
  const existing = store.findById(id);
  if (!existing) throw new NotFoundError(id);
  if (existing.status !== TodoStatus.Completed) {
    console.log(`任务 ${existing.id} 已经是未完成状态。`);
    return;
  }
  const t = store.mutate(id, "undone", (todo) => {
    todo.status = TodoStatus.Pending;
    todo.completedAt = null;
  });
  console.log(`已取消完成任务 ${t.id}：${t.content}`);
}
function cmdEdit(store: TodoStore, id: string, content: string): void {
  const c = content.trim();
  if (!c) throw new ValidationError("新任务内容不能为空。");
  const t = store.mutate(id, "edit", (todo) => {
    todo.content = c;
  });
  console.log(`已编辑任务 ${t.id}：${t.content}`);
}
function cmdDelete(store: TodoStore, id: string): void {
  const t = store.require(id);
  store.commit("delete", () => store.delete(id));
  console.log(`已删除任务 ${t.id}：${t.content}`);
}
function cmdClear(store: TodoStore): void {
  const completed = store
    .findAll()
    .filter((t) => t.status === TodoStatus.Completed);
  if (completed.length === 0) {
    console.log("没有已完成的任务需要清除。");
    return;
  }
  store.commit("clear", () => {
    for (const t of completed) store.delete(t.id);
  });
  console.log(`已清除 ${completed.length} 项已完成的任务。`);
}
function cmdTag(
  store: TodoStore,
  id: string,
  tag: string,
  action: "add" | "remove",
): void {
  const tg = tag.trim();
  if (!tg) throw new ValidationError("标签不能为空。");
  const t = store.mutate(id, "tag", (todo) => {
    if (action === "add") {
      if (!todo.tags.includes(tg)) todo.tags.push(tg);
    } else {
      todo.tags = todo.tags.filter((x) => x !== tg);
    }
  });
  console.log(
    `已${action === "add" ? "添加" : "移除"}标签 '${tg}'：${t.id} #${t.tags.join(" #")}`,
  );
}
function cmdSubtask(
  store: TodoStore,
  id: string,
  action: "add" | "done" | "remove",
  title: string,
): void {
  const t = store.mutate(id, "subtask", (todo) => {
    const tt = title.trim();
    if (action === "add") {
      if (!tt) throw new ValidationError("子任务标题不能为空。");
      todo.subtasks.push({
        id: `st_${Math.random().toString(36).slice(2, 8)}`,
        title: tt,
        done: false,
      });
    } else if (action === "done") {
      const st = todo.subtasks.find((s) => s.title === tt);
      if (st) st.done = true;
    } else {
      todo.subtasks = todo.subtasks.filter((s) => s.title !== tt);
    }
  });
  const list = t.subtasks.length
    ? t.subtasks.map((s) => `${s.done ? "x" : " "} ${s.title}`).join(" | ")
    : "（无子任务）";
  console.log(`子任务操作 (${action}) on ${t.id}：${list}`);
}
function cmdSearch(store: TodoStore, query: string): void {
  const session = new SearchSession(query);
  if (!session.query) {
    console.log("请提供搜索关键词。");
    return;
  }
  const results = searchTodos(store.findAll(), session.query);
  if (results.length === 0) {
    console.log(`未找到匹配 '${query}' 的任务。`);
    return;
  }
  console.log(`搜索 '${query}' 结果 (共 ${results.length} 项，按相关性排序)：`);
  for (const [t, score] of results)
    console.log(`  ${t.id}  [${score}分]  ${t.content}`);
}
function cmdSort(store: TodoStore, field: SortField, order: SortOrder): void {
  const specs: SortSpecs = [[field, order] as const];
  const sorted = sortTodos(store.findAll(), specs);
  console.log(`排序 (${field} ${order})：`);
  for (const t of sorted)
    console.log(`  ${t.id}  ${t.content} ${priorityBadge(t.priority)}`);
}
function cmdExport(store: TodoStore, format: "json" | "csv"): void {
  const todos = store.findAll();
  const content = format === "json" ? exportJSON(todos) : exportCSV(todos);
  const file = path.join(DATA_DIR, `export.${format}`);
  fs.writeFileSync(file, content, "utf-8");
  console.log(`已导出 ${todos.length} 项任务到 ${file}`);
}
function cmdImport(store: TodoStore, file: string): void {
  if (!file) throw new ValidationError("请指定导入文件路径。");
  if (!fs.existsSync(file))
    throw new ValidationError(`导入文件不存在：${file}`);
  const imported = importJSON(fs.readFileSync(file, "utf-8"));
  store.commit("import", () => {
    for (const t of imported) store.save({ ...t });
  });
  console.log(`已导入 ${imported.length} 项任务。`);
}
function cmdBatchComplete(store: TodoStore): void {
  const pending = store
    .findAll()
    .filter((t) => t.status !== TodoStatus.Completed);
  if (pending.length === 0) {
    console.log("没有可批量完成的任务。");
    return;
  }
  store.commit("batch-complete", () => {
    const now = new Date().toISOString();
    for (const t of pending) {
      t.status = TodoStatus.Completed;
      t.completedAt = now;
      t.updatedAt = now;
      store.save(t);
    }
  });
  console.log(`已批量完成 ${pending.length} 项任务。`);
}
function cmdUndo(store: TodoStore): void {
  console.log(store.undo() ? "已撤销上一步操作。" : "没有可撤销的操作。");
}
function cmdRedo(store: TodoStore): void {
  console.log(store.redo() ? "已重做。" : "没有可重做的操作。");
}

function cmdStats(store: TodoStore): void {
  const s: ReturnType<typeof computeStats> = computeStats(store.findAll());
  if (s.total === 0) {
    console.log("暂无任务，无统计信息。");
    return;
  }
  const [total, done, pending, overdue] = s.completionTuple;
  const pct = Math.round((done / total) * 100);
  const barLen = 24;
  const filled = Math.round((done / total) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
  console.log();
  console.log(`  Todo 统计面板`);
  console.log(`  ${divider("═", 48)}`);
  console.log(
    `  总数：${total}   完成：${done}   未完成：${pending}   逾期：${overdue}`,
  );
  console.log(`  完成率：${bar} ${pct}%`);
  console.log(`  ${divider("─", 48)}`);
  console.log(`  按优先级：`);
  for (const p of Object.values(TodoPriority))
    console.log(`    ${priorityBadge(p)} ${s.byPriority[p]}`);
  console.log(`  按状态：`);
  for (const st of Object.values(TodoStatus))
    console.log(`    ${statusBadge(st)} ${s.byStatus[st]}`);
  if (Object.keys(s.byCategory).length) {
    console.log(`  按分类：`);
    for (const [c, n] of Object.entries(s.byCategory))
      console.log(`    ${c}: ${n}`);
  }
  if (Object.keys(s.byTag).length) {
    console.log(`  按标签：`);
    for (const [tg, n] of Object.entries(s.byTag))
      console.log(`    #${tg}: ${n}`);
  }
  console.log(`  ${divider("═", 48)}`);
  console.log();
}

function cmdHelp(): void {
  console.log(
    [
      "Todo CLI — 高级命令行 Todo 管理工具",
      "",
      "用法： todo-cli <command> [args...]",
      "",
      "命令：",
      "  add <内容> [--priority=low|medium|high|urgent] [--tags=a,b] [--category=x] [--due=2025-12-31]",
      "  list [--filter=all|pending|completed|overdue|by_tag:xxx|by_priority:high|by_category:work]",
      "  done <id>            标记完成",
      "  undone <id>          取消完成",
      "  edit <id> <内容>     编辑内容",
      "  delete <id>          删除任务",
      "  clear                清除所有已完成",
      "  tag <id> <tag> <add|remove>",
      "  subtask <id> <add|done|remove> <标题>",
      "  search <关键词>      搜索（带相关性评分）",
      "  sort <field> <order> field: createdAt|dueDate|priority|content|status  order: asc|desc",
      "  export <json|csv>    导出",
      "  import <file>        导入 JSON",
      "  batch-complete       批量完成所有未完成",
      "  undo / redo          撤销 / 重做",
      "  stats                统计面板",
      "  help                 帮助",
      "",
      "别名：add→new, list→ls, delete→rm/del, search→find, export→exp 等",
      "",
      "数据存储：" + DATA_FILE,
    ].join("\n"),
  );
}

// ============================== 过滤器工厂 & 参数解析 ==============================
function makeFilter(arg?: string): AbstractTodoFilter {
  if (!arg || arg === "all") return new AllFilter();
  if (arg === "pending") return new StatusFilter(TodoStatus.Pending);
  if (arg === "completed") return new StatusFilter(TodoStatus.Completed);
  if (arg === "overdue") return new OverdueFilter();
  if (arg.startsWith("by_tag:")) return new TagFilter(arg.slice(7));
  if (arg.startsWith("by_priority:")) {
    const p = arg.slice(12);
    return isTodoPriority(p) ? new PriorityFilter(p) : new AllFilter();
  }
  if (arg.startsWith("by_category:")) return new CategoryFilter(arg.slice(13));
  return new AllFilter();
}
function parseFlag(args: string[], flag: string): string | undefined {
  const p = `--${flag}=`;
  const found = args.find((a) => a.startsWith(p));
  return found ? found.slice(p.length) : undefined;
}

// ============================== 命令分发 ==============================
function dispatch(store: TodoStore, cmd: Command): void {
  switch (cmd.type) {
    case "add":
      cmdAdd(store, cmd);
      break;
    case "list":
      cmdList(store, makeFilter(cmd.value));
      break;
    case "done":
      cmdDone(store, cmd.id);
      break;
    case "undone":
      cmdUndone(store, cmd.id);
      break;
    case "edit":
      cmdEdit(store, cmd.id, cmd.content);
      break;
    case "delete":
      cmdDelete(store, cmd.id);
      break;
    case "clear":
      cmdClear(store);
      break;
    case "stats":
      cmdStats(store);
      break;
    case "tag":
      cmdTag(store, cmd.id, cmd.tag, cmd.action);
      break;
    case "subtask":
      cmdSubtask(store, cmd.id, cmd.action, cmd.title);
      break;
    case "search":
      cmdSearch(store, cmd.query);
      break;
    case "sort":
      cmdSort(store, cmd.field, cmd.order);
      break;
    case "export":
      cmdExport(store, cmd.format);
      break;
    case "import":
      cmdImport(store, cmd.file);
      break;
    case "batch-complete":
      cmdBatchComplete(store);
      break;
    case "undo":
      cmdUndo(store);
      break;
    case "redo":
      cmdRedo(store);
      break;
    case "help":
      cmdHelp();
      break;
  }
}

// ============================== 命令构建（satisfies） ==============================
function buildCommand(argv: string[]): Command {
  const raw = argv[0] ?? "help";
  const canonical = (COMMAND_ALIASES as Record<string, string>)[raw] ?? raw;
  const rest = argv.slice(1);
  switch (canonical) {
    case "add":
      return {
        type: "add",
        content: rest.filter((a) => !a.startsWith("--")).join(" "),
        priority: parsePriority(parseFlag(rest, "priority")),
        tags: parseTags(parseFlag(rest, "tags")),
        category: parseFlag(rest, "category"),
        dueDate: parseDueDate(parseFlag(rest, "due")),
      } satisfies Command;
    case "list":
      return {
        type: "list",
        value: parseFlag(rest, "filter"),
      } satisfies Command;
    case "done":
      return { type: "done", id: rest[0] ?? "" } satisfies Command;
    case "undone":
      return { type: "undone", id: rest[0] ?? "" } satisfies Command;
    case "edit":
      return {
        type: "edit",
        id: rest[0] ?? "",
        content: rest.slice(1).join(" "),
      } satisfies Command;
    case "delete":
      return { type: "delete", id: rest[0] ?? "" } satisfies Command;
    case "clear":
      return { type: "clear" } satisfies Command;
    case "stats":
      return { type: "stats" } satisfies Command;
    case "tag":
      return {
        type: "tag",
        id: rest[0] ?? "",
        tag: rest[1] ?? "",
        action: rest[2] === "remove" ? "remove" : "add",
      } satisfies Command;
    case "subtask":
      return {
        type: "subtask",
        id: rest[0] ?? "",
        action:
          rest[1] === "done" ? "done" : rest[1] === "remove" ? "remove" : "add",
        title: rest.slice(2).join(" "),
      } satisfies Command;
    case "search":
      return { type: "search", query: rest.join(" ") } satisfies Command;
    case "sort":
      return {
        type: "sort",
        field: rest[0] ? (rest[0] as SortField) : SortField.CreatedAt,
        order: rest[1] ? (rest[1] as SortOrder) : SortOrder.Asc,
      } satisfies Command;
    case "export":
      return {
        type: "export",
        format: rest[0] === "csv" ? "csv" : "json",
      } satisfies Command;
    case "import":
      return {
        type: "import",
        format: "json",
        file: rest[0] ?? "",
      } satisfies Command;
    case "batch-complete":
      return { type: "batch-complete" } satisfies Command;
    case "undo":
      return { type: "undo" } satisfies Command;
    case "redo":
      return { type: "redo" } satisfies Command;
    default:
      return { type: "help" } satisfies Command;
  }
}

// ============================== 入口 ==============================
function main(): void {
  const argv = process.argv.slice(2);
  const store = new TodoStore();
  store.load();
  try {
    const cmd = buildCommand(argv);
    dispatch(store, cmd);
  } catch (err) {
    if (err instanceof TodoError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
