/**
 * AIIA safety extension — real tool_call interception.
 * Loaded by Pi via DefaultResourceLoader (extensionFactories or .pi/extensions).
 * Returns { block: true, reason } per Pi's official tool_call contract.
 */
import { evaluateToolCall } from "../src/policy.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function safetyExtension(pi) {
  pi.on("tool_call", async (event) => {
    const verdict = evaluateToolCall(event.toolName, event.args || {});
    if (verdict.block) {
      return { block: true, reason: verdict.reason };
    }
  });
}
