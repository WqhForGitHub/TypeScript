#!/usr/bin/env node
/**
 * TypeScript ORM 简单实现 (Enhanced)
 * Schema definition, CRUD, relations (hasOne/hasMany/belongsTo) with lazy loading,
 * JSON persistence. Uses advanced TS: enums, discriminated unions, generics,
 * abstract classes, mapped types, custom errors, satisfies, generators, symbols,
 * as const, type guards, overloads, template literal types. Node.js built-ins only.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/* ===================== String Enums ===================== */
export enum FieldType {
  Integer = "INTEGER",
  Text = "TEXT",
  Real = "REAL",
  Boolean = "BOOLEAN",
  Date = "DATE",
}

export enum RelationKind {
  HasOne = "hasOne",
  HasMany = "hasMany",
  BelongsTo = "belongsTo",
}

export enum ErrorCode {
  ModelNotFound = "MODEL_NOT_FOUND",
  FieldRequired = "FIELD_REQUIRED",
  UnknownCommand = "UNKNOWN_COMMAND",
  InvalidValue = "INVALID_VALUE",
  MigrationFailed = "MIGRATION_FAILED",
}

export enum QueryOp {
  Eq = "=",
  Ne = "!=",
  Lt = "<",
  Gt = ">",
  Lte = "<=",
  Gte = ">=",
  In = "in",
  Like = "like",
  IsNull = "isnull",
}

export enum MigrationState {
  Pending = "pending",
  Running = "running",
  Applied = "applied",
  Failed = "failed",
}

/* ===================== Types & Interfaces ===================== */
/** Mapped type: strip readonly modifiers */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Template literal type for $-prefixed column references */
export type ColumnRef<T> = `$${Extract<keyof T, string>}`;

/** Discriminated union: where conditions */
export type WhereOp =
  | {
      op:
        | QueryOp.Eq
        | QueryOp.Ne
        | QueryOp.Lt
        | QueryOp.Gt
        | QueryOp.Lte
        | QueryOp.Gte;
      value: unknown;
    }
  | { op: QueryOp.In; value: unknown[] }
  | { op: QueryOp.Like; value: string }
  | { op: QueryOp.IsNull };

export type WhereClause = Record<string, WhereOp>;

/** Discriminated union: query results */
export type QueryResult<T> =
  | { readonly kind: "ok"; readonly rows: T[]; readonly count: number }
  | { readonly kind: "empty"; readonly rows: T[]; readonly count: 0 }
  | { readonly kind: "error"; readonly message: string };

/** Interface with readonly + optional properties */
export interface FieldDef {
  readonly type: FieldType;
  readonly primaryKey?: boolean;
  readonly autoIncrement?: boolean;
  readonly nullable?: boolean;
  readonly default?: unknown;
}

export interface RelationDef {
  readonly kind: RelationKind;
  readonly model: string;
  readonly foreignKey: string;
  readonly localKey: string;
}

export interface ModelDef {
  readonly name: string;
  readonly table: string;
  readonly fields: Readonly<Record<string, FieldDef>>;
  readonly relations: Readonly<Record<string, RelationDef>>;
}

/** Interface with index signature + readonly + mutable members */
export interface Entity {
  readonly __model: string;
  __id: string | number;
  [key: string]: unknown;
}

interface SchemaFile {
  readonly models: ModelDef[];
  readonly data: Record<string, Entity[]>;
}

/* ===================== Symbols (unique property keys) ===================== */
const RAW_ENTITY: unique symbol = Symbol("rawEntity");

interface ProxiedEntity extends Entity {
  [RAW_ENTITY]?: Entity;
}

/* ===================== Custom Error Hierarchy ===================== */
export class OrmError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "OrmError";
    this.code = code;
  }
}

export class ModelNotFoundError extends OrmError {
  constructor(model: string) {
    super(ErrorCode.ModelNotFound, `模型未定义: ${model}`);
    this.name = "ModelNotFoundError";
  }
}

export class FieldRequiredError extends OrmError {
  constructor(field: string) {
    super(ErrorCode.FieldRequired, `字段 ${field} 不能为空`);
    this.name = "FieldRequiredError";
  }
}

/* ===================== Helpers ===================== */
function uid(): string {
  return crypto.randomBytes(12).toString("hex");
}

function pkOf(m: ModelDef): string {
  for (const [n, f] of Object.entries(m.fields)) {
    if (f.primaryKey) return n;
  }
  return "id";
}

