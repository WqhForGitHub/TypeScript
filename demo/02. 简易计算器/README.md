# 简易计算器 (Simple Calculator CLI)

一个使用纯 **TypeScript** 编写的命令行简易计算器演示。

实现要点：

- 词法分析 (Tokenizer)
- Shunting Yard 算法：中缀表达式转后缀表达式 (RPN)
- 后缀表达式求值
- 支持交互模式与单次执行模式

## 支持的运算

| 运算符 | 含义     | 优先级 | 结合性 |
| ------ | -------- | ------ | ------ |
| `+`    | 加法     | 1      | 左     |
| `-`    | 减法     | 1      | 左     |
| `*`    | 乘法     | 2      | 左     |
| `/`    | 除法     | 2      | 左     |
| `%`    | 取模     | 2      | 左     |
| `^`    | 幂运算   | 3      | 右     |
| `( )`  | 括号嵌套 | -      | -      |

支持小数、负数与括号嵌套。

## 安装

```bash
npm install
```

## 构建

```bash
npm run build
```

## 使用

### 1. 交互模式

```bash
npm start
```

示例：

```
calc> 1 + 2 * 3
= 7
calc> (1 + 2) * (3 - 4)
= -3
calc> 2 ^ 10
= 1024
calc> 10 % 3
= 1
calc> exit
再见！
```

### 2. 直接计算表达式

```bash
node dist/index.js "1 + 2 * 3"
# 输出: 7

node dist/index.js "(1 + 2.5) * -4"
# 输出: -14
```

### 3. 查看帮助

```bash
node dist/index.js --help
```

## 项目结构

```
02. 简易计算器/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── index.ts        # 计算器主程序
```

## TypeScript 知识点演示

- 字面量联合类型 (`type TokenType = "number" | "operator" | ...`)
- 接口 (`interface Token`, `interface OperatorInfo`)
- 索引类型 (`Record<Operator, OperatorInfo>`)
- 类型守卫与运行时错误抛出
- 非空断言 `!` 与可选链
- 严格模式 (`"strict": true`) 下的类型安全编程
