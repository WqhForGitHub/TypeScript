#!/usr/bin/env node
/**
 * 内存 SQL 数据库封装（含词法分析器与语法分析器）
 * 支持: CREATE/INSERT/SELECT/UPDATE/DELETE, WHERE, LIKE, IS NULL, ORDER BY,
 *       LIMIT/OFFSET, DISTINCT, INNER/LEFT JOIN, CSV 导入导出, JSON 持久化。
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";

enum TokenType {
  Keyword = "keyword",
  Ident = "ident",
  Number = "number",
  String = "string",
  Op = "op",
  Punct = "punct",
  Eof = "eof",
}
enum KeywordType {
  Create = "CREATE",
  Table = "TABLE",
  Insert = "INSERT",
  Into = "INTO",
  Values = "VALUES",
  Select = "SELECT",
  From = "FROM",
  Where = "WHERE",
  Order = "ORDER",
  By = "BY",
  Asc = "ASC",
  Desc = "DESC",
  Limit = "LIMIT",
  Offset = "OFFSET",
  Update = "UPDATE",
  Set = "SET",
  Delete = "DELETE",
  And = "AND",
  Or = "OR",
  Like = "LIKE",
  Is = "IS",
  Null = "NULL",
  Not = "NOT",
  Primary = "PRIMARY",
  Key = "KEY",
  Integer = "INTEGER",
  Text = "TEXT",
  Real = "REAL",
  Distinct = "DISTINCT",
  Join = "JOIN",
  On = "ON",
  Inner = "INNER",
  Left = "LEFT",
}
enum ErrorCode {
  Tokenize = "TOKENIZE",
  Parse = "PARSE",
  Eval = "EVAL",
  Runtime = "RUNTIME",
}
enum StatementType {
  Create = "create",
  Insert = "insert",
  Select = "select",
  Update = "update",
  Delete = "delete",
}
enum JoinType {
  Inner = "INNER",
  Left = "LEFT",
  Right = "RIGHT",
}

class SqlError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
class TokenizeError extends SqlError {
  constructor(m: string) {
    super(ErrorCode.Tokenize, m);
  }
}
class ParseError extends SqlError {
  constructor(m: string) {
    super(ErrorCode.Parse, m);
  }
}
class EvalError extends SqlError {
  constructor(m: string) {
    super(ErrorCode.Eval, m);
  }
}

type ColType = "INTEGER" | "TEXT" | "REAL";
interface ColumnDef {
  readonly name: string;
  type: ColType;
  primaryKey?: boolean;
  notNull?: boolean;
}
interface Row {
  [key: string]: unknown;
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface SerializedTable {
  readonly name: string;
  readonly columns: ColumnDef[];
  readonly rows: Row[];
  readonly autoInc: number;
}
type WritableSerializedTable = Mutable<SerializedTable>;

const SYM_ORIGIN: unique symbol = Symbol("origin");
const SUPPORTED_TYPES = ["INTEGER", "TEXT", "REAL"] as const;
const KEYWORDS = new Set<string>(
  Object.values(KeywordType),
) satisfies Set<string>;

class Table<T extends Row = Row> {
  readonly name: string;
  readonly columns: ColumnDef[];
  rows: T[];
  private _autoInc = 0;
  [SYM_ORIGIN]: string;
  constructor(name: string, columns: ColumnDef[]) {
    this.name = name;
    this.columns = columns;
    this.rows = [];
    this[SYM_ORIGIN] = name;
  }
  get count(): number {
    return this.rows.length;
  }
  get autoInc(): number {
    return this._autoInc;
  }
  set autoInc(v: number) {
    this._autoInc = v;
  }
  nextAutoInc(): number {
    this._autoInc++;
    return this._autoInc;
  }
  *[Symbol.iterator](): Iterator<T> {
    for (const r of this.rows) yield r;
  }
  *iter(): IterableIterator<T> {
    yield* this.rows;
  }
}

interface Token {
  readonly kind: TokenType;
  readonly value: string;
  readonly pos: number;
}

function tokenize(sql: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = sql.length;
  const isId = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isDig = (c: string) => /[0-9]/.test(c);
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
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
      toks.push({ kind: TokenType.String, value: s, pos: i });
      continue;
    }
    if (c === '"') {
      i++;
      let s = "";
      while (i < n && sql[i] !== '"') {
        s += sql[i];
        i++;
      }
      i++;
      toks.push({ kind: TokenType.Ident, value: s, pos: i });
      continue;
    }
    if (isDig(c) || (c === "." && isDig(sql[i + 1]))) {
      let s = "";
      while (i < n && (isDig(sql[i]) || sql[i] === ".")) {
        s += sql[i];
        i++;
      }
      toks.push({ kind: TokenType.Number, value: s, pos: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < n && isId(sql[i])) {
        s += sql[i];
        i++;
      }
      const up = s.toUpperCase();
      toks.push(
        KEYWORDS.has(up)
          ? { kind: TokenType.Keyword, value: up, pos: i }
          : { kind: TokenType.Ident, value: s, pos: i },
      );
      continue;
    }
    if (c === "<" || c === ">" || c === "!" || c === "=") {
      let s = c;
      if (sql[i + 1] === "=") s += "=";
      else if (c === "<" && sql[i + 1] === ">") s = "<>";
      i += s.length;
      toks.push({ kind: TokenType.Op, value: s, pos: i });
      continue;
    }
    if ("(),.*;".includes(c)) {
      toks.push({ kind: TokenType.Punct, value: c, pos: i });
      i++;
      continue;
    }
    throw new TokenizeError(`未知字符 '${c}' 于位置 ${i}`);
  }
  toks.push({ kind: TokenType.Eof, value: "", pos: n });
  return toks;
}

/* AST statement nodes (discriminated union, enum discriminants) */
interface CreateStmt {
  type: StatementType.Create;
  table: string;
  columns: ColumnDef[];
}
interface InsertStmt {
  type: StatementType.Insert;
  table: string;
  columns: string[] | null;
  rows: unknown[][];
}
interface OrderBy {
  col: string;
  dir: "ASC" | "DESC";
}
interface JoinClause {
  type: JoinType;
  table: string;
  on: AbstractExpression;
}
interface SelectStmt {
  type: StatementType.Select;
  distinct: boolean;
  columns: string[] | "*";
  table: string;
  where: AbstractExpression | null;
  orderBy: OrderBy[];
  limit: number | null;
  offset: number | null;
  join: JoinClause | null;
}
interface UpdateStmt {
  type: StatementType.Update;
  table: string;
  sets: { col: string; value: AbstractExpression }[];
  where: AbstractExpression | null;
}
interface DeleteStmt {
  type: StatementType.Delete;
  table: string;
  where: AbstractExpression | null;
}
type Stmt = CreateStmt | InsertStmt | SelectStmt | UpdateStmt | DeleteStmt;

