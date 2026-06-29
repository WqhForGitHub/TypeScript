#!/usr/bin/env node

/**
 * 简单记事本 CLI（增强版）
 *
 * 在原有 CRUD + 搜索基础上引入：标签 / 优先级 / 状态 / 排序 / 模板 /
 * 全文搜索(评分) / 导入导出 / 统计 / 彩色输出，并演示大量 TS 高级特性：
 * 枚举、泛型约束、判别联合、映射类型、条件类型、模板字面量类型、类型守卫、
 * 工具类型、元组、抽象类、函数重载、as const、自定义错误层次、索引签名、
 * satisfies、getter/setter、生成器/迭代器、Symbol、可选链与空值合并。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

/* ===== 枚举 ===== */
enum NotePriority {
  Low = "low",
  Medium = "medium",
  High = "high",
  Urgent = "urgent",
}
enum NoteStatus {
  Draft = "draft",
  Active = "active",
  Archived = "archived",
  Deleted = "deleted",
}
enum SortField {
  CreatedAt = "createdAt",
  UpdatedAt = "updatedAt",
  Title = "title",
  Priority = "priority",
}
enum SortOrder {
  Asc = "asc",
  Desc = "desc",
}
enum OutputFormat {
  Text = "text",
  JSON = "json",
}

/* ===== 类型系统：模板字面量 / 接口(只读+可选+索引签名) / 工具类型 ===== */
type NoteId = `note_${string}`;

interface NoteCore {
  title: string;
  content: string;
  tags: string[];
  priority: NotePriority;
  status: NoteStatus;
}

interface Note extends NoteCore {
  readonly id: NoteId;
  readonly createdAt: string;
  updatedAt: string;
  [meta: string]: unknown; // 索引签名
}

interface NoteStore {
  nextSeq: number;
  notes: Note[];
}

interface NoteInput extends Partial<NoteCore> {
  title: string;
  content: string;
}

interface NoteTemplate {
  readonly name: string;
  title: string;
  content: string;
  readonly tags?: readonly string[];
  priority?: NotePriority;
}

// Omit / Pick / Partial / Readonly 工具类型演示
type NoteSummary = Omit<NoteCore, "content">;
type NoteUpdate = Partial<
  Pick<Note, "title" | "content" | "tags" | "priority" | "status">
>;

// 映射类型：每个字段一个校验器
type NoteValidator<K extends keyof Note> = (value: Note[K]) => boolean;
type Validators = {
  [K in "title" | "content" | "tags" | "priority" | "status"]: NoteValidator<K>;
};

// 判别联合：命令 / 事件
type Command =
  | {
      type: "list";
      sortField: SortField;
      sortOrder: SortOrder;
      format: OutputFormat;
    }
  | {
      type: "add";
      title: string;
      tags: readonly string[];
      priority: NotePriority;
      template?: string;
    }
  | { type: "view"; id: NoteId }
  | { type: "edit"; id: NoteId }
  | { type: "delete"; id: NoteId }
  | { type: "search"; keyword: string; minScore: number }
  | {
      type: "tag";
      action: "add" | "remove";
      id: NoteId;
      tags: readonly string[];
    }
  | { type: "export"; file: string }
  | { type: "import"; file: string }
  | { type: "stats" }
  | { type: "help" };

type NoteEvent =
  | { type: "created"; note: Note }
  | { type: "updated"; note: Note; changes: Partial<Note> }
  | { type: "deleted"; id: NoteId };

// 条件类型
type EventEntity<E extends NoteEvent> = E extends { note: infer N }
  ? N
  : E extends { id: infer I }
    ? I
    : never;
type Unwrap<T> = T extends Promise<infer U> ? U : T;

// 只读元组：搜索结果 = [笔记, 分数, 命中字段]
type SearchResult = readonly [
  note: Note,
  score: number,
  fields: readonly string[],
];

// 泛型约束：仓储
interface Identifiable {
  readonly id: string;
}
interface Repository<T extends Identifiable> {
  findAll(): T[];
  findById(id: string): T | undefined;
  add(item: T): void;
  update(id: string, changes: Partial<T>): T | undefined;
  remove(id: string): T | undefined;
  [Symbol.iterator](): Iterator<T>;
}

