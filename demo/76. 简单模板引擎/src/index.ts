#!/usr/bin/env node
/**
 * 简单模板引擎 (Template Engine)
 * -------------------------------------------------------------
 * 支持：
 *   - 变量插值 {{expression}} （自动 HTML 转义）
 *   - 原始输出 {{{raw}}}
 *   - 嵌套对象访问 {{user.name}}
 *   - 过滤器 {{value | filter}} / {{value | filter:arg1:arg2}}
 *   - 条件 {{#if cond}}...{{else}}...{{/if}}
 *   - 循环 {{#each items}}...{{/each}} (内部可用 {{this}} / {{@index}} / {{@key}})
 *   - partial {{> partialName}}
 *   - helper {{helperName arg1 arg2}}
 *   - 注释 {{!-- comment --}}
 *
 * 公开 API:
 *   class TemplateEngine
 *     registerHelper(name, fn)
 *     registerPartial(name, template)
 *     registerFilter(name, fn)
 *     compile(template) -> (data) => string
 *     render(template, data) -> string
 *
 * 仅依赖 Node.js 内置模块: fs, path.
 */

import fs from 'fs';
import path from 'path';

export type HelperFn = (...args: unknown[]) => string;
export type FilterFn = (value: unknown, ...args: unknown[]) => unknown;

/** AST 节点 */
type Node =
  | { type: 'text'; value: string }
  | { type: 'expr'; expr: string; raw: boolean }
  | { type: 'if'; cond: string; then: Node[]; els: Node[] | null }
  | { type: 'each'; expr: string; body: Node[] }
  | { type: 'partial'; name: string }
  | { type: 'helper'; name: string; args: string[] };

interface EvalContext {
  data: Record<string, unknown>;
  helpers: Map<string, HelperFn>;
  filters: Map<string, FilterFn>;
  partials: Map<string, Node[]>;
}

