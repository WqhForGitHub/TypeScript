# TypeScript AST 解析与代码生成工具

一个使用纯 TypeScript 编写的 TypeScript AST（抽象语法树）解析与代码生成工具演示。

## 功能

1. **AST 解析** - 将 TypeScript 源码解析为抽象语法树（使用 `ts.createSourceFile`）
2. **AST 可视化** - 以树形结构打印 AST 节点，支持中文标签
3. **AST 分析** - 提取函数、类、接口、类型别名、变量、导入/导出等声明信息
4. **AST 变换** - 修改 AST 节点（标识符重命名、添加 @deprecated 注释、插入日志语句）
5. **代码生成** - 使用 `ts.createPrinter` 从 AST 还原为源码
6. **AST 构建** - 使用 `ts.factory` 工厂方法编程式构建完整的 TypeScript 模块
7. **综合流水线** - 完整的解析→分析→变换→生成演示
8. **自定义代码** - 支持输入自定义代码并实时解析

## 项目结构

```
100.  TypeScript AST 解析与代码生成工具/
├── src/
│   └── index.ts          # 主程序入口
├── dist/                  # 编译输出
├── package.json
├── tsconfig.json
└── README.md
```

## 安装与运行

```bash
# 安装依赖
npm install

# 编译
npm run build

# 运行
npm start

# 或者一步编译+运行
npm run dev
```

## 使用说明

运行后进入交互式菜单：

```
═ 1. 解析源码为 AST 并可视化     - 查看源码对应的 AST 树形结构
═ 2. 分析 AST（提取声明信息）    - 提取函数、类、接口等声明
═ 3. 标识符重命名变换           - 输入旧/新名称，自动重命名
═ 4. 添加 @deprecated 注释      - 给所有函数添加废弃注释
═ 5. 添加函数日志语句           - 在函数体开头插入 console.log
═ 6. 编程式构建 AST 并生成代码   - 用工厂方法从零构建代码
═ 7. 运行综合示例（完整流水线）  - 解析→分析→变换→生成
═ 8. 自定义代码解析             - 输入任意 TS 代码进行解析
═ 0. 退出
```

## TypeScript 知识点演示

- **TypeScript Compiler API** (`ts.createSourceFile`, `ts.factory`, `ts.createPrinter`)
- **AST 节点类型** 与 `ts.SyntaxKind` 枚举
- **访问者模式** (`ts.visitNode`, `ts.visitEachChild`)
- **AST 变换** (`ts.transform`, `ts.TransformerFactory`)
- **工厂方法创建节点** (`ts.factory.createXxx`)
- **代码打印** (`ts.createPrinter().printFile`)
- **交互式 CLI** (`readline` 模块)
