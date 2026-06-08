#!/usr/bin/env node

/**
 * 简单记事本 CLI
 *
 * 功能：
 *   - list                 列出所有笔记
 *   - add <title>          新建一条笔记（标题），随后输入内容（多行，单独一行输入 :wq 结束）
 *   - view <id>            查看指定笔记内容
 *   - edit <id>            编辑指定笔记内容
 *   - delete <id>          删除指定笔记
 *   - search <keyword>     在标题与内容中搜索关键字
 *   - help                 显示帮助信息
 *
 * 数据存储：以 JSON 格式持久化在用户主目录下 ~/.simple-notepad-cli/notes.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

/* ============================== 类型定义 ============================== */

interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: string; // ISO 时间字符串
  updatedAt: string; // ISO 时间字符串
}

interface NoteStore {
  nextId: number;
  notes: Note[];
}

/* ============================== 存储相关 ============================== */

const DATA_DIR: string = path.join(os.homedir(), ".simple-notepad-cli");
const DATA_FILE: string = path.join(DATA_DIR, "notes.json");

function ensureDataFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const empty: NoteStore = { nextId: 1, notes: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2), "utf-8");
  }
}

function loadStore(): NoteStore {
  ensureDataFile();
  try {
    const raw: string = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as NoteStore;
    if (typeof parsed.nextId !== "number" || !Array.isArray(parsed.notes)) {
      throw new Error("数据文件格式不正确");
    }
    return parsed;
  } catch (err) {
    console.error(
      "读取数据文件失败，将使用空数据。错误信息：",
      (err as Error).message,
    );
    return { nextId: 1, notes: [] };
  }
}

function saveStore(store: NoteStore): void {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/* ============================== 工具函数 ============================== */

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function findNoteIndex(store: NoteStore, id: number): number {
  return store.notes.findIndex((n) => n.id === id);
}

/**
 * 多行输入工具：读取用户输入，单独一行输入 :wq 结束并保存，
 * 单独一行输入 :q 则放弃。返回 null 表示放弃。
 */
function readMultiLine(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    console.log(prompt);
    console.log("（提示：单独一行输入 :wq 保存并结束，输入 :q 放弃）");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    const lines: string[] = [];

    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (trimmed === ":wq") {
        rl.close();
        resolve(lines.join("\n"));
      } else if (trimmed === ":q") {
        rl.close();
        resolve(null);
      } else {
        lines.push(line);
      }
    });

    rl.on("close", () => {
      // 若被外部关闭（例如 Ctrl+D），默认保存已输入内容
      // 这里通过判断 resolved 状态不可行，故让上面的分支先 resolve。
    });
  });
}

/* ============================== 命令实现 ============================== */

function cmdList(): void {
  const store = loadStore();
  if (store.notes.length === 0) {
    console.log("暂无笔记。使用 `notepad-cli add <标题>` 新建一条笔记。");
    return;
  }

  console.log("当前共有 " + store.notes.length + " 条笔记：");
  console.log("--------------------------------------------------");
  console.log("ID\t创建时间\t\t更新时间\t\t标题");
  console.log("--------------------------------------------------");
  for (const note of store.notes) {
    console.log(
      `${note.id}\t${formatDate(note.createdAt)}\t${formatDate(
        note.updatedAt,
      )}\t${note.title}`,
    );
  }
  console.log("--------------------------------------------------");
}

async function cmdAdd(title: string): Promise<void> {
  if (!title || title.trim().length === 0) {
    console.error("错误：请提供笔记标题。用法：notepad-cli add <标题>");
    return;
  }

  const content = await readMultiLine(`请输入笔记内容，标题为：「${title}」`);
  if (content === null) {
    console.log("已放弃新建笔记。");
    return;
  }

  const store = loadStore();
  const now = new Date().toISOString();
  const note: Note = {
    id: store.nextId,
    title: title.trim(),
    content,
    createdAt: now,
    updatedAt: now,
  };
  store.notes.push(note);
  store.nextId += 1;
  saveStore(store);

  console.log(`已保存笔记，ID = ${note.id}`);
}

