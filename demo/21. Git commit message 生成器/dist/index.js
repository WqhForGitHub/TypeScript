#!/usr/bin/env node
"use strict";
/**
 * Git Commit Message 生成器
 *
 * 一个使用纯 TypeScript 编写的命令行工具，用于生成符合 Conventional Commits 规范的
 * Git commit message。支持交互式引导、自动分析暂存区变更、历史记录参考等功能。
 *
 * 功能特性：
 *   - 交互式引导生成 commit message
 *   - 自动分析 git diff --staged 暂存区变更
 *   - 智能推荐 commit 类型和范围
 *   - 支持所有 Conventional Commits 标准类型
 *   - 支持 Breaking Change 标识
 *   - 支持自定义 scope
 *   - 查看历史 commit 记录作为参考
 *   - 生成后可直接执行 git commit
 *   - 纯命令行参数模式，可跳过交互
 *
 * 用法：
 *   node dist/index.js                  交互式生成
 *   node dist/index.js -i              交互式生成（显式指定）
 *   node dist/index.js -a              自动分析暂存区并推荐
 *   node dist/index.js -h              查看帮助
 *   node dist/index.js -t feat -s api -m "添加用户登录接口"
 *                                      直接指定类型、范围和描述
 *   node dist/index.js --history       查看最近的 commit 记录
 *   node dist/index.js --commit        生成后直接执行 git commit
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const readline = __importStar(require("readline"));
const child_process_1 = require("child_process");
// ========== 常量定义 ==========
/** Conventional Commits 标准类型列表 */
const COMMIT_TYPES = [
    { code: "feat", name: "新功能", description: "新增功能或特性" },
    { code: "fix", name: "修复", description: "修复 Bug 或问题" },
    { code: "docs", name: "文档", description: "仅文档变更" },
    { code: "style", name: "样式", description: "不影响代码含义的格式变更（空格、分号等）" },
    { code: "refactor", name: "重构", description: "既不新增功能也不修复 Bug 的代码变更" },
    { code: "perf", name: "性能", description: "提升性能的代码变更" },
    { code: "test", name: "测试", description: "新增或修正测试代码" },
    { code: "build", name: "构建", description: "影响构建系统或外部依赖的变更" },
    { code: "ci", name: "持续集成", description: "CI 配置文件和脚本的变更" },
    { code: "chore", name: "杂务", description: "其他不修改 src 或 test 的变更" },
    { code: "revert", name: "回退", description: "回退之前的 commit" },
];
/** 文件扩展名到推荐类型的映射 */
const EXTENSION_TYPE_MAP = {
    ".md": ["docs"],
    ".txt": ["docs"],
    ".test.": ["test"],
    ".spec.": ["test"],
    ".css": ["style"],
    ".scss": ["style"],
    ".less": ["style"],
    ".yml": ["ci"],
    ".yaml": ["ci"],
    ".json": ["chore", "build"],
    ".lock": ["build"],
};
/** 路径关键词到推荐类型的映射 */
const PATH_TYPE_MAP = {
    "test": ["test"],
    "tests": ["test"],
    "__tests__": ["test"],
    "spec": ["test"],
    "doc": ["docs"],
    "docs": ["docs"],
    "style": ["style"],
    "styles": ["style"],
    "ci": ["ci"],
    ".github": ["ci"],
    "docker": ["build"],
    "Dockerfile": ["build"],
    "config": ["chore"],
    "scripts": ["chore"],
    "build": ["build"],
    "webpack": ["build"],
    "vite": ["build"],
    "rollup": ["build"],
};
// ========== 工具函数 ==========
/**
 * 创建 readline 接口
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}
/**
 * 封装 readline question 为 Promise
 */
function question(rl, prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
}
/**
 * 执行 Git 命令并返回输出
 */
