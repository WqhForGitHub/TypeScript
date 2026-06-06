// TypeScript 对象类型示例

// ==================== 基本对象类型 ====================

const obj: {
  x: number;
  y: number;
} = { x: 1, y: 1 };

// 使用 type 命令
type MyObj = {
  x: number;
  y: number;
};
const o1: MyObj = { x: 1, y: 1 };

// 使用 interface
interface MyObj2 {
  x: number;
  y: number;
}
const o2: MyObj2 = { x: 1, y: 1 };

// 不能缺少或多余属性
// const bad1: MyObj = { x: 1 }; // 报错，缺少 y
// const bad2: MyObj = { x: 1, y: 1, z: 1 }; // 报错，多了 z

// 对象方法
const objWithMethod: {
  x: number;
  y: number;
  add(x: number, y: number): number;
} = {
  x: 1,
  y: 1,
  add(x, y) {
    return x + y;
  },
};

// 使用方括号读取属性类型
type User = {
  name: string;
  age: number;
};
type Name = User["name"]; // string

// ==================== 可选属性 ====================

const optionalObj: {
  x: number;
  y?: number;
} = { x: 1 };

// 可选属性等同于允许赋值为 undefined
type UserWithOptional = {
  firstName: string;
  lastName?: string; // 等同于 lastName?: string | undefined
};

// 读取可选属性前需要判断
const user: {
  firstName: string;
  lastName?: string;
} = { firstName: "Foo" };

if (user.lastName !== undefined) {
  console.log(`hello ${user.firstName} ${user.lastName}`);
}

// 使用 ?? 设置默认值
let lastName = user.lastName ?? "Bar";

// 可选属性 vs undefined 必选属性
type A = { x: number; y?: number };
type B = { x: number; y: number | undefined };
const objA: A = { x: 1 }; // 正确
// const objB: B = { x: 1 }; // 报错，必须写 y

// ==================== 只读属性 ====================

const readonlyObj: {
  readonly age: number;
} = { age: 20 };
// readonlyObj.age = 21; // 报错

// readonly 只禁止完全替换，不禁止修改对象内部属性
interface Home {
  readonly resident: {
    name: string;
    age: number;
  };
}
const h: Home = {
  resident: { name: "Vicky", age: 42 },
};
h.resident.age = 32; // 正确
// h.resident = { name: "Kate", age: 23 }; // 报错

// as const 生成只读对象
const constObj = {
  name: "Sabrina",
} as const;
// constObj.name = "Cynthia"; // 报错

// ==================== 属性名索引类型 ====================

type StringIndexed = {
  [property: string]: string;
};
const indexed: StringIndexed = {
  foo: "a",
  bar: "b",
};

// 数值索引
type NumberIndexed = {
  [n: number]: number;
};
const numArr: NumberIndexed = [1, 2, 3];

// 数值索引必须兼容字符串索引
// type BadIndex = {
//   [x: number]: boolean; // 报错
//   [x: string]: string;
// };

// 具体属性必须兼容索引
// type BadProp = {
//   foo: boolean; // 报错
//   [x: string]: string;
// };

// ==================== 解构赋值 ====================

const product = { id: "1", name: "test", price: 100 };
const { id, name, price }: {
  id: string;
  name: string;
  price: number;
} = product;

// 解构中的冒号是重命名，不是类型
let { x: foo, y: bar }: { x: string; y: number } = { x: "hi", y: 1 };

// ==================== 结构类型原则 ====================

// 只要对象 B 满足对象 A 的结构，B 就兼容 A
type ShapeA = { x: number };
type ShapeB = { x: number; y: number };

const bObj = { x: 1, y: 1 };
const aObj: { x: number } = bObj; // 正确

// ==================== 严格字面量检查 ====================

// 字面量对象会触发严格检查
// const bad: { x: number; y: number } = { x: 1, y: 1, z: 1 }; // 报错

// 变量赋值不会触发严格检查
const myPoint = { x: 1, y: 1, z: 1 };
const point: { x: number; y: number } = myPoint; // 正确

// 使用类型断言规避
const asserted: { x: number } = { x: 1, y: 1 } as { x: number };

// ==================== 最小可选属性规则 ====================

type Options = {
  a?: number;
  b?: number;
  c?: number;
};
// const opts = { d: 123 };
// const optObj: Options = opts; // 报错，没有共同属性

// ==================== 空对象 ====================

const emptyObj = {};
// emptyObj.prop = 123; // 报错

// 空对象是 Object 的简写
let empty: {};
empty = {};
empty = { x: 1 };
empty = "hello";

// 强制没有任何属性的对象
interface WithoutProperties {
  [key: string]: never;
}
// const wp: WithoutProperties = { prop: 1 }; // 报错
