import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_EXTENSIONS,
  VISUAL_EXTENSIONS,
  isExtensionEnabled,
  isCatalogToolEnabled,
} from "../src/extension-profile.js";
import { buildCapabilityCatalog } from "../src/capability-catalog.js";
import cronSchedulerExtension from "../extensions/cron-scheduler.js";
import safetyExtension from "../extensions/safety.js";

describe("extension profile (lean default)", () => {
  test("core ids are enabled with empty env", () => {
    const env = {};
    for (const id of CORE_EXTENSIONS) {
      assert.equal(isExtensionEnabled(id, env), true, id);
    }
    assert.equal(isExtensionEnabled("cron-scheduler", env), false);
    assert.equal(isExtensionEnabled("web-search-proxy", env), false);
    assert.equal(isExtensionEnabled("auto-router", env), false);
  });

  test("visual extras are enabled with empty env", () => {
    const env = {};
    for (const id of VISUAL_EXTENSIONS) {
      assert.equal(isExtensionEnabled(id, env), true, id);
    }
    assert.equal(CORE_EXTENSIONS.includes("ui-task-board"), false);
    assert.equal(CORE_EXTENSIONS.includes("compact-progress"), false);
    assert.equal(CORE_EXTENSIONS.includes("turn-status"), false);
  });

  test("AIIA_VISUAL_DISABLED turns off visual extras only", () => {
    const env = { AIIA_VISUAL_DISABLED: "1" };
    assert.equal(isExtensionEnabled("ui-task-board", env), false);
    assert.equal(isExtensionEnabled("compact-progress", env), false);
    assert.equal(isExtensionEnabled("turn-status", env), false);
    assert.equal(isExtensionEnabled("safety", env), true);
    assert.equal(isExtensionEnabled("cron-scheduler", env), false);
  });

  test("AIIA_EXTENSIONS=all enables optional", () => {
    const env = { AIIA_EXTENSIONS: "all" };
    assert.equal(isExtensionEnabled("cron-scheduler", env), true);
    assert.equal(isExtensionEnabled("safety", env), true);
  });

  test("AIIA_EXTRA_EXTENSIONS appends to core", () => {
    const env = { AIIA_EXTRA_EXTENSIONS: "cron-scheduler, kb-search" };
    assert.equal(isExtensionEnabled("cron-scheduler", env), true);
    assert.equal(isExtensionEnabled("kb-search", env), true);
    assert.equal(isExtensionEnabled("web-search-proxy", env), false);
  });

  test("catalog hides optional tools by default", () => {
    const lean = buildCapabilityCatalog({ env: {} });
    assert.match(lean, /remember/);
    assert.doesNotMatch(lean, /register_cron_task/);
    assert.doesNotMatch(lean, /spawn_worktree_subagent/);
    assert.equal(isCatalogToolEnabled("remember", {}), true);
    assert.equal(isCatalogToolEnabled("update_todos", {}), true);
    assert.equal(isCatalogToolEnabled("update_todos", { AIIA_VISUAL_DISABLED: "1" }), false);
    assert.equal(isCatalogToolEnabled("register_cron_task", {}), false);
  });

  test("optional factory is a no-op by default; core still registers", () => {
    const prev = process.env.AIIA_EXTENSIONS;
    const extra = process.env.AIIA_EXTRA_EXTENSIONS;
    delete process.env.AIIA_EXTENSIONS;
    delete process.env.AIIA_EXTRA_EXTENSIONS;
    const tools = {};
    try {
      cronSchedulerExtension({
        registerTool: (t) => {
          tools[t.name] = t;
        },
        on: () => {},
      });
    } finally {
      if (prev === undefined) delete process.env.AIIA_EXTENSIONS;
      else process.env.AIIA_EXTENSIONS = prev;
      if (extra === undefined) delete process.env.AIIA_EXTRA_EXTENSIONS;
      else process.env.AIIA_EXTRA_EXTENSIONS = extra;
    }
    assert.equal(tools.register_cron_task, undefined);

    const hooks = {};
    safetyExtension({
      on: (ev, fn) => {
        hooks[ev] = fn;
      },
    });
    assert.equal(typeof hooks.tool_call, "function");
  });

  test("every gated factory gates on its own file basename", () => {
    // Extension identity is a hardcoded string per factory that must match the
    // filename Pi loads. A rename without updating the gate silently enables the
    // extension in the default profile (profile can't recognize the new id).
    const extDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extensions");
    for (const file of fs.readdirSync(extDir).filter((f) => f.endsWith(".js"))) {
      const id = file.replace(/\.js$/, "");
      const src = fs.readFileSync(path.join(extDir, file), "utf8");
      const m = src.match(/isExtensionEnabled\(\s*"([^"]+)"\s*\)/);
      if (!m) continue; // core / always-on extensions have no gate
      assert.equal(m[1], id, `extension ${file} gates on "${m[1]}" but its basename is "${id}"`);
    }
  });
});
