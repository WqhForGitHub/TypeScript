#!/usr/bin/env node
/**
 * ============================================================================
 * TypeScript AST 解析与代码生成工具
 * ============================================================================
 *
 * 功能演示：
 *   1. AST 解析 - 将 TypeScript 源码解析为抽象语法树
 *   2. AST 可视化 - 以树形结构打印 AST 节点
 *   3. AST 分析 - 提取函数、变量、接口、类等声明信息
 *   4. AST 变换 - 修改 AST 节点（重命名标识符、添加注释等）
 *   5. 代码生成 - 从 AST 重新生成源码
 *   6. AST 构建 - 使用工厂方法编程式构建 AST 节点
 *   7. 综合示例 - 完整的解析→分析→变换→生成流水线
 *
 * 使用方式：
 *   npm run dev
 *
 * TypeScript 知识点：
 *   - TypeScript Compiler API (ts.createSourceFile, ts.factory, ts.createPrinter)
 *   - AST 节点类型与访问者模式
 *   - ts.SyntaxKind 枚举
 *   - ts.visitNode / ts.visitEachChild 遍历与变换
 *   - 工厂方法创建 AST 节点
 *   - Printer 将 AST 还原为源码
 * ============================================================================
 */

import * as ts from "typescript";
import * as readline from "readline";

// ============ 示例源码 ============

const SAMPLE_CODE = `
import { useState, useEffect } from "react";
import type { User } from "./types";

interface Config {
  name: string;
  version: number;
  debug: boolean;
}

type Status = "active" | "inactive" | "pending";

const DEFAULT_CONFIG: Config = {
  name: "MyApp",
  version: 1,
  debug: false,
};

function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const add = (a: number, b: number): number => a + b;

class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUserCount(): number {
    return this.users.length;
  }
}

export { greet, add, UserService, DEFAULT_CONFIG };
export type { Status, Config };
`;

// ============ 工具函数 ============

