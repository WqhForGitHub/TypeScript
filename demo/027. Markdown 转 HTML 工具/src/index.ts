#!/usr/bin/env node
/**
 * Markdown 转 HTML 工具 (Markdown to HTML Converter) — Enhanced Edition
 *
 * AST-based pipeline: tokenize (generator) -> parse -> render (visitor).
 * Supports: headings+TOC, bold, italic, strikethrough, highlight, inline code,
 * fenced code blocks w/ basic syntax highlighting (JS/TS/Python), links, images,
 * nested ordered/unordered lists, task lists, blockquotes, GFM tables, footnotes,
 * dividers, inline HTML passthrough, emoji shortcodes, multiple CSS themes.
 *
 * Commands:
 *   convert <mdfile> [-o htmlfile] [--theme dark|light|github] [--toc]
 *   batch   <dir>    [-o outdir]   [--theme ...]
 *   watch   <mdfile> [-o htmlfile] [--theme ...]
 *   help
 */

import * as fs from "fs";
import * as path from "path";

// 1. Enums
enum MarkdownType {
  CommonMark = "commonmark",
  GFM = "gfm",
}
enum BlockType {
  Heading = "heading",
  Paragraph = "paragraph",
  CodeBlock = "code",
  List = "list",
  Quote = "quote",
  Hr = "hr",
  Table = "table",
  TaskList = "tasklist",
  Footnote = "footnote",
  Html = "html",
}
enum InlineType {
  Text = "text",
  Bold = "bold",
  Italic = "italic",
  Code = "code",
  Link = "link",
  Image = "image",
  Strike = "strike",
  Highlight = "highlight",
  Emoji = "emoji",
  Html = "html",
}
enum ListType {
  Ordered = "ol",
  Unordered = "ul",
}
enum OutputFormat {
  Full = "full",
  Fragment = "fragment",
}
enum WatchEvent {
  Change = "change",
  Error = "error",
}

// 2. Custom error hierarchy
abstract class MarkdownError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
class ParseError extends MarkdownError {
  constructor(
    msg: string,
    public readonly line?: number,
  ) {
    super(msg, "PARSE");
  }
}
class RenderError extends MarkdownError {
  constructor(
    msg: string,
    public readonly nodeType?: string,
  ) {
    super(msg, "RENDER");
  }
}
class FileError extends MarkdownError {
  constructor(
    msg: string,
    public readonly path: string,
  ) {
    super(msg, "FILE");
  }
}

// 3. AST: discriminated unions, generics, tuples, template-literal & conditional types
interface NodeBase<T extends BlockType | InlineType> {
  readonly type: T;
  raw: string;
}

interface HeadingNode extends NodeBase<BlockType.Heading> {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  id: string;
  children: InlineNode[];
}
interface ParagraphNode extends NodeBase<BlockType.Paragraph> {
  children: InlineNode[];
}
interface CodeBlockNode extends NodeBase<BlockType.CodeBlock> {
  lang: string;
  code: string;
}
interface ListItem {
  text: string;
  checked: boolean | null;
  sub?: ListNode;
}
interface ListNode extends NodeBase<BlockType.List> {
  listType: ListType;
  items: ListItem[];
}
interface QuoteNode extends NodeBase<BlockType.Quote> {
  children: BlockNode[];
}
interface HrNode extends NodeBase<BlockType.Hr> {}
interface TableNode extends NodeBase<BlockType.Table> {
  headers: readonly string[];
  aligns: readonly ("left" | "center" | "right" | null)[];
  rows: readonly (readonly string[])[];
}
interface TaskListNode extends NodeBase<BlockType.TaskList> {
  items: readonly { readonly text: string; readonly checked: boolean }[];
}
interface FootnoteNode extends NodeBase<BlockType.Footnote> {
  id: string;
  children: InlineNode[];
}
interface HtmlBlockNode extends NodeBase<BlockType.Html> {
  html: string;
}

type BlockNode =
  | HeadingNode
  | ParagraphNode
  | CodeBlockNode
  | ListNode
  | QuoteNode
  | HrNode
  | TableNode
  | TaskListNode
  | FootnoteNode
  | HtmlBlockNode;

interface InlineText {
  type: InlineType.Text;
  text: string;
}
interface InlineBold {
  type: InlineType.Bold;
  children: InlineNode[];
}
interface InlineItalic {
  type: InlineType.Italic;
  children: InlineNode[];
}
interface InlineCode {
  type: InlineType.Code;
  code: string;
}
interface InlineLink {
  type: InlineType.Link;
  text: string;
  url: string;
  title?: string;
}
interface InlineImage {
  type: InlineType.Image;
  alt: string;
  url: string;
}
interface InlineStrike {
  type: InlineType.Strike;
  children: InlineNode[];
}
interface InlineHighlight {
  type: InlineType.Highlight;
  children: InlineNode[];
}
interface InlineEmoji {
  type: InlineType.Emoji;
  name: string;
  char: string;
}
interface InlineHtml {
  type: InlineType.Html;
  html: string;
}

