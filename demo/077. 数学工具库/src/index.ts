#!/usr/bin/env node
/**
 * 数学工具库 (Math Utils)
 * - 统计、向量、矩阵、几何、数论、随机、插值、舍入
 * - 仅依赖 Node.js 内置模块
 */
import * as fs from "fs";

/* ===================== Enums ===================== */

enum ErrorCode {
  InvalidInput = "INVALID_INPUT",
  DimensionMismatch = "DIMENSION_MISMATCH",
  NotInvertible = "NOT_INVERTIBLE",
  EmptyArray = "EMPTY_ARRAY",
  OutOfRange = "OUT_OF_RANGE",
}
enum RoundingMode {
  Up = "up",
  Down = "down",
  Nearest = "nearest",
  TowardZero = "toward_zero",
}
enum Distribution {
  Uniform = "uniform",
  Normal = "normal",
}
enum MatrixType {
  Identity = "identity",
  Zero = "zero",
  Random = "random",
}

/* ===================== Types ===================== */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type Vec = readonly number[];
export type Matrix = readonly Vec[];

interface Identifiable {
  readonly id: string;
}
interface MathEntry extends Identifiable {
  readonly value: number;
}

type MathResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | {
      readonly kind: "error";
      readonly code: ErrorCode;
      readonly message: string;
    }
  | { readonly kind: "nan"; readonly reason: string };

const CONST_PI = Math.PI;
const CONST_E = Math.E;
const CONST_INF = Infinity;

/* ===================== Symbols ===================== */

const SYM_META: unique symbol = Symbol("meta");
const SYM_BRAND: unique symbol = Symbol("mathBrand");

interface EntryMeta {
  readonly createdAt: number;
  accessedAt: number;
}

/* ===================== Error Hierarchy ===================== */

class MathError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "MathError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class DimensionError extends MathError {
  constructor(msg: string) {
    super(ErrorCode.DimensionMismatch, msg);
    this.name = "DimensionError";
  }
}
class NotInvertibleError extends MathError {
  constructor(msg: string) {
    super(ErrorCode.NotInvertible, msg);
    this.name = "NotInvertibleError";
  }
}

/* ===================== Type Guards ===================== */

function isMathSuccess<T>(
  r: MathResult<T>,
): r is { kind: "success"; value: T } {
  return r.kind === "success";
}
function isMathError<T>(
  r: MathResult<T>,
): r is { kind: "error"; code: ErrorCode; message: string } {
  return r.kind === "error";
}
function isVec(v: unknown): v is Vec {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}
function isMatrix(m: unknown): m is Matrix {
  return Array.isArray(m) && m.every((r) => isVec(r));
}

/* ===================== Generic Number Store ===================== */

class NumberStore<T extends MathEntry> implements Iterable<T> {
  private items = new Map<string, T>();
  private readonly [SYM_META]: EntryMeta = {
    createdAt: Date.now(),
    accessedAt: Date.now(),
  };
  get count(): number {
    return this.items.size;
  }
  add(item: T): void {
    this.items.set(item.id, item);
    this.touch();
  }
  get(id: string): T | undefined {
    const v = this.items.get(id);
    if (v) this.touch();
    return v;
  }
  delete(id: string): boolean {
    return this.items.delete(id);
  }
  clear(): void {
    this.items.clear();
    this.touch();
  }
  private touch(): void {
    this[SYM_META].accessedAt = Date.now();
  }
  *[Symbol.iterator](): Iterator<T> {
    for (const v of this.items.values()) yield v;
  }
  *entries(): IterableIterator<[string, T]> {
    for (const e of this.items.entries()) yield e;
  }
  *values(): IterableIterator<T> {
    for (const v of this.items.values()) yield v;
  }
}

/* ===================== Abstract Statistics ===================== */

abstract class AbstractStatistics {
  abstract compute(data: number[]): number;
  get name(): string {
    return this.constructor.name;
  }
  safeCompute(data: number[]): MathResult<number> {
    if (data.length === 0)
      return { kind: "error", code: ErrorCode.EmptyArray, message: "数组为空" };
    try {
      return { kind: "success", value: this.compute(data) };
    } catch (e) {
      return {
        kind: "error",
        code: ErrorCode.InvalidInput,
        message: (e as Error).message,
      };
    }
  }
}

