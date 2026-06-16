// TypeScript any 类型、unknown 类型、never 类型示例

// ==================== any 类型 ====================

let x: any;

x = 1; // 正确
x = "foo"; // 正确
x = true; // 正确

let anyVar: any = "hello";
// anyVar(1); // 不报错，但运行时会出错
// anyVar.foo = 100; // 不报错，但运行时会出错

// any 类型会污染其他变量
let anyX: any = "hello";
let y: number;
// y = anyX; // 不报错，但 y 实际是字符串
// y * 123; // 不报错，但运行时出错

// ==================== unknown 类型 ====================

let u: unknown;

u = true; // 正确
u = 42; // 正确
u = "Hello World"; // 正确

// unknown 不能直接赋值给其他类型
let v: unknown = 123;
// let v1: boolean = v; // 报错
// let v2: number = v; // 报错

// 不能直接调用 unknown 类型变量的方法和属性
let v1: unknown = { foo: 123 };
// v1.foo; // 报错

let v2: unknown = "hello";
// v2.trim(); // 报错

// unknown 类型变量只能进行比较运算
let ua: unknown = 1;
// ua + 1; // 报错
ua === 1; // 正确

// 经过类型缩小后可以使用
let s: unknown = "hello";

if (typeof s === "string") {
  s.length; // 正确
}

// ==================== never 类型 ====================

// never 类型不包含任何值
// let neverVar: never = 123; // 报错

// 联合类型缩小到 never
function fn(x: string | number) {
  if (typeof x === "string") {
    // x 是 string
  } else if (typeof x === "number") {
    // x 是 number
  } else {
    x; // never 类型
  }
}

// never 可以赋值给任意类型
function f(): never {
  throw new Error("Error");
}

let nv1: number = f(); // 不报错
let nv2: string = f(); // 不报错
