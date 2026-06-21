import { Plugin, PluginContext } from '../core/types';

/* ============================== 日志插件 ============================== */

/**
 * logger 插件
 * - 提供全局日志记录功能
 * - 通过钩子监听所有命令执行，记录操作日志
 * - 监听 calc 插件事件记录运算日志
 * - 其他插件可声明对 logger 的依赖
 */
export function register(): Plugin {
  /** 操作日志缓存 */
  const logs: Array<{ time: string; type: string; message: string }> = [];

  /** 添加日志条目 */
  function addLog(type: string, message: string): void {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.push({ time, type, message });
  }

  return {
    meta: {
      name: 'logger',
      version: '1.0.0',
      description: '日志插件 - 记录所有命令执行与操作日志',
    },

    init(context: PluginContext) {
      // 注册 beforeCommand 钩子 - 记录命令调用
      context.registerHook('beforeCommand', (payload) => {
        const argsStr = payload.args?.positional.join(' ') ?? '';
        addLog('COMMAND', `执行命令: ${payload.command} ${argsStr}`.trim());
      });

      // 注册 onError 钩子 - 记录错误
      context.registerHook('onError', (payload) => {
        addLog('ERROR', `错误: ${payload.error?.message ?? '未知错误'}`);
      });

      // 监听 calc 插件的运算事件
      context.on('calc:operation', (data) => {
        const d = data as { operation: string; a: number; b: number; result: number };
        addLog('CALC', `${d.a} ${d.operation} ${d.b} = ${d.result}`);
      });

      // 监听计时器事件
      context.on('timer:started', (data) => {
        const d = data as { name: string };
        addLog('TIMER', `计时器 "${d.name}" 已启动`);
      });

      context.on('timer:stopped', (data) => {
        const d = data as { name: string; elapsed: number };
        addLog('TIMER', `计时器 "${d.name}" 已停止, 耗时 ${(d.elapsed / 1000).toFixed(2)}s`);
      });

      // 注册日志查看命令
      context.registerCommand({
        name: 'logs',
        aliases: ['history'],
        description: '查看操作日志',
        usage: 'logs [--clear]',
        handler: (args) => {
          const shouldClear = args.options.clear === true;

          if (shouldClear) {
            const count = logs.length;
            logs.length = 0;
            console.log(`\x1b[33m已清除 ${count} 条日志\x1b[0m`);
            return;
          }

          if (logs.length === 0) {
            console.log('\x1b[33m暂无日志记录\x1b[0m');
            return;
          }

          console.log(`\x1b[1m操作日志 (${logs.length} 条):\x1b[0m`);
          console.log('─'.repeat(60));

          for (const log of logs) {
            const typeColor =
              log.type === 'ERROR' ? '\x1b[31m' :
              log.type === 'CALC'   ? '\x1b[33m' :
              log.type === 'TIMER'  ? '\x1b[36m' :
                                      '\x1b[90m';
            console.log(
              `  \x1b[90m${log.time}\x1b[0m ${typeColor}[${log.type}]\x1b[0m ${log.message}`
            );
          }

          console.log('─'.repeat(60));
        },
      });

      // 注册插件信息命令
      context.registerCommand({
        name: 'plugins',
        aliases: ['list-plugins', 'ls-plugins'],
        description: '列出所有已加载插件',
        handler: () => {
          // 通过事件请求插件管理器信息（此处直接使用 getPlugin 模拟）
          console.log('\x1b[1m已加载插件:\x1b[0m');
          console.log('─'.repeat(50));

          const greetPlugin = context.getPlugin('greet');
          const loggerPlugin = context.getPlugin('logger');
          const calcPlugin = context.getPlugin('calc');
          const timePlugin = context.getPlugin('time');

          const allPlugins = [greetPlugin, loggerPlugin, calcPlugin, timePlugin].filter(Boolean);

          for (const p of allPlugins) {
            const deps = p!.meta.dependencies?.length
              ? `\x1b[90m (依赖: ${p!.meta.dependencies.join(', ')})\x1b[0m`
              : '';
            console.log(
              `  \x1b[36m${p!.meta.name}\x1b[0m v${p!.meta.version} - ${p!.meta.description}${deps}`
            );
          }

          console.log('─'.repeat(50));
        },
      });
    },
  };
}
