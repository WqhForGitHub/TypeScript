#!/usr/bin/env node
/**
 * 文件大小统计工具 (File Size Statistics Tool)
 *
 * 递归扫描目录并统计文件大小信息，包括总大小、文件数、按扩展名分组、
 * 最大文件、大小分布、目录树，并支持监控目录变化。
 *
 * 命令:
 *   stats <dir>                 综合统计：总大小、文件数、扩展名分组、分布
 *   bytype <dir>                按扩展名分组统计
 *   top <dir> [-n count]        最大的 N 个文件 (默认 10)
 *   tree <dir> [-d depth]       目录大小树 (默认深度 3)
 *   watch <dir>                 监控目录大小变化
 *   help                        显示帮助
 *
 * 说明: 仅使用 Node.js 内置模块，大小以人类可读形式显示 (B/KB/MB/GB)。
 */

import * as fs from "fs";
import * as path from "path";

interface FileEntry {
  path: string;
  size: number;
  ext: string;
}

interface DirNode {
  name: string;
  path: string;
  size: number;
  fileCount: number;
  children: DirNode[];
}

/** 人类可读的大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 0) return "-" + formatSize(-bytes);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return val.toFixed(idx === 0 ? 0 : 2) + " " + units[idx];
}

/** 递归收集所有文件 */
function collectFiles(dir: string, files: FileEntry[] = []): FileEntry[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue; // 跳过常见大目录
      collectFiles(full, files);
    } else if (e.isFile()) {
      try {
        const stat = fs.statSync(full);
        files.push({ path: full, size: stat.size, ext: path.extname(e.name).toLowerCase() });
      } catch { /* 忽略无法访问的文件 */ }
    }
  }
  return files;
}

/** 构建目录大小树 */
function buildTree(dir: string, depth: number, maxDepth: number): DirNode {
  const node: DirNode = { name: path.basename(dir) || dir, path: dir, size: 0, fileCount: 0, children: [] };
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return node; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      if (depth < maxDepth) {
        const child = buildTree(full, depth + 1, maxDepth);
        node.size += child.size;
        node.fileCount += child.fileCount;
        node.children.push(child);
      }
    } else if (e.isFile()) {
      try {
        const stat = fs.statSync(full);
        node.size += stat.size;
        node.fileCount++;
      } catch { /* 忽略 */ }
    }
  }
  node.children.sort((a, b) => b.size - a.size);
  return node;
}

/** 渲染表格 */
function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]?.length ?? 0)));
  const sep = "+" + widths.map(w => "-".repeat(w + 2)).join("+") + "+";
  const line = (cells: string[]) => "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  return [sep, line(headers), sep, ...rows.map(line), sep].join("\n");
}

function cmdStats(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供目录路径"); process.exit(1); }
  const dir = args[0];
  if (!fs.existsSync(dir)) { console.error(`错误: 目录不存在: ${dir}`); process.exit(1); }
  const files = collectFiles(dir);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  console.log(`\n目录统计: ${path.resolve(dir)}`);
  console.log(`总文件数: ${files.length}`);
  console.log(`总大小:   ${formatSize(totalSize)} (${totalSize.toLocaleString()} 字节)`);
  if (files.length > 0) {
    const avg = totalSize / files.length;
    console.log(`平均大小: ${formatSize(avg)}`);
  }
  // 按扩展名分组
  const byExt = new Map<string, { count: number; size: number }>();
  for (const f of files) {
    const key = f.ext || "(无扩展名)";
    const cur = byExt.get(key) ?? { count: 0, size: 0 };
    cur.count++; cur.size += f.size;
    byExt.set(key, cur);
  }
  if (byExt.size > 0) {
    const rows = [...byExt.entries()].sort((a, b) => b[1].size - a[1].size)
      .map(([ext, v]) => [ext, String(v.count), formatSize(v.size), ((v.size / totalSize) * 100).toFixed(1) + "%"]);
    console.log(`\n按扩展名分组:\n${renderTable(["扩展名", "文件数", "大小", "占比"], rows)}`);
  }
  // 大小分布
  const buckets = [
    { label: "< 1KB", test: (s: number) => s < 1024 },
    { label: "1KB - 100KB", test: (s: number) => s >= 1024 && s < 100 * 1024 },
    { label: "100KB - 1MB", test: (s: number) => s >= 100 * 1024 && s < 1024 * 1024 },
    { label: "1MB - 10MB", test: (s: number) => s >= 1024 * 1024 && s < 10 * 1024 * 1024 },
    { label: "10MB - 100MB", test: (s: number) => s >= 10 * 1024 * 1024 && s < 100 * 1024 * 1024 },
    { label: "> 100MB", test: (s: number) => s >= 100 * 1024 * 1024 },
  ];
  const distRows = buckets.map(b => {
    const count = files.filter(f => b.test(f.size)).length;
    return [b.label, String(count), count > 0 ? "█".repeat(Math.max(1, Math.round(count / files.length * 40))) : "", ((count / files.length) * 100).toFixed(1) + "%"];
  });
  console.log(`\n大小分布:\n${renderTable(["区间", "数量", "图示", "占比"], distRows)}\n`);
}

