import readline from 'node:readline';

export default function escCancelExtension(pi) {
  pi.on('session_start', (event, ctx) => {
    const cancelTasks = (source) => {
      ctx?.ui?.notify?.(`⚠️ [${source}] 拦截指令：正在中断请求与任务...`, 'warning');
      if (ctx?.session && typeof ctx.session.abort === 'function') {
        ctx.session.abort();
      }
      if (typeof pi.cancelActiveTasks === 'function') {
        pi.cancelActiveTasks();
      } else if (ctx?.session && typeof ctx.session.cancelActiveToolCalls === 'function') {
        ctx.session.cancelActiveToolCalls();
      }
    };

    // 1. 监听 ESC 键
    if (process.stdin.isTTY) {
      if (typeof readline.emitKeypressEvents === 'function') {
        readline.emitKeypressEvents(process.stdin);
      }
      const onKeypress = (str, key) => {
        if (key && key.name === 'escape') {
          cancelTasks('ESC');
        }
      };
      process.stdin.on('keypress', onKeypress);
      pi.on('session_shutdown', () => process.stdin.off('keypress', onKeypress));
    }

    // 2. 监听 Ctrl+C (SIGINT)
    const onSigint = () => {
      cancelTasks('Ctrl+C');
    };
    process.on('SIGINT', onSigint);

    pi.on('session_shutdown', () => {
      process.off('SIGINT', onSigint);
    });
  });
}
