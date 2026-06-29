#!/usr/bin/env node

/**
 * 文本分词工具 (Text Tokenizer) - Enhanced TypeScript Edition
 *
 * 功能保持不变：中英文文本分词、词频统计、N-gram 生成、句子切分、关键词抽取。
 * 仅使用 Node.js 内置模块。演示大量高级 TypeScript 特性：
 *   字符串枚举、判别联合、泛型类与约束、抽象类与具体子类、映射类型、
 *   自定义错误层级、接口可选/只读/索引签名、satisfies、getter/setter、
 *   生成器/迭代器、Symbol 唯一键、as const、类型守卫、函数重载。
 */

import * as fs from "fs";

// ---- 字符串枚举 (String enums, NOT const enum) ----

enum TokenType {
  Word = "word",
  Punct = "punct",
  Number = "number",
  Whitespace = "whitespace",
  Mixed = "mixed",
}

enum ErrorCode {
  EmptyInput = "EMPTY_INPUT",
  InvalidMode = "INVALID_MODE",
  InvalidN = "INVALID_N",
  NotFound = "NOT_FOUND",
  Unknown = "UNKNOWN",
}

enum SegmentMode {
  Whitespace = "whitespace",
  Char = "char",
  Dict = "dict",
  Ngram = "ngram",
}

enum Language {
  Chinese = "zh",
  English = "en",
  Mixed = "mixed",
}

// ---- Symbol 唯一属性键 ----

const tokenIdSym: unique symbol = Symbol("tokenId");
const metadataSym: unique symbol = Symbol("metadata");

// ---- 接口 (含 optional / readonly / index signature) ----

interface Identifiable {
  readonly id: string;
  [tokenIdSym]?: number;
}

interface TokenMetadata {
  readonly type: TokenType;
  language: Language;
  position: number;
  length: number;
  tags?: string[];
  [key: string]: unknown;
}

interface TokenRecord extends Identifiable {
  readonly text: string;
  readonly meta: TokenMetadata;
  [metadataSym]?: TokenMetadata;
}

interface TokenizerConfig {
  readonly defaultMode: SegmentMode;
  readonly maxN: number;
  readonly stopWordsEnabled: boolean;
  readonly defaultLanguage: Language;
}

// ---- 映射类型 (Mapped types) ----

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ReadonlyToken<T> = { readonly [K in keyof T]: T[K] };

// ---- 判别联合 (Discriminated unions) ----

type TokenSuccess = {
  readonly success: true;
  readonly tokens: string[];
  readonly count: number;
};
type TokenError = {
  readonly success: false;
  readonly error: string;
  readonly code: ErrorCode;
};
type TokenEmpty = {
  readonly success: true;
  readonly tokens: readonly [];
  readonly count: 0;
};
type TokenResult = TokenSuccess | TokenError | TokenEmpty;

// ---- as const 断言 ----

const DEFAULTS = {
  mode: SegmentMode.Whitespace,
  n: 2,
  top: 10,
  language: Language.Mixed,
} as const;

const SUPPORTED_MODES = [
  SegmentMode.Whitespace,
  SegmentMode.Char,
  SegmentMode.Dict,
  SegmentMode.Ngram,
] as const;

const CONFIG = {
  defaultMode: SegmentMode.Dict,
  maxN: 5,
  stopWordsEnabled: true,
  defaultLanguage: Language.Mixed,
} satisfies TokenizerConfig;

// ---- 静态数据 ----

const STOP_WORDS: ReadonlySet<string> = new Set<string>([
  "的",
  "了",
  "是",
  "在",
  "我",
  "有",
  "和",
  "就",
  "不",
  "人",
  "都",
  "一",
  "一个",
  "上",
  "也",
  "很",
  "到",
  "说",
  "要",
  "去",
  "你",
  "会",
  "着",
  "没有",
  "看",
  "好",
  "自己",
  "这",
  "那",
  "它",
  "他",
  "她",
  "们",
  "与",
  "及",
  "或",
  "但",
  "而",
  "因为",
  "所以",
  "如果",
  "虽然",
  "然后",
  "可是",
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "and",
  "or",
  "but",
  "if",
  "this",
  "that",
]);

