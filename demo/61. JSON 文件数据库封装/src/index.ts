#!/usr/bin/env node
/**
 * JSON 文件数据库封装
 * - 基于集合（collection）的存储
 * - 支持 CRUD：insert / find / update / delete
 * - 查询运算符：$gt $lt $eq $in $ne $and $or
 * - 字段索引（自动维护）
 * - 防抖写入 + 原子写入（临时文件 + rename）
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** 文档类型：任意对象，必须可序列化为 JSON */
export type Doc = Record<string, unknown>;

/** 比较运算符值 */
export type OpValue =
  | { $gt: number | string }
  | { $lt: number | string }
  | { $gte: number | string }
  | { $lte: number | string }
  | { $eq: unknown }
  | { $ne: unknown }
  | { $in: unknown[] }
  | { $nin: unknown[] };

/** 单字段查询：可以是值，也可以是运算符对象 */
export type FieldQuery = OpValue | string | number | boolean | null;

/** 顶层查询：$and/$or 逻辑运算符 + 字段名 */
export interface Query {
  $and?: Query[];
  $or?: Query[];
  [field: string]: Query | Query[] | FieldQuery | undefined;
}

/** 索引映射：字段值 -> 文档 id 列表 */
type IndexMap = Map<string, Set<string>>;

interface CollectionMeta {
  name: string;
  docs: Map<string, Doc>;
  indexes: Map<string, IndexMap>;
  indexedFields: string[];
}

interface DatabaseFile {
  version: number;
  collections: Record<string, { docs: Doc[]; indexes: string[] }>;
}

const $id = (): string => crypto.randomBytes(12).toString("hex");

/** 判断值是否匹配字段查询 */
function matchField(value: unknown, q: FieldQuery): boolean {
  if (q !== null && typeof q === "object" && !Array.isArray(q)) {
    const op = q as OpValue;
    if ("$gt" in op) return typeof value === typeof op.$gt && (value as number | string) > op.$gt;
    if ("$lt" in op) return typeof value === typeof op.$lt && (value as number | string) < op.$lt;
    if ("$gte" in op) return typeof value === typeof op.$gte && (value as number | string) >= op.$gte;
    if ("$lte" in op) return typeof value === typeof op.$lte && (value as number | string) <= op.$lte;
    if ("$eq" in op) return value === op.$eq;
    if ("$ne" in op) return value !== op.$ne;
    if ("$in" in op) return op.$in.includes(value);
    if ("$nin" in op) return !op.$nin.includes(value);
    return false;
  }
  return value === q;
}

/** 判断文档是否匹配查询 */
export function matchQuery(doc: Doc, query: Query): boolean {
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
    if (!matchField(doc[key], cond as FieldQuery)) return false;
  }
  return true;
}

/** JsonDB：JSON 文件数据库主类 */
export class JsonDB {
  private file: string;
  private cols = new Map<string, CollectionMeta>();
  private writeTimer: NodeJS.Timeout | null = null;
  private writeDebounceMs: number;
  private dirty = false;

  constructor(file: string, writeDebounceMs = 200) {
    this.file = path.resolve(file);
    this.writeDebounceMs = writeDebounceMs;
    this.load();
  }

