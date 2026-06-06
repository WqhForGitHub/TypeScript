#!/usr/bin/env node

/**
 * Hello World CLI
 * 一个使用纯 TypeScript 编写的命令行演示程序。
 */

interface CliOptions {
  name: string;
  language: string;
  repeat: number;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    name: "World",
    language: "en",
    repeat: 1,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--name":
      case "-n":
        options.name = args[++i] ?? options.name;
        break;
      case "--language":
      case "-l":
        options.language = args[++i] ?? options.language;
        break;
      case "--repeat":
      case "-r": {
        const val = parseInt(args[++i] ?? "1", 10);
        options.repeat = isNaN(val) ? 1 : Math.max(1, val);
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage: hello-cli [options]

Options:
  -n, --name <name>      指定问候对象名称 (默认: World)
  -l, --language <lang>  选择语言 en | zh | ja | fr (默认: en)
  -r, --repeat <count>   重复次数 (默认: 1)
  -h, --help             显示此帮助信息

Examples:
  hello-cli --name TypeScript
  hello-cli -n Alice -l zh -r 3
`);
}

function getGreeting(name: string, language: string): string {
  const greetings: Record<string, string> = {
    en: `Hello, ${name}! Welcome to TypeScript CLI.`,
    zh: `你好，${name}！欢迎使用 TypeScript CLI。`,
    ja: `こんにちは、${name}！TypeScript CLI へようこそ。`,
    fr: `Bonjour, ${name} ! Bienvenue dans TypeScript CLI.`,
  };

  return greetings[language] ?? greetings["en"];
}

function printRepeated(greeting: string, count: number): void {
  const maxLen = greeting.length;
  const border = "=".repeat(maxLen + 4);

  console.log(`\n${border}`);
  for (let i = 0; i < count; i++) {
    const line = `| ${greeting.padEnd(maxLen)} |`;
    console.log(line);
  }
  console.log(`${border}\n`);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const greeting = getGreeting(options.name, options.language);
  printRepeated(greeting, options.repeat);
}

main();
