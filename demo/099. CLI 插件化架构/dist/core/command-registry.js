"use strict";
/* ============================== 命令注册表 ============================== */
/*
 * 演示:
 *   - 泛型与约束 (generics with constraints)
 *   - 函数重载 (function overloads)
 *   - 生成器 / 迭代器 (generators / Iterable)
 *   - 元组与只读元组 (tuple / readonly tuple)
 *   - 判别联合 + 类型守卫
 *   - Getter
 *   - 自定义错误层次结构
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRegistry = void 0;
exports.isPluginResolveResult = isPluginResolveResult;
exports.isMissingResolveResult = isMissingResolveResult;
const types_1 = require("./types");
const errors_1 = require("./errors");
/**
 * 命令注册表
 * - 管理所有插件注册的命令
 * - 支持命令名称与别名查找
 * - 提供命令列表与帮助信息
 */
class CommandRegistry {
    constructor() {
        /** 命令名称 -> 命令定义 */
        this.commands = new Map();
        /** 别名 -> 命令名称 */
        this.aliases = new Map();
        /** 命令名称 -> 注册来源插件 */
        this.sources = new Map();
        /** 命令名称 -> 来源分类 (builtin / plugin) */
        this.kinds = new Map();
    }
    /* ---------------------------- Getters ---------------------------- */
    /** 已注册命令数量 (getter) */
    get count() {
        return this.commands.size;
    }
    /** 是否为空 (getter) */
    get empty() {
        return this.commands.size === 0;
    }
    /** register 实现 */
    register(command, pluginName, kind = types_1.CommandKind.Plugin) {
        // 检查命令名称是否已存在
        if (this.commands.has(command.name)) {
            const existingSource = this.sources.get(command.name) ?? 'unknown';
            throw new errors_1.CommandAlreadyRegisteredError(command.name, existingSource, pluginName);
        }
        // 检查别名是否冲突
        if (command.aliases) {
            for (const alias of command.aliases) {
                if (this.aliases.has(alias)) {
                    const existingCmd = this.aliases.get(alias);
                    throw new errors_1.CommandAliasConflictError(alias, existingCmd, command.name, pluginName);
                }
                this.aliases.set(alias, command.name);
            }
        }
        this.commands.set(command.name, command);
        this.sources.set(command.name, pluginName);
        this.kinds.set(command.name, kind);
    }
    /** 注销一条命令 */
    unregister(commandName) {
        const command = this.commands.get(commandName);
        if (!command)
            return false;
        if (command.aliases) {
            for (const alias of command.aliases) {
                this.aliases.delete(alias);
            }
        }
        this.commands.delete(commandName);
        this.sources.delete(commandName);
        this.kinds.delete(commandName);
        return true;
    }
    /** resolve 实现 */
    resolve(nameOrAlias, throwIfMissing) {
        const direct = this.commands.get(nameOrAlias);
        if (direct)
            return direct;
        const aliasTarget = this.aliases.get(nameOrAlias);
        if (aliasTarget)
            return this.commands.get(aliasTarget);
        if (throwIfMissing) {
            throw new errors_1.CommandNotFoundError(nameOrAlias);
        }
        return undefined;
    }
    /** 解析命令条目 (返回判别联合, 含来源分类) */
    resolveEntry(nameOrAlias) {
        const command = this.resolve(nameOrAlias);
        if (!command) {
            return { kind: 'missing', name: nameOrAlias };
        }
        const source = this.sources.get(command.name) ?? 'unknown';
        const kind = this.kinds.get(command.name) ?? types_1.CommandKind.Plugin;
        if (kind === types_1.CommandKind.Builtin) {
            return {
                kind: types_1.CommandKind.Builtin,
                entry: { kind: types_1.CommandKind.Builtin, command, source: 'builtin' },
            };
        }
        return {
            kind: types_1.CommandKind.Plugin,
            entry: { kind: types_1.CommandKind.Plugin, command, source },
        };
    }
    /* ---------------------------- 查询 ---------------------------- */
    /** 获取所有已注册命令 */
    getAll() {
        return Array.from(this.commands.values());
    }
    /** 获取命令的来源插件 */
    getSource(commandName) {
        return this.sources.get(commandName);
    }
    /** 获取命令来源分类 */
    getKind(commandName) {
        return this.kinds.get(commandName);
    }
    /** 判断命令是否存在 */
    has(nameOrAlias) {
        return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias);
    }
    /* ---------------------------- 生成器 / 迭代器 ---------------------------- */
    /** 实现 Iterable 协议: 迭代所有命令 */
    *[Symbol.iterator]() {
        for (const cmd of this.commands.values()) {
            yield cmd;
        }
    }
    /** 生成器: 迭代所有命令条目 (判别联合) */
    *entries() {
        for (const [name, command] of this.commands) {
            const source = this.sources.get(name) ?? 'unknown';
            const kind = this.kinds.get(name) ?? types_1.CommandKind.Plugin;
            if (kind === types_1.CommandKind.Builtin) {
                yield { kind: types_1.CommandKind.Builtin, command, source: 'builtin' };
            }
            else {
                yield { kind: types_1.CommandKind.Plugin, command, source };
            }
        }
    }
    /** 生成器: 迭代命令名 + 来源 (只读元组) */
    *sourcesEntries() {
        for (const [name, source] of this.sources) {
            yield [name, source];
        }
    }
    /** 生成器: 仅迭代 builtin 命令条目 (使用类型守卫) */
    *builtinEntries() {
        for (const entry of this.entries()) {
            if ((0, types_1.isBuiltinEntry)(entry)) {
                yield entry;
            }
        }
    }
    /** 生成器: 仅迭代 plugin 命令条目 (使用类型守卫) */
    *pluginEntries() {
        for (const entry of this.entries()) {
            if ((0, types_1.isPluginEntry)(entry)) {
                yield entry;
            }
        }
    }
    /* ---------------------------- 帮助文本 ---------------------------- */
    /** 生成帮助文本 */
    generateHelp() {
        const lines = [];
        lines.push('\x1b[1m可用命令:\x1b[0m');
        lines.push('─'.repeat(60));
        const commands = this.getAll();
        if (commands.length === 0) {
            lines.push('  (无已注册命令)');
            return lines.join('\n');
        }
        // 计算最大命令名宽度用于对齐
        let maxNameLen = 0;
        for (const cmd of commands) {
            const nameStr = this.formatCommandName(cmd);
            maxNameLen = Math.max(maxNameLen, nameStr.length);
        }
        for (const cmd of commands) {
            const nameStr = this.formatCommandName(cmd);
            const source = this.sources.get(cmd.name) ?? '';
            const padded = nameStr.padEnd(maxNameLen + 2);
            lines.push(`  \x1b[36m${padded}\x1b[0m ${cmd.description}  \x1b[90m[${source}]\x1b[0m`);
        }
        lines.push('─'.repeat(60));
        return lines.join('\n');
    }
    /* ---------------------------- 私有工具 ---------------------------- */
    /** 格式化命令名 (含别名) */
    formatCommandName(cmd) {
        return cmd.aliases?.length
            ? `${cmd.name} (${cmd.aliases.join(', ')})`
            : cmd.name;
    }
    /** 泛型: 查找满足谓词的命令 (泛型 + 约束) */
    findCommand(predicate) {
        for (const cmd of this.commands.values()) {
            if (predicate(cmd))
                return cmd;
        }
        return undefined;
    }
    /** 泛型: 过滤命令 (泛型 + 约束) */
    filterCommands(predicate) {
        const result = [];
        for (const cmd of this.commands.values()) {
            if (predicate(cmd))
                result.push(cmd);
        }
        return result;
    }
}
exports.CommandRegistry = CommandRegistry;
/** 模块级类型守卫: 判断 ResolveResult 是否为 plugin 来源 */
function isPluginResolveResult(r) {
    return r.kind === types_1.CommandKind.Plugin;
}
/** 模块级类型守卫: 判断 ResolveResult 是否未找到 */
function isMissingResolveResult(r) {
    return r.kind === 'missing';
}
//# sourceMappingURL=command-registry.js.map