  /** 加载文件 */
  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const data = JSON.parse(raw) as DatabaseFile;
      for (const name of Object.keys(data.collections)) {
        const c = data.collections[name];
        const meta: CollectionMeta = {
          name,
          docs: new Map(),
          indexes: new Map(),
          indexedFields: c.indexes || [],
        };
        for (const f of meta.indexedFields) meta.indexes.set(f, new Map());
        for (const d of c.docs) {
          const id = (d._id as string) || $id();
          d._id = id;
          meta.docs.set(id, d);
          this.reindex(meta, id, d);
        }
        this.cols.set(name, meta);
      }
    } catch (e) {
      throw new Error(`数据库文件损坏: ${(e as Error).message}`);
    }
  }

  /** 重建某文档的所有索引项 */
  private reindex(meta: CollectionMeta, id: string, doc: Doc): void {
    for (const f of meta.indexedFields) {
      const map = meta.indexes.get(f)!;
      // 先移除旧值
      for (const [k, set] of map) {
        if (set.has(id)) {
          set.delete(id);
          if (set.size === 0) map.delete(k);
        }
      }
      const v = doc[f];
      if (v === undefined || v === null) continue;
      const key = typeof v === "object" ? JSON.stringify(v) : String(v);
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(id);
    }
  }

  /** 标记脏数据，触发防抖写入 */
  private schedule(): void {
    this.dirty = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), this.writeDebounceMs);
  }

  /** 立即写入磁盘（原子：先写临时文件再 rename） */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.dirty) return;
    const data: DatabaseFile = { version: 1, collections: {} };
    for (const [name, meta] of this.cols) {
      data.collections[name] = {
        docs: Array.from(meta.docs.values()),
        indexes: meta.indexedFields,
      };
    }
    const json = JSON.stringify(data, null, 2);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  /** 创建集合 */
  createCollection(name: string, indexes: string[] = []): void {
    if (this.cols.has(name)) throw new Error(`集合已存在: ${name}`);
    const meta: CollectionMeta = { name, docs: new Map(), indexes: new Map(), indexedFields: indexes };
    for (const f of indexes) meta.indexes.set(f, new Map());
    this.cols.set(name, meta);
    this.schedule();
  }

  /** 在字段上建立索引 */
  ensureIndex(collection: string, field: string): void {
    const meta = this.cols.get(collection);
    if (!meta) throw new Error(`集合不存在: ${collection}`);
    if (meta.indexedFields.includes(field)) return;
    meta.indexedFields.push(field);
    const map: IndexMap = new Map();
    for (const [id, doc] of meta.docs) {
      const v = doc[field];
      if (v === undefined || v === null) continue;
      const key = typeof v === "object" ? JSON.stringify(v) : String(v);
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(id);
    }
    meta.indexes.set(field, map);
    this.schedule();
  }

  /** 列出所有集合 */
  collections(): string[] {
    return Array.from(this.cols.keys());
  }

  /** 插入文档 */
  insert(collection: string, doc: Doc): Doc {
    const meta = this.cols.get(collection);
    if (!meta) throw new Error(`集合不存在: ${collection}`);
    const id = (doc._id as string) || $id();
    doc._id = id;
    meta.docs.set(id, doc);
    this.reindex(meta, id, doc);
    this.schedule();
    return doc;
  }

  /** 批量插入 */
  insertMany(collection: string, docs: Doc[]): Doc[] {
    return docs.map((d) => this.insert(collection, d));
  }

  /** 查询文档 */
  find(collection: string, query: Query = {}, limit?: number): Doc[] {
    const meta = this.cols.get(collection);
    if (!meta) throw new Error(`集合不存在: ${collection}`);
    const result: Doc[] = [];
    // 若存在索引且查询只有单一字段相等条件，则使用索引
    const keys = Object.keys(query).filter((k) => k !== "$and" && k !== "$or");
    let candidates: Set<string> | null = null;
    if (keys.length === 1) {
      const k = keys[0];
      const v = query[k];
      if (meta.indexedFields.includes(k) && (typeof v !== "object" || v === null || "$eq" in (v as object))) {
        const map = meta.indexes.get(k)!;
        const real = typeof v === "object" && v !== null && "$eq" in (v as object) ? (v as { $eq: unknown }).$eq : v;
        const key = typeof real === "object" ? JSON.stringify(real) : String(real);
        candidates = map.get(key) ?? new Set();
      }
    }
    const ids = candidates ?? Array.from(meta.docs.keys());
    for (const id of ids) {
      const doc = meta.docs.get(id);
      if (!doc) continue;
      if (matchQuery(doc, query)) {
        result.push(doc);
        if (limit !== undefined && result.length >= limit) break;
      }
    }
    return result;
  }

  /** 查询单条 */
  findOne(collection: string, query: Query = {}): Doc | null {
    const r = this.find(collection, query, 1);
    return r.length > 0 ? r[0] : null;
  }

  /** 更新匹配文档 */
  update(collection: string, query: Query, data: Partial<Doc>): number {
    const meta = this.cols.get(collection);
    if (!meta) throw new Error(`集合不存在: ${collection}`);
    let count = 0;
    for (const [id, doc] of meta.docs) {
      if (matchQuery(doc, query)) {
        for (const k of Object.keys(data)) {
          if (k === "_id") continue;
          if (data[k] === undefined) continue;
          doc[k] = data[k];
        }
        this.reindex(meta, id, doc);
        count++;
      }
    }
    if (count > 0) this.schedule();
    return count;
  }

  /** 删除匹配文档 */
  delete(collection: string, query: Query): number {
    const meta = this.cols.get(collection);
    if (!meta) throw new Error(`集合不存在: ${collection}`);
    let count = 0;
    for (const [id, doc] of Array.from(meta.docs)) {
      if (matchQuery(doc, query)) {
        meta.docs.delete(id);
        this.reindex(meta, id, {});
        count++;
      }
    }
    if (count > 0) this.schedule();
    return count;
  }

  /** 删除集合 */
  dropCollection(name: string): void {
    if (!this.cols.delete(name)) throw new Error(`集合不存在: ${name}`);
    this.schedule();
  }

  /** 集合统计 */
  stats(): Record<string, { count: number; indexes: string[] }> {
    const out: Record<string, { count: number; indexes: string[] }> = {};
    for (const [name, meta] of this.cols) {
      out[name] = { count: meta.docs.size, indexes: meta.indexedFields };
    }
    return out;
  }

  /** 导出全部数据为字符串 */
  dump(): string {
    const data: DatabaseFile = { version: 1, collections: {} };
    for (const [name, meta] of this.cols) {
      data.collections[name] = {
        docs: Array.from(meta.docs.values()),
        indexes: meta.indexedFields,
      };
    }
    return JSON.stringify(data, null, 2);
  }
}

