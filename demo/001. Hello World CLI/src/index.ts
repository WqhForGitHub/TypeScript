#!/usr/bin/env node
/**
 * Hello World CLI (增强版)
 * 一个使用纯 TypeScript 编写的命令行演示程序，展示大量 TypeScript 高级语法特性。
 */

// ============================================================
// 1. 枚举
// ============================================================

enum Language {
  English = "en",
  Chinese = "zh",
  Japanese = "ja",
  French = "fr",
  Spanish = "es",
  German = "de",
  Korean = "ko",
}

enum OutputStyle {
  Plain = "plain",
  Boxed = "boxed",
  Inline = "inline",
}

enum AnsiColor {
  Reset = "\x1b[0m",
  Red = "\x1b[31m",
  Green = "\x1b[32m",
  Yellow = "\x1b[33m",
  Blue = "\x1b[34m",
  Magenta = "\x1b[35m",
  Cyan = "\x1b[36m",
  Bold = "\x1b[1m",
}

// ============================================================
// 2. 接口（含可选 / readonly 属性）
// ============================================================

interface CliOptions {
  readonly name: string;
  readonly language: Language;
  readonly repeat: number;
  readonly style: OutputStyle;
  readonly verbose: boolean;
  readonly color: boolean;
}

interface GreetingEntry {
  readonly language: Language;
  readonly template: string;
  readonly locale: string;
  readonly color: AnsiColor;
}

interface HistoryRecord {
  readonly id: number;
  readonly timestamp: Date;
  readonly name: string;
  readonly language: Language;
  readonly greeting: string;
}

interface GreetingStrategy {
  readonly name: string;
  format(greeting: string, repeat: number): string;
}

// ============================================================
// 3. 自定义错误类层级
// ============================================================

class HelloCliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class InvalidLanguageError extends HelloCliError {
  constructor(value: string) {
    super(
      `不支持的语言: "${value}"。支持: en, zh, ja, fr, es, de, ko`,
      "INVALID_LANGUAGE",
    );
  }
}

class InvalidRepeatError extends HelloCliError {
  constructor(value: string) {
    super(`无效的重复次数: "${value}"`, "INVALID_REPEAT");
  }
}

// ============================================================
// 4. 泛型 + 约束
// ============================================================

type ArgumentKey =
  "name" | "language" | "repeat" | "style" | "verbose" | "color";

type ArgumentDefinition<T extends ArgumentKey> = {
  readonly key: T;
  readonly shortFlag: string;
  readonly longFlag: string;
  readonly description: string;
  readonly requiresValue: boolean;
};

function defineArg<T extends ArgumentKey>(
  def: ArgumentDefinition<T>,
): ArgumentDefinition<T> {
  return def;
}

// ============================================================
// 5. 映射类型
// ============================================================

type ReadonlyOptions<T> = { readonly [K in keyof T]: T[K] };
type PartialOptions = Partial<CliOptions>;
type WritableOptions<T> = { -readonly [K in keyof T]: T[K] };

// ============================================================
// 6. 条件类型
// ============================================================

type GreetingResult<T extends Language> = T extends Language ? string : never;

type ColorOf<T extends Language> = T extends Language.English
  ? AnsiColor.Green
  : T extends Language.Chinese
    ? AnsiColor.Red
    : T extends Language.Japanese
      ? AnsiColor.Cyan
      : T extends Language.French
        ? AnsiColor.Blue
        : T extends Language.Spanish
          ? AnsiColor.Yellow
          : T extends Language.German
            ? AnsiColor.Magenta
            : AnsiColor.Bold;

// ============================================================
// 7. 模板字面量类型
// ============================================================

type GreetingPrefix = `Hello, ${string}!`;
type FormattedGreeting<L extends string> = `[${L}] ${string}`;

// ============================================================
// 8. 元组与 readonly 元组
// ============================================================

const ARG_DEFINITIONS = [
  defineArg({
    key: "name",
    shortFlag: "-n",
    longFlag: "--name",
    description: "指定问候对象名称",
    requiresValue: true,
  }),
  defineArg({
    key: "language",
    shortFlag: "-l",
    longFlag: "--language",
    description: "选择语言",
    requiresValue: true,
  }),
  defineArg({
    key: "repeat",
    shortFlag: "-r",
    longFlag: "--repeat",
    description: "重复次数",
    requiresValue: true,
  }),
  defineArg({
    key: "style",
    shortFlag: "-s",
    longFlag: "--style",
    description: "输出风格 plain|boxed|inline",
    requiresValue: true,
  }),
  defineArg({
    key: "verbose",
    shortFlag: "-v",
    longFlag: "--verbose",
    description: "详细输出",
    requiresValue: false,
  }),
  defineArg({
    key: "color",
    shortFlag: "-c",
    longFlag: "--color",
    description: "启用彩色输出",
    requiresValue: false,
  }),
] as const satisfies readonly ArgumentDefinition<ArgumentKey>[];

