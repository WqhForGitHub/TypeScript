#!/usr/bin/env node
/**
 * 内存 SQL 数据库封装（含词法分析器与语法分析器）
 *
 * 支持的 SQL：
 *   CREATE TABLE name (col TYPE [PRIMARY KEY], ...);
 *   INSERT INTO name (c1,c2) VALUES (v1,v2), (...);
 *   INSERT INTO name VALUES (v1,v2);
 *   SELECT (星号或列名) FROM name [WHERE expr] [ORDER BY col [ASC|DESC]] [LIMIT n] [OFFSET n];
 *   UPDATE name SET c=v,... [WHERE expr];
 *   DELETE FROM name [WHERE expr];
 *
 * WHERE 支持：=, !=, <>, <, >, <=, >=, AND, OR, LIKE, IS NULL, IS NOT NULL
 * 类型：INTEGER / TEXT / REAL
 * 持久化：保存到 JSON 文件。
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";

type ColType = "INTEGER" | "TEXT" | "REAL";

interface ColumnDef {
  name: string;
  type: ColType;
  primaryKey?: boolean;
  notNull?: boolean;
}

interface Table {
  name: string;
  columns: ColumnDef[];
  rows: Record<string, unknown>[]; // 每行的字段名 -> 值
  autoInc: number;
}

/* ----------------------- Tokenizer ----------------------- */

type TokKind =
  | "keyword"
  | "ident"
  | "number"
  | "string"
  | "op"
  | "punct"
  | "eof";

interface Token {
  kind: TokKind;
  value: string;
  pos: number;
}

const KEYWORDS = new Set([
  "CREATE", "TABLE", "INSERT", "INTO", "VALUES", "SELECT", "FROM", "WHERE",
  "ORDER", "BY", "ASC", "DESC", "LIMIT", "OFFSET", "UPDATE", "SET", "DELETE",
  "AND", "OR", "LIKE", "IS", "NULL", "NOT", "PRIMARY", "KEY", "INTEGER",
  "TEXT", "REAL", "INTO", "DISTINCT",
]);

function tokenize(sql: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = sql.length;
  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isDigit = (c: string) => /[0-9]/.test(c);
  const isWs = (c: string) => /\s/.test(c);

  while (i < n) {
    const c = sql[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    // 注释 -- 行注释
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // 块注释 /* */
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // 字符串
    if (c === "'") {
      i++;
      let s = "";
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += sql[i];
        i++;
      }
      toks.push({ kind: "string", value: s, pos: i });
      continue;
    }
    // 双引号标识符
    if (c === '"') {
      i++;
      let s = "";
      while (i < n && sql[i] !== '"') {
        s += sql[i];
        i++;
      }
      i++;
      toks.push({ kind: "ident", value: s, pos: i });
      continue;
    }
    // 数字
    if (isDigit(c) || (c === "." && isDigit(sql[i + 1]))) {
      let s = "";
      while (i < n && (isDigit(sql[i]) || sql[i] === ".")) {
        s += sql[i];
        i++;
      }
      toks.push({ kind: "number", value: s, pos: i });
      continue;
    }
    // 标识符/关键字
    if (isIdentStart(c)) {
      let s = "";
      while (i < n && isIdent(sql[i])) {
        s += sql[i];
        i++;
      }
      const up = s.toUpperCase();
      if (KEYWORDS.has(up)) toks.push({ kind: "keyword", value: up, pos: i });
      else toks.push({ kind: "ident", value: s, pos: i });
      continue;
    }
    // 运算符
    if (c === "<" || c === ">" || c === "!" || c === "=") {
      let s = c;
      if (sql[i + 1] === "=") s += "=";
      else if (c === "<" && sql[i + 1] === ">") s = "<>";
      if (s.length > 1) i += 2;
      else i++;
      toks.push({ kind: "op", value: s, pos: i });
      continue;
    }
    // 标点
    if ("(),.*;".includes(c)) {
      toks.push({ kind: "punct", value: c, pos: i });
      i++;
      continue;
    }
    throw new Error(`词法错误: 未知字符 '${c}' 于位置 ${i}`);
  }
  toks.push({ kind: "eof", value: "", pos: n });
  return toks;
}

/* ----------------------- AST ----------------------- */

