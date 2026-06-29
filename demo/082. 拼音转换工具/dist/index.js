#!/usr/bin/env node
"use strict";
/**
 * 拼音转换工具 (Pinyin Converter) — 汉字转拼音命令行工具。
 * 内置 300+ 常用汉字，支持声调标记/数字/无声调、首字母、用户词典。
 * 仅使用 Node.js 内置模块（fs, path）。
 * 文件刻意展示高级 TS 特性：枚举/判别联合/泛型类/抽象类/映射类型/
 * 错误层级/接口/satisfies/getter&setter/生成器/Symbol/as const/
 * 类型守卫/函数重载/模板字面量类型。
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
// ## 1. 字符串枚举（非 const enum）
/** 声调显示风格 */
var ToneStyle;
(function (ToneStyle) {
    ToneStyle["Mark"] = "mark";
    ToneStyle["Number"] = "number";
    ToneStyle["None"] = "none";
})(ToneStyle || (ToneStyle = {}));
/** 错误代码 */
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["NotFound"] = "NOT_FOUND";
    ErrorCode["InvalidPinyin"] = "INVALID_PINYIN";
    ErrorCode["InvalidInput"] = "INVALID_INPUT";
    ErrorCode["Ambiguous"] = "AMBIGUOUS";
    ErrorCode["Empty"] = "EMPTY_INPUT";
    ErrorCode["Unknown"] = "UNKNOWN";
})(ErrorCode || (ErrorCode = {}));
/** 转换模式 */
var ConvertMode;
(function (ConvertMode) {
    ConvertMode["Full"] = "full";
    ConvertMode["Initials"] = "initials";
    ConvertMode["Lookup"] = "lookup";
})(ConvertMode || (ConvertMode = {}));
/** 字符类型 */
var CharType;
(function (CharType) {
    CharType["Hanzi"] = "hanzi";
    CharType["Punctuation"] = "punctuation";
    CharType["Space"] = "space";
    CharType["Other"] = "other";
})(CharType || (CharType = {}));
// ## 2. 模板字面量类型 + as const 派生类型
const TONE_DIGITS = [1, 2, 3, 4, 5];
// ## 6. 自定义错误类层级
class PinyinError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "PinyinError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
class PinyinNotFoundError extends PinyinError {
    constructor(message) {
        super(ErrorCode.NotFound, message);
        this.name = "PinyinNotFoundError";
    }
}
class InvalidPinyinError extends PinyinError {
    constructor(message) {
        super(ErrorCode.InvalidPinyin, message);
        this.name = "InvalidPinyinError";
    }
}
// ## 7. Symbol 唯一属性键 + as const / satisfies
const STORE_ID = Symbol("storeId");
const INTERNAL_VERSION = Symbol("internalVersion");
const DEFAULT_CONFIG = {
    defaultTone: ToneStyle.Mark,
    strict: true,
};
/** 声调符号映射（按 a o e i u ü 顺序择优放置） */
const TONE_MARKS = {
    a: "āáǎàa", o: "ōóǒòo", e: "ēéěèe",
    i: "īíǐìi", u: "ūúǔùu", v: "ǖǘǚǜü",
};
const MARK_TO_TONE = [
    ["ā", 1], ["á", 2], ["ǎ", 3], ["à", 4],
    ["ō", 1], ["ó", 2], ["ǒ", 3], ["ò", 4],
    ["ē", 1], ["é", 2], ["ě", 3], ["è", 4],
    ["ī", 1], ["í", 2], ["ǐ", 3], ["ì", 4],
    ["ū", 1], ["ú", 2], ["ǔ", 3], ["ù", 4],
    ["ǖ", 1], ["ǘ", 2], ["ǚ", 3], ["ǜ", 4],
];
// ## 8. 内置汉字 -> 拼音(数字形式) 映射（约 330 字，常用字）
const BUILTIN_PINYIN = {
    啊: "a1", 阿: "a1", 爱: "ai4", 安: "an1", 岸: "an4", 按: "an4",
    八: "ba1", 爸: "ba4", 吧: "ba5", 白: "bai2", 百: "bai3", 班: "ban1",
    半: "ban4", 办: "ban4", 帮: "bang1", 包: "bao1", 饱: "bao3", 报: "bao4",
    杯: "bei1", 北: "bei3", 备: "bei4", 本: "ben3", 笔: "bi3", 比: "bi3",
    必: "bi4", 边: "bian1", 变: "bian4", 表: "biao3", 别: "bie2", 宾: "bin1",
    冰: "bing1", 病: "bing4", 不: "bu4", 步: "bu4",
    才: "cai2", 菜: "cai4", 参: "can1", 草: "cao3", 层: "ceng2", 茶: "cha2",
    差: "cha4", 长: "chang2", 常: "chang2", 厂: "chang3", 车: "che1", 晨: "chen2",
    城: "cheng2", 成: "cheng2", 吃: "chi1", 迟: "chi2", 出: "chu1", 处: "chu3",
    穿: "chuan1", 船: "chuan2", 窗: "chuang1", 床: "chuang2", 春: "chun1",
    词: "ci2", 次: "ci4", 从: "cong2", 错: "cuo4",
    打: "da3", 大: "da4", 代: "dai4", 带: "dai4", 单: "dan1", 但: "dan4",
    当: "dang1", 到: "dao4", 倒: "dao3", 的: "de5", 得: "de2", 等: "deng3",
    低: "di1", 地: "di4", 第: "di4", 点: "dian3", 电: "dian4", 店: "dian4",
    东: "dong1", 冬: "dong1", 懂: "dong3", 动: "dong4", 都: "dou1", 读: "du2",
    独: "du2", 度: "du4", 短: "duan3", 段: "duan4", 对: "dui4", 多: "duo1",
    儿: "er2", 二: "er4", 饿: "e4",
    发: "fa1", 法: "fa3", 烦: "fan2", 反: "fan3", 饭: "fan4", 方: "fang1",
    房: "fang2", 放: "fang4", 飞: "fei1", 非: "fei1", 分: "fen1", 粉: "fen3",
    风: "feng1", 丰: "feng1", 否: "fou3", 夫: "fu1", 父: "fu4", 服: "fu2",
    改: "gai3", 干: "gan1", 感: "gan3", 刚: "gang1", 高: "gao1", 告: "gao4",
    哥: "ge1", 歌: "ge1", 个: "ge4", 给: "gei3", 根: "gen1", 跟: "gen1",
    更: "geng4", 工: "gong1", 公: "gong1", 共: "gong4", 狗: "gou3", 够: "gou4",
    故: "gu4", 顾: "gu4", 古: "gu3", 挂: "gua4", 关: "guan1", 观: "guan1",
    管: "guan3", 光: "guang1", 广: "guang3", 贵: "gui4", 国: "guo2", 过: "guo4",
    孩: "hai2", 海: "hai3", 好: "hao3", 号: "hao4", 喝: "he1", 和: "he2",
    河: "he2", 黑: "hei1", 很: "hen3", 红: "hong2", 后: "hou4", 候: "hou4",
    胡: "hu2", 花: "hua1", 华: "hua2", 化: "hua4", 话: "hua4", 坏: "huai4",
    还: "huan2", 回: "hui2", 会: "hui4", 火: "huo3", 或: "huo4",
    机: "ji1", 鸡: "ji1", 几: "ji3", 己: "ji3", 记: "ji4", 计: "ji4",
    技: "ji4", 际: "ji4", 加: "jia1", 家: "jia1", 假: "jia3", 价: "jia4",
    见: "jian4", 间: "jian1", 简: "jian3", 建: "jian4", 江: "jiang1",
    讲: "jiang3", 教: "jiao1", 叫: "jiao4", 接: "jie1", 节: "jie2", 结: "jie2",
    姐: "jie3", 解: "jie3", 借: "jie4", 斤: "jin1", 今: "jin1", 金: "jin1",
    进: "jin4", 近: "jin4", 经: "jing1", 京: "jing1", 精: "jing1", 九: "jiu3",
    久: "jiu3", 旧: "jiu4", 就: "jiu4", 句: "ju4", 决: "jue2",
    开: "kai1", 看: "kan4", 康: "kang1", 考: "kao3", 科: "ke1", 可: "ke3",
    渴: "ke3", 客: "ke4", 课: "ke4", 空: "kong1", 口: "kou3", 苦: "ku3",
    裤: "ku4", 快: "kuai4", 块: "kuai4", 矿: "kuang4",
    来: "lai2", 老: "lao3", 乐: "le4", 了: "le5", 累: "lei4", 冷: "leng3",
    离: "li2", 里: "li3", 礼: "li3", 立: "li4", 力: "li4", 两: "liang3",
    亮: "liang4", 路: "lu4", 旅: "lv3", 绿: "lv4", 乱: "luan4", 论: "lun4",
    罗: "luo2",
    妈: "ma1", 马: "ma3", 吗: "ma5", 买: "mai3", 卖: "mai4", 满: "man3",
    慢: "man4", 忙: "mang2", 猫: "mao1", 毛: "mao2", 么: "me5", 没: "mei2",
    美: "mei3", 妹: "mei4", 门: "men2", 们: "men5", 米: "mi3", 面: "mian4",
    明: "ming2", 名: "ming2", 母: "mu3",
    拿: "na2", 那: "na4", 奶: "nai3", 男: "nan2", 南: "nan2", 难: "nan2",
    闹: "nao4", 呢: "ne5", 内: "nei4", 能: "neng2", 你: "ni3", 年: "nian2",
    鸟: "niao3", 您: "nin2", 牛: "niu2", 农: "nong2", 女: "nv3",
    偶: "ou3",
    怕: "pa4", 朋: "peng2", 片: "pian4", 苹: "ping2", 瓶: "ping2", 平: "ping2",
    破: "po4", 普: "pu3",
    七: "qi1", 期: "qi1", 其: "qi2", 奇: "qi2", 齐: "qi2", 起: "qi3",
    气: "qi4", 汽: "qi4", 千: "qian1", 钱: "qian2", 前: "qian2", 浅: "qian3",
    情: "qing2", 请: "qing3", 秋: "qiu1", 去: "qu4", 全: "quan2",
    然: "ran2", 让: "rang4", 热: "re4", 人: "ren2", 认: "ren4", 日: "ri4",
    容: "rong2", 肉: "rou4", 如: "ru2",
    三: "san1", 色: "se4", 山: "shan1", 闪: "shan3", 上: "shang4", 烧: "shao1",
    少: "shao3", 谁: "shui2", 身: "shen1", 深: "shen1", 什: "shen2",
    生: "sheng1", 声: "sheng1", 十: "shi2", 是: "shi4", 事: "shi4", 市: "shi4",
    手: "shou3", 书: "shu1", 树: "shu4", 双: "shuang1", 水: "shui3",
    说: "shuo1", 四: "si4", 送: "song4", 速: "su4", 宿: "su4",
    他: "ta1", 她: "ta1", 太: "tai4", 谈: "tan2", 汤: "tang1", 堂: "tang2",
    天: "tian1", 甜: "tian2", 条: "tiao2", 听: "ting1", 停: "ting2",
    同: "tong2", 痛: "tong4", 头: "tou2", 图: "tu2", 土: "tu3", 团: "tuan2",
    推: "tui1", 腿: "tui3", 退: "tui4",
    外: "wai4", 完: "wan2", 晚: "wan3", 万: "wan4", 王: "wang2", 网: "wang3",
    往: "wang3", 忘: "wang4", 为: "wei2", 伟: "wei3", 卫: "wei4", 文: "wen2",
    问: "wen4", 我: "wo3", 五: "wu3", 午: "wu3", 物: "wu4",
    西: "xi1", 希: "xi1", 喜: "xi3", 系: "xi4", 下: "xia4", 先: "xian1",
    现: "xian4", 线: "xian4", 想: "xiang3", 向: "xiang4", 像: "xiang4",
    小: "xiao3", 些: "xie1", 写: "xie3", 谢: "xie4", 心: "xin1", 新: "xin1",
    信: "xin4", 星: "xing1", 行: "xing2", 姓: "xing4", 修: "xiu1", 须: "xu1",
    许: "xu3", 学: "xue2", 雪: "xue3",
    爷: "ye2", 也: "ye3", 夜: "ye4", 一: "yi1", 衣: "yi1", 医: "yi1",
    已: "yi3", 以: "yi3", 易: "yi4", 意: "yi4", 因: "yin1", 音: "yin1",
    阴: "yin1", 银: "yin2", 应: "ying1", 英: "ying1", 营: "ying2",
    赢: "ying2", 硬: "ying4", 用: "yong4", 有: "you3", 又: "you4", 右: "you4",
    于: "yu2", 鱼: "yu2", 雨: "yu3", 语: "yu3", 元: "yuan2", 月: "yue4",
    云: "yun2",
    杂: "za2", 再: "zai4", 在: "zai4", 早: "zao3", 怎: "zen3", 站: "zhan4",
    张: "zhang1", 找: "zhao3", 着: "zhe5", 真: "zhen1", 正: "zheng4",
    知: "zhi1", 直: "zhi2", 只: "zhi3", 中: "zhong1", 种: "zhong3",
    重: "zhong4", 周: "zhou1", 住: "zhu4", 子: "zi5", 字: "zi4", 自: "zi4",
    总: "zong3", 走: "zou3", 足: "zu2", 族: "zu2", 组: "zu3", 昨: "zuo2",
    左: "zuo3", 做: "zuo4", 作: "zuo4",
};
// ## 9. 核心转换函数（保持原有逻辑）
/**
 * 将数字形式拼音（如 "hao3"、"nv3"）转换为带声调标记形式（"hǎo"、"nǚ"）。
 * 规则：a > o > e > i > u > ü；iu 标在 u；ui 标在 i。
 */
