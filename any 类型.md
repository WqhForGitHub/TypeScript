# any 类型

```typescript
let notSure: any = 4;
notSure = "maybe a string instead";
notSure = false;
```

<br>

<br>

# unknown 类型

1. unknown 跟 any 的相似之处，在于所有类型的值都可以分配给 unknown 类型。

```typescript
let x:unknown;

x = true; // 正确
x = 42; // 正确
x = "Hello World"; // 正确
```

上面的示例中，变量 x 的类型是 unknown，可以赋值为各种类型的值。这与 any 的行为一致。

unknown 类型跟 any 类型的不同之处在于，它不能直接使用。主要有以下几个限制。

首先，unknown 类型的变量，不能直接赋值给其他类型的变量（除了 any 类型和 unknown 类型）。

```typescript
let v:unknown = 123;

let v1:boolean = v; // 报错
let v2:number = v; // 报错
```

上面示例中，变量 v 是 unknown 类型，赋值给 any 和 unknown 以外类型的变量都会报错，这就避免了污染问题，从而克服了 any 类型的一大缺点。

其次，不能直接调用 unknown 类型变量的方法和属性。

```typescript
let v1:unknown = { foo: 123 };
v1.foo; // 报错

let v2:unknown = "hello";
v2.trim(); // 报错

let v3:unknown = (n = 0) => n + 1;
v3(); // 报错
```

上面示例中，直接调用 unknown 类型变量的属性和方法，或者直接当作函数执行，都会报错。

再次，unknown 类型变量能够进行的运算是有限的，只能进行比较运算（运算符 ==、===、!=、!==、||、&&、?）、取反运算（运算符 !）、typeof 运算符和 instanceof 运算符这几种，其他运算都会报错。

```typescript
let a:unknown = 1;

a + 1; // 报错
a === 1; // 正确
```



```typescript
function greet(name: unknown) {
    if (typeof name === "string") {
        console.log(`Hello, ${name}!`);
    }
}

greet("John"); // 输出: Hello, John!
greet(123); // 没有输出
```

<br>

<br>

# never 类型

```typescript
// 返回 never 的函数必须存在无法达到的终点
function error(message: string): never{
    throw new Error(message);
}

// 推断的返回值类型为 never
function fail() {
    return error("Something failed");
}

// 返回 never 的函数同样无法被执行到终点
function infiniteLoop(): never {
    while (true) {}
}
```



