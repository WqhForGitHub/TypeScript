#!/usr/bin/env node
/**
 * 47. RSS 阅读器 (Enhanced TypeScript Edition)
 * 订阅、抓取、解析 RSS 2.0 / Atom 订阅源 (手动 XML 解析)。
 * 仅使用 Node.js 内置模块。
 */

import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URL } from "url";

/* ===== 1. Enums: string enums & regular enums ===== */

enum Command {
  Add = "add",
  List = "list",
  Fetch = "fetch",
  FetchAll = "fetch-all",
  Unread = "unread",
  MarkRead = "mark-read",
  Remove = "remove",
  Export = "export",
  Help = "help",
}

enum FeedType {
  Rss = "rss",
  Atom = "atom",
  Unknown = "unknown",
}

enum ContentType {
  Xml = "application/xml",
  Rss = "application/rss+xml",
  Atom = "application/atom+xml",
  Text = "text/xml",
  Html = "text/html",
  Any = "*/*",
}

/** 条目状态 (regular enum — works with Object.values / numeric mapping) */
enum ItemStatus {
  Unread = 0,
  Read = 1,
  Starred = 2,
  Archived = 3,
}

/** 错误码 (regular enum) */
enum ErrorCode {
  Unknown = 0,
  Network = 1,
  Parse = 2,
  NotFound = 3,
  InvalidUrl = 4,
  InvalidFeed = 5,
  Io = 6,
  Timeout = 7,
  Redirect = 8,
}

/* ===== 2. Template literal / Mapped / Conditional types ===== */

type FeedKey = `feed:${string}`;
type CommandKey = `cmd:${Command}`;
type LogLevel = "info" | "warn" | "error";

type Nullable<T> = { [K in keyof T]: T[K] | null };
type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
type PickFields<T, K extends keyof T> = { [P in K]: T[P] };
type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;
type StatusFlag<S extends ItemStatus> = S extends ItemStatus.Read
  ? true
  : false;

/* ===== 3. Interfaces (optional / readonly / index signatures) ===== */

interface Subscription {
  readonly url: string;
  title: string;
  readonly addedAt: string;
  lastFetchedAt: string | null;
  fetchCount: number;
  [key: string]: string | number | null;
}

interface FeedItemData {
  readonly id: string;
  readonly feedUrl: string;
  feedTitle: string;
  readonly title: string;
  readonly link: string;
  readonly pubDate: string | null;
  readonly description: string;
  readonly guid: string;
}

interface FeedItem extends FeedItemData {
  status: ItemStatus;
}

interface State {
  subscriptions: Subscription[];
  items: FeedItem[];
  meta: { [k: string]: string | number };
}

interface Config {
  readonly maxItems: number;
  readonly timeout: number;
  readonly maxRedirects: number;
  readonly userAgent: string;
  readonly accept: string;
}

/* ===== 4. Discriminated unions for feed formats ===== */

interface RssFeed {
  readonly type: FeedType.Rss;
  readonly title: string;
  readonly url: string;
  readonly items: readonly FeedItemData[];
}
interface AtomFeed {
  readonly type: FeedType.Atom;
  readonly title: string;
  readonly url: string;
  readonly items: readonly FeedItemData[];
}
interface UnknownFeed {
  readonly type: FeedType.Unknown;
  readonly title: string;
  readonly url: string;
  readonly items: readonly FeedItemData[];
}
type ParsedFeed = RssFeed | AtomFeed | UnknownFeed;

/* ===== 5. Custom Error hierarchy with `code` property ===== */

