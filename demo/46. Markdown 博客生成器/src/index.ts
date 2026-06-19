#!/usr/bin/env node
/**
 * 46. Markdown 博客生成器
 * ----------------------------------------------------
 * 将一个目录下的 .md 文件 (含 YAML frontmatter: title/date/tags) 转换为静态 HTML 博客。
 *   - 首页 (按日期倒序的文章列表)
 *   - 单篇文章页
 *   - 标签页 (按标签归档)
 *   - RSS feed (rss.xml)
 *   - 内置 CSS 样式
 *
 * 命令:
 *   build <src> [-o outdir]           构建静态站点
 *   serve <src> [-p port]             本地预览 (带 watch 监听)
 *   new <title>                       创建新文章模板
 *
 * Markdown 支持: 标题/粗体/斜体/行内代码/代码块/列表/链接/引用。
 *
 * 仅使用 Node.js 内置模块。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { URL } from 'url';

interface PostFrontmatter {
  title: string;
  date: string; // ISO 字符串
  tags: string[];
  description?: string;
}

interface Post {
  slug: string;
  frontmatter: PostFrontmatter;
  markdown: string;
  html: string;
  sourcePath: string;
}

interface BuildOptions {
  src: string;
  outDir: string;
}

interface ServeOptions {
  src: string;
  port: number;
}

interface NewPostOptions {
  title: string;
  src: string;
}

const Logger = {
  info(msg: string): void {
    console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  },
  warn(msg: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  },
  error(msg: string): void {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  },
};

/** 解析命令行 */
function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string>;
  help: boolean;
} {
  const args = argv.slice(2);
  const result = {
    command: '',
    positional: [] as string[],
    flags: {} as Record<string, string>,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      result.help = true;
      i++;
      continue;
    }
    if (a.startsWith('-')) {
      // 形如 -o value 或 --out value
      const key = a.replace(/^--?/, '');
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        result.flags[key] = next;
        i += 2;
      } else {
        result.flags[key] = 'true';
        i++;
      }
      continue;
    }
    if (!result.command) {
      result.command = a;
    } else {
      result.positional.push(a);
    }
    i++;
  }
  return result;
}

function printHelp(): void {
  console.log(`
Markdown 博客生成器 - 使用说明

用法:
  markdown-blog-generator build <src> [-o outdir]
  markdown-blog-generator serve <src> [-p port]
  markdown-blog-generator new <title> [-s src]
  markdown-blog-generator -h, --help

命令:
  build    构建静态站点到 outdir (默认 ./dist-blog)
  serve    本地预览 (默认端口 4000，自动监听 src 变化并重新构建)
  new      创建一篇新文章模板

选项:
  -o, --out <dir>     输出目录
  -p, --port <n>      预览端口
  -s, --src <dir>     源 Markdown 目录 (用于 new)
  -h, --help          显示帮助

Frontmatter 格式 (YAML):
  ---
  title: 文章标题
  date: 2024-01-01T10:00:00Z
  tags: [typescript, demo]
  description: 简短描述
  ---
`);
}

/** 解析 YAML frontmatter (简化的 key: value 与 [a, b] 列表) */
function parseFrontmatter(raw: string): { frontmatter: PostFrontmatter; body: string } {
  const fm: PostFrontmatter = {
    title: '未命名',
    date: new Date().toISOString(),
    tags: [],
  };
  let body = raw;

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    const yamlBlock = match[1];
    body = match[2];
    for (const line of yamlBlock.split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim();
      if (key === 'tags') {
        // [a, b] 或 a, b
        const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
        if (inner) {
          fm.tags = inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
        }
      } else if (key === 'title' || key === 'description') {
        fm[key] = val.replace(/^"|"$/g, '');
      } else if (key === 'date') {
        fm.date = val.replace(/^"|"$/g, '');
      } else {
        // 未知字段忽略
      }
    }
  }
  return { frontmatter: fm, body };
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 简易 Markdown -> HTML 转换 */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let inOl = false;
  let inQuote = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

  for (const line of lines) {
    // 代码块
    const codeFence = line.match(/^```(\w*)\s*$/);
    if (codeFence) {
      if (!inCodeBlock) { inCodeBlock = true; codeLang = codeFence[1] || ''; codeLines = []; }
      else { out.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`); inCodeBlock = false; }
      continue;
    }
    if (inCodeBlock) { codeLines.push(line); continue; }
    // 空行
    if (/^\s*$/.test(line)) { closeList(); closeQuote(); out.push(''); continue; }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); closeQuote(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    // 引用
    if (/^>\s?/.test(line)) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${inline(line.replace(/^>\s?/, ''))}</p>`);
      continue;
    } else { closeQuote(); }
    // 有序列表
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (inList) closeList();
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    } else if (inOl) { out.push('</ol>'); inOl = false; }
    // 无序列表
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    } else if (inList) { out.push('</ul>'); inList = false; }
    // 水平线
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr />'); continue; }
    // 普通段落
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inCodeBlock) { out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`); }
  closeList();
  closeQuote();
  return out.join('\n');
}

