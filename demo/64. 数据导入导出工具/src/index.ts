#!/usr/bin/env node
/**
 * 数据导入导出工具
 * - 支持 JSON / CSV / TSV / 简单表格格式（TABLE）互转
 * - 命令：import / export / merge / split / validate
 * - 自动按扩展名识别格式，支持 schema 推断与类型检测
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";

export type Format = "json" | "csv" | "tsv" | "table";

export interface Dataset {
  columns: string[];
  rows: Record<string, unknown>[];
  inferredTypes?: Record<string, string>;
}

/** 根据文件扩展名推断格式 */
export function detectFormat(file: string): Format {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv") return "tsv";
  if (ext === ".table" || ext === ".txt") return "table";
  throw new Error(`无法识别的文件扩展名: ${ext}`);
}

/** 推断单值的类型 */
export function inferType(v: unknown): string {
  if (v === null || v === undefined || v === "") return "null";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "real";
  if (typeof v === "string") {
    if (/^-?\d+$/.test(v)) return "integer";
    if (/^-?\d+\.\d+$/.test(v)) return "real";
    if (v === "true" || v === "false") return "boolean";
    const d = new Date(v);
    if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(v)) return "date";
    return "text";
  }
  return "unknown";
}

/** 推断每列的整体类型（取所有非空值的"最宽"类型） */
export function inferSchema(ds: Dataset): Record<string, string> {
  const types: Record<string, string> = {};
  for (const c of ds.columns) {
    const set = new Set<string>();
    for (const r of ds.rows) {
      const t = inferType(r[c]);
      if (t !== "null") set.add(t);
    }
    if (set.size === 0) types[c] = "null";
    else if (set.size === 1) types[c] = Array.from(set)[0];
    else if (set.has("real") && (set.has("integer"))) types[c] = "real";
    else types[c] = "text";
  }
  ds.inferredTypes = types;
  return types;
}

/* ----------------------- Parsers ----------------------- */

function parseDelimited(text: string, delim: string): Dataset {
  const rows = splitDelimited(text, delim);
  if (rows.length === 0) return { columns: [], rows: [] };
  const columns = rows[0];
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r: Record<string, unknown> = {};
    for (let j = 0; j < columns.length; j++) {
      const raw = rows[i][j] ?? "";
      r[columns[j]] = coerceValue(raw);
    }
    out.push(r);
  }
  return { columns, rows: out };
}

function splitDelimited(text: string, delim: string): string[][] {
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

function coerceValue(s: string): unknown {
  if (s === "") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

export function parseJson(text: string): Dataset {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON 数据必须是对象数组");
  if (data.length === 0) return { columns: [], rows: [] };
  const colSet: string[] = [];
  for (const r of data) {
    for (const k of Object.keys(r)) {
      if (!colSet.includes(k)) colSet.push(k);
    }
  }
  const rows = data.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of colSet) o[c] = r[c] ?? null;
    return o;
  });
  return { columns: colSet, rows };
}

export function parseCsv(text: string): Dataset {
  return parseDelimited(text, ",");
}

export function parseTsv(text: string): Dataset {
  return parseDelimited(text, "\t");
}

/** 简单表格格式：首行 +----+----+ 分隔，第二行表头，第三行分隔，后续为数据 */
export function parseTable(text: string): Dataset {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 3) throw new Error("TABLE 格式至少需要 3 行");
  // 找到表头行（首个非分隔行）
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^[+\-|=]+$/.test(lines[i]) && lines[i].includes("|")) {
      headerIdx = i;
      break;
    }
  }
  const columns = lines[headerIdx].split("|").map((s) => s.trim()).filter(Boolean);
  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^[+\-|=]+$/.test(lines[i])) continue;
    const parts = lines[i].split("|").map((s) => s.trim());
    // 去掉首尾空段
    const vals: string[] = [];
    for (let j = 0; j < parts.length; j++) {
      if (j === 0 && parts[j] === "") continue;
      if (j === parts.length - 1 && parts[j] === "") continue;
      vals.push(parts[j]);
    }
    const r: Record<string, unknown> = {};
    for (let j = 0; j < columns.length; j++) r[columns[j]] = coerceValue(vals[j] ?? "");
    rows.push(r);
  }
  return { columns, rows };
}

/* ----------------------- Serializers ----------------------- */

