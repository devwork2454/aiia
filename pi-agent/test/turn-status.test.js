import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  applyTurnStatusEvent,
  cacheHitPct,
  createTurnStatusState,
  extractUsage,
  formatDuration,
  formatTurnStatusLine,
  formatWorkingMessage,
  summarizeTool,
} from "../src/turn-status.js";
import turnStatusExtension from "../extensions/turn-status.js";

describe("turn-status helpers", () => {
  it("formatDuration uses ms / tenths / seconds / minutes", () => {
    assert.equal(formatDuration(0), "0ms");
    assert.equal(formatDuration(420), "420ms");
    assert.equal(formatDuration(2400), "2.4s");
    assert.equal(formatDuration(12_400), "12s");
    assert.equal(formatDuration(125_000), "2m 05s");
  });

  it("summarizeTool prefers command then basename", () => {
    assert.equal(summarizeTool("bash", { command: "npm  test" }), "bash npm test");
    assert.equal(summarizeTool("edit", { path: "/tmp/src/foo.js" }), "edit foo.js");
    assert.equal(summarizeTool("remember", {}), "remember");
  });

  it("extractUsage and cacheHitPct read Pi usage buckets", () => {
    const usage = extractUsage({
      usage: { input: 20, output: 5, cacheRead: 80, cacheWrite: 0 },
    });
    assert.deepEqual(usage, { input: 20, output: 5, cacheRead: 80, cacheWrite: 0 });
    assert.equal(cacheHitPct(usage), 80);
    assert.equal(extractUsage({ role: "assistant" }), null);
    assert.equal(cacheHitPct(null), null);
  });

  it("formatTurnStatusLine covers idle / thinking / tool / done", () => {
    assert.equal(formatTurnStatusLine(createTurnStatusState()), "Ready");
    assert.equal(
      formatTurnStatusLine({ phase: "thinking", startedAt: 0, now: 2400 }),
      "◐ 2.4s · thinking",
    );
    assert.equal(
      formatTurnStatusLine({
        phase: "tool",
        startedAt: 0,
        now: 8100,
        toolSummary: "bash npm test",
        toolCount: 3,
      }),
      "◐ 8.1s · bash npm test · 3 tools",
    );
    assert.equal(
      formatTurnStatusLine({
        phase: "done",
        startedAt: 0,
        now: 12_300,
        usage: { input: 20, cacheRead: 80, cacheWrite: 0 },
        toolCount: 2,
      }),
      "✓ 12s · cache 80% · 2 tools",
    );
    assert.equal(formatWorkingMessage({ phase: "tool", toolSummary: "bash ls" }), "bash ls");
    assert.equal(formatWorkingMessage({ phase: "thinking" }), undefined);
  });

  it("applyTurnStatusEvent walks a turn then keeps the done line", () => {
    let state = createTurnStatusState();
    state = applyTurnStatusEvent(state, { type: "session_start" }, 0);
    assert.equal(formatTurnStatusLine(state), "Ready");

    state = applyTurnStatusEvent(state, { type: "turn_start", turnIndex: 1, timestamp: 1000 }, 1000);
    assert.match(formatTurnStatusLine(state), /thinking/);

    state = applyTurnStatusEvent(
      state,
      { type: "tool_execution_start", toolName: "bash", args: { command: "ls" } },
      2500,
    );
    assert.equal(formatTurnStatusLine(state), "◐ 1.5s · bash ls");
    assert.equal(formatWorkingMessage(state), "bash ls");

    state = applyTurnStatusEvent(state, { type: "tool_execution_end", toolName: "bash" }, 4000);
    assert.equal(state.phase, "thinking");

    state = applyTurnStatusEvent(
      state,
      {
        type: "message_end",
        message: { usage: { input: 10, output: 2, cacheRead: 90, cacheWrite: 0 } },
      },
      5000,
    );
    state = applyTurnStatusEvent(state, { type: "turn_end" }, 5000);
    assert.equal(formatTurnStatusLine(state), "✓ 4.0s · cache 90% · 1 tool");
  });
});

describe("turn-status extension", () => {
  before(() => {
    delete process.env.AIIA_VISUAL_DISABLED;
    delete process.env.AIIA_DISABLE_TURN_STATUS;
  });

  it("paints footer on turn/tool events and restores working message", async () => {
    /** @type {Record<string, Function[]>} */
    const handlers = {};
    const statuses = new Map();
    /** @type {string[]} */
    const working = [];
    turnStatusExtension({
      on(event, fn) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(fn);
      },
    });

    const ctx = {
      ui: {
        setStatus(key, text) {
          if (text === undefined) statuses.delete(key);
          else statuses.set(key, text);
        },
        setWorkingMessage(message) {
          working.push(message === undefined ? "(default)" : message);
        },
      },
    };

    await handlers.session_start[0]({ type: "session_start" }, ctx);
    assert.equal(statuses.get("turn-status"), "Ready");

    await handlers.turn_start[0]({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
    assert.match(statuses.get("turn-status") || "", /thinking/);

    await handlers.tool_execution_start[0](
      { type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } },
      ctx,
    );
    assert.match(statuses.get("turn-status") || "", /bash npm test/);
    assert.equal(working.at(-1), "bash npm test");

    await handlers.tool_execution_end[0]({ type: "tool_execution_end", toolName: "bash" }, ctx);
    assert.equal(working.at(-1), "(default)");

    await handlers.turn_end[0](
      {
        type: "turn_end",
        message: { usage: { input: 25, output: 4, cacheRead: 75, cacheWrite: 0 } },
      },
      ctx,
    );
    assert.match(statuses.get("turn-status") || "", /✓/);
    assert.match(statuses.get("turn-status") || "", /cache 75%/);

    await handlers.session_shutdown[0]({ type: "session_shutdown" }, ctx);
    assert.equal(statuses.has("turn-status"), false);
  });

  it("factory is a no-op when AIIA_VISUAL_DISABLED=1", () => {
    const prev = process.env.AIIA_VISUAL_DISABLED;
    process.env.AIIA_VISUAL_DISABLED = "1";
    try {
      const handlers = {};
      turnStatusExtension({
        on(event, fn) {
          handlers[event] = fn;
        },
      });
      assert.equal(Object.keys(handlers).length, 0);
    } finally {
      if (prev === undefined) delete process.env.AIIA_VISUAL_DISABLED;
      else process.env.AIIA_VISUAL_DISABLED = prev;
    }
  });
});
