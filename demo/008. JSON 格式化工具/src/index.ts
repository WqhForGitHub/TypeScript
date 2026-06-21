#!/usr/bin/env node
/**
 * JSON 格式化工具 (JSON Formatter)
 * -------------------------------
 * 使用方式：
 *   json-fmt format <file.json>           → 格式化 JSON (默认缩进 2 空格)
 *   json-fmt format <file.json> -i 4      → 格式化 JSON (缩进 4 空格)
 *   json-fmt minify <file.json>           → 压缩 JSON (移除所有空白)
 *   json-fmt validate <file.json>         → 校验 JSON 是否合法
 *   json-fmt query <file.json> <path>     → 用路径查询 JSON (如 "data.list[0].name")
 *   json-fmt stats <file.json>            → 显示 JSON 统计信息
 *   json-fmt --help                       → 显示帮助
 *
 * 也支持从 stdin 读取：
 *   echo '{"a":1}' | json-fmt format -
 *   echo '{"a":1}' | json-fmt validate -
 */

import * as fs from "fs";
import * as path from "path";

// ===================== 类型定义 =====================

/** 支持的子命令 */
type Command = "format" | "minify" | "validate" | "query" | "stats";

/** 解析后的命令行参数 */
interface ParsedArgs {
  command: Command | null;
  filePath: string;
  /** 缩进空格数 (仅 format 命令) */
  indent: number;
  /** 查询路径 (仅 query 命令) */
  queryPath: string;
  /** 是否从 stdin 读取 */
  useStdin: boolean;
  /** 是否显示帮助 */
  showHelp: boolean;
}

/** JSON 统计信息 */
interface JsonStats {
  type: string;
  keys: number;
  depth: number;
  sizeBytes: number;
  /** 对象类型的键列表 */
  keyList?: string[];
  /** 数组类型的长度 */
  arrayLength?: number;
}

// ===================== ANSI 颜色常量 =====================

const COLOR = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
  BOLD: "\x1b[1m",
} as const;

// ===================== 工具函数 =====================

/**
 * 从文件或 stdin 读取原始文本
 */
function readInput(filePath: string): string {
  if (filePath === "-") {
    // 从 stdin 读取 (同步方式)
    return fs.readFileSync(0, "utf-8");
  }
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`文件不存在: ${absPath}`);
  }
  return fs.readFileSync(absPath, "utf-8");
}

/**
 * 安全解析 JSON，返回 [结果, 错误]
 */
function safeParse(raw: string): [unknown, null] | [null, SyntaxError] {
  try {
    return [JSON.parse(raw), null];
  } catch (err) {
    return [
      null,
      err instanceof SyntaxError ? err : new SyntaxError(String(err)),
    ];
  }
}

/**
 * 根据点分隔路径查询 JSON 对象
 * 支持: "data.list[0].name" / "items" / "a.b.c"
 */
function queryByPath(obj: unknown, queryPath: string): unknown {
  if (queryPath.trim() === "") {
    return obj;
  }

  // 将路径拆分为 token: 支持 . 和 [] 语法
  // "data.list[0].name" → ["data", "list", "0", "name"]
  const tokens: string[] = [];
  const regex = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(queryPath)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }

  let current: unknown = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw new Error(
        `路径 "${queryPath}" 在 "${token}" 处遇到 null/undefined`,
      );
    }

    if (Array.isArray(current)) {
      const index = Number(token);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        throw new Error(
          `数组索引越界: [${token}] (数组长度: ${current.length})`,
        );
      }
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(
        `路径 "${queryPath}" 在 "${token}" 处遇到非对象类型: ${typeof current}`,
      );
    }
  }
  return current;
}

/**
 * 计算 JSON 对象的最大嵌套深度
 */
function calcDepth(obj: unknown, current: number = 0): number {
  if (obj === null || typeof obj !== "object") {
    return current;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return current + 1;
    return Math.max(...obj.map((item) => calcDepth(item, current + 1)));
  }
  const values = Object.values(obj as Record<string, unknown>);
  if (values.length === 0) return current + 1;
  return Math.max(...values.map((v) => calcDepth(v, current + 1)));
}

/**
 * 获取 JSON 统计信息
 */
function getStats(obj: unknown, rawSize: number): JsonStats {
  if (obj === null) {
    return { type: "null", keys: 0, depth: 0, sizeBytes: rawSize };
  }

  const type = Array.isArray(obj) ? "array" : typeof obj;

  if (type === "object") {
    const keys = Object.keys(obj as Record<string, unknown>);
    return {
      type,
      keys: keys.length,
      depth: calcDepth(obj),
      sizeBytes: rawSize,
      keyList: keys,
    };
  }

  if (type === "array") {
    return {
      type,
      keys: 0,
      depth: calcDepth(obj),
      sizeBytes: rawSize,
      arrayLength: (obj as unknown[]).length,
    };
  }

  return { type, keys: 0, depth: 0, sizeBytes: rawSize };
}

