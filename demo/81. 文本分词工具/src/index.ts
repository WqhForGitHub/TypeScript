#!/usr/bin/env node

/**
 * 文本分词工具 (Text Tokenizer)
 * 一个使用纯 TypeScript 编写的命令行分词工具。
 * 支持空白分词、字符切分、中文词典正向最大匹配、N-gram、句子切分、词频统计与关键词抽取。
 * 仅使用 Node.js 内置模块。
 */

import * as fs from "fs";

/** 分词模式 */
type TokenMode = "whitespace" | "char" | "dict" | "ngram";

/** 中文停用词表（示例） */
const STOP_WORDS: ReadonlySet<string> = new Set<string>([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "那", "它", "他", "她", "们", "与",
    "及", "或", "但", "而", "因为", "所以", "如果", "虽然", "然后", "可是",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "in", "on", "at", "to", "for", "of", "and", "or", "but", "if", "this", "that",
]);

/**
 * 内置中文常用词词典（约 200 个），用于正向最大匹配分词。
 * 按长度倒序使用可提升匹配效率。
 */
const BUILTIN_DICT: ReadonlyArray<string> = [
    "我们", "你们", "他们", "她们", "它们", "自己", "什么", "怎么", "为什么",
    "因为", "所以", "如果", "虽然", "但是", "然后", "因此", "由于", "并且",
    "或者", "已经", "正在", "将要", "可以", "应该", "必须", "可能", "也许",
    "现在", "今天", "明天", "昨天", "以后", "以前", "时候", "时间", "地方",
    "中国", "北京", "上海", "广州", "深圳", "国家", "社会", "世界", "经济",
    "政治", "文化", "教育", "科学", "技术", "计算机", "互联网", "手机", "电脑",
    "程序", "代码", "数据", "信息", "系统", "网络", "软件", "硬件", "人工智能",
    "机器学习", "深度学习", "神经网络", "自然语言", "处理", "分析", "研究", "开发",
    "设计", "测试", "维护", "部署", "运行", "执行", "操作", "管理", "控制",
    "问题", "方法", "方案", "结果", "原因", "目的", "目标", "过程", "步骤",
    "开始", "结束", "继续", "停止", "完成", "进行", "实现", "实现", "支持",
    "提供", "获得", "需要", "希望", "喜欢", "认为", "觉得", "知道", "了解",
    "学习", "工作", "生活", "吃饭", "睡觉", "走路", "跑步", "看书", "写字",
    "说话", "听话", "唱歌", "跳舞", "游戏", "运动", "音乐", "电影", "电视",
    "电话", "短信", "邮件", "消息", "新闻", "故事", "文章", "书籍", "报纸",
    "学生", "老师", "医生", "护士", "工人", "农民", "警察", "司机", "工程师",
    "家庭", "父母", "孩子", "朋友", "同事", "领导", "员工", "客户", "用户",
    "商店", "超市", "医院", "学校", "公司", "工厂", "银行", "机场", "车站",
    "火车", "汽车", "飞机", "自行车", "公交车", "地铁", "高铁", "高速公路",
    "吃饭", "喝水", "买", "卖", "价格", "钱", "货币", "美元", "人民币",
    "快乐", "悲伤", "生气", "害怕", "惊讶", "喜欢", "讨厌", "感谢", "抱歉",
    "漂亮", "帅气", "聪明", "笨", "勇敢", "胆小", "善良", "邪恶", "诚实",
    "天气", "下雨", "下雪", "刮风", "晴天", "阴天", "温度", "湿度", "季节",
    "春天", "夏天", "秋天", "冬天", "早上", "中午", "晚上", "白天", "黑夜",
    "红色", "绿色", "蓝色", "黄色", "黑色", "白色", "颜色", "形状", "大小",
    "长度", "宽度", "高度", "深度", "重量", "速度", "面积", "体积", "距离",
    "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
    "百", "千", "万", "亿", "个", "只", "条", "本", "张", "件",
    "中国话", "中文", "英文", "日语", "法语", "德语", "俄语", "西班牙语",
];

/** 判断字符是否为中文字符 */
function isChineseChar(ch: string): boolean {
    const code = ch.codePointAt(0);
    if (code === undefined) return false;
    // CJK 统一表意文字基本区
    return code >= 0x4e00 && code <= 0x9fff;
}

/** 判断字符是否为英文字母 */
function isLetter(ch: string): boolean {
    return /[a-zA-Z]/.test(ch);
}

/** 判断字符是否为数字 */
function isDigit(ch: string): boolean {
    return /[0-9]/.test(ch);
}

/** 句子切分：按中英文句末标点切分 */
function splitSentences(text: string): string[] {
    const result: string[] = [];
    let buf = "";
    for (const ch of text) {
        buf += ch;
        if ("。！？.!?".includes(ch)) {
            result.push(buf.trim());
            buf = "";
        }
    }
    if (buf.trim().length > 0) result.push(buf.trim());
    return result.filter((s) => s.length > 0);
}

/** 空白分词：按空白符切分 */
function tokenizeWhitespace(text: string): string[] {
    return text
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/** 字符级切分：每个非空白字符为一个 token */
function tokenizeChar(text: string): string[] {
    const out: string[] = [];
    for (const ch of text) {
        if (/\s/.test(ch)) continue;
        out.push(ch);
    }
    return out;
}

/**
 * 词典正向最大匹配（Forward Maximum Matching）中文分词。
 * 对连续的中文段落使用词典匹配；非中文段落按空白/字母数字切分。
 */
function segmentChinese(text: string, dict: ReadonlyArray<string>): string[] {
    // 按长度倒序排列，便于最大匹配
    const sorted = [...dict].sort((a, b) => b.length - a.length);
    const dictSet = new Set(sorted);
    const maxLen = sorted.length > 0 ? sorted[0].length : 1;

    const tokens: string[] = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
        const ch = text[i];
        if (!isChineseChar(ch)) {
            // 非中文段：连续的非中文字符作为一个块处理
            let j = i;
            let buf = "";
            while (j < n && !isChineseChar(text[j])) {
                if (/\s/.test(text[j])) {
                    if (buf.length > 0) {
                        tokens.push(buf);
                        buf = "";
                    }
                } else {
                    buf += text[j];
                }
                j++;
            }
            if (buf.length > 0) tokens.push(buf);
            i = j;
            continue;
        }

        // 中文段：正向最大匹配
        let matched = "";
        for (let L = Math.min(maxLen, n - i); L >= 1; L--) {
            const candidate = text.substring(i, i + L);
            if (L === 1 || dictSet.has(candidate)) {
                matched = candidate;
                break;
            }
        }
        tokens.push(matched);
        i += matched.length;
    }
    return tokens;
}

/** N-gram 生成：在已切分 token 序列上滑动 */
function generateNgrams(tokens: string[], n: number): string[] {
    if (n < 1) return [];
    const out: string[] = [];
    for (let i = 0; i + n <= tokens.length; i++) {
        out.push(tokens.slice(i, i + n).join(" "));
    }
    return out;
}

/** 词频统计：返回 [词, 频次] 数组，按频次降序 */
function countFrequency(tokens: string[], topN?: number): Array<[string, number]> {
    const map = new Map<string, number>();
    for (const t of tokens) {
        map.set(t, (map.get(t) ?? 0) + 1);
    }
    const arr = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return topN !== undefined ? arr.slice(0, topN) : arr;
}

/** 关键词抽取（基于 TF，过滤停用词与单字符） */
function extractKeywords(text: string, count: number): Array<[string, number]> {
    const tokens = segmentChinese(text, BUILTIN_DICT).filter(
        (t) => !STOP_WORDS.has(t.toLowerCase()) && t.length > 1
    );
    return countFrequency(tokens, count);
}

/** 解析命令行参数 */
interface ParsedArgs {
    command: string;
    text: string;
    mode: TokenMode;
    n: number;
    top: number;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let text = "";
    let mode: TokenMode = "whitespace";
    let n = 2;
    let top = 10;

    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === "-m" || a === "--mode") {
            const v = rest[++i] as TokenMode;
            if (v === "whitespace" || v === "char" || v === "dict" || v === "ngram") {
                mode = v;
            }
        } else if (a === "-n" || a === "--n") {
            const v = parseInt(rest[++i] ?? "", 10);
            if (!isNaN(v) && v > 0) n = v;
        } else if (a === "--top") {
            const v = parseInt(rest[++i] ?? "", 10);
            if (!isNaN(v) && v > 0) top = v;
        } else if (a === "-f" || a === "--file") {
            const path = rest[++i];
            if (path) text = fs.readFileSync(path, "utf-8");
        } else if (!a.startsWith("-")) {
            text = text.length === 0 ? a : text + " " + a;
        }
    }
    return { command, text, mode, n, top };
}

