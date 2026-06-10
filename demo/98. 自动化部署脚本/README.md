# 自动化部署脚本

一个使用 **纯 TypeScript** 编写的自动化部署工具演示。

## 功能特性

- **流水线编排**: 9 个部署步骤按序执行，支持自定义流水线
- **多环境部署**: 支持 staging / production 等多环境配置
- **SSH 远程操作**: 模拟 SSH 连接、命令执行、文件上传
- **钩子机制**: beforeAll / afterAll / beforeEach / afterEach / onFailure 全生命周期钩子
- **自动回滚**: 部署失败时自动回滚到上一版本
- **健康检查**: 部署后自动验证服务是否正常运行（含重试）
- **备份管理**: 自动备份当前版本，支持配置保留数量
- **干跑模式**: `--dry-run` 只预览步骤不实际执行
- **配置文件**: 支持 `deploy.config.json` 配置文件与命令行参数
- **彩色输出**: 步骤进度、耗时统计、部署摘要

## 项目结构

```
98. 自动化部署脚本/
├── src/
│   ├── index.ts      # 入口：CLI 参数解析、主流程编排
│   ├── config.ts     # 配置：类型定义、加载、校验
│   ├── pipeline.ts   # 流水线：Task 编排、Hook 钩子、回滚
│   ├── tasks.ts      # 任务：9 个部署步骤的具体实现
│   ├── ssh.ts        # SSH：远程连接与命令执行模拟
│   └── logger.ts     # 日志：彩色终端输出、进度条
├── dist/              # 编译输出
├── package.json
├── tsconfig.json
└── README.md
```

## 部署流水线

| 步骤 | 名称 | 说明 |
|------|------|------|
| 1 | 环境检查 | 检查 Node.js / npm 版本与依赖 |
| 2 | 运行测试 | 执行测试命令，可选跳过 |
| 3 | 项目构建 | 执行构建命令，生成产物 |
| 4 | 打包压缩 | 将产物打包为 tar.gz |
| 5 | 远程准备 | SSH 连接、创建目录、备份旧版 |
| 6 | 上传部署 | 上传并解压到远程服务器 |
| 7 | 切换版本 | 更新符号链接、重启服务 |
| 8 | 健康检查 | 验证服务是否正常（含重试） |
| 9 | 清理 | 清理临时文件与旧版本（可选） |

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
# 默认部署到 staging 环境
node dist/index.js

# 指定环境
node dist/index.js --env staging
node dist/index.js production

# 干跑模式（预览步骤）
node dist/index.js --dry-run

# 跳过测试
node dist/index.js --skip-test

# 详细输出
node dist/index.js -v

# 生成配置文件
node dist/index.js --init

# 使用配置文件部署
node dist/index.js --config deploy.config.json --env production
```

## 一键构建并运行

```bash
npm run dev
```

## 选项说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-e, --env <name>` | 部署环境 | staging |
| `-p, --project <name>` | 项目名称 | demo-project |
| `--host <host>` | SSH 主机地址 | 192.168.1.100 |
| `--port <port>` | SSH 端口 | 22 |
| `--user <username>` | SSH 用户名 | deployer |
| `--remote-path <path>` | 远程部署路径 | /var/www/app |
| `--build-cmd <cmd>` | 构建命令 | npm run build |
| `--output-dir <dir>` | 构建输出目录 | ./dist |
| `--test-cmd <cmd>` | 测试命令 | npm test |
| `--skip-test` | 跳过测试 | 否 |
| `--include <patterns>` | 包含文件模式 | dist/\*\*, package.json |
| `--exclude <patterns>` | 排除文件模式 | \*.log, .env, .git/\*\* |
| `--backups <n>` | 保留备份数量 | 3 |
| `--timeout <ms>` | 部署超时时间 | 300000 |
| `-c, --config <path>` | 配置文件路径 | 无 |
| `--dry-run` | 干跑模式 | 否 |
| `--init` | 生成默认配置文件 | 否 |
| `-v, --verbose` | 详细输出 | 否 |

## 配置文件示例

运行 `--init` 生成 `deploy.config.json`:

```json
{
  "project": "my-project",
  "environment": "staging",
  "envs": {
    "staging": {
      "name": "staging",
      "build": { "command": "npm run build", "outputDir": "./dist" },
      "target": {
        "name": "staging-server",
        "remotePath": "/var/www/app",
        "ssh": { "host": "192.168.1.100", "port": 22, "username": "deployer" }
      },
      "runTests": true,
      "testCommand": "npm test",
      "include": ["dist/**", "package.json"],
      "exclude": ["*.log", ".env", ".git/**"],
      "backupCount": 3,
      "timeout": 300000
    },
    "production": {
      "name": "production",
      "build": { "command": "npm run build:prod", "outputDir": "./dist" },
      "target": {
        "name": "prod-server",
        "remotePath": "/var/www/app",
        "ssh": { "host": "10.0.0.1", "port": 22, "username": "deployer" }
      },
      "runTests": true,
      "testCommand": "npm test",
      "backupCount": 5,
      "timeout": 600000
    }
  }
}
```

## 示例输出

```
  ╔════════════════════════════════════════════════╗
  ║             自动化部署工具                     ║
  ╚════════════════════════════════════════════════╝
  v1.0.0

  14:30:01 i  从命令行参数构建配置
  ────────────────────────────────────────────────
  14:30:01 i  项目: demo-project
  14:30:01 i  环境: staging
  14:30:01 i  构建: npm run build → ./dist
  14:30:01 i  目标: deployer@192.168.1.100:22
  14:30:01 i  路径: /var/www/app
  14:30:01 i  测试: npm test
  14:30:01 i  备份: 保留最近 3 个版本
  14:30:01 i  超时: 300s
  ────────────────────────────────────────────────

  14:30:04 →  [1/9] 环境检查
  14:30:04     ├─ 检查 Node.js 版本...
  14:30:05     ├─ Node.js v20.11.0
  14:30:05     ├─ 检查 npm 版本...
  14:30:05     ├─ npm 10.2.4
  14:30:05     ├─ 依赖已安装 ✓
  14:30:05 √   环境检查 完成 (1.2s)

  14:30:05 →  [2/9] 运行测试
  ...

  ────────────────────────────────────────────────
  部署摘要
  ────────────────────────────────────────────────
  环境:     staging
  总步骤:   9
  成功:     9
  失败:     0
  耗时:     28.5s
  ────────────────────────────────────────────────

  14:30:32 √   部署完成!
```

## 注意

本 Demo 的 SSH 操作和构建命令均为**模拟执行**，不会真实连接远程服务器或执行本地命令。如需启用真实执行模式，设置环境变量 `DEPLOY_REAL=1`，并确保配置正确的 SSH 信息。
