// TypeScript symbol 类型示例

// ==================== 基本用法 ====================

let x: symbol = Symbol();
let y: symbol = Symbol();
console.log(x === y); // false

// ==================== unique symbol ====================

// unique symbol 表示单个具体的 Symbol 值
// 只能用 const 声明
const us1: unique symbol = Symbol();
// let us2: unique symbol = Symbol(); // 报错

// const 声明时默认就是 unique symbol
const us3 = Symbol(); // 类型为 unique symbol

// 每个 unique symbol 都是不同的类型
const a: unique symbol = Symbol();
const b: unique symbol = Symbol();
// a === b; // 报错，不同类型

// 同类型赋值需要 typeof
const c: unique symbol = Symbol();
const d: typeof c = c; // 正确

// unique symbol 是 symbol 的子类型
const e: unique symbol = Symbol();
const f: symbol = e; // 正确
// const g: unique symbol = f; // 报错

// ==================== Symbol.for ====================

// Symbol.for 返回相同值，但 TypeScript 无法识别
const sf1: unique symbol = Symbol.for("foo");
const sf2: unique symbol = Symbol.for("foo");
// sf1 === sf2 // 报错，但实际值相等

// ==================== 用作属性名 ====================

const key: unique symbol = Symbol();
const key2: symbol = Symbol();

interface Foo {
  [key]: string; // 正确
  // [key2]: string; // 5.8.3 版本之前报错
}

// ==================== 类中的 unique symbol ====================

class C {
  static readonly foo: unique symbol = Symbol();
}

// ==================== 类型推断 ====================

// let 声明推断为 symbol
let inferred1 = Symbol(); // symbol

// const 声明推断为 unique symbol
const inferred2 = Symbol(); // unique symbol

// const 赋值为 symbol 变量，推断为 symbol
let symVar = Symbol();
const inferred3 = symVar; // symbol

// let 赋值为 unique symbol 变量，推断为 symbol
const uniqueVar = Symbol();
let inferred4 = uniqueVar; // symbol
