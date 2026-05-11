// TypeScript tsc 命令行编译器示例

// ==================== 基本用法 ====================

// 使用 tsconfig.json 的配置
// $ tsc

// 编译单个文件
// $ tsc index.ts

// 编译多个文件
// $ tsc src/*.ts

// 指定配置文件
// $ tsc --project tsconfig.production.json

// 只生成类型声明文件
// $ tsc index.js --declaration --emitDeclarationOnly

// 多个 TS 文件编译成单个 JS 文件
// $ tsc app.ts util.ts --target esnext --outfile index.js

// ==================== 常用命令行参数 ====================

// --all：输出所有可用的参数
// $ tsc --all

// --allowJs：允许加载 JS 模块
// --alwaysStrict：添加 use strict
// --checkJs：对 JS 脚本进行类型检查
// --declaration：生成类型声明文件
// --esModuleInterop：CommonJS 和 ES6 模块兼容
// --experimentalDecorators：支持早期装饰器语法
// --help：输出帮助信息
// --init：创建 tsconfig.json
// --module：指定模块格式
// --noEmit：只检查类型，不生成产物
// --noEmitOnError：报错时停止编译
// --noImplicitAny：any 类型推断报错
// --outDir：指定输出目录
// --outFile：合并输出
// --pretty：美化终端输出
// --project / -p：指定配置文件
// --removeComments：移除注释
// --sourceMap：生成 SourceMap
// --strict：严格模式
// --strictNullChecks：严格空值检查
// --target：指定 JS 版本
// --version / -v：输出版本号
// --watch / -w：观察模式
// --traceResolution：输出模块解析步骤
// --skipLibCheck：跳过 .d.ts 检查
// --typeRoots：设置类型模块目录
// --types：指定类型模块
