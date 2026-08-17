import fs from 'node:fs';
import path from 'node:path';

/**
 * Default-on extension profile (lean + visual).
 * CORE always on. VISUAL (board / compact bar) on unless AIIA_VISUAL_DISABLED=1.
 * Other optionals no-op unless AIIA_EXTENSIONS=all or listed in AIIA_EXTRA_EXTENSIONS.
 */

/** Always loaded. Security + memory + quality + routing + human slash + management. */
export const CORE_EXTENSIONS = Object.freeze([
  'safety',
  'sandbox-policy',
  'secret-gate',
  'memory',
  'context-card',
  'capability-catalog',
  'prompt-snapshot',
  'quality-gate',
  'tool-result-prune',
  'context-gc',
  'router',
  'vision-fallback',
  'auto-router',
  'auto-dag',
  'slash-ux',
  'goal',
  'imp',
  'reply-prefs',
  'config',
  'add-dir',
  'vault',
  'steer',
  'markdown-transform',
  'manage',
  'progress-archiver',
  'large-file-gate',
  'esc-cancel',
  'lark-progress-sync',
  'project-router',
  'self-heal',
]);

/** Default-on TUI extras. Not CORE. Kill: AIIA_VISUAL_DISABLED=1 */
export const VISUAL_EXTENSIONS = Object.freeze([
  'ui-task-board',
  'compact-progress',
  'turn-status',
  'ui-beautify',
  'ui-subagent-board',
  'ui-footer',
  'todo-sync-guard',
  'ui-tool-inline',
]);

/** Catalog tool name → extension id (file basename without .js). */
export const CATALOG_TOOL_EXTENSION = Object.freeze({
  remember: 'memory',
  memory_search: 'memory',
  memory_list: 'memory',
  kb_search: 'kb-search',
  list_additional_dirs: 'add-dir',
  list_channels: 'channel-adapter',
  get_os_browser_status: 'os-browser',
  register_cron_task: 'cron-scheduler',
  list_cron_tasks: 'cron-scheduler',
  create_dag_task: 'task-runner',
  run_dag_task: 'task-runner',
  spawn_worktree_subagent: 'subagent-worktree',
  execute_dag: 'auto-dag',
  set_sandbox_policy: 'sandbox-policy',
  update_todos: 'ui-task-board',
});

function splitList(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 崩溃隔离：读取 .agent/heal/disabled-extensions.json（mtime 缓存，避免每次调用 IO）
let disabledCache = { path: null, mtimeMs: 0, list: [] };

export function getDisabledExtensions(env = process.env) {
  try {
    const cwd = process.cwd();
    const file = env.AIIA_HEAL_DIR
      ? path.join(path.isAbsolute(env.AIIA_HEAL_DIR) ? env.AIIA_HEAL_DIR : path.resolve(cwd, env.AIIA_HEAL_DIR), 'disabled-extensions.json')
      : path.join(cwd, '.agent', 'heal', 'disabled-extensions.json');
    const stat = fs.statSync(file);
    if (stat.mtimeMs === disabledCache.mtimeMs && disabledCache.path === file) {
      return disabledCache.list;
    }
    const list = JSON.parse(fs.readFileSync(file, 'utf-8'));
    disabledCache = {
      path: file,
      mtimeMs: stat.mtimeMs,
      list: Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [],
    };
    return disabledCache.list;
  } catch {
    return [];
  }
}

export function isVisualDisabled(env = process.env) {
  const v = env.AIIA_VISUAL_DISABLED;
  return v === '1' || v === 'true';
}

export function isExtensionEnabled(name, env = process.env) {
  const id = String(name || '').replace(/\.js$/i, '');
  if (!id) return false;
  if (getDisabledExtensions(env).includes(id)) return false; // 崩溃隔离：降级运行
  if (env.AIIA_EXTENSIONS === 'all' || env.AIIA_EXTENSIONS === '*') return true;
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