// ============================================================
// 9. as const 断言 + satisfies
// ============================================================

const GREETINGS = {
  [Language.English]: {
    template: "Hello, {0}! Welcome to TypeScript CLI.",
    locale: "en-US",
    color: AnsiColor.Green,
  },
  [Language.Chinese]: {
    template: "你好，{0}！欢迎使用 TypeScript CLI。",
    locale: "zh-CN",
    color: AnsiColor.Red,
  },
  [Language.Japanese]: {
    template: "こんにちは、{0}！TypeScript CLI へようこそ。",
    locale: "ja-JP",
    color: AnsiColor.Cyan,
  },
  [Language.French]: {
    template: `Bonjour, {0} ! Bienvenue dans TypeScript CLI.`,
    locale: "fr-FR",
    color: AnsiColor.Blue,
  },
  [Language.Spanish]: {
    template: "¡Hola, {0}! Bienvenido a TypeScript CLI.",
    locale: "es-ES",
    color: AnsiColor.Yellow,
  },
  [Language.German]: {
    template: "Hallo, {0}! Willkommen bei TypeScript CLI.",
    locale: "de-DE",
    color: AnsiColor.Magenta,
  },
  [Language.Korean]: {
    template: "안녕하세요, {0}! TypeScript CLI에 오신 것을 환영합니다.",
    locale: "ko-KR",
    color: AnsiColor.Bold,
  },
} as const satisfies Record<Language, Omit<GreetingEntry, "language">>;

// ============================================================
// 10. 判别联合 (Discriminated Union)
// ============================================================

type CliEvent =
  | {
      readonly type: "flag";
      readonly flag: string;
      readonly value: string | null;
    }
  | { readonly type: "positional"; readonly value: string }
  | { readonly type: "unknown"; readonly raw: string };

// ============================================================
// 11. 类型守卫
// ============================================================

function isLanguage(value: string): value is Language {
  return Object.values(Language).includes(value as Language);
}

function isOutputStyle(value: string): value is OutputStyle {
  return Object.values(OutputStyle).includes(value as OutputStyle);
}

