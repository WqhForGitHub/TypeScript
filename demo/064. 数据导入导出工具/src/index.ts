#!/usr/bin/env node
/**
 * 数据导入导出工具 (enhanced)
 * - 支持 JSON / CSV / TSV / 简单表格格式（TABLE）互转
 * - 命令：import / export / merge / split / validate
 * - 自动按扩展名识别格式，支持 schema 推断与类型检测
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";

/* ===================== Enums ===================== */

export enum Format {
  Json = "json",
  Csv = "csv",
  Tsv = "tsv",
  Table = "table",
}

export enum DataType {
  Null = "null",
  Boolean = "boolean",
  Integer = "integer",
  Real = "real",
  Text = "text",
  Date = "date",
  Unknown = "unknown",
}

export enum ErrorCode {
  ParseError = "PARSE_ERROR",
  InvalidFormat = "INVALID_FORMAT",
  SchemaError = "SCHEMA_ERROR",
  IoError = "IO_ERROR",
  UnknownCommand = "UNKNOWN_COMMAND",
}

export enum ConvertStatus {
  Success = "success",
  Error = "error",
}

/* ===================== Mapped Types ===================== */

/** 移除 readonly 修饰符的映射类型 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/* ===================== Symbols ===================== */

const META: unique symbol = Symbol("meta");

/* ===================== Interfaces ===================== */

export interface Row {
  [key: string]: unknown;
}

export interface Dataset {
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
  inferredTypes?: Record<string, DataType>;
}

export interface ParseOptions {
  readonly delimiter?: string;
  readonly strict?: boolean;
  readonly encoding?: BufferEncoding;
  [key: string]: unknown;
}

export interface SchemaInfo {
  readonly column: string;
  readonly type: DataType;
  readonly nullable: boolean;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly checkedAt: Date;
}

/* ===================== Discriminated Unions ===================== */

export interface ConvertSuccess {
  readonly status: ConvertStatus.Success;
  readonly dataset: Dataset;
  readonly format: Format;
  readonly text: string;
  readonly warnings: readonly string[];
}

export interface ConvertError {
  readonly status: ConvertStatus.Error;
  readonly error: DataError;
  readonly format: Format;
}

export type ConvertResult = ConvertSuccess | ConvertError;

/* ===================== Error Hierarchy ===================== */

export class DataError extends Error {
  readonly code: ErrorCode;
  constructor(
    message: string,
    code: ErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DataError";
    this.code = code;
  }
}

export class ParseError extends DataError {
  constructor(
    message: string,
    public readonly format: Format,
    cause?: unknown,
  ) {
    super(message, ErrorCode.ParseError, cause);
    this.name = "ParseError";
  }
}

export class ValidationError extends DataError {
  constructor(message: string) {
    super(message, ErrorCode.SchemaError);
    this.name = "ValidationError";
  }
}

/* ===================== Type Guards ===================== */

export function isConvertSuccess(r: ConvertResult): r is ConvertSuccess {
  return r.status === ConvertStatus.Success;
}

export function isConvertError(r: ConvertResult): r is ConvertError {
  return r.status === ConvertStatus.Error;
}

export function isDataset(v: unknown): v is Dataset {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Dataset;
  return Array.isArray(d.columns) && Array.isArray(d.rows);
}

/* ===================== Type Inference ===================== */

export function inferType(v: unknown): DataType {
  if (v === null || v === undefined || v === "") return DataType.Null;
  if (typeof v === "boolean") return DataType.Boolean;
  if (typeof v === "number")
    return Number.isInteger(v) ? DataType.Integer : DataType.Real;
  if (typeof v === "string") {
    if (/^-?\d+$/.test(v)) return DataType.Integer;
    if (/^-?\d+\.\d+$/.test(v)) return DataType.Real;
    if (v === "true" || v === "false") return DataType.Boolean;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(v))
      return DataType.Date;
    return DataType.Text;
  }
  return DataType.Unknown;
}

