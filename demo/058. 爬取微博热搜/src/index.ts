#!/usr/bin/env node
/**
 * 58. 爬取微博热搜
 * ------------------------------------------------------------------
 * 演示一个微博热搜爬虫：
 *   - 尝试抓取 s.weibo.com/top/summary 页面，解析热搜榜
 *   - 网络失败时回退到模拟热搜数据
 *   - 支持命令：hot、search、history、export
 *   - 本地缓存（带时间戳），可查看历史抓取结果
 *   - 彩色展示榜单（rank、关键词、热度）
 *
 * 仅使用 Node.js 内置模块：fs、path、url、http、https、zlib、buffer、crypto。
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

interface HotItem {
  rank: number;
  keyword: string;
  heat: number;        // 热度值
  category: string;    // 分类标签（如"沸"、"热"、"新"）
  link: string;        // 搜索结果链接
}

interface HotSnapshot {
  fetchedAt: string;
  source: "live" | "demo";
  items: HotItem[];
}

// ---------------------------------------------------------------------------
// HTTP 助手
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<{ status: number; body: string; finalUrl: string }> {
  const timeout = opts.timeout ?? 12000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Cookie: "SUB=_2AkMS-fake_demo_session",  // 仅用于演示，微博可能需要 cookie
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) { reject(new Error(`无效 URL: ${target}`)); return; }
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : undefined,
          path: parsed.path || "/",
          method: "GET",
          headers,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects >= 5) { reject(new Error("重定向次数过多")); res.resume(); return; }
            redirects++;
            const next = url.resolve(target, res.headers.location);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }
          const chunks: Buffer[] = [];
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => resolve({
            status: res.statusCode || 200,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: currentUrl,
          }));
          stream.on("error", (err: Error) => reject(err));
        }
      );
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时 (${timeout}ms)`)));
      req.on("error", (err: Error) => reject(err));
      req.end();
    };
    attempt(currentUrl);
  });
}

// ---------------------------------------------------------------------------
// HTML 解析（提取热搜条目）
// ---------------------------------------------------------------------------

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 微博热搜页面结构（简化）：
 *   <td class="td-02">
 *     <a href="/weibo?q=关键字" target="_blank">关键字</a>
 *     <span>1234567</span>  // 热度
 *   </td>
 * 演示用通用提取：找所有 <a href="/weibo?q=..."> 并配对热度
 */
function parseHotItems(html: string, baseUrl: string): HotItem[] {
  const out: HotItem[] = [];
  const re = /<a\s+href=["'](\/weibo\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let rank = 0;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const keyword = stripTags(m[2]);
    if (!keyword || keyword.length < 1) continue;
    // 寻找紧随其后的 <span>数字</span>
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 300);
    const heatMatch = /<span[^>]*>([\d.万]+)</i.exec(tail);
    const heat = heatMatch ? parseHeat(heatMatch[1]) : 0;
    // 类别（沸/热/新 等）
    const catMatch = /<span[^>]*class=["'][^"']*(?:hot|new|boil|fei)[^"']*["'][^>]*>([\u4e00-\u9fa5])</i.exec(tail);
    const category = catMatch ? catMatch[1] : "热";
    out.push({
      rank: ++rank,
      keyword,
      heat,
      category,
      link: url.resolve(baseUrl, href),
    });
  }
  return out;
}

function parseHeat(s: string): number {
  s = s.trim();
  if (s.includes("万")) {
    return Math.round(parseFloat(s) * 10000);
  }
  return parseInt(s.replace(/[^\d]/g, ""), 10) || 0;
}

// ---------------------------------------------------------------------------
// 模拟热搜数据
// ---------------------------------------------------------------------------

