#!/usr/bin/env node
/**
 * 数学工具库 (Math Utils)
 * -------------------------------------------------------------
 * 提供统计、向量、矩阵、几何、数论、随机、插值、舍入等函数。
 *
 * 公开 API (命名空间 m):
 *   - 统计: sum, mean, median, mode, variance, stddev, min, max, range
 *   - 向量: vecAdd, vecSub, dot, cross, magnitude, normalize, vecAngle
 *   - 矩阵: matrix, matMultiply, matTranspose, matDeterminant, matInverse
 *   - 几何: distance, areaCircle, areaTriangle, areaRectangle, hypotenuse
 *   - 数论: gcd, lcm, isPrime, primeFactors, fib, factorial, sieve
 *   - 随机: randomRange, randomInt, randomChoice, shuffle, sample
 *   - 插值: lerp, mapRange, clamp, smoothstep
 *   - 舍入: roundTo, floorTo, ceilTo
 *   - 常量: PI, E, INF
 *
 * 仅依赖 Node.js 内置模块 (本库不需要任何模块依赖).
 */

import fs from 'fs';

// ---------- 统计 ----------
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
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return [...counts.entries()].filter(([, c]) => c === max).map(([v]) => v);
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

// ---------- 向量 ----------
export type Vec = number[];

export function vecAdd(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v + (b[i] ?? 0));
}
export function vecSub(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v - (b[i] ?? 0));
}
export function dot(a: Vec, b: Vec): number {
  return a.reduce((acc, v, i) => acc + v * (b[i] ?? 0), 0);
}
export function cross(a: Vec, b: Vec): Vec {
  // 仅 3 维
  if (a.length !== 3 || b.length !== 3) throw new Error('叉积仅支持 3 维向量');
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function magnitude(a: Vec): number {
  return Math.sqrt(dot(a, a));
}
export function normalize(a: Vec): Vec {
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

// ---------- 矩阵 ----------
export type Matrix = number[][];

export function matrix(rows: number, cols: number, fill = 0): Matrix {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}
export function matMultiply(a: Matrix, b: Matrix): Matrix {
  if (a[0].length !== b.length) throw new Error('矩阵维度不匹配');
  const result = matrix(a.length, b[0].length, 0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b[0].length; j++) {
      for (let k = 0; k < b.length; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}
export function matTranspose(a: Matrix): Matrix {
  return a[0].map((_, j) => a.map((row) => row[j]));
}
export function matDeterminant(a: Matrix): number {
  const n = a.length;
  if (n !== a[0].length) throw new Error('矩阵必须为方阵');
  if (n === 1) return a[0][0];
  if (n === 2) return a[0][0] * a[1][1] - a[0][1] * a[1][0];
  let det = 0;
  for (let j = 0; j < n; j++) {
    const minor = a.slice(1).map((row) => row.filter((_, c) => c !== j));
    det += (j % 2 === 0 ? 1 : -1) * a[0][j] * matDeterminant(minor);
  }
  return det;
}
export function matInverse(a: Matrix): Matrix {
  const n = a.length;
  if (n !== a[0].length) throw new Error('矩阵必须为方阵');
  const det = matDeterminant(a);
  if (Math.abs(det) < 1e-12) throw new Error('矩阵不可逆 (行列式为 0)');
  // 伴随矩阵法
  const adj = matrix(n, n, 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const minor = a
        .filter((_, r) => r !== i)
        .map((row) => row.filter((_, c) => c !== j));
      adj[j][i] = ((i + j) % 2 === 0 ? 1 : -1) * matDeterminant(minor);
    }
  }
  return adj.map((row) => row.map((v) => v / det));
}

// ---------- 几何 ----------
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

// ---------- 数论 ----------
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
  for (let i = 3; i <= lim; i += 2) {
    if (n % i === 0) return false;
  }
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
  if (n < 0) throw new Error('n 不能为负数');
  if (n < 2) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}
export function factorial(n: number): number {
  if (n < 0) throw new Error('n 不能为负数');
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
export function sieve(limit: number): number[] {
  if (limit < 2) return [];
  const arr = new Array(limit + 1).fill(true);
  arr[0] = arr[1] = false;
  for (let i = 2; i * i <= limit; i++) {
    if (arr[i]) {
      for (let j = i * i; j <= limit; j += i) arr[j] = false;
    }
  }
  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) if (arr[i]) primes.push(i);
  return primes;
}

// ---------- 随机 ----------
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}
export function randomChoice<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('数组为空');
  return arr[Math.floor(Math.random() * arr.length)];
}
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function sample<T>(arr: T[], count: number): T[] {
  return shuffle(arr).slice(0, Math.min(count, arr.length));
}

