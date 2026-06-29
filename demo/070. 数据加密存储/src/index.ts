#!/usr/bin/env node
/**
 * 数据加密存储
 * - AES-256-GCM 对称加密，scrypt 密钥派生
 * - 加密 KV 存储：init / unlock / set / get / del / keys / export / import / rekey
 *
 * 仅使用 Node.js 内置模块。
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";

/* ===================== Enums ===================== */

enum Command {
  Init = "init",
  Set = "set",
  Get = "get",
  Del = "del",
  Keys = "keys",
  Export = "export",
  Import = "import",
  Rekey = "rekey",
  Stats = "stats",
  Demo = "demo",
}

enum ErrorCode {
  NotInitialized = "NOT_INITIALIZED",
  AlreadyInitialized = "ALREADY_INITIALIZED",
  AuthFailed = "AUTH_FAILED",
  DecryptFailed = "DECRYPT_FAILED",
  WeakPassphrase = "WEAK_PASSPHRASE",
  IoError = "IO_ERROR",
  UnknownCommand = "UNKNOWN_COMMAND",
}

enum VaultState {
  Locked = "locked",
  Unlocked = "unlocked",
}

enum CryptoAlgorithm {
  Aes256Gcm = "aes-256-gcm",
}

enum KeyDerivation {
  Scrypt = "scrypt",
}

/* ===================== Types ===================== */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface StoredItem {
  readonly salt: string;
  readonly iv: string;
  readonly ct: string;
  readonly tag: string;
}

interface VaultFile {
  readonly version: number;
  readonly algo: CryptoAlgorithm;
  readonly kdf: KeyDerivation;
  readonly verifier: StoredItem;
  items: Record<string, StoredItem>;
}

interface Identifiable {
  readonly id: string;
}

interface VaultStats {
  readonly count: number;
  readonly fileBytes: number;
  readonly state: VaultState;
}

type OpResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | {
      readonly kind: "error";
      readonly code: ErrorCode;
      readonly message: string;
    }
  | { readonly kind: "notfound"; readonly key: string };

const VAULT_OK_PLAINTEXT = "VAULT_OK";

const CRYPTO_PARAMS = {
  saltLen: 16,
  ivLen: 12,
  keyLen: 32,
  authTagLen: 16,
  scryptN: 16384,
  scryptR: 8,
  scryptP: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

const MAGIC = Buffer.from("TVLT", "utf8");
const VAULT_VERSION = 1 as const;

/* ===================== Symbols ===================== */

const SYM_META: unique symbol = Symbol("meta");
const SYM_BRAND: unique symbol = Symbol("vaultBrand");

interface MetaInfo {
  readonly createdAt: number;
  modifiedAt: number;
}

/* ===================== Error Hierarchy ===================== */

class VaultError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
class AuthError extends VaultError {
  constructor(msg: string) {
    super(ErrorCode.AuthFailed, msg);
    this.name = "AuthError";
  }
}
class CryptoError extends VaultError {
  constructor(msg: string) {
    super(ErrorCode.DecryptFailed, msg);
    this.name = "CryptoError";
  }
}

/* ===================== Type Guards ===================== */

function isOpSuccess<T>(r: OpResult<T>): r is { kind: "success"; value: T } {
  return r.kind === "success";
}
function isOpError<T>(
  r: OpResult<T>,
): r is { kind: "error"; code: ErrorCode; message: string } {
  return r.kind === "error";
}
function isStoredItem(v: unknown): v is StoredItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.salt === "string" &&
    typeof o.iv === "string" &&
    typeof o.ct === "string" &&
    typeof o.tag === "string"
  );
}

/* ===================== Abstract Crypto Provider ===================== */

abstract class AbstractCryptoProvider {
  readonly algorithm: CryptoAlgorithm;
  protected constructor(algo: CryptoAlgorithm) {
    this.algorithm = algo;
  }
  abstract encrypt(
    key: Buffer,
    plaintext: Buffer,
  ): { iv: Buffer; ct: Buffer; tag: Buffer };
  abstract decrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer;
}

