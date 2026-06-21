#!/usr/bin/env node
/**
 * 文件批量重命名工具 (Batch File Rename Tool)
 *
 * 支持模板模式重命名、字符串替换、大小写转换、添加前缀后缀等操作。
 * 执行前总是先预览所有变更，必须加 -y 标志才会真正执行。
 *
 * 命令:
 *   preview <dir> <pattern>            预览模板重命名结果
 *   execute <dir> <pattern> -y         执行模板重命名
 *   replace <dir> <from> <to> [-y]     批量替换文件名中的字符串
 *   lowercase <dir> [-y]               文件名转小写
 *   uppercase <dir> [-y]               文件名转大写
 *   addprefix <dir> <prefix> [-y]      添加前缀
 *   addsuffix <dir> <suffix> [-y]      添加后缀 (在扩展名前)
 *   help                               显示帮助
 *
 * 模板变量:
 *   {name}      原文件名 (不含扩展名)
 *   {ext}       扩展名 (含点，如 .txt)
 *   {index}     序号 (从 1 开始)
 *   {index:N}   序号，零填充到 N 位，如 {index:3} -> 001
 *   {date}      当前日期 YYYYMMDD
 *   {date:fmt}  指定格式，如 {date:YYYY-MM-DD}
 */

import * as fs from "fs";
import * as path from "path";

interface RenamePlan {
  oldName: string;
  newName: string;
  conflict: boolean;
}

/** 列出目录中的文件 (不含子目录) */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) throw new Error(`不是目录: ${dir}`);
  return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort();
}

/** 解析日期格式 */
function formatDate(fmt: string): string {
  const d = new Date();
  const map: Record<string, string> = {
    "YYYY": String(d.getFullYear()),
    "MM": String(d.getMonth() + 1).padStart(2, "0"),
    "DD": String(d.getDate()).padStart(2, "0"),
    "HH": String(d.getHours()).padStart(2, "0"),
    "mm": String(d.getMinutes()).padStart(2, "0"),
    "ss": String(d.getSeconds()).padStart(2, "0"),
  };
  let result = fmt;
  for (const [k, v] of Object.entries(map)) result = result.split(k).join(v);
  return result;
}

/** 应用模板变量生成新文件名 */
function applyTemplate(template: string, original: string, index: number): string {
  const ext = path.extname(original);
  const name = path.basename(original, ext);
  let result = template;
  // {index:N}
  result = result.replace(/\{index:(\d+)\}/g, (_, n) => String(index).padStart(parseInt(n, 10), "0"));
  // {date:fmt}
  result = result.replace(/\{date:([^}]+)\}/g, (_, fmt) => formatDate(fmt));
  // {date}
  result = result.replace(/\{date\}/g, formatDate("YYYYMMDD"));
  // {name} {ext} {index}
  result = result.replace(/\{name\}/g, name);
  result = result.replace(/\{ext\}/g, ext);
  result = result.replace(/\{index\}/g, String(index));
  return result;
}

/** 计算重命名计划 */
function buildPlan(dir: string, transformer: (name: string, index: number) => string): RenamePlan[] {
  const files = listFiles(dir);
  const plans = files.map((f, i) => ({ oldName: f, newName: transformer(f, i + 1), conflict: false }));
  // 检测冲突 (新名字重复，或与目录中已有非本次源文件冲突)
  const newNames = plans.map(p => p.newName);
  const nameCount = new Map<string, number>();
  for (const n of newNames) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  const existing = new Set(files);
  for (const p of plans) {
    if (nameCount.get(p.newName)! > 1) p.conflict = true;
    else if (p.oldName !== p.newName && existing.has(p.newName)) p.conflict = true;
  }
  return plans;
}

/** 打印预览表格 */
function printPlan(plans: RenamePlan[], dir: string): number {
  let changed = 0;
  const rows: string[][] = [];
  for (const p of plans) {
    if (p.oldName === p.newName) continue;
    changed++;
    const mark = p.conflict ? " [冲突!]" : "";
    rows.push([p.oldName, " -> ", p.newName + mark]);
  }
  if (rows.length === 0) { console.log("没有需要重命名的文件。"); return 0; }
  const w1 = Math.max(...rows.map(r => r[0].length), 4);
  const w3 = Math.max(...rows.map(r => r[2].length), 6);
  console.log(`\n目录: ${path.resolve(dir)}`);
  console.log(`将重命名 ${changed} 个文件 (共 ${plans.length} 个):\n`);
  for (const r of rows) {
    const conflict = r[2].includes("[冲突!]");
    const prefix = conflict ? "\x1b[33m" : "\x1b[36m";
    console.log(`  ${r[0].padEnd(w1)}  ${r[1]}  ${prefix}${r[2]}\x1b[0m`);
  }
  const conflicts = plans.filter(p => p.conflict).length;
  if (conflicts > 0) console.log(`\n\x1b[33m警告: ${conflicts} 个文件存在命名冲突，执行时将被跳过。\x1b[0m`);
  console.log("");
  return changed;
}

