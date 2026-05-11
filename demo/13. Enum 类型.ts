// TypeScript Enum 类型示例

// ==================== 简介 ====================

enum Color {
  Red, // 0
  Green, // 1
  Blue, // 2
}

let c = Color.Green; // 1
let c2 = Color["Green"]; // 1

let c3: Color = Color.Green; // 正确
let c4: number = Color.Green; // 正确

// Enum 适用场景
enum Operator {
  ADD,
  DIV,
  MUL,
  SUB,
}

function compute(op: Operator, a: number, b: number) {
  switch (op) {
    case Operator.ADD:
      return a + b;
    case Operator.DIV:
      return a / b;
    case Operator.MUL:
      return a * b;
    case Operator.SUB:
      return a - b;
    default:
      throw new Error("wrong operator");
  }
}

compute(Operator.ADD, 1, 3); // 4

// as const 替代 Enum
const Bar = {
  A: 0,
  B: 1,
  C: 2,
} as const;

// ==================== Enum 成员的值 ====================

// 显式赋值
enum Color2 {
  Red = 0,
  Green = 1,
  Blue = 2,
}

// 成员的值可以是小数，不能是 BigInt
// enum BadColor {
//   Blue = 7n, // 报错
// }

// 只设定第一个成员的值
enum Color3 {
  Red = 7,
  Green, // 8
  Blue, // 9
}

// 成员的值可以使用计算式
enum Permission {
  UserRead = 1 << 8,
  UserWrite = 1 << 7,
}

// 成员值只读
// Color.Red = 4; // 报错

// ==================== const enum ====================

const enum Color4 {
  Red,
  Green,
  Blue,
}

const x = Color4.Red;
const y = Color4.Green;
// 编译后：const x = 0; const y = 1;

// ==================== 同名 Enum 的合并 ====================

enum Foo {
  A,
}

enum Foo {
  B = 1,
}

enum Foo {
  C = 2,
}

// 等同于
// enum Foo { A, B = 1, C = 2 }

// ==================== 字符串 Enum ====================

enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

// 字符串 Enum 所有成员值必须显式设置
// enum BadFoo {
//   A,
//   B = "hello",
//   C, // 报错
// }

// 字符串和数值混合赋值
enum MixedEnum {
  One = "One",
  Two = "Two",
  Three = 3,
  Four = 4,
}

// 字符串 Enum 变量不能赋值为字符串
enum MyEnum {
  One = "One",
  Two = "Two",
}

let s = MyEnum.One;
// s = "One"; // 报错

// 用联合类型替代字符串 Enum
function move(where: "Up" | "Down" | "Left" | "Right") {
  // ...
}

// ==================== keyof 运算符 ====================

enum KeyofEnum {
  A = "a",
  B = "b",
}

// 'A'|'B'
type FooKeys = keyof typeof KeyofEnum;

// 返回所有成员值
type FooValues = { [key in KeyofEnum]: any };
// { a: any, b: any }

// ==================== 反向映射 ====================

enum Weekdays {
  Monday = 1,
  Tuesday,
  Wednesday,
  Thursday,
  Friday,
  Saturday,
  Sunday,
}

console.log(Weekdays[3]); // Wednesday
// 注意：字符串 Enum 不存在反向映射
