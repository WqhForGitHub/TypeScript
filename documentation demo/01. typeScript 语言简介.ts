// TypeScript 语言简介示例

// ==================== 类型的概念 ====================

function addOne(n: number) {
  return n + 1;
}

// addOne("hello"); // 报错

// ==================== 动态类型与静态类型 ====================

// JavaScript 允许动态改变变量类型
// let x = 1;
// x = "hello"; // JS 中不报错

// TypeScript 中变量类型是静态的
let x = 1;
// x = "hello"; // 报错

// 对象属性也是静态的
let y = { foo: 1 };
// delete y.foo; // 报错
// y.bar = 2; // 报错

// ==================== 静态类型的优点 ====================

// 发现拼写错误
let obj = { message: "" };
// console.log(obj.messege); // 报错

// 发现语义错误
const a = 0;
const b = true;
// const result = a + b; // 报错

// 发现方法调用错误
function hello() {
  return "hello world";
}
// hello().find("hello"); // 报错
