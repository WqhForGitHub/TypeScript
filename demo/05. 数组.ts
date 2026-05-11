// TypeScript 数组类型示例

// ==================== 基本数组类型 ====================

// 写法一：类型后面加方括号
let arr1: number[] = [1, 2, 3];

// 写法二：使用 Array 接口（泛型写法）
let arr2: Array<number> = [1, 2, 3];

// 联合类型数组，需要用圆括号
let arr3: (number | string)[] = [1, "hello", 2, "world"];

// any 类型数组（应避免使用）
let arr4: any[] = [1, "hello", true];

// 复杂类型使用泛型写法可读性更好
let arr5: Array<number | string> = [1, "hello"];

// ==================== 数组类型推断 ====================

// 空数组推断为 any[]
const emptyArr = [];
emptyArr.push(123);     // 推断为 number[]
emptyArr.push("abc");   // 推断为 (string|number)[]

// 非空数组推断固定类型
const numArr = [123];   // 推断为 number[]
// numArr.push("abc");  // 报错

// ==================== 只读数组 ====================

// readonly 关键字
const readonlyArr: readonly number[] = [0, 1];
// readonlyArr[1] = 2;    // 报错
// readonlyArr.push(3);   // 报错
// delete readonlyArr[0]; // 报错

// number[] 是 readonly number[] 的子类型
let a1: number[] = [0, 1];
let a2: readonly number[] = a1; // 正确
// a1 = a2; // 报错

// ReadonlyArray<T> 泛型
const ra1: ReadonlyArray<number> = [0, 1];

// Readonly<T[]> 泛型
const ra2: Readonly<number[]> = [0, 1];

// readonly 不能与泛型写法一起使用
// const ra3: readonly Array<number> = [0, 1]; // 报错

// const 断言生成只读数组
const constArr = [0, 1] as const;
// constArr[0] = 2; // 报错

// ==================== 使用方括号读取成员类型 ====================

type Names = string[];
type Name = Names[0];      // string
type Name2 = Names[number]; // string

// ==================== 多维数组 ====================

var multi: number[][] = [
  [1, 2, 3],
  [23, 24, 25],
];

// ==================== 数组边界不检查 ====================

let arr: number[] = [1, 2, 3];
let foo = arr[3]; // 不会报错，越界访问
