#!/usr/bin/env node
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
import * as readline from "readline";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// 1. Enums
enum CommitType {
  Feat = "feat",
  Fix = "fix",
  Docs = "docs",
  Style = "style",
  Refactor = "refactor",
  Perf = "perf",
  Test = "test",
  Build = "build",
  Ci = "ci",
  Chore = "chore",
  Revert = "revert",
}
enum ChangeType {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
}
enum BreakingReason {
  Api = "不兼容的 API 变更",
  Removal = "功能被移除",
  Behavior = "默认行为变更",
  Default = "不向后兼容的变更",
}
enum FormatStyle {
  Conventional = "conventional",
  Gitmoji = "gitmoji",
  Custom = "custom",
}

// 2. Custom Error hierarchy
class GitError extends Error {
  constructor(
    message: string,
    readonly code: string = "GIT_ERROR",
  ) {
    super(message);
    this.name = "GitError";
  }
}
class NotARepoError extends GitError {
  constructor() {
    super("当前目录不在 Git 仓库中", "NOT_A_REPO");
    this.name = "NotARepoError";
  }
}
class NoStagedChangesError extends GitError {
  constructor() {
    super("暂存区没有变更", "NO_STAGED_CHANGES");
    this.name = "NoStagedChangesError";
  }
}
class CommitValidationError extends GitError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "CommitValidationError";
  }
}

// 3. Interfaces, tuples, index signatures, readonly/optional
interface StagedFile {
  readonly status: ChangeType;
  readonly path: string;
  readonly extension: string;
  readonly additions: number;
  readonly deletions: number;
}
interface DiffStats {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly byExtension: Readonly<Record<string, readonly [number, number]>>;
}
interface StagedChanges {
  readonly files: readonly StagedFile[];
  readonly stats: DiffStats;
  readonly summary: string;
}
interface CommitTypeMeta {
  readonly name: string;
  readonly description: string;
  readonly emoji: string;
  readonly [key: string]: string;
}
interface CommitParts {
  type: CommitType;
  scope?: string;
  subject: string;
  body?: string;
  isBreaking: boolean;
  breakingReason?: BreakingReason;
  closesIssues?: readonly number[];
  coAuthors?: readonly [string, string][];
  footer?: string;
}
interface GeneratedMessage {
  readonly type: CommitType;
  readonly scope: string;
  readonly subject: string;
  readonly body: string;
  readonly isBreaking: boolean;
  readonly footer: string;
  readonly full: string;
  readonly style: FormatStyle;
}
interface Suggestion {
  readonly type: CommitType;
  readonly scope: string;
  readonly confidence: number;
}

// 4. Mapped · Conditional · Template literal · Utility types
type CommitTypeMap = { [K in CommitType]: CommitTypeMeta };
type CommitHeader<
  T extends string,
  S extends string,
  D extends string,
> = `${T}${S extends "" ? "" : `(${S})`}: ${D}`;
type EmojiOf<T> = T extends CommitType ? string : never;
type CommitInput = Partial<
  Pick<CommitParts, "scope" | "body" | "closesIssues" | "coAuthors" | "footer">
> &
  Pick<CommitParts, "type" | "subject" | "isBreaking">;
type CommitEssentials = Omit<
  CommitParts,
  "closesIssues" | "coAuthors" | "footer"
>;
type CommitDisplayInfo = Omit<GeneratedMessage, "full">;

// 5. `as const` + `satisfies` configuration tables
const COMMIT_TYPES = {
  feat: { name: "新功能", description: "新增功能或特性", emoji: "✨" },
  fix: { name: "修复", description: "修复 Bug 或问题", emoji: "🐛" },
  docs: { name: "文档", description: "仅文档变更", emoji: "📝" },
  style: { name: "样式", description: "格式变更（空格、分号等）", emoji: "💄" },
  refactor: {
    name: "重构",
    description: "既不新增功能也不修复 Bug",
    emoji: "♻️",
  },
  perf: { name: "性能", description: "提升性能的代码变更", emoji: "⚡" },
  test: { name: "测试", description: "新增或修正测试代码", emoji: "✅" },
  build: { name: "构建", description: "影响构建系统或依赖", emoji: "📦" },
  ci: { name: "持续集成", description: "CI 配置和脚本变更", emoji: "👷" },
  chore: {
    name: "杂务",
    description: "其他不修改 src/test 的变更",
    emoji: "🔧",
  },
  revert: { name: "回退", description: "回退之前的 commit", emoji: "⏪" },
} as const satisfies Record<CommitType, CommitTypeMeta>;