/* ===== as const 常量 + Record ===== */
const PRIORITY_WEIGHTS = {
  [NotePriority.Low]: 1,
  [NotePriority.Medium]: 2,
  [NotePriority.High]: 3,
  [NotePriority.Urgent]: 4,
} as const;

const Colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const;
type ColorName = keyof typeof Colors;

const PRIORITY_COLOR: Record<NotePriority, ColorName> = {
  [NotePriority.Low]: "gray",
  [NotePriority.Medium]: "cyan",
  [NotePriority.High]: "yellow",
  [NotePriority.Urgent]: "red",
};

const COMMAND_ALIASES = {
  ls: "list",
  new: "add",
  show: "view",
  cat: "view",
  update: "edit",
  del: "delete",
  rm: "delete",
  find: "search",
  grep: "search",
  tags: "tag",
  exp: "export",
  imp: "import",
  stat: "stats",
  "-h": "help",
  "--help": "help",
} as const;

const KNOWN_COMMANDS = new Set<string>([
  "list",
  "add",
  "view",
  "edit",
  "delete",
  "search",
  "tag",
  "export",
  "import",
  "stats",
  "help",
]);

/* ===== Symbol ===== */
const INTERNAL = Symbol("internal");

/* ===== 自定义错误层次（抽象类） ===== */
abstract class NoteError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class NotFoundError extends NoteError {
  readonly code = "NOT_FOUND";
}
class ValidationError extends NoteError {
  readonly code = "VALIDATION";
}
class StorageError extends NoteError {
  readonly code = "STORAGE";
}
class ImportError extends NoteError {
  readonly code = "IMPORT";
}

/* ===== 模板（satisfies）+ 校验器（映射类型实例） ===== */
const DEFAULT_TEMPLATES = {
  meeting: {
    name: "meeting",
    title: "会议纪要",
    content: "## 与会人员\n\n## 议题\n\n## 决议\n",
    tags: ["meeting"],
    priority: NotePriority.Medium,
  },
  todo: {
    name: "todo",
    title: "待办清单",
    content: "- [ ] \n- [ ] \n",
    tags: ["todo"],
    priority: NotePriority.Low,
  },
} satisfies Record<string, NoteTemplate>;

const TEMPLATES: Record<string, NoteTemplate> = DEFAULT_TEMPLATES;

const NOTE_VALIDATORS: Validators = {
  title: (v) => typeof v === "string" && v.trim().length > 0,
  content: (v) => typeof v === "string",
  tags: (v) => Array.isArray(v) && v.every((t) => typeof t === "string"),
  priority: (v) => isNotePriority(v),
  status: (v) => isNoteStatus(v),
};

