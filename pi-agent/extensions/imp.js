/**
 * AIIA /imp command — shape a rough task then execute (skill `imp`).
 * Skill text lives in `.agents/skills/imp` (linked to ~/.pi/agent/skills/imp).
 */
import { buildImpKickoffMessage, parseImpArgs, resolveImpDelivery } from '../src/imp-command.js';
import { registerAiiaHandler } from '../src/command-registry.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function impExtension(pi) {
  const impHandler = async (args, ctx) => {
    const { empty, taskText } = parseImpArgs(args);
    const message = buildImpKickoffMessage(args);

    if (empty) {
      ctx?.ui?.notify?.(message, 'info');
      return;
    }

    const idle = typeof ctx?.isIdle === 'function' ? ctx.isIdle() : true;
    const delivery = resolveImpDelivery({ isIdle: idle });

    try {
      if (delivery.deliverAs) {
        pi.sendUserMessage(message, { deliverAs: delivery.deliverAs });
      } else {
        pi.sendUserMessage(message);
      }
    } catch (err) {
      try {
        pi.sendUserMessage(message, { deliverAs: 'followUp' });
        ctx?.ui?.notify?.('Imp queued as follow-up', 'info');
      } catch (err2) {
        ctx?.ui?.notify?.(` /imp failed: ${err2?.message || err?.message || err}`, 'error');
        return;
      }
    }

    if (delivery.notify) {
      ctx?.ui?.notify?.(delivery.notify, 'info');
    } else {
      ctx?.ui?.notify?.(` /imp：已启动 — ${taskText.slice(0, 60)}`, 'info');
    }
  };

  pi.registerCommand('imp', {
    description: '优化并执行 | 用法: /imp <粗糙任务>；先整形再动手，多步可衔 /goal',
    handler: impHandler,
  });
  registerAiiaHandler('imp', impHandler);
}
