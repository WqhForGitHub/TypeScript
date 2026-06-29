#!/usr/bin/env node
/**
 * 迷宫生成器与求解器 (Maze Generator & Solver) — Enhanced Edition
 *
 * TypeScript features: enums, generics, discriminated unions, mapped types,
 * conditional types, template literal types, type guards, utility types,
 * tuples, abstract classes, function overloads, as const, custom errors,
 * generators, symbols, satisfies, getters/setters.
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ============================================================
// 1. 常量与枚举
// ============================================================

const ANSI = {
  RESET: "\x1b[0m",
  CLEAR: "\x1b[2J",
  HOME: "\x1b[H",
  BOLD: "\x1b[1m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
} as const;

enum GenAlgorithm {
  Backtracker = "backtracker",
  Prim = "prim",
  Kruskal = "kruskal",
}
enum SolveAlgorithm {
  BFS = "bfs",
  DFS = "dfs",
  AStar = "astar",
}
enum Color {
  Red = "red",
  Green = "green",
  Yellow = "yellow",
  Blue = "blue",
  Cyan = "cyan",
  Gray = "gray",
  Bold = "bold",
}

type ColorCode = (typeof ANSI)[keyof typeof ANSI];

const COLOR_MAP: Record<Color, ColorCode> = {
  [Color.Red]: ANSI.RED,
  [Color.Green]: ANSI.GREEN,
  [Color.Yellow]: ANSI.YELLOW,
  [Color.Blue]: ANSI.BLUE,
  [Color.Cyan]: ANSI.CYAN,
  [Color.Gray]: ANSI.GRAY,
  [Color.Bold]: ANSI.BOLD,
} as const satisfies Record<Color, ColorCode>;

type Grid = string[][];
type Coord = readonly [number, number];

interface Maze {
  readonly width: number;
  readonly height: number;
  readonly grid: Grid;
  readonly seed: number;
  readonly algorithm: GenAlgorithm;
}

interface SolveResult {
  readonly path: Coord[];
  readonly explored: Coord[];
  readonly method: SolveAlgorithm;
  readonly found: boolean;
  readonly elapsedMs: number;
}

interface MazeStats {
  readonly totalGenerated: number;
  readonly totalSolved: number;
  readonly bestSolveTime: Partial<Record<string, number>>;
  readonly [key: string]: unknown;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DATA_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".maze_data.json",
);

// ============================================================
// 2. 判别联合
// ============================================================

type MazeEvent =
  | {
      readonly type: "generate";
      readonly width: number;
      readonly height: number;
      readonly algorithm: GenAlgorithm;
    }
  | {
      readonly type: "solve";
      readonly method: SolveAlgorithm;
      readonly found: boolean;
    }
  | { readonly type: "save"; readonly file: string }
  | { readonly type: "load"; readonly file: string };

type EventOfType<T extends MazeEvent["type"]> = Extract<MazeEvent, { type: T }>;

type ParsedCommand =
  | {
      readonly action: "generate";
      readonly width: number;
      readonly height: number;
      readonly algorithm: GenAlgorithm;
      readonly seed: number | null;
      readonly output: string | null;
    }
  | {
      readonly action: "solve";
      readonly file: string;
      readonly method: SolveAlgorithm;
      readonly output: string | null;
    }
  | {
      readonly action: "animate";
      readonly file: string;
      readonly method: SolveAlgorithm;
    }
  | { readonly action: "show"; readonly file: string }
  | { readonly action: "help" }
  | { readonly action: "quit" }
  | { readonly action: "unknown"; readonly input: string };

// ============================================================
// 3. 自定义错误
// ============================================================

abstract class MazeError extends Error {
  abstract readonly code: string;
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InvalidSizeError extends MazeError {
  readonly code = "INVALID_SIZE";
  constructor(msg: string) {
    super(msg);
  }
}

class MazeFileError extends MazeError {
  readonly code = "MAZE_FILE";
  constructor(msg: string) {
    super(msg);
  }
}

class NoSolutionError extends MazeError {
  readonly code = "NO_SOLUTION";
  constructor() {
    super("迷宫无解");
  }
}

// ============================================================
// 4. 类型守卫
// ============================================================

function isGenAlgorithm(value: unknown): value is GenAlgorithm {
  return (
    typeof value === "string" &&
    Object.values(GenAlgorithm).includes(value as GenAlgorithm)
  );
}

function isSolveAlgorithm(value: unknown): value is SolveAlgorithm {
  return (
    typeof value === "string" &&
    Object.values(SolveAlgorithm).includes(value as SolveAlgorithm)
  );
}

// ============================================================
// 5. 种子随机数
// ============================================================

class SeededRandom {
  private state: number;
  readonly seed: number;
  constructor(seed: number) {
    this.seed = seed >>> 0 || 1;
    this.state = this.seed;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

// ============================================================
// 6. 生成器
// ============================================================

function* iterateGrid(grid: Grid): Generator<{
  readonly x: number;
  readonly y: number;
  readonly cell: string;
}> {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y]!.length; x++) {
      yield { x, y, cell: grid[y]![x]! };
    }
  }
}

function* neighbors4(
  x: number,
  y: number,
  w: number,
  h: number,
): Generator<Coord> {
  const dirs: readonly Coord[] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < w && ny >= 0 && ny < h) yield [nx, ny];
  }
}

// ============================================================
// 7. 抽象迷宫生成器
// ============================================================

abstract class MazeGenerator {
  protected readonly rng: SeededRandom;
  constructor(
    readonly width: number,
    readonly height: number,
    seed: number,
  ) {
    this.rng = new SeededRandom(seed);
  }
  abstract generate(): Maze;
  protected get algorithm(): GenAlgorithm {
    return GenAlgorithm.Backtracker;
  }

  protected createEmptyGrid(): Grid {
    const gw = 2 * this.width + 1;
    const gh = 2 * this.height + 1;
    const grid: Grid = [];
    for (let y = 0; y < gh; y++) {
      grid.push(new Array(gw).fill("#"));
    }
    return grid;
  }
}

class BacktrackerGenerator extends MazeGenerator {
  get algorithm(): GenAlgorithm {
    return GenAlgorithm.Backtracker;
  }

  generate(): Maze {
    const grid = this.createEmptyGrid();
    const w = this.width;
    const h = this.height;
    const visited: boolean[][] = Array.from({ length: h }, () =>
      new Array(w).fill(false),
    );
    const stack: Array<{ r: number; c: number }> = [{ r: 0, c: 0 }];
    visited[0][0] = true;
    grid[1]![1] = " ";

    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    while (stack.length > 0) {
      const cur = stack[stack.length - 1]!;
      const unvisited: Array<{ r: number; c: number; dr: number; dc: number }> =
        [];
      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (nr >= 0 && nr < h && nc >= 0 && nc < w && !visited[nr][nc]) {
          unvisited.push({ r: nr, c: nc, dr, dc });
        }
      }
      if (unvisited.length === 0) {
        stack.pop();
        continue;
      }
      const next = unvisited[this.rng.nextInt(unvisited.length)]!;
      grid[2 * cur.r + 1 + next.dr]![2 * cur.c + 1 + next.dc] = " ";
      grid[2 * next.r + 1]![2 * next.c + 1] = " ";
      visited[next.r][next.c] = true;
      stack.push({ r: next.r, c: next.c });
    }
    return {
      width: w,
      height: h,
      grid,
      seed: this.rng.seed,
      algorithm: this.algorithm,
    };
  }
}

class PrimGenerator extends MazeGenerator {
  get algorithm(): GenAlgorithm {
    return GenAlgorithm.Prim;
  }

  generate(): Maze {
    const grid = this.createEmptyGrid();
    const w = this.width;
    const h = this.height;
    const visited: boolean[][] = Array.from({ length: h }, () =>
      new Array(w).fill(false),
    );
    visited[0][0] = true;
    grid[1]![1] = " ";
    const frontier: Array<{ r: number; c: number; pr: number; pc: number }> =
      [];
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = dr,
        nc = dc;
      if (nr >= 0 && nr < h && nc >= 0 && nc < w)
        frontier.push({ r: nr, c: nc, pr: 0, pc: 0 });
    }
    while (frontier.length > 0) {
      const idx = this.rng.nextInt(frontier.length);
      const cell = frontier.splice(idx, 1)[0]!;
      if (visited[cell.r][cell.c]) continue;
      visited[cell.r][cell.c] = true;
      grid[2 * cell.r + 1]![2 * cell.c + 1] = " ";
      grid[2 * cell.pr + 1 + (cell.r - cell.pr)]![
        2 * cell.pc + 1 + (cell.c - cell.pc)
      ] = " ";
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nr = cell.r + dr;
        const nc = cell.c + dc;
        if (nr >= 0 && nr < h && nc >= 0 && nc < w && !visited[nr][nc]) {
          frontier.push({ r: nr, c: nc, pr: cell.r, pc: cell.c });
        }
      }
    }
    return { width: w, height: h, grid, seed: 0, algorithm: this.algorithm };
  }
}

class KruskalGenerator extends MazeGenerator {
  get algorithm(): GenAlgorithm {
    return GenAlgorithm.Kruskal;
  }

  generate(): Maze {
    const grid = this.createEmptyGrid();
    const w = this.width;
    const h = this.height;
    const parent: number[] = Array.from({ length: w * h }, (_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!];
        x = parent[x]!;
      }
      return x;
    };
    const edges: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (c < w - 1) edges.push({ r1: r, c1: c, r2: r, c2: c + 1 });
        if (r < h - 1) edges.push({ r1: r, c1: c, r2: r + 1, c2: c });
      }
    }
    // Shuffle
    for (let i = edges.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1);
      [edges[i], edges[j]] = [edges[j]!, edges[i]!];
    }
    for (const e of edges) {
      const a = find(e.r1 * w + e.c1);
      const b = find(e.r2 * w + e.c2);
      if (a === b) continue;
      parent[a] = b;
      grid[2 * e.r1 + 1]![2 * e.c1 + 1] = " ";
      grid[2 * e.r2 + 1]![2 * e.c2 + 1] = " ";
      grid[e.r1 + e.r2 + 1]![e.c1 + e.c2 + 1] = " ";
    }
    return { width: w, height: h, grid, seed: 0, algorithm: this.algorithm };
  }
}

function createGenerator(
  width: number,
  height: number,
  seed: number,
  algo: GenAlgorithm,
): MazeGenerator {
  switch (algo) {
    case GenAlgorithm.Prim:
      return new PrimGenerator(width, height, seed);
    case GenAlgorithm.Kruskal:
      return new KruskalGenerator(width, height, seed);
    default:
      return new BacktrackerGenerator(width, height, seed);
  }
}

// ============================================================
// 8. 抽象求解器
// ============================================================

abstract class MazeSolver {
  abstract readonly algorithm: SolveAlgorithm;
  abstract solve(maze: Maze): SolveResult;
  protected getStartEnd(maze: Maze): { start: Coord; end: Coord } {
    return { start: [1, 1], end: [2 * maze.width - 1, 2 * maze.height - 1] };
  }
  protected isPath(grid: Grid, x: number, y: number): boolean {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0]!.length)
      return false;
    return grid[y]![x] !== "#";
  }
  protected reconstructPath(parents: Map<string, Coord>, end: Coord): Coord[] {
    const path: Coord[] = [];
    let cur: Coord | null = end;
    while (cur) {
      path.unshift(cur);
      cur = parents.get(`${cur[0]},${cur[1]}`) ?? null;
    }
    return path;
  }
}

class BfsSolver extends MazeSolver {
  readonly algorithm = SolveAlgorithm.BFS;
  solve(maze: Maze): SolveResult {
    const start = Date.now();
    const { start: s, end: e } = this.getStartEnd(maze);
    const visited = new Set<string>();
    const parents = new Map<string, Coord>();
    const explored: Coord[] = [];
    const queue: Coord[] = [s];
    visited.add(`${s[0]},${s[1]}`);
    let found = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      explored.push(cur);
      if (cur[0] === e[0] && cur[1] === e[1]) {
        found = true;
        break;
      }
      for (const [nx, ny] of neighbors4(
        cur[0],
        cur[1],
        maze.grid[0]!.length,
        maze.grid.length,
      )) {
        const key = `${nx},${ny}`;
        if (this.isPath(maze.grid, nx, ny) && !visited.has(key)) {
          visited.add(key);
          parents.set(key, cur);
          queue.push([nx, ny]);
        }
      }
    }
    const path = found ? this.reconstructPath(parents, e) : [];
    return {
      path,
      explored,
      method: this.algorithm,
      found,
      elapsedMs: Date.now() - start,
    };
  }
}

class DfsSolver extends MazeSolver {
  readonly algorithm = SolveAlgorithm.DFS;
  solve(maze: Maze): SolveResult {
    const start = Date.now();
    const { start: s, end: e } = this.getStartEnd(maze);
    const visited = new Set<string>();
    const parents = new Map<string, Coord>();
    const explored: Coord[] = [];
    const stack: Coord[] = [s];
    visited.add(`${s[0]},${s[1]}`);
    let found = false;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      explored.push(cur);
      if (cur[0] === e[0] && cur[1] === e[1]) {
        found = true;
        break;
      }
      for (const [nx, ny] of neighbors4(
        cur[0],
        cur[1],
        maze.grid[0]!.length,
        maze.grid.length,
      )) {
        const key = `${nx},${ny}`;
        if (this.isPath(maze.grid, nx, ny) && !visited.has(key)) {
          visited.add(key);
          parents.set(key, cur);
          stack.push([nx, ny]);
        }
      }
    }
    const path = found ? this.reconstructPath(parents, e) : [];
    return {
      path,
      explored,
      method: this.algorithm,
      found,
      elapsedMs: Date.now() - start,
    };
  }
}

class AStarSolver extends MazeSolver {
  readonly algorithm = SolveAlgorithm.AStar;
  solve(maze: Maze): SolveResult {
    const start = Date.now();
    const { start: s, end: e } = this.getStartEnd(maze);
    const visited = new Set<string>();
    const parents = new Map<string, Coord>();
    const gScore = new Map<string, number>();
    const explored: Coord[] = [];
    const heuristic = (x: number, y: number): number =>
      Math.abs(x - e[0]) + Math.abs(y - e[1]);
    const open: Array<{ coord: Coord; f: number }> = [
      { coord: s, f: heuristic(s[0], s[1]) },
    ];
    gScore.set(`${s[0]},${s[1]}`, 0);
    let found = false;
    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift()!;
      const key = `${cur.coord[0]},${cur.coord[1]}`;
      if (visited.has(key)) continue;
      visited.add(key);
      explored.push(cur.coord);
      if (cur.coord[0] === e[0] && cur.coord[1] === e[1]) {
        found = true;
        break;
      }
      for (const [nx, ny] of neighbors4(
        cur.coord[0],
        cur.coord[1],
        maze.grid[0]!.length,
        maze.grid.length,
      )) {
        const nkey = `${nx},${ny}`;
        if (!this.isPath(maze.grid, nx, ny) || visited.has(nkey)) continue;
        const tentG = (gScore.get(key) ?? 0) + 1;
        if (tentG < (gScore.get(nkey) ?? Infinity)) {
          gScore.set(nkey, tentG);
          parents.set(nkey, cur.coord);
          open.push({ coord: [nx, ny], f: tentG + heuristic(nx, ny) });
        }
      }
    }
    const path = found ? this.reconstructPath(parents, e) : [];
    return {
      path,
      explored,
      method: this.algorithm,
      found,
      elapsedMs: Date.now() - start,
    };
  }
}

function createSolver(method: SolveAlgorithm): MazeSolver {
  switch (method) {
    case SolveAlgorithm.DFS:
      return new DfsSolver();
    case SolveAlgorithm.AStar:
      return new AStarSolver();
    default:
      return new BfsSolver();
  }
}

// ============================================================
// 9. 迷宫分析
// ============================================================

function analyzeMaze(
  maze: Maze,
  result: SolveResult,
): { deadEnds: number; junctions: number; difficulty: number } {
  let deadEnds = 0;
  let junctions = 0;
  for (const { x, y, cell } of iterateGrid(maze.grid)) {
    if (cell !== " ") continue;
    let pathCount = 0;
    for (const [nx, ny] of neighbors4(
      x,
      y,
      maze.grid[0]!.length,
      maze.grid.length,
    )) {
      if (maze.grid[ny]![nx] !== "#") pathCount++;
    }
    if (pathCount === 1) deadEnds++;
    else if (pathCount >= 3) junctions++;
  }
  const difficulty = Math.round(
    deadEnds * 0.5 + junctions * 0.3 + result.path.length * 0.1,
  );
  return { deadEnds, junctions, difficulty };
}

// ============================================================
// 10. 渲染
// ============================================================

function colorize(text: string, color: Color): string {
  return `${COLOR_MAP[color]}${text}${ANSI.RESET}`;
}

function renderMaze(
  maze: Maze,
  result?: SolveResult,
  useColor: boolean = true,
): string {
  const c = (t: string, col: Color): string =>
    useColor ? `${COLOR_MAP[col]}${t}${ANSI.RESET}` : t;
  const pathSet = new Set(result?.path.map((p) => `${p[0]},${p[1]}`) ?? []);
  const exploredSet = new Set(
    result?.explored.map((p) => `${p[0]},${p[1]}`) ?? [],
  );
  const lines: string[] = [];
  for (let y = 0; y < maze.grid.length; y++) {
    let row = "";
    for (let x = 0; x < maze.grid[y]!.length; x++) {
      const cell = maze.grid[y]![x]!;
      const k = `${x},${y}`;
      if (x === 1 && y === 1) row += c("S", Color.Green);
      else if (x === 2 * maze.width - 1 && y === 2 * maze.height - 1)
        row += c("E", Color.Red);
      else if (cell === "#") row += c("#", Color.Gray);
      else if (pathSet.has(k)) row += c("*", Color.Yellow);
      else if (exploredSet.has(k)) row += c(".", Color.Blue);
      else row += " ";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

// ============================================================
// 11. 文件 I/O
// ============================================================

function saveMaze(maze: Maze, file: string): void {
  const lines: string[] = [
    `${maze.width} ${maze.height} ${maze.seed} ${maze.algorithm}`,
  ];
  for (const row of maze.grid) lines.push(row.join(""));
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
}

function loadMaze(file: string): Maze {
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new MazeFileError("文件格式无效");
  const [wStr, hStr, seedStr, algoStr] = lines[0]!.split(/\s+/);
  const width = parseInt(wStr ?? "0", 10);
  const height = parseInt(hStr ?? "0", 10);
  if (Number.isNaN(width) || Number.isNaN(height) || width < 1 || height < 1)
    throw new MazeFileError("尺寸无效");
  const seed = parseInt(seedStr ?? "0", 10) || 0;
  const algorithm = isGenAlgorithm(algoStr)
    ? algoStr
    : GenAlgorithm.Backtracker;
  const grid: Grid = [];
  for (let i = 1; i < lines.length; i++) grid.push(lines[i]!.split(""));
  return { width, height, grid, seed, algorithm };
}

// ============================================================
// 12. 统计
// ============================================================

function loadStats(): MazeStats {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf-8"),
      ) as Partial<MazeStats>;
      return {
        totalGenerated: d.totalGenerated ?? 0,
        totalSolved: d.totalSolved ?? 0,
        bestSolveTime: d.bestSolveTime ?? {},
      };
    }
  } catch {
    /* ignore */
  }
  return { totalGenerated: 0, totalSolved: 0, bestSolveTime: {} };
}

