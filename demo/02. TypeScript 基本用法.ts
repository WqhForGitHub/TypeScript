// TypeScript 基本用法示例

// ==================== 类型声明 ====================

let foo: string;

function toString(num: number): string {
  return String(num);
}

// let bad: string = 123; // 报错

// 变量只有赋值后才能使用
// let x: number;
// console.log(x); // 报错

// ==================== 类型推断 ====================

let inferred = 123; // 推断为 number
// inferred = "hello"; // 报错

function inferReturn(num: number) {
  return String(num); // 推断返回 string
}

// ==================== 值与类型 ====================

// typeof 在类型运算中返回 TypeScript 类型
const a = { x: 0 };
type T0 = typeof a; // { x: number }
type T1 = typeof a.x; // number

// typeof 在值运算中返回 JS 类型字符串
let val = 1;
let b: typeof val;

if (typeof val === "number") {
  b = val;
}
