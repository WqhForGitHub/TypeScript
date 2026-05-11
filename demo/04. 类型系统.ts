// TypeScript 类型系统示例

// ==================== 基本类型 ====================

const boolVal: boolean = true;
const strVal: string = "hello";
const numVal: number = 123;
const bigVal: bigint = 123n;
const symVal: symbol = Symbol();
const objVal: object = { foo: 123 };
const undefVal: undefined = undefined;
const nullVal: null = null;

// ==================== 包装对象类型 ====================

const s1: String = "hello"; // 正确
const s2: String = new String("hello"); // 正确

const s3: string = "hello"; // 正确
// const s4: string = new String("hello"); // 报错

// 建议使用小写类型
const n1: number = 1;
// const n2: Number = 1;
// Math.abs(n2); // 报错

// ==================== Object 类型与 object 类型 ====================

// 大写 Object 包含几乎所有值
let obj: Object;
obj = true;
obj = "hi";
obj = 1;
// obj = undefined; // 报错
// obj = null; // 报错

// 小写 object 只包含对象、数组和函数
let obj2: object;
obj2 = { foo: 123 };
obj2 = [1, 2];
// obj2 = true; // 报错
// obj2 = "hi"; // 报错

// 两种类型都不包含自定义属性
const o1: Object = { foo: 0 };
const o2: object = { foo: 0 };
o1.toString(); // 正确
// o1.foo; // 报错

// ==================== undefined 和 null 的特殊性 ====================

// 任何类型都可以赋值为 undefined 或 null（除非开启 strictNullChecks）
let age: number = 24;
// age = null; // strictNullChecks 下报错
// age = undefined; // strictNullChecks 下报错

// 开启 strictNullChecks 后
let name: string | null;
name = "John";
name = null;

// ==================== 值类型 ====================

let x: "hello";
x = "hello"; // 正确
// x = "world"; // 报错

// const 声明推断为值类型
const https = "https"; // 类型为 "https"

// 值类型组成的联合类型
let setting: true | false;
let gender: "male" | "female";
let rainbowColor: "赤" | "橙" | "黄" | "绿" | "青" | "蓝" | "紫";

// ==================== 联合类型 ====================

let union: string | number;
union = 123; // 正确
union = "abc"; // 正确

// 类型缩小
function printId(id: number | string) {
  if (typeof id === "string") {
    console.log(id.toUpperCase());
  } else {
    console.log(id);
  }
}

function getPort(scheme: "http" | "https") {
  switch (scheme) {
    case "http":
      return 80;
    case "https":
      return 443;
  }
}

// ==================== 交叉类型 ====================

let crossObj: { foo: string } & { bar: string };
crossObj = {
  foo: "hello",
  bar: "world",
};

type TypeA = { foo: number };
type TypeB = TypeA & { bar: number };

// ==================== type 命令 ====================

type Age = number;
let age2: Age = 55;

// 别名不允许重名
// type Color = "red";
// type Color = "blue"; // 报错

// 别名支持嵌套
type World = "world";
type Greeting = `hello ${World}`;

// ==================== typeof 运算符 ====================

const typeofA = { x: 0 };
type T0 = typeof typeofA; // { x: number }
type T1 = typeof typeofA.x; // number

let typeofVal = 1;
let typeofB: typeof typeofVal;

if (typeof typeofVal === "number") {
  typeofB = typeofVal;
}

// ==================== 块级类型声明 ====================

if (true) {
  type T = number;
  let v: T = 5;
} else {
  type T = string;
  let v: T = "hello";
}

// ==================== 类型的兼容 ====================

type Compatible = number | string;
let subType: number = 1;
let superType: Compatible = subType; // 正确

let a2: "hi" = "hi";
let b2: string = "hello";
b2 = a2; // 正确
// a2 = b2; // 报错
