/**
 * AIIA Self-Heal extension — 报错/崩溃自动采集与恢复。
 *
 * L0 崩溃隔离：uncaughtException/unhandledRejection → 崩溃前尽力记录 + 坏扩展禁用
 * L1 报错即修复：error/agent_end → 修复队列 → goal 循环消费
 * L3 崩溃恢复：context 注入上次会话恢复摘要（异常退出后无缝续上）
 *
 * Env:
 *   AIIA_DISABLE_SELF_HEAL=1   关闭全部自愈采集
 *   AIIA_HEAL_RESUME=1         崩溃后不重抛异常（降级继续运行，默认重抛保崩溃语义）
 */
import { isExtensionEnabled } from '../src/extension-profile.js';
import {
  extractSelfErrors,
  scanCrashLog,
  queueHealTask,
  markSessionHealthy,
  markSessionCrashed,
  recordCrashedExtension,
  extensionIdFromStack,
  buildRecoverySummary,
  markRecoveryInjected,
  readLastSession,
} from '../src/self-heal-store.js';

const RECOVERY_CUSTOM_TYPE = 'aiia-recovery';

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

  // -------------------------------------------------------------------------
  // L0: 进程级兜底（崩溃前尽力留存，坏扩展隔离）
  // -------------------------------------------------------------------------
  let processGuardInstalled = false;
  function installProcessGuard() {
    if (processGuardInstalled) return;
    processGuardInstalled = true;

    const handleCrash = (kind, err, rethrow) => {
      const cwd = process.cwd();
      const message = err?.message || String(err || 'unknown');
      const stack = err?.stack || '';
      const detail = `[${kind}] ${message}\n${stack}`.slice(0, 4000);
      try {
        // 1) 会话健康标记为崩溃（供下次启动恢复）
        markSessionCrashed(cwd, `${kind}: ${message.slice(0, 200)}`);
        // 2) 坏扩展隔离：从堆栈定位 aiia 扩展 → 持久化禁用
        const extId = extensionIdFromStack(stack, cwd);
        if (extId) {
          recordCrashedExtension(cwd, extId);
          console.error(`[AIIA self-heal] crash isolated extension: ${extId}`);
        }
        // 3) 错误入修复队列
        queue(cwd, {
          type: 'crash',
          source: kind,
          summary: `${kind}: ${message.split('\n')[0]?.slice(0, 200) || message}`,
          detail,
          files: extId ? [`pi-agent/extensions/${extId}.js`] : [],
        });
      } catch {
        /* best effort before dying */
      }
      if (rethrow) {
        // 保留崩溃语义（状态可能已损坏，默认不继续跑）
        throw err;
      }
    };

    process.on('uncaughtException', (err) => {
      handleCrash('uncaughtException', err, process.env.AIIA_HEAL_RESUME !== '1');
    });
    process.on('unhandledRejection', (reason) => {
      handleCrash('unhandledRejection', reason, false);
    });
  }
  installProcessGuard();

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

  // L3: 崩溃后上下文恢复（context 注入恢复摘要，仅一次）
  if (typeof pi.on === 'function') {
    pi.on('context', (event) => {
      const cwd = process.cwd();
      try {
        const summary = buildRecoverySummary(cwd);
        if (!summary) return;
        const messages = Array.isArray(event?.messages) ? event.messages : [];
        const last = readLastSession(cwd);
        const injected = messages.some(
          (m) => m?.role === 'custom' && m?.customType === RECOVERY_CUSTOM_TYPE,
        );
        if (injected) return;
        const recoveryMessage = {
          role: 'custom',
          customType: RECOVERY_CUSTOM_TYPE,
          content: summary,
          display: false,
          timestamp: 0,
        };
        // 追加到消息流末尾（让 agent 在首轮就看到恢复上下文）
        event.messages = [...messages, recoveryMessage];
        if (last) markRecoveryInjected(cwd, last.ts || '');
        console.error('[AIIA self-heal] recovery context injected (last session crashed)');
      } catch (err) {
        console.error('[AIIA self-heal] recovery inject failed:', err?.message || err);
      }
    });
  }

  // L1b: 会话结束 → 聚合本次会话错误 + 崩溃日志新增段 + 健康标记
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

  pi.on('session_shutdown', async (_event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    try {
      markSessionHealthy(cwd, 'shutdown');
    } catch (err) {
      console.error('[AIIA self-heal] shutdown mark failed:', err?.message || err);
    }
  });
}