/* ===== 类型守卫与工具函数 ===== */
function isNote(x: unknown): x is Note {
  if (typeof x !== "object" || x === null) return false;
  const n = x as Record<string, unknown>;
  return (
    typeof n["id"] === "string" &&
    (n["id"] as string).startsWith("note_") &&
    typeof n["title"] === "string" &&
    typeof n["content"] === "string" &&
    Array.isArray(n["tags"]) &&
    isNotePriority(n["priority"]) &&
    isNoteStatus(n["status"]) &&
    typeof n["createdAt"] === "string" &&
    typeof n["updatedAt"] === "string"
  );
}
function isNotePriority(x: unknown): x is NotePriority {
  return (
    typeof x === "string" &&
    (Object.values(NotePriority) as string[]).includes(x)
  );
}
function isNoteStatus(x: unknown): x is NoteStatus {
  return (
    typeof x === "string" && (Object.values(NoteStatus) as string[]).includes(x)
  );
}
function isSortField(x: unknown): x is SortField {
  return (
    typeof x === "string" && (Object.values(SortField) as string[]).includes(x)
  );
}
function isSortOrder(x: unknown): x is SortOrder {
  return (
    typeof x === "string" && (Object.values(SortOrder) as string[]).includes(x)
  );
}
function assertNonEmpty(
  s: string | undefined,
  field: string,
): asserts s is string {
  if (!s || s.trim().length === 0)
    throw new ValidationError(`${field} 不能为空`);
}
function color(text: string, c: ColorName): string {
  return `${Colors[c]}${text}${Colors.reset}`;
}
function priorityColor(p: NotePriority): ColorName {
  return PRIORITY_COLOR[p];
}
function toSummary(n: Note): NoteSummary {
  return {
    title: n.title,
    tags: n.tags,
    priority: n.priority,
    status: n.status,
  };
}
function formatDate(iso: string): string {
  const d = new Date(iso),
    p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ===== 函数重载 ===== */
function makeId(seq: number): NoteId;
function makeId(seq: number, prefix: string): NoteId;
function makeId(seq: number, prefix = "note"): NoteId {
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}` as NoteId;
}
function parseId(input: string): NoteId;
function parseId(input: number): NoteId;
function parseId(input: string | number): NoteId {
  const s = String(input);
  return (s.startsWith("note_") ? s : `note_${s}`) as NoteId;
}

/* 兼容旧版数据：把任意笔记对象归一化为新结构（id 转 note_ 前缀，补默认 tags/优先级/状态） */
function normalizeNote(raw: unknown): Note | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rawId = r["id"];
  const id: NoteId =
    typeof rawId === "string" && rawId.startsWith("note_")
      ? (rawId as NoteId)
      : parseId(String(rawId ?? 0));
  const now = new Date().toISOString();
  return {
    id,
    title: typeof r["title"] === "string" ? r["title"] : "",
    content: typeof r["content"] === "string" ? r["content"] : "",
    tags: Array.isArray(r["tags"])
      ? (r["tags"] as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : [],
    priority: isNotePriority(r["priority"])
      ? r["priority"]
      : NotePriority.Medium,
    status: isNoteStatus(r["status"]) ? r["status"] : NoteStatus.Active,
    createdAt: typeof r["createdAt"] === "string" ? r["createdAt"] : now,
    updatedAt: typeof r["updatedAt"] === "string" ? r["updatedAt"] : now,
  };
}

/* ===== 抽象类：存储 ===== */
abstract class AbstractStorage<T> {
  protected readonly filePath: string;
  constructor(filePath: string) {
    this.filePath = filePath;
  }
  protected ensure(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  abstract load(): T;
  abstract save(items: T): void;
}

class JsonFileStorage extends AbstractStorage<NoteStore> {
  load(): NoteStore {
    this.ensure();
    if (!fs.existsSync(this.filePath)) return { nextSeq: 1, notes: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
    } catch (err) {
      throw new StorageError(`读取数据失败：${(err as Error).message}`);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { notes?: unknown }).notes)
    ) {
      throw new StorageError("数据文件格式不正确");
    }
    // 兼容旧版 nextId 字段；逐条归一化笔记
    const p = parsed as { nextSeq?: number; nextId?: number; notes: unknown[] };
    const nextSeq =
      typeof p.nextSeq === "number"
        ? p.nextSeq
        : typeof p.nextId === "number"
          ? p.nextId
          : 1;
    const notes = p.notes
      .map(normalizeNote)
      .filter((n): n is Note => n !== null);
    return { nextSeq, notes };
  }
  save(store: NoteStore): void {
    this.ensure();
    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
  }
}

/* ===== 仓储实现（生成器迭代器 + 事件） ===== */
class NoteRepository implements Repository<Note> {
  private readonly store: NoteStore;
  private readonly listeners: Array<(e: NoteEvent) => void> = [];
  constructor(private readonly storage: JsonFileStorage) {
    this.store = storage.load();
  }
  on(listener: (e: NoteEvent) => void): void {
    this.listeners.push(listener);
  }
  private emit(e: NoteEvent): void {
    for (const l of this.listeners) l(e);
  }
  private persist(): void {
    this.storage.save(this.store);
  }
  findAll(): Note[] {
    return this.store.notes.filter((n) => n.status !== NoteStatus.Deleted);
  }
  findById(id: string): Note | undefined {
    return this.findAll().find((n) => n.id === id);
  }
  add(item: Note): void {
    this.store.notes.push(item);
    this.store.nextSeq += 1;
    this.persist();
    this.emit({ type: "created", note: item });
  }
  update(id: string, changes: Partial<Note>): Note | undefined {
    const note = this.store.notes.find((n) => n.id === id);
    if (!note) return undefined;
    Object.assign(note, changes, { updatedAt: new Date().toISOString() });
    this.persist();
    this.emit({ type: "updated", note, changes });
    return note;
  }
  remove(id: string): Note | undefined {
    const idx = this.store.notes.findIndex((n) => n.id === id);
    if (idx === -1) return undefined;
    const removed = this.store.notes.splice(idx, 1)[0]!;
    this.persist();
    this.emit({ type: "deleted", id: removed.id });
    return removed;
  }
  nextSeq(): number {
    return this.store.nextSeq;
  }
  *[Symbol.iterator](): Generator<Note> {
    for (const n of this.findAll()) yield n;
  }
}

/* ===== NoteManager（getter/setter / 生成器 / Symbol / 可选链+空值合并） ===== */
class NoteManager {
  private _defaultPriority: NotePriority = NotePriority.Medium;
  [INTERNAL]: { lastTouched: NoteId | null } = { lastTouched: null };
  constructor(private readonly repo: NoteRepository) {}

  get defaultPriority(): NotePriority {
    return this._defaultPriority;
  }
  set defaultPriority(p: NotePriority) {
    if (!isNotePriority(p)) throw new ValidationError(`无效优先级：${p}`);
    this._defaultPriority = p;
  }
  get count(): number {
    return this.repo.findAll().length;
  }
  get allTags(): Set<string> {
    const s = new Set<string>();
    for (const n of this.repo) for (const t of n.tags) s.add(t);
    return s;
  }
  private touch(id: NoteId): void {
    this[INTERNAL].lastTouched = id;
  }

  create(input: Readonly<NoteInput>): Note {
    if (!NOTE_VALIDATORS.title(input.title))
      throw new ValidationError("标题无效");
    const now = new Date().toISOString();
    const note: Note = {
      id: makeId(this.repo.nextSeq()),
      title: input.title.trim(),
      content: input.content,
      tags: input.tags ? [...input.tags] : [],
      priority: input.priority ?? this._defaultPriority,
      status: input.status ?? NoteStatus.Active,
      createdAt: now,
      updatedAt: now,
    };
    this.repo.add(note);
    this.touch(note.id);
    return note;
  }
  view(id: NoteId): Note {
    const note = this.repo.findById(id);
    if (!note) throw new NotFoundError(`未找到 ID 为 ${id} 的笔记`);
    this.touch(id);
    return note;
  }
  edit(id: NoteId, update: NoteUpdate): Note {
    const note = this.repo.update(id, update);
    if (!note) throw new NotFoundError(`未找到 ID 为 ${id} 的笔记`);
    this.touch(id);
    return note;
  }
  delete(id: NoteId): Note {
    const note = this.repo.remove(id);
    if (!note) throw new NotFoundError(`未找到 ID 为 ${id} 的笔记`);
    return note;
  }
  addTags(id: NoteId, tags: readonly string[]): Note {
    const note = this.repo.findById(id);
    if (!note) throw new NotFoundError(`未找到 ID 为 ${id} 的笔记`);
    const set = new Set(note.tags);
    for (const t of tags) if (t.trim()) set.add(t.trim());
    return this.edit(id, { tags: [...set] });
  }
  removeTags(id: NoteId, tags: readonly string[]): Note {
    const note = this.repo.findById(id);
    if (!note) throw new NotFoundError(`未找到 ID 为 ${id} 的笔记`);
    const rm = new Set(tags.map((t) => t.trim()));
    return this.edit(id, { tags: note.tags.filter((t) => !rm.has(t)) });
  }
  list(opts: { sortField: SortField; sortOrder: SortOrder }): Note[] {
    const notes = this.repo.findAll();
    const dir = opts.sortOrder === SortOrder.Asc ? 1 : -1;
    return [...notes].sort((a, b) => {
      switch (opts.sortField) {
        case SortField.Title:
          return dir * a.title.localeCompare(b.title);
        case SortField.Priority:
          return (
            dir * (PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority])
          );
        case SortField.CreatedAt:
          return dir * a.createdAt.localeCompare(b.createdAt);
        case SortField.UpdatedAt:
          return dir * a.updatedAt.localeCompare(b.updatedAt);
      }
    });
  }
  *search(keyword: string, minScore = 1): Generator<SearchResult> {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return;
    const re = new RegExp(escapeRegExp(kw), "g");
    for (const note of this.repo) {
      const fields: string[] = [];
      let score = 0;
      const t = (note.title.toLowerCase().match(re) ?? []).length;
      const c = (note.content.toLowerCase().match(re) ?? []).length;
      const g = note.tags.filter((x) => x.toLowerCase().includes(kw)).length;
      if (t > 0) {
        score += t * 5;
        fields.push("title");
      }
      if (c > 0) {
        score += c * 2;
        fields.push("content");
      }
      if (g > 0) {
        score += g * 3;
        fields.push("tags");
      }
      if (score >= minScore) yield [note, score, fields] as SearchResult;
    }
  }
  stats(): {
    total: number;
    byPriority: Record<NotePriority, number>;
    byStatus: Record<NoteStatus, number>;
    byTag: Record<string, number>;
  } {
    const byPriority = {
      [NotePriority.Low]: 0,
      [NotePriority.Medium]: 0,
      [NotePriority.High]: 0,
      [NotePriority.Urgent]: 0,
    } as Record<NotePriority, number>;
    const byStatus = {
      [NoteStatus.Draft]: 0,
      [NoteStatus.Active]: 0,
      [NoteStatus.Archived]: 0,
      [NoteStatus.Deleted]: 0,
    } as Record<NoteStatus, number>;
    const byTag: Record<string, number> = {};
    let total = 0;
    for (const n of this.repo) {
      total++;
      byPriority[n.priority]++;
      byStatus[n.status]++;
      for (const t of n.tags) byTag[t] = (byTag[t] ?? 0) + 1;
    }
    return { total, byPriority, byStatus, byTag };
  }
  exportAll(): string {
    return JSON.stringify(
      { exportedAt: new Date().toISOString(), notes: this.repo.findAll() },
      null,
      2,
    );
  }
  importAll(json: string): number {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new ImportError("JSON 解析失败");
    }
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as { notes?: unknown }).notes)
    ) {
      throw new ImportError("导入数据格式不正确");
    }
    const notes = (data as { notes: unknown[] }).notes;
    const now = new Date().toISOString();
    let count = 0;
    for (const raw of notes) {
      if (!isNote(raw)) continue;
      this.repo.add({
        id: makeId(this.repo.nextSeq()),
        title: raw.title,
        content: raw.content,
        tags: [...raw.tags],
        priority: raw.priority,
        status: raw.status,
        createdAt: raw.createdAt,
        updatedAt: now,
      });
      count++;
    }
    return count;
  }
}

// ReturnType / Parameters / 条件类型 解包 演示
type StatsResult = ReturnType<NoteManager["stats"]>;
type CreateInput = Parameters<NoteManager["create"]>[0];
type SyncManager = Unwrap<NoteManager>;

/* ===== 多行输入 ===== */
function readMultiLine(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    console.log(prompt);
    console.log("（提示：单独一行输入 :wq 保存并结束，输入 :q 放弃）");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    const lines: string[] = [];
    rl.on("line", (line: string) => {
      const t = line.trim();
      if (t === ":wq") {
        rl.close();
        resolve(lines.join("\n"));
      } else if (t === ":q") {
        rl.close();
        resolve(null);
      } else lines.push(line);
    });
  });
}

/* ===== 数据目录与 Manager 工厂 ===== */
const DATA_DIR: string = path.join(os.homedir(), ".simple-notepad-cli");
const DATA_FILE: string = path.join(DATA_DIR, "notes.json");

function getManager(): NoteManager {
  const storage = new JsonFileStorage(DATA_FILE);
  const repo = new NoteRepository(storage);
  repo.on((e) => {
    if (process.env.NOTEPAD_DEBUG === "1")
      console.error(color(`[event] ${e.type}`, "gray"));
  });
  return new NoteManager(repo);
}

/* ===== 命令处理（Extract 提取各判别联合分支） ===== */
type ListCmd = Extract<Command, { type: "list" }>;
type AddCmd = Extract<Command, { type: "add" }>;
type ViewCmd = Extract<Command, { type: "view" }>;
type EditCmd = Extract<Command, { type: "edit" }>;
type DeleteCmd = Extract<Command, { type: "delete" }>;
type SearchCmd = Extract<Command, { type: "search" }>;
type TagCmd = Extract<Command, { type: "tag" }>;
type ExportCmd = Extract<Command, { type: "export" }>;
type ImportCmd = Extract<Command, { type: "import" }>;
type StatsCmd = Extract<Command, { type: "stats" }>;
type HelpCmd = Extract<Command, { type: "help" }>;

function cmdList(cmd: ListCmd): void {
  const manager = getManager();
  const notes = manager.list({
    sortField: cmd.sortField,
    sortOrder: cmd.sortOrder,
  });
  if (cmd.format === OutputFormat.JSON) {
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  if (notes.length === 0) {
    console.log("暂无笔记。使用 `notepad-cli add <标题>` 新建一条笔记。");
    return;
  }
  console.log(color(`共 ${notes.length} 条笔记：`, "bold"));
  console.log(color("-".repeat(80), "gray"));
  for (const n of notes) {
    const p = color(`[${n.priority}]`, priorityColor(n.priority));
    const s = color(
      `(${n.status})`,
      n.status === NoteStatus.Archived ? "gray" : "green",
    );
    const tags = n.tags.length ? color(`#${n.tags.join(" #")}`, "magenta") : "";
    console.log(`${color(n.id, "blue")}  ${p} ${s} ${tags}`);
    console.log(`  ${n.title}  ${color(formatDate(n.updatedAt), "gray")}`);
  }
  console.log(color("-".repeat(80), "gray"));
}

