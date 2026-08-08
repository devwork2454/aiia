/**
 * AIIA safety extension for Pi.
 * Load with: pi -e ./extensions/safety.ts
 * Or place under .pi/extensions / ~/.pi/agent/extensions
 *
 * Note: type-only import; runtime uses ExtensionAPI shape from pi-coding-agent.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DANGEROUS =
  /\b(rm\s+-rf\s+[\/~]|sudo\b|git\s+push\s+--force|mkfs\b|dd\s+if=)/i;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName || "").toLowerCase();
    if (name !== "bash" && name !== "shell") return;
    const command = String((event.args as { command?: string })?.command || "");
    if (DANGEROUS.test(command)) {
      ctx.ui?.notify?.(`AIIA blocked: ${command.slice(0, 80)}`);
      // Prefer deny via throwing / returning block if API supports it;
      // fallback: rewrite to echo deny for older hooks.
      throw new Error("Blocked dangerous shell command by AIIA policy.");
    }
  });
}
