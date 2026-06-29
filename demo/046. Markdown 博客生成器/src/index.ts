#!/usr/bin/env node
/**
 * 46. Markdown 博客生成器 (Enhanced with advanced TypeScript features)
 * 将 .md (含 YAML frontmatter: title/date/tags) 转换为静态 HTML 博客。
 *   - 首页 / 单篇文章页 / 标签页 / RSS feed / 内置 CSS 样式
 *   - 命令: build / serve / new  (仅使用 Node.js 内置模块)
 * Markdown 支持: 标题/粗体/斜体/行内代码/代码块/列表/链接/引用。
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { URL } from "url";

/* 1. 枚举: 字符串枚举与普通枚举 */
enum CliCommand {
  Build = "build",
  Serve = "serve",
  New = "new",
}

enum BuildPhase {
  Init,
  LoadPosts,
  RenderIndex,
  RenderPosts,
  RenderTags,
  RenderRss,
  Done,
}

enum ContentType {
  Html = "text/html; charset=utf-8",
  Css = "text/css; charset=utf-8",
  Js = "application/javascript; charset=utf-8",
  Json = "application/json; charset=utf-8",
  Xml = "application/xml; charset=utf-8",
  Png = "image/png",
  Jpeg = "image/jpeg",
  Svg = "image/svg+xml",
  OctetStream = "application/octet-stream",
}

enum MarkdownBlockKind {
  Heading = "heading",
  Paragraph = "paragraph",
  Code = "code",
  UnorderedList = "ul",
  OrderedList = "ol",
  ListItem = "li",
  Blockquote = "blockquote",
  Hr = "hr",
}

/* 2. 模板字面量类型 / 条件类型 / 映射类型 */
type RoutePath =
  `/` | `/posts/${string}.html` | `/tags/${string}.html` | `/rss.xml`;
type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type IsString<T> = T extends string ? true : false;
type NonEmptyArray<T> = [T, ...T[]];
type FrontmatterKey = "title" | "date" | "tags" | "description";
type RequiredFrontmatter = Pick<PostFrontmatter, "title" | "date" | "tags">;
type OptionalFrontmatter = Partial<
  Omit<PostFrontmatter, "title" | "date" | "tags">
>;

/* 3. 接口 (含可选 / readonly / 索引签名) */
interface PostFrontmatter {
  readonly title: string;
  date: string;
  tags: readonly string[];
  description?: string;
  [key: string]: unknown;
}

interface Post {
  readonly slug: string;
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
interface ParsedArgs {
  command: CliCommand | "";
  positional: string[];
  flags: Record<string, string>;
  help: boolean;
}
interface MimeRegistry {
  [ext: string]: ContentType;
}

/* 4. 判别联合 (Markdown AST 节点) */
interface HeadingNode {
  kind: MarkdownBlockKind.Heading;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}
interface ParagraphNode {
  kind: MarkdownBlockKind.Paragraph;
  text: string;
}
interface CodeNode {
  kind: MarkdownBlockKind.Code;
  lang: string;
  code: string;
}
interface ListNode {
  kind: MarkdownBlockKind.UnorderedList | MarkdownBlockKind.OrderedList;
  ordered: boolean;
  items: readonly string[];
}
interface BlockquoteNode {
  kind: MarkdownBlockKind.Blockquote;
  lines: readonly string[];
}
interface HrNode {
  kind: MarkdownBlockKind.Hr;
}
type MarkdownNode =
  HeadingNode | ParagraphNode | CodeNode | ListNode | BlockquoteNode | HrNode;

/* 5. 自定义错误类层次 (含 code 属性) */
abstract class BlogError extends Error {
  abstract readonly code: string;
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
class FrontmatterError extends BlogError {
  readonly code = "BLOG_FRONTMATTER";
}
class RenderError extends BlogError {
  readonly code = "BLOG_RENDER";
}
class FileNotFoundError extends BlogError {
  readonly code = "BLOG_FILE_NOT_FOUND";
}
class RouteError extends BlogError {
  readonly code = "BLOG_ROUTE";
}

/* 6. Symbol 唯一键 / as const 断言 */
const POST_COLLECTION = Symbol("PostCollection");
const RENDER_META = Symbol("RenderMeta");
const DEFAULT_OPTIONS = {
  port: 4000,
  outDirName: "dist-blog",
  previewDirName: ".blog-preview",
  debounceMs: 300,
} as const;

/* 7. 类型守卫 */
function isHeadingNode(n: MarkdownNode): n is HeadingNode {
  return n.kind === MarkdownBlockKind.Heading;
}
function isCodeNode(n: MarkdownNode): n is CodeNode {
  return n.kind === MarkdownBlockKind.Code;
}
function isListNode(n: MarkdownNode): n is ListNode {
  return (
    n.kind === MarkdownBlockKind.UnorderedList ||
    n.kind === MarkdownBlockKind.OrderedList
  );
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/* 8. 泛型集合类 (带约束) + 迭代器 / 生成器 */
interface Identifiable {
  readonly slug: string;
}

class Collection<T extends Identifiable> implements Iterable<T> {
  private readonly items = new Map<string, T>();
  private order: readonly string[] = [];

  add(item: T): void {
    if (!this.items.has(item.slug)) {
      this.order = [...this.order, item.slug];
    }
    this.items.set(item.slug, item);
  }
  get(slug: string): T | undefined {
    return this.items.get(slug);
  }
  all(): T[] {
    return this.order.map((s) => this.items.get(s)!);
  }
  get size(): number {
    return this.items.size;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const slug of this.order) yield this.items.get(slug)!;
  }

  *byTag(tag: string, tagOf: (t: T) => readonly string[]): Generator<T> {
    for (const item of this) {
      if (tagOf(item).some((tg) => slugify(tg) === slugify(tag))) yield item;
    }
  }
}

class PostCollection extends Collection<Post> {
  [POST_COLLECTION] = true;
  [RENDER_META]: string = "demo46";

