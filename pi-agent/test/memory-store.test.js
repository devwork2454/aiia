import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory-store.js";

describe("MemoryStore", () => {
  let dir, store;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "aiia-mem-"));
    store = new MemoryStore(join(dir, "t.db"));
  });
  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds and lists", () => {
    const id = store.add({ content: "prefer concise answers" });
    assert.ok(id > 0);
    const items = store.list();
    assert.ok(items.some((m) => m.content.includes("concise")));
  });

  it("ranks active memories by weight", () => {
    store.add({ content: "project uses Node", category: "coding_style", initialStrength: 0.9 });
    const active = store.active({ threshold: 0.01 });
    assert.ok(active.length >= 1);
    assert.ok(active.some((m) => m.includes("concise") || m.includes("Node")));
  });

  it("removes", () => {
    const id = store.add({ content: "temp" });
    assert.equal(store.remove(id), true);
    assert.equal(store.remove(999999), false);
  });
});
