#!/usr/bin/env node
/**
 * CSV 转 JSON 工具 (enhanced edition)
 * 功能不变：完整 CSV 解析（引号/转义/嵌入换行/自定义分隔符/注释）、
 * 类型推断、JSON↔CSV、流式处理。仅用 Node 内置模块（fs/path/readline）。
 *
 * 刻意展示高级 TS 特性：字符串枚举、判别联合、泛型类与约束、抽象类、
 * 映射类型、自定义错误层级、接口（可选/只读/索引签名）、satisfies、
 * getter/setter、生成器与迭代器、Symbol 唯一键、as const、类型守卫、函数重载。
 */
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/* ---- 1. 字符串枚举（非 const enum）---- */

/** 解析器状态机状态 */
export enum State {
  Start = "Start",
  InField = "InField",
  InQuotes = "InQuotes",
  AfterQuote = "AfterQuote",
  Delimiter = "Delimiter",
  EndOfLine = "EndOfLine",
  Comment = "Comment",
}

/** 推断得到的列数据类型 */
export enum DataType {
  Integer = "integer",
  Real = "real",
  Number = "number",
  Boolean = "boolean",
  Date = "date",
  String = "string",
  Null = "null",
}

/** 错误码 */
export enum ErrorCode {
  InvalidDelimiter = "INVALID_DELIMITER",
  UnbalancedQuotes = "UNBALANCED_QUOTES",
  EmptyInput = "EMPTY_INPUT",
  UnknownCommand = "UNKNOWN_COMMAND",
  CoerceFailed = "COERCE_FAILED",
  HeaderMissing = "HEADER_MISSING",
  NotAnArray = "NOT_AN_ARRAY",
}

/** 转换结果状态 */
export enum ConvertResult {
  Success = "SUCCESS",
  Failure = "FAILURE",
  Partial = "PARTIAL",
}

/* ---- 2. Symbol 唯一属性键 ---- */

const RAW_KEY: unique symbol = Symbol("rawRow");
const META_KEY: unique symbol = Symbol("storeMeta");

/* ---- 3. 映射类型 ---- */

/** 去掉只读修饰符 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/* ---- 4. 接口（可选/只读/索引签名）+ 判别联合 ---- */

export interface CsvOptions {
  readonly delimiter?: string;
  readonly header?: boolean;
  readonly comment?: string;
  readonly skipEmptyLines?: boolean;
  [key: string]: unknown; // 索引签名
}

export interface JsonOptions {
  readonly coerce?: boolean;
  readonly strict?: boolean;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly count: number;
}

export interface ParseFailure {
  readonly ok: false;
  readonly error: CsvError;
}

/** 解析结果判别联合 */
export type ParseResult = ParseSuccess | ParseFailure;

/** 单元格类型判别联合 */
export enum CellKind {
  Text = "Text",
  Number = "Number",
  Boolean = "Boolean",
  Date = "Date",
  Null = "Null",
}

export interface TextCell {
  readonly kind: CellKind.Text;
  readonly value: string;
}
export interface NumberCell {
  readonly kind: CellKind.Number;
  readonly value: number;
}
export interface BooleanCell {
  readonly kind: CellKind.Boolean;
  readonly value: boolean;
}
export interface DateCell {
  readonly kind: CellKind.Date;
  readonly value: string;
}
export interface NullCell {
  readonly kind: CellKind.Null;
}
export type Cell = TextCell | NumberCell | BooleanCell | DateCell | NullCell;

/** 带原始行标记的行对象（Symbol 键不参与 JSON.stringify） */
export interface TaggedRow {
  readonly [RAW_KEY]?: readonly string[];
  [key: string]: unknown;
}

interface StoreMeta {
  readonly created: number;
  tag: string;
}

/* ---- 5. 自定义错误层级 ---- */

export class CsvError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CsvError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ParseError extends CsvError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "ParseError";
  }
}

export class CoerceError extends CsvError {
  constructor(message: string) {
    super(ErrorCode.CoerceFailed, message);
    this.name = "CoerceError";
  }
}

/* ---- 6. 类型守卫 ---- */

export function isParseSuccess(r: ParseResult): r is ParseSuccess {
  return r.ok === true;
}

export function isParseFailure(r: ParseResult): r is ParseFailure {
  return r.ok === false;
}

export function isNumberCell(c: Cell): c is NumberCell {
  return c.kind === CellKind.Number;
}

export function isTextCell(c: Cell): c is TextCell {
  return c.kind === CellKind.Text;
}

