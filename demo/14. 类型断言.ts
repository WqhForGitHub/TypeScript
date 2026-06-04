// TypeScript 类型断言示例

// ==================== 简介 ====================

type T = "a" | "b" | "c";
let foo = "a";
// let bar: T = foo; // 报错
let bar: T = foo as T; // 正确

// 两种语法
// 语法一：<类型>值
// let bar1: T = <T>foo;
// 语法二：值 as 类型
let bar2: T = foo as T;

// 严格字面量检查时使用类型断言
// const p: { x: number } = { x: 0, y: 0 }; // 报错
const p0: { x: number } = { x: 0, y: 0 } as { x: number };

// unknown 类型断言
const value: unknown = "Hello World";
// const s1: string = value; // 报错
const s2: string = value as string; // 正确

// ==================== 类型断言的条件 ====================

const n = 1;
// const m: string = n as string; // 报错

// 连续两次断言可以断言为任意类型
const m: string = n as unknown as string; // 正确

// ==================== as const 断言 ====================

// let 推断为基本类型，const 推断为值类型
let s1 = "JavaScript"; // string
const s2_const = "JavaScript"; // "JavaScript"

// as const 将 let 变量断言为 const
let s3 = "JavaScript" as const;
// s3 = "Python"; // 报错

// as const 只能用于字面量，不能用于变量
// let s4 = "JavaScript";
// let s5 = s4 as const; // 报错

// as const 用于对象
const v1 = {
  x: 1,
  y: 2,
}; // { x: number; y: number }

const v2 = {
  x: 1 as const,
  y: 2,
}; // { x: 1; y: number }

const v3 = {
  x: 1,
  y: 2,
} as const; // { readonly x: 1; readonly y: 2 }

// as const 用于数组
const a1 = [1, 2, 3]; // number[]
const a2 = [1, 2, 3] as const; // readonly [1, 2, 3]

// as const 用于函数 rest 参数
function add(x: number, y: number) {
  return x + y;
}

const nums = [1, 2] as const;
const total = add(...nums); // 正确

// as const 用于 Enum
enum Foo {
  X,
  Y,
}

let e1 = Foo.X; // Foo
let e2 = Foo.X as const; // Foo.X

// ==================== 非空断言 ====================

function f(x?: number | null) {
  console.log(x!.toFixed());
}

// 非空断言用于 DOM
// const root = document.getElementById("root")!;

// 赋值断言
class Point {
  x!: number;
  y!: number;

  constructor(x: number, y: number) {
    // ...
  }
}

// ==================== 断言函数 ====================

function isString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("Not a string");
}

function toUpper(x: string | number) {
  isString(x);
  return x.toUpperCase(); // x 断言为 string
}

// 断言参数非空
function assertIsDefined<T>(value: T): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(`${value} is not defined`);
  }
}

// 断言函数的简写形式
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 断言函数 vs 类型保护函数
function isString2(value: unknown): value is string {
  return typeof value === "string";
}
