#!/usr/bin/env node
/**
 * 加密解密工具库 (Crypto Library) - 增强版
 * 基于 Node.js 内置 crypto / fs / path 模块。
 *
 * API: hash/hashFile/hashStream, hmac, encryptAesGcm/decryptAesGcm,
 *   encryptAesCbc/decryptAesCbc, AbstractCipher -> AesCipher/RsaCipher,
 *   generateRsaKeyPair/rsaSign/rsaVerify, hashPassword/verifyPassword,
 *   pbkdf2/deriveKey, random/uuid/token, base64/hex, constantTimeCompare,
 *   KeyStore<T extends KeyEntry>.
 *
 * TS 特性: string enums / discriminated unions / generic class / abstract
 *   class / mapped types / custom Error / satisfies / getter-setter /
 *   generators / symbols / as const / type guards / function overloads.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// ============================================================
// 1. 字符串枚举 (String Enums, NOT const enum)
// ============================================================

export enum HashAlgorithm {
  MD5 = "md5",
  SHA1 = "sha1",
  SHA256 = "sha256",
  SHA384 = "sha384",
  SHA512 = "sha512",
  RIPEMD160 = "ripemd160",
}

export enum CipherAlgorithm {
  AES256GCM = "aes-256-gcm",
  AES256CBC = "aes-256-cbc",
  RSA = "rsa",
}

export enum ErrorCode {
  Unknown = "UNKNOWN",
  InvalidInput = "INVALID_INPUT",
  InvalidKey = "INVALID_KEY",
  EncryptFailed = "ENCRYPT_FAILED",
  DecryptFailed = "DECRYPT_FAILED",
  VerifyFailed = "VERIFY_FAILED",
  Unsupported = "UNSUPPORTED",
}

export enum Encoding {
  Hex = "hex",
  Base64 = "base64",
  Base64Url = "base64url",
}

export enum KeyFormat {
  PEM = "pem",
  DER = "der",
  JWK = "jwk",
}

// ============================================================
// 2. Symbol / as const / 常量
// ============================================================

/** 唯一属性键 (unique symbol) */
const SYM_KEY_ID = Symbol("keyId");
const SYM_META = Symbol("meta");

export const SUPPORTED_HASHES = [
  HashAlgorithm.MD5,
  HashAlgorithm.SHA1,
  HashAlgorithm.SHA256,
  HashAlgorithm.SHA384,
  HashAlgorithm.SHA512,
  HashAlgorithm.RIPEMD160,
] as const;

const IV_LENGTHS = {
  gcm: 12,
  cbc: 16,
} as const;

// ============================================================
// 3. 映射类型 / 接口 (optional / readonly / index signature)
// ============================================================

/** 去除 readonly 修饰符的映射类型 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface CipherOptions {
  readonly iv?: string; // hex
  readonly aad?: string; // additional authenticated data (GCM)
  readonly salt?: string; // hex
  iterations?: number;
}

export interface AesPayload {
  readonly iv: string;
  readonly data: string;
  readonly salt: string;
  readonly tag?: string;
  readonly mode: "gcm" | "cbc";
}

export interface AesGcmPayload {
  iv: string;
  data: string;
  tag: string;
  salt: string;
}

export interface RsaKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLen: number;
  readonly maxmem: number;
}

export interface PasswordHash {
  salt: string;
  hash: string;
  algo: "scrypt";
  params: { N: number; r: number; p: number; keyLen: number };
}

/** 密钥条目：含 readonly / optional / index signature / symbol 键 */
export interface KeyEntry {
  readonly id: string;
  readonly algo: CipherAlgorithm;
  material: string;
  readonly createdAt: number;
  tags?: readonly string[];
  readonly [SYM_KEY_ID]?: number;
  [SYM_META]?: Record<string, unknown>;
  [key: string]: unknown;
}

/** satisfies 运算符：保证字面量满足某接口，同时保留具体字面量类型 */
const DEFAULT_SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 64,
  maxmem: 64 * 1024 * 1024,
} satisfies ScryptParams;