export function isTaggedRow(v: unknown): v is TaggedRow {
  return typeof v === "object" && v !== null && RAW_KEY in v;
}

/* ---- 7. 抽象类 + 具体子类 ---- */

export abstract class AbstractFieldParser {
  abstract parse(raw: string): Cell;
  abstract format(cell: Cell): string;
  protected normalize(s: string): string {
    return s.trim();
  }
}

export class CsvFieldParser extends AbstractFieldParser {
  parse(raw: string): Cell {
    const s = this.normalize(raw);
    if (s === "" || s === "null" || s === "NULL")
      return { kind: CellKind.Null };
    if (s === "true") return { kind: CellKind.Boolean, value: true };
    if (s === "false") return { kind: CellKind.Boolean, value: false };
    if (/^-?\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (Number.isSafeInteger(n)) return { kind: CellKind.Number, value: n };
    }
    if (/^-?\d+\.\d+$/.test(s))
      return { kind: CellKind.Number, value: parseFloat(s) };
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime()))
        return { kind: CellKind.Date, value: d.toISOString() };
    }
    return { kind: CellKind.Text, value: s };
  }

  format(cell: Cell): string {
    switch (cell.kind) {
      case CellKind.Null:
        return "";
      case CellKind.Boolean:
        return cell.value ? "true" : "false";
      case CellKind.Number:
        return String(cell.value);
      case CellKind.Date:
        return cell.value;
      case CellKind.Text:
        return cell.value;
    }
  }
}

function cellToValue(c: Cell): unknown {
  switch (c.kind) {
    case CellKind.Null:
      return null;
    case CellKind.Boolean:
      return c.value;
    case CellKind.Number:
      return c.value;
    case CellKind.Date:
      return c.value;
    case CellKind.Text:
      return c.value;
  }
}

/* ---- 8. 泛型类（带约束）+ getter/setter + 生成器/迭代器 ---- */

export class RowStore<T extends Record<string, unknown>> {
  private readonly _rows: T[] = [];
  private _cursor = 0;
  [META_KEY]!: StoreMeta;

  constructor(tag = "csv-store") {
    this[META_KEY] = { created: Date.now(), tag };
  }

  add(row: T): void {
    this._rows.push(row);
  }

  get length(): number {
    return this._rows.length;
  }

  get current(): T | undefined {
    return this._rows[this._cursor];
  }

  set current(row: T | undefined) {
    if (row === undefined) {
      if (this._rows.length > 0) this._rows.pop();
    } else if (this._cursor < this._rows.length) {
      this._rows[this._cursor] = row;
    } else {
      this._rows.push(row);
    }
  }

  get meta(): StoreMeta {
    return this[META_KEY];
  }
  set metaTag(tag: string) {
    this[META_KEY].tag = tag;
  }

  /** 自定义迭代器协议实现 */
  [Symbol.iterator](): IterableIterator<T> {
    let i = 0;
    const rows = this._rows;
    return {
      next(): IteratorResult<T> {
        if (i < rows.length) return { value: rows[i++], done: false };
        return { value: undefined as unknown as T, done: true };
      },
      [Symbol.iterator]() {
        return this;
      },
    };
  }

  /** 生成器方式逐行产出 */
  *rows(): Generator<T, void, unknown> {
    for (const r of this._rows) yield r;
  }

  toArray(): readonly T[] {
    return this._rows;
  }
}

/* ---- 9. CSV 解析器（状态机）---- */

export class CsvParser {
  private readonly delim: string;
  private readonly header: boolean;
  private readonly comment: string | null;
  private readonly skipEmpty: boolean;
  private _lastState: State = State.Start;

  constructor(opts: CsvOptions = {}) {
    // Mutable 映射类型允许在拷贝上赋值
    const o: Mutable<CsvOptions> = { ...opts };
    const d = (o.delimiter as string | undefined) ?? ",";
    if (d.length !== 1) {
      throw new ParseError(
        ErrorCode.InvalidDelimiter,
        `delimiter must be exactly 1 char, got: ${JSON.stringify(d)}`,
      );
    }
    this.delim = d;
    this.header = (o.header as boolean | undefined) ?? true;
    this.comment = (o.comment as string | undefined) ?? null;
    this.skipEmpty = (o.skipEmptyLines as boolean | undefined) ?? true;
  }

  get lastState(): State {
    return this._lastState;
  }

  parse(text: string): { header: string[]; rows: string[][] } {
    const records = this.parseRecords(text);
    if (records.length === 0) return { header: [], rows: [] };
    if (this.header) return { header: records[0], rows: records.slice(1) };
    const n = records[0].length;
    return {
      header: Array.from({ length: n }, (_, i) => `col${i + 1}`),
      rows: records,
    };
  }

