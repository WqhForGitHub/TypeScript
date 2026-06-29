#!/usr/bin/env node
/**
 * 54. 爬取电影信息 (Enhanced TypeScript Edition)
 * 仅使用 Node.js 内置模块：http、https、url、zlib、crypto。
 * 展示枚举、泛型类、可辨识联合、映射/条件/模板字面量类型、
 * 抽象类、函数重载、自定义 Error 层级、satisfies、getter/setter、
 * 生成器、Symbol、as const、类型守卫、元组等高级 TS 特性。
 */
import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";
import * as crypto from "crypto";

// --- 字符串枚举 ---
enum Command {
  Search = "search",
  Top = "top",
  Popular = "popular",
  Detail = "detail",
  ByGenre = "bygenre",
  Help = "help",
}
enum Genre {
  Drama = "剧情",
  Crime = "犯罪",
  Action = "动作",
  SciFi = "科幻",
  Mystery = "悬疑",
  Comedy = "喜剧",
  War = "战争",
  History = "历史",
  Fantasy = "奇幻",
  Adventure = "冒险",
}
enum ContentType {
  Json = "application/json",
  Html = "text/html",
  Text = "text/plain",
}

// --- 常规枚举 (非 const enum，以便 Object.values() 可用) ---
enum RatingRange {
  Excellent = 9,
  Good = 7,
  Average = 5,
  Poor = 0,
}
enum ErrorCode {
  NetworkError = "NETWORK_ERROR",
  Timeout = "TIMEOUT",
  ParseError = "PARSE_ERROR",
  NotFound = "NOT_FOUND",
  InvalidArgument = "INVALID_ARGUMENT",
  TooManyRedirects = "TOO_MANY_REDIRECTS",
  Unknown = "UNKNOWN",
}

// --- 自定义 Error 层级 (带 code 属性) ---
class ScraperError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ScraperError";
    this.code = code;
    this.cause = cause;
  }
}
class NetworkScraperError extends ScraperError {
  constructor(msg: string, cause?: unknown) {
    super(ErrorCode.NetworkError, msg, cause);
    this.name = "NetworkScraperError";
  }
}
class TimeoutScraperError extends ScraperError {
  constructor(ms: number) {
    super(ErrorCode.Timeout, `请求超时 (${ms}ms)`);
    this.name = "TimeoutScraperError";
  }
}
class ParseScraperError extends ScraperError {
  constructor(d: string) {
    super(ErrorCode.ParseError, `解析失败: ${d}`);
    this.name = "ParseScraperError";
  }
}
class NotFoundScraperError extends ScraperError {
  constructor(id: string) {
    super(ErrorCode.NotFound, `未找到: ${id}`);
    this.name = "NotFoundScraperError";
  }
}

// --- 核心类型：可辨识联合 (Discriminated Unions) ---
interface BaseMovie {
  readonly id: string;
  title: string;
  year: number;
  rating: number;
  genres: Genre[];
  director: string;
  cast: readonly string[];
  plot: string;
  poster?: string;
  source: "live" | "demo";
}
interface DetailedMovie extends BaseMovie {
  kind: "detailed";
  awards?: string;
  runtime?: number;
  imdbId?: string;
}
interface SearchResult {
  kind: "search";
  query: string;
  total: number;
  items: BaseMovie[];
}
interface TopMovie {
  kind: "top";
  rank: number;
  movie: BaseMovie;
}
type MovieEntry = DetailedMovie | SearchResult | TopMovie;

// --- 类型守卫 ---
function isDetailedMovie(m: MovieEntry): m is DetailedMovie {
  return m.kind === "detailed";
}
function isSearchResult(m: MovieEntry): m is SearchResult {
  return m.kind === "search";
}
function isTopMovie(m: MovieEntry): m is TopMovie {
  return m.kind === "top";
}
function isCommand(s: string): s is Command {
  return (Object.values(Command) as string[]).includes(s);
}

