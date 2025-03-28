# 简介

```typescript
interface Person {
    name: string;
    age: number;
    greet(message: string): string;
}

const person1: Person = {
    name: "Alice",
    age: 30,
    greet(message: string) {
        return `Hello, ${this.name}! ${message}`;
    }
};

console.log(person1.greet("How are you?")); // 输出：Hello, Alice! How are you?
```

<br>

<br>

# 可选属性

```typescript
interface Config {
    url: string;
    timeout?: number; // timeout 是可选属性
}

const config1: Config = { url: "https://example.com" };
const config2: Config = { url: "https://example.com", timeout: 5000 };
```

<br>

<br>

# 只读属性

```typescript
interface Point {
    readonly x: number;
    readonly y: number;
}

const point1: Point = { x: 10, y: 20 };
```

<br>

<br>

# interface 的继承

## interface 继承 interface

```typescript
interface ChildInterface extends ParentInterface {}
```

```typescript
interface Animal {
    name: string;
    eat(): void;
}

interface Dog extends Animal {
    breed: string;
    bark(): void;
}

const myDog: Dog = {
    name: "Buddy",
    breed: "Golden Retriever",
    eat() {
        console.log("Dog is eating");
    },
    bark() {
        console.log("Woof!");
    }
};

console.log(myDog.name); // 输出：Buddy
myDog.eat(); // 输出：Dog is eating
myDog.bark(); // 输出：Woof!
```

<br>

## interface 继承 type

```typescript
type AnimalType = {
    name: string;
    eat(): void;
};

interface Dog extends AnimalType {
    breed: string;
    bark(): void;
}

const myDog: Dog = {
    name: "Buddy",
    breed: "Goldren Retriever",
    eat() {
        console.log("Dog is eating");
    },
    bark() {
        console.log("Woof!");
    }
}
```

<br>

## interface 继承 class

```typescript
class A {
    x:string = "";
    
    y():boolean {
        return true;
    }
}

interface B extends A {
    z: number;
}
```

<br>

<br>

# 接口合并

```typescript
interface Person {
    name: string;
}

interface Person {
    age: number;
}

interface Person {
    greet(message: string): void;
}

const person: Person = {
    name: "Alice",
    age: 30,
    greet(message: string) {
        console.log(`Hello, ${this.name}! ${message}`);
    }
};

console.log(person.name); // 输出：Alice
console.log(person.age); // 输出：30
person.greet("How are you?"); // 输出：Hello, Alice! How are you?
```



```typescript
interface Document {
    createElement(tagName: any): Element;
}

interface Document {
    createElement(tagName: "div"): HTMLDivElement;
    createElement(tagName: "span"): HTMLSpanElement;
}

interface Document {
    createElement(tagName: string): HTMLElement;
    createElement(tagName: "canvas"): HTMLCanvasElement;
}
```

<br>

<br>

# interface 与 type 的异同

**`type 可以用来定义原始类型、联合类型和元组，而 interface 不能。`**

```typescript
type Name = string;
type NumOrString = number | string;
type Point = [number, number];
```

**`interface 和 type 都可以用来定义对象类型，但在语法上略有不同。`**

```typescript
interface Person {
    name: string;
    age: number;
}

type Person = {
    name: string;
    age: number;
}
```

**`type 和 interface 都可以用来定义函数类型，但推荐使用 type，因为它更简洁。`**

```typescript
type Add = (x: number, y: number) => number;

interface Add {
    (x: number, y: number): number;
}
```

**`interface 使用 extends 关键字来扩展，而 type 使用交叉类型（&）。`**

```typescript
interface Animal {
    name: string;
}

interface Dog extends Animal {
    bark(): void;
}

type Animal = {
    name: string;
};

type Dog = Animal & {
    bark(): void;
}
```

**`interface 支持声明合并，即可以多次声明同一个接口，TypeScript 编译器会自动它们合并成一个接口定义。这在扩展第三方库的类型定义时非常有用。`**

```typescript
interface Person {
    name: string;
}

interface Person {
    age: number;
}

const person: Person = {
    name: "John",
    age: 30
}
```







