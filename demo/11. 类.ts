// TypeScript 类类型示例

// ==================== 属性的类型 ====================

class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

// 给出初值可以省略类型
class Point2 {
  x = 0;
  y = 0;
}

// 非空断言
class Point3 {
  x!: number;
  y!: number;
}

// ==================== readonly 修饰符 ====================

class ReadonlyClass {
  readonly id = "foo";
}

const rc = new ReadonlyClass();
// rc.id = "bar"; // 报错

// readonly 可以在构造方法中赋值
class ReadonlyInit {
  readonly id: string;
  constructor() {
    this.id = "bar"; // 正确
  }
}

// ==================== 方法的类型 ====================

class PointWithMethod {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  add(point: PointWithMethod) {
    return new PointWithMethod(this.x + point.x, this.y + point.y);
  }
}

// 构造方法参数默认值
class DefaultPoint {
  constructor(x = 0, y = 0) {
    // ...
  }
}

// 构造方法重载
class OverloadPoint {
  constructor(x: number, y: string);
  constructor(s: string);
  constructor(xs: number | string, y?: string) {
    // ...
  }
}

// ==================== 存取器方法 ====================

class AccessorClass {
  _name = "";
  get name() {
    return this._name;
  }
  set name(value) {
    this._name = value;
  }
}

// 只有 get 的属性是只读的
class ReadOnlyAccessor {
  _name = "foo";
  get name() {
    return this._name;
  }
}
const roa = new ReadOnlyAccessor();
// roa.name = "bar"; // 报错

// ==================== implements 关键字 ====================

interface Country {
  name: string;
  capital: string;
}

class MyCountry implements Country {
  name = "";
  capital = "";
}

// implements 不能代替类自身的类型声明
interface A {
  get(name: string): boolean;
}
class B implements A {
  get(s: string) {
    // s 的类型需要手动声明
    return true;
  }
}

// 实现多个接口
interface MotorVehicle {
  // ...
}
interface Flyable {
  // ...
}
class Car implements MotorVehicle, Flyable {
  // ...
}

// ==================== 实例类型与类的自身类型 ====================

class Color {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
const green: Color = new Color("green");

// 类名代表实例类型，typeof 获取类的自身类型
function createPoint(PointClass: typeof Point, x: number, y: number): Point {
  return new PointClass(x, y);
}

// 构造函数类型
interface PointConstructor {
  new (x: number, y: number): Point;
}
function createPoint2(PC: PointConstructor, x: number, y: number): Point {
  return new PC(x, y);
}

// ==================== 结构类型原则 ====================

class Empty {}
function fn(x: Empty) {
  // ...
}
fn({});
fn(window);

// ==================== 类的继承 ====================

class Base {
  greet() {
    console.log("Hello, world!");
  }
}
class Derived extends Base {}
const d = new Base();
d.greet();

// 子类覆盖父类方法
class Extended extends Base {
  greet(name?: string) {
    if (name === undefined) {
      super.greet();
    } else {
      console.log(`Hello, ${name}`);
    }
  }
}

// ==================== override 关键字 ====================

class Parent {
  show() {}
  hide() {}
}
class Child extends Parent {
  override show() {}
  override hide() {}
}

// ==================== 可访问性修饰符 ====================

// public：公开（默认）
class PublicClass {
  public greet() {
    console.log("hi!");
  }
}

// private：私有，只能在类内部使用
class PrivateClass {
  private x: number = 0;
}
const pc = new PrivateClass();
// pc.x; // 报错

// ES2022 私有成员
class ESPrivate {
  #x = 1;
}
const esp = new ESPrivate();
// esp["x"]; // 报错

// protected：保护，子类内部可以使用
class ProtectedClass {
  protected x = 1;
}
class ProtectedChild extends ProtectedClass {
  getX() {
    return this.x; // 正确
  }
}

// ==================== 实例属性简写 ====================

class Shorthand {
  constructor(
    public a: number,
    protected b: number,
    private c: number,
    readonly d: number,
  ) {}
}

// ==================== 静态成员 ====================

class StaticClass {
  static x = 0;
  static printX() {
    console.log(StaticClass.x);
  }
}
StaticClass.x; // 0

// 静态私有
class StaticPrivate {
  private static x = 0;
  static #y = 0;
}

// ==================== 泛型类 ====================

class Box<Type> {
  contents: Type;
  constructor(value: Type) {
    this.contents = value;
  }
}
const box: Box<string> = new Box("hello!");

// 静态成员不能使用泛型类型参数
// class BadBox<Type> {
//   static data: Type; // 报错
// }

// ==================== 抽象类 ====================

abstract class AbstractClass {
  id = 1;
  abstract foo: string;
  abstract execute(): string;
}
// const ac = new AbstractClass(); // 报错

class ConcreteClass extends AbstractClass {
  foo = "b";
  execute() {
    return "Concrete executed";
  }
}

// ==================== this 问题 ====================

class ThisClass {
  name = "A";
  getName(this: ThisClass) {
    return this.name;
  }
}

// this 作为类型
class Chain {
  contents: string = "";
  set(value: string): this {
    this.contents = value;
    return this;
  }
}

// this is 类型
class FileSystemObject {
  isFile(): this is FileRep {
    return this instanceof FileRep;
  }
}
class FileRep extends FileSystemObject {}
