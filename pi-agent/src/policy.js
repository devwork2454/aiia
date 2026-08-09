/** Shared high-risk shell policy (used by safety extension + unit tests). */

export const DANGEROUS =
  /(\brm\s+-[A-Za-z]*[rR][A-Za-z]*f\s+[\/~]|\brm\s+-[A-Za-z]*f[A-Za-z]*[rR]\s+[\/~]|\bsudo\b|\bgit\s+push\s+--force\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;|\bchmod\s+-R\s+777\s+\/|>\s*\/dev\/sd[a-z])/i;

const SHELL_TOOLS = new Set(["bash", "shell", "run_shell_command"]);

/**
 * Extract the shell command from a Pi tool_call event.
 * Pi's real event shape is `event.input.command` (BashToolInput); we also accept
 * `event.args`/`cmd` for robustness against SDK shape drift and unit tests.
 * @param {any} event
 * @returns {string}
 */
export function extractCommand(event) {
  const src = event?.input ?? event?.args ?? {};
  return String(src.command ?? src.cmd ?? "");
}

/**
 * Evaluate a Pi tool_call event. Pass the WHOLE event (real shape), not just args.
 * @param {{toolName?: string, input?: any, args?: any}} event
 * @returns {{ block: boolean, reason?: string }}
 */
export function evaluateToolCallEvent(event) {
  const name = String(event?.toolName || "").toLowerCase();
  if (!SHELL_TOOLS.has(name)) return { block: false };
  const command = extractCommand(event);
  if (DANGEROUS.test(command)) {
    return { block: true, reason: `AIIA policy blocked dangerous shell: ${command.slice(0, 80)}` };
  }
  return { block: false };
}