/** Type guard: is value an Entity? */
function isEntity(v: unknown): v is Entity {
  return typeof v === "object" && v !== null && "__model" in v && "__id" in v;
}

/** Type guard: is value a WhereOp? */
function isWhereOp(v: unknown): v is WhereOp {
  return typeof v === "object" && v !== null && "op" in v;
}

function coerce(v: unknown, type: FieldType): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case FieldType.Integer: {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isNaN(n) ? null : n;
    }
    case FieldType.Real: {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isNaN(n) ? null : n;
    }
    case FieldType.Text:
      return String(v);
    case FieldType.Boolean:
      return Boolean(v);
    case FieldType.Date:
      return v instanceof Date ? v.toISOString() : String(v);
    default:
      return null;
  }
}

function matchWhere(row: Entity, where: WhereClause): boolean {
  for (const [field, cond] of Object.entries(where)) {
    if (!isWhereOp(cond)) continue;
    const v = row[field];
    switch (cond.op) {
      case QueryOp.Eq:
        if (v !== cond.value) return false;
        break;
      case QueryOp.Ne:
        if (v === cond.value) return false;
        break;
      case QueryOp.Lt:
        if (!(
          typeof v === typeof cond.value &&
          (v as number | string) < (cond.value as number | string)
        ))
          return false;
        break;
      case QueryOp.Gt:
        if (!(
          typeof v === typeof cond.value &&
          (v as number | string) > (cond.value as number | string)
        ))
          return false;
        break;
      case QueryOp.Lte:
        if (!(
          typeof v === typeof cond.value &&
          (v as number | string) <= (cond.value as number | string)
        ))
          return false;
        break;
      case QueryOp.Gte:
        if (!(
          typeof v === typeof cond.value &&
          (v as number | string) >= (cond.value as number | string)
        ))
          return false;
        break;
      case QueryOp.In:
        if (!cond.value.includes(v)) return false;
        break;
      case QueryOp.Like: {
        const re = new RegExp(
          "^" + String(cond.value).replace(/%/g, ".*").replace(/_/g, ".") + "$",
          "i",
        );
        if (!(typeof v === "string" && re.test(v))) return false;
        break;
      }
      case QueryOp.IsNull:
        if (v !== null && v !== undefined) return false;
        break;
    }
  }
  return true;
}

/** Resolve a $-prefixed column reference (template literal type) to its value */
function resolveColumn<T extends Entity>(
  entity: T,
  ref: ColumnRef<T>,
): unknown {
  const key = ref.slice(1) as keyof T;
  return entity[key];
}

/* ===================== ORM Class ===================== */
export class ORM {
  private readonly models = new Map<string, ModelDef>();
  private readonly data = new Map<string, Entity[]>();
  private readonly file: string | null;
  private _migrationState: MigrationState = MigrationState.Pending;

  constructor(file?: string) {
    this.file = file ? path.resolve(file) : null;
    this.load();
  }

  /** Getter: current migration state */
  get migrationState(): MigrationState {
    return this._migrationState;
  }

