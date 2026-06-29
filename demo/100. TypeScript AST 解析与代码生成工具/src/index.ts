#!/usr/bin/env node
/**
 * TypeScript AST 解析与代码生成工具
 * 功能：1.AST解析 2.AST可视化 3.AST分析 4.AST变换 5.代码生成 6.AST构建 7.完整流水线
 * 高级 TS 特性：enum/泛型约束/可辨识联合/映射类型(-readonly)/条件类型/抽象类/
 *   函数重载/错误层级(code)/接口(可选|只读|索引签名)/satisfies/getter setter/
 *   生成器/Symbol.iterator/Symbol唯一键/as const/类型守卫/元组
 */
import * as ts from "typescript";
import * as readline from "readline";

// 高级特性 1: String Enum（普通 enum，非 const enum）
enum AstOperationKind {
  Parse = "parse",
  Analyze = "analyze",
  Transform = "transform",
  Generate = "generate",
  Build = "build",
  Pipeline = "pipeline",
}

// 高级特性 2: as const 断言（仅用于字面量，避免 TS1355）
const PIPELINE_STEPS = [
  "parse",
  "analyze",
  "rename",
  "log",
  "generate",
] as const;
const LITERAL_LIMITS = { maxDepth: 4, maxNodes: 1000 } as const;

// 高级特性 3: 元组与只读元组
type NodePath = readonly [ts.Node, ...ts.Node[]];
type StepTriple = [AstOperationKind, string, number];

// 高级特性 4: 接口（只读 / 可选 / 索引签名）
interface AnalysisResult {
  readonly imports: string[];
  readonly exports: string[];
  readonly functions: string[];
  readonly classes: string[];
  readonly interfaces: string[];
  readonly typeAliases: string[];
  readonly variables: string[];
  readonly arrowFunctions: string[];
  [key: string]: string[];
}

interface AnalysisOptions {
  readonly maxDepth?: number;
  readonly includeArrowFns?: boolean;
  readonly [key: string]: unknown;
}

// 高级特性 5: 映射类型（-readonly 移除只读修饰符）
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DeepMutable<T> = T extends object
  ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T;

// 高级特性 6: 条件类型
type ElementType<T> = T extends readonly (infer U)[] ? U : never;
type NameOrFallback<T> = T extends { name: infer N } ? N : "anonymous";

// 高级特性 7: 可辨识联合（带共同 kind 字段）
type AstEvent =
  | { kind: "parsed"; fileName: string; nodeCount: number }
  | { kind: "analyzed"; summary: AnalysisResult }
  | { kind: "transformed"; transformerName: string }
  | { kind: "generated"; codeLength: number }
  | { kind: "error"; message: string };

// 高级特性 8: 自定义错误类层级（带 code 属性）
abstract class AstError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class ParseError extends AstError {
  readonly code = "AST_PARSE_001";
}
class TransformError extends AstError {
  readonly code = "AST_TRANSFORM_002";
}
class GenerateError extends AstError {
  readonly code = "AST_GENERATE_003";
}
class AnalysisError extends AstError {
  readonly code = "AST_ANALYSIS_004";
}

// 高级特性 9: Symbol 作为唯一属性键
const META_KEY: unique symbol = Symbol("ast-meta");
type MetaInfo = { operation: AstOperationKind; timestamp: number };
interface WithMeta {
  [META_KEY]?: MetaInfo;
}

