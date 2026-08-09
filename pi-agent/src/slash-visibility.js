/**
 * Slash menu visibility + /aiia routing helpers.
 */

export const DEFAULT_SLASH_ALLOWLIST = Object.freeze([
  "goal",
  "reply",
  "add-dir",
  "vault",
  "aiia",
]);

/** Commands owned by AIIA that may be hidden from autocomplete. */
export const AIIA_MANAGED_SLASH_COMMANDS = Object.freeze([
  "goal",
  "reply",
  "add-dir",
  "rm-dir",
  "list-dirs",
  "memory",
  "vault",
  "sync",
  "aiia",
]);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function resolveSlashAllowlist(env = process.env) {
  const raw = env.AIIA_SLASH_ALLOWLIST;
  if (raw == null || String(raw).trim() === "") {
    return [...DEFAULT_SLASH_ALLOWLIST];
  }
  const list = String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.includes("aiia")) list.push("aiia");
  return list;
}

/** @param {NodeJS.ProcessEnv} [env] */
export function isSlashUxDisabled(env = process.env) {
  const v = env.AIIA_SLASH_UX_DISABLED;
  return v === "1" || v === "true";
}

/**
 * @param {string} args
 * @returns {{ subcommand: string, rest: string }}
 */
export function parseAiiaArgs(args = "") {
  const trimmed = String(args || "").trim();
  if (!trimmed) return { subcommand: "help", rest: "" };
  const sp = trimmed.indexOf(" ");
  if (sp === -1) return { subcommand: trimmed.toLowerCase(), rest: "" };
  return {
    subcommand: trimmed.slice(0, sp).toLowerCase(),
    rest: trimmed.slice(sp + 1).trim(),
  };
}

/**
 * Filter autocomplete items for "/" menus.
 * Keeps Pi builtins / unknown commands; drops managed AIIA cmds not on allowlist;
 * always drops skill:*.
 *
 * @param {Array<{ value?: string, name?: string, label?: string, description?: string }>} items
 * @param {string[]} allowlist
 * @param {Iterable<string>} [managed]
 */
export function filterSlashAutocompleteItems(
  items,
  allowlist,
  managed = AIIA_MANAGED_SLASH_COMMANDS,
) {
  const allow = new Set(allowlist);
  const managedSet = new Set(managed);
  return (items || []).filter((item) => {
    const name = String(item?.value ?? item?.name ?? item?.label ?? "").replace(/^\//, "");
    if (!name) return false;
    if (name.startsWith("skill:")) return false;
    if (!managedSet.has(name)) return true;
    return allow.has(name);
  });
}

/**
 * @param {string} sub
 * @param {string} rest
 * @param {Record<string, (args: string, ctx: any) => Promise<void>|void>} handlers
 * @param {any} ctx
 */
export async function routeAiiaSubcommand(sub, rest, handlers, ctx) {
  const key = String(sub || "help").toLowerCase();
  const aliases = {
    dirs: "list-dirs",
    dir: "list-dirs",
    "list-dir": "list-dirs",
    help: "help",
    "?": "help",
  };
  const resolved = aliases[key] || key;

  if (resolved === "help") {
    const names = Object.keys(handlers)
      .filter((n) => n !== "help")
      .sort();
    const lines = [
      "AIIA command hub:",
      "  /aiia help",
      ...names.map((n) => `  /aiia ${n} ...`),
      "",
      "Visible slash shortcuts: /goal /reply /add-dir /vault",
      "Prefer tools from the capability catalog for agent work.",
    ];
    ctx?.ui?.notify?.(lines.join("\n"), "info");
    return { ok: true, subcommand: "help" };
  }

  const handler = handlers[resolved];
  if (!handler) {
    ctx?.ui?.notify?.(
      `Unknown /aiia subcommand: ${key}. Try /aiia help`,
      "warning",
    );
    return { ok: false, subcommand: resolved, error: "unknown" };
  }
  await handler(rest, ctx);
  return { ok: true, subcommand: resolved };
}
