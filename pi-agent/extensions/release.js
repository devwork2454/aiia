/**
 * AIIA /release command — Automates local CI/CD verification and release flow.
 * Skill text lives in `.agents/skills/release`.
 */
import { registerAiiaHandler } from '../src/command-registry.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function releaseExtension(pi) {
  const handler = async (args, ctx) => {
    let msg = '/release';
    if (args) {
      msg += ' ' + args;
    }

    try {
      if (typeof ctx?.isIdle === 'function' && !ctx.isIdle()) {
        pi.sendUserMessage(msg, { deliverAs: 'followUp' });
      } else {
        pi.sendUserMessage(msg);
      }
      ctx?.ui?.notify?.('🚀 已启动本地自动化发布流水线...', 'info');
    } catch (err) {
      ctx?.ui?.notify?.(`启动 /release 失败: ${err.message}`, 'error');
    }
  };

  pi.registerCommand('release', {
    description: '一键本地流水线 | 自动执行 quality-check -> verify -> Git 推送',
    handler,
  });

  if (typeof registerAiiaHandler === 'function') {
    registerAiiaHandler('release', handler);
  }
}