const EXTENSION_TYPE_MAP: Readonly<Record<string, readonly CommitType[]>> = {
  ".md": [CommitType.Docs],
  ".txt": [CommitType.Docs],
  ".css": [CommitType.Style],
  ".scss": [CommitType.Style],
  ".less": [CommitType.Style],
  ".yml": [CommitType.Ci],
  ".yaml": [CommitType.Ci],
  ".json": [CommitType.Chore, CommitType.Build],
  ".lock": [CommitType.Build],
};

const PATH_TYPE_MAP: Readonly<Record<string, CommitType>> = {
  test: CommitType.Test,
  tests: CommitType.Test,
  __tests__: CommitType.Test,
  spec: CommitType.Test,
  docs: CommitType.Docs,
  doc: CommitType.Docs,
  style: CommitType.Style,
  styles: CommitType.Style,
  ci: CommitType.Ci,
  ".github": CommitType.Ci,
  docker: CommitType.Build,
  Dockerfile: CommitType.Build,
  config: CommitType.Chore,
  scripts: CommitType.Chore,
  build: CommitType.Build,
  webpack: CommitType.Build,
  vite: CommitType.Build,
  rollup: CommitType.Build,
};

// 6. Generics with constraints · Result · GitCommand
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
type GitCommand<T extends string> = `git ${T}`;

function runGit<T extends string>(
  cmd: GitCommand<T>,
): Result<string, GitError> {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { ok: true, value: out };
  } catch (e) {
    return {
      ok: false,
      error: new GitError(
        e instanceof Error ? e.message : String(e),
        "GIT_CMD",
      ),
    };
  }
}
function execGit(args: string): string {
  const r = runGit(`git ${args}` as GitCommand<"diff">);
  return r.ok ? r.value : "";
}

// 7. Discriminated union for diff outcome
type DiffOutcome =
  | { readonly status: "ok"; readonly changes: StagedChanges }
  | { readonly status: "no-staged" }
  | { readonly status: "not-repo" };

// 8. Type guards
function isCommitType(x: unknown): x is CommitType {
  return (
    typeof x === "string" &&
    (Object.values(CommitType) as readonly string[]).includes(x)
  );
}
function isBreakingChange<
  T extends Pick<CommitParts, "isBreaking" | "breakingReason">,
>(p: T): p is T & { isBreaking: true; breakingReason: BreakingReason } {
  return p.isBreaking === true && p.breakingReason !== undefined;
}

// 9. Symbols
const ANALYZE = Symbol("analyze");
const INTERNAL = Symbol("internal");

// 10. Abstract Git analyzer + concrete implementation
abstract class AbstractGitAnalyzer {
  protected exec(args: string): string {
    return execGit(args);
  }
  protected isRepo(): boolean {
    return this.exec("rev-parse --is-inside-work-tree") === "true";
  }
  protected hasStaged(): boolean {
    return this.exec("diff --staged --name-only").length > 0;
  }
  protected get repoRoot(): string {
    return this.exec("rev-parse --show-toplevel") || ".";
  }
  abstract analyze(): StagedChanges;
  abstract [ANALYZE](): Iterable<StagedFile>;
}

class StagedChangesAnalyzer extends AbstractGitAnalyzer {
  private cache: StagedChanges | null = null;

