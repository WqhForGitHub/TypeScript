#!/usr/bin/env node
/**
 * 随机密码生成器 (增强版)
 * 支持自定义字符集、批量生成、密码强度分析、可记忆密码、密码短语模式
 */

import * as crypto from "crypto";

// ============================================================
// 1. 枚举
// ============================================================

enum CharType {
  Lowercase = "lowercase",
  Uppercase = "uppercase",
  Numbers = "numbers",
  Symbols = "symbols",
}

enum StrengthLevel {
  VeryWeak = "极弱",
  Weak = "弱",
  Fair = "一般",
  Strong = "强",
  VeryStrong = "极强",
}

enum GenerationMode {
  Random = "random",
  Memorable = "memorable",
  Passphrase = "passphrase",
  Pattern = "pattern",
}

enum OutputFormat {
  Plain = "plain",
  Labeled = "labeled",
  Json = "json",
}

enum AnsiColor {
  Reset = "\x1b[0m",
  Red = "\x1b[31m",
  Green = "\x1b[32m",
  Yellow = "\x1b[33m",
  Cyan = "\x1b[36m",
  Bold = "\x1b[1m",
}

// ============================================================
// 2. 接口（含 readonly / optional）
// ============================================================

interface PasswordOptions {
  readonly length: number;
  readonly charTypes: readonly CharType[];
  readonly exclude: string;
  readonly count: number;
  readonly mode: GenerationMode;
  readonly format: OutputFormat;
  readonly noSimilar: boolean;
  readonly noAmbiguous: boolean;
  readonly minPerType: number;
}

interface StrengthResult {
  readonly score: number;
  readonly level: StrengthLevel;
  readonly entropy: number;
  readonly crackTime: string;
  readonly details: readonly string[];
}

interface PasswordAnalysis {
  readonly password: string;
  readonly length: number;
  readonly charDistribution: Readonly<Record<CharType, number>>;
  readonly strength: StrengthResult;
  readonly patterns: readonly string[];
}

interface BatchResult {
  readonly total: number;
  readonly passwords: readonly PasswordAnalysis[];
  readonly duplicates: number;
  readonly avgEntropy: number;
}

// ============================================================
// 3. 自定义错误层级
// ============================================================

class PasswordError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class WeakPasswordError extends PasswordError {
  constructor(message: string) {
    super(message, "WEAK_PASSWORD");
  }
}

class InvalidOptionsError extends PasswordError {
  constructor(message: string) {
    super(message, "INVALID_OPTIONS");
  }
}

class PatternError extends PasswordError {
  constructor(message: string) {
    super(message, "PATTERN_ERROR");
  }
}

// ============================================================
// 4. 映射类型
// ============================================================

type CharPool = { readonly [K in CharType]: string };
type CharDistribution = { readonly [K in CharType]: number };

// ============================================================
// 5. 条件类型
// ============================================================

type GeneratorResult<T extends GenerationMode> =
  T extends GenerationMode.Passphrase ? string : string;

// ============================================================
// 6. 模板字面量类型
// ============================================================

type PatternString = `${string}`;
type PasswordPattern =
  `L${string}` | `U${string}` | `D${string}` | `S${string}`;

// ============================================================
// 7. 判别联合 (生成选项)
// ============================================================

type GenerationConfig =
  | { readonly mode: GenerationMode.Random; readonly options: PasswordOptions }
  | {
      readonly mode: GenerationMode.Memorable;
      readonly count: number;
      readonly separator: string;
    }
  | {
      readonly mode: GenerationMode.Passphrase;
      readonly wordCount: number;
      readonly separator: string;
      readonly capitalize: boolean;
    }
  | { readonly mode: GenerationMode.Pattern; readonly pattern: string };

// ============================================================
// 8. 字符池定义 (as const + satisfies)
// ============================================================

const CHAR_POOLS = {
  [CharType.Lowercase]: "abcdefghijklmnopqrstuvwxyz",
  [CharType.Uppercase]: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  [CharType.Numbers]: "0123456789",
  [CharType.Symbols]: "!@#$%^&*()_+-=[]{}|;:,.<>?",
} as const satisfies CharPool;

