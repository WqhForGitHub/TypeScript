# Git Commit Message 生成器

一个使用 **纯 TypeScript** 编写的 Git commit message 生成器，遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

## 功能特性

- 交互式引导生成 commit message
- 自动分析 `git diff --staged` 暂存区变更
- 智能推荐 commit 类型和范围（scope）
- 支持所有 Conventional Commits 标准类型（feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert）
- 支持 Breaking Change 标识
- 支持自定义 scope
- 查看历史 commit 记录作为参考
- 生成后可直接执行 `git commit`
- 纯命令行参数模式，可跳过交互

## 项目结构

```
11. Git commit message 生成器/
├── src/
│   └── index.ts          # 源代码
├── dist/                  # 编译输出
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
└── README.md              # 说明文档
```

## 安装与运行

```bash
# 安装依赖
npm install

# 编译
npm run build

# 运行（交互式模式）
npm start

# 编译并运行
npm run dev
```

## 使用方法

### 交互式生成

```bash
node dist/index.js
```

按照提示依次选择 commit 类型、输入范围、描述等信息。

### 自动分析暂存区

```bash
node dist/index.js -a
```

自动分析 `git diff --staged` 的内容，智能推荐 commit 类型和范围。

### 命令行参数模式

```bash
# 指定类型和描述
node dist/index.js -t feat -m "添加用户登录接口"

# 指定类型、范围和描述
node dist/index.js -t fix -s api -m "修复登录超时问题"

# 包含 Breaking Change
node dist/index.js -t feat -m "重构用户认证 API" -B

# 添加详细说明
node dist/index.js -t refactor -m "优化数据库查询" -b "使用索引优化查询性能，减少 50% 响应时间"

# 添加 footer（关联 Issue）
node dist/index.js -t fix -m "修复内存泄漏" -f "Closes #123"

# 生成后直接 commit
node dist/index.js -t feat -m "添加新功能" -c
```

### 查看历史 Commit 记录

```bash
node dist/index.js --history
```

## 支持的 Commit 类型

| 类型       | 说明                                |
| ---------- | ----------------------------------- |
| `feat`     | 新增功能或特性                      |
| `fix`      | 修复 Bug 或问题                     |
| `docs`     | 仅文档变更                          |
| `style`    | 不影响代码含义的格式变更            |
| `refactor` | 既不新增功能也不修复 Bug 的代码变更 |
| `perf`     | 提升性能的代码变更                  |
| `test`     | 新增或修正测试代码                  |
| `build`    | 影响构建系统或外部依赖的变更        |
| `ci`       | CI 配置文件和脚本的变更             |
| `chore`    | 其他不修改 src 或 test 的变更       |
| `revert`   | 回退之前的 commit                   |

## 输出示例

```
✅ 生成的 Commit Message：
══════════════════════════════════════════════════
feat(api)!: 添加用户登录接口

BREAKING CHANGE: 此变更包含不兼容的 API 变更

Closes #42
══════════════════════════════════════════════════
```