  analyze(): StagedChanges {
    if (this.cache) return this.cache;
    if (!this.isRepo()) throw new NotARepoError();
    if (!this.hasStaged()) throw new NoStagedChangesError();

    const nameStatus = this.exec("diff --staged --name-status");
    const numstat = this.exec("diff --staged --numstat");
    const fileMap = new Map<string, StagedFile>();
    const byExt: Record<string, [number, number]> = {};

    if (nameStatus) {
      for (const line of nameStatus.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        if (parts.length < 2) continue;
        const status = this.toChangeType(parts[0][0]);
        const filePath = parts[1];
        fileMap.set(filePath, {
          status,
          path: filePath,
          extension: this.extOf(filePath),
          additions: 0,
          deletions: 0,
        });
      }
    }

    let insertions = 0,
      deletions = 0;
    if (numstat) {
      for (const line of numstat.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const ins = parseInt(parts[0], 10) || 0;
        const del = parseInt(parts[1], 10) || 0;
        const filePath = parts[2];
        insertions += ins;
        deletions += del;
        const ext = this.extOf(filePath);
        const existing = fileMap.get(filePath);
        if (existing)
          fileMap.set(filePath, {
            ...existing,
            additions: ins,
            deletions: del,
          });
        if (ext) {
          const cur = byExt[ext] ?? [0, 0];
          byExt[ext] = [cur[0] + ins, cur[1] + del];
        }
      }
    }

    const files = Array.from(fileMap.values());
    const result: StagedChanges = {
      files,
      stats: {
        filesChanged: files.length,
        insertions,
        deletions,
        byExtension: byExt,
      },
      summary: this.buildSummary(files, insertions, deletions),
    };
    this.cache = result;
    return result;
  }

  *[ANALYZE](): Iterable<StagedFile> {
    for (const f of this.analyze().files) yield f;
  }
  *iterFiles(): Iterable<StagedFile> {
    yield* this[ANALYZE]();
  }
  [INTERNAL](): number {
    return this.analyze().files.length;
  }

  private extOf(p: string): string {
    return p.includes(".") ? "." + p.split(".").pop()!.toLowerCase() : "";
  }
  private toChangeType(c: string): ChangeType {
    switch (c) {
      case "A":
        return ChangeType.Added;
      case "D":
        return ChangeType.Deleted;
      case "R":
        return ChangeType.Renamed;
      default:
        return ChangeType.Modified;
    }
  }
  private buildSummary(
    files: readonly StagedFile[],
    ins: number,
    del: number,
  ): string {
    const counts: Record<ChangeType, number> = {
      [ChangeType.Added]: 0,
      [ChangeType.Modified]: 0,
      [ChangeType.Deleted]: 0,
      [ChangeType.Renamed]: 0,
    };
    for (const f of files) counts[f.status]++;
    const parts: string[] = [];
    if (counts[ChangeType.Added])
      parts.push(`新增 ${counts[ChangeType.Added]} 个文件`);
    if (counts[ChangeType.Modified])
      parts.push(`修改 ${counts[ChangeType.Modified]} 个文件`);
    if (counts[ChangeType.Deleted])
      parts.push(`删除 ${counts[ChangeType.Deleted]} 个文件`);
    if (counts[ChangeType.Renamed])
      parts.push(`重命名 ${counts[ChangeType.Renamed]} 个文件`);
    return parts.length
      ? parts.join("，") + `，+${ins}/-${del} 行`
      : "暂存区无变更";
  }
}

// Standalone generator function.
function* iterateFiles(
  files: readonly StagedFile[],
): IterableIterator<StagedFile> {
  for (const f of files) yield f;
}

function safeAnalyze(analyzer: StagedChangesAnalyzer): DiffOutcome {
  if (!execGit("rev-parse --is-inside-work-tree"))
    return { status: "not-repo" };
  if (!execGit("diff --staged --name-only")) return { status: "no-staged" };
  return { status: "ok", changes: analyzer.analyze() };
}