function saveStats(stats: MazeStats): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

// ============================================================
// 13. 命令解析 (函数重载)
// ============================================================

const SYM_PARSED = Symbol("parsed");

interface ParsedArgs {
  [SYM_PARSED]: boolean;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("-")) {
      const key = args[i]!.replace(/^-+/, "");
      if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        flags[key] = args[++i]!;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(args[i]!);
    }
  }
  return { [SYM_PARSED]: true, positional, flags };
}

// ============================================================
// 14. 命令处理
// ============================================================

function cmdGenerate(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 2) {
    console.log(
      colorize(
        "用法: generate <w> <h> [-s seed] [-a algo] [-o file]",
        Color.Red,
      ),
    );
    return;
  }
  const w = parseInt(positional[0]!, 10);
  const h = parseInt(positional[1]!, 10);
  if (
    Number.isNaN(w) ||
    Number.isNaN(h) ||
    w < 1 ||
    h < 1 ||
    w > 100 ||
    h > 100
  ) {
    throw new InvalidSizeError("尺寸必须为 1-100 的正整数");
  }
  const seed = flags.s
    ? parseInt(flags.s, 10)
    : Math.floor(Math.random() * 1000000);
  const algo = isGenAlgorithm(flags.a) ? flags.a : GenAlgorithm.Backtracker;
  const generator = createGenerator(w, h, seed, algo);
  const maze = generator.generate();
  const file = flags.o ?? `maze_${w}x${h}_${algo}_${seed}.txt`;
  saveMaze(maze, file);
  console.log(
    colorize(
      `已生成 ${w}x${h} 迷宫 (${algo}, 种子 ${seed}) -> ${file}`,
      Color.Green,
    ),
  );
  console.log("");
  console.log(renderMaze(maze));
  const stats = loadStats();
  (stats as Mutable<MazeStats>).totalGenerated++;
  saveStats(stats);
}

