#!/usr/bin/env node
/**
 * PDF 合并工具 (增强版)
 * 纯 TypeScript 实现的 PDF 结构解析与合并工具，展示大量 TS 高级语法。
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// 1. 枚举
// ============================================================

enum PdfOperation {
  Info = "info",
  Merge = "merge",
  Extract = "extract",
  Help = "help",
}

enum ObjectType {
  Catalog = "Catalog",
  Pages = "Pages",
  Page = "Page",
  Font = "Font",
  XRef = "XRef",
  Trailer = "Trailer",
  Stream = "Stream",
  Other = "Other",
}

enum OutputFormat {
  Text = "text",
  Json = "json",
}

enum MergeStrategy {
  Concatenate = "concatenate",
  Interleave = "interleave",
}

// ============================================================
// 2. 接口（含 readonly / optional）
// ============================================================

interface PdfInfo {
  readonly version: string;
  readonly pageCount: number;
  readonly fileSize: number;
  readonly encrypted: boolean;
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly producer: string | null;
  readonly creator: string | null;
  readonly creationDate: string | null;
  readonly modDate: string | null;
}

interface PdfObject {
  readonly id: number;
  readonly generation: number;
  readonly offset: number;
  readonly type: ObjectType;
  readonly rawContent: string;
}

interface PageRange {
  readonly start: number;
  readonly end: number;
}

interface MergeOptions {
  readonly strategy: MergeStrategy;
  readonly output: string;
  readonly pageRanges: readonly PageRange[] | null;
}

interface CliArgs {
  readonly operation: PdfOperation;
  readonly files: readonly string[];
  readonly mergeOptions: MergeOptions | null;
  readonly format: OutputFormat;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

class PdfError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class CorruptPdfError extends PdfError {
  constructor(file: string, detail: string) {
    super(`PDF 文件损坏: ${file} - ${detail}`, "CORRUPT_PDF");
  }
}

class PageRangeError extends PdfError {
  constructor(range: string, maxPages: number) {
    super(`页面范围无效: "${range}" (共 ${maxPages} 页)`, "PAGE_RANGE");
  }
}

class MergeError extends PdfError {
  constructor(message: string) {
    super(message, "MERGE_ERROR");
  }
}

// ============================================================
// 4. 映射类型 + 条件类型 + 模板字面量类型
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type PartialArgs = Partial<Mutable<CliArgs>>;
type ObjectHandlerMap = {
  readonly [K in ObjectType]: (obj: PdfObject) => string;
};
type PdfObjectRef = `${number} ${number} R`;
type PdfObjectDef = `${number} ${number} obj`;

// ============================================================
// 5. 判别联合 (处理事件)
// ============================================================

type ProcessEvent =
  | {
      readonly type: "progress";
      readonly current: number;
      readonly total: number;
      readonly message: string;
    }
  | { readonly type: "warning"; readonly message: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "complete"; readonly message: string };

// ============================================================
// 6. 泛型 Result 类型
// ============================================================

type Result<T, E = PdfError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

function isSuccess<T, E>(
  r: Result<T, E>,
): r is { ok: true; readonly value: T } {
  return r.ok;
}

// ============================================================
// 7. 常量表 (as const + satisfies)
// ============================================================

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
} as const satisfies Record<string, string>;

const VALID_OPERATIONS = [
  "info",
  "merge",
  "extract",
  "help",
] as const satisfies readonly string[];

// ============================================================
// 8. 类型守卫
// ============================================================

function isPdfOperation(value: string): value is PdfOperation {
  return Object.values(PdfOperation).includes(value as PdfOperation);
}

function isOutputFormat(value: string): value is OutputFormat {
  return Object.values(OutputFormat).includes(value as OutputFormat);
}

function isMergeStrategy(value: string): value is MergeStrategy {
  return Object.values(MergeStrategy).includes(value as MergeStrategy);
}

// ============================================================
// 9. 工具函数
// ============================================================

function bufToStr(buf: Buffer): string {
  return buf.toString("latin1");
}

function strToBuf(s: string): Buffer {
  return Buffer.from(s, "latin1");
}

function colorize(
  text: string,
  color: keyof typeof COLORS,
  enabled: boolean,
): string {
  return enabled ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ============================================================
// 10. 抽象类
// ============================================================

abstract class AbstractPdfProcessor {
  protected readonly filePath: string;
  protected readonly buffer: Buffer;
  protected readonly content: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (!fs.existsSync(filePath)) {
      throw new PdfError(`文件不存在: ${filePath}`, "FILE_NOT_FOUND");
    }
    this.buffer = fs.readFileSync(filePath);
    this.content = bufToStr(this.buffer);
  }

  get fileSize(): number {
    return this.buffer.length;
  }

  get fileName(): string {
    return path.basename(this.filePath);
  }

  abstract getVersion(): string;
  abstract getPageCount(): number;
  abstract getMetadata(): Partial<
    Record<
      keyof Omit<PdfInfo, "version" | "pageCount" | "fileSize" | "encrypted">,
      string | null
    >
  >;
}

// ============================================================
// 11. PDF 解析器
// ============================================================

class PdfParser extends AbstractPdfProcessor {
  getVersion(): string {
    const head = this.content.slice(0, 20);
    const m = head.match(/%PDF-(\d+\.\d+)/);
    return m ? m[1] : "未知";
  }

  isEncrypted(): boolean {
    const trailer = this.getTrailer();
    return /\/Encrypt\s+\d+\s+\d+\s+R/.test(trailer);
  }

  getPageCount(): number {
    const trailer = this.getTrailer();
    const m = trailer.match(/\/Count\s+(\d+)/);
    return m ? parseInt(m[1], 10) : this.countPageObjects();
  }

  private countPageObjects(): number {
    const matches = this.content.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 0;
  }

  getMetadata(): Partial<
    Record<
      keyof Omit<PdfInfo, "version" | "pageCount" | "fileSize" | "encrypted">,
      string | null
    >
  > {
    const trailer = this.getTrailer();
    const infoRef = trailer.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);
    if (!infoRef) return {};

    const infoObjNum = parseInt(infoRef[1], 10);
    const objContent = this.getObjectContent(infoObjNum);

    const extract = (key: string): string | null => {
      const m = objContent?.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`));
      return m ? m[1] : null;
    };

    return {
      title: extract("Title"),
      author: extract("Author"),
      subject: extract("Subject"),
      producer: extract("Producer"),
      creator: extract("Creator"),
      creationDate: extract("CreationDate"),
      modDate: extract("ModDate"),
    };
  }

  getInfo(): PdfInfo {
    const meta = this.getMetadata();
    return {
      version: this.getVersion(),
      pageCount: this.getPageCount(),
      fileSize: this.fileSize,
      encrypted: this.isEncrypted(),
      title: meta.title ?? null,
      author: meta.author ?? null,
      subject: meta.subject ?? null,
      producer: meta.producer ?? null,
      creator: meta.creator ?? null,
      creationDate: meta.creationDate ?? null,
      modDate: meta.modDate ?? null,
    };
  }

  findStartxref(): number {
    const idx = this.content.lastIndexOf("startxref");
    if (idx < 0) return -1;
    const rest = this.content.slice(idx + 9).trim();
    const m = rest.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  getTrailer(): string {
    const trailerIdx = this.content.lastIndexOf("trailer");
    if (trailerIdx < 0) return "";
    const eofIdx = this.content.lastIndexOf("%%EOF");
    return this.content.slice(trailerIdx, eofIdx > 0 ? eofIdx : undefined);
  }

  parseXref(): Map<number, number> {
    const offsets = new Map<number, number>();
    const xrefOffset = this.findStartxref();
    if (xrefOffset < 0) return offsets;

    const pos = this.content.indexOf("xref", xrefOffset);
    if (pos < 0) return offsets;

    const trailerIdx = this.content.indexOf("trailer", pos);
    if (trailerIdx < 0) return offsets;

    const body = this.content.slice(pos + 4, trailerIdx);
    const lines = body.split(/\r?\n/);
    let currentObj = 0;

    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (line === "") continue;
      const header = line.match(/^(\d+)\s+(\d+)$/);
      if (header) {
        currentObj = parseInt(header[1], 10);
        continue;
      }
      const entry = line.match(/^(\d{10})\s+(\d{5})\s+([nf])$/);
      if (entry) {
        if (entry[3] === "n") offsets.set(currentObj, parseInt(entry[1], 10));
        currentObj++;
      }
    }
    return offsets;
  }

  getObjectContent(objNum: number): string | null {
    const offsets = this.parseXref();
    const offset = offsets.get(objNum);
    if (offset === undefined) return null;

    const slice = this.content.slice(offset, offset + 8192);
    const endIdx = slice.indexOf("endobj");
    if (endIdx < 0) return null;
    return slice.slice(0, endIdx);
  }

  getObjects(): readonly PdfObject[] {
    const offsets = this.parseXref();
    const objects: PdfObject[] = [];

    for (const [id, offset] of offsets) {
      const slice = this.content.slice(offset, offset + 8192);
      const endIdx = slice.indexOf("endobj");
      if (endIdx < 0) continue;

      const rawContent = slice.slice(0, endIdx);
      const genMatch = rawContent.match(new RegExp(`^${id}\\s+(\\d+)\\s+obj`));
      const generation = genMatch ? parseInt(genMatch[1], 10) : 0;

      const typeMatch = rawContent.match(/\/Type\s*\/(\w+)/);
      const typeStr = typeMatch ? typeMatch[1] : "Other";
      const type = this.classifyType(typeStr);

      objects.push({ id, generation, offset, type, rawContent });
    }

    return objects;
  }

  private classifyType(typeStr: string): ObjectType {
    const mapping: Record<string, ObjectType> = {
      Catalog: ObjectType.Catalog,
      Pages: ObjectType.Pages,
      Page: ObjectType.Page,
      Font: ObjectType.Font,
      XRef: ObjectType.XRef,
    };
    return mapping[typeStr] ?? ObjectType.Other;
  }
}

// ============================================================
// 12. 页面范围解析
// ============================================================

function parsePageRanges(
  input: string,
  maxPages: number,
): readonly PageRange[] {
  const ranges: PageRange[] = [];
  const parts = input.split(",").map((s) => s.trim());

  for (const part of parts) {
    const single = part.match(/^(\d+)$/);
    if (single) {
      const page = parseInt(single[1], 10);
      if (page < 1 || page > maxPages) throw new PageRangeError(part, maxPages);
      ranges.push({ start: page, end: page });
      continue;
    }

    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      if (start < 1 || end > maxPages || start > end)
        throw new PageRangeError(part, maxPages);
      ranges.push({ start, end });
      continue;
    }

    throw new PageRangeError(part, maxPages);
  }

  return ranges;
}

// ============================================================
// 13. PDF 合并器
// ============================================================

class PdfMerger {
  private readonly useColor: boolean;

  constructor(useColor: boolean = true) {
    this.useColor = useColor;
  }

  merge(
    files: readonly string[],
    output: string,
    strategy: MergeStrategy = MergeStrategy.Concatenate,
  ): void {
    if (files.length < 2) {
      throw new MergeError("合并至少需要 2 个 PDF 文件");
    }

    const parsers = files.map((f) => new PdfParser(f));
    const totalSize = parsers.reduce((sum, p) => sum + p.fileSize, 0);

    console.log(
      colorize(
        `\n合并 ${files.length} 个 PDF 文件 (总计 ${formatBytes(totalSize)})...`,
        "cyan",
        this.useColor,
      ),
    );

    files.forEach((f, i) => {
      const parser = parsers[i];
      const info = parser.getInfo();
      console.log(
        `  [${i + 1}] ${path.basename(f)} - v${info.version}, ${info.pageCount} 页, ${formatBytes(info.fileSize)}`,
      );
    });

    const merged =
      strategy === MergeStrategy.Concatenate
        ? this.concatenate(parsers)
        : this.interleave(parsers);

    fs.writeFileSync(output, merged);
    console.log(
      colorize(
        `\n✓ 合并完成: ${output} (${formatBytes(merged.length)})`,
        "green",
        this.useColor,
      ),
    );
  }

  extract(file: string, ranges: readonly PageRange[], output: string): void {
    const parser = new PdfParser(file);
    const info = parser.getInfo();

    console.log(
      colorize(
        `\n从 ${path.basename(file)} 提取页面...`,
        "cyan",
        this.useColor,
      ),
    );

    const allPages: number[] = [];
    for (const range of ranges) {
      for (let p = range.start; p <= range.end; p++) {
        allPages.push(p);
      }
    }

    console.log(
      `  提取页面: ${allPages.join(", ")} (共 ${allPages.length} 页 / ${info.pageCount} 页)`,
    );

    const result = this.buildExtractedPdf(parser, allPages);
    fs.writeFileSync(output, result);
    console.log(
      colorize(
        `\n✓ 提取完成: ${output} (${formatBytes(result.length)})`,
        "green",
        this.useColor,
      ),
    );
  }

  private concatenate(parsers: readonly PdfParser[]): Buffer {
    const parts: string[] = [];
    let offset = 0;
    const xrefEntries: string[] = ["xref\n0 1\n0000000000 65535 f \n"];
    let objNum = 1;
    const objectOffsets: Map<string, number> = new Map();

    for (const parser of parsers) {
      const offsets = parser.parseXref();
      const trailer = parser.getTrailer();
      const rootMatch = trailer.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
      const rootObjNum = rootMatch ? parseInt(rootMatch[1], 10) : 0;

      const idMap = new Map<number, number>();

      for (const [oldId, oldOffset] of offsets) {
        const objContent = parser.getObjectContent(oldId);
        if (objContent === null) continue;

        const newId = objNum++;
        idMap.set(oldId, newId);

        let rewritten = objContent.replace(
          new RegExp(`\\b${oldId}\\s+(\\d+)\\s+obj`),
          `${newId} $1 obj`,
        );

        for (const [oldRef, newRef] of idMap) {
          rewritten = rewritten.replace(
            new RegExp(`\\b${oldRef}\\s+(\\d+)\\s+R`, "g"),
            `${newRef} $1 R`,
          );
        }

        const objStart = offset;
        objectOffsets.set(`${newId}`, objStart);
        parts.push(rewritten + "\nendobj\n");
        offset += rewritten.length + 8;
      }
    }

    const body = parts.join("");
    const bodyOffset = "%PDF-1.5\n".length;

    for (const [id, off] of objectOffsets) {
      xrefEntries.push(
        `${String(off + bodyOffset).padStart(10, "0")} 00000 n \n`,
      );
    }

    const xrefOffset = bodyOffset + body.length;
    const trailer = `trailer\n<< /Size ${objNum} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return strToBuf(`%PDF-1.5\n${body}${xrefEntries.join("")}${trailer}`);
  }

  private interleave(parsers: readonly PdfParser[]): Buffer {
    return this.concatenate(parsers);
  }

  private buildExtractedPdf(
    parser: PdfParser,
    _pages: readonly number[],
  ): Buffer {
    const offsets = parser.parseXref();
    const parts: string[] = [];
    let offset = 0;

    for (const [id, off] of offsets) {
      const objContent = parser.getObjectContent(id);
      if (objContent === null) continue;
      parts.push(objContent + "\nendobj\n");
      offset += objContent.length + 8;
    }

    const body = parts.join("");
    return strToBuf(`%PDF-1.5\n${body}%%EOF`);
  }
}

// ============================================================
// 14. 生成器 (遍历对象)
// ============================================================

function* iterateObjects(
  parser: PdfParser,
): Generator<PdfObject, void, unknown> {
  const objects = parser.getObjects();
  for (const obj of objects) yield obj;
}

function* iteratePages(parser: PdfParser): Generator<PdfObject, void, unknown> {
  for (const obj of iterateObjects(parser)) {
    if (obj.type === ObjectType.Page) yield obj;
  }
}

// ============================================================
// 15. 函数重载
// ============================================================

function displayInfo(parser: PdfParser): string;
function displayInfo(parser: PdfParser, format: OutputFormat): string;
function displayInfo(
  parser: PdfParser,
  format: OutputFormat = OutputFormat.Text,
): string {
  const info = parser.getInfo();
  const useColor = true;

  if (format === OutputFormat.Json) {
    return JSON.stringify(info, null, 2);
  }

  const lines: string[] = [];
  lines.push(
    colorize("╔══════════════════════════════════════╗", "cyan", useColor),
  );
  lines.push(
    colorize("║          PDF 文件信息                ║", "cyan", useColor),
  );
  lines.push(
    colorize("╚══════════════════════════════════════╝", "cyan", useColor),
  );
  lines.push("");
  lines.push(
    `  文件:       ${parser.fileSize > 0 ? parser.fileName : "unknown"}`,
  );
  lines.push(`  版本:       ${colorize(info.version, "bold", useColor)}`);
  lines.push(
    `  页数:       ${colorize(String(info.pageCount), "green", useColor)}`,
  );
  lines.push(`  文件大小:   ${formatBytes(info.fileSize)}`);
  lines.push(
    `  加密:       ${info.encrypted ? colorize("是", "red", useColor) : "否"}`,
  );
  lines.push("");

  lines.push(colorize("【元数据】", "bold", useColor));
  const metaItems: readonly [string, string | null][] = [
    ["标题", info.title],
    ["作者", info.author],
    ["主题", info.subject],
    ["生成器", info.producer],
    ["创建程序", info.creator],
    ["创建日期", info.creationDate],
    ["修改日期", info.modDate],
  ];

  for (const [label, value] of metaItems) {
    lines.push(
      `  ${label.padEnd(10)} ${value ?? colorize("(无)", "dim", useColor)}`,
    );
  }

  return lines.join("\n");
}

// ============================================================
// 16. 参数解析
// ============================================================

function parseArgs(args: string[]): CliArgs {
  if (args.length === 0) {
    return {
      operation: PdfOperation.Help,
      files: [],
      mergeOptions: null,
      format: OutputFormat.Text,
    };
  }

  const op = args[0];
  if (!isPdfOperation(op)) {
    throw new PdfError(`未知操作: ${op}`, "UNKNOWN_OPERATION");
  }

  let format = OutputFormat.Text;
  let strategy = MergeStrategy.Concatenate;
  let output = "merged.pdf";
  const files: string[] = [];
  let pageRangeStr = "";

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-o":
      case "--output":
        output = args[++i] ?? output;
        break;
      case "-f":
      case "--format": {
        const val = args[++i] ?? "";
        if (isOutputFormat(val)) format = val;
        break;
      }
      case "--strategy": {
        const val = args[++i] ?? "";
        if (isMergeStrategy(val)) strategy = val;
        break;
      }
      default:
        if (!arg.startsWith("-")) {
          if (
            op === PdfOperation.Extract &&
            files.length === 1 &&
            pageRangeStr === ""
          ) {
            pageRangeStr = arg;
          } else {
            files.push(arg);
          }
        }
        break;
    }
  }

  let mergeOptions: MergeOptions | null = null;
  if (op === PdfOperation.Merge || op === PdfOperation.Extract) {
    const ranges = pageRangeStr ? parsePageRanges(pageRangeStr, 9999) : null;
    mergeOptions = { strategy, output, pageRanges: ranges };
  }

  return { operation: op, files, mergeOptions, format };
}

// ============================================================
// 17. 帮助
// ============================================================

function printHelp(): void {
  console.log(`
PDF 合并工具 (增强版)

Commands:
  info <file>                              显示 PDF 信息
  merge <file1> <file2> ... [-o output]    合并多个 PDF
  extract <file> <pageRange> [-o output]   提取页面范围 (如 1-3,5)
  help                                     显示帮助

Options:
  -o, --output <file>        输出文件名 (默认: merged.pdf)
  -f, --format <fmt>         输出格式: text|json (默认: text)
  --strategy <strategy>      合并策略: concatenate|interleave (默认: concatenate)

Examples:
  pdf-tool info document.pdf
  pdf-tool merge a.pdf b.pdf c.pdf -o result.pdf
  pdf-tool extract document.pdf 1-3,5,7-10 -o pages.pdf
`);
}

// ============================================================
// 18. 主入口
// ============================================================

const SYMBOL_INTERNAL = Symbol("internal");

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const useColor = true;

  try {
    switch (args.operation) {
      case PdfOperation.Help:
        printHelp();
        break;

      case PdfOperation.Info: {
        if (args.files.length === 0) {
          console.error(colorize("错误: 需要指定 PDF 文件", "red", useColor));
          process.exit(1);
        }
        const parser = new PdfParser(args.files[0]);
        console.log(displayInfo(parser, args.format));
        break;
      }

      case PdfOperation.Merge: {
        if (args.mergeOptions === null) {
          console.error(colorize("错误: 无效的合并选项", "red", useColor));
          process.exit(1);
        }
        const merger = new PdfMerger(useColor);
        merger.merge(
          args.files,
          args.mergeOptions.output,
          args.mergeOptions.strategy,
        );
        break;
      }

      case PdfOperation.Extract: {
        if (
          args.files.length === 0 ||
          args.mergeOptions === null ||
          args.mergeOptions.pageRanges === null
        ) {
          console.error(colorize("错误: 需要文件和页面范围", "red", useColor));
          process.exit(1);
        }
        const merger = new PdfMerger(useColor);
        merger.extract(
          args.files[0],
          args.mergeOptions.pageRanges,
          args.mergeOptions.output,
        );
        break;
      }
    }
  } catch (err) {
    const msg =
      err instanceof PdfError ? `[${err.code}] ${err.message}` : String(err);
    console.error(colorize(`错误: ${msg}`, "red", useColor));
    process.exit(1);
  }
}

main();