async function cmdAdd(cmd: AddCmd): Promise<void> {
  assertNonEmpty(cmd.title, "标题");
  const tpl = cmd.template ? TEMPLATES[cmd.template] : undefined;
  if (cmd.template && !tpl)
    throw new ValidationError(`未知模板：${cmd.template}`);
  const hint = tpl ? color(`（模板：${cmd.template}）`, "gray") : "";
  const content = await readMultiLine(
    `请输入笔记内容，标题为：「${cmd.title}」${hint}`,
  );
  if (content === null) {
    console.log("已放弃新建笔记。");
    return;
  }
  const finalContent = content.length > 0 ? content : (tpl?.content ?? "");
  const note = getManager().create({
    title: cmd.title,
    content: finalContent,
    tags: [...cmd.tags, ...(tpl?.tags ?? [])],
    priority: cmd.priority,
  });
  console.log(
    color("已保存笔记 ", "green") +
      color(note.id, "blue") +
      color(`，标题：${note.title}`, "green"),
  );
}

function cmdView(cmd: ViewCmd): void {
  try {
    const note = getManager().view(cmd.id);
    const line = color("=".repeat(80), "cyan");
    console.log(line);
    console.log(`${color("ID:", "bold")}       ${color(note.id, "blue")}`);
    console.log(`${color("标题:", "bold")}     ${note.title}`);
    console.log(
      `${color("优先级:", "bold")}   ${color(note.priority, priorityColor(note.priority))}`,
    );
    console.log(`${color("状态:", "bold")}     ${note.status}`);
    console.log(
      `${color("标签:", "bold")}     ${note.tags.length ? "#" + note.tags.join(" #") : "(无)"}`,
    );
    console.log(`${color("创建:", "bold")}     ${formatDate(note.createdAt)}`);
    console.log(`${color("更新:", "bold")}     ${formatDate(note.updatedAt)}`);
    console.log(color("-".repeat(80), "cyan"));
    console.log(note.content || color("(空)", "gray"));
    console.log(line);
  } catch (e) {
    console.error(color((e as Error).message, "red"));
  }
}

