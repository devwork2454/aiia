/** Shared high-risk shell policy (used by safety extension + unit tests). */

export const DANGEROUS =
  /(\brm\s+-rf\s+[\/~]|\bsudo\b|\bgit\s+push\s+--force\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;|\bchmod\s+-R\s+777\s+\/|>\s*\/dev\/sd[a-z])/i;

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {{ block: boolean, reason?: string }}
 */
export function evaluateToolCall(toolName, args = {}) {
  const name = String(toolName || "").toLowerCase();
  if (name === "bash" || name === "shell" || name === "run_shell_command") {
    const command = String(args.command ?? args.cmd ?? "");
    if (DANGEROUS.test(command)) {
      return { block: true, reason: `AIIA policy blocked dangerous shell: ${command.slice(0, 80)}` };
    }
  }
  return { block: false };
}
