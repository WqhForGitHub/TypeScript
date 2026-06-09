# Todo CLI

一个使用 **纯 TypeScript** 编写的命令行 Todo 管理工具。

## 项目结构

```
12. Todo CLI/
├── src/
│   └── index.ts        # CLI 入口源代码
├── dist/               # 编译产物 (执行 build 后生成)
├── package.json
├── tsconfig.json
└── README.md
```

## 安装依赖

```bash
cd "demo/12. Todo CLI"
npm install
```

## 构建

```bash
npm run build
```

将 TypeScript 编译为 JavaScript，输出到 `dist/` 目录。

## 运行

```bash
# 查看帮助
node dist/index.js help

# 添加任务
node dist/index.js add "学习 TypeScript"

# 列出所有任务
node dist/index.js list

# 标记完成
node dist/index.js done 1

# 取消完成
node dist/index.js undone 1

# 编辑任务
node dist/index.js edit 1 "学习 TypeScript 高级类型"

# 删除任务
node dist/index.js delete 1

# 清除已完成任务
node dist/index.js clear

# 查看统计
node dist/index.js stats
```

## 一键构建并运行

```bash
npm run dev
```

## 支持的命令

| 命令               | 简写  | 说明                   |
| ------------------ | ----- | ---------------------- |
| `add <内容>`       | `new` | 添加一条新任务         |
| `list`             | `ls`  | 列出所有任务           |
| `done <id>`        |       | 标记指定任务为已完成   |
| `undone <id>`      |       | 取消指定任务的完成状态 |
| `edit <id> <内容>` |       | 编辑指定任务的内容     |
| `delete <id>`      | `rm`  | 删除指定任务           |
| `clear`            |       | 清除所有已完成的任务   |
| `stats`            |       | 显示任务统计信息       |
| `help`             | `-h`  | 显示帮助信息           |

## 数据存储

任务数据以 JSON 格式持久化在用户主目录下 `~/.todo-cli/todos.json`。

## 示例输出

```
$ todo-cli list

  Todo 列表 (共 3 项，已完成 1 项)
  ────────────────────────────────────────
  [ ] 1  学习 TypeScript
  [x] 2  初始化项目
  [ ] 3  编写单元测试
  ────────────────────────────────────────
```
