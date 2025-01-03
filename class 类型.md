### 1. 简介

类（class）是面向对象编程的基本构件，封装了属性和方法，TypeScript 给予了全面支持。

#### 1. 属性的类型

类的属性可以在顶层声明，也可以在构造方法内部声明。

对于顶层声明的属性，可以在声明时同时给出类型。

```typescript
class Point {
    x:number;
    y:number;
}
```

上面声明中，属性 `x` 和 `y` 的类型都是 `number`。

如果不给出类型，TypeScript 会认为 `x` 和 `y` 的类型都是 `any`。

```typescript
class Point {
	x;
    y;
}
```

上面示例中，`x` 和 `y` 的类型都是 `any`。

如果声明时给出初值，可以不写类型，TypeScript 会自行推断属性的类型。

```typescript
class Point {
    x = 0;
    y = 0;
}
```

上面示例中，属性 `x` 和 `y` 的类型都会被推断为 number。

TypeScript 有一个配置项 `strictPropertyInitialization`，只要打开（默认是打开的），就会检查属性是否设置了初值，如果没有就报错。

```typescript
// 打开 strictPropertyInitialization

class Point {
    x: number; // 报错
    y: number; // 报错
}
```

上面示例中，如果类的顶层属性不赋值，就会报错。如果不希望出现报错，可以使用非空断言。

```typescript
class Point {
    x!: number;
    y!: number;
}
```

上面示例中，属性 `x` 和 `y` 没有初值，但是属性名后面添加了感叹号，表示这两个属性肯定不会为空，所以 TypeScript 就不报错了，详见《类型断言》一章。



#### 2. readonly 修饰符

属性名前面加上 readonly 修饰符，就表示该属性是只读的。实例对象不能修改这个属性。

```typescript
class A {
    readonly id = 'foo';
}

const a = new A();
a.id = 'bar'; // 报错
```

上面示例中，`id` 属性前面有 readonly 修饰符，实例对象修改这个属性就会报错。

readonly 属性的初始值，可以写在顶层属性，也可以写在构造方法里面。

```typescript
class A {
    readonly id:string;
    
    constructor() {
        this.id = 'bar'; // 正确
    }
}
```

上面示例中，构造方法内部设置只读属性的初值，这是可以的。

```typescript
class A {
    readonly id:string = 'foo';
    
    constructor() {
        this.id = 'bar'' // 正确
    }
}
```

上面示例中，构造方法修改只读属性的值也是可以的。或者说，如果两个地方都设置了只读属性的值，以构造方法为准。在其他方法修改只读属性都会报错。



#### 3. 方法的类型

类的方法就是普通函数，类型声明方式与函数一致。

```typescript
class Point {
    x:number;
    y:number;
    
    constructor(x:number, y:number) {
        this.x = x;
        this.y = y;
    }
    
    add(point:Point) {
        return new Point(
            this.x + point.x,
            this.y + point.y
        );
    }
}
```

上面示例中，构造方法 `constructor()` 和普通函数 `add()` 都注明了参数类型，但是省略了返回值类型，因为 TypeScript 可以自己推断出来。

类的方法跟普通函数一样，可以使用参数默认值，以及函数重载。

下面是参数默认值的例子。

```typescript
class Point {
    x: number;
    y: number;
    
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
}
```

上面示例中，如果新建实例时，不提供属性 `x` 和 `y` 的值，它们都等于默认值 `0`。

下面是函数重载的例子。

```typescript
class Point {
    constructor(x:number, y:string);
    constructor(s:string);
    constructor(xs:number|string, y?:string) {
        
    }
}
```

上面示例中，构造方法可以接受一个参数，也可以接受两个参数，采用函数重载进行类型声明。

另外，构造方法不能声明返回值类型，否则报错，因为它总是返回实例对象。

```typescript
class B {
	constructor():object { // 报错
        
    }
}
```

上面示例中，构造方法声明了返回值类型 `object`，导致报错。



#### 4. 存取器方法

存取器（accessor）是特殊的类方法，包括取值器（getter）和存值器（setter）两种方法。

它们用于读写某个属性，取值器用来读取属性，存值器用来写入属性。

```typescript
class C {
    _name = '';
    get name() {
        return this._name;
    }
    
    set name(value) {
        this._name = value;
    }
}
```

上面示例中，`get name()` 是取值器，其中 `get` 是关键词，`name` 是属性名。外部读取 `name` 属性时，实例对象会自动调用这个方法，该方法的返回值就是 `name` 属性的值。

`set name()` 是存值器，其中 `set` 是关键词，`name` 是属性名。外部写入 `name` 属性时，实例对象会自动调用这个方法，并将所赋的值作为函数参数传入。

TypeScript 对存取器有以下规则。

