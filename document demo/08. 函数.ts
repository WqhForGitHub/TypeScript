// TypeScript 函数类型示例

// ==================== 基本函数类型 ====================

function hello(txt: string): void {
  console.log("hello " + txt);
}

// 返回值类型通常可以省略
function hello2(txt: string) {
  console.log("hello " + txt);
}

// 变量形式的函数类型
// 写法一：通过等号右边推断
const fn1 = function (txt: string) {
  console.log("hello " + txt);
};

// 写法二：使用箭头函数形式指定类型
const fn2: (txt: string) => void = function (txt) {
  console.log("hello " + txt);
};

// 使用 type 别名
type MyFunc = (txt: string) => void;
const fn3: MyFunc = function (txt) {
  console.log("hello " + txt);
};

// 参数名必须写，不能省略
// type Bad = (string, number) => number; // 参数类型都是 any

// 函数类型参数名与实际参数名可以不同
let f: (x: number) => number;
f = function (y: number) {
  return y;
};

// 使用 typeof 获取函数类型
function add(x: number, y: number) {
  return x + y;
}
const myAdd: typeof add = function (x, y) {
  return x + y;
};

// ==================== 函数类型的对象写法 ====================

let addObj: {
  (x: number, y: number): number;
};
addObj = function (x, y) {
  return x + y;
};

// 函数本身有属性时
function fWithProp(x: number) {
  console.log(x);
}
fWithProp.version = "1.0";

let foo: {
  (x: number): void;
  version: string;
} = fWithProp;

// ==================== Function 类型 ====================

// Function 类型接受任意参数，返回 any，不建议使用
function doSomething(f: Function) {
  return f(1, 2, 3);
}

// ==================== 箭头函数 ====================

const repeat = (str: string, times: number): string => str.repeat(times);

// 函数参数为箭头函数类型
function greet(fn: (a: string) => void): void {
  fn("world");
}

// ==================== 可选参数 ====================

function optionalParam(x?: number) {
  // ...
}
optionalParam();     // OK
optionalParam(10);   // OK
optionalParam(undefined); // OK

// 可选参数必须在尾部
// let bad: (a?: number, b: number) => number; // 报错

// 可选参数在函数体内部需要判断
let myFunc: (a: number, b?: number) => number;
myFunc = function (x, y) {
  if (y === undefined) {
    return x;
  }
  return x + y;
};

// ==================== 参数默认值 ====================

function createPoint(x: number = 0, y: number = 0): [number, number] {
  return [x, y];
}
createPoint(); // [0, 0]

// 可选参数与默认值不能同时使用
// function bad(x?: number = 0) {} // 报错

// 传入 undefined 触发默认值
function defaultParam(x = 456) {
  return x;
}
defaultParam(undefined); // 456

// 默认值参数不在末尾时，需要显式传入 undefined
function addDefault(x: number = 0, y: number) {
  return x + y;
}
// addDefault(1); // 报错
addDefault(undefined, 1); // 正确

// ==================== 参数解构 ====================

function destructure([x, y]: [number, number]) {
  // ...
}

type ABC = { a: number; b: number; c: number };
function sum({ a, b, c }: ABC) {
  console.log(a + b + c);
}

// ==================== rest 参数 ====================

// rest 参数为数组
function joinNumbers(...nums: number[]) {
  // ...
}

// rest 参数为元组
function restTuple(...args: [boolean, number]) {
  // ...
}

// rest 参数可嵌套
function nestedRest(...args: [boolean, ...string[]]) {
  // ...
}

// rest 参数与变量解构结合
function repeat2(...[str, times]: [string, number]): string {
  return str.repeat(times);
}

// ==================== readonly 只读参数 ====================

function arraySum(arr: readonly number[]) {
  // arr[0] = 0; // 报错
}

// ==================== void 类型 ====================

function voidFunc(): void {
  console.log("hello");
}

// void 允许返回 undefined 或 null
function returnUndefined(): void {
  return undefined; // 正确
}

// void 类型变量可以接受有返回值的函数
type voidFunc2 = () => void;
const f1: voidFunc2 = () => {
  return 123; // 正确
};

// 但使用返回值会报错
// f1() * 2; // 报错

// ==================== never 类型 ====================

// 抛出错误的函数
function fail(msg: string): never {
  throw new Error(msg);
}

// 无限执行的函数
const sing = function (): never {
  while (true) {
    console.log("sing");
  }
};

// never 与 void 的区别
// void：正常结束但不返回值
// never：不会正常结束

// never 用于类型缩小
function neverReturns(): never {
  throw new Error();
}
function narrowType(x: string | undefined) {
  if (x === undefined) {
    neverReturns();
  }
  x; // 推断为 string
}

// ==================== 局部类型 ====================

function helloLocal(txt: string) {
  type message = string;
  let newTxt: message = "hello " + txt;
  return newTxt;
}
// const outside: message = helloLocal("world"); // 报错

// ==================== 高阶函数 ====================

const higherOrder: (someValue: number) => (multiplier: number) => number =
  (someValue) => (multiplier) => someValue * multiplier;

// ==================== 函数重载 ====================

function reverse(str: string): string;
function reverse(arr: any[]): any[];
function reverse(stringOrArray: string | any[]): string | any[] {
  if (typeof stringOrArray === "string")
    return stringOrArray.split("").reverse().join("");
  else return stringOrArray.slice().reverse();
}

// 重载声明顺序很重要，最宽的声明放最后
function createElement(tag: "a"): HTMLAnchorElement;
function createElement(tag: "canvas"): HTMLCanvasElement;
function createElement(tag: string): HTMLElement {
  // ...
  return document.createElement(tag);
}

// 联合类型替代重载（更简单）
function len(x: any[] | string): number {
  return x.length;
}

// ==================== 构造函数类型 ====================

class Animal {
  numLegs: number = 4;
}

type AnimalConstructor = new () => Animal;

function create(c: AnimalConstructor): Animal {
  return new c();
}

const animal = create(Animal);

// 构造函数的对象写法
type Constructor = {
  new (s: string): object;
};

// 既是构造函数又是普通函数
type DualFunc = {
  new (s: string): object;
  (n?: number): number;
};
