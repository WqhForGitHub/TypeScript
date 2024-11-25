let x: unknown;

x = true;
x = 42;
x = "hello World";

let a: unknown = 1;

if (typeof a === "number") {
  let r = a + 10;
  console.log("r: ", r);
}