// ===================== 带语法高亮的 JSON 输出 =====================

/**
 * 对格式化后的 JSON 字符串进行语法高亮着色
 */
function colorize(jsonStr: string): string {
  return jsonStr
    .replace(/("(?:\\.|[^"\\])*")\s*:/g, `${COLOR.CYAN}$1${COLOR.RESET}:`) // 键名
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, `: ${COLOR.GREEN}$1${COLOR.RESET}`) // 字符串值
    .replace(
      /:\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      `: ${COLOR.YELLOW}$1${COLOR.RESET}`,
    ) // 数字
    .replace(/:\s*(true|false)/g, `: ${COLOR.BLUE}$1${COLOR.RESET}`) // 布尔值
    .replace(/:\s*(null)/g, `: ${COLOR.GRAY}$1${COLOR.RESET}`); // null
}

// ===================== 子命令实现 =====================

/**
 * format: 格式化 JSON 并输出
 */
function cmdFormat(raw: string, indent: number): void {
  const [obj, err] = safeParse(raw);
  if (err) {
    console.error(`${COLOR.RED}JSON 解析失败: ${err.message}${COLOR.RESET}`);
    process.exit(1);
  }
  const formatted = JSON.stringify(obj, null, indent);
  console.log(colorize(formatted));

  // 输出压缩比
  const minified = JSON.stringify(obj);
  const saved = raw.length - minified.length;
  const ratio =
    raw.length > 0 ? ((saved / raw.length) * 100).toFixed(1) : "0.0";
  console.log(
    `\n${COLOR.GRAY}原始: ${raw.length} 字节 | 格式化: ${formatted.length} 字节 | 压缩后: ${minified.length} 字节 | 可压缩: ${ratio}%${COLOR.RESET}`,
  );
}

/**
 * minify: 压缩 JSON (移除所有空白)
 */
function cmdMinify(raw: string): void {
  const [obj, err] = safeParse(raw);
  if (err) {
    console.error(`${COLOR.RED}JSON 解析失败: ${err.message}${COLOR.RESET}`);
    process.exit(1);
  }
  const minified = JSON.stringify(obj);
  console.log(minified);
  console.log(
    `\n${COLOR.GRAY}原始: ${raw.length} 字节 → 压缩: ${minified.length} 字节 (节省 ${raw.length - minified.length} 字节, ${((1 - minified.length / raw.length) * 100).toFixed(1)}%)${COLOR.RESET}`,
  );
}

/**
 * validate: 校验 JSON 是否合法
 */
function cmdValidate(raw: string): void {
  const [, err] = safeParse(raw);
  if (err) {
    console.log(`${COLOR.RED}✗ JSON 不合法${COLOR.RESET}`);
    console.log(`${COLOR.RED}  ${err.message}${COLOR.RESET}`);

    // 尝试定位错误位置
    const posMatch = err.message.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = Number(posMatch[1]);
      const start = Math.max(0, pos - 20);
      const end = Math.min(raw.length, pos + 20);
      const context = raw.substring(start, end).replace(/\n/g, "\\n");
      const pointer = " ".repeat(pos - start) + "^";
      console.log(`${COLOR.YELLOW}  上下文: ...${context}...${COLOR.RESET}`);
      console.log(`${COLOR.YELLOW}          ${pointer}${COLOR.RESET}`);
    }
    process.exit(1);
  }
  console.log(
    `${COLOR.GREEN}✓ JSON 格式合法${COLOR.RESET} (${raw.length} 字节)`,
  );
}

/**
 * query: 用路径查询 JSON 值
 */
function cmdQuery(raw: string, queryPath: string): void {
  const [obj, err] = safeParse(raw);
  if (err) {
    console.error(`${COLOR.RED}JSON 解析失败: ${err.message}${COLOR.RESET}`);
    process.exit(1);
  }

  try {
    const result = queryByPath(obj, queryPath);
    if (result === undefined) {
      console.log(
        `${COLOR.YELLOW}路径 "${queryPath}" 未找到任何值${COLOR.RESET}`,
      );
      process.exit(1);
    }

    const type = Array.isArray(result) ? "array" : typeof result;
    console.log(`${COLOR.GRAY}类型: ${type}${COLOR.RESET}`);

    if (typeof result === "object" && result !== null) {
      console.log(colorize(JSON.stringify(result, null, 2)));
    } else {
      console.log(
        typeof result === "string"
          ? `${COLOR.GREEN}"${result}"${COLOR.RESET}`
          : `${COLOR.YELLOW}${result}${COLOR.RESET}`,
      );
    }
  } catch (queryErr) {
    const msg = queryErr instanceof Error ? queryErr.message : String(queryErr);
    console.error(`${COLOR.RED}查询失败: ${msg}${COLOR.RESET}`);
    process.exit(1);
  }
}

/**
 * stats: 显示 JSON 统计信息
 */
