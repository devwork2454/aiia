/**
 * Persistent To-do progress widget + checklist renderer.
 *
 * Agent tool `update_todos` writes the live list. TUI shows:
 *   To-do Working on N to-dos • M done
 *       ✔ completed
 *       ◐ in progress
 *       ○ pending
 *
 * /demo-board seeds a sample. Kill: AIIA_VISUAL_DISABLED=1
 */
import { VStack, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { isExtensionEnabled } from "../src/extension-profile.js";
import {
  DEMO_TODOS,
  STATUS_GLYPH,
  WIDGET_KEY,
  applyTodoUpdate,
  formatProgressBar,
  formatTodoHeader,
  formatTodoWidgetLines,
  latestTodosFromEntries,
  normalizeTodos,
  paintTodoWidget,
  summarizeTodos,
} from "../src/todo-progress.js";

function checklistFromUnknown(raw) {
  if (Array.isArray(raw)) return normalizeTodos(raw);
  if (raw && typeof raw === "object" && Array.isArray(raw.todos)) {
    return normalizeTodos(raw.todos);
  }
  return [];
}

/**
 * Build the colored widget tree: header with a compact progress bar, and one
 * line per todo — in_progress items are highlighted with ▶ + accent color.
 */
function buildTodoWidgetTree(theme, rawTodos) {
  const items = normalizeTodos(rawTodos);
  if (items.length === 0) return undefined;
  const root = new VStack();
  const summary = summarizeTodos(items);
  const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 100;
  const barColor = pct === 100 ? "success" : "accent";
  const header = `${formatTodoHeader(summary)} ${theme.fg(barColor, formatProgressBar(pct))}`;
  root.addChild(new Text(header, 0, 0));
  
  // 安全获取终端宽度，留点边距
  const maxWidth = (process.stdout.columns || 150) - 2;

  for (const item of items) {
    const glyph = STATUS_GLYPH[item.status] || STATUS_GLYPH.pending;
    const color =
      item.status === "completed" ? "success" : item.status === "in_progress" ? "accent" : "dim";
    const marker = item.status === "in_progress" ? "▶ " : "  ";
    let text = `    ${marker}${theme.fg(color, glyph)} ${theme.fg(color, item.content)}`;
    if (item.logPath) {
      text += ` ${theme.fg("dim", `(log: ${item.logPath})`)}`;
    }
    
    // 使用 truncateToWidth 防止超宽报错
    text = truncateToWidth(text, maxWidth, theme.fg("dim", "..."));
    root.addChild(new Text(text, 0, 0));
  }
  return root;
}

export default function uiTaskBoardExtension(pi) {
  if (!isExtensionEnabled("ui-task-board")) return;

  let todos = [];

  function restoreFrom(ctx) {
    const branch = ctx?.sessionManager?.getBranch?.();
    if (!Array.isArray(branch)) return;
    todos = latestTodosFromEntries(branch);
  }

  let currentCtx = null;

  function paint(ctx) {
    if (ctx) currentCtx = ctx;
    const ui = currentCtx?.ui;
    if (!ui || typeof ui.setWidget !== "function") return;
    try {
      // Theme-aware tree (progress bar + highlight) with string fallback.
      ui.setWidget(WIDGET_KEY, todos.length ? (_tui, theme) => buildTodoWidgetTree(theme, todos) : undefined, {
        placement: "aboveEditor",
      });
    } catch {
      paintTodoWidget(ui, todos);
    }
  }
  
  const onResize = () => {
    if (currentCtx) paint(currentCtx);
  };

  pi.on("session_start", async (_event, ctx) => {
    restoreFrom(ctx);
    paint(ctx);
    process.stdout.on('resize', onResize);
  });
  pi.on("session_tree", async (_event, ctx) => {
    restoreFrom(ctx);
    paint(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx?.ui?.setWidget?.(WIDGET_KEY, undefined);
    process.stdout.off('resize', onResize);
  });

  pi.registerMessageRenderer("checklist", (msg, _options, theme) => {
    let parsed;
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      return undefined;
    }
    return buildTodoWidgetTree(theme, checklistFromUnknown(parsed));
  });

  pi.registerTool({
    name: "update_todos",
    label: "To-do",
    description:
      "Update the on-screen To-do progress list (✔ done, ◐ working, ○ pending). Send the full list unless merge=true.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Todo items. Each: {id?, content|task, status: pending|in_progress|completed}",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              task: { type: "string" },
              status: { type: "string" },
              logPath: { type: "string", description: "Optional path to a log file for this task" },
            },
          },
        },
        merge: { type: "boolean", description: "Merge by id instead of replacing the list" },
        clear: { type: "boolean", description: "Clear the list and hide the widget" },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      todos = applyTodoUpdate(todos, params || {});
      paint(ctx);
      const lines = formatTodoWidgetLines(todos);
      return {
        content: [{ type: "text", text: lines.length ? lines.join("\n") : "(no to-dos)" }],
        details: { todos },
      };
    },
  });

  pi.registerCommand("demo-board", {
    description: "Show a sample To-do progress panel",
    handler: async (_args, ctx) => {
      todos = normalizeTodos(DEMO_TODOS);
      paint(ctx);
      pi.sendMessage({
        customType: "checklist",
        content: JSON.stringify(todos),
        display: true,
      });
    },
  });
}
