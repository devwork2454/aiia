/**
 * AIIA safety extension — real tool_call interception.
 * Loaded by Pi via DefaultResourceLoader (additionalExtensionPaths / .pi/extensions).
 * Returns { block: true, reason } per Pi's official ToolCallEventResult contract.
 *
 * NOTE: Pi's real tool_call event carries args in `event.input` (BashToolInput.command),
 * NOT `event.args`. evaluateToolCallEvent handles the real shape.
 */
import { evaluateToolCallEvent } from "../src/policy.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function safetyExtension(pi) {
  pi.on("tool_call", async (event) => {
    const verdict = evaluateToolCallEvent(event);
    if (verdict.block) {
      return { block: true, reason: verdict.reason };
    }
  });
}