const SIMILAR_CHARS = "il1Lo0O" as const;
const AMBIGUOUS_CHARS = "{}[]()/\\\"'`~,;:.<>" as const;

const WORD_LIST = [
  "apple",
  "brave",
  "cloud",
  "dream",
  "eagle",
  "flame",
  "globe",
  "heart",
  "ivory",
  "jungle",
  "kneel",
  "lemon",
  "mango",
  "noble",
  "ocean",
  "piano",
  "quest",
  "river",
  "stone",
  "tiger",
  "umbra",
  "vivid",
  "whale",
  "xenon",
  "yacht",
  "zebra",
  "alpha",
  "blaze",
  "coral",
  "delta",
  "ember",
  "frost",
  "grace",
  "haven",
  "index",
  "joker",
  "karma",
  "lunar",
  "magic",
  "north",
  "orbit",
  "prism",
  "quiet",
  "rapid",
  "storm",
  "trace",
  "ultra",
  "vapor",
] as const satisfies readonly string[];

// ============================================================
// 9. 类型守卫
// ============================================================

function isCharType(value: string): value is CharType {
  return Object.values(CharType).includes(value as CharType);
}

function isGenerationMode(value: string): value is GenerationMode {
  return Object.values(GenerationMode).includes(value as GenerationMode);
}

function isOutputFormat(value: string): value is OutputFormat {
  return Object.values(OutputFormat).includes(value as OutputFormat);
}

// ============================================================
// 10. 泛型 + 约束
// ============================================================

abstract class AbstractRandomSource {
  abstract nextInt(max: number): number;
  abstract nextBytes(length: number): Uint8Array;

  pick<T>(array: readonly T[]): T {
    if (array.length === 0) throw new PasswordError("数组为空", "EMPTY_ARRAY");
    return array[this.nextInt(array.length)];
  }

  shuffle<T>(array: readonly T[]): readonly T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

class CryptoRandomSource extends AbstractRandomSource {
  nextInt(max: number): number {
    if (max <= 0) throw new PasswordError("max 必须 > 0", "INVALID_MAX");
    const range = 2 ** 32;
    const limit = range - (range % max);
    let val: number;
    do {
      const bytes = crypto.randomBytes(4);
      val = bytes.readUInt32BE(0);
    } while (val >= limit);
    return val % max;
  }