type InlineNode =
  | InlineText
  | InlineBold
  | InlineItalic
  | InlineCode
  | InlineLink
  | InlineImage
  | InlineStrike
  | InlineHighlight
  | InlineEmoji
  | InlineHtml;

/** Generic AST node lookup: ASTNode<BlockType.Heading> => HeadingNode. */
type ASTNode<T extends BlockType | InlineType> = T extends BlockType
  ? Extract<BlockNode, { type: T }>
  : Extract<InlineNode, { type: T }>;

// Template literal / tuple / conditional type demonstrations
type HtmlTag = `<${string}>`;
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type HeadingTag = `h${HeadingLevel}`;
type HeadingTuple = readonly [level: HeadingLevel, text: string, id: string];
type AlignRow = readonly ("left" | "center" | "right" | null)[];
type NodeChildren<N> = N extends { children: infer C } ? C : never;
type IsContainer<N> = N extends { children: readonly unknown[] } ? true : false;

// 4. Mapped type & utility-type demonstrations
type BlockRenderer = {
  [K in BlockType]: (
    node: Extract<BlockNode, { type: K }>,
    ctx: RenderContext,
  ) => string;
};
type RendererContext = Pick<RenderContext, "theme" | "format">;
type InlineRenderOpts = Omit<ConvertOptions, "mdType">;
type BlockRenderFn = BlockRenderer[BlockType.Heading];
type BlockRenderRet = ReturnType<BlockRenderFn>; // string
type BlockRenderParams = Parameters<BlockRenderFn>; // [HeadingNode, RenderContext]
type Mutable<T> = { -readonly [K in keyof T]: T[K] }; // strip readonly (mapped w/ modifier)

// 5. Type guards
function isBlockType(s: string): s is BlockType {
  return (Object.values(BlockType) as readonly string[]).includes(s);
}
function isInlineType(s: string): s is InlineType {
  return (Object.values(InlineType) as readonly string[]).includes(s);
}
function isHeadingNode(n: BlockNode): n is HeadingNode {
  return n.type === BlockType.Heading;
}
function isListNode(n: BlockNode): n is ListNode {
  return n.type === BlockType.List;
}
function isQuoteNode(n: BlockNode): n is QuoteNode {
  return n.type === BlockType.Quote;
}
function isTableNode(n: BlockNode): n is TableNode {
  return n.type === BlockType.Table;
}
function isInlineContainer(
  n: InlineNode,
): n is InlineBold | InlineItalic | InlineStrike | InlineHighlight {
  return "children" in n;
}

// 6. Interfaces (optional/readonly/index signatures) & options
type ThemeName = "light" | "dark" | "github";

interface ConvertOptions {
  readonly theme?: ThemeName;
  readonly toc?: boolean;
  readonly title?: string;
  readonly mdType?: MarkdownType;
}
interface RenderContext {
  readonly theme: ThemeName;
  readonly format: OutputFormat;
  title: string;
  toc: TocEntry[];
  footnotes: FootnoteNode[];
  meta: { [key: string]: string }; // index signature
}
interface TocEntry {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}
interface Token {
  readonly type: BlockType;
  readonly lines: readonly string[];
  readonly meta: { [key: string]: string };
}
interface FootnoteRegistry {
  [id: string]: FootnoteNode | undefined;
}

// 7. Constants (as const, satisfies, Record, Readonly, Partial)
const EMOJI = {
  smile: "😄",
  laugh: "😂",
  wink: "😉",
  heart: "❤️",
  thumbsup: "👍",
  thumbsdown: "👎",
  ok: "👌",
  rocket: "🚀",
  fire: "🔥",
  star: "⭐",
  check: "✅",
  x: "❌",
  warning: "⚠️",
  info: "ℹ️",
  bug: "🐛",
  memo: "📝",
  book: "📖",
  coffee: "☕",
  tada: "🎉",
  sunny: "☀️",
  heart_eyes: "😍",
  thinking: "🤔",
  beer: "🍺",
} satisfies Readonly<Record<string, string>>;

const KEYWORDS = {
  javascript: [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "extends",
    "new",
    "import",
    "export",
    "from",
    "default",
    "async",
    "await",
    "try",
    "catch",
    "throw",
    "typeof",
    "instanceof",
    "of",
    "in",
    "this",
    "null",
    "true",
    "false",
  ],
  typescript: [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "extends",
    "implements",
    "interface",
    "type",
    "enum",
    "new",
    "import",
    "export",
    "from",
    "default",
    "async",
    "await",
    "try",
    "catch",
    "throw",
    "typeof",
    "instanceof",
    "public",
    "private",
    "protected",
    "readonly",
    "abstract",
    "namespace",
    "of",
    "in",
    "as",
    "this",
    "null",
    "true",
    "false",
    "void",
    "never",
    "unknown",
    "any",
  ],
  python: [
    "def",
    "class",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "import",
    "from",
    "as",
    "try",
    "except",
    "finally",
    "raise",
    "with",
    "lambda",
    "pass",
    "None",
    "True",
    "False",
    "and",
    "or",
    "not",
    "in",
    "is",
    "self",
    "yield",
    "global",
    "nonlocal",
  ],
} satisfies Readonly<Record<string, readonly string[]>>;