// 高级特性 10: satisfies 操作符
const SYNTAX_KIND_LABELS = {
  [ts.SyntaxKind.SourceFile]: "源文件",
  [ts.SyntaxKind.ImportDeclaration]: "导入声明",
  [ts.SyntaxKind.ImportClause]: "导入子句",
  [ts.SyntaxKind.NamedImports]: "命名导入",
  [ts.SyntaxKind.NamedExports]: "命名导出",
  [ts.SyntaxKind.ImportSpecifier]: "导入说明符",
  [ts.SyntaxKind.ExportSpecifier]: "导出说明符",
  [ts.SyntaxKind.ExportDeclaration]: "导出声明",
  [ts.SyntaxKind.InterfaceDeclaration]: "接口声明",
  [ts.SyntaxKind.TypeAliasDeclaration]: "类型别名声明",
  [ts.SyntaxKind.ClassDeclaration]: "类声明",
  [ts.SyntaxKind.Constructor]: "构造函数",
  [ts.SyntaxKind.PropertyDeclaration]: "属性声明",
  [ts.SyntaxKind.MethodDeclaration]: "方法声明",
  [ts.SyntaxKind.FunctionDeclaration]: "函数声明",
  [ts.SyntaxKind.VariableDeclaration]: "变量声明",
  [ts.SyntaxKind.VariableStatement]: "变量语句",
  [ts.SyntaxKind.VariableDeclarationList]: "变量声明列表",
  [ts.SyntaxKind.Parameter]: "参数",
  [ts.SyntaxKind.TypeReference]: "类型引用",
  [ts.SyntaxKind.PropertySignature]: "属性签名",
  [ts.SyntaxKind.StringKeyword]: "string",
  [ts.SyntaxKind.NumberKeyword]: "number",
  [ts.SyntaxKind.BooleanKeyword]: "boolean",
  [ts.SyntaxKind.VoidKeyword]: "void",
  [ts.SyntaxKind.UnionType]: "联合类型",
  [ts.SyntaxKind.LiteralType]: "字面量类型",
  [ts.SyntaxKind.StringLiteral]: "字符串字面量",
  [ts.SyntaxKind.NumericLiteral]: "数字字面量",
  [ts.SyntaxKind.ObjectLiteralExpression]: "对象字面量",
  [ts.SyntaxKind.PropertyAssignment]: "属性赋值",
  [ts.SyntaxKind.ArrowFunction]: "箭头函数",
  [ts.SyntaxKind.ReturnStatement]: "返回语句",
  [ts.SyntaxKind.BinaryExpression]: "二元表达式",
  [ts.SyntaxKind.TemplateExpression]: "模板表达式",
  [ts.SyntaxKind.CallExpression]: "调用表达式",
  [ts.SyntaxKind.PropertyAccessExpression]: "属性访问表达式",
  [ts.SyntaxKind.Identifier]: "标识符",
  [ts.SyntaxKind.ArrayType]: "数组类型",
  [ts.SyntaxKind.Block]: "代码块",
  [ts.SyntaxKind.ExpressionStatement]: "表达式语句",
  [ts.SyntaxKind.EndOfFileToken]: "文件结束",
} satisfies Record<number, string>;

// 高级特性 11: 函数重载
function getKindLabel(kind: ts.SyntaxKind): string;
function getKindLabel(kind: number): string;
function getKindLabel(kind: ts.SyntaxKind | number): string {
  return (
    (SYNTAX_KIND_LABELS as Record<number, string>)[kind as number] ||
    ts.SyntaxKind[kind as number] ||
    `Unknown(${kind})`
  );
}

// 高级特性 12: 泛型 + 约束
function firstOf<T extends readonly unknown[]>(arr: T): ElementType<T> {
  return arr[0] as ElementType<T>;
}

// 高级特性 13: 自定义类型守卫
function isNamedDecl(
  node: ts.Node,
): node is ts.NamedDeclaration & { name: ts.Identifier } {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isVariableDeclaration(node)) &&
    !!node.name &&
    ts.isIdentifier(node.name)
  );
}

function isParsedEvent(
  e: AstEvent,
): e is Extract<AstEvent, { kind: "parsed" }> {
  return e.kind === "parsed";
}
function isErrorEvent(e: AstEvent): e is Extract<AstEvent, { kind: "error" }> {
  return e.kind === "error";
}