class AesGcmProvider extends AbstractCryptoProvider {
  constructor() {
    super(CryptoAlgorithm.Aes256Gcm);
  }
  encrypt(
    key: Buffer,
    plaintext: Buffer,
  ): { iv: Buffer; ct: Buffer; tag: Buffer } {
    const iv = crypto.randomBytes(CRYPTO_PARAMS.ivLen);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { iv, ct, tag: cipher.getAuthTag() };
  }
  decrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

/* ===================== Generic Vault Store ===================== */

class VaultStore<T extends StoredItem> implements Iterable<T> {
  private items = new Map<string, T>();
  private readonly [SYM_META]: MetaInfo = {
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  };
  constructor() {}
  get count(): number {
    return this.items.size;
  }
  set(key: string, item: T): void {
    this.items.set(key, item);
    this.touch();
  }
  get(key: string): T | undefined {
    return this.items.get(key);
  }
  delete(key: string): boolean {
    const r = this.items.delete(key);
    if (r) this.touch();
    return r;
  }
  keys(): string[] {
    return Array.from(this.items.keys());
  }
  has(key: string): boolean {
    return this.items.has(key);
  }
  clear(): void {
    this.items.clear();
    this.touch();
  }
  private touch(): void {
    this[SYM_META].modifiedAt = Date.now();
  }
  *[Symbol.iterator](): Iterator<T> {
    for (const v of this.items.values()) yield v;
  }
  *entries(): IterableIterator<[string, T]> {
    for (const e of this.items.entries()) yield e;
  }
  toRecord(): Record<string, T> {
    return Object.fromEntries(this.items.entries());
  }
  loadRecord(rec: Record<string, T>): void {
    for (const [k, v] of Object.entries(rec)) this.items.set(k, v);
  }
}

/* ===================== Helpers ===================== */

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(
    Buffer.from(passphrase, "utf8"),
    salt,
    CRYPTO_PARAMS.keyLen,
    {
      N: CRYPTO_PARAMS.scryptN,
      r: CRYPTO_PARAMS.scryptR,
      p: CRYPTO_PARAMS.scryptP,
      maxmem: CRYPTO_PARAMS.maxmem,
    },
  );
}

function toStored(
  salt: Buffer,
  e: { iv: Buffer; ct: Buffer; tag: Buffer },
): StoredItem {
  return {
    salt: salt.toString("base64"),
    iv: e.iv.toString("base64"),
    ct: e.ct.toString("base64"),
    tag: e.tag.toString("base64"),
  };
}

function fromStored(item: StoredItem): {
  salt: Buffer;
  iv: Buffer;
  ct: Buffer;
  tag: Buffer;
} {
  return {
    salt: Buffer.from(item.salt, "base64"),
    iv: Buffer.from(item.iv, "base64"),
    ct: Buffer.from(item.ct, "base64"),
    tag: Buffer.from(item.tag, "base64"),
  };
}

/* ===================== Encrypted Store ===================== */

class EncryptedStore {
  private file: string;
  private passphrase: string | null = null;
  private vault: VaultFile | null = null;
  private provider: AbstractCryptoProvider = new AesGcmProvider();
  private readonly [SYM_BRAND] = true;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  get state(): VaultState {
    return this.passphrase !== null && this.vault !== null
      ? VaultState.Unlocked
      : VaultState.Locked;
  }
  get filePath(): string {
    return this.file;
  }

  isInitialized(): boolean {
    return fs.existsSync(this.file);
  }

  init(passphrase: string): void {
    if (this.isInitialized())
      throw new VaultError(
        ErrorCode.AlreadyInitialized,
        "存储已初始化，请使用 rekey 修改口令",
      );
    if (passphrase.length < 6)
      throw new VaultError(ErrorCode.WeakPassphrase, "口令至少 6 个字符");
    this.passphrase = passphrase;
    const salt = crypto.randomBytes(CRYPTO_PARAMS.saltLen);
    const key = deriveKey(passphrase, salt);
    const verifierEnc = this.provider.encrypt(
      key,
      Buffer.from(VAULT_OK_PLAINTEXT, "utf8"),
    );
    const vault: VaultFile = {
      version: VAULT_VERSION,
      algo: CryptoAlgorithm.Aes256Gcm,
      kdf: KeyDerivation.Scrypt,
      verifier: toStored(salt, verifierEnc),
      items: {},
    };
    this.vault = vault;
    this.save();
  }

  unlock(passphrase: string): boolean {
    if (!this.isInitialized())
      throw new VaultError(ErrorCode.NotInitialized, "存储未初始化");
    const parsed = this.readVault();
    const v = fromStored(parsed.verifier);
    const key = deriveKey(passphrase, v.salt);
    try {
      const pt = this.provider.decrypt(key, v.iv, v.ct, v.tag);
      if (pt.toString("utf8") !== VAULT_OK_PLAINTEXT) return false;
    } catch {
      return false;
    }
    this.passphrase = passphrase;
    this.vault = parsed;
    return true;
  }

  private readVault(): VaultFile {
    const raw = fs.readFileSync(this.file, "utf8");
    try {
      return JSON.parse(raw) as VaultFile;
    } catch {
      const buf = fs.readFileSync(this.file);
      if (
        buf.length < MAGIC.length ||
        buf.slice(0, MAGIC.length).toString() !== MAGIC.toString()
      )
        throw new VaultError(ErrorCode.IoError, "存储文件损坏");
      return JSON.parse(buf.slice(MAGIC.length).toString("utf8")) as VaultFile;
    }
  }

