/**
 * AIIA safety extension — real tool_call interception.
 * Loaded by Pi via DefaultResourceLoader (additionalExtensionPaths / .pi/extensions).
 * Returns { block: true, reason } per Pi's official ToolCallEventResult contract.
 *
 * NOTE: Pi's real tool_call event carries args in `event.input` (BashToolInput.command),
 * NOT `event.args`. evaluateToolCallEvent handles the real shape.
 */
import { evaluateToolCallEvent } from '../src/policy.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function safetyExtension(pi) {
  pi.on('tool_call', async (event, ctx) => {
    const verdict = evaluateToolCallEvent(event);
    if (verdict.block) {
      if (ctx.hasUI) {
        const command = event?.input?.command || event?.args?.command || event?.args?.cmd || '';
        const confirmed = await ctx.ui.confirm(
          '⚠ 安全拦截警告',
          `该命令包含高危操作：\n${verdict.reason}\n\n指令内容：\n${command}\n\n是否仍要强制执行？`,
        );
        if (confirmed) {
          return { block: false };
        }
      }
      return { block: true, reason: verdict.reason };
    }
  });
}