const DEFAULT_OPTS: Partial<ConvertOptions> = { theme: "light", toc: false };

const THEMES: Record<ThemeName, string> = {
  light: `body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.7;color:#333;max-width:820px;margin:2rem auto;padding:0 1rem}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.5em 0 .5em}h1{border-bottom:2px solid #eee;padding-bottom:.3em}h2{border-bottom:1px solid #eee;padding-bottom:.3em}code{background:#f5f5f5;padding:.15em .35em;border-radius:3px;font-family:Consolas,monospace;font-size:.9em}pre{background:#f5f5f5;padding:1em;border-radius:5px;overflow-x:auto}pre code{background:none;padding:0}.kw{color:#a71d5d}.str{color:#df5000}.cmt{color:#969896}.num{color:#0086b3}blockquote{border-left:4px solid #4a90d9;margin:1em 0;padding:.5em 1em;color:#555;background:#f9f9f9}a{color:#4a90d9}a:hover{text-decoration:underline}img{max-width:100%}hr{border:none;border-top:1px solid #ddd;margin:2em 0}table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:.4em .8em}th{background:#f5f5f5}.toc{background:#f9f9f9;border:1px solid #eee;padding:1em 1.5em;border-radius:5px}.footnote{font-size:.85em;color:#666}.task-list{list-style:none}mark{background:#ffe066}del{color:#999}`,
  dark: `body{background:#1e1e1e;color:#ddd;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.7;max-width:820px;margin:2rem auto;padding:0 1rem}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.5em 0 .5em}h1{border-bottom:2px solid #444;padding-bottom:.3em}h2{border-bottom:1px solid #444;padding-bottom:.3em}code{background:#2d2d2d;padding:.15em .35em;border-radius:3px;font-family:Consolas,monospace;font-size:.9em;color:#e6e6e6}pre{background:#2d2d2d;padding:1em;border-radius:5px;overflow-x:auto}.kw{color:#c586c0}.str{color:#ce9178}.cmt{color:#6a9955}.num{color:#b5cea8}blockquote{border-left:4px solid #569cd6;margin:1em 0;padding:.5em 1em;color:#aaa;background:#2a2a2a}a{color:#569cd6}img{max-width:100%}hr{border:none;border-top:1px solid #444;margin:2em 0}table{border-collapse:collapse}th,td{border:1px solid #444;padding:.4em .8em}th{background:#2d2d2d}.toc{background:#2a2a2a;border:1px solid #444;padding:1em 1.5em;border-radius:5px}.footnote{font-size:.85em;color:#999}.task-list{list-style:none}mark{background:#614a04}del{color:#777}`,
  github: `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.6;color:#24292e;max-width:820px;margin:2rem auto;padding:0 1rem}h1,h2,h3,h4,h5,h6{margin-top:24px;margin-bottom:16px;font-weight:600;line-height:1.25}h1{border-bottom:1px solid #eaecef;padding-bottom:.3em;font-size:2em}h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;font-size:1.5em}code{background:rgba(27,31,35,.05);padding:.2em .4em;border-radius:3px;font-family:SFMono-Regular,Consolas,monospace;font-size:85%}pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto}pre code{background:none;padding:0;font-size:85%}.kw{color:#d73a49}.str{color:#032f62}.cmt{color:#6a737d}.num{color:#005cc5}blockquote{border-left:4px solid #dfe2e5;margin:0 0 16px;padding:0 1em;color:#6a737d}a{color:#0366d6}img{max-width:100%}hr{border:none;border-top:1px solid #eaecef;margin:24px 0}table{border-collapse:collapse}th,td{border:1px solid #dfe2e5;padding:6px 13px}th{background:#f6f8fa;font-weight:600}.toc{background:#f6f8fa;border:1px solid #eaecef;padding:16px 24px;border-radius:6px}.footnote{font-size:.85em;color:#6a737d}.task-list{list-style:none}mark{background:#ffdf5d}del{color:#959da5}`,
};

// 8. Utility functions
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "heading"
  );
}
function extractTitle(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const m2 = md.match(/^(.+)\n[=-]+\s*$/m);
  return m2 ? m2[1].trim() : "文档";
}
function stripInlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case InlineType.Text:
          return n.text;
        case InlineType.Bold:
        case InlineType.Italic:
        case InlineType.Strike:
        case InlineType.Highlight:
          return stripInlineText(n.children);
        case InlineType.Code:
          return n.code;
        case InlineType.Link:
          return n.text;
        case InlineType.Image:
          return n.alt;
        case InlineType.Emoji:
          return n.char;
        case InlineType.Html:
          return "";
      }
    })
    .join("");
}