  /** 安全解析：返回判别联合 ParseResult */
  tryParse(text: string): ParseResult {
    try {
      const { header, rows } = this.parse(text);
      if (header.length === 0) {
        return {
          ok: false,
          error: new ParseError(
            ErrorCode.EmptyInput,
            "empty input or header missing",
          ),
        };
      }
      return { ok: true, header, rows, count: rows.length };
    } catch (e) {
      const err =
        e instanceof CsvError
          ? e
          : new ParseError(
              ErrorCode.UnknownCommand,
              e instanceof Error ? e.message : String(e),
            );
      return { ok: false, error: err };
    }
  }

  parseObjects(
    text: string,
    opts: JsonOptions = {},
  ): Record<string, unknown>[] {
    const { header, rows } = this.parse(text);
    if (header.length === 0) return [];
    const fieldParser = opts.coerce ? new CsvFieldParser() : null;
    return rows.map((r) => {
      const o: TaggedRow = { [RAW_KEY]: r };
      for (let i = 0; i < header.length; i++) {
        const raw = r[i] ?? "";
        o[header[i]] = fieldParser ? cellToValue(fieldParser.parse(raw)) : raw;
      }
      return o;
    });
  }

  /** 生成器：逐行产出（行迭代） */
  *iterRows(text: string): Generator<readonly string[], void, unknown> {
    const { rows } = this.parse(text);
    for (const r of rows) yield r;
  }

  private parseRecords(text: string): string[][] {
    const records: string[][] = [];
    let field = "";
    let row: string[] = [];
    let i = 0;
    let inQuotes = false;
    let lineStart = true;
    let state: State = State.Start;
    const n = text.length;

    while (i < n) {
      if (lineStart && this.comment && text[i] === this.comment) {
        state = State.Comment;
        while (i < n && text[i] !== "\n") i++;
        if (i < n) i++;
        continue;
      }
      lineStart = false;
      const c = text[i];

      if (inQuotes) {
        state = State.InQuotes;
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          state = State.AfterQuote;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        state = State.InQuotes;
        i++;
        continue;
      }

      if (c === this.delim) {
        row.push(field);
        field = "";
        state = State.Delimiter;
        i++;
        continue;
      }

      if (c === "\r" || c === "\n") {
        row.push(field);
        field = "";
        if (this.skipEmpty && row.length === 1 && row[0] === "") {
          row = [];
          if (c === "\r" && text[i + 1] === "\n") i++;
          i++;
          lineStart = true;
          state = State.EndOfLine;
          continue;
        }
        records.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
        i++;
        lineStart = true;
        state = State.EndOfLine;
        continue;
      }

      field += c;
      state = State.InField;
      i++;
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      if (!(this.skipEmpty && row.length === 1 && row[0] === ""))
        records.push(row);
    }

    this._lastState = state;
    return records;
  }
}

/* ---- 10. 类型推断（函数重载）---- */

export function coerce(s: string): unknown;
export function coerce(s: string, mode: "cell"): Cell;
export function coerce(s: string, mode?: "cell"): unknown {
  const cell = new CsvFieldParser().parse(s);
  return mode === "cell" ? cell : cellToValue(cell);
}

export function getCell(parser: AbstractFieldParser, raw: string): Cell;
export function getCell(
  parser: AbstractFieldParser,
  raw: string,
  asValue: true,
): unknown;
export function getCell(
  parser: AbstractFieldParser,
  raw: string,
  asValue?: boolean,
): Cell | unknown {
  const cell = parser.parse(raw);
  return asValue ? cellToValue(cell) : cell;
}

export function inferColumnType(values: string[]): DataType {
  let hasInt = false,
    hasReal = false,
    hasBool = false,
    hasDate = false,
    hasText = false;
  for (const v of values) {
    if (v === "") continue;
    if (/^-?\d+$/.test(v)) hasInt = true;
    else if (/^-?\d+\.\d+$/.test(v)) hasReal = true;
    else if (v === "true" || v === "false") hasBool = true;
    else if (
      /^\d{4}-\d{2}-\d{2}/.test(v) &&
      !Number.isNaN(new Date(v).getTime())
    )
      hasDate = true;
    else hasText = true;
  }
  if (hasText) return DataType.String;
  if (hasReal || hasInt) return DataType.Number;
  if (hasBool) return DataType.Boolean;
  if (hasDate) return DataType.Date;
  return DataType.String;
}

