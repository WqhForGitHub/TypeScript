# 文件系统监控工具

一个使用 **纯 TypeScript** 编写的文件系统监控工具。

## 功能特性

- 监控指定目录的文件创建、修改、删除、重命名事件
- 支持递归监控子目录
- 支持通过 glob 模式过滤监控目标（包含/排除）
- 支持文件内容变化差异提示
- 支持事件防抖，避免频繁触发
- 支持实时统计监控数据（事件计数、监控文件数等）
- 支持将监控日志输出到文件
- 彩色终端输出
- 优雅退出并显示监控摘要

## 项目结构

```
96. 文件系统监控工具/
├── src/
│   └── index.ts          # 源代码
├── dist/                  # 编译输出
├── package.json
├── tsconfig.json
└── README.md
```

## 安装依赖

```bash
npm install
```

## 构建

```bash
npm run build
```

## 运行

```bash
# 监控当前目录
npm start -- .

# 监控指定目录
node dist/index.js ./src

# 只监控 .ts 文件
node dist/index.js ./src -i "*.ts"

# 排除日志文件并显示差异和统计
node dist/index.js ./project -e "*.log" --diff --stats

# 将日志输出到文件
node dist/index.js ./src -o watch.log
```

## 一键构建并运行

```bash
npm run dev
```

## 选项说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-r, --recursive` | 递归监控子目录 | 开启 |
| `--no-recursive` | 不递归监控子目录 | - |
| `-i, --include <glob>` | 只监控匹配 glob 模式的文件（可多次指定） | 无 |
| `-e, --exclude <glob>` | 排除匹配 glob 模式的文件（可多次指定） | `node_modules/**`, `.git/**`, `dist/**`, `*.log` |
| `-d, --debounce <ms>` | 事件防抖时间（毫秒） | 100 |
| `-o, --output <file>` | 将日志输出到文件 | 无 |
| `--diff` | 显示文件内容变化差异 | 关闭 |
| `--stats` | 显示实时统计信息（每10秒） | 关闭 |
| `-h, --help` | 显示帮助信息 | - |

## 事件类型

| 图标 | 类型 | 说明 |
|------|------|------|
| `+` | CREATE | 文件被创建 |
| `~` | UPDATE | 文件内容被修改 |
| `-` | DELETE | 文件被删除 |
| `>` | RENAME | 文件被重命名 |

## 示例输出

```
  ╔══════════════════════════════════════════╗
  ║       文件系统监控工具 v1.0.0           ║
  ╚══════════════════════════════════════════╝

  监控目录: E:\project\src
  递归监控: 是
  排除模式: node_modules/**, .git/**, dist/**, *.log
  防抖时间: 100ms
  内容差异: 开启
  已发现文件: 12 个

  按 Ctrl+C 停止监控
  ────────────────────────────────────────────

  14:32:05  + CREATE  utils/helper.ts (1.2 KB)
  14:32:18  ~ UPDATE  index.ts (3.5 KB)
    - 3: const VERSION = "1.0.0";
    + 3: const VERSION = "1.1.0";
  14:33:01  - DELETE  temp.ts
  14:33:45  > RENAME  old-name.ts → new-name.ts
```
