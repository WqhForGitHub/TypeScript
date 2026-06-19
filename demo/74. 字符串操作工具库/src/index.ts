#!/usr/bin/env node
/**
 * 字符串操作工具库 (String Utils)
 * -------------------------------------------------------------
 * 提供大量字符串处理函数，全部为纯函数，仅依赖 Node.js 内置 crypto 模块。
 *
 * 公开 API (命名空间导出 `s`):
 *   - 大小写: camelCase, kebabCase, snakeCase, pascalCase, capitalize, titleCase
 *   - 截断/填充: truncate, pad (left/right/center)
 *   - HTML: stripTags, escapeHtml, unescapeHtml
 *   - 处理: slugify, template, wordWrap, reverse, repeat, chop, between, strip, only
 *   - 匹配: contains, fuzzyMatch, levenshtein, similarity
 *   - 统计: wordCount, charCount
 *   - 随机/掩码: random, mask
 *   - 复数: pluralize, singularize
 *
 * 仅依赖 Node.js 内置模块: crypto.
 */

import crypto from 'crypto';

/** 拆分单词（支持驼峰、下划线、连字符、空格） */
function words(str: string): string[] {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** 转为驼峰 */
export function camelCase(str: string): string {
  const w = words(str);
  return w
    .map((word, i) =>
      i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('');
}

/** 转为短横线小写 */
export function kebabCase(str: string): string {
  return words(str)
    .map((w) => w.toLowerCase())
    .join('-');
}

/** 转为下划线小写 */
export function snakeCase(str: string): string {
  return words(str)
    .map((w) => w.toLowerCase())
    .join('_');
}

/** 转为帕斯卡（大驼峰） */
export function pascalCase(str: string): string {
  const w = words(str);
  return w
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/** 首字母大写 */
export function capitalize(str: string): string {
  return str.length === 0 ? str : str.charAt(0).toUpperCase() + str.slice(1);
}

/** 标题大小写（每个单词首字母大写） */
export function titleCase(str: string): string {
  return words(str)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** 截断字符串并附加省略号 */
export function truncate(str: string, maxLen: number, ellipsis = '...'): string {
  if (str.length <= maxLen) return str;
  const cut = Math.max(0, maxLen - ellipsis.length);
  return str.slice(0, cut) + ellipsis;
}

/** 填充字符串到指定长度 */
export function pad(
  str: string,
  len: number,
  mode: 'left' | 'right' | 'center' = 'left',
  char = ' '
): string {
  if (str.length >= len) return str;
  const padLen = len - str.length;
  if (mode === 'left') return char.repeat(padLen) + str;
  if (mode === 'right') return str + char.repeat(padLen);
  const left = Math.floor(padLen / 2);
  const right = padLen - left;
  return char.repeat(left) + str + char.repeat(right);
}

/** 去除 HTML 标签 */
export function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

/** HTML 转义 */
export function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

/** HTML 反转义 */
export function unescapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'",
  };
  return str.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => map[m] ?? m);
}

/** 生成 URL slug */
export function slugify(str: string): string {
  return str
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 简易模板插值 {{var}} / {{nested.path}} */
export function template(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const paths = expr.trim().split('.');
    let cur: unknown = data;
    for (const p of paths) {
      if (cur && typeof cur === 'object' && p in (cur as object)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return '';
      }
    }
    return cur === null || cur === undefined ? '' : String(cur);
  });
}

/** Levenshtein 编辑距离 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 相似度 0-1 */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/** 是否包含（大小写不敏感可选） */
export function contains(haystack: string, needle: string, ignoreCase = false): boolean {
  if (ignoreCase) {
    return haystack.toLowerCase().includes(needle.toLowerCase());
  }
  return haystack.includes(needle);
}

/** 模糊匹配（基于子序列） */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let i = 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

/** 按指定宽度换行 */
export function wordWrap(str: string, width: number, indent = ''): string {
  const lines: string[] = [];
  let line = '';
  for (const word of str.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join('\n');
}

/** 单词计数 */
export function wordCount(str: string): number {
  return words(str).length;
}

/** 字符计数（不计空白可选） */
export function charCount(str: string, ignoreWhitespace = false): number {
  return ignoreWhitespace ? str.replace(/\s/g, '').length : str.length;
}

/** 反转字符串 */
export function reverse(str: string): string {
  // 处理 surrogate pair
  return Array.from(str).reverse().join('');
}

/** 重复 n 次 */
export function repeat(str: string, n: number): string {
  if (n <= 0) return '';
  return str.repeat(n);
}

/** 切分为等长块 */
export function chop(str: string, size: number): string[] {
  if (size <= 0) return [str];
  const out: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    out.push(str.slice(i, i + size));
  }
  return out;
}