const isCreate = (s: Stmt): s is CreateStmt => s.type === StatementType.Create;
const isInsert = (s: Stmt): s is InsertStmt => s.type === StatementType.Insert;
const isSelect = (s: Stmt): s is SelectStmt => s.type === StatementType.Select;
const isUpdate = (s: Stmt): s is UpdateStmt => s.type === StatementType.Update;
const isDelete = (s: Stmt): s is DeleteStmt => s.type === StatementType.Delete;

/* Expression hierarchy: abstract base + concrete subclasses */
abstract class AbstractExpression {
  abstract get kind(): string;
  abstract eval(row: Row): unknown;
}
class LiteralExpr extends AbstractExpression {
  constructor(readonly value: unknown) {
    super();
  }
  get kind() {
    return "lit";
  }
  eval(): unknown {
    return this.value;
  }
}
class ColumnExpr extends AbstractExpression {
  constructor(readonly name: string) {
    super();
  }
  get kind() {
    return "col";
  }
  eval(row: Row): unknown {
    return row[this.name];
  }
}
class BinaryExpr extends AbstractExpression {
  constructor(
    readonly op: string,
    readonly left: AbstractExpression,
    readonly right: AbstractExpression,
  ) {
    super();
  }
  get kind() {
    return "bin";
  }
  eval(row: Row): unknown {
    const { op, left, right } = this;
    if (op === "AND")
      return Boolean(left.eval(row)) && Boolean(right.eval(row));
    if (op === "OR") return Boolean(left.eval(row)) || Boolean(right.eval(row));
    const l = left.eval(row),
      r = right.eval(row);
    switch (op) {
      case "=":
        return l === r;
      case "!=":
      case "<>":
        return l !== r;
      case "<":
        return cmp(l, r) < 0;
      case ">":
        return cmp(l, r) > 0;
      case "<=":
        return cmp(l, r) <= 0;
      case ">=":
        return cmp(l, r) >= 0;
    }
    throw new EvalError(`未知运算符: ${op}`);
  }
}
class LikeExpr extends AbstractExpression {
  constructor(
    readonly col: string,
    readonly pattern: string,
    readonly negate: boolean,
  ) {
    super();
  }
  get kind() {
    return "like";
  }
  eval(row: Row): unknown {
    const v = row[this.col];
    const m = typeof v === "string" && likeToRegex(this.pattern).test(v);
    return this.negate ? !m : m;
  }
}
class IsNullExpr extends AbstractExpression {
  constructor(
    readonly col: string,
    readonly negate: boolean,
  ) {
    super();
  }
  get kind() {
    return "isnull";
  }
  eval(row: Row): unknown {
    const v = row[this.col];
    const isn = v === null || v === undefined;
    return this.negate ? !isn : isn;
  }
}

