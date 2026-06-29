#!/usr/bin/env node
/**
 * JSON 文件数据库封装 (增强版)
 * - 集合存储、CRUD、查询运算符、字段索引、防抖写入 + 原子写入
 * - 高级 TS 特性：枚举、可辨识联合、泛型约束、抽象类、映射/条件类型、
 *   自定义错误层级、satisfies、getter/setter、生成器、Symbol、as const、
 *   类型守卫、函数重载、模板字面量类型
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/* 枚举 */
export enum Command {
  Create = "create",
  Insert = "insert",
  Find = "find",
  Update = "update",
  Delete = "delete",
  Drop = "drop",
  EnsureIndex = "ensureIndex",
  Collections = "collections",
  Stats = "stats",
  Dump = "dump",
  Demo = "demo",
}
export enum ErrorCode {
  DbCorrupted = "DB_CORRUPTED",
  CollectionExists = "COLLECTION_EXISTS",
  CollectionMissing = "COLLECTION_MISSING",
  DocumentMissing = "DOCUMENT_MISSING",
  DocumentExists = "DOCUMENT_EXISTS",
  UnknownCommand = "UNKNOWN_COMMAND",
  ParseError = "PARSE_ERROR",
  IndexError = "INDEX_ERROR",
}
export enum IndexState {
  Building = "BUILDING",
  Ready = "READY",
  Stale = "STALE",
}
export enum DocumentStatus {
  Active = "ACTIVE",
  Deleted = "DELETED",
  Pending = "PENDING",
}

/* 基础接口与类型 */
export interface Identifiable {
  readonly id: string;
}
export type Doc = Record<string, unknown> & Identifiable;
/** 映射类型：去除 readonly */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** 模板字面量类型 */
export type OperatorKey = `$${string}`;
export type CollectionEvent = `on${Capitalize<Command>}`;

export type OpValue =
  | { $gt: number | string }
  | { $lt: number | string }
  | { $gte: number | string }
  | { $lte: number | string }
  | { $eq: unknown }
  | { $ne: unknown }
  | { $in: unknown[] }
  | { $nin: unknown[] };
export type FieldQuery = OpValue | string | number | boolean | null;

export interface Query {
  $and?: Query[];
  $or?: Query[];
  [field: string]: Query | Query[] | FieldQuery | undefined;
}

/* 可辨识联合：查询结果 */
export interface QuerySuccess<T extends Identifiable> {
  readonly kind: "success";
  readonly docs: T[];
  readonly count: number;
}
export interface QueryError {
  readonly kind: "error";
  readonly code: ErrorCode;
  readonly message: string;
}
export interface QueryEmpty {
  readonly kind: "empty";
  readonly reason: string;
}
export type QueryOutcome<T extends Identifiable> =
  QuerySuccess<T> | QueryError | QueryEmpty;
/** 条件类型 */
export type QueryResult<T> = T extends Identifiable ? QuerySuccess<T> : never;

/* Symbol 唯一键 / as const */
const SYM_COLLECTION = Symbol("collection");
const SYM_STATUS = Symbol("status");
const DB_VERSION = 1 as const;
const DEFAULT_DEBOUNCE_MS = 200 as const;
const EMPTY_QUERY = {} as const;

/* 自定义错误层级 */
export class DatabaseError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
  }
}
export class CollectionError extends DatabaseError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "CollectionError";
  }
}
export class DocumentError extends DatabaseError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "DocumentError";
  }
}
export class IndexError extends DatabaseError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "IndexError";
  }
}

type IndexMap = Map<string, Set<string>>;
interface DatabaseFile {
  readonly version: number;
  collections: Record<string, { docs: Doc[]; indexes: string[] }>;
}

/* 类型守卫 */
function isOpValue(v: unknown): v is OpValue {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}
function isIdentifiable(v: unknown): v is Identifiable {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as { id?: unknown }).id === "string"
  );
}
function isQueryError<T extends Identifiable>(
  r: QueryOutcome<T>,
): r is QueryError {
  return r.kind === "error";
}