class SumStatistic extends AbstractStatistics {
  compute(data: number[]): number {
    return data.reduce((a, b) => a + b, 0);
  }
}
class MeanStatistic extends AbstractStatistics {
  compute(data: number[]): number {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }
}
class MedianStatistic extends AbstractStatistics {
  compute(data: number[]): number {
    const s = [...data].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  }
}
class VarianceStatistic extends AbstractStatistics {
  constructor(private sample = false) {
    super();
  }
  compute(data: number[]): number {
    const mu = data.reduce((a, b) => a + b, 0) / data.length;
    const n = this.sample ? data.length - 1 : data.length;
    return n <= 0 ? 0 : data.reduce((acc, x) => acc + (x - mu) ** 2, 0) / n;
  }
}
class StdDevStatistic extends VarianceStatistic {
  constructor(sample = false) {
    super(sample);
  }
  compute(data: number[]): number {
    return Math.sqrt(super.compute(data));
  }
}

/* ===================== Statistics ===================== */

export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
export function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : sum(arr) / arr.length;
}
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
export function mode(arr: number[]): number[] {
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let mx = 0;
  for (const c of counts.values()) if (c > mx) mx = c;
  return [...counts.entries()].filter(([, c]) => c === mx).map(([v]) => v);
}
export function variance(arr: number[], sample = false): number {
  if (arr.length === 0) return 0;
  const mu = mean(arr);
  const n = sample ? arr.length - 1 : arr.length;
  return n <= 0 ? 0 : sum(arr.map((x) => (x - mu) ** 2)) / n;
}
export function stddev(arr: number[], sample = false): number {
  return Math.sqrt(variance(arr, sample));
}
export function min(arr: number[]): number {
  return arr.length === 0 ? NaN : Math.min(...arr);
}
export function max(arr: number[]): number {
  return arr.length === 0 ? NaN : Math.max(...arr);
}
export function range(arr: number[]): number {
  return arr.length === 0 ? 0 : max(arr) - min(arr);
}

/* ===================== Vectors ===================== */

export function vecAdd(a: Vec, b: Vec): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}
export function vecSub(a: Vec, b: Vec): number[] {
  return a.map((v, i) => v - (b[i] ?? 0));
}
export function dot(a: Vec, b: Vec): number {
  return a.reduce((acc, v, i) => acc + v * (b[i] ?? 0), 0);
}
export function cross(a: Vec, b: Vec): number[] {
  if (a.length !== 3 || b.length !== 3)
    throw new DimensionError("叉积仅支持 3 维向量");
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function magnitude(a: Vec): number {
  return Math.sqrt(dot(a, a));
}
export function normalize(a: Vec): number[] {
  const mag = magnitude(a);
  if (mag === 0) return a.map(() => 0);
  return a.map((v) => v / mag);
}
export function vecAngle(a: Vec, b: Vec): number {
  const d = dot(a, b);
  const m = magnitude(a) * magnitude(b);
  if (m === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, d / m)));
}

/* ===================== Matrix Class ===================== */

class MatrixOps<T extends number = number> implements Iterable<number[]> {
  private data: number[][];
  private readonly [SYM_BRAND] = true;
  constructor(data: number[][]) {
    this.data = data.map((r) => [...r]);
  }
  get rows(): number {
    return this.data.length;
  }
  get cols(): number {
    return this.data[0]?.length ?? 0;
  }
  get isSquare(): boolean {
    return this.rows === this.cols;
  }
  get determinant(): number {
    return matDeterminant(this.data);
  }
  at(r: number, c: number): number {
    return this.data[r]?.[c] ?? 0;
  }
  transpose(): MatrixOps<T> {
    return new MatrixOps(matTranspose(this.data));
  }
  multiply(other: MatrixOps<T>): MatrixOps<T> {
    return new MatrixOps(matMultiply(this.data, other.data));
  }
  inverse(): MatrixOps<T> {
    return new MatrixOps(matInverse(this.data));
  }
  *[Symbol.iterator](): Iterator<number[]> {
    for (const row of this.data) yield [...row];
  }
  *flatten(): IterableIterator<number> {
    for (const row of this.data) for (const v of row) yield v;
  }
  toRaw(): number[][] {
    return this.data.map((r) => [...r]);
  }
  static identity(n: number): MatrixOps {
    const m: number[][] = [];
    for (let i = 0; i < n; i++) {
      m.push(new Array(n).fill(0));
      m[i][i] = 1;
    }
    return new MatrixOps(m);
  }
  static zero(rows: number, cols: number): MatrixOps {
    return new MatrixOps(
      Array.from({ length: rows }, () => new Array(cols).fill(0)),
    );
  }
}

export function matrix(rows: number, cols: number, fill = 0): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => fill),
  );
}
export function matMultiply(a: Matrix, b: Matrix): number[][] {
  if (a[0].length !== b.length) throw new DimensionError("矩阵维度不匹配");
  const result = matrix(a.length, b[0].length, 0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b[0].length; j++)
      for (let k = 0; k < b.length; k++) result[i][j] += a[i][k] * b[k][j];
  return result;
}
export function matTranspose(a: Matrix): number[][] {
  return a[0].map((_, j) => a.map((row) => row[j]));
}
export function matDeterminant(a: Matrix): number {
  const n = a.length;
  if (n !== a[0].length) throw new DimensionError("矩阵必须为方阵");
  if (n === 1) return a[0][0];
  if (n === 2) return a[0][0] * a[1][1] - a[0][1] * a[1][0];
  let det = 0;
  for (let j = 0; j < n; j++) {
    const minor = a.slice(1).map((row) => row.filter((_, c) => c !== j));
    det += (j % 2 === 0 ? 1 : -1) * a[0][j] * matDeterminant(minor);
  }
  return det;
}
export function matInverse(a: Matrix): number[][] {
  const n = a.length;
  if (n !== a[0].length) throw new DimensionError("矩阵必须为方阵");
  const det = matDeterminant(a);
  if (Math.abs(det) < 1e-12)
    throw new NotInvertibleError("矩阵不可逆 (行列式为 0)");
  const adj = matrix(n, n, 0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const minor = a
        .filter((_, r) => r !== i)
        .map((row) => row.filter((_, c) => c !== j));
      adj[j][i] = ((i + j) % 2 === 0 ? 1 : -1) * matDeterminant(minor);
    }
  return adj.map((row) => row.map((v) => v / det));
}

/* ===================== Geometry ===================== */

export function distance(p1: Vec, p2: Vec): number {
  return magnitude(vecSub(p1, p2));
}
export function areaCircle(r: number): number {
  return Math.PI * r * r;
}
export function areaTriangle(base: number, height: number): number {
  return 0.5 * base * height;
}
export function areaRectangle(w: number, h: number): number {
  return w * h;
}
export function hypotenuse(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/* ===================== Number Theory ===================== */

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  const lim = Math.sqrt(n);
  for (let i = 3; i <= lim; i += 2) if (n % i === 0) return false;
  return true;
}
export function primeFactors(n: number): number[] {
  const factors: number[] = [];
  let x = Math.abs(n);
  for (let d = 2; d * d <= x; d++) {
    while (x % d === 0) {
      factors.push(d);
      x /= d;
    }
  }
  if (x > 1) factors.push(x);
  return factors;
}
export function fib(n: number): number {
  if (n < 0) throw new MathError(ErrorCode.InvalidInput, "n 不能为负数");
  if (n < 2) return n;
  let a = 0,
    b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}
export function factorial(n: number): number {
  if (n < 0) throw new MathError(ErrorCode.InvalidInput, "n 不能为负数");
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
export function sieve(limit: number): number[] {
  if (limit < 2) return [];
  const arr = new Array(limit + 1).fill(true);
  arr[0] = arr[1] = false;
  for (let i = 2; i * i <= limit; i++)
    if (arr[i]) for (let j = i * i; j <= limit; j += i) arr[j] = false;
  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) if (arr[i]) primes.push(i);
  return primes;
}

/** Prime generator (infinite sequence, lazily evaluated) */
export function* primes(): IterableIterator<number> {
  yield 2;
  let n = 3;
  while (true) {
    if (isPrime(n)) yield n;
    n += 2;
  }
}