interface CreateStmt {
  type: "create";
  table: string;
  columns: ColumnDef[];
}
interface InsertStmt {
  type: "insert";
  table: string;
  columns: string[] | null;
  rows: unknown[][];
}
type OrderBy = { col: string; dir: "ASC" | "DESC" };
interface SelectStmt {
  type: "select";
  distinct: boolean;
  columns: string[] | "*";
  table: string;
  where: Expr | null;
  orderBy: OrderBy[];
  limit: number | null;
  offset: number | null;
}
interface UpdateStmt {
  type: "update";
  table: string;
  sets: { col: string; value: Expr }[];
  where: Expr | null;
}
interface DeleteStmt {
  type: "delete";
  table: string;
  where: Expr | null;
}
type Stmt = CreateStmt | InsertStmt | SelectStmt | UpdateStmt | DeleteStmt;

type Expr =
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "col"; name: string }
  | { k: "lit"; value: unknown }
  | { k: "like"; col: string; pattern: string; negate: boolean }
  | { k: "isnull"; col: string; negate: boolean };

/* ----------------------- Parser ----------------------- */

class Parser {
  private toks: Token[];
  private p = 0;
  constructor(toks: Token[]) {
    this.toks = toks;
  }
  private peek(): Token {
    return this.toks[this.p];
  }
  private next(): Token {
    return this.toks[this.p++];
  }
  private expect(kind: TokKind, value?: string): Token {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value.toUpperCase() !== value.toUpperCase())) {
      throw new Error(`语法错误: 期望 ${value || kind} 实际 ${t.kind} '${t.value}'`);
    }
    return this.next();
  }
  private matchKeyword(kw: string): boolean {
    const t = this.peek();
    if (t.kind === "keyword" && t.value === kw) {
      this.next();
      return true;
    }
    return false;
  }
  private isKeyword(kw: string): boolean {
    const t = this.peek();
    return t.kind === "keyword" && t.value === kw;
  }

  parseAll(): Stmt[] {
    const stmts: Stmt[] = [];
    while (this.peek().kind !== "eof") {
      const s = this.parseStatement();
      if (s) stmts.push(s);
      while (this.peek().kind === "punct" && this.peek().value === ";") this.next();
    }
    return stmts;
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    if (t.kind !== "keyword") throw new Error(`语法错误: 期望语句开头 实际 '${t.value}'`);
    switch (t.value) {
      case "CREATE": return this.parseCreate();
      case "INSERT": return this.parseInsert();
      case "SELECT": return this.parseSelect();
      case "UPDATE": return this.parseUpdate();
      case "DELETE": return this.parseDelete();
      default: throw new Error(`不支持的语句: ${t.value}`);
    }
  }

  private parseCreate(): CreateStmt {
    this.expect("keyword", "CREATE");
    this.expect("keyword", "TABLE");
    const table = this.parseName();
    this.expect("punct", "(");
    const columns: ColumnDef[] = [];
    while (true) {
      const colName = this.parseName();
      const typeTok = this.next();
      if (typeTok.kind !== "keyword" || !["INTEGER", "TEXT", "REAL"].includes(typeTok.value)) {
        throw new Error(`未知列类型: ${typeTok.value}`);
      }
      const col: ColumnDef = { name: colName, type: typeTok.value as ColType };
      // 列约束
      while (true) {
        if (this.matchKeyword("PRIMARY")) {
          this.expect("keyword", "KEY");
          col.primaryKey = true;
        } else if (this.matchKeyword("NOT")) {
          this.expect("keyword", "NULL");
          col.notNull = true;
        } else break;
      }
      columns.push(col);
      if (this.peek().kind === "punct" && this.peek().value === ",") {
        this.next();
        continue;
      }
      break;
    }
    this.expect("punct", ")");
    return { type: "create", table, columns };
  }

  private parseInsert(): InsertStmt {
    this.expect("keyword", "INSERT");
    this.expect("keyword", "INTO");
    const table = this.parseName();
    let columns: string[] | null = null;
    if (this.peek().kind === "punct" && this.peek().value === "(") {
      this.next();
      columns = [];
      while (true) {
        columns.push(this.parseName());
        if (this.peek().kind === "punct" && this.peek().value === ",") {
          this.next();
          continue;
        }
        break;
      }
      this.expect("punct", ")");
    }
    this.expect("keyword", "VALUES");
    const rows: unknown[][] = [];
    while (true) {
      this.expect("punct", "(");
      const vals: unknown[] = [];
      while (true) {
        vals.push(this.parseLiteral());
        if (this.peek().kind === "punct" && this.peek().value === ",") {
          this.next();
          continue;
        }
        break;
      }
      this.expect("punct", ")");
      rows.push(vals);
      if (this.peek().kind === "punct" && this.peek().value === ",") {
        this.next();
        continue;
      }
      break;
    }
    return { type: "insert", table, columns, rows };
  }

  private parseSelect(): SelectStmt {
    this.expect("keyword", "SELECT");
    let distinct = false;
    if (this.matchKeyword("DISTINCT")) distinct = true;
    let columns: string[] | "*" = "*";
    if (this.peek().kind === "punct" && this.peek().value === "*") {
      this.next();
    } else {
      columns = [];
      while (true) {
        columns.push(this.parseName());
        if (this.peek().kind === "punct" && this.peek().value === ",") {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expect("keyword", "FROM");
    const table = this.parseName();
    let where: Expr | null = null;
    if (this.matchKeyword("WHERE")) where = this.parseExpr();
    let orderBy: OrderBy[] = [];
    if (this.matchKeyword("ORDER")) {
      this.expect("keyword", "BY");
      orderBy = [];
      while (true) {
        const col = this.parseName();
        let dir: "ASC" | "DESC" = "ASC";
        if (this.matchKeyword("ASC")) dir = "ASC";
        else if (this.matchKeyword("DESC")) dir = "DESC";
        orderBy.push({ col, dir });
        if (this.peek().kind === "punct" && this.peek().value === ",") {
          this.next();
          continue;
        }
        break;
      }
    }
    let limit: number | null = null;
    let offset: number | null = null;
    if (this.matchKeyword("LIMIT")) {
      limit = Number(this.expect("number").value);
    }
    if (this.matchKeyword("OFFSET")) {
      offset = Number(this.expect("number").value);
    }
    return { type: "select", distinct, columns, table, where, orderBy, limit, offset };
  }

  private parseUpdate(): UpdateStmt {
    this.expect("keyword", "UPDATE");
    const table = this.parseName();
    this.expect("keyword", "SET");
    const sets: { col: string; value: Expr }[] = [];
    while (true) {
      const col = this.parseName();
      const op = this.next();
      if (op.kind !== "op" || op.value !== "=") throw new Error("SET 子句缺少 =");
      const value = this.parseExpr();
      sets.push({ col, value });
      if (this.peek().kind === "punct" && this.peek().value === ",") {
        this.next();
        continue;
      }
      break;
    }
    let where: Expr | null = null;
    if (this.matchKeyword("WHERE")) where = this.parseExpr();
    return { type: "update", table, sets, where };
  }

  private parseDelete(): DeleteStmt {
    this.expect("keyword", "DELETE");
    this.expect("keyword", "FROM");
    const table = this.parseName();
    let where: Expr | null = null;
    if (this.matchKeyword("WHERE")) where = this.parseExpr();
    return { type: "delete", table, where };
  }

  // 表达式：OR < AND < 比较/LIKE/IS
  private parseExpr(): Expr {
    return this.parseOr();
  }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isKeyword("OR")) {
      this.next();
      const r = this.parseAnd();
      l = { k: "bin", op: "OR", l, r };
    }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parsePred();
    while (this.isKeyword("AND")) {
      this.next();
      const r = this.parsePred();
      l = { k: "bin", op: "AND", l, r };
    }
    return l;
  }
  private parsePred(): Expr {
    // 括号
    if (this.peek().kind === "punct" && this.peek().value === "(") {
      this.next();
      const e = this.parseExpr();
      this.expect("punct", ")");
      return e;
    }
    const left = this.parsePrimary();
    if (left.k !== "col") return left;
    // IS [NOT] NULL
    if (this.matchKeyword("IS")) {
      const negate = this.matchKeyword("NOT");
      this.expect("keyword", "NULL");
      return { k: "isnull", col: left.name, negate };
    }
    // LIKE / NOT LIKE
    if (this.isKeyword("LIKE")) {
      this.next();
      const pat = this.expect("string").value;
      return { k: "like", col: left.name, pattern: pat, negate: false };
    }
    if (this.isKeyword("NOT")) {
      this.next();
      this.expect("keyword", "LIKE");
      const pat = this.expect("string").value;
      return { k: "like", col: left.name, pattern: pat, negate: true };
    }
    // 比较运算符
    const t = this.peek();
    if (t.kind === "op") {
      this.next();
      const right = this.parsePrimary();
      return { k: "bin", op: t.value, l: left, r: right };
    }
    return left;
  }
  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === "string") {
      this.next();
      return { k: "lit", value: t.value };
    }
    if (t.kind === "number") {
      this.next();
      const num = Number(t.value);
      return { k: "lit", value: num };
    }
    if (t.kind === "keyword" && t.value === "NULL") {
      this.next();
      return { k: "lit", value: null };
    }
    if (t.kind === "ident") {
      this.next();
      return { k: "col", name: t.value };
    }
    throw new Error(`语法错误: 意外的 token '${t.value}'`);
  }
  private parseLiteral(): unknown {
    const t = this.peek();
    if (t.kind === "string") {
      this.next();
      return t.value;
    }
    if (t.kind === "number") {
      this.next();
      return Number(t.value);
    }
    if (t.kind === "keyword" && t.value === "NULL") {
      this.next();
      return null;
    }
    throw new Error(`语法错误: 期望字面量 实际 '${t.value}'`);
  }
  private parseName(): string {
    const t = this.next();
    if (t.kind !== "ident") throw new Error(`语法错误: 期望标识符 实际 '${t.value}'`);
    return t.value;
  }
}

