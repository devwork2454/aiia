/**
 * Pure helpers for the persistent To-do progress widget.
 */

export const MAX_TODOS = 24;
export const WIDGET_KEY = "todo-progress";

export const STATUS_GLYPH = Object.freeze({
  pending: "○",
  in_progress: "◐",
  completed: "✔",
});

const STATUS_ALIASES = Object.freeze({
  pending: "pending",
  todo: "pending",
  open: "pending",
  doing: "in_progress",
  working: "in_progress",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  done: "completed",
  complete: "completed",
  completed: "completed",
});

export const DEMO_TODOS = Object.freeze([
  { id: "sdd", content: "SDD 工作区 / worktree / ledger", status: "completed" },
  { id: "t1", content: "Task 1: 窗口纯函数", status: "completed" },
  { id: "t2", content: "Task 2: watermark 单调合并", status: "in_progress" },
  { id: "t3", content: "Task 3: 0 行不 REPLACE", status: "pending" },
  { id: "t4", content: "Task 4: 增量窗口 + SETTINGS + backfill CLI", status: "pending" },
  { id: "t5", content: "Task 5: 恢复 earliest 门禁", status: "pending" },
  { id: "t6", content: "Task 6: SOP 与 spec 交叉引用", status: "pending" },
  { id: "t7", content: "Task 7: 全量门禁 verify.sh", status: "pending" },
  { id: "review", content: "整支审查 + verifier + 收尾", status: "pending" },
]);

export function normalizeStatus(raw) {
  const key = String(raw || "pending")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return STATUS_ALIASES[key] || "pending";
}

export function normalizeTodo(raw, index = 0) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const content = raw.trim();
    if (!content) return null;
    return { id: `t${index + 1}`, content, status: "pending" };
  }
  if (typeof raw !== "object") return null;
  const content = String(raw.content || raw.task || raw.text || raw.title || "").trim();
  if (!content) return null;
  const id = String(raw.id || raw.key || `t${index + 1}`).trim() || `t${index + 1}`;
  return { id, content, status: normalizeStatus(raw.status) };
}

export function normalizeTodos(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < MAX_TODOS; i++) {
    const item = normalizeTodo(list[i], i);
    if (!item) continue;
    let { id } = item;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    out.push({ ...item, id });
  }
  return out;
}

export function summarizeTodos(todos) {
  const items = Array.isArray(todos) ? todos : [];
  let done = 0;
  let inProgress = 0;
  let pending = 0;
  for (const item of items) {
    if (item.status === "completed") done += 1;
    else if (item.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { total: items.length, done, inProgress, pending };
}

export function formatTodoHeader(summary) {
  const total = Number(summary?.total) || 0;
  const done = Number(summary?.done) || 0;
  const inProgress = Number(summary?.inProgress) || 0;
  const noun = total === 1 ? "to-do" : "to-dos";
  if (inProgress > 0) return `To-do Working on ${total} ${noun} • ${done} done`;
  if (total > 0 && done === total) return `To-do ${total} ${noun} • all done`;
  return `To-do ${total} ${noun} • ${done} done`;
}

export function formatTodoLine(todo) {
  const glyph = STATUS_GLYPH[todo?.status] || STATUS_GLYPH.pending;
  return `    ${glyph} ${todo?.content || ""}`;
}

export function formatTodoWidgetLines(todos) {
  const items = Array.isArray(todos) ? todos : [];
  if (items.length === 0) return [];
  return [formatTodoHeader(summarizeTodos(items)), ...items.map(formatTodoLine)];
}

export function mergeTodos(existing, incoming) {
  const seen = new Set((incoming || []).map((item) => item.id));
  const next = [...(incoming || []), ...(existing || []).filter((item) => !seen.has(item.id))];
  return next.slice(0, MAX_TODOS);
}

export function applyTodoUpdate(current, params = {}) {
  if (params.clear === true) return [];
  const incoming = normalizeTodos(params.todos);
  if (params.merge === true) return mergeTodos(current, incoming);
  return incoming;
}

export function latestTodosFromEntries(entries) {
  const list = entries || [];
  // Only the latest update_todos result matters; scan from the tail and short-circuit.
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i];
    if (entry?.type !== "message") continue;
    const msg = entry.message;
    if (msg?.role !== "toolResult" || msg.toolName !== "update_todos") continue;
    if (Array.isArray(msg.details?.todos)) return normalizeTodos(msg.details.todos);
  }
  return [];
}

export function paintTodoWidget(ui, todos) {
  if (!ui || typeof ui.setWidget !== "function") return false;
  const lines = formatTodoWidgetLines(todos);
  ui.setWidget(WIDGET_KEY, lines.length ? lines : undefined, { placement: "aboveEditor" });
  return true;
}