function printHelp(): void {
    console.log(`
文本分词工具 (Text Tokenizer)

用法:
  tokenize <text> [-m mode]        按模式分词 (mode: whitespace|char|dict|ngram)
  segment <text>                    中文词典正向最大匹配分词
  freq <text> [--top N]             词频统计 (默认前 10)
  keywords <text> [-n count]        关键词抽取 (基于 TF)
  ngram <text> -n <n>               N-gram 生成
  sentences <text>                  句子切分

选项:
  -m, --mode <mode>     分词模式
  -n, --n <n>           N-gram 长度或关键词数量
  --top <N>             词频统计返回前 N
  -f, --file <path>     从文件读取文本
  -h, --help            显示帮助

示例:
  node dist/index.js segment "我喜欢机器学习和深度学习"
  node dist/index.js freq "今天天气很好 今天天气不好" --top 5
  node dist/index.js ngram "我爱自然语言处理" -n 2
`);
}

function formatTokens(tokens: string[]): string {
    return tokens.map((t, i) => `${(i + 1).toString().padStart(3, "0")}. ${t}`).join("\n");
}

function formatFreq(list: Array<[string, number]>): string {
    if (list.length === 0) return "(无结果)";
    const maxWord = Math.max(...list.map(([w]) => w.length));
    return list
        .map(([w, c], i) => `${(i + 1).toString().padStart(3, "0")}. ${w.padEnd(maxWord)}  ${c}`)
        .join("\n");
}

function main(): void {
    const opts = parseArgs(process.argv);
    if (!opts.text && opts.command !== "help") {
        console.error("错误：未提供输入文本。使用 -h 查看帮助。");
        process.exit(1);
    }

    switch (opts.command) {
        case "tokenize": {
            let tokens: string[];
            if (opts.mode === "whitespace") tokens = tokenizeWhitespace(opts.text);
            else if (opts.mode === "char") tokens = tokenizeChar(opts.text);
            else if (opts.mode === "dict") tokens = segmentChinese(opts.text, BUILTIN_DICT);
            else {
                // ngram 模式：先按词典分词，再生成 n-gram
                tokens = generateNgrams(segmentChinese(opts.text, BUILTIN_DICT), opts.n);
            }
            console.log(`模式: ${opts.mode} | 共 ${tokens.length} 个 token`);
            console.log(formatTokens(tokens));
            break;
        }
        case "segment": {
            const tokens = segmentChinese(opts.text, BUILTIN_DICT);
            console.log(`中文分词结果 (共 ${tokens.length} 个词):`);
            console.log(tokens.join(" / "));
            break;
        }
        case "sentences": {
            const sents = splitSentences(opts.text);
            console.log(`句子数: ${sents.length}`);
            console.log(formatTokens(sents));
            break;
        }
        case "freq": {
            const tokens = segmentChinese(opts.text, BUILTIN_DICT);
            const freq = countFrequency(tokens, opts.top);
            console.log(`词频统计 (前 ${opts.top}):`);
            console.log(formatFreq(freq));
            break;
        }
        case "keywords": {
            const kws = extractKeywords(opts.text, opts.n);
            console.log(`关键词 (基于 TF, 前 ${opts.n}):`);
            console.log(formatFreq(kws));
            break;
        }
        case "ngram": {
            const base = segmentChinese(opts.text, BUILTIN_DICT);
            const grams = generateNgrams(base, opts.n);
            console.log(`${opts.n}-gram (共 ${grams.length} 个):`);
            console.log(formatTokens(grams));
            break;
        }
        default:
            console.error(`未知命令: ${opts.command}`);
            printHelp();
            process.exit(1);
    }
}

main();