class Parser {
  private p = 0;
  constructor(private toks: Token[]) {}
  private peek(): Token {
    return this.toks[this.p];
  }
  private next(): Token {
    return this.toks[this.p++];
  }
  private isKw(kw: string): boolean {
    return this.peek().kind === TokenType.Keyword && this.peek().value === kw;
  }
  private isPunct(v: string): boolean {
    return this.peek().kind === TokenType.Punct && this.peek().value === v;
  }
  private matchKw(kw: string): boolean {
    if (this.isKw(kw)) {
      this.next();
      return true;
    }
    return false;
  }
  private expect(kind: TokenType, value?: string): Token {
    const t = this.peek();
    if (
      t.kind !== kind ||
      (value !== undefined && t.value.toUpperCase() !== value.toUpperCase())
    )
      throw new ParseError(`期望 ${value || kind} 实际 ${t.kind} '${t.value}'`);
    return this.next();
  }
  parseAll(): Stmt[] {
    const out: Stmt[] = [];
    while (this.peek().kind !== TokenType.Eof) {
      const s = this.parseStatement();
      if (s) out.push(s);
      while (this.isPunct(";")) this.next();
    }
    return out;
  }
  private parseName(): string {
    const t = this.next();
    if (t.kind !== TokenType.Ident)
      throw new ParseError(`期望标识符 实际 '${t.value}'`);
    return t.value;
  }
  private parseStatement(): Stmt {
    const t = this.peek();
    if (t.kind !== TokenType.Keyword)
      throw new ParseError(`期望语句开头 实际 '${t.value}'`);
    switch (t.value) {
      case KeywordType.Create:
        return this.parseCreate();
      case KeywordType.Insert:
        return this.parseInsert();
      case KeywordType.Select:
        return this.parseSelect();
      case KeywordType.Update:
        return this.parseUpdate();
      case KeywordType.Delete:
        return this.parseDelete();
      default:
        throw new ParseError(`不支持的语句: ${t.value}`);
    }
  }
  private parseCreate(): CreateStmt {
    this.expect(TokenType.Keyword, "CREATE");
    this.expect(TokenType.Keyword, "TABLE");
    const table = this.parseName();
    this.expect(TokenType.Punct, "(");
    const columns: ColumnDef[] = [];
    while (true) {
      const name = this.parseName();
      const tt = this.next();
      if (
        tt.kind !== TokenType.Keyword ||
        !SUPPORTED_TYPES.includes(tt.value as ColType)
      )
        throw new ParseError(`未知列类型: ${tt.value}`);
      const col: ColumnDef = { name, type: tt.value as ColType };
      while (true) {
        if (this.matchKw("PRIMARY")) {
          this.expect(TokenType.Keyword, "KEY");
          col.primaryKey = true;
        } else if (this.matchKw("NOT")) {
          this.expect(TokenType.Keyword, "NULL");
          col.notNull = true;
        } else break;
      }
      columns.push(col);
      if (this.isPunct(",")) {
        this.next();
        continue;
      }
      break;
    }
    this.expect(TokenType.Punct, ")");
    return { type: StatementType.Create, table, columns };
  }
  private parseInsert(): InsertStmt {
    this.expect(TokenType.Keyword, "INSERT");
    this.expect(TokenType.Keyword, "INTO");
    const table = this.parseName();
    let columns: string[] | null = null;
    if (this.isPunct("(")) {
      this.next();
      columns = [];
      while (true) {
        columns.push(this.parseName());
        if (this.isPunct(",")) {
          this.next();
          continue;
        }
        break;
      }
      this.expect(TokenType.Punct, ")");
    }
    this.expect(TokenType.Keyword, "VALUES");
    const rows: unknown[][] = [];
    while (true) {
      this.expect(TokenType.Punct, "(");
      const vals: unknown[] = [];
      while (true) {
        vals.push(this.parseLiteral());
        if (this.isPunct(",")) {
          this.next();
          continue;
        }
        break;
      }
      this.expect(TokenType.Punct, ")");
      rows.push(vals);
      if (this.isPunct(",")) {
        this.next();
        continue;
      }
      break;
    }
    return { type: StatementType.Insert, table, columns, rows };
  }
  private parseSelect(): SelectStmt {
    this.expect(TokenType.Keyword, "SELECT");
    const distinct = this.matchKw("DISTINCT");
    let columns: string[] | "*" = "*";
    if (this.isPunct("*")) {
      this.next();
    } else {
      columns = [];
      while (true) {
        columns.push(this.parseName());
        if (this.isPunct(",")) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expect(TokenType.Keyword, "FROM");
    const table = this.parseName();
    let join: JoinClause | null = null;
    if (this.isKw("INNER") || this.isKw("LEFT") || this.isKw("JOIN")) {
      let jt = JoinType.Inner;
      if (this.matchKw("INNER")) jt = JoinType.Inner;
      else if (this.matchKw("LEFT")) jt = JoinType.Left;
      this.expect(TokenType.Keyword, "JOIN");
      const jtable = this.parseName();
      this.expect(TokenType.Keyword, "ON");
      join = { type: jt, table: jtable, on: this.parseExpr() };
    }
    let where: AbstractExpression | null = null;
    if (this.matchKw("WHERE")) where = this.parseExpr();
    let orderBy: OrderBy[] = [];
    if (this.matchKw("ORDER")) {
      this.expect(TokenType.Keyword, "BY");
      while (true) {
        const col = this.parseName();
        let dir: "ASC" | "DESC" = "ASC";
        if (this.matchKw("ASC")) dir = "ASC";
        else if (this.matchKw("DESC")) dir = "DESC";
        orderBy.push({ col, dir });
        if (this.isPunct(",")) {
          this.next();
          continue;
        }
        break;
      }
    }
    let limit: number | null = null;
    let offset: number | null = null;
    if (this.matchKw("LIMIT"))
      limit = Number(this.expect(TokenType.Number).value);
    if (this.matchKw("OFFSET"))
      offset = Number(this.expect(TokenType.Number).value);
    return {
      type: StatementType.Select,
      distinct,
      columns,
      table,
      where,
      orderBy,
      limit,
      offset,
      join,
    };
  }
  private parseUpdate(): UpdateStmt {
    this.expect(TokenType.Keyword, "UPDATE");
    const table = this.parseName();
    this.expect(TokenType.Keyword, "SET");
    const sets: { col: string; value: AbstractExpression }[] = [];
    while (true) {
      const col = this.parseName();
      const op = this.next();
      if (op.kind !== TokenType.Op || op.value !== "=")
        throw new ParseError("SET 子句缺少 =");
      sets.push({ col, value: this.parseExpr() });
      if (this.isPunct(",")) {
        this.next();
        continue;
      }
      break;
    }
    let where: AbstractExpression | null = null;
    if (this.matchKw("WHERE")) where = this.parseExpr();
    return { type: StatementType.Update, table, sets, where };
  }
  private parseDelete(): DeleteStmt {
    this.expect(TokenType.Keyword, "DELETE");
    this.expect(TokenType.Keyword, "FROM");
    const table = this.parseName();
    let where: AbstractExpression | null = null;
    if (this.matchKw("WHERE")) where = this.parseExpr();
    return { type: StatementType.Delete, table, where };
  }
  private parseExpr(): AbstractExpression {
    return this.parseOr();
  }
  private parseOr(): AbstractExpression {
    let l = this.parseAnd();
    while (this.isKw("OR")) {
      this.next();
      l = new BinaryExpr("OR", l, this.parseAnd());
    }
    return l;
  }
  private parseAnd(): AbstractExpression {
    let l = this.parsePred();
    while (this.isKw("AND")) {
      this.next();
      l = new BinaryExpr("AND", l, this.parsePred());
    }
    return l;
  }
  private parsePred(): AbstractExpression {
    if (this.isPunct("(")) {
      this.next();
      const e = this.parseExpr();
      this.expect(TokenType.Punct, ")");
      return e;
    }
    const left = this.parsePrimary();
    if (!(left instanceof ColumnExpr)) return left;
    if (this.matchKw("IS")) {
      const neg = this.matchKw("NOT");
      this.expect(TokenType.Keyword, "NULL");
      return new IsNullExpr(left.name, neg);
    }
    if (this.isKw("LIKE")) {
      this.next();
      return new LikeExpr(
        left.name,
        this.expect(TokenType.String).value,
        false,
      );
    }
    if (this.isKw("NOT")) {
      this.next();
      this.expect(TokenType.Keyword, "LIKE");
      return new LikeExpr(left.name, this.expect(TokenType.String).value, true);
    }
    const t = this.peek();
    if (t.kind === TokenType.Op) {
      this.next();
      return new BinaryExpr(t.value, left, this.parsePrimary());
    }
    return left;
  }
  private parsePrimary(): AbstractExpression {
    const t = this.peek();
    if (t.kind === TokenType.String) {
      this.next();
      return new LiteralExpr(t.value);
    }
    if (t.kind === TokenType.Number) {
      this.next();
      return new LiteralExpr(Number(t.value));
    }
    if (t.kind === TokenType.Keyword && t.value === "NULL") {
      this.next();
      return new LiteralExpr(null);
    }
    if (t.kind === TokenType.Ident) {
      this.next();
      return new ColumnExpr(t.value);
    }
    throw new ParseError(`意外的 token '${t.value}'`);
  }
  private parseLiteral(): unknown {
    const t = this.peek();
    if (t.kind === TokenType.String) {
      this.next();
      return t.value;
    }
    if (t.kind === TokenType.Number) {
      this.next();
      return Number(t.value);
    }
    if (t.kind === TokenType.Keyword && t.value === "NULL") {
      this.next();
      return null;
    }
    throw new ParseError(`期望字面量 实际 '${t.value}'`);
  }
}

/* Helpers */
function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a),
    sb = String(b);
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
  return new RegExp(re + "$", "i");
}
function coerce(v: unknown, type: ColType): unknown {
  if (v === null || v === undefined) return null;
  if (type === "INTEGER") {
    const x = typeof v === "number" ? v : parseInt(String(v), 10);
    return Number.isNaN(x) ? null : x;
  }
  if (type === "REAL") {
    const x = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isNaN(x) ? null : x;
  }
  return String(v);
}
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
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