  nextBytes(length: number): Uint8Array {
    return crypto.randomBytes(length);
  }
}

// ============================================================
// 11. 字符池构建
// ============================================================

function buildPool(options: PasswordOptions): string {
  let pool = "";
  for (const type of options.charTypes) {
    pool += CHAR_POOLS[type];
  }

  if (options.noSimilar) {
    pool = pool.replace(new RegExp(`[${SIMILAR_CHARS}]`, "g"), "");
  }
  if (options.noAmbiguous) {
    pool = pool.replace(
      new RegExp(
        `[${AMBIGUOUS_CHARS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]`,
        "g",
      ),
      "",
    );
  }
  if (options.exclude) {
    const excludePattern = options.exclude.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    pool = pool.replace(new RegExp(`[${excludePattern}]`, "g"), "");
  }

  if (pool.length === 0) {
    throw new InvalidOptionsError("字符池为空，请检查排除设置");
  }
  return pool;
}

function getCharType(ch: string): CharType | null {
  if (CHAR_POOLS[CharType.Lowercase].includes(ch)) return CharType.Lowercase;
  if (CHAR_POOLS[CharType.Uppercase].includes(ch)) return CharType.Uppercase;
  if (CHAR_POOLS[CharType.Numbers].includes(ch)) return CharType.Numbers;
  if (CHAR_POOLS[CharType.Symbols].includes(ch)) return CharType.Symbols;
  return null;
}

// ============================================================
// 12. 函数重载 (随机源)
// ============================================================

const randomSource = new CryptoRandomSource();

function generateRandom(length: number, pool: string): string;
function generateRandom(
  length: number,
  pool: string,
  options: PasswordOptions,
): string;
function generateRandom(
  length: number,
  pool: string,
  options?: PasswordOptions,
): string {
  const chars: string[] = [];

  if (options && options.minPerType > 0) {
    const types = options.charTypes;
    for (const type of types) {
      let typePool: string = CHAR_POOLS[type];
      if (options.noSimilar)
        typePool = typePool.replace(new RegExp(`[${SIMILAR_CHARS}]`, "g"), "");
      if (options.exclude) {
        const ep = options.exclude.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        typePool = typePool.replace(new RegExp(`[${ep}]`, "g"), "");
      }
      if (typePool.length > 0) {
        for (let i = 0; i < options.minPerType && chars.length < length; i++) {
          chars.push(typePool[randomSource.nextInt(typePool.length)]);
        }
      }
    }
  }

  while (chars.length < length) {
    chars.push(pool[randomSource.nextInt(pool.length)]);
  }

  return randomSource.shuffle(chars).join("");
}

// ============================================================
// 13. 密码强度分析
// ============================================================

function analyzeDistribution(password: string): CharDistribution {
  const dist: Record<CharType, number> = {
    [CharType.Lowercase]: 0,
    [CharType.Uppercase]: 0,
    [CharType.Numbers]: 0,
    [CharType.Symbols]: 0,
  };

  for (const ch of password) {
    const type = getCharType(ch);
    if (type) dist[type]++;
  }
  return dist as CharDistribution;
}

function calculateEntropy(password: string): number {
  const dist = analyzeDistribution(password);
  let poolSize = 0;
  if (dist[CharType.Lowercase] > 0) poolSize += 26;
  if (dist[CharType.Uppercase] > 0) poolSize += 26;
  if (dist[CharType.Numbers] > 0) poolSize += 10;
  if (dist[CharType.Symbols] > 0) poolSize += 27;
  return password.length * Math.log2(poolSize || 1);
}

function estimateCrackTime(entropy: number): string {
  const guessesPerSecond = 1e10;
  const guesses = Math.pow(2, entropy) / 2;
  const seconds = guesses / guessesPerSecond;

  if (seconds < 1) return "瞬间";
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分钟`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小时`;
  if (seconds < 31536000) return `${(seconds / 86400).toFixed(1)} 天`;
  if (seconds < 31536000 * 100) return `${(seconds / 31536000).toFixed(1)} 年`;
  if (seconds < 31536000 * 1e6)
    return `${(seconds / 31536000 / 1000).toFixed(1)} 千年`;
  return "数百万年以上";
}

function detectPatterns(password: string): readonly string[] {
  const patterns: string[] = [];
  if (/(.)\1{2,}/.test(password)) patterns.push("连续重复字符");
  if (/^(abc|123|qwe|asd)/i.test(password)) patterns.push("键盘序列");
  if (/\d{4,}/.test(password)) patterns.push("连续数字");
  if (/^[a-z]+$/i.test(password)) patterns.push("仅字母");
  if (/^\d+$/.test(password)) patterns.push("仅数字");
  if (password.length < 8) patterns.push("长度过短");
  return patterns;
}

function analyzeStrength(password: string): StrengthResult {
  const entropy = calculateEntropy(password);
  const patterns = detectPatterns(password);
  const dist = analyzeDistribution(password);

  let score = entropy;
  if (patterns.length > 0) score -= patterns.length * 10;
  if (dist[CharType.Lowercase] > 0) score += 5;
  if (dist[CharType.Uppercase] > 0) score += 5;
  if (dist[CharType.Numbers] > 0) score += 5;
  if (dist[CharType.Symbols] > 0) score += 10;
  score = Math.max(0, Math.min(100, score));

  let level: StrengthLevel;
  if (score < 20) level = StrengthLevel.VeryWeak;
  else if (score < 40) level = StrengthLevel.Weak;
  else if (score < 60) level = StrengthLevel.Fair;
  else if (score < 80) level = StrengthLevel.Strong;
  else level = StrengthLevel.VeryStrong;

  const details: string[] = [
    `熵值: ${entropy.toFixed(1)} bits`,
    `字符多样性: ${Object.values(dist).filter((v) => v > 0).length}/4 类`,
  ];
  if (patterns.length > 0) {
    details.push(`风险: ${patterns.join(", ")}`);
  }

  return {
    score,
    level,
    entropy,
    crackTime: estimateCrackTime(entropy),
    details,
  };
}

function analyzePassword(password: string): PasswordAnalysis {
  return {
    password,
    length: password.length,
    charDistribution: analyzeDistribution(password),
    strength: analyzeStrength(password),
    patterns: detectPatterns(password),
  };
}

// ============================================================
// 14. 生成器 (多模式)
// ============================================================

function generateByMode(config: GenerationConfig): string {
  switch (config.mode) {
    case GenerationMode.Random: {
      const pool = buildPool(config.options);
      return generateRandom(config.options.length, pool, config.options);
    }
    case GenerationMode.Memorable: {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const word = randomSource.pick(WORD_LIST);
        parts.push(word.charAt(0).toUpperCase() + word.slice(1));
      }
      parts.push(String(randomSource.nextInt(100)));
      parts.push(randomSource.pick(CHAR_POOLS[CharType.Symbols].split("")));
      return parts.join(config.separator ?? "-");
    }
    case GenerationMode.Passphrase: {
      const words: string[] = [];
      for (let i = 0; i < config.wordCount; i++) {
        let word = randomSource.pick(WORD_LIST);
        if (config.capitalize)
          word = word.charAt(0).toUpperCase() + word.slice(1);
        words.push(word);
      }
      return words.join(config.separator);
    }
    case GenerationMode.Pattern: {
      return generateFromPattern(config.pattern);
    }
  }
}