  sortedByDateDesc(): Post[] {
    return this.all().sort((a, b) =>
      b.frontmatter.date.localeCompare(a.frontmatter.date),
    );
  }

  *tags(): Generator<string> {
    const seen = new Set<string>();
    for (const p of this) {
      for (const t of p.frontmatter.tags) {
        const key = slugify(t);
        if (!seen.has(key)) {
          seen.add(key);
          yield t;
        }
      }
    }
  }
}

/* 9. 抽象渲染器类层次 */
abstract class AbstractRenderer<TInput, TOutput> {
  constructor(protected readonly meta: Record<string, string> = {}) {}
  abstract render(input: TInput): TOutput;
  protected abstract header(): string;
  protected abstract footer(): string;
  get metadata(): Readonly<Record<string, string>> {
    return Object.freeze({ ...this.meta });
  }
  set metadata(_v: Readonly<Record<string, string>>) {
    /* immutable, no-op */
  }
}

class HtmlRenderer extends AbstractRenderer<Post, string> {
  protected header(): string {
    return "";
  }
  protected footer(): string {
    return "";
  }
  render(p: Post): string {
    return renderPost(p);
  }
}

class RssRenderer extends AbstractRenderer<readonly Post[], string> {
  protected header(): string {
    return "";
  }
  protected footer(): string {
    return "";
  }
  render(posts: readonly Post[]): string {
    return renderRss(posts);
  }
}

/* 10. 函数重载 */
function resolveRoute(p: "/"): { kind: "index" };
function resolveRoute(p: `/posts/${string}.html`): {
  kind: "post";
  slug: string;
};
function resolveRoute(p: `/tags/${string}.html`): { kind: "tag"; tag: string };
function resolveRoute(p: "/rss.xml"): { kind: "rss" };
function resolveRoute(p: string): { kind: "unknown" };
function resolveRoute(p: string): {
  kind: string;
  slug?: string;
  tag?: string;
} {
  if (p === "/") return { kind: "index" };
  if (p === "/rss.xml") return { kind: "rss" };
  const postMatch = /^\/posts\/(.+)\.html$/.exec(p);
  if (postMatch) return { kind: "post", slug: postMatch[1] };
  const tagMatch = /^\/tags\/(.+)\.html$/.exec(p);
  if (tagMatch) return { kind: "tag", tag: tagMatch[1] };
  return { kind: "unknown" };
}

function firstOf<T>(
  arr: readonly T[],
  predicate: (x: T) => boolean,
): T | undefined;
function firstOf<T>(
  arr: readonly T[],
  predicate: (x: T) => boolean,
  fallback: T,
): T;
function firstOf<T>(
  arr: readonly T[],
  predicate: (x: T) => boolean,
  fallback?: T,
): T | undefined {
  const found = arr.find(predicate);
  return found !== undefined ? found : fallback;
}

/* 11. Logger (单例风格对象 + satisfies) */
type LogLevel = "info" | "warn" | "error";
interface LoggerShape {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  level: LogLevel;
}

const Logger = {
  level: "info" as LogLevel,
  info(msg: string): void {
    console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  },
  warn(msg: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  },
  error(msg: string): void {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  },
} satisfies LoggerShape;

/* 12. HTML/XML 转义 + 行内格式 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
function inline(text: string): string {
  let s = text;
  s = s.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt, url) =>
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`,
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, t, url) => `<a href="${escapeHtml(url)}">${escapeHtml(t)}</a>`,
  );
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s;
}

/* 13. Markdown 解析 (生成器) -> AST -> HTML */
function* tokenize(md: string): Generator<MarkdownNode> {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      yield { kind: MarkdownBlockKind.Code, lang, code: codeLines.join("\n") };
      continue;
    }
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      yield {
        kind: MarkdownBlockKind.Heading,
        level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: h[2],
      };
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      yield { kind: MarkdownBlockKind.Blockquote, lines: quoteLines };
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      yield { kind: MarkdownBlockKind.Hr };
      i++;
      continue;
    }
    const olItems: string[] = [];
    while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
      olItems.push(lines[i].replace(/^\d+\.\s+/, ""));
      i++;
    }
    if (olItems.length) {
      yield {
        kind: MarkdownBlockKind.OrderedList,
        ordered: true,
        items: olItems,
      };
      continue;
    }
    const ulItems: string[] = [];
    while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
      ulItems.push(lines[i].replace(/^[-*+]\s+/, ""));
      i++;
    }
    if (ulItems.length) {
      yield {
        kind: MarkdownBlockKind.UnorderedList,
        ordered: false,
        items: ulItems,
      };
      continue;
    }
    yield { kind: MarkdownBlockKind.Paragraph, text: line };
    i++;
  }
}