  private ensureUnlocked(): void {
    if (!this.passphrase || !this.vault)
      throw new VaultError(ErrorCode.NotInitialized, "存储未解锁，请先 unlock");
  }

  set(key: string, value: unknown): void {
    this.ensureUnlocked();
    const salt = crypto.randomBytes(CRYPTO_PARAMS.saltLen);
    const dk = deriveKey(this.passphrase!, salt);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const enc = this.provider.encrypt(dk, plaintext);
    this.vault!.items[key] = toStored(salt, enc);
    this.save();
  }

  get<T = unknown>(key: string): T | null {
    this.ensureUnlocked();
    const item = this.vault!.items[key];
    if (!item) return null;
    const v = fromStored(item);
    const dk = deriveKey(this.passphrase!, v.salt);
    try {
      const pt = this.provider.decrypt(dk, v.iv, v.ct, v.tag);
      return JSON.parse(pt.toString("utf8")) as T;
    } catch {
      throw new CryptoError(`解密失败: ${key}（数据可能被篡改）`);
    }
  }

  tryGet<T = unknown>(key: string): OpResult<T> {
    try {
      const v = this.get<T>(key);
      if (v === null) return { kind: "notfound", key };
      return { kind: "success", value: v };
    } catch (e) {
      return {
        kind: "error",
        code: ErrorCode.DecryptFailed,
        message: (e as Error).message,
      };
    }
  }

  del(key: string): boolean {
    this.ensureUnlocked();
    if (!this.vault!.items[key]) return false;
    delete this.vault!.items[key];
    this.save();
    return true;
  }

  keys(): string[] {
    this.ensureUnlocked();
    return Object.keys(this.vault!.items);
  }

  rekey(newPassphrase: string): void {
    this.ensureUnlocked();
    if (newPassphrase.length < 6)
      throw new VaultError(ErrorCode.WeakPassphrase, "口令至少 6 个字符");
    const plain: Record<string, unknown> = {};
    for (const k of Object.keys(this.vault!.items)) plain[k] = this.get(k);
    this.passphrase = newPassphrase;
    const salt = crypto.randomBytes(CRYPTO_PARAMS.saltLen);
    const dk = deriveKey(newPassphrase, salt);
    const verifierEnc = this.provider.encrypt(
      dk,
      Buffer.from(VAULT_OK_PLAINTEXT, "utf8"),
    );
    const vault: VaultFile = {
      version: VAULT_VERSION,
      algo: CryptoAlgorithm.Aes256Gcm,
      kdf: KeyDerivation.Scrypt,
      verifier: toStored(salt, verifierEnc),
      items: {},
    };
    this.vault = vault;
    for (const k of Object.keys(plain)) this.set(k, plain[k]);
    this.save();
  }

  exportToFile(outFile: string): void {
    this.ensureUnlocked();
    const data = JSON.stringify(this.vault, null, 2);
    const buf = Buffer.concat([MAGIC, Buffer.from(data, "utf8")]);
    fs.writeFileSync(path.resolve(outFile), buf);
  }

