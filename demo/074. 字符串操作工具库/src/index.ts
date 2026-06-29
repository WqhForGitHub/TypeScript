#!/usr/bin/env node
/**
 * 字符串操作工具库 (String Utils) - Enhanced TypeScript Edition
 * Provides a large set of pure string-processing functions.
 * Only Node.js built-in dependency: crypto.
 *
 * Advanced TS features: string enums, discriminated unions, generic class
 * w/ constraints, abstract class + subclasses, mapped types, custom error
 * hierarchy, interfaces (optional/readonly/index signatures), satisfies,
 * as const, getters/setters, generators/iterators, symbols, type guards,
 * function overloads, template literal types.
 */
import crypto from "crypto";

// ===================== String Enums =====================

export enum CaseType {
  Camel = "camel",
  Kebab = "kebab",
  Snake = "snake",
  Pascal = "pascal",
  Title = "title",
  Capital = "capital",
}
export enum ErrorCode {
  InvalidInput = "INVALID_INPUT",
  OutOfRange = "OUT_OF_RANGE",
  EmptyString = "EMPTY_STRING",
  UnknownCase = "UNKNOWN_CASE",
  TemplateError = "TEMPLATE_ERROR",
}
export enum AlignDirection {
  Left = "left",
  Right = "right",
  Center = "center",
}
export enum TrimMode {
  Start = "start",
  End = "end",
  Both = "both",
}

// ===================== Template Literal Types =====================

export type CaseStyle = `${CaseType}`;
export type PadCommand = `pad:${AlignDirection}`;
export type SlugPart = `${string}-${string}`;
export type ErrorCodeLiteral = `${ErrorCode}`;

// ===================== Mapped Types =====================

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type DeepReadonly<T> = { readonly [K in keyof T]: T[K] };

// ===================== Interfaces =====================

export interface StringStats {
  readonly length: number;
  readonly wordCount: number;
  readonly charCountNoWhitespace: number;
  readonly lineCount: number;
  readonly uniqueChars: number;
  readonly isPalindrome: number;
  [key: string]: number;
}

export interface TruncateOptions {
  readonly maxLen: number;
  readonly ellipsis?: string;
  readonly mode?: "hard" | "soft";
}
export interface PadOptions {
  readonly length: number;
  readonly direction?: AlignDirection;
  readonly char?: string;
}
export interface TemplateContext {
  readonly [key: string]: unknown;
}
interface PluralRule {
  readonly re: RegExp;
  readonly to: string;
}

// ===================== Discriminated Unions =====================

export interface StringResult<T = string> {
  readonly ok: true;
  readonly value: T;
  readonly meta?: Readonly<Record<string, unknown>>;
}
export interface StringError {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly message: string;
  readonly input?: unknown;
}
export type StringOutcome<T = string> = StringResult<T> | StringError;

// ===================== Custom Error Hierarchy =====================

export class StringUtilError extends Error {
  public readonly code: ErrorCode;
  public readonly input?: unknown;
  constructor(code: ErrorCode, message: string, input?: unknown) {
    super(message);
    this.name = "StringUtilError";
    this.code = code;
    this.input = input;
    Object.setPrototypeOf(this, StringUtilError.prototype);
  }
  public toJSON(): { code: ErrorCode; message: string; input?: unknown } {
    return { code: this.code, message: this.message, input: this.input };
  }
}

export class InvalidInputError extends StringUtilError {
  constructor(message: string, input?: unknown) {
    super(ErrorCode.InvalidInput, message, input);
    this.name = "InvalidInputError";
    Object.setPrototypeOf(this, InvalidInputError.prototype);
  }
}
export class OutOfRangeError extends StringUtilError {
  constructor(message: string, input?: unknown) {
    super(ErrorCode.OutOfRange, message, input);
    this.name = "OutOfRangeError";
    Object.setPrototypeOf(this, OutOfRangeError.prototype);
  }
}
export class UnknownCaseError extends StringUtilError {
  constructor(message: string, input?: unknown) {
    super(ErrorCode.UnknownCase, message, input);
    this.name = "UnknownCaseError";
    Object.setPrototypeOf(this, UnknownCaseError.prototype);
  }
}

// ===================== Type Guards =====================