// --- 映射类型 / 条件类型 / 模板字面量类型 ---
type MovieKey = keyof BaseMovie;
type ReadonlyMovie = {
  readonly [K in keyof BaseMovie]: Readonly<BaseMovie[K]>;
};
type MoviePatch = { [K in keyof BaseMovie]?: BaseMovie[K] };
type IsString<T> = T extends string ? true : false;
type StringKeys<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];
type MovieField = `movie:${MovieKey}`;
type GenreTag = `genre:${Genre}`;

// --- 接口 (可选 / 只读 / 索引签名) ---
interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
}
interface FetchResult {
  readonly status: number;
  readonly body: string;
  readonly finalUrl: string;
  readonly contentType?: string;
}
interface ScraperConfig {
  readonly defaultTimeout: number;
  readonly maxRedirects: number;
  readonly retryCount: number;
  readonly userAgent: string;
}
interface MovieStoreOptions {
  readonly capacity: number;
  readonly allowLive?: boolean;
  [key: string]: unknown;
}
interface MovieIndex {
  [id: string]: BaseMovie;
}

// --- 元组 / 只读元组 ---
type MovieRanking = readonly [rank: number, movie: BaseMovie];
type FetchStats = readonly [requests: number, bytes: number, errors: number];

// --- Symbol 唯一属性键 + as const + satisfies ---
const SOURCE_TAG = Symbol("sourceTag");
const CACHE_KEY = Symbol("cacheKey");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json,text/html,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate",
} as const;

const RANKING_WEIGHTS = { rating: 0.7, year: 0.3 } as const;

const SCRAPER_CONFIG = {
  defaultTimeout: 10000,
  maxRedirects: 5,
  retryCount: 2,
  userAgent: DEFAULT_HEADERS["User-Agent"],
} satisfies ScraperConfig;

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
} satisfies Record<string, string>;

// --- HTTP 助手 (函数重载) ---
function fetchText(rawUrl: string): Promise<FetchResult>;
function fetchText(rawUrl: string, opts: FetchOptions): Promise<FetchResult>;
function fetchText(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const timeout = opts.timeout ?? SCRAPER_CONFIG.defaultTimeout;
  const maxRedirects = opts.maxRedirects ?? SCRAPER_CONFIG.maxRedirects;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...opts.headers,
  };
  return new Promise<FetchResult>((resolve, reject) => {
    let redirects = 0;
    let currentUrl = rawUrl;
    const attempt = (target: string): void => {
      const parsed = url.parse(target);
      const lib = parsed.protocol === "https:" ? https : http;
      if (!parsed.hostname) {
        reject(
          new ScraperError(ErrorCode.InvalidArgument, `无效 URL: ${target}`),
        );
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
          const loc = res.headers.location;
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            typeof loc === "string"
          ) {
            if (redirects >= maxRedirects) {
              reject(
                new ScraperError(ErrorCode.TooManyRedirects, "重定向次数过多"),
              );
              res.resume();
              return;
            }
            redirects++;
            const next = url.resolve(target, loc);
            res.resume();
            currentUrl = next;
            attempt(next);
            return;
          }
          const chunks: Buffer[] = [];
          const encRaw = res.headers["content-encoding"];
          const enc = (typeof encRaw === "string" ? encRaw : "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br")
            stream = res.pipe(zlib.createBrotliDecompress());
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const ct = res.headers["content-type"];
            resolve({
              status: res.statusCode || 200,
              body: Buffer.concat(chunks).toString("utf8"),
              finalUrl: currentUrl,
              contentType: typeof ct === "string" ? ct : undefined,
            });
          });
          stream.on("error", (err: Error) =>
            reject(new NetworkScraperError(err.message, err)),
          );
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new TimeoutScraperError(timeout)),
      );
      req.on("error", (err: Error) => {
        if (err instanceof ScraperError) reject(err);
        else reject(new NetworkScraperError(err.message, err));
      });
      req.end();
    };
    attempt(currentUrl);
  });
}