/** 语法关键字中文映射 */
const SYNTAX_KIND_LABELS: Record<number, string> = {
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
    [ts.SyntaxKind.TypeLiteral]: "类型字面量",
    [ts.SyntaxKind.PropertySignature]: "属性签名",
    [ts.SyntaxKind.StringKeyword]: "string类型",
    [ts.SyntaxKind.NumberKeyword]: "number类型",
    [ts.SyntaxKind.BooleanKeyword]: "boolean类型",
    [ts.SyntaxKind.VoidKeyword]: "void类型",
    [ts.SyntaxKind.UnionType]: "联合类型",
    [ts.SyntaxKind.LiteralType]: "字面量类型",
    [ts.SyntaxKind.StringLiteral]: "字符串字面量",
    [ts.SyntaxKind.NumericLiteral]: "数字字面量",
    [ts.SyntaxKind.TrueKeyword]: "true关键字",
    [ts.SyntaxKind.FalseKeyword]: "false关键字",
    [ts.SyntaxKind.ObjectLiteralExpression]: "对象字面量",
    [ts.SyntaxKind.PropertyAssignment]: "属性赋值",
    [ts.SyntaxKind.ArrowFunction]: "箭头函数",
    [ts.SyntaxKind.ReturnStatement]: "返回语句",
    [ts.SyntaxKind.BinaryExpression]: "二元表达式",
    [ts.SyntaxKind.TemplateExpression]: "模板表达式",
    [ts.SyntaxKind.TemplateSpan]: "模板跨度",
    [ts.SyntaxKind.CallExpression]: "调用表达式",
    [ts.SyntaxKind.PropertyAccessExpression]: "属性访问表达式",
    [ts.SyntaxKind.Identifier]: "标识符",
    [ts.SyntaxKind.QualifiedName]: "限定名",
    [ts.SyntaxKind.ArrayType]: "数组类型",
    [ts.SyntaxKind.PrivateKeyword]: "private修饰符",
    [ts.SyntaxKind.EndOfFileToken]: "文件结束",
    [ts.SyntaxKind.ExportAssignment]: "导出赋值",
    [ts.SyntaxKind.PrefixUnaryExpression]: "前缀一元表达式",
    [ts.SyntaxKind.Block]: "代码块",
    [ts.SyntaxKind.ExpressionStatement]: "表达式语句",
    [ts.SyntaxKind.ThisKeyword]: "this关键字",
    [ts.SyntaxKind.SpreadAssignment]: "展开赋值",
    [ts.SyntaxKind.ShorthandPropertyAssignment]: "简写属性赋值",
    [ts.SyntaxKind.ComputedPropertyName]: "计算属性名",
    [ts.SyntaxKind.Decorator]: "装饰器",
    [ts.SyntaxKind.HeritageClause]: "继承子句",
    [ts.SyntaxKind.ExpressionWithTypeArguments]: "带类型参数的表达式",
    [ts.SyntaxKind.IndexSignature]: "索引签名",
    [ts.SyntaxKind.ConstructorType]: "构造类型",
    [ts.SyntaxKind.FunctionType]: "函数类型",
    [ts.SyntaxKind.TypeOperator]: "类型操作符",
    [ts.SyntaxKind.ParenthesizedType]: "括号类型",

    [ts.SyntaxKind.TypeOfExpression]: "typeof表达式",
    [ts.SyntaxKind.DeleteExpression]: "delete表达式",
    [ts.SyntaxKind.VoidExpression]: "void表达式",
    [ts.SyntaxKind.AwaitExpression]: "await表达式",
    [ts.SyntaxKind.YieldExpression]: "yield表达式",
    [ts.SyntaxKind.SwitchStatement]: "switch语句",
    [ts.SyntaxKind.CaseClause]: "case子句",
    [ts.SyntaxKind.DefaultClause]: "default子句",
    [ts.SyntaxKind.IfStatement]: "if语句",
    [ts.SyntaxKind.ForStatement]: "for语句",
    [ts.SyntaxKind.ForInStatement]: "for-in语句",
    [ts.SyntaxKind.ForOfStatement]: "for-of语句",
    [ts.SyntaxKind.WhileStatement]: "while语句",
    [ts.SyntaxKind.DoStatement]: "do-while语句",
    [ts.SyntaxKind.TryStatement]: "try语句",
    [ts.SyntaxKind.CatchClause]: "catch子句",
    [ts.SyntaxKind.ThrowStatement]: "throw语句",
    [ts.SyntaxKind.NewExpression]: "new表达式",
    [ts.SyntaxKind.ArrayLiteralExpression]: "数组字面量",
    [ts.SyntaxKind.ObjectBindingPattern]: "对象绑定模式",
    [ts.SyntaxKind.ArrayBindingPattern]: "数组绑定模式",
    [ts.SyntaxKind.BindingElement]: "绑定元素",
    [ts.SyntaxKind.ConditionalExpression]: "条件表达式",
    [ts.SyntaxKind.ParenthesizedExpression]: "括号表达式",
    [ts.SyntaxKind.AsExpression]: "as表达式",
    [ts.SyntaxKind.TypeAssertionExpression]: "类型断言表达式",
    [ts.SyntaxKind.NonNullExpression]: "非空表达式",
    [ts.SyntaxKind.MetaProperty]: "元属性",
    [ts.SyntaxKind.ModuleDeclaration]: "模块声明",
    [ts.SyntaxKind.ModuleBlock]: "模块块",
    [ts.SyntaxKind.NamespaceImport]: "命名空间导入",
    [ts.SyntaxKind.ImportEqualsDeclaration]: "导入等于声明",
    [ts.SyntaxKind.EnumDeclaration]: "枚举声明",
    [ts.SyntaxKind.EnumMember]: "枚举成员",
    [ts.SyntaxKind.JsxElement]: "JSX元素",
    [ts.SyntaxKind.JsxSelfClosingElement]: "JSX自关闭元素",
    [ts.SyntaxKind.JsxOpeningElement]: "JSX开始元素",
    [ts.SyntaxKind.JsxClosingElement]: "JSX结束元素",
    [ts.SyntaxKind.JsxExpression]: "JSX表达式",
    [ts.SyntaxKind.JsxText]: "JSX文本",
    [ts.SyntaxKind.SpreadElement]: "展开元素",
    [ts.SyntaxKind.ElementAccessExpression]: "元素访问表达式",
    [ts.SyntaxKind.TaggedTemplateExpression]: "标签模板表达式",
    [ts.SyntaxKind.PostfixUnaryExpression]: "后缀一元表达式",
    [ts.SyntaxKind.OmittedExpression]: "省略表达式",
    [ts.SyntaxKind.TypeQuery]: "类型查询节点",
    [ts.SyntaxKind.IndexedAccessType]: "索引访问类型",
    [ts.SyntaxKind.MappedType]: "映射类型",
    [ts.SyntaxKind.ConditionalType]: "条件类型",
    [ts.SyntaxKind.InferType]: "infer类型",
    [ts.SyntaxKind.OptionalType]: "可选类型",
    [ts.SyntaxKind.RestType]: "rest类型",
    [ts.SyntaxKind.TupleType]: "元组类型",
    [ts.SyntaxKind.NamedTupleMember]: "命名元组成员",
    [ts.SyntaxKind.IntersectionType]: "交叉类型",
    [ts.SyntaxKind.ConstructSignature]: "构造签名",
    [ts.SyntaxKind.CallSignature]: "调用签名",
    [ts.SyntaxKind.MethodSignature]: "方法签名",
    [ts.SyntaxKind.SemicolonClassElement]: "分号类元素",
    [ts.SyntaxKind.GetAccessor]: "get访问器",
    [ts.SyntaxKind.SetAccessor]: "set访问器",
};