/* ----------------------- Evaluator ----------------------- */

function evalExpr(expr: Expr, row: Record<string, unknown>): unknown {
  switch (expr.k) {
    case "lit": return expr.value;
    case "col": return row[expr.name];
    case "isnull": {
      const v = row[expr.col];
      const isn = v === null || v === undefined;
      return expr.negate ? !isn : isn;
    }
    case "like": {
      const v = row[expr.col];
      const re = likeToRegex(expr.pattern);
      const m = typeof v === "string" && re.test(v);
      return expr.negate ? !m : m;
    }
    case "bin": {
      if (expr.op === "AND") {
        return Boolean(evalExpr(expr.l, row)) && Boolean(evalExpr(expr.r, row));
      }
      if (expr.op === "OR") {
        return Boolean(evalExpr(expr.l, row)) || Boolean(evalExpr(expr.r, row));
      }
      const l = evalExpr(expr.l, row);
      const r = evalExpr(expr.r, row);
      switch (expr.op) {
        case "=": return l === r;
        case "!=":
        case "<>": return l !== r;
        case "<": return cmp(l, r) < 0;
        case ">": return cmp(l, r) > 0;
        case "<=": return cmp(l, r) <= 0;
        case ">=": return cmp(l, r) >= 0;
      }
      return false;
    }
  }
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function likeToRegex(p: string): RegExp {
  let re = "^";
  for (const c of p) {
    if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else if (/[.*+?^${}()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  re += "$";
  return new RegExp(re, "i");
}

/* ----------------------- Database ----------------------- */

export class SqlDB {
  private tables = new Map<string, Table>();
  private file: string | null;

  constructor(file?: string) {
    this.file = file ? path.resolve(file) : null;
    this.load();
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as { tables: Table[] };
    for (const t of data.tables) this.tables.set(t.name, t);
  }

  private save(): void {
    if (!this.file) return;
    const data = { tables: Array.from(this.tables.values()) };
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  exec(sql: string): { changes: number; message: string } {
    const toks = tokenize(sql);
    const parser = new Parser(toks);
    const stmts = parser.parseAll();
    let total = 0;
    let last = "";
    for (const s of stmts) {
      const r = this.run(s);
      total += r.changes;
      last = r.message;
    }
    this.save();
    return { changes: total, message: last };
  }

  query(sql: string): { columns: string[]; rows: Record<string, unknown>[] } {
    const toks = tokenize(sql);
    const parser = new Parser(toks);
    const stmts = parser.parseAll();
    if (stmts.length !== 1 || stmts[0].type !== "select") {
      throw new Error("query 只能执行单个 SELECT 语句");
    }
    return this.runSelect(stmts[0]);
  }

  private run(s: Stmt): { changes: number; message: string } {
    switch (s.type) {
      case "create": return this.runCreate(s);
      case "insert": return this.runInsert(s);
      case "select": {
        // 不持久化，但返回行数信息
        const r = this.runSelect(s);
        return { changes: r.rows.length, message: `查询返回 ${r.rows.length} 行` };
      }
      case "update": return this.runUpdate(s);
      case "delete": return this.runDelete(s);
    }
  }

  private runCreate(s: CreateStmt): { changes: number; message: string } {
    if (this.tables.has(s.table)) throw new Error(`表已存在: ${s.table}`);
    this.tables.set(s.table, { name: s.table, columns: s.columns, rows: [], autoInc: 0 });
    return { changes: 0, message: `表 ${s.table} 已创建` };
  }

  private runInsert(s: InsertStmt): { changes: number; message: string } {
    const t = this.tables.get(s.table);
    if (!t) throw new Error(`表不存在: ${s.table}`);
    const cols = s.columns ?? t.columns.map((c) => c.name);
    let count = 0;
    for (const vals of s.rows) {
      if (vals.length !== cols.length) throw new Error("INSERT 列数不匹配");
      const row: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) {
        const colDef = t.columns.find((c) => c.name === cols[i]);
        if (!colDef) throw new Error(`未知列: ${cols[i]}`);
        row[cols[i]] = coerce(vals[i], colDef.type);
      }
      // 主键自增
      for (const c of t.columns) {
        if (c.primaryKey && (row[c.name] === undefined || row[c.name] === null)) {
          t.autoInc++;
          row[c.name] = t.autoInc;
        }
      }
      // 缺省 NOT NULL 校验
      for (const c of t.columns) {
        if (c.notNull && (row[c.name] === undefined || row[c.name] === null)) {
          throw new Error(`列 ${c.name} 不能为空`);
        }
      }
      t.rows.push(row);
      count++;
    }
    return { changes: count, message: `插入 ${count} 行` };
  }

  private runSelect(s: SelectStmt): { columns: string[]; rows: Record<string, unknown>[] } {
    const t = this.tables.get(s.table);
    if (!t) throw new Error(`表不存在: ${s.table}`);
    let rows = t.rows.slice();
    if (s.where) rows = rows.filter((r) => Boolean(evalExpr(s.where!, r)));
    if (s.orderBy.length > 0) {
      rows.sort((a, b) => {
        for (const o of s.orderBy) {
          const d = cmp(a[o.col], b[o.col]);
          if (d !== 0) return o.dir === "ASC" ? d : -d;
        }
        return 0;
      });
    }
    if (s.offset !== null) rows = rows.slice(s.offset);
    if (s.limit !== null) rows = rows.slice(0, s.limit);
    const cols = s.columns === "*" ? t.columns.map((c) => c.name) : s.columns;
    const out = rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of cols) o[c] = r[c];
      return o;
    });
    let finalRows = out;
    if (s.distinct) {
      const seen = new Set<string>();
      finalRows = [];
      for (const r of out) {
        const k = JSON.stringify(r);
        if (!seen.has(k)) {
          seen.add(k);
          finalRows.push(r);
        }
      }
    }
    return { columns: cols, rows: finalRows };
  }

  private runUpdate(s: UpdateStmt): { changes: number; message: string } {
    const t = this.tables.get(s.table);
    if (!t) throw new Error(`表不存在: ${s.table}`);
    let count = 0;
    for (const row of t.rows) {
      if (s.where && !evalExpr(s.where, row)) continue;
      for (const set of s.sets) {
        const colDef = t.columns.find((c) => c.name === set.col);
        if (!colDef) throw new Error(`未知列: ${set.col}`);
        row[set.col] = coerce(evalExpr(set.value, row), colDef.type);
      }
      count++;
    }
    return { changes: count, message: `更新 ${count} 行` };
  }

  private runDelete(s: DeleteStmt): { changes: number; message: string } {
    const t = this.tables.get(s.table);
    if (!t) throw new Error(`表不存在: ${s.table}`);
    const before = t.rows.length;
    t.rows = t.rows.filter((r) => !(s.where ? evalExpr(s.where, r) : true));
    const n = before - t.rows.length;
    return { changes: n, message: `删除 ${n} 行` };
  }

  tablesList(): string[] {
    return Array.from(this.tables.keys());
  }

  schema(table: string): ColumnDef[] {
    const t = this.tables.get(table);
    if (!t) throw new Error(`表不存在: ${table}`);
    return t.columns;
  }

  exportCsv(table: string): string {
    const t = this.tables.get(table);
    if (!t) throw new Error(`表不存在: ${table}`);
    const cols = t.columns.map((c) => c.name);
    const lines = [cols.join(",")];
    for (const r of t.rows) {
      lines.push(cols.map((c) => csvEscape(r[c])).join(","));
    }
    return lines.join("\n");
  }

  importCsv(table: string, csv: string): number {
    const t = this.tables.get(table);
    if (!t) throw new Error(`表不存在: ${table}`);
    const rows = parseCsv(csv);
    if (rows.length < 1) return 0;
    const header = rows[0];
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row: Record<string, unknown> = {};
      for (let j = 0; j < header.length; j++) {
        const colDef = t.columns.find((c) => c.name === header[j]);
        if (!colDef) throw new Error(`未知列: ${header[j]}`);
        row[header[j]] = coerce(parseCsvValue(rows[i][j]), colDef.type);
      }
      t.rows.push(row);
      count++;
    }
    this.save();
    return count;
  }
}