（1）如果某个属性只有 `get` 方法，没有 `set` 方法，那么该属性自动成为只读属性。

```typescript
class C {
    _name: 'foo';
    
    get name() {
        return this._name;
    }
}

const c = new C();
c.name = 'bar'; // 报错
```

上面示例中，`name` 属性没有 `set` 方法，对该属性赋值就会报错。

（2）TypeScript 5.1 版之前，`set` 方法的参数类型，必须兼容 `get` 方法的返回值类型，否则报错。

```typescript
// TypeScript 5.1 版之前

class C {
    _name = '';
    
    get name():string { // 报错
        return this._name;
    }
    
    set name(value:number) {
        this._name = String(value);
    }
}
```

上面示例中，`get` 方法的返回值类型是字符串，与 `set` 方法的参数类型是 `number` 不兼容，导致报错。改成下面这样，就不会报错。

```typescript
class C {
    _name = '';
    
    get name():string {
        return this._name;
    }
    
    set name(value:number|string) {
        this._name = String(value);
    }
}
```

上面示例中，`set` 方法的参数类型（`number|string`）兼容 `get` 方法的返回值类型（`string`），这是允许的。

TypeScript 5.1 版做出了改变，现在两者可以不兼容。

（3）`get` 方法与 `set` 方法的可访问性必须一致，要么都为公开方法，要么都为私有方法。



#### 5. 属性索引

类允许定义属性索引。

```typescript
class MyClass {
    [s:string]: boolean | ((s:string) => boolean);
    
    get(s:string) {
        return this[s] as boolean;
    }
}
```

上面示例中，`[s:string]` 表示所有属性名类型为字符串的属性，它们的属性值要么是布尔值，要么是返回布尔值的函数。

注意，由于类的方法是一种特殊属性（属性值为函数的属性），所以属性索引的类型定义也涵盖了方法。如果一个对象同时定义了属性索引和方法，那么前者必须包含后者的类型。

```typescript
class MyClass {
    [s:string]: boolean;
    
    f() { // 报错
        return true;
    }
}
```

上面示例中，属性索引的类型里面不包括方法，导致后面的方法 `f()` 定义直接报错。正确的写法是下面这样。

```typescript
class MyClass {
    [s:string]: boolean | (() => boolean);
    
    f() {
        return true;
    }
}
```

属性存取器视同属性。

```typescript
class MyClass {
    [s:string]: boolean;
    
    get isInstance() {
        return true;
    }
}
```

上面示例中，属性 `inInstance` 的读取器虽然是一个函数方法，但是视同属性，所以属性索引虽然没有涉及方法类型，但是不会报错。





### 2. 类的 interface 接口

#### 1. implements 关键字

interface 接口或 type 别名，可以用对象的形式，为 class 指定一组检查条件。然后，类使用 implements 关键字，表示当前类满足这些外部类型条件的限制。

```typescript
interface Country {
    name:string;
    capital:string;
}

// 或者
type Country = {
    name:string;
    capital:string;
}

class MyCountry implements Country {
    name = '';
    capital = '';
}
```

上面示例中，`interface` 或 `type` 都可以定义一个对象类型。类 `MyCountry` 使用 `implements` 关键字，表示该类的实例对象满足这个外部类型。

interface 只是指定检查条件，如果不满足这些条件就会报错。它并不能代替 class 自身的类型声明。

```typescript
interface A {
    get(name:string): boolean;
}

class B implements A {
    get(s) { // s 的类型是 any
        return true;
    }
}
```

上面示例中，类 `B` 实现了接口 `A`，但后者并不能代替 `B` 的类型声明。因此，`B` 的 `get()` 方法的参数 `s` 的类型是 `any`，而不是 `string`。`B` 类依然需要声明参数 `s` 的类型。

```typescript
class B implements A {
    get(s:string) {
        return true;
    }
}
```

下面是另一个例子。

```typescript
interface A {
    x: number;
    y?: number;
}

class B implements A {
    x = 0;
}

const b = new B();
b.y = 10; // 报错
```

上面示例中，接口 `A` 有一个可选属性 `y`，类 `B` 没有声明这个属性，所以可以通过类型检查。但是，如果给 `B` 的实例对象的属性 `y` 赋值，就会报错。所以，`B` 类还是需要声明可选属性 `y`。

```typescript
class B implements A {
    x = 0;
    y?: number;
}
```

同理，类可以定义接口没有声明的方法和属性。

```typescript
interface Point {
    x: number;
    y: number;
}

class MyPoint implements Point {
    x = 1;
    y = 1;
    z:number = 1;
}
```

上面示例中，`MyPoint` 类实现了 `Point` 接口，但是内部还定义了一个额外的属性 `z`，这是允许的，表示除了满足接口给出的条件，类还有额外的条件。