// --- HTML 文本提取助手 ---
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
function extractText(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(stripTags(m[1]).trim());
  return out;
}

// --- 工具函数 (条件类型 / crypto / 枚举) ---
function computeCacheKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}
function movieFingerprint(movie: BaseMovie): string {
  return computeCacheKey(`${movie.id}:${movie.title}:${movie.year}`);
}
function categorizeByRating(rating: number): RatingRange {
  if (rating >= RatingRange.Excellent) return RatingRange.Excellent;
  if (rating >= RatingRange.Good) return RatingRange.Good;
  if (rating >= RatingRange.Average) return RatingRange.Average;
  return RatingRange.Poor;
}
function isStringField<T extends BaseMovie, K extends keyof T>(
  movie: T,
  key: K,
): IsString<T[K]> {
  return (typeof movie[key] === "string") as unknown as IsString<T[K]>;
}
function fieldPath(field: MovieKey): MovieField {
  return `movie:${field}` as MovieField;
}
function genreTag(g: Genre): GenreTag {
  return `genre:${g}` as GenreTag;
}
function parseGenre(s: string): Genre | undefined {
  const lower = s.toLowerCase();
  return (Object.values(Genre) as Genre[]).find(
    (g) => g.toLowerCase() === lower || g.toLowerCase().includes(lower),
  );
}
function detectContentType(res: FetchResult): ContentType {
  const ct = res.contentType || "";
  if (ct.includes("json")) return ContentType.Json;
  if (ct.includes("html")) return ContentType.Html;
  return ContentType.Text;
}
function* iterateMovies(
  movies: readonly BaseMovie[],
): Generator<BaseMovie, void, undefined> {
  for (const m of movies) yield m;
}