function generateFromPattern(pattern: string): string {
  let result = "";
  for (const ch of pattern) {
    let pool: string;
    switch (ch.toUpperCase()) {
      case "L":
        pool = CHAR_POOLS[CharType.Lowercase];
        break;
      case "U":
        pool = CHAR_POOLS[CharType.Uppercase];
        break;
      case "D":
        pool = CHAR_POOLS[CharType.Numbers];
        break;
      case "S":
        pool = CHAR_POOLS[CharType.Symbols];
        break;
      default:
        throw new PatternError(`未知模式字符: '${ch}' (可用: L/U/D/S)`);
    }
    result += pool[randomSource.nextInt(pool.length)];
  }
  return result;
}

// ============================================================
// 15. 批量生成 + 去重 (生成器)
// ============================================================

function* generateBatch(
  config: GenerationConfig,
  count: number,
): Generator<string, void, unknown> {
  const seen = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 100;

  while (seen.size < count && attempts < maxAttempts) {
    attempts++;
    const password = generateByMode(config);
    if (!seen.has(password)) {
      seen.add(password);
      yield password;
    }
  }
}

function generateBatchWithAnalysis(
  config: GenerationConfig,
  count: number,
): BatchResult {
  const passwords: PasswordAnalysis[] = [];
  let duplicates = 0;
  let totalEntropy = 0;

  for (const password of generateBatch(config, count)) {
    const analysis = analyzePassword(password);
    passwords.push(analysis);
    totalEntropy += analysis.strength.entropy;
  }

  return {
    total: passwords.length,
    passwords,
    duplicates: count - passwords.length,
    avgEntropy: passwords.length > 0 ? totalEntropy / passwords.length : 0,
  };
}

// ============================================================
// 16. 输出格式化
// ============================================================

function colorize(text: string, color: AnsiColor, enabled: boolean): string {
  return enabled ? `${color}${text}${AnsiColor.Reset}` : text;
}

function strengthColor(level: StrengthLevel): AnsiColor {
  switch (level) {
    case StrengthLevel.VeryWeak:
    case StrengthLevel.Weak:
      return AnsiColor.Red;
    case StrengthLevel.Fair:
      return AnsiColor.Yellow;
    case StrengthLevel.Strong:
    case StrengthLevel.VeryStrong:
      return AnsiColor.Green;
  }
}

