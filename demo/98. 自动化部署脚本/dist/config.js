"use strict";
/**
 * 部署配置模块
 * - 定义部署配置的类型约束
 * - 支持从 deploy.config.json 文件加载配置
 * - 支持环境变量覆盖
 * - 支持配置校验
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
exports.loadConfigFromFile = loadConfigFromFile;
exports.generateDefaultConfig = generateDefaultConfig;
exports.buildConfigFromArgs = buildConfigFromArgs;
exports.validateConfig = validateConfig;
exports.printConfigSummary = printConfigSummary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─── 默认配置 ─────────────────────────────────────────────────
const DEFAULT_ENV = {
    name: "staging",
    build: {
        command: "npm run build",
        outputDir: "./dist",
    },
    target: {
        name: "staging-server",
        remotePath: "/var/www/app",
        ssh: {
            host: "192.168.1.100",
            port: 22,
            username: "deployer",
        },
    },
    runTests: true,
    testCommand: "npm test",
    include: ["dist/**", "package.json", "node_modules/**"],
    exclude: ["*.log", ".env", ".git/**"],
    backupCount: 3,
    timeout: 300000,
};
// ─── 配置加载 ─────────────────────────────────────────────────
/**
 * 从文件加载配置
 */
function loadConfigFromFile(configPath) {
    const fullPath = path.resolve(configPath);
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(fullPath, "utf-8");
        return JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`配置文件解析失败: ${err.message}`);
    }
}
/**
 * 生成默认配置文件
 */
function generateDefaultConfig(writePath) {
    const config = {
        project: "my-project",
        environment: "staging",
        envs: {
            staging: { ...DEFAULT_ENV },
            production: {
                ...DEFAULT_ENV,
                name: "production",
                build: { command: "npm run build:prod", outputDir: "./dist" },
                target: {
                    name: "prod-server",
                    remotePath: "/var/www/app",
                    ssh: { host: "10.0.0.1", port: 22, username: "deployer" },
                },
                runTests: true,
                testCommand: "npm test",
                backupCount: 5,
                timeout: 600000,
            },
        },
    };
    fs.writeFileSync(writePath, JSON.stringify(config, null, 2), "utf-8");
}
/**
 * 从命令行参数构造配置 (demo 模式)
 */
function buildConfigFromArgs(args) {
    const envName = args.env;
    const env = {
        name: envName,
        build: {
            command: args.buildCmd ?? "npm run build",
            outputDir: args.outputDir ?? "./dist",
        },
        target: {
            name: `${envName}-server`,
            remotePath: args.remotePath ?? "/var/www/app",
            ssh: {
                host: args.host ?? "192.168.1.100",
                port: args.port ?? 22,
                username: args.user ?? "deployer",
            },
        },
        runTests: !args.skipTest,
        testCommand: args.testCmd ?? "npm test",
        include: args.include ?? ["dist/**", "package.json"],
        exclude: args.exclude ?? ["*.log", ".env", ".git/**"],
        backupCount: args.backups ?? 3,
        timeout: args.timeout ?? 300000,
    };
    return {
        project: args.project ?? "demo-project",
        environment: envName,
        envs: { [envName]: env },
    };
}
function validateConfig(config) {
    const errors = [];
    const envName = config.environment;
    if (!config.project || config.project.trim() === "") {
        errors.push({ field: "project", message: "项目名称不能为空" });
    }
    if (!config.envs[envName]) {
        errors.push({ field: "environment", message: `未找到环境 "${envName}" 的配置` });
        return errors;
    }
    const env = config.envs[envName];
    if (!env.build.command) {
        errors.push({ field: "build.command", message: "构建命令不能为空" });
    }
    if (!env.build.outputDir) {
        errors.push({ field: "build.outputDir", message: "构建输出目录不能为空" });
    }
    if (!env.target.ssh.host) {
        errors.push({ field: "target.ssh.host", message: "SSH 主机地址不能为空" });
    }
    if (!env.target.ssh.username) {
        errors.push({ field: "target.ssh.username", message: "SSH 用户名不能为空" });
    }
    if (!env.target.remotePath) {
        errors.push({ field: "target.remotePath", message: "远程部署路径不能为空" });
    }
    if (env.backupCount < 0) {
        errors.push({ field: "backupCount", message: "备份数量不能为负数" });
    }
    if (env.timeout <= 0) {
        errors.push({ field: "timeout", message: "超时时间必须大于 0" });
    }
    return errors;
}
/**
 * 打印当前使用的配置信息
 */
function printConfigSummary(config, log) {
    const env = config.envs[config.environment];
    if (!env)
        return;
    log.info(`项目: ${config.project}`);
    log.info(`环境: ${env.name}`);
    log.info(`构建: ${env.build.command} → ${env.build.outputDir}`);
    log.info(`目标: ${env.target.ssh.username}@${env.target.ssh.host}:${env.target.ssh.port}`);
    log.info(`路径: ${env.target.remotePath}`);
    log.info(`测试: ${env.runTests ? env.testCommand : "跳过"}`);
    log.info(`备份: 保留最近 ${env.backupCount} 个版本`);
    log.info(`超时: ${env.timeout / 1000}s`);
}
//# sourceMappingURL=config.js.map