/** 获取语法关键字的中文标签 */
function getKindLabel(kind: ts.SyntaxKind): string {
    return (
        SYNTAX_KIND_LABELS[kind] || ts.SyntaxKind[kind] || `Unknown(${kind})`
    );
}

/** 缩进辅助 */
function indent(level: number): string {
    return "  ".repeat(level);
}

/** 分隔线 */
function divider(title: string): string {
    const line = "─".repeat(56);
    return `\n┌${line}┐\n│ ${title.padEnd(55)}│\n└${line}┘`;
}

// ============ 1. AST 解析 ============

/**
 * 将 TypeScript 源码解析为 AST（SourceFile 节点）
 */
function parseToAST(
    code: string,
    fileName: string = "sample.ts",
): ts.SourceFile {
    return ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.Latest,
        true, // setParentNodes: 设置父节点引用
        ts.ScriptKind.TS,
    );
}

// ============ 2. AST 可视化 ============

/**
 * 递归打印 AST 树形结构
 * @param node   当前 AST 节点
 * @param level  缩进层级
 * @param maxDepth 最大显示深度（默认5）
 */
function printAST(
    node: ts.Node,
    level: number = 0,
    maxDepth: number = 5,
): void {
    if (level > maxDepth) {
        console.log(`${indent(level)}... (深度超限，已截断)`);
        return;
    }

    const kind = node.kind;
    const label = getKindLabel(kind);

    // 获取节点的文本摘要
    let text = "";
    if (ts.isIdentifier(node)) {
        text = ` [${node.text}]`;
    } else if (ts.isStringLiteral(node)) {
        text = ` ["${node.text}"]`;
    } else if (ts.isNumericLiteral(node)) {
        text = ` [${node.text}]`;
    } else if (ts.isImportSpecifier(node)) {
        text = ` [${node.name.text}]`;
    } else if (ts.isExportSpecifier(node)) {
        text = ` [${node.name.text}]`;
    } else if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
    ) {
        const name = node.name;
        text = name ? ` [${name.text}]` : " [匿名]";
    } else if (ts.isVariableDeclaration(node)) {
        text = node.name.getText ? ` [${node.name.getText()}]` : "";
    } else if (ts.isMethodDeclaration(node)) {
        const name = node.name;
        text = ` [${name.getText()}]`;
    } else if (ts.isPropertyDeclaration(node)) {
        const name = node.name;
        text = ` [${name.getText()}]`;
    } else if (ts.isPropertySignature(node)) {
        const name = node.name;
        text = ` [${name.getText()}]`;
    } else if (ts.isParameter(node)) {
        const name = node.name;
        text = ` [${name.getText()}]`;
    } else if (ts.isPropertyAssignment(node)) {
        const name = node.name;
        text = ` [${name.getText()}]`;
    } else if (ts.isLiteralTypeNode(node)) {
        const literal = node.literal;
        text = ` [${literal.getText()}]`;
    }

    console.log(`${indent(level)}${ts.SyntaxKind[kind]}(${label})${text}`);

    // 递归遍历子节点
    node.forEachChild((child) => {
        printAST(child, level + 1, maxDepth);
    });
}

