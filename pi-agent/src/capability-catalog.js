/**
 * Short capability catalog for the cache-safe context snapshot.
 * Goal: teach the model which tools to use — not dump skill bodies.
 */
import { isCatalogToolEnabled } from "./extension-profile.js";

export const MAX_CATALOG_CHARS = 2048;

/** @typedef {{ name: string, when: string }} CatalogEntry */

/** Static tool catalog (stable; avoid runtime discovery flake). */
export const DEFAULT_CATALOG_ENTRIES = Object.freeze([
  { name: "remember", when: "Persist a durable user preference/fact to long-term memory." },
  { name: "update_todos", when: "Show/update the on-screen To-do progress list for multi-step work." },
  { name: "memory_search", when: "Search long-term memories by keywords (prefer over asking user for /memory)." },
  { name: "memory_list", when: "List recent long-term memories." },
  { name: "kb_search", when: "Search Markdown knowledge roots + memories for docs/facts." },
  { name: "list_additional_dirs", when: "List extra workspace dirs added via /add-dir." },
  { name: "list_channels", when: "Inspect inbound channel adapter status (cli/feishu/web)." },
  { name: "get_os_browser_status", when: "Check L7.6 OS/browser gate (default off; do not assume desktop control)." },
  { name: "register_cron_task", when: "Schedule a recurring 5-field cron shell task (ticks only while this Pi session is alive)." },
  { name: "list_cron_tasks", when: "List registered cron tasks." },
  { name: "create_dag_task", when: "Create a dependent task DAG for multi-step shell workflows." },
  { name: "run_dag_task", when: "Run/resume a task DAG by id." },
  { name: "spawn_worktree_subagent", when: "Isolate a branch refactor/feature in a git worktree subagent." },
  { name: "set_sandbox_policy", when: "Tighten sandbox to sandbox/strict (permissive requires SANDBOX_ALLOW_PERMISSIVE=1)." },
]);

/**
 * @param {{ tools?: CatalogEntry[], env?: NodeJS.ProcessEnv, card?: import("./context-card.js").Card, maxChars?: number }} [opts]
 * @returns {string}
 */
export function buildCapabilityCatalog({
  tools = DEFAULT_CATALOG_ENTRIES,
  env = process.env,
  card,
  maxChars = MAX_CATALOG_CHARS,
} = {}) {
  if (isCatalogDisabled(env)) return "";

  tools = tools.filter((t) => isCatalogToolEnabled(t?.name, env));

  if (card) {
    tools = filterCatalogEntries(tools, card);
  }

  const lines = [
    "AIIA tools (prefer calling tools; do not ask the user to memorize slash commands):",
  ];
  for (const t of tools) {
    if (!t?.name) continue;
    lines.push(`- ${t.name}: ${t.when || ""}`.trimEnd());
  }
  lines.push(
    "Human slash control plane (optional): /goal /imp /reply /add-dir /vault /profile; rough tasks → skill `imp`; more via /aiia help.",
  );

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
  }
  return text;
}

/**
 * @param {string} catalogText
 * @returns {string}
 */
export function formatCapabilityCatalogPrompt(catalogText) {
  const body = String(catalogText || "").trim();
  if (!body) return "";
  return ["[AIIA capability catalog]", body].join("\n");
}

/** @param {NodeJS.ProcessEnv} [env] */
export function isCatalogDisabled(env = process.env) {
  const v = env.AIIA_CAPABILITY_CATALOG_DISABLED;
  return v === "1" || v === "true";
}

/**
 * @param {CatalogEntry[]} entries
 * @param {import("./context-card.js").Card | null | undefined} card
 * @returns {CatalogEntry[]}
 */
export function filterCatalogEntries(entries, card) {
  const avoid = new Set((card?.avoid_tools || []).map(String));
  const prefer = (card?.prefer_tools || []).map(String);
  const base = entries.filter((e) => e?.name && !avoid.has(e.name));
  if (!prefer.length) return base;
  const rank = new Map(prefer.map((n, i) => [n, i]));
  return [...base].sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name) : 1000;
    const rb = rank.has(b.name) ? rank.get(b.name) : 1000;
    return ra - rb || a.name.localeCompare(b.name);
  });
}