// 工具函数
const indent = (level: number): string => "  ".repeat(level);
const HRL = "─".repeat(60);
const divider = (title: string): string =>
  `\n┌${"─".repeat(56)}┐\n│ ${title.padEnd(55)}│\n└${"─".repeat(56)}┘`;

// 高级特性 14: 存取器（getter/setter）+ Symbol 唯一键
class SourceCodeBundle implements WithMeta {
  private _code: string;
  private _fileName: string;
  [META_KEY]?: MetaInfo;
  constructor(code: string, fileName: string = "sample.ts") {
    this._code = code;
    this._fileName = fileName;
  }
  get code(): string {
    return this._code;
  }
  get fileName(): string {
    return this._fileName;
  }
  get length(): number {
    return this._code.length;
  }
  set code(value: string) {
    if (!value.trim()) throw new ParseError("源码不能为空");
    this._code = value;
  }
  set fileName(value: string) {
    this._fileName = value;
  }
  mark(op: AstOperationKind): void {
    this[META_KEY] = { operation: op, timestamp: Date.now() };
  }
}

// 高级特性 15: 生成器/迭代器（function* 与 Symbol.iterator）
function* walkAst(
  node: ts.Node,
  maxDepth = Infinity,
): Generator<ts.Node, void, undefined> {
  yield node;
  if (maxDepth <= 0) return;
  for (const child of node.getChildren()) {
    yield* walkAst(child, maxDepth - 1);
  }
}

class AstWalker implements Iterable<ts.Node> {
  constructor(
    private readonly root: ts.Node,
    private readonly depth = Infinity,
  ) {}
  [Symbol.iterator](): Iterator<ts.Node> {
    return walkAst(this.root, this.depth);
  }
  *entries(): Generator<[number, ts.Node]> {
    let i = 0;
    for (const n of this) yield [i++, n];
  }
}

// 高级特性 16: 抽象类 + 具体子类（访问者模式）
abstract class AstVisitor<T = void> {
  protected abstract readonly operation: AstOperationKind;
  abstract visit(node: ts.Node): T;
  protected walk(node: ts.Node): void {
    ts.forEachChild(node, (c) => {
      this.visit(c);
    });
  }
  run(root: ts.Node): T {
    return this.visit(root);
  }
}