abstract class RssError extends Error {
  abstract readonly code: ErrorCode;
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toJSON(): { name: string; code: ErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}
class NetworkError extends RssError {
  readonly code = ErrorCode.Network;
}
class ParseError extends RssError {
  readonly code = ErrorCode.Parse;
}
class NotFoundError extends RssError {
  readonly code = ErrorCode.NotFound;
}
class InvalidUrlError extends RssError {
  readonly code = ErrorCode.InvalidUrl;
}
class InvalidFeedError extends RssError {
  readonly code = ErrorCode.InvalidFeed;
}
class IoError extends RssError {
  readonly code = ErrorCode.Io;
}
class TimeoutError extends RssError {
  readonly code = ErrorCode.Timeout;
}
class RedirectError extends RssError {
  readonly code = ErrorCode.Redirect;
}

/* ===== 6. `satisfies` operator + `as const` ===== */

const CONFIG = {
  maxItems: 500,
  timeout: 15000,
  maxRedirects: 5,
  userAgent: "Mozilla/5.0 (TypeScript RSS Reader Demo 47)",
  accept: `${ContentType.Rss}, ${ContentType.Atom}, ${ContentType.Xml}, ${ContentType.Any}`,
} satisfies Config;

const COMMAND_ALIASES = {
  ls: Command.List,
  rm: Command.Remove,
  mark: Command.MarkRead,
} as const;

/* ===== 7. Unique symbol keys ===== */

const INTERNAL_SEQ = Symbol("internalSeq");
const FETCH_TOKEN = Symbol("fetchToken");

interface TrackedSubscription extends Subscription {
  [INTERNAL_SEQ]?: number;
  [FETCH_TOKEN]?: string;
}

/* ===== 8. Logger (satisfies mapped record) ===== */

const Logger = {
  info(msg: string): void {
    console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  },
  warn(msg: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  },
  error(msg: string): void {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  },
} satisfies Record<LogLevel, (msg: string) => void>;

/* ===== 9. State persistence ===== */

const STATE_FILE = path.join(os.homedir(), ".rss-feeds.json");

function loadState(): State {
  if (!fs.existsSync(STATE_FILE))
    return { subscriptions: [], items: [], meta: {} };
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const data = JSON.parse(raw) as Partial<State>;
    return {
      subscriptions: Array.isArray(data.subscriptions)
        ? (data.subscriptions as Subscription[])
        : [],
      items: Array.isArray(data.items) ? (data.items as FeedItem[]) : [],
      meta: data.meta && typeof data.meta === "object" ? data.meta : {},
    };
  } catch (err) {
    Logger.warn(
      "状态文件解析失败，使用空状态: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return { subscriptions: [], items: [], meta: {} };
  }
}

function saveState(state: State): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    throw new IoError(
      "保存状态失败: " + (err instanceof Error ? err.message : String(err)),
    );
  }
}

/* ===== 10. Minimal XML parser ===== */

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXml(xml: string): XmlNode {
  let src = xml.replace(/<\?[^>]*\?>/g, "");
  src = src.replace(/<!--[\s\S]*?-->/g, "");
  src = src.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c) =>
    escapeXmlText(String(c)),
  );
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < src.length) {
    if (src[i] === "<") {
      if (src[i + 1] === "/") {
        const end = src.indexOf(">", i);
        if (end === -1) break;
        const name = src.substring(i + 2, end).trim();
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].name === name) {
            stack.length = j;
            break;
          }
        }
        i = end + 1;
        continue;
      }
      const end = src.indexOf(">", i);
      if (end === -1) break;
      let tagContent = src.substring(i + 1, end);
      const selfClosing = tagContent.endsWith("/");
      if (selfClosing) tagContent = tagContent.slice(0, -1).trim();
      const spaceIdx = tagContent.search(/\s/);
      const name =
        spaceIdx === -1 ? tagContent : tagContent.substring(0, spaceIdx);
      const attrsStr =
        spaceIdx === -1 ? "" : tagContent.substring(spaceIdx + 1).trim();
      const node: XmlNode = {
        name,
        attrs: parseAttrs(attrsStr),
        children: [],
        text: "",
      };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = end + 1;
      continue;
    }
    const nextTag = src.indexOf("<", i);
    const textEnd = nextTag === -1 ? src.length : nextTag;
    const text = src.substring(i, textEnd).trim();
    if (text) {
      const top = stack[stack.length - 1];
      top.text += (top.text ? " " : "") + unescapeXmlText(text);
    }
    i = textEnd;
  }
  return root;
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w:-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&amp;/g, "&");
}

