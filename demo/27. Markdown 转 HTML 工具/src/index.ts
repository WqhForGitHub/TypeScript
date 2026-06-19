#!/usr/bin/env node
/**
 * Markdown 转 HTML 工具 (Markdown to HTML Converter)
 *
 * 纯 TypeScript 实现的 Markdown 解析器，支持标题、粗体、斜体、行内代码、
 * 代码块、链接、图片、无序/有序列表、引用、分割线、段落等语法。
 *
 * 命令:
 *   convert <mdfile> [-o htmlfile]   转换单个 Markdown 文件为 HTML
 *   batch <dir> [-o outdir]          批量转换目录下所有 .md 文件
 *   watch <mdfile> [-o htmlfile]     监视文件变化并自动转换
 *   help                             显示帮助
 *
 * 说明: 输出干净的 HTML5 文档，附带基础样式。
 */

import * as fs from "fs";
import * as path from "path";

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 解析行内元素 (粗体、斜体、行内代码、链接、图片) */
function parseInline(text: string): string {
  // 先用占位符保护行内代码，避免其内部被二次解析
  const codeBlocks: string[] = [];
  let work = text.replace(/`([^`]+)`/g, (_, code) => {
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00${codeBlocks.length - 1}\x00`;
  });
  // 图片 ![alt](url)
  work = work.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
    `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`);
  // 链接 [text](url)
  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
    `<a href="${escapeHtml(url)}">${parseInline(label)}</a>`);
  // 粗体 **text**
  work = work.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体 *text* (避免与粗体冲突)
  work = work.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // 还原行内代码
  work = work.replace(/\x00(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i, 10)]);
  return work;
}

interface Block { type: string; content: string; items?: string[]; lang?: string; }

/** 解析块级元素 */
function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", content: paragraph.join(" ") });
      paragraph = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // 空行
    if (/^\s*$/.test(line)) { flushParagraph(); i++; continue; }
    // 代码块 ```
    const fence = line.match(/^```\s*(.*)$/);
    if (fence) {
      flushParagraph();
      const lang = fence[1].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      i++; // 跳过结束 ```
      blocks.push({ type: "code", content: codeLines.join("\n"), lang });
      continue;
    }
    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push({ type: `h${level}`, content: heading[2].trim() });
      i++; continue;
    }
    // 分割线
    if (/^(\*\s*){3,}$/.test(line) || /^(-\s*){3,}$/.test(line) || /^(_\s*){3,}$/.test(line) || /^-{3,}$/.test(line)) {
      flushParagraph();
      blocks.push({ type: "hr", content: "" });
      i++; continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }
    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", content: "", items });
      continue;
    }
    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", content: "", items });
      continue;
    }
    // 普通段落行
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return blocks;
}

/** 将块级元素渲染为 HTML */
function renderBlocks(blocks: Block[]): string {
  const html: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        html.push(`<${b.type}>${parseInline(b.content)}</${b.type}>`); break;
      case "code": {
        const cls = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : "";
        html.push(`<pre><code${cls}>${escapeHtml(b.content)}</code></pre>`); break;
      }
      case "blockquote": {
        const inner = renderBlocks(parseBlocks(b.content));
        html.push(`<blockquote>${inner}</blockquote>`); break;
      }
      case "ul":
        html.push(`<ul>${(b.items ?? []).map(it => `<li>${parseInline(it)}</li>`).join("")}</ul>`); break;
      case "ol":
        html.push(`<ol>${(b.items ?? []).map(it => `<li>${parseInline(it)}</li>`).join("")}</ol>`); break;
      case "hr": html.push("<hr>"); break;
      case "paragraph": html.push(`<p>${parseInline(b.content)}</p>`); break;
    }
  }
  return html.join("\n");
}

/** 提取标题作为文档标题 */
function extractTitle(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const m2 = md.match(/^(.+)\n[=-]+\s*$/m);
  if (m2) return m2[1].trim();
  return "文档";
}

const STYLE = `
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.7; color: #333; max-width: 820px; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin-top: 1.5em; margin-bottom: 0.5em; }
  h1 { border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
  h2 { border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
  code { background: #f5f5f5; padding: 0.15em 0.35em; border-radius: 3px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
  pre { background: #f5f5f5; padding: 1em; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #4a90d9; margin: 1em 0; padding: 0.5em 1em; color: #555; background: #f9f9f9; }
  a { color: #4a90d9; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  table { border-collapse: collapse; }
</style>`;