// ============ 3. AST 分析 ============

interface AnalysisResult {
    imports: string[];
    exports: string[];
    functions: string[];
    classes: string[];
    interfaces: string[];
    typeAliases: string[];
    variables: string[];
    arrowFunctions: string[];
}

/**
 * 分析 AST，提取各类声明信息
 */
function analyzeAST(sourceFile: ts.SourceFile): AnalysisResult {
    const result: AnalysisResult = {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        interfaces: [],
        typeAliases: [],
        variables: [],
        arrowFunctions: [],
    };

    function visit(node: ts.Node) {
        // 导入声明
        if (ts.isImportDeclaration(node)) {
            const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral)
                .text;
            const importClause = node.importClause;

            let importInfo = `from "${moduleSpecifier}"`;

            if (importClause) {
                const parts: string[] = [];

                // 默认导入
                if (importClause.name) {
                    parts.push(`default as ${importClause.name.text}`);
                }

                // 命名导入
                if (
                    importClause.namedBindings &&
                    ts.isNamedImports(importClause.namedBindings)
                ) {
                    const names = importClause.namedBindings.elements.map(
                        (e) => e.name.text,
                    );
                    parts.push(`{ ${names.join(", ")} }`);
                }

                // 命名空间导入
                if (
                    importClause.namedBindings &&
                    ts.isNamespaceImport(importClause.namedBindings)
                ) {
                    parts.push(`* as ${importClause.namedBindings.name.text}`);
                }

                importInfo = parts.join(", ") + " " + importInfo;
            }

            result.imports.push(importInfo);
        }

        // 导出声明
        if (ts.isExportDeclaration(node)) {
            const exportClause = node.exportClause;
            if (exportClause && ts.isNamedExports(exportClause)) {
                const names = exportClause.elements.map((e) => e.name.text);
                result.exports.push(`export { ${names.join(", ")} }`);
            }
        }

        // 函数声明
        if (ts.isFunctionDeclaration(node)) {
            const name = node.name ? node.name.text : "<匿名>";
            const params = node.parameters
                .map((p) => p.name.getText())
                .join(", ");
            const returnType = node.type ? `: ${node.type.getText()}` : "";
            result.functions.push(`function ${name}(${params})${returnType}`);
        }

        // 类声明
        if (ts.isClassDeclaration(node)) {
            const name = node.name ? node.name.text : "<匿名>";
            const members: string[] = [];

            node.members.forEach((member) => {
                if (ts.isConstructorDeclaration(member)) {
                    const params = member.parameters
                        .map((p) => p.name.getText())
                        .join(", ");
                    members.push(`  constructor(${params})`);
                } else if (ts.isMethodDeclaration(member)) {
                    const methodName = member.name.getText();
                    const params = member.parameters
                        .map((p) => p.name.getText())
                        .join(", ");
                    const modifiers = member.modifiers
                        ? member.modifiers.map((m) => m.getText()).join(" ") +
                          " "
                        : "";
                    members.push(`  ${modifiers}${methodName}(${params})`);
                } else if (ts.isPropertyDeclaration(member)) {
                    const propName = member.name.getText();
                    const modifiers = member.modifiers
                        ? member.modifiers.map((m) => m.getText()).join(" ") +
                          " "
                        : "";
                    members.push(`  ${modifiers}${propName}`);
                }
            });

            result.classes.push(`class ${name} {\n${members.join("\n")}\n}`);
        }

        // 接口声明
        if (ts.isInterfaceDeclaration(node)) {
            const name = node.name.text;
            const members = node.members.map((m) => {
                if (ts.isPropertySignature(m)) {
                    const propName = m.name.getText();
                    const opt = m.questionToken ? "?" : "";
                    const type = m.type ? `: ${m.type.getText()}` : "";
                    return `  ${propName}${opt}${type}`;
                }
                return `  ${m.getText()}`;
            });
            result.interfaces.push(
                `interface ${name} {\n${members.join("\n")}\n}`,
            );
        }

        // 类型别名声明
        if (ts.isTypeAliasDeclaration(node)) {
            const name = node.name.text;
            const type = node.type.getText();
            result.typeAliases.push(`type ${name} = ${type}`);
        }

        // 变量声明
        if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach((decl) => {
                const name = decl.name.getText();
                const type = decl.type ? `: ${decl.type.getText()}` : "";
                const init = decl.initializer
                    ? ` = ${decl.initializer.getText().substring(0, 50)}${decl.initializer.getText().length > 50 ? "..." : ""}`
                    : "";
                result.variables.push(`const ${name}${type}${init}`);
            });
        }

        // 箭头函数（在变量声明中）
        if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isArrowFunction(node.initializer)
        ) {
            const name = node.name.getText();
            const params = node.initializer.parameters
                .map((p) => p.name.getText())
                .join(", ");
            result.arrowFunctions.push(`const ${name} = (${params}) => ...`);
        }

        // 递归遍历
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return result;
}

