#!/usr/bin/env node
/**
 * 简易神经网络 (Simple Neural Network) - Enhanced Edition
 * 纯 TypeScript 从零实现的前馈神经网络，含矩阵运算/抽象激活类体系/反向传播/
 * 小批量训练/判别联合训练结果/自定义错误/Symbol 唯一键/生成器迭代/XOR 演示。
 * 仅使用 Node.js 内置模块（fs, path, crypto）。
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ====================== 字符串枚举 ======================
enum ActivationType {
  Sigmoid = "sigmoid",
  Tanh = "tanh",
  Relu = "relu",
  Softmax = "softmax",
  Linear = "linear",
}
enum ErrorCode {
  DimMismatch = "DIM_MISMATCH",
  InvalidInput = "INVALID_INPUT",
  ParseError = "PARSE_ERROR",
  FileNotFound = "FILE_NOT_FOUND",
  Converged = "CONVERGED",
  MaxEpochs = "MAX_EPOCHS",
}
enum LayerType {
  Input = "INPUT",
  Hidden = "HIDDEN",
  Output = "OUTPUT",
}
enum NetworkState {
  Untrained = "UNTRAINED",
  Training = "TRAINING",
  Trained = "TRAINED",
  Converged = "CONVERGED",
}
enum TrainingPhase {
  Forward = "FORWARD",
  Backward = "BACKWARD",
  Update = "UPDATE",
  EpochEnd = "EPOCH_END",
}
type LossName = "mse" | "crossEntropy";

// ====================== 自定义错误层次 ======================
class NNError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "NNError";
    this.code = code;
  }
}
class DimensionError extends NNError {
  constructor(message: string) {
    super(ErrorCode.DimMismatch, message);
    this.name = "DimensionError";
  }
}
class ParseError extends NNError {
  constructor(message: string) {
    super(ErrorCode.ParseError, message);
    this.name = "ParseError";
  }
}

// ====================== 判别联合：训练结果 + 类型守卫 ======================
interface TrainSuccess {
  readonly kind: "success";
  readonly epoch: number;
  readonly loss: number;
  readonly phase: TrainingPhase;
}
interface TrainError {
  readonly kind: "error";
  readonly code: ErrorCode;
  readonly message: string;
  readonly epoch: number;
}
interface TrainConverged {
  readonly kind: "converged";
  readonly epoch: number;
  readonly finalLoss: number;
}
type TrainResult = TrainSuccess | TrainError | TrainConverged;

function isTrainSuccess(r: TrainResult): r is TrainSuccess {
  return r.kind === "success";
}
function isTrainError(r: TrainResult): r is TrainError {
  return r.kind === "error";
}
function isTrainConverged(r: TrainResult): r is TrainConverged {
  return r.kind === "converged";
}

// ====================== 映射类型 ======================
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function withLearningRate(
  config: NetworkConfig,
  lr: number,
): Mutable<NetworkConfig> {
  const m: Mutable<NetworkConfig> = { ...config, hidden: [...config.hidden] };
  m.learningRate = lr;
  return m;
}

// ====================== Symbol 唯一键 ======================
const MODEL_ID = Symbol("modelId");
const TRAINING_TRACE = Symbol("trainingTrace");

// ====================== Matrix ======================
class Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
  constructor(rows: number, cols: number, fill = 0) {
    this.rows = rows;
    this.cols = cols;
    this.data = new Float64Array(rows * cols).fill(fill);
  }
  static fromArray(arr: readonly (readonly number[])[]): Matrix {
    const r = arr.length;
    const c = r > 0 ? arr[0].length : 0;
    const m = new Matrix(r, c);
    for (let i = 0; i < r; i++)
      for (let j = 0; j < c; j++) m.data[i * c + j] = arr[i][j];
    return m;
  }
  static random(rows: number, cols: number, scale = 1): Matrix {
    const m = new Matrix(rows, cols);
    for (let i = 0; i < m.data.length; i++)
      m.data[i] = (Math.random() * 2 - 1) * scale;
    return m;
  }
  get(i: number, j: number): number {
    return this.data[i * this.cols + j];
  }
  set(i: number, j: number, v: number): void {
    this.data[i * this.cols + j] = v;
  }
  private assertSameShape(b: Matrix): void {
    if (this.rows !== b.rows || this.cols !== b.cols)
      throw new DimensionError(
        `矩阵形状不一致 ${this.rows}x${this.cols} vs ${b.rows}x${b.cols}`,
      );
  }
  add(b: Matrix): Matrix {
    this.assertSameShape(b);
    const out = new Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++)
      out.data[i] = this.data[i] + b.data[i];
    return out;
  }
  sub(b: Matrix): Matrix {
    this.assertSameShape(b);
    const out = new Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++)
      out.data[i] = this.data[i] - b.data[i];
    return out;
  }
  mul(b: Matrix): Matrix {
    if (this.cols !== b.rows)
      throw new DimensionError(
        `矩阵维度不匹配 ${this.rows}x${this.cols} * ${b.rows}x${b.cols}`,
      );
    const out = new Matrix(this.rows, b.cols);
    for (let i = 0; i < this.rows; i++)
      for (let k = 0; k < this.cols; k++) {
        const a = this.data[i * this.cols + k];
        if (a === 0) continue;
        for (let j = 0; j < b.cols; j++)
          out.data[i * b.cols + j] += a * b.data[k * b.cols + j];
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
    for (let i = 0; i < this.data.length; i++)
      out.data[i] = fn(this.data[i], i);
    return out;
  }
  scale(s: number): Matrix {
    return this.map((v) => v * s);
  }
  /** 生成器：逐元素迭代 [行, 列, 值] */
  *entries(): Generator<[number, number, number]> {
    for (let i = 0; i < this.rows; i++)
      for (let j = 0; j < this.cols; j++) yield [i, j, this.get(i, j)];
  }
  /** 生成器：按行迭代 */
  *iterRows(): Generator<number[]> {
    for (let i = 0; i < this.rows; i++) {
      const r: number[] = [];
      for (let j = 0; j < this.cols; j++) r.push(this.get(i, j));
      yield r;
    }
  }
  /** 使 Matrix 可被 for...of 直接迭代所有元素 */
  *[Symbol.iterator](): Generator<number> {
    for (let i = 0; i < this.data.length; i++) yield this.data[i];
  }
}