function convertMarkdown(md: string): string {
  const title = extractTitle(md);
  const body = renderBlocks(parseBlocks(md));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${STYLE}
</head>
<body>
${body}
</body>
</html>`;
}

function convertFile(mdFile: string, outPath: string): void {
  if (!fs.existsSync(mdFile)) throw new Error(`文件不存在: ${mdFile}`);
  const md = fs.readFileSync(mdFile, "utf8");
  const html = convertMarkdown(md);
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`\x1b[32m已转换: ${path.resolve(mdFile)} -> ${path.resolve(outPath)}\x1b[0m`);
}

function cmdConvert(args: string[]): void {
  if (!args[0]) { console.error("错误: 用法 convert <mdfile> [-o htmlfile]"); process.exit(1); }
  const mdFile = args[0];
  let outPath = "";
  for (let i = 1; i < args.length; i++) if (args[i] === "-o" || args[i] === "--output") outPath = args[++i] ?? "";
  if (!outPath) outPath = mdFile.replace(/\.md$/i, "") + ".html";
  convertFile(mdFile, outPath);
}

function cmdBatch(args: string[]): void {
  if (!args[0]) { console.error("错误: 用法 batch <dir> [-o outdir]"); process.exit(1); }
  const dir = args[0];
  let outDir = "";
  for (let i = 1; i < args.length; i++) if (args[i] === "-o" || args[i] === "--output") outDir = args[++i] ?? "";
  if (!outDir) outDir = dir;
  if (!fs.existsSync(dir)) { console.error(`错误: 目录不存在: ${dir}`); process.exit(1); }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let count = 0;
  for (const e of entries) {
    if (e.isFile() && /\.md$/i.test(e.name)) {
      const mdFile = path.join(dir, e.name);
      const outPath = path.join(outDir, e.name.replace(/\.md$/i, "") + ".html");
      try { convertFile(mdFile, outPath); count++; }
      catch (err) { console.error(`跳过 ${e.name}: ${err instanceof Error ? err.message : err}`); }
    }
  }
  console.log(`\n批量转换完成，共转换 ${count} 个文件。`);
}

function cmdWatch(args: string[]): void {
  if (!args[0]) { console.error("错误: 用法 watch <mdfile> [-o htmlfile]"); process.exit(1); }
  const mdFile = args[0];
  let outPath = "";
  for (let i = 1; i < args.length; i++) if (args[i] === "-o" || args[i] === "--output") outPath = args[++i] ?? "";
  if (!outPath) outPath = mdFile.replace(/\.md$/i, "") + ".html";
  console.log(`监视 ${path.resolve(mdFile)} 的变化，自动转换到 ${path.resolve(outPath)} (Ctrl+C 退出)\n`);
  const doConvert = () => {
    try { convertFile(mdFile, outPath); }
    catch (err) { console.error(`转换失败: ${err instanceof Error ? err.message : err}`); }
  };
  doConvert();
  let debounce: NodeJS.Timeout | null = null;
  fs.watch(mdFile, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(doConvert, 200);
  });
  process.on("SIGINT", () => { console.log("\n已停止监视。"); process.exit(0); });
}

function printHelp(): void {
  console.log(`
Markdown 转 HTML 工具 (Markdown to HTML Converter)
==================================================
支持标题、粗体、斜体、行内代码、代码块、链接、图片、列表、引用、分割线等。

用法:
  md2html convert <mdfile> [-o htmlfile]   转换单个 Markdown 文件
  md2html batch <dir> [-o outdir]          批量转换目录下 .md 文件
  md2html watch <mdfile> [-o htmlfile]     监视文件变化并自动转换
  md2html help                             显示本帮助

示例:
  md2html convert README.md -o readme.html
  md2html batch ./docs -o ./site
  md2html watch notes.md

说明: 输出 HTML5 文档，自带基础样式；未指定输出路径时使用同名 .html 文件。
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "convert": cmdConvert(rest); break;
      case "batch": cmdBatch(rest); break;
      case "watch": cmdWatch(rest); break;
      case "help": case "--help": case "-h": case undefined: printHelp(); break;
      default: console.error(`未知命令: ${command}\n运行 'md2html help' 查看帮助。`); process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