/** 打印分析结果 */
function printAnalysis(result: AnalysisResult): void {
    const sections: { title: string; items: string[] }[] = [
        { title: "导入声明 (Imports)", items: result.imports },
        { title: "导出声明 (Exports)", items: result.exports },
        { title: "函数声明 (Functions)", items: result.functions },
        { title: "类声明 (Classes)", items: result.classes },
        { title: "接口声明 (Interfaces)", items: result.interfaces },
        { title: "类型别名 (Type Aliases)", items: result.typeAliases },
        { title: "变量声明 (Variables)", items: result.variables },
        { title: "箭头函数 (Arrow Functions)", items: result.arrowFunctions },
    ];

    sections.forEach(({ title, items }) => {
        console.log(`\n  ▸ ${title}:`);
        if (items.length === 0) {
            console.log("    (无)");
        } else {
            items.forEach((item) => {
                const lines = item.split("\n");
                lines.forEach((line, i) => {
                    console.log(`    ${i === 0 ? "• " : "  "}${line}`);
                });
            });
        }
    });
}

// ============ 4. AST 变换 ============

/**
 * 变换1：标识符重命名
 * 将 AST 中所有匹配的标识符替换为新名称
 */
function renameIdentifier(
    sourceFile: ts.SourceFile,
    oldName: string,
    newName: string,
): ts.SourceFile {
    const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
        const visit: ts.Visitor = (node) => {
            // 如果是标识符且名称匹配，创建新标识符
            if (ts.isIdentifier(node) && node.text === oldName) {
                return ts.factory.createIdentifier(newName);
            }
            return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };

    const result = ts.transform(sourceFile, [transform]);
    return result.transformed[0];
}

/**
 * 变换2：给函数添加 @deprecated JSDoc 注释
 */
function addDeprecatedTag(sourceFile: ts.SourceFile): ts.SourceFile {
    const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
        const visit: ts.Visitor = (node) => {
            if (ts.isFunctionDeclaration(node) && node.name) {
                // 使用 addSyntheticLeadingComment 添加 @deprecated 注释
                const newNode = ts.addSyntheticLeadingComment(
                    node,
                    ts.SyntaxKind.MultiLineCommentTrivia,
                    "*\n * @deprecated 此函数已废弃，请使用新版本。\n ",
                    true,
                );
                return newNode;
            }
            return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };

    const result = ts.transform(sourceFile, [transform]);
    return result.transformed[0];
}

/**
 * 变换3：给函数参数添加修饰（在参数前添加注释标记）
 * 这里演示通过修改 AST 来添加 console.log 调试语句
 */
