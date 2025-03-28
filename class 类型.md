# 简介

```typescript
class Animal {
    name: string;
    
    constructor(name: string) {
        this.name = name;
    }
    
    sayHello(): string {
        return `Hello, my name is ${this.name}`;
    }
}

const animal = new Animal("Dog");
console.log(animal.sayHello()); // 输出：Hello，my name is Dog
```

<br>

## 字段

```typescript
class Animal {
    name: string;
    age: number = 0;
    readonly numberOfLegs: number = 4;
    
    constructor(name: string) {
        this.name = name;
    }
}
```

<br>

<br>

# 类的 interface 接口

```typescript
interface AnimalInterface {
    name: string;
    age: number;
    sayHello(): string;
}

class Animal implements AnimalInterface {
    name: string;
    age: number;
    
    constructor(name: string, age: number) {
        this.name = name;
        this.age = age;
    }
    
    sayHello(): string {
        return `Hello, my name is ${this.name}, and I am ${this.age} years old.`;
    }
}

const animal = new Animal("Dog", 5);
console.log(animal.sayHello()); // 输出：Hello, my name is Dog, and I am 5 years old.
```

<br>

<br>

# Class 类型

<br>

<br>

# 类的继承

```typescript
class Animal {
    name: string;
    
    constructor(name: string) {
        this.name = name;
    }
    
    sayHello(): string {
        return `Hello, my name is ${this.name}`;
    }
}

class Dog extends Animal {
    breed: string;
    
    constructor(name: string, breed: string) {
        super(name);
        this.breed = breed;
    }
    
    bark(): string {
        return "Woof!";
    }
}

const dog = new Dog("Buddy", "Golden Retriever");
console.log(dog.sayHello()); // 输出：Hello, my name is Buddy
console.log(dog.bark()); // 输出：Woof!
```

<br>

<br>

# 可访问性修饰符

## public

```typescript
class Animal {
    public name: string;
    
    constructor(name: string) {
        this.name = name;
    }
    
    public sayHello(): string {
        return `Hello, my name is ${this.name}`;
    }
}

const animal = new Animal("Dog");
console.log(animal.name);
console.log(animal.sayHello());

class Dog extends Animal {
    constructor(name: string) {
        super(name);
        console.log(this.name);
    }
}
```

<br>

## private

```typescript
class Animal {
    private age: number;
    
    constructor(age: number) {
        this.age = age;
    }
    
    private getAge(): number {
        return this.age;
    }
    
    public showAge(): string {
        return `The age is ${this.getAge()}`;
    }
}

const animal = new Animal(5);
console.log(animal.showAge());

class Dog extends Animal {
    constructor(age: number) {
        super(age);
    }
}
```

<br>

## protected

```typescript
class Animal {
    protected numberOfLegs: number = 4;
    
    protected getNumberOfLegs(): number {
        return this.numberOfLegs;
    }
}

const animal = new Animal();

class Dog extends Animal {
    constructor() {
        super();
        console.log(this.numberOfLegs);
        console.log(this.getNumberOfLegs());
    }
}

const dog = new Dog();
```

<br>

<br>

# 静态成员

```typescript
class Circle {
    static pi: number = 3.14;
    
    constructor() {}
}

console.log(Circle.pi);
```

```typescript
class Circle {
    static pi: number = 3.14;
    
    constructor() {}
    
    static calculateArea(radius: number): number {
        return this.pi * radius * radius;
    }
}

console.log(Circle.calculateArea(5));
```

<br>

<br>

# 泛型类

```typescript
class DataHolder<T> {
    data: T;
    
    constructor(data: T) {
        this.data = data;
    }
    
    getData(): T {
        return this.data;
    }
}

const numberData = new DataHolder<number>(123);
console.log(numberData.getData()); // 输出：123

const stringData = new DataHolder<string>("hello");
console.log(stringData.getData()); // 输出：hello
```

<br>

<br>

# 抽象类、抽象成员

```typescript
abstract class Animal {
    abstract makeSound(): string;
    
    sayHello(): string {
        return `Hello, I am an animal.`;
    }
}
```

```typescript
abstract class Animal {
    abstract name: string;
    abstract makeSound(): string;
    
    sayHello(): string {
        return `Hello, I am an animal. My name is ${this.name}`;
    }
}

class Dog extends Animal {
    name: string = "Dog";
    makeSound(): string {
        return "Woof!";
    }
}

const dog = new Dog();
console.log(dog.sayHello()); // 输出：Hello, I am an animal. My name is Dog
console.log(dog.makeSound()); // 输出：Woof!
```

<br>

<br>

# this 问题

```typescript
class MyClass {
    name: string = "MyClass";
    
    myMethod() {
        console.log(this.name);
    }
    
    myCallback(callback: () => void) {
        callback();
    }
}

const myInstance = new MyClass();
myInstance.myMethod(); // 输出：MyClass

myInstance.myCallback(myInstance.myMethod);
```







