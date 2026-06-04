// TypeScript 注释指令示例

// ==================== @ts-nocheck ====================

// @ts-nocheck 告诉编译器不对当前脚本进行类型检查
// 在文件顶部添加：
// // @ts-nocheck

// ==================== @ts-check ====================

// @ts-check 对 JavaScript 脚本进行类型检查
// 在 JS 文件顶部添加：
// // @ts-check

// ==================== @ts-ignore ====================

// @ts-ignore 不对下一行代码进行类型检查
let tsIgnoreX: number;
tsIgnoreX = 0;
// @ts-ignore
tsIgnoreX = false; // 不报错

// ==================== @ts-expect-error ====================

// "@ts-expect-error" 压制下一行的类型错误
// 如果下一行没有错误，会显示提示
function doStuff2(abc: string, xyz: string) {
  // ...
}

// @ts-expect-error
doStuff2(123, 456);

// ==================== JSDoc ====================

// @typedef 创建自定义类型
/**
 * @typedef {(number | string)} NumberLike
 */

// @type 定义变量类型
/**
 * @type {string}
 */
let jsDocA;

// @param 定义函数参数类型
/**
 * @param {string}  x
 */
function jsDocFoo(x: string) {}

// 可选参数用方括号
/**
 * @param {string}  [x]
 */
function jsDocOptional(x?: string) {}

// @return / @returns 指定返回值类型
/**
 * @return {boolean}
 */
function jsDocReturn() {
  return true;
}

// @extends 定义继承
// class Base {}
/**
 * @extends {Base}
 */
// class Derived2 extends Base {}

// 可见性修饰符
class JSDocClass {
  /**
   * @public
   * @readonly
   */
  x = 0;

  /**
   * @protected
   */
  y = 0;
}