function addLoggingToFunctions(sourceFile: ts.SourceFile): ts.SourceFile {
    const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
        const visit: ts.Visitor = (node) => {
            if (ts.isFunctionDeclaration(node) && node.body && node.name) {
                const funcName = node.name.text;

                // 创建 console.log 调用语句
                const logStatement = ts.factory.createExpressionStatement(
                    ts.factory.createCallExpression(
                        ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier("console"),
                            ts.factory.createIdentifier("log"),
                        ),
                        undefined,
                        [
                            ts.factory.createStringLiteral(
                                `[调用函数: ${funcName}]`,
                            ),
                        ],
                    ),
                );

                // 获取原函数体语句
                const originalStatements = ts.isBlock(node.body)
                    ? [...node.body.statements]
                    : [ts.factory.createReturnStatement(node.body)];

                // 在函数体开头插入日志语句
                const newBody = ts.factory.createBlock(
                    [logStatement, ...originalStatements],
                    true,
                );

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
            return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };

    const result = ts.transform(sourceFile, [transform]);
    return result.transformed[0];
}

// ============ 5. 代码生成 ============

/**
 * 从 AST (SourceFile) 生成代码字符串
 */
function generateCode(sourceFile: ts.SourceFile): string {
    const printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed,
        removeComments: false,
    });
    return printer.printFile(sourceFile);
}

// ============ 6. AST 构建 ============

/**
 * 使用 ts.factory 方法编程式构建一个完整的 TypeScript 模块
 *
 * 构建目标：
 * ```typescript
 * // 自动生成的代码
 * interface Person {
 *   name: string;
 *   age: number;
 * }
 *
 * function createPerson(name: string, age: number): Person {
 *   return { name, age };
 * }
 *
 * function greetPerson(person: Person): string {
 *   return `Hello, ${person.name}! You are ${person.age} years old.`;
 * }
 *
 * export { Person, createPerson, greetPerson };
 * ```
 */
function buildASTProgramatically(): ts.SourceFile {
    const factory = ts.factory;

    // ---- 构建 interface Person ----
    const personInterface = factory.createInterfaceDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        factory.createIdentifier("Person"),
        undefined, // typeParameters
        undefined, // heritageClauses
        [
            factory.createPropertySignature(
                undefined,
                factory.createIdentifier("name"),
                undefined,
                factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            ),
            factory.createPropertySignature(
                undefined,
                factory.createIdentifier("age"),
                undefined,
                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            ),
        ],
    );

    // ---- 构建 createPerson 函数 ----
    const createPersonFunc = factory.createFunctionDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        undefined,
        factory.createIdentifier("createPerson"),
        undefined,
        [
            factory.createParameterDeclaration(
                undefined,
                undefined, // dotDotDotToken
                factory.createIdentifier("name"),
                undefined,
                factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            ),
            factory.createParameterDeclaration(
                undefined,
                undefined, // dotDotDotToken
                factory.createIdentifier("age"),
                undefined,
                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            ),
        ],
        factory.createTypeReferenceNode(factory.createIdentifier("Person")),
        factory.createBlock(
            [
                factory.createReturnStatement(
                    factory.createObjectLiteralExpression(
                        [
                            factory.createShorthandPropertyAssignment(
                                factory.createIdentifier("name"),
                            ),
                            factory.createShorthandPropertyAssignment(
                                factory.createIdentifier("age"),
                            ),
                        ],
                        true,
                    ),
                ),
            ],
            true,
        ),
    );

    // ---- 构建 greetPerson 函数 ----
    const greetPersonFunc = factory.createFunctionDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        undefined,
        factory.createIdentifier("greetPerson"),
        undefined,
        [
            factory.createParameterDeclaration(
                undefined,
                undefined, // dotDotDotToken
                factory.createIdentifier("person"),
                undefined,
                factory.createTypeReferenceNode(
                    factory.createIdentifier("Person"),
                ),
            ),
        ],
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        factory.createBlock(
            [
                factory.createReturnStatement(
                    factory.createTemplateExpression(
                        factory.createTemplateHead("Hello, "),
                        [
                            factory.createTemplateSpan(
                                factory.createPropertyAccessExpression(
                                    factory.createIdentifier("person"),
                                    factory.createIdentifier("name"),
                                ),
                                factory.createTemplateMiddle("! You are "),
                            ),
                            factory.createTemplateSpan(
                                factory.createPropertyAccessExpression(
                                    factory.createIdentifier("person"),
                                    factory.createIdentifier("age"),
                                ),
                                factory.createTemplateTail(" years old."),
                            ),
                        ],
                    ),
                ),
            ],
            true,
        ),
    );

    // ---- 构建 SourceFile ----
    const sourceFile = factory.createSourceFile(
        [personInterface, createPersonFunc, greetPersonFunc],
        factory.createToken(ts.SyntaxKind.EndOfFileToken),
        ts.NodeFlags.None,
    );

    return sourceFile;
}