/** 行内格式：粗体/斜体/行内代码/链接/图片 */
function inline(text: string): string {
  let s = text;
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, url) => `<a href="${escapeHtml(url)}">${escapeHtml(t)}</a>`);
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

/** 生成 slug */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\w\u4e00-\u9fa5\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'post-' + Date.now();
}

/** 加载所有文章 */
function loadPosts(src: string): Post[] {
  if (!fs.existsSync(src)) { Logger.error(`源目录不存在: ${src}`); return []; }
  const entries = fs.readdirSync(src).filter((f) => f.endsWith('.md'));
  const posts: Post[] = [];
  for (const entry of entries) {
    const fullPath = path.join(src, entry);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const slug = slugify(frontmatter.title) || entry.replace(/\.md$/, '');
    posts.push({ slug, frontmatter, markdown: body, html: markdownToHtml(body), sourcePath: fullPath });
  }
  posts.sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
  return posts;
}

/** CSS 样式 */
function blogCss(): string {
  return `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 0 auto; padding: 20px; color: #2c3e50; line-height: 1.7; background: #fafbfc; }
    a { color: #3498db; text-decoration: none; } a:hover { text-decoration: underline; }
    header { padding: 20px 0; border-bottom: 2px solid #3498db; margin-bottom: 24px; } header h1 { margin: 0; font-size: 28px; } header .subtitle { color: #7f8c8d; font-size: 14px; margin-top: 4px; }
    .post-list { list-style: none; padding: 0; } .post-list li { padding: 16px 0; border-bottom: 1px solid #ecf0f1; } .post-list h2 { margin: 0 0 4px 0; font-size: 20px; }
    .post-meta { color: #95a5a6; font-size: 13px; }
    .tag { display: inline-block; background: #ecf0f1; color: #34495e; padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-right: 4px; }
    article h1 { font-size: 28px; margin-bottom: 4px; } article h2 { font-size: 22px; margin-top: 28px; } article h3 { font-size: 18px; margin-top: 22px; }
    article pre { background: #2c3e50; color: #ecf0f1; padding: 14px; border-radius: 6px; overflow-x: auto; }
    article code { background: #ecf0f1; padding: 2px 5px; border-radius: 3px; font-family: Consolas, Monaco, monospace; } article pre code { background: transparent; padding: 0; }
    article blockquote { border-left: 4px solid #3498db; padding: 4px 16px; margin: 16px 0; color: #555; background: #ecf0f1; }
    article img { max-width: 100%; border-radius: 6px; } article hr { border: none; border-top: 1px solid #ecf0f1; margin: 24px 0; }
    .tags-cloud a { display: inline-block; background: #3498db; color: #fff; padding: 4px 10px; border-radius: 12px; margin: 4px 4px; font-size: 13px; }
    .back { margin-bottom: 20px; display: inline-block; }
    footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ecf0f1; color: #95a5a6; font-size: 12px; text-align: center; }
  `;
}

/** 通用页面外壳 */
function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${blogCss()}</style>
</head>
<body>
  <header><h1><a href="/" style="color:inherit">我的博客</a></h1><div class="subtitle">使用 TypeScript 构建的静态博客</div></header>
  ${body}
  <footer>Powered by Demo 46 Markdown 博客生成器</footer>
