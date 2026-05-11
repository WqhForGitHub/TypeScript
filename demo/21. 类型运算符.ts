// TypeScript 类型运算符示例

// ==================== keyof 运算符 ====================

type MyObj = {
  foo: number;
  bar: string;
};

type Keys = keyof MyObj; // 'foo'|'bar'

// keyof any 返回 string|number|symbol
type KeyT = keyof any; // string | number | symbol

// keyof object 返回 never
type KeyObject = keyof object; // never

// 交叉类型与 keyof
type Capital<T extends string> = Capitalize<T>;
type MyKeys<Obj extends object> = Capital<string & keyof Obj>;

// keyof 用于索引类型
interface T2 {
  [prop: number]: number;
}
type KeyT2 = keyof T2; // number

// keyof 用于联合类型，返回共有键名
type A2 = { a: string; z: boolean };
type B2 = { b: string; z: boolean };
type CommonKeys = keyof (A2 | B2); // 'z'

// keyof 用于交叉类型，返回所有键名
type A3 = { a: string; x: boolean };
type B3 = { b: string; y: number };
type AllKeys = keyof (A3 & B3); // 'a' | 'x' | 'b' | 'y'

// 取出键值类型
type Values = MyObj[keyof MyObj]; // number|string

// keyof 精确表达属性类型
function prop<Obj, K extends keyof Obj>(obj: Obj, key: K): Obj[K] {
  return obj[key];
}

// keyof 用于属性映射
type NewProps<Obj> = {
  [Prop in keyof Obj]: boolean;
};

// ==================== in 运算符 ====================

type U = "a" | "b" | "c";
type Foo = {
  [Prop in U]: number;
};
// 等同于 { a: number; b: number; c: number }

// ==================== 方括号运算符 ====================

type Person2 = {
  age: number;
  name: string;
  alive: boolean;
};

type Age = Person2["age"]; // number
type T3 = Person2["age" | "name"]; // number|string
type T4 = Person2[keyof Person2]; // number|string|boolean

// 方括号参数为索引类型
type Obj2 = {
  [key: string]: number;
};
type T5 = Obj2[string]; // number

// 数组使用方括号运算符
const MyArray = ["a", "b", "c"];
type Str = (typeof MyArray)[number]; // string

// 方括号里不能有值的运算
// const key = 'age';
// type Bad = Person2[key]; // 报错

// ==================== extends...?: 条件运算符 ====================

type T6 = 1 extends number ? true : false; // true

interface Animal2 {
  live(): void;
}
interface Dog2 extends Animal2 {
  woof(): void;
}

type T7 = Dog2 extends Animal2 ? number : string; // number
type T8 = RegExp extends Animal2 ? number : string; // string

// 联合类型的条件运算会展开
type ToArray<Type> = Type extends any ? Type[] : never;
type T9 = ToArray<string | number>; // string[]|number[]

// 使用方括号避免展开
type ToArray2<Type> = [Type] extends [any] ? Type[] : never;
type T10 = ToArray2<string | number>; // (string|number)[]

// 条件运算符嵌套
type LiteralTypeName<T> = T extends undefined
  ? "undefined"
  : T extends null
    ? "null"
    : T extends boolean
      ? "boolean"
      : T extends number
        ? "number"
        : T extends bigint
          ? "bigint"
          : T extends string
            ? "string"
            : never;

// ==================== infer 关键字 ====================

type Flatten<Type> = Type extends Array<infer Item> ? Item : Type;
type Str2 = Flatten<string[]>; // string
type Num2 = Flatten<number>; // number

// infer 推断函数参数和返回值
type ReturnPromise<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => Promise<R>
  : T;

// infer 提取对象属性
type MyType<T> = T extends { a: infer M; b: infer N } ? [M, N] : never;
type Result = MyType<{ a: string; b: number }>; // [string, number]

// infer 与模板字符串
type Str3 = "foo-bar";
type Bar = Str3 extends `foo-${infer rest}` ? rest : never; // 'bar'

// ==================== is 运算符 ====================

interface Fish {
  swim(): void;
}
interface Bird {
  fly(): void;
}

function isFish(pet: Fish | Bird): pet is Fish {
  return (pet as Fish).swim !== undefined;
}

// is 用于类型保护
type TypeA = { a: string };
type TypeB = { b: string };

function isTypeA(x: TypeA | TypeB): x is TypeA {
  if ("a" in x) return true;
  return false;
}

// is 在类中使用
class Teacher {
  isStudent(): this is Student {
    return false;
  }
}

class Student {
  isStudent(): this is Student {
    return true;
  }
}

// ==================== 模板字符串 ====================

type World = "world";
type Greeting = `hello ${World}`; // "hello world"

// 模板字符串引用联合类型
type T11 = "A" | "B";
type U2 = `${T11}_id`; // "A_id"|"B_id"

// 引用两个联合类型
type T12 = "A" | "B";
type U3 = "1" | "2";
type V = `${T12}${U3}`; // 'A1'|'A2'|'B1'|'B2'

// ==================== satisfies 运算符 ====================

type Colors = "red" | "green" | "blue";
type RGB = [number, number, number];

const palette = {
  red: [255, 0, 0],
  green: "#00ff00",
  // bleu: [0, 0, 255], // satisfies 会报错，拼写错误
} satisfies Record<Colors, string | RGB>;

const greenComponent = palette.green.substring(1); // 正确

// satisfies 检测属性值
const palette2 = {
  red: [255, 0, 0],
  green: "#00ff00",
  // blue: [0, 0], // satisfies 会报错，RGB 需要三个成员
} satisfies Record<Colors, string | RGB>;