function findChild(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

function findChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/* ===== 11. Utility helpers ===== */

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ===== 12. Type guards ===== */

function isRssFeed(feed: ParsedFeed): feed is RssFeed {
  return feed.type === FeedType.Rss;
}
function isAtomFeed(feed: ParsedFeed): feed is AtomFeed {
  return feed.type === FeedType.Atom;
}
function isRssError(err: unknown): err is RssError {
  return err instanceof RssError;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/* ===== 13. Abstract feed parser + concrete subclasses (generic w/ constraints) ===== */

abstract class AbstractFeedParser<T extends ParsedFeed = ParsedFeed> {
  abstract readonly supportedType: FeedType;
  abstract parse(xml: string, url: string): T;
  protected extractTitle(node: XmlNode, fallback: string): string {
    return findChild(node, "title")?.text ?? fallback;
  }
  protected makeItem(
    node: XmlNode,
    feedUrl: string,
    feedTitle: string,
    title: string,
    link: string,
    pubDate: string | null,
    description: string,
    guid: string,
  ): FeedItemData {
    return {
      id: hashId(feedUrl + "|" + guid),
      feedUrl,
      feedTitle,
      title,
      link,
      pubDate,
      description: stripHtml(description).slice(0, 300),
      guid,
    } satisfies FeedItemData;
  }
}

class RssParser extends AbstractFeedParser<RssFeed> {
  readonly supportedType = FeedType.Rss;
  canHandle(root: XmlNode): boolean {
    return findChild(root, "rss") !== null;
  }
  parse(xml: string, url: string): RssFeed {
    const root = parseXml(xml);
    const rssNode = findChild(root, "rss");
    const channel = rssNode ? findChild(rssNode, "channel") : null;
    if (!channel) throw new InvalidFeedError("RSS 缺少 channel 节点", { url });
    const feedTitle = this.extractTitle(channel, url);
    const items: FeedItemData[] = [];
    for (const node of findChildren(channel, "item")) {
      const title = findChild(node, "title")?.text ?? "(无标题)";
      const link = findChild(node, "link")?.text ?? "";
      const pubDate =
        findChild(node, "pubDate")?.text ??
        findChild(node, "dc:date")?.text ??
        null;
      const description = findChild(node, "description")?.text ?? "";
      const guid = (findChild(node, "guid")?.text ?? link) || title;
      items.push(
        this.makeItem(
          node,
          url,
          feedTitle,
          title,
          link,
          pubDate,
          description,
          guid,
        ),
      );
    }
    return { type: FeedType.Rss, title: feedTitle, url, items };
  }
}

class AtomParser extends AbstractFeedParser<AtomFeed> {
  readonly supportedType = FeedType.Atom;
  canHandle(root: XmlNode): boolean {
    return findChild(root, "feed") !== null;
  }
  parse(xml: string, url: string): AtomFeed {
    const root = parseXml(xml);
    const atomFeed = findChild(root, "feed");
    if (!atomFeed) throw new InvalidFeedError("Atom 缺少 feed 节点", { url });
    const feedTitle = this.extractTitle(atomFeed, url);
    const items: FeedItemData[] = [];
    for (const entry of findChildren(atomFeed, "entry")) {
      const title = findChild(entry, "title")?.text ?? "(无标题)";
      const linkNode =
        findChildren(entry, "link").find((l) => l.attrs.rel === "alternate") ||
        findChildren(entry, "link")[0];
      const link = linkNode?.attrs.href ?? "";
      const pubDate =
        findChild(entry, "published")?.text ??
        findChild(entry, "updated")?.text ??
        null;
      const description =
        findChild(entry, "summary")?.text ??
        findChild(entry, "content")?.text ??
        "";
      const guid = (findChild(entry, "id")?.text ?? link) || title;
      items.push(
        this.makeItem(
          entry,
          url,
          feedTitle,
          title,
          link,
          pubDate,
          description,
          guid,
        ),
      );
    }
    return { type: FeedType.Atom, title: feedTitle, url, items };
  }
}

const PARSERS = [new RssParser(), new AtomParser()] as const;

function parseFeed(xml: string, feedUrl: string): ParsedFeed {
  const root = parseXml(xml);
  for (const parser of PARSERS) {
    if (parser.canHandle(root)) return parser.parse(xml, feedUrl);
  }
  return {
    type: FeedType.Unknown,
    title: feedUrl,
    url: feedUrl,
    items: [],
  } satisfies UnknownFeed;
}

/* ===== 14. Generic Subscription Manager with iterators ===== */

class SubscriptionManager<T extends Subscription> {
  private _items: T[] = [];
  private _seq = 0;
  constructor(initial: T[] = []) {
    for (const item of initial) this.add(item);
  }
  get count(): number {
    return this._items.length;
  }
  get items(): readonly T[] {
    return this._items;
  }
  add(item: T): void {
    const tracked = item as TrackedSubscription;
    if (tracked[INTERNAL_SEQ] === undefined)
      tracked[INTERNAL_SEQ] = this._seq++;
    if (!this._items.find((s) => s.url === item.url)) this._items.push(item);
  }
  remove(url: string): T | undefined {
    const idx = this._items.findIndex((s) => s.url === url);
    if (idx === -1) return undefined;
    const [removed] = this._items.splice(idx, 1);
    return removed;
  }
  find(url: string): T | undefined {
    return this._items.find((s) => s.url === url);
  }
  *[Symbol.iterator](): Iterator<T> {
    for (const item of this._items) yield item;
  }
  *withUnread(items: FeedItem[]): Generator<readonly [T, number]> {
    for (const sub of this._items) {
      const unread = items.filter(
        (it) => it.feedUrl === sub.url && it.status !== ItemStatus.Read,
      ).length;
      yield [sub, unread] as const;
    }
  }
  toArray(): T[] {
    return [...this._items];
  }
}

/* ===== 15. FeedItem wrapper with getters/setters ===== */

class FeedItemImpl {
  private _status: ItemStatus = ItemStatus.Unread;
  constructor(private _data: FeedItemData) {}
  get data(): FeedItemData {
    return this._data;
  }
  get id(): string {
    return this._data.id;
  }
  get title(): string {
    return this._data.title;
  }
  get status(): ItemStatus {
    return this._status;
  }
  set status(value: ItemStatus) {
    if (value < ItemStatus.Unread || value > ItemStatus.Archived) {
      throw new RangeError("Invalid ItemStatus: " + value);
    }
    this._status = value;
  }
  get isRead(): boolean {
    return this._status === ItemStatus.Read;
  }
  get isUnread(): boolean {
    return this._status === ItemStatus.Unread;
  }
  markRead(): void {
    this._status = ItemStatus.Read;
  }
}

/* ===== 16. HTTP fetcher returning readonly tuple [status, body] ===== */

type HttpResult = readonly [number, string];

function fetchUrl(url: string, redirectCount = 0): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(
        new InvalidUrlError(
          "URL 无效: " + (err instanceof Error ? err.message : String(err)),
          { url },
        ),
      );
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new InvalidUrlError("不支持的协议: " + parsed.protocol, { url }));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers: { "User-Agent": CONFIG.userAgent, Accept: CONFIG.accept },
        timeout: CONFIG.timeout,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectCount >= CONFIG.maxRedirects) {
            reject(
              new RedirectError("重定向次数过多", {
                url,
                count: redirectCount,
              }),
            );
            res.resume();
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fetchUrl(nextUrl, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(
            new NetworkError(`HTTP ${res.statusCode}`, {
              url,
              status: res.statusCode,
            }),
          );
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve([
            res.statusCode ?? 200,
            Buffer.concat(chunks).toString("utf8"),
          ] as const),
        );
        res.on("error", (e) =>
          reject(new NetworkError("响应错误: " + e.message, { url })),
        );
      },
    );
    req.on("error", (e) =>
      reject(new NetworkError("请求错误: " + e.message, { url })),
    );
    req.on("timeout", () => {
      req.destroy(new Error("请求超时"));
      reject(new TimeoutError("请求超时", { url, timeout: CONFIG.timeout }));
    });
  });
}

