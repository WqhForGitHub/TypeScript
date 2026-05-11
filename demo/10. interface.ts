// TypeScript interface 接口示例

// ==================== 基本接口 ====================

interface Person {
  firstName: string;
  lastName: string;
  age: number;
}

const p: Person = {
  firstName: "John",
  lastName: "Smith",
  age: 25,
};

// 方括号取出属性类型
interface Foo {
  a: string;
}
type A = Foo["a"]; // string

// ==================== 接口成员的5种形式 ====================

// 1. 对象属性
interface Point {
  x: number;
  y: number;
  z?: number; // 可选属性
  readonly name: string; // 只读属性
}

// 2. 属性索引
interface Indexed {
  [prop: string]: number;
}

interface ArrayLike {
  [prop: number]: string;
}
const arrLike: ArrayLike = ["a", "b", "c"];

// 3. 对象方法（三种写法）
interface MethodWays {
  f(x: boolean): string;           // 写法一
  g: (x: boolean) => string;       // 写法二
  h: { (x: boolean): string };     // 写法三
}

// 方法重载
interface Overloaded {
  f(): number;
  f(x: boolean): boolean;
  f(x: string, y: string): string;
}

// 4. 函数接口
interface Add {
  (x: number, y: number): number;
}
const myAdd: Add = (x, y) => x + y;

// 5. 构造函数接口
interface ErrorConstructor {
  new (message?: string): Error;
}

// ==================== 接口继承 ====================

// 继承 interface
interface Shape {
  name: string;
}
interface Circle extends Shape {
  radius: number;
}
// Circle 有 name 和 radius

// 多重继承
interface Style {
  color: string;
}
interface CircleFull extends Style, Shape {
  radius: number;
}

// 继承 type
type Country = {
  name: string;
  capital: string;
};
interface CountryWithPop extends Country {
  population: number;
}

// 继承 class
class A {
  x: string = "";
  y(): boolean {
    return true;
  }
}
interface B extends A {
  z: number;
}
const bInstance: B = {
  x: "",
  y: function () {
    return true;
  },
  z: 123,
};

// ==================== 接口合并 ====================

interface Box {
  height: number;
  width: number;
}
interface Box {
  length: number;
}
// Box 现在有 height, width, length

// 扩展 Document
interface Document {
  foo: string;
}
// document.foo = "hello"; // 可以使用自定义属性

// 同名属性不能有类型冲突
// interface Conflict {
//   a: number;
// }
// interface Conflict {
//   a: string; // 报错
// }

// 同名方法会产生函数重载
interface Cloner {
  clone(animal: any): any;
}
interface Cloner {
  clone(animal: object): object;
}
// 后面的定义优先级更高

// ==================== interface 与 type 的异同 ====================

// type 能表示非对象类型
type MyStr = string;

// type 用 & 继承
type Animal = { name: string };
type Bear = Animal & { honey: boolean };

// interface 用 extends 继承
interface Animal2 {
  name: string;
}
interface Bear2 extends Animal2 {
  honey: boolean;
}

// interface 可以继承 type
type Foo = { x: number };
interface Bar extends Foo {
  y: number;
}

// type 也可以继承 interface
interface Foo2 {
  x: number;
}
type Bar2 = Foo2 & { y: number };

// 同名 interface 会合并，同名 type 会报错
// type SameName = { foo: number };
// type SameName = { bar: number }; // 报错

// type 可以包含属性映射
interface Point {
  x: number;
  y: number;
}
type PointCopy = {
  [Key in keyof Point]: Point[Key]; // 正确
};
// interface PointCopy2 {
//   [Key in keyof Point]: Point[Key]; // 报错
// }

// this 关键字只能用于 interface
interface FooThis {
  add(num: number): this; // 正确
}
// type BarThis = {
//   add(num: number): this; // 报错
// };

// type 可以扩展原始数据类型
type MyStr2 = string & {
  type: "new";
};
// interface MyStr3 extends string { // 报错
//   type: "new";
// }

// type 可以表达联合类型和交叉类型
type UnionA = { a: string };
type UnionB = { b: string };
type AorB = UnionA | UnionB;
type AorBwithName = AorB & { name: string };