/* 查询匹配 */
function matchField(value: unknown, q: FieldQuery): boolean {
  if (isOpValue(q)) {
    const op = q;
    if ("$gt" in op)
      return (
        typeof value === typeof op.$gt && (value as number | string) > op.$gt
      );
    if ("$lt" in op)
      return (
        typeof value === typeof op.$lt && (value as number | string) < op.$lt
      );
    if ("$gte" in op)
      return (
        typeof value === typeof op.$gte && (value as number | string) >= op.$gte
      );
    if ("$lte" in op)
      return (
        typeof value === typeof op.$lte && (value as number | string) <= op.$lte
      );
    if ("$eq" in op) return value === op.$eq;
    if ("$ne" in op) return value !== op.$ne;
    if ("$in" in op) return op.$in.includes(value);
    if ("$nin" in op) return !op.$nin.includes(value);
    return false;
  }
  return value === q;
}
export function matchQuery<T extends Identifiable>(
  doc: T,
  query: Query,
): boolean {
  const rec = doc as Record<string, unknown>;
  for (const key of Object.keys(query)) {
    const cond = query[key];
    if (key === "$and") {
      if (!Array.isArray(cond)) return false;
      if (!(cond as Query[]).every((q) => matchQuery(doc, q))) return false;
      continue;
    }
    if (key === "$or") {
      if (!Array.isArray(cond)) return false;
      if (!(cond as Query[]).some((q) => matchQuery(doc, q))) return false;
      continue;
    }
    if (!matchField(rec[key], cond as FieldQuery)) return false;
  }
  return true;
}
const $id = (): string => crypto.randomBytes(12).toString("hex");

/* 抽象存储类 */
export abstract class AbstractStore<T extends Identifiable> {
  protected readonly docs = new Map<string, T>();
  protected readonly file: string;
  protected dirty = false;
  protected writeTimer: NodeJS.Timeout | null = null;
  protected readonly writeDebounceMs: number;

  constructor(file: string, writeDebounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.file = path.resolve(file);
    this.writeDebounceMs = writeDebounceMs;
  }
  protected abstract serialize(): unknown;
  protected abstract deserialize(raw: string): void;
  abstract insert(doc: T): T;
  abstract find(query: Query, limit?: number): T[];

  get size(): number {
    return this.docs.size;
  }
  get path(): string {
    return this.file;
  }

  protected schedule(): void {
    this.dirty = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), this.writeDebounceMs);
  }
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.dirty) return;
    const json = JSON.stringify(this.serialize(), null, 2);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }
  /** 生成器：迭代所有文档 */
  *[Symbol.iterator](): Iterator<T> {
    for (const doc of this.docs.values()) yield doc;
  }
}

interface JsonStoreFile {
  readonly version: number;
  readonly docs: Doc[];
}

/** 单集合存储的具体实现 */
export class JsonStore extends AbstractStore<Doc> {
  constructor(file: string, writeDebounceMs: number = DEFAULT_DEBOUNCE_MS) {
    super(file, writeDebounceMs);
    this.load();
  }
  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      this.deserialize(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      throw new DatabaseError(
        ErrorCode.DbCorrupted,
        `数据库文件损坏: ${(e as Error).message}`,
      );
    }
  }
  protected serialize(): JsonStoreFile {
    return { version: DB_VERSION, docs: Array.from(this.docs.values()) };
  }
  protected deserialize(raw: string): void {
    const data = JSON.parse(raw) as JsonStoreFile;
    for (const d of data.docs) {
      const id = d.id || $id();
      (d as Mutable<Doc>).id = id;
      this.docs.set(id, d);
    }
  }
  insert(doc: Doc): Doc {
    const id = doc.id || $id();
    const stored: Doc = { ...doc, id };
    this.docs.set(id, stored);
    this.schedule();
    return stored;
  }
  find(query: Query = {}, limit?: number): Doc[] {
    const out: Doc[] = [];
    for (const doc of this.docs.values()) {
      if (matchQuery(doc, query)) {
        out.push(doc);
        if (limit !== undefined && out.length >= limit) break;
      }
    }
    return out;
  }
}

/* 泛型集合 */
export class Collection<T extends Identifiable> {
  readonly name: string;
  readonly indexedFields: string[] = [];
  private readonly docs = new Map<string, T>();
  private readonly indexes = new Map<string, IndexMap>();
  private _state: IndexState = IndexState.Ready;
  private _status: DocumentStatus = DocumentStatus.Active;

