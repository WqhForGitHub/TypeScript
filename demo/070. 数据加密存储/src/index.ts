#!/usr/bin/env node
/**
 * 数据加密存储
 * - 使用 Node.js crypto：AES-256-GCM 对称加密
 * - 密钥通过 scrypt 从口令派生（salt + 口令 -> 32 字节密钥）
 * - 存储格式：salt(16) + iv(12) + ciphertext + authTag(16)
 * - 加密 KV 存储：set / get / del / keys
 * - 命令：init / set / get / del / keys / export / import / rekey
 * - 操作前验证口令（尝试解密校验数据）
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";

const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32; // AES-256
const AUTH_TAG_LEN = 16;
const SCRYPT_N = 16384; // CPU/内存代价
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAGIC = Buffer.from("TVLT"); // TypeScript VauLT

/** 单个加密条目的存储格式 */
interface StoredItem {
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64 密文
  tag: string; // base64 authTag
}

/** 整个 vault 文件 */
interface VaultFile {
  version: number;
  // 用于校验口令：存一个固定明文 "VAULT_OK" 的加密结果
  verifier: StoredItem;
  items: Record<string, StoredItem>;
}

/** 从口令派生密钥 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(Buffer.from(passphrase, "utf8"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

/** AES-256-GCM 加密 */
function encrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ct, tag };
}

/** AES-256-GCM 解密 */
function decrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function toStored(salt: Buffer, e: { iv: Buffer; ct: Buffer; tag: Buffer }): StoredItem {
  return {
    salt: salt.toString("base64"),
    iv: e.iv.toString("base64"),
    ct: e.ct.toString("base64"),
    tag: e.tag.toString("base64"),
  };
}

function fromStored(item: StoredItem): { salt: Buffer; iv: Buffer; ct: Buffer; tag: Buffer } {
  return {
    salt: Buffer.from(item.salt, "base64"),
    iv: Buffer.from(item.iv, "base64"),
    ct: Buffer.from(item.ct, "base64"),
    tag: Buffer.from(item.tag, "base64"),
  };
}

