import { Plugin, PluginContext, CommandArgs } from '../core/types';

/* ============================== 计算器插件 ============================== */

/**
 * calc 插件
 * - 提供基础数学计算命令
 * - 演示带参数解析的命令实现
 * - 依赖 logger 插件进行操作日志记录
 */
export function register(): Plugin {
  return {
    meta: {
      name: 'calc',
      version: '1.0.0',
      description: '计算器插件 - 提供基础数学运算',
      dependencies: ['logger'],
    },

    init(context: PluginContext) {
      context.registerCommand({
        name: 'calc',
        aliases: ['compute', 'math'],
        description: '执行数学计算',
        usage: 'calc <add|sub|mul|div> <a> <b>',
        handler: (args: CommandArgs) => {
          const operation = args.positional[0];
          const a = parseFloat(args.positional[1] ?? '0');
          const b = parseFloat(args.positional[2] ?? '0');

          if (isNaN(a) || isNaN(b)) {
            console.error('\x1b[31m✗ 请提供有效的数字参数\x1b[0m');
            return;
          }

          let result: number;
          let symbol: string;

          switch (operation) {
            case 'add':
              result = a + b; symbol = '+'; break;
            case 'sub':
              result = a - b; symbol = '-'; break;
            case 'mul':
              result = a * b; symbol = '×'; break;
            case 'div':
              if (b === 0) {
                console.error('\x1b[31m✗ 除数不能为零\x1b[0m');
                return;
              }
              result = a / b; symbol = '÷'; break;
            default:
              console.error(`\x1b[31m✗ 未知运算: "${operation}"\x1b[0m`);
              console.log('支持的运算: add(加), sub(减), mul(乘), div(除)');
              return;
          }

          // 通知 logger 插件
          context.emit('calc:operation', { operation, a, b, result });

          const resultStr = Number.isInteger(result) ? String(result) : result.toFixed(4);
          console.log(`\x1b[33m${a} ${symbol} ${b} = ${resultStr}\x1b[0m`);
        },
      });

      context.registerCommand({
        name: 'sqrt',
        description: '计算平方根',
        usage: 'sqrt <number>',
        handler: (args: CommandArgs) => {
          const n = parseFloat(args.positional[0] ?? '0');

          if (isNaN(n)) {
            console.error('\x1b[31m✗ 请提供有效的数字\x1b[0m');
            return;
          }

          if (n < 0) {
            console.error('\x1b[31m✗ 无法计算负数的平方根\x1b[0m');
            return;
          }

          const result = Math.sqrt(n);
          console.log(`\x1b[33m√${n} = ${result.toFixed(4)}\x1b[0m`);
        },
      });
    },
  };
}