function numberToMark(py) {
    if (py.length === 0)
        return py;
    const toneStr = py[py.length - 1];
    const tone = parseInt(toneStr, 10);
    if (isNaN(tone))
        return py;
    let body = py.substring(0, py.length - 1);
    if (tone === 5 || tone === 0)
        return body;
    const lower = body.toLowerCase();
    let targetIdx = -1;
    const aIdx = lower.indexOf("a");
    const oIdx = lower.indexOf("o");
    const eIdx = lower.indexOf("e");
    const iuIdx = lower.indexOf("iu");
    const uiIdx = lower.indexOf("ui");
    const iIdx = lower.indexOf("i");
    const uIdx = lower.indexOf("u");
    const vIdx = lower.indexOf("v");
    if (aIdx >= 0)
        targetIdx = aIdx;
    else if (oIdx >= 0)
        targetIdx = oIdx;
    else if (eIdx >= 0)
        targetIdx = eIdx;
    else if (iuIdx >= 0)
        targetIdx = iuIdx + 1;
    else if (uiIdx >= 0)
        targetIdx = uiIdx;
    else if (iIdx >= 0)
        targetIdx = iIdx;
    else if (uIdx >= 0)
        targetIdx = uIdx;
    else if (vIdx >= 0)
        targetIdx = vIdx;
    if (targetIdx < 0)
        return body + tone;
    const vowelChar = body[targetIdx];
    const marks = TONE_MARKS[vowelChar.toLowerCase()];
    if (!marks)
        return body + tone;
    const marked = marks[tone - 1] ?? vowelChar;
    const replacement = vowelChar === vowelChar.toUpperCase() ? marked.toUpperCase() : marked;
    body = body.substring(0, targetIdx) + replacement + body.substring(targetIdx + 1);
    body = body.replace(/v/g, "ü").replace(/V/g, "Ü");
    return body;
}
/** 将带声调标记的拼音转换为数字形式（如 "hǎo" -> "hao3"） */
function markToNumber(py) {
    let tone = 0;
    let out = "";
    for (const ch of py) {
        let replaced = false;
        for (const [m, t] of MARK_TO_TONE) {
            if (ch === m) {
                if (m === "ǖ" || m === "ǘ" || m === "ǚ" || m === "ǜ")
                    out += "v";
                else
                    out += ch.toLowerCase().normalize("NFD")[0];
                tone = t;
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            out += ch === "ü" ? "v" : ch === "Ü" ? "V" : ch;
        }
    }
    return tone > 0 ? out + tone : out;
}
function buildEntry(numberForm, source) {
    const lower = numberForm.toLowerCase();
    const initialChar = lower.length > 0 ? lower[0] : "";
    const entry = {
        number: numberForm,
        mark: numberToMark(numberForm),
        initial: initialChar,
    };
    if (source !== undefined) {
        const mutable = { ...entry };
        mutable.source = source;
        return mutable;
    }
    return entry;
}
function formatPinyin(entry, style) {
    if (style === ToneStyle.Mark)
        return entry.mark;
    if (style === ToneStyle.Number)
        return entry.number;
    return entry.number.replace(/[1-5]$/, "");
}
// ## 11. 类型守卫
function isConvertSuccess(r) {
    return r.kind === "success";
}
function isConvertError(r) {
    return r.kind === "error";
}
function isPinyinError(e) {
    return e instanceof PinyinError;
}
/** 类型守卫：判断字符串是否为合法拼音音节 */
function isPinyinSyllable(s) {
    return /^[a-z]+[1-5]$/i.test(s);
}
/** 类型守卫：CharInfo 是否为带拼音的汉字 */
function isResolvedHanzi(info) {
    return info.type === CharType.Hanzi && info.entry !== undefined;
}
// ## 12. 泛型存储类（带约束 + 迭代器 + 生成器 + getter/setter + Symbol）
class PinyinStore {
    constructor(id) {
        this.items = new Map();
        this[STORE_ID] = id;
        this[INTERNAL_VERSION] = 0;
    }
    get(id) {
        return this.items.get(id);
    }
    has(id) {
        return this.items.has(id);
    }
    set(item) {
        this.items.set(item.id, item);
        this[INTERNAL_VERSION]++;
    }
    delete(id) {
        const ok = this.items.delete(id);
        if (ok)
            this[INTERNAL_VERSION]++;
        return ok;
    }
    get size() {
        return this.items.size;
    }
    get version() {
        return this[INTERNAL_VERSION];
    }
    [Symbol.iterator]() {
        return this.items.values();
    }
    /** 生成器：逐项产出 */
    *values() {
        for (const item of this.items.values()) {
            yield item;
        }
    }
    *keys() {
        for (const k of this.items.keys()) {
            yield k;
        }
    }
}
function buildDictItem(char, numberForm, source) {
    return {
        id: char,
        char,
        entry: buildEntry(numberForm, source),
    };
}
// ## 13. 抽象类 + 具体子类
class AbstractPinyinConverter {
    constructor(store, toneStyle = DEFAULT_CONFIG.defaultTone) {
        this.store = store;
        this._toneStyle = toneStyle;
    }
    get toneStyle() {
        return this._toneStyle;
    }
    set toneStyle(value) {
        const valid = Object.values(ToneStyle).includes(value);
        if (!valid) {
            throw new PinyinError(ErrorCode.InvalidInput, `非法声调风格: ${value}`);
        }
        this._toneStyle = value;
    }
    lookup(ch) {
        return this.store.get(ch)?.entry;
    }
}
/** 全拼音转换器 */
class FullPinyinConverter extends AbstractPinyinConverter {
    convert(text) {
        if (text.length === 0) {
            return { kind: "error", code: ErrorCode.Empty, message: "输入为空", input: text };
        }
        const output = [];
        for (const info of this.iterate(text)) {
            if (isResolvedHanzi(info)) {
                output.push(formatPinyin(info.entry, this._toneStyle));
            }
            else {
                output.push(info.char);
            }
        }
        return { kind: "success", input: text, output, mode: ConvertMode.Full };
    }
    classify(ch) {
        if (this.store.has(ch))
            return CharType.Hanzi;
        if (/\s/.test(ch))
            return CharType.Space;
        if (/[，。！？、；：""''（）【】,.!?;:]/.test(ch))
            return CharType.Punctuation;
        return CharType.Other;
    }
    /** 生成器：逐字分类 */
    *iterate(text) {
        for (const ch of text) {
            const entry = this.lookup(ch);
            yield {
                char: ch,
                type: entry ? CharType.Hanzi : this.classify(ch),
                entry,
            };
        }
    }
}
/** 首字母转换器 */
class InitialsPinyinConverter extends AbstractPinyinConverter {
    convert(text) {
        if (text.length === 0) {
            return { kind: "error", code: ErrorCode.Empty, message: "输入为空", input: text };
        }
        let out = "";
        for (const ch of text) {
            const entry = this.lookup(ch);
            if (entry) {
                out += entry.initial.toUpperCase();
            }
            else if (!/\s/.test(ch)) {
                out += ch;
            }
        }
        return { kind: "success", input: text, output: [out], mode: ConvertMode.Initials };
    }
    classify(ch) {
        if (this.store.has(ch))
            return CharType.Hanzi;
        if (/\s/.test(ch))
            return CharType.Space;
        return CharType.Other;
    }
}
// ## 14. 词典加载 / 合并
function loadUserDict(userPath) {
    if (!fs.existsSync(userPath))
        return {};
    try {
        const raw = JSON.parse(fs.readFileSync(userPath, "utf-8"));
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const entries = {};
            for (const [k, v] of Object.entries(raw)) {
                if (typeof v === "string")
                    entries[k] = v;
            }
            return entries;
        }
    }
    catch {
        // 忽略损坏的用户词典
    }
    return {};
}
function buildStore(userDict) {
    const store = new PinyinStore("pinyin-main");
    for (const [ch, py] of Object.entries(BUILTIN_PINYIN)) {
        store.set(buildDictItem(ch, py, "builtin"));
    }
    for (const [ch, py] of Object.entries(userDict)) {
        store.set(buildDictItem(ch, py, "user"));
    }
    return store;
}
// ## 15. CLI 部分
function getHomeDir() {
    return process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || ".";
}
function userDictPath() {
    return path.join(getHomeDir(), ".pinyin-user-dict.json");
}
function printHelp() {
    console.log(`
拼音转换工具 (Pinyin Converter)

用法:
  convert <text> [-t tones]       文本转拼音 (tones: mark|number|none, 默认 mark)
  initials <text>                 取每个汉字拼音首字母
  dict <char>                     查询某字的内置拼音
  add <char> <pinyin>             添加/覆盖用户词典条目（如 add 好 hao3），持久化到文件

选项:
  -t, --tone <mode>     声调显示模式: mark | number | none
  -h, --help            显示帮助

说明:
  - 内置约 330 个常用汉字；未命中的汉字原样输出。
  - 多音字取最常用读音（基础处理）。
  - 用户词典保存在 ~/.pinyin-user-dict.json。

示例:
  node dist/index.js convert "你好，世界"
  node dist/index.js convert "我爱中国" -t number
  node dist/index.js initials "中华人民共和国"
  node dist/index.js dict 好
  node dist/index.js add 喵 miao1
`);
}
function parseTone(v) {
    if (v === ToneStyle.Number)
        return ToneStyle.Number;
    if (v === ToneStyle.None)
        return ToneStyle.None;
    return ToneStyle.Mark;
}
function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let text = "";
    let char = "";
    let pinyin = "";
    let tone = ToneStyle.Mark;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === "-t" || a === "--tone") {
            tone = parseTone(rest[++i]);
        }
        else if (!a.startsWith("-")) {
            if (command === "add") {
                if (char === "")
                    char = a;
                else if (pinyin === "")
                    pinyin = a;
            }
            else if (command === "dict") {
                char = a;
            }
            else {
                text = text.length === 0 ? a : text + " " + a;
            }
        }
    }
    return { command, text, char, pinyin, tone };
}
function describeResult(result) {
    if (isConvertSuccess(result)) {
        return result.output.join(" ");
    }
    if (isConvertError(result)) {
        return `[${result.code}] ${result.message}`;
    }
    return `[ambiguous] ${result.candidates.join(" | ")}`;
}
function main() {
    const opts = parseArgs(process.argv);
    const userPath = userDictPath();
    const userDict = loadUserDict(userPath);
    const store = buildStore(userDict);
    switch (opts.command) {
        case "convert": {
            if (!opts.text) {
                console.error("错误：未提供文本。");
                process.exit(1);
            }
            const converter = new FullPinyinConverter(store, opts.tone);
            const result = converter.convert(opts.text);
            console.log(`声调模式: ${opts.tone}`);
            console.log("原文: " + opts.text);
            console.log("拼音: " + describeResult(result));
            break;
        }
        case "initials": {
            if (!opts.text) {
                console.error("错误：未提供文本。");
                process.exit(1);
            }
            const converter = new InitialsPinyinConverter(store);
            const result = converter.convert(opts.text);
            console.log("首字母: " + describeResult(result));
            break;
        }
        case "dict": {
            if (!opts.char) {
                console.error("错误：未提供汉字。");
                process.exit(1);
            }
            const item = store.get(opts.char);
            if (!item) {
                console.log(`未在词典中找到 "${opts.char}"。`);
            }
            else {
                const e = item.entry;
                console.log(`字: ${opts.char}`);
                console.log(`  声调标记: ${e.mark}`);
                console.log(`  声调数字: ${e.number}`);
                console.log(`  首字母:   ${e.initial.toUpperCase()}`);
                console.log(`  来源:     ${e.source === "user" ? "用户" : "内置"}`);
            }
            break;
        }
        case "add": {
            if (!opts.char || !opts.pinyin) {
                console.error("错误：用法 add <char> <pinyin>，例如 add 喵 miao1");
                process.exit(1);
            }
            if (!isPinyinSyllable(opts.pinyin) && !/^[a-z]+$/i.test(opts.pinyin)) {
                throw new InvalidPinyinError(`拼音格式无效: ${opts.pinyin}`);
            }
            userDict[opts.char] = opts.pinyin.toLowerCase();
            fs.writeFileSync(userPath, JSON.stringify(userDict, null, 2), "utf-8");
            const e = buildEntry(opts.pinyin.toLowerCase(), "user");
            console.log(`已保存: ${opts.char} -> ${e.mark} (${e.number})`);
            console.log(`文件: ${userPath}`);
            break;
        }
        case "test": {
            const samples = ["hao3", "ni3", "liu3", "gui4", "xue2", "lv3", "nv3", "de5"];
            console.log("声调转换自检：");
            for (const s of samples) {
                const m = numberToMark(s);
                const back = markToNumber(m);
                console.log(`  ${s} -> ${m} -> ${back}`);
            }
            console.log("词典大小: " + store.size);
            console.log("存储版本: " + store.version);
            try {
                const bad = new FullPinyinConverter(store);
                bad.toneStyle = "wrong";
            }
            catch (e) {
                if (isPinyinError(e)) {
                    console.log(`捕获错误: [${e.code}] ${e.message}`);
                }
            }
            break;
        }
        default:
            console.error(`未知命令: ${opts.command}`);
            printHelp();
            process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map