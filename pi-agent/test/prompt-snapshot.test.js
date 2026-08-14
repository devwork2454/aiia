import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAPSHOT_CHARS,
  SNAPSHOT_START,
  applySnapshotToMessages,
  buildPromptSnapshot,
  clearSnapshotSections,
  hashSnapshot,
  isSnapshotDisabled,
  isSnapshotMessage,
  listSnapshotSectionIds,
  makeSnapshotMessage,
  registerSnapshotSection,
  upsertSnapshotMessages,
} from "../src/prompt-snapshot.js";
import promptSnapshotExtension from "../extensions/prompt-snapshot.js";
import capabilityCatalogExtension from "../extensions/capability-catalog.js";

describe("prompt-snapshot helpers", () => {
  beforeEach(() => {
    clearSnapshotSections();
  });

  it("registers sections and builds a stable joined body", () => {
    registerSnapshotSection("b", () => "bravo");
    registerSnapshotSection("a", () => "alpha");
    assert.deepEqual(listSnapshotSectionIds(), ["b", "a"]);
    assert.equal(buildPromptSnapshot(), "bravo\n\nalpha");
    assert.equal(hashSnapshot("x"), hashSnapshot("x"));
    assert.notEqual(hashSnapshot("x"), hashSnapshot("y"));
  });

  it("skips empty/throwing sections and caps length", () => {
    registerSnapshotSection("empty", () => "");
    registerSnapshotSection("boom", () => {
      throw new Error("nope");
    });
    registerSnapshotSection("ok", () => "keep");
    assert.equal(buildPromptSnapshot(), "keep");

    registerSnapshotSection("huge", () => "H".repeat(MAX_SNAPSHOT_CHARS + 50));
    const body = buildPromptSnapshot();
    assert.ok(body.length <= MAX_SNAPSHOT_CHARS);
    assert.ok(body.endsWith("…"));
  });

  it("upserts after the first system message and replaces in place", () => {
    const first = upsertSnapshotMessages([{ role: "user", content: "hi" }], "facts");
    assert.equal(first[0].role, "system");
    assert.match(first[0].content, /AIIA context snapshot/);
    assert.match(first[0].content, /facts/);

    const withSys = upsertSnapshotMessages(
      [
        { role: "system", content: "base" },
        { role: "user", content: "hi" },
      ],
      "facts",
    );
    assert.equal(withSys[0].content, "base");
    assert.equal(isSnapshotMessage(withSys[1]), true);

    const replaced = upsertSnapshotMessages(withSys, "facts-2");
    assert.match(replaced[1].content, /facts-2/);
    assert.equal(replaced.filter(isSnapshotMessage).length, 1);

    const cleared = upsertSnapshotMessages(replaced, "");
    assert.equal(cleared.some(isSnapshotMessage), false);
  });

  it("applySnapshotToMessages is a no-op when hash is unchanged", () => {
    const body = "stable-facts";
    const first = applySnapshotToMessages([{ role: "user", content: "hi" }], body);
    assert.ok(first?.messages);
    const again = applySnapshotToMessages(first.messages, body);
    assert.equal(again, null);
    const gone = applySnapshotToMessages(first.messages, "");
    assert.equal(gone.messages.some(isSnapshotMessage), false);
    assert.equal(applySnapshotToMessages([{ role: "user", content: "hi" }], ""), null);
    assert.match(makeSnapshotMessage(body).content, /hash:/);
  });

  it("isSnapshotDisabled honors env", () => {
    assert.equal(isSnapshotDisabled({}), false);
    assert.equal(isSnapshotDisabled({ AIIA_PROMPT_SNAPSHOT_DISABLED: "1" }), true);
  });
});

describe("prompt-snapshot extension", () => {
  beforeEach(() => {
    clearSnapshotSections();
    delete process.env.AIIA_PROMPT_SNAPSHOT_DISABLED;
  });

  it("rewrites context once, then skips an identical snapshot", async () => {
    const hooks = {};
    promptSnapshotExtension({
      on(event, fn) {
        hooks[event] = fn;
      },
    });
    capabilityCatalogExtension({ on() {} });
    assert.equal(typeof hooks.context, "function");

    const first = await hooks.context({ messages: [{ role: "user", content: "hi" }] }, {});
    assert.ok(first.messages.some(isSnapshotMessage));
    assert.match(JSON.stringify(first.messages), /capability catalog/);

    const second = await hooks.context({ messages: first.messages }, {});
    assert.equal(second, null);
  });

  it("factory is a no-op when AIIA_PROMPT_SNAPSHOT_DISABLED only skips apply", async () => {
    const hooks = {};
    promptSnapshotExtension({
      on(event, fn) {
        hooks[event] = fn;
      },
    });
    registerSnapshotSection("x", () => "block");
    process.env.AIIA_PROMPT_SNAPSHOT_DISABLED = "1";
    const out = await hooks.context({ messages: [{ role: "user", content: "hi" }] }, {});
    assert.equal(out, undefined);
  });
});
