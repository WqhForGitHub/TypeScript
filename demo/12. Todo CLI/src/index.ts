#!/usr/bin/env node

/**
 * Todo CLI — 命令行 Todo 管理工具
 *
 * 功能：
 *   - add <内容>          添加一条新任务
 *   - list                列出所有任务
 *   - done <id>           标记指定任务为已完成
 *   - undone <id>         取消指定任务的完成状态
 *   - edit <id> <内容>    编辑指定任务的内容
 *   - delete <id>         删除指定任务
 *   - clear               清除所有已完成的任务
 *   - stats               显示任务统计信息
 *   - help                显示帮助信息
 *
 * 数据存储：以 JSON 格式持久化在用户主目录下 ~/.todo-cli/todos.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/* ============================== 类型定义 ============================== */

interface Todo {
  id: number;
  content: string;
  done: boolean;
  createdAt: string; // ISO 时间字符串
  completedAt: string | null; // ISO 时间字符串
}

interface TodoStore {
  nextId: number;
  todos: Todo[];
}

/* ============================== 存储相关 ============================== */

const DATA_DIR: string = path.join(os.homedir(), ".todo-cli");
const DATA_FILE: string = path.join(DATA_DIR, "todos.json");

function ensureDataFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const empty: TodoStore = { nextId: 1, todos: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2), "utf-8");
  }
}

function loadStore(): TodoStore {
  ensureDataFile();
  try {
    const raw: string = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TodoStore;
    if (typeof parsed.nextId !== "number" || !Array.isArray(parsed.todos)) {
      throw new Error("数据文件格式不正确");
    }
    return parsed;
  } catch (err) {
    console.error(
      "读取数据文件失败，将使用空数据。错误信息：",
      (err as Error).message,
    );
    return { nextId: 1, todos: [] };
  }
}

function saveStore(store: TodoStore): void {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/* ============================== 工具函数 ============================== */

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function findTodoIndex(store: TodoStore, id: number): number {
  return store.todos.findIndex((t) => t.id === id);
}

/** 绘制水平分割线 */
function divider(char: string = "─", length: number = 50): string {
  return char.repeat(length);
}

/* ============================== 命令实现 ============================== */

function cmdAdd(content: string): void {
  if (!content || content.trim().length === 0) {
    console.error("错误：请提供任务内容。用法：todo-cli add <内容>");
    return;
  }

  const store = loadStore();
  const now = new Date().toISOString();
  const todo: Todo = {
    id: store.nextId,
    content: content.trim(),
    done: false,
    createdAt: now,
    completedAt: null,
  };
  store.todos.push(todo);
  store.nextId += 1;
  saveStore(store);

  console.log(`已添加任务 #${todo.id}：${todo.content}`);
}

function cmdList(): void {
  const store = loadStore();
  if (store.todos.length === 0) {
    console.log("暂无任务。使用 `todo-cli add <内容>` 添加一条新任务。");
    return;
  }

  const doneCount = store.todos.filter((t) => t.done).length;
  const totalCount = store.todos.length;

  console.log();
  console.log(`  Todo 列表 (共 ${totalCount} 项，已完成 ${doneCount} 项)`);
  console.log(`  ${divider()}`);

  for (const todo of store.todos) {
    const check = todo.done ? "x" : " ";
    const content = todo.done ? `\x1b[9m${todo.content}\x1b[0m` : todo.content;
    console.log(`  [${check}] ${todo.id}  ${content}`);
  }

  console.log(`  ${divider()}`);
  console.log();
}

function cmdDone(idStr: string): void {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  const store = loadStore();
  const idx = findTodoIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的任务。`);
    return;
  }

  const todo = store.todos[idx]!;
  if (todo.done) {
    console.log(`任务 #${todo.id} 已经是完成状态。`);
    return;
  }

  todo.done = true;
  todo.completedAt = new Date().toISOString();
  saveStore(store);

  console.log(`已完成任务 #${todo.id}：${todo.content}`);
}

function cmdUndone(idStr: string): void {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  const store = loadStore();
  const idx = findTodoIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的任务。`);
    return;
  }

  const todo = store.todos[idx]!;
  if (!todo.done) {
    console.log(`任务 #${todo.id} 已经是未完成状态。`);
    return;
  }

  todo.done = false;
  todo.completedAt = null;
  saveStore(store);

  console.log(`已取消完成任务 #${todo.id}：${todo.content}`);
}

function cmdEdit(idStr: string, content: string): void {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  if (!content || content.trim().length === 0) {
    console.error(
      "错误：请提供新的任务内容。用法：todo-cli edit <id> <新内容>",
    );
    return;
  }

  const store = loadStore();
  const idx = findTodoIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的任务。`);
    return;
  }

  const todo = store.todos[idx]!;
  const oldContent = todo.content;
  todo.content = content.trim();
  saveStore(store);

  console.log(`已编辑任务 #${todo.id}：`);
  console.log(`  旧内容：${oldContent}`);
  console.log(`  新内容：${todo.content}`);
}

