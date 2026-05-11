// TypeScript 模块示例

// ==================== 简介 ====================

// 包含 import 或 export 的文件就是模块
// export type Bool = true | false;

// 不含 export 的文件是全局脚本
// 添加空导出使其成为模块
// export {};

// ==================== import type 语句 ====================

// 方法一：在 import 中加 type 关键字
// import { type A, a } from "./a";

// 方法二：使用 import type 语句
// import type { A } from "./a";
// let b: A = "hello";

// export type 语句
// type A2 = "a";
// type B2 = "b";
// export type { A2, B2 };

// export type 输出类的实例类型
// class Point {
//   x: number;
//   y: number;
// }
// export type { Point };

// ==================== CommonJS 模块 ====================

// import = 语句
// import fs = require("fs");
// const code = fs.readFileSync("hello.ts", "utf8");

// import * as 也适用于 CommonJS
// import * as fs from "fs";

// export = 语句
// let obj = { foo: 123 };
// export = obj;

// ==================== 模块定位 ====================

// 相对模块：以 / ./ ../ 开头
// import { TypeA } from "./a";

// 非相对模块：不带有路径信息
// import * as $ from "jquery";

// Classic 方法：以当前脚本路径为基准
// Node 方法：模拟 Node.js 的 require()

// 路径映射（tsconfig.json）
// {
//   "compilerOptions": {
//     "baseUrl": ".",
//     "paths": {
//       "jquery": ["node_modules/jquery/dist/jquery"]
//     }
//   }
// }

// rootDirs 字段
// {
//   "compilerOptions": {
//     "rootDirs": ["src/zh", "src/de"]
//   }
// }
