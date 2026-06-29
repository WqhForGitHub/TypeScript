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
 * TypeScript AST 解析与代码生成工具
 * 功能：1.AST解析 2.AST可视化 3.AST分析 4.AST变换 5.代码生成 6.AST构建 7.完整流水线
 * 高级 TS 特性：enum/泛型约束/可辨识联合/映射类型(-readonly)/条件类型/抽象类/
 *   函数重载/错误层级(code)/接口(可选|只读|索引签名)/satisfies/getter setter/
 *   生成器/Symbol.iterator/Symbol唯一键/as const/类型守卫/元组
 */
const ts = __importStar(require("typescript"));
const readline = __importStar(require("readline"));
// 高级特性 1: String Enum（普通 enum，非 const enum）
var AstOperationKind;
(function (AstOperationKind) {
    AstOperationKind["Parse"] = "parse";
    AstOperationKind["Analyze"] = "analyze";
    AstOperationKind["Transform"] = "transform";
    AstOperationKind["Generate"] = "generate";
    AstOperationKind["Build"] = "build";
    AstOperationKind["Pipeline"] = "pipeline";
})(AstOperationKind || (AstOperationKind = {}));
// 高级特性 2: as const 断言（仅用于字面量，避免 TS1355）
const PIPELINE_STEPS = ["parse", "analyze", "rename", "log", "generate"];
const LITERAL_LIMITS = { maxDepth: 4, maxNodes: 1000 };
// 高级特性 8: 自定义错误类层级（带 code 属性）
class AstError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
class ParseError extends AstError {
    constructor() {
        super(...arguments);
        this.code = "AST_PARSE_001";
    }
}
class TransformError extends AstError {
    constructor() {
        super(...arguments);
        this.code = "AST_TRANSFORM_002";
    }
}
class GenerateError extends AstError {
    constructor() {
        super(...arguments);
        this.code = "AST_GENERATE_003";
    }
}
class AnalysisError extends AstError {
    constructor() {
        super(...arguments);
        this.code = "AST_ANALYSIS_004";
    }
}
// 高级特性 9: Symbol 作为唯一属性键
const META_KEY = Symbol("ast-meta");
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
};
function getKindLabel(kind) {
    return (SYNTAX_KIND_LABELS[kind] ||
        ts.SyntaxKind[kind] ||
        `Unknown(${kind})`);
}
// 高级特性 12: 泛型 + 约束
function firstOf(arr) {
    return arr[0];
}
// 高级特性 13: 自定义类型守卫
function isNamedDecl(node) {
    return ((ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
        !!node.name &&
        ts.isIdentifier(node.name));
}
function isParsedEvent(e) {
    return e.kind === "parsed";
}
function isErrorEvent(e) {
    return e.kind === "error";
}
// 工具函数
const indent = (level) => "  ".repeat(level);
const HRL = "─".repeat(60);
const divider = (title) => `\n┌${"─".repeat(56)}┐\n│ ${title.padEnd(55)}│\n└${"─".repeat(56)}┘`;
// 高级特性 14: 存取器（getter/setter）+ Symbol 唯一键
class SourceCodeBundle {
    constructor(code, fileName = "sample.ts") {
        this._code = code;
        this._fileName = fileName;
    }
    get code() { return this._code; }
    get fileName() { return this._fileName; }
    get length() { return this._code.length; }
    set code(value) {
        if (!value.trim())
            throw new ParseError("源码不能为空");
        this._code = value;
    }
    set fileName(value) { this._fileName = value; }
    mark(op) {
        this[META_KEY] = { operation: op, timestamp: Date.now() };
    }
}
// 高级特性 15: 生成器/迭代器（function* 与 Symbol.iterator）
function* walkAst(node, maxDepth = Infinity) {
    yield node;
    if (maxDepth <= 0)
        return;
    for (const child of node.getChildren()) {
        yield* walkAst(child, maxDepth - 1);
    }
}
class AstWalker {
    constructor(root, depth = Infinity) {
        this.root = root;
        this.depth = depth;
    }
    [Symbol.iterator]() {
        return walkAst(this.root, this.depth);
    }
    *entries() {
        let i = 0;
        for (const n of this)
            yield [i++, n];
    }
}
// 高级特性 16: 抽象类 + 具体子类（访问者模式）
class AstVisitor {
    walk(node) {
        ts.forEachChild(node, (c) => { this.visit(c); });
    }
    run(root) { return this.visit(root); }
}
// 分析访问者
class AnalysisVisitor extends AstVisitor {
    constructor() {
        super();
        this.operation = AstOperationKind.Analyze;
        this.result = {
            imports: [], exports: [], functions: [], classes: [],
            interfaces: [], typeAliases: [], variables: [], arrowFunctions: [],
        };
    }
    visit(node) {
        if (ts.isImportDeclaration(node))
            this.handleImport(node);
        else if (ts.isExportDeclaration(node))
            this.handleExport(node);
        else if (ts.isFunctionDeclaration(node))
            this.handleFunction(node);
        else if (ts.isClassDeclaration(node))
            this.handleClass(node);
        else if (ts.isInterfaceDeclaration(node))
            this.handleInterface(node);
        else if (ts.isTypeAliasDeclaration(node))
            this.handleTypeAlias(node);
        else if (ts.isVariableStatement(node))
            this.handleVariable(node);
        else if (ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isArrowFunction(node.initializer)) {
            this.handleArrow(node);
        }
        this.walk(node);
    }
    handleImport(node) {
        const spec = node.moduleSpecifier.text;
        const clause = node.importClause;
        let info = `from "${spec}"`;
        if (clause) {
            const parts = [];
            if (clause.name)
                parts.push(`default as ${clause.name.text}`);
            if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                parts.push(`{ ${clause.namedBindings.elements.map((e) => e.name.text).join(", ")} }`);
            }
            if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
                parts.push(`* as ${clause.namedBindings.name.text}`);
            }
            info = parts.join(", ") + " " + info;
        }
        this.result.imports.push(info);
    }
    handleExport(node) {
        const ec = node.exportClause;
        if (ec && ts.isNamedExports(ec)) {
            this.result.exports.push(`export { ${ec.elements.map((e) => e.name.text).join(", ")} }`);
        }
    }
    handleFunction(node) {
        const name = node.name ? node.name.text : "<匿名>";
        const params = node.parameters.map((p) => p.name.getText()).join(", ");
        const ret = node.type ? `: ${node.type.getText()}` : "";
        this.result.functions.push(`function ${name}(${params})${ret}`);
    }
    handleClass(node) {
        const name = node.name ? node.name.text : "<匿名>";
        const members = [];
        for (const m of node.members) {
            if (ts.isConstructorDeclaration(m)) {
                members.push(`  constructor(${m.parameters.map((p) => p.name.getText()).join(", ")})`);
            }
            else if (ts.isMethodDeclaration(m)) {
                const mod = m.modifiers ? m.modifiers.map((x) => x.getText()).join(" ") + " " : "";
                members.push(`  ${mod}${m.name.getText()}(${m.parameters.map((p) => p.name.getText()).join(", ")})`);
            }
            else if (ts.isPropertyDeclaration(m)) {
                const mod = m.modifiers ? m.modifiers.map((x) => x.getText()).join(" ") + " " : "";
                members.push(`  ${mod}${m.name.getText()}`);
            }
        }
        this.result.classes.push(`class ${name} {\n${members.join("\n")}\n}`);
    }
    handleInterface(node) {
        const members = node.members.map((m) => {
            if (ts.isPropertySignature(m)) {
                const opt = m.questionToken ? "?" : "";
                const t = m.type ? `: ${m.type.getText()}` : "";
                return `  ${m.name.getText()}${opt}${t}`;
            }
            return `  ${m.getText()}`;
        });
        this.result.interfaces.push(`interface ${node.name.text} {\n${members.join("\n")}\n}`);
    }
    handleTypeAlias(node) {
        this.result.typeAliases.push(`type ${node.name.text} = ${node.type.getText()}`);
    }
    handleVariable(node) {
        for (const d of node.declarationList.declarations) {
            const t = d.type ? `: ${d.type.getText()}` : "";
            const init = d.initializer ? ` = ${d.initializer.getText().substring(0, 50)}` : "";
            this.result.variables.push(`${d.name.getText()}${t}${init}`);
        }
    }
    handleArrow(node) {
        if (!node.initializer || !ts.isArrowFunction(node.initializer))
            return;
        const params = node.initializer.parameters.map((p) => p.name.getText()).join(", ");
        this.result.arrowFunctions.push(`const ${node.name.getText()} = (${params}) => ...`);
    }
}
// 打印访问者
class PrintVisitor extends AstVisitor {
    constructor(maxDepth = 5) {
        super();
        this.maxDepth = maxDepth;
        this.operation = AstOperationKind.Parse;
    }
    visit(node, level = 0) {
        if (level > this.maxDepth) {
            console.log(`${indent(level)}... (深度超限，已截断)`);
            return;
        }
        const label = getKindLabel(node.kind);
        const txt = this.getText(node);
        console.log(`${indent(level)}${ts.SyntaxKind[node.kind]}(${label})${txt}`);
        node.forEachChild((c) => this.visit(c, level + 1));
    }
    getText(node) {
        if (ts.isIdentifier(node))
            return ` [${node.text}]`;
        if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
            return ` [${node.text}]`;
        if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node))
            return ` [${node.name.text}]`;
        if (isNamedDecl(node))
            return ` [${node.name.text}]`;
        if (ts.isMethodDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isPropertySignature(node) ||
            ts.isParameter(node) ||
            ts.isPropertyAssignment(node)) {
            return ` [${node.name.getText()}]`;
        }
        if (ts.isLiteralTypeNode(node))
            return ` [${node.literal.getText()}]`;
        return "";
    }
}
// 变换访问者抽象基类
class TransformVisitor extends AstVisitor {
    constructor() {
        super(...arguments);
        this.operation = AstOperationKind.Transform;
    }
    transform(sourceFile) {
        const factory = (ctx) => {
            this.context = ctx;
            return (node) => ts.visitNode(node, (n) => this.visit(n));
        };
        const result = ts.transform(sourceFile, [factory]);
        return result.transformed[0];
    }
}
class RenameVisitor extends TransformVisitor {
    constructor(oldName, newName) {
        super();
        this.oldName = oldName;
        this.newName = newName;
    }
    visit(node) {
        if (ts.isIdentifier(node) && node.text === this.oldName) {
            return ts.factory.createIdentifier(this.newName);
        }
        return ts.visitEachChild(node, (n) => this.visit(n), this.context);
    }
}
class DeprecatedTagVisitor extends TransformVisitor {
    visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name) {
            return ts.addSyntheticLeadingComment(node, ts.SyntaxKind.MultiLineCommentTrivia, "*\n * @deprecated 此函数已废弃，请使用新版本。\n ", true);
        }
        return ts.visitEachChild(node, (n) => this.visit(n), this.context);
    }
}
class LoggingInjectorVisitor extends TransformVisitor {
    visit(node) {
        if (ts.isFunctionDeclaration(node) && node.body && node.name) {
            const funcName = node.name.text;
            const logStmt = ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("console"), ts.factory.createIdentifier("log")), undefined, [ts.factory.createStringLiteral(`[调用函数: ${funcName}]`)]));
            const orig = ts.isBlock(node.body)
                ? [...node.body.statements]
                : [ts.factory.createReturnStatement(node.body)];
            const newBody = ts.factory.createBlock([logStmt, ...orig], true);
            return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, newBody);
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
function parseToAST(code, fileName = "sample.ts") {
    try {
        return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    }
    catch (e) {
        throw new ParseError(`解析失败: ${e.message}`);
    }
}
// 功能 2: AST 可视化
function printAST(node, level = 0, maxDepth = 5) {
    new PrintVisitor(maxDepth).visit(node, level);
}
// 功能 3: AST 分析
function analyzeAST(sourceFile, _opts) {
    const v = new AnalysisVisitor();
    v.run(sourceFile);
    return v.result;
}
function printAnalysis(result) {
    const list = [
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
            item.split("\n").forEach((line, i) => console.log(`    ${i === 0 ? "• " : "  "}${line}`));
        }
    }
}
// 功能 4: AST 变换
function renameIdentifier(sf, oldName, newName) {
    return new RenameVisitor(oldName, newName).transform(sf);
}
function addDeprecatedTag(sf) {
    return new DeprecatedTagVisitor().transform(sf);
}
function addLoggingToFunctions(sf) {
    return new LoggingInjectorVisitor().transform(sf);
}
// 功能 5: 代码生成
function generateCode(sourceFile) {
    try {
        const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });
        return printer.printFile(sourceFile);
    }
    catch (e) {
        throw new GenerateError(`代码生成失败: ${e.message}`);
    }
}
// 功能 6: AST 构建
function buildASTProgramatically() {
    const f = ts.factory;
    const id = (s) => f.createIdentifier(s);
    const strKw = () => f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
    const numKw = () => f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    const param = (n, t) => f.createParameterDeclaration(undefined, undefined, id(n), undefined, t);
    const exportMod = () => [f.createModifier(ts.SyntaxKind.ExportKeyword)];
    const personInterface = f.createInterfaceDeclaration(exportMod(), id("Person"), undefined, undefined, [
        f.createPropertySignature(undefined, id("name"), undefined, strKw()),
        f.createPropertySignature(undefined, id("age"), undefined, numKw()),
    ]);
    const createPerson = f.createFunctionDeclaration(exportMod(), undefined, id("createPerson"), undefined, [param("name", strKw()), param("age", numKw())], f.createTypeReferenceNode(id("Person")), f.createBlock([f.createReturnStatement(f.createObjectLiteralExpression([
            f.createShorthandPropertyAssignment(id("name")),
            f.createShorthandPropertyAssignment(id("age")),
        ], true))], true));
    const greetPerson = f.createFunctionDeclaration(exportMod(), undefined, id("greetPerson"), undefined, [param("person", f.createTypeReferenceNode(id("Person")))], strKw(), f.createBlock([f.createReturnStatement(f.createTemplateExpression(f.createTemplateHead("Hello, "), [
            f.createTemplateSpan(f.createPropertyAccessExpression(id("person"), id("name")), f.createTemplateMiddle("! You are ")),
            f.createTemplateSpan(f.createPropertyAccessExpression(id("person"), id("age")), f.createTemplateTail(" years old.")),
        ]))], true));
    return f.createSourceFile([personInterface, createPerson, greetPerson], f.createToken(ts.SyntaxKind.EndOfFileToken), ts.NodeFlags.None);
}
// 功能 7: 完整流水线
function fullPipeline(code) {
    console.log(divider("综合示例：解析 → 分析 → 变换 → 生成 流水线"));
    const events = [];
    const stepInfo = [AstOperationKind.Parse, "解析", 0];
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
    if (firstImport)
        console.log(`   ✓ 首个导入: ${firstImport}`);
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
        else if (isErrorEvent(e))
            console.log(`   [事件] 错误: ${e.message}`);
    }
    // 使用迭代器遍历 AST
    const walker = new AstWalker(sf, 2);
    let count = 0;
    for (const _ of walker)
        count++;
    console.log(`   ✓ 迭代器遍历(深度2): ${count} 节点; 步骤数: ${PIPELINE_STEPS.length}`);
}
// 交互式 CLI
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function prompt(q) {
    return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}