function cmdSolve(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 1) {
    console.log(
      colorize("用法: solve <file> [-m bfs|dfs|astar] [-o output]", Color.Red),
    );
    return;
  }
  const file = positional[0]!;
  if (!fs.existsSync(file)) throw new MazeFileError(`文件不存在: ${file}`);
  const method = isSolveAlgorithm(flags.m) ? flags.m : SolveAlgorithm.BFS;
  const maze = loadMaze(file);
  const solver = createSolver(method);
  const result = solver.solve(maze);
  const analysis = analyzeMaze(maze, result);
  console.log(
    colorize(`\n===== 求解 (${method.toUpperCase()}) =====`, Color.Cyan),
  );
  console.log(
    `找到: ${result.found ? colorize("是", Color.Green) : colorize("否", Color.Red)}  路径长度: ${result.path.length}  探索: ${result.explored.length}  耗时: ${result.elapsedMs}ms`,
  );
  console.log(
    `死胡同: ${analysis.deadEnds}  分叉: ${analysis.junctions}  难度: ${analysis.difficulty}`,
  );
  console.log("");
  console.log(renderMaze(maze, result));
  if (flags.o) {
    const grid = maze.grid.map((r) => [...r]);
    for (const [x, y] of result.explored)
      if (grid[y]![x] === " ") grid[y]![x] = ".";
    for (const [x, y] of result.path) grid[y]![x] = "*";
    const lines = [
      `${maze.width} ${maze.height} ${maze.seed} ${maze.algorithm}`,
    ];
    for (const row of grid) lines.push(row.join(""));
    fs.writeFileSync(flags.o, lines.join("\n") + "\n", "utf-8");
    console.log(colorize(`已保存 -> ${flags.o}`, Color.Green));
  }
  const stats = loadStats();
  (stats as Mutable<MazeStats>).totalSolved++;
  const key = `${maze.width}x${maze.height}_${method}`;
  const best = stats.bestSolveTime[key];
  if (best === undefined || result.elapsedMs < best) {
    (stats as Mutable<MazeStats>).bestSolveTime[key] = result.elapsedMs;
  }
  saveStats(stats);
}