// 11. Abstract commit formatter + concrete formatters
abstract class AbstractCommitFormatter {
  constructor(protected readonly parts: CommitParts) {}
  abstract get header(): string;
  abstract format(): string;
  protected get breakingMark(): string {
    return this.parts.isBreaking ? "!" : "";
  }
  protected get scopePart(): string {
    return this.parts.scope ? `(${this.parts.scope})` : "";
  }
}

class ConventionalFormatter extends AbstractCommitFormatter {
  get header(): string {
    return `${this.parts.type}${this.scopePart}${this.breakingMark}: ${this.parts.subject}`;
  }
  format(): string {
    const lines: string[] = [this.header];
    if (this.parts.body) lines.push("", this.parts.body);
    if (this.parts.isBreaking)
      lines.push(
        "",
        `BREAKING CHANGE: ${this.parts.breakingReason ?? BreakingReason.Default}`,
      );
    const footer = this.buildFooter();
    if (footer) lines.push("", footer);
    return lines.join("\n");
  }
  protected buildFooter(): string {
    const out: string[] = [];
    if (this.parts.closesIssues?.length)
      out.push(`Closes #${this.parts.closesIssues.join(", #")}`);
    if (this.parts.coAuthors?.length) {
      for (const [name, email] of this.parts.coAuthors)
        out.push(`Co-authored-by: ${name} <${email}>`);
    }
    if (this.parts.footer) out.push(this.parts.footer);
    return out.join("\n");
  }
}

class GitmojiFormatter extends ConventionalFormatter {
  get header(): string {
    const emoji = COMMIT_TYPES[this.parts.type]?.emoji ?? "";
    return `${emoji} ${this.parts.type}${this.scopePart}${this.breakingMark}: ${this.parts.subject}`;
  }
}

class CustomFormatter extends AbstractCommitFormatter {
  constructor(
    parts: CommitParts,
    private readonly template: string,
  ) {
    super(parts);
  }
  get header(): string {
    return this.template
      .replace("{type}", this.parts.type)
      .replace("{scope}", this.scopePart)
      .replace("{breaking}", this.breakingMark)
      .replace("{subject}", this.parts.subject);
  }
  format(): string {
    const lines: string[] = [this.header];
    if (this.parts.body) lines.push("", this.parts.body);
    if (this.parts.isBreaking)
      lines.push(
        "",
        `BREAKING CHANGE: ${this.parts.breakingReason ?? BreakingReason.Default}`,
      );
    return lines.join("\n");
  }
}

// 12. Function overloads · Formatter factory
function createFormatter(
  parts: CommitParts,
  style: FormatStyle.Conventional,
): ConventionalFormatter;
function createFormatter(
  parts: CommitParts,
  style: FormatStyle.Gitmoji,
): GitmojiFormatter;
function createFormatter(
  parts: CommitParts,
  style: FormatStyle.Custom,
  template: string,
): CustomFormatter;
function createFormatter(
  parts: CommitParts,
  style: FormatStyle,
  template?: string,
): AbstractCommitFormatter {
  switch (style) {
    case FormatStyle.Gitmoji:
      return new GitmojiFormatter(parts);
    case FormatStyle.Custom:
      return new CustomFormatter(
        parts,
        template ?? "{type}{scope}{breaking}: {subject}",
      );
    case FormatStyle.Conventional:
    default:
      return new ConventionalFormatter(parts);
  }
}
type FormatterInstance = ReturnType<typeof createFormatter>;
type SuggestParams = Parameters<CommitSuggester["suggest"]>[0];