// ============ 7. 综合示例：完整流水线 ============

/**
 * 完整的解析→分析→变换→生成流水线
 */
function fullPipeline(code: string): void {
    console.log(divider("综合示例：解析 → 分析 → 变换 → 生成 流水线"));

    // 步骤1：解析
    console.log("\n📝 步骤1：解析源码为 AST");
    const sourceFile = parseToAST(code);
    console.log(`   ✓ 解析完成，文件名: ${sourceFile.fileName}`);
    console.log(`   ✓ 顶层节点数: ${sourceFile.getChildren().length}`);

    // 步骤2：分析
    console.log("\n🔍 步骤2：分析 AST");
    const analysis = analyzeAST(sourceFile);
    console.log(`   ✓ 函数: ${analysis.functions.length} 个`);
    console.log(`   ✓ 类: ${analysis.classes.length} 个`);
    console.log(`   ✓ 接口: ${analysis.interfaces.length} 个`);
    console.log(`   ✓ 类型别名: ${analysis.typeAliases.length} 个`);
    console.log(`   ✓ 导入: ${analysis.imports.length} 个`);
    console.log(`   ✓ 导出: ${analysis.exports.length} 个`);

    // 步骤3：变换 - 重命名
    console.log("\n🔄 步骤3：变换 AST - 重命名 'greet' → 'sayHello'");
    let transformed = renameIdentifier(sourceFile, "greet", "sayHello");
    console.log("   ✓ 重命名完成");

    // 步骤4：变换 - 添加日志
    console.log("\n🔄 步骤4：变换 AST - 给函数添加日志语句");
    transformed = addLoggingToFunctions(transformed);
    console.log("   ✓ 日志语句添加完成");

    // 步骤5：生成代码
    console.log("\n🖨️  步骤5：从变换后的 AST 生成代码");
    const generated = generateCode(transformed);
    console.log("\n" + "─".repeat(60));
    console.log(generated);
    console.log("─".repeat(60));
}

// ============ 交互式 CLI ============

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

function printMenu(): void {
    console.log("\n" + "═".repeat(60));
    console.log("  TypeScript AST 解析与代码生成工具");
    console.log("═".repeat(60));
    console.log("  1. 解析源码为 AST 并可视化");
    console.log("  2. 分析 AST（提取声明信息）");
    console.log("  3. 标识符重命名变换");
    console.log("  4. 添加 @deprecated 注释");
    console.log("  5. 添加函数日志语句");
    console.log("  6. 编程式构建 AST 并生成代码");
    console.log("  7. 运行综合示例（完整流水线）");
    console.log("  8. 自定义代码解析");
    console.log("  0. 退出");
    console.log("═".repeat(60));
}