`implements` 关键字后面，不仅可以是接口，也可以是另一个类。这时，后面的类将被当作接口。

```typescript
class Car {
    id:number = 1;
    move():void {};
}

class MyCar implements Car {
    id = 2; // 不可省略
    move():void {}; // 不可省略
}
```

上面示例中，`implements` 后面是类 `Car`，这时 TypeScript 就把 `Car` 视为一个接口，要求 `MyCar` 实现 `Car` 里面的每一个属性和方法，否则就会报错，所以，这时不能因为 `Car` 类已经实现过一次，而在 `MyCar` 类省略属性或方法。

注意，interface 描述的是类的对外接口，也就是实例的公开属性和公开方法，不能定义私有的属性和方法。这是因为 TypeScript 设计者认为，私有属性是类的内部实现，接口作为模板，不应该涉及类的内部代码写法。

```typescript
interface Foo {
    private member:{}; // 报错
}
```

上面示例中，接口 `Foo` 有一个私有属性，结果就报错了。



#### 2. 实现多个接口

类可以实现多个接口（其实是接受多重限制），每个接口之间使用逗号分隔。

```typescript
class Car implements MotorVehicle, Flyable, Swimmable {
    
}
```

上面示例中，`Car` 类同时实现了 `MotorVehicle`、`Flyable`、`Swimmable` 三个接口。这意味着，它必须部署这三个接口声明的所有属性和方法，满足它们的所有条件。

但是，同时实现多个接口并不是一个好的写法，容易使得代码难以管理，可以使用两种方法替代。

第一种方法是类的继承。

```typescript
class Car implements MotorVehicle {
    
}

class SecretCar extends Car implements Flyable, Swimmable {
    
}
```

上面示例中，`Car` 类实现了 `MotorVehicle`，而 `SecretCar` 类继承了 `Car` 类，然后再实现 `Flyable` 和 `Swimmable` 两个接口，相当于 `SecretCar` 类同时实现了三个接口。

第二种方法是接口的继承。

```typescript
interface A {
	a:number;
}

interface B extends A {
    b:number;
}
```

上面示例中，接口 `B` 继承了接口 `A`，类只要实现接口 `B`，就相当于实现 `A` 和 `B` 两个接口。

前一个例子可以用接口继承改写。

```typescript
interface MotorVehicle {
    
}

interface Flyable {
    
}

interface Swimmable {
    
}

interface SuperCar extends MotorVehicle,Flyable,Swimmable {
    
}

class SecretCar implements SuperCar {
    
}
```

上面示例中，类 `SecretCar` 通过 `SuperCar` 接口，就间接实现了多个接口。

注意，发生多重实现时（即一个接口同时实现多个接口），不同接口不能有互相冲突的属性。

```typescript
interface Flyable {
    foo:number;
}

interface Swimmable {
    foo:string;
}
```

上面示例中，属性 `foo` 在两个接口里面的类型不同，如果同时实现这两个接口，就会报错。



#### 3. 类与接口的合并

TypeScript 不允许两个同名的类，但是如果一个类和一个接口同名，那么接口会被合并进类。

```typescript
class A {
    x:number = 1;
}

interface A {
    y:number;
}

let a = new A();
a.y = 10;

a.x // 1
a.y // 10
```

上面示例中，类 `A` 与接口 `A` 同名，后者会被合并进前者的类型定义。

注意，合并进类的非空属性（上例的 `y`），如果在赋值之前读取，会返回 `undefined`。

```typescript
class A {
    x:number = 1;
}

interface A {
    y:number;
}

let a = new A();
a.y // undefined
```

上面示例中，根据类型定义，`y` 应该是一个非空属性。但是合并后，`y` 有可能是 `undefined`。



### 3. Class 类型

#### 1. 实例类型

TypeScript 的类本身就是一种类型，但是它代表该类的实例类型，而不是 class 的自身类型。

```typescript
class Color {
    name:string;
    
    constructor(name:string) {
        this.name = name;
    }
}

const green:Color = new Color('green');
```

上面示例中，定义了一个类 `Color`。它的类名就代表一种类型，实例对象 `green` 就属于该类型。

对于引用实例对象的变量来说，既可以声明类型为 Class，也可以声明类型为 Interface，因为两者都代表实例对象的类型。

```typescript
interface MotorVehicle {
    
}

class Car implements MotorVehicle {
    
}

// 写法一
const c1:Car = new Car();

// 写法二
const c2:MotorVehicle = new Car();
```

上面示例中，变量的类型可以写成类 `Car`，也可以写成接口 `MotorVehicle`。它们的区别是，如果类 `Car` 有接口 `MotorVehicle` 没有的属性和方法，那么只有变量 `c1` 可以调用这些属性和方法。

作为类型使用时，类名只能表示实例的类型，不能表示类的自身类型。

