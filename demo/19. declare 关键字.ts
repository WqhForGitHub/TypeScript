// TypeScript declare 关键字示例

// ==================== declare variable ====================

declare let x: number;
x = 1;

declare var document2: any;
// document2.title = "Hello";

// declare 不能设置初始值
// declare let bad: number = 1; // 报错

// ==================== declare function ====================

declare function sayHello(name: string): void;
sayHello("张三");

// ==================== declare class ====================

declare class Animal {
  constructor(name: string);
  eat(): void;
  sleep(): void;
}

declare class C {
  public static s0(): string;
  private static s1: string;
  public a: number;
  private b: number;
  constructor(arg: number);
  m(x: number, y: number): number;
  get c(): number;
  set c(value: number);
  [index: string]: any;
}

// ==================== declare namespace ====================

declare namespace AnimalLib {
  class Animal2 {
    constructor(name: string);
    eat(): void;
    sleep(): void;
  }
  type Animals = "Fish" | "Dog";
}

declare namespace myLib {
  function makeGreeting(s: string): string;
  let numberOfGreetings: number;
}

// ==================== declare module ====================

// 为没有类型的模块声明 any
// declare module "hot-new-module";

// 模块名可以使用通配符
// declare module "my-plugin-*" {
//   interface PluginOptions {
//     enabled: boolean;
//     priority: number;
//   }
//   function initialize(options: PluginOptions): void;
// }

// ==================== declare global ====================

// declare global 必须用在模块中
// export {};

// declare global {
//   interface String {
//     toSmallString(): string;
//   }
// }

// declare global {
//   interface Window {
//     myAppConfig: object;
//   }
// }

// ==================== declare enum ====================

declare enum E1 {
  A,
  B,
}

declare enum E2 {
  A = 0,
  B = 1,
}

declare const enum E3 {
  A,
  B,
}
