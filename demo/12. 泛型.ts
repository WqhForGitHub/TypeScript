// TypeScript 泛型示例

// ==================== 简介 ====================

function getFirst<T>(arr: T[]): T {
  return arr[0];
}

getFirst<number>([1, 2, 3]);
getFirst([1, 2, 3]); // 自动推断

// 多个类型参数
function map<T, U>(arr: T[], f: (arg: T) => U): U[] {
  return arr.map(f);
}

map<string, number>(["1", "2", "3"], (n) => parseInt(n));

// ==================== 函数的泛型写法 ====================

function id<T>(arg: T): T {
  return arg;
}

// 写法一
let myId: <T>(arg: T) => T = id;

// 写法二
let myId2: { <T>(arg: T): T } = id;

// ==================== 接口的泛型写法 ====================

interface Box<Type> {
  contents: Type;
}

let box: Box<string>;

// 泛型接口第二种写法
interface Fn {
  <Type>(arg: Type): Type;
}

let myFn: Fn = id;

// ==================== 类的泛型写法 ====================

class Pair<K, V> {
  key: K;
  value: V;
}

class A<T> {
  value: T;
}

class B extends A<any> {}

// 泛型类表达式
const Container = class<T> {
  constructor(private readonly data: T) {}
};

const a = new Container<boolean>(true);
const b = new Container<number>(0);

// 静态成员不能引用类型参数
// class BadClass<T> {
//   static data: T; // 报错
// }

// ==================== 类型别名的泛型写法 ====================

type Nullable<T> = T | undefined | null;

type Container2<T> = { value: T };
const c1: Container2<number> = { value: 0 };

type Tree<T> = {
  value: T;
  left: Tree<T> | null;
  right: Tree<T> | null;
};

// ==================== 类型参数的默认值 ====================

function getFirstDefault<T = string>(arr: T[]): T {
  return arr[0];
}

class Generic<T = string> {
  list: T[] = [];
  add(t: T) {
    this.list.push(t);
  }
}

const g1 = new Generic();
// g1.add(4); // 报错
g1.add("hello"); // 正确

const g2 = new Generic<number>();
g2.add(4); // 正确

// 可选参数必须在必选参数之后
// <T = boolean, U> // 报错
// <T, U = boolean> // 正确

// ==================== 数组的泛型表示 ====================

let arr: Array<number> = [1, 2, 3];

function doStuff(values: ReadonlyArray<string>) {
  // values.push("hello!"); // 报错
}

// ==================== 类型参数的约束条件 ====================

function comp<T extends { length: number }>(a: T, b: T) {
  if (a.length >= b.length) {
    return a;
  }
  return b;
}

comp([1, 2], [1, 2, 3]); // 正确
comp("ab", "abc"); // 正确
// comp(1, 2); // 报错

// 约束条件与默认值
type Fn2<A extends string, B extends string = "world"> = [A, B];
type Result = Fn2<"hello">; // ["hello", "world"]

// 一个类型参数的约束条件可以引用其他参数
// <T, U extends T> // 正确
// <T extends U, U> // 正确
// <T extends T> // 报错

// ==================== 使用注意点 ====================

// 类型参数需要出现两次
// function greet<Str extends string>(s: Str) {
//   console.log("Hello, " + s);
// }
// 上面的 Str 只用了一次，不必要

function greet(s: string) {
  console.log("Hello, " + s);
}

// 泛型可以嵌套
type OrNull<Type> = Type | null;
type OneOrMany<Type> = Type | Type[];
type OneOrManyOrNull<Type> = OrNull<OneOrMany<Type>>;