// 9. Inline parser (regex-driven, recursive, builds InlineNode tree)
const INLINE_RE =
  /\*\*(?<boldc>[^*]+)\*\*|\*(?<italicc>[^*]+)\*|`(?<codec>[^`]+)`|~~(?<strikec>[^~]+)~~|==(?<hc>[^=]+)==|!\[(?<imgalt>[^\]]*)\]\((?<imgurl>[^)\s]+)\)|\[\^(?<fnid>[^\]]+)\]|\[(?<linkt>[^\]]+)\]\((?<linkurl>[^)\s]+)(?:\s+"(?<linktitle>[^"]+)")?\)|:(?<emojiname>[a-z_]+):|(?<html><[^>]+>)/g;

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  // matchAll uses an internal regex clone, so recursive calls don't clobber shared lastIndex.
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index!;
    if (idx > last)
      nodes.push({ type: InlineType.Text, text: text.slice(last, idx) });
    const g = m.groups!;
    if (m[0].startsWith("**"))
      nodes.push({ type: InlineType.Bold, children: parseInline(g.boldc!) });
    else if (m[0].startsWith("*"))
      nodes.push({
        type: InlineType.Italic,
        children: parseInline(g.italicc!),
      });
    else if (m[0].startsWith("`"))
      nodes.push({ type: InlineType.Code, code: g.codec! });
    else if (m[0].startsWith("~~"))
      nodes.push({
        type: InlineType.Strike,
        children: parseInline(g.strikec!),
      });
    else if (m[0].startsWith("=="))
      nodes.push({ type: InlineType.Highlight, children: parseInline(g.hc!) });
    else if (m[0].startsWith("!["))
      nodes.push({
        type: InlineType.Image,
        alt: g.imgalt ?? "",
        url: g.imgurl!,
      });
    else if (g.fnid)
      nodes.push({
        type: InlineType.Link,
        text: `[^${g.fnid}]`,
        url: `#fn-${g.fnid}`,
      });
    else if (m[0].startsWith("["))
      nodes.push({
        type: InlineType.Link,
        text: g.linkt!,
        url: g.linkurl!,
        title: g.linktitle,
      });
    else if (m[0].startsWith(":")) {
      const name = g.emojiname!;
      const char =
        (EMOJI as Readonly<Record<string, string>>)[name] ?? `:${name}:`;
      nodes.push({ type: InlineType.Emoji, name, char });
    } else if (g.html) nodes.push({ type: InlineType.Html, html: g.html });
    last = idx + m[0].length;
  }
  if (last < text.length)
    nodes.push({ type: InlineType.Text, text: text.slice(last) });
  return nodes;
}

// 10. Basic syntax highlighting (JS/TS/Python)
function normalizeLang(lang: string): keyof typeof KEYWORDS | null {
  const l = lang.toLowerCase();
  if (l === "js" || l === "javascript") return "javascript";
  if (l === "ts" || l === "typescript") return "typescript";
  if (l === "py" || l === "python") return "python";
  return null;
}
function highlightCode(code: string, lang: string): string {
  const key = normalizeLang(lang);
  if (!key) return escapeHtml(code);
  const kwSet = new Set<string>(KEYWORDS[key]);
  const out: string[] = [];
  // comments | strings | numbers | identifiers | other
  const re =
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const [, comment, str, num, ident, other] = m;
    if (comment !== undefined)
      out.push(`<span class="cmt">${escapeHtml(comment)}</span>`);
    else if (str !== undefined)
      out.push(`<span class="str">${escapeHtml(str)}</span>`);
    else if (num !== undefined)
      out.push(`<span class="num">${escapeHtml(num)}</span>`);
    else if (ident !== undefined)
      out.push(
        kwSet.has(ident)
          ? `<span class="kw">${escapeHtml(ident)}</span>`
          : escapeHtml(ident),
      );
    else out.push(escapeHtml(other));
  }
  return out.join("");
}

