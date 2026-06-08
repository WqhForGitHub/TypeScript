#!/usr/bin/env node

/**
 * 随机密码生成器
 *
 * 一个使用纯 TypeScript 实现的随机密码生成器 CLI 工具。
 * 支持自定义密码长度、字符集、排除字符、批量生成等功能。
 */

import * as crypto from "crypto";

// ============================================================
// 类型定义
// ============================================================

/** 密码生成选项 */
interface PasswordOptions {
  /** 密码长度，默认 16 */
  length: number;
  /** 是否包含小写字母，默认 true */
  lowercase: boolean;
  /** 是否包含大写字母，默认 true */
  uppercase: boolean;
  /** 是否包含数字，默认 true */
  numbers: boolean;
  /** 是否包含特殊符号，默认 true */
  symbols: boolean;
  /** 需要排除的字符 */
  exclude: string;
  /** 生成数量，默认 1 */
  count: number;
  /** 是否显示密码强度评估 */
  strength: boolean;
}

/** 密码强度等级 */
enum StrengthLevel {
  VeryWeak = "极弱",
  Weak = "弱",
  Fair = "一般",
  Strong = "强",
  VeryStrong = "极强",
}

/** 密码强度评估结果 */
interface StrengthResult {
  score: number;
  level: StrengthLevel;
  details: string;
}

// ============================================================
// 常量定义
// ============================================================

const CHARSETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  numbers: "0123456789",
  symbols: "!@#$%^&*()_+-=[]{}|;:',.<>?/`~",
};

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
  exclude: "",
  count: 1,
  strength: false,
};

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 使用 crypto.randomInt 生成指定范围内的安全随机整数
 */
function secureRandomInt(max: number): number {
  return crypto.randomInt(max);
}

/**
 * 构建可用字符集（根据选项拼接并排除指定字符）
 */
function buildCharset(options: PasswordOptions): string {
  let charset = "";

  if (options.lowercase) charset += CHARSETS.lowercase;
  if (options.uppercase) charset += CHARSETS.uppercase;
  if (options.numbers) charset += CHARSETS.numbers;
  if (options.symbols) charset += CHARSETS.symbols;

  // 排除指定字符
  if (options.exclude) {
    const excludeSet = new Set(options.exclude.split(""));
    charset = charset
      .split("")
      .filter((ch) => !excludeSet.has(ch))
      .join("");
  }

  return charset;
}

/**
 * 生成单个随机密码
 *
 * 使用 crypto 模块的安全随机数生成器，确保密码的随机性和安全性。
 * 生成的密码保证至少包含每种已启用字符类型的一个字符。
 */
function generatePassword(options: PasswordOptions): string {
  const charset = buildCharset(options);

  if (charset.length === 0) {
    throw new Error("可用字符集为空，请至少启用一种字符类型");
  }

  if (options.length <= 0) {
    throw new Error("密码长度必须大于 0");
  }

  // 收集每种已启用字符类型的字符列表，用于保证至少包含一个
  const requiredChars: string[] = [];
  const enabledTypes: string[] = [];

  if (options.lowercase) {
    const filtered = filterExcluded(CHARSETS.lowercase, options.exclude);
    if (filtered.length > 0) {
      requiredChars.push(filtered[secureRandomInt(filtered.length)]);
      enabledTypes.push(filtered);
    }
  }
  if (options.uppercase) {
    const filtered = filterExcluded(CHARSETS.uppercase, options.exclude);
    if (filtered.length > 0) {
      requiredChars.push(filtered[secureRandomInt(filtered.length)]);
      enabledTypes.push(filtered);
    }
  }
  if (options.numbers) {
    const filtered = filterExcluded(CHARSETS.numbers, options.exclude);
    if (filtered.length > 0) {
      requiredChars.push(filtered[secureRandomInt(filtered.length)]);
      enabledTypes.push(filtered);
    }
  }
  if (options.symbols) {
    const filtered = filterExcluded(CHARSETS.symbols, options.exclude);
    if (filtered.length > 0) {
      requiredChars.push(filtered[secureRandomInt(filtered.length)]);
      enabledTypes.push(filtered);
    }
  }

  // 如果密码长度不足以包含所有必需字符，给出警告但继续生成
  if (requiredChars.length > options.length) {
    throw new Error(
      `密码长度 ${options.length} 不足以包含所有已启用字符类型（至少需要 ${requiredChars.length} 位）`,
    );
  }

  // 填充剩余长度
  const remaining = options.length - requiredChars.length;
  const fillerChars: string[] = [];
  for (let i = 0; i < remaining; i++) {
    fillerChars.push(charset[secureRandomInt(charset.length)]);
  }

  // 合并并随机打乱顺序（Fisher-Yates 洗牌算法）
  const allChars = [...requiredChars, ...fillerChars];
  for (let i = allChars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [allChars[i], allChars[j]] = [allChars[j], allChars[i]];
  }

  return allChars.join("");
}

/**
 * 过滤掉被排除的字符
 */
function filterExcluded(charset: string, exclude: string): string {
  if (!exclude) return charset;
  const excludeSet = new Set(exclude.split(""));
  return charset
    .split("")
    .filter((ch) => !excludeSet.has(ch))
    .join("");
}

/**
 * 评估密码强度
 *
 * 评分规则：
 * - 长度评分：每增加 4 位 +10 分（上限 30 分）
 * - 字符类型评分：每种启用的字符类型 +20 分（上限 80 分）
 * - 字符分布均匀性：+10 分
 *
 * 总分范围 0-100：
 *   0-20: 极弱
 *  21-40: 弱
 *  41-60: 一般
 *  61-80: 强
 *  81-100: 极强
 */