function cmdShow(args: string[]): void {
  const { positional } = parseArgs(args);
  if (positional.length < 1) {
    console.log(colorize("用法: show <file>", Color.Red));
    return;
  }
  const maze = loadMaze(positional[0]!);
  console.log(
    colorize(
      `\n===== 迷宫 ${maze.width}x${maze.height} (${maze.algorithm}) =====`,
      Color.Cyan,
    ),
  );
  console.log(renderMaze(maze));
}

function cmdAnimate(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 1) {
    console.log(colorize("用法: animate <file> [-m bfs|dfs|astar]", Color.Red));
    return;
  }
  const method = isSolveAlgorithm(flags.m) ? flags.m : SolveAlgorithm.BFS;
  const maze = loadMaze(positional[0]!);
  const result = createSolver(method).solve(maze);
  console.log(
    colorize(`\n===== 动画 (${method.toUpperCase()}) =====`, Color.Cyan),
  );
  console.log(`路径: ${result.path.length}  探索: ${result.explored.length}`);
  console.log("");
  console.log(renderMaze(maze, result));
}

function showHelp(): void {
  console.log(colorize("===== 迷宫生成器与求解器 =====", Color.Cyan));
  console.log("");
  console.log("命令:");
  console.log(
    "  generate <w> <h> [-s seed] [-a backtracker|prim|kruskal] [-o file]",
  );
  console.log("  solve <file> [-m bfs|dfs|astar] [-o output]");
  console.log("  animate <file> [-m bfs|dfs|astar]");
  console.log("  show <file>");
  console.log("  help");
  console.log("  quit");
  console.log("");
  console.log("图例: # 墙  S 起点  E 终点  * 路径  . 已探索");
}

