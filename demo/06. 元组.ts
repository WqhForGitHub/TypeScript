// TypeScript 元组类型示例

// ==================== 基本元组 ====================

// 元组：成员类型写在方括号里面
const s: [string, string, boolean] = ["a", "b", true];

// 数组 vs 元组的区别
let a: number[] = [1];   // 数组，类型写在外面
let t: [number] = [1];   // 元组，类型写在里面

// 元组必须显式声明类型，否则会被推断为数组
let inferred = [1, true]; // 推断为 (number | boolean)[]

// ==================== 可选成员 ====================

// 使用 ? 表示可选成员，必须在尾部
let opt: [number, number?] = [1];
type myTuple = [number, number, number?, string?];

// ==================== 扩展运算符 ====================

// 不限成员数量的元组
type NamedNums = [string, ...number[]];
const a1: NamedNums = ["A", 1, 2];
const a2: NamedNums = ["B", 1, 2, 3];

// 扩展运算符可以在任意位置
type t1 = [string, number, ...boolean[]];
type t2 = [string, ...boolean[], number];
type t3 = [...boolean[], string, number];

// ==================== 成员名 ====================

// 成员名只是说明性的，没有实际作用
type Color = [red: number, green: number, blue: number];
const c: Color = [255, 255, 255];

// ==================== 读取成员类型 ====================

type Tuple = [string, number];
type Age = Tuple[1]; // number

type Tuple2 = [string, number, Date];
type TupleEl = Tuple2[number]; // string | number | Date

// ==================== 只读元组 ====================

// 写法一
type readonlyTuple1 = readonly [number, string];

// 写法二
type readonlyTuple2 = Readonly<[number, string]>;

// 元组可以赋值给只读元组，反之不行
type t1type = readonly [number, number];
type t2type = [number, number];
let x: t2type = [1, 2];
let y: t1type = x; // 正确
// x = y; // 报错

// ==================== 成员数量推断 ====================

// 没有可选成员和扩展运算符时，TypeScript 可以推断成员数量
function f(point: [number, number]) {
  // if (point.length === 3) {} // 报错，TypeScript 知道长度是 2
}

// 有可选成员时，推断可能的长度
function f2(point: [number, number?, number?]) {
  // if (point.length === 4) {} // 报错，可能的长度是 1|2|3
}

// 使用扩展运算符时，无法推断成员数量
const myTuple: [...string[]] = ["a", "b", "c"];
if (myTuple.length === 4) {
  // 正确
}

// ==================== 扩展运算符与函数参数 ====================

function add(x: number, y: number) {
  return x + y;
}

// 使用元组解决扩展运算符参数数量问题
const arr: [number, number] = [1, 2];
add(...arr); // 正确

// 使用 as const 断言
const arr2 = [1, 2] as const;
// add(...arr2); // 正确，类型为 readonly [1, 2]