function cmdByType(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供目录路径"); process.exit(1); }
  const files = collectFiles(args[0]);
  const totalSize = files.reduce((s, f) => s + f.size, 0) || 1;
  const byExt = new Map<string, { count: number; size: number }>();
  for (const f of files) {
    const key = f.ext || "(无扩展名)";
    const cur = byExt.get(key) ?? { count: 0, size: 0 };
    cur.count++; cur.size += f.size;
    byExt.set(key, cur);
  }
  const rows = [...byExt.entries()].sort((a, b) => b[1].size - a[1].size)
    .map(([ext, v]) => [ext, String(v.count), formatSize(v.size), ((v.size / totalSize) * 100).toFixed(1) + "%"]);
  console.log(`\n按扩展名分组统计: ${path.resolve(args[0])}\n`);
  console.log(renderTable(["扩展名", "文件数", "总大小", "占比"], rows));
  console.log("");
}

function cmdTop(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供目录路径"); process.exit(1); }
  let n = 10;
  for (let i = 1; i < args.length; i++) if (args[i] === "-n" || args[i] === "--count") n = parseInt(args[++i] ?? "10", 10);
  const files = collectFiles(args[0]).sort((a, b) => b.size - a.size).slice(0, n);
  if (files.length === 0) { console.log("目录中没有文件。"); return; }
  const maxLen = Math.max(...files.map(f => path.basename(f.path).length), 4);
  console.log(`\n最大的 ${files.length} 个文件: ${path.resolve(args[0])}\n`);
  files.forEach((f, i) => {
    const bar = "█".repeat(Math.min(30, Math.max(1, Math.round(f.size / files[0].size * 30))));
    console.log(`  ${(i + 1).toString().padStart(2)}. ${path.basename(f.path).padEnd(maxLen)}  ${formatSize(f.size).padStart(10)}  ${bar}`);
  });
  console.log("");
}

function cmdTree(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供目录路径"); process.exit(1); }
  let depth = 3;
  for (let i = 1; i < args.length; i++) if (args[i] === "-d" || args[i] === "--depth") depth = parseInt(args[++i] ?? "3", 10);
  const tree = buildTree(args[0], 0, depth);
  console.log(`\n目录大小树 (深度 ${depth}): ${path.resolve(args[0])}\n`);
  const render = (node: DirNode, prefix: string, isLast: boolean, top: boolean) => {
    const connector = top ? "" : (isLast ? "└── " : "├── ");
    const pct = tree.size > 0 ? ((node.size / tree.size) * 100).toFixed(1) + "%" : "0%";
    console.log(`${prefix}${connector}${node.name}/  ${formatSize(node.size).padStart(10)}  (${node.fileCount} 文件, ${pct})`);
    const childPrefix = top ? "" : (isLast ? "    " : "│   ");
    node.children.forEach((c, i) => render(c, prefix + childPrefix, i === node.children.length - 1, false));
  };
  render(tree, "", true, true);
  console.log(`\n总计: ${formatSize(tree.size)}, ${tree.fileCount} 个文件\n`);
}

function cmdWatch(args: string[]): void {
  if (!args[0]) { console.error("错误: 请提供目录路径"); process.exit(1); }
  const dir = args[0];
  console.log(`监控目录大小变化: ${path.resolve(dir)} (每 2 秒刷新，Ctrl+C 退出)\n`);
  let lastSize = -1;
  const tick = () => {
    const files = collectFiles(dir);
    const size = files.reduce((s, f) => s + f.size, 0);
    const time = new Date().toLocaleTimeString();
    const delta = lastSize < 0 ? 0 : size - lastSize;
    const deltaStr = lastSize < 0 ? "" : (delta >= 0 ? ` \x1b[31m+${formatSize(delta)}\x1b[0m` : ` \x1b[32m${formatSize(delta)}\x1b[0m`);
    process.stdout.write(`\r\x1b[K[${time}] 文件数: ${files.length}  总大小: ${formatSize(size)}${deltaStr}`);
    lastSize = size;
  };
  tick();
  const timer = setInterval(tick, 2000);
  process.on("SIGINT", () => { clearInterval(timer); console.log("\n已停止监控。"); process.exit(0); });
}

function printHelp(): void {
  console.log(`
文件大小统计工具 (File Size Statistics Tool)
============================================
递归扫描目录并统计文件大小信息。

用法:
  fsize stats <dir>                 综合统计：总大小、文件数、扩展名分组、分布
  fsize bytype <dir>                按扩展名分组统计
  fsize top <dir> [-n count]        最大的 N 个文件 (默认 10)
  fsize tree <dir> [-d depth]       目录大小树 (默认深度 3)
  fsize watch <dir>                 监控目录大小变化
  fsize help                        显示本帮助

示例:
  fsize stats ./src
  fsize top ./dist -n 20
  fsize tree . -d 2
  fsize watch ./logs

说明: 自动跳过 node_modules 与 .git 目录。大小以 B/KB/MB/GB 显示。
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "stats": cmdStats(rest); break;
      case "bytype": cmdByType(rest); break;
      case "top": cmdTop(rest); break;
      case "tree": cmdTree(rest); break;
      case "watch": cmdWatch(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'fsize help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
