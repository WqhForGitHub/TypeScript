# 1. any 类型

## 1.1 基本含义

any 类型表示没有任何限制，该类型的变量可以赋予任意类型的值。

```typescript
let x:any;

x = 1; // 正确
x = "foo"; // 正确
x = true; // 正确
```

上面示例中，变量 x 的类型是 any，就可以被赋值为任意类型的值。

变量类型一旦设为 any，TypeScript 实际上会关闭这个变量的类型检查。即使有明显的类型错误，只要句法正确，都不会报错。

```typescript
let x:any = "hello";

x(1); // 不报错
x.foo = 100; // 不报错
```



<br>

# 2. unknown 类型

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

上面示例中，unknown 类型的变量 a 进行加法运算会报错，因为这是不允许的运算。但是，进行比较运算就是可以的。

那么，怎么才能使用 unknown 类型变量呢？

答案是只有经过类型缩小，unknown 类型变量才可以使用。所谓类型缩小，就是缩小 unknown 变量的类型范围，确保不会出错。

```typescript
let a:unknown = 1;

if (typeof a === "number") {
    let r = a + 10; // 正确
}
```

上面示例中，unknown 类型的变量 a 经过 typeof 运算以后，能够确定实际类型是 number，就能用于加法运算了。这就是类型缩小，即将一个不确定的类型缩小为更明确的类型。

下面是另一个例子。

```typescript
let s:unknown = "hello";

if (typeof s === "string") {
    s.length; // 正确
}
```

上面示例中，确定变量 s 的类型为字符串以后，才能调用它的 length 属性。

这样设计的目的是，只有明确 unknown 变量的实际类型，才允许使用它，防止像 any 那样可以随意乱用，污染其他变量。类型缩小以后再使用，就不会报错。

总之，unknown 可以看作是更安全的 any。一般来说，凡是需要设为 any 类型的地方，通常都应该优先考虑设为 unknown 类型。

在集合论上，unknown 也可以视为所有其他类型（除了 any）的全集，所以它和 any 一样，也属于 Typescript 的顶层类型。

<br>

# 3. never 类型

为了保持与集合论的对应关系，以及类型运算的完整性，TypeScript 还引入了空类型的概念，即该类型为空，不包含任何值。

由于不存在任何属于空类型的值，所以该类型被称为 never，即不可能有这样的值。

```typescript
let x:never;
```

上面示例中，变量 x 的类型是 never，就不可能赋给它任何值，否则都会报错。

never 类型的使用场景，主要是在一些类型运算之中，保证类型运算的完整性，详见后面章节。另外，不可能返回值的函数，返回值的类型就可以写成 never，详见《函数》一章。

如果一个变量可能有多种类型（即联合类型），通常需要使用分支处理每一种类型。这时，处理所有可能的类型之后，剩余的情况就属于 never 类型。

```typescript
function fn(x: string | number) {
    if (typeof x === "string") {
        
    } else if (typeof x === "number") {
        
    } else {
        x; // never 类型
    }
}
```

上面示例中，参数变量 x 可能是字符串，也可能是数值，判断了这两种情况后，剩下的最后那个 else 分支里面，x 就是 never 类型了。

never 类型的一个重要特点是，可以赋值给任意其他类型。

```typescript
function f(): never {
    throw new Error("Error");
}

let v1:number = f(); // 不报错
let v2:string = f(); // 不报错
let v3:boolean = f(); // 不报错
```

上面示例中，函数 f() 会抛出错误，所以返回值类型可以写成 never，即不可能返回任何值。各种其他类型的变量都可以赋值为 f() 的运行结果（never 类型）。

为什么 never 类型可以赋值给任意其他类型呢？这也跟集合论有关，空集是任何集合的子集。TypeScript 就相应规定，任何类型都包含了 never 类型。因此，never 类型是任何其他类型所共有的，TypeScript 把这种情况称为底层类型。

总之，TypeScript 有两个顶层类型（any 和 unknown），但是底层类型只有 never 唯一一个。