/* ===== 17. Function overloads for getItem ===== */

function getItem(state: State, id: string): FeedItem | undefined;
function getItem(
  state: State,
  predicate: (item: FeedItem) => boolean,
): FeedItem[];
function getItem(
  state: State,
  arg: string | ((item: FeedItem) => boolean),
): FeedItem | FeedItem[] | undefined {
  if (typeof arg === "string") return state.items.find((it) => it.id === arg);
  return state.items.filter(arg);
}

/* ===== 18. Generators for items & subscriptions ===== */

function* iterateItems(
  state: State,
  filter?: (it: FeedItem) => boolean,
): Generator<FeedItem> {
  for (const item of state.items) if (!filter || filter(item)) yield item;
}
function* iterateUnread(state: State): Generator<FeedItem> {
  yield* iterateItems(state, (it) => it.status !== ItemStatus.Read);
}
function* iterateSubscriptions(state: State): Generator<Subscription> {
  for (const sub of state.subscriptions) yield sub;
}

/* ===== 19. Commands ===== */

function cmdAdd(state: State, url: string): void {
  if (state.subscriptions.find((s) => s.url === url)) {
    Logger.warn("已经订阅过该源");
    return;
  }
  Logger.info(`抓取以获取标题: ${url}`);
  fetchUrl(url)
    .then(([, body]) => {
      const feed = parseFeed(body, url);
      state.subscriptions.push({
        url,
        title: feed.title,
        addedAt: new Date().toISOString(),
        lastFetchedAt: null,
        fetchCount: 0,
      });
      saveState(state);
      Logger.info(`已订阅: ${feed.title} (${url}) [${feed.type}]`);
    })
    .catch((err: unknown) => {
      Logger.error(
        "订阅失败: " + (isRssError(err) ? err.message : String(err)),
      );
      state.subscriptions.push({
        url,
        title: url,
        addedAt: new Date().toISOString(),
        lastFetchedAt: null,
        fetchCount: 0,
      });
      saveState(state);
      Logger.info(`已订阅 (标题未知): ${url}`);
    });
}