function demoHotItems(): HotItem[] {
  const data: Array<[string, number, string]> = [
    ["#新春档票房破纪录#", 4928103, "沸"],
    ["#国产AI大模型新突破#", 4382102, "沸"],
    ["#冬奥会金牌榜更新#", 3920411, "热"],
    ["#高校毕业生就业新政策#", 3502194, "热"],
    ["#城市夜经济火热#", 3120485, "热"],
    ["#新能源汽车出口增长#", 2891043, "热"],
    ["#国产电影获国际大奖#", 2650412, "热"],
    ["# astronaut 太空授课#", 2401852, "新"],
    ["#高校招生改革方案#", 2210593, "新"],
    ["#城市马拉松开赛#", 2050184, "新"],
    ["#5G网络覆盖扩大#", 1930472, ""],
    ["#数字人民币试点#", 1810293, ""],
    ["#夏季高温预警#", 1720485, ""],
    ["#篮球联赛总决赛#", 1650284, ""],
    ["#非遗文化展#", 1520184, ""],
    ["#量子计算新进展#", 1430291, ""],
    ["#国产芯片量产#", 1340183, ""],
    ["#航母编队演练#", 1280472, ""],
    ["#高考成绩查询#", 1210284, ""],
    ["#城市轨道交通开通#", 1150183, ""],
    ["#科技创新大赛#", 1080472, ""],
    ["#国际电影节开幕#", 1020183, ""],
    ["#乡村振兴典型案例#", 960472, ""],
    ["#环保新规实施#", 910283, ""],
    ["#全国羽毛球锦标赛#", 860472, ""],
    ["#博物馆夜场开放#", 810283, ""],
    ["#智慧城市建设#", 760472, ""],
    ["#冰雪运动热潮#", 710283, ""],
    ["#老旧小区改造#", 660472, ""],
    ["#中医药走向世界#", 610283, ""],
    ["#青少年科技展#", 560472, ""],
    ["#新一代显示技术#", 510283, ""],
    ["#国产飞机首飞#", 470472, ""],
    ["#深空探测新进展#", 430283, ""],
    ["#海洋经济新政策#", 390472, ""],
    ["#机器人产业大会#", 350283, ""],
    ["#绿色能源峰会#", 310472, ""],
    ["#智能网联汽车#", 280283, ""],
    ["#职业教育改革#", 250472, ""],
    ["#国产操作系统发布#", 220283, ""],
    ["#量子通信实验#", 190472, ""],
    ["#文物保护新技术#", 160283, ""],
    ["#绿色建筑标准#", 130472, ""],
    ["#跨境电商新规#", 110283, ""],
    ["#智能制造示范#", 95000, ""],
    ["#乡村旅游精品线路#", 82000, ""],
    ["#生物育种新突破#", 71000, ""],
    ["#航天员出舱活动#", 60000, ""],
    ["#碳达峰行动方案#", 50000, ""],
    ["#智慧医疗落地#", 42000, ""],
  ];
  return data.map(([keyword, heat, category], i) => ({
    rank: i + 1,
    keyword,
    heat,
    category,
    link: `https://s.weibo.com/weibo?q=${encodeURIComponent(keyword)}`,
  }));
}

// ---------------------------------------------------------------------------
// 缓存（本地 JSON 文件）
// ---------------------------------------------------------------------------

const CACHE_DIR = path.resolve(process.cwd(), "output", "weibo-cache");

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function saveCache(snap: HotSnapshot): string {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `hot-${snap.fetchedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), "utf8");
  return file;
}

function listCache(): string[] {
  ensureCacheDir();
  return fs.readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("hot-") && f.endsWith(".json"))
    .sort()
    .reverse();
}

function loadCache(file: string): HotSnapshot | null {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf8")) as HotSnapshot;
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 颜色与展示
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m", yellow: "\x1b[33m",
  green: "\x1b[32m", cyan: "\x1b[36m", gray: "\x1b[90m", magenta: "\x1b[35m",
};

function colorCategory(cat: string): string {
  if (cat === "沸") return C.red + cat + C.reset;
  if (cat === "热") return C.yellow + cat + C.reset;
  if (cat === "新") return C.green + cat + C.reset;
  return C.gray + cat + C.reset;
}

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}

function fmtHeat(h: number): string {
  if (h >= 10000) return (h / 10000).toFixed(1) + "万";
  return h.toString();
}

function printHot(snap: HotSnapshot, limit: number): void {
  const src = snap.source === "live" ? "实时" : "演示";
  console.log("");
  console.log(`  ${C.bold}微博热搜榜${C.reset}  数据源: ${src}  抓取时间: ${snap.fetchedAt}`);
  console.log("  " + "─".repeat(60));
  const widths = [6, 8, 28, 14];
  const header = ["排名", "标签", "关键词", "热度"];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(60));
  for (const it of snap.items.slice(0, limit)) {
    const cat = colorCategory(it.category || "热");
    const row = [
      `#${it.rank}`,
      cat,
      it.keyword,
      C.magenta + fmtHeat(it.heat) + C.reset,
    ];
    console.log("  " + row.map((r, i) => pad(r, widths[i])).join(" "));
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function fetchHot(): Promise<HotSnapshot> {
  const target = "https://s.weibo.com/top/summary";
  console.log(`[hot] 抓取: ${target}`);
  try {
    const res = await fetchText(target, { timeout: 12000 });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const items = parseHotItems(res.body, res.finalUrl);
    if (items.length === 0) throw new Error("未解析到热搜条目");
    console.log(`[hot] 实时抓取成功，共 ${items.length} 条`);
    return { fetchedAt: new Date().toISOString(), source: "live", items };
  } catch (err) {
    console.log(`[hot] 实时抓取失败: ${(err as Error).message}`);
    console.log("[hot] 回退到演示数据。");
    return { fetchedAt: new Date().toISOString(), source: "demo", items: demoHotItems() };
  }
}