const BUILTIN_DICT: readonly string[] = [
  "我们",
  "你们",
  "他们",
  "她们",
  "它们",
  "自己",
  "什么",
  "怎么",
  "为什么",
  "因为",
  "所以",
  "如果",
  "虽然",
  "但是",
  "然后",
  "因此",
  "由于",
  "并且",
  "或者",
  "已经",
  "正在",
  "将要",
  "可以",
  "应该",
  "必须",
  "可能",
  "也许",
  "现在",
  "今天",
  "明天",
  "昨天",
  "以后",
  "以前",
  "时候",
  "时间",
  "地方",
  "中国",
  "北京",
  "上海",
  "广州",
  "深圳",
  "国家",
  "社会",
  "世界",
  "经济",
  "政治",
  "文化",
  "教育",
  "科学",
  "技术",
  "计算机",
  "互联网",
  "手机",
  "电脑",
  "程序",
  "代码",
  "数据",
  "信息",
  "系统",
  "网络",
  "软件",
  "硬件",
  "人工智能",
  "机器学习",
  "深度学习",
  "神经网络",
  "自然语言",
  "处理",
  "分析",
  "研究",
  "开发",
  "设计",
  "测试",
  "维护",
  "部署",
  "运行",
  "执行",
  "操作",
  "管理",
  "控制",
  "问题",
  "方法",
  "方案",
  "结果",
  "原因",
  "目的",
  "目标",
  "过程",
  "步骤",
  "开始",
  "结束",
  "继续",
  "停止",
  "完成",
  "进行",
  "实现",
  "支持",
  "提供",
  "获得",
  "需要",
  "希望",
  "喜欢",
  "认为",
  "觉得",
  "知道",
  "了解",
  "学习",
  "工作",
  "生活",
  "吃饭",
  "睡觉",
  "走路",
  "跑步",
  "看书",
  "写字",
  "说话",
  "听话",
  "唱歌",
  "跳舞",
  "游戏",
  "运动",
  "音乐",
  "电影",
  "电视",
  "电话",
  "短信",
  "邮件",
  "消息",
  "新闻",
  "故事",
  "文章",
  "书籍",
  "报纸",
  "学生",
  "老师",
  "医生",
  "护士",
  "工人",
  "农民",
  "警察",
  "司机",
  "工程师",
  "家庭",
  "父母",
  "孩子",
  "朋友",
  "同事",
  "领导",
  "员工",
  "客户",
  "用户",
  "商店",
  "超市",
  "医院",
  "学校",
  "公司",
  "工厂",
  "银行",
  "机场",
  "车站",
  "火车",
  "汽车",
  "飞机",
  "自行车",
  "公交车",
  "地铁",
  "高铁",
  "高速公路",
  "吃饭",
  "喝水",
  "买",
  "卖",
  "价格",
  "钱",
  "货币",
  "美元",
  "人民币",
  "快乐",
  "悲伤",
  "生气",
  "害怕",
  "惊讶",
  "喜欢",
  "讨厌",
  "感谢",
  "抱歉",
  "漂亮",
  "帅气",
  "聪明",
  "笨",
  "勇敢",
  "胆小",
  "善良",
  "邪恶",
  "诚实",
  "天气",
  "下雨",
  "下雪",
  "刮风",
  "晴天",
  "阴天",
  "温度",
  "湿度",
  "季节",
  "春天",
  "夏天",
  "秋天",
  "冬天",
  "早上",
  "中午",
  "晚上",
  "白天",
  "黑夜",
  "红色",
  "绿色",
  "蓝色",
  "黄色",
  "黑色",
  "白色",
  "颜色",
  "形状",
  "大小",
  "长度",
  "宽度",
  "高度",
  "深度",
  "重量",
  "速度",
  "面积",
  "体积",
  "距离",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "百",
  "千",
  "万",
  "亿",
  "个",
  "只",
  "条",
  "本",
  "张",
  "件",
  "中国话",
  "中文",
  "英文",
  "日语",
  "法语",
  "德语",
  "俄语",
  "西班牙语",
];

// ---- 自定义错误类层级 ----

class TokenizeError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode = ErrorCode.Unknown) {
    super(message);
    this.name = "TokenizeError";
    this.code = code;
  }
}

class EmptyInputError extends TokenizeError {
  constructor(message = "Input text is empty") {
    super(message, ErrorCode.EmptyInput);
    this.name = "EmptyInputError";
  }
}

class InvalidModeError extends TokenizeError {
  constructor(mode: string) {
    super(`Invalid segment mode: ${mode}`, ErrorCode.InvalidMode);
    this.name = "InvalidModeError";
  }
}

// ---- 类型守卫 (Type guards) ----

function isTokenSuccess(r: TokenResult): r is TokenSuccess {
  return r.success === true && r.count > 0;
}
function isTokenError(r: TokenResult): r is TokenError {
  return r.success === false;
}
function isTokenEmpty(r: TokenResult): r is TokenEmpty {
  return r.success === true && r.count === 0;
}
function isSegmentMode(v: unknown): v is SegmentMode {
  return (
    typeof v === "string" &&
    (v === SegmentMode.Whitespace ||
      v === SegmentMode.Char ||
      v === SegmentMode.Dict ||
      v === SegmentMode.Ngram)
  );
}
function isNonEmptyArray<T>(arr: readonly T[]): arr is [T, ...T[]] {
  return arr.length > 0;
}

// ---- 字符工具函数 ----

function isChineseChar(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  return code >= 0x4e00 && code <= 0x9fff;
}
function isLetter(ch: string): boolean {
  return /[a-zA-Z]/.test(ch);
}
function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

