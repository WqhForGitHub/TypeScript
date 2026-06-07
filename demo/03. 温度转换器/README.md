# 温度转换器 (Temperature Converter)

一个使用 **纯 TypeScript** 编写的命令行温度转换器演示。

支持单位：

| 缩写 | 单位名称              | 符号 |
| ---- | --------------------- | ---- |
| C    | 摄氏度 (Celsius)      | °C   |
| F    | 华氏度 (Fahrenheit)   | °F   |
| K    | 开尔文 (Kelvin)       | K    |

## 安装

```bash
npm install
npm run build
```

## 使用

### 1. 直接命令行模式

```bash
# 100 摄氏度 → 华氏度
node dist/index.js 100 C F
# 输出: 100 °C  =  212 °F

# 32 华氏度 → 摄氏度
node dist/index.js 32 F C

# 打印一张换算表
node dist/index.js --table 25 C
```

### 2. 交互模式

直接运行（不带参数）即可进入交互模式：

```bash
npm start
```

```
==========================================
   TypeScript 温度转换器  (temp-cli)
==========================================
支持单位：C (摄氏度)  F (华氏度)  K (开尔文)
示例输入：100 C F   或   32F to C   或   300 K C
输入 'help' 查看帮助，输入 'exit' 退出。

temp> 100 C F
= 100 °C  =  212 °F
temp> 32F to C
= 32 °F  =  0 °C
temp> exit
再见！
```

### 3. 帮助

```bash
node dist/index.js --help
```

## 转换公式

所有转换均先转为 **开尔文 (K)** 作为中间单位：

- C → K：`K = C + 273.15`
- F → K：`K = (F - 32) × 5 / 9 + 273.15`
- K → C：`C = K - 273.15`
- K → F：`F = (K - 273.15) × 9 / 5 + 32`

## 安全校验

输入温度不能低于该单位下的 **绝对零度**：

- C：`-273.15 °C`
- F：`-459.67 °F`
- K：`0 K`

低于绝对零度时会输出错误并退出（CLI 模式下返回非零退出码）。

## 项目结构

```
03. 温度转换器/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── index.ts
```