/** 提取两个字符串之间的内容 */
export function between(str: string, start: string, end: string): string {
  const s = str.indexOf(start);
  if (s === -1) return '';
  const startIdx = s + start.length;
  const e = str.indexOf(end, startIdx);
  if (e === -1) return str.slice(startIdx);
  return str.slice(startIdx, e);
}

/** 删除指定字符集 */
export function strip(str: string, chars: string): string {
  const set = new Set(Array.from(chars));
  return Array.from(str)
    .filter((c) => !set.has(c))
    .join('');
}

/** 仅保留指定字符集 */
export function only(str: string, chars: string): string {
  const set = new Set(Array.from(chars));
  return Array.from(str)
    .filter((c) => set.has(c))
    .join('');
}

/** 生成随机字符串 */
export function random(length = 16, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += charset[bytes[i] % charset.length];
  }
  return out;
}

/** 掩码，例如信用卡 4111111111111111 -> 4111********1111 */
export function mask(str: string, visibleStart = 4, visibleEnd = 4, maskChar = '*'): string {
  if (str.length <= visibleStart + visibleEnd) {
    return maskChar.repeat(str.length);
  }
  const start = str.slice(0, visibleStart);
  const end = str.slice(str.length - visibleEnd);
  const middle = maskChar.repeat(str.length - visibleStart - visibleEnd);
  return start + middle + end;
}

// ---------- 简单复数处理 ----------

const pluralRules: Array<{ re: RegExp; to: string }> = [
  { re: /(quiz)$/i, to: '$1zes' },
  { re: /^(ox)$/i, to: '$1en' },
  { re: /([m|l])ouse$/i, to: '$1ice' },
  { re: /(matr|vert|ind)(ix|ex)$/i, to: '$1ices' },
  { re: /(x|ch|ss|sh)$/i, to: '$1es' },
  { re: /([^aeiouy]|qu)y$/i, to: '$1ies' },
  { re: /(hive)$/i, to: '$1s' },
  { re: /(?:([^f])fe|([lr])f)$/i, to: '$1$2ves' },
  { re: /sis$/i, to: 'ses' },
  { re: /([ti])um$/i, to: '$1a' },
  { re: /(buffal|tomat)o$/i, to: '$1oes' },
  { re: /(bu)s$/i, to: '$1ses' },
  { re: /(alias|status)$/i, to: '$1es' },
  { re: /(octop|vir)us$/i, to: '$1i' },
  { re: /(ax|test)is$/i, to: '$1es' },
  { re: /s$/i, to: 's' },
  { re: /$/, to: 's' },
];

