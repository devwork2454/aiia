import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CATALOG_CHARS,
  buildCapabilityCatalog,
  formatCapabilityCatalogPrompt,
  isCatalogDisabled,
} from "../src/capability-catalog.js";
import capabilityCatalogExtension from "../extensions/capability-catalog.js";

describe("capability catalog", () => {
  test("buildCapabilityCatalog includes key tools and stays short", () => {
    const text = buildCapabilityCatalog({ env: {} });
    assert.ok(text.length > 0);
    assert.ok(text.length <= MAX_CATALOG_CHARS);
    assert.match(text, /kb_search/);
    assert.match(text, /remember/);
    assert.match(text, /memory_search/);
  });

  test("truncates oversized catalogs", () => {
    const tools = Array.from({ length: 200 }, (_, i) => ({
      name: `tool_${i}_${"x".repeat(40)}`,
      when: "y".repeat(80),
    }));
    const text = buildCapabilityCatalog({ tools, env: {}, maxChars: 500 });
    assert.ok(text.length <= 500);
    assert.ok(text.endsWith("…"));
  });

  test("disabled env yields empty catalog / no prompt", () => {
    assert.equal(isCatalogDisabled({ AIIA_CAPABILITY_CATALOG_DISABLED: "1" }), true);
    assert.equal(buildCapabilityCatalog({ env: { AIIA_CAPABILITY_CATALOG_DISABLED: "1" } }), "");
    assert.equal(formatCapabilityCatalogPrompt(""), "");
  });

  test("formatCapabilityCatalogPrompt wraps body", () => {
    const p = formatCapabilityCatalogPrompt("hello");
    assert.match(p, /\[AIIA capability catalog\]/);
    assert.match(p, /hello/);
  });

  test("extension injects on before_agent_start unless disabled", async () => {
    const hooks = {};
    const pi = {
      on: (ev, fn) => {
        hooks[ev] = fn;
      },
    };
    capabilityCatalogExtension(pi);
    assert.equal(typeof hooks.before_agent_start, "function");

    const prev = process.env.AIIA_CAPABILITY_CATALOG_DISABLED;
    delete process.env.AIIA_CAPABILITY_CATALOG_DISABLED;
    try {
      const res = await hooks.before_agent_start();
      assert.match(res.appendSystemPrompt, /capability catalog/);
      assert.match(res.appendSystemPrompt, /kb_search/);
      assert.ok(res.appendSystemPrompt.length <= MAX_CATALOG_CHARS + 80);

      process.env.AIIA_CAPABILITY_CATALOG_DISABLED = "1";
      const res2 = await hooks.before_agent_start();
      assert.equal(res2, undefined);
    } finally {
      if (prev === undefined) delete process.env.AIIA_CAPABILITY_CATALOG_DISABLED;
      else process.env.AIIA_CAPABILITY_CATALOG_DISABLED = prev;
    }
  });
});

import memoryExtension from "../extensions/memory.js";
import { clearAiiaHandlers } from "../src/command-registry.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory tool-first", () => {
  test("registers memory_search/list tools and handler registry", async () => {
    clearAiiaHandlers();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiia-mem-tools-"));
    const db = path.join(dir, "t.db");
    const prev = process.env.AIIA_DB;
    process.env.AIIA_DB = db;
    try {
      const tools = {};
      const commands = {};
      const pi = {
        on: () => {},
        registerCommand: (n, o) => { commands[n] = o; },
        registerTool: (tool) => { tools[tool.name] = tool; },
      };
      memoryExtension(pi);
      assert.equal(typeof commands.memory?.handler, "function");
      assert.equal(typeof tools.remember?.execute, "function");
      assert.equal(typeof tools.memory_search?.execute, "function");
      assert.equal(typeof tools.memory_list?.execute, "function");
      await tools.remember.execute("1", { content: "prefers tool-first UX" });
      const search = await tools.memory_search.execute("2", { query: "tool-first" });
      assert.match(search.content[0].text, /tool-first/);
    } finally {
      if (prev === undefined) delete process.env.AIIA_DB;
      else process.env.AIIA_DB = prev;
    }
  });
});