  importFromFile(inFile: string): number {
    this.ensureUnlocked();
    const buf = fs.readFileSync(path.resolve(inFile));
    let parsed: VaultFile;
    if (
      buf.length >= MAGIC.length &&
      buf.slice(0, MAGIC.length).toString() === MAGIC.toString()
    ) {
      parsed = JSON.parse(
        buf.slice(MAGIC.length).toString("utf8"),
      ) as VaultFile;
    } else {
      parsed = JSON.parse(buf.toString("utf8")) as VaultFile;
    }
    const v = fromStored(parsed.verifier);
    const dk = deriveKey(this.passphrase!, v.salt);
    try {
      const pt = this.provider.decrypt(dk, v.iv, v.ct, v.tag);
      if (pt.toString("utf8") !== VAULT_OK_PLAINTEXT)
        throw new AuthError("导入文件的口令与当前口令不一致");
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError(`无法解密导入文件: ${(e as Error).message}`);
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

  lock(): void {
    this.passphrase = null;
    this.vault = null;
  }

  stats(): VaultStats {
    return {
      count: this.vault ? Object.keys(this.vault.items).length : 0,
      fileBytes: fs.existsSync(this.file) ? fs.statSync(this.file).size : 0,
      state: this.state,
    };
  }

  *iterateItems(): IterableIterator<[string, StoredItem]> {
    this.ensureUnlocked();
    for (const entry of Object.entries(this.vault!.items)) yield entry;
  }
}

/* ===================== Password Prompt ===================== */

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const stdin = process.stdin;
    let data = "";
    process.stdout.write(prompt);
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\r" || c === "\n") {
        process.stdout.write("\n");
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        rl.close();
        resolve(data);
      } else if (c === "\u0003") {
        process.exit(1);
      } else if (c === "\u007f" || c === "\b") {
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
  if (p1.length < 6)
    throw new VaultError(ErrorCode.WeakPassphrase, "口令至少 6 个字符");
  if (confirm) {
    const p2 = await promptPassword("再次输入口令: ");
    if (p1 !== p2)
      throw new VaultError(ErrorCode.AuthFailed, "两次输入的口令不一致");
  }
  return p1;
}

/* ===================== CLI ===================== */

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
  demo                       演示
`);
    return;
  }

  switch (cmd as Command) {
    case Command.Init: {
      if (store.isInitialized())
        throw new VaultError(
          ErrorCode.AlreadyInitialized,
          "已初始化，使用 rekey 修改口令",
        );
      const pass = await getPassphrase(true);
      store.init(pass);
      console.log("已初始化加密存储:", file);
      break;
    }
    case Command.Set: {
      const [key, ...valParts] = rest;
      if (!key) throw new VaultError(ErrorCode.IoError, "缺少 key");
      const value = valParts.join(" ");
      if (!value) throw new VaultError(ErrorCode.IoError, "缺少 value");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      let parsed: unknown = value;
      try {
        parsed = JSON.parse(value);
      } catch {
        /* 字符串 */
      }
      store.set(key, parsed);
      console.log("已加密保存:", key);
      store.lock();
      break;
    }
    case Command.Get: {
      const [key] = rest;
      if (!key) throw new VaultError(ErrorCode.IoError, "缺少 key");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      const result = store.tryGet<unknown>(key);
      if (isOpSuccess(result))
        console.log(
          typeof result.value === "string"
            ? result.value
            : JSON.stringify(result.value, null, 2),
        );
      else if (result.kind === "notfound") console.log("(nil)");
      else if (isOpError(result)) console.error("错误:", result.message);
      store.lock();
      break;
    }
    case Command.Del: {
      const [key] = rest;
      if (!key) throw new VaultError(ErrorCode.IoError, "缺少 key");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      console.log(store.del(key) ? "已删除" : "(nil)");
      store.lock();
      break;
    }
    case Command.Keys: {
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      const keys = store.keys();
      console.log(keys.length === 0 ? "(empty)" : keys.join("\n"));
      store.lock();
      break;
    }
    case Command.Export: {
      const [out] = rest;
      if (!out) throw new VaultError(ErrorCode.IoError, "缺少导出文件路径");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      store.exportToFile(out);
      console.log("已导出到:", out);
      store.lock();
      break;
    }
    case Command.Import: {
      const [inp] = rest;
      if (!inp) throw new VaultError(ErrorCode.IoError, "缺少导入文件路径");
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      const n = store.importFromFile(inp);
      console.log(`已导入 ${n} 个新条目`);
      store.lock();
      break;
    }
    case Command.Rekey: {
      const pass = await getPassphrase();
      if (!store.unlock(pass)) throw new AuthError("口令错误");
      const newPass = await getPassphrase(true);
      store.rekey(newPass);
      console.log("口令已修改，所有条目已重新加密");
      store.lock();
      break;
    }
    case Command.Stats: {
      console.log(store.stats());
      break;
    }
    case Command.Demo: {
      const pass = "demo-pass-123";
      if (store.isInitialized()) fs.unlinkSync(file);
      store.init(pass);
      console.log("=== 加密存储演示 ===");
      console.log("已初始化 vault, 状态:", store.state);
      store.set("api-key", "sk-abc123-secret");
      store.set("db-config", { host: "localhost", port: 5432, user: "admin" });
      store.set("note", "这是一段机密笔记");
      console.log("\n存储的键:", store.keys());
      console.log("api-key:", store.get("api-key"));
      console.log("db-config:", store.get("db-config"));
      console.log("note:", store.get("note"));
      const rawFile = fs.readFileSync(file, "utf8");
      console.log(
        "\n文件中是否包含明文 'sk-abc123-secret':",
        rawFile.includes("sk-abc123-secret"),
      );
      console.log(
        "文件中是否包含明文 '机密笔记':",
        rawFile.includes("机密笔记"),
      );
      console.log("\n用错误口令解锁:", store.unlock("wrong-pass"));
      store.unlock(pass);
      store.rekey("new-pass-456");
      console.log("rekey 后用新口令解锁:", store.unlock("new-pass-456"));
      console.log("rekey 后 api-key:", store.get("api-key"));
      const exp = path.join(process.cwd(), "vault-export.dat");
      store.exportToFile(exp);
      console.log("已导出到:", exp);
      console.log("\n迭代所有条目:");
      for (const [k, item] of store.iterateItems())
        console.log(`  ${k}: ct=${item.ct.slice(0, 20)}...`);
      store.lock();
      break;
    }
    default:
      throw new VaultError(ErrorCode.UnknownCommand, `未知命令: ${cmd}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}