export function isStringResult<T>(r: StringOutcome<T>): r is StringResult<T> {
  return r.ok === true;
}
export function isStringError<T>(r: StringOutcome<T>): r is StringError {
  return r.ok === false;
}
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
export function isCaseType(v: unknown): v is CaseType {
  return (
    typeof v === "string" && Object.values(CaseType).includes(v as CaseType)
  );
}
export function isStringUtilError(e: unknown): e is StringUtilError {
  return e instanceof StringUtilError;
}

// ===================== Symbols =====================

export const ORIGINAL_KEY: unique symbol = Symbol("original");
const STATS_KEY: unique symbol = Symbol("stats");

// ===================== as const + satisfies =====================

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
} as const satisfies Record<string, string>;
const HTML_UNESCAPE_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
} as const satisfies Record<string, string>;
const DEFAULT_PAD_OPTIONS = {
  direction: AlignDirection.Left,
  char: " ",
} satisfies Partial<PadOptions>;
const DEFAULT_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" as const;

// ===================== Core helper =====================

function splitWords(str: string): string[] {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// ===================== Case Conversion =====================

export function camelCase(str: string): string {
  return splitWords(str)
    .map((word, i) =>
      i === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}
export function kebabCase(str: string): string {
  return splitWords(str)
    .map((w) => w.toLowerCase())
    .join("-");
}
export function snakeCase(str: string): string {
  return splitWords(str)
    .map((w) => w.toLowerCase())
    .join("_");
}
export function pascalCase(str: string): string {
  return splitWords(str)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}
export function capitalize(str: string): string {
  return str.length === 0 ? str : str.charAt(0).toUpperCase() + str.slice(1);
}
export function titleCase(str: string): string {
  return splitWords(str)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Function overloads
export function convertCase(str: string, type: CaseType): string;
export function convertCase(str: string, type: CaseStyle): string;
export function convertCase(str: string, type: CaseType | CaseStyle): string {
  const t = type as string;
  if (t === CaseType.Camel) return camelCase(str);
  if (t === CaseType.Kebab) return kebabCase(str);
  if (t === CaseType.Snake) return snakeCase(str);
  if (t === CaseType.Pascal) return pascalCase(str);
  if (t === CaseType.Title) return titleCase(str);
  if (t === CaseType.Capital) return capitalize(str);
  throw new UnknownCaseError(`Unknown case type: ${t}`, type);
}

// ===================== Truncate / Pad =====================

export function truncate(
  str: string,
  maxLen: number,
  ellipsis = "...",
): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - ellipsis.length)) + ellipsis;
}

export function truncateSafe(
  str: string,
  options: TruncateOptions,
): StringOutcome<string> {
  const { maxLen, ellipsis = "...", mode = "hard" } = options;
  if (maxLen < 0)
    return {
      ok: false,
      code: ErrorCode.OutOfRange,
      message: "maxLen must be >= 0",
      input: options,
    };
  if (mode === "soft" && str.length > maxLen) {
    const cut = Math.max(0, maxLen - ellipsis.length);
    let end = cut;
    while (end > 0 && !/\s/.test(str[end])) end--;
    const base = end > 0 ? str.slice(0, end) : str.slice(0, cut);
    return { ok: true, value: base + ellipsis };
  }
  return { ok: true, value: truncate(str, maxLen, ellipsis) };
}

export function pad(
  str: string,
  len: number,
  mode: AlignDirection = AlignDirection.Left,
  char = " ",
): string {
  if (str.length >= len) return str;
  const padLen = len - str.length;
  if (mode === AlignDirection.Left) return char.repeat(padLen) + str;
  if (mode === AlignDirection.Right) return str + char.repeat(padLen);
  const left = Math.floor(padLen / 2);
  return char.repeat(left) + str + char.repeat(padLen - left);
}

export function padWith(str: string, options: PadOptions): string {
  const {
    length,
    direction = DEFAULT_PAD_OPTIONS.direction,
    char = DEFAULT_PAD_OPTIONS.char,
  } = options;
  return pad(str, length, direction, char);
}

