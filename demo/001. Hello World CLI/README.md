# Hello World CLI

一个使用 **纯 TypeScript** 编写的命令行 Demo。

## 项目结构

```
01. Hello World CLI/
├── src/
│   └── index.ts        # CLI 入口源代码
├── dist/               # 编译产物 (执行 build 后生成)
├── package.json
├── tsconfig.json
└── README.md
```

## 安装依赖

```bash
cd "demo/01. Hello World CLI"
npm install
```

## 构建

```bash
npm run build
```

将 TypeScript 编译为 JavaScript，输出到 `dist/` 目录。

## 运行

```bash
# 默认输出
npm start

# 自定义参数
node dist/index.js --name TypeScript --language zh --repeat 3

# 简写
node dist/index.js -n Alice -l ja -r 2

# 查看帮助
node dist/index.js --help
```

## 一键构建并运行

```bash
npm run dev
```

## 支持的参数

| 参数         | 简写 | 说明               | 默认值  |
| ------------ | ---- | ------------------ | ------- |
| `--name`     | `-n` | 问候对象名称       | `World` |
| `--language` | `-l` | 语言 (en/zh/ja/fr) | `en`    |
| `--repeat`   | `-r` | 重复输出次数       | `1`     |
| `--help`     | `-h` | 显示帮助信息       | -       |

## 示例输出

```
======================================================
| 你好，TypeScript！欢迎使用 TypeScript CLI。           |
======================================================
```