function formatAnalysis(analysis: PasswordAnalysis, useColor: boolean): string {
  const lines: string[] = [];
  const s = analysis.strength;
  const color = strengthColor(s.level);

  lines.push(colorize(`密码: ${analysis.password}`, AnsiColor.Bold, useColor));
  lines.push(`长度: ${analysis.length}`);
  lines.push(colorize(`强度: ${s.level} (${s.score}/100)`, color, useColor));
  lines.push(`熵值: ${s.entropy.toFixed(1)} bits`);
  lines.push(`破解时间: ${s.crackTime}`);

  const dist = analysis.charDistribution;
  lines.push(
    `分布: 小写=${dist[CharType.Lowercase]} 大写=${dist[CharType.Uppercase]} 数字=${dist[CharType.Numbers]} 符号=${dist[CharType.Symbols]}`,
  );

  if (analysis.patterns.length > 0) {
    lines.push(
      colorize(
        `风险: ${analysis.patterns.join(", ")}`,
        AnsiColor.Red,
        useColor,
      ),
    );
  }

  return lines.join("\n");
}

function formatBatchResult(result: BatchResult, useColor: boolean): string {
  const lines: string[] = [];
  lines.push(colorize(`\n=== 批量生成结果 ===`, AnsiColor.Bold, useColor));
  lines.push(`生成数量: ${result.total}`);
  if (result.duplicates > 0)
    lines.push(
      colorize(
        `重复(已去重): ${result.duplicates}`,
        AnsiColor.Yellow,
        useColor,
      ),
    );
  lines.push(`平均熵值: ${result.avgEntropy.toFixed(1)} bits\n`);

  for (const analysis of result.passwords) {
    const s = analysis.strength;
    const color = strengthColor(s.level);
    lines.push(
      `  ${colorize(analysis.password, AnsiColor.Bold, useColor)}  [${colorize(s.level, color, useColor)}]  ${s.entropy.toFixed(0)}bits  ${s.crackTime}`,
    );
  }
  return lines.join("\n");
}

// ============================================================
// 17. 参数解析
// ============================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function parseArgs(args: string[]): GenerationConfig & {
  readonly count: number;
  readonly format: OutputFormat;
  readonly useColor: boolean;
  readonly showStrength: boolean;
} {
  let length = 16;
  const charTypes: CharType[] = [
    CharType.Lowercase,
    CharType.Uppercase,
    CharType.Numbers,
    CharType.Symbols,
  ];
  let exclude = "";
  let count = 1;
  let mode = GenerationMode.Random;
  let format = OutputFormat.Labeled;
  let useColor = true;
  let showStrength = true;
  let noSimilar = false;
  let noAmbiguous = false;
  let minPerType = 0;
  let separator = "-";
  let capitalize = true;
  let wordCount = 4;
  let pattern = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--length":
      case "-l":
        length = parseInt(args[++i] ?? "16", 10);
        break;
      case "--count":
      case "-n":
        count = parseInt(args[++i] ?? "1", 10);
        break;
      case "--exclude":
      case "-e":
        exclude = args[++i] ?? "";
        break;
      case "--mode":
      case "-m": {
        const val = args[++i] ?? "";
        if (isGenerationMode(val)) mode = val;
        else throw new InvalidOptionsError(`未知模式: ${val}`);
        break;
      }
      case "--format":
      case "-f": {
        const val = args[++i] ?? "";
        if (isOutputFormat(val)) format = val;
        break;
      }
      case "--no-similar":
        noSimilar = true;
        break;
      case "--no-ambiguous":
        noAmbiguous = true;
        break;
      case "--no-strength":
        showStrength = false;
        break;
      case "--no-color":
        useColor = false;
        break;
      case "--min-per-type":
        minPerType = parseInt(args[++i] ?? "0", 10);
        break;
      case "--separator":
        separator = args[++i] ?? "-";
        break;
      case "--no-capitalize":
        capitalize = false;
        break;
      case "--words":
        wordCount = parseInt(args[++i] ?? "4", 10);
        break;
      case "--pattern":
      case "-p":
        pattern = args[++i] ?? "";
        mode = GenerationMode.Pattern;
        break;
      case "--lowercase-only":
        charTypes.length = 0;
        charTypes.push(CharType.Lowercase);
        break;
      case "--no-symbols":
        const symIdx = charTypes.indexOf(CharType.Symbols);
        if (symIdx >= 0) charTypes.splice(symIdx, 1);
        break;
    }
  }

  const options: PasswordOptions = {
    length,
    charTypes: [...charTypes],
    exclude,
    count,
    mode,
    format,
    noSimilar,
    noAmbiguous,
    minPerType,
  };

  switch (mode) {
    case GenerationMode.Memorable:
      return {
        mode,
        count,
        format,
        useColor,
        showStrength,
        separator,
        capitalize,
        options,
      } as any;
    case GenerationMode.Passphrase:
      return {
        mode,
        count,
        format,
        useColor,
        showStrength,
        separator,
        capitalize,
        wordCount,
        options,
      } as any;
    case GenerationMode.Pattern:
      return {
        mode,
        count,
        format,
        useColor,
        showStrength,
        pattern,
        options,
      } as any;
    default:
      return { mode, count, format, useColor, showStrength, options } as any;
  }
}