  constructor(name: string, indexes: string[] = []) {
    this.name = name;
    this.indexedFields.push(...indexes);
    for (const f of indexes) this.indexes.set(f, new Map());
  }
  get count(): number {
    return this.docs.size;
  }
  get state(): IndexState {
    return this._state;
  }
  set state(s: IndexState) {
    this._state = s;
  }
  get status(): DocumentStatus {
    return this._status;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const doc of this.docs.values()) yield doc;
  }

  ensureIndex(field: string): void {
    if (this.indexedFields.includes(field)) return;
    this.indexedFields.push(field);
    this._state = IndexState.Building;
    const map: IndexMap = new Map();
    for (const [id, doc] of this.docs) this.addToIndex(map, field, id, doc);
    this.indexes.set(field, map);
    this._state = IndexState.Ready;
  }
  private addToIndex(map: IndexMap, field: string, id: string, doc: T): void {
    const v = (doc as Record<string, unknown>)[field];
    if (v === undefined || v === null) return;
    const key = typeof v === "object" ? JSON.stringify(v) : String(v);
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }
  private reindex(id: string, doc: T): void {
    for (const f of this.indexedFields) {
      const map = this.indexes.get(f)!;
      for (const [k, set] of map) {
        if (set.has(id)) {
          set.delete(id);
          if (set.size === 0) map.delete(k);
        }
      }
      this.addToIndex(map, f, id, doc);
    }
  }
  private removeFromIndex(id: string): void {
    for (const f of this.indexedFields) {
      const map = this.indexes.get(f)!;
      for (const [k, set] of map) {
        if (set.has(id)) {
          set.delete(id);
          if (set.size === 0) map.delete(k);
        }
      }
    }
  }

  insert(doc: T): T {
    this.docs.set(doc.id, doc);
    this.reindex(doc.id, doc);
    return doc;
  }
  insertMany(docs: T[]): T[] {
    return docs.map((d) => this.insert(d));
  }
  getById(id: string): T {
    const doc = this.docs.get(id);
    if (!doc)
      throw new DocumentError(ErrorCode.DocumentMissing, `文档不存在: ${id}`);
    return doc;
  }

  find(query: Query = {}, limit?: number): T[] {
    const out: T[] = [];
    const keys = Object.keys(query).filter((k) => k !== "$and" && k !== "$or");
    let candidates: Set<string> | null = null;
    if (keys.length === 1) {
      const k = keys[0];
      const v = query[k];
      if (
        this.indexedFields.includes(k) &&
        (typeof v !== "object" || v === null || "$eq" in (v as object))
      ) {
        const map = this.indexes.get(k)!;
        const real =
          typeof v === "object" && v !== null && "$eq" in (v as object)
            ? (v as { $eq: unknown }).$eq
            : v;
        const key =
          typeof real === "object" ? JSON.stringify(real) : String(real);
        candidates = map.get(key) ?? new Set();
      }
    }
    const ids = candidates ?? Array.from(this.docs.keys());
    for (const id of ids) {
      const doc = this.docs.get(id);
      if (!doc) continue;
      if (matchQuery(doc, query)) {
        out.push(doc);
        if (limit !== undefined && out.length >= limit) break;
      }
    }
    return out;
  }
  findOne(query: Query = {}): T | null {
    const r = this.find(query, 1);
    return r.length > 0 ? r[0] : null;
  }
  /** 返回可辨识联合结果 */
  findOutcome(query: Query = {}): QueryOutcome<T> {
    if (this._state !== IndexState.Ready) {
      return {
        kind: "error",
        code: ErrorCode.IndexError,
        message: "索引未就绪",
      };
    }
    const docs = this.find(query);
    if (docs.length === 0) return { kind: "empty", reason: "无匹配文档" };
    return { kind: "success", docs, count: docs.length };
  }
  update(query: Query, data: Partial<T>): number {
    let count = 0;
    for (const [id, doc] of this.docs) {
      if (matchQuery(doc, query)) {
        for (const k of Object.keys(data)) {
          if (k === "id") continue;
          const val = (data as Record<string, unknown>)[k];
          if (val === undefined) continue;
          (doc as Record<string, unknown>)[k] = val;
        }
        this.reindex(id, doc);
        count++;
      }
    }
    return count;
  }
  delete(query: Query): number {
    let count = 0;
    for (const [id, doc] of Array.from(this.docs)) {
      if (matchQuery(doc, query)) {
        this.docs.delete(id);
        this.removeFromIndex(id);
        count++;
      }
    }
    return count;
  }
  toJSON(): { docs: T[]; indexes: string[] } {
    return {
      docs: Array.from(this.docs.values()),
      indexes: [...this.indexedFields],
    };
  }
}

/* JsonDB：多集合主类 */
export class JsonDB {
  private readonly file: string;
  private readonly cols = new Map<string, Collection<Doc>>();
  private writeTimer: NodeJS.Timeout | null = null;
  private readonly writeDebounceMs: number;
  private _dirty = false;
  readonly [SYM_COLLECTION] = "JsonDB";
  [SYM_STATUS]: DocumentStatus = DocumentStatus.Active;