async function cmdHot(limit: number): Promise<void> {
  const snap = await fetchHot();
  printHot(snap, limit);
  const file = saveCache(snap);
  console.log(`[hot] 已缓存到: ${file}`);
}

async function cmdSearch(keyword: string): Promise<void> {
  console.log(`[search] 关键词: ${keyword}`);
  const snap = await fetchHot();
  const k = keyword.toLowerCase();
  const matched = snap.items.filter((it) => it.keyword.toLowerCase().includes(k));
  if (matched.length === 0) {
    console.log(`[search] 未找到包含 "${keyword}" 的热搜。`);
    return;
  }
  console.log(`[search] 命中 ${matched.length} 条：`);
  printHot({ ...snap, items: matched }, matched.length);
}

function cmdHistory(): void {
  const files = listCache();
  if (files.length === 0) {
    console.log("[history] 暂无历史缓存。请先运行 hot 命令。");
    return;
  }
  console.log(`[history] 共 ${files.length} 条历史缓存：`);
  for (const f of files.slice(0, 20)) {
    const snap = loadCache(f);
    if (snap) {
      console.log(`  ${f}  ${snap.source === "live" ? "实时" : "演示"}  ${snap.items.length}条  ${snap.fetchedAt}`);
    }
  }
  if (files.length > 20) console.log(`  ... 还有 ${files.length - 20} 条`);
}

function cmdExport(format: "json" | "csv"): void {
  const files = listCache();
  if (files.length === 0) {
    console.log("[export] 暂无缓存可导出。请先运行 hot 命令。");
    return;
  }
  const snap = loadCache(files[0]);
  if (!snap) { console.log("[export] 读取缓存失败。"); return; }
  const outDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  let file: string;
  let content: string;
  if (format === "json") {
    file = path.join(outDir, `weibo-hot-${Date.now()}.json`);
    content = JSON.stringify(snap, null, 2);
  } else {
    file = path.join(outDir, `weibo-hot-${Date.now()}.csv`);
    const rows = ["rank,keyword,heat,category,link"];
    for (const it of snap.items) {
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      rows.push([it.rank, esc(it.keyword), it.heat, esc(it.category), esc(it.link)].join(","));
    }
    content = "\ufeff" + rows.join("\n"); // BOM for Excel
  }
  fs.writeFileSync(file, content, "utf8");
  console.log(`[export] 已导出 ${format.toUpperCase()}: ${file}  (共 ${snap.items.length} 条)`);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
微博热搜爬虫 - 用法:
  node dist/index.js hot [-l limit]                 抓取当前热搜（默认 50 条）
  node dist/index.js search <keyword>               在热搜中搜索关键词
  node dist/index.js history                         查看本地缓存历史
  node dist/index.js export [-f json|csv]           导出最近一次抓取结果
  node dist/index.js help                            显示本帮助

说明:
  - 优先抓取 s.weibo.com/top/summary；失败时回退到演示数据。
  - 抓取结果按时间戳缓存到 ./output/weibo-cache/。
`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-l" || a === "--limit") flags.limit = args[++i];
    else if (a === "-f" || a === "--format") flags.format = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i];
    else positional.push(a);
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
  const { positional, flags } = parseFlags(argv.slice(1));

  try {
    switch (cmd) {
      case "hot": {
        const limit = parseInt(flags.limit || "50", 10) || 50;
        await cmdHot(Math.min(Math.max(limit, 1), 100));
        break;
      }
      case "search":
        if (!positional[0]) { console.log("请提供搜索关键词。"); return; }
        await cmdSearch(positional[0]);
        break;
      case "history":
        cmdHistory();
        break;
      case "export": {
        const fmt = (flags.format === "csv" ? "csv" : "json") as "json" | "csv";
        cmdExport(fmt);
        break;
      }
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