function evaluateStrength(password: string): StrengthResult {
  let score = 0;
  const details: string[] = [];

  // 长度评分
  const lengthScore = Math.min(30, Math.floor(password.length / 4) * 10);
  score += lengthScore;
  details.push(`长度 ${password.length} 位 (+${lengthScore}分)`);

  // 字符类型评分
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);

  const typeCount = [hasLower, hasUpper, hasNumber, hasSymbol].filter(
    Boolean,
  ).length;
  const typeScore = typeCount * 20;
  score += typeScore;

  const typeNames: string[] = [];
  if (hasLower) typeNames.push("小写字母");
  if (hasUpper) typeNames.push("大写字母");
  if (hasNumber) typeNames.push("数字");
  if (hasSymbol) typeNames.push("特殊符号");
  details.push(`包含 ${typeNames.join("、")} (+${typeScore}分)`);

  // 字符分布均匀性
  const uniqueChars = new Set(password.split("")).size;
  const uniqueRatio = uniqueChars / password.length;
  const uniformScore = uniqueRatio > 0.7 ? 10 : uniqueRatio > 0.5 ? 5 : 0;
  score += uniformScore;
  details.push(
    `字符唯一率 ${(uniqueRatio * 100).toFixed(0)}% (+${uniformScore}分)`,
  );

  // 确定等级（分数上限 100）
  score = Math.min(100, score);
  let level: StrengthLevel;
  if (score <= 20) level = StrengthLevel.VeryWeak;
  else if (score <= 40) level = StrengthLevel.Weak;
  else if (score <= 60) level = StrengthLevel.Fair;
  else if (score <= 80) level = StrengthLevel.Strong;
  else level = StrengthLevel.VeryStrong;

  return {
    score,
    level,
    details: details.join("；"),
  };
}

// ============================================================
// CLI 参数解析
// ============================================================

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): PasswordOptions {
  const options: PasswordOptions = { ...DEFAULT_OPTIONS };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case "-l":
      case "--length": {
        const val = parseInt(args[++i], 10);
        if (isNaN(val) || val <= 0) {
          console.error(`错误：无效的密码长度 "${args[i]}"，必须为正整数`);
          process.exit(1);
        }
        options.length = val;
        break;
      }
      case "--no-lowercase":
        options.lowercase = false;
        break;
      case "--no-uppercase":
        options.uppercase = false;
        break;
      case "--no-numbers":
        options.numbers = false;
        break;
      case "--no-symbols":
        options.symbols = false;
        break;
      case "-e":
      case "--exclude": {
        options.exclude = args[++i] || "";
        break;
      }
      case "-c":
      case "--count": {
        const val = parseInt(args[++i], 10);
        if (isNaN(val) || val <= 0) {
          console.error(`错误：无效的生成数量 "${args[i]}"，必须为正整数`);
          process.exit(1);
        }
        options.count = val;
        break;
      }
      case "-s":
      case "--strength":
        options.strength = true;
        break;
      case "-h":
      case "--help":
        showHelp();
        process.exit(0);
      case "-v":
      case "--version":
        console.log("随机密码生成器 v1.0.0");
        process.exit(0);
      default:
        console.error(`错误：未知选项 "${arg}"`);
        console.error("使用 --help 查看帮助信息");
        process.exit(1);
    }

    i++;
  }

  return options;
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
随机密码生成器 - 使用纯 TypeScript 实现的安全随机密码生成器

用法：
  random-password-generator [选项]

选项：
  -l, --length <数字>      密码长度，默认 16
  --no-lowercase           不包含小写字母
  --no-uppercase           不包含大写字母
  --no-numbers             不包含数字
  --no-symbols             不包含特殊符号
  -e, --exclude <字符>     排除指定字符
  -c, --count <数字>       生成密码数量，默认 1
  -s, --strength           显示密码强度评估
  -h, --help               显示帮助信息
  -v, --version            显示版本号

示例：
  random-password-generator                        生成 16 位默认密码
  random-password-generator -l 20                  生成 20 位密码
  random-password-generator -l 12 --no-symbols     生成不含符号的 12 位密码
  random-password-generator -e "0OlI1"             排除易混淆字符
  random-password-generator -c 5 -s                生成 5 个密码并显示强度
`);
}

// ============================================================
// 主函数
// ============================================================

function main(): void {
  const args = process.argv.slice(2);

  // 无参数时使用默认选项
  const options = parseArgs(args);

  try {
    console.log(`\n🔑 随机密码生成器\n${"─".repeat(40)}\n`);

    for (let i = 0; i < options.count; i++) {
      const password = generatePassword(options);

      if (options.count > 1) {
        console.log(`密码 ${i + 1}:`);
      }

      console.log(`  ${password}`);

      if (options.strength) {
        const result = evaluateStrength(password);
        console.log(`  强度: ${result.level} (${result.score}/100)`);
        console.log(`  ${result.details}`);
      }

      if (options.count > 1 && i < options.count - 1) {
        console.log("");
      }
    }

    console.log(`\n${"─".repeat(40)}`);

    // 显示生成配置摘要
    const charsetInfo: string[] = [];
    if (options.lowercase) charsetInfo.push("小写");
    if (options.uppercase) charsetInfo.push("大写");
    if (options.numbers) charsetInfo.push("数字");
    if (options.symbols) charsetInfo.push("符号");

    console.log(
      `配置: ${options.length} 位 | 字符集: ${charsetInfo.join("+")}${
        options.exclude ? ` | 排除: "${options.exclude}"` : ""
      }\n`,
    );
  } catch (error) {
    console.error(
      `\n错误: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

main();
