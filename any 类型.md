# any 类型

```typescript
let notSure: any = 4;
notSure = "maybe a string instead";
notSure = false;
```

<br>

<br>

# unknown 类型

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