  constructor(file: string, writeDebounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.file = path.resolve(file);
    this.writeDebounceMs = writeDebounceMs;
    this.load();
  }
  get filePath(): string {
    return this.file;
  }
  get isDirty(): boolean {
    return this._dirty;
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const data = JSON.parse(raw) as DatabaseFile;
      for (const name of Object.keys(data.collections)) {
        const c = data.collections[name];
        const col = new Collection<Doc>(name, c.indexes || []);
        for (const d of c.docs) {
          const id = d.id || $id();
          (d as Mutable<Doc>).id = id;
          col.insert(d);
        }
        this.cols.set(name, col);
      }
    } catch (e) {
      if (e instanceof DatabaseError) throw e;
      throw new DatabaseError(
        ErrorCode.DbCorrupted,
        `数据库文件损坏: ${(e as Error).message}`,
      );
    }
  }
  private schedule(): void {
    this._dirty = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), this.writeDebounceMs);
  }
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this._dirty) return;
    const data: DatabaseFile = { version: DB_VERSION, collections: {} };
    for (const [name, col] of this.cols) data.collections[name] = col.toJSON();
    const json = JSON.stringify(data, null, 2);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, this.file);
    this._dirty = false;
  }
  createCollection(name: string, indexes: string[] = []): void {
    if (this.cols.has(name))
      throw new CollectionError(
        ErrorCode.CollectionExists,
        `集合已存在: ${name}`,
      );
    this.cols.set(name, new Collection<Doc>(name, indexes));
    this.schedule();
  }
  ensureIndex(collection: string, field: string): void {
    this.requireCollection(collection).ensureIndex(field);
    this.schedule();
  }
  collections(): string[] {
    return Array.from(this.cols.keys());
  }
  insert(collection: string, doc: Doc): Doc {
    const col = this.requireCollection(collection);
    const id = doc.id || $id();
    const stored: Doc = { ...doc, id };
    col.insert(stored);
    this.schedule();
    return stored;
  }
  insertMany(collection: string, docs: Doc[]): Doc[] {
    return docs.map((d) => this.insert(collection, d));
  }
  /** 函数重载 */
  find(collection: string): Doc[];
  find(collection: string, query: Query): Doc[];
  find(collection: string, query: Query, limit: number): Doc[];
  find(collection: string, query: Query = {}, limit?: number): Doc[] {
    return this.requireCollection(collection).find(query, limit);
  }
  findOne(collection: string, query: Query = {}): Doc | null {
    return this.requireCollection(collection).findOne(query);
  }
  update(collection: string, query: Query, data: Partial<Doc>): number {
    const n = this.requireCollection(collection).update(query, data);
    if (n > 0) this.schedule();
    return n;
  }
  delete(collection: string, query: Query): number {
    const n = this.requireCollection(collection).delete(query);
    if (n > 0) this.schedule();
    return n;
  }
  dropCollection(name: string): void {
    if (!this.cols.delete(name))
      throw new CollectionError(
        ErrorCode.CollectionMissing,
        `集合不存在: ${name}`,
      );
    this.schedule();
  }
  /** satisfies 用法 */
  stats(): Record<string, { count: number; indexes: string[] }> {
    const out: Record<string, { count: number; indexes: string[] }> = {};
    for (const [name, col] of this.cols) {
      const stat = {
        count: col.count,
        indexes: [...col.indexedFields],
      } satisfies { count: number; indexes: string[] };
      out[name] = stat;
    }
    return out;
  }
  dump(): string {
    const data: DatabaseFile = { version: DB_VERSION, collections: {} };
    for (const [name, col] of this.cols) data.collections[name] = col.toJSON();
    return JSON.stringify(data, null, 2);
  }
  /** 生成器：迭代所有集合名 */
  *collectionNames(): IterableIterator<string> {
    for (const name of this.cols.keys()) yield name;
  }
  private requireCollection(name: string): Collection<Doc> {
    const col = this.cols.get(name);
    if (!col)
      throw new CollectionError(
        ErrorCode.CollectionMissing,
        `集合不存在: ${name}`,
      );
    return col;
  }
}

/* CLI */
function parseQuery(s: string): Query {
  if (!s) return { ...EMPTY_QUERY };
  try {
    return JSON.parse(s) as Query;
  } catch {
    throw new DatabaseError(ErrorCode.ParseError, `查询 JSON 解析失败: ${s}`);
  }
}
function print(obj: unknown): void {
  console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}