</body>
</html>`;
}

/** 首页 */
function renderIndex(posts: Post[]): string {
  const tagsHtml = (p: Post) => p.frontmatter.tags.length ? ' · ' + p.frontmatter.tags.map((t) => `<a class="tag" href="/tags/${slugify(t)}.html">${escapeHtml(t)}</a>`).join('') : '';
  const items = posts.map((p) => `<li><h2><a href="/posts/${p.slug}.html">${escapeHtml(p.frontmatter.title)}</a></h2><div class="post-meta">${formatDate(p.frontmatter.date)}${tagsHtml(p)}</div>${p.frontmatter.description ? `<p>${escapeHtml(p.frontmatter.description)}</p>` : ''}</li>`).join('');
  return pageShell('首页', `<ul class="post-list">${items}</ul>`);
}

/** 文章页 */
function renderPost(p: Post): string {
  const tagsHtml = p.frontmatter.tags.length ? ' · ' + p.frontmatter.tags.map((t) => `<a class="tag" href="/tags/${slugify(t)}.html">${escapeHtml(t)}</a>`).join('') : '';
  const body = `<article><a class="back" href="/">&larr; 返回首页</a><h1>${escapeHtml(p.frontmatter.title)}</h1><div class="post-meta">${formatDate(p.frontmatter.date)}${tagsHtml}</div>${p.html}</article>`;
  return pageShell(p.frontmatter.title, body);
}

/** 标签页 */
function renderTag(tag: string, posts: Post[]): string {
  const items = posts.map((p) => `<li><a href="/posts/${p.slug}.html">${escapeHtml(p.frontmatter.title)}</a> <span class="post-meta">- ${formatDate(p.frontmatter.date)}</span></li>`).join('');
  return pageShell(`标签: ${tag}`, `<h2>标签: ${escapeHtml(tag)}</h2><ul class="post-list">${items}</ul>`);
}

/** RSS feed */
function renderRss(posts: Post[]): string {
  const items = posts
    .map(
      (p) => `    <item>
      <title>${escapeXml(p.frontmatter.title)}</title>
      <link>http://localhost/posts/${p.slug}.html</link>
      <guid>http://localhost/posts/${p.slug}.html</guid>
      <pubDate>${new Date(p.frontmatter.date).toUTCString()}</pubDate>
      <description>${escapeXml(p.frontmatter.description ?? '')}</description>
    </item>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>我的博客</title>
    <link>http://localhost</link>
    <description>TypeScript 静态博客</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/** 构建站点 */
function buildSite(opts: BuildOptions): number {
  const posts = loadPosts(opts.src);
  if (posts.length === 0) {
    Logger.warn('没有找到任何 .md 文件');
  }

  // 准备目录
  const postsDir = path.join(opts.outDir, 'posts');
  const tagsDir = path.join(opts.outDir, 'tags');
  if (!fs.existsSync(opts.outDir)) fs.mkdirSync(opts.outDir, { recursive: true });
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });
  if (!fs.existsSync(tagsDir)) fs.mkdirSync(tagsDir, { recursive: true });

  // 首页
  fs.writeFileSync(path.join(opts.outDir, 'index.html'), renderIndex(posts), 'utf8');
  Logger.info(`生成首页 (${posts.length} 篇文章)`);

  // 文章页
  for (const p of posts) {
    fs.writeFileSync(path.join(postsDir, `${p.slug}.html`), renderPost(p), 'utf8');
  }
  Logger.info(`生成 ${posts.length} 篇文章页`);

  // 标签页 (按标签聚合)
  const tagMap: Record<string, Post[]> = {};
  for (const p of posts) {
    for (const t of p.frontmatter.tags) {
      const key = slugify(t);
      if (!tagMap[key]) tagMap[key] = [];
      tagMap[key].push(p);
    }
  }
  for (const [key, list] of Object.entries(tagMap)) {
    fs.writeFileSync(path.join(tagsDir, `${key}.html`), renderTag(list[0].frontmatter.tags.find((t) => slugify(t) === key) ?? key, list), 'utf8');
  }
  Logger.info(`生成 ${Object.keys(tagMap).length} 个标签页`);

  // RSS
  fs.writeFileSync(path.join(opts.outDir, 'rss.xml'), renderRss(posts), 'utf8');
  Logger.info('生成 RSS feed (rss.xml)');

  // CSS (内联到模板中，无需单独文件)
  return posts.length;
}

