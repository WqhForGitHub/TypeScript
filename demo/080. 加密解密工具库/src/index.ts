#!/usr/bin/env node
/**
 * 加密解密工具库 (Crypto Utils)
 * -------------------------------------------------------------
 * 基于 Node.js 内置 crypto 模块。
 *
 * 公开 API:
 *   - 哈希: hash(algo, data), hashFile(algo, file), hashStream(stream)
 *   - HMAC: hmac(algo, key, data)
 *   - 对称加密: encryptAesGcm(text, password) / decryptAesGcm(data, password)
 *              encryptAesCbc(text, password) / decryptAesCbc(data, password)
 *   - RSA: generateRsaKeyPair(), rsaSign(privKey, data), rsaVerify(pubKey, data, sig)
 *   - 密码哈希: hashPassword(password) / verifyPassword(password, stored)
 *             pbkdf2(password, salt)
 *   - 随机: randomBytes(n), randomHex(n), randomBase64(n), uuid(), token(length)
 *   - 编码: base64Encode, base64Decode, hexEncode, hexDecode
 *   - 工具: constantTimeCompare(a, b), deriveKey(password, salt)
 *
 * 仅依赖 Node.js 内置模块: crypto, fs, buffer.
 */

import crypto from 'crypto';
import fs from 'fs';

type HashAlgo = 'md5' | 'sha1' | 'sha256' | 'sha512' | 'ripemd160';

// ---------- 哈希 ----------

export function hash(algo: HashAlgo, data: string | Buffer, encoding: 'hex' | 'base64' = 'hex'): string {
  return crypto.createHash(algo).update(data).digest(encoding);
}

export async function hashFile(algo: HashAlgo, file: string, encoding: 'hex' | 'base64' = 'hex'): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest(encoding)));
    stream.on('error', reject);
  });
}

export function hashStream(algo: HashAlgo, stream: NodeJS.ReadableStream, encoding: 'hex' | 'base64' = 'hex'): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest(encoding)));
    stream.on('error', reject);
  });
}

// ---------- HMAC ----------

export function hmac(algo: HashAlgo, key: string | Buffer, data: string | Buffer, encoding: 'hex' | 'base64' = 'hex'): string {
  return crypto.createHmac(algo, key).update(data).digest(encoding);
}

// ---------- 编码 ----------

export function base64Encode(data: string | Buffer, urlSafe = false): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const encoded = buf.toString('base64');
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
}

export function base64Decode(data: string, urlSafe = false): string {
  let s = data;
  if (urlSafe) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
  }
  return Buffer.from(s, 'base64').toString('utf8');
}

export function hexEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('hex');
}

export function hexDecode(data: string): string {
  return Buffer.from(data, 'hex').toString('utf8');
}

// ---------- 随机 ----------

export function randomBytes(n: number): Buffer {
  return crypto.randomBytes(n);
}

export function randomHex(n: number): string {
  return crypto.randomBytes(n).toString('hex');
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

// ---------- 常量时间比较 ----------

export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------- 密钥派生 ----------

export function deriveKey(password: string, salt: Buffer | string, iterations = 100000, keyLen = 32): Buffer {
  const saltBuf = typeof salt === 'string' ? Buffer.from(salt) : salt;
  return crypto.pbkdf2Sync(password, saltBuf, iterations, keyLen, 'sha256');
}

export function pbkdf2(password: string, salt: string, iterations = 100000, keyLen = 32): { salt: string; hash: string; iterations: number } {
  const saltBuf = salt ? Buffer.from(salt) : crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, saltBuf, iterations, keyLen, 'sha256');
  return {
    salt: saltBuf.toString('hex'),
    hash: derived.toString('hex'),
    iterations,
  };
}

// ---------- 密码哈希 (scrypt) ----------

export interface PasswordHash {
  salt: string;
  hash: string;
  algo: 'scrypt';
  params: { N: number; r: number; p: number; keyLen: number };
}