function cmdList(state: State): void {
  if (state.subscriptions.length === 0) {
    console.log("暂无订阅");
    return;
  }
  const manager = new SubscriptionManager<Subscription>(state.subscriptions);
  console.log("\n订阅列表 (" + manager.count + "):");
  let i = 1;
  for (const [sub, unread] of manager.withUnread(state.items)) {
    console.log(`  ${i++}. \x1b[36m${sub.title}\x1b[0m`);
    console.log(`     ${sub.url}`);
    console.log(
      `     添加时间: ${sub.addedAt}  | 未读: ${unread}  | 抓取次数: ${sub.fetchCount}`,
    );
  }
  console.log("");
}

async function cmdFetch(state: State, url?: string): Promise<void> {
  const targets = url
    ? state.subscriptions.filter((s) => s.url === url)
    : state.subscriptions;
  if (targets.length === 0) {
    Logger.warn("没有匹配的订阅");
    return;
  }
  let totalNew = 0;
  for (const sub of targets) {
    try {
      Logger.info(`抓取: ${sub.title}`);
      const [, body] = await fetchUrl(sub.url);
      const feed = parseFeed(body, sub.url);
      let added = 0;
      for (const item of feed.items) {
        if (!state.items.find((it) => it.id === item.id)) {
          state.items.push({ ...item, status: ItemStatus.Unread });
          added++;
          totalNew++;
        }
      }
      sub.lastFetchedAt = new Date().toISOString();
      sub.fetchCount = (sub.fetchCount ?? 0) + 1;
      Logger.info(
        `  新增 ${added} 条，共 ${feed.items.length} 条 [${feed.type}]`,
      );
    } catch (err) {
      const msg = isRssError(err)
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
      Logger.error("  抓取失败: " + msg);
    }
  }
  state.items.sort((a, b) => (b.pubDate ?? "").localeCompare(a.pubDate ?? ""));
  if (state.items.length > CONFIG.maxItems)
    state.items = state.items.slice(0, CONFIG.maxItems);
  saveState(state);
  Logger.info(`完成，共新增 ${totalNew} 条`);
}

function cmdUnread(state: State, showAll: boolean): void {
  const filter = (it: FeedItem) => showAll || it.status !== ItemStatus.Read;
  const items = [...iterateItems(state, filter)];
  if (items.length === 0) {
    console.log("没有未读条目");
    return;
  }
  console.log(`\n${showAll ? "所有" : "未读"}条目 (${items.length}):\n`);
  items.slice(0, 50).forEach((it) => {
    const mark = it.status === ItemStatus.Read ? " " : "*";
    console.log(`${mark} [\x1b[33m${it.id}\x1b[0m] ${it.title}`);
    console.log(`    ${it.feedTitle}  |  ${it.pubDate ?? "无日期"}`);
    if (it.link) console.log(`    ${it.link}`);
    if (it.description)
      console.log(
        `    ${it.description.slice(0, 120)}${it.description.length > 120 ? "..." : ""}`,
      );
    console.log("");
  });
}

function cmdMarkRead(state: State, id: string): void {
  const item = getItem(state, id);
  if (!item) {
    Logger.error("未找到该条目: " + id);
    return;
  }
  item.status = ItemStatus.Read;
  saveState(state);
  Logger.info("已标记为已读: " + item.title);
}

function cmdRemove(state: State, url: string): void {
  const before = state.subscriptions.length;
  state.subscriptions = state.subscriptions.filter((s) => s.url !== url);
  state.items = state.items.filter((it) => it.feedUrl !== url);
  saveState(state);
  if (state.subscriptions.length < before) Logger.info("已取消订阅: " + url);
  else Logger.warn("未找到该订阅");
}

function cmdExport(state: State, file: string): void {
  const outlines = [...iterateSubscriptions(state)]
    .map(
      (s) =>
        `    <outline type="rss" text="${escapeAttr(s.title)}" title="${escapeAttr(s.title)}" xmlUrl="${escapeAttr(s.url)}" htmlUrl="${escapeAttr(s.url)}" />`,
    )
    .join("\n");
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS 订阅</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>`;
  try {
    fs.writeFileSync(file, opml, "utf8");
    Logger.info(
      `已导出 OPML 到 ${file} (${state.subscriptions.length} 个订阅)`,
    );
  } catch (err) {
    throw new IoError(
      "导出失败: " + (err instanceof Error ? err.message : String(err)),
      { file },
    );
  }
}

/* ===== 20. Argument parsing (Command enum + readonly tuple return) ===== */

type ParsedArgs = readonly [Command | "", string[], boolean];

function parseArgs(argv: string[]): ParsedArgs {
  const a = argv.slice(2);
  if (a.length === 0) return ["", [], false] as const;
  if (a[0] === "-h" || a[0] === "--help") return ["", [], true] as const;
  const raw = a[0] as Command;
  const alias = (COMMAND_ALIASES as Record<string, Command>)[raw];
  const cmd = alias ?? (Object.values(Command).includes(raw) ? raw : "");
  return [cmd, a.slice(1), false] as const;
}

function printHelp(): void {
  console.log(`
RSS 阅读器 - 使用说明

用法:
  rss-reader <command> [args]

命令:
  add <url>           订阅一个 RSS / Atom 源
  list                列出所有订阅
  fetch [url]         抓取最新条目 (不指定 url 则抓取全部)
  fetch-all           抓取所有订阅源
  unread [--all]      显示未读条目 (--all 显示所有)
  mark-read <id>      标记某条目为已读
  remove <url>        取消订阅
  export [file]       导出 OPML (默认 ./subscriptions.opml)
  -h, --help          显示帮助

配置文件: ${STATE_FILE}
`);
}

/* ===== 21. Main dispatcher (Command enum) ===== */

function dispatch(command: Command | "", args: string[], state: State): void {
  switch (command) {
    case Command.Add:
      if (!args[0]) {
        Logger.error("请提供 URL");
        process.exit(1);
      }
      cmdAdd(state, args[0]);
      break;
    case Command.List:
      cmdList(state);
      break;
    case Command.Fetch:
      cmdFetch(state, args[0]).catch((e: unknown) =>
        Logger.error(isRssError(e) ? e.message : String(e)),
      );
      break;
    case Command.FetchAll:
      cmdFetch(state).catch((e: unknown) =>
        Logger.error(isRssError(e) ? e.message : String(e)),
      );
      break;
    case Command.Unread:
      cmdUnread(state, args.includes("--all"));
      break;
    case Command.MarkRead:
      if (!args[0]) {
        Logger.error("请提供条目 ID");
        process.exit(1);
      }
      cmdMarkRead(state, args[0]);
      break;
    case Command.Remove:
      if (!args[0]) {
        Logger.error("请提供 URL");
        process.exit(1);
      }
      cmdRemove(state, args[0]);
      break;
    case Command.Export:
      cmdExport(
        state,
        args[0] ?? path.resolve(process.cwd(), "subscriptions.opml"),
      );
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

function main(): void {
  const [command, args, help] = parseArgs(process.argv);
  if (help) {
    printHelp();
    process.exit(0);
    return;
  }
  const state = loadState();
  dispatch(command, args, state);
}

// Type-level references to keep advanced type aliases / guards / errors in scope.
type _TypeSurface = [
  FeedKey,
  CommandKey,
  ArrayElement<readonly FeedItemData[]>,
  Nullable<{ a: number }>,
  DeepReadonly<State>,
  StatusFlag<ItemStatus.Read>,
  PickFields<FeedItemData, "id" | "title">,
];
const _pick: PickFields<FeedItemData, "id" | "title"> = { id: "x", title: "y" };
const _strArr: string[] = isStringArray(["x"]) ? ["x"] : [];
const _errClasses = [ParseError, NotFoundError] as const;
const _surfaceRef: _TypeSurface | undefined = undefined;
void _surfaceRef;
void _pick;
void _strArr;
void _errClasses;

main();
