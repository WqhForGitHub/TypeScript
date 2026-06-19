#!/usr/bin/env node
/**
 * CSV 转 JSON 工具
 * - 完整 CSV 解析：带引号字段、转义引号、嵌入换行、自定义分隔符、表头、注释
 * - 命令：convert / preview / schema / json2csv / stream
 * - 类型推断：number / boolean / date / string
 * - 流式处理大文件
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export interface CsvOptions {
  delimiter?: string;
  header?: boolean;
  comment?: string;
  skipEmptyLines?: boolean;
}

export interface JsonOptions {
  coerce?: boolean; // 是否进行类型推断
}

/** CSV 解析器（状态机） */
export class CsvParser {
  private delim: string;
  private header: boolean;
  private comment: string | null;
  private skipEmpty: boolean;

  constructor(opts: CsvOptions = {}) {
    this.delim = opts.delimiter ?? ",";
    this.header = opts.header ?? true;
    this.comment = opts.comment ?? null;
    this.skipEmpty = opts.skipEmptyLines ?? true;
  }

  /** 解析完整文本 */
  parse(text: string): { header: string[]; rows: string[][] } {
    const records = this.parseRecords(text);
    if (records.length === 0) return { header: [], rows: [] };
    if (this.header) {
      return { header: records[0], rows: records.slice(1) };
    }
    const n = records[0].length;
    return { header: Array.from({ length: n }, (_, i) => `col${i + 1}`), rows: records };
  }

  /** 解析为对象数组 */
  parseObjects(text: string, opts: JsonOptions = {}): Record<string, unknown>[] {
    const { header, rows } = this.parse(text);
    if (header.length === 0) return [];
    return rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < header.length; i++) {
        o[header[i]] = opts.coerce ? coerce(r[i] ?? "") : (r[i] ?? "");
      }
      return o;
    });
  }

  private parseRecords(text: string): string[][] {
    const records: string[][] = [];
    let field = "";
    let row: string[] = [];
    let i = 0;
    let inQuotes = false;
    let lineStart = true;
    const n = text.length;

    while (i < n) {
      // 行首：检查注释
      if (lineStart && this.comment && text[i] === this.comment) {
        // 跳过整行
        while (i < n && text[i] !== "\n") i++;
        if (i < n) i++;
        continue;
      }
      lineStart = false;

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

      if (c === this.delim) {
        row.push(field);
        field = "";
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
          continue;
        }
        records.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
        i++;
        lineStart = true;
        continue;
      }

      field += c;
      i++;
    }
    // 最后一个字段
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      if (!(this.skipEmpty && row.length === 1 && row[0] === "")) {
        records.push(row);
      }
    }
    return records;
  }
}

/** 类型推断并转换 */
export function coerce(s: string): unknown {
  if (s === "") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "NULL") return null;
  if (/^-?\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // ISO 日期
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return s;
}

/** 推断某列的类型 */
export function inferColumnType(values: string[]): string {
  let hasInt = false;
  let hasReal = false;
  let hasBool = false;
  let hasDate = false;
  let hasText = false;
  for (const v of values) {
    if (v === "") continue;
    if (/^-?\d+$/.test(v)) hasInt = true;
    else if (/^-?\d+\.\d+$/.test(v)) hasReal = true;
    else if (v === "true" || v === "false") hasBool = true;
    else if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime())) hasDate = true;
    else hasText = true;
  }
  if (hasText) return "string";
  if (hasReal && hasInt) return "number";
  if (hasReal) return "number";
  if (hasInt) return "number";
  if (hasBool) return "boolean";
  if (hasDate) return "date";
  return "string";
}

/** 推断整个 CSV 的 schema */
export function inferSchema(text: string, opts: CsvOptions = {}): Record<string, string> {
  const parser = new CsvParser(opts);
  const { header, rows } = parser.parse(text);
  const out: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    const col = rows.map((r) => r[i] ?? "");
    out[header[i]] = inferColumnType(col);
  }
  return out;
}

