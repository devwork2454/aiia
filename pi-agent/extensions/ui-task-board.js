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
import { VStack, Text } from "@earendil-works/pi-tui";
import { isExtensionEnabled } from "../src/extension-profile.js";
import {
  DEMO_TODOS,
  WIDGET_KEY,
  applyTodoUpdate,
  formatTodoLine,
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

export default function uiTaskBoardExtension(pi) {
  if (!isExtensionEnabled("ui-task-board")) return;

  let todos = [];

  function restoreFrom(ctx) {
    const branch = ctx?.sessionManager?.getBranch?.();
    if (!Array.isArray(branch)) return;
    todos = latestTodosFromEntries(branch);
  }

  function paint(ctx) {
    paintTodoWidget(ctx?.ui, todos);
  }

  pi.on("session_start", async (_event, ctx) => {
    restoreFrom(ctx);
    paint(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    restoreFrom(ctx);
    paint(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx?.ui?.setWidget?.(WIDGET_KEY, undefined);
  });

  pi.registerMessageRenderer("checklist", (msg, _options, theme) => {
    let parsed;
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      return undefined;
    }
    const items = checklistFromUnknown(parsed);
    if (items.length === 0) return undefined;

    const root = new VStack();
    root.addChild(new Text(theme.fg("muted", formatTodoHeader(summarizeTodos(items))), 0, 0));
    for (const item of items) {
      const glyph = formatTodoLine(item).trimStart().slice(0, 1);
      const color =
        item.status === "completed" ? "success" : item.status === "in_progress" ? "accent" : "dim";
      root.addChild(new Text(`    ${theme.fg(color, glyph)} ${theme.fg(color, item.content)}`, 0, 0));
    }
    return root;
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