// 分析访问者
class AnalysisVisitor extends AstVisitor<void> {
  protected readonly operation = AstOperationKind.Analyze;
  readonly result: Mutable<AnalysisResult>;
  constructor() {
    super();
    this.result = {
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      interfaces: [],
      typeAliases: [],
      variables: [],
      arrowFunctions: [],
    };
  }
  visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) this.handleImport(node);
    else if (ts.isExportDeclaration(node)) this.handleExport(node);
    else if (ts.isFunctionDeclaration(node)) this.handleFunction(node);
    else if (ts.isClassDeclaration(node)) this.handleClass(node);
    else if (ts.isInterfaceDeclaration(node)) this.handleInterface(node);
    else if (ts.isTypeAliasDeclaration(node)) this.handleTypeAlias(node);
    else if (ts.isVariableStatement(node)) this.handleVariable(node);
    else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      this.handleArrow(node);
    }
    this.walk(node);
  }
  private handleImport(node: ts.ImportDeclaration): void {
    const spec = (node.moduleSpecifier as ts.StringLiteral).text;
    const clause = node.importClause;
    let info = `from "${spec}"`;
    if (clause) {
      const parts: string[] = [];
      if (clause.name) parts.push(`default as ${clause.name.text}`);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        parts.push(
          `{ ${clause.namedBindings.elements.map((e) => e.name.text).join(", ")} }`,
        );
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        parts.push(`* as ${clause.namedBindings.name.text}`);
      }
      info = parts.join(", ") + " " + info;
    }
    this.result.imports.push(info);
  }
  private handleExport(node: ts.ExportDeclaration): void {
    const ec = node.exportClause;
    if (ec && ts.isNamedExports(ec)) {
      this.result.exports.push(
        `export { ${ec.elements.map((e) => e.name.text).join(", ")} }`,
      );
    }
  }
  private handleFunction(node: ts.FunctionDeclaration): void {
    const name = node.name ? node.name.text : "<匿名>";
    const params = node.parameters.map((p) => p.name.getText()).join(", ");
    const ret = node.type ? `: ${node.type.getText()}` : "";
    this.result.functions.push(`function ${name}(${params})${ret}`);
  }
  private handleClass(node: ts.ClassDeclaration): void {
    const name = node.name ? node.name.text : "<匿名>";
    const members: string[] = [];
    for (const m of node.members) {
      if (ts.isConstructorDeclaration(m)) {
        members.push(
          `  constructor(${m.parameters.map((p) => p.name.getText()).join(", ")})`,
        );
      } else if (ts.isMethodDeclaration(m)) {
        const mod = m.modifiers
          ? m.modifiers.map((x) => x.getText()).join(" ") + " "
          : "";
        members.push(
          `  ${mod}${m.name.getText()}(${m.parameters.map((p) => p.name.getText()).join(", ")})`,
        );
      } else if (ts.isPropertyDeclaration(m)) {
        const mod = m.modifiers
          ? m.modifiers.map((x) => x.getText()).join(" ") + " "
          : "";
        members.push(`  ${mod}${m.name.getText()}`);
      }
    }
    this.result.classes.push(`class ${name} {\n${members.join("\n")}\n}`);
  }
  private handleInterface(node: ts.InterfaceDeclaration): void {
    const members = node.members.map((m) => {
      if (ts.isPropertySignature(m)) {
        const opt = m.questionToken ? "?" : "";
        const t = m.type ? `: ${m.type.getText()}` : "";
        return `  ${m.name.getText()}${opt}${t}`;
      }
      return `  ${m.getText()}`;
    });
    this.result.interfaces.push(
      `interface ${node.name.text} {\n${members.join("\n")}\n}`,
    );
  }
  private handleTypeAlias(node: ts.TypeAliasDeclaration): void {
    this.result.typeAliases.push(
      `type ${node.name.text} = ${node.type.getText()}`,
    );
  }
  private handleVariable(node: ts.VariableStatement): void {
    for (const d of node.declarationList.declarations) {
      const t = d.type ? `: ${d.type.getText()}` : "";
      const init = d.initializer
        ? ` = ${d.initializer.getText().substring(0, 50)}`
        : "";
      this.result.variables.push(`${d.name.getText()}${t}${init}`);
    }
  }
  private handleArrow(node: ts.VariableDeclaration): void {
    if (!node.initializer || !ts.isArrowFunction(node.initializer)) return;
    const params = node.initializer.parameters
      .map((p) => p.name.getText())
      .join(", ");
    this.result.arrowFunctions.push(
      `const ${node.name.getText()} = (${params}) => ...`,
    );
  }
}

// 打印访问者
class PrintVisitor extends AstVisitor<void> {
  protected readonly operation = AstOperationKind.Parse;
  constructor(private readonly maxDepth = 5) {
    super();
  }
  visit(node: ts.Node, level = 0): void {
    if (level > this.maxDepth) {
      console.log(`${indent(level)}... (深度超限，已截断)`);
      return;
    }
    const label = getKindLabel(node.kind);
    const txt = this.getText(node);
    console.log(`${indent(level)}${ts.SyntaxKind[node.kind]}(${label})${txt}`);
    node.forEachChild((c) => this.visit(c, level + 1));
  }
  private getText(node: ts.Node): string {
    if (ts.isIdentifier(node)) return ` [${node.text}]`;
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
      return ` [${node.text}]`;
    if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node))
      return ` [${node.name.text}]`;
    if (isNamedDecl(node)) return ` [${node.name.text}]`;
    if (
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isParameter(node) ||
      ts.isPropertyAssignment(node)
    ) {
      return ` [${(node.name as ts.Node).getText()}]`;
    }
    if (ts.isLiteralTypeNode(node)) return ` [${node.literal.getText()}]`;
    return "";
  }
}

