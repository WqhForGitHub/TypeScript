# 简易日历生成器 (Simple Calendar Generator)

一个使用 **纯 TypeScript** 编写的命令行日历生成器示例。

## 功能特性

- 显示当前月份日历（无参数时）
- 显示指定年份的全年日历
- 显示指定年月的日历
- 自动处理闰年（2 月 29 天）
- 中文星期标题（日 一 二 三 四 五 六）
- 严格的 TypeScript 类型系统：
  - 使用 `Month` 字面量联合类型限定 1-12
  - 使用 `Weekday` 字面量联合类型限定 0-6
  - 使用 `CalendarCell` / `CalendarWeek` 表示日历单元

## 项目结构

```
04. 简易日历生成器/
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

# 运行 (显示当前月)
npm start

# 一键编译并运行
npm run dev
```

## 使用示例

```bash
# 显示当前月份
node dist/index.js

# 显示 2026 年全年日历
node dist/index.js 2026

# 显示 2026 年 6 月日历
node dist/index.js 2026 6

# 显示帮助
node dist/index.js --help
```

## 示例输出

```
   2026 年 六月
日 一 二 三 四 五 六
    1  2  3  4  5  6
 7  8  9 10 11 12 13
14 15 16 17 18 19 20
21 22 23 24 25 26 27
28 29 30
```

## 核心实现说明

| 函数 | 作用 |
| ---- | ---- |
| `isLeapYear(year)` | 判断闰年（4 整除且非 100，或 400 整除） |
| `getDaysInMonth(year, month)` | 获取指定月的天数 |
| `getFirstWeekday(year, month)` | 获取该月 1 号是周几 |
| `buildMonthMatrix(year, month)` | 构建按周分行的二维日历表 |
| `renderMonth(year, month)` | 渲染单个月份为字符串 |
| `renderYear(year)` | 渲染整年日历 |
| `parseArgs(argv)` | 解析并校验命令行参数 |

## License

ISC
