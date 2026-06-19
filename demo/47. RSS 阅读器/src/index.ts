#!/usr/bin/env node
/**
 * 47. RSS 阅读器
 * ----------------------------------------------------
 * 订阅、抓取、解析 RSS 2.0 / Atom 订阅源 (手动 XML 解析)。
 *
 * 命令:
 *   add <url>           订阅一个源 (保存到 ~/.rss-feeds.json)
 *   list                列出所有订阅
 *   fetch [url]         抓取最新条目 (单源或全部)
 *   fetch-all           抓取所有订阅源
 *   unread              显示未读条目
 *   mark-read <id>      标记某条目为已读
 *   export [file]       导出 OPML
 *   remove <url>        取消订阅
 *   -h, --help          帮助
 *
 * 仅使用 Node.js 内置模块。
 */

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';

interface Subscription {
  url: string;
  title: string;
  addedAt: string;
  lastFetchedAt: string | null;
}

interface FeedItem {
  id: string; // url + guid 哈希
  feedUrl: string;
  feedTitle: string;
  title: string;
  link: string;
  pubDate: string | null;
  description: string;
  guid: string;
  read: boolean;
}

interface State {
  subscriptions: Subscription[];
  items: FeedItem[];
}

const STATE_FILE = path.join(os.homedir(), '.rss-feeds.json');

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
};

/** 加载状态 */
function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) {
    return { subscriptions: [], items: [] };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return { subscriptions: [], items: [] };
  }
}

/** 保存状态 */
function saveState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/** 简易 XML 节点结构 */
interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

/** 解析 XML (基于正则与状态机的极简实现) */
function parseXml(xml: string): XmlNode {
  // 移除注释、声明、CDATA 标记的简化处理
  let src = xml.replace(/<\?[^>]*\?>/g, '');
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  // CDATA 转为普通文本
  src = src.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c) => escapeXmlText(c));

  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '<') {
      // 结束标签
      if (src[i + 1] === '/') {
        const end = src.indexOf('>', i);
        if (end === -1) break;
        const name = src.substring(i + 2, end).trim();
        // 弹栈直到匹配
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].name === name) {
            stack.length = j;
            break;
          }
        }
        i = end + 1;
        continue;
      }
      // 开始标签
      const end = src.indexOf('>', i);
      if (end === -1) break;
      let tagContent = src.substring(i + 1, end);
      const selfClosing = tagContent.endsWith('/');
      if (selfClosing) tagContent = tagContent.slice(0, -1).trim();
      const spaceIdx = tagContent.search(/\s/);
      const name = spaceIdx === -1 ? tagContent : tagContent.substring(0, spaceIdx);
      const attrsStr = spaceIdx === -1 ? '' : tagContent.substring(spaceIdx + 1).trim();
      const attrs = parseAttrs(attrsStr);
      const node: XmlNode = { name, attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) {
        stack.push(node);
      }
      i = end + 1;
      continue;
    }
    // 文本
    const nextTag = src.indexOf('<', i);
    const textEnd = nextTag === -1 ? src.length : nextTag;
    const text = src.substring(i, textEnd).trim();
    if (text) {
      stack[stack.length - 1].text += (stack[stack.length - 1].text ? ' ' : '') + unescapeXmlText(text);
    }
    i = textEnd;
  }
  return root;
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w:-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&amp;/g, '&');
}

/** 在节点树中查找第一个指定名称的子节点 */
function findChild(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (c.name === name) return c;
  }
  return null;
}

/** 查找所有指定名称的子节点 */
function findChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/** 递归查找任意层级的节点 (用于 channel/item 与 feed/entry) */
function findAllByPath(node: XmlNode, names: string[]): XmlNode[] {
  if (names.length === 0) return [node];
  const [head, ...rest] = names;
  const result: XmlNode[] = [];
  for (const c of node.children) {
    if (c.name === head) {
      result.push(...findAllByPath(c, rest));
    } else {
      // 也递归搜索子树
      result.push(...findAllByPath(c, names));
    }
  }
  return result;
}

/** 抓取 URL 内容 */
function fetchUrl(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(new Error('URL 无效: ' + (err instanceof Error ? err.message : String(err))));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (TypeScript RSS Reader Demo 47)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectCount >= 5) {
            reject(new Error('重定向次数过多'));
            res.resume();
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fetchUrl(nextUrl, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
  });
}