const singularRules: Array<{ re: RegExp; to: string }> = [
  { re: /(quiz)zes$/i, to: '$1' },
  { re: /(matr)ices$/i, to: '$1ix' },
  { re: /(vert|ind)ices$/i, to: '$1ex' },
  { re: /^(ox)en/i, to: '$1' },
  { re: /(alias|status)es$/i, to: '$1' },
  { re: /(octop|vir)i$/i, to: '$1us' },
  { re: /^(a)x[ie]s$/i, to: '$1xis' },
  { re: /(cris|test)es$/i, to: '$1is' },
  { re: /(shoe)s$/i, to: '$1' },
  { re: /(o)es$/i, to: '$1' },
  { re: /(bus)es$/i, to: '$1' },
  { re: /([m|l])ice$/i, to: '$1ouse' },
  { re: /(x|ch|ss|sh)es$/i, to: '$1' },
  { re: /(m)ovies$/i, to: '$1ovie' },
  { re: /(s)eries$/i, to: '$1eries' },
  { re: /([^aeiouy]|qu)ies$/i, to: '$1y' },
  { re: /([lr])ves$/i, to: '$1f' },
  { re: /(tive)s$/i, to: '$1' },
  { re: /(hive)s$/i, to: '$1' },
  { re: /([^f])ves$/i, to: '$1fe' },
  { re: /(^analy)(sis|ses)$/i, to: '$1sis' },
  { re: /((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/i, to: '$1sis' },
  { re: /([ti])a$/i, to: '$1um' },
  { re: /(n)ews$/i, to: '$1ews' },
  { re: /s$/i, to: '' },
];

export function pluralize(word: string): string {
  if (!word) return word;
  for (const rule of pluralRules) {
    if (rule.re.test(word)) {
      return word.replace(rule.re, rule.to);
    }
  }
  return word;
}

export function singularize(word: string): string {
  if (!word) return word;
  for (const rule of singularRules) {
    if (rule.re.test(word)) {
      return word.replace(rule.re, rule.to);
    }
  }
  return word;
}

/** 命名空间导出 */
export const s = {
  camelCase, kebabCase, snakeCase, pascalCase, capitalize, titleCase,
  truncate, pad, stripTags, escapeHtml, unescapeHtml, slugify, template,
  levenshtein, similarity, contains, fuzzyMatch, wordWrap, wordCount,
  charCount, reverse, repeat, chop, between, strip, only, random, mask,
  pluralize, singularize,
};

// ===================== CLI 演示 =====================

function showDemo(): void {
  console.log('===== 字符串工具库函数演示 =====\n');
  const demos: Array<[string, string, string]> = [
    ['camelCase', 'hello world foo', camelCase('hello world foo')],
    ['kebabCase', 'HelloWorld_FooBar', kebabCase('HelloWorld_FooBar')],
    ['snakeCase', 'Hello World Foo', snakeCase('Hello World Foo')],
    ['pascalCase', 'hello-world-foo', pascalCase('hello-world-foo')],
    ['capitalize', 'hello world', capitalize('hello world')],
    ['titleCase', 'the quick brown fox', titleCase('the quick brown fox')],
    ['truncate', 'Hello, World!', truncate('Hello, World!', 8)],
    ['pad(center)', '42', pad('42', 6, 'center', '0')],
    ['stripTags', '<p>Hello <b>World</b></p>', stripTags('<p>Hello <b>World</b></p>')],
    ['escapeHtml', '<a href="x">1 & 2</a>', escapeHtml('<a href="x">1 & 2</a>')],
    ['unescapeHtml', '&lt;p&gt;hi&lt;/p&gt;', unescapeHtml('&lt;p&gt;hi&lt;/p&gt;')],
    ['slugify', 'Hello, 世界 Foo!', slugify('Hello, 世界 Foo!')],
    ['template', '{{user.name}} 年龄 {{user.age}}', template('{{user.name}} 年龄 {{user.age}}', { user: { name: 'Bob', age: 25 } })],
    ['levenshtein', 'kitten / sitting', String(levenshtein('kitten', 'sitting'))],
    ['similarity', 'hello / hallo', similarity('hello', 'hallo').toFixed(3)],
    ['fuzzyMatch', 'fuzzy("abcdefg", "adg")', String(fuzzyMatch('abcdefg', 'adg'))],
    ['wordWrap', 'The quick brown fox jumps', JSON.stringify(wordWrap('The quick brown fox jumps over', 10))],
    ['reverse', 'abc', reverse('abc')],
    ['chop', 'abcdefg', JSON.stringify(chop('abcdefg', 3))],
    ['between', '<a>link</a>', between('<a>link</a>', '<a>', '</a>')],
    ['mask', '4111111111111111', mask('4111111111111111')],
    ['pluralize', 'box', pluralize('box')],
    ['pluralize', 'city', pluralize('city')],
    ['singularize', 'cities', singularize('cities')],
    ['random(12)', '(随机)', random(12)],
  ];
  for (const [fn, input, output] of demos) {
    console.log(`  ${fn.padEnd(20)} | 输入: ${input}  =>  ${output}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'demo':
      showDemo();
      break;
    case 'slugify': {
      const text = process.argv.slice(3).join(' ');
      console.log(slugify(text));
      break;
    }
    case 'case': {
      const style = process.argv[3] as 'camel' | 'kebab' | 'snake' | 'pascal' | 'title';
      const text = process.argv.slice(4).join(' ');
      switch (style) {
        case 'camel': console.log(camelCase(text)); break;
        case 'kebab': console.log(kebabCase(text)); break;
        case 'snake': console.log(snakeCase(text)); break;
        case 'pascal': console.log(pascalCase(text)); break;
        case 'title': console.log(titleCase(text)); break;
        default: console.log('可用 style: camel, kebab, snake, pascal, title');
      }
      break;
    }
    case 'dist': {
      const a = process.argv[3] || '';
      const b = process.argv[4] || '';
      console.log(`编辑距离: ${levenshtein(a, b)}`);
      console.log(`相似度: ${similarity(a, b).toFixed(4)}`);
      break;
    }
    case 'template': {
      const tpl = process.argv[3];
      const jsonFile = process.argv[4];
      if (!tpl || !jsonFile) {
        console.log('用法: template <模板字符串> <data.json>');
        return;
      }
      const fs = await import('fs');
      const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      console.log(template(tpl, data));
      break;
    }
    default:
      console.log(`
字符串工具库 - 命令行演示

用法:
  demo                       展示所有函数效果
  slugify <text>             生成 slug
  case <style> <text>        转换大小写 (camel|kebab|snake|pascal|title)
  dist <s1> <s2>             计算编辑距离与相似度
  template <tpl> <data.json> 模板插值

示例:
  demo
  slugify "Hello World! 你好"
  case kebab "Hello World Foo"
  dist kitten sitting
  template "你好 {{name}}, 你 {{age}} 岁" ./data.json
`);
  }
}

main();