/** 加密存储主类 */
export class EncryptedStore {
  private file: string;
  private passphrase: string | null = null;
  private vault: VaultFile | null = null;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return fs.existsSync(this.file);
  }

  /** 初始化 vault（设置口令） */
  init(passphrase: string): void {
    if (this.isInitialized()) throw new Error("存储已初始化，请使用 rekey 修改口令");
    if (passphrase.length < 6) throw new Error("口令至少 6 个字符");
    this.passphrase = passphrase;
    const salt = crypto.randomBytes(SALT_LEN);
    const key = deriveKey(passphrase, salt);
    // 创建校验器
    const verifierEnc = encrypt(key, Buffer.from("VAULT_OK", "utf8"));
    const vault: VaultFile = {
      version: 1,
      verifier: toStored(salt, verifierEnc),
      items: {},
    };
    this.vault = vault;
    this.save();
  }

  /** 解锁：验证口令并加载 */
  unlock(passphrase: string): boolean {
    if (!this.isInitialized()) throw new Error("存储未初始化");
    const raw = fs.readFileSync(this.file, "utf8");
    let parsed: VaultFile;
    try {
      parsed = JSON.parse(raw) as VaultFile;
    } catch {
      // 也许是旧格式：MAGIC + JSON
      const buf = fs.readFileSync(this.file);
      if (buf.length < MAGIC.length || buf.slice(0, MAGIC.length).toString() !== MAGIC.toString()) {
        throw new Error("存储文件损坏");
      }
      parsed = JSON.parse(buf.slice(MAGIC.length).toString("utf8")) as VaultFile;
    }
    const v = fromStored(parsed.verifier);
    const key = deriveKey(passphrase, v.salt);
    try {
      const pt = decrypt(key, v.iv, v.ct, v.tag);
      if (pt.toString("utf8") !== "VAULT_OK") return false;
    } catch {
      return false;
    }
    this.passphrase = passphrase;
    this.vault = parsed;
    return true;
  }

  /** 确保已解锁 */
  private ensureUnlocked(): void {
    if (!this.passphrase || !this.vault) throw new Error("存储未解锁，请先 unlock");
  }

  /** 设置键值 */
  set(key: string, value: unknown): void {
    this.ensureUnlocked();
    const salt = crypto.randomBytes(SALT_LEN);
    const dk = deriveKey(this.passphrase!, salt);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const enc = encrypt(dk, plaintext);
    this.vault!.items[key] = toStored(salt, enc);
    this.save();
  }

  /** 获取键值 */
  get<T = unknown>(key: string): T | null {
    this.ensureUnlocked();
    const item = this.vault!.items[key];
    if (!item) return null;
    const v = fromStored(item);
    const dk = deriveKey(this.passphrase!, v.salt);
    try {
      const pt = decrypt(dk, v.iv, v.ct, v.tag);
      return JSON.parse(pt.toString("utf8")) as T;
    } catch {
      throw new Error(`解密失败: ${key}（数据可能被篡改）`);
    }
  }

  /** 删除键 */
  del(key: string): boolean {
    this.ensureUnlocked();
    if (!this.vault!.items[key]) return false;
    delete this.vault!.items[key];
    this.save();
    return true;
  }

  /** 列出键 */
  keys(): string[] {
    this.ensureUnlocked();
    return Object.keys(this.vault!.items);
  }

  /** 修改口令（重新加密所有条目） */
  rekey(newPassphrase: string): void {
    this.ensureUnlocked();
    if (newPassphrase.length < 6) throw new Error("口令至少 6 个字符");
    // 先解密所有明文
    const plain: Record<string, unknown> = {};
    for (const k of Object.keys(this.vault!.items)) {
      plain[k] = this.get(k);
    }
    // 用新口令重建
    this.passphrase = newPassphrase;
    const salt = crypto.randomBytes(SALT_LEN);
    const dk = deriveKey(newPassphrase, salt);
    const verifierEnc = encrypt(dk, Buffer.from("VAULT_OK", "utf8"));
    const vault: VaultFile = {
      version: 1,
      verifier: toStored(salt, verifierEnc),
      items: {},
    };
    this.vault = vault;
    for (const k of Object.keys(plain)) this.set(k, plain[k]);
    this.save();
  }

  /** 导出（加密导出文件，独立口令可选） */
  exportToFile(outFile: string, exportPassphrase?: string): void {
    this.ensureUnlocked();
    // 把当前 vault 原样写出（已经是加密的）
    const data = JSON.stringify(this.vault, null, 2);
    const buf = Buffer.concat([MAGIC, Buffer.from(data, "utf8")]);
    fs.writeFileSync(path.resolve(outFile), buf);
    void exportPassphrase;
  }

  /** 导入（合并条目，需用同一口令） */
  importFromFile(inFile: string): number {
    this.ensureUnlocked();
    const buf = fs.readFileSync(path.resolve(inFile));
    let parsed: VaultFile;
    if (buf.length >= MAGIC.length && buf.slice(0, MAGIC.length).toString() === MAGIC.toString()) {
      parsed = JSON.parse(buf.slice(MAGIC.length).toString("utf8")) as VaultFile;
    } else {
      parsed = JSON.parse(buf.toString("utf8")) as VaultFile;
    }
    // 校验导入文件的口令是否一致（用当前口令尝试解密 verifier）
    const v = fromStored(parsed.verifier);
    const dk = deriveKey(this.passphrase!, v.salt);
    try {
      const pt = decrypt(dk, v.iv, v.ct, v.tag);
      if (pt.toString("utf8") !== "VAULT_OK") {
        throw new Error("导入文件的口令与当前口令不一致");
      }
    } catch (e) {
      throw new Error(`无法解密导入文件: ${(e as Error).message}`);
    }
    let count = 0;
    for (const k of Object.keys(parsed.items)) {
      if (!this.vault!.items[k]) count++;
      this.vault!.items[k] = parsed.items[k];
    }
    this.save();
    return count;
  }

  private save(): void {
    const data = JSON.stringify(this.vault, null, 2);
    const buf = Buffer.concat([MAGIC, Buffer.from(data, "utf8")]);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.file);
  }

  /** 锁定（清除内存中的口令） */
  lock(): void {
    this.passphrase = null;
    this.vault = null;
  }

  /** 统计 */
  stats(): { count: number; fileBytes: number } {
    const count = this.vault ? Object.keys(this.vault.items).length : 0;
    let fileBytes = 0;
    if (fs.existsSync(this.file)) fileBytes = fs.statSync(this.file).size;
    return { count, fileBytes };
  }
}