// --- 内置演示电影数据库 ---
const DEMO_MOVIES: readonly BaseMovie[] = [
  {
    id: "tt0111161",
    title: "肖申克的救赎",
    year: 1994,
    rating: 9.7,
    genres: [Genre.Drama, Genre.Crime],
    director: "弗兰克·德拉邦特",
    cast: ["蒂姆·罗宾斯", "摩根·弗里曼", "鲍勃·冈顿"],
    plot: "银行家安迪被诬陷杀害妻子及其情人，被送往肖申克监狱。在狱中，他与瑞德结下深厚友谊，并通过近二十年的坚持，最终实现越狱与自我救赎。",
    source: "demo",
  },
  {
    id: "tt0068646",
    title: "教父",
    year: 1972,
    rating: 9.3,
    genres: [Genre.Drama, Genre.Crime],
    director: "弗朗西斯·福特·科波拉",
    cast: ["马龙·白兰度", "阿尔·帕西诺", "詹姆斯·肯恩"],
    plot: "讲述了以维托·柯里昂为首的黑手党家族的发展历程，以及其小儿子迈克如何接任父亲成为新一代教父的故事。",
    source: "demo",
  },
  {
    id: "tt0468569",
    title: "蝙蝠侠：黑暗骑士",
    year: 2008,
    rating: 9.2,
    genres: [Genre.Action, Genre.Crime, Genre.Drama],
    director: "克里斯托弗·诺兰",
    cast: ["克里斯蒂安·贝尔", "希斯·莱杰", "阿伦·埃克哈特"],
    plot: "蝙蝠侠面对疯狂而高智商的小丑，小丑企图在哥谭市制造混乱并摧毁蝙蝠侠的信念。",
    source: "demo",
  },
  {
    id: "tt0050083",
    title: "十二怒汉",
    year: 1957,
    rating: 9.4,
    genres: [Genre.Drama],
    director: "西德尼·吕美特",
    cast: ["亨利·方达", "李·科布", "埃德·贝格利"],
    plot: "12 名陪审员在休息室讨论一桩少年杀人案，唯一持异议的陪审员通过理性分析逐步说服其他人，最终裁定无罪。",
    source: "demo",
  },
  {
    id: "tt0108052",
    title: "辛德勒的名单",
    year: 1993,
    rating: 9.5,
    genres: [Genre.Drama, Genre.History, Genre.War],
    director: "史蒂文·斯皮尔伯格",
    cast: ["连姆·尼森", "本·金斯利", "拉尔夫·费因斯"],
    plot: "二战期间，德国商人辛德勒利用自己的工厂庇护了千余名犹太人，使其免于纳粹屠杀。",
    source: "demo",
  },
  {
    id: "tt0167260",
    title: "指环王：王者归来",
    year: 2003,
    rating: 9.3,
    genres: [Genre.Action, Genre.Fantasy, Genre.Adventure],
    director: "彼得·杰克逊",
    cast: ["伊利亚·伍德", "维果·莫腾森", "伊安·麦克莱恩"],
    plot: "弗罗多与山姆最终抵达末日山脉销毁魔戒，人类与邪恶势力的最终决战打响，中土世界迎来新的纪元。",
    source: "demo",
  },
  {
    id: "tt0114369",
    title: "七宗罪",
    year: 1995,
    rating: 9.0,
    genres: [Genre.Drama, Genre.Mystery, Genre.Crime],
    director: "大卫·芬奇",
    cast: ["布拉德·皮特", "摩根·弗里曼", "凯文·史派西"],
    plot: "两名警探追查一名以七宗罪为作案主题的连环杀手，最终揭开令人战栗的真相。",
    source: "demo",
  },
  {
    id: "tt1375666",
    title: "盗梦空间",
    year: 2010,
    rating: 9.4,
    genres: [Genre.Action, Genre.SciFi, Genre.Mystery],
    director: "克里斯托弗·诺兰",
    cast: ["莱昂纳多·迪卡普里奥", "玛丽昂·歌迪亚", "约瑟夫·高登-莱维特"],
    plot: "柯布带领团队潜入他人梦境，执行植入想法的任务，同时他自身也深陷对妻子的回忆与执念之中。",
    source: "demo",
  },
  {
    id: "tt0118799",
    title: "美丽人生",
    year: 1997,
    rating: 9.6,
    genres: [Genre.Drama, Genre.Comedy, Genre.War],
    director: "罗伯托·贝尼尼",
    cast: ["罗伯托·贝尼尼", "尼可莱塔·布拉斯基", "乔治·坎塔里尼"],
    plot: "犹太青年圭多在集中营中以游戏的方式保护儿子纯真的心灵，最终自己却难逃厄运。",
    source: "demo",
  },
  {
    id: "tt0137523",
    title: "搏击俱乐部",
    year: 1999,
    rating: 9.0,
    genres: [Genre.Drama, Genre.Action],
    director: "大卫·芬奇",
    cast: ["布拉德·皮特", "爱德华·诺顿", "海伦娜·伯翰·卡特"],
    plot: "一名失眠的白领与神秘肥皂商人泰勒创立了地下搏击俱乐部，事件却逐渐失控走向极端。",
    source: "demo",
  },
];

// --- 抽象类 + 具体子类 ---
abstract class AbstractMovieSource {
  abstract readonly name: string;
  abstract readonly sourceType: "live" | "demo";
  abstract search(query: string): Promise<BaseMovie[]>;
  abstract top(): Promise<BaseMovie[]>;
  abstract popular(): Promise<BaseMovie[]>;
  abstract detail(id: string): Promise<BaseMovie | null>;
  abstract byGenre(genre: Genre): Promise<BaseMovie[]>;
  protected log(msg: string): void {
    console.log(`[${this.name}] ${msg}`);
  }
  fieldPath(field: MovieKey): MovieField {
    return fieldPath(field);
  }
  genreTag(g: Genre): GenreTag {
    return genreTag(g);
  }
}