async function cmdEdit(cmd: EditCmd): Promise<void> {
  const manager = getManager();
  let note: Note;
  try {
    note = manager.view(cmd.id);
  } catch (e) {
    console.error(color((e as Error).message, "red"));
    return;
  }
  console.log(`正在编辑笔记「${note.title}」(${note.id})`);
  console.log(color("-".repeat(80), "gray"));
  console.log("当前内容：");
  console.log(note.content || color("(空)", "gray"));
  const newContent =
    await readMultiLine("请输入新的笔记内容（将覆盖原内容）：");
  if (newContent === null) {
    console.log("已放弃编辑。");
    return;
  }
  manager.edit(cmd.id, { content: newContent });
  console.log(color(`笔记 ${cmd.id} 已更新。`, "green"));
}

function cmdDelete(cmd: DeleteCmd): void {
  try {
    const r = getManager().delete(cmd.id);
    console.log(color(`已删除笔记 ${r.id}（${r.title}）`, "green"));
  } catch (e) {
    console.error(color((e as Error).message, "red"));
  }
}

function cmdSearch(cmd: SearchCmd): void {
  assertNonEmpty(cmd.keyword, "关键字");
  const results = [...getManager().search(cmd.keyword, cmd.minScore)];
  if (results.length === 0) {
    console.log(color(`未找到包含「${cmd.keyword}」的笔记。`, "yellow"));
    return;
  }
  results.sort((a, b) => b[1] - a[1]);
  console.log(color(`共找到 ${results.length} 条匹配笔记：`, "bold"));
  console.log(color("-".repeat(80), "gray"));
  for (const [note, score, fields] of results) {
    const sum = toSummary(note);
    console.log(
      `${color(note.id, "blue")} ${color(`[${sum.priority}]`, priorityColor(sum.priority))} ` +
        `${color(`[score:${score}]`, "yellow")} ${color(`#${fields.join(" #")}`, "magenta")}`,
    );
    const firstLine =
      note.content.split("\n").find((l) => l.trim().length > 0) ?? "";
    const preview =
      firstLine.length > 60 ? firstLine.slice(0, 60) + "..." : firstLine;
    console.log(
      `  ${color(sum.title, "bold")}  ${preview ? color(preview, "gray") : ""}`,
    );
  }
  console.log(color("-".repeat(80), "gray"));
}

