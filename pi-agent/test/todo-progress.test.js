import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_TODOS,
  WIDGET_KEY,
  applyTodoUpdate,
  formatTodoHeader,
  formatTodoLine,
  formatTodoWidgetLines,
  latestTodosFromEntries,
  normalizeTodos,
  paintTodoWidget,
  summarizeTodos,
} from "../src/todo-progress.js";

describe("todo-progress helpers", () => {
  it("normalizes aliases and builds the sample widget", () => {
    const todos = normalizeTodos([
      { task: "SDD 工作区 / worktree / ledger", status: "done" },
      { content: "Task 1: 窗口纯函数", status: "completed" },
      { content: "Task 2: watermark 单调合并", status: "doing" },
      "Task 3: 0 行不 REPLACE",
    ]);
    assert.equal(todos[0].status, "completed");
    assert.equal(todos[2].status, "in_progress");
    assert.equal(todos[3].status, "pending");
    assert.equal(formatTodoLine(todos[0]).includes("✔"), true);
    assert.equal(formatTodoLine(todos[2]).includes("◐"), true);
    assert.equal(formatTodoLine(todos[3]).includes("○"), true);

    const demo = normalizeTodos([
      ...DEMO_TODOS,
      { id: "with-log", content: "With Log", status: "pending", logPath: ".agent/logs/test.log" }
    ]);
    const summary = summarizeTodos(demo);
    assert.equal(summary.total, 10);
    assert.equal(summary.done, 2);
    assert.equal(summary.inProgress, 1);
    assert.equal(formatTodoHeader(summary), "To-do Working on 10 to-dos • 2 done (20%)");

    const lines = formatTodoWidgetLines(demo);
    assert.equal(lines[0], "To-do Working on 10 to-dos • 2 done (20%)");
    assert.match(lines[1], /✔ SDD 工作区 \/ worktree \/ ledger/);
    assert.match(lines[3], /◐ Task 2: watermark 单调合并/);
    assert.match(lines[4], /○ Task 3: 0 行不 REPLACE/);
    assert.match(lines.at(-1), /○ With Log \(log: .agent\/logs\/test\.log\)/);
  });

  it("replace vs merge vs clear", () => {
    const first = applyTodoUpdate([], {
      todos: [
        { id: "a", content: "A", status: "pending" },
        { id: "b", content: "B", status: "pending" },
      ],
    });
    const merged = applyTodoUpdate(first, {
      merge: true,
      todos: [{ id: "a", content: "A", status: "completed" }],
    });
    assert.equal(merged[0].status, "completed");
    assert.equal(merged[1].id, "b");
    const replaced = applyTodoUpdate(merged, { todos: [{ content: "only" }] });
    assert.equal(replaced.length, 1);
    assert.equal(applyTodoUpdate(replaced, { clear: true }).length, 0);
  });

  it("restores latest tool snapshot from session entries", () => {
    const todos = latestTodosFromEntries([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "update_todos",
          details: { todos: [{ content: "old", status: "pending" }] },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "update_todos",
          details: { todos: [{ content: "new", status: "in_progress" }] },
        },
      },
    ]);
    assert.equal(todos.length, 1);
    assert.equal(todos[0].content, "new");
    assert.equal(todos[0].status, "in_progress");
  });

  it("paints and clears the above-editor widget", () => {
    const widgets = new Map();
    const ui = {
      setWidget(key, content, opts) {
        if (content === undefined) widgets.delete(key);
        else widgets.set(key, { content, opts });
      },
    };
    paintTodoWidget(ui, normalizeTodos(DEMO_TODOS));
    const painted = widgets.get(WIDGET_KEY);
    assert.equal(painted.opts.placement, "aboveEditor");
    assert.equal(painted.content[0], "To-do Working on 9 to-dos • 2 done (22%)");
    paintTodoWidget(ui, []);
    assert.equal(widgets.has(WIDGET_KEY), false);
  });
});