/* ----------------------- CLI ----------------------- */

function parseQuery(s: string): Query {
  if (!s) return {};
  try {
    return JSON.parse(s) as Query;
  } catch {
    throw new Error(`查询 JSON 解析失败: ${s}`);
  }
}

function print(obj: unknown): void {
  console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
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
  collections                           列出集合
  dump                                  导出全部数据
  stats                                 集合统计
示例:
  insert users '{"name":"Alice","age":30}'
  find   users '{"age":{"$gt":25}}'
  update users '{"name":"Alice"}' '{"age":31}'
`);
    return;
  }

  const dbFile = path.join(process.cwd(), "db.json");
  const db = new JsonDB(dbFile);

  switch (cmd) {
    case "create": {
      const [c, idx] = rest;
      if (!c) throw new Error("缺少集合名");
      db.createCollection(c, idx ? idx.split(",").map((s) => s.trim()) : []);
      db.flush();
      console.log(`集合已创建: ${c}`);
      break;
    }
    case "insert": {
      const [c, json] = rest;
      if (!c || !json) throw new Error("用法: insert <collection> <json>");
      const doc = JSON.parse(json) as Doc;
      const r = db.insert(c, doc);
      db.flush();
      print(r);
      break;
    }
    case "find": {
      const [c, q] = rest;
      if (!c) throw new Error("缺少集合名");
      const r = db.find(c, parseQuery(q || "{}"));
      print(r);
      break;
    }
    case "update": {
      const [c, q, d] = rest;
      if (!c || !q || !d) throw new Error("用法: update <collection> <query> <data>");
      const n = db.update(c, parseQuery(q), JSON.parse(d) as Doc);
      db.flush();
      console.log(`更新 ${n} 条`);
      break;
    }
    case "delete": {
      const [c, q] = rest;
      if (!c || !q) throw new Error("用法: delete <collection> <query>");
      const n = db.delete(c, parseQuery(q));
      db.flush();
      console.log(`删除 ${n} 条`);
      break;
    }
    case "collections":
      print(db.collections());
      break;
    case "stats":
      print(db.stats());
      break;
    case "dump":
      print(db.dump());
      break;
    case "demo": {
      // 内置演示
      db.createCollection("users", ["email"]);
      db.insert("users", { name: "Alice", age: 30, email: "a@x.com" });
      db.insert("users", { name: "Bob", age: 25, email: "b@x.com" });
      db.insert("users", { name: "Carol", age: 35, email: "c@x.com" });
      db.flush();
      console.log("年龄大于 26 的用户:");
      print(db.find("users", { age: { $gt: 26 } }));
      console.log("名字是 Alice 或 Bob:");
      print(db.find("users", { name: { $in: ["Alice", "Bob"] } }));
      console.log("(age>20 AND age<30) OR name=Carol:");
      print(
        db.find("users", {
          $or: [{ $and: [{ age: { $gt: 20 } }, { age: { $lt: 30 } }] }, { name: "Carol" }],
        })
      );
      break;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
