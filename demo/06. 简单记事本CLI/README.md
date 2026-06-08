# 简单记事本 CLI

一个使用 **纯 TypeScript** 编写的命令行记事本工具，无任何第三方运行时依赖，仅使用 Node.js 内置模块（`fs` / `path` / `os` / `readline`）实现。

支持新建、查看、编辑、删除和搜索笔记，数据以 JSON 格式持久化到用户主目录下。

---

## 功能特性

- 列出所有笔记（含 ID、创建时间、更新时间、标题）
- 新建笔记（支持多行内容输入）
- 查看指定 ID 笔记完整内容
- 编辑指定 ID 笔记内容
- 删除指定 ID 笔记
- 在标题与内容中按关键字搜索
- 数据持久化到 `~/.simple-notepad-cli/notes.json`

---

## 目录结构

```
06. 简单记事本CLI/
├── src/
│   └── index.ts        # CLI 主程序
├── dist/               # 编译产物（npm run build 后生成）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 安装与构建

```bash
# 进入项目目录
cd "06. 简单记事本CLI"

# 安装依赖（只有 typescript / @types/node）
npm install

# 编译 TypeScript
npm run build
```

构建完成后，可执行入口为 `dist/index.js`。

---

## 使用方法

```bash
# 查看帮助
node dist/index.js help

# 列出所有笔记
node dist/index.js list

# 新建笔记（标题为"我的第一条笔记"）
node dist/index.js add 我的第一条笔记
# 接着进入多行输入模式，输入完毕后单独一行输入 :wq 保存
# 若要放弃，单独一行输入 :q

# 查看 ID = 1 的笔记
node dist/index.js view 1

# 编辑 ID = 1 的笔记
node dist/index.js edit 1

# 删除 ID = 1 的笔记
node dist/index.js delete 1

# 搜索包含关键字 typescript 的笔记
node dist/index.js search typescript
```

也可以使用 npm script：

```bash
npm start -- list
npm start -- add "新的标题"
```

---

## 命令一览

| 命令                            | 别名               | 说明                              |
| ------------------------------- | ------------------ | --------------------------------- |
| `list`                          | `ls`               | 列出所有笔记                      |
| `add <标题>`                    | `new`              | 新建笔记（接着输入多行内容）      |
| `view <id>`                     | `show` / `cat`     | 查看指定笔记                      |
| `edit <id>`                     | `update`           | 编辑指定笔记（覆盖原内容）        |
| `delete <id>`                   | `del` / `rm`       | 删除指定笔记                      |
| `search <关键字>`               | `find` / `grep`    | 在标题与内容中搜索                |
| `help`                          | `--help` / `-h`    | 显示帮助信息                      |

多行输入约定：
- 单独一行输入 `:wq` —— **保存**并退出
- 单独一行输入 `:q` —— **放弃**当前输入

---

## 数据存储

- 存储路径：`~/.simple-notepad-cli/notes.json`（Windows 下通常为 `C:\Users\<用户名>\.simple-notepad-cli\notes.json`）
- 格式示例：

```json
{
  "nextId": 3,
  "notes": [
    {
      "id": 1,
      "title": "我的第一条笔记",
      "content": "这是笔记内容\n第二行内容",
      "createdAt": "2026-06-08T09:56:55.000Z",
      "updatedAt": "2026-06-08T09:56:55.000Z"
    }
  ]
}
```

---

## 技术要点

- 全程使用 TypeScript 严格模式（`strict: true`）开发
- 接口 `Note` / `NoteStore` 描述领域模型
- 使用 `readline` 模块实现多行输入交互
- 使用 `fs` 同步 API 简化代码（CLI 工具瞬时执行，无需异步 I/O）
- 命令分发使用 `switch-case`，支持多种命令别名

