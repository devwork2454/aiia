/**
 * Default-on extension profile (lean).
 * Optional extensions no-op unless AIIA_EXTENSIONS=all or listed in AIIA_EXTRA_EXTENSIONS.
 */

/** Always loaded. Security + memory + quality + routing + human slash. */
export const CORE_EXTENSIONS = Object.freeze([
  "safety",
  "sandbox-policy",
  "secret-gate",
  "memory",
  "context-card",
  "capability-catalog",
  "quality-gate",
  "context-gc",
  "router",
  "slash-ux",
  "goal",
  "imp",
  "reply-prefs",
  "config",
  "add-dir",
  "vault",
  "steer",
]);

/** Catalog tool name → extension id (file basename without .js). */
export const CATALOG_TOOL_EXTENSION = Object.freeze({
  remember: "memory",
  memory_search: "memory",
  memory_list: "memory",
  kb_search: "kb-search",
  list_additional_dirs: "add-dir",
  list_channels: "channel-adapter",
  get_os_browser_status: "os-browser",
  register_cron_task: "cron-scheduler",
  list_cron_tasks: "cron-scheduler",
  create_dag_task: "task-runner",
  run_dag_task: "task-runner",
  spawn_worktree_subagent: "subagent-worktree",
  set_sandbox_policy: "sandbox-policy",
});

function splitList(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isExtensionEnabled(name, env = process.env) {
  const id = String(name || "").replace(/\.js$/i, "");
  if (!id) return false;
  if (env.AIIA_EXTENSIONS === "all" || env.AIIA_EXTENSIONS === "*") return true;
  if (CORE_EXTENSIONS.includes(id)) return true;
  const extra = splitList(env.AIIA_EXTRA_EXTENSIONS);
  return extra.includes(id);
}

export function isCatalogToolEnabled(toolName, env = process.env) {
  const ext = CATALOG_TOOL_EXTENSION[toolName];
  if (!ext) return true;
  return isExtensionEnabled(ext, env);
}
