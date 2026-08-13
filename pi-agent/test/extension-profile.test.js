import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_EXTENSIONS,
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
});
