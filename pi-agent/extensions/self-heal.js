/**
 * AIIA Self-Heal extension — 报错/崩溃自动采集，入修复队列供 goal 循环消费。
 *
 * L0/L1 落点：
 *  - 监听 error 事件：把 aiia 自身运行期错误写入修复队列（不打断当前循环）
 *  - 监听 agent_end：扫描本次会话错误消息 + pi-crash.log 新增段 → 去重入队
 *  - 修复动作由 goal 循环（D6 自省 + 修复队列消费）在确定性门禁内执行
 *
 * Env:
 *   AIIA_DISABLE_SELF_HEAL=1  关闭采集
 */
import { isExtensionEnabled } from '../src/extension-profile.js';
import {
  extractSelfErrors,
  scanCrashLog,
  queueHealTask,
} from '../src/self-heal-store.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function selfHealExtension(pi) {
  if (!isExtensionEnabled('self-heal')) return;

  const queue = (cwd, task) => {
    try {
      const queued = queueHealTask(cwd, task);
      if (queued) {
        console.error(`[AIIA self-heal] queued repair task: ${task.summary?.slice(0, 80)}`);
      }
    } catch (err) {
      // Never break the agent loop for heal bookkeeping failures.
      console.error('[AIIA self-heal] queue failed:', err?.message || err);
    }
  };

  // L1a: 运行期错误（扩展/内部）→ 直接入队
  if (typeof pi.on === 'function') {
    pi.on('error', (event, ctx) => {
      const cwd = ctx?.cwd || process.cwd();
      const msg =
        event?.message ||
        event?.error?.message ||
        (typeof event === 'string' ? event : JSON.stringify(event || {}));
      if (!msg) return;
      const text = String(msg);
      if (!/\[AIIA/i.test(text) && !/pi-agent[/\\]/.test(text)) return;
      queue(cwd, {
        type: 'runtime-error',
        source: 'pi-error-event',
        summary: text.split('\n')[0]?.slice(0, 200) || 'runtime error',
        detail: text.slice(0, 4000),
        files: [],
      });
    });
  }

  // L1b: 会话结束 → 聚合本次会话错误 + 崩溃日志新增段
  pi.on('agent_end', async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    try {
      for (const task of extractSelfErrors(event, { cwd })) {
        queue(cwd, task);
      }
      for (const task of scanCrashLog(cwd)) {
        queue(cwd, task);
      }
    } catch (err) {
      console.error('[AIIA self-heal] agent_end collect failed:', err?.message || err);
    }
  });
}