function execGit(args) {
    try {
        return (0, child_process_1.execSync)(`git ${args}`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
    }
    catch {
        return "";
    }
}
/**
 * 检查当前目录是否在 Git 仓库中
 */
function isGitRepo() {
    const result = execGit("rev-parse --is-inside-work-tree");
    return result === "true";
}
/**
 * 检查是否存在暂存区变更
 */
function hasStagedChanges() {
    const result = execGit("diff --staged --name-only");
    return result.length > 0;
}
/**
 * 获取暂存区变更详情
 */
function getStagedChanges() {
    const nameStatus = execGit("diff --staged --name-status");
    const numstat = execGit("diff --staged --numstat");
    const files = [];
    let insertions = 0;
    let deletions = 0;
    // 解析文件状态
    if (nameStatus) {
        for (const line of nameStatus.split("\n")) {
            if (!line.trim())
                continue;
            const parts = line.split("\t");
            if (parts.length < 2)
                continue;
            const statusChar = parts[0][0];
            const filePath = parts[1];
            let status;
            switch (statusChar) {
                case "A":
                    status = "added";
                    break;
                case "M":
                    status = "modified";
                    break;
                case "D":
                    status = "deleted";
                    break;
                case "R":
                    status = "renamed";
                    break;
                default:
                    status = "modified";
            }
            const ext = filePath.includes(".")
                ? "." + filePath.split(".").pop().toLowerCase()
                : "";
            files.push({ status, path: filePath, extension: ext });
        }
    }
    // 解析行数统计
    if (numstat) {
        for (const line of numstat.split("\n")) {
            if (!line.trim())
                continue;
            const parts = line.split("\t");
            if (parts.length < 2)
                continue;
            const ins = parseInt(parts[0], 10);
            const del = parseInt(parts[1], 10);
            if (!isNaN(ins))
                insertions += ins;
            if (!isNaN(del))
                deletions += del;
        }
    }
    // 生成摘要
    const added = files.filter((f) => f.status === "added").length;
    const modified = files.filter((f) => f.status === "modified").length;
    const deleted = files.filter((f) => f.status === "deleted").length;
    const renamed = files.filter((f) => f.status === "renamed").length;
    const parts = [];
    if (added > 0)
        parts.push(`新增 ${added} 个文件`);
    if (modified > 0)
        parts.push(`修改 ${modified} 个文件`);
    if (deleted > 0)
        parts.push(`删除 ${deleted} 个文件`);
    if (renamed > 0)
        parts.push(`重命名 ${renamed} 个文件`);
    const summary = parts.length > 0
        ? parts.join("，") + `，+${insertions}/-${deletions} 行`
        : "暂存区无变更";
    return {
        files,
        stats: { filesChanged: files.length, insertions, deletions },
        summary,
    };
}
/**
 * 获取最近的 commit 记录
 */
function getRecentCommits(count = 10) {
    const result = execGit(`log --oneline -${count} --format="%s"`);
    return result ? result.split("\n").filter(Boolean) : [];
}
/**
 * 根据暂存区文件变更推荐 commit 类型
 */
function suggestCommitType(changes) {
    const typeScores = {};
    for (const file of changes.files) {
        // 根据扩展名推荐
        for (const [ext, types] of Object.entries(EXTENSION_TYPE_MAP)) {
            if (ext.startsWith(".") && file.extension === ext) {
                for (const t of types) {
                    typeScores[t] = (typeScores[t] || 0) + 2;
                }
            }
            else if (!ext.startsWith(".") && file.path.includes(ext)) {
                for (const t of types) {
                    typeScores[t] = (typeScores[t] || 0) + 1;
                }
            }
        }
        // 根据路径关键词推荐
        for (const [keyword, types] of Object.entries(PATH_TYPE_MAP)) {
            if (file.path.toLowerCase().includes(keyword.toLowerCase())) {
                for (const t of types) {
                    typeScores[t] = (typeScores[t] || 0) + 1.5;
                }
            }
        }
        // 测试文件的特殊处理
        if (file.path.includes(".test.") ||
            file.path.includes(".spec.") ||
            file.path.includes("__tests__")) {
            typeScores["test"] = (typeScores["test"] || 0) + 3;
        }
    }
    // 如果全是新增文件，更倾向于 feat
    const allAdded = changes.files.length > 0 && changes.files.every((f) => f.status === "added");
    if (allAdded) {
        typeScores["feat"] = (typeScores["feat"] || 0) + 3;
    }
    // 如果全是删除文件，更倾向于 refactor
    const allDeleted = changes.files.length > 0 && changes.files.every((f) => f.status === "deleted");
    if (allDeleted) {
        typeScores["refactor"] = (typeScores["refactor"] || 0) + 2;
    }
    // 大量删除行可能表示重构
    if (changes.stats.deletions > changes.stats.insertions * 2) {
        typeScores["refactor"] = (typeScores["refactor"] || 0) + 1;
    }
    // 找出得分最高的类型
    let bestType = "feat"; // 默认
    let bestScore = 0;
    for (const [type, score] of Object.entries(typeScores)) {
        if (score > bestScore) {
            bestScore = score;
            bestType = type;
        }
    }
    // 置信度：归一化到 0-1
    const totalScore = Object.values(typeScores).reduce((a, b) => a + b, 0);
    const confidence = totalScore > 0 ? bestScore / totalScore : 0;
    return { type: bestType, confidence };
}
/**
 * 根据暂存区文件路径推荐 scope
 */
function suggestScope(changes) {
    if (changes.files.length === 0)
        return "";
    // 提取公共路径前缀
    const paths = changes.files.map((f) => f.path);
    // 查找公共目录前缀
    const segments = paths[0].split("/");
    let commonPrefix = "";
    for (let i = 0; i < segments.length - 1; i++) {
        const candidate = segments.slice(0, i + 1).join("/");
        if (paths.every((p) => p.startsWith(candidate + "/") || p === candidate)) {
            commonPrefix = candidate;
        }
        else {
            break;
        }
    }
    if (commonPrefix) {
        const parts = commonPrefix.split("/");
        return parts[parts.length - 1];
    }
    // 如果只有一个文件，取其直接父目录
    if (paths.length === 1 && paths[0].includes("/")) {
        const parts = paths[0].split("/");
        return parts[parts.length - 2];
    }
    return "";
}
/**
 * 格式化 commit message
 */
function formatCommitMessage(type, scope, subject, body, isBreaking, footer) {
    // 构建头部
    const breakingMark = isBreaking ? "!" : "";
    const scopePart = scope ? `(${scope})` : "";
    const header = `${type}${scopePart}${breakingMark}: ${subject}`;
    // 构建正文
    const parts = [header];
    if (body) {
        parts.push("", body);
    }
    if (isBreaking && !body?.includes("BREAKING CHANGE")) {
        parts.push("", "BREAKING CHANGE: 此变更包含不兼容的 API 变更");
    }
    if (footer) {
        parts.push("", footer);
    }
    return parts.join("\n");
}
// ========== 核心功能 ==========
/**
 * 显示 commit 类型选择列表
 */
function displayCommitTypes() {
    console.log("\n可用的 Commit 类型：");
    console.log("─".repeat(50));
    for (let i = 0; i < COMMIT_TYPES.length; i++) {
        const t = COMMIT_TYPES[i];
        console.log(`  ${(i + 1).toString().padStart(2)}. ${t.code.padEnd(10)} ${t.name.padEnd(6)} - ${t.description}`);
    }
    console.log("─".repeat(50));
}
/**
 * 显示暂存区变更摘要
 */
function displayStagedChanges(changes) {
    console.log("\n📋 暂存区变更摘要：");
    console.log("─".repeat(50));
    console.log(`  ${changes.summary}`);
    console.log();
    // 按状态分组显示文件
    const grouped = {};
    for (const file of changes.files) {
        if (!grouped[file.status])
            grouped[file.status] = [];
        grouped[file.status].push(file.path);
    }
    const statusLabel = {
        added: "🆕 新增",
        modified: "✏️  修改",
        deleted: "🗑️  删除",
        renamed: "📝 重命名",
    };
    for (const [status, files] of Object.entries(grouped)) {
        const label = statusLabel[status] || status;
        console.log(`  ${label}:`);
        for (const f of files) {
            console.log(`    - ${f}`);
        }
    }
    console.log("─".repeat(50));
}
/**
 * 显示历史 commit 记录
 */
function displayHistory() {
    const commits = getRecentCommits(10);
    if (commits.length === 0) {
        console.log("暂无 commit 记录。");
        return;
    }
    console.log("\n📜 最近的 Commit 记录：");
    console.log("─".repeat(50));
    for (const commit of commits) {
        console.log(`  ${commit}`);
    }
    console.log("─".repeat(50));
}
/**
 * 交互式生成 commit message
 */
async function interactiveGenerate(shouldAutoAnalyze) {
    const rl = createReadlineInterface();
    try {
        // 检查是否在 Git 仓库中
        if (!isGitRepo()) {
            console.log("❌ 当前目录不在 Git 仓库中！");
            return null;
        }
        const hasStaged = hasStagedChanges();
        let changes = null;
        let suggestedType = "feat";
        let suggestedScope = "";
        // 分析暂存区
        if (hasStaged) {
            changes = getStagedChanges();
            displayStagedChanges(changes);
            const suggestion = suggestCommitType(changes);
            suggestedScope = suggestScope(changes);
            console.log(`\n💡 推荐类型: ${suggestion.type}（置信度: ${Math.round(suggestion.confidence * 100)}%）`);
            if (suggestedScope) {
                console.log(`💡 推荐范围: ${suggestedScope}`);
            }
        }
        else {
            console.log("⚠️  暂存区没有变更。请先使用 git add 添加文件。");
            console.log("   你仍可以继续生成 commit message，但建议先暂存变更。\n");
        }
        // 选择 commit 类型
        displayCommitTypes();
        let type = "";
        while (!type) {
            const defaultHint = shouldAutoAnalyze && suggestedType ? ` [${suggestedType}]` : "";
            const answer = await question(rl, `\n请选择 commit 类型（输入编号或类型代码）${defaultHint}: `);
            if (!answer && suggestedType) {
                type = suggestedType;
                break;
            }
            if (!answer) {
                console.log("请输入有效的类型编号或代码！");
                continue;
            }
            // 检查是否为编号
            const num = parseInt(answer, 10);
            if (!isNaN(num) && num >= 1 && num <= COMMIT_TYPES.length) {
                type = COMMIT_TYPES[num - 1].code;
                break;
            }
            // 检查是否为类型代码
            const found = COMMIT_TYPES.find((t) => t.code.toLowerCase() === answer.toLowerCase());
            if (found) {
                type = found.code;
                break;
            }
            console.log("无效的类型！请输入编号（1-11）或类型代码。");
        }
        // 输入 scope（可选）
        const scopeDefault = shouldAutoAnalyze && suggestedScope ? ` [${suggestedScope}]` : "";
        const scopeAnswer = await question(rl, `请输入影响范围 scope（可选，按 Enter 跳过）${scopeDefault}: `);
        const scope = scopeAnswer || (shouldAutoAnalyze ? suggestedScope : "");
        // 输入 subject
        let subject = "";
        while (!subject) {
            subject = await question(rl, "请输入简短描述（不超过 72 个字符）: ");
            if (!subject) {
                console.log("描述不能为空！");
            }
            else if (subject.length > 72) {
                console.log("描述过长，请限制在 72 个字符以内！");
                subject = "";
            }
        }
        // 询问是否需要 body
        const bodyAnswer = await question(rl, "是否添加详细说明？（y/N）: ");
        let body = "";
        if (bodyAnswer.toLowerCase() === "y" || bodyAnswer.toLowerCase() === "yes") {
            console.log("请输入详细说明（输入空行结束）：");
            const bodyLines = [];
            let line = await question(rl, "  ");
            while (line !== "") {
                bodyLines.push(line);
                line = await question(rl, "  ");
            }
            body = bodyLines.join("\n");
        }
        // 询问是否有 Breaking Change
        const breakingAnswer = await question(rl, "是否包含 Breaking Change？（y/N）: ");
        const isBreaking = breakingAnswer.toLowerCase() === "y" || breakingAnswer.toLowerCase() === "yes";
        // 询问是否有 footer
        const footerAnswer = await question(rl, "是否添加 footer（如关联 Issue）？（y/N）: ");
        let footer = "";
        if (footerAnswer.toLowerCase() === "y" || footerAnswer.toLowerCase() === "yes") {
            footer = await question(rl, "请输入 footer（如 Closes #123）: ");
        }
        // 生成 commit message
        const full = formatCommitMessage(type, scope, subject, body, isBreaking, footer);
        const result = {
            type,
            scope,
            subject,
            body,
            isBreaking,
            footer,
            full,
        };
        return result;
    }
    finally {
        rl.close();
    }
}
/**
 * 命令行参数模式生成 commit message
 */
function cliGenerate(type, scope, subject, body, isBreaking, footer) {
    // 验证类型
    const validType = COMMIT_TYPES.find((t) => t.code.toLowerCase() === type.toLowerCase());
    if (!validType) {
        console.log(`⚠️  未知的 commit 类型: "${type}"，仍将使用该类型。`);
    }
    // 验证描述长度
    if (subject.length > 72) {
        console.log("⚠️  描述超过 72 个字符，建议缩短。");
    }
    const full = formatCommitMessage(validType?.code || type, scope, subject, body, isBreaking, footer);
    return {
        type: validType?.code || type,
        scope,
        subject,
        body,
        isBreaking,
        footer,
        full,
    };
}
/**
 * 显示生成的结果
 */
function displayResult(result, shouldCommit) {
    console.log("\n✅ 生成的 Commit Message：");
    console.log("═".repeat(50));
    console.log(result.full);
    console.log("═".repeat(50));
    if (shouldCommit && isGitRepo()) {
        // 使用临时文件方式避免引号转义问题
        try {
            const tempFile = `.git/COMMIT_EDITMSG_${Date.now()}`;
            const fs = require("fs");
            const path = require("path");
            const filePath = path.join(execGit("rev-parse --show-toplevel") || ".", tempFile);
            fs.writeFileSync(filePath, result.full, "utf-8");
            (0, child_process_1.execSync)(`git commit -F "${filePath}"`, { stdio: "inherit" });
            fs.unlinkSync(filePath);
            console.log("\n🎉 Commit 成功！");
        }
        catch (err) {
            console.log(`\n❌ Commit 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    else if (shouldCommit && !isGitRepo()) {
        console.log("\n❌ 当前不在 Git 仓库中，无法执行 commit。");
    }
    else {
        console.log("\n💡 你可以使用以下命令提交：");
        // 转义双引号
        const escaped = result.full.replace(/"/g, '\\"');
        console.log(`  git commit -m "${escaped.replace(/\n/g, '\\n')}"`);
    }
}
// ========== 帮助信息 ==========
function printHelp() {
    console.log(`
Git Commit Message 生成器

用法：
  node dist/index.js [选项]

选项：
  -i, --interactive    交互式生成（默认模式）
  -a, --auto           自动分析暂存区并推荐
  -t, --type <type>    指定 commit 类型（feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert）
  -s, --scope <scope>  指定影响范围
  -m, --message <msg>  指定简短描述
  -b, --body <body>    指定详细说明
  -B, --breaking       标记为 Breaking Change
  -f, --footer <text>  添加 footer
  -c, --commit         生成后直接执行 git commit
  --history            查看最近的 commit 记录
  -h, --help           显示帮助信息

示例：
  node dist/index.js                              # 交互式生成
  node dist/index.js -a                           # 自动分析暂存区
  node dist/index.js -t feat -m "添加用户登录"     # 指定类型和描述
  node dist/index.js -t fix -s api -m "修复登录超时"  # 指定类型、范围和描述
  node dist/index.js -t feat -m "新API" -B        # 包含 Breaking Change
  node dist/index.js -t feat -m "新API" -c        # 生成后直接 commit
  node dist/index.js --history                    # 查看 commit 历史
`);
}
function parseArgs(argv) {
    const options = {
        interactive: false,
        autoAnalyze: false,
        type: "",
        scope: "",
        message: "",
        body: "",
        breaking: false,
        footer: "",
        commit: false,
        showHistory: false,
        showHelp: false,
    };
    let i = 2; // 跳过 node 和脚本路径
    while (i < argv.length) {
        const arg = argv[i];
        switch (arg) {
            case "-i":
            case "--interactive":
                options.interactive = true;
                break;
            case "-a":
            case "--auto":
                options.autoAnalyze = true;
                break;
            case "-t":
            case "--type":
                options.type = argv[++i] || "";
                break;
            case "-s":
            case "--scope":
                options.scope = argv[++i] || "";
                break;
            case "-m":
            case "--message":
                options.message = argv[++i] || "";
                break;
            case "-b":
            case "--body":
                options.body = argv[++i] || "";
                break;
            case "-B":
            case "--breaking":
                options.breaking = true;
                break;
            case "-f":
            case "--footer":
                options.footer = argv[++i] || "";
                break;
            case "-c":
            case "--commit":
                options.commit = true;
                break;
            case "--history":
                options.showHistory = true;
                break;
            case "-h":
            case "--help":
                options.showHelp = true;
                break;
            default:
                console.log(`未知选项: ${arg}，使用 --help 查看帮助。`);
        }
        i++;
    }
    return options;
}
// ========== 主函数 ==========
async function main() {
    const options = parseArgs(process.argv);
    // 显示帮助
    if (options.showHelp) {
        printHelp();
        return;
    }
    // 显示历史记录
    if (options.showHistory) {
        if (!isGitRepo()) {
            console.log("❌ 当前目录不在 Git 仓库中！");
            return;
        }
        displayHistory();
        return;
    }
    // 判断模式：如果提供了 type 和 message，使用 CLI 模式
    const isCliMode = options.type && options.message;
    if (isCliMode) {
        // CLI 直接生成模式
        const result = cliGenerate(options.type, options.scope, options.message, options.body, options.breaking, options.footer);
        displayResult(result, options.commit);
    }
    else {
        // 交互式模式
        const shouldAutoAnalyze = options.autoAnalyze || options.interactive;
        const result = await interactiveGenerate(shouldAutoAnalyze);
        if (result) {
            displayResult(result, options.commit);
        }
    }
}
main().catch((err) => {
    console.error(`发生错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map