function printMenu() {
    const bar = "═".repeat(60);
    console.log(`\n${bar}\n  TypeScript AST 解析与代码生成工具\n${bar}`);
    console.log("  1.解析源码为AST并可视化  2.分析AST  3.标识符重命名");
    console.log("  4.添加@deprecated  5.添加日志  6.编程式构建AST");
    console.log("  7.完整流水线  8.自定义解析  0.退出");
    console.log(bar);
}
function printCodeBlock(code) {
    console.log(`${HRL}\n${code}${HRL}`);
}
async function handleChoice(choice) {
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
                const lines = [];
                while (true) {
                    const l = await prompt("  > ");
                    if (l === "")
                        break;
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
    }
    catch (e) {
        if (e instanceof AstError) {
            console.log(`  ✗ [${e.code}] ${e.message}`);
        }
        else {
            console.log(`  ✗ 未知错误: ${e.message}`);
        }
    }
    return true;
}
async function main() {
    console.log("╔══════════════════════════════════════════════════════════╗\n║     TypeScript AST 解析与代码生成工具                   ║\n║     纯 TypeScript 实现 · Compiler API 演示              ║\n╚══════════════════════════════════════════════════════════╝");
    let running = true;
    while (running) {
        printMenu();
        running = await handleChoice(await prompt("  请选择功能 (0-8): "));
    }
}
main().catch(console.error);
//# sourceMappingURL=index.js.map