function escapeDelimited(v: unknown, delim: string): string {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(ds: Dataset): string {
  const lines = [ds.columns.join(",")];
  for (const r of ds.rows) {
    lines.push(ds.columns.map((c) => escapeDelimited(r[c], ",")).join(","));
  }
  return lines.join("\n");
}

export function toTsv(ds: Dataset): string {
  const lines = [ds.columns.join("\t")];
  for (const r of ds.rows) {
    lines.push(ds.columns.map((c) => escapeDelimited(r[c], "\t")).join("\t"));
  }
  return lines.join("\n");
}

export function toJson(ds: Dataset, pretty = true): string {
  return JSON.stringify(ds.rows, null, pretty ? 2 : 0);
}

export function toTable(ds: Dataset): string {
  if (ds.columns.length === 0) return "";
  const widths = ds.columns.map((c) =>
    Math.max(c.length, ...ds.rows.map((r) => fmt(r[c]).length))
  );
  const sep = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const header = "| " + ds.columns.map((c, i) => pad(c, widths[i])).join(" | ") + " |";
  const lines = [sep, header, sep];
  for (const r of ds.rows) {
    lines.push("| " + ds.columns.map((c, i) => pad(fmt(r[c]), widths[i])).join(" | ") + " |");
  }
  lines.push(sep);
  return lines.join("\n");
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/* ----------------------- Converter ----------------------- */

export function parse(text: string, format: Format): Dataset {
  switch (format) {
    case "json": return parseJson(text);
    case "csv": return parseCsv(text);
    case "tsv": return parseTsv(text);
    case "table": return parseTable(text);
  }
}

export function serialize(ds: Dataset, format: Format): string {
  switch (format) {
    case "json": return toJson(ds);
    case "csv": return toCsv(ds);
    case "tsv": return toTsv(ds);
    case "table": return toTable(ds);
  }
}

export function loadFile(file: string, format?: Format): Dataset {
  const fmt = format || detectFormat(file);
  const text = fs.readFileSync(path.resolve(file), "utf8");
  return parse(text, fmt);
}

export function saveFile(ds: Dataset, file: string, format?: Format): void {
  const fmt = format || detectFormat(file);
  fs.writeFileSync(path.resolve(file), serialize(ds, fmt), "utf8");
}

/** 合并多个数据集（按列并集） */
export function merge(datasets: Dataset[]): Dataset {
  const colSet: string[] = [];
  for (const ds of datasets) {
    for (const c of ds.columns) {
      if (!colSet.includes(c)) colSet.push(c);
    }
  }
  const rows: Record<string, unknown>[] = [];
  for (const ds of datasets) {
    for (const r of ds.rows) {
      const o: Record<string, unknown> = {};
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
    out.push({ columns: ds.columns.slice(), rows: ds.rows.slice(i, i + rowsPerFile) });
  }
  return out;
}

/** 校验数据集（每行列数一致、类型一致） */
export function validate(ds: Dataset): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const types = inferSchema(ds);
  for (let i = 0; i < ds.rows.length; i++) {
    const r = ds.rows[i];
    for (const c of ds.columns) {
      const t = inferType(r[c]);
      if (t === "null") continue;
      const expected = types[c];
      if (expected === "text" || expected === "null") continue;
      if (expected === "real" && (t === "integer" || t === "real")) continue;
      if (t !== expected) {
        errors.push(`第 ${i + 1} 行 列 ${c}: 期望 ${expected} 实际 ${t}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/* ----------------------- CLI ----------------------- */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasOpt(args: string[], name: string): boolean {
  return args.includes(name);
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
支持的格式：json / csv / tsv / table
`);
    return;
  }

  switch (cmd) {
    case "import": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
      const fmt = getOpt(rest, "-f") as Format | undefined;
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
      if (!infile || !outfile) throw new Error("用法: export <infile> <outfile>");
      const ds = loadFile(infile);
      saveFile(ds, outfile);
      console.log(`已转换 ${infile} -> ${outfile} (${ds.rows.length} 行)`);
      break;
    }
    case "merge": {
      const files = rest.filter((a) => !a.startsWith("-") && a !== getOpt(rest, "-o"));
      const out = getOpt(rest, "-o");
      if (files.length < 1) throw new Error("至少需要一个文件");
      const datasets = files.map((f) => loadFile(f));
      const merged = merge(datasets);
      if (out) saveFile(merged, out);
      else console.log(toJson(merged));
      console.log(`合并 ${datasets.length} 个文件，共 ${merged.rows.length} 行`);
      break;
    }
    case "split": {
      const [file] = rest;
      if (!file) throw new Error("缺少文件路径");
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
      if (!file) throw new Error("缺少文件路径");
      const fmt = getOpt(rest, "-f") as Format | undefined;
      const ds = loadFile(file, fmt);
      const r = validate(ds);
      if (r.valid) console.log("校验通过");
      else {
        console.log("校验失败:");
        for (const e of r.errors.slice(0, 20)) console.log("  " + e);
        if (r.errors.length > 20) console.log(`  ... 共 ${r.errors.length} 个错误`);
      }
      break;
    }
    case "demo": {
      // 生成示例数据
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