function cmdDelete(idStr: string): void {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  const store = loadStore();
  const idx = findTodoIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的任务。`);
    return;
  }

  const removed = store.todos.splice(idx, 1)[0]!;
  saveStore(store);

  const status = removed.done ? "已完成" : "未完成";
  console.log(`已删除任务 #${removed.id}（${status}）：${removed.content}`);
}

function cmdClear(): void {
  const store = loadStore();
  const doneCount = store.todos.filter((t) => t.done).length;

  if (doneCount === 0) {
    console.log("没有已完成的任务需要清除。");
    return;
  }

  store.todos = store.todos.filter((t) => !t.done);
  saveStore(store);

  console.log(`已清除 ${doneCount} 项已完成的任务。`);
}

function cmdStats(): void {
  const store = loadStore();
  const total = store.todos.length;

  if (total === 0) {
    console.log("暂无任务，无统计信息。");
    return;
  }

  const doneCount = store.todos.filter((t) => t.done).length;
  const pendingCount = total - doneCount;
  const percentage = Math.round((doneCount / total) * 100);

  // 找出最早和最晚创建的任务
  const sortedByDate = [...store.todos].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const earliest = sortedByDate[0]!;
  const latest = sortedByDate[sortedByDate.length - 1]!;

  // 找出最近完成的任务
  const completedTodos = store.todos.filter((t) => t.done && t.completedAt);
  const recentlyCompleted =
    completedTodos.length > 0
      ? [...completedTodos].sort(
          (a, b) =>
            new Date(b.completedAt!).getTime() -
            new Date(a.completedAt!).getTime(),
        )[0]!
      : null;

  // 进度条
  const barLength = 20;
  const filled = Math.round((doneCount / total) * barLength);
  const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

  console.log();
  console.log(`  Todo 统计`);
  console.log(`  ${divider("═", 40)}`);
  console.log(`  总任务数：${total}`);
  console.log(`  已完成：  ${doneCount}`);
  console.log(`  未完成：  ${pendingCount}`);
  console.log(`  完成率：  ${bar} ${percentage}%`);
  console.log(`  ${divider("─", 40)}`);

  if (earliest) {
    console.log(`  最早创建：#${earliest.id} ${earliest.content}`);
    console.log(`            ${formatDate(earliest.createdAt)}`);
  }
  if (latest) {
    console.log(`  最新创建：#${latest.id} ${latest.content}`);
    console.log(`            ${formatDate(latest.createdAt)}`);
  }
  if (recentlyCompleted) {
    console.log(
      `  最近完成：#${recentlyCompleted.id} ${recentlyCompleted.content}`,
    );
    console.log(`            ${formatDate(recentlyCompleted.completedAt!)}`);
  }

  console.log(`  ${divider("═", 40)}`);
  console.log();
}

function cmdHelp(): void {
  console.log(
    [
      "Todo CLI — 命令行 Todo 管理工具",
      "",
      "用法： todo-cli <command> [args...]",
      "",
      "命令：",
      "  add    <内容>          添加一条新任务",
      "  list                   列出所有任务",
      "  done   <id>            标记指定任务为已完成",
      "  undone <id>            取消指定任务的完成状态",
      "  edit   <id> <内容>     编辑指定任务的内容",
      "  delete <id>            删除指定任务",
      "  clear                  清除所有已完成的任务",
      "  stats                  显示任务统计信息",
      "  help                   显示帮助信息",
      "",
      "别名：",
      "  add    → new",
      "  list   → ls",
      "  delete → rm, del",
      "",
      "数据存储路径：" + DATA_FILE,
      "",
      "示例：",
      "  todo-cli add 学习 TypeScript",
      "  todo-cli list",
      "  todo-cli done 1",
      "  todo-cli edit 1 学习 TypeScript 高级类型",
      "  todo-cli undone 1",
      "  todo-cli delete 1",
      "  todo-cli clear",
      "  todo-cli stats",
    ].join("\n"),
  );
}

/* ============================== 入口 ============================== */

function main(): void {
  const argv: string[] = process.argv.slice(2);
  const command: string = (argv[0] ?? "help").toLowerCase();

  switch (command) {
    case "add":
    case "new":
      cmdAdd(argv.slice(1).join(" "));
      break;

    case "list":
    case "ls":
      cmdList();
      break;

    case "done":
    case "complete":
      cmdDone(argv[1] ?? "");
      break;

    case "undone":
    case "incomplete":
      cmdUndone(argv[1] ?? "");
      break;

    case "edit":
    case "update":
      cmdEdit(argv[1] ?? "", argv.slice(2).join(" "));
      break;

    case "delete":
    case "del":
    case "rm":
      cmdDelete(argv[1] ?? "");
      break;

    case "clear":
    case "clean":
      cmdClear();
      break;

    case "stats":
    case "stat":
      cmdStats();
      break;

    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;

    default:
      console.error(`未知命令：${command}`);
      console.error("使用 `todo-cli help` 查看可用命令。");
      process.exit(1);
  }
}

main();
