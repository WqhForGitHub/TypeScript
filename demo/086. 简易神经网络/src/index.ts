#!/usr/bin/env node

/**
 * 简易神经网络 (Simple Neural Network)
 * 一个使用纯 TypeScript 从零实现的前馈神经网络。
 * 包含：Matrix 类（加减乘/转置/逐元素/初始化）、Dense 层、激活函数
 * (sigmoid/tanh/relu/softmax)、损失函数 (MSE / 交叉熵)、
 * 前向传播、反向传播、梯度下降、小批量训练。
 * 内置演示：XOR 问题、合成分类数据、模型保存/加载/预测。
 * 仅使用 Node.js 内置模块（fs, path, crypto）。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

type ActivationName = "sigmoid" | "tanh" | "relu" | "softmax" | "linear";
type LossName = "mse" | "crossEntropy";

/** 矩阵类（行优先） */
class Matrix {
    readonly rows: number;
    readonly cols: number;
    readonly data: Float64Array;

    constructor(rows: number, cols: number, fill = 0) {
        this.rows = rows;
        this.cols = cols;
        this.data = new Float64Array(rows * cols).fill(fill);
    }

    static fromArray(arr: number[][], copy = true): Matrix {
        const r = arr.length;
        const c = r > 0 ? arr[0].length : 0;
        const m = new Matrix(r, c);
        for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) m.data[i * c + j] = arr[i][j];
        return m;
    }

    static random(rows: number, cols: number, scale = 1): Matrix {
        const m = new Matrix(rows, cols);
        for (let i = 0; i < m.data.length; i++) {
            // Box-Muller 近似的高斯随机
            m.data[i] = (Math.random() * 2 - 1) * scale;
        }
        return m;
    }

    get(i: number, j: number): number { return this.data[i * this.cols + j]; }
    set(i: number, j: number, v: number): void { this.data[i * this.cols + j] = v; }

    add(b: Matrix): Matrix {
        const out = new Matrix(this.rows, this.cols);
        for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] + b.data[i];
        return out;
    }
    sub(b: Matrix): Matrix {
        const out = new Matrix(this.rows, this.cols);
        for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] - b.data[i];
        return out;
    }
    mul(b: Matrix): Matrix {
        if (this.cols !== b.rows) throw new Error(`矩阵维度不匹配 ${this.rows}x${this.cols} * ${b.rows}x${b.cols}`);
        const out = new Matrix(this.rows, b.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let k = 0; k < this.cols; k++) {
                const a = this.data[i * this.cols + k];
                if (a === 0) continue;
                for (let j = 0; j < b.cols; j++) {
                    out.data[i * b.cols + j] += a * b.data[k * b.cols + j];
                }
            }
        }
        return out;
    }
    transpose(): Matrix {
        const out = new Matrix(this.cols, this.rows);
        for (let i = 0; i < this.rows; i++)
            for (let j = 0; j < this.cols; j++)
                out.data[j * this.rows + i] = this.data[i * this.cols + j];
        return out;
    }
    map(fn: (v: number, i: number) => number): Matrix {
        const out = new Matrix(this.rows, this.cols);
        for (let i = 0; i < this.data.length; i++) out.data[i] = fn(this.data[i], i);
        return out;
    }
    scale(s: number): Matrix { return this.map((v) => v * s); }
}

/** 激活函数与导数（softmax 导数在 loss 中处理） */
const Activations: Record<ActivationName, (x: Matrix) => Matrix> = {
    sigmoid: (x) => x.map((v) => 1 / (1 + Math.exp(-v))),
    tanh: (x) => x.map((v) => Math.tanh(v)),
    relu: (x) => x.map((v) => (v > 0 ? v : 0)),
    linear: (x) => x.map((v) => v),
    softmax: (x) => {
        const out = new Matrix(x.rows, x.cols);
        for (let i = 0; i < x.rows; i++) {
            let max = -Infinity;
            for (let j = 0; j < x.cols; j++) max = Math.max(max, x.get(i, j));
            let sum = 0;
            for (let j = 0; j < x.cols; j++) { const e = Math.exp(x.get(i, j) - max); out.set(i, j, e); sum += e; }
            for (let j = 0; j < x.cols; j++) out.set(i, j, out.get(i, j) / sum);
        }
        return out;
    },
};