// ============================================================
// 18. 帮助信息
// ============================================================

function printHelp(): void {
  console.log(`
Usage: password-gen [options]

Modes:
  -m, --mode <mode>       生成模式: random | memorable | passphrase | pattern (默认: random)

Random Mode Options:
  -l, --length <n>        密码长度 (默认: 16)
  -n, --count <n>         生成数量 (默认: 1)
  -e, --exclude <chars>   排除的字符
      --no-similar        排除易混淆字符 (il1Lo0O)
      --no-ambiguous      排除模糊字符
      --min-per-type <n>  每种字符类型最少数量 (默认: 0)
      --lowercase-only    仅使用小写字母
      --no-symbols        不使用符号

Passphrase Mode Options:
      --words <n>         单词数量 (默认: 4)
      --separator <s>     分隔符 (默认: -)
      --no-capitalize     不大写首字母

Pattern Mode Options:
  -p, --pattern <pat>     模式字符串 (L=小写 U=大写 D=数字 S=符号)
                          示例: LULDSS → 如 aB5#f!

Output Options:
  -f, --format <fmt>      输出格式: plain | labeled | json (默认: labeled)
      --no-strength       不显示强度分析
      --no-color          禁用彩色输出

Examples:
  password-gen -l 20 -n 5
  password-gen -m passphrase --words 5
  password-gen -m pattern -p LLDUSS
  password-gen --no-similar --min-per-type 1
`);
}

// ============================================================
// 19. 主入口
// ============================================================

function main(): void {
  let config: ReturnType<typeof parseArgs>;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg =
      err instanceof PasswordError
        ? `[${err.code}] ${err.message}`
        : String(err);
    console.error(`错误: ${msg}`);
    process.exit(1);
  }

  if (config.count <= 0) {
    console.error("错误: 数量必须大于 0");
    process.exit(1);
  }

  if (config.count === 1) {
    const password = generateByMode(config);
    if (config.showStrength) {
      const analysis = analyzePassword(password);
      if (config.format === OutputFormat.Plain) {
        console.log(password);
      } else if (config.format === OutputFormat.Json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        console.log(formatAnalysis(analysis, config.useColor));
      }
    } else {
      console.log(password);
    }
  } else {
    const result = generateBatchWithAnalysis(config, config.count);
    if (config.format === OutputFormat.Json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (config.format === OutputFormat.Plain) {
      result.passwords.forEach((p) => console.log(p.password));
    } else {
      console.log(formatBatchResult(result, config.useColor));
    }
  }
}

main();