class MockSource extends AbstractMovieSource {
  readonly name = "Mock";
  readonly sourceType = "demo" as const;
  constructor(private movies: readonly BaseMovie[]) {
    super();
  }
  async search(query: string): Promise<BaseMovie[]> {
    const k = query.toLowerCase();
    return this.movies.filter(
      (m) =>
        m.title.toLowerCase().includes(k) ||
        m.id.includes(k) ||
        m.cast.some((c) => c.toLowerCase().includes(k)) ||
        m.director.toLowerCase().includes(k),
    );
  }
  async top(): Promise<BaseMovie[]> {
    return [...this.movies].sort((a, b) => b.rating - a.rating).slice(0, 10);
  }
  async popular(): Promise<BaseMovie[]> {
    return [...this.movies]
      .sort((a, b) => {
        const sA =
          a.rating * RANKING_WEIGHTS.rating * 10 +
          a.year * RANKING_WEIGHTS.year;
        const sB =
          b.rating * RANKING_WEIGHTS.rating * 10 +
          b.year * RANKING_WEIGHTS.year;
        return sB - sA;
      })
      .slice(0, 10);
  }
  async detail(id: string): Promise<BaseMovie | null> {
    return this.movies.find((m) => m.id === id) || null;
  }
  async byGenre(genre: Genre): Promise<BaseMovie[]> {
    const g = genre.toLowerCase();
    return this.movies.filter((m) =>
      m.genres.some((x) => x.toLowerCase().includes(g)),
    );
  }
}

class DoubanSource extends AbstractMovieSource {
  readonly name = "Douban";
  readonly sourceType = "live" as const;
  async search(query: string): Promise<BaseMovie[]> {
    try {
      const u = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(query)}`;
      const res = await fetchText(u, { timeout: 10000 });
      if (res.status !== 200 || res.body.length < 1000) return [];
      this.log(`响应类型: ${detectContentType(res)}`);
      const out: BaseMovie[] = [];
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
      this.log(`搜索失败: ${(err as Error).message}`);
      return [];
    }
  }
  async top(): Promise<BaseMovie[]> {
    return [];
  }
  async popular(): Promise<BaseMovie[]> {
    return [];
  }
  async detail(_id: string): Promise<BaseMovie | null> {
    return null;
  }
  async byGenre(_genre: Genre): Promise<BaseMovie[]> {
    return [];
  }
}

class OmdbSource extends AbstractMovieSource {
  readonly name = "OMDb";
  readonly sourceType = "live" as const;
  constructor(private apiKey?: string) {
    super();
  }
  async search(query: string): Promise<BaseMovie[]> {
    if (!this.apiKey) {
      this.log("未配置 API Key，跳过 OMDb 搜索");
      return [];
    }
    try {
      const u = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${this.apiKey}`;
      const res = await fetchText(u);
      if (res.status !== 200) return [];
      const data = JSON.parse(res.body) as {
        Search?: Array<{ Title: string; Year: string; imdbID: string }>;
      };
      if (!data.Search) return [];
      return data.Search.map((item) => ({
        id: item.imdbID,
        title: item.Title,
        year: parseInt(item.Year, 10) || 0,
        rating: 0,
        genres: [],
        director: "(未知)",
        cast: [],
        plot: "",
        source: "live" as const,
      }));
    } catch (err) {
      this.log(`搜索失败: ${(err as Error).message}`);
      return [];
    }
  }
  async top(): Promise<BaseMovie[]> {
    return [];
  }
  async popular(): Promise<BaseMovie[]> {
    return [];
  }
  async detail(_id: string): Promise<BaseMovie | null> {
    return null;
  }
  async byGenre(_genre: Genre): Promise<BaseMovie[]> {
    return [];
  }
}