/** Fibonacci generator */
export function* fibSequence(count: number): IterableIterator<number> {
  for (let i = 0; i < count; i++) yield fib(i);
}

/* ===================== Random ===================== */

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}
export function randomChoice<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new MathError(ErrorCode.EmptyArray, "数组为空");
  return arr[Math.floor(Math.random() * arr.length)];
}
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function sample<T>(arr: readonly T[], count: number): T[] {
  return shuffle(arr).slice(0, Math.min(count, arr.length));
}

/* ===================== Interpolation ===================== */

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function mapRange(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax - inMin === 0) return outMin;
  return outMin + ((v - inMin) * (outMax - outMin)) / (inMax - inMin);
}
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ===================== Rounding ===================== */

export function roundTo(v: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
export function floorTo(v: number, multiple: number): number {
  return Math.floor(v / multiple) * multiple;
}
export function ceilTo(v: number, multiple: number): number {
  return Math.ceil(v / multiple) * multiple;
}

function roundWithMode(
  v: number,
  decimals: number,
  mode: RoundingMode,
): number {
  const f = 10 ** decimals;
  const scaled = v * f;
  switch (mode) {
    case RoundingMode.Up:
      return Math.ceil(scaled) / f;
    case RoundingMode.Down:
      return Math.floor(scaled) / f;
    case RoundingMode.Nearest:
      return Math.round(scaled) / f;
    case RoundingMode.TowardZero:
      return Math.trunc(scaled) / f;
  }
}

/* ===================== Constants ===================== */

export const PI = CONST_PI;
export const E = CONST_E;
export const INF = CONST_INF;

const STAT_REGISTRY = {
  sum: new SumStatistic(),
  mean: new MeanStatistic(),
  median: new MedianStatistic(),
  variance: new VarianceStatistic(false),
  stddev: new StdDevStatistic(false),
} satisfies Record<string, AbstractStatistics>;

/* ===================== Namespace Export ===================== */

export const m = {
  sum,
  mean,
  median,
  mode,
  variance,
  stddev,
  min,
  max,
  range,
  vecAdd,
  vecSub,
  dot,
  cross,
  magnitude,
  normalize,
  vecAngle,
  matrix,
  matMultiply,
  matTranspose,
  matDeterminant,
  matInverse,
  distance,
  areaCircle,
  areaTriangle,
  areaRectangle,
  hypotenuse,
  gcd,
  lcm,
  isPrime,
  primeFactors,
  fib,
  factorial,
  sieve,
  randomRange,
  randomInt,
  randomChoice,
  shuffle,
  sample,
  lerp,
  mapRange,
  clamp,
  smoothstep,
  roundTo,
  floorTo,
  ceilTo,
  PI,
  E,
  INF,
};

/* ===================== CLI ===================== */

function parseNums(args: string[]): number[] {
  return args.map((a) => Number(a)).filter((n) => !Number.isNaN(n));
}
function printMatrix(mat: Matrix): void {
  for (const row of mat)
    console.log(
      "  [" + row.map((v) => v.toFixed(2).padStart(8)).join(", ") + "]",
    );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "stats": {
      const nums = parseNums(process.argv.slice(3));
      if (nums.length === 0) {
        console.log("用法: stats <numbers...>");
        return;
      }
      console.log("统计结果:");
      console.log(`  数量: ${nums.length}`);
      console.log(`  总和: ${sum(nums)}`);
      console.log(`  均值: ${roundTo(mean(nums), 4)}`);
      console.log(`  中位数: ${median(nums)}`);
      console.log(`  众数: ${mode(nums).join(", ")}`);
      console.log(`  方差: ${roundTo(variance(nums, true), 4)} (样本)`);
      console.log(`  标准差: ${roundTo(stddev(nums, true), 4)} (样本)`);
      console.log(`  最小: ${min(nums)}`);
      console.log(`  最大: ${max(nums)}`);
      console.log(`  极差: ${range(nums)}`);
      const result = STAT_REGISTRY.stddev.safeCompute(nums);
      if (isMathSuccess(result))
        console.log(`  (safeCompute) 标准差: ${roundTo(result.value, 4)}`);
      break;
    }
    case "prime": {
      const n = Number(process.argv[3]);
      if (!n) {
        console.log("用法: prime <n>");
        return;
      }
      console.log(`${n} 是否为质数: ${isPrime(n)}`);
      console.log(`质因数: ${primeFactors(n).join(" × ")}`);
      console.log(
        `小于等于 ${Math.floor(n)} 的质数: ${sieve(Math.floor(n)).join(", ")}`,
      );
      console.log(
        `前 10 个质数 (生成器): ${[...take(primes(), 10)].join(", ")}`,
      );
      break;
    }
    case "gcd": {
      const a = Number(process.argv[3]);
      const b = Number(process.argv[4]);
      if (!a || !b) {
        console.log("用法: gcd <a> <b>");
        return;
      }
      console.log(`gcd(${a}, ${b}) = ${gcd(a, b)}`);
      console.log(`lcm(${a}, ${b}) = ${lcm(a, b)}`);
      break;
    }
    case "matrix": {
      const file = process.argv[3];
      if (!file || !fs.existsSync(file)) {
        console.log("用法: matrix <json文件>");
        return;
      }
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(data)) {
        const mat = data as number[][];
        const ops = new MatrixOps(mat);
        console.log("矩阵:");
        printMatrix(ops.toRaw());
        console.log("转置:");
        printMatrix(ops.transpose().toRaw());
        console.log(`行列式: ${ops.determinant}`);
        try {
          console.log("逆矩阵:");
          printMatrix(ops.inverse().toRaw());
        } catch (e) {
          console.log(`逆矩阵: ${(e as Error).message}`);
        }
        console.log("扁平化迭代:", [...ops.flatten()].join(", "));
      } else {
        const a = (data as { a: number[][] }).a;
        const b = (data as { b: number[][] }).b;
        console.log("A × B:");
        printMatrix(matMultiply(a, b));
      }
      break;
    }
    case "fib": {
      const n = Number(process.argv[3]);
      if (!n && n !== 0) {
        console.log("用法: fib <n>");
        return;
      }
      console.log(
        `斐波那契前 ${n} 项 (生成器): ${[...fibSequence(n)].join(", ")}`,
      );
      console.log(`fib(${n}) = ${fib(n)}`);
      console.log(`${n}! = ${factorial(n)}`);
      break;
    }
    case "demo": {
      const store = new NumberStore<MathEntry>();
      store.add({ id: "pi", value: Math.PI });
      store.add({ id: "e", value: Math.E });
      store.add({ id: "phi", value: (1 + Math.sqrt(5)) / 2 });
      console.log("=== NumberStore 演示 ===");
      console.log("存储的常量:");
      for (const entry of store) console.log(`  ${entry.id} = ${entry.value}`);
      console.log("\n=== 舍入模式 ===");
      const v = 3.14159;
      for (const mode of Object.values(RoundingMode))
        console.log(`  round(π, 2, ${mode}) = ${roundWithMode(v, 2, mode)}`);
      console.log("\n=== MatrixOps ===");
      const m1 = MatrixOps.identity(3);
      console.log("单位矩阵:");
      printMatrix(m1.toRaw());
      console.log("零矩阵 2x3:");
      printMatrix(MatrixOps.zero(2, 3).toRaw());
      console.log("\n=== 抽象统计 ===");
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      for (const [name, stat] of Object.entries(STAT_REGISTRY))
        console.log(`  ${name}: ${roundTo(stat.compute(data), 4)}`);
      break;
    }
    default:
      console.log(`数学工具库 - 命令行演示

用法:
  stats <numbers...>     统计计算
  prime <n>              质数判断与质因数
  gcd <a> <b>            最大公约数与最小公倍数
  matrix <json文件>      矩阵运算
  fib <n>                斐波那契数列与阶乘
  demo                   演示新特性

示例:
  stats 1 2 3 4 5 6 7 8 9 10
  prime 97
  gcd 12 18
  matrix ./mat.json
  fib 20
  demo`);
  }
}

function* take<T>(iter: Iterable<T>, n: number): IterableIterator<T> {
  let i = 0;
  for (const v of iter) {
    if (i++ >= n) break;
    yield v;
  }
}

main();