/** 本地预览服务器 (含 watch) */
function serveSite(opts: ServeOptions): void {
  const outDir = path.resolve(opts.src, '..', '.blog-preview');
  // 每次启动重新构建
  buildSite({ src: opts.src, outDir });

  // 监听源目录变化
  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    fs.watch(opts.src, { recursive: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        Logger.warn(`检测到 ${filename} 变化，重新构建...`);
        buildSite({ src: opts.src, outDir });
      }, 300);
    });
  } catch (err) {
    Logger.warn('无法监听目录变更: ' + (err instanceof Error ? err.message : String(err)));
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const urlObj = new URL(url, `http://localhost:${opts.port}`);
    let pathname = decodeURIComponent(urlObj.pathname);
    if (pathname === '/') pathname = '/index.html';

    const filePath = path.join(outDir, pathname);
    // 路径安全
    if (!filePath.startsWith(outDir)) {
      res.writeHead(403);
      res.end('禁止访问');
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('未找到: ' + pathname);
      return;
    }
    const mime = getMime(path.extname(filePath));
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(buf);
  });

  server.listen(opts.port, () => {
    Logger.info(`博客预览: http://localhost:${opts.port}`);
    Logger.info(`预览输出目录: ${outDir}`);
    Logger.info('源文件变更将自动重建');
  });

  process.on('SIGINT', () => {
    Logger.warn('关闭预览服务器...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

function getMime(ext: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** 创建新文章模板 */
function createNewPost(opts: NewPostOptions): void {
  if (!fs.existsSync(opts.src)) {
    fs.mkdirSync(opts.src, { recursive: true });
  }
  const slug = slugify(opts.title);
  const date = new Date().toISOString();
  const filename = `${date.slice(0, 10)}-${slug}.md`;
  const filePath = path.join(opts.src, filename);
  const content = `---
title: "${opts.title}"
date: ${date}
tags: []
description: 在此填写简短描述
---

# ${opts.title}

在这里开始写正文。

## 二级标题

- 列表项 1
- 列表项 2

\`\`\`typescript
console.log("Hello, world");
\`\`\`

> 这是一段引用。

[一个链接](https://example.com)
`;
  fs.writeFileSync(filePath, content, 'utf8');
  Logger.info(`已创建新文章: ${filePath}`);
}

/** 主函数 */
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }

  switch (parsed.command) {
    case 'build': {
      const src = parsed.positional[0] ?? parsed.flags.src ?? process.cwd();
      const outDir = parsed.flags.o ?? parsed.flags.out ?? path.resolve(process.cwd(), 'dist-blog');
      if (!fs.existsSync(src)) {
        Logger.error(`源目录不存在: ${src}`);
        process.exit(1);
      }
      const count = buildSite({ src: path.resolve(src), outDir: path.resolve(outDir) });
      Logger.info(`构建完成，共 ${count} 篇文章，输出到 ${path.resolve(outDir)}`);
      break;
    }
    case 'serve': {
      const src = parsed.positional[0] ?? parsed.flags.src ?? process.cwd();
      const port = parseInt(parsed.flags.p ?? parsed.flags.port ?? '4000', 10);
      if (!fs.existsSync(src)) {
        Logger.error(`源目录不存在: ${src}`);
        process.exit(1);
      }
      serveSite({ src: path.resolve(src), port });
      break;
    }
    case 'new': {
      const title = parsed.positional.join(' ') || parsed.flags.title || '未命名文章';
      const src = parsed.flags.s ?? parsed.flags.src ?? process.cwd();
      createNewPost({ title, src: path.resolve(src) });
      break;
    }
    default:
      printHelp();
      process.exit(1);
  }
}

main();
