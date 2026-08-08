/** Shared safety policy for bash / shell tool calls (also mirrored in Pi extension). */

const DANGEROUS =
  /\b(rm\s+-rf\s+[\/~]|sudo\b|git\s+push\s+--force|mkfs\b|dd\s+if=|: \(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;)/i;

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {{ status: 'ALLOW' | 'DENY', reason?: string }}
 */
export function preToolCheck(toolName, args = {}) {
  const name = String(toolName || "").toLowerCase();
  if (name === "bash" || name === "run_shell_command" || name === "shell") {
    const command = String(args.command ?? args.cmd ?? "");
    if (DANGEROUS.test(command)) {
      return { status: "DENY", reason: "Blocked dangerous shell command by AIIA policy." };
    }
  }
  return { status: "ALLOW" };
}
