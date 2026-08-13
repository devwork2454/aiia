import { describe, it, before } from "node:test";
import { enableAllExtensions } from "./with-all-extensions.js";
import assert from "node:assert/strict";
import {
  advancePct,
  formatCompactProgressLine,
  renderBar,
  BAR_WIDTH,
} from "../src/compact-progress.js";
import compactProgressExtension from "../extensions/compact-progress.js";

describe("compact-progress helpers", () => {
  it("renderBar fills proportionally", () => {
    assert.equal(renderBar(0, 10), "░░░░░░░░░░");
    assert.equal(renderBar(100, 10), "██████████");
    assert.equal(renderBar(50, 10), "█████░░░░░");
    assert.equal(renderBar(50).length, BAR_WIDTH);
  });

  it("advancePct climbs toward 90 then pulses", () => {
    let p = 10;
    for (let i = 0; i < 80; i++) p = advancePct(p, 0);
    assert.ok(p >= 80 && p <= 90, `expected near 90, got ${p}`);
    const a = advancePct(90, 0);
    const b = advancePct(90, 1000);
    assert.ok(a >= 86 && a <= 90);
    assert.ok(b >= 86 && b <= 90);
  });

  it("formatCompactProgressLine includes bar and tokens", () => {
    const line = formatCompactProgressLine({
      pct: 42,
      reason: "manual",
      tokensBefore: 12345,
    });
    assert.match(line, /Compact \[/);
    assert.match(line, /42%/);
    assert.match(line, /manual/);
    assert.match(line, /12,?345 tok/);
    assert.match(formatCompactProgressLine({ pct: 100, done: true }), /100%.*done/);
  });
});

describe("compact-progress extension", () => {
  before(() => {
    enableAllExtensions();
  });

  it("starts bar on session_before_compact and clears on session_compact", async () => {
    /** @type {Record<string, Function[]>} */
    const handlers = {};
    const statuses = new Map();
    const widgets = new Map();
    const pi = {
      on(event, fn) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(fn);
      },
    };
    compactProgressExtension(pi);

    const ctx = {
      ui: {
        setStatus(key, text) {
          if (text === undefined) statuses.delete(key);
          else statuses.set(key, text);
        },
        setWidget(key, content) {
          if (content === undefined) widgets.delete(key);
          else widgets.set(key, content);
        },
      },
    };

    const ac = new AbortController();
    await handlers.session_before_compact[0](
      {
        reason: "manual",
        preparation: { tokensBefore: 50000 },
        signal: ac.signal,
      },
      ctx,
    );

    assert.ok(statuses.get("compact-progress")?.includes("Compact ["));
    assert.ok(widgets.get("compact-progress")?.[0]?.includes("%"));

    // Allow a couple ticks
    await new Promise((r) => setTimeout(r, 280));
    const mid = statuses.get("compact-progress") || "";
    assert.match(mid, /\d+%/);

    await handlers.session_compact[0]({}, ctx);
    // finish paints 100% briefly
    assert.match(statuses.get("compact-progress") || "", /100%/);

    await new Promise((r) => setTimeout(r, 500));
    assert.equal(statuses.has("compact-progress"), false);
    assert.equal(widgets.has("compact-progress"), false);
  });

  it("clears on abort signal", async () => {
    const handlers = {};
    const statuses = new Map();
    const pi = {
      on(event, fn) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(fn);
      },
    };
    compactProgressExtension(pi);
    const ctx = {
      ui: {
        setStatus(key, text) {
          if (text === undefined) statuses.delete(key);
          else statuses.set(key, text);
        },
        setWidget() {},
      },
    };
    const ac = new AbortController();
    await handlers.session_before_compact[0](
      { reason: "threshold", preparation: { tokensBefore: 1 }, signal: ac.signal },
      ctx,
    );
    assert.ok(statuses.has("compact-progress"));
    ac.abort();
    assert.equal(statuses.has("compact-progress"), false);
  });
});