/** JSON 数组 -> CSV */
export function jsonToCsv(json: Record<string, unknown>[], opts: { delimiter?: string } = {}): string {
  if (json.length === 0) return "";
  const delim = opts.delimiter ?? ",";
  const colSet: string[] = [];
  for (const r of json) {
    for (const k of Object.keys(r)) {
      if (!colSet.includes(k)) colSet.push(k);
    }
  }
  const lines = [colSet.map((c) => escapeField(c)).join(delim)];
  for (const r of json) {
    lines.push(colSet.map((c) => escapeField(fmtValue(r[c]))).join(delim));
  }
  return lines.join("\n");
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeField(s: string, delim = ","): string {
  if (s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 流式解析大文件 */
export async function parseStream(
  filePath: string,
  onRow: (row: Record<string, unknown>) => void,
  opts: CsvOptions & JsonOptions = {}
): Promise<number> {
  const parser = new CsvParser(opts);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });

  // 注意：readline 按行分割会破坏嵌入换行的引号字段。
  // 这里采用累积缓冲，遇到未闭合的引号就继续拼接下一行。
  let buffer = "";
  let header: string[] | null = null;
  let count = 0;

  const flushBuffer = () => {
    if (buffer.trim() === "") return;
    const records = parser.parse(buffer);
    if (records.rows.length === 0) return;
    if (header === null) {
      if (opts.header !== false) {
        header = records.rows[0];
        records.rows.slice(1).forEach(processRow);
      } else {
        header = Array.from({ length: records.rows[0].length }, (_, i) => `col${i + 1}`);
        records.rows.forEach(processRow);
      }
    } else {
      records.rows.forEach(processRow);
    }
    buffer = "";
  };

  const processRow = (r: string[]) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < (header as string[]).length; i++) {
      o[(header as string[])[i]] = opts.coerce ? coerce(r[i] ?? "") : (r[i] ?? "");
    }
    onRow(o);
    count++;
  };

  for await (const line of rl) {
    buffer += (buffer ? "\n" : "") + line;
    // 检查引号是否平衡
    const qcount = (buffer.match(/"/g) || []).length;
    if (qcount % 2 === 0) {
      flushBuffer();
    }
  }
  if (buffer.trim() !== "") flushBuffer();
  return count;
}

/* ----------------------- CLI ----------------------- */

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
    console.log(`CSV 转 JSON 工具 CLI
用法:
  convert <csv> [-o json] [-d delim] [--no-header]   转换 CSV 为 JSON
  preview <csv> [-n rows]                            预览前 N 行
  schema  <csv>                                      推断列类型
  json2csv <json> [-o csv]                           JSON 转 CSV
  stream  <csv>                                      流式处理大文件
`);
    return;
  }

  switch (cmd) {
    case "convert": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
      const delim = getOpt(rest, "-d") || ",";
      const noHeader = rest.includes("--no-header");
      const out = getOpt(rest, "-o");
      const text = fs.readFileSync(path.resolve(file), "utf8");
      const parser = new CsvParser({ delimiter: delim, header: !noHeader });
      const rows = parser.parseObjects(text, { coerce: true });
      const json = JSON.stringify(rows, null, 2);
      if (out) fs.writeFileSync(path.resolve(out), json, "utf8");
      else console.log(json);
      console.error(`已转换 ${rows.length} 行`);
      break;
    }
    case "preview": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
      const n = getOptNum(rest, "-n", 5);
      const text = fs.readFileSync(path.resolve(file), "utf8");
      const parser = new CsvParser({ header: true });
      const { header, rows } = parser.parse(text);
      console.log(header.join(" | "));
      console.log(header.map((h) => "-".repeat(Math.max(5, h.length))).join("-+-"));
      for (let i = 0; i < Math.min(n, rows.length); i++) {
        console.log(rows[i].map((c) => c ?? "").join(" | "));
      }
      console.log(`(共 ${rows.length} 行，预览 ${Math.min(n, rows.length)} 行)`);
      break;
    }
    case "schema": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
      const text = fs.readFileSync(path.resolve(file), "utf8");
      const schema = inferSchema(text);
      console.log(JSON.stringify(schema, null, 2));
      break;
    }
    case "json2csv": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
      const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
      if (!Array.isArray(data)) throw new Error("JSON 顶层必须是数组");
      const csv = jsonToCsv(data as Record<string, unknown>[]);
      const out = getOpt(rest, "-o");
      if (out) fs.writeFileSync(path.resolve(out), csv, "utf8");
      else console.log(csv);
      break;
    }
    case "stream": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
      let count = 0;
      const n = await parseStream(
        path.resolve(file),
        (row) => {
          if (count < 3) console.log(JSON.stringify(row));
          count++;
        },
        { coerce: true }
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
      console.log("\n=== 转换为 JSON ===");
      console.log(JSON.stringify(rows, null, 2));
      console.log("\n=== Schema ===");
      console.log(JSON.stringify(inferSchema(csv), null, 2));
      console.log("\n=== 回写 CSV ===");
      console.log(jsonToCsv(rows));
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