export function inferSchema(ds: Dataset): Record<string, DataType> {
  const types: Record<string, DataType> = {};
  for (const c of ds.columns) {
    const set = new Set<DataType>();
    for (const r of ds.rows) {
      const t = inferType(r[c]);
      if (t !== DataType.Null) set.add(t);
    }
    if (set.size === 0) types[c] = DataType.Null;
    else if (set.size === 1) types[c] = Array.from(set)[0];
    else if (set.has(DataType.Real) && set.has(DataType.Integer))
      types[c] = DataType.Real;
    else types[c] = DataType.Text;
  }
  ds.inferredTypes = types;
  return types;
}

/* ===================== Format Detection ===================== */

export function detectFormat(file: string): Format {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return Format.Json;
  if (ext === ".csv") return Format.Csv;
  if (ext === ".tsv") return Format.Tsv;
  if (ext === ".table" || ext === ".txt") return Format.Table;
  throw new DataError(`无法识别的文件扩展名: ${ext}`, ErrorCode.InvalidFormat);
}

/* ===================== Abstract Parser ===================== */

export abstract class AbstractParser {
  abstract readonly format: Format;
  abstract parse(text: string): Dataset;

  protected coerceValue(s: string): unknown {
    if (s === "") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null") return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
  }

  protected splitDelimited(text: string, delim: string): string[][] {
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
      if (c === delim) {
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
    return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
  }

  protected parseDelimited(text: string, delim: string): Dataset {
    const rows = this.splitDelimited(text, delim);
    if (rows.length === 0) return { columns: [], rows: [] };
    const columns = rows[0];
    const out: Row[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r: Row = {};
      for (let j = 0; j < columns.length; j++) {
        r[columns[j]] = this.coerceValue(rows[i][j] ?? "");
      }
      out.push(r);
    }
    return { columns, rows: out };
  }
}

export class CsvParser extends AbstractParser {
  readonly format = Format.Csv;
  parse(text: string): Dataset {
    return this.parseDelimited(text, ",");
  }
}

export class TsvParser extends AbstractParser {
  readonly format = Format.Tsv;
  parse(text: string): Dataset {
    return this.parseDelimited(text, "\t");
  }
}

export class JsonParser extends AbstractParser {
  readonly format = Format.Json;
  parse(text: string): Dataset {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ParseError(
        `JSON 解析失败: ${(e as Error).message}`,
        Format.Json,
        e,
      );
    }
    if (!Array.isArray(data))
      throw new ParseError("JSON 数据必须是对象数组", Format.Json);
    if (data.length === 0) return { columns: [], rows: [] };
    const colSet: string[] = [];
    const arr = data as Record<string, unknown>[];
    for (const r of arr) {
      for (const k of Object.keys(r)) {
        if (!colSet.includes(k)) colSet.push(k);
      }
    }
    const rows: Row[] = arr.map((r) => {
      const o: Row = {};
      for (const c of colSet) o[c] = r[c] ?? null;
      return o;
    });
    return { columns: colSet, rows };
  }
}

/** 简单表格格式：首行 +----+----+ 分隔，第二行表头，第三行分隔，后续为数据 */
export class TableParser extends AbstractParser {
  readonly format = Format.Table;
  parse(text: string): Dataset {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 3)
      throw new ParseError("TABLE 格式至少需要 3 行", Format.Table);
    let headerIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/^[+\-|=]+$/.test(lines[i]) && lines[i].includes("|")) {
        headerIdx = i;
        break;
      }
    }
    const columns = lines[headerIdx]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const rows: Row[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (/^[+\-|=]+$/.test(lines[i])) continue;
      const parts = lines[i].split("|").map((s) => s.trim());
      const vals: string[] = [];
      for (let j = 0; j < parts.length; j++) {
        if (j === 0 && parts[j] === "") continue;
        if (j === parts.length - 1 && parts[j] === "") continue;
        vals.push(parts[j]);
      }
      const r: Row = {};
      for (let j = 0; j < columns.length; j++)
        r[columns[j]] = this.coerceValue(vals[j] ?? "");
      rows.push(r);
    }
    return { columns, rows };
  }
}