// 13. Suggester (type / scope inference)
class CommitSuggester {
  suggest(changes: StagedChanges): Suggestion {
    const scores = this.emptyScores();
    for (const file of changes.files) {
      for (const [ext, types] of Object.entries(EXTENSION_TYPE_MAP)) {
        if (ext.startsWith(".") && file.extension === ext) {
          for (const t of types) scores[t] += 2;
        } else if (!ext.startsWith(".") && file.path.includes(ext)) {
          for (const t of types) scores[t] += 1;
        }
      }
      for (const [kw, t] of Object.entries(PATH_TYPE_MAP)) {
        if (file.path.toLowerCase().includes(kw.toLowerCase()))
          scores[t] += 1.5;
      }
      if (
        file.path.includes(".test.") ||
        file.path.includes(".spec.") ||
        file.path.includes("__tests__")
      ) {
        scores[CommitType.Test] += 3;
      }
    }
    const allAdded =
      changes.files.length > 0 &&
      changes.files.every((f) => f.status === ChangeType.Added);
    if (allAdded) scores[CommitType.Feat] += 3;
    const allDeleted =
      changes.files.length > 0 &&
      changes.files.every((f) => f.status === ChangeType.Deleted);
    if (allDeleted) scores[CommitType.Refactor] += 2;
    if (changes.stats.deletions > changes.stats.insertions * 2)
      scores[CommitType.Refactor] += 1;

    let bestType: CommitType = CommitType.Feat,
      bestScore = 0;
    for (const [t, s] of Object.entries(scores)) {
      if (s > bestScore) {
        bestScore = s;
        bestType = t as CommitType;
      }
    }
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    return {
      type: bestType,
      scope: this.inferScope(changes),
      confidence: total > 0 ? bestScore / total : 0,
    };
  }

  private emptyScores(): Record<CommitType, number> {
    const r = {} as Record<CommitType, number>;
    for (const t of Object.values(CommitType)) r[t] = 0;
    return r;
  }