// ============================================================
// 4. 自定义错误类 + 判别联合 (Discriminated Unions)
// ============================================================

/** CryptoError 同时是 Error 子类与 CryptoResult 的一个判别分支 */
export class CryptoError extends Error {
  readonly kind = "error" as const;
  readonly ok = false as const;
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
    Object.setPrototypeOf(this, CryptoError.prototype);
  }
}

export interface CryptoSuccess<T> {
  readonly kind: "success";
  readonly ok: true;
  readonly value: T;
}

export interface CryptoVerifyFail {
  readonly kind: "verify-fail";
  readonly ok: false;
  readonly code: ErrorCode.VerifyFailed;
  readonly expected?: string;
  readonly actual?: string;
}

export type CryptoResult<T> = CryptoSuccess<T> | CryptoError | CryptoVerifyFail;

// ============================================================
// 5. 类型守卫 (Type Guards)
// ============================================================

export function isHashAlgorithm(x: unknown): x is HashAlgorithm {
  return (
    typeof x === "string" &&
    (Object.values(HashAlgorithm) as string[]).includes(x)
  );
}

export function isCipherAlgorithm(x: unknown): x is CipherAlgorithm {
  return (
    typeof x === "string" &&
    (Object.values(CipherAlgorithm) as string[]).includes(x)
  );
}

export function isSuccess<T>(r: CryptoResult<T>): r is CryptoSuccess<T> {
  return r.kind === "success";
}

export function isErrorResult<T>(r: CryptoResult<T>): r is CryptoError {
  return r.kind === "error";
}

export function isVerifyFail<T>(r: CryptoResult<T>): r is CryptoVerifyFail {
  return r.kind === "verify-fail";
}

export function isKeyEntry(x: unknown): x is KeyEntry {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    isCipherAlgorithm(o.algo) &&
    typeof o.material === "string"
  );
}

// ============================================================
// 6. 哈希 (函数重载)
// ============================================================

export function hash(algo: HashAlgorithm, data: string | Buffer): string;
export function hash(
  algo: HashAlgorithm,
  data: string | Buffer,
  encoding: Encoding,
): string;
export function hash(
  algo: HashAlgorithm,
  data: string | Buffer,
  encoding: Encoding = Encoding.Hex,
): string {
  if (!isHashAlgorithm(algo))
    throw new CryptoError(ErrorCode.Unsupported, `Unsupported hash: ${algo}`);
  return crypto.createHash(algo).update(data).digest(encoding);
}

export async function hashFile(
  algo: HashAlgorithm,
  file: string,
  encoding: Encoding = Encoding.Hex,
): Promise<string> {
  const resolved = path.resolve(file);
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const stream = fs.createReadStream(resolved);
    stream.on("data", (chunk) => h.update(chunk));
    stream.on("end", () => resolve(h.digest(encoding)));
    stream.on("error", reject);
  });
}

export function hashStream(
  algo: HashAlgorithm,
  stream: NodeJS.ReadableStream,
  encoding: Encoding = Encoding.Hex,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    stream.on("data", (chunk) => h.update(chunk));
    stream.on("end", () => resolve(h.digest(encoding)));
    stream.on("error", reject);
  });
}

// ============================================================
// 7. HMAC / 编码 / 随机 / 常量时间比较
// ============================================================

export function hmac(
  algo: HashAlgorithm,
  key: string | Buffer,
  data: string | Buffer,
  encoding: Encoding = Encoding.Hex,
): string {
  return crypto.createHmac(algo, key).update(data).digest(encoding);
}

export function base64Encode(data: string | Buffer, urlSafe = false): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const encoded = buf.toString("base64");
  return urlSafe
    ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : encoded;
}

export function base64Decode(data: string, urlSafe = false): string {
  let s = data;
  if (urlSafe) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
  }
  return Buffer.from(s, "base64").toString("utf8");
}

export function hexEncode(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("hex");
}

export function hexDecode(data: string): string {
  return Buffer.from(data, "hex").toString("utf8");
}

export function randomBytes(n: number): Buffer {
  return crypto.randomBytes(n);
}

export function randomHex(n: number): string {
  return crypto.randomBytes(n).toString("hex");
}

export function randomBase64(n: number, urlSafe = false): string {
  return base64Encode(crypto.randomBytes(n), urlSafe);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function token(length = 32): string {
  return randomBase64(length).slice(0, length);
}

export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================
// 8. 密钥派生 / PBKDF2 / 密码哈希 (scrypt)
// ============================================================

export function deriveKey(
  password: string,
  salt: Buffer | string,
  iterations = 100000,
  keyLen = 32,
): Buffer {
  const saltBuf = typeof salt === "string" ? Buffer.from(salt) : salt;
  return crypto.pbkdf2Sync(
    password,
    saltBuf,
    iterations,
    keyLen,
    HashAlgorithm.SHA256,
  );
}

export function pbkdf2(
  password: string,
  salt: string,
  iterations = 100000,
  keyLen = 32,
): { salt: string; hash: string; iterations: number } {
  const saltBuf = salt ? Buffer.from(salt) : crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(
    password,
    saltBuf,
    iterations,
    keyLen,
    HashAlgorithm.SHA256,
  );
  return {
    salt: saltBuf.toString("hex"),
    hash: derived.toString("hex"),
    iterations,
  };
}

function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, HashAlgorithm.SHA256);
}

export function hashPassword(password: string): PasswordHash {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(
    password,
    salt,
    DEFAULT_SCRYPT_PARAMS.keyLen,
    DEFAULT_SCRYPT_PARAMS,
  );
  return {
    salt: salt.toString("hex"),
    hash: derived.toString("hex"),
    algo: "scrypt",
    params: {
      N: DEFAULT_SCRYPT_PARAMS.N,
      r: DEFAULT_SCRYPT_PARAMS.r,
      p: DEFAULT_SCRYPT_PARAMS.p,
      keyLen: DEFAULT_SCRYPT_PARAMS.keyLen,
    },
  };
}

export function verifyPassword(
  password: string,
  stored: PasswordHash,
): boolean {
  const salt = Buffer.from(stored.salt, "hex");
  const expected = Buffer.from(stored.hash, "hex");
  try {
    const derived = crypto.scryptSync(password, salt, stored.params.keyLen, {
      N: stored.params.N,
      r: stored.params.r,
      p: stored.params.p,
      maxmem: DEFAULT_SCRYPT_PARAMS.maxmem,
    });
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ============================================================
// 9. AES 自由函数 (保持原 API)
// ============================================================

export function encryptAesGcm(text: string, password: string): AesGcmPayload {
  const salt = crypto.randomBytes(16);
  const key = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(IV_LENGTHS.gcm);
  const cipher = crypto.createCipheriv(CipherAlgorithm.AES256GCM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = (cipher as crypto.CipherGCM).getAuthTag();
  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
  };
}

export function decryptAesGcm(
  payload: AesGcmPayload,
  password: string,
): string {
  const salt = Buffer.from(payload.salt, "hex");
  const key = deriveKeyFromPassword(password, salt);
  const iv = Buffer.from(payload.iv, "hex");
  const data = Buffer.from(payload.data, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const decipher = crypto.createDecipheriv(CipherAlgorithm.AES256GCM, key, iv);
  (decipher as crypto.DecipherGCM).setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

export function encryptAesCbc(
  text: string,
  password: string,
): { iv: string; data: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const key = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(IV_LENGTHS.cbc);
  const cipher = crypto.createCipheriv(CipherAlgorithm.AES256CBC, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    salt: salt.toString("hex"),
  };
}

export function decryptAesCbc(
  payload: { iv: string; data: string; salt: string },
  password: string,
): string {
  const salt = Buffer.from(payload.salt, "hex");
  const key = deriveKeyFromPassword(password, salt);
  const iv = Buffer.from(payload.iv, "hex");
  const data = Buffer.from(payload.data, "hex");
  const decipher = crypto.createDecipheriv(CipherAlgorithm.AES256CBC, key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// ============================================================
// 10. RSA
// ============================================================

export function generateRsaKeyPair(modulusLength = 2048): RsaKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

export function rsaSign(
  privateKey: string,
  data: string | Buffer,
  algo: HashAlgorithm = HashAlgorithm.SHA256,
): string {
  const sign = crypto.createSign(algo);
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, "hex");
}

export function rsaVerify(
  publicKey: string,
  data: string | Buffer,
  signature: string,
  algo: HashAlgorithm = HashAlgorithm.SHA256,
): boolean {
  const verify = crypto.createVerify(algo);
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature, "hex");
}

// ============================================================
// 11. 抽象加密类 + 具体子类 (AbstractCipher -> AesCipher / RsaCipher)
// ============================================================

export abstract class AbstractCipher {
  abstract readonly algorithm: CipherAlgorithm;
  abstract encrypt(
    plaintext: string,
    key: string,
    opts?: CipherOptions,
  ): CryptoResult<string>;
  abstract decrypt(
    ciphertext: string,
    key: string,
    opts?: CipherOptions,
  ): CryptoResult<string>;
  protected abstract deriveKeyMaterial(password: string, salt: Buffer): Buffer;

  protected ok<T>(value: T): CryptoSuccess<T> {
    return { kind: "success", ok: true, value };
  }
  protected fail(code: ErrorCode, message: string): CryptoError {
    return new CryptoError(code, message);
  }
}

export class AesCipher extends AbstractCipher {
  readonly algorithm: CipherAlgorithm;
  private readonly mode: "gcm" | "cbc";
  private readonly keyLen = 32;

  constructor(mode: "gcm" | "cbc" = "gcm") {
    super();
    this.mode = mode;
    this.algorithm =
      mode === "gcm" ? CipherAlgorithm.AES256GCM : CipherAlgorithm.AES256CBC;
  }

  /** getter */
  get ivLength(): number {
    return IV_LENGTHS[this.mode];
  }

  protected deriveKeyMaterial(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      password,
      salt,
      100000,
      this.keyLen,
      HashAlgorithm.SHA256,
    );
  }

  encrypt(
    plaintext: string,
    password: string,
    opts: CipherOptions = {},
  ): CryptoResult<string> {
    try {
      const salt = opts.salt
        ? Buffer.from(opts.salt, "hex")
        : crypto.randomBytes(16);
      const key = this.deriveKeyMaterial(password, salt);
      const iv = opts.iv
        ? Buffer.from(opts.iv, "hex")
        : crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      if (this.mode === "gcm" && opts.aad) {
        (cipher as crypto.CipherGCM).setAAD(Buffer.from(opts.aad, "utf8"));
      }
      const enc = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const payload: AesPayload = {
        iv: iv.toString("hex"),
        data: enc.toString("hex"),
        salt: salt.toString("hex"),
        mode: this.mode,
        ...(this.mode === "gcm"
          ? { tag: (cipher as crypto.CipherGCM).getAuthTag().toString("hex") }
          : {}),
      };
      return this.ok(JSON.stringify(payload));
    } catch (e) {
      return this.fail(ErrorCode.EncryptFailed, (e as Error).message);
    }
  }

  decrypt(
    ciphertext: string,
    password: string,
    _opts: CipherOptions = {},
  ): CryptoResult<string> {
    try {
      const payload = JSON.parse(ciphertext) as AesPayload;
      const salt = Buffer.from(payload.salt, "hex");
      const key = this.deriveKeyMaterial(password, salt);
      const iv = Buffer.from(payload.iv, "hex");
      const data = Buffer.from(payload.data, "hex");
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      if (this.mode === "gcm" && payload.tag) {
        (decipher as crypto.DecipherGCM).setAuthTag(
          Buffer.from(payload.tag, "hex"),
        );
      }
      const dec = Buffer.concat([decipher.update(data), decipher.final()]);
      return this.ok(dec.toString("utf8"));
    } catch (e) {
      return this.fail(ErrorCode.DecryptFailed, (e as Error).message);
    }
  }
}

export class RsaCipher extends AbstractCipher {
  readonly algorithm = CipherAlgorithm.RSA;

  protected deriveKeyMaterial(_password: string, _salt: Buffer): Buffer {
    throw new CryptoError(
      ErrorCode.Unsupported,
      "RSA cipher does not derive keys from password",
    );
  }

  encrypt(
    plaintext: string,
    publicKey: string,
    _opts: CipherOptions = {},
  ): CryptoResult<string> {
    try {
      const enc = crypto.publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(plaintext, "utf8"),
      );
      return this.ok(enc.toString("hex"));
    } catch (e) {
      return this.fail(ErrorCode.EncryptFailed, (e as Error).message);
    }
  }

  decrypt(
    ciphertext: string,
    privateKey: string,
    _opts: CipherOptions = {},
  ): CryptoResult<string> {
    try {
      const dec = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(ciphertext, "hex"),
      );
      return this.ok(dec.toString("utf8"));
    } catch (e) {
      return this.fail(ErrorCode.DecryptFailed, (e as Error).message);
    }
  }
}

// ============================================================
// 12. KeyStore<T extends KeyEntry> (generic / generators / getter-setter)
// ============================================================

export class KeyStore<T extends KeyEntry> {
  private readonly entries = new Map<string, T>();
  private _defaultId: string | null = null;

  /** getter/setter 对 */
  get defaultId(): string | null {
    return this._defaultId;
  }
  set defaultId(id: string | null) {
    if (id !== null && !this.entries.has(id)) {
      throw new CryptoError(ErrorCode.InvalidKey, `Key not found: ${id}`);
    }
    this._defaultId = id;
  }

  get size(): number {
    return this.entries.size;
  }

  add(entry: T): void {
    this.entries.set(entry.id, entry);
    if (this._defaultId === null) this._defaultId = entry.id;
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    const deleted = this.entries.delete(id);
    if (deleted && this._defaultId === id) this._defaultId = null;
    return deleted;
  }

  /** 生成器：迭代所有密钥 */
  *[Symbol.iterator](): Iterator<T> {
    for (const entry of this.entries.values()) yield entry;
  }

  /** 生成器：迭代密钥 id */
  *ids(): Generator<string> {
    for (const id of this.entries.keys()) yield id;
  }

  /** 应用映射类型 Mutable<T>：返回可变副本数组 */
  toMutableList(): Mutable<T>[] {
    const out: Mutable<T>[] = [];
    for (const entry of this) out.push({ ...entry });
    return out;
  }

  /** 使用 path / fs 将密钥导出到目录 */
  exportToDir(dir: string, format: KeyFormat = KeyFormat.PEM): string[] {
    const resolved = path.resolve(dir);
    fs.mkdirSync(resolved, { recursive: true });
    const written: string[] = [];
    for (const entry of this) {
      const ext =
        format === KeyFormat.PEM
          ? "pem"
          : format === KeyFormat.DER
            ? "der"
            : "jwk";
      const file = path.join(resolved, `${entry.id}.${ext}`);
      fs.writeFileSync(file, entry.material, "utf8");
      written.push(file);
    }
    return written;
  }
}

// ============================================================
// 13. CLI 演示
// ============================================================

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "hash": {
      const raw = process.argv[3];
      const text = process.argv.slice(4).join(" ");
      if (!raw || !isHashAlgorithm(raw) || !text) {
        console.log(
          "用法: hash <algo> <text>   (algo: md5|sha1|sha256|sha384|sha512|ripemd160)",
        );
        return;
      }
      console.log(`${raw}("${text}") = ${hash(raw, text)}`);
      break;
    }
    case "hashfile": {
      const raw = process.argv[3];
      const file = process.argv[4];
      if (!raw || !isHashAlgorithm(raw) || !file) {
        console.log("用法: hashfile <algo> <file>");
        return;
      }
      const h = await hashFile(raw, file);
      console.log(`${raw}(${file}) = ${h}`);
      break;
    }
    case "encrypt": {
      const text = process.argv[3];
      const pFlag = process.argv.indexOf("-p");
      const pass = pFlag >= 0 ? process.argv[pFlag + 1] : "default-password";
      if (!text) {
        console.log("用法: encrypt <text> -p <password>");
        return;
      }
      const payload = encryptAesGcm(text, pass);
      console.log("加密结果 (AES-256-GCM):");
      console.log(JSON.stringify(payload, null, 2));
      console.log("\nBase64 编码: " + base64Encode(JSON.stringify(payload)));
      break;
    }
    case "decrypt": {
      const data = process.argv[3];
      const pFlag = process.argv.indexOf("-p");
      const pass = pFlag >= 0 ? process.argv[pFlag + 1] : "default-password";
      if (!data) {
        console.log("用法: decrypt <json|base64> -p <password>");
        return;
      }
      try {
        let payload: AesGcmPayload;
        if (data.startsWith("{")) {
          payload = JSON.parse(data) as AesGcmPayload;
        } else {
          payload = JSON.parse(base64Decode(data)) as AesGcmPayload;
        }
        const plain = decryptAesGcm(payload, pass);
        console.log("解密结果: " + plain);
      } catch (e) {
        console.log("解密失败 (密码错误或数据损坏):", (e as Error).message);
      }
      break;
    }
    case "cipher": {
      // 演示 AesCipher + CryptoResult 判别联合
      const text = process.argv[3] ?? "hello";
      const pass = process.argv[4] ?? "secret";
      const c = new AesCipher("gcm");
      const enc = c.encrypt(text, pass);
      if (isSuccess(enc)) {
        console.log("AesCipher 加密成功");
        const dec = c.decrypt(enc.value, pass);
        if (isSuccess(dec)) console.log("解密回: " + dec.value);
        else if (isErrorResult(dec))
          console.log("解密错误: " + dec.code + " " + dec.message);
      } else if (isErrorResult(enc)) {
        console.log("加密错误: " + enc.code + " " + enc.message);
      }
      break;
    }
    case "uuid": {
      console.log(uuid());
      break;
    }
    case "token": {
      const lFlag = process.argv.indexOf("-l");
      const len = lFlag >= 0 ? parseInt(process.argv[lFlag + 1], 10) : 32;
      console.log(token(len));
      break;
    }
    case "random": {
      const bFlag = process.argv.indexOf("-b");
      const bytes = bFlag >= 0 ? parseInt(process.argv[bFlag + 1], 10) : 16;
      console.log("hex:   " + randomHex(bytes));
      console.log("base64: " + randomBase64(bytes));
      break;
    }
    case "passwd": {
      const password = process.argv[3];
      if (!password) {
        console.log("用法: passwd <password>");
        return;
      }
      const hashed = hashPassword(password);
      console.log("密码哈希 (scrypt):");
      console.log(JSON.stringify(hashed, null, 2));
      console.log(
        "验证结果: " + (verifyPassword(password, hashed) ? "通过" : "失败"),
      );
      console.log(
        "错误密码验证: " +
          (verifyPassword(password + "x", hashed) ? "通过" : "失败"),
      );
      break;
    }
    default:
      console.log(`
加密解密工具库 - 命令行演示

用法:
  hash <algo> <text>            哈希文本 (md5|sha1|sha256|sha384|sha512|ripemd160)
  hashfile <algo> <file>        哈希文件
  encrypt <text> -p <password>  AES-256-GCM 加密
  decrypt <data> -p <password>  AES-256-GCM 解密
  cipher [text] [password]      演示 AesCipher 类与 CryptoResult
  uuid                          生成 UUID v4
  token [-l length]             生成随机 token
  random [-b bytes]             生成随机字节 (hex + base64)
  passwd <password>             密码哈希与验证

示例:
  hash sha256 hello
  hashfile md5 ./package.json
  encrypt "秘密消息" -p mypass
  decrypt <base64或json> -p mypass
  cipher "hi" mypass
  uuid
  token -l 48
  random -b 32
  passwd mySecret123
`);
  }
}

main();