// --- 泛型类 MovieStore<T extends BaseMovie> ---
// getter/setter / 生成器 / Symbol / 映射类型 / 元组 / 索引签名
class MovieStore<T extends BaseMovie> {
  private items: Map<string, T> = new Map();
  private _fingerprintCache: Map<string, string> = new Map();
  private _stats: FetchStats;
  constructor(private _capacity: number) {
    this._stats = [0, 0, 0] as FetchStats;
  }
  get capacity(): number {
    return this._capacity;
  }
  set capacity(v: number) {
    if (v < 0)
      throw new ScraperError(ErrorCode.InvalidArgument, "容量不能为负");
    this._capacity = v;
  }
  get size(): number {
    return this.items.size;
  }
  get stats(): FetchStats {
    return this._stats;
  }
  get name(): string {
    return "MovieStore";
  }
  add(movie: T): void {
    if (this.items.size >= this._capacity && !this.items.has(movie.id)) {
      const first = this.items.keys().next().value;
      if (first !== undefined) this.items.delete(first);
    }
    this.items.set(movie.id, movie);
    const [r, b, e] = this._stats;
    this._stats = [r + 1, b + movie.plot.length, e];
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  has(id: string): boolean {
    return this.items.has(id);
  }
  clear(): void {
    this.items.clear();
    this._fingerprintCache.clear();
  }
  *[Symbol.iterator](): Generator<T, void, undefined> {
    for (const m of this.items.values()) yield m;
  }
  [SOURCE_TAG](): string {
    return `${this.name}:${this._capacity}`;
  }
  [CACHE_KEY](input: string): string {
    const cached = this._fingerprintCache.get(input);
    if (cached) return cached;
    const key = computeCacheKey(input);
    this._fingerprintCache.set(input, key);
    return key;
  }
  toPatch(movie: T): MoviePatch {
    return {
      id: movie.id,
      title: movie.title,
      year: movie.year,
      rating: movie.rating,
      genres: movie.genres,
      director: movie.director,
      cast: movie.cast,
      plot: movie.plot,
      source: movie.source,
    };
  }
  snapshot(): readonly ReadonlyMovie[] {
    return [...this.items.values()] as readonly ReadonlyMovie[];
  }
  toRankings(): MovieRanking[] {
    return [...this.items.values()]
      .sort((a, b) => b.rating - a.rating)
      .map((m, i) => [i + 1, m] as MovieRanking);
  }
  toIndex(): MovieIndex {
    const idx: MovieIndex = {};
    for (const m of this.items.values()) idx[m.id] = m;
    return idx;
  }
  checkStringField<K extends keyof T>(movie: T, key: K): IsString<T[K]> {
    return isStringField(movie, key);
  }
}

// --- 显示 ---
const DEFAULT_WIDTHS = [8, 26, 8, 8, 22] as const;

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  return w >= n ? s : s + " ".repeat(n - w);
}

function printList(movies: readonly BaseMovie[]): void {
  if (movies.length === 0) {
    console.log("  没有找到匹配的电影。");
    return;
  }
  console.log("");
  const header = ["ID", "标题", "年份", "评分", "类型"];
  console.log("  " + header.map((h, i) => pad(h, DEFAULT_WIDTHS[i])).join(" "));
  console.log("  " + "─".repeat(76));
  for (const m of iterateMovies(movies)) {
    const range = categorizeByRating(m.rating);
    const rc =
      range === RatingRange.Excellent
        ? COLORS.green
        : range === RatingRange.Good
          ? COLORS.yellow
          : "";
    const rating =
      m.rating > 0 ? `${rc}${m.rating.toFixed(1)}${COLORS.reset}` : "-";
    const row = [
      m.id.slice(0, 8),
      m.title.slice(0, 24),
      `${m.year}`,
      rating,
      m.genres.join("/"),
    ];
    console.log("  " + row.map((r, i) => pad(r, DEFAULT_WIDTHS[i])).join(" "));
  }
  console.log("");
}