  /** Setter: update migration state */
  set migrationState(s: MigrationState) {
    this._migrationState = s;
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as SchemaFile;
    for (const m of raw.models) this.models.set(m.name, m);
    for (const name of Object.keys(raw.data))
      this.data.set(name, raw.data[name]);
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

  define(
    name: string,
    fields: Readonly<Record<string, FieldDef>>,
    relations: Readonly<Record<string, RelationDef>> = {},
  ): ModelDef {
    const def: ModelDef = {
      name,
      table: name.toLowerCase(),
      fields,
      relations,
    };
    this.models.set(name, def);
    if (!this.data.has(name)) this.data.set(name, []);
    return def;
  }

  model(name: string): ModelDef {
    const m = this.models.get(name);
    if (!m) throw new ModelNotFoundError(name);
    return m;
  }

  sync(): void {
    for (const name of this.models.keys()) {
      if (!this.data.has(name)) this.data.set(name, []);
    }
    this.save();
    console.log(`已同步 ${this.models.size} 个模型`);
  }

  migrate(): void {
    this._migrationState = MigrationState.Running;
    try {
      let added = 0;
      for (const name of this.models.keys()) {
        if (!this.data.has(name)) {
          this.data.set(name, []);
          added++;
        }
      }
      this.save();
      this._migrationState = MigrationState.Applied;
      console.log(`迁移完成，新增 ${added} 个表`);
    } catch (e) {
      this._migrationState = MigrationState.Failed;
      throw new OrmError(ErrorCode.MigrationFailed, (e as Error).message);
    }
  }

  drop(name: string): void {
    this.model(name);
    this.data.delete(name);
    this.save();
  }

  insert<T extends Entity>(modelName: string, row: Record<string, unknown>): T {
    const m = this.model(modelName);
    const entity = { __model: modelName, __id: "" } as Mutable<Entity> &
      Record<string, unknown>;
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
          v =
            typeof fdef.default === "function"
              ? (fdef.default as () => unknown)()
              : fdef.default;
          entity[name] = v;
        } else if (fdef.nullable) {
          entity[name] = null;
        } else {
          throw new FieldRequiredError(name);
        }
      } else {
        entity[name] = coerce(v, fdef.type);
      }
    }
    if (entity[pkName] === undefined || entity[pkName] === "") {
      entity[pkName] = uid();
    }
    entity.__id = entity[pkName] as string | number;
    this.data.get(modelName)!.push(entity as Entity);
    this.save();
    return this.attachProxy(entity as Entity) as T;
  }

  findById<T extends Entity>(modelName: string, id: string | number): T | null {
    const m = this.model(modelName);
    const pkName = pkOf(m);
    const rows = this.data.get(modelName) || [];
    for (const r of rows) {
      if (r[pkName] === id) return this.attachProxy(r) as T;
    }
    return null;
  }

  find<T extends Entity>(modelName: string, where?: WhereClause): T[] {
    this.model(modelName);
    const rows = this.data.get(modelName) || [];
    const matched = where
      ? rows.filter((r) => matchWhere(r, where))
      : rows.slice();
    return matched.map((r) => this.attachProxy(r) as T);
  }

  /** Generator: lazily iterate over matching entities */
  *iterate<T extends Entity>(
    modelName: string,
    where?: WhereClause,
  ): Generator<T, void, unknown> {
    this.model(modelName);
    const rows = this.data.get(modelName) || [];
    for (const r of rows) {
      if (!where || matchWhere(r, where)) yield this.attachProxy(r) as T;
    }
  }

  /** Query returning a discriminated-union result */
  query<T extends Entity>(
    modelName: string,
    where?: WhereClause,
  ): QueryResult<T> {
    const rows = this.find<T>(modelName, where);
    if (rows.length === 0) return { kind: "empty", rows: [], count: 0 };
    return { kind: "ok", rows, count: rows.length };
  }

  /** Function overloads: findOne with optional default value */
  findOne<T extends Entity>(modelName: string, where: WhereClause): T | null;
  findOne<T extends Entity>(
    modelName: string,
    where: WhereClause,
    defaultValue: T,
  ): T;
  findOne<T extends Entity>(
    modelName: string,
    where: WhereClause,
    defaultValue?: T,
  ): T | null {
    const rows = this.find<T>(modelName, where);
    if (rows.length > 0) return rows[0];
    return defaultValue !== undefined ? defaultValue : null;
  }

  /** Attach lazy-loading proxy for relations */
  private attachProxy(entity: Entity): Entity {
    const m = this.model(entity.__model);
    const proxy = { ...entity } as ProxiedEntity;
    proxy[RAW_ENTITY] = entity;
    for (const [relName, rel] of Object.entries(m.relations)) {
      Object.defineProperty(proxy, relName, {
        get: () => this.loadRelation(entity, rel),
        enumerable: false,
        configurable: true,
      });
    }
    return proxy;
  }

  private loadRelation(
    entity: Entity,
    rel: RelationDef,
  ): Entity | Entity[] | null {
    const localVal = entity[rel.localKey];
    if (
      rel.kind === RelationKind.BelongsTo ||
      rel.kind === RelationKind.HasOne
    ) {
      const rows = this.data.get(rel.model) || [];
      for (const r of rows) {
        if (r[rel.foreignKey] === localVal) return this.attachProxy(r);
      }
      return null;
    }
    // HasMany
    const rows = this.data.get(rel.model) || [];
    return rows
      .filter((r) => r[rel.foreignKey] === localVal)
      .map((r) => this.attachProxy(r));
  }

  update(
    modelName: string,
    where: WhereClause,
    data: Record<string, unknown>,
  ): number {
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

  delete(modelName: string, where: WhereClause): number {
    const rows = this.data.get(modelName) || [];
    const before = rows.length;
    const remaining = rows.filter((r) => !matchWhere(r, where));
    this.data.set(modelName, remaining);
    const n = before - remaining.length;
    if (n > 0) this.save();
    return n;
  }

  modelsList(): string[] {
    return Array.from(this.models.keys());
  }

  seed(): void {
    if (!this.models.has("User")) {
      this.define(
        "User",
        {
          id: {
            type: FieldType.Integer,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: FieldType.Text },
          email: { type: FieldType.Text, nullable: true },
          age: { type: FieldType.Integer, nullable: true },
        },
        {
          posts: {
            kind: RelationKind.HasMany,
            model: "Post",
            foreignKey: "userId",
            localKey: "id",
          },
        },
      );
    }
    if (!this.models.has("Post")) {
      this.define(
        "Post",
        {
          id: {
            type: FieldType.Integer,
            primaryKey: true,
            autoIncrement: true,
          },
          title: { type: FieldType.Text },
          content: { type: FieldType.Text, nullable: true },
          userId: { type: FieldType.Integer, nullable: true },
        },
        {
          author: {
            kind: RelationKind.BelongsTo,
            model: "User",
            foreignKey: "id",
            localKey: "userId",
          },
        },
      );
    }
    const u1 = this.insert("User", {
      name: "Alice",
      email: "a@x.com",
      age: 30,
    });
    const u2 = this.insert("User", { name: "Bob", email: "b@x.com", age: 25 });
    this.insert("Post", {
      title: "TypeScript 入门",
      content: "TS 基础...",
      userId: u1.id,
    });
    this.insert("Post", { title: "ORM 实战", content: "...", userId: u1.id });
    this.insert("Post", { title: "Bob 的随笔", content: "...", userId: u2.id });
    this.save();
    console.log("已插入演示数据");
  }
}