function detectTokenType(s: string): TokenType {
  if (s.length === 0) return TokenType.Whitespace;
  if (/^\s+$/.test(s)) return TokenType.Whitespace;
  if (/^\d+$/.test(s)) return TokenType.Number;
  if (/^[。！？.!?，,；;：:、""''""''\"\'()（）]+$/.test(s))
    return TokenType.Punct;
  let hasZh = false;
  let hasEn = false;
  for (const ch of s) {
    if (isChineseChar(ch)) hasZh = true;
    else if (isLetter(ch)) hasEn = true;
  }
  if (hasZh && hasEn) return TokenType.Mixed;
  return TokenType.Word;
}

function detectLanguage(text: string): Language {
  let zh = false;
  let en = false;
  for (const ch of text) {
    if (isChineseChar(ch)) zh = true;
    else if (isLetter(ch)) en = true;
  }
  if (zh && en) return Language.Mixed;
  if (zh) return Language.Chinese;
  if (en) return Language.English;
  return Language.Mixed;
}

// ---- 核心分词函数 ----

function splitSentences(text: string): string[] {
  const result: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if ("。！？.!?".includes(ch)) {
      result.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim().length > 0) result.push(buf.trim());
  return result.filter((s) => s.length > 0);
}

function tokenizeWhitespace(text: string): string[] {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenizeChar(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    out.push(ch);
  }
  return out;
}

function segmentChinese(text: string, dict: ReadonlyArray<string>): string[] {
  const sorted = [...dict].sort((a, b) => b.length - a.length);
  const dictSet = new Set(sorted);
  const maxLen = sorted.length > 0 ? sorted[0].length : 1;
  const tokens: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (!isChineseChar(ch)) {
      let j = i;
      let buf = "";
      while (j < n && !isChineseChar(text[j])) {
        if (/\s/.test(text[j])) {
          if (buf.length > 0) {
            tokens.push(buf);
            buf = "";
          }
        } else {
          buf += text[j];
        }
        j++;
      }
      if (buf.length > 0) tokens.push(buf);
      i = j;
      continue;
    }
    let matched = "";
    for (let L = Math.min(maxLen, n - i); L >= 1; L--) {
      const candidate = text.substring(i, i + L);
      if (L === 1 || dictSet.has(candidate)) {
        matched = candidate;
        break;
      }
    }
    tokens.push(matched);
    i += matched.length;
  }
  return tokens;
}

function generateNgrams(tokens: readonly string[], n: number): string[] {
  if (n < 1) return [];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function countFrequency(
  tokens: readonly string[],
  topN?: number,
): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  const arr = Array.from(map.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return topN !== undefined ? arr.slice(0, topN) : arr;
}

function extractKeywords(text: string, count: number): Array<[string, number]> {
  const tokens = segmentChinese(text, BUILTIN_DICT).filter(
    (t) => !STOP_WORDS.has(t.toLowerCase()) && t.length > 1,
  );
  return countFrequency(tokens, count);
}

// ---- 函数重载 (Function overloads) ----

function tokenize(text: string): string[];
function tokenize(text: string, mode: SegmentMode): string[];
function tokenize(text: string, mode: SegmentMode, n: number): string[];
function tokenize(
  text: string,
  mode: SegmentMode = SegmentMode.Whitespace,
  n: number = DEFAULTS.n,
): string[] {
  if (text.length === 0) throw new EmptyInputError();
  switch (mode) {
    case SegmentMode.Whitespace:
      return tokenizeWhitespace(text);
    case SegmentMode.Char:
      return tokenizeChar(text);
    case SegmentMode.Dict:
      return segmentChinese(text, BUILTIN_DICT);
    case SegmentMode.Ngram:
      return generateNgrams(segmentChinese(text, BUILTIN_DICT), n);
    default:
      throw new InvalidModeError(mode);
  }
}

// ---- 判别联合构造与处理 ----

function makeResult(tokens: string[]): TokenResult {
  if (tokens.length === 0) {
    return {
      success: true,
      tokens: [] as const,
      count: 0,
    } satisfies TokenEmpty;
  }
  return { success: true, tokens, count: tokens.length } satisfies TokenSuccess;
}

function safeTokenize(text: string, mode: SegmentMode, n: number): TokenResult {
  try {
    if (text.length === 0) {
      return {
        success: true,
        tokens: [] as const,
        count: 0,
      } satisfies TokenEmpty;
    }
    return makeResult(tokenize(text, mode, n));
  } catch (e) {
    const msg = e instanceof TokenizeError ? e.message : (e as Error).message;
    const code = e instanceof TokenizeError ? e.code : ErrorCode.Unknown;
    return { success: false, error: msg, code } satisfies TokenError;
  }
}

function printResult(r: TokenResult): void {
  if (isTokenError(r)) {
    console.error(`[ERROR ${r.code}] ${r.error}`);
    return;
  }
  if (isTokenEmpty(r)) {
    console.log("(空结果)");
    return;
  }
  console.log(`共 ${r.count} 个 token:`);
  console.log(formatTokens(r.tokens));
}

// ---- 抽象类与具体子类 ----

abstract class AbstractTokenizer {
  protected _dict: ReadonlyArray<string>;

  constructor(dict: ReadonlyArray<string> = []) {
    this._dict = dict;
  }

  abstract get language(): Language;
  abstract segment(text: string): string[];

  get dictionarySize(): number {
    return this._dict.length;
  }
  get dictionary(): ReadonlyArray<string> {
    return this._dict;
  }
  set dictionary(dict: ReadonlyArray<string>) {
    this._dict = dict;
  }

  /** 生成器：逐个产出 token */
  *iterate(text: string): IterableIterator<string> {
    for (const t of this.segment(text)) {
      yield t;
    }
  }

  segmentToResult(text: string): TokenResult {
    if (text.length === 0) throw new EmptyInputError();
    return makeResult(this.segment(text));
  }
}

class ChineseTokenizer extends AbstractTokenizer {
  get language(): Language {
    return Language.Chinese;
  }
  segment(text: string): string[] {
    return segmentChinese(text, this._dict);
  }
}

class EnglishTokenizer extends AbstractTokenizer {
  get language(): Language {
    return Language.English;
  }
  segment(text: string): string[] {
    return tokenizeWhitespace(text);
  }
}

class MixedTokenizer extends AbstractTokenizer {
  get language(): Language {
    return Language.Mixed;
  }
  segment(text: string): string[] {
    const tokens: string[] = [];
    let buf = "";
    for (const ch of text) {
      if (isChineseChar(ch)) {
        if (buf.length > 0) {
          tokens.push(...tokenizeWhitespace(buf));
          buf = "";
        }
        tokens.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf.length > 0) tokens.push(...tokenizeWhitespace(buf));
    return tokens;
  }
}

function createTokenizer(
  lang: Language,
  dict: ReadonlyArray<string> = BUILTIN_DICT,
): AbstractTokenizer {
  switch (lang) {
    case Language.Chinese:
      return new ChineseTokenizer(dict);
    case Language.English:
      return new EnglishTokenizer(dict);
    case Language.Mixed:
    default:
      return new MixedTokenizer(dict);
  }
}

// ---- 泛型类 (Generic class with constraints) ----

class TokenStore<T extends Identifiable> {
  private readonly items: Map<string, T> = new Map();
  private _version = 0;

  add(item: T): void {
    if (this.items.has(item.id)) {
      throw new TokenizeError(`Duplicate id: ${item.id}`, ErrorCode.Unknown);
    }
    this.items.set(item.id, item);
    this._version++;
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  has(id: string): boolean {
    return this.items.has(id);
  }
  get size(): number {
    return this.items.size;
  }
  get version(): number {
    return this._version;
  }

  /** 生成器：逐个产出已存储的记录 */
  *values(): IterableIterator<T> {
    for (const v of this.items.values()) {
      yield v;
    }
  }
  [Symbol.iterator](): Iterator<T> {
    return this.values();
  }
  toArray(): T[] {
    return Array.from(this.items.values());
  }
  toMutableArray(): Array<Mutable<T>> {
    return this.toArray() as Array<Mutable<T>>;
  }
}

function createTokenRecord(text: string, position: number): TokenRecord {
  const meta: TokenMetadata = {
    type: detectTokenType(text),
    language: detectLanguage(text),
    position,
    length: text.length,
  };
  const record: TokenRecord = {
    id: `tok_${position}`,
    text,
    meta,
    [tokenIdSym]: position,
    [metadataSym]: meta,
  };
  return record;
}

function buildStoreFromText(
  text: string,
  mode: SegmentMode,
): TokenStore<TokenRecord> {
  const store = new TokenStore<TokenRecord>();
  const tokens = tokenize(text, mode);
  tokens.forEach((t, i) => store.add(createTokenRecord(t, i)));
  return store;
}

// ---- CLI 部分 ----

interface ParsedArgs {
  readonly command: string;
  text: string;
  mode: SegmentMode;
  n: number;
  top: number;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  let text = "";
  let mode: SegmentMode = SegmentMode.Whitespace;
  let n: number = DEFAULTS.n;
  let top: number = DEFAULTS.top;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-m" || a === "--mode") {
      const v = rest[++i];
      if (isSegmentMode(v)) {
        mode = v;
      } else {
        throw new InvalidModeError(v ?? "(missing)");
      }
    } else if (a === "-n" || a === "--n") {
      const v = parseInt(rest[++i] ?? "", 10);
      if (!isNaN(v) && v > 0 && v <= CONFIG.maxN) {
        n = v;
      } else {
        throw new TokenizeError(`Invalid n: ${v}`, ErrorCode.InvalidN);
      }
    } else if (a === "--top") {
      const v = parseInt(rest[++i] ?? "", 10);
      if (!isNaN(v) && v > 0) top = v;
    } else if (a === "-f" || a === "--file") {
      const filePath = rest[++i];
      if (filePath) text = fs.readFileSync(filePath, "utf-8");
    } else if (!a.startsWith("-")) {
      text = text.length === 0 ? a : text + " " + a;
    }
  }
  return { command, text, mode, n, top };
}

function printHelp(): void {
  console.log(`
文本分词工具 (Text Tokenizer) - Enhanced TS Edition

用法:
  tokenize <text> [-m mode]        按模式分词 (mode: whitespace|char|dict|ngram)
  segment <text>                    中文词典正向最大匹配分词
  freq <text> [--top N]             词频统计 (默认前 10)
  keywords <text> [-n count]        关键词抽取 (基于 TF)
  ngram <text> -n <n>               N-gram 生成
  sentences <text>                  句子切分
  store <text> [-m mode]            构造 TokenStore 并打印记录
  safe <text> [-m mode]             安全分词 (返回判别联合结果)

选项:
  -m, --mode <mode>     分词模式
  -n, --n <n>           N-gram 长度或关键词数量
  --top <N>             词频统计返回前 N
  -f, --file <path>     从文件读取文本
  -h, --help            显示帮助

示例:
  node dist/index.js segment "我喜欢机器学习和深度学习"
  node dist/index.js freq "今天天气很好 今天天气不好" --top 5
  node dist/index.js ngram "我爱自然语言处理" -n 2
`);
}

function formatTokens(tokens: readonly string[]): string {
  return tokens
    .map((t, i) => `${(i + 1).toString().padStart(3, "0")}. ${t}`)
    .join("\n");
}

function formatFreq(list: ReadonlyArray<readonly [string, number]>): string {
  if (!isNonEmptyArray(list)) return "(无结果)";
  const maxWord = Math.max(...list.map(([w]) => w.length));
  return list
    .map(
      ([w, c], i) =>
        `${(i + 1).toString().padStart(3, "0")}. ${w.padEnd(maxWord)}  ${c}`,
    )
    .join("\n");
}

function runCommand(opts: ParsedArgs): void {
  switch (opts.command) {
    case "tokenize": {
      const tokens = tokenize(opts.text, opts.mode, opts.n);
      console.log(`模式: ${opts.mode} | 共 ${tokens.length} 个 token`);
      console.log(formatTokens(tokens));
      break;
    }
    case "segment": {
      const tok = createTokenizer(Language.Chinese, BUILTIN_DICT);
      const tokens = tok.segment(opts.text);
      console.log(
        `中文分词结果 (共 ${tokens.length} 个词, 语言=${tok.language}):`,
      );
      console.log(tokens.join(" / "));
      break;
    }
    case "sentences": {
      const sents = splitSentences(opts.text);
      console.log(`句子数: ${sents.length}`);
      console.log(formatTokens(sents));
      break;
    }
    case "freq": {
      const tokens = segmentChinese(opts.text, BUILTIN_DICT);
      const freq = countFrequency(tokens, opts.top);
      console.log(`词频统计 (前 ${opts.top}):`);
      console.log(formatFreq(freq));
      break;
    }
    case "keywords": {
      const kws = extractKeywords(opts.text, opts.n);
      console.log(`关键词 (基于 TF, 前 ${opts.n}):`);
      console.log(formatFreq(kws));
      break;
    }
    case "ngram": {
      const base = segmentChinese(opts.text, BUILTIN_DICT);
      const grams = generateNgrams(base, opts.n);
      console.log(`${opts.n}-gram (共 ${grams.length} 个):`);
      console.log(formatTokens(grams));
      break;
    }
    case "store": {
      const store = buildStoreFromText(opts.text, opts.mode);
      console.log(`TokenStore: size=${store.size}, version=${store.version}`);
      for (const rec of store) {
        console.log(
          `  [${rec.meta.position}] "${rec.text}" type=${rec.meta.type} lang=${rec.meta.language} id=${rec.id}`,
        );
      }
      break;
    }
    case "safe": {
      const r = safeTokenize(opts.text, opts.mode, opts.n);
      printResult(r);
      break;
    }
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

function main(): void {
  try {
    const opts = parseArgs(process.argv);
    if (!opts.text && opts.command !== "help") {
      throw new EmptyInputError("未提供输入文本。使用 -h 查看帮助。");
    }
    runCommand(opts);
  } catch (e) {
    if (e instanceof TokenizeError) {
      console.error(`[${e.code}] ${e.message}`);
    } else {
      console.error(`Unexpected error: ${(e as Error).message}`);
    }
    process.exit(1);
  }
}

main();