```typescript
class Point {
    x:number;
    y:number;
    
    constructor(x:number, y:number) {
        this.x = x;
        this.y = y;
    }
}

// 错误
function createPoint(
	PointClass:Point,
    x: number,
    y: number
) {
    return new PointClass(x, y);
}
```

上面示例中，函数 `createPoint()` 的第一个参数 `PointClass`，需要传入 Point 这个类，但是如果把参数的类型写成 `Point` 就会报错，因为 `Point` 描述的是实例类型，而不是 Class 的自身类型。

由于类名作为类型使用，实际上代表一个对象，因此可以把类看作为对象类型起名。事实上，TypeScript 有三种方法可以为对象类型起名：type、interface 和 class。



#### 2. 类的自身类型

要获得一个类的自身类型，一个简便的方法就是使用 typeof 运算符。

```typescript
function createPoint(
	PointClass:typeof Point,
    x:number,
    y:number
):Point {
    return new PointClass(x, y);
}
```

上面示例中，`createPoint()` 的第一个参数 `PointClass` 是 `Point` 类自身，要声明这个参数的类型，简便的方法就是使用 `typeof Point`。因为 `Point` 类是一个值，`typeof Point` 返回这个值的类型。注意，`createPoint()` 的返回值类型是 `Point`，代表实例类型。

JavaScript 语言中，类只是构造函数的一种语法糖，本质上是构造函数的另一种写法。所以，类的自身类型可以写成构造函数的形式。

```typescript
function createPoint(
	PointClass: new (x:number, y:number) => Point,
    x: number,
    y: number
):Point {
    return new PointClass(x, y);
}
```

上面示例中，参数 `PointClass` 的类型写成了一个构造函数，这时就可以把 `Point` 类传入。

构造函数也可以写成对象形式，所以参数 `PointClass` 的类型还有另一种写法。

```typescript
function createPoint(
	PointClass: {
        new (x:number, y:number): Point
    },
    x: number,
    y: number
):Point {
    return new PointClass(x, y);
}
```

根据上面的写法，可以把构造函数提取出来，单独定义一个接口（interface），这样可以大大提高代码的通用性。

```typescript
interface PointConstructor {
    new(x:number, y:number):Point;
}

function createPoint(
	PointClass: PointConstructor,
    x: number,
    y: number
):Point {
    return new PointClass(x, y);
}
```

总结一下，类的自身类型就是一个构造函数，可以单独定义一个接口来表示。



#### 3. 结构类型原则

Class 也遵循结构类型原则。一个对象只要满足 Class 的实例结构，就跟该 Class 属于同一个类型。

```typescript
class Foo {
    id!:number;
}

function fn(arg:Foo) {
    
}

const bar = {
    id: 10,
    amount: 100,
};

fn(bar); // 正确
```

上面示例中，对象 `bar` 满足类 `Foo` 的实例结构，只是多了一个属性 `amount`。所以，它可以当作参数，传入函数 `fn()`。

如果两个类的实例结构相同，那么这两个类就是兼容的，可以用在对方的使用场合。

```typescript
class Person {
    name: string;
}

class Customer {
    name: string;
}

// 正确
const cust:Customer = new Person();
```

上面示例中，`Person` 和 `Customer` 是两个结构相同的类，TypeScript 将它们视为相同类型，因此 `Person` 可以用在类型为 `Customer` 的场合。

现在修改一下代码，`Person` 类添加一个属性。

```typescript
class Person {
    name: string;
    age: number;
}

class Customer {
    name: string;
}

// 正确
const cust:Customer = new Person();
```

上面示例中，`Person` 类添加一个属性 `age`，跟 `Customer` 类的结构不再相同。但是这种情况下，TypeScript 依然认为，`Person` 属于 `Customer` 类型。

这是因为根据结构类型原则，只要 `Person` 类具有 `name` 属性，就满足 `Customer` 类型的实例结构，所以可以代替它。反过来就不行，如果 `Customer` 类多出一个属性，就会报错。

```typescript
class Person {
    name: string;
}

class Customer {
    name: string;
    age: number;
}

// 报错
const cust:Customer = new Person();
```

上面示例中，`Person` 类比 `Customer` 类少了一个属性 `age`，它就不满足 `Customer` 类型的实例结构，就报错了。因为在使用 `Customer` 类型的情况下，可能会用到它的 `age` 属性，而 `Person` 类就没有这个属性。

总之，只要 A 类具有 B 类的结构，哪怕还有额外的属性和方法，TypeScript 也认为 A 兼容 B 的类型。

不仅是类，如果某个对象跟某个 class 的实例结构相同，TypeScript 也认为两者的类型相同。

```typescript
class Person {
    name: string;
}

const obj = { name: 'John' };
const p:Person = obj; // 正确
```





