// ============================================================
// 15. 主程序
// ============================================================

function main(): void {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const cmd = args[0]!.toLowerCase();
    const rest = args.slice(1);
    try {
      if (cmd === "generate") cmdGenerate(rest);
      else if (cmd === "solve") cmdSolve(rest);
      else if (cmd === "show") cmdShow(rest);
      else if (cmd === "animate") cmdAnimate(rest);
      else if (cmd === "help" || cmd === "h") showHelp();
      else console.log(colorize(`未知命令: ${cmd}`, Color.Red));
    } catch (e) {
      if (e instanceof MazeError)
        console.log(colorize(`错误: ${e.message}`, Color.Red));
      else throw e;
    }
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "maze> ",
  });
  showHelp();
  rl.prompt();
  rl.on("line", (line: string) => {
    const parts = line.trim().split(/\s+/);
    const cmd = (parts[0] ?? "").toLowerCase();
    const rest = parts.slice(1);
    try {
      if (cmd === "quit" || cmd === "q" || cmd === "exit") {
        rl.close();
        return;
      } else if (cmd === "help" || cmd === "h") showHelp();
      else if (cmd === "generate") cmdGenerate(rest);
      else if (cmd === "solve") cmdSolve(rest);
      else if (cmd === "show") cmdShow(rest);
      else if (cmd === "animate") cmdAnimate(rest);
      else if (cmd === "") {
        /* no-op */
      } else console.log(colorize(`未知命令: ${cmd}`, Color.Red));
    } catch (e) {
      if (e instanceof MazeError)
        console.log(colorize(`错误: ${e.message}`, Color.Red));
      else console.log(colorize(`未知错误: ${String(e)}`, Color.Red));
    }
    rl.prompt();
  });
  rl.on("close", () => {
    process.stdout.write(ANSI.SHOW_CURSOR + ANSI.CLEAR + ANSI.HOME);
    console.log("再见!");
    process.exit(0);
  });
}

main();