/** 激活导数（逐元素，输入为激活后的值 a） */
function activationDerivative(name: ActivationName, a: Matrix): Matrix {
    switch (name) {
        case "sigmoid": return a.map((v) => v * (1 - v));
        case "tanh": return a.map((v) => 1 - v * v);
        case "relu": return a.map((v) => (v > 0 ? 1 : 0));
        case "linear": return a.map(() => 1);
        case "softmax": return a.map(() => 1); // 与交叉熵配合，在 delta 计算时直接用 a-y
    }
}

/** 损失函数 */
function computeLoss(name: LossName, pred: Matrix, target: Matrix): number {
    let sum = 0;
    for (let i = 0; i < pred.data.length; i++) {
        const p = pred.data[i], t = target.data[i];
        if (name === "mse") sum += (p - t) * (p - t);
        else sum += -(t * Math.log(p + 1e-12) + (1 - t) * Math.log(1 - p + 1e-12));
    }
    return sum / pred.rows;
}

/** 全连接层 */
interface Layer {
    weights: Matrix;   // (in+1) x out，含偏置行
    activation: ActivationName;
    lastInput?: Matrix;
    lastZ?: Matrix;
    lastA?: Matrix;
}

interface NetworkConfig {
    inputSize: number;
    hidden: number[]; // 各隐藏层神经元数
    outputSize: number;
    hiddenActivation: ActivationName;
    outputActivation: ActivationName;
    loss: LossName;
    learningRate: number;
}

class NeuralNetwork {
    layers: Layer[] = [];
    config: NetworkConfig;

    constructor(config: NetworkConfig) {
        this.config = config;
        const sizes = [config.inputSize, ...config.hidden, config.outputSize];
        const acts = [...Array(config.hidden.length).fill(config.hiddenActivation), config.outputActivation] as ActivationName[];
        for (let i = 0; i < sizes.length - 1; i++) {
            const inSize = sizes[i] + 1; // +1 偏置
            const outSize = sizes[i + 1];
            // He/Xavier 初始化
            const scale = Math.sqrt(2 / inSize);
            const w = Matrix.random(inSize, outSize, scale);
            this.layers.push({ weights: w, activation: acts[i] });
        }
    }

    /** 前向传播，返回每层激活 */
    forward(x: Matrix): Matrix {
        let a = x;
        for (const layer of this.layers) {
            // 加偏置列
            const biased = new Matrix(a.rows, a.cols + 1);
            for (let i = 0; i < a.rows; i++) {
                for (let j = 0; j < a.cols; j++) biased.set(i, j, a.get(i, j));
                biased.set(i, a.cols, 1); // 偏置
            }
            const z = biased.mul(layer.weights);
            const aNext = Activations[layer.activation](z);
            layer.lastInput = biased;
            layer.lastZ = z;
            layer.lastA = aNext;
            a = aNext;
        }
        return a;
    }

