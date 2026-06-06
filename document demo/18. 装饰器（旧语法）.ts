// TypeScript 装饰器旧语法示例
// 需要 --experimentalDecorators 编译选项

// ==================== 类装饰器（旧语法） ====================

// function sealed(constructor: Function) {
//   Object.seal(constructor);
//   Object.seal(constructor.prototype);
// }

// @sealed
// class BugReport {
//   type = "report";
//   title: string;
//   constructor(t: string) {
//     this.title = t;
//   }
// }

// ==================== 方法装饰器（旧语法） ====================

// function enumerable(value: boolean) {
//   return function (
//     target: any,
//     propertyKey: string,
//     descriptor: PropertyDescriptor
//   ) {
//     descriptor.enumerable = value;
//   };
// }

// class Greeter {
//   greeting: string;
//   constructor(message: string) {
//     this.greeting = message;
//   }
//   @enumerable(false)
//   greet() {
//     return "Hello, " + this.greeting;
//   }
// }

// ==================== 属性装饰器（旧语法） ====================

// function format(formatString: string) {
//   return function (target: any, propertyKey: string) {
//     // ...
//   };
// }

// class Greeter2 {
//   @format("Hello, %s")
//   greeting: string;
// }

// ==================== 参数装饰器（旧语法） ====================

// function required(target: any, propertyKey: string, parameterIndex: number) {
//   // ...
// }

// class Foo {
//   greet(@required name: string) {
//     return "Hello " + name;
//   }
// }

// 注意：旧语法装饰器需要 --experimentalDecorators 编译选项
// $ tsc --target ES5 --experimentalDecorators
