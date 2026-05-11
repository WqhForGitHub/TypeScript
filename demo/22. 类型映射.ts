// TypeScript 类型映射示例

// ==================== 简介 ====================

type A = {
  foo: number;
  bar: number;
};

type B = {
  [prop in keyof A]: string;
};
// B 等同于 { foo: string; bar: string }

// 复制原始类型
type A2 = {
  foo: number;
  bar: string;
};

type B2 = {
  [prop in keyof A2]: A2[prop];
};

// 泛型映射
type ToBoolean<Type> = {
  [Property in keyof Type]: boolean;
};

// 联合类型映射
type MyObj = {
  [P in 0 | 1 | 2]: string;
};
// 等同于 { 0: string; 1: string; 2: string }

// 单个属性映射
type MyObj2 = {
  [p in "foo"]: number;
};
// 等同于 { foo: number }

// p in string 等同于属性名索引
type MyObj3 = {
  [p in string]: boolean;
};
// 等同于 { [p: string]: boolean }

// 映射添加可选属性
type A3 = {
  a: string;
  b: number;
};

type B3 = {
  [Prop in keyof A3]?: A3[Prop];
};

// Partial<T> 的实现
// type Partial<T> = {
//   [P in keyof T]?: T[P];
// };

// Readonly<T> 的实现
// type Readonly<T> = {
//   readonly [P in keyof T]: T[P];
// };

// ==================== 映射修饰符 ====================

// 映射会保留可选和只读属性
type A4 = {
  a?: string;
  readonly b: number;
};

type B4 = {
  [Prop in keyof A4]: A4[Prop];
};
// B4 等同于 { a?: string; readonly b: number }

// +? 添加可选属性
type Optional<Type> = {
  [Prop in keyof Type]+?: Type[Prop];
};

// -? 移除可选属性
type Concrete<Type> = {
  [Prop in keyof Type]-?: Type[Prop];
};

// +readonly 添加只读
type CreateImmutable<Type> = {
  +readonly [Prop in keyof Type]: Type[Prop];
};

// -readonly 移除只读
type CreateMutable<Type> = {
  -readonly [Prop in keyof Type]: Type[Prop];
};

// 同时增删 ? 和 readonly
type MyObjAdd<T> = {
  +readonly [P in keyof T]+?: T[P];
};

type MyObjRemove<T> = {
  -readonly [P in keyof T]-?: T[P];
};

// +? 可简写为 ?，+readonly 可简写为 readonly
type A5<T> = {
  +readonly [P in keyof T]+?: T[P];
};
// 等同于
type A6<T> = {
  readonly [P in keyof T]?: T[P];
};

// ==================== 键名重映射 ====================

// 修改键名
type RenameA = {
  foo: number;
  bar: number;
};

type RenameB = {
  [p in keyof RenameA as `${p}ID`]: number;
};
// 等同于 { fooID: number; barID: number }

// Getters 类型
interface Person2 {
  name: string;
  age: number;
  location: string;
}

type Getters<T> = {
  [P in keyof T as `get${Capitalize<string & P>}`]: () => T[P];
};

type LazyPerson = Getters<Person2>;
// { getName: () => string; getAge: () => number; getLocation: () => string }

// ==================== 属性过滤 ====================

type User2 = {
  name: string;
  age: number;
};

type Filter<T> = {
  [K in keyof T as T[K] extends string ? K : never]: string;
};

type FilteredUser = Filter<User2>; // { name: string }

// ==================== 联合类型的映射 ====================

type S = {
  kind: "square";
  x: number;
  y: number;
};

type C = {
  kind: "circle";
  radius: number;
};

type MyEvents<Events extends { kind: string }> = {
  [E in Events as E["kind"]]: (event: E) => void;
};

type Config = MyEvents<S | C>;
// { square: (event: S) => void; circle: (event: C) => void }