function astToHtml(nodes: readonly MarkdownNode[]): string {
  const out: string[] = [];
  for (const n of nodes) {
    if (isHeadingNode(n)) {
      out.push(`<h${n.level}>${inline(n.text)}</h${n.level}>`);
    } else if (isCodeNode(n)) {
      out.push(
        `<pre><code class="language-${escapeHtml(n.lang)}">${escapeHtml(n.code)}</code></pre>`,
      );
    } else if (n.kind === MarkdownBlockKind.Paragraph) {
      out.push(`<p>${inline(n.text)}</p>`);
    } else if (n.kind === MarkdownBlockKind.Blockquote) {
      out.push(
        `<blockquote>${n.lines.map((l) => `<p>${inline(l)}</p>`).join("")}</blockquote>`,
      );
    } else if (n.kind === MarkdownBlockKind.Hr) {
      out.push("<hr />");
    } else if (isListNode(n)) {
      const tag = n.ordered ? "ol" : "ul";
      out.push(
        `<${tag}>${n.items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`,
      );
    }
  }
  return out.join("\n");
}

function markdownToHtml(md: string): string {
  return astToHtml([...tokenize(md)]);
}
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "post-" + Date.now()
  );
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

/* 14. Frontmatter 解析 (类型安全) */
function parseFrontmatter(raw: string): {
  frontmatter: PostFrontmatter;
  body: string;
} {
  const fm: Mutable<RequiredFrontmatter> & OptionalFrontmatter = {
    title: "未命名",
    date: new Date().toISOString(),
    tags: [] as string[],
  };
  let body = raw;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    body = match[2];
    for (const line of match[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1] as FrontmatterKey;
      const val = m[2].trim();
      if (key === "tags") {
        const inner = val.replace(/^\[/, "").replace(/\]$/, "").trim();
        if (inner) {
          const tags = inner
            .split(",")
            .map((s) => s.trim().replace(/^"|"$/g, ""))
            .filter(Boolean);
          if (isStringArray(tags)) fm.tags = tags;
        }
      } else if (key === "title" || key === "description") {
        fm[key] = val.replace(/^"|"$/g, "");
      } else if (key === "date") {
        fm.date = val.replace(/^"|"$/g, "");
      }
    }
  }
  return { frontmatter: { ...fm, tags: Object.freeze([...fm.tags]) }, body };
}

