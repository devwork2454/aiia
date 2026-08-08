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
  // Pi 官方约定：tool_call handler 返回 { block: true, reason?, terminate? } 来拦截，
  // 而非抛异常（抛异常语义不同，且不会给模型可读的 reason）。
  pi.on("tool_call", async (event) => {
    const name = String(event.toolName || "").toLowerCase();
    if (name !== "bash" && name !== "shell") return;
    const command = String((event.args as { command?: string })?.command || "");
    if (DANGEROUS.test(command)) {
      return {
        block: true,
        reason: `Blocked dangerous shell command by AIIA policy: ${command.slice(0, 80)}`,
      };
    }
  });
}
