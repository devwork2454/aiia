/**
 * Default-on extension profile (lean + visual).
 * CORE always on. VISUAL (board / compact bar) on unless AIIA_VISUAL_DISABLED=1.
 * Other optionals no-op unless AIIA_EXTENSIONS=all or listed in AIIA_EXTRA_EXTENSIONS.
 */

/** Always loaded. Security + memory + quality + routing + human slash + management. */
export const CORE_EXTENSIONS = Object.freeze([
  "safety",
  "sandbox-policy",
  "secret-gate",
  "memory",
  "context-card",
  "capability-catalog",
  "prompt-snapshot",
  "quality-gate",
  "tool-result-prune",
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
  "manage",
]);

/** Default-on TUI extras. Not CORE. Kill: AIIA_VISUAL_DISABLED=1 */
export const VISUAL_EXTENSIONS = Object.freeze([
  "ui-task-board",
  "compact-progress",
  "turn-status",
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
  update_todos: "ui-task-board",
});

function splitList(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isVisualDisabled(env = process.env) {
  const v = env.AIIA_VISUAL_DISABLED;
  return v === "1" || v === "true";
}

export function isExtensionEnabled(name, env = process.env) {
  const id = String(name || "").replace(/\.js$/i, "");
  if (!id) return false;
  if (env.AIIA_EXTENSIONS === "all" || env.AIIA_EXTENSIONS === "*") return true;
  if (CORE_EXTENSIONS.includes(id)) return true;
  if (VISUAL_EXTENSIONS.includes(id) && !isVisualDisabled(env)) return true;
  const extra = splitList(env.AIIA_EXTRA_EXTENSIONS);
  return extra.includes(id);
}

export function isCatalogToolEnabled(toolName, env = process.env) {
  const ext = CATALOG_TOOL_EXTENSION[toolName];
  if (!ext) return true;
  return isExtensionEnabled(ext, env);
}