function cmdTag(cmd: TagCmd): void {
  try {
    const manager = getManager();
    const note =
      cmd.action === "add"
        ? manager.addTags(cmd.id, cmd.tags)
        : manager.removeTags(cmd.id, cmd.tags);
    console.log(
      color(
        `标签已更新：${note.tags.length ? "#" + note.tags.join(" #") : "(无)"}`,
        "green",
      ),
    );
  } catch (e) {
    console.error(color((e as Error).message, "red"));
  }
}

function cmdStats(_cmd: StatsCmd): void {
  const s: StatsResult = getManager().stats();
  console.log(color("=== 笔记统计 ===", "bold"));
  console.log(`总数：${s.total}`);
  console.log(color("按优先级：", "cyan"));
  for (const p of Object.values(NotePriority))
    console.log(`  ${color(p, priorityColor(p))}: ${s.byPriority[p]}`);
  console.log(color("按状态：", "cyan"));
  for (const st of Object.values(NoteStatus))
    console.log(`  ${st}: ${s.byStatus[st]}`);
  const tagEntries = Object.entries(s.byTag).sort((a, b) => b[1] - a[1]);
  if (tagEntries.length) {
    console.log(color("按标签：", "cyan"));
    for (const [t, c] of tagEntries)
      console.log(`  ${color("#" + t, "magenta")}: ${c}`);
  }
}