/** 模板字面量类型构造 */
function buildEventName(c: Command): CollectionEvent {
  const cap = c.charAt(0).toUpperCase() + c.slice(1);
  return `on${cap}` as CollectionEvent;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.log(`JSON 文件数据库 CLI
用法:
  create <collection> [idx1,idx2,...]   创建集合
  insert <collection> <json>            插入文档
  find   <collection> [query]           查询文档
  update <collection> <query> <data>    更新文档
  delete <collection> <query>           删除文档
  ensureIndex <collection> <field>      建立索引
  collections | stats | dump | demo     其它命令
示例:
  insert users '{"id":"u1","name":"Alice","age":30}'
  find   users '{"age":{"$gt":25}}'
  update users '{"name":"Alice"}' '{"age":31}'`);
    return;
  }

  const db = new JsonDB(path.join(process.cwd(), "db.json"));
  const command = cmd as Command;

  switch (command) {
    case Command.Create: {
      const [c, idx] = rest;
      if (!c)
        throw new CollectionError(ErrorCode.CollectionMissing, "缺少集合名");
      db.createCollection(c, idx ? idx.split(",").map((s) => s.trim()) : []);
      db.flush();
      console.log(`集合已创建: ${c}`);
      break;
    }
    case Command.Insert: {
      const [c, json] = rest;
      if (!c || !json)
        throw new DatabaseError(
          ErrorCode.ParseError,
          "用法: insert <collection> <json>",
        );
      const parsed: Record<string, unknown> = JSON.parse(json);
      if (!isIdentifiable(parsed)) parsed.id = $id();
      const r = db.insert(c, parsed as Doc);
      db.flush();
      print(r);
      break;
    }
    case Command.Find: {
      const [c, q] = rest;
      if (!c)
        throw new CollectionError(ErrorCode.CollectionMissing, "缺少集合名");
      print(db.find(c, parseQuery(q || "{}")));
      break;
    }
    case Command.Update: {
      const [c, q, d] = rest;
      if (!c || !q || !d)
        throw new DatabaseError(
          ErrorCode.ParseError,
          "用法: update <collection> <query> <data>",
        );
      const n = db.update(c, parseQuery(q), JSON.parse(d) as Doc);
      db.flush();
      console.log(`更新 ${n} 条`);
      break;
    }
    case Command.Delete: {
      const [c, q] = rest;
      if (!c || !q)
        throw new DatabaseError(
          ErrorCode.ParseError,
          "用法: delete <collection> <query>",
        );
      const n = db.delete(c, parseQuery(q));
      db.flush();
      console.log(`删除 ${n} 条`);
      break;
    }
    case Command.EnsureIndex: {
      const [c, field] = rest;
      if (!c || !field)
        throw new IndexError(
          ErrorCode.IndexError,
          "用法: ensureIndex <collection> <field>",
        );
      db.ensureIndex(c, field);
      db.flush();
      console.log(`索引已建立: ${c}.${field}`);
      break;
    }
    case Command.Collections:
      print(db.collections());
      break;
    case Command.Stats:
      print(db.stats());
      break;
    case Command.Dump:
      print(db.dump());
      break;
    case Command.Demo: {
      db.createCollection("users", ["email"]);
      db.insert("users", {
        id: "u1",
        name: "Alice",
        age: 30,
        email: "a@x.com",
      });
      db.insert("users", { id: "u2", name: "Bob", age: 25, email: "b@x.com" });
      db.insert("users", {
        id: "u3",
        name: "Carol",
        age: 35,
        email: "c@x.com",
      });
      db.flush();
      console.log("事件名示例:", buildEventName(Command.Insert));
      console.log("年龄大于 26 的用户:");
      print(db.find("users", { age: { $gt: 26 } }));
      console.log("名字是 Alice 或 Bob:");
      print(db.find("users", { name: { $in: ["Alice", "Bob"] } }));
      console.log("(age>20 AND age<30) OR name=Carol:");
      print(
        db.find("users", {
          $or: [
            { $and: [{ age: { $gt: 20 } }, { age: { $lt: 30 } }] },
            { name: "Carol" },
          ],
        }),
      );
      // 演示可辨识联合 + 类型守卫
      const tmpCol = new Collection<Doc>("tmp");
      tmpCol.insert({ id: "t1", name: "Temp" });
      const outcome = tmpCol.findOutcome({ name: "Temp" });
      if (!isQueryError(outcome) && outcome.kind === "success") {
        console.log(`可辨识联合查询成功，共 ${outcome.count} 条`);
      }
      break;
    }
    default:
      throw new DatabaseError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const msg =
      e instanceof DatabaseError
        ? `[${e.code}] ${e.message}`
        : (e as Error).message;
    console.error("错误:", msg);
    process.exit(1);
  });
}