/** 解析 RSS 2.0 / Atom feed */
function parseFeed(xml: string, feedUrl: string): { title: string; items: Omit<FeedItem, 'read'>[] } {
  const root = parseXml(xml);

  // RSS 2.0: rss > channel
  const channel = findChild(root, 'rss') ? findChild(findChild(root, 'rss')!, 'channel') : null;
  if (channel) {
    const feedTitle = findChild(channel, 'title')?.text ?? feedUrl;
    const items: Omit<FeedItem, 'read'>[] = [];
    const itemNodes = findChildren(channel, 'item');
    for (const node of itemNodes) {
      const title = findChild(node, 'title')?.text ?? '(无标题)';
      const link = findChild(node, 'link')?.text ?? '';
      const pubDate = findChild(node, 'pubDate')?.text ?? findChild(node, 'dc:date')?.text ?? null;
      const description = findChild(node, 'description')?.text ?? '';
      const guid = (findChild(node, 'guid')?.text ?? link) || title;
      items.push({
        id: hashId(feedUrl + '|' + guid),
        feedUrl,
        feedTitle,
        title,
        link,
        pubDate,
        description: stripHtml(description).slice(0, 300),
        guid,
      });
    }
    return { title: feedTitle, items };
  }

  // Atom: feed
  const atomFeed = findChild(root, 'feed');
  if (atomFeed) {
    const feedTitle = findChild(atomFeed, 'title')?.text ?? feedUrl;
    const items: Omit<FeedItem, 'read'>[] = [];
    const entries = findChildren(atomFeed, 'entry');
    for (const entry of entries) {
      const title = findChild(entry, 'title')?.text ?? '(无标题)';
      const linkNode = findChildren(entry, 'link').find((l) => l.attrs.rel === 'alternate') ||
        findChildren(entry, 'link')[0];
      const link = linkNode?.attrs.href ?? '';
      const pubDate = findChild(entry, 'published')?.text ?? findChild(entry, 'updated')?.text ?? null;
      const description = findChild(entry, 'summary')?.text ?? findChild(entry, 'content')?.text ?? '';
      const guid = (findChild(entry, 'id')?.text ?? link) || title;
      items.push({
        id: hashId(feedUrl + '|' + guid),
        feedUrl,
        feedTitle,
        title,
        link,
        pubDate,
        description: stripHtml(description).slice(0, 300),
        guid,
      });
    }
    return { title: feedTitle, items };
  }

  throw new Error('未识别的 Feed 格式 (非 RSS 2.0 也非 Atom)');
}

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
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 命令: add */
function cmdAdd(state: State, url: string): void {
  if (state.subscriptions.find((s) => s.url === url)) {
    Logger.warn('已经订阅过该源');
    return;
  }
  Logger.info(`抓取以获取标题: ${url}`);
  fetchUrl(url)
    .then((xml) => {
      const { title } = parseFeed(xml, url);
      state.subscriptions.push({
        url,
        title,
        addedAt: new Date().toISOString(),
        lastFetchedAt: null,
      });
      saveState(state);
      Logger.info(`已订阅: ${title} (${url})`);
    })
    .catch((err) => {
      Logger.error('订阅失败: ' + (err instanceof Error ? err.message : String(err)));
      // 即使抓取失败，仍可保留
      state.subscriptions.push({
        url,
        title: url,
        addedAt: new Date().toISOString(),
        lastFetchedAt: null,
      });
      saveState(state);
      Logger.info(`已订阅 (标题未知): ${url}`);
    });
}

/** 命令: list */
function cmdList(state: State): void {
  if (state.subscriptions.length === 0) {
    console.log('暂无订阅');
    return;
  }
  console.log('\n订阅列表 (' + state.subscriptions.length + '):');
  state.subscriptions.forEach((s, i) => {
    const unreadCount = state.items.filter((it) => it.feedUrl === s.url && !it.read).length;
    console.log(`  ${i + 1}. \x1b[36m${s.title}\x1b[0m`);
    console.log(`     ${s.url}`);
    console.log(`     添加时间: ${s.addedAt}  | 未读: ${unreadCount}`);
  });
  console.log('');
}