export function hashPassword(password: string): PasswordHash {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const keyLen = 64;
  const derived = crypto.scryptSync(password, salt, keyLen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return {
    salt: salt.toString('hex'),
    hash: derived.toString('hex'),
    algo: 'scrypt',
    params: { N, r, p, keyLen },
  };
}

export function verifyPassword(password: string, stored: PasswordHash): boolean {
  const salt = Buffer.from(stored.salt, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  try {
    const derived = crypto.scryptSync(password, salt, stored.params.keyLen, {
      N: stored.params.N,
      r: stored.params.r,
      p: stored.params.p,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------- AES-256-GCM ----------

export interface AesGcmPayload {
  iv: string;
  data: string;
  tag: string;
  salt: string;
}

function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

export function encryptAesGcm(text: string, password: string): AesGcmPayload {
  const salt = crypto.randomBytes(16);
  const key = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    tag: tag.toString('hex'),
    salt: salt.toString('hex'),
  };
}

export function decryptAesGcm(payload: AesGcmPayload, password: string): string {
  const salt = Buffer.from(payload.salt, 'hex');
  const key = deriveKeyFromPassword(password, salt);
  const iv = Buffer.from(payload.iv, 'hex');
  const data = Buffer.from(payload.data, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------- AES-256-CBC ----------

export function encryptAesCbc(text: string, password: string): { iv: string; data: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const key = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), data: encrypted.toString('hex'), salt: salt.toString('hex') };
}

export function decryptAesCbc(payload: { iv: string; data: string; salt: string }, password: string): string {
  const salt = Buffer.from(payload.salt, 'hex');
  const key = deriveKeyFromPassword(password, salt);
  const iv = Buffer.from(payload.iv, 'hex');
  const data = Buffer.from(payload.data, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------- RSA ----------

export interface RsaKeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateRsaKeyPair(modulusLength = 2048): RsaKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

export function rsaSign(privateKey: string, data: string | Buffer, algo = 'sha256'): string {
  const sign = crypto.createSign(algo);
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, 'hex');
}

export function rsaVerify(publicKey: string, data: string | Buffer, signature: string, algo = 'sha256'): boolean {
  const verify = crypto.createVerify(algo);
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature, 'hex');
}

// ===================== CLI 演示 =====================

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'hash': {
      const algo = process.argv[3] as HashAlgo;
      const text = process.argv.slice(4).join(' ');
      if (!algo || !text) {
        console.log('用法: hash <algo> <text>');
        return;
      }
      console.log(`${algo}("${text}") = ${hash(algo, text)}`);
      break;
    }
    case 'hashfile': {
      const algo = process.argv[3] as HashAlgo;
      const file = process.argv[4];
      if (!algo || !file) {
        console.log('用法: hashfile <algo> <file>');
        return;
      }
      const h = await hashFile(algo, file);
      console.log(`${algo}(${file}) = ${h}`);
      break;
    }
    case 'encrypt': {
      const text = process.argv[3];
      const pFlag = process.argv.indexOf('-p');
      const pass = pFlag >= 0 ? process.argv[pFlag + 1] : 'default-password';
      if (!text) {
        console.log('用法: encrypt <text> -p <password>');
        return;
      }
      const payload = encryptAesGcm(text, pass);
      console.log('加密结果 (AES-256-GCM):');
      console.log(JSON.stringify(payload, null, 2));
      console.log('\nBase64 编码: ' + base64Encode(JSON.stringify(payload)));
      break;
    }
    case 'decrypt': {
      const data = process.argv[3];
      const pFlag = process.argv.indexOf('-p');
      const pass = pFlag >= 0 ? process.argv[pFlag + 1] : 'default-password';
      if (!data) {
        console.log('用法: decrypt <json|base64> -p <password>');
        return;
      }
      try {
        let payload: AesGcmPayload;
        if (data.startsWith('{')) {
          payload = JSON.parse(data);
        } else {
          payload = JSON.parse(base64Decode(data));
        }
        const plain = decryptAesGcm(payload, pass);
        console.log('解密结果: ' + plain);
      } catch (e) {
        console.log('解密失败 (密码错误或数据损坏):', (e as Error).message);
      }
      break;
    }
    case 'uuid': {
      console.log(uuid());
      break;
    }
    case 'token': {
      const lFlag = process.argv.indexOf('-l');
      const len = lFlag >= 0 ? parseInt(process.argv[lFlag + 1], 10) : 32;
      console.log(token(len));
      break;
    }
    case 'random': {
      const bFlag = process.argv.indexOf('-b');
      const bytes = bFlag >= 0 ? parseInt(process.argv[bFlag + 1], 10) : 16;
      console.log('hex:   ' + randomHex(bytes));
      console.log('base64: ' + randomBase64(bytes));
      break;
    }
    case 'passwd': {
      const password = process.argv[3];
      if (!password) {
        console.log('用法: passwd <password>');
        return;
      }
      const hashed = hashPassword(password);
      console.log('密码哈希 (scrypt):');
      console.log(JSON.stringify(hashed, null, 2));
      const ok = verifyPassword(password, hashed);
      console.log('验证结果: ' + (ok ? '通过' : '失败'));
      const wrong = verifyPassword(password + 'x', hashed);
      console.log('错误密码验证: ' + (wrong ? '通过' : '失败'));
      break;
    }
    default:
      console.log(`
加密解密工具库 - 命令行演示

用法:
  hash <algo> <text>            哈希文本 (md5|sha1|sha256|sha512)
  hashfile <algo> <file>        哈希文件
  encrypt <text> -p <password>  AES-256-GCM 加密
  decrypt <data> -p <password>  AES-256-GCM 解密
  uuid                          生成 UUID v4
  token [-l length]             生成随机 token
  random [-b bytes]             生成随机字节 (hex + base64)
  passwd <password>             密码哈希与验证

示例:
  hash sha256 hello
  hashfile md5 ./package.json
  encrypt "秘密消息" -p mypass
  decrypt <base64或json> -p mypass
  uuid
  token -l 48
  random -b 32
  passwd mySecret123
`);
  }
}

main();