  private inferScope(changes: StagedChanges): string {
    if (changes.files.length === 0) return "";
    const paths = changes.files.map((f) => f.path);
    const segments = paths[0].split("/");
    let commonPrefix = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const candidate = segments.slice(0, i + 1).join("/");
      if (paths.every((p) => p.startsWith(candidate + "/") || p === candidate))
        commonPrefix = candidate;
      else break;
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

// 14. Validation rules + Validator
interface ValidationRule {
  readonly name: string;
  readonly check: (msg: GeneratedMessage) => boolean;
  readonly message: string;
}
const VALIDATION_RULES = [
  {
    name: "subject-length",
    check: (m: GeneratedMessage) =>
      m.subject.length > 0 && m.subject.length <= 72,
    message: "subject 必须在 1-72 字符之间",
  },
  {
    name: "subject-no-period",
    check: (m: GeneratedMessage) => !m.subject.endsWith("."),
    message: "subject 不应以句号结尾",
  },
  {
    name: "subject-lowercase",
    check: (m: GeneratedMessage) => /^[a-z]/.test(m.subject),
    message: "subject 应以小写字母开头",
  },
  {
    name: "valid-type",
    check: (m: GeneratedMessage) => isCommitType(m.type),
    message: "type 必须是合法的 Conventional Commit 类型",
  },
] as const satisfies readonly ValidationRule[];

class CommitValidator {
  validate(
    msg: GeneratedMessage,
  ): Result<true, readonly CommitValidationError[]> {
    const errors: CommitValidationError[] = [];
    for (const rule of VALIDATION_RULES) {
      if (!rule.check(msg))
        errors.push(
          new CommitValidationError(`[${rule.name}] ${rule.message}`),
        );
    }
    return errors.length === 0
      ? { ok: true, value: true }
      : { ok: false, error: errors };
  }
}

// 15. CommitBuilder with getters/setters
class CommitBuilder {
  private _type: CommitType = CommitType.Feat;
  private _scope = "";
  private _subject = "";
  private _body = "";
  private _isBreaking = false;
  private _breakingReason?: BreakingReason;
  private _closesIssues: number[] = [];
  private _coAuthors: [string, string][] = [];
  private _footer = "";
  private _style: FormatStyle = FormatStyle.Conventional;
  private _template = "{type}{scope}{breaking}: {subject}";

  get type(): CommitType {
    return this._type;
  }
  set type(v: CommitType) {
    this._type = v;
  }
  get scope(): string {
    return this._scope;
  }
  set scope(v: string) {
    this._scope = v;
  }
  get subject(): string {
    return this._subject;
  }
  set subject(v: string) {
    if (v.length > 72)
      throw new CommitValidationError(`subject 长度 ${v.length} 超过 72 字符`);
    this._subject = v;
  }
  get isBreaking(): boolean {
    return this._isBreaking;
  }
  set isBreaking(v: boolean) {
    this._isBreaking = v;
  }
  get breakingReason(): BreakingReason | undefined {
    return this._breakingReason;
  }
  set breakingReason(v: BreakingReason | undefined) {
    this._breakingReason = v;
  }
  get style(): FormatStyle {
    return this._style;
  }
  set style(v: FormatStyle) {
    this._style = v;
  }

  forceSubject(v: string): this {
    this._subject = v;
    return this;
  }
  addClosesIssue(n: number): this {
    this._closesIssues.push(n);
    return this;
  }
  addCoAuthor(name: string, email: string): this {
    this._coAuthors.push([name, email]);
    return this;
  }
  setBody(b: string): this {
    this._body = b;
    return this;
  }
  setFooter(f: string): this {
    this._footer = f;
    return this;
  }
  setTemplate(t: string): this {
    this._template = t;
    return this;
  }

  build(): GeneratedMessage {
    const parts: CommitParts = {
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
    const formatter: AbstractCommitFormatter =
      this._style === FormatStyle.Gitmoji
        ? new GitmojiFormatter(parts)
        : this._style === FormatStyle.Custom
          ? new CustomFormatter(parts, this._template)
          : new ConventionalFormatter(parts);
    const full = formatter.format();
    return {
      type: this._type,
      scope: this._scope,
      subject: this._subject,
      body: this._body,
      isBreaking: this._isBreaking,
      footer: this._footer,
      full,
      style: this._style,
    };
  }
}

// 16. Body generator + grouping helper
function groupByStatus(
  files: readonly StagedFile[],
): Record<ChangeType, readonly StagedFile[]> {
  const g: Record<ChangeType, StagedFile[]> = {
    [ChangeType.Added]: [],
    [ChangeType.Modified]: [],
    [ChangeType.Deleted]: [],
    [ChangeType.Renamed]: [],
  };
  for (const f of iterateFiles(files)) g[f.status].push(f);
  return g;
}

function generateBody(changes: StagedChanges, extra?: string): string {
  const lines: string[] = [`变更摘要：${changes.summary}`];
  const grouped = groupByStatus(changes.files);
  const labels: Record<ChangeType, string> = {
    [ChangeType.Added]: "新增",
    [ChangeType.Modified]: "修改",
    [ChangeType.Deleted]: "删除",
    [ChangeType.Renamed]: "重命名",
  };
  for (const st of Object.values(ChangeType)) {
    if (grouped[st].length) {
      lines.push(`${labels[st]}：`);
      for (const p of grouped[st]) lines.push(`  - ${p}`);
    }
  }
  const extEntries = Object.entries(changes.stats.byExtension);
  if (extEntries.length) {
    lines.push("按扩展名统计：");
    for (const [ext, [a, d]] of extEntries)
      lines.push(`  ${ext || "(无)"}: +${a}/-${d}`);
  }
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

// 17. History & readline helpers
function getRecentCommits(count: number = 10): string[] {
  const out = execGit(`log --oneline -${count} --format="%s"`);
  return out ? out.split("\n").filter(Boolean) : [];
}
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}
function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => resolve(answer.trim()));
  });
}