function isNumberString(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

// ============================================================
// 12. 函数重载
// ============================================================

function resolveGreeting(language: Language): GreetingEntry;
function resolveGreeting(language: Language, fallback: Language): GreetingEntry;
function resolveGreeting(
  language: Language,
  fallback?: Language,
): GreetingEntry {
  const entry = GREETINGS[language];
  if (entry) {
    return { language, ...entry };
  }
  if (fallback !== undefined) {
    return { language: fallback, ...GREETINGS[fallback] };
  }
  return { language: Language.English, ...GREETINGS[Language.English] };
}

function parseDuration(input: string): number;
function parseDuration(input: string, min: number, max: number): number;
function parseDuration(input: string, min?: number, max?: number): number {
  const val = parseInt(input, 10);
  if (isNaN(val)) throw new InvalidRepeatError(input);
  if (min !== undefined && val < min) return min;
  if (max !== undefined && val > max) return max;
  return val;
}

// ============================================================
// 13. 索引签名
// ============================================================

interface ArgMap {
  [flag: string]: string | boolean;
}

// ============================================================
// 14. 抽象类
// ============================================================

abstract class BaseGreetingStrategy implements GreetingStrategy {
  abstract readonly name: string;
  abstract format(greeting: string, repeat: number): string;

  protected repeatText(text: string, count: number): readonly string[] {
    return Array.from({ length: count }, () => text);
  }
}

class BoxedStrategy extends BaseGreetingStrategy {
  readonly name = "boxed";

  format(greeting: string, repeat: number): string {
    const maxLen = greeting.length;
    const border = "=".repeat(maxLen + 4);
    const lines = this.repeatText(`| ${greeting.padEnd(maxLen)} |`, repeat);
    return [`\n${border}`, ...lines, `${border}\n`].join("\n");
  }
}

class PlainStrategy extends BaseGreetingStrategy {
  readonly name = "plain";

  format(greeting: string, repeat: number): string {
    return this.repeatText(greeting, repeat).join("\n");
  }
}

class InlineStrategy extends BaseGreetingStrategy {
  readonly name = "inline";

  format(greeting: string, repeat: number): string {
    return this.repeatText(greeting, repeat).join(" | ");
  }
}

// ============================================================
// 15. 问候历史记录 (History tracker)
// ============================================================

class GreetingHistory {
  private readonly records: HistoryRecord[] = [];
  private nextId = 1;
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  add(name: string, language: Language, greeting: string): void {
    const record: HistoryRecord = {
      id: this.nextId++,
      timestamp: new Date(),
      name,
      language,
      greeting,
    };
    this.records.push(record);
    if (this.records.length > this.maxSize) {
      this.records.shift();
    }
  }

  get count(): number {
    return this.records.length;
  }

  get last(): HistoryRecord | undefined {
    return this.records[this.records.length - 1];
  }

  *iterate(): Generator<HistoryRecord, void, unknown> {
    for (const record of this.records) {
      yield record;
    }
  }

  filter(predicate: (r: HistoryRecord) => boolean): readonly HistoryRecord[] {
    return this.records.filter(predicate);
  }

  toSummary(): string[] {
    return this.records.map(
      (r) =>
        `[${r.id}] ${r.timestamp.toISOString()} | ${r.language} | ${r.name} → ${r.greeting.substring(0, 40)}...`,
    );
  }
}

// ============================================================
// 16. 工具函数
// ============================================================

function applyColor(text: string, color: AnsiColor, enabled: boolean): string {
  return enabled ? `${color}${text}${AnsiColor.Reset}` : text;
}

function fillTemplate(template: string, name: string): string {
  return template.replace("{0}", name);
}

function getStrategy(style: OutputStyle): GreetingStrategy {
  switch (style) {
    case OutputStyle.Boxed:
      return new BoxedStrategy();
    case OutputStyle.Inline:
      return new InlineStrategy();
    case OutputStyle.Plain:
    default:
      return new PlainStrategy();
  }
}

// ============================================================
// 17. 参数解析（使用判别联合 + 泛型）
// ============================================================

function classifyArg(raw: string, index: number, args: string[]): CliEvent {
  if (raw.startsWith("--")) {
    const next = args[index + 1];
    return {
      type: "flag",
      flag: raw,
      value: next && !next.startsWith("-") ? next : null,
    };
  }
  if (raw.startsWith("-") && raw.length === 2) {
    const next = args[index + 1];
    return {
      type: "flag",
      flag: raw,
      value: next && !next.startsWith("-") ? next : null,
    };
  }
  return { type: "positional", value: raw };
}

function parseArgs(args: string[]): CliOptions {
  const options: WritableOptions<CliOptions> = {
    name: "World",
    language: Language.English,
    repeat: 1,
    style: OutputStyle.Boxed,
    verbose: false,
    color: true,
  };

  for (let i = 0; i < args.length; i++) {
    const event = classifyArg(args[i], i, args);

    if (event.type === "positional") {
      options.name = event.value;
      continue;
    }

    if (event.type === "flag") {
      const def = ARG_DEFINITIONS.find(
        (d) => d.shortFlag === event.flag || d.longFlag === event.flag,
      );

      if (!def) {
        if (event.flag === "--help" || event.flag === "-h") {
          printHelp();
          process.exit(0);
        }
        continue;
      }

      switch (def.key) {
        case "name":
          if (event.value) options.name = event.value;
          break;
        case "language":
          if (event.value && isLanguage(event.value)) {
            options.language = event.value;
          } else if (event.value) {
            throw new InvalidLanguageError(event.value);
          }
          break;
        case "repeat":
          if (event.value) {
            options.repeat = parseDuration(event.value, 1, 1000);
          }
          break;
        case "style":
          if (event.value && isOutputStyle(event.value)) {
            options.style = event.value;
          }
          break;
        case "verbose":
          options.verbose = true;
          break;
        case "color":
          options.color = true;
          break;
      }
    }
  }

  return options as CliOptions;
}

// ============================================================
// 18. 帮助与横幅
// ============================================================

function printHelp(): void {
  console.log(`
Usage: hello-cli [options] [name]

Options:
${ARG_DEFINITIONS.map((d) => `  ${d.shortFlag}, ${d.longFlag.padEnd(12)} ${d.description}`).join("\n")}
  -h, --help        显示此帮助信息

Languages: en, zh, ja, fr, es, de, ko
Styles:    plain, boxed, inline

Examples:
  hello-cli --name TypeScript
  hello-cli -n Alice -l zh -r 3
  hello-cli Bob -l ja -s inline -v
`);
}

function printVerboseInfo(options: CliOptions): void {
  if (!options.verbose) return;
  console.error(
    `[verbose] name=${options.name}, lang=${options.language}, repeat=${options.repeat}, style=${options.style}`,
  );
}

// ============================================================
// 19. 主入口
// ============================================================

const history = new GreetingHistory(50);

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg =
      err instanceof HelloCliError
        ? `[${err.code}] ${err.message}`
        : String(err);
    console.error(`错误: ${msg}`);
    process.exit(1);
  }

  printVerboseInfo(options);

  const entry = resolveGreeting(options.language, Language.English);
  const greeting = fillTemplate(entry.template, options.name);

  const strategy = getStrategy(options.style);
  const formatted = strategy.format(greeting, options.repeat);

  const colored = applyColor(formatted, entry.color, options.color);
  console.log(colored);

  history.add(options.name, options.language, greeting);

  if (options.verbose) {
    console.error(`[verbose] 历史记录数: ${history.count}`);
  }
}

main();