// 11. Tokenizer (generator)
function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6}\s|>\s?|```|[-*+]\s|\d+\.\s|\[\^[^\]]+\]:)/.test(line) ||
    /^\s*([-*_])\1{2,}\s*$/.test(line) ||
    /^\s*<[^>]+>/.test(line)
  );
}
function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|?/, "")
    .replace(/\|?\s*$/, "")
    .split("|")
    .map((s) => s.trim());
}
function parseAligns(line: string): AlignRow {
  return line
    .replace(/^\s*\|?/, "")
    .replace(/\|?\s*$/, "")
    .split("|")
    .map((s) => {
      const t = s.trim();
      if (/^:.*:$/.test(t)) return "center" as const;
      if (t.startsWith(":")) return "left" as const;
      if (t.endsWith(":")) return "right" as const;
      return null;
    });
}
function* tokenize(md: string): Generator<Token> {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/); // fenced code
    if (fence) {
      const lang = fence[1] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      yield { type: BlockType.CodeBlock, lines: code, meta: { lang } };
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/); // heading
    if (h) {
      yield {
        type: BlockType.Heading,
        lines: [h[2]],
        meta: { level: String(h[1].length) },
      };
      i++;
      continue;
    }
    if (
      /^\s*([-*_])\1{2,}\s*$/.test(line) ||
      /^(\s*[-*_]\s*){3,}$/.test(line)
    ) {
      // hr
      yield { type: BlockType.Hr, lines: [], meta: {} };
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      // blockquote
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      yield { type: BlockType.Quote, lines: q, meta: {} };
      continue;
    }
    if (
      /\|/.test(line) &&
      i + 1 < lines.length && // GFM table
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      /\|/.test(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      const aligns = parseAligns(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        /\|/.test(lines[i]) &&
        lines[i].trim() !== ""
      ) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      yield {
        type: BlockType.Table,
        lines: [],
        meta: {
          headers: JSON.stringify(headers),
          aligns: JSON.stringify(aligns),
          rows: JSON.stringify(rows),
        },
      };
      continue;
    }
    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      // task list
      const items: { text: string; checked: boolean }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const tm = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/)!;
        items.push({ text: tm[2], checked: tm[1].toLowerCase() === "x" });
        i++;
      }
      yield {
        type: BlockType.TaskList,
        lines: [],
        meta: { items: JSON.stringify(items) },
      };
      continue;
    }
    const fn = line.match(/^\[\^([^\]]+)\]:\s+(.*)$/); // footnote def
    if (fn) {
      const text = [fn[2]];
      i++;
      while (
        i < lines.length &&
        /^\s+\S/.test(lines[i]) &&
        !isBlockStart(lines[i])
      ) {
        text.push(lines[i].trim());
        i++;
      }
      yield { type: BlockType.Footnote, lines: text, meta: { id: fn[1] } };
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      // list (nestable)
      const blockLines: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        blockLines.push(lines[i]);
        i++;
      }
      yield { type: BlockType.List, lines: blockLines, meta: {} };
      continue;
    }
    if (/^\s*<[^>]+>/.test(line)) {
      // inline HTML block
      const html: string[] = [];
      while (i < lines.length && /^\s*</.test(lines[i])) {
        html.push(lines[i]);
        i++;
      }
      yield { type: BlockType.Html, lines: html, meta: {} };
      continue;
    }
    const para: string[] = []; // paragraph
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !isBlockStart(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    yield { type: BlockType.Paragraph, lines: para, meta: {} };
  }
}

// 12. Abstract base classes & visitor protocol (Symbol)
abstract class AbstractMarkdownParser {
  abstract parse(md: string): BlockNode[];
  protected abstract parseToken(tok: Token): BlockNode;
}
abstract class AbstractHtmlRenderer {
  abstract renderBlocks(
    nodes: readonly BlockNode[],
    ctx: RenderContext,
  ): string;
  abstract renderInline(nodes: readonly InlineNode[]): string;
}
const VISIT = Symbol("MarkdownVisitor");
abstract class AbstractVisitor<T extends ASTNode<any>, R> {
  abstract [VISIT](node: T, ctx: RenderContext): R;
  visit(node: T, ctx: RenderContext): R {
    return this[VISIT](node, ctx);
  }
}

// 13. Concrete parser
function detectListType(line: string): ListType {
  return /^\s*\d+\.\s+/.test(line) ? ListType.Ordered : ListType.Unordered;
}
function parseListItems(lines: readonly string[]): ListItem[] {
  const items: ListItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const indent = m[1].length;
    const text = m[2];
    i++;
    const subLines: string[] = [];
    while (i < lines.length) {
      const sm = lines[i].match(/^(\s+)(?:[-*+]|\d+\.)\s+(.*)$/);
      if (sm && sm[1].length > indent) {
        subLines.push(lines[i]);
        i++;
      } else break;
    }
    const sub: ListNode | undefined =
      subLines.length > 0
        ? {
            type: BlockType.List,
            raw: subLines.join("\n"),
            listType: detectListType(subLines[0]),
            items: parseListItems(subLines),
          }
        : undefined;
    items.push({ text, checked: null, sub });
  }
  return items;
}

class MarkdownParser extends AbstractMarkdownParser {
  private readonly usedIds = new Set<string>();

  parse(md: string): BlockNode[] {
    const nodes: BlockNode[] = [];
    for (const tok of tokenize(md)) {
      try {
        nodes.push(this.parseToken(tok));
      } catch (e) {
        throw new ParseError(e instanceof Error ? e.message : String(e));
      }
    }
    return nodes;
  }

  protected parseToken(tok: Token): BlockNode {
    switch (tok.type) {
      case BlockType.Heading: {
        const level = Number(tok.meta.level) as HeadingLevel;
        const text = tok.lines[0] ?? "";
        return {
          type: BlockType.Heading,
          level,
          id: this.uniqueId(text),
          raw: text,
          children: parseInline(text),
        };
      }
      case BlockType.Paragraph: {
        const text = tok.lines.join(" ");
        return {
          type: BlockType.Paragraph,
          raw: text,
          children: parseInline(text),
        };
      }
      case BlockType.CodeBlock:
        return {
          type: BlockType.CodeBlock,
          raw: tok.lines.join("\n"),
          lang: tok.meta.lang ?? "",
          code: tok.lines.join("\n"),
        };
      case BlockType.Hr:
        return { type: BlockType.Hr, raw: "" };
      case BlockType.Quote: {
        const inner = tok.lines.join("\n");
        return {
          type: BlockType.Quote,
          raw: inner,
          children: new MarkdownParser().parse(inner),
        };
      }
      case BlockType.List:
        return {
          type: BlockType.List,
          raw: tok.lines.join("\n"),
          listType: detectListType(tok.lines[0]),
          items: parseListItems(tok.lines),
        };
      case BlockType.Table: {
        const headers = JSON.parse(tok.meta.headers) as string[];
        const aligns = JSON.parse(tok.meta.aligns) as (
          "left" | "center" | "right" | null
        )[];
        const rows = JSON.parse(tok.meta.rows) as string[][];
        return { type: BlockType.Table, raw: "", headers, aligns, rows };
      }
      case BlockType.TaskList: {
        const items = JSON.parse(tok.meta.items) as {
          text: string;
          checked: boolean;
        }[];
        return { type: BlockType.TaskList, raw: "", items };
      }
      case BlockType.Footnote: {
        const text = tok.lines.join(" ");
        return {
          type: BlockType.Footnote,
          raw: text,
          id: tok.meta.id,
          children: parseInline(text),
        };
      }
      case BlockType.Html:
        return {
          type: BlockType.Html,
          raw: tok.lines.join("\n"),
          html: tok.lines.join("\n"),
        };
    }
  }

  private uniqueId(text: string): string {
    const base = slugify(text);
    let id = base;
    let n = 1;
    while (this.usedIds.has(id)) {
      id = `${base}-${++n}`;
    }
    this.usedIds.add(id);
    return id;
  }
}

// 14. Concrete renderer (visitor + mapped-type dispatch, getters/setters, satisfies)
class HtmlRenderer
  extends AbstractVisitor<BlockNode, string>
  implements AbstractHtmlRenderer
{
  private _theme: ThemeName = "light";
  get theme(): ThemeName {
    return this._theme;
  }
  set theme(v: ThemeName) {
    this._theme = v;
  }

  private readonly renderers: BlockRenderer = {
    [BlockType.Heading]: (n, ctx) => {
      ctx.toc.push({
        level: n.level,
        text: stripInlineText(n.children),
        id: n.id,
      });
      return `<h${n.level} id="${escapeHtml(n.id)}">${this.renderInline(n.children)}</h${n.level}>`;
    },
    [BlockType.Paragraph]: (n) => `<p>${this.renderInline(n.children)}</p>`,
    [BlockType.CodeBlock]: (n) => {
      const cls = n.lang ? ` class="language-${escapeHtml(n.lang)}"` : "";
      return `<pre><code${cls}>${highlightCode(n.code, n.lang)}</code></pre>`;
    },
    [BlockType.Quote]: (n, ctx) =>
      `<blockquote>${this.renderBlocks(n.children, ctx)}</blockquote>`,
    [BlockType.Hr]: () => `<hr>`,
    [BlockType.List]: (n, ctx) => this.renderList(n, ctx),
    [BlockType.Table]: (n) => this.renderTable(n),
    [BlockType.TaskList]: (n) => this.renderTaskList(n),
    [BlockType.Footnote]: (n, ctx) => {
      ctx.footnotes.push(n);
      return "";
    },
    [BlockType.Html]: (n) => n.html,
  } satisfies BlockRenderer;

  [VISIT](node: BlockNode, ctx: RenderContext): string {
    const fn = this.renderers[node.type] as (
      n: BlockNode,
      ctx: RenderContext,
    ) => string;
    return fn(node, ctx);
  }

  renderBlocks(nodes: readonly BlockNode[], ctx: RenderContext): string {
    return nodes.map((n) => this.visit(n, ctx)).join("\n");
  }
  renderInline(nodes: readonly InlineNode[]): string {
    return nodes.map((n) => this.renderInlineNode(n)).join("");
  }
  /** Renders a collected footnote definition for the footnotes section. */
  renderFootnote(f: FootnoteNode): string {
    return `<aside class="footnote" id="fn-${escapeHtml(f.id)}"><a href="#fnref-${escapeHtml(f.id)}">[^${escapeHtml(f.id)}]</a>: ${this.renderInline(f.children)}</aside>`;
  }
  private renderInlineNode(n: InlineNode): string {
    switch (n.type) {
      case InlineType.Text:
        return escapeHtml(n.text);
      case InlineType.Bold:
        return `<strong>${this.renderInline(n.children)}</strong>`;
      case InlineType.Italic:
        return `<em>${this.renderInline(n.children)}</em>`;
      case InlineType.Code:
        return `<code>${escapeHtml(n.code)}</code>`;
      case InlineType.Link: {
        const t = n.title ? ` title="${escapeHtml(n.title)}"` : "";
        return `<a href="${escapeHtml(n.url)}"${t}>${escapeHtml(n.text)}</a>`;
      }
      case InlineType.Image:
        return `<img src="${escapeHtml(n.url)}" alt="${escapeHtml(n.alt)}">`;
      case InlineType.Strike:
        return `<del>${this.renderInline(n.children)}</del>`;
      case InlineType.Highlight:
        return `<mark>${this.renderInline(n.children)}</mark>`;
      case InlineType.Emoji:
        return n.char;
      case InlineType.Html:
        return n.html;
    }
  }
  private renderList(node: ListNode, ctx: RenderContext): string {
    const tag = node.listType;
    const items = node.items
      .map((item) => {
        let inner = this.renderInline(parseInline(item.text));
        if (item.sub) inner += this.renderList(item.sub, ctx);
        return `<li>${inner}</li>`;
      })
      .join("");
    return `<${tag}>${items}</${tag}>`;
  }
  private renderTable(node: TableNode): string {
    const headerCells = node.headers
      .map((h, i) => {
        const style = node.aligns[i]
          ? ` style="text-align:${node.aligns[i]}"`
          : "";
        return `<th${style}>${this.renderInline(parseInline(h))}</th>`;
      })
      .join("");
    const rows = node.rows
      .map(
        (row) =>
          `<tr>${row
            .map((c, i) => {
              const style = node.aligns[i]
                ? ` style="text-align:${node.aligns[i]}"`
                : "";
              return `<td${style}>${this.renderInline(parseInline(c))}</td>`;
            })
            .join("")}</tr>`,
      )
      .join("");
    return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  private renderTaskList(node: TaskListNode): string {
    const items = node.items
      .map((item) => {
        const checked = item.checked ? "checked disabled" : "disabled";
        return `<li><input type="checkbox" ${checked}> ${this.renderInline(parseInline(item.text))}</li>`;
      })
      .join("");
    return `<ul class="task-list">${items}</ul>`;
  }
}

// 15. AST walking (generator) — iterator demonstration
function* walkAst(
  nodes: readonly BlockNode[],
): Generator<BlockNode | InlineNode> {
  for (const n of nodes) {
    yield n;
    if (
      isHeadingNode(n) ||
      n.type === BlockType.Paragraph ||
      n.type === BlockType.Footnote
    ) {
      yield* (n as { children: InlineNode[] }).children;
    } else if (isQuoteNode(n)) {
      yield* walkAst(n.children) as Generator<BlockNode>;
    } else if (isListNode(n)) {
      for (const item of n.items) {
        yield* parseInline(item.text);
        if (item.sub) yield item.sub;
      }
    }
  }
}

// 16. TOC & HTML document template
function renderToc(toc: readonly TocEntry[]): string {
  if (toc.length === 0) return "";
  const minLevel = Math.min(...toc.map((t) => t.level));
  const lines: string[] = ['<nav class="toc"><h2>目录</h2><ul>'];
  for (const t of toc) {
    const indent = "  ".repeat(t.level - minLevel);
    lines.push(
      `${indent}<li class="toc-l${t.level}"><a href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a></li>`,
    );
  }
  lines.push("</ul></nav>");
  return lines.join("\n");
}
function htmlTemplate(title: string, theme: ThemeName, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${THEMES[theme]}</style>
</head>
<body>
${body}
</body>
</html>`;
}

// 17. convert() with function overloads (optional chaining & nullish coalescing)
function convert(md: string, opts?: ConvertOptions): string;
function convert(
  md: string,
  format: OutputFormat,
  opts?: ConvertOptions,
): string;
function convert(
  md: string,
  formatOrOpts?: OutputFormat | ConvertOptions,
  opts: ConvertOptions = {},
): string {
  let format = OutputFormat.Full;
  let options: ConvertOptions = opts;
  if (typeof formatOrOpts === "string") format = formatOrOpts;
  else if (formatOrOpts) options = formatOrOpts;

  const theme: ThemeName = options.theme ?? "light";
  const wantToc = options.toc ?? false;
  const title = options.title ?? extractTitle(md);

  const ast = new MarkdownParser().parse(md);
  const renderer = new HtmlRenderer();
  renderer.theme = theme;

  const ctx: RenderContext = {
    theme,
    format,
    title,
    toc: [],
    footnotes: [],
    meta: {},
  };
  const body = renderer.renderBlocks(ast, ctx);
  const tocHtml = wantToc ? renderToc(ctx.toc) : "";
  const fnHtml =
    ctx.footnotes.length > 0
      ? `<section class="footnotes"><hr>${ctx.footnotes.map((f) => renderer.renderFootnote(f)).join("\n")}</section>`
      : "";
  const full = `${tocHtml}${body}${fnHtml}`;
  return format === OutputFormat.Fragment
    ? full
    : htmlTemplate(title, theme, full);
}

