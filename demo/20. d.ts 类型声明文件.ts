// TypeScript d.ts 类型声明文件示例

// ==================== 简介 ====================

// 类型声明文件只有类型代码，没有具体实现
// 文件名为 [模块名].d.ts

// 模块的类型声明文件示例
// export function getArrayLength(arr: any[]): number;
// export const maxInterval: 12;

// 使用 export = 输出
// declare module "moment" {
//   function moment(): any;
//   export = moment;
// }

// 使用 export default 输出
// declare const pi: number;
// export default pi;

// ==================== 类型声明文件的来源 ====================

// 1. TypeScript 编译器自动生成
// tsc --declaration

// 2. TypeScript 内置类型文件（lib 目录下）
// lib.d.ts, lib.dom.d.ts, lib.es2015.d.ts 等

// 3. 外部模块的类型声明文件
// - 自带 .d.ts 文件的库
// - 社区提供的 @types/xxx 包
// - 自己编写

// ==================== declare 关键字在声明文件中的使用 ====================

// 变量声明必须使用 declare
// declare let foo: string;

// interface 可以不加 declare
// interface Foo {} // 正确
// declare interface Foo {} // 也正确

// ==================== 模块发布 ====================

// package.json 中使用 types 或 typings 字段
// {
//   "name": "awesome",
//   "main": "./lib/main.js",
//   "types": "./lib/main.d.ts"
// }

// ==================== 三斜杠命令 ====================

// /// <reference path="" />
// 引入其他文件
// /// <reference path="./interfaces.d.ts" />
// /// <reference path="./functions.d.ts" />

// /// <reference types="" />
// 引入 @types 目录下的类型库
// /// <reference types="node" />

// /// <reference lib="" />
// 显式包含内置 lib 库
// /// <reference lib="es2017.string" />