/** 执行重命名计划 */
function executePlan(plans: RenamePlan[], dir: string): number {
  let done = 0;
  let skipped = 0;
  // 为避免循环冲突，先全部重命名为临时名，再重命名为目标名
  const tempNames = new Map<string, string>();
  for (const p of plans) {
    if (p.conflict) { skipped++; continue; }
    if (p.oldName === p.newName) continue;
    const temp = `.__batch_rename_tmp_${process.pid}_${done}__`;
    const oldP = path.join(dir, p.oldName);
    const tempP = path.join(dir, temp);
    fs.renameSync(oldP, tempP);
    tempNames.set(temp, p.newName);
    done++;
  }
  for (const [temp, newName] of tempNames) {
    fs.renameSync(path.join(dir, temp), path.join(dir, newName));
  }
  console.log(`\x1b[32m完成: 成功重命名 ${done} 个文件${skipped > 0 ? `，跳过 ${skipped} 个冲突文件` : ""}。\x1b[0m`);
  return done;
}

/** 从参数中提取 -y 标志 */
function extractYes(args: string[]): { rest: string[]; yes: boolean } {
  const yes = args.includes("-y") || args.includes("--yes");
  return { rest: args.filter(a => a !== "-y" && a !== "--yes"), yes };
}

function cmdPreview(args: string[]): void {
  if (args.length < 2) { console.error("错误: 用法 preview <dir> <pattern>"); process.exit(1); }
  const [dir, pattern] = args;
  const plans = buildPlan(dir, (name, i) => applyTemplate(pattern, name, i));
  printPlan(plans, dir);
}

function cmdExecute(args: string[]): void {
  if (args.length < 2) { console.error("错误: 用法 execute <dir> <pattern> -y"); process.exit(1); }
  const { rest, yes } = extractYes(args);
  const [dir, pattern] = rest;
  const plans = buildPlan(dir, (name, i) => applyTemplate(pattern, name, i));
  const changed = printPlan(plans, dir);
  if (changed === 0) return;
  if (!yes) { console.log("\x1b[33m这是预览模式。如需真正执行，请添加 -y 标志。\x1b[0m"); return; }
  executePlan(plans, dir);
}

function cmdTransform(args: string[], fn: (name: string, index: number, extra: string[]) => string, label: string): void {
  if (args.length < 1) { console.error(`错误: 用法 ${label}`); process.exit(1); }
  const { rest, yes } = extractYes(args);
  const dir = rest[0];
  const extra = rest.slice(1);
  const plans = buildPlan(dir, (name, i) => fn(name, i, extra));
  const changed = printPlan(plans, dir);
  if (changed === 0) return;
  if (!yes) { console.log("\x1b[33m这是预览模式。如需真正执行，请添加 -y 标志。\x1b[0m"); return; }
  executePlan(plans, dir);
}

function printHelp(): void {
  console.log(`
文件批量重命名工具 (Batch File Rename Tool)
============================================
支持模板模式、替换、大小写转换、前缀后缀等批量重命名操作。

用法:
  batch-rename preview <dir> <pattern>            预览模板重命名
  batch-rename execute <dir> <pattern> -y         执行模板重命名
  batch-rename replace <dir> <from> <to> [-y]     替换文件名中的字符串
  batch-rename lowercase <dir> [-y]               文件名转小写
  batch-rename uppercase <dir> [-y]               文件名转大写
  batch-rename addprefix <dir> <prefix> [-y]      添加前缀
  batch-rename addsuffix <dir> <suffix> [-y]      添加后缀 (扩展名前)

模板变量:
  {name}      原文件名 (不含扩展名)
  {ext}       扩展名 (含点)
  {index}     序号 (从 1 开始)
  {index:N}   零填充序号，如 {index:3} -> 001
  {date}      当前日期 YYYYMMDD
  {date:fmt}  指定格式，如 {date:YYYY-MM-DD}

示例:
  batch-rename preview ./photos IMG_{index:3}{ext}
  batch-rename execute ./docs report_{date}_{name}{ext} -y
  batch-rename replace ./data old_ new_ -y
  batch-rename addprefix ./logs backup_ -y
  batch-rename addsuffix ./images _thumb -y
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "preview": cmdPreview(rest); break;
      case "execute": cmdExecute(rest); break;
      case "replace": cmdTransform(rest, (name, _i, ex) => name.split(ex[0] ?? "").join(ex[1] ?? ""), "replace <dir> <from> <to> [-y]"); break;
      case "lowercase": cmdTransform(rest, (name) => name.toLowerCase(), "lowercase <dir> [-y]"); break;
      case "uppercase": cmdTransform(rest, (name) => name.toUpperCase(), "uppercase <dir> [-y]"); break;
      case "addprefix": cmdTransform(rest, (name, _i, ex) => (ex[0] ?? "") + name, "addprefix <dir> <prefix> [-y]"); break;
      case "addsuffix": cmdTransform(rest, (name, _i, ex) => {
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        return base + (ex[0] ?? "") + ext;
      }, "addsuffix <dir> <suffix> [-y]"); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'batch-rename help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