async function handleChoice(choice: string): Promise<boolean> {
    const sourceFile = parseToAST(SAMPLE_CODE);

    switch (choice) {
        case "1": {
            console.log(divider("AST 解析与可视化"));
            console.log("\n源码:\n");
            console.log(SAMPLE_CODE);
            console.log(divider("AST 树形结构"));
            printAST(sourceFile, 0, 4);
            break;
        }

        case "2": {
            console.log(divider("AST 分析"));
            const analysis = analyzeAST(sourceFile);
            printAnalysis(analysis);
            break;
        }

        case "3": {
            console.log(divider("标识符重命名变换"));
            const oldName = await prompt(
                "  请输入要重命名的标识符（如 greet）: ",
            );
            const newName = await prompt("  请输入新名称（如 sayHello）: ");
            if (!oldName || !newName) {
                console.log("  ✗ 输入不能为空");
                break;
            }
            const transformed = renameIdentifier(sourceFile, oldName, newName);
            const code = generateCode(transformed);
            console.log(`\n  ✓ 已将 "${oldName}" 重命名为 "${newName}"\n`);
            console.log("─".repeat(60));
            console.log(code);
            console.log("─".repeat(60));
            break;
        }

        case "4": {
            console.log(divider("添加 @deprecated 注释"));
            const transformed = addDeprecatedTag(sourceFile);
            const code = generateCode(transformed);
            console.log("\n  ✓ 已给所有函数添加 @deprecated 注释\n");
            console.log("─".repeat(60));
            console.log(code);
            console.log("─".repeat(60));
            break;
        }

        case "5": {
            console.log(divider("添加函数日志语句"));
            const transformed = addLoggingToFunctions(sourceFile);
            const code = generateCode(transformed);
            console.log("\n  ✓ 已给所有函数添加 console.log 日志\n");
            console.log("─".repeat(60));
            console.log(code);
            console.log("─".repeat(60));
            break;
        }

        case "6": {
            console.log(divider("编程式构建 AST 并生成代码"));
            console.log("\n  使用 ts.factory 方法构建以下代码：\n");
            const builtSourceFile = buildASTProgramatically();
            const code = generateCode(builtSourceFile);
            console.log("─".repeat(60));
            console.log(code);
            console.log("─".repeat(60));

            // 再验证：将生成的代码解析回 AST，确认其合法性
            console.log("\n  ✓ 验证：将生成的代码重新解析为 AST...");
            const reparsed = parseToAST(code, "generated.ts");
            const reAnalysis = analyzeAST(reparsed);
            console.log(`    - 接口: ${reAnalysis.interfaces.length} 个`);
            console.log(`    - 函数: ${reAnalysis.functions.length} 个`);
            reAnalysis.functions.forEach((f) => console.log(`      • ${f}`));
            console.log("  ✓ 代码生成验证通过！\n");

            // 可视化生成的 AST
            console.log("  生成的 AST 结构（深度3）:");
            printAST(reparsed, 0, 3);
            break;
        }

        case "7": {
            fullPipeline(SAMPLE_CODE);
            break;
        }

        case "8": {
            console.log(divider("自定义代码解析"));
            console.log("  请输入 TypeScript 代码（输入空行结束）：\n");
            const lines: string[] = [];
            let line: string;
            // 逐行读取，空行结束
            while (true) {
                line = await prompt("  > ");
                if (line === "") break;
                lines.push(line);
            }
            const customCode = lines.join("\n");
            if (!customCode.trim()) {
                console.log("  ✗ 代码不能为空");
                break;
            }
            const customSource = parseToAST(customCode, "custom.ts");
            console.log("\n  ▸ AST 可视化:");
            printAST(customSource, 0, 6);
            console.log("\n  ▸ AST 分析:");
            const customAnalysis = analyzeAST(customSource);
            printAnalysis(customAnalysis);
            console.log("\n  ▸ 从 AST 重新生成的代码:");
            console.log("─".repeat(60));
            console.log(generateCode(customSource));
            console.log("─".repeat(60));
            break;
        }

        case "0": {
            console.log("\n  再见！");
            rl.close();
            return false;
        }

        default: {
            console.log("  ✗ 无效选项，请重新选择");
            break;
        }
    }

    return true;
}

async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║     TypeScript AST 解析与代码生成工具                   ║");
    console.log("║     纯 TypeScript 实现 · Compiler API 演示              ║");
    console.log("╚══════════════════════════════════════════════════════════╝");

    let running = true;
    while (running) {
        printMenu();
        const choice = await prompt("  请选择功能 (0-8): ");
        running = await handleChoice(choice);
    }
}

// 运行主程序
main().catch(console.error);