// 18. Display helpers
function displayCommitTypes(): void {
  console.log("\n可用的 Commit 类型：");
  console.log("─".repeat(60));
  Object.values(CommitType).forEach((code, i) => {
    const meta = COMMIT_TYPES[code];
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${meta.emoji} ${code.padEnd(10)} ${meta.name.padEnd(6)} - ${meta.description}`,
    );
  });
  console.log("─".repeat(60));
}

function displayStagedChanges(changes: StagedChanges): void {
  console.log("\n📋 暂存区变更摘要：");
  console.log("─".repeat(60));
  console.log(`  ${changes.summary}\n`);
  const grouped = groupByStatus(changes.files);
  const labels: Record<ChangeType, string> = {
    [ChangeType.Added]: "🆕 新增",
    [ChangeType.Modified]: "✏️  修改",
    [ChangeType.Deleted]: "🗑️  删除",
    [ChangeType.Renamed]: "📝 重命名",
  };
  for (const st of Object.values(ChangeType)) {
    if (grouped[st].length) {
      console.log(`  ${labels[st]}:`);
      for (const p of grouped[st]) console.log(`    - ${p}`);
    }
  }
  console.log("─".repeat(60));
}

function displayStats(changes: StagedChanges): void {
  console.log("\n📊 按文件类型统计：");
  console.log("─".repeat(60));
  const entries = Object.entries(changes.stats.byExtension);
  if (entries.length === 0) console.log("  无统计数据");
  else
    for (const [ext, [a, d]] of entries)
      console.log(`  ${(ext || "(无)").padEnd(10)} +${a} / -${d}`);
  console.log(
    `  总计：+${changes.stats.insertions} / -${changes.stats.deletions} (${changes.stats.filesChanged} 个文件)`,
  );
  console.log("─".repeat(60));
}

function displayHistory(): void {
  const commits = getRecentCommits(10);
  if (commits.length === 0) {
    console.log("暂无 commit 记录。");
    return;
  }
  console.log("\n📜 最近的 Commit 记录：");
  console.log("─".repeat(60));
  for (const c of commits) console.log(`  ${c}`);
  console.log("─".repeat(60));
}

// 19. Interactive generation
async function interactiveGenerate(
  shouldAutoAnalyze: boolean,
): Promise<GeneratedMessage | null> {
  const rl = createReadlineInterface();
  try {
    const analyzer = new StagedChangesAnalyzer();
    const outcome = safeAnalyze(analyzer);
    let changes: StagedChanges | null = null;
    let suggestedType: CommitType = CommitType.Feat;
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
      console.log(
        `\n💡 推荐类型: ${sug.type}（置信度: ${Math.round(sug.confidence * 100)}%）`,
      );
      if (suggestedScope) console.log(`💡 推荐范围: ${suggestedScope}`);
      console.log(`💡 共 ${analyzer[INTERNAL]()} 个变更文件`);
    } else {
      console.log("⚠️  暂存区没有变更。请先使用 git add 添加文件。");
      console.log("   你仍可以继续生成 commit message，但建议先暂存变更。\n");
    }

    displayCommitTypes();
    const builder = new CommitBuilder();

    // Type
    while (true) {
      const hint =
        shouldAutoAnalyze && suggestedType ? ` [${suggestedType}]` : "";
      const answer = await question(
        rl,
        `\n请选择 commit 类型（编号或类型代码）${hint}: `,
      );
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
        builder.type = answer.toLowerCase() as CommitType;
        break;
      }
      console.log("无效的类型！请输入编号或类型代码。");
    }

    // Scope
    const scopeHint =
      shouldAutoAnalyze && suggestedScope ? ` [${suggestedScope}]` : "";
    builder.scope =
      (await question(rl, `请输入影响范围 scope（可选）${scopeHint}: `)) ||
      (shouldAutoAnalyze ? suggestedScope : "");

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
      } catch (e) {
        console.log(`⚠️  ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Body
    const bodyAnswer = (
      await question(rl, "是否添加详细说明？(y/N): ")
    ).toLowerCase();
    if (bodyAnswer === "y" || bodyAnswer === "yes") {
      console.log("请输入详细说明（输入空行结束）：");
      const lines: string[] = [];
      let line = await question(rl, "  ");
      while (line !== "") {
        lines.push(line);
        line = await question(rl, "  ");
      }
      builder.setBody(lines.join("\n"));
    } else if (changes) {
      builder.setBody(generateBody(changes));
    }

    // Breaking change
    const breakingAnswer = (
      await question(rl, "是否包含 Breaking Change？(y/N): ")
    ).toLowerCase();
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
    const closesAnswer = await question(
      rl,
      "是否关联 Issue？输入编号，逗号分隔（可选）: ",
    );
    if (closesAnswer) {
      for (const n of closesAnswer
        .split(/[,\s]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n))) {
        builder.addClosesIssue(n);
      }
    }

    // Footer
    const footerAnswer = (
      await question(rl, "是否添加额外 footer？(y/N): ")
    ).toLowerCase();
    if (footerAnswer === "y" || footerAnswer === "yes")
      builder.setFooter(await question(rl, "请输入 footer 内容: "));

    // Style
    const styleAnswer = await question(
      rl,
      "选择格式 (1=conventional [默认], 2=gitmoji, 3=custom): ",
    );
    if (styleAnswer === "2") builder.style = FormatStyle.Gitmoji;
    else if (styleAnswer === "3") {
      builder.style = FormatStyle.Custom;
      builder.setTemplate(
        await question(
          rl,
          "自定义模板（含 {type}{scope}{breaking}{subject}）: ",
        ),
      );
    }

    const msg = builder.build();
    const result = new CommitValidator().validate(msg);
    if (!result.ok) {
      console.log("\n⚠️  验证警告：");
      for (const e of result.error) console.log(`  - ${e.message}`);
    }
    return msg;
  } finally {
    rl.close();
  }
}