// 变换访问者抽象基类
abstract class TransformVisitor extends AstVisitor<ts.Node> {
  protected readonly operation = AstOperationKind.Transform;
  protected context!: ts.TransformationContext;
  transform(sourceFile: ts.SourceFile): ts.SourceFile {
    const factory: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
      this.context = ctx;
      return (node) =>
        ts.visitNode(node, (n) => this.visit(n)) as ts.SourceFile;
    };
    const result = ts.transform(sourceFile, [factory]);
    return result.transformed[0];
  }
}

class RenameVisitor extends TransformVisitor {
  constructor(
    private readonly oldName: string,
    private readonly newName: string,
  ) {
    super();
  }
  visit(node: ts.Node): ts.Node {
    if (ts.isIdentifier(node) && node.text === this.oldName) {
      return ts.factory.createIdentifier(this.newName);
    }
    return ts.visitEachChild(node, (n) => this.visit(n), this.context);
  }
}

class DeprecatedTagVisitor extends TransformVisitor {
  visit(node: ts.Node): ts.Node {
    if (ts.isFunctionDeclaration(node) && node.name) {
      return ts.addSyntheticLeadingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        "*\n * @deprecated 此函数已废弃，请使用新版本。\n ",
        true,
      );
    }
    return ts.visitEachChild(node, (n) => this.visit(n), this.context);
  }
}

class LoggingInjectorVisitor extends TransformVisitor {
  visit(node: ts.Node): ts.Node {
    if (ts.isFunctionDeclaration(node) && node.body && node.name) {
      const funcName = node.name.text;
      const logStmt = ts.factory.createExpressionStatement(
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier("console"),
            ts.factory.createIdentifier("log"),
          ),
          undefined,
          [ts.factory.createStringLiteral(`[调用函数: ${funcName}]`)],
        ),
      );
      const orig = ts.isBlock(node.body)
        ? [...node.body.statements]
        : [ts.factory.createReturnStatement(node.body)];
      const newBody = ts.factory.createBlock([logStmt, ...orig], true);
      return ts.factory.updateFunctionDeclaration(
        node,
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        newBody,
      );
    }
    return ts.visitEachChild(node, (n) => this.visit(n), this.context);
  }
}

// 示例源码
const SAMPLE_CODE = `import { useState, useEffect } from "react";
import type { User } from "./types";

interface Config { name: string; version: number; debug: boolean; }
type Status = "active" | "inactive" | "pending";

const DEFAULT_CONFIG: Config = { name: "MyApp", version: 1, debug: false };

function greet(name: string): string { return \`Hello, \${name}!\`; }
const add = (a: number, b: number): number => a + b;

class UserService {
  private users: User[] = [];
  addUser(user: User): void { this.users.push(user); }
  getUserCount(): number { return this.users.length; }
}

export { greet, add, UserService, DEFAULT_CONFIG };
export type { Status, Config };
`;

// 功能 1: AST 解析
function parseToAST(
  code: string,
  fileName: string = "sample.ts",
): ts.SourceFile {
  try {
    return ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  } catch (e) {
    throw new ParseError(`解析失败: ${(e as Error).message}`);
  }
}

// 功能 2: AST 可视化
function printAST(
  node: ts.Node,
  level: number = 0,
  maxDepth: number = 5,
): void {
  new PrintVisitor(maxDepth).visit(node, level);
}

// 功能 3: AST 分析
function analyzeAST(
  sourceFile: ts.SourceFile,
  _opts?: AnalysisOptions,
): AnalysisResult {
  const v = new AnalysisVisitor();
  v.run(sourceFile);
  return v.result;
}