/* Database */
type ExecResult = { changes: number; message: string };
type QueryResult = { columns: string[]; rows: Row[] };

export class SqlDB {
  private tables = new Map<string, Table<Row>>();
  private file: string | null;
  constructor(file?: string) {
    this.file = file ? path.resolve(file) : null;
    this.load();
  }
  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as {
      tables: WritableSerializedTable[];
    };
    for (const t of data.tables) {
      const tbl = new Table<Row>(t.name, t.columns);
      tbl.rows = t.rows;
      tbl.autoInc = t.autoInc;
      this.tables.set(t.name, tbl);
    }
  }
  private save(): void {
    if (!this.file) return;
    const tables: WritableSerializedTable[] = Array.from(
      this.tables.values(),
    ).map((t) => ({
      name: t.name,
      columns: t.columns,
      rows: t.rows,
      autoInc: t.autoInc,
    }));
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ tables }, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }
  exec(sql: string): ExecResult {
    const stmts = new Parser(tokenize(sql)).parseAll();
    let total = 0,
      last = "";
    for (const s of stmts) {
      const r = this.run(s);
      total += r.changes;
      last = r.message;
    }
    this.save();
    return { changes: total, message: last };
  }
  query(sql: string): QueryResult {
    const stmts = new Parser(tokenize(sql)).parseAll();
    if (stmts.length !== 1 || !isSelect(stmts[0]))
      throw new EvalError("query 只能执行单个 SELECT");
    return this.runSelect(stmts[0]);
  }
  private run(s: Stmt): ExecResult {
    if (isCreate(s)) return this.runCreate(s);
    if (isInsert(s)) return this.runInsert(s);
    if (isSelect(s)) {
      const r = this.runSelect(s);
      return {
        changes: r.rows.length,
        message: `查询返回 ${r.rows.length} 行`,
      };
    }
    if (isUpdate(s)) return this.runUpdate(s);
    if (isDelete(s)) return this.runDelete(s);
    throw new EvalError("未知语句");
  }
  private getTable(name: string): Table<Row> {
    const t = this.tables.get(name);
    if (!t) throw new EvalError(`表不存在: ${name}`);
    return t;
  }
  private runCreate(s: CreateStmt): ExecResult {
    if (this.tables.has(s.table)) throw new EvalError(`表已存在: ${s.table}`);
    this.tables.set(s.table, new Table<Row>(s.table, s.columns));
    return { changes: 0, message: `表 ${s.table} 已创建` };
  }
  private runInsert(s: InsertStmt): ExecResult {
    const t = this.getTable(s.table);
    const cols = s.columns ?? t.columns.map((c) => c.name);
    let count = 0;
    for (const vals of s.rows) {
      if (vals.length !== cols.length) throw new EvalError("INSERT 列数不匹配");
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) {
        const cd = t.columns.find((c) => c.name === cols[i]);
        if (!cd) throw new EvalError(`未知列: ${cols[i]}`);
        row[cols[i]] = coerce(vals[i], cd.type);
      }
      for (const c of t.columns) {
        if (c.primaryKey && (row[c.name] === undefined || row[c.name] === null))
          row[c.name] = t.nextAutoInc();
      }
      for (const c of t.columns) {
        if (c.notNull && (row[c.name] === undefined || row[c.name] === null))
          throw new EvalError(`列 ${c.name} 不能为空`);
      }
      t.rows.push(row);
      count++;
    }
    return { changes: count, message: `插入 ${count} 行` };
  }
  private runSelect(s: SelectStmt): QueryResult {
    const t = this.getTable(s.table);
    let rows: Row[] = t.rows.slice();
    if (s.join) {
      const j = s.join;
      const t2 = this.getTable(j.table);
      const joined: Row[] = [];
      for (const a of rows) {
        let matched = false;
        for (const b of t2.rows) {
          const merged: Row = { ...a, ...b };
          if (Boolean(j.on.eval(merged))) {
            joined.push(merged);
            matched = true;
          }
        }
        if (!matched && j.type === JoinType.Left) joined.push({ ...a });
      }
      rows = joined;
    }
    if (s.where) rows = rows.filter((r) => Boolean(s.where!.eval(r)));
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
    let out = rows.map((r) => {
      const o: Row = {};
      for (const c of cols) o[c] = r[c];
      return o;
    });
    if (s.distinct) {
      const seen = new Set<string>();
      out = out.filter((r) => {
        const k = JSON.stringify(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return { columns: cols, rows: out };
  }
  private runUpdate(s: UpdateStmt): ExecResult {
    const t = this.getTable(s.table);
    let count = 0;
    for (const row of t.rows) {
      if (s.where && !s.where.eval(row)) continue;
      for (const set of s.sets) {
        const cd = t.columns.find((c) => c.name === set.col);
        if (!cd) throw new EvalError(`未知列: ${set.col}`);
        row[set.col] = coerce(set.value.eval(row), cd.type);
      }
      count++;
    }
    return { changes: count, message: `更新 ${count} 行` };
  }
  private runDelete(s: DeleteStmt): ExecResult {
    const t = this.getTable(s.table);
    const before = t.rows.length;
    t.rows = t.rows.filter((r) => !(s.where ? s.where.eval(r) : true));
    const n = before - t.rows.length;
    return { changes: n, message: `删除 ${n} 行` };
  }
  tablesList(): string[] {
    return Array.from(this.tables.keys());
  }
  schema(table: string): ColumnDef[] {
    return this.getTable(table).columns;
  }
  *scan(table: string): IterableIterator<Row> {
    yield* this.getTable(table).iter();
  }
  exportCsv(table: string): string;
  exportCsv(table: string, file: string): void;
  exportCsv(table: string, file?: string): string | void {
    const t = this.getTable(table);
    const cols = t.columns.map((c) => c.name);
    const lines = [cols.join(",")];
    for (const r of t.rows)
      lines.push(cols.map((c) => csvEscape(r[c])).join(","));
    const csv = lines.join("\n");
    if (file !== undefined) {
      fs.writeFileSync(path.resolve(file), csv, "utf8");
      return;
    }
    return csv;
  }
  importCsv(table: string, csv: string): number {
    const t = this.getTable(table);
    const rows = parseCsv(csv);
    if (rows.length < 1) return 0;
    const header = rows[0];
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row: Row = {};
      for (let j = 0; j < header.length; j++) {
        const cd = t.columns.find((c) => c.name === header[j]);
        if (!cd) throw new EvalError(`未知列: ${header[j]}`);
        row[header[j]] = coerce(rows[i][j], cd.type);
      }
      t.rows.push(row);
      count++;
    }
    this.save();
    return count;
  }
}

/* CLI */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  return typeof v === "string" ? v : String(v);
}
function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function printTable(columns: string[], rows: Row[]): void {
  if (rows.length === 0) {
    console.log("(空结果集)");
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => fmt(r[c]).length)),
  );
  console.log(columns.map((c, i) => pad(c, widths[i])).join(" | "));
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const r of rows)
    console.log(columns.map((c, i) => pad(fmt(r[c]), widths[i])).join(" | "));
  console.log(`(${rows.length} 行)`);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const db = new SqlDB(path.join(process.cwd(), "sql.json"));
  if (!cmd) {
    console.log(`内存 SQL 数据库 CLI
用法: exec <sql> | query <sql> | script <file> | tables | schema <t>
      import <t> <csv> | export <t> [csv] | scan <t> | demo`);
    return;
  }
  switch (cmd) {
    case "exec": {
      const r = db.exec(rest.join(" "));
      console.log(`${r.message} (changes=${r.changes})`);
      break;
    }
    case "query": {
      const r = db.query(rest.join(" "));
      printTable(r.columns, r.rows);
      break;
    }
    case "script": {
      const f = rest[0];
      if (!f) throw new Error("缺少文件路径");
      const sql = fs.readFileSync(path.resolve(f), "utf8");
      const r = db.exec(sql);
      console.log(`${r.message} (changes=${r.changes})`);
      break;
    }
    case "tables":
      console.log(db.tablesList().join("\n") || "(无表)");
      break;
    case "schema": {
      const t = rest[0];
      if (!t) throw new Error("缺少表名");
      for (const c of db.schema(t)) {
        const flags = [c.primaryKey ? "PK" : "", c.notNull ? "NOT NULL" : ""]
          .filter(Boolean)
          .join(" ");
        console.log(`  ${c.name} ${c.type} ${flags}`.trim());
      }
      break;
    }
    case "import": {
      const [t, f] = rest;
      if (!t || !f) throw new Error("用法: import <table> <csv>");
      const n = db.importCsv(t, fs.readFileSync(path.resolve(f), "utf8"));
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
    case "scan": {
      const t = rest[0];
      if (!t) throw new Error("缺少表名");
      for (const r of db.scan(t)) console.log(JSON.stringify(r));
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
