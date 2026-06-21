#!/usr/bin/env node
/**
 * 51. 爬取新闻网站
 * ------------------------------------------------------------------
 * 演示一个基于 Node.js 内置模块实现的新闻网站爬虫。
 *
 * 特性：
 *   - 使用 http/https 内置模块发起请求，支持重定向、gzip 解压、超时、UA
 *   - 内置简易 HTML 解析器（基于状态机），提取 <a> / <h1>-<h3> / <p> 标签
 *   - 提供命令：fetch <url> [-l limit]、latest、search <keyword>
 *   - 结果保存为 JSON 文件
 *   - 网络失败时自动回退到内置演示数据，便于离线运行
 *
 * 仅使用 Node.js 内置模块：fs、path、url、http、https、zlib、buffer。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

interface FetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  finalUrl: string;
}

interface NewsArticle {
  title: string;
  link: string;
  summary: string;
  source: string;
  fetchedAt: string;
}

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

// ---------------------------------------------------------------------------
// HTTP 抓取助手（支持重定向 / gzip / 超时 / UA）
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeout = opts.timeout ?? 12000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    ...opts.headers,
  };

  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;

    const attempt = (target: string): void => {
      let parsed: url.UrlWithStringQuery;
      try {
        parsed = url.parse(target);
      } catch (err) {
        reject(new Error(`URL 解析失败: ${target}`));
        return;
      }
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(new Error(`无效主机: ${target}`));
        return;
      }

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : undefined,
          path: parsed.path || "/",
          method: "GET",
          headers,
        },
        (res) => {
          // 处理重定向
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= maxRedirects) {
              reject(new Error(`重定向次数过多 (> ${maxRedirects})`));
              res.resume();
              return;
            }
            redirects++;
            const next = url.resolve(target, res.headers.location);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }

          const chunks: Buffer[] = [];
          const encoding = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (encoding === "gzip") {
            stream = res.pipe(zlib.createGunzip());
          } else if (encoding === "deflate") {
            stream = res.pipe(zlib.createInflate());
          } else if (encoding === "br") {
            stream = res.pipe(zlib.createBrotliDecompress());
          }

          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode || 200,
              headers: res.headers,
              body,
              finalUrl: currentUrl,
            });
          });
          stream.on("error", (err: Error) => reject(err));
        }
      );

      req.setTimeout(timeout, () => {
        req.destroy(new Error(`请求超时 (${timeout}ms): ${target}`));
      });
      req.on("error", (err: Error) => reject(err));
      req.end();
    };

    attempt(currentUrl);
  });
}

// ---------------------------------------------------------------------------
// 简易 HTML 解析器（状态机）
//   提取 <a> / <h1>-<h3> / <p> 标签及其文本/属性
// ---------------------------------------------------------------------------

class HtmlExtractor {
  private nodes: HtmlNode[] = [];

  constructor(private html: string) {
    this.parse();
  }

  private parse(): void {
    const html = this.html;
    let i = 0;
    const len = html.length;

    while (i < len) {
      if (html[i] === "<") {
        // 跳过注释、CDATA、<!doctype、<script、<style 内容
        if (html.substr(i, 4) === "<!--") {
          const end = html.indexOf("-->", i + 4);
          i = end === -1 ? len : end + 3;
          continue;
        }
        if (/^<\?/i.test(html.substr(i, 2))) {
          const end = html.indexOf("?>", i + 2);
          i = end === -1 ? len : end + 2;
          continue;
        }
        if (/^<!/i.test(html.substr(i, 2))) {
          const end = html.indexOf(">", i + 2);
          i = end === -1 ? len : end + 1;
          continue;
        }
        // 解析开始标签
        const tagEnd = html.indexOf(">", i + 1);
        if (tagEnd === -1) break;
        const tagContent = html.slice(i + 1, tagEnd);
        const selfClose = tagContent.endsWith("/");
        const cleaned = selfClose ? tagContent.slice(0, -1).trim() : tagContent.trim();
        const match = /^([a-zA-Z][a-zA-Z0-9]*)\s*(.*)$/s.exec(cleaned);
        if (!match) {
          i = tagEnd + 1;
          continue;
        }
        const tag = match[1].toLowerCase();
        const attrStr = match[2] || "";
        const attrs = this.parseAttrs(attrStr);

        if (tag === "script" || tag === "style") {
          // 跳过其内部内容
          const closeTag = `</${tag}`;
          const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
          i = closeIdx === -1 ? len : html.indexOf(">", closeIdx) + 1;
          continue;
        }

        // 自闭合或没有闭合标签的元素
        const voidTags = new Set([
          "area","base","br","col","embed","hr","img","input",
          "link","meta","param","source","track","wbr",
        ]);
        if (selfClose || voidTags.has(tag)) {
          this.nodes.push({ tag, attrs, text: "" });
          i = tagEnd + 1;
          continue;
        }

        // 提取文本直到匹配的闭合标签
        const closeTag = `</${tag}`;
        const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
        if (closeIdx === -1) {
          // 没有闭合，把剩余当文本
          const text = this.cleanText(html.slice(tagEnd + 1));
          this.nodes.push({ tag, attrs, text });
          i = len;
          continue;
        }
        const inner = html.slice(tagEnd + 1, closeIdx);
        const text = this.cleanText(inner);
        this.nodes.push({ tag, attrs, text });
        const realCloseEnd = html.indexOf(">", closeIdx);
        i = realCloseEnd === -1 ? len : realCloseEnd + 1;
      } else {
        // 文本节点
        const nextTag = html.indexOf("<", i);
        const end = nextTag === -1 ? len : nextTag;
        const text = this.cleanText(html.slice(i, end));
        if (text.trim()) {
          this.nodes.push({ tag: "#text", attrs: {}, text });
        }
        i = end;
      }
    }
  }

  private parseAttrs(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)'|(\s)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrStr)) !== null) {
      const name = m[1];
      const value = m[2] ?? m[3] ?? "";
      attrs[name.toLowerCase()] = value;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return attrs;
  }

  private cleanText(s: string): string {
    return s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 获取所有指定标签 */
  byTag(tag: string): HtmlNode[] {
    return this.nodes.filter((n) => n.tag === tag.toLowerCase());
  }

  /** 获取所有标题节点（h1-h3） */
  headings(): HtmlNode[] {
    return this.nodes.filter(
      (n) => n.tag === "h1" || n.tag === "h2" || n.tag === "h3"
    );
  }

  /** 获取所有链接（带 href） */
  links(): HtmlNode[] {
    return this.nodes.filter((n) => n.tag === "a" && !!n.attrs.href);
  }

  /** 段落文本 */
  paragraphs(): HtmlNode[] {
    return this.nodes.filter((n) => n.tag === "p" && !!n.text);
  }
}

