// TypeScript namespace 示例

// ==================== 基本用法 ====================

namespace Utils {
  function isString(value: any) {
    return typeof value === "string";
  }
  isString("yes"); // 正确
}

// Utils.isString("no"); // 报错，需要 export

namespace Utility {
  export function log(msg: string) {
    console.log(msg);
  }
  export function error(msg: string) {
    console.error(msg);
  }
}

Utility.log("Call me");
Utility.error("maybe!");

// ==================== import 别名 ====================

namespace Utils2 {
  export function isString(value: any) {
    return typeof value === "string";
  }
}

namespace App {
  import isString = Utils2.isString;
  isString("yes");
}

// ==================== 嵌套命名空间 ====================

namespace Utils3 {
  export namespace Messaging {
    export function log(msg: string) {
      console.log(msg);
    }
  }
}

Utils3.Messaging.log("hello");

// ==================== namespace 包含类型 ====================

namespace N {
  export interface MyInterface {}
  export class MyClass {}
}

// ==================== namespace 的输出 ====================

export namespace Shapes {
  export class Triangle {
    // ...
  }
  export class Square {
    // ...
  }
}

// ==================== namespace 的合并 ====================

namespace Animals {
  export class Cat {}
}

namespace Animals {
  export interface Legged {
    numberOfLegs: number;
  }
  export class Dog {}
}

// 非 export 成员不被合并
namespace MergeN {
  const a = 0;
  export function foo() {
    console.log(a); // 正确
  }
}

namespace MergeN {
  export function bar() {
    foo(); // 正确
    // console.log(a); // 报错
  }
}

// namespace 与同名函数合并
function f() {
  return f.version;
}

namespace f {
  export const version = "1.0";
}

f(); // '1.0'
f.version; // '1.0'

// namespace 与同名 class 合并
class C {
  foo = 1;
}

namespace C {
  export const bar = 2;
}

C.bar; // 2

// namespace 与同名 Enum 合并
enum E {
  A,
  B,
  C,
}

namespace E {
  export function foo() {
    console.log(E.C);
  }
}

E.foo(); // 2