export function trimByMode(
  str: string,
  mode: TrimMode = TrimMode.Both,
): string {
  switch (mode) {
    case TrimMode.Start:
      return str.trimStart();
    case TrimMode.End:
      return str.trimEnd();
    case TrimMode.Both:
    default:
      return str.trim();
  }
}

// ===================== HTML =====================

export function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}
export function escapeHtml(str: string): string {
  const map = HTML_ESCAPE_MAP as Record<string, string>;
  return str.replace(/[&<>"']/g, (c) => map[c]);
}
export function unescapeHtml(str: string): string {
  const map = HTML_UNESCAPE_MAP as Record<string, string>;
  return str.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => map[m] ?? m);
}

// ===================== Slugify / Template =====================

export function slugify(str: string): string {
  return str
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function template(tpl: string, data: TemplateContext): string {
  return tpl.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const paths = expr.trim().split(".");
    let cur: unknown = data;
    for (const p of paths) {
      if (cur && typeof cur === "object" && p in (cur as object)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return cur === null || cur === undefined ? "" : String(cur);
  });
}

// ===================== Distance / Similarity =====================

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length,
    n = b.length;
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

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export function contains(
  haystack: string,
  needle: string,
  ignoreCase = false,
): boolean {
  return ignoreCase
    ? haystack.toLowerCase().includes(needle.toLowerCase())
    : haystack.includes(needle);
}

export function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let i = 0;
  const h = haystack.toLowerCase(),
    n = needle.toLowerCase();
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

// ===================== Word Wrap / Counts / Stats =====================

export function wordWrap(str: string, width: number, indent = ""): string {
  const lines: string[] = [];
  let line = "";
  for (const w of splitWords(str)) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

export function wordCount(str: string): number {
  return splitWords(str).length;
}
export function charCount(str: string, ignoreWhitespace = false): number {
  return ignoreWhitespace ? str.replace(/\s/g, "").length : str.length;
}

export function computeStats(str: string): StringStats {
  const ws = splitWords(str);
  const unique = new Set(Array.from(str));
  const reversed = Array.from(str).reverse().join("");
  return {
    length: str.length,
    wordCount: ws.length,
    charCountNoWhitespace: str.replace(/\s/g, "").length,
    lineCount: str.split(/\r?\n/).length,
    uniqueChars: unique.size,
    isPalindrome: str === reversed ? 1 : 0,
  };
}

// ===================== Misc string ops =====================

export function reverse(str: string): string {
  return Array.from(str).reverse().join("");
}
export function repeat(str: string, n: number): string {
  return n <= 0 ? "" : str.repeat(n);
}

export function chop(str: string, size: number): string[] {
  if (size <= 0) return [str];
  const out: string[] = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

export function between(str: string, start: string, end: string): string {
  const s = str.indexOf(start);
  if (s === -1) return "";
  const startIdx = s + start.length;
  const e = str.indexOf(end, startIdx);
  return e === -1 ? str.slice(startIdx) : str.slice(startIdx, e);
}

export function strip(str: string, chars: string): string {
  const set = new Set(Array.from(chars));
  return Array.from(str)
    .filter((c) => !set.has(c))
    .join("");
}
export function only(str: string, chars: string): string {
  const set = new Set(Array.from(chars));
  return Array.from(str)
    .filter((c) => set.has(c))
    .join("");
}

// ===================== Random / Mask =====================

export function random(length = 16, charset: string = DEFAULT_CHARSET): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

export function mask(
  str: string,
  visibleStart = 4,
  visibleEnd = 4,
  maskChar = "*",
): string {
  if (str.length <= visibleStart + visibleEnd)
    return maskChar.repeat(str.length);
  return (
    str.slice(0, visibleStart) +
    maskChar.repeat(str.length - visibleStart - visibleEnd) +
    str.slice(str.length - visibleEnd)
  );
}

// ===================== Generators / Iterators =====================

export function* chars(str: string): Generator<string> {
  for (const ch of str) yield ch;
}
export function* wordsIter(str: string): Generator<string> {
  for (const w of splitWords(str)) yield w;
}
export function* chunks(str: string, size: number): Generator<string> {
  if (size <= 0) return;
  for (let i = 0; i < str.length; i += size) yield str.slice(i, i + size);
}

// ===================== Generic Class: StringStore =====================

export class StringStore<T extends string> {
  private _value: T;
  private readonly _original: T;
  constructor(value: T) {
    this._value = value;
    this._original = value;
  }

  get value(): T {
    return this._value;
  }
  set value(v: T) {
    this._value = v;
  }
  get original(): T {
    return this._original;
  }
  get length(): number {
    return this._value.length;
  }
  get isEmpty(): boolean {
    return this._value.length === 0;
  }

  public [ORIGINAL_KEY](): T {
    return this._original;
  }
  public [STATS_KEY](): StringStats {
    return computeStats(this._value);
  }
  public transform<U extends string>(fn: (s: T) => U): StringStore<U> {
    return new StringStore(fn(this._value));
  }
  public reset(): void {
    this._value = this._original;
  }
  public *[Symbol.iterator](): Generator<string> {
    for (const ch of this._value) yield ch;
  }
  public toString(): string {
    return this._value;
  }
}

// ===================== Abstract Class + Subclasses =====================

export abstract class AbstractStringOp<TInput, TOutput> {
  public abstract readonly name: string;
  public abstract execute(input: TInput): TOutput;
  protected validate(input: TInput): void {
    if (input === null || input === undefined)
      throw new InvalidInputError("Input cannot be null or undefined", input);
  }
  public run(input: TInput): StringOutcome<TOutput> {
    try {
      return { ok: true, value: this.execute(input) };
    } catch (e) {
      if (e instanceof StringUtilError)
        return { ok: false, code: e.code, message: e.message, input };
      return {
        ok: false,
        code: ErrorCode.InvalidInput,
        message: e instanceof Error ? e.message : String(e),
        input,
      };
    }
  }
}

export class CaseOp extends AbstractStringOp<
  { str: string; type: CaseType },
  string
> {
  public readonly name = "case";
  public execute(input: { str: string; type: CaseType }): string {
    this.validate(input);
    return convertCase(input.str, input.type);
  }
}
export class TruncateOp extends AbstractStringOp<
  { str: string; maxLen: number; ellipsis?: string },
  string
> {
  public readonly name = "truncate";
  public execute(input: {
    str: string;
    maxLen: number;
    ellipsis?: string;
  }): string {
    this.validate(input);
    return truncate(input.str, input.maxLen, input.ellipsis);
  }
}
export class SlugifyOp extends AbstractStringOp<string, string> {
  public readonly name = "slugify";
  public execute(input: string): string {
    this.validate(input);
    return slugify(input);
  }
}
export class ReverseOp extends AbstractStringOp<string, string> {
  public readonly name = "reverse";
  public execute(input: string): string {
    this.validate(input);
    return reverse(input);
  }
}

// ===================== Plural / Singular =====================

const pluralRules: DeepReadonly<PluralRule[]> = [
  { re: /(quiz)$/i, to: "$1zes" },
  { re: /^(ox)$/i, to: "$1en" },
  { re: /([m|l])ouse$/i, to: "$1ice" },
  { re: /(matr|vert|ind)(ix|ex)$/i, to: "$1ices" },
  { re: /(x|ch|ss|sh)$/i, to: "$1es" },
  { re: /([^aeiouy]|qu)y$/i, to: "$1ies" },
  { re: /(hive)$/i, to: "$1s" },
  { re: /(?:([^f])fe|([lr])f)$/i, to: "$1$2ves" },
  { re: /sis$/i, to: "ses" },
  { re: /([ti])um$/i, to: "$1a" },
  { re: /(buffal|tomat)o$/i, to: "$1oes" },
  { re: /(bu)s$/i, to: "$1ses" },
  { re: /(alias|status)$/i, to: "$1es" },
  { re: /(octop|vir)us$/i, to: "$1i" },
  { re: /(ax|test)is$/i, to: "$1es" },
  { re: /s$/i, to: "s" },
  { re: /$/, to: "s" },
];

const singularRules: DeepReadonly<PluralRule[]> = [
  { re: /(quiz)zes$/i, to: "$1" },
  { re: /(matr)ices$/i, to: "$1ix" },
  { re: /(vert|ind)ices$/i, to: "$1ex" },
  { re: /^(ox)en/i, to: "$1" },
  { re: /(alias|status)es$/i, to: "$1" },
  { re: /(octop|vir)i$/i, to: "$1us" },
  { re: /^(a)x[ie]s$/i, to: "$1xis" },
  { re: /(cris|test)es$/i, to: "$1is" },
  { re: /(shoe)s$/i, to: "$1" },
  { re: /(o)es$/i, to: "$1" },
  { re: /(bus)es$/i, to: "$1" },
  { re: /([m|l])ice$/i, to: "$1ouse" },
  { re: /(x|ch|ss|sh)es$/i, to: "$1" },
  { re: /(m)ovies$/i, to: "$1ovie" },
  { re: /(s)eries$/i, to: "$1eries" },
  { re: /([^aeiouy]|qu)ies$/i, to: "$1y" },
  { re: /([lr])ves$/i, to: "$1f" },
  { re: /(tive)s$/i, to: "$1" },
  { re: /(hive)s$/i, to: "$1" },
  { re: /([^f])ves$/i, to: "$1fe" },
  { re: /(^analy)(sis|ses)$/i, to: "$1sis" },
  {
    re: /((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/i,
    to: "$1sis",
  },
  { re: /([ti])a$/i, to: "$1um" },
  { re: /(n)ews$/i, to: "$1ews" },
  { re: /s$/i, to: "" },
];

export function pluralize(word: string): string {
  if (!word) return word;
  for (const rule of pluralRules)
    if (rule.re.test(word)) return word.replace(rule.re, rule.to);
  return word;
}
export function singularize(word: string): string {
  if (!word) return word;
  for (const rule of singularRules)
    if (rule.re.test(word)) return word.replace(rule.re, rule.to);
  return word;
}

// ===================== Namespace export =====================

export const s = {
  camelCase,
  kebabCase,
  snakeCase,
  pascalCase,
  capitalize,
  titleCase,
  convertCase,
  truncate,
  truncateSafe,
  pad,
  padWith,
  trimByMode,
  stripTags,
  escapeHtml,
  unescapeHtml,
  slugify,
  template,
  levenshtein,
  similarity,
  contains,
  fuzzyMatch,
  wordWrap,
  wordCount,
  charCount,
  computeStats,
  reverse,
  repeat,
  chop,
  between,
  strip,
  only,
  random,
  mask,
  pluralize,
  singularize,
  chars,
  wordsIter,
  chunks,
  StringStore,
  CaseOp,
  TruncateOp,
  SlugifyOp,
  ReverseOp,
  AbstractStringOp,
  StringUtilError,
  InvalidInputError,
  OutOfRangeError,
  UnknownCaseError,
  isStringResult,
  isStringError,
  isNonEmptyString,
  isCaseType,
  isStringUtilError,
  CaseType,
  ErrorCode,
  AlignDirection,
  TrimMode,
};

// ===================== CLI 演示 =====================

function showDemo(): void {
  console.log("===== 字符串工具库函数演示 =====\n");
  const demos: Array<[string, string, string]> = [
    ["camelCase", "hello world foo", camelCase("hello world foo")],
    ["kebabCase", "HelloWorld_FooBar", kebabCase("HelloWorld_FooBar")],
    ["snakeCase", "Hello World Foo", snakeCase("Hello World Foo")],
    ["pascalCase", "hello-world-foo", pascalCase("hello-world-foo")],
    ["capitalize", "hello world", capitalize("hello world")],
    ["titleCase", "the quick brown fox", titleCase("the quick brown fox")],
    ["convertCase(Pascal)", "foo bar", convertCase("foo bar", CaseType.Pascal)],
    ["truncate", "Hello, World!", truncate("Hello, World!", 8)],
    ["pad(center)", "42", pad("42", 6, AlignDirection.Center, "0")],
    [
      "stripTags",
      "<p>Hello <b>World</b></p>",
      stripTags("<p>Hello <b>World</b></p>"),
    ],
    [
      "escapeHtml",
      '<a href="x">1 & 2</a>',
      escapeHtml('<a href="x">1 & 2</a>'),
    ],
    [
      "unescapeHtml",
      "&lt;p&gt;hi&lt;/p&gt;",
      unescapeHtml("&lt;p&gt;hi&lt;/p&gt;"),
    ],
    ["slugify", "Hello, 世界 Foo!", slugify("Hello, 世界 Foo!")],
    [
      "template",
      "{{user.name}} 年龄 {{user.age}}",
      template("{{user.name}} 年龄 {{user.age}}", {
        user: { name: "Bob", age: 25 },
      }),
    ],
    [
      "levenshtein",
      "kitten / sitting",
      String(levenshtein("kitten", "sitting")),
    ],
    ["similarity", "hello / hallo", similarity("hello", "hallo").toFixed(3)],
    [
      "fuzzyMatch",
      'fuzzy("abcdefg","adg")',
      String(fuzzyMatch("abcdefg", "adg")),
    ],
    [
      "wordWrap",
      "The quick brown fox",
      JSON.stringify(wordWrap("The quick brown fox jumps over", 10)),
    ],
    ["reverse", "abc", reverse("abc")],
    ["chop", "abcdefg", JSON.stringify(chop("abcdefg", 3))],
    ["between", "<a>link</a>", between("<a>link</a>", "<a>", "</a>")],
    ["mask", "4111111111111111", mask("4111111111111111")],
    ["pluralize", "box", pluralize("box")],
    ["pluralize", "city", pluralize("city")],
    ["singularize", "cities", singularize("cities")],
    ["random(12)", "(随机)", random(12)],
  ];
  for (const [fn, input, output] of demos) {
    console.log(`  ${fn.padEnd(22)} | 输入: ${input}  =>  ${output}`);
  }

  console.log("\n----- StringStore / Op / 高级特性演示 -----");
  const store = new StringStore("Hello World");
  const transformed = store.transform((v) => snakeCase(v));
  console.log(
    `  StringStore("${store.original}").transform(snake) -> "${transformed.value}"`,
  );
  const slugOp = new SlugifyOp();
  const result = slugOp.run("Hello, World! 你好");
  if (isStringResult(result))
    console.log(`  SlugifyOp.run -> ok=${result.ok}, value="${result.value}"`);
  const iter = new StringStore("abc");
  const collected: string[] = [];
  for (const c of iter) collected.push(c);
  console.log(`  StringStore[Symbol.iterator] -> ${JSON.stringify(collected)}`);
  const mutable: Mutable<TruncateOptions> = {
    maxLen: 5,
    ellipsis: "~",
    mode: "hard",
  };
  mutable.maxLen = 10;
  console.log(`  Mutable<TruncateOptions> -> ${JSON.stringify(mutable)}`);
  const fail = truncateSafe("hi", { maxLen: -1 });
  if (isStringError(fail))
    console.log(`  truncateSafe(maxLen=-1) -> error code=${fail.code}`);
  const wordsFromGen: string[] = [];
  for (const w of wordsIter("helloWorld_fooBar")) wordsFromGen.push(w);
  console.log(`  wordsIter -> ${JSON.stringify(wordsFromGen)}`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "demo":
      showDemo();
      break;
    case "slugify": {
      const text = process.argv.slice(3).join(" ");
      console.log(slugify(text));
      break;
    }
    case "case": {
      const style = process.argv[3] as CaseStyle;
      const text = process.argv.slice(4).join(" ");
      try {
        console.log(convertCase(text, style));
      } catch {
        console.log("可用 style: camel, kebab, snake, pascal, title, capital");
      }
      break;
    }
    case "dist": {
      const a = process.argv[3] || "";
      const b = process.argv[4] || "";
      console.log(`编辑距离: ${levenshtein(a, b)}`);
      console.log(`相似度: ${similarity(a, b).toFixed(4)}`);
      break;
    }
    case "template": {
      const tpl = process.argv[3];
      const jsonFile = process.argv[4];
      if (!tpl || !jsonFile) {
        console.log("用法: template <模板字符串> <data.json>");
        return;
      }
      const fs = await import("fs");
      const data = JSON.parse(
        fs.readFileSync(jsonFile, "utf8"),
      ) as TemplateContext;
      console.log(template(tpl, data));
      break;
    }
    default:
      console.log(`
字符串工具库 - 命令行演示

用法:
  demo                       展示所有函数效果
  slugify <text>             生成 slug
  case <style> <text>        转换大小写 (camel|kebab|snake|pascal|title|capital)
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
