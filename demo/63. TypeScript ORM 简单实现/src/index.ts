#!/usr/bin/env node
/**
 * TypeScript ORM 简单实现
 * - 基于 schema 配置定义模型（字段类型、主键、自增、可空、默认值）
 * - 支持建表/删表、插入、按主键查找、条件查询、更新、删除
 * - 支持关联关系：hasOne / hasMany / belongsTo（懒加载）
 * - 后端存储使用内存 + JSON 文件持久化
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** 字段类型 */
export type FieldType = "INTEGER" | "TEXT" | "REAL" | "BOOLEAN" | "DATE";

/** 字段定义 */
export interface FieldDef {
  type: FieldType;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  nullable?: boolean;
  default?: unknown;
}

/** 关联关系定义 */
export interface RelationDef {
  kind: "hasOne" | "hasMany" | "belongsTo";
  model: string;
  foreignKey: string;
  localKey: string;
}

/** 模型定义 */
export interface ModelDef {
  name: string;
  table: string;
  fields: Record<string, FieldDef>;
  relations: Record<string, RelationDef>;
}

/** 实例：行数据 + 关联懒加载缓存 */
export interface Entity {
  __model: string;
  __id: string | number;
  [key: string]: unknown;
}

interface SchemaFile {
  models: ModelDef[];
  data: Record<string, Entity[]>;
}

/** 比较运算符 */
export type WhereOp =
  | { op: "=" | "!=" | "<" | ">" | "<=" | ">="; value: unknown }
  | { op: "in"; value: unknown[] }
  | { op: "like"; value: string }
  | { op: "isnull" };

export type WhereClause = Record<string, WhereOp>;

function uid(): string {
  return crypto.randomBytes(12).toString("hex");
}

/** ORM 主类 */
export class ORM {
  private models = new Map<string, ModelDef>();
  private data = new Map<string, Entity[]>();
  private file: string | null;

  constructor(file?: string) {
    this.file = file ? path.resolve(file) : null;
    this.load();
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as SchemaFile;
    for (const m of raw.models) this.models.set(m.name, m);
    for (const name of Object.keys(raw.data)) this.data.set(name, raw.data[name]);
  }

