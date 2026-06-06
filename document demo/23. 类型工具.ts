// TypeScript 类型工具示例

// ==================== Awaited<Type> ====================

type AwaitedA = Awaited<Promise<string>>; // string
type AwaitedB = Awaited<Promise<Promise<number>>>; // number
type AwaitedC = Awaited<boolean | Promise<number>>; // number | boolean

// ==================== ConstructorParameters<Type> ====================

type CP1 = ConstructorParameters<new (x: string, y: number) => object>; // [x: string, y: number]
type CP2 = ConstructorParameters<new (x?: string) => object>; // [x?: string | undefined]

type CP3 = ConstructorParameters<ErrorConstructor>; // [message?: string]
type CP4 = ConstructorParameters<any>; // unknown[]
type CP5 = ConstructorParameters<never>; // never

// ==================== Exclude<UnionType, ExcludedMembers> ====================

type Ex1 = Exclude<"a" | "b" | "c", "a">; // 'b'|'c'
type Ex2 = Exclude<"a" | "b" | "c", "a" | "b">; // 'c'
type Ex3 = Exclude<string | (() => void), Function>; // string

// ==================== Extract<UnionType, Union> ====================

type Ext1 = Extract<"a" | "b" | "c", "a">; // 'a'
type Ext2 = Extract<"a" | "b" | "c", "a" | "b">; // 'a'|'b'
type Ext3 = Extract<string | number, boolean>; // never

// ==================== InstanceType<Type> ====================

type IT1 = InstanceType<new () => object>; // object
type IT2 = InstanceType<ErrorConstructor>; // Error

class InstC {
  x = 0;
  y = 0;
}
type IT3 = InstanceType<typeof InstC>; // InstC

type IT4 = InstanceType<any>; // any
type IT5 = InstanceType<never>; // never

// ==================== NonNullable<Type> ====================

type NN1 = NonNullable<string | number | undefined>; // string|number
type NN2 = NonNullable<string[] | null | undefined>; // string[]
type NN3 = NonNullable<null | undefined>; // never

// ==================== Omit<Type, Keys> ====================

interface OmitA {
  x: number;
  y: number;
}

type Om1 = Omit<OmitA, "x">; // { y: number }
type Om2 = Omit<OmitA, "y">; // { x: number }
type Om3 = Omit<OmitA, "x" | "y">; // {}

// ==================== OmitThisParameter<Type> ====================

function toHex(this: number) {
  return this.toString(16);
}

type WithoutThis = OmitThisParameter<typeof toHex>; // () => string

// ==================== Parameters<Type> ====================

type P1 = Parameters<() => string>; // []
type P2 = Parameters<(s: string) => void>; // [s: string]
type P3 = Parameters<(a: number, b: number) => number>; // [a: number, b: number]
type P4 = Parameters<any>; // unknown[]
type P5 = Parameters<never>; // never

// ==================== Partial<Type> ====================

interface PartialA {
  x: number;
  y: number;
}

type PartialT = Partial<PartialA>; // { x?: number; y?: number }

// ==================== Pick<Type, Keys> ====================

interface PickA {
  x: number;
  y: number;
}

type Pick1 = Pick<PickA, "x">; // { x: number }
type Pick2 = Pick<PickA, "x" | "y">; // { x: number; y: number }

// ==================== Readonly<Type> ====================

interface ReadonlyA {
  x: number;
  y?: number;
}

type ReadonlyT = Readonly<ReadonlyA>; // { readonly x: number; readonly y?: number }

// 自定义 Mutable
type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

// Readonly 与 Partial 结合
interface Person3 {
  name: string;
  age: number;
}

const worker: Readonly<Partial<Person3>> = { name: "张三" };
// worker.name = "李四"; // 报错

// ==================== Record<Keys, Type> ====================

type Rec1 = Record<"a", number>; // { a: number }
type Rec2 = Record<"a" | "b", number>; // { a: number; b: number }
type Rec3 = Record<"a", number | string>; // { a: number|string }

// ==================== Required<Type> ====================

interface RequiredA {
  x?: number;
  y: number;
}

type RequiredT = Required<RequiredA>; // { x: number; y: number }

// ==================== ReadonlyArray<Type> ====================

const values: ReadonlyArray<string> = ["a", "b", "c"];
// values[0] = "x"; // 报错
// values.push("x"); // 报错

// ==================== ReturnType<Type> ====================

type RT1 = ReturnType<() => string>; // string
type RT2 = ReturnType<(s: string) => void>; // void
type RT3 = ReturnType<typeof Math.random>; // number
type RT4 = ReturnType<any>; // any
type RT5 = ReturnType<never>; // never

// ==================== ThisParameterType<Type> ====================

function toHex2(this: number) {
  return this.toString(16);
}

type TPT = ThisParameterType<typeof toHex2>; // number

// ==================== ThisType<Type> ====================

// ThisType 需要打开 noImplicitThis
// interface HelperThisValue {
//   logError: (error: string) => void;
// }
// let helperFunctions: { [name: string]: Function } & ThisType<HelperThisValue> = {
//   hello: function () {
//     this.logError("Error: Something wrong!"); // 正确
//     this.update(); // 报错
//   },
// };

// ==================== 字符串类型工具 ====================

type UpperA = "hello";
type UpperB = Uppercase<UpperA>; // "HELLO"

type LowerA = "HELLO";
type LowerB = Lowercase<LowerA>; // "hello"

type CapA = "hello";
type CapB = Capitalize<CapA>; // "Hello"

type UncapA = "HELLO";
type UncapB = Uncapitalize<UncapA>; // "hELLO"
