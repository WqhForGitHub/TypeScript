#!/usr/bin/env node
/**
 * 54. 爬取电影信息
 * ------------------------------------------------------------------
 * 演示一个电影信息爬虫：
 *   - 尝试从公开源（OMDb 公共镜像 / 豆瓣 HTML）抓取电影信息
 *   - 网络失败时回退到内置电影数据库
 *   - 支持命令：search、top、popular、detail、bygenre
 *   - 展示标题、年份、评分、导演、主演、剧情简介
 *
 * 仅使用 Node.js 内置模块：http、https、url、zlib、buffer、crypto。
 */

import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

interface Movie {
  id: string;
  title: string;
  year: number;
  rating: number;     // 0-10
  genres: string[];
  director: string;
  cast: string[];
  plot: string;
  poster?: string;
  source: "live" | "demo";
}

// ---------------------------------------------------------------------------
// HTTP 助手
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<{ status: number; body: string; finalUrl: string }> {
  const timeout = opts.timeout ?? 10000;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "application/json,text/html,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
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
// 简易 HTML 文本/标签提取器（用于解析豆瓣页面）
// ---------------------------------------------------------------------------

function extractText(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(stripTags(m[1]).trim());
  }
  return out;
}

function extractAttr(html: string, tag: string, attr: string): Array<{ text: string; attr: string }> {
  const re = new RegExp(`<${tag}\\s[^>]*?${attr}=["']([^"']*)["'][^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: Array<{ text: string; attr: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ attr: m[1], text: stripTags(m[2]).trim() });
  }
  return out;
}

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

// ---------------------------------------------------------------------------
// 内置演示电影数据库
// ---------------------------------------------------------------------------

const DEMO_MOVIES: Movie[] = [
  {
    id: "tt0111161", title: "肖申克的救赎", year: 1994, rating: 9.7,
    genres: ["剧情", "犯罪"], director: "弗兰克·德拉邦特",
    cast: ["蒂姆·罗宾斯", "摩根·弗里曼", "鲍勃·冈顿"],
    plot: "银行家安迪被诬陷杀害妻子及其情人，被送往肖申克监狱。在狱中，他与瑞德结下深厚友谊，并通过近二十年的坚持，最终实现越狱与自我救赎。",
    source: "demo",
  },
  {
    id: "tt0068646", title: "教父", year: 1972, rating: 9.3,
    genres: ["剧情", "犯罪"], director: "弗朗西斯·福特·科波拉",
    cast: ["马龙·白兰度", "阿尔·帕西诺", "詹姆斯·肯恩"],
    plot: "讲述了以维托·柯里昂为首的黑手党家族的发展历程，以及其小儿子迈克如何接任父亲成为新一代教父的故事。",
    source: "demo",
  },
  {
    id: "tt0071562", title: "教父2", year: 1974, rating: 9.2,
    genres: ["剧情", "犯罪"], director: "弗朗西斯·福特·科波拉",
    cast: ["阿尔·帕西诺", "罗伯特·德尼罗", "罗伯特·杜瓦尔"],
    plot: "继续讲述柯里昂家族的故事，迈克巩固家族势力，同时回顾父亲维托年轻时从西西里来到美国创业的历程。",
    source: "demo",
  },
  {
    id: "tt0468569", title: "蝙蝠侠：黑暗骑士", year: 2008, rating: 9.2,
    genres: ["动作", "犯罪", "剧情"], director: "克里斯托弗·诺兰",
    cast: ["克里斯蒂安·贝尔", "希斯·莱杰", "阿伦·埃克哈特"],
    plot: "蝙蝠侠面对疯狂而高智商的小丑，小丑企图在哥谭市制造混乱并摧毁蝙蝠侠的信念。",
    source: "demo",
  },
  {
    id: "tt0050083", title: "十二怒汉", year: 1957, rating: 9.4,
    genres: ["剧情"], director: "西德尼·吕美特",
    cast: ["亨利·方达", "李·科布", "埃德·贝格利"],
    plot: "12 名陪审员在休息室讨论一桩少年杀人案，唯一持异议的陪审员通过理性分析逐步说服其他人，最终裁定无罪。",
    source: "demo",
  },
  {
    id: "tt0108052", title: "辛德勒的名单", year: 1993, rating: 9.5,
    genres: ["剧情", "历史", "战争"], director: "史蒂文·斯皮尔伯格",
    cast: ["连姆·尼森", "本·金斯利", "拉尔夫·费因斯"],
    plot: "二战期间，德国商人辛德勒利用自己的工厂庇护了千余名犹太人，使其免于纳粹屠杀。",
    source: "demo",
  },
  {
    id: "tt0167260", title: "指环王：王者归来", year: 2003, rating: 9.3,
    genres: ["动作", "奇幻", "冒险"], director: "彼得·杰克逊",
    cast: ["伊利亚·伍德", "维果·莫腾森", "伊安·麦克莱恩"],
    plot: "弗罗多与山姆最终抵达末日山脉销毁魔戒，人类与邪恶势力的最终决战打响，中土世界迎来新的纪元。",
    source: "demo",
  },
  {
    id: "tt0114369", title: "七宗罪", year: 1995, rating: 9.0,
    genres: ["剧情", "悬疑", "犯罪"], director: "大卫·芬奇",
    cast: ["布拉德·皮特", "摩根·弗里曼", "凯文·史派西"],
    plot: "两名警探追查一名以七宗罪为作案主题的连环杀手，最终揭开令人战栗的真相。",
    source: "demo",
  },
  {
    id: "tt0099685", title: "好家伙", year: 1990, rating: 9.0,
    genres: ["剧情", "犯罪"], director: "马丁·斯科塞斯",
    cast: ["罗伯特·德尼罗", "雷·利奥塔", "乔·佩西"],
    plot: "讲述亨利·希尔从街头少年成长为黑帮成员，最终因毒品与背叛走向毁灭的一生。",
    source: "demo",
  },
  {
    id: "tt1375666", title: "盗梦空间", year: 2010, rating: 9.4,
    genres: ["动作", "科幻", "悬疑"], director: "克里斯托弗·诺兰",
    cast: ["莱昂纳多·迪卡普里奥", "玛丽昂·歌迪亚", "约瑟夫·高登-莱维特"],
    plot: "柯布带领团队潜入他人梦境，执行“植入想法”的任务，同时他自身也深陷对妻子的回忆与执念之中。",
    source: "demo",
  },
  {
    id: "tt0137523", title: "搏击俱乐部", year: 1999, rating: 9.0,
    genres: ["剧情", "动作"], director: "大卫·芬奇",
    cast: ["布拉德·皮特", "爱德华·诺顿", "海伦娜·伯翰·卡特"],
    plot: "一名失眠的白领与神秘肥皂商人泰勒创立了地下搏击俱乐部，事件却逐渐失控走向极端。",
    source: "demo",
  },
  {
    id: "tt0118799", title: "美丽人生", year: 1997, rating: 9.6,
    genres: ["剧情", "喜剧", "战争"], director: "罗伯托·贝尼尼",
    cast: ["罗伯托·贝尼尼", "尼可莱塔·布拉斯基", "乔治·坎塔里尼"],
    plot: "犹太青年圭多在集中营中以游戏的方式保护儿子纯真的心灵，最终自己却难逃厄运。",
    source: "demo",
  },
];

// ---------------------------------------------------------------------------
// 实时抓取（尝试从公开 OMDb 备用镜像 / 豆瓣页面）
// ---------------------------------------------------------------------------

async function liveSearchByTitle(title: string): Promise<Movie[]> {
  // 由于 OMDb 需要 key，这里尝试用豆瓣搜索页面 HTML 解析作为演示
  try {
    const u = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(title)}`;
    const res = await fetchText(u, { timeout: 10000 });
    if (res.status !== 200 || res.body.length < 1000) return [];
    // 从 HTML 中粗略提取标题与年份（演示解析技术）
    const out: Movie[] = [];
    const re = /<a [^>]*?title="([^"]+)"[^>]*?>[\s\S]*?(\d{4})/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(res.body)) !== null && count < 10) {
      out.push({
        id: `live-${count}-${Date.now()}`,
        title: m[1],
        year: parseInt(m[2], 10) || 0,
        rating: 0,
        genres: [],
        director: "(未知)",
        cast: [],
        plot: "(实时数据仅解析到标题与年份，详情请使用 detail 命令)",
        source: "live",
      });
      count++;
    }
    return out;
  } catch (err) {
    console.log(`[liveSearch] 失败: ${(err as Error).message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 数据访问层
// ---------------------------------------------------------------------------

function searchInDemo(title: string): Movie[] {
  const k = title.toLowerCase();
  return DEMO_MOVIES.filter(
    (m) => m.title.toLowerCase().includes(k) || m.id.includes(k) ||
      m.cast.some((c) => c.toLowerCase().includes(k)) ||
      m.director.toLowerCase().includes(k)
  );
}

function topRated(): Movie[] {
  return [...DEMO_MOVIES].sort((a, b) => b.rating - a.rating).slice(0, 10);
}

function popular(): Movie[] {
  // 按“年份+评分”模拟热度
  return [...DEMO_MOVIES].sort((a, b) => (b.year + b.rating * 10) - (a.year + a.rating * 10)).slice(0, 10);
}

function byGenre(genre: string): Movie[] {
  const g = genre.toLowerCase();
  return DEMO_MOVIES.filter((m) => m.genres.some((x) => x.toLowerCase().includes(g)));
}

function detail(id: string): Movie | null {
  return DEMO_MOVIES.find((m) => m.id === id) || null;
}

// ---------------------------------------------------------------------------
// 显示
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  if (w >= n) return s;
  return s + " ".repeat(n - w);
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  green: "\x1b[32m", gray: "\x1b[90m",
};

function printList(movies: Movie[]): void {
  if (movies.length === 0) {
    console.log("  没有找到匹配的电影。");
    return;
  }
  console.log("");
  const widths = [8, 26, 8, 8, 22];
  const header = ["ID", "标题", "年份", "评分", "类型"];
  console.log("  " + header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("  " + "─".repeat(76));
  for (const m of movies) {
    const rating = m.rating > 0 ? C.yellow + m.rating.toFixed(1) + C.reset : "-";
    const row = [m.id.slice(0, 8), m.title.slice(0, 24), `${m.year}`, rating, m.genres.join("/")];
    console.log("  " + row.map((r, i) => pad(r.toString(), widths[i])).join(" "));
  }
  console.log("");
}

function printDetail(m: Movie): void {
  console.log("");
  console.log(`  ${C.bold}${m.title}${C.reset} (${m.year})   [${m.id}]   评分: ${C.yellow}${m.rating.toFixed(1)}${C.reset}`);
  console.log("  " + "─".repeat(64));
  console.log(`  导演: ${m.director}`);
  console.log(`  主演: ${m.cast.join(" / ")}`);
  console.log(`  类型: ${m.genres.join(" / ")}`);
  console.log(`  剧情: ${m.plot}`);
  console.log(`  数据源: ${m.source === "live" ? "实时" : "演示"}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function cmdSearch(title: string): Promise<void> {
  console.log(`[search] ${title}`);
  const live = await liveSearchByTitle(title);
  if (live.length > 0) {
    console.log(`[search] 使用实时数据 (共 ${live.length} 条)`);
    printList(live);
  } else {
    console.log("[search] 实时搜索失败或无结果，使用内置演示数据库。");
    printList(searchInDemo(title));
  }
}

function cmdTop(): void {
  console.log("[top] 评分榜 Top 10（演示数据库）");
  printList(topRated());
}

function cmdPopular(): void {
  console.log("[popular] 热门榜 Top 10（演示数据库）");
  printList(popular());
}

function cmdDetail(id: string): void {
  console.log(`[detail] ${id}`);
  const m = detail(id);
  if (!m) {
    console.log("  未找到该电影。可使用 search/top/popular 浏览列表。");
    return;
  }
  printDetail(m);
}

function cmdByGenre(genre: string): void {
  console.log(`[bygenre] ${genre}`);
  const list = byGenre(genre);
  if (list.length === 0) {
    console.log("  没有找到该类型的电影。");
    return;
  }
  printList(list);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
电影信息爬虫 - 用法:
  node dist/index.js search <title>         搜索电影（实时优先，回退演示）
  node dist/index.js top                    评分榜 Top 10
  node dist/index.js popular                热门榜 Top 10
  node dist/index.js detail <id>            查看详情
  node dist/index.js bygenre <genre>        按类型筛选
  node dist/index.js help                   显示本帮助

说明:
  - 实时数据尝试从公开搜索页面解析标题与年份；详情数据来自内置演示库。
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const arg = argv[1];

  try {
    switch (cmd) {
      case "search":
        if (!arg) { console.log("请提供搜索关键词。"); return; }
        await cmdSearch(arg);
        break;
      case "top": cmdTop(); break;
      case "popular": cmdPopular(); break;
      case "detail":
        if (!arg) { console.log("请提供电影 ID。"); return; }
        cmdDetail(arg);
        break;
      case "bygenre":
        if (!arg) { console.log("请提供类型名（如 剧情/动作/科幻）。"); return; }
        cmdByGenre(arg);
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