/* 15. 命令行解析 / 帮助 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "",
    positional: [],
    flags: {},
    help: false,
  };
  const knownCommands = Object.values(CliCommand) as readonly string[];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      result.help = true;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      const key = a.replace(/^--?/, "");
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        result.flags[key] = next;
        i += 2;
      } else {
        result.flags[key] = "true";
        i++;
      }
      continue;
    }
    if (!result.command && knownCommands.includes(a))
      result.command = a as CliCommand;
    else result.positional.push(a);
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

选项: -o/--out <dir>  -p/--port <n>  -s/--src <dir>  -h/--help
Frontmatter: ---  title / date(ISO) / tags:[a,b] / description  ---
`);
}

/* 16. 加载文章到 PostCollection */
function loadPosts(src: string): PostCollection {
  const collection = new PostCollection();
  if (!fs.existsSync(src))
    throw new FileNotFoundError(`源目录不存在: ${src}`, { src });
  const entries = fs.readdirSync(src).filter((f) => f.endsWith(".md"));
  for (const entry of entries) {
    const fullPath = path.join(src, entry);
    let raw: string;
    try {
      raw = fs.readFileSync(fullPath, "utf8");
    } catch {
      throw new FileNotFoundError(`无法读取文件: ${fullPath}`, {
        path: fullPath,
      });
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    const slug = slugify(frontmatter.title) || entry.replace(/\.md$/, "");
    collection.add({
      slug,
      frontmatter,
      markdown: body,
      html: markdownToHtml(body),
      sourcePath: fullPath,
    });
  }
  return collection;
}

/* 17. 页面渲染 */
function blogCss(): string {
  return `*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#2c3e50;line-height:1.7;background:#fafbfc}a{color:#3498db;text-decoration:none}a:hover{text-decoration:underline}header{padding:20px 0;border-bottom:2px solid #3498db;margin-bottom:24px}header h1{margin:0;font-size:28px}header .subtitle{color:#7f8c8d;font-size:14px;margin-top:4px}.post-list{list-style:none;padding:0}.post-list li{padding:16px 0;border-bottom:1px solid #ecf0f1}.post-list h2{margin:0 0 4px 0;font-size:20px}.post-meta{color:#95a5a6;font-size:13px}.tag{display:inline-block;background:#ecf0f1;color:#34495e;padding:2px 8px;border-radius:10px;font-size:12px;margin-right:4px}article h1{font-size:28px;margin-bottom:4px}article h2{font-size:22px;margin-top:28px}article h3{font-size:18px;margin-top:22px}article pre{background:#2c3e50;color:#ecf0f1;padding:14px;border-radius:6px;overflow-x:auto}article code{background:#ecf0f1;padding:2px 5px;border-radius:3px;font-family:Consolas,Monaco,monospace}article pre code{background:transparent;padding:0}article blockquote{border-left:4px solid #3498db;padding:4px 16px;margin:16px 0;color:#555;background:#ecf0f1}article img{max-width:100%;border-radius:6px}article hr{border:none;border-top:1px solid #ecf0f1;margin:24px 0}.tags-cloud a{display:inline-block;background:#3498db;color:#fff;padding:4px 10px;border-radius:12px;margin:4px 4px;font-size:13px}.back{margin-bottom:20px;display:inline-block}footer{margin-top:40px;padding-top:16px;border-top:1px solid #ecf0f1;color:#95a5a6;font-size:12px;text-align:center}`;
}

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

function tagsInlineHtml(tags: readonly string[]): string {
  return tags.length
    ? " · " +
        tags
          .map(
            (t) =>
              `<a class="tag" href="/tags/${slugify(t)}.html">${escapeHtml(t)}</a>`,
          )
          .join("")
    : "";
}

function renderIndex(posts: readonly Post[]): string {
  const items = posts
    .map(
      (p) =>
        `<li><h2><a href="/posts/${p.slug}.html">${escapeHtml(p.frontmatter.title)}</a></h2>` +
        `<div class="post-meta">${formatDate(p.frontmatter.date)}${tagsInlineHtml(p.frontmatter.tags)}</div>` +
        `${p.frontmatter.description ? `<p>${escapeHtml(p.frontmatter.description)}</p>` : ""}</li>`,
    )
    .join("");
  return pageShell("首页", `<ul class="post-list">${items}</ul>`);
}

function renderPost(p: Post): string {
  const body =
    `<article><a class="back" href="/">&larr; 返回首页</a>` +
    `<h1>${escapeHtml(p.frontmatter.title)}</h1>` +
    `<div class="post-meta">${formatDate(p.frontmatter.date)}${tagsInlineHtml(p.frontmatter.tags)}</div>` +
    `${p.html}</article>`;
  return pageShell(p.frontmatter.title, body);
}

function renderTag(tag: string, posts: readonly Post[]): string {
  const items = posts
    .map(
      (p) =>
        `<li><a href="/posts/${p.slug}.html">${escapeHtml(p.frontmatter.title)}</a> <span class="post-meta">- ${formatDate(p.frontmatter.date)}</span></li>`,
    )
    .join("");
  return pageShell(
    `标签: ${tag}`,
    `<h2>标签: ${escapeHtml(tag)}</h2><ul class="post-list">${items}</ul>`,
  );
}

function renderRss(posts: readonly Post[]): string {
  const items = posts
    .map(
      (p) => `    <item>
      <title>${escapeXml(p.frontmatter.title)}</title>
      <link>http://localhost/posts/${p.slug}.html</link>
      <guid>http://localhost/posts/${p.slug}.html</guid>
      <pubDate>${new Date(p.frontmatter.date).toUTCString()}</pubDate>
      <description>${escapeXml(p.frontmatter.description ?? "")}</description>
    </item>`,
    )
    .join("\n");
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

/* 18. 构建站点 (使用 BuildPhase 枚举) */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildSite(opts: BuildOptions): number {
  let phase: BuildPhase = BuildPhase.Init;
  try {
    phase = BuildPhase.LoadPosts;
    const collection = loadPosts(opts.src);
    const posts = collection.sortedByDateDesc();
    if (posts.length === 0) Logger.warn("没有找到任何 .md 文件");

    const postsDir = path.join(opts.outDir, "posts");
    const tagsDir = path.join(opts.outDir, "tags");
    ensureDir(opts.outDir);
    ensureDir(postsDir);
    ensureDir(tagsDir);

    phase = BuildPhase.RenderIndex;
    fs.writeFileSync(
      path.join(opts.outDir, "index.html"),
      renderIndex(posts),
      "utf8",
    );
    Logger.info(`生成首页 (${posts.length} 篇文章)`);

    phase = BuildPhase.RenderPosts;
    const htmlRenderer = new HtmlRenderer({ engine: "demo46" });
    for (const p of posts)
      fs.writeFileSync(
        path.join(postsDir, `${p.slug}.html`),
        htmlRenderer.render(p),
        "utf8",
      );
    Logger.info(`生成 ${posts.length} 篇文章页`);

    phase = BuildPhase.RenderTags;
    const tagMap: Map<string, { tag: string; posts: Post[] }> = new Map();
    for (const t of collection.tags()) {
      const key = slugify(t);
      tagMap.set(key, {
        tag: t,
        posts: [...collection.byTag(t, (p) => p.frontmatter.tags)],
      });
    }
    for (const [, entry] of tagMap) {
      fs.writeFileSync(
        path.join(tagsDir, `${slugify(entry.tag)}.html`),
        renderTag(entry.tag, entry.posts),
        "utf8",
      );
    }
    Logger.info(`生成 ${tagMap.size} 个标签页`);

    phase = BuildPhase.RenderRss;
    const rssRenderer = new RssRenderer({ version: "2.0" });
    fs.writeFileSync(
      path.join(opts.outDir, "rss.xml"),
      rssRenderer.render(posts),
      "utf8",
    );
    Logger.info("生成 RSS feed (rss.xml)");

    phase = BuildPhase.Done;
    return posts.length;
  } catch (e) {
    if (e instanceof BlogError)
      Logger.error(
        `[${e.code}] 构建失败 (phase=${BuildPhase[phase]}): ${e.message}`,
      );
    else
      Logger.error(
        `构建失败 (phase=${BuildPhase[phase]}): ${e instanceof Error ? e.message : String(e)}`,
      );
    throw e;
  }
}

/* 19. 本地预览服务器 (含 watch) + getMime 用枚举 */
const MIME_REGISTRY: MimeRegistry = {
  ".html": ContentType.Html,
  ".css": ContentType.Css,
  ".js": ContentType.Js,
  ".json": ContentType.Json,
  ".xml": ContentType.Xml,
  ".png": ContentType.Png,
  ".jpg": ContentType.Jpeg,
  ".svg": ContentType.Svg,
};
function getMime(ext: string): ContentType {
  return MIME_REGISTRY[ext.toLowerCase()] ?? ContentType.OctetStream;
}

function serveSite(opts: ServeOptions): void {
  const outDir = path.resolve(opts.src, "..", DEFAULT_OPTIONS.previewDirName);
  buildSite({ src: opts.src, outDir });

  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    fs.watch(opts.src, { recursive: false }, (_eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        Logger.warn(`检测到 ${filename} 变化，重新构建...`);
        buildSite({ src: opts.src, outDir });
      }, DEFAULT_OPTIONS.debounceMs);
    });
  } catch (err) {
    Logger.warn(
      "无法监听目录变更: " + (err instanceof Error ? err.message : String(err)),
    );
  }

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
    let pathname = decodeURIComponent(urlObj.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.join(outDir, pathname);
    if (!filePath.startsWith(outDir)) {
      res.writeHead(403, { "Content-Type": ContentType.Html });
      res.end("禁止访问");
      return;
    }
    const route = resolveRoute(pathname);
    if (route.kind === "unknown" && !fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": ContentType.Html });
      res.end("未找到: " + pathname);
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": ContentType.Html });
      res.end("未找到: " + pathname);
      return;
    }
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": getMime(path.extname(filePath)) });
    res.end(buf);
  });

  server.listen(opts.port, () => {
    Logger.info(`博客预览: http://localhost:${opts.port}`);
    Logger.info(`预览输出目录: ${outDir}`);
    Logger.info("源文件变更将自动重建");
  });
  process.on("SIGINT", () => {
    Logger.warn("关闭预览服务器...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

/* 20. 创建新文章模板 */
function createNewPost(opts: NewPostOptions): void {
  if (!fs.existsSync(opts.src)) fs.mkdirSync(opts.src, { recursive: true });
  const slug = slugify(opts.title);
  const date = new Date().toISOString();
  const filePath = path.join(opts.src, `${date.slice(0, 10)}-${slug}.md`);
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
  fs.writeFileSync(filePath, content, "utf8");
  Logger.info(`已创建新文章: ${filePath}`);
}

/* 21. 主函数 */
function main(): void {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }
  try {
    switch (parsed.command) {
      case CliCommand.Build: {
        const src = parsed.positional[0] ?? parsed.flags.src ?? process.cwd();
        const outDir =
          parsed.flags.o ??
          parsed.flags.out ??
          path.resolve(process.cwd(), DEFAULT_OPTIONS.outDirName);
        if (!fs.existsSync(src))
          throw new FileNotFoundError(`源目录不存在: ${src}`, { src });
        const count = buildSite({
          src: path.resolve(src),
          outDir: path.resolve(outDir),
        });
        Logger.info(
          `构建完成，共 ${count} 篇文章，输出到 ${path.resolve(outDir)}`,
        );
        break;
      }
      case CliCommand.Serve: {
        const src = parsed.positional[0] ?? parsed.flags.src ?? process.cwd();
        const port = parseInt(
          parsed.flags.p ?? parsed.flags.port ?? String(DEFAULT_OPTIONS.port),
          10,
        );
        if (!fs.existsSync(src))
          throw new FileNotFoundError(`源目录不存在: ${src}`, { src });
        serveSite({ src: path.resolve(src), port });
        break;
      }
      case CliCommand.New: {
        const title =
          parsed.positional.join(" ") || parsed.flags.title || "未命名文章";
        const src = parsed.flags.s ?? parsed.flags.src ?? process.cwd();
        createNewPost({ title, src: path.resolve(src) });
        break;
      }
      default:
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof BlogError) Logger.error(`[${e.code}] ${e.message}`);
    else Logger.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

main();
