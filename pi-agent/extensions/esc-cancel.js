import readline from 'node:readline';

export default function escCancelExtension(pi) {
  pi.on("session_start", (event, ctx) => {
    if (process.stdin.isTTY) {
      if (typeof readline.emitKeypressEvents === 'function') {
        readline.emitKeypressEvents(process.stdin);
      }
      
      const onKeypress = (str, key) => {
        if (key && key.name === 'escape') {
          ctx?.ui?.notify?.("⚠️ [ESC] 拦截指令：正在取消任务与工具调用...", "warning");
          
          if (typeof pi.cancelActiveTasks === 'function') {
            pi.cancelActiveTasks();
          } else if (ctx?.session && typeof ctx.session.cancelActiveToolCalls === 'function') {
            ctx.session.cancelActiveToolCalls();
          }
        }
      };
      
      process.stdin.on('keypress', onKeypress);
      
      // Cleanup on shutdown
      pi.on("session_shutdown", () => {
        process.stdin.off('keypress', onKeypress);
      });
    }
  });
}