function cmdExport(cmd: ExportCmd): void {
  assertNonEmpty(cmd.file, "导出文件路径");
  fs.writeFileSync(cmd.file, getManager().exportAll(), "utf-8");
  console.log(color(`已导出到 ${cmd.file}`, "green"));
}

function cmdImport(cmd: ImportCmd): void {
  assertNonEmpty(cmd.file, "导入文件路径");
  if (!fs.existsSync(cmd.file)) {
    console.error(color("文件不存在", "red"));
    return;
  }
  try {
    const n = getManager().importAll(fs.readFileSync(cmd.file, "utf-8"));
    console.log(color(`已导入 ${n} 条笔记`, "green"));
  } catch (e) {
    console.error(color((e as Error).message, "red"));
  }
}

function cmdHelp(_cmd: HelpCmd): void {
  console.log(
    [
      color("简单记事本 CLI（增强版）", "bold"),
      "",
      "用法： notepad-cli <command> [args...]",
      "",
      "命令：",
      "  list   [--json] [sortField] [sortOrder]   列出所有笔记",
      "  add    <标题> [#标签...] [--p=优先级] [--template=名]  新建笔记",
      "  view   <id>                                 查看笔记",
      "  edit   <id>                                 编辑笔记内容",
      "  delete <id>                                 删除笔记",
      "  search <关键字>                             全文搜索（带评分）",
      "  tag    <add|remove> <id> <标签...>          增删标签",
      "  stats                                       统计面板",
      "  export <文件>                               导出为 JSON",
      "  import <文件>                               从 JSON 导入",
      "  help                                        显示帮助",
      "",
      "优先级：low/medium/high/urgent  排序：createdAt/updatedAt/title/priority  顺序：asc/desc",
      `可用模板：${Object.keys(TEMPLATES).join(", ")}`,
      "数据存储路径：" + DATA_FILE,
    ].join("\n"),
  );
}