  private save(): void {
    if (!this.file) return;
    const data: SchemaFile = {
      models: Array.from(this.models.values()),
      data: Object.fromEntries(this.data.entries()),
    };
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  /** 定义模型 */
  define(name: string, fields: Record<string, FieldDef>, relations: Record<string, RelationDef> = {}): ModelDef {
    const def: ModelDef = { name, table: name.toLowerCase(), fields, relations };
    this.models.set(name, def);
    if (!this.data.has(name)) this.data.set(name, []);
    return def;
  }

  /** 获取模型定义 */
  model(name: string): ModelDef {
    const m = this.models.get(name);
    if (!m) throw new Error(`模型未定义: ${name}`);
    return m;
  }

  /** 同步：根据 schema 创建/重置表（清空数据） */
  sync(): void {
    // 这里"建表"等价于初始化数据数组
    for (const name of this.models.keys()) {
      if (!this.data.has(name)) this.data.set(name, []);
    }
    this.save();
    console.log(`已同步 ${this.models.size} 个模型`);
  }

  /** 迁移：保留数据，仅确保结构存在 */
  migrate(): void {
    let added = 0;
    for (const name of this.models.keys()) {
      if (!this.data.has(name)) {
        this.data.set(name, []);
        added++;
      }
    }
    this.save();
    console.log(`迁移完成，新增 ${added} 个表`);
  }

  /** 删除表 */
  drop(name: string): void {
    this.model(name); // 校验存在
    this.data.delete(name);
    this.save();
  }

  /** 插入记录 */
  insert<T extends Entity>(modelName: string, row: Record<string, unknown>): T {
    const m = this.model(modelName);
    const entity: Entity = { __model: modelName, __id: "" };
    let pkName = "id";
    for (const [name, fdef] of Object.entries(m.fields)) {
      if (fdef.primaryKey) pkName = name;
      let v = row[name];
      if (v === undefined) {
        if (fdef.autoIncrement) {
          const rows = this.data.get(modelName)!;
          let max = 0;
          for (const r of rows) {
            const rid = r[name];
            if (typeof rid === "number" && rid > max) max = rid;
          }
          v = max + 1;
          entity[name] = v;
        } else if (fdef.default !== undefined) {
          v = typeof fdef.default === "function" ? (fdef.default as () => unknown)() : fdef.default;
          entity[name] = v;
        } else if (fdef.nullable) {
          entity[name] = null;
        } else {
          throw new Error(`字段 ${name} 不能为空`);
        }
      } else {
        entity[name] = coerce(v, fdef.type);
      }
    }
    if (entity[pkName] === undefined || entity[pkName] === "") {
      entity[pkName] = uid();
    }
    entity.__id = entity[pkName] as string | number;
    this.data.get(modelName)!.push(entity);
    this.save();
    return entity as T;
  }

  /** 按主键查找 */
  findById<T extends Entity>(modelName: string, id: string | number): T | null {
    const m = this.model(modelName);
    const pkName = pkOf(m);
    const rows = this.data.get(modelName) || [];
    for (const r of rows) {
      if (r[pkName] === id) return this.attachProxy(r) as T;
    }
    return null;
  }

  /** 条件查询 */
  find<T extends Entity>(modelName: string, where?: WhereClause): T[] {
    const m = this.model(modelName);
    const rows = this.data.get(modelName) || [];
    const matched = where ? rows.filter((r) => matchWhere(r, where)) : rows.slice();
    return matched.map((r) => this.attachProxy(r) as T);
  }

  /** 为实体附加懒加载代理（关联访问） */
  private attachProxy(entity: Entity): Entity {
    const m = this.model(entity.__model);
    const proxy: Entity = { ...entity };
    for (const [relName, rel] of Object.entries(m.relations)) {
      Object.defineProperty(proxy, relName, {
        get: () => this.loadRelation(entity, rel),
        enumerable: false,
        configurable: true,
      });
    }
    return proxy;
  }

  private loadRelation(entity: Entity, rel: RelationDef): Entity | Entity[] | null {
    const localVal = entity[rel.localKey];
    if (rel.kind === "belongsTo" || rel.kind === "hasOne") {
      const rows = this.data.get(rel.model) || [];
      for (const r of rows) {
        if (r[rel.foreignKey] === localVal) return this.attachProxy(r);
      }
      return null;
    }
    // hasMany
    const rows = this.data.get(rel.model) || [];
    return rows
      .filter((r) => r[rel.foreignKey] === localVal)
      .map((r) => this.attachProxy(r));
  }

  /** 更新记录 */
  update(modelName: string, where: WhereClause, data: Record<string, unknown>): number {
    const m = this.model(modelName);
    const rows = this.data.get(modelName) || [];
    let count = 0;
    for (const r of rows) {
      if (matchWhere(r, where)) {
        for (const [k, v] of Object.entries(data)) {
          if (k === "__model" || k === "__id") continue;
          if (!m.fields[k]) continue;
          r[k] = coerce(v, m.fields[k].type);
        }
        count++;
      }
    }
    if (count > 0) this.save();
    return count;
  }

  /** 删除记录 */
  delete(modelName: string, where: WhereClause): number {
    const rows = this.data.get(modelName) || [];
    const before = rows.length;
    const remaining = rows.filter((r) => !matchWhere(r, where));
    this.data.set(modelName, remaining);
    const n = before - remaining.length;
    if (n > 0) this.save();
    return n;
  }

  /** 列出全部模型 */
  modelsList(): string[] {
    return Array.from(this.models.keys());
  }

  /** 插入演示数据 */
  seed(): void {
    if (!this.models.has("User")) {
      this.define(
        "User",
        {
          id: { type: "INTEGER", primaryKey: true, autoIncrement: true },
          name: { type: "TEXT" },
          email: { type: "TEXT", nullable: true },
          age: { type: "INTEGER", nullable: true },
        },
        { posts: { kind: "hasMany", model: "Post", foreignKey: "userId", localKey: "id" } }
      );
    }
    if (!this.models.has("Post")) {
      this.define(
        "Post",
        {
          id: { type: "INTEGER", primaryKey: true, autoIncrement: true },
          title: { type: "TEXT" },
          content: { type: "TEXT", nullable: true },
          userId: { type: "INTEGER", nullable: true },
        },
        { author: { kind: "belongsTo", model: "User", foreignKey: "id", localKey: "userId" } }
      );
    }
    const u1 = this.insert("User", { name: "Alice", email: "a@x.com", age: 30 });
    const u2 = this.insert("User", { name: "Bob", email: "b@x.com", age: 25 });
    this.insert("Post", { title: "TypeScript 入门", content: "TS 基础...", userId: u1.id });
    this.insert("Post", { title: "ORM 实战", content: "...", userId: u1.id });
    this.insert("Post", { title: "Bob 的随笔", content: "...", userId: u2.id });
    this.save();
    console.log("已插入演示数据");
  }
}

function pkOf(m: ModelDef): string {
  for (const [n, f] of Object.entries(m.fields)) {
    if (f.primaryKey) return n;
  }
  return "id";
}

function coerce(v: unknown, type: FieldType): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "INTEGER": {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isNaN(n) ? null : n;
    }
    case "REAL": {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isNaN(n) ? null : n;
    }
    case "TEXT": return String(v);
    case "BOOLEAN": return Boolean(v);
    case "DATE": return v instanceof Date ? v.toISOString() : String(v);
  }
}