function cmdStats(raw: string): void {
  const [obj, err] = safeParse(raw);
  if (err) {
    console.error(`${COLOR.RED}JSON 解析失败: ${err.message}${COLOR.RESET}`);
    process.exit(1);
  }

  const stats = getStats(obj, raw.length);

  console.log(`${COLOR.BOLD}── JSON 统计信息 ──${COLOR.RESET}`);
  console.log(`  根类型:    ${COLOR.CYAN}${stats.type}${COLOR.RESET}`);
  console.log(`  嵌套深度:  ${COLOR.YELLOW}${stats.depth}${COLOR.RESET}`);
  console.log(
    `  原始大小:  ${COLOR.GREEN}${stats.sizeBytes} 字节${COLOR.RESET}`,
  );

  if (stats.type === "object" && stats.keyList) {
    console.log(`  键数量:    ${COLOR.BLUE}${stats.keys}${COLOR.RESET}`);
    console.log(
      `  键列表:    ${COLOR.GRAY}${stats.keyList.slice(0, 20).join(", ")}${stats.keyList.length > 20 ? ` ... (共 ${stats.keyList.length} 个)` : ""}${COLOR.RESET}`,
    );
  }

  if (stats.type === "array" && stats.arrayLength !== undefined) {
    console.log(`  数组长度:  ${COLOR.BLUE}${stats.arrayLength}${COLOR.RESET}`);
  }
}

// ===================== CLI 参数解析 =====================

const VALID_COMMANDS: Command[] = [
  "format",
  "minify",
  "validate",
  "query",
  "stats",
];

function printHelp(): void {
  const help = `
JSON 格式化工具 (TypeScript 版)

用法:
  json-fmt <command> <file.json> [options]
  json-fmt --help, -h                     显示帮助

命令:
  format     格式化 JSON (美化输出，带语法高亮)
  minify     压缩 JSON (移除所有空白)
  validate   校验 JSON 是否合法
  query      用路径查询 JSON 中的值
  stats      显示 JSON 统计信息

选项:
  -i, --indent <n>   格式化缩进空格数 (默认: 2, 仅 format 命令)

从 stdin 读取:
  使用 "-" 作为文件名即可从标准输入读取
  echo '{"a":1}' | json-fmt format -

查询路径语法:
  data               访问对象键 "data"
  data.name          访问嵌套键
  data.list[0]       访问数组索引
  data.list[0].name  组合使用

示例:
  json-fmt format data.json
  json-fmt format data.json -i 4
  json-fmt minify data.json
  json-fmt validate data.json
  json-fmt query data.json "data.list[0].name"
  json-fmt stats data.json
  echo '{"a":1}' | json-fmt format -
`.trim();
  console.log(help);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  // 帮助
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return {
      command: null,
      filePath: "",
      indent: 2,
      queryPath: "",
      useStdin: false,
      showHelp: true,
    };
  }

  const command = args[0] as Command;
  if (!VALID_COMMANDS.includes(command)) {
    throw new Error(
      `未知命令: "${command}" (可用命令: ${VALID_COMMANDS.join(", ")})`,
    );
  }

  // 需要文件路径
  if (args.length < 2) {
    throw new Error(
      `命令 "${command}" 需要指定 JSON 文件路径 (或用 "-" 从 stdin 读取)`,
    );
  }

  const filePath = args[1];
  const useStdin = filePath === "-";

  // 解析额外选项
  let indent = 2;
  let queryPath = "";

  for (let i = 2; i < args.length; i++) {
    if (args[i] === "-i" || args[i] === "--indent") {
      i++;
      if (i >= args.length) {
        throw new Error("--indent 需要一个数字参数");
      }
      indent = Number(args[i]);
      if (Number.isNaN(indent) || indent < 0) {
        throw new Error("--indent 必须为非负整数");
      }
    } else if (command === "query" && !queryPath) {
      queryPath = args[i];
    }
  }

  // query 命令需要查询路径
  if (command === "query" && !queryPath) {
    throw new Error(
      'query 命令需要指定查询路径, 例如: json-fmt query data.json "data.name"',
    );
  }

  return { command, filePath, indent, queryPath, useStdin, showHelp: false };
}

// ===================== 主入口 =====================

function main(): void {
  try {
    const parsed = parseArgs(process.argv);

    if (parsed.showHelp) {
      printHelp();
      return;
    }

    const raw = readInput(parsed.filePath);

    switch (parsed.command) {
      case "format":
        cmdFormat(raw, parsed.indent);
        break;
      case "minify":
        cmdMinify(raw);
        break;
      case "validate":
        cmdValidate(raw);
        break;
      case "query":
        cmdQuery(raw, parsed.queryPath);
        break;
      case "stats":
        cmdStats(raw);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${COLOR.RED}错误: ${msg}${COLOR.RESET}\n`);
    printHelp();
    process.exit(1);
  }
}

main();