/** HTML 转义 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 解析路径访问 */
function resolvePath(expr: string, data: Record<string, unknown>): unknown {
  expr = expr.trim();
  if (expr === 'this') return data['this'];
  if (expr === '.') return data['this'];
  if (expr.startsWith('@')) return data[expr];
  const parts = expr.split('.');
  let cur: unknown = data;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** 评估表达式为布尔 */
function evalBool(expr: string, ctx: EvalContext): boolean {
  expr = expr.trim();
  // 处理比较 a == b / != / > <
  const cmpMatch = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (cmpMatch) {
    const left = resolveValue(cmpMatch[1].trim(), ctx);
    const right = resolveValue(cmpMatch[3].trim(), ctx);
    const op = cmpMatch[2];
    switch (op) {
      case '==': return left == right; // eslint-disable-line eqeqeq
      case '!=': return left != right; // eslint-disable-line eqeqeq
      case '>': return Number(left) > Number(right);
      case '<': return Number(left) < Number(right);
      case '>=': return Number(left) >= Number(right);
      case '<=': return Number(left) <= Number(right);
    }
  }
  const v = resolveValue(expr, ctx);
  return !!v && !((Array.isArray(v) && v.length === 0));
}

/** 解析单个值（字面量或路径） */
function resolveValue(expr: string, ctx: EvalContext): unknown {
  expr = expr.trim();
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  if (expr === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr.slice(1, -1);
  }
  return resolvePath(expr, ctx.data);
}

/** 词法分析 */
function tokenize(src: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  let buf = '';
  while (i < src.length) {
    // 注释 {{!-- ... --}}
    if (src.startsWith('{{!--', i)) {
      if (buf) {
        nodes.push({ type: 'text', value: buf });
        buf = '';
      }
      const end = src.indexOf('--}}', i + 5);
      i = end === -1 ? src.length : end + 5;
      continue;
    }
    // 原始输出 {{{ }}}
    if (src.startsWith('{{{', i)) {
      if (buf) {
        nodes.push({ type: 'text', value: buf });
        buf = '';
      }
      const end = src.indexOf('}}}', i + 3);
      const expr = src.slice(i + 3, end === -1 ? undefined : end).trim();
      nodes.push({ type: 'expr', expr, raw: true });
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    // 普通 {{ }}
    if (src.startsWith('{{', i)) {
      if (buf) {
        nodes.push({ type: 'text', value: buf });
        buf = '';
      }
      const end = src.indexOf('}}', i + 2);
      const content = src.slice(i + 2, end === -1 ? undefined : end).trim();
      i = end === -1 ? src.length : end + 2;
      if (content.startsWith('#if')) {
        nodes.push({ type: 'if', cond: content.slice(3).trim(), then: [], els: null });
      } else if (content.startsWith('#each')) {
        nodes.push({ type: 'each', expr: content.slice(5).trim(), body: [] });
      } else if (content.startsWith('>')) {
        nodes.push({ type: 'partial', name: content.slice(1).trim() });
      } else {
        // helper: name arg1 arg2
        const parts = content.split(/\s+/);
        if (parts.length > 1 && /^[a-zA-Z_][\w]*$/.test(parts[0]) && !content.includes('|')) {
          nodes.push({ type: 'helper', name: parts[0], args: parts.slice(1) });
        } else {
          nodes.push({ type: 'expr', expr: content, raw: false });
        }
      }
      continue;
    }
    buf += src[i];
    i++;
  }
  if (buf) nodes.push({ type: 'text', value: buf });
  return nodes;
}

/** 构建 AST（处理 if/each 嵌套与 else） */
function buildTree(tokens: Node[]): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  let currentIfNode: (Node & { type: 'if' }) | null = null;
  for (const tok of tokens) {
    if (tok.type === 'if') {
      const node = tok as Node & { type: 'if' };
      stack[stack.length - 1].push(node);
      stack.push(node.then);
      currentIfNode = node;
    } else if (tok.type === 'each') {
      const node = tok as Node & { type: 'each' };
      stack[stack.length - 1].push(node);
      stack.push(node.body);
      currentIfNode = null;
    } else if (tok.type === 'text' && tok.value.trim() === '{{else}}') {
      // else 分支
      if (currentIfNode) {
        stack.pop();
        currentIfNode.els = [];
        stack.push(currentIfNode.els);
      }
    } else if (tok.type === 'text' && (tok.value.trim() === '{{/if}}' || tok.value.trim() === '{{/each}}')) {
      stack.pop();
      currentIfNode = null;
    } else {
      // 处理 text 中可能包含的 else/end（当词法被合并到 text）
      const t = tok as { type: 'text'; value: string };
      if (tok.type === 'text') {
        let value = tok.value;
        // 上面词法分析已分离 {{}}，但 else/end 可能被当 text 处理不到，已单独分支
        stack[stack.length - 1].push({ type: 'text', value });
      } else {
        stack[stack.length - 1].push(tok);
      }
    }
  }
  return root;
}

/** 渲染 AST */
function renderNodes(nodes: Node[], ctx: EvalContext): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value;
        break;
      case 'expr': {
        let val = resolvePath(node.expr, ctx.data);
        // 过滤器 {{value | filter:arg}}
        if (node.expr.includes('|')) {
          const [pathPart, ...filterParts] = node.expr.split('|').map((s) => s.trim());
          val = resolvePath(pathPart, ctx.data);
          for (const fp of filterParts) {
            const [fname, ...args] = fp.split(':').map((s) => s.trim());
            const fn = ctx.filters.get(fname);
            if (fn) val = fn(val, ...args.map((a) => resolveValue(a, ctx)));
          }
        }
        if (val === null || val === undefined) val = '';
        out += node.raw ? String(val) : escapeHtml(String(val));
        break;
      }
      case 'if': {
        if (evalBool(node.cond, ctx)) {
          out += renderNodes(node.then, ctx);
        } else if (node.els) {
          out += renderNodes(node.els, ctx);
        }
        break;
      }
      case 'each': {
        const arr = resolvePath(node.expr, ctx.data);
        if (Array.isArray(arr)) {
          arr.forEach((item, idx) => {
            const childData = { ...ctx.data, this: item, '@index': idx };
            out += renderNodes(node.body, { ...ctx, data: childData });
          });
        } else if (arr && typeof arr === 'object') {
          for (const [k, v] of Object.entries(arr)) {
            const childData = { ...ctx.data, this: v, '@key': k };
            out += renderNodes(node.body, { ...ctx, data: childData });
          }
        }
        break;
      }
      case 'partial': {
        const p = ctx.partials.get(node.name);
        if (p) out += renderNodes(p, ctx);
        break;
      }
      case 'helper': {
        const fn = ctx.helpers.get(node.name);
        if (fn) {
          const args = node.args.map((a) => resolveValue(a, ctx));
          out += escapeHtml(fn(...args));
        }
        break;
      }
    }
  }
  return out;
}

/** 模板引擎类 */
export class TemplateEngine {
  private helpers = new Map<string, HelperFn>();
  private filters = new Map<string, FilterFn>();
  private partials = new Map<string, Node[]>();

