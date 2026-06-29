#!/usr/bin/env node
"use strict";
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
/**
 * Git Commit Message 生成器 (Enhanced TypeScript Edition)
 *
 * Demonstrates: Enums, Generics w/ constraints, Discriminated unions, Mapped
 * types, Conditional types, Template literal types, Type guards, Utility types,
 * Tuples/readonly tuples, Abstract classes, Function overloads, `as const`,
 * Custom Error hierarchy, Interfaces (readonly/optional), Index signatures,
 * `satisfies`, Getters/Setters, Generators/Iterators, Symbols, Optional
 * chaining & nullish coalescing.
 *
 * Core: Conventional/Gitmoji/Custom commit generation from staged changes with
 * scope/type inference, breaking-change detection, footer/body generation,
 * validation, statistics, and interactive suggestions.
 */
const readline = __importStar(require("readline"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 1. Enums
var CommitType;
(function (CommitType) {
    CommitType["Feat"] = "feat";
    CommitType["Fix"] = "fix";
    CommitType["Docs"] = "docs";
    CommitType["Style"] = "style";
    CommitType["Refactor"] = "refactor";
    CommitType["Perf"] = "perf";
    CommitType["Test"] = "test";
    CommitType["Build"] = "build";
    CommitType["Ci"] = "ci";
    CommitType["Chore"] = "chore";
    CommitType["Revert"] = "revert";
})(CommitType || (CommitType = {}));
var ChangeType;
(function (ChangeType) {
    ChangeType["Added"] = "added";
    ChangeType["Modified"] = "modified";
    ChangeType["Deleted"] = "deleted";
    ChangeType["Renamed"] = "renamed";
})(ChangeType || (ChangeType = {}));
var BreakingReason;
(function (BreakingReason) {
    BreakingReason["Api"] = "\u4E0D\u517C\u5BB9\u7684 API \u53D8\u66F4";
    BreakingReason["Removal"] = "\u529F\u80FD\u88AB\u79FB\u9664";
    BreakingReason["Behavior"] = "\u9ED8\u8BA4\u884C\u4E3A\u53D8\u66F4";
    BreakingReason["Default"] = "\u4E0D\u5411\u540E\u517C\u5BB9\u7684\u53D8\u66F4";
})(BreakingReason || (BreakingReason = {}));
var FormatStyle;
(function (FormatStyle) {
    FormatStyle["Conventional"] = "conventional";
    FormatStyle["Gitmoji"] = "gitmoji";
    FormatStyle["Custom"] = "custom";
})(FormatStyle || (FormatStyle = {}));
// 2. Custom Error hierarchy
class GitError extends Error {
    constructor(message, code = "GIT_ERROR") {
        super(message);
        this.code = code;
        this.name = "GitError";
    }
}
class NotARepoError extends GitError {
    constructor() { super("当前目录不在 Git 仓库中", "NOT_A_REPO"); this.name = "NotARepoError"; }
}
class NoStagedChangesError extends GitError {
    constructor() { super("暂存区没有变更", "NO_STAGED_CHANGES"); this.name = "NoStagedChangesError"; }
}
class CommitValidationError extends GitError {
    constructor(message) { super(message, "VALIDATION_ERROR"); this.name = "CommitValidationError"; }
}
// 5. `as const` + `satisfies` configuration tables
const COMMIT_TYPES = {
    feat: { name: "新功能", description: "新增功能或特性", emoji: "✨" },
    fix: { name: "修复", description: "修复 Bug 或问题", emoji: "🐛" },
    docs: { name: "文档", description: "仅文档变更", emoji: "📝" },
    style: { name: "样式", description: "格式变更（空格、分号等）", emoji: "💄" },
    refactor: { name: "重构", description: "既不新增功能也不修复 Bug", emoji: "♻️" },
    perf: { name: "性能", description: "提升性能的代码变更", emoji: "⚡" },
    test: { name: "测试", description: "新增或修正测试代码", emoji: "✅" },
    build: { name: "构建", description: "影响构建系统或依赖", emoji: "📦" },
    ci: { name: "持续集成", description: "CI 配置和脚本变更", emoji: "👷" },
    chore: { name: "杂务", description: "其他不修改 src/test 的变更", emoji: "🔧" },
    revert: { name: "回退", description: "回退之前的 commit", emoji: "⏪" },
};
const EXTENSION_TYPE_MAP = {
    ".md": [CommitType.Docs], ".txt": [CommitType.Docs],
    ".css": [CommitType.Style], ".scss": [CommitType.Style], ".less": [CommitType.Style],
    ".yml": [CommitType.Ci], ".yaml": [CommitType.Ci],
    ".json": [CommitType.Chore, CommitType.Build], ".lock": [CommitType.Build],
};
const PATH_TYPE_MAP = {
    test: CommitType.Test, tests: CommitType.Test, __tests__: CommitType.Test, spec: CommitType.Test,
    docs: CommitType.Docs, doc: CommitType.Docs,
    style: CommitType.Style, styles: CommitType.Style,
    ci: CommitType.Ci, ".github": CommitType.Ci,
    docker: CommitType.Build, Dockerfile: CommitType.Build,
    config: CommitType.Chore, scripts: CommitType.Chore,
    build: CommitType.Build, webpack: CommitType.Build, vite: CommitType.Build, rollup: CommitType.Build,
};
function runGit(cmd) {
    try {
        const out = (0, child_process_1.execSync)(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
        return { ok: true, value: out };
    }
    catch (e) {
        return { ok: false, error: new GitError(e instanceof Error ? e.message : String(e), "GIT_CMD") };
    }
}
function execGit(args) {
    const r = runGit(`git ${args}`);
    return r.ok ? r.value : "";
}
// 8. Type guards
function isCommitType(x) {
    return typeof x === "string" && Object.values(CommitType).includes(x);
}
function isBreakingChange(p) {
    return p.isBreaking === true && p.breakingReason !== undefined;
}
// 9. Symbols
const ANALYZE = Symbol("analyze");
const INTERNAL = Symbol("internal");
// 10. Abstract Git analyzer + concrete implementation
class AbstractGitAnalyzer {
    exec(args) { return execGit(args); }
    isRepo() { return this.exec("rev-parse --is-inside-work-tree") === "true"; }
    hasStaged() { return this.exec("diff --staged --name-only").length > 0; }
    get repoRoot() { return this.exec("rev-parse --show-toplevel") || "."; }
}
class StagedChangesAnalyzer extends AbstractGitAnalyzer {
    constructor() {
        super(...arguments);
        this.cache = null;
    }
    analyze() {
        if (this.cache)
            return this.cache;
        if (!this.isRepo())
            throw new NotARepoError();
        if (!this.hasStaged())
            throw new NoStagedChangesError();
        const nameStatus = this.exec("diff --staged --name-status");
        const numstat = this.exec("diff --staged --numstat");
        const fileMap = new Map();
        const byExt = {};
        if (nameStatus) {
            for (const line of nameStatus.split("\n")) {
                if (!line.trim())
                    continue;
                const parts = line.split("\t");
                if (parts.length < 2)
                    continue;
                const status = this.toChangeType(parts[0][0]);
                const filePath = parts[1];
                fileMap.set(filePath, { status, path: filePath, extension: this.extOf(filePath), additions: 0, deletions: 0 });
            }
        }
        let insertions = 0, deletions = 0;
        if (numstat) {
            for (const line of numstat.split("\n")) {
                if (!line.trim())
                    continue;
                const parts = line.split("\t");
                if (parts.length < 3)
                    continue;
                const ins = parseInt(parts[0], 10) || 0;
                const del = parseInt(parts[1], 10) || 0;
                const filePath = parts[2];
                insertions += ins;
                deletions += del;
                const ext = this.extOf(filePath);
                const existing = fileMap.get(filePath);
                if (existing)
                    fileMap.set(filePath, { ...existing, additions: ins, deletions: del });
                if (ext) {
                    const cur = byExt[ext] ?? [0, 0];
                    byExt[ext] = [cur[0] + ins, cur[1] + del];
                }
            }
        }
        const files = Array.from(fileMap.values());
        const result = {
            files,
            stats: { filesChanged: files.length, insertions, deletions, byExtension: byExt },
            summary: this.buildSummary(files, insertions, deletions),
        };
        this.cache = result;
        return result;
    }
    *[ANALYZE]() { for (const f of this.analyze().files)
        yield f; }
    *iterFiles() { yield* this[ANALYZE](); }
    [INTERNAL]() { return this.analyze().files.length; }
    extOf(p) { return p.includes(".") ? "." + p.split(".").pop().toLowerCase() : ""; }
    toChangeType(c) {
        switch (c) {
            case "A": return ChangeType.Added;
            case "D": return ChangeType.Deleted;
            case "R": return ChangeType.Renamed;
            default: return ChangeType.Modified;
        }
    }
    buildSummary(files, ins, del) {
        const counts = { [ChangeType.Added]: 0, [ChangeType.Modified]: 0, [ChangeType.Deleted]: 0, [ChangeType.Renamed]: 0 };
        for (const f of files)
            counts[f.status]++;
        const parts = [];
        if (counts[ChangeType.Added])
            parts.push(`新增 ${counts[ChangeType.Added]} 个文件`);
        if (counts[ChangeType.Modified])
            parts.push(`修改 ${counts[ChangeType.Modified]} 个文件`);
        if (counts[ChangeType.Deleted])
            parts.push(`删除 ${counts[ChangeType.Deleted]} 个文件`);
        if (counts[ChangeType.Renamed])
            parts.push(`重命名 ${counts[ChangeType.Renamed]} 个文件`);
        return parts.length ? parts.join("，") + `，+${ins}/-${del} 行` : "暂存区无变更";
    }
}
// Standalone generator function.
function* iterateFiles(files) { for (const f of files)
    yield f; }
function safeAnalyze(analyzer) {
    if (!execGit("rev-parse --is-inside-work-tree"))
        return { status: "not-repo" };
    if (!execGit("diff --staged --name-only"))
        return { status: "no-staged" };
    return { status: "ok", changes: analyzer.analyze() };
}
// 11. Abstract commit formatter + concrete formatters
class AbstractCommitFormatter {
    constructor(parts) {
        this.parts = parts;
    }
    get breakingMark() { return this.parts.isBreaking ? "!" : ""; }
    get scopePart() { return this.parts.scope ? `(${this.parts.scope})` : ""; }
}
class ConventionalFormatter extends AbstractCommitFormatter {
    get header() { return `${this.parts.type}${this.scopePart}${this.breakingMark}: ${this.parts.subject}`; }
    format() {
        const lines = [this.header];
        if (this.parts.body)
            lines.push("", this.parts.body);
        if (this.parts.isBreaking)
            lines.push("", `BREAKING CHANGE: ${this.parts.breakingReason ?? BreakingReason.Default}`);
        const footer = this.buildFooter();
        if (footer)
            lines.push("", footer);
        return lines.join("\n");
    }
    buildFooter() {
        const out = [];
        if (this.parts.closesIssues?.length)
            out.push(`Closes #${this.parts.closesIssues.join(", #")}`);
        if (this.parts.coAuthors?.length) {
            for (const [name, email] of this.parts.coAuthors)
                out.push(`Co-authored-by: ${name} <${email}>`);
        }
        if (this.parts.footer)
            out.push(this.parts.footer);
        return out.join("\n");
    }
}
class GitmojiFormatter extends ConventionalFormatter {
    get header() {
        const emoji = COMMIT_TYPES[this.parts.type]?.emoji ?? "";
        return `${emoji} ${this.parts.type}${this.scopePart}${this.breakingMark}: ${this.parts.subject}`;
    }
}
class CustomFormatter extends AbstractCommitFormatter {
    constructor(parts, template) {
        super(parts);
        this.template = template;
    }
    get header() {
        return this.template
            .replace("{type}", this.parts.type)
            .replace("{scope}", this.scopePart)
            .replace("{breaking}", this.breakingMark)
            .replace("{subject}", this.parts.subject);
    }
    format() {
        const lines = [this.header];
        if (this.parts.body)
            lines.push("", this.parts.body);
        if (this.parts.isBreaking)
            lines.push("", `BREAKING CHANGE: ${this.parts.breakingReason ?? BreakingReason.Default}`);
        return lines.join("\n");
    }
}
function createFormatter(parts, style, template) {
    switch (style) {
        case FormatStyle.Gitmoji: return new GitmojiFormatter(parts);
        case FormatStyle.Custom: return new CustomFormatter(parts, template ?? "{type}{scope}{breaking}: {subject}");
        case FormatStyle.Conventional:
        default: return new ConventionalFormatter(parts);
    }
}
// 13. Suggester (type / scope inference)
class CommitSuggester {
    suggest(changes) {
        const scores = this.emptyScores();
        for (const file of changes.files) {
            for (const [ext, types] of Object.entries(EXTENSION_TYPE_MAP)) {
                if (ext.startsWith(".") && file.extension === ext) {
                    for (const t of types)
                        scores[t] += 2;
                }
                else if (!ext.startsWith(".") && file.path.includes(ext)) {
                    for (const t of types)
                        scores[t] += 1;
                }
            }
            for (const [kw, t] of Object.entries(PATH_TYPE_MAP)) {
                if (file.path.toLowerCase().includes(kw.toLowerCase()))
                    scores[t] += 1.5;
            }
            if (file.path.includes(".test.") || file.path.includes(".spec.") || file.path.includes("__tests__")) {
                scores[CommitType.Test] += 3;
            }
        }
        const allAdded = changes.files.length > 0 && changes.files.every((f) => f.status === ChangeType.Added);
        if (allAdded)
            scores[CommitType.Feat] += 3;
        const allDeleted = changes.files.length > 0 && changes.files.every((f) => f.status === ChangeType.Deleted);
        if (allDeleted)
            scores[CommitType.Refactor] += 2;
        if (changes.stats.deletions > changes.stats.insertions * 2)
            scores[CommitType.Refactor] += 1;
        let bestType = CommitType.Feat, bestScore = 0;
        for (const [t, s] of Object.entries(scores)) {
            if (s > bestScore) {
                bestScore = s;
                bestType = t;
            }
        }
        const total = Object.values(scores).reduce((a, b) => a + b, 0);
        return { type: bestType, scope: this.inferScope(changes), confidence: total > 0 ? bestScore / total : 0 };
    }
    emptyScores() {
        const r = {};
        for (const t of Object.values(CommitType))
            r[t] = 0;
        return r;
    }
    inferScope(changes) {
        if (changes.files.length === 0)
            return "";
        const paths = changes.files.map((f) => f.path);
        const segments = paths[0].split("/");
        let commonPrefix = "";
        for (let i = 0; i < segments.length - 1; i++) {
            const candidate = segments.slice(0, i + 1).join("/");
            if (paths.every((p) => p.startsWith(candidate + "/") || p === candidate))
                commonPrefix = candidate;
            else
                break;
        }
        if (commonPrefix) {
            const p = commonPrefix.split("/");
            return p[p.length - 1];
        }
        if (paths.length === 1 && paths[0].includes("/")) {
            const p = paths[0].split("/");
            return p[p.length - 2];
        }
        return "";
    }
}
const VALIDATION_RULES = [
    { name: "subject-length", check: (m) => m.subject.length > 0 && m.subject.length <= 72, message: "subject 必须在 1-72 字符之间" },
    { name: "subject-no-period", check: (m) => !m.subject.endsWith("."), message: "subject 不应以句号结尾" },
    { name: "subject-lowercase", check: (m) => /^[a-z]/.test(m.subject), message: "subject 应以小写字母开头" },
    { name: "valid-type", check: (m) => isCommitType(m.type), message: "type 必须是合法的 Conventional Commit 类型" },
];
class CommitValidator {
    validate(msg) {
        const errors = [];
        for (const rule of VALIDATION_RULES) {
            if (!rule.check(msg))
                errors.push(new CommitValidationError(`[${rule.name}] ${rule.message}`));
        }
        return errors.length === 0 ? { ok: true, value: true } : { ok: false, error: errors };
    }
}
// 15. CommitBuilder with getters/setters
class CommitBuilder {
    constructor() {
        this._type = CommitType.Feat;
        this._scope = "";
        this._subject = "";
        this._body = "";
        this._isBreaking = false;
        this._closesIssues = [];
        this._coAuthors = [];
        this._footer = "";
        this._style = FormatStyle.Conventional;
        this._template = "{type}{scope}{breaking}: {subject}";
    }
    get type() { return this._type; }
    set type(v) { this._type = v; }
    get scope() { return this._scope; }
    set scope(v) { this._scope = v; }
    get subject() { return this._subject; }
    set subject(v) {
        if (v.length > 72)
            throw new CommitValidationError(`subject 长度 ${v.length} 超过 72 字符`);
        this._subject = v;
    }
    get isBreaking() { return this._isBreaking; }
    set isBreaking(v) { this._isBreaking = v; }
    get breakingReason() { return this._breakingReason; }
    set breakingReason(v) { this._breakingReason = v; }
    get style() { return this._style; }
    set style(v) { this._style = v; }
    forceSubject(v) { this._subject = v; return this; }
    addClosesIssue(n) { this._closesIssues.push(n); return this; }
    addCoAuthor(name, email) { this._coAuthors.push([name, email]); return this; }
    setBody(b) { this._body = b; return this; }
    setFooter(f) { this._footer = f; return this; }
    setTemplate(t) { this._template = t; return this; }
    build() {
        const parts = {
            type: this._type,
            scope: this._scope || undefined,
            subject: this._subject,
            body: this._body || undefined,
            isBreaking: this._isBreaking,
            breakingReason: this._breakingReason,
            closesIssues: this._closesIssues,
            coAuthors: this._coAuthors,
            footer: this._footer || undefined,
        };
        const formatter = this._style === FormatStyle.Gitmoji ? new GitmojiFormatter(parts)
            : this._style === FormatStyle.Custom ? new CustomFormatter(parts, this._template)
                : new ConventionalFormatter(parts);
        const full = formatter.format();
        return { type: this._type, scope: this._scope, subject: this._subject, body: this._body, isBreaking: this._isBreaking, footer: this._footer, full, style: this._style };
    }
}
// 16. Body generator + grouping helper
function groupByStatus(files) {
    const g = { [ChangeType.Added]: [], [ChangeType.Modified]: [], [ChangeType.Deleted]: [], [ChangeType.Renamed]: [] };
    for (const f of iterateFiles(files))
        g[f.status].push(f);
    return g;
}
function generateBody(changes, extra) {
    const lines = [`变更摘要：${changes.summary}`];
    const grouped = groupByStatus(changes.files);
    const labels = { [ChangeType.Added]: "新增", [ChangeType.Modified]: "修改", [ChangeType.Deleted]: "删除", [ChangeType.Renamed]: "重命名" };
    for (const st of Object.values(ChangeType)) {
        if (grouped[st].length) {
            lines.push(`${labels[st]}：`);
            for (const p of grouped[st])
                lines.push(`  - ${p}`);
        }
    }
    const extEntries = Object.entries(changes.stats.byExtension);
    if (extEntries.length) {
        lines.push("按扩展名统计：");
        for (const [ext, [a, d]] of extEntries)
            lines.push(`  ${ext || "(无)"}: +${a}/-${d}`);
    }
    if (extra)
        lines.push("", extra);
    return lines.join("\n");
}
// 17. History & readline helpers
function getRecentCommits(count = 10) {
    const out = execGit(`log --oneline -${count} --format="%s"`);
    return out ? out.split("\n").filter(Boolean) : [];
}
function createReadlineInterface() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}
function question(rl, prompt) {
    return new Promise((resolve) => { rl.question(prompt, (answer) => resolve(answer.trim())); });
}
// 18. Display helpers
function displayCommitTypes() {
    console.log("\n可用的 Commit 类型：");
    console.log("─".repeat(60));
    Object.values(CommitType).forEach((code, i) => {
        const meta = COMMIT_TYPES[code];
        console.log(`  ${(i + 1).toString().padStart(2)}. ${meta.emoji} ${code.padEnd(10)} ${meta.name.padEnd(6)} - ${meta.description}`);
    });
    console.log("─".repeat(60));
}
function displayStagedChanges(changes) {
    console.log("\n📋 暂存区变更摘要：");
    console.log("─".repeat(60));
    console.log(`  ${changes.summary}\n`);
    const grouped = groupByStatus(changes.files);
    const labels = { [ChangeType.Added]: "🆕 新增", [ChangeType.Modified]: "✏️  修改", [ChangeType.Deleted]: "🗑️  删除", [ChangeType.Renamed]: "📝 重命名" };
    for (const st of Object.values(ChangeType)) {
        if (grouped[st].length) {
            console.log(`  ${labels[st]}:`);
            for (const p of grouped[st])
                console.log(`    - ${p}`);
        }
    }
    console.log("─".repeat(60));
}
function displayStats(changes) {
    console.log("\n📊 按文件类型统计：");
    console.log("─".repeat(60));
    const entries = Object.entries(changes.stats.byExtension);
    if (entries.length === 0)
        console.log("  无统计数据");
    else
        for (const [ext, [a, d]] of entries)
            console.log(`  ${(ext || "(无)").padEnd(10)} +${a} / -${d}`);
    console.log(`  总计：+${changes.stats.insertions} / -${changes.stats.deletions} (${changes.stats.filesChanged} 个文件)`);
    console.log("─".repeat(60));
}
function displayHistory() {
    const commits = getRecentCommits(10);
    if (commits.length === 0) {
        console.log("暂无 commit 记录。");
        return;
    }
    console.log("\n📜 最近的 Commit 记录：");
    console.log("─".repeat(60));
    for (const c of commits)
        console.log(`  ${c}`);
    console.log("─".repeat(60));
}
// 19. Interactive generation
async function interactiveGenerate(shouldAutoAnalyze) {
    const rl = createReadlineInterface();
    try {
        const analyzer = new StagedChangesAnalyzer();
        const outcome = safeAnalyze(analyzer);
        let changes = null;
        let suggestedType = CommitType.Feat;
        let suggestedScope = "";
        if (outcome.status === "not-repo") {
            console.log("❌ 当前目录不在 Git 仓库中！");
            return null;
        }
        if (outcome.status === "ok") {
            changes = outcome.changes;
            displayStagedChanges(changes);
            displayStats(changes);
            const sug = new CommitSuggester().suggest(changes);
            suggestedType = sug.type;
            suggestedScope = sug.scope;
            console.log(`\n💡 推荐类型: ${sug.type}（置信度: ${Math.round(sug.confidence * 100)}%）`);
            if (suggestedScope)
                console.log(`💡 推荐范围: ${suggestedScope}`);
            console.log(`💡 共 ${analyzer[INTERNAL]()} 个变更文件`);
        }
        else {
            console.log("⚠️  暂存区没有变更。请先使用 git add 添加文件。");
            console.log("   你仍可以继续生成 commit message，但建议先暂存变更。\n");
        }
        displayCommitTypes();
        const builder = new CommitBuilder();
        // Type
        while (true) {
            const hint = shouldAutoAnalyze && suggestedType ? ` [${suggestedType}]` : "";
            const answer = await question(rl, `\n请选择 commit 类型（编号或类型代码）${hint}: `);
            if (!answer && suggestedType) {
                builder.type = suggestedType;
                break;
            }
            if (!answer) {
                console.log("请输入有效的类型编号或代码！");
                continue;
            }
            const num = parseInt(answer, 10);
            const entries = Object.values(CommitType);
            if (!isNaN(num) && num >= 1 && num <= entries.length) {
                builder.type = entries[num - 1];
                break;
            }
            if (isCommitType(answer.toLowerCase())) {
                builder.type = answer.toLowerCase();
                break;
            }
            console.log("无效的类型！请输入编号或类型代码。");
        }
        // Scope
        const scopeHint = shouldAutoAnalyze && suggestedScope ? ` [${suggestedScope}]` : "";
        builder.scope = (await question(rl, `请输入影响范围 scope（可选）${scopeHint}: `)) || (shouldAutoAnalyze ? suggestedScope : "");
        // Subject
        while (true) {
            const s = await question(rl, "请输入简短描述（不超过 72 个字符）: ");
            if (!s) {
                console.log("描述不能为空！");
                continue;
            }
            try {
                builder.subject = s;
                break;
            }
            catch (e) {
                console.log(`⚠️  ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        // Body
        const bodyAnswer = (await question(rl, "是否添加详细说明？(y/N): ")).toLowerCase();
        if (bodyAnswer === "y" || bodyAnswer === "yes") {
            console.log("请输入详细说明（输入空行结束）：");
            const lines = [];
            let line = await question(rl, "  ");
            while (line !== "") {
                lines.push(line);
                line = await question(rl, "  ");
            }
            builder.setBody(lines.join("\n"));
        }
        else if (changes) {
            builder.setBody(generateBody(changes));
        }
        // Breaking change
        const breakingAnswer = (await question(rl, "是否包含 Breaking Change？(y/N): ")).toLowerCase();
        builder.isBreaking = breakingAnswer === "y" || breakingAnswer === "yes";
        if (builder.isBreaking) {
            console.log("可选原因：");
            const reasons = Object.values(BreakingReason);
            reasons.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
            const r = await question(rl, "选择原因编号（可选）: ");
            const n = parseInt(r, 10);
            if (!isNaN(n) && n >= 1 && n <= reasons.length)
                builder.breakingReason = reasons[n - 1];
        }
        // Closes issues
        const closesAnswer = await question(rl, "是否关联 Issue？输入编号，逗号分隔（可选）: ");
        if (closesAnswer) {
            for (const n of closesAnswer.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))) {
                builder.addClosesIssue(n);
            }
        }
        // Footer
        const footerAnswer = (await question(rl, "是否添加额外 footer？(y/N): ")).toLowerCase();
        if (footerAnswer === "y" || footerAnswer === "yes")
            builder.setFooter(await question(rl, "请输入 footer 内容: "));
        // Style
        const styleAnswer = await question(rl, "选择格式 (1=conventional [默认], 2=gitmoji, 3=custom): ");
        if (styleAnswer === "2")
            builder.style = FormatStyle.Gitmoji;
        else if (styleAnswer === "3") {
            builder.style = FormatStyle.Custom;
            builder.setTemplate(await question(rl, "自定义模板（含 {type}{scope}{breaking}{subject}）: "));
        }
        const msg = builder.build();
        const result = new CommitValidator().validate(msg);
        if (!result.ok) {
            console.log("\n⚠️  验证警告：");
            for (const e of result.error)
                console.log(`  - ${e.message}`);
        }
        return msg;
    }
    finally {
        rl.close();
    }
}
function cliGenerate(opts) {
    const builder = new CommitBuilder();
    if (isCommitType(opts.type.toLowerCase()))
        builder.type = opts.type.toLowerCase();
    else {
        console.log(`⚠️  未知的 commit 类型: "${opts.type}"，将使用 feat。`);
        builder.type = CommitType.Feat;
    }
    builder.scope = opts.scope;
    try {
        builder.subject = opts.subject;
    }
    catch (e) {
        console.log(`⚠️  ${e instanceof Error ? e.message : String(e)}`);
        builder.forceSubject(opts.subject);
    }
    if (opts.body)
        builder.setBody(opts.body);
    builder.isBreaking = opts.breaking;
    if (opts.footer)
        builder.setFooter(opts.footer);
    builder.style = opts.style;
    return builder.build();
}
// 21. Display & commit execution
function displayResult(result, shouldCommit) {
    console.log("\n✅ 生成的 Commit Message：");
    console.log("═".repeat(60));
    console.log(result.full);
    console.log("═".repeat(60));
    if (!shouldCommit) {
        console.log("\n💡 你可以使用以下命令提交：");
        const escaped = result.full.replace(/"/g, '\\"');
        console.log(`  git commit -m "${escaped.replace(/\n/g, "\\n")}"`);
        return;
    }
    if (!execGit("rev-parse --is-inside-work-tree")) {
        console.log("\n❌ 当前不在 Git 仓库中，无法执行 commit。");
        return;
    }
    try {
        const root = execGit("rev-parse --show-toplevel") || ".";
        const tempFile = path.join(root, `.git/COMMIT_EDITMSG_${Date.now()}`);
        fs.writeFileSync(tempFile, result.full, "utf-8");
        (0, child_process_1.execSync)(`git commit -F "${tempFile}"`, { stdio: "inherit" });
        fs.unlinkSync(tempFile);
        console.log("\n🎉 Commit 成功！");
    }
    catch (err) {
        console.log(`\n❌ Commit 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function parseArgs(argv) {
    const opts = {
        interactive: false, autoAnalyze: false, type: "", scope: "", message: "", body: "",
        breaking: false, footer: "", commit: false, showHistory: false, showHelp: false,
        style: FormatStyle.Conventional,
    };
    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        switch (arg) {
            case "-i":
            case "--interactive":
                opts.interactive = true;
                break;
            case "-a":
            case "--auto":
                opts.autoAnalyze = true;
                break;
            case "-t":
            case "--type":
                opts.type = argv[++i] ?? "";
                break;
            case "-s":
            case "--scope":
                opts.scope = argv[++i] ?? "";
                break;
            case "-m":
            case "--message":
                opts.message = argv[++i] ?? "";
                break;
            case "-b":
            case "--body":
                opts.body = argv[++i] ?? "";
                break;
            case "-B":
            case "--breaking":
                opts.breaking = true;
                break;
            case "-f":
            case "--footer":
                opts.footer = argv[++i] ?? "";
                break;
            case "-c":
            case "--commit":
                opts.commit = true;
                break;
            case "--gitmoji":
                opts.style = FormatStyle.Gitmoji;
                break;
            case "--custom":
                opts.style = FormatStyle.Custom;
                break;
            case "--history":
                opts.showHistory = true;
                break;
            case "-h":
            case "--help":
                opts.showHelp = true;
                break;
            default: console.log(`未知选项: ${arg}，使用 --help 查看帮助。`);
        }
        i++;
    }
    return opts;
}
// 23. Help & main
function printHelp() {
    console.log(`
Git Commit Message 生成器 (Enhanced)

用法：
  node dist/index.js [选项]

选项：
  -i, --interactive    交互式生成（默认）
  -a, --auto           自动分析暂存区
  -t, --type <type>    指定 commit 类型
  -s, --scope <scope>  指定影响范围
  -m, --message <msg>  指定简短描述
  -b, --body <body>    指定详细说明
  -B, --breaking       标记为 Breaking Change
  -f, --footer <text>  添加 footer
  -c, --commit         生成后直接执行 git commit
  --gitmoji            使用 gitmoji 风格
  --custom             使用自定义模板风格
  --history            查看最近 commit 记录
  -h, --help           显示帮助

示例：
  node dist/index.js -a                                  # 自动分析
  node dist/index.js -t feat -m "添加登录"               # 指定类型和描述
  node dist/index.js -t feat -m "新API" -B -c            # Breaking + commit
  node dist/index.js -t fix -s api -m "修复超时" --gitmoji
`);
}
async function main() {
    const options = parseArgs(process.argv);
    if (options.showHelp) {
        printHelp();
        return;
    }
    if (options.showHistory) {
        if (!execGit("rev-parse --is-inside-work-tree")) {
            console.log("❌ 当前目录不在 Git 仓库中！");
            return;
        }
        displayHistory();
        return;
    }
    if (options.type && options.message) {
        const result = cliGenerate({
            type: options.type, scope: options.scope, subject: options.message, body: options.body,
            breaking: options.breaking, footer: options.footer, style: options.style,
        });
        const v = new CommitValidator().validate(result);
        if (!v.ok) {
            console.log("⚠️  验证警告：");
            for (const e of v.error)
                console.log(`  - ${e.message}`);
        }
        displayResult(result, options.commit);
    }
    else {
        const shouldAutoAnalyze = options.autoAnalyze || options.interactive;
        const result = await interactiveGenerate(shouldAutoAnalyze);
        if (result)
            displayResult(result, options.commit);
    }
}
main().catch((err) => {
    console.error(`发生错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map