// 18. File I/O
function convertFile(
  mdFile: string,
  outPath: string,
  opts: ConvertOptions = {},
): void {
  if (!fs.existsSync(mdFile))
    throw new FileError(`文件不存在: ${mdFile}`, mdFile);
  let md: string;
  try {
    md = fs.readFileSync(mdFile, "utf8");
  } catch {
    throw new FileError(`读取失败: ${mdFile}`, mdFile);
  }
  const html = convert(md, OutputFormat.Full, opts);
  try {
    fs.writeFileSync(outPath, html, "utf8");
  } catch {
    throw new FileError(`写入失败: ${outPath}`, outPath);
  }
  console.log(
    `\x1b[32m已转换: ${path.resolve(mdFile)} -> ${path.resolve(outPath)}\x1b[0m`,
  );
}

// 19. CLI argument parsing & commands
interface ParsedArgs {
  positional: string[];
  output?: string;
  opts: ConvertOptions;
}
function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  let output: string | undefined;
  const opts: Mutable<ConvertOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === "-o" || a === "--output") && i + 1 < args.length)
      output = args[++i];
    else if (a === "--theme" && i + 1 < args.length)
      opts.theme = args[++i] as ThemeName;
    else if (a === "--toc") opts.toc = true;
    else if (a === "--title" && i + 1 < args.length) opts.title = args[++i];
    else positional.push(a);
  }
  return { positional, output, opts };
}
function defaultOutput(mdFile: string): string {
  return mdFile.replace(/\.md$/i, "") + ".html";
}

function cmdConvert(args: string[]): void {
  const { positional, output, opts } = parseArgs(args);
  const mdFile = positional[0];
  if (!mdFile) {
    console.error(
      "错误: 用法 convert <mdfile> [-o htmlfile] [--theme ...] [--toc]",
    );
    process.exit(1);
  }
  convertFile(mdFile, output ?? defaultOutput(mdFile), opts);
}
function cmdBatch(args: string[]): void {
  const { positional, output, opts } = parseArgs(args);
  const dir = positional[0];
  if (!dir) {
    console.error("错误: 用法 batch <dir> [-o outdir] [--theme ...]");
    process.exit(1);
  }
  const outDir = output ?? dir;
  if (!fs.existsSync(dir)) {
    console.error(`错误: 目录不存在: ${dir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let count = 0;
  for (const e of entries) {
    if (e.isFile() && /\.md$/i.test(e.name)) {
      const mdFile = path.join(dir, e.name);
      const outPath = path.join(outDir, e.name.replace(/\.md$/i, "") + ".html");
      try {
        convertFile(mdFile, outPath, opts);
        count++;
      } catch (err) {
        console.error(
          `跳过 ${e.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
  console.log(`\n批量转换完成，共转换 ${count} 个文件。`);
}
function cmdWatch(args: string[]): void {
  const { positional, output, opts } = parseArgs(args);
  const mdFile = positional[0];
  if (!mdFile) {
    console.error("错误: 用法 watch <mdfile> [-o htmlfile] [--theme ...]");
    process.exit(1);
  }
  const outPath = output ?? defaultOutput(mdFile);
  console.log(
    `监视 ${path.resolve(mdFile)} 的变化，自动转换到 ${path.resolve(outPath)} (Ctrl+C 退出)\n`,
  );
  const doConvert = (): void => {
    try {
      convertFile(mdFile, outPath, opts);
    } catch (err) {
      console.error(
        `转换失败 [${WatchEvent.Error}]: ${err instanceof Error ? err.message : err}`,
      );
    }
  };
  doConvert();
  let debounce: NodeJS.Timeout | null = null;
  fs.watch(mdFile, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(doConvert, 200);
  });
  process.on("SIGINT", () => {
    console.log("\n已停止监视。");
    process.exit(0);
  });
}

function printHelp(): void {
  console.log(`
Markdown 转 HTML 工具 (Markdown to HTML Converter) — Enhanced
=============================================================
AST 管线: tokenize -> parse -> render。支持标题/TOC、粗体、斜体、删除线、
高亮、行内代码、代码块(基础语法高亮)、链接、图片、嵌套列表、任务列表、
引用、GFM 表格、脚注、分割线、行内 HTML 透传、emoji 短码、多主题。

用法:
  md2html convert <mdfile> [-o htmlfile] [--theme dark|light|github] [--toc]
  md2html batch   <dir>    [-o outdir]   [--theme ...]
  md2html watch   <mdfile> [-o htmlfile] [--theme ...]
  md2html help

示例:
  md2html convert README.md -o readme.html --theme github --toc
  md2html batch ./docs -o ./site --theme dark
  md2html watch notes.md
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  try {
    switch (command) {
      case "convert":
        cmdConvert(rest);
        break;
      case "batch":
        cmdBatch(rest);
        break;
      case "watch":
        cmdWatch(rest);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;
      default:
        console.error(`未知命令: ${command}\n运行 'md2html help' 查看帮助。`);
        process.exit(1);
    }
  } catch (err) {
    const msg =
      err instanceof MarkdownError
        ? `[${err.code}] ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`错误: ${msg}`);
    process.exit(1);
  }
}

main();