function matchWhere(row: Entity, where: WhereClause): boolean {
  for (const [field, cond] of Object.entries(where)) {
    const v = row[field];
    switch (cond.op) {
      case "=": if (v !== cond.value) return false; break;
      case "!=": if (v === cond.value) return false; break;
      case "<": if (!(typeof v === typeof cond.value && (v as number | string) < (cond.value as number | string))) return false; break;
      case ">": if (!(typeof v === typeof cond.value && (v as number | string) > (cond.value as number | string))) return false; break;
      case "<=": if (!(typeof v === typeof cond.value && (v as number | string) <= (cond.value as number | string))) return false; break;
      case ">=": if (!(typeof v === typeof cond.value && (v as number | string) >= (cond.value as number | string))) return false; break;
      case "in": if (!cond.value.includes(v)) return false; break;
      case "like": {
        const re = new RegExp("^" + String(cond.value).replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
        if (!(typeof v === "string" && re.test(v))) return false;
        break;
      }
      case "isnull": if (v !== null && v !== undefined) return false; break;
    }
  }
  return true;
}

/* ----------------------- CLI ----------------------- */

function parseFilter(s: string): WhereClause {
  if (!s) return {};
  // 简易解析：name=Alice,age>=20 -> {name:{op:"=",value:"Alice"},age:{op:">=",value:20}}
  const out: WhereClause = {};
  for (const part of s.split(",")) {
    const m = part.match(/^(\w+)\s*(=|!=|<=|>=|<|>)(.*)$/);
    if (m) {
      const [, f, op, val] = m;
      const num = Number(val);
      out[f] = { op: op as WhereOp["op"], value: Number.isNaN(num) ? val : num } as WhereOp;
    }
  }
  return out;
}

function print(obj: unknown): void {
  console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const file = path.join(process.cwd(), "orm.json");
  const orm = new ORM(file);

  if (!cmd) {
    console.log(`TypeScript ORM CLI
用法:
  sync                   根据 schema 创建表
  seed                   插入演示数据
  migrate                迁移
  query <model> [filter] 查询模型记录
  models                 列出所有模型
示例:
  seed
  query User name=Alice
  query Post userId=1
`);
    return;
  }

  switch (cmd) {
    case "sync":
      orm.define(
        "User",
        {
          id: { type: "INTEGER", primaryKey: true, autoIncrement: true },
          name: { type: "TEXT" },
          email: { type: "TEXT", nullable: true },
          age: { type: "INTEGER", nullable: true },
        },
        { posts: { kind: "hasMany", model: "Post", foreignKey: "userId", localKey: "id" } }
      );
      orm.define(
        "Post",
        {
          id: { type: "INTEGER", primaryKey: true, autoIncrement: true },
          title: { type: "TEXT" },
          content: { type: "TEXT", nullable: true },
          userId: { type: "INTEGER", nullable: true },
        },
        { author: { kind: "belongsTo", model: "User", foreignKey: "id", localKey: "userId" } }
      );
      orm.sync();
      break;
    case "seed":
      orm.seed();
      break;
    case "migrate":
      orm.migrate();
      break;
    case "models":
      print(orm.modelsList());
      break;
    case "query": {
      const [m, filter] = rest;
      if (!m) throw new Error("缺少模型名");
      const rows = orm.find(m, parseFilter(filter || ""));
      // 不触发懒加载代理的序列化
      const clean = rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(r)) o[k] = r[k];
        return o;
      });
      print(clean);
      break;
    }
    case "demo": {
      orm.seed();
      const u = orm.find("User", { name: { op: "=", value: "Alice" } })[0];
      console.log("Alice 的主键:", u.id);
      const u2 = orm.findById("User", u.id as number);
      if (u2) {
        const posts = (u2 as Entity & { posts: Entity[] }).posts;
        console.log(`Alice 有 ${posts.length} 篇文章:`);
        for (const p of posts) console.log("  -", p.title);
      }
      const post = orm.find("Post")[0];
      if (post) {
        const author = (post as Entity & { author: Entity | null }).author;
        console.log(`文章 "${post.title}" 的作者:`, author ? author.name : "(无)");
      }
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