// 20. CLI generation
interface CliGenerateOptions {
  readonly type: string;
  readonly scope: string;
  readonly subject: string;
  readonly body: string;
  readonly breaking: boolean;
  readonly footer: string;
  readonly style: FormatStyle;
}

function cliGenerate(opts: CliGenerateOptions): GeneratedMessage {
  const builder = new CommitBuilder();
  if (isCommitType(opts.type.toLowerCase()))
    builder.type = opts.type.toLowerCase() as CommitType;
  else {
    console.log(`⚠️  未知的 commit 类型: "${opts.type}"，将使用 feat。`);
    builder.type = CommitType.Feat;
  }
  builder.scope = opts.scope;
  try {
    builder.subject = opts.subject;
  } catch (e) {
    console.log(`⚠️  ${e instanceof Error ? e.message : String(e)}`);
    builder.forceSubject(opts.subject);
  }
  if (opts.body) builder.setBody(opts.body);
  builder.isBreaking = opts.breaking;
  if (opts.footer) builder.setFooter(opts.footer);
  builder.style = opts.style;
  return builder.build();
}

// 21. Display & commit execution
function displayResult(result: GeneratedMessage, shouldCommit: boolean): void {
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
    execSync(`git commit -F "${tempFile}"`, { stdio: "inherit" });
    fs.unlinkSync(tempFile);
    console.log("\n🎉 Commit 成功！");
  } catch (err) {
    console.log(
      `\n❌ Commit 失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// 22. CLI parsing
interface CliOptions {
  interactive: boolean;
  autoAnalyze: boolean;
  type: string;
  scope: string;
  message: string;
  body: string;
  breaking: boolean;
  footer: string;
  commit: boolean;
  showHistory: boolean;
  showHelp: boolean;
  style: FormatStyle;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
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
      default:
        console.log(`未知选项: ${arg}，使用 --help 查看帮助。`);
    }
    i++;
  }
  return opts;
}

// 23. Help & main
function printHelp(): void {
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

async function main(): Promise<void> {
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
      type: options.type,
      scope: options.scope,
      subject: options.message,
      body: options.body,
      breaking: options.breaking,
      footer: options.footer,
      style: options.style,
    });
    const v = new CommitValidator().validate(result);
    if (!v.ok) {
      console.log("⚠️  验证警告：");
      for (const e of v.error) console.log(`  - ${e.message}`);
    }
    displayResult(result, options.commit);
  } else {
    const shouldAutoAnalyze = options.autoAnalyze || options.interactive;
    const result = await interactiveGenerate(shouldAutoAnalyze);
    if (result) displayResult(result, options.commit);
  }
}

main().catch((err) => {
  console.error(
    `发生错误: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