// ---------- 插值 ----------
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function mapRange(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
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

// ---------- 舍入 ----------
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

// ---------- 常量 ----------
export const PI = Math.PI;
export const E = Math.E;
export const INF = Infinity;

/** 命名空间导出 */
export const m = {
  sum, mean, median, mode, variance, stddev, min, max, range,
  vecAdd, vecSub, dot, cross, magnitude, normalize, vecAngle,
  matrix, matMultiply, matTranspose, matDeterminant, matInverse,
  distance, areaCircle, areaTriangle, areaRectangle, hypotenuse,
  gcd, lcm, isPrime, primeFactors, fib, factorial, sieve,
  randomRange, randomInt, randomChoice, shuffle, sample,
  lerp, mapRange, clamp, smoothstep,
  roundTo, floorTo, ceilTo,
  PI, E, INF,
};

// ===================== CLI 演示 =====================

function parseNums(args: string[]): number[] {
  return args.map((a) => Number(a)).filter((n) => !Number.isNaN(n));
}

function printMatrix(mat: Matrix): void {
  for (const row of mat) {
    console.log('  [' + row.map((v) => v.toFixed(2).padStart(8)).join(', ') + ']');
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'stats': {
      const nums = parseNums(process.argv.slice(3));
      if (nums.length === 0) {
        console.log('用法: stats <numbers...>');
        return;
      }
      console.log('统计结果:');
      console.log(`  数量: ${nums.length}`);
      console.log(`  总和: ${sum(nums)}`);
      console.log(`  均值: ${roundTo(mean(nums), 4)}`);
      console.log(`  中位数: ${median(nums)}`);
      console.log(`  众数: ${mode(nums).join(', ')}`);
      console.log(`  方差: ${roundTo(variance(nums, true), 4)} (样本)`);
      console.log(`  标准差: ${roundTo(stddev(nums, true), 4)} (样本)`);
      console.log(`  最小: ${min(nums)}`);
      console.log(`  最大: ${max(nums)}`);
      console.log(`  极差: ${range(nums)}`);
      break;
    }
    case 'prime': {
      const n = Number(process.argv[3]);
      if (!n) {
        console.log('用法: prime <n>');
        return;
      }
      console.log(`${n} 是否为质数: ${isPrime(n)}`);
      console.log(`质因数: ${primeFactors(n).join(' × ')}`);
      console.log(`小于等于 ${Math.floor(n)} 的质数: ${sieve(Math.floor(n)).join(', ')}`);
      break;
    }
    case 'gcd': {
      const a = Number(process.argv[3]);
      const b = Number(process.argv[4]);
      if (!a || !b) {
        console.log('用法: gcd <a> <b>');
        return;
      }
      console.log(`gcd(${a}, ${b}) = ${gcd(a, b)}`);
      console.log(`lcm(${a}, ${b}) = ${lcm(a, b)}`);
      break;
    }
    case 'matrix': {
      const file = process.argv[3];
      if (!file || !fs.existsSync(file)) {
        console.log('用法: matrix <json文件>');
        console.log('JSON 文件格式: [[1,2],[3,4]] 或 {a:[[...]], b:[[...]]}');
        return;
      }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) {
        const mat = data as Matrix;
        console.log('矩阵:');
        printMatrix(mat);
        console.log('转置:');
        printMatrix(matTranspose(mat));
        console.log(`行列式: ${matDeterminant(mat)}`);
        try {
          console.log('逆矩阵:');
          printMatrix(matInverse(mat));
        } catch (e) {
          console.log(`逆矩阵: ${(e as Error).message}`);
        }
      } else {
        const a = (data as { a: Matrix }).a;
        const b = (data as { b: Matrix }).b;
        console.log('A × B:');
        printMatrix(matMultiply(a, b));
      }
      break;
    }
    case 'fib': {
      const n = Number(process.argv[3]);
      if (!n) {
        console.log('用法: fib <n>');
        return;
      }
      const seq: number[] = [];
      for (let i = 0; i <= n; i++) seq.push(fib(i));
      console.log(`斐波那契前 ${n} 项: ${seq.join(', ')}`);
      console.log(`fib(${n}) = ${fib(n)}`);
      console.log(`${n}! = ${factorial(n)}`);
      break;
    }
    default:
      console.log(`
数学工具库 - 命令行演示

用法:
  stats <numbers...>     统计计算
  prime <n>              质数判断与质因数
  gcd <a> <b>            最大公约数与最小公倍数
  matrix <json文件>      矩阵运算
  fib <n>                斐波那契数列与阶乘

示例:
  stats 1 2 3 4 5 6 7 8 9 10
  prime 97
  gcd 12 18
  matrix ./mat.json
  fib 20
`);
  }
}

main();