export function inferSchema(
  text: string,
  opts: CsvOptions = {},
): Record<string, DataType> {
  const parser = new CsvParser(opts);
  const { header, rows } = parser.parse(text);
  const out: Record<string, DataType> = {};
  for (let i = 0; i < header.length; i++) {
    const col = rows.map((r) => r[i] ?? "");
    out[header[i]] = inferColumnType(col);
  }
  return out;
}

/* ---- 11. JSON -> CSV ---- */

export function jsonToCsv(
  json: Record<string, unknown>[],
  opts: { delimiter?: string } = {},
): string {
  if (json.length === 0) return "";
  const delim = opts.delimiter ?? ",";
  const colSet: string[] = [];
  for (const r of json) {
    for (const k of Object.keys(r)) {
      if (!colSet.includes(k)) colSet.push(k);
    }
  }
  const lines = [colSet.map((c) => escapeField(c, delim)).join(delim)];
  for (const r of json) {
    lines.push(
      colSet.map((c) => escapeField(fmtValue(r[c]), delim)).join(delim),
    );
  }
  return lines.join("\n");
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeField(s: string, delim = ","): string {
  if (
    s.includes(delim) ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r")
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/* ---- 12. 流式解析大文件 ---- */

export async function parseStream(
  filePath: string,
  onRow: (row: Record<string, unknown>) => void,
  opts: CsvOptions & JsonOptions = {},
): Promise<number> {
  const parser = new CsvParser(opts);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });

  // readline 按行分割会破坏嵌入换行的引号字段，这里累积缓冲直到引号平衡。
  let buffer = "";
  let header: string[] | null = null;
  let count = 0;

  const flushBuffer = (): void => {
    if (buffer.trim() === "") return;
    const records = parser.parse(buffer);
    if (records.rows.length === 0) return;
    if (header === null) {
      if (opts.header !== false) {
        header = records.rows[0];
        records.rows.slice(1).forEach(processRow);
      } else {
        header = Array.from(
          { length: records.rows[0].length },
          (_, i) => `col${i + 1}`,
        );
        records.rows.forEach(processRow);
      }
    } else {
      records.rows.forEach(processRow);
    }
    buffer = "";
  };

  const processRow = (r: string[]): void => {
    const o: Record<string, unknown> = {};
    const h = header as string[];
    for (let i = 0; i < h.length; i++) {
      const raw = r[i] ?? "";
      o[h[i]] = opts.coerce ? coerce(raw) : raw;
    }
    onRow(o);
    count++;
  };

  for await (const line of rl) {
    buffer += (buffer ? "\n" : "") + line;
    const qcount = (buffer.match(/"/g) || []).length;
    if (qcount % 2 === 0) flushBuffer();
  }
  if (buffer.trim() !== "") flushBuffer();
  return count;
}

/* ---- 13. as const / satisfies 配置 ---- */

const TYPE_PRIORITY = [
  DataType.String,
  DataType.Number,
  DataType.Boolean,
  DataType.Date,
] as const;

const DEFAULT_CSV_OPTS = {
  delimiter: ",",
  header: true,
  skipEmptyLines: true,
} satisfies CsvOptions;

const CLI_HELP = `CSV 转 JSON 工具 CLI
用法:
  convert <csv> [-o json] [-d delim] [--no-header]   转换 CSV 为 JSON
  preview <csv> [-n rows]                            预览前 N 行
  schema  <csv>                                      推断列类型
  json2csv <json> [-o csv]                           JSON 转 CSV
  stream  <csv>                                      流式处理大文件
  demo                                               运行内置示例` as const;

/* ---- 14. 转换辅助（使用 ConvertResult 枚举）---- */

interface ConvertOutput {
  readonly result: ConvertResult;
  readonly count: number;
  readonly json: string;
  readonly error?: CsvError;
}

function runConvert(
  file: string,
  opts: { delim: string; noHeader: boolean; coerce: boolean },
): ConvertOutput {
  try {
    const text = fs.readFileSync(path.resolve(file), "utf8");
    const parser = new CsvParser({
      delimiter: opts.delim,
      header: !opts.noHeader,
    });
    const rows = parser.parseObjects(text, { coerce: opts.coerce });
    const json = JSON.stringify(rows, null, 2);
    return {
      result: rows.length === 0 ? ConvertResult.Partial : ConvertResult.Success,
      count: rows.length,
      json,
    };
  } catch (e) {
    const err =
      e instanceof CsvError
        ? e
        : new CsvError(
            ErrorCode.UnknownCommand,
            e instanceof Error ? e.message : String(e),
          );
    return { result: ConvertResult.Failure, count: 0, json: "", error: err };
  }
}

/* ---- 15. CLI ---- */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function getOptNum(args: string[], name: string, def: number): number {
  const v = getOpt(args, name);
  return v ? parseInt(v, 10) : def;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.log(CLI_HELP);
    return;
  }

  switch (cmd) {
    case "convert": {
      const [file] = rest;
      if (!file) throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
      const delim = getOpt(rest, "-d") ?? DEFAULT_CSV_OPTS.delimiter;
      const noHeader = rest.includes("--no-header");
      const out = getOpt(rest, "-o");
      const res = runConvert(file, { delim, noHeader, coerce: true });
      if (res.result === ConvertResult.Failure) {
        throw res.error ?? new CsvError(ErrorCode.UnknownCommand, "未知错误");
      }
      if (out) fs.writeFileSync(path.resolve(out), res.json, "utf8");
      else console.log(res.json);
      console.error(`已转换 ${res.count} 行 (结果: ${res.result})`);
      break;
    }
    case "preview": {
      const [file] = rest;
      if (!file) throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
      const n = getOptNum(rest, "-n", 5);
      const text = fs.readFileSync(path.resolve(file), "utf8");
      const parser = new CsvParser({ header: true });
      const { header, rows } = parser.parse(text);
      console.log(header.join(" | "));
      console.log(
        header.map((h) => "-".repeat(Math.max(5, h.length))).join("-+-"),
      );
      for (let i = 0; i < Math.min(n, rows.length); i++) {
        console.log(rows[i].map((c) => c ?? "").join(" | "));
      }
      console.log(
        `(共 ${rows.length} 行，预览 ${Math.min(n, rows.length)} 行)`,
      );
      console.log(`解析结束状态: ${parser.lastState}`);
      break;
    }
    case "schema": {
      const [file] = rest;
      if (!file) throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
      const text = fs.readFileSync(path.resolve(file), "utf8");
      const schema = inferSchema(text);
      console.log(JSON.stringify(schema, null, 2));
      console.log(`类型优先级: ${TYPE_PRIORITY.join(" > ")}`);
      break;
    }
    case "json2csv": {
      const [file] = rest;
      if (!file) throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
      const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
      if (!Array.isArray(data))
        throw new CsvError(ErrorCode.NotAnArray, "JSON 顶层必须是数组");
      const csv = jsonToCsv(data as Record<string, unknown>[]);
      const out = getOpt(rest, "-o");
      if (out) fs.writeFileSync(path.resolve(out), csv, "utf8");
      else console.log(csv);
      break;
    }
    case "stream": {
      const [file] = rest;
      if (!file) throw new CsvError(ErrorCode.UnknownCommand, "缺少文件路径");
      let count = 0;
      const n = await parseStream(
        path.resolve(file),
        (row) => {
          if (count < 3) console.log(JSON.stringify(row));
          count++;
        },
        { coerce: true },
      );
      console.log(`流式处理完成，共 ${n} 行（仅显示前 3 行）`);
      break;
    }
    case "demo": {
      const csv = `id,name,note,active
1,Alice,"Hello, world",true
2,Bob,"Line1
Line2",false
3,"Carol ""C""","quoted ""text""",true
4,Dave,,false`;
      console.log("=== 原始 CSV ===");
      console.log(csv);
      const parser = new CsvParser({ delimiter: ",", header: true });
      const rows = parser.parseObjects(csv, { coerce: true });

      // 展示 RowStore + 生成器 + Symbol 标记
      const store = new RowStore<Record<string, unknown>>("demo");
      for (const r of rows) store.add(r);
      console.log(
        `\n=== RowStore (length=${store.length}, tag=${store.meta.tag}) ===`,
      );

      console.log("\n=== 转换为 JSON ===");
      console.log(JSON.stringify(rows, null, 2));
      console.log("\n=== Schema ===");
      console.log(JSON.stringify(inferSchema(csv), null, 2));
      console.log("\n=== 回写 CSV ===");
      console.log(jsonToCsv(rows));

      // 类型守卫 + 判别联合演示
      const cell = coerce("42", "cell");
      if (isNumberCell(cell))
        console.log(`\n[类型守卫] 识别为数字: ${cell.value + 1}`);
      const first = rows[0];
      console.log(`[Symbol] 行已标记原始数据: ${isTaggedRow(first)}`);
      break;
    }
    default:
      throw new CsvError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("错误:", msg);
    process.exit(1);
  });
}
