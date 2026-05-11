// TypeScript tsconfig.json 配置示例

// ==================== 简介 ====================

// tsconfig.json 是 TypeScript 项目的配置文件
// 可以使用 tsc --init 自动生成

// {
//   "compilerOptions": {
//     "outDir": "./built",
//     "allowJs": true,
//     "target": "es5"
//   },
//   "include": ["./src/**/*"]
// }

// ==================== 一级属性 ====================

// exclude：排除文件
// {
//   "include": ["**/*"],
//   "exclude": ["**/*.spec.ts"]
// }

// extends：继承配置
// {
//   "extends": "../tsconfig.base.json"
// }

// files：指定编译文件列表
// {
//   "files": ["a.ts", "b.ts"]
// }

// include：指定编译文件（支持通配符）
// {
//   "include": ["src/**/*", "tests/**/*"]
// }

// references：项目引用
// {
//   "references": [
//     { "path": "../pkg1" },
//     { "path": "../pkg2/tsconfig.json" }
//   ]
// }

// ==================== compilerOptions 常用选项 ====================

// allowJs：允许加载 JS 脚本
// "allowJs": true

// checkJs：对 JS 文件进行类型检查
// "checkJs": true

// declaration：生成 .d.ts 文件
// "declaration": true

// declarationDir：.d.ts 文件输出目录
// "declarationDir": "./types"

// esModuleInterop：修复 CommonJS 和 ES6 模块兼容性
// "esModuleInterop": true

// exactOptionalPropertyTypes：可选属性不能赋值为 undefined
// "exactOptionalPropertyTypes": true

// incremental：增量构建
// "incremental": true

// jsx：处理 .tsx 文件
// "jsx": "preserve"

// lib：指定内置类型描述文件
// "lib": ["dom", "es2021"]

// module：编译产物的模块格式
// "module": "commonjs"

// moduleResolution：模块定位算法
// "moduleResolution": "node"

// noEmit：不生成编译产物
// "noEmit": true

// noEmitOnError：报错时不生成编译产物
// "noEmitOnError": true

// noImplicitAny：推断为 any 时报错
// "noImplicitAny": true

// outDir：编译产物存放目录
// "outDir": "./dist"

// paths：模块路径映射
// "paths": {
//   "@bar/*": ["bar/*"]
// }

// removeComments：移除注释
// "removeComments": true

// sourceMap：生成 SourceMap
// "sourceMap": true

// strict：打开严格检查（推荐）
// "strict": true
// 等同于同时打开：
// - alwaysStrict
// - strictNullChecks
// - strictBindCallApply
// - strictFunctionTypes
// - strictPropertyInitialization
// - noImplicitAny
// - noImplicitThis
// - useUnknownInCatchVariables

// strictNullChecks：严格空值检查
// "strictNullChecks": true

// target：编译产物的 JS 版本
// "target": "es2021"

// typeRoots：类型模块所在目录
// "typeRoots": ["./typings", "./vendor/types"]

// types：指定加载的类型模块
// "types": ["node", "jest"]