// ====================== 抽象激活函数类体系 ======================
abstract class AbstractActivation {
  abstract readonly type: ActivationType;
  abstract forward(x: Matrix): Matrix;
  abstract derivative(a: Matrix): Matrix;
  toString(): string {
    return `Activation(${this.type})`;
  }
}
class SigmoidActivation extends AbstractActivation {
  readonly type = ActivationType.Sigmoid;
  forward(x: Matrix): Matrix {
    return x.map((v) => 1 / (1 + Math.exp(-v)));
  }
  derivative(a: Matrix): Matrix {
    return a.map((v) => v * (1 - v));
  }
}
class TanhActivation extends AbstractActivation {
  readonly type = ActivationType.Tanh;
  forward(x: Matrix): Matrix {
    return x.map((v) => Math.tanh(v));
  }
  derivative(a: Matrix): Matrix {
    return a.map((v) => 1 - v * v);
  }
}
class ReluActivation extends AbstractActivation {
  readonly type = ActivationType.Relu;
  forward(x: Matrix): Matrix {
    return x.map((v) => (v > 0 ? v : 0));
  }
  derivative(a: Matrix): Matrix {
    return a.map((v) => (v > 0 ? 1 : 0));
  }
}
class SoftmaxActivation extends AbstractActivation {
  readonly type = ActivationType.Softmax;
  forward(x: Matrix): Matrix {
    const out = new Matrix(x.rows, x.cols);
    for (let i = 0; i < x.rows; i++) {
      let max = -Infinity;
      for (let j = 0; j < x.cols; j++) max = Math.max(max, x.get(i, j));
      let sum = 0;
      for (let j = 0; j < x.cols; j++) {
        const e = Math.exp(x.get(i, j) - max);
        out.set(i, j, e);
        sum += e;
      }
      for (let j = 0; j < x.cols; j++) out.set(i, j, out.get(i, j) / sum);
    }
    return out;
  }
  // 与交叉熵配合，delta 计算时直接使用 a - y
  derivative(a: Matrix): Matrix {
    return a.map(() => 1);
  }
}
class LinearActivation extends AbstractActivation {
  readonly type = ActivationType.Linear;
  forward(x: Matrix): Matrix {
    return x.map((v) => v);
  }
  derivative(a: Matrix): Matrix {
    return a.map(() => 1);
  }
}
const ACTIVATION_REGISTRY = {
  [ActivationType.Sigmoid]: () => new SigmoidActivation(),
  [ActivationType.Tanh]: () => new TanhActivation(),
  [ActivationType.Relu]: () => new ReluActivation(),
  [ActivationType.Softmax]: () => new SoftmaxActivation(),
  [ActivationType.Linear]: () => new LinearActivation(),
} satisfies Record<ActivationType, () => AbstractActivation>;
function makeActivation(t: ActivationType): AbstractActivation {
  const f = ACTIVATION_REGISTRY[t];
  if (!f)
    throw new NNError(ErrorCode.InvalidInput, `未知激活类型: ${t as string}`);
  return f();
}

// ====================== 接口（可选/只读/索引签名） ======================
interface LayerMeta {
  readonly index: number;
  name?: string;
  [key: string]: string | number | undefined;
}
interface LayerSnapshot {
  readonly weights: readonly number[];
  readonly rows: number;
  readonly cols: number;
  readonly activation: ActivationType;
  readonly layerType: LayerType;
}
interface NetworkConfig {
  readonly inputSize: number;
  readonly hidden: readonly number[];
  readonly outputSize: number;
  readonly hiddenActivation: ActivationType;
  readonly outputActivation: ActivationType;
  readonly loss: LossName;
  readonly learningRate: number;
  readonly convergeThreshold?: number;
  readonly shuffle?: boolean;
}

// ====================== 泛型全连接层 ======================
class Layer<T extends number> {
  readonly neuronCount: T;
  readonly layerType: LayerType;
  weights: Matrix;
  activation: AbstractActivation;
  lastInput?: Matrix;
  lastZ?: Matrix;
  lastA?: Matrix;
  readonly meta: LayerMeta;
  constructor(
    neuronCount: T,
    layerType: LayerType,
    weights: Matrix,
    activation: AbstractActivation,
    index: number,
  ) {
    this.neuronCount = neuronCount;
    this.layerType = layerType;
    this.weights = weights;
    this.activation = activation;
    this.meta = { index };
  }
  get inputSize(): number {
    return this.weights.rows - 1;
  }
  get weightCols(): number {
    return this.weights.cols;
  }
  get activationType(): ActivationType {
    return this.activation.type;
  }
  setWeights(w: Matrix): void {
    if (w.rows !== this.weights.rows || w.cols !== this.weights.cols)
      throw new DimensionError(`权重形状不匹配 ${w.rows}x${w.cols}`);
    this.weights = w;
  }
  setActivation(t: ActivationType): void {
    this.activation = makeActivation(t);
  }
  snapshot(): LayerSnapshot {
    return {
      weights: Array.from(this.weights.data),
      rows: this.weights.rows,
      cols: this.weights.cols,
      activation: this.activation.type,
      layerType: this.layerType,
    };
  }
  /** 生成器：逐神经元迭代（每神经元的权重列） */
  *neurons(): Generator<{
    readonly index: number;
    readonly weights: number[];
  }> {
    for (let j = 0; j < this.weights.cols; j++) {
      const w: number[] = [];
      for (let i = 0; i < this.weights.rows; i++)
        w.push(this.weights.get(i, j));
      yield { index: j, weights: w };
    }
  }
}

// ====================== 损失函数 / 工具 ======================
function computeLoss(name: LossName, pred: Matrix, target: Matrix): number {
  let sum = 0;
  for (let i = 0; i < pred.data.length; i++) {
    const p = pred.data[i],
      t = target.data[i];
    if (name === "mse") sum += (p - t) * (p - t);
    else sum += -(t * Math.log(p + 1e-12) + (1 - t) * Math.log(1 - p + 1e-12));
  }
  return sum / pred.rows;
}
function argmax(arr: readonly number[]): number {
  let bi = 0,
    bv = -Infinity;
  for (let i = 0; i < arr.length; i++)
    if (arr[i] > bv) {
      bv = arr[i];
      bi = i;
    }
  return bi;
}

// ====================== 神经网络 ======================
class NeuralNetwork {
  readonly layers: Layer<number>[] = [];
  private _config: NetworkConfig;
  private _state: NetworkState = NetworkState.Untrained;
  private _epoch = 0;
  private _learningRate: number;
  [MODEL_ID]: string;
  [TRAINING_TRACE]: TrainResult[] = [];
  constructor(config: NetworkConfig) {
    this._config = config;
    this._learningRate = config.learningRate;
    this[MODEL_ID] = crypto.randomUUID();
    this.build();
  }
  private build(): void {
    const sizes = [
      this._config.inputSize,
      ...this._config.hidden,
      this._config.outputSize,
    ];
    for (let i = 0; i < sizes.length - 1; i++) {
      const inSize = sizes[i] + 1; // +1 偏置
      const outSize = sizes[i + 1];
      const scale = Math.sqrt(2 / inSize); // He/Xavier 初始化
      const w = Matrix.random(inSize, outSize, scale);
      const isOutput = i === sizes.length - 2;
      const actType = isOutput
        ? this._config.outputActivation
        : this._config.hiddenActivation;
      const lt =
        i === 0
          ? LayerType.Input
          : isOutput
            ? LayerType.Output
            : LayerType.Hidden;
      this.layers.push(
        new Layer<number>(outSize, lt, w, makeActivation(actType), i),
      );
    }
  }
  get config(): NetworkConfig {
    return this._config;
  }
  get state(): NetworkState {
    return this._state;
  }
  get epoch(): number {
    return this._epoch;
  }
  get learningRate(): number {
    return this._learningRate;
  }
  set learningRate(v: number) {
    if (v <= 0) throw new NNError(ErrorCode.InvalidInput, "学习率必须为正数");
    this._learningRate = v;
  }
  setState(s: NetworkState): void {
    this._state = s;
  }
  /** 前向传播，返回输出层激活 */
  forward(x: Matrix): Matrix {
    let a = x;
    for (const layer of this.layers) {
      const biased = new Matrix(a.rows, a.cols + 1);
      for (let i = 0; i < a.rows; i++) {
        for (let j = 0; j < a.cols; j++) biased.set(i, j, a.get(i, j));
        biased.set(i, a.cols, 1); // 偏置
      }
      const z = biased.mul(layer.weights);
      const aNext = layer.activation.forward(z);
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
    const loss = computeLoss(this._config.loss, pred, y);
    let delta: Matrix;
    const last = this.layers[this.layers.length - 1];
    if (
      last.activationType === ActivationType.Softmax &&
      this._config.loss === "crossEntropy"
    ) {
      delta = pred.sub(y); // softmax + 交叉熵的简化梯度
    } else {
      const dAct = last.activation.derivative(last.lastA!);
      const dLoss =
        this._config.loss === "mse"
          ? pred.sub(y).scale(2 / y.cols)
          : pred.sub(y);
      delta = new Matrix(dLoss.rows, dLoss.cols);
      for (let i = 0; i < delta.data.length; i++)
        delta.data[i] = dLoss.data[i] * dAct.data[i];
    }
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const layer = this.layers[l];
      const input = layer.lastInput!;
      const grad = input
        .transpose()
        .mul(delta)
        .scale(this._learningRate / x.rows);
      layer.weights = layer.weights.sub(grad);
      if (l > 0) {
        const wNoBias = new Matrix(layer.weights.rows - 1, layer.weights.cols);
        for (let i = 0; i < wNoBias.rows; i++)
          for (let j = 0; j < wNoBias.cols; j++)
            wNoBias.set(i, j, layer.weights.get(i, j));
        const prevA = this.layers[l - 1].lastA!;
        const dPrev = delta.mul(wNoBias.transpose());
        const dAct = this.layers[l - 1].activation.derivative(prevA);
        delta = new Matrix(dPrev.rows, dPrev.cols);
        for (let i = 0; i < delta.data.length; i++)
          delta.data[i] = dPrev.data[i] * dAct.data[i];
      }
    }
    return loss;
  }
  /** 训练多个 epoch，支持小批量与可选收敛阈值 */
  fit(
    inputs: readonly (readonly number[])[],
    targets: readonly (readonly number[])[],
    epochs: number,
    batchSize: number,
    verbose = true,
    convergeThreshold = 0,
  ): number[] {
    const x = Matrix.fromArray(inputs);
    const y = Matrix.fromArray(targets);
    const losses: number[] = [];
    const n = x.rows;
    this._state = NetworkState.Training;
    for (let e = 0; e < epochs; e++) {
      this._epoch = e + 1;
      const order = Array.from({ length: n }, (_, i) => i);
      if (this._config.shuffle !== false) {
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
      let epochLoss = 0,
        batches = 0;
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
      this[TRAINING_TRACE].push({
        kind: "success",
        epoch: e + 1,
        loss: avg,
        phase: TrainingPhase.EpochEnd,
      });
      if (verbose && (e < 5 || e % Math.max(1, Math.floor(epochs / 10)) === 0))
        console.log(`  epoch ${e + 1}/${epochs}  loss=${avg.toFixed(6)}`);
      if (convergeThreshold > 0 && avg < convergeThreshold) {
        this._state = NetworkState.Converged;
        this[TRAINING_TRACE].push({
          kind: "converged",
          epoch: e + 1,
          finalLoss: avg,
        });
        if (verbose)
          console.log(`  收敛于 epoch ${e + 1} (loss=${avg.toFixed(6)})`);
        break;
      }
    }
    if (this._state === NetworkState.Training)
      this._state = NetworkState.Trained;
    return losses;
  }
  predict(input: readonly number[]): number[] {
    const out = this.forward(Matrix.fromArray([input]));
    const arr: number[] = [];
    for (let j = 0; j < out.cols; j++) arr.push(out.get(0, j));
    return arr;
  }
  /** 生成器：层迭代 */
  *iterLayers(): Generator<Layer<number>> {
    for (const l of this.layers) yield l;
  }
  /** 生成器：所有层的所有神经元迭代 */
  *iterNeurons(): Generator<{
    layer: number;
    neuron: number;
    weights: number[];
  }> {
    for (let li = 0; li < this.layers.length; li++)
      for (const n of this.layers[li].neurons())
        yield { layer: li, neuron: n.index, weights: n.weights };
  }
  summary(): string {
    const parts: string[] = [
      `Network[id=${this[MODEL_ID].substring(0, 8)}] state=${this._state} epoch=${this._epoch}`,
    ];
    for (const l of this.iterLayers())
      parts.push(
        `  ${l.layerType.padEnd(7)} ${l.activationType.padEnd(8)} in=${l.inputSize} out=${l.weightCols}`,
      );
    return parts.join("\n");
  }
  serialize(): string {
    return JSON.stringify({
      modelId: this[MODEL_ID],
      config: this._config,
      layers: this.layers.map((l) => l.snapshot()),
    });
  }
  static deserialize(json: string): NeuralNetwork {
    let obj: {
      config: NetworkConfig;
      layers: LayerSnapshot[];
      modelId?: string;
    };
    try {
      obj = JSON.parse(json) as {
        config: NetworkConfig;
        layers: LayerSnapshot[];
        modelId?: string;
      };
    } catch {
      throw new ParseError("模型 JSON 解析失败");
    }
    const net = new NeuralNetwork(obj.config);
    if (obj.modelId) net[MODEL_ID] = obj.modelId;
    for (let i = 0; i < net.layers.length; i++) {
      const snap = obj.layers[i];
      const w = new Matrix(snap.rows, snap.cols);
      for (let k = 0; k < w.data.length; k++) w.data[k] = snap.weights[k];
      net.layers[i].setWeights(w);
      net.layers[i].setActivation(snap.activation);
    }
    return net;
  }
}

// ====================== 函数重载 / 工具 ======================
function formatResult(r: TrainSuccess): string;
function formatResult(r: TrainError): string;
function formatResult(r: TrainConverged): string;
function formatResult(r: TrainResult): string;
function formatResult(r: TrainResult): string {
  switch (r.kind) {
    case "success":
      return `[epoch ${r.epoch}] loss=${r.loss.toFixed(6)} (${r.phase})`;
    case "error":
      return `[epoch ${r.epoch}] ERROR(${r.code}): ${r.message}`;
    case "converged":
      return `[epoch ${r.epoch}] converged finalLoss=${r.finalLoss.toFixed(6)}`;
  }
}
function summarizeTrace(trace: readonly TrainResult[]): {
  successes: number;
  errors: number;
  converged: number;
} {
  let successes = 0,
    errors = 0,
    converged = 0;
  for (const r of trace) {
    if (isTrainSuccess(r)) successes++;
    else if (isTrainError(r)) errors++;
    else if (isTrainConverged(r)) converged++;
  }
  return { successes, errors, converged };
}

// ====================== 数据集 ======================
const XOR_DATA = {
  inputs: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  targets: [[0], [1], [1], [0]],
} as const;

/** 合成分类数据：3 类二维点 */
function generateClassData(): {
  inputs: number[][];
  targets: number[][];
  labels: readonly string[];
} {
  const inputs: number[][] = [];
  const targets: number[][] = [];
  const labels = ["A", "B", "C"] as const;
  const centers = [
    [1, 1],
    [5, 1],
    [3, 5],
  ] as const;
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

// ====================== CLI ======================
interface ParsedArgs {
  readonly command: string;
  readonly dataFile: string;
  readonly modelFile: string;
  readonly inputVec: readonly number[];
  readonly epochs: number;
  readonly lr: number;
  readonly outFile: string;
}
function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);
  let dataFile = "",
    modelFile = "",
    outFile = "";
  const inputVec: number[] = [];
  let epochs = 500,
    lr = 0.5;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case "-e":
      case "--epochs": {
        const v = parseInt(rest[++i] ?? "", 10);
        if (!isNaN(v)) epochs = v;
        break;
      }
      case "-l":
      case "--lr": {
        const v = parseFloat(rest[++i] ?? "");
        if (!isNaN(v)) lr = v;
        break;
      }
      case "-o":
      case "--out":
        outFile = rest[++i] ?? "";
        break;
      case "-i":
      case "--input": {
        const s = rest[++i] ?? "";
        s.split(",")
          .map((n) => parseFloat(n))
          .forEach((n) => {
            if (!isNaN(n)) inputVec.push(n);
          });
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
  console.log(`简易神经网络 (Simple Neural Network)
用法:
  xor [-e epochs] [-l lr]                       训练并测试 XOR 问题
  classify [-e epochs] [-l lr] [-o model.json]  训练合成 3 分类数据
  train <data.json> [-e epochs] [-l lr] [-o m]  用自定义数据训练
  predict <model.json> -i v1,v2,...             加载模型并预测
  test                                          运行内置自检（XOR 与矩阵）
示例: node dist/index.js xor -e 2000 -l 0.5`);
}

function runXorDemo(epochs: number, lr: number): void {
  console.log("=== XOR 训练 ===");
  const baseConfig: NetworkConfig = {
    inputSize: 2,
    hidden: [4],
    outputSize: 1,
    hiddenActivation: ActivationType.Tanh,
    outputActivation: ActivationType.Sigmoid,
    loss: "mse",
    learningRate: 0.5,
  };
  const net = new NeuralNetwork(withLearningRate(baseConfig, lr));
  net.fit(XOR_DATA.inputs, XOR_DATA.targets, epochs, 4, true);
  console.log("\n预测结果:");
  for (const inp of XOR_DATA.inputs) {
    const p = net.predict(inp);
    console.log(
      `  XOR(${inp[0]}, ${inp[1]}) = ${p[0].toFixed(4)} -> ${p[0] > 0.5 ? 1 : 0}`,
    );
  }
  console.log(net.summary());
  const t = summarizeTrace(net[TRAINING_TRACE]);
  console.log(
    `  trace: success=${t.successes} converged=${t.converged} errors=${t.errors}`,
  );
}

function runClassifyDemo(epochs: number, lr: number, outFile: string): void {
  console.log("=== 合成 3 分类训练 ===");
  const { inputs, targets, labels } = generateClassData();
  const net = new NeuralNetwork({
    inputSize: 2,
    hidden: [8, 6],
    outputSize: 3,
    hiddenActivation: ActivationType.Relu,
    outputActivation: ActivationType.Softmax,
    loss: "crossEntropy",
    learningRate: lr,
  });
  net.fit(inputs, targets, epochs, 16, true);
  let correct = 0;
  for (let i = 0; i < inputs.length; i++)
    if (argmax(net.predict(inputs[i])) === argmax(targets[i])) correct++;
  console.log(
    `\n训练集准确率: ${((correct / inputs.length) * 100).toFixed(1)}% (${correct}/${inputs.length})`,
  );
  console.log("抽样预测:");
  for (let i = 0; i < 5; i++) {
    const p = net.predict(inputs[i]);
    console.log(
      `  [${inputs[i].map((v) => v.toFixed(2))}] -> ${labels[argmax(p)]} (置信度 ${(Math.max(...p) * 100).toFixed(1)}%)`,
    );
  }
  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), net.serialize(), "utf-8");
    console.log(`模型已保存: ${outFile}`);
  }
}

function trainFromData(
  dataFile: string,
  epochs: number,
  lr: number,
  outFile: string,
): void {
  const abs = path.resolve(dataFile);
  if (!fs.existsSync(abs)) {
    console.error(`错误：数据文件不存在 ${dataFile}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf-8")) as {
    inputs: number[][];
    targets: number[][];
    hidden?: number[];
    hiddenActivation?: ActivationType;
    outputActivation?: ActivationType;
    loss?: LossName;
  };
  if (!raw.inputs || !raw.targets) {
    console.error("错误：数据需包含 inputs 与 targets");
    process.exit(1);
  }
  const inputSize = raw.inputs[0].length;
  const outputSize = raw.targets[0].length;
  const net = new NeuralNetwork({
    inputSize,
    hidden: raw.hidden ?? [8],
    outputSize,
    hiddenActivation: raw.hiddenActivation ?? ActivationType.Relu,
    outputActivation:
      raw.outputActivation ??
      (outputSize === 1 ? ActivationType.Sigmoid : ActivationType.Softmax),
    loss: raw.loss ?? (outputSize === 1 ? "mse" : "crossEntropy"),
    learningRate: lr,
  });
  net.fit(raw.inputs, raw.targets, epochs, 16, true);
  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), net.serialize(), "utf-8");
    console.log(`模型已保存: ${outFile}`);
  }
}

function predictModel(modelFile: string, input: readonly number[]): void {
  const abs = path.resolve(modelFile);
  if (!fs.existsSync(abs)) {
    console.error(`错误：模型不存在 ${modelFile}`);
    process.exit(1);
  }
  if (input.length === 0) {
    console.error("错误：缺少 -i 输入向量");
    process.exit(1);
  }
  const net = NeuralNetwork.deserialize(fs.readFileSync(abs, "utf-8"));
  const p = net.predict(input);
  console.log(`输入: [${input.join(", ")}]`);
  console.log(`输出: [${p.map((v) => v.toFixed(6)).join(", ")}]`);
  if (p.length > 1) console.log(`预测类别: ${argmax(p)}`);
  console.log(net.summary());
}

function runSelfTest(): void {
  console.log("=== 内置自检 ===");
  const c = Matrix.fromArray([
    [1, 2],
    [3, 4],
  ]).mul(
    Matrix.fromArray([
      [5, 6],
      [7, 8],
    ]),
  );
  console.log(
    `矩阵乘法: [[1,2],[3,4]]*[[5,6],[7,8]]=[[${c.get(0, 0)},${c.get(0, 1)}],[${c.get(1, 0)},${c.get(1, 1)}]] (期望 [[19,22],[43,50]])`,
  );
  // 演示 Matrix 可迭代（Symbol.iterator 生成器）
  let msum = 0;
  for (const v of Matrix.fromArray([
    [1, 2],
    [3, 4],
  ]))
    msum += v;
  console.log(`矩阵元素和 (迭代器): ${msum} (期望 10)`);
  // 演示 entries() 生成器
  let entryCount = 0;
  for (const _e of Matrix.fromArray([
    [1, 2],
    [3, 4],
  ]).entries())
    entryCount++;
  console.log(`矩阵 entries 计数: ${entryCount} (期望 4)`);
  // 演示抽象激活类
  const sigmoid = makeActivation(ActivationType.Sigmoid);
  const s = sigmoid.forward(Matrix.fromArray([[0]]));
  console.log(
    `sigmoid(0) = ${s.get(0, 0).toFixed(4)} (期望 0.5) [via ${sigmoid.toString()}]`,
  );
  const net = new NeuralNetwork({
    inputSize: 2,
    hidden: [4],
    outputSize: 1,
    hiddenActivation: ActivationType.Tanh,
    outputActivation: ActivationType.Sigmoid,
    loss: "mse",
    learningRate: 0.5,
  });
  net.fit(XOR_DATA.inputs, XOR_DATA.targets, 1500, 4, false);
  let ok = 0;
  for (let i = 0; i < 4; i++) {
    const p = net.predict(XOR_DATA.inputs[i]);
    const want = XOR_DATA.targets[i][0];
    const got = p[0] > 0.5 ? 1 : 0;
    if (got === want) ok++;
    console.log(
      `  XOR(${XOR_DATA.inputs[i][0]},${XOR_DATA.inputs[i][1]}) -> ${p[0].toFixed(3)} (期望 ${want})`,
    );
  }
  console.log(`XOR 正确: ${ok}/4 ${ok === 4 ? "PASS" : "FAIL"}`);
  // 演示神经元生成器
  let neuronCount = 0;
  for (const _n of net.iterNeurons()) neuronCount++;
  console.log(`网络神经元总数 (生成器): ${neuronCount}`);
  // 演示类型守卫 + 判别联合 + 函数重载
  const trace = net[TRAINING_TRACE];
  const summary = summarizeTrace(trace);
  const last = trace[trace.length - 1];
  console.log(
    `训练 trace: success=${summary.successes} converged=${summary.converged} errors=${summary.errors}`,
  );
  if (last) console.log(`  最后 trace: ${formatResult(last)}`);
  if (last && isTrainSuccess(last))
    console.log(
      `  (类型守卫确认 success: epoch=${last.epoch}, loss=${last.loss.toFixed(6)})`,
    );
  const json = net.serialize();
  const diff = Math.abs(
    net.predict([1, 1])[0] - NeuralNetwork.deserialize(json).predict([1, 1])[0],
  );
  console.log(
    `序列化往返误差: ${diff.toFixed(8)} ${diff < 1e-9 ? "PASS" : "FAIL"}`,
  );
  console.log(
    `模型摘要: ${crypto.createHash("sha256").update(json).digest("hex").substring(0, 16)}`,
  );
}

function main(): void {
  const opts = parseArgs(process.argv);
  switch (opts.command) {
    case "xor":
      runXorDemo(opts.epochs, opts.lr);
      break;
    case "classify":
      runClassifyDemo(opts.epochs, opts.lr, opts.outFile);
      break;
    case "train":
      trainFromData(opts.dataFile, opts.epochs, opts.lr, opts.outFile);
      break;
    case "predict":
      predictModel(opts.modelFile, opts.inputVec);
      break;
    case "test":
      runSelfTest();
      break;
    default:
      console.error(`未知命令: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main();