/** 命令: fetch */
async function cmdFetch(state: State, url?: string): Promise<void> {
  const targets = url
    ? state.subscriptions.filter((s) => s.url === url)
    : state.subscriptions;
  if (targets.length === 0) {
    Logger.warn('没有匹配的订阅');
    return;
  }
  let totalNew = 0;
  for (const sub of targets) {
    try {
      Logger.info(`抓取: ${sub.title}`);
      const xml = await fetchUrl(sub.url);
      const { items } = parseFeed(xml, sub.url);
      let added = 0;
      for (const item of items) {
        if (!state.items.find((it) => it.id === item.id)) {
          state.items.push({ ...item, read: false });
          added++;
          totalNew++;
        }
      }
      sub.lastFetchedAt = new Date().toISOString();
      Logger.info(`  新增 ${added} 条，共 ${items.length} 条`);
    } catch (err) {
      Logger.error('  抓取失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
  // 仅保留最近 500 条
  state.items.sort((a, b) => (b.pubDate ?? '').localeCompare(a.pubDate ?? ''));
  if (state.items.length > 500) {
    state.items = state.items.slice(0, 500);
  }
  saveState(state);
  Logger.info(`完成，共新增 ${totalNew} 条`);
}

/** 命令: unread */
function cmdUnread(state: State, showAll: boolean): void {
  const items = state.items.filter((it) => showAll || !it.read);
  if (items.length === 0) {
    console.log('没有未读条目');
    return;
  }
  console.log(`\n${showAll ? '所有' : '未读'}条目 (${items.length}):\n`);
  items.slice(0, 50).forEach((it, i) => {
    const mark = it.read ? ' ' : '*';
    console.log(`${mark} [\x1b[33m${it.id}\x1b[0m] ${it.title}`);
    console.log(`    ${it.feedTitle}  |  ${it.pubDate ?? '无日期'}`);
    if (it.link) console.log(`    ${it.link}`);
    if (it.description) console.log(`    ${it.description.slice(0, 120)}${it.description.length > 120 ? '...' : ''}`);
    console.log('');
  });
}

/** 命令: mark-read */
function cmdMarkRead(state: State, id: string): void {
  const item = state.items.find((it) => it.id === id);
  if (!item) {
    Logger.error('未找到该条目: ' + id);
    return;
  }
  item.read = true;
  saveState(state);
  Logger.info('已标记为已读: ' + item.title);
}

/** 命令: remove */
function cmdRemove(state: State, url: string): void {
  const before = state.subscriptions.length;
  state.subscriptions = state.subscriptions.filter((s) => s.url !== url);
  state.items = state.items.filter((it) => it.feedUrl !== url);
  saveState(state);
  if (state.subscriptions.length < before) {
    Logger.info('已取消订阅: ' + url);
  } else {
    Logger.warn('未找到该订阅');
  }
}

/** 命令: export OPML */
function cmdExport(state: State, file: string): void {
  const items = state.subscriptions
    .map(
      (s) =>
        `    <outline type="rss" text="${escapeAttr(s.title)}" title="${escapeAttr(s.title)}" xmlUrl="${escapeAttr(s.url)}" htmlUrl="${escapeAttr(s.url)}" />`
    )
    .join('\n');
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS 订阅</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${items}
  </body>
</opml>`;
  fs.writeFileSync(file, opml, 'utf8');
  Logger.info(`已导出 OPML 到 ${file} (${state.subscriptions.length} 个订阅)`);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 解析参数 */
function parseArgs(argv: string[]): { command: string; args: string[]; help: boolean } {
  const a = argv.slice(2);
  if (a.length === 0) return { command: '', args: [], help: false };
  if (a[0] === '-h' || a[0] === '--help') return { command: '', args: [], help: true };
  return { command: a[0], args: a.slice(1), help: false };
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

/** 主函数 */
function main(): void {
  const { command, args, help } = parseArgs(process.argv);
  if (help) {
    printHelp();
    process.exit(0);
    return;
  }

  const state = loadState();

  switch (command) {
    case 'add':
      if (!args[0]) {
        Logger.error('请提供 URL');
        process.exit(1);
      }
      cmdAdd(state, args[0]);
      break;
    case 'list':
      cmdList(state);
      break;
    case 'fetch':
      cmdFetch(state, args[0]).catch((e) => Logger.error(String(e)));
      break;
    case 'fetch-all':
      cmdFetch(state).catch((e) => Logger.error(String(e)));
      break;
    case 'unread':
      cmdUnread(state, args.includes('--all'));
      break;
    case 'mark-read':
      if (!args[0]) {
        Logger.error('请提供条目 ID');
        process.exit(1);
      }
      cmdMarkRead(state, args[0]);
      break;
    case 'remove':
      if (!args[0]) {
        Logger.error('请提供 URL');
        process.exit(1);
      }
      cmdRemove(state, args[0]);
      break;
    case 'export':
      cmdExport(state, args[0] ?? path.resolve(process.cwd(), 'subscriptions.opml'));
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

main();