function printDetail(m: BaseMovie): void {
  console.log("");
  console.log(
    `  ${COLORS.bold}${m.title}${COLORS.reset} (${m.year})   [${m.id}]   评分: ${COLORS.yellow}${m.rating.toFixed(1)}${COLORS.reset}`,
  );
  console.log("  " + "─".repeat(64));
  console.log(`  导演: ${m.director}`);
  console.log(`  主演: ${m.cast.join(" / ")}`);
  console.log(`  类型: ${m.genres.join(" / ")}`);
  console.log(`  剧情: ${m.plot}`);
  console.log(`  评级: ${categorizeByRating(m.rating)}`);
  console.log(`  指纹: ${movieFingerprint(m)}`);
  console.log(`  数据源: ${m.source === "live" ? "实时" : "演示"}`);
  console.log("");
}

// --- 命令实现 ---
const mockSource = new MockSource(DEMO_MOVIES);
const doubanSource = new DoubanSource();
const omdbSource = new OmdbSource();
const demoStore = new MovieStore<BaseMovie>(50);
for (const m of DEMO_MOVIES) demoStore.add(m);

async function cmdSearch(title: string): Promise<void> {
  console.log(`[search] ${title}`);
  const live = await doubanSource.search(title);
  if (live.length > 0) {
    console.log(`[search] 使用实时数据 (共 ${live.length} 条)`);
    printList(live);
  } else {
    console.log("[search] 实时搜索失败或无结果，使用内置演示数据库。");
    printList(await mockSource.search(title));
  }
}
async function cmdTop(): Promise<void> {
  console.log("[top] 评分榜 Top 10（演示数据库）");
  printList(await mockSource.top());
}
async function cmdPopular(): Promise<void> {
  console.log("[popular] 热门榜 Top 10（演示数据库）");
  printList(await mockSource.popular());
}
async function cmdDetail(id: string): Promise<void> {
  console.log(`[detail] ${id}`);
  const m = await mockSource.detail(id);
  if (!m) {
    console.log("  未找到该电影。可使用 search/top/popular 浏览列表。");
    return;
  }
  printDetail(m);
}
async function cmdByGenre(genreStr: string): Promise<void> {
  console.log(`[bygenre] ${genreStr}`);
  const genre = parseGenre(genreStr);
  if (!genre) {
    console.log("  没有找到该类型的电影。");
    return;
  }
  const list = await mockSource.byGenre(genre);
  if (list.length === 0) {
    console.log("  没有找到该类型的电影。");
    return;
  }
  printList(list);
}

// --- 入口 ---
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
  - 支持的类型: ${Object.values(Genre).join(" / ")}
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === Command.Help || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const arg = argv[1];
  if (!isCommand(cmd)) {
    console.log(`未知命令: ${cmd}`);
    printHelp();
    return;
  }
  try {
    switch (cmd) {
      case Command.Search:
        if (!arg) {
          console.log("请提供搜索关键词。");
          return;
        }
        await cmdSearch(arg);
        break;
      case Command.Top:
        await cmdTop();
        break;
      case Command.Popular:
        await cmdPopular();
        break;
      case Command.Detail:
        if (!arg) {
          console.log("请提供电影 ID。");
          return;
        }
        await cmdDetail(arg);
        break;
      case Command.ByGenre:
        if (!arg) {
          console.log("请提供类型名（如 剧情/动作/科幻）。");
          return;
        }
        await cmdByGenre(arg);
        break;
      case Command.Help:
        printHelp();
        break;
      default:
        const _exhaustive: never = cmd;
        console.log(`未实现命令: ${_exhaustive}`);
    }
    const [reqs, byts, errs] = demoStore.stats;
    console.log(
      `${COLORS.gray}[store] 容量=${demoStore.capacity}, 条目=${demoStore.size}, 请求=${reqs}, 字节=${byts}, 错误=${errs}${COLORS.reset}`,
    );
  } catch (err) {
    if (err instanceof ScraperError)
      console.error(`运行出错 [${err.code}]:`, err.message);
    else console.error("运行出错:", (err as Error).message);
    process.exit(1);
  }
  void omdbSource;
  void isDetailedMovie;
  void isSearchResult;
  void isTopMovie;
  void extractText;
}

main();