    /** 反向传播 + 梯度下降（单步），返回损失值 */
    trainBatch(x: Matrix, y: Matrix): number {
        const pred = this.forward(x);
        const loss = computeLoss(this.config.loss, pred, y);

        // 计算输出层 delta
        let delta: Matrix;
        const last = this.layers[this.layers.length - 1];
        if (last.activation === "softmax" && this.config.loss === "crossEntropy") {
            delta = pred.sub(y); // softmax + 交叉熵的简化梯度
        } else {
            const dAct = activationDerivative(last.activation, last.lastA!);
            const dLoss = this.config.loss === "mse" ? pred.sub(y).scale(2 / y.cols) : pred.sub(y);
            delta = new Matrix(dLoss.rows, dLoss.cols);
            for (let i = 0; i < delta.data.length; i++) delta.data[i] = dLoss.data[i] * dAct.data[i];
        }

        // 反向遍历各层
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];
            const input = layer.lastInput!;
            const grad = input.transpose().mul(delta).scale(this.config.learningRate / x.rows);
            layer.weights = layer.weights.sub(grad);
            if (l > 0) {
                // 传播到上一层激活（去掉偏置列对应的 delta）
                const wNoBias = new Matrix(layer.weights.rows - 1, layer.weights.cols);
                for (let i = 0; i < wNoBias.rows; i++)
                    for (let j = 0; j < wNoBias.cols; j++) wNoBias.set(i, j, layer.weights.get(i, j));
                const prevA = this.layers[l - 1].lastA!;
                const dPrev = delta.mul(wNoBias.transpose());
                const dAct = activationDerivative(this.layers[l - 1].activation, prevA);
                delta = new Matrix(dPrev.rows, dPrev.cols);
                for (let i = 0; i < delta.data.length; i++) delta.data[i] = dPrev.data[i] * dAct.data[i];
            }
        }
        return loss;
    }

    /** 训练多个 epoch，支持小批量 */
    fit(inputs: number[][], targets: number[][], epochs: number, batchSize: number, verbose = true): number[] {
        const x = Matrix.fromArray(inputs);
        const y = Matrix.fromArray(targets);
        const losses: number[] = [];
        const n = x.rows;
        for (let e = 0; e < epochs; e++) {
            // 简单 shuffle
            const order = Array.from({ length: n }, (_, i) => i);
            for (let i = n - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            let epochLoss = 0;
            let batches = 0;
            for (let start = 0; start < n; start += batchSize) {
                const idx = order.slice(start, start + batchSize);
                const bx = new Matrix(idx.length, x.cols);
                const by = new Matrix(idx.length, y.cols);
                for (let r = 0; r < idx.length; r++) {
                    for (let c = 0; c < x.cols; c++) bx.set(r, c, x.get(idx[r], c));
                    for (let c = 0; c < y.cols; c++) by.set(r, c, y.get(idx[r], c));
                }
                epochLoss += this.trainBatch(bx, by);
                batches++;
            }
            const avg = epochLoss / batches;
            losses.push(avg);
            if (verbose && (e < 5 || e % Math.max(1, Math.floor(epochs / 10)) === 0)) {
                console.log(`  epoch ${e + 1}/${epochs}  loss=${avg.toFixed(6)}`);
            }
        }
        return losses;
    }

    predict(input: number[]): number[] {
        const x = Matrix.fromArray([input]);
        const out = this.forward(x);
        const arr: number[] = [];
        for (let j = 0; j < out.cols; j++) arr.push(out.get(0, j));
        return arr;
    }

    serialize(): string {
        return JSON.stringify({
            config: this.config,
            layers: this.layers.map((l) => ({
                weights: Array.from(l.weights.data),
                rows: l.weights.rows,
                cols: l.weights.cols,
                activation: l.activation,
            })),
        });
    }

    static deserialize(json: string): NeuralNetwork {
        const obj = JSON.parse(json) as {
            config: NetworkConfig;
            layers: Array<{ weights: number[]; rows: number; cols: number; activation: ActivationName }>;
        };
        const net = new NeuralNetwork(obj.config);
        for (let i = 0; i < net.layers.length; i++) {
            const w = new Matrix(obj.layers[i].rows, obj.layers[i].cols);
            for (let k = 0; k < w.data.length; k++) w.data[k] = obj.layers[i].weights[k];
            net.layers[i].weights = w;
            net.layers[i].activation = obj.layers[i].activation;
        }
        return net;
    }
}

/** XOR 数据集 */
const XOR_DATA: { inputs: number[][]; targets: number[][] } = {
    inputs: [[0, 0], [0, 1], [1, 0], [1, 1]],
    targets: [[0], [1], [1], [0]],
};

/** 合成分类数据：3 类二维点 */
function generateClassData(): { inputs: number[][]; targets: number[][]; labels: string[] } {
    const inputs: number[][] = [];
    const targets: number[][] = [];
    const labels = ["A", "B", "C"];
    const centers = [[1, 1], [5, 1], [3, 5]];
    for (let c = 0; c < 3; c++) {
        for (let i = 0; i < 30; i++) {
            const x = centers[c][0] + (Math.random() - 0.5) * 2;
            const y = centers[c][1] + (Math.random() - 0.5) * 2;
            inputs.push([x, y]);
            const t = [0, 0, 0];
            t[c] = 1;
            targets.push(t);
        }
    }
    return { inputs, targets, labels };
}

function argmax(arr: number[]): number {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < arr.length; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
    return bi;
}

interface ParsedArgs {
    command: string;
    dataFile: string;
    modelFile: string;
    inputVec: number[];
    epochs: number;
    lr: number;
    outFile: string;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        printHelp();
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let dataFile = "", modelFile = "", outFile = "";
    const inputVec: number[] = [];
    let epochs = 500, lr = 0.5;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        switch (a) {
            case "-e": case "--epochs": { const v = parseInt(rest[++i] ?? "", 10); if (!isNaN(v)) epochs = v; break; }
            case "-l": case "--lr": { const v = parseFloat(rest[++i] ?? ""); if (!isNaN(v)) lr = v; break; }
            case "-o": case "--out": outFile = rest[++i] ?? ""; break;
            case "-i": case "--input": {
                const s = rest[++i] ?? "";
                s.split(",").map((n) => parseFloat(n)).forEach((n) => { if (!isNaN(n)) inputVec.push(n); });
                break;
            }
            default:
                if (!a.startsWith("-")) {
                    if (dataFile === "") dataFile = a;
                    else if (modelFile === "") modelFile = a;
                }
        }
    }
    return { command, dataFile, modelFile, inputVec, epochs, lr, outFile };
}

function printHelp(): void {
    console.log(`
简易神经网络 (Simple Neural Network)
用法:
  xor [-e epochs] [-l lr]                       训练并测试 XOR 问题
  classify [-e epochs] [-l lr] [-o model.json]  训练合成 3 分类数据
  train <data.json> [-e epochs] [-l lr] [-o m]  用自定义数据训练
  predict <model.json> -i v1,v2,...             加载模型并预测
  test                                          运行内置自检（XOR 与矩阵）
示例:
  node dist/index.js xor -e 2000 -l 0.5
`);
}

function runXorDemo(epochs: number, lr: number): void {
    console.log("=== XOR 训练 ===");
    const net = new NeuralNetwork({
        inputSize: 2, hidden: [4], outputSize: 1,
        hiddenActivation: "tanh", outputActivation: "sigmoid",
        loss: "mse", learningRate: lr,
    });
    net.fit(XOR_DATA.inputs, XOR_DATA.targets, epochs, 4, true);
    console.log("\n预测结果:");
    for (const inp of XOR_DATA.inputs) {
        const p = net.predict(inp);
        console.log(`  XOR(${inp[0]}, ${inp[1]}) = ${p[0].toFixed(4)} -> ${p[0] > 0.5 ? 1 : 0}`);
    }
}

function runClassifyDemo(epochs: number, lr: number, outFile: string): void {
    console.log("=== 合成 3 分类训练 ===");
    const { inputs, targets, labels } = generateClassData();
    const net = new NeuralNetwork({
        inputSize: 2, hidden: [8, 6], outputSize: 3,
        hiddenActivation: "relu", outputActivation: "softmax",
        loss: "crossEntropy", learningRate: lr,
    });
    net.fit(inputs, targets, epochs, 16, true);
    let correct = 0;
    for (let i = 0; i < inputs.length; i++) {
        if (argmax(net.predict(inputs[i])) === argmax(targets[i])) correct++;
    }
    console.log(`\n训练集准确率: ${((correct / inputs.length) * 100).toFixed(1)}% (${correct}/${inputs.length})`);
    console.log("抽样预测:");
    for (let i = 0; i < 5; i++) {
        const p = net.predict(inputs[i]);
        console.log(`  [${inputs[i].map((v) => v.toFixed(2))}] -> ${labels[argmax(p)]} (置信度 ${(Math.max(...p) * 100).toFixed(1)}%)`);
    }
    if (outFile) {
        fs.writeFileSync(outFile, net.serialize(), "utf-8");
        console.log(`模型已保存: ${outFile}`);
    }
}

function trainFromData(dataFile: string, epochs: number, lr: number, outFile: string): void {
    if (!fs.existsSync(dataFile)) { console.error(`错误：数据文件不存在 ${dataFile}`); process.exit(1); }
    const raw = JSON.parse(fs.readFileSync(dataFile, "utf-8")) as {
        inputs: number[][]; targets: number[][];
        hidden?: number[]; hiddenActivation?: ActivationName;
        outputActivation?: ActivationName; loss?: LossName;
    };
    if (!raw.inputs || !raw.targets) { console.error("错误：数据需包含 inputs 与 targets"); process.exit(1); }
    const inputSize = raw.inputs[0].length;
    const outputSize = raw.targets[0].length;
    const net = new NeuralNetwork({
        inputSize,
        hidden: raw.hidden ?? [8],
        outputSize,
        hiddenActivation: raw.hiddenActivation ?? "relu",
        outputActivation: raw.outputActivation ?? (outputSize === 1 ? "sigmoid" : "softmax"),
        loss: raw.loss ?? (outputSize === 1 ? "mse" : "crossEntropy"),
        learningRate: lr,
    });
    net.fit(raw.inputs, raw.targets, epochs, 16, true);
    if (outFile) {
        fs.writeFileSync(outFile, net.serialize(), "utf-8");
        console.log(`模型已保存: ${outFile}`);
    }
}

function predictModel(modelFile: string, input: number[]): void {
    if (!fs.existsSync(modelFile)) { console.error(`错误：模型不存在 ${modelFile}`); process.exit(1); }
    if (input.length === 0) { console.error("错误：缺少 -i 输入向量"); process.exit(1); }
    const net = NeuralNetwork.deserialize(fs.readFileSync(modelFile, "utf-8"));
    const p = net.predict(input);
    console.log(`输入: [${input.join(", ")}]`);
    console.log(`输出: [${p.map((v) => v.toFixed(6)).join(", ")}]`);
    if (p.length > 1) console.log(`预测类别: ${argmax(p)}`);
}

function runSelfTest(): void {
    console.log("=== 内置自检 ===");
    const c = Matrix.fromArray([[1, 2], [3, 4]]).mul(Matrix.fromArray([[5, 6], [7, 8]]));
    console.log(`矩阵乘法: [[1,2],[3,4]]*[[5,6],[7,8]]=[[${c.get(0, 0)},${c.get(0, 1)}],[${c.get(1, 0)},${c.get(1, 1)}]] (期望 [[19,22],[43,50]])`);
    const s = Activations.sigmoid(Matrix.fromArray([[0]]));
    console.log(`sigmoid(0) = ${s.get(0, 0).toFixed(4)} (期望 0.5)`);
    const net = new NeuralNetwork({
        inputSize: 2, hidden: [4], outputSize: 1,
        hiddenActivation: "tanh", outputActivation: "sigmoid",
        loss: "mse", learningRate: 0.5,
    });
    net.fit(XOR_DATA.inputs, XOR_DATA.targets, 1500, 4, false);
    let ok = 0;
    for (let i = 0; i < 4; i++) {
        const p = net.predict(XOR_DATA.inputs[i]);
        const want = XOR_DATA.targets[i][0];
        const got = p[0] > 0.5 ? 1 : 0;
        if (got === want) ok++;
        console.log(`  XOR(${XOR_DATA.inputs[i]}) -> ${p[0].toFixed(3)} (期望 ${want})`);
    }
    console.log(`XOR 正确: ${ok}/4 ${ok === 4 ? "PASS" : "FAIL"}`);
    const json = net.serialize();
    const diff = Math.abs(net.predict([1, 1])[0] - NeuralNetwork.deserialize(json).predict([1, 1])[0]);
    console.log(`序列化往返误差: ${diff.toFixed(8)} ${diff < 1e-9 ? "PASS" : "FAIL"}`);
    console.log(`模型摘要: ${crypto.createHash("sha256").update(json).digest("hex").substring(0, 16)}`);
}

function main(): void {
    const opts = parseArgs(process.argv);
    switch (opts.command) {
        case "xor": runXorDemo(opts.epochs, opts.lr); break;
        case "classify": runClassifyDemo(opts.epochs, opts.lr, opts.outFile); break;
        case "train": trainFromData(opts.dataFile, opts.epochs, opts.lr, opts.outFile); break;
        case "predict": predictModel(opts.modelFile, opts.inputVec); break;
        case "test": runSelfTest(); break;
        default: console.error(`未知命令: ${opts.command}`); printHelp(); process.exit(1);
    }
}

main();
