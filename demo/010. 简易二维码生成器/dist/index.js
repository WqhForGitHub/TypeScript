#!/usr/bin/env node
"use strict";
/**
 * 简易二维码生成器 (QR Code Generator) - 增强版
 *
 * 纯 TypeScript 实现，演示大量高级类型特性：
 *   - 枚举 (QRVersion / ErrorCorrectionLevel / EncodingMode / MaskPattern / OutputFormat)
 *   - 泛型与约束 (Matrix<T> / BitBuffer<M extends EncodingMode>)
 *   - 判别联合 (NumericSegment / AlphanumericSegment / ByteSegment / KanjiSegment)
 *   - 映射类型、条件类型、模板字面量类型
 *   - 类型守卫、工具类型 (Partial/Pick/Omit/Readonly/Record/ReturnType)
 *   - 元组与只读元组、as const、satisfies
 *   - 抽象类继承体系 (AbstractQRRenderer -> 4 个具体渲染器)
 *   - 函数重载、自定义错误类层级、getter/setter、生成器
 *
 * 功能：版本 1-3、L/M/Q/H 四级纠错、数字/字母数字/字节三种编码、
 * Reed-Solomon (GF(256))、8 种掩码与惩罚评分、格式信息 BCH(15,5)、
 * 多种输出格式 (ASCII / Unicode / SVG / 矩阵)、静默区与反色。
 *
 * 仅依赖 Node.js 内置模块。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ============================================================
// 1. 枚举
// ============================================================
var QRVersion;
(function (QRVersion) {
    QRVersion[QRVersion["V1"] = 1] = "V1";
    QRVersion[QRVersion["V2"] = 2] = "V2";
    QRVersion[QRVersion["V3"] = 3] = "V3";
})(QRVersion || (QRVersion = {}));
var ErrorCorrectionLevel;
(function (ErrorCorrectionLevel) {
    ErrorCorrectionLevel["L"] = "L";
    ErrorCorrectionLevel["M"] = "M";
    ErrorCorrectionLevel["Q"] = "Q";
    ErrorCorrectionLevel["H"] = "H";
})(ErrorCorrectionLevel || (ErrorCorrectionLevel = {}));
var EncodingMode;
(function (EncodingMode) {
    EncodingMode["Numeric"] = "numeric";
    EncodingMode["Alphanumeric"] = "alphanumeric";
    EncodingMode["Byte"] = "byte";
    EncodingMode["Kanji"] = "kanji";
})(EncodingMode || (EncodingMode = {}));
var MaskPattern;
(function (MaskPattern) {
    MaskPattern[MaskPattern["M0"] = 0] = "M0";
    MaskPattern[MaskPattern["M1"] = 1] = "M1";
    MaskPattern[MaskPattern["M2"] = 2] = "M2";
    MaskPattern[MaskPattern["M3"] = 3] = "M3";
    MaskPattern[MaskPattern["M4"] = 4] = "M4";
    MaskPattern[MaskPattern["M5"] = 5] = "M5";
    MaskPattern[MaskPattern["M6"] = 6] = "M6";
    MaskPattern[MaskPattern["M7"] = 7] = "M7";
})(MaskPattern || (MaskPattern = {}));
var OutputFormat;
(function (OutputFormat) {
    OutputFormat["ASCII"] = "ascii";
    OutputFormat["Unicode"] = "unicode";
    OutputFormat["SVG"] = "svg";
    OutputFormat["Matrix"] = "matrix";
})(OutputFormat || (OutputFormat = {}));
// ============================================================
// 2. 自定义错误类层级
// ============================================================
class QRError extends Error {
    constructor(message, code) { super(message); this.name = "QRError"; this.code = code; }
}
class EncodingError extends QRError {
    constructor(message) { super(message, "ENCODING"); this.name = "EncodingError"; }
}
class CapacityError extends QRError {
    constructor(message) { super(message, "CAPACITY"); this.name = "CapacityError"; }
}
class InvalidVersionError extends QRError {
    constructor(message) { super(message, "VERSION"); this.name = "InvalidVersionError"; }
}
const isNumeric = (s) => s.mode === EncodingMode.Numeric;
const isAlphanumeric = (s) => s.mode === EncodingMode.Alphanumeric;
const isByteSegment = (s) => s.mode === EncodingMode.Byte;
const isKanjiSegment = (s) => s.mode === EncodingMode.Kanji;
// ============================================================
// 5. 泛型 BitBuffer (带约束)
// ============================================================
class BitBuffer {
    constructor(mode) {
        this._bits = [];
        this.mode = mode;
    }
    push(value, count) {
        for (let i = count - 1; i >= 0; i--)
            this._bits.push((value >> i) & 1);
        return this;
    }
    get length() { return this._bits.length; }
    get bits() { return this._bits; }
    toBytes() {
        const padded = [...this._bits];
        while (padded.length % 8 !== 0)
            padded.push(0);
        const out = [];
        for (let i = 0; i < padded.length; i += 8) {
            let v = 0;
            for (let j = 0; j < 8; j++)
                v = (v << 1) | padded[i + j];
            out.push(v);
        }
        return out;
    }
}
class Matrix {
    constructor(size) { this.size = size; this.data = new Uint8Array(size * size); }
    idx(x, y) { return y * this.size + x; }
    get(x, y) { return this.data[this.idx(x, y)]; }
    set(x, y, v) { this.data[this.idx(x, y)] = v; }
    *cells() {
        for (let y = 0; y < this.size; y++)
            for (let x = 0; x < this.size; x++) {
                yield { x, y, value: this.data[this.idx(x, y)] };
            }
    }
    *[Symbol.iterator]() { yield* this.cells(); }
}
function buildGFTables() {
    const exp = new Array(512);
    const log = new Array(256).fill(0);
    let x = 1;
    for (let i = 0; i < 255; i++) {
        exp[i] = x;
        log[x] = i;
        x <<= 1;
        if (x & 0x100)
            x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++)
        exp[i] = exp[i - 255];
    return { exp, log };
}
const GF = buildGFTables();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF.exp[GF.log[a] + GF.log[b]]);
const gfPow = (a, n) => (a === 0 ? 0 : GF.exp[(GF.log[a] * n) % 255]);
// ============================================================
// 8. Reed-Solomon 多项式运算
// ============================================================
function polyMultiply(a, b) {
    const r = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++)
        for (let j = 0; j < b.length; j++)
            r[i + j] ^= gfMul(a[i], b[j]);
    return r;
}
function generatorPoly(ecCount) {
    let poly = [1];
    for (let i = 0; i < ecCount; i++)
        poly = polyMultiply(poly, [1, gfPow(2, i)]);
    return poly;
}
function rsEncodeBlock(data, ecCount) {
    const gen = generatorPoly(ecCount);
    const buf = [...data, ...new Array(ecCount).fill(0)];
    for (let i = 0; i < data.length; i++) {
        const c = buf[i];
        if (c !== 0)
            for (let j = 0; j < gen.length; j++)
                buf[i + j] ^= gfMul(gen[j], c);
    }
    return buf.slice(data.length);
}
const ALIGNMENT = {
    [QRVersion.V1]: [],
    [QRVersion.V2]: [18],
    [QRVersion.V3]: [22],
};
const CAP_V1 = {
    [EncodingMode.Numeric]: 41, [EncodingMode.Alphanumeric]: 25, [EncodingMode.Byte]: 17, [EncodingMode.Kanji]: 10,
};
const CAP_V1_M = {
    [EncodingMode.Numeric]: 34, [EncodingMode.Alphanumeric]: 20, [EncodingMode.Byte]: 14, [EncodingMode.Kanji]: 8,
};
const CAP_V1_Q = {
    [EncodingMode.Numeric]: 27, [EncodingMode.Alphanumeric]: 16, [EncodingMode.Byte]: 11, [EncodingMode.Kanji]: 7,
};
const CAP_V1_H = {
    [EncodingMode.Numeric]: 17, [EncodingMode.Alphanumeric]: 10, [EncodingMode.Byte]: 7, [EncodingMode.Kanji]: 4,
};
const CAP_V2_L = {
    [EncodingMode.Numeric]: 77, [EncodingMode.Alphanumeric]: 47, [EncodingMode.Byte]: 32, [EncodingMode.Kanji]: 20,
};
const CAP_V2_M = {
    [EncodingMode.Numeric]: 63, [EncodingMode.Alphanumeric]: 38, [EncodingMode.Byte]: 26, [EncodingMode.Kanji]: 16,
};
const CAP_V2_Q = {
    [EncodingMode.Numeric]: 48, [EncodingMode.Alphanumeric]: 29, [EncodingMode.Byte]: 20, [EncodingMode.Kanji]: 12,
};
const CAP_V2_H = {
    [EncodingMode.Numeric]: 34, [EncodingMode.Alphanumeric]: 20, [EncodingMode.Byte]: 14, [EncodingMode.Kanji]: 8,
};
const CAP_V3_L = {
    [EncodingMode.Numeric]: 127, [EncodingMode.Alphanumeric]: 77, [EncodingMode.Byte]: 53, [EncodingMode.Kanji]: 32,
};
const CAP_V3_M = {
    [EncodingMode.Numeric]: 101, [EncodingMode.Alphanumeric]: 61, [EncodingMode.Byte]: 42, [EncodingMode.Kanji]: 26,
};
const CAP_V3_Q = {
    [EncodingMode.Numeric]: 77, [EncodingMode.Alphanumeric]: 47, [EncodingMode.Byte]: 32, [EncodingMode.Kanji]: 20,
};
const CAP_V3_H = {
    [EncodingMode.Numeric]: 58, [EncodingMode.Alphanumeric]: 35, [EncodingMode.Byte]: 24, [EncodingMode.Kanji]: 15,
};
const VERSION_TABLE = {
    [QRVersion.V1]: {
        [ErrorCorrectionLevel.L]: { version: QRVersion.V1, size: 21, blocks: [{ count: 1, dataCodewords: 19, ecCodewords: 7 }], alignCenters: ALIGNMENT[QRVersion.V1], capacities: CAP_V1 },
        [ErrorCorrectionLevel.M]: { version: QRVersion.V1, size: 21, blocks: [{ count: 1, dataCodewords: 16, ecCodewords: 10 }], alignCenters: ALIGNMENT[QRVersion.V1], capacities: CAP_V1_M },
        [ErrorCorrectionLevel.Q]: { version: QRVersion.V1, size: 21, blocks: [{ count: 1, dataCodewords: 13, ecCodewords: 13 }], alignCenters: ALIGNMENT[QRVersion.V1], capacities: CAP_V1_Q },
        [ErrorCorrectionLevel.H]: { version: QRVersion.V1, size: 21, blocks: [{ count: 1, dataCodewords: 9, ecCodewords: 17 }], alignCenters: ALIGNMENT[QRVersion.V1], capacities: CAP_V1_H },
    },
    [QRVersion.V2]: {
        [ErrorCorrectionLevel.L]: { version: QRVersion.V2, size: 25, blocks: [{ count: 1, dataCodewords: 34, ecCodewords: 10 }], alignCenters: ALIGNMENT[QRVersion.V2], capacities: CAP_V2_L },
        [ErrorCorrectionLevel.M]: { version: QRVersion.V2, size: 25, blocks: [{ count: 1, dataCodewords: 28, ecCodewords: 16 }], alignCenters: ALIGNMENT[QRVersion.V2], capacities: CAP_V2_M },
        [ErrorCorrectionLevel.Q]: { version: QRVersion.V2, size: 25, blocks: [{ count: 1, dataCodewords: 22, ecCodewords: 22 }], alignCenters: ALIGNMENT[QRVersion.V2], capacities: CAP_V2_Q },
        [ErrorCorrectionLevel.H]: { version: QRVersion.V2, size: 25, blocks: [{ count: 1, dataCodewords: 16, ecCodewords: 28 }], alignCenters: ALIGNMENT[QRVersion.V2], capacities: CAP_V2_H },
    },
    [QRVersion.V3]: {
        [ErrorCorrectionLevel.L]: { version: QRVersion.V3, size: 29, blocks: [{ count: 1, dataCodewords: 55, ecCodewords: 15 }], alignCenters: ALIGNMENT[QRVersion.V3], capacities: CAP_V3_L },
        [ErrorCorrectionLevel.M]: { version: QRVersion.V3, size: 29, blocks: [{ count: 1, dataCodewords: 44, ecCodewords: 26 }], alignCenters: ALIGNMENT[QRVersion.V3], capacities: CAP_V3_M },
        [ErrorCorrectionLevel.Q]: { version: QRVersion.V3, size: 29, blocks: [{ count: 2, dataCodewords: 17, ecCodewords: 18 }], alignCenters: ALIGNMENT[QRVersion.V3], capacities: CAP_V3_Q },
        [ErrorCorrectionLevel.H]: { version: QRVersion.V3, size: 29, blocks: [{ count: 2, dataCodewords: 13, ecCodewords: 22 }], alignCenters: ALIGNMENT[QRVersion.V3], capacities: CAP_V3_H },
    },
};
const ALL_VERSIONS = [QRVersion.V1, QRVersion.V2, QRVersion.V3];
const ALL_MASKS = [
    MaskPattern.M0, MaskPattern.M1, MaskPattern.M2, MaskPattern.M3,
    MaskPattern.M4, MaskPattern.M5, MaskPattern.M6, MaskPattern.M7,
];
function getVersionInfo(version, level) {
    return VERSION_TABLE[version][level];
}
function totalDataCodewords(info) {
    return info.blocks.reduce((a, b) => a + b.count * b.dataCodewords, 0);
}
// ============================================================
// 10. 编码模式工具
// ============================================================
const ALPHANUMERIC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function detectMode(text) {
    if (/^[0-9]+$/.test(text))
        return EncodingMode.Numeric;
    if (/^[0-9A-Z $%*+\-./:]+$/.test(text))
        return EncodingMode.Alphanumeric;
    return EncodingMode.Byte;
}
function makeSegment(text, mode) {
    switch (mode) {
        case EncodingMode.Numeric: return { mode, data: text };
        case EncodingMode.Alphanumeric: return { mode, data: text.toUpperCase() };
        case EncodingMode.Byte: return { mode, data: Buffer.from(text, "utf8") };
        case EncodingMode.Kanji: throw new EncodingError("Kanji 编码未实现");
    }
}
function charCountBits(mode) {
    switch (mode) {
        case EncodingMode.Numeric: return 10;
        case EncodingMode.Alphanumeric: return 9;
        case EncodingMode.Byte: return 8;
        case EncodingMode.Kanji: return 8;
    }
}
function selectVersion(text, mode, level) {
    for (const v of ALL_VERSIONS) {
        const info = VERSION_TABLE[v][level];
        const need = mode === EncodingMode.Byte ? Buffer.byteLength(text, "utf8") : text.length;
        if (need <= info.capacities[mode])
            return info;
    }
    throw new CapacityError(`文本过长，版本 1-3 等级 ${level} 模式 ${mode} 无法容纳`);
}
function encodeSegment(segment, buffer) {
    if (isNumeric(segment)) {
        buffer.push(0b0001, 4).push(segment.data.length, charCountBits(EncodingMode.Numeric));
        for (let i = 0; i < segment.data.length; i += 3) {
            const chunk = segment.data.slice(i, i + 3);
            const n = parseInt(chunk, 10);
            buffer.push(n, chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4);
        }
    }
    else if (isAlphanumeric(segment)) {
        buffer.push(0b0010, 4).push(segment.data.length, charCountBits(EncodingMode.Alphanumeric));
        for (let i = 0; i < segment.data.length; i += 2) {
            const a = ALPHANUMERIC_CHARS.indexOf(segment.data[i]);
            const b = i + 1 < segment.data.length ? ALPHANUMERIC_CHARS.indexOf(segment.data[i + 1]) : -1;
            if (b < 0)
                buffer.push(a, 6);
            else
                buffer.push(a * 45 + b, 11);
        }
    }
    else if (isByteSegment(segment)) {
        buffer.push(0b0100, 4).push(segment.data.length, charCountBits(EncodingMode.Byte));
        for (const b of segment.data)
            buffer.push(b, 8);
    }
    else if (isKanjiSegment(segment)) {
        throw new EncodingError("Kanji 编码未实现");
    }
}
function encodeData(segment, info) {
    const buffer = new BitBuffer(segment.mode);
    encodeSegment(segment, buffer);
    const totalBits = totalDataCodewords(info) * 8;
    for (let i = 0; i < 4 && buffer.length < totalBits; i++)
        buffer.push(0, 1);
    const data = buffer.toBytes();
    const total = totalDataCodewords(info);
    let pad = 0xec;
    while (data.length < total) {
        data.push(pad);
        pad = pad === 0xec ? 0xed : 0xec;
    }
    return interleaveBlocks(data, info);
}
function interleaveBlocks(data, info) {
    const blocks = [];
    let offset = 0;
    for (const spec of info.blocks) {
        for (let i = 0; i < spec.count; i++) {
            const blockData = data.slice(offset, offset + spec.dataCodewords);
            offset += spec.dataCodewords;
            blocks.push({ data: blockData, ec: rsEncodeBlock(blockData, spec.ecCodewords) });
        }
    }
    const result = [];
    const maxData = Math.max(...blocks.map(b => b.data.length));
    for (let i = 0; i < maxData; i++)
        for (const b of blocks)
            if (i < b.data.length)
                result.push(b.data[i]);
    const maxEc = Math.max(...blocks.map(b => b.ec.length));
    for (let i = 0; i < maxEc; i++)
        for (const b of blocks)
            if (i < b.ec.length)
                result.push(b.ec[i]);
    return result;
}
// ============================================================
// 11. 模块放置 (探测 / 时序 / 对齐 / 格式预留 / 数据)
// ============================================================
function placeFinder(m, r, ox, oy) {
    for (let dy = -1; dy <= 7; dy++)
        for (let dx = -1; dx <= 7; dx++) {
            const x = ox + dx, y = oy + dy;
            if (x < 0 || y < 0 || x >= m.size || y >= m.size)
                continue;
            r.set(x, y, 1);
            const outer = dx === 0 || dx === 6 || dy === 0 || dy === 6;
            const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
            m.set(x, y, outer || inner ? 1 : 0);
        }
}
function placeTiming(m, r) {
    for (let i = 8; i < m.size - 8; i++) {
        r.set(i, 6, 1);
        r.set(6, i, 1);
        m.set(i, 6, i % 2 === 0 ? 1 : 0);
        m.set(6, i, i % 2 === 0 ? 1 : 0);
    }
}
function placeAlignment(m, r, centers) {
    for (const cy of centers)
        for (const cx of centers) {
            if ((cx === 6 && cy === 6) || (cx === m.size - 7 && cy === 6) || (cx === 6 && cy === m.size - 7))
                continue;
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                    const x = cx + dx, y = cy + dy;
                    r.set(x, y, 1);
                    const edge = Math.max(Math.abs(dx), Math.abs(dy));
                    m.set(x, y, edge !== 1 ? 1 : 0);
                }
        }
}
function reserveFormat(m, r) {
    const size = m.size;
    for (let i = 0; i <= 8; i++) {
        if (i !== 6) {
            r.set(8, i, 1);
            r.set(i, 8, 1);
        }
        if (i < 8) {
            r.set(size - 1 - i, 8, 1);
            r.set(8, size - 1 - i, 1);
        }
    }
    m.set(8, size - 8, 1);
    r.set(8, size - 8, 1);
}
function placeData(m, r, codewords) {
    const size = m.size;
    const bits = [];
    for (const cw of codewords)
        for (let i = 7; i >= 0; i--)
            bits.push((cw >> i) & 1);
    let bitIdx = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6)
            col = 5;
        for (let i = 0; i < size; i++) {
            const y = upward ? size - 1 - i : i;
            for (let c = 0; c < 2; c++) {
                const x = col - c;
                if (r.get(x, y) === 0 && bitIdx < bits.length)
                    m.set(x, y, bits[bitIdx++] ? 1 : 0);
            }
        }
        upward = !upward;
    }
}
// ============================================================
// 12. 掩码条件与惩罚评分
// ============================================================
function maskCondition(mask, x, y) {
    switch (mask) {
        case MaskPattern.M0: return (x + y) % 2 === 0;
        case MaskPattern.M1: return y % 2 === 0;
        case MaskPattern.M2: return x % 3 === 0;
        case MaskPattern.M3: return (x + y) % 3 === 0;
        case MaskPattern.M4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case MaskPattern.M5: return ((x * y) % 2) + ((x * y) % 3) === 0;
        case MaskPattern.M6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        case MaskPattern.M7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
}
function applyMask(base, r, mask) {
    const out = new Matrix(base.size);
    out.data.set(base.data);
    for (const { x, y } of base.cells()) {
        if (r.get(x, y) === 0 && maskCondition(mask, x, y))
            out.set(x, y, base.get(x, y) ^ 1);
    }
    return out;
}
function penaltyScore(m) {
    const size = m.size;
    let score = 0;
    const runs = (line) => {
        let run = 1, s = 0;
        for (let i = 1; i < line.length; i++) {
            if (line[i] === line[i - 1])
                run++;
            else {
                if (run >= 5)
                    s += 3 + (run - 5);
                run = 1;
            }
        }
        if (run >= 5)
            s += 3 + (run - 5);
        return s;
    };
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++)
            row.push(m.get(x, y));
        score += runs(row);
    }
    for (let x = 0; x < size; x++) {
        const col = [];
        for (let y = 0; y < size; y++)
            col.push(m.get(x, y));
        score += runs(col);
    }
    for (let y = 0; y < size - 1; y++)
        for (let x = 0; x < size - 1; x++) {
            const v = m.get(x, y);
            if (v === m.get(x + 1, y) && v === m.get(x, y + 1) && v === m.get(x + 1, y + 1))
                score += 3;
        }
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matchAt = (line, start) => p1.every((v, i) => line[start + i] === v) || p2.every((v, i) => line[start + i] === v);
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++)
            row.push(m.get(x, y));
        for (let i = 0; i + 11 <= size; i++)
            if (matchAt(row, i))
                score += 40;
    }
    for (let x = 0; x < size; x++) {
        const col = [];
        for (let y = 0; y < size; y++)
            col.push(m.get(x, y));
        for (let i = 0; i + 11 <= size; i++)
            if (matchAt(col, i))
                score += 40;
    }
    let dark = 0;
    for (const cell of m)
        if (cell.value === 1)
            dark++;
    const pct = (dark * 100) / m.data.length;
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
}
// ============================================================
// 13. 格式信息 BCH(15,5)
// ============================================================
function placeFormatInfo(m, level, mask) {
    const size = m.size;
    const levelBits = level === ErrorCorrectionLevel.L ? 0b01 :
        level === ErrorCorrectionLevel.M ? 0b00 :
            level === ErrorCorrectionLevel.Q ? 0b11 : 0b10;
    const data = (levelBits << 3) | mask;
    let bch = data << 10;
    const gen = 0b10100110111;
    for (let i = 14; i >= 10; i--)
        if ((bch >> i) & 1)
            bch ^= gen << (i - 10);
    const format = ((data << 10) | bch) ^ 0b101010000010010;
    const bit = (i) => (format >> i) & 1;
    for (let i = 0; i <= 5; i++)
        m.set(8, i, bit(i));
    m.set(8, 7, bit(6));
    m.set(8, 8, bit(7));
    m.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++)
        m.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++)
        m.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++)
        m.set(8, size - 15 + i, bit(i));
    m.set(8, size - 8, 1);
}
function generateMatrix(text, level, mode, fixedVersion) {
    const info = fixedVersion ? getVersionInfo(fixedVersion, level) : selectVersion(text, mode, level);
    const need = mode === EncodingMode.Byte ? Buffer.byteLength(text, "utf8") : text.length;
    if (need > info.capacities[mode]) {
        throw new CapacityError(`版本 ${info.version}-${level} 最多支持 ${info.capacities[mode]} 个 ${mode} 字符`);
    }
    const segment = makeSegment(text, mode);
    const codewords = encodeData(segment, info);
    const m = new Matrix(info.size);
    const r = new Matrix(info.size);
    placeFinder(m, r, 0, 0);
    placeFinder(m, r, info.size - 7, 0);
    placeFinder(m, r, 0, info.size - 7);
    placeAlignment(m, r, info.alignCenters);
    placeTiming(m, r);
    reserveFormat(m, r);
    placeData(m, r, codewords);
    let bestMask = MaskPattern.M0;
    let bestScore = Infinity;
    let bestMatrix = m;
    for (const mk of ALL_MASKS) {
        const masked = applyMask(m, r, mk);
        placeFormatInfo(masked, level, mk);
        const sc = penaltyScore(masked);
        if (sc < bestScore) {
            bestScore = sc;
            bestMask = mk;
            bestMatrix = masked;
        }
    }
    placeFormatInfo(bestMatrix, level, bestMask);
    return { matrix: bestMatrix, size: info.size, version: info.version, level, mask: bestMask, mode };
}
class AbstractQRRenderer {
    isDark(matrix, x, y, invert) {
        const v = matrix.get(x, y) === 1;
        return invert ? !v : v;
    }
    // 模板方法：可被子类覆写
    header() { return ""; }
}
class AsciiRenderer extends AbstractQRRenderer {
    constructor() {
        super(...arguments);
        this.format = OutputFormat.ASCII;
    }
    render(matrix, opts) {
        const dark = opts.invert ? "  " : "##";
        const light = opts.invert ? "##" : "  ";
        const q = opts.quietZone;
        const lines = [];
        const border = light.repeat(matrix.size + q * 2 + 2);
        for (let i = 0; i < q + 1; i++)
            lines.push(border);
        for (let y = 0; y < matrix.size; y++) {
            let row = light;
            for (let g = 0; g < q; g++)
                row += light;
            for (let x = 0; x < matrix.size; x++)
                row += this.isDark(matrix, x, y, opts.invert) ? dark : light;
            for (let g = 0; g < q; g++)
                row += light;
            row += light;
            lines.push(row);
        }
        for (let i = 0; i < q + 1; i++)
            lines.push(border);
        return lines.join("\n");
    }
}
class UnicodeRenderer extends AbstractQRRenderer {
    constructor() {
        super(...arguments);
        this.format = OutputFormat.Unicode;
    }
    render(matrix, opts) {
        const q = opts.quietZone;
        const lines = [];
        const blank = " ".repeat(matrix.size + q * 2);
        for (let i = 0; i < Math.ceil(q / 2); i++)
            lines.push(blank);
        for (let y = 0; y < matrix.size; y += 2) {
            let row = " ".repeat(q);
            for (let x = 0; x < matrix.size; x++) {
                const top = this.isDark(matrix, x, y, opts.invert);
                const bot = y + 1 < matrix.size && this.isDark(matrix, x, y + 1, opts.invert);
                const ch = !top && !bot ? " " : top && bot ? "\u2588" : top ? "\u2580" : "\u2584";
                row += ch;
            }
            row += " ".repeat(q);
            lines.push(row);
        }
        for (let i = 0; i < Math.ceil(q / 2); i++)
            lines.push(blank);
        return lines.join("\n");
    }
}
class SvgRenderer extends AbstractQRRenderer {
    constructor() {
        super(...arguments);
        this.format = OutputFormat.SVG;
    }
    render(matrix, opts) {
        const scale = opts.scale ?? 8;
        const q = opts.quietZone;
        const total = matrix.size + q * 2;
        const dim = total * scale;
        const bg = opts.invert ? "#000000" : "#ffffff";
        const fg = opts.invert ? "#ffffff" : "#000000";
        const parts = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">`,
            `<rect width="${dim}" height="${dim}" fill="${bg}"/>`,
        ];
        for (let y = 0; y < matrix.size; y++)
            for (let x = 0; x < matrix.size; x++) {
                if (this.isDark(matrix, x, y, opts.invert)) {
                    parts.push(`<rect x="${(x + q) * scale}" y="${(y + q) * scale}" width="${scale}" height="${scale}" fill="${fg}"/>`);
                }
            }
        parts.push("</svg>");
        return parts.join("\n");
    }
}
class MatrixRenderer extends AbstractQRRenderer {
    constructor() {
        super(...arguments);
        this.format = OutputFormat.Matrix;
    }
    render(matrix, opts) {
        const lines = [];
        for (let y = 0; y < matrix.size; y++) {
            let row = "";
            for (let x = 0; x < matrix.size; x++)
                row += this.isDark(matrix, x, y, opts.invert) ? "1" : "0";
            lines.push(row);
        }
        return lines.join("\n");
    }
}
const RENDERERS = {
    [OutputFormat.ASCII]: new AsciiRenderer(),
    [OutputFormat.Unicode]: new UnicodeRenderer(),
    [OutputFormat.SVG]: new SvgRenderer(),
    [OutputFormat.Matrix]: new MatrixRenderer(),
};
// ============================================================
// 16. QRCodeConfig — getter/setter
// ============================================================
class QRCodeConfig {
    constructor() {
        this._level = ErrorCorrectionLevel.M;
        this._quietZone = 2;
        this._invert = false;
        this._format = OutputFormat.ASCII;
    }
    get level() { return this._level; }
    set level(v) { this._level = v; }
    get quietZone() { return this._quietZone; }
    set quietZone(v) { if (v < 0 || v > 10)
        throw new QRError("quietZone 范围 0-10", "CONFIG"); this._quietZone = v; }
    get invert() { return this._invert; }
    set invert(v) { this._invert = v; }
    get format() { return this._format; }
    set format(v) { this._format = v; }
    get mode() { return this._mode; }
    set mode(v) { this._mode = v; }
    toOptions() {
        return { level: this._level, quietZone: this._quietZone, invert: this._invert, format: this._format, mode: this._mode };
    }
}
function generate(text, optsOrFormat) {
    let opts;
    if (optsOrFormat === undefined)
        opts = {};
    else if (optsOrFormat instanceof QRCodeConfig)
        opts = optsOrFormat.toOptions();
    else if (typeof optsOrFormat === "string")
        opts = { format: optsOrFormat };
    else
        opts = optsOrFormat;
    const level = opts.level ?? ErrorCorrectionLevel.M;
    const mode = opts.mode ?? detectMode(text);
    const result = generateMatrix(text, level, mode, opts.version);
    const renderer = RENDERERS[opts.format ?? OutputFormat.ASCII];
    return renderer.render(result.matrix, {
        quietZone: opts.quietZone ?? 2,
        invert: opts.invert ?? false,
        scale: opts.scale,
    });
}
function parseOpts(args) {
    const opts = { level: ErrorCorrectionLevel.M, invert: false, format: OutputFormat.ASCII, quietZone: 2 };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "-l" || a === "--level") {
            const v = args[++i]?.toUpperCase();
            if (v !== "L" && v !== "M" && v !== "Q" && v !== "H")
                throw new QRError("纠错等级仅支持 L/M/Q/H", "ARG");
            opts.level = v;
        }
        else if (a === "-v" || a === "--version") {
            const v = parseInt(args[++i] ?? "", 10);
            if (v < 1 || v > 3)
                throw new InvalidVersionError("版本仅支持 1-3");
            opts.version = v;
        }
        else if (a === "-i" || a === "--invert") {
            opts.invert = true;
        }
        else if (a === "-f" || a === "--format") {
            const v = args[++i]?.toLowerCase();
            if (v !== "ascii" && v !== "unicode" && v !== "svg" && v !== "matrix")
                throw new QRError("格式仅支持 ascii/unicode/svg/matrix", "ARG");
            opts.format = v;
        }
        else if (a === "-q" || a === "--quiet-zone") {
            const v = parseInt(args[++i] ?? "", 10);
            if (Number.isNaN(v) || v < 0 || v > 10)
                throw new QRError("quietZone 0-10", "ARG");
            opts.quietZone = v;
        }
        else if (a === "-m" || a === "--mode") {
            const v = args[++i];
            if (v !== "numeric" && v !== "alphanumeric" && v !== "byte")
                throw new EncodingError("mode 仅支持 numeric/alphanumeric/byte");
            opts.mode = v;
        }
    }
    return opts;
}
function printHelp() {
    console.log(`
简易二维码生成器 (QR Code Generator) - 增强版
=============================================
纯 TypeScript 实现，支持版本 1-3、L/M/Q/H 四级纠错、
数字/字母数字/字节三种编码、Reed-Solomon (GF(256))、8 种数据掩码、
格式信息 BCH(15,5)、多种输出格式 (ASCII / Unicode / SVG / 矩阵)。

用法:
  qr-gen generate <text> [选项]              生成二维码并在终端显示
  qr-gen save <text> <file> [选项]           生成二维码并保存到文件
  qr-gen help                                显示本帮助

选项:
  -l, --level <L|M|Q|H>      纠错等级 (默认 M)
  -v, --version <1|2|3>      指定版本 (默认自动选择最小可用版本)
  -m, --mode <numeric|alphanumeric|byte>  编码模式 (默认自动检测)
  -f, --format <ascii|unicode|svg|matrix> 输出格式 (默认 ascii)
  -q, --quiet-zone <0-10>    静默区大小 (默认 2)
  -i, --invert               反转黑白 (深色终端背景使用)

示例:
  qr-gen generate "Hello QR"
  qr-gen generate "12345" -m numeric -l L
  qr-gen generate "你好，二维码" -f unicode
  qr-gen save "https://example.com" qr.svg -f svg -v 2
`);
}
function cmdGenerate(args) {
    if (args.length === 0)
        throw new QRError("请提供要编码的文本", "ARG");
    const text = args[0];
    const opts = parseOpts(args.slice(1));
    const mode = opts.mode ?? detectMode(text);
    const result = generateMatrix(text, opts.level, mode, opts.version);
    const renderer = RENDERERS[opts.format];
    const output = renderer.render(result.matrix, { quietZone: opts.quietZone, invert: opts.invert });
    console.log(`\n版本: ${result.version} | 等级: ${result.level} | 模式: ${result.mode} | 掩码: ${result.mask} | 尺寸: ${result.size}x${result.size}\n`);
    console.log(output);
}
function cmdSave(args) {
    if (args.length < 2)
        throw new QRError("用法: save <text> <file> [选项]", "ARG");
    const [text, file] = args;
    const opts = parseOpts(args.slice(2));
    const mode = opts.mode ?? detectMode(text);
    const result = generateMatrix(text, opts.level, mode, opts.version);
    const renderer = RENDERERS[opts.format];
    const output = renderer.render(result.matrix, { quietZone: opts.quietZone, invert: opts.invert });
    const header = `# 二维码: "${text}"\n# 版本: ${result.version} | 等级: ${result.level} | 模式: ${result.mode} | 掩码: ${result.mask} | 尺寸: ${result.size}x${result.size}\n\n`;
    const outPath = path.resolve(file);
    fs.writeFileSync(outPath, header + output + "\n", "utf8");
    console.log(`已保存二维码到: ${outPath} (版本 ${result.version}, 等级 ${result.level}, 格式 ${opts.format})`);
}
function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const rest = args.slice(1);
    try {
        switch (command) {
            case "generate":
                cmdGenerate(rest);
                break;
            case "save":
                cmdSave(rest);
                break;
            case "help":
            case "--help":
            case "-h":
            case undefined:
                printHelp();
                break;
            default: throw new QRError(`未知命令: ${command} (运行 'qr-gen help' 查看帮助)`, "ARG");
        }
    }
    catch (err) {
        console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map