/* ===================== Abstract Serializer ===================== */

export abstract class AbstractSerializer {
  abstract readonly format: Format;
  abstract serialize(ds: Dataset): string;

  protected fmt(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  protected pad(s: string, w: number): string {
    return s.length >= w ? s : s + " ".repeat(w - s.length);
  }

  protected escapeDelimited(v: unknown, delim: string): string {
    const s =
      v === null || v === undefined
        ? ""
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
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
}

export class CsvSerializer extends AbstractSerializer {
  readonly format = Format.Csv;
  serialize(ds: Dataset): string {
    const lines = [ds.columns.join(",")];
    for (const r of ds.rows) {
      lines.push(
        ds.columns.map((c) => this.escapeDelimited(r[c], ",")).join(","),
      );
    }
    return lines.join("\n");
  }
}

export class TsvSerializer extends AbstractSerializer {
  readonly format = Format.Tsv;
  serialize(ds: Dataset): string {
    const lines = [ds.columns.join("\t")];
    for (const r of ds.rows) {
      lines.push(
        ds.columns.map((c) => this.escapeDelimited(r[c], "\t")).join("\t"),
      );
    }
    return lines.join("\n");
  }
}

export class JsonSerializer extends AbstractSerializer {
  readonly format = Format.Json;
  constructor(private readonly pretty: boolean = true) {
    super();
  }
  serialize(ds: Dataset): string {
    return JSON.stringify(ds.rows, null, this.pretty ? 2 : 0);
  }
}

export class TableSerializer extends AbstractSerializer {
  readonly format = Format.Table;
  serialize(ds: Dataset): string {
    if (ds.columns.length === 0) return "";
    const widths = ds.columns.map((c) =>
      Math.max(c.length, ...ds.rows.map((r) => this.fmt(r[c]).length)),
    );
    const sep = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
    const header =
      "| " +
      ds.columns.map((c, i) => this.pad(c, widths[i])).join(" | ") +
      " |";
    const lines = [sep, header, sep];
    for (const r of ds.rows) {
      lines.push(
        "| " +
          ds.columns
            .map((c, i) => this.pad(this.fmt(r[c]), widths[i]))
            .join(" | ") +
          " |",
      );
    }
    lines.push(sep);
    return lines.join("\n");
  }
}

/* ===================== Registries (satisfies) ===================== */

const PARSERS = {
  [Format.Json]: new JsonParser(),
  [Format.Csv]: new CsvParser(),
  [Format.Tsv]: new TsvParser(),
  [Format.Table]: new TableParser(),
} satisfies Record<Format, AbstractParser>;

const SERIALIZERS = {
  [Format.Json]: new JsonSerializer(),
  [Format.Csv]: new CsvSerializer(),
  [Format.Tsv]: new TsvSerializer(),
  [Format.Table]: new TableSerializer(),
} satisfies Record<Format, AbstractSerializer>;

const SUPPORTED_FORMATS = [
  Format.Json,
  Format.Csv,
  Format.Tsv,
  Format.Table,
] as const;

/* ===================== Parse / Serialize ===================== */

export function parse(text: string, format: Format): Dataset {
  return PARSERS[format].parse(text);
}

export function serialize(ds: Dataset, format: Format): string {
  return SERIALIZERS[format].serialize(ds);
}

export function parseJson(text: string): Dataset {
  return new JsonParser().parse(text);
}
export function parseCsv(text: string): Dataset {
  return new CsvParser().parse(text);
}
export function parseTsv(text: string): Dataset {
  return new TsvParser().parse(text);
}
export function parseTable(text: string): Dataset {
  return new TableParser().parse(text);
}

export function toJson(ds: Dataset, pretty = true): string {
  return new JsonSerializer(pretty).serialize(ds);
}
export function toCsv(ds: Dataset): string {
  return new CsvSerializer().serialize(ds);
}
export function toTsv(ds: Dataset): string {
  return new TsvSerializer().serialize(ds);
}
export function toTable(ds: Dataset): string {
  return new TableSerializer().serialize(ds);
}

/* ===================== Convert (overloads + discriminated union) ===================== */

export function convert(text: string, from: Format, to: Format): ConvertResult;
export function convert(ds: Dataset, to: Format): ConvertResult;
export function convert(
  input: string | Dataset,
  from: Format,
  to?: Format,
): ConvertResult {
  let ds: Dataset;
  let outFormat: Format;
  if (typeof input === "string") {
    outFormat = to as Format;
    try {
      ds = parse(input, from);
    } catch (e) {
      return {
        status: ConvertStatus.Error,
        error: toDataError(e, from),
        format: from,
      };
    }
  } else {
    ds = input;
    outFormat = from;
  }
  try {
    const text = serialize(ds, outFormat);
    const warnings: string[] = [];
    if (ds.rows.length === 0) warnings.push("数据集为空");
    return {
      status: ConvertStatus.Success,
      dataset: ds,
      format: outFormat,
      text,
      warnings,
    };
  } catch (e) {
    return {
      status: ConvertStatus.Error,
      error: toDataError(e, outFormat),
      format: outFormat,
    };
  }
}

function toDataError(e: unknown, fmt: Format): DataError {
  if (e instanceof DataError) return e;
  return new ParseError(String(e), fmt, e);
}

/* ===================== Generic DataStore ===================== */

export class DataStore<
  T extends Record<string, unknown>,
> implements Iterable<T> {
  private _columns: string[];
  private _rows: T[];
  [META]!: Record<string, unknown>;

  constructor(columns: readonly string[], rows: readonly T[]) {
    this._columns = [...columns];
    this._rows = [...rows];
    this[META] = {};
  }

  get columns(): readonly string[] {
    return this._columns;
  }
  get rowCount(): number {
    return this._rows.length;
  }

  get meta(): Record<string, unknown> {
    return this[META];
  }
  set meta(value: Record<string, unknown>) {
    this[META] = { ...value };
  }

  *[Symbol.iterator](): Generator<T> {
    for (const row of this._rows) yield row;
  }

  /** 逐行生成器 */
  *rows(): Generator<T> {
    for (const r of this._rows) yield r;
  }

  toDataset(): Dataset {
    return {
      columns: [...this._columns],
      rows: this._rows.map((r) => ({ ...r })),
    };
  }

  static fromDataset(ds: Dataset): DataStore<Row> {
    return new DataStore(ds.columns, ds.rows);
  }
}

/** 逐行迭代数据集的生成器 */
export function* iterateRows(ds: Dataset): Generator<Row> {
  for (const r of ds.rows) yield r;
}

/* ===================== Mapped Type Usage ===================== */

/** 生成可变副本 */
export function cloneDataset(ds: Dataset): Mutable<Dataset> {
  return {
    columns: ds.columns.slice(),
    rows: ds.rows.map((r) => ({ ...r })),
    inferredTypes: ds.inferredTypes ? { ...ds.inferredTypes } : undefined,
  };
}

export function schemaInfo(ds: Dataset): SchemaInfo[] {
  const types = inferSchema(ds);
  return ds.columns.map((c) => {
    const t = types[c] ?? DataType.Null;
    let nullable = false;
    for (const r of ds.rows) {
      if (inferType(r[c]) === DataType.Null) {
        nullable = true;
        break;
      }
    }
    return { column: c, type: t, nullable };
  });
}

/* ===================== File I/O ===================== */

export function loadFile(
  file: string,
  format?: Format,
  options?: ParseOptions,
): Dataset {
  const fmt = format ?? detectFormat(file);
  const encoding: BufferEncoding = options?.encoding ?? "utf8";
  const text = fs.readFileSync(path.resolve(file), encoding);
  return parse(text, fmt);
}

export function saveFile(ds: Dataset, file: string, format?: Format): void {
  const fmt = format ?? detectFormat(file);
  fs.writeFileSync(path.resolve(file), serialize(ds, fmt), "utf8");
}

/* ===================== Merge / Split ===================== */

/** 合并多个数据集（按列并集） */
export function merge(datasets: readonly Dataset[]): Dataset {
  const colSet: string[] = [];
  for (const ds of datasets) {
    for (const c of ds.columns) {
      if (!colSet.includes(c)) colSet.push(c);
    }
  }
  const rows: Row[] = [];
  for (const ds of datasets) {
    for (const r of ds.rows) {
      const o: Row = {};
      for (const c of colSet) o[c] = r[c] ?? null;
      rows.push(o);
    }
  }
  return { columns: colSet, rows };
}

/** 按行数拆分 */
export function split(ds: Dataset, rowsPerFile: number): Dataset[] {
  const out: Dataset[] = [];
  for (let i = 0; i < ds.rows.length; i += rowsPerFile) {
    out.push({
      columns: [...ds.columns],
      rows: ds.rows.slice(i, i + rowsPerFile),
    });
  }
  return out;
}

/* ===================== Validate ===================== */

/** 校验数据集（每行列数一致、类型一致） */
export function validate(ds: Dataset): ValidationReport {
  const errors: string[] = [];
  const types = inferSchema(ds);
  for (let i = 0; i < ds.rows.length; i++) {
    const r = ds.rows[i];
    for (const c of ds.columns) {
      const t = inferType(r[c]);
      if (t === DataType.Null) continue;
      const expected = types[c];
      if (expected === DataType.Text || expected === DataType.Null) continue;
      if (
        expected === DataType.Real &&
        (t === DataType.Integer || t === DataType.Real)
      )
        continue;
      if (t !== expected) {
        errors.push(`第 ${i + 1} 行 列 ${c}: 期望 ${expected} 实际 ${t}`);
      }
    }
  }
  return { valid: errors.length === 0, errors, checkedAt: new Date() };
}

/* ===================== CLI ===================== */

function getOpt(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseFormatArg(v: string | undefined): Format | undefined {
  if (v === undefined) return undefined;
  const found = SUPPORTED_FORMATS.find((f) => f === v);
  if (!found)
    throw new DataError(`不支持的格式: ${v}`, ErrorCode.InvalidFormat);
  return found;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.log(`数据导入导出工具 CLI
用法:
  import  <file> [-f format]            加载文件并打印
  export  <infile> <outfile>            转换格式
  merge   <f1> <f2> ... [-o output]     合并多文件
  split   <file> [-r rows] [-o outdir]  按行数拆分
  validate <file> [-f format]           校验数据
  demo                              生成示例数据
支持的格式：${SUPPORTED_FORMATS.join(" / ")}`);
    return;
  }

  switch (cmd) {
    case "import": {
      const [file] = rest;
      if (!file) throw new DataError("缺少文件路径", ErrorCode.UnknownCommand);
      const fmt = parseFormatArg(getOpt(rest, "-f"));
      const ds = loadFile(file, fmt);
      inferSchema(ds);
      console.log(`列: ${ds.columns.join(", ")}`);
      console.log(`行数: ${ds.rows.length}`);
      console.log("推断类型:", ds.inferredTypes);
      console.log("前 5 行:");
      console.log(toTable({ columns: ds.columns, rows: ds.rows.slice(0, 5) }));
      break;
    }
    case "export": {
      const [infile, outfile] = rest;
      if (!infile || !outfile)
        throw new DataError(
          "用法: export <infile> <outfile>",
          ErrorCode.UnknownCommand,
        );
      const ds = loadFile(infile);
      saveFile(ds, outfile);
      console.log(`已转换 ${infile} -> ${outfile} (${ds.rows.length} 行)`);
      break;
    }
    case "merge": {
      const outOpt = getOpt(rest, "-o");
      const files = rest.filter((a) => !a.startsWith("-") && a !== outOpt);
      if (files.length < 1)
        throw new DataError("至少需要一个文件", ErrorCode.UnknownCommand);
      const datasets = files.map((f) => loadFile(f));
      const merged = merge(datasets);
      if (outOpt) saveFile(merged, outOpt);
      else console.log(toJson(merged));
      console.log(
        `合并 ${datasets.length} 个文件，共 ${merged.rows.length} 行`,
      );
      break;
    }
    case "split": {
      const [file] = rest;
      if (!file) throw new DataError("缺少文件路径", ErrorCode.UnknownCommand);
      const rowsPer = parseInt(getOpt(rest, "-r") || "100", 10);
      const outdir = getOpt(rest, "-o") || path.dirname(path.resolve(file));
      const ds = loadFile(file);
      const parts = split(ds, rowsPer);
      const base = path.basename(file, path.extname(file));
      const ext = path.extname(file) || ".json";
      if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
      for (let i = 0; i < parts.length; i++) {
        const outPath = path.join(outdir, `${base}.part${i + 1}${ext}`);
        saveFile(parts[i], outPath);
        console.log(`写出 ${outPath} (${parts[i].rows.length} 行)`);
      }
      break;
    }
    case "validate": {
      const [file] = rest;
      if (!file) throw new DataError("缺少文件路径", ErrorCode.UnknownCommand);
      const fmt = parseFormatArg(getOpt(rest, "-f"));
      const ds = loadFile(file, fmt);
      const r = validate(ds);
      if (r.valid) console.log("校验通过");
      else {
        console.log("校验失败:");
        for (const e of r.errors.slice(0, 20)) console.log("  " + e);
        if (r.errors.length > 20)
          console.log(`  ... 共 ${r.errors.length} 个错误`);
      }
      break;
    }
    case "demo": {
      const ds: Dataset = {
        columns: ["id", "name", "age", "active"],
        rows: [
          { id: 1, name: "Alice", age: 30, active: true },
          { id: 2, name: "Bob", age: 25, active: false },
          { id: 3, name: "Carol", age: 35, active: true },
        ],
      };
      console.log("=== CSV ===");
      console.log(toCsv(ds));
      console.log("\n=== TSV ===");
      console.log(toTsv(ds));
      console.log("\n=== TABLE ===");
      console.log(toTable(ds));
      console.log("\n=== JSON ===");
      console.log(toJson(ds));
      inferSchema(ds);
      console.log("\n推断类型:", ds.inferredTypes);

      // 演示 convert（函数重载 + 判别联合）+ DataStore（泛型 + 生成器）
      const result = convert(ds, Format.Csv);
      if (isConvertSuccess(result)) {
        console.log("\n转换 CSV 成功，长度:", result.text.length);
      } else if (isConvertError(result)) {
        console.log("\n转换失败:", result.error.message);
      }
      const store = DataStore.fromDataset(ds);
      store.meta = { source: "demo" };
      console.log("DataStore 行数:", store.rowCount, "元数据:", store.meta);
      for (const r of store) console.log("  row:", r);
      break;
    }
    default:
      throw new DataError(`未知命令: ${cmd}`, ErrorCode.UnknownCommand);
  }
}

if (require.main === module) {
  main().catch((e) => {
    const msg =
      e instanceof DataError
        ? `[${e.code}] ${e.message}`
        : (e as Error).message;
    console.error("错误:", msg);
    process.exit(1);
  });
}
