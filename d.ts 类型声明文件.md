# 简介

**`myLib.js`**

```javascript
(function () {
    function makeGreeting(s) {
        return "Hello, " + s + "!";
    }
})(myLib || (myLib = {}));
```

**`myLib.d.ts`**

```typescript
declare namespace myLib {
    function makeGreeting(s: string): string;
    let numberOfGreetings: number;
}
```

**`app.ts`**

```typescript
/// <reference path="myLib.d.ts" />

let result = myLib.makeGreeting("hello, world");
console.log("The computed greeting is:" + result);
let count = myLib.numberOfGreetings;
```