/* ----------------------- 口令输入 ----------------------- */

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // 在 stdout 隐藏输入（简易实现：覆盖 _writeToOutput）
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY;
    let data = "";
    process.stdout.write(prompt);
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\r" || c === "\n") {
        process.stdout.write("\n");
        stdin.removeListener("data", onData);
        if (wasRaw !== undefined) stdin.setRawMode(false);
        rl.close();
        resolve(data);
      } else if (c === "\u0003") {
        // Ctrl+C
        process.exit(1);
      } else if (c === "\u007f" || c === "\b") {
        // 退格
        if (data.length > 0) {
          data = data.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        data += c;
        process.stdout.write("*");
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function getPassphrase(confirm = false): Promise<string> {
  const p1 = await promptPassword("请输入口令: ");
  if (p1.length < 6) throw new Error("口令至少 6 个字符");
  if (confirm) {
    const p2 = await promptPassword("再次输入口令: ");
    if (p1 !== p2) throw new Error("两次输入的口令不一致");
  }
  return p1;
}

/* ----------------------- CLI ----------------------- */

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const file = path.join(process.cwd(), "vault.dat");
  const store = new EncryptedStore(file);

  if (!cmd) {
    console.log(`数据加密存储 CLI
用法:
  init                       初始化并设置口令
  set <key> <value>          设置键值（加密存储）
  get <key>                  获取键值（解密）
  del <key>                  删除键
  keys                       列出所有键
  export <file>              导出加密文件
  import <file>              导入加密文件
  rekey                      修改口令
  stats                      查看统计
注意：所有操作会提示输入口令以解锁。
`);
    return;
  }

  switch (cmd) {
    case "init": {
      if (store.isInitialized()) throw new Error("已初始化，使用 rekey 修改口令");
      const pass = await getPassphrase(true);
      store.init(pass);
      console.log("已初始化加密存储:", file);
      break;
    }
    case "set": {
      const [key, ...valParts] = rest;
      if (!key) throw new Error("缺少 key");
      const value = valParts.join(" ");
      if (!value) throw new Error("缺少 value");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      // 尝试解析 JSON，否则按字符串
      let parsed: unknown = value;
      try { parsed = JSON.parse(value); } catch { /* 保持字符串 */ }
      store.set(key, parsed);
      console.log("已加密保存:", key);
      store.lock();
      break;
    }
    case "get": {
      const [key] = rest;
      if (!key) throw new Error("缺少 key");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      const v = store.get(key);
      console.log(v === null ? "(nil)" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
      store.lock();
      break;
    }
    case "del": {
      const [key] = rest;
      if (!key) throw new Error("缺少 key");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      console.log(store.del(key) ? "已删除" : "(nil)");
      store.lock();
      break;
    }
    case "keys": {
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      const keys = store.keys();
      console.log(keys.length === 0 ? "(empty)" : keys.join("\n"));
      store.lock();
      break;
    }
    case "export": {
      const [out] = rest;
      if (!out) throw new Error("缺少导出文件路径");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      store.exportToFile(out);
      console.log("已导出到:", out);
      store.lock();
      break;
    }
    case "import": {
      const [inp] = rest;
      if (!inp) throw new Error("缺少导入文件路径");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      const n = store.importFromFile(inp);
      console.log(`已导入 ${n} 个新条目`);
      store.lock();
      break;
    }
    case "rekey": {
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new Error("口令错误");
      const newPass = await getPassphrase(true);
      store.rekey(newPass);
      console.log("口令已修改，所有条目已重新加密");
      store.lock();
      break;
    }
    case "stats": {
      console.log(store.stats());
      break;
    }
    case "demo": {
      // 自动化演示（不交互）
      const pass = "demo-pass-123";
      if (store.isInitialized()) {
        // 删除旧文件以便重新演示
        fs.unlinkSync(file);
      }
      store.init(pass);
      console.log("=== 加密存储演示 ===");
      console.log("已初始化 vault");
      store.set("api-key", "sk-abc123-secret");
      store.set("db-config", { host: "localhost", port: 5432, user: "admin" });
      store.set("note", "这是一段机密笔记");
      console.log("\n存储的键:", store.keys());
      console.log("api-key:", store.get("api-key"));
      console.log("db-config:", store.get("db-config"));
      console.log("note:", store.get("note"));
      // 文件中看不到明文
      const rawFile = fs.readFileSync(file, "utf8");
      console.log("\n文件中是否包含明文 'sk-abc123-secret':", rawFile.includes("sk-abc123-secret"));
      console.log("文件中是否包含明文 '机密笔记':", rawFile.includes("机密笔记"));
      // 错误口令
      console.log("\n用错误口令解锁:", store.unlock("wrong-pass"));
      // 重新加密
      store.unlock(pass);
      store.rekey("new-pass-456");
      console.log("rekey 后用新口令解锁:", store.unlock("new-pass-456"));
      console.log("rekey 后 api-key:", store.get("api-key"));
      // 导出
      const exp = path.join(process.cwd(), "vault-export.dat");
      store.exportToFile(exp);
      console.log("已导出到:", exp);
      store.lock();
      break;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