/* ===== 命令构建与分发 ===== */
function resolveCommand(name: string): string {
  return name in COMMAND_ALIASES
    ? (COMMAND_ALIASES as Record<string, string>)[name]
    : name;
}
function parsePriority(s: string | undefined): NotePriority {
  if (!s) return NotePriority.Medium;
  const v = s.toLowerCase();
  if (isNotePriority(v)) return v;
  throw new ValidationError(`无效的优先级：${s}`);
}
function buildCommand(raw: string, args: readonly string[]): Command {
  switch (raw) {
    case "list":
      return {
        type: "list",
        sortField: isSortField(args[0]) ? args[0] : SortField.UpdatedAt,
        sortOrder: isSortOrder(args[1]) ? args[1] : SortOrder.Desc,
        format: args.includes("--json") ? OutputFormat.JSON : OutputFormat.Text,
      };
    case "add": {
      const tags = args.filter((a) => a.startsWith("#")).map((a) => a.slice(1));
      const pArg = args.find(
        (a) => a.startsWith("--p=") || a.startsWith("-p="),
      );
      const tplArg = args.find((a) => a.startsWith("--template="));
      const title = args
        .filter(
          (a) =>
            !a.startsWith("#") &&
            !a.startsWith("-p=") &&
            !a.startsWith("--p=") &&
            !a.startsWith("--template=") &&
            a !== "--json",
        )
        .join(" ");
      return {
        type: "add",
        title,
        tags,
        priority: pArg
          ? parsePriority(pArg.split("=")[1])
          : NotePriority.Medium,
        template: tplArg?.split("=")[1],
      };
    }
    case "view":
      return { type: "view", id: parseId(args[0] ?? "") };
    case "edit":
      return { type: "edit", id: parseId(args[0] ?? "") };
    case "delete":
      return { type: "delete", id: parseId(args[0] ?? "") };
    case "search":
      return { type: "search", keyword: args.join(" "), minScore: 1 };
    case "tag":
      return {
        type: "tag",
        action: args[0] === "remove" ? "remove" : "add",
        id: parseId(args[1] ?? ""),
        tags: args.slice(2),
      };
    case "export":
      return { type: "export", file: args[0] ?? "" };
    case "import":
      return { type: "import", file: args[0] ?? "" };
    case "stats":
      return { type: "stats" };
    case "help":
      return { type: "help" };
    default:
      throw new ValidationError(`未知命令：${raw}`);
  }
}

async function dispatch(cmd: Command): Promise<void> {
  switch (cmd.type) {
    case "list":
      cmdList(cmd);
      break;
    case "add":
      await cmdAdd(cmd);
      break;
    case "view":
      cmdView(cmd);
      break;
    case "edit":
      await cmdEdit(cmd);
      break;
    case "delete":
      cmdDelete(cmd);
      break;
    case "search":
      cmdSearch(cmd);
      break;
    case "tag":
      cmdTag(cmd);
      break;
    case "export":
      cmdExport(cmd);
      break;
    case "import":
      cmdImport(cmd);
      break;
    case "stats":
      cmdStats(cmd);
      break;
    case "help":
      cmdHelp(cmd);
      break;
  }
}

/* ===== 入口 ===== */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const raw = (argv[0] ?? "help").toLowerCase();
  const canonical = resolveCommand(raw);
  const args = argv.slice(1);
  if (!KNOWN_COMMANDS.has(canonical)) {
    console.error(color(`未知命令：${raw}`, "red"));
    cmdHelp({ type: "help" });
    process.exit(1);
  }
  try {
    await dispatch(buildCommand(canonical, args));
  } catch (e) {
    if (e instanceof NoteError)
      console.error(color(`[${e.code}] ${e.message}`, "red"));
    else console.error(color(`程序执行出错：${(e as Error).message}`, "red"));
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(color(`程序执行出错：${(err as Error).message}`, "red"));
  process.exit(1);
});