function coerce(v: unknown, type: ColType): unknown {
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
  }
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvValue(s: string): string {
  return s;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ----------------------- CLI ----------------------- */

function printTable(columns: string[], rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("(空结果集)");
    return;
  }
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => fmt(r[c]).length)));
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  console.log(columns.map((c, i) => pad(c, widths[i])).join(" | "));
  console.log(sep);
  for (const r of rows) {
    console.log(columns.map((c, i) => pad(fmt(r[c]), widths[i])).join(" | "));
  }
  console.log(`(${rows.length} 行)`);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") return v;
  return String(v);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const dbFile = path.join(process.cwd(), "sql.json");
  const db = new SqlDB(dbFile);

  if (!cmd) {
    console.log(`内存 SQL 数据库 CLI
用法:
  exec <sql>                 执行 SQL（可多条，分号分隔）
  query <sql>                执行 SELECT 查询并打印表格
  script <file.sql>          执行脚本文件
  tables                     列出所有表
  schema <table>             查看表结构
  import <table> <csv>       从 CSV 导入
  export <table> [csv]       导出到 CSV（默认打印到 stdout）
示例:
  exec "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);"
  exec "INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25);"
  query "SELECT * FROM users WHERE age > 26 ORDER BY age DESC"
`);
    return;
  }

  switch (cmd) {
    case "exec": {
      const r = db.exec(rest.join(" "));
      console.log(r.message + ` (changes=${r.changes})`);
      break;
    }
    case "query": {
      const r = db.query(rest.join(" "));
      printTable(r.columns, r.rows);
      break;
    }
    case "script": {
      const file = rest[0];
      if (!file) throw new Error("缺少文件路径");
      const sql = fs.readFileSync(path.resolve(file), "utf8");
      const r = db.exec(sql);
      console.log(r.message + ` (changes=${r.changes})`);
      break;
    }
    case "tables":
      console.log(db.tablesList().join("\n") || "(无表)");
      break;
    case "schema": {
      const t = rest[0];
      if (!t) throw new Error("缺少表名");
      for (const c of db.schema(t)) {
        const flags = [c.primaryKey ? "PK" : "", c.notNull ? "NOT NULL" : ""].filter(Boolean).join(" ");
        console.log(`  ${c.name} ${c.type} ${flags}`.trim());
      }
      break;
    }
    case "import": {
      const [t, f] = rest;
      if (!t || !f) throw new Error("用法: import <table> <csv>");
      const csv = fs.readFileSync(path.resolve(f), "utf8");
      const n = db.importCsv(t, csv);
      console.log(`导入 ${n} 行到 ${t}`);
      break;
    }
    case "export": {
      const [t, f] = rest;
      if (!t) throw new Error("缺少表名");
      const csv = db.exportCsv(t);
      if (f) fs.writeFileSync(path.resolve(f), csv, "utf8");
      else console.log(csv);
      break;
    }
    case "demo": {
      db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
               INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25), ('Carol', 35);`);
      console.log("--- 全部用户 ---");
      const all = db.query("SELECT * FROM users ORDER BY age DESC");
      printTable(all.columns, all.rows);
      console.log("--- age > 26 ---");
      const r = db.query("SELECT name, age FROM users WHERE age > 26");
      printTable(r.columns, r.rows);
      console.log("--- LIKE 查询 ---");
      const r2 = db.query("SELECT * FROM users WHERE name LIKE 'A%'");
      printTable(r2.columns, r2.rows);
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