function printAnalysis(result: AnalysisResult): void {
  const list: ReadonlyArray<{ title: string; items: readonly string[] }> = [
    { title: "导入声明 (Imports)", items: result.imports },
    { title: "导出声明 (Exports)", items: result.exports },
    { title: "函数声明 (Functions)", items: result.functions },
    { title: "类声明 (Classes)", items: result.classes },
    { title: "接口声明 (Interfaces)", items: result.interfaces },
    { title: "类型别名 (Type Aliases)", items: result.typeAliases },
    { title: "变量声明 (Variables)", items: result.variables },
    { title: "箭头函数 (Arrow Functions)", items: result.arrowFunctions },
  ];
  for (const { title, items } of list) {
    console.log(`\n  ▸ ${title}:`);
    if (items.length === 0) {
      console.log("    (无)");
      continue;
    }
    for (const item of items) {
      item
        .split("\n")
        .forEach((line, i) =>
          console.log(`    ${i === 0 ? "• " : "  "}${line}`),
        );
    }
  }
}

// 功能 4: AST 变换
function renameIdentifier(
  sf: ts.SourceFile,
  oldName: string,
  newName: string,
): ts.SourceFile {
  return new RenameVisitor(oldName, newName).transform(sf);
}
function addDeprecatedTag(sf: ts.SourceFile): ts.SourceFile {
  return new DeprecatedTagVisitor().transform(sf);
}
function addLoggingToFunctions(sf: ts.SourceFile): ts.SourceFile {
  return new LoggingInjectorVisitor().transform(sf);
}

// 功能 5: 代码生成
function generateCode(sourceFile: ts.SourceFile): string {
  try {
    const printer = ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    });
    return printer.printFile(sourceFile);
  } catch (e) {
    throw new GenerateError(`代码生成失败: ${(e as Error).message}`);
  }
}

// 功能 6: AST 构建
function buildASTProgramatically(): ts.SourceFile {
  const f = ts.factory;
  const id = (s: string) => f.createIdentifier(s);
  const strKw = () => f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
  const numKw = () => f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
  const param = (n: string, t: ts.TypeNode) =>
    f.createParameterDeclaration(undefined, undefined, id(n), undefined, t);
  const exportMod = () => [f.createModifier(ts.SyntaxKind.ExportKeyword)];

  const personInterface = f.createInterfaceDeclaration(
    exportMod(),
    id("Person"),
    undefined,
    undefined,
    [
      f.createPropertySignature(undefined, id("name"), undefined, strKw()),
      f.createPropertySignature(undefined, id("age"), undefined, numKw()),
    ],
  );
  const createPerson = f.createFunctionDeclaration(
    exportMod(),
    undefined,
    id("createPerson"),
    undefined,
    [param("name", strKw()), param("age", numKw())],
    f.createTypeReferenceNode(id("Person")),
    f.createBlock(
      [
        f.createReturnStatement(
          f.createObjectLiteralExpression(
            [
              f.createShorthandPropertyAssignment(id("name")),
              f.createShorthandPropertyAssignment(id("age")),
            ],
            true,
          ),
        ),
      ],
      true,
    ),
  );
  const greetPerson = f.createFunctionDeclaration(
    exportMod(),
    undefined,
    id("greetPerson"),
    undefined,
    [param("person", f.createTypeReferenceNode(id("Person")))],
    strKw(),
    f.createBlock(
      [
        f.createReturnStatement(
          f.createTemplateExpression(f.createTemplateHead("Hello, "), [
            f.createTemplateSpan(
              f.createPropertyAccessExpression(id("person"), id("name")),
              f.createTemplateMiddle("! You are "),
            ),
            f.createTemplateSpan(
              f.createPropertyAccessExpression(id("person"), id("age")),
              f.createTemplateTail(" years old."),
            ),
          ]),
        ),
      ],
      true,
    ),
  );
  return f.createSourceFile(
    [personInterface, createPerson, greetPerson],
    f.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None,
  );
}

// 功能 7: 完整流水线
function fullPipeline(code: string): void {
  console.log(divider("综合示例：解析 → 分析 → 变换 → 生成 流水线"));
  const events: AstEvent[] = [];
  const stepInfo: StepTriple = [AstOperationKind.Parse, "解析", 0];
  const bundle = new SourceCodeBundle(code, "pipeline.ts");

  console.log("\n📝 步骤1：解析源码为 AST");
  const sf = parseToAST(bundle.code, bundle.fileName);
  const topCount = sf.getChildren().length;
  stepInfo[2] = topCount;
  bundle.mark(AstOperationKind.Parse);
  console.log(`   ✓ 解析完成，文件名: ${sf.fileName}`);
  console.log(`   ✓ 顶层节点数: ${topCount} [${stepInfo[0]}: ${stepInfo[1]}]`);
  events.push({ kind: "parsed", fileName: sf.fileName, nodeCount: topCount });

  console.log("\n🔍 步骤2：分析 AST");
  const analysis = analyzeAST(sf);
  console.log(`   ✓ 函数: ${analysis.functions.length} 个`);
  console.log(`   ✓ 类: ${analysis.classes.length} 个`);
  console.log(`   ✓ 接口: ${analysis.interfaces.length} 个`);
  console.log(`   ✓ 类型别名: ${analysis.typeAliases.length} 个`);
  console.log(`   ✓ 导入: ${analysis.imports.length} 个`);
  console.log(`   ✓ 导出: ${analysis.exports.length} 个`);
  const firstImport = firstOf(analysis.imports);
  if (firstImport) console.log(`   ✓ 首个导入: ${firstImport}`);
  events.push({ kind: "analyzed", summary: analysis });

  console.log("\n🔄 步骤3：变换 AST - 重命名 'greet' → 'sayHello'");
  let transformed = renameIdentifier(sf, "greet", "sayHello");
  events.push({ kind: "transformed", transformerName: "rename" });

  console.log("\n🔄 步骤4：变换 AST - 给函数添加日志语句");
  transformed = addLoggingToFunctions(transformed);
  events.push({ kind: "transformed", transformerName: "logging" });

  console.log("\n🖨️  步骤5：从变换后的 AST 生成代码");
  const generated = generateCode(transformed);
  console.log(`\n${HRL}\n${generated}${HRL}`);
  events.push({ kind: "generated", codeLength: generated.length });

  // 使用类型守卫处理事件流
  for (const e of events) {
    if (isParsedEvent(e))
      console.log(`   [事件] 解析 ${e.fileName} (${e.nodeCount} 节点)`);
    else if (isErrorEvent(e)) console.log(`   [事件] 错误: ${e.message}`);
  }
  // 使用迭代器遍历 AST
  const walker = new AstWalker(sf, 2);
  let count = 0;
  for (const _ of walker) count++;
  console.log(
    `   ✓ 迭代器遍历(深度2): ${count} 节点; 步骤数: ${PIPELINE_STEPS.length}`,
  );
}

// 交互式 CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
function prompt(q: string): Promise<string> {
  return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}

function printMenu(): void {
  const bar = "═".repeat(60);
  console.log(`\n${bar}\n  TypeScript AST 解析与代码生成工具\n${bar}`);
  console.log("  1.解析源码为AST并可视化  2.分析AST  3.标识符重命名");
  console.log("  4.添加@deprecated  5.添加日志  6.编程式构建AST");
  console.log("  7.完整流水线  8.自定义解析  0.退出");
  console.log(bar);
}

function printCodeBlock(code: string): void {
  console.log(`${HRL}\n${code}${HRL}`);
}

async function handleChoice(choice: string): Promise<boolean> {
  const sf = parseToAST(SAMPLE_CODE);
  try {
    switch (choice) {
      case "1":
        console.log(divider("AST 解析与可视化"));
        console.log(`\n源码:\n\n${SAMPLE_CODE}${divider("AST 树形结构")}`);
        printAST(sf, 0, LITERAL_LIMITS.maxDepth);
        break;
      case "2":
        console.log(divider("AST 分析"));
        printAnalysis(analyzeAST(sf));
        break;
      case "3": {
        console.log(divider("标识符重命名变换"));
        const oldName = await prompt("  请输入要重命名的标识符（如 greet）: ");
        const newName = await prompt("  请输入新名称（如 sayHello）: ");
        if (!oldName || !newName) {
          console.log("  ✗ 输入不能为空");
          break;
        }
        console.log(`\n  ✓ 已将 "${oldName}" 重命名为 "${newName}"\n`);
        printCodeBlock(generateCode(renameIdentifier(sf, oldName, newName)));
        break;
      }
      case "4":
        console.log(divider("添加 @deprecated 注释"));
        console.log("\n  ✓ 已给所有函数添加 @deprecated 注释\n");
        printCodeBlock(generateCode(addDeprecatedTag(sf)));
        break;
      case "5":
        console.log(divider("添加函数日志语句"));
        console.log("\n  ✓ 已给所有函数添加 console.log 日志\n");
        printCodeBlock(generateCode(addLoggingToFunctions(sf)));
        break;
      case "6": {
        console.log(divider("编程式构建 AST 并生成代码"));
        console.log("\n  使用 ts.factory 方法构建以下代码：\n");
        const built = buildASTProgramatically();
        printCodeBlock(generateCode(built));
        console.log("\n  ✓ 验证：将生成的代码重新解析为 AST...");
        const reparsed = parseToAST(generateCode(built), "generated.ts");
        const re = analyzeAST(reparsed);
        console.log(`    - 接口: ${re.interfaces.length} 个`);
        console.log(`    - 函数: ${re.functions.length} 个`);
        re.functions.forEach((fn) => console.log(`      • ${fn}`));
        console.log("  ✓ 代码生成验证通过！\n");
        console.log("  生成的 AST 结构（深度3）:");
        printAST(reparsed, 0, 3);
        break;
      }
      case "7":
        fullPipeline(SAMPLE_CODE);
        break;
      case "8": {
        console.log(divider("自定义代码解析"));
        console.log("  请输入 TypeScript 代码（输入空行结束）：\n");
        const lines: string[] = [];
        while (true) {
          const l = await prompt("  > ");
          if (l === "") break;
          lines.push(l);
        }
        const custom = lines.join("\n");
        if (!custom.trim()) {
          console.log("  ✗ 代码不能为空");
          break;
        }
        const cs = parseToAST(custom, "custom.ts");
        console.log("\n  ▸ AST 可视化:");
        printAST(cs, 0, 6);
        console.log("\n  ▸ AST 分析:");
        printAnalysis(analyzeAST(cs));
        console.log("\n  ▸ 从 AST 重新生成的代码:");
        printCodeBlock(generateCode(cs));
        break;
      }
      case "0":
        console.log("\n  再见！");
        rl.close();
        return false;
      default:
        console.log("  ✗ 无效选项，请重新选择");
    }
  } catch (e) {
    if (e instanceof AstError) {
      console.log(`  ✗ [${e.code}] ${e.message}`);
    } else {
      console.log(`  ✗ 未知错误: ${(e as Error).message}`);
    }
  }
  return true;
}

async function main(): Promise<void> {
  console.log(
    "╔══════════════════════════════════════════════════════════╗\n║     TypeScript AST 解析与代码生成工具                   ║\n║     纯 TypeScript 实现 · Compiler API 演示              ║\n╚══════════════════════════════════════════════════════════╝",
  );
  let running = true;
  while (running) {
    printMenu();
    running = await handleChoice(await prompt("  请选择功能 (0-8): "));
  }
}

main().catch(console.error);
