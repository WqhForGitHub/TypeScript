# CLI 插件化架构 Demo

纯 TypeScript 实现的 CLI 插件化架构，展示插件系统的核心设计模式。

## 架构设计

```
┌──────────────────────────────────────────────┐
│                  CLI 入口                      │
│            (参数解析 / REPL)                    │
├──────────────────────────────────────────────┤
│              PluginManager                     │
│         (插件生命周期 / 钩子调度)                │
├──────────┬──────────┬────────────────────────┤
│ EventBus │ Command  │      Hook System       │
│ (事件总线)│ Registry │  (beforeCommand/       │
│          │ (命令注册)│   afterCommand/        │
│          │          │   onInit/onDestroy/    │
│          │          │   onError)             │
├──────────┴──────────┴────────────────────────┤
│                 PluginContext                  │
│    (registerCommand / registerHook / emit)     │
├──────────┬──────────┬──────────┬─────────────┤
│  greet   │  calc    │  time    │   logger    │
│  插件    │  插件    │  插件    │   插件      │
└──────────┴──────────┴──────────┴─────────────┘
```

## 核心概念

### 插件 (Plugin)

每个插件通过 `register()` 函数导出，包含元信息 (`meta`) 和初始化方法 (`init`)：

- `meta.name` - 唯一标识
- `meta.dependencies` - 声明的插件依赖
- `init(context)` - 接收 PluginContext 进行命令/钩子/事件注册

### 插件上下文 (PluginContext)

插件与宿主交互的唯一接口：

- `registerCommand()` - 注册命令
- `registerHook()` - 注册生命周期钩子
- `emit()` / `on()` - 通过事件总线通信
- `getPlugin()` - 获取其他插件实例
- `logger` - 日志工具

### 钩子 (Hooks)

5 种生命周期钩子：

| 钩子            | 触发时机             |
| --------------- | -------------------- |
| `onInit`        | 所有插件初始化完成后 |
| `beforeCommand` | 命令执行前           |
| `afterCommand`  | 命令执行后           |
| `onError`       | 发生错误时           |
| `onDestroy`     | 插件管理器销毁时     |

### 事件总线 (EventBus)

插件间松耦合通信：

- `calc` 插件发出 `calc:operation` 事件
- `time` 插件发出 `timer:started` / `timer:stopped` 事件
- `logger` 插件监听以上事件并记录日志

## 项目结构

```
99. CLI 插件化架构/
├── src/
│   ├── index.ts                 # CLI 入口 (参数解析 / REPL)
│   ├── core/
│   │   ├── types.ts             # 核心类型定义
│   │   ├── plugin-manager.ts    # 插件管理器
│   │   ├── event-bus.ts         # 事件总线
│   │   └── command-registry.ts  # 命令注册表
│   └── plugins/
│       ├── greet.ts             # 问候插件
│       ├── calc.ts              # 计算器插件 (依赖 logger)
│       ├── time.ts              # 时间插件
│       └── logger.ts            # 日志插件
├── package.json
└── tsconfig.json
```

## 使用方法

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 运行

**交互式 REPL 模式** (无参数启动):

```bash
npm start
```

**单命令模式**:

```bash
npm start -- greet 世界
npm start -- greet 世界 --formal
npm start -- calc add 10 20
npm start -- calc div 100 3
npm start -- sqrt 144
npm start -- time
npm start -- time --format iso
npm start -- timer start mytimer
npm start -- timer stop mytimer
npm start -- logs
npm start -- logs --clear
npm start -- plugins
npm start -- help
```

### 一键构建运行

```bash
npm run dev
```

## 内置插件命令

| 命令                    | 别名          | 插件   | 说明                       |
| ----------------------- | ------------- | ------ | -------------------------- |
| `greet <name>`          | hello, hi     | greet  | 向某人问候                 |
| `greet <name> --formal` |               | greet  | 正式问候                   |
| `bye <name>`            | goodbye       | greet  | 告别                       |
| `calc <op> <a> <b>`     | compute, math | calc   | 数学运算 (add/sub/mul/div) |
| `sqrt <n>`              |               | calc   | 平方根                     |
| `time`                  | now           | time   | 当前时间                   |
| `time --format <fmt>`   |               | time   | iso/locale/unix 格式       |
| `timer start <name>`    | stopwatch     | time   | 启动计时器                 |
| `timer stop <name>`     |               | time   | 停止计时器                 |
| `timer list`            |               | time   | 列出运行中的计时器         |
| `logs`                  | history       | logger | 查看操作日志               |
| `logs --clear`          |               | logger | 清除日志                   |
| `plugins`               | list-plugins  | logger | 列出已加载插件             |

## 示例输出

```
═══════════════════════════════════════════════
           CLI 插件化架构 Demo
═══════════════════════════════════════════════

▸ 初始化插件: logger v1.0.0
▸ 初始化插件: greet v1.0.0
▸ 初始化插件: time v1.0.0
▸ 初始化插件: calc v1.0.0

✓ 初始化完成: 4 个插件已加载, 8 条命令已注册

pluggy> greet TypeScript
你好, TypeScript! 👋

pluggy> calc add 10 20
10 + 20 = 30

pluggy> logs
操作日志 (2 条):
──────────────────────────────────────────────────
  14:30:15 [COMMAND] 执行命令: greet TypeScript
  14:30:22 [COMMAND] 执行命令: calc add 10 20
──────────────────────────────────────────────────
```