  constructor() {
    // 内置过滤器
    this.registerFilter('upper', (v) => String(v).toUpperCase());
    this.registerFilter('lower', (v) => String(v).toLowerCase());
    this.registerFilter('trim', (v) => String(v).trim());
    this.registerFilter('length', (v) => (Array.isArray(v) ? v.length : String(v).length));
    this.registerFilter('default', (v, d) => (v === null || v === undefined || v === '' ? d : v));
    this.registerFilter('json', (v) => JSON.stringify(v));
    this.registerFilter('reverse', (v) => String(v).split('').reverse().join(''));
    // 内置 helper
    this.registerHelper('upper', (s) => String(s).toUpperCase());
    this.registerHelper('concat', (...args) => args.map(String).join(''));
    this.registerHelper('ifEqual', (a, b) => (a == b ? 'true' : 'false')); // eslint-disable-line eqeqeq
  }

  registerHelper(name: string, fn: HelperFn): this {
    this.helpers.set(name, fn);
    return this;
  }
  registerFilter(name: string, fn: FilterFn): this {
    this.filters.set(name, fn);
    return this;
  }
  registerPartial(name: string, template: string): this {
    this.partials.set(name, buildTree(tokenize(template)));
    return this;
  }

  compile(template: string): (data: Record<string, unknown>) => string {
    const ast = buildTree(tokenize(template));
    const ctx: EvalContext = {
      data: {},
      helpers: this.helpers,
      filters: this.filters,
      partials: this.partials,
    };
    return (data) => {
      return renderNodes(ast, { ...ctx, data });
    };
  }

  render(template: string, data: Record<string, unknown>): string {
    return this.compile(template)(data);
  }
}

// ===================== CLI 演示 =====================

function showExamples(): void {
  console.log('===== 模板引擎示例 =====\n');
  const engine = new TemplateEngine();
  engine.registerPartial('greeting', '你好, {{name}}!');
  engine.registerHelper('repeat', (s: unknown, n: unknown) => String(s).repeat(Number(n)));

  const tpl = `{{!-- 这是一个注释，不会输出 --}}
{{greeting name=name}} <{{email}}>
{{{rawHtml}}}

过滤: {{name | upper}} | {{name | reverse}}
默认: {{missing | default:"N/A"}}

{{#if items.length}}
项目列表:
{{#each items}}
  [{{@index}}] {{this.name}} - {{this.price}} 元
{{/each}}
{{else}}
没有项目
{{/if}}

{{#if user.isAdmin}}
管理员模式
{{else}}
普通用户模式
{{/if}}

重复: {{repeat "ab" 3}}

> partial: {{> greeting}}
`;

  const data = {
    name: '<script>x</script>张三',
    email: 'zhangsan@test.com',
    rawHtml: '<b>原始 HTML</b>',
    missing: '',
    items: [
      { name: '苹果', price: 5 },
      { name: '香蕉', price: 3 },
      { name: '橙子', price: 4 },
    ],
    user: { isAdmin: true },
  };
  console.log('--- 模板 ---');
  console.log(tpl);
  console.log('--- 渲染结果 ---');
  console.log(engine.render(tpl, data));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'render': {
      const tpl = process.argv[3];
      const jsonFile = process.argv[4];
      if (!tpl || !jsonFile) {
        console.log('用法: render <模板文件或字符串> <data.json>');
        return;
      }
      const engine = new TemplateEngine();
      let templateStr = tpl;
      if (fs.existsSync(tpl)) {
        templateStr = fs.readFileSync(tpl, 'utf8');
      }
      const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      console.log(engine.render(templateStr, data));
      break;
    }
    case 'compile': {
      const tpl = process.argv[3];
      const oFlag = process.argv.indexOf('-o');
      if (!tpl) {
        console.log('用法: compile <模板文件> [-o outfile]');
        return;
      }
      const engine = new TemplateEngine();
      const src = fs.readFileSync(tpl, 'utf8');
      const fn = engine.compile(src);
      // 预编译为字符串形式的可序列化函数（这里简单输出函数体说明）
      const outPath = oFlag >= 0 ? process.argv[oFlag + 1] : 'compiled.js';
      const code = `// 预编译模板，由简单模板引擎生成
// 使用: const fn = require('./compiled.js'); fn(data);
module.exports = ${fn.toString()};\n`;
      fs.writeFileSync(outPath, code, 'utf8');
      console.log(`已预编译并输出到 ${outPath}`);
      break;
    }
    case 'examples':
      showExamples();
      break;
    default:
      console.log(`
简单模板引擎 - 命令行演示

用法:
  render <模板文件或字符串> <data.json>   渲染模板
  compile <模板文件> [-o outfile]         预编译模板为函数
  examples                                展示示例

示例:
  examples
  render ./tpl.txt ./data.json
  compile ./tpl.txt -o compiled.js
`);
  }
}

main();
