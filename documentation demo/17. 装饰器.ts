// TypeScript 装饰器示例（标准语法，TS 5.0+）

// ==================== 简介 ====================

function simpleDecorator(value: any, context: any) {
  console.log(`hi, this is ${context.kind} ${context.name}`);
  return value;
}

@simpleDecorator
class DecoratedClass {} // "hi, this is class DecoratedClass"

// ==================== 装饰器的结构 ====================

// type Decorator = (
//   value: DecoratedValue,
//   context: {
//     kind: string;
//     name: string | symbol;
//     addInitializer?(initializer: () => void): void;
//     static?: boolean;
//     private?: boolean;
//     access: { get?(): unknown; set?(value: unknown): void };
//   },
// ) => void | ReplacementValue;

// ==================== 类装饰器 ====================

function Greeter(value: any, context: any) {
  if (context.kind === "class") {
    value.prototype.greet = function () {
      console.log("你好");
    };
  }
}

@Greeter
class User {
  // ...
}

let u = new (User as any)();
// u.greet(); // "你好"

// 类装饰器返回新的构造方法
function countInstances(value: any, context: any) {
  let instanceCount = 0;
  return class extends value {
    constructor(...args: any[]) {
      super(...args);
      instanceCount++;
      (this as any).count = instanceCount;
    }
  };
}

@countInstances
class MyClass {}

const inst1 = new MyClass();
// inst1.count; // 1

// ==================== 方法装饰器 ====================

function replaceMethod(value: any, context: ClassMethodDecoratorContext) {
  return function (this: any) {
    return `How are you, ${this.name}?`;
  };
}

class Person {
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  @replaceMethod
  hello() {
    return `Hi ${this.name}!`;
  }
}

const robin = new Person("Robin");
robin.hello(); // 'How are you, Robin?'

// 方法装饰器 - 日志
function log(originalMethod: any, context: ClassMethodDecoratorContext) {
  const methodName = String(context.name);
  function replacementMethod(this: any, ...args: any[]) {
    console.log(`LOG: Entering method '${methodName}'.`);
    const result = originalMethod.call(this, ...args);
    console.log(`LOG: Exiting method '${methodName}'.`);
    return result;
  }
  return replacementMethod;
}

// addInitializer - 绑定 this
function bound(originalMethod: any, context: ClassMethodDecoratorContext) {
  const methodName = context.name;
  if (context.private) {
    throw new Error(`不能绑定私有方法 ${String(methodName)}`);
  }
  context.addInitializer(function (this: any) {
    this[methodName] = this[methodName].bind(this);
  });
}

// ==================== 属性装饰器 ====================

function logged(value: any, context: any) {
  const { kind, name } = context;
  if (kind === "field") {
    return function (initialValue: any) {
      console.log(`initializing ${name} with value ${initialValue}`);
      return initialValue;
    };
  }
}

class Color {
  @logged name = "green";
}

const color = new Color();
// "initializing name with value green"

// 属性装饰器更改初始值
function twice() {
  return function (
    value: undefined,
    context: ClassFieldDecoratorContext
  ): (this: any, initialValue: any) => any {
    return function (initialValue) {
      return initialValue * 2;
    };
  };
}

class C2 {
  @twice()
  field = 3;
}

const inst2 = new C2();
inst2.field; // 6

// ==================== getter 装饰器 ====================

function lazy(value: any, { kind, name }: any) {
  if (kind === "getter") {
    return function (this: any) {
      const result = value.call(this);
      Object.defineProperty(this, name, {
        value: result,
        writable: false,
      });
      return result;
    };
  }
  return;
}

class C3 {
  @lazy
  get value() {
    console.log("正在计算……");
    return "开销大的计算结果";
  }
}

// ==================== accessor 装饰器 ====================

class C4 {
  accessor x = 1;
  // 等同于：
  // #x = 1;
  // get x() { return this.#x; }
  // set x(val) { this.#x = val; }

  static accessor y = 1;
}

// accessor 装饰器示例
function loggedAccessor(value: any, { kind, name }: any) {
  if (kind === "accessor") {
    let { get, set } = value;
    return {
      get() {
        console.log(`getting ${name}`);
        return get.call(this);
      },
      set(val: any) {
        console.log(`setting ${name} to ${val}`);
        return set.call(this, val);
      },
      init(initialValue: any) {
        console.log(`initializing ${name} with value ${initialValue}`);
        return initialValue;
      },
    };
  }
}

class C5 {
  @loggedAccessor accessor x = 1;
}

// ==================== 装饰器的执行顺序 ====================

// 1. 评估阶段：计算 @ 后面的表达式
// 2. 应用阶段：将装饰器应用于所装饰对象
// 应用顺序：方法装饰器和属性装饰器先执行，然后是类装饰器
// 多个装饰器：内层先执行，外层后执行