function cmdView(idStr: string): void {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  const store = loadStore();
  const idx = findNoteIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的笔记。`);
    return;
  }

  const note = store.notes[idx]!;
  console.log("==================================================");
  console.log(`ID:       ${note.id}`);
  console.log(`标题:     ${note.title}`);
  console.log(`创建时间: ${formatDate(note.createdAt)}`);
  console.log(`更新时间: ${formatDate(note.updatedAt)}`);
  console.log("--------------------------------------------------");
  console.log(note.content || "(空)");
  console.log("==================================================");
}

async function cmdEdit(idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  const store = loadStore();
  const idx = findNoteIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的笔记。`);
    return;
  }

  const note = store.notes[idx]!;
  console.log(`正在编辑笔记「${note.title}」（ID = ${note.id}）`);
  console.log("--------------------------------------------------");
  console.log("当前内容：");
  console.log(note.content || "(空)");
  console.log("--------------------------------------------------");

  const newContent =
    await readMultiLine("请输入新的笔记内容（将覆盖原内容）：");
  if (newContent === null) {
    console.log("已放弃编辑笔记。");
    return;
  }

  note.content = newContent;
  note.updatedAt = new Date().toISOString();
  saveStore(store);

  console.log(`笔记 ID = ${note.id} 已更新。`);
}

function cmdDelete(idStr: string): void {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("错误：ID 必须是正整数。");
    return;
  }

  const store = loadStore();
  const idx = findNoteIndex(store, id);
  if (idx === -1) {
    console.error(`未找到 ID 为 ${id} 的笔记。`);
    return;
  }

  const removed = store.notes.splice(idx, 1)[0]!;
  saveStore(store);
  console.log(`已删除笔记 ID = ${removed.id}（标题：${removed.title}）。`);
}

function cmdSearch(keyword: string): void {
  if (!keyword || keyword.trim().length === 0) {
    console.error("错误：请提供搜索关键字。用法：notepad-cli search <关键字>");
    return;
  }

  const kw = keyword.trim().toLowerCase();
  const store = loadStore();
  const hits = store.notes.filter(
    (n) =>
      n.title.toLowerCase().includes(kw) ||
      n.content.toLowerCase().includes(kw),
  );

  if (hits.length === 0) {
    console.log(`未找到包含关键字「${keyword}」的笔记。`);
    return;
  }

  console.log(`共找到 ${hits.length} 条匹配笔记：`);
  console.log("--------------------------------------------------");
  for (const note of hits) {
    console.log(
      `ID ${note.id} | ${formatDate(note.updatedAt)} | ${note.title}`,
    );
    // 输出第一行作为预览
    const firstLine =
      note.content.split("\n").find((l) => l.trim().length > 0) ?? "";
    if (firstLine.length > 0) {
      const preview =
        firstLine.length > 60 ? firstLine.slice(0, 60) + "..." : firstLine;
      console.log(`   预览: ${preview}`);
    }
  }
  console.log("--------------------------------------------------");
}

function cmdHelp(): void {
  console.log(
    [
      "简单记事本 CLI",
      "",
      "用法： notepad-cli <command> [args...]",
      "",
      "命令：",
      "  list                     列出所有笔记",
      "  add    <标题>            新建一条笔记",
      "  view   <id>              查看指定笔记内容",
      "  edit   <id>              编辑指定笔记内容",
      "  delete <id>              删除指定笔记",
      "  search <关键字>          在标题与内容中搜索关键字",
      "  help                     显示帮助信息",
      "",
      "数据存储路径：" + DATA_FILE,
      "",
      "示例：",
      "  notepad-cli add 我的第一条笔记",
      "  notepad-cli list",
      "  notepad-cli view 1",
      "  notepad-cli edit 1",
      "  notepad-cli delete 1",
      "  notepad-cli search typescript",
    ].join("\n"),
  );
}

/* ============================== 入口 ============================== */

async function main(): Promise<void> {
  const argv: string[] = process.argv.slice(2);
  const command: string = (argv[0] ?? "help").toLowerCase();
  const args: string[] = argv.slice(1);

  switch (command) {
    case "list":
    case "ls":
      cmdList();
      break;

    case "add":
    case "new":
      await cmdAdd(args.join(" "));
      break;

    case "view":
    case "show":
    case "cat":
      cmdView(args[0] ?? "");
      break;

    case "edit":
    case "update":
      await cmdEdit(args[0] ?? "");
      break;

    case "delete":
    case "del":
    case "rm":
      cmdDelete(args[0] ?? "");
      break;

    case "search":
    case "find":
    case "grep":
      cmdSearch(args.join(" "));
      break;

    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;

    default:
      console.error(`未知命令：${command}`);
      console.error("使用 `notepad-cli help` 查看可用命令。");
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("程序执行出错：", err);
  process.exit(1);
});