// ---------------------------------------------------------------------------
// 新闻解析与命令实现
// ---------------------------------------------------------------------------

function extractArticles(html: string, baseUrl: string): NewsArticle[] {
  const ex = new HtmlExtractor(html);
  const links = ex.links();
  const headings = ex.headings();
  const paragraphs = ex.paragraphs();

  const seen = new Set<string>();
  const articles: NewsArticle[] = [];

  // 优先以 <a> 链接作为文章
  for (const a of links) {
    const href = a.attrs.href || "";
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    const absolute = url.resolve(baseUrl, href);
    if (!/^https?:\/\//.test(absolute)) continue;
    const title = a.text.trim();
    if (title.length < 6) continue; // 过滤短文本（导航类）
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    // 尝试在附近找摘要
    let summary = "";
    for (const p of paragraphs) {
      if (p.text.length > 30 && p.text.includes(title.slice(0, 4))) {
        summary = p.text.slice(0, 160);
        break;
      }
    }
    if (!summary && paragraphs.length > 0) {
      summary = paragraphs[0].text.slice(0, 160);
    }

    articles.push({
      title,
      link: absolute,
      summary,
      source: baseUrl,
      fetchedAt: new Date().toISOString(),
    });
  }

  // 用标题补充
  for (const h of headings) {
    const text = h.text.trim();
    if (!text || text.length < 4) continue;
    if (articles.some((a) => a.title === text)) continue;
    articles.push({
      title: text,
      link: "",
      summary: "",
      source: baseUrl,
      fetchedAt: new Date().toISOString(),
    });
  }

  return articles;
}

function saveJson(filename: string, data: unknown): void {
  const outDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  console.log(`\n[保存] 结果已写入: ${file}`);
}

function printArticles(articles: NewsArticle[], limit: number): void {
  const slice = articles.slice(0, limit);
  console.log(`\n共 ${articles.length} 条，显示 ${slice.length} 条：`);
  console.log("=".repeat(72));
  slice.forEach((a, idx) => {
    console.log(`\n[${idx + 1}] ${a.title}`);
    if (a.link) console.log(`    链接: ${a.link}`);
    if (a.summary) console.log(`    摘要: ${a.summary}`);
    console.log(`    来源: ${a.source}  时间: ${a.fetchedAt}`);
  });
  console.log("\n" + "=".repeat(72));
}

// 演示数据（离线时使用）
function demoArticles(): NewsArticle[] {
  const now = new Date().toISOString();
  return [
    { title: "国家发布 2025 年数字经济新政策 推动高质量发展", link: "https://demo.news.example.com/p/1001", summary: "国务院近日发布关于数字经济的新政策，明确未来五年发展方向，重点支持人工智能与制造业深度融合。", source: "演示数据", fetchedAt: now },
    { title: "全球气候大会达成新协议 多国承诺减排目标", link: "https://demo.news.example.com/p/1002", summary: "经过两周谈判，与会各国就减排路线图达成共识，发达国家承诺提供更多气候融资。", source: "演示数据", fetchedAt: now },
    { title: "中国空间站完成新一轮科学实验 取得重要成果", link: "https://demo.news.example.com/p/1003", summary: "神舟乘组在轨完成多项生命科学与材料科学实验，相关数据已传回地面。", source: "演示数据", fetchedAt: now },
    { title: "国内新能源汽车销量再创新高 出口持续增长", link: "https://demo.news.example.com/p/1004", summary: "据行业协会统计，上月新能源汽车销量同比增长 35%，欧洲市场表现尤为亮眼。", source: "演示数据", fetchedAt: now },
    { title: "高校招生改革新方案公布 注重综合素质评价", link: "https://demo.news.example.com/p/1005", summary: "教育部公布新一轮招生改革方案，强化对学生综合素质与实践能力的考察。", source: "演示数据", fetchedAt: now },
    { title: "5G 网络覆盖进一步扩大 农村地区受益明显", link: "https://demo.news.example.com/p/1006", summary: "工信部数据显示，全国 5G 基站总数突破 400 万，偏远地区网络体验显著改善。", source: "演示数据", fetchedAt: now },
    { title: "人工智能大模型在医疗影像领域取得突破", link: "https://demo.news.example.com/p/1007", summary: "国内研究团队开发的医学影像大模型在多中心测试中表现优于传统方法。", source: "演示数据", fetchedAt: now },
    { title: "央行下调存款准备金率 释放长期资金", link: "https://demo.news.example.com/p/1008", summary: "中国人民银行宣布降准 0.5 个百分点，预计释放约 1 万亿元长期资金。", source: "演示数据", fetchedAt: now },
  ];
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function cmdFetch(targetUrl: string, limit: number): Promise<void> {
  console.log(`[抓取] 目标: ${targetUrl} (limit=${limit})`);
  let useDemo = false;
  let articles: NewsArticle[] = [];
  try {
    const res = await fetchText(targetUrl, { timeout: 12000 });
    console.log(`[抓取] HTTP ${res.status}, 共 ${res.body.length} 字节`);
    articles = extractArticles(res.body, res.finalUrl);
    if (articles.length === 0) {
      console.log("[抓取] 未解析到文章，使用演示数据。");
      useDemo = true;
      articles = demoArticles();
    } else {
      console.log(`[抓取] 解析到 ${articles.length} 条文章（数据来源: 实时）`);
    }
  } catch (err) {
    useDemo = true;
    console.log(`[抓取] 实时请求失败: ${(err as Error).message}`);
    console.log("[抓取] 回退到演示数据。");
    articles = demoArticles();
  }
  printArticles(articles, limit);
  const tag = useDemo ? "demo" : "live";
  saveJson(`news-${tag}-${Date.now()}.json`, articles);
}

async function cmdLatest(): Promise<void> {
  const defaultUrl = "https://news.ycombinator.com/";
  console.log(`[latest] 抓取默认新闻源: ${defaultUrl}`);
  await cmdFetch(defaultUrl, 20);
}

async function cmdSearch(keyword: string): Promise<void> {
  console.log(`[search] 关键词: ${keyword}`);
  // 先尝试实时抓取，再在结果中搜索；失败则使用演示数据
  let pool: NewsArticle[] = [];
  try {
    const target = `https://news.ycombinator.com/`;
    const res = await fetchText(target, { timeout: 12000 });
    pool = extractArticles(res.body, res.finalUrl);
    console.log(`[search] 实时抓取到 ${pool.length} 条候选`);
  } catch (err) {
    console.log(`[search] 实时抓取失败: ${(err as Error).message}，使用演示数据。`);
  }
  if (pool.length === 0) pool = demoArticles();

  const k = keyword.toLowerCase();
  const matched = pool.filter(
    (a) =>
      a.title.toLowerCase().includes(k) ||
      a.summary.toLowerCase().includes(k)
  );
  if (matched.length === 0) {
    console.log(`[search] 未找到与 "${keyword}" 匹配的文章。`);
    return;
  }
  printArticles(matched, 50);
  saveJson(`news-search-${keyword}-${Date.now()}.json`, matched);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
新闻网站爬虫 - 用法:
  node dist/index.js fetch <url> [-l limit]   抓取指定 URL，提取文章
  node dist/index.js latest                   抓取默认新闻源（Hacker News）
  node dist/index.js search <keyword>         在抓取结果中搜索关键词
  node dist/index.js help                     显示本帮助

选项:
  -l, --limit <n>   最多显示的文章数量（默认 20）
`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-l" || a === "--limit") {
      flags.limit = args[++i];
    } else if (a.startsWith("--")) {
      flags[a.slice(2)] = args[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const rest = argv.slice(1);
  const { positional, flags } = parseFlags(rest);
  const limit = parseInt(flags.limit || "20", 10) || 20;

  try {
    switch (cmd) {
      case "fetch":
        if (!positional[0]) {
          console.log("请提供要抓取的 URL。");
          return;
        }
        await cmdFetch(positional[0], limit);
        break;
      case "latest":
        await cmdLatest();
        break;
      case "search":
        if (!positional[0]) {
          console.log("请提供搜索关键词。");
          return;
        }
        await cmdSearch(positional[0]);
        break;
      default:
        console.log(`未知命令: ${cmd}`);
        printHelp();
    }
  } catch (err) {
    console.error("运行出错:", (err as Error).message);
    process.exit(1);
  }
}

main();
