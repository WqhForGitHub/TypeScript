# 倒计时计时器 (Countdown Timer)

一个使用 **纯 TypeScript** 编写的命令行倒计时计时器示例。

## 功能特性

- 支持多种时长格式：`30` / `90s` / `1m30s` / `1h` / `1d2h3m4s`
- 支持倒计时到指定时间点：`--to "2026-01-01 00:00:00"`
- 实时刷新显示剩余时间（基于 `setInterval` + `process.stdout` 的 ANSI 控制）
- 基于 `endTime - now()` 计算剩余时间，避免长时间累积漂移
- 支持 `Ctrl+C` 优雅中断
- 严格的 TypeScript 类型系统：
  - 使用 `TimeUnit` 字面量联合类型限定 `"d" | "h" | "m" | "s"`
  - 使用 `TimeParts` 接口描述天/时/分/秒分量
  - 使用 `ParsedArgs` 接口描述解析后的参数

## 项目结构

```
05. 倒计时计时器/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── index.ts
```

## 安装依赖

```bash
npm install
```

## 编译与运行

```bash
# 编译
npm run build

# 运行 (显示帮助)
npm start

# 一键编译并运行
npm run dev
```

## 使用示例

```bash
# 倒计时 30 秒 (纯数字视为秒)
node dist/index.js 30

# 倒计时 90 秒
node dist/index.js 90s

# 倒计时 1 分 30 秒
node dist/index.js 1m30s

# 倒计时 1 小时
node dist/index.js 1h

# 倒计时 1 天 2 小时 3 分 4 秒
node dist/index.js 1d2h3m4s

# 倒计时到指定时间
node dist/index.js --to "2026-01-01 00:00:00"

# 显示帮助
node dist/index.js --help
```

## 示例输出

```
🚀 开始：倒计时 1m30s (共 00:01:30)
⏳ 倒计时 1m30s (共 00:01:30)  剩余: 00:01:29
...
✅ 倒计时 1m30s (共 00:01:30)  倒计时结束！
```

## 核心实现说明

| 函数                        | 作用                                                |
| --------------------------- | --------------------------------------------------- |
| `parseDuration(input)`      | 解析 `30` / `1m30s` / `1d2h3m4s` 等时长字符串为毫秒 |
| `parseTargetTime(input)`    | 解析目标时间字符串为剩余毫秒                        |
| `splitDuration(ms)`         | 将毫秒数拆分为 `TimeParts` (天/时/分/秒)            |
| `formatTimeParts(parts)`    | 渲染为 `DD 天 HH:mm:ss` 或 `HH:mm:ss`               |
| `startCountdown(ms, label)` | 启动倒计时，返回 Promise；用 ANSI 控制行内刷新      |
| `parseArgs(argv)`           | 解析并校验命令行参数                                |

## 关于 ANSI 行刷新

倒计时使用以下 ANSI 控制序列实现行内刷新：

| 序列        | 作用                 |
| ----------- | -------------------- |
| `\r\x1b[2K` | 回到行首并清除当前行 |
| `\x1b[?25l` | 隐藏光标             |
| `\x1b[?25h` | 显示光标             |

在大多数现代终端（Windows Terminal / macOS Terminal / Linux 终端）中均能正常工作。

## License

ISC