/* ===================== Generic Model<T extends Entity> ===================== */
export class Model<T extends Entity> {
  constructor(
    readonly orm: ORM,
    readonly name: string,
    readonly definition: ModelDef,
  ) {}

  insert(row: Record<string, unknown>): T {
    return this.orm.insert<T>(this.name, row);
  }

  findById(id: string | number): T | null {
    return this.orm.findById<T>(this.name, id);
  }

  find(where?: WhereClause): T[] {
    return this.orm.find<T>(this.name, where);
  }

  *iterate(where?: WhereClause): Generator<T, void, unknown> {
    yield* this.orm.iterate<T>(this.name, where);
  }
}

/* ===================== Abstract Repository ===================== */
export abstract class AbstractRepository<T extends Entity> {
  protected readonly orm: ORM;
  protected readonly modelName: string;

  constructor(orm: ORM, modelName: string) {
    this.orm = orm;
    this.modelName = modelName;
  }

  abstract create(row: Record<string, unknown>): T;
  abstract findAll(where?: WhereClause): T[];

  findById(id: string | number): T | null {
    return this.orm.findById<T>(this.modelName, id);
  }

  update(where: WhereClause, data: Record<string, unknown>): number {
    return this.orm.update(this.modelName, where, data);
  }

  delete(where: WhereClause): number {
    return this.orm.delete(this.modelName, where);
  }

  /** Make repository iterable via generator */
  *[Symbol.iterator](): Generator<T, void, unknown> {
    yield* this.orm.iterate<T>(this.modelName);
  }
}

interface UserEntity extends Entity {
  id: number;
  name: string;
  email: string | null;
  age: number | null;
  posts?: Entity[];
}

interface PostEntity extends Entity {
  id: number;
  title: string;
  content: string | null;
  userId: number | null;
  author?: Entity | null;
}

/** Concrete repository subclass */
export class UserRepository extends AbstractRepository<UserEntity> {
  create(row: Record<string, unknown>): UserEntity {
    return this.orm.insert<UserEntity>(this.modelName, row);
  }

  findAll(where?: WhereClause): UserEntity[] {
    return this.orm.find<UserEntity>(this.modelName, where);
  }

  findByName(name: string): UserEntity | null {
    return this.orm.findOne<UserEntity>(this.modelName, {
      name: { op: QueryOp.Eq, value: name },
    });
  }
}

/* ===================== Schema Constants (as const + satisfies) ===================== */
const USER_SCHEMA = {
  fields: {
    id: { type: FieldType.Integer, primaryKey: true, autoIncrement: true },
    name: { type: FieldType.Text },
    email: { type: FieldType.Text, nullable: true },
    age: { type: FieldType.Integer, nullable: true },
  },
  relations: {
    posts: {
      kind: RelationKind.HasMany,
      model: "Post",
      foreignKey: "userId",
      localKey: "id",
    },
  },
} as const satisfies {
  fields: Readonly<Record<string, FieldDef>>;
  relations: Readonly<Record<string, RelationDef>>;
};

const POST_SCHEMA = {
  fields: {
    id: { type: FieldType.Integer, primaryKey: true, autoIncrement: true },
    title: { type: FieldType.Text },
    content: { type: FieldType.Text, nullable: true },
    userId: { type: FieldType.Integer, nullable: true },
  },
  relations: {
    author: {
      kind: RelationKind.BelongsTo,
      model: "User",
      foreignKey: "id",
      localKey: "userId",
    },
  },
} as const satisfies {
  fields: Readonly<Record<string, FieldDef>>;
  relations: Readonly<Record<string, RelationDef>>;
};

/* ===================== CLI ===================== */
function parseFilter(s: string): WhereClause {
  if (!s) return {};
  const out: WhereClause = {};
  for (const part of s.split(",")) {
    const m = part.match(/^(\w+)\s*(=|!=|<=|>=|<|>)(.*)$/);
    if (m) {
      const [, f, op, val] = m;
      const num = Number(val);
      const value = Number.isNaN(num) ? val : num;
      const opEnum = op as
        | QueryOp.Eq
        | QueryOp.Ne
        | QueryOp.Lt
        | QueryOp.Gt
        | QueryOp.Lte
        | QueryOp.Gte;
      out[f] = { op: opEnum, value };
    }
  }
  return out;
}

function print(obj: unknown): void {
  console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}

function defineSchema(orm: ORM): void {
  orm.define("User", USER_SCHEMA.fields, USER_SCHEMA.relations);
  orm.define("Post", POST_SCHEMA.fields, POST_SCHEMA.relations);
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
      defineSchema(orm);
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
      if (!m) throw new OrmError(ErrorCode.UnknownCommand, "缺少模型名");
      const result = orm.query<Entity>(m, parseFilter(filter || ""));
      if (result.kind === "error") {
        print(result.message);
        break;
      }
      const clean = result.rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(r)) o[k] = r[k];
        return o;
      });
      print(clean);
      break;
    }
    case "demo": {
      orm.seed();
      const userRepo = new UserRepository(orm, "User");
      const u = userRepo.findByName("Alice");
      if (u) {
        console.log("Alice 的主键:", u.id);
        const u2 = orm.findById<UserEntity>("User", u.id);
        if (u2) {
          const posts = u2.posts;
          if (posts) {
            console.log(`Alice 有 ${posts.length} 篇文章:`);
            for (const p of posts) console.log("  -", p.title);
          }
        }
      }
      // Generator iteration via ORM.iterate
      const allPosts = Array.from(orm.iterate<PostEntity>("Post"));
      console.log("Post 总数 (via generator):", allPosts.length);
      // Symbol.iterator on repository
      console.log("所有用户 (via repository iterator):");
      for (const user of userRepo) {
        console.log("  -", user.name, user.email);
      }
      // Template literal type / resolveColumn
      const firstPost = orm.find<PostEntity>("Post")[0];
      if (firstPost) {
        const titleVal = resolveColumn(firstPost, "$title");
        console.log("第一篇文章标题:", titleVal);
        const author = (firstPost as PostEntity & { author: Entity | null })
          .author;
        console.log(
          `文章 "${firstPost.title}" 的作者:`,
          author ? author.name : "(无)",
        );
      }
      // Type guard
      const maybeEntity: unknown = orm.find("User")[0];
      if (isEntity(maybeEntity)) {
        console.log("类型守卫验证通过，模型:", maybeEntity.__model);
      }
      // findOne overload
      const defaultUser = orm.findOne<UserEntity>("User", {
        name: { op: QueryOp.Eq, value: "Nobody" },
      });
      console.log("findOne (无匹配):", defaultUser);
      break;
    }
    default:
      throw new OrmError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const msg =
      e instanceof OrmError
        ? `[${e.code}] ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.error("错误:", msg);
    process.exit(1);
  });
}
