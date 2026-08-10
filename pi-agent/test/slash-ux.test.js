import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SLASH_ALLOWLIST,
  filterSlashAutocompleteItems,
  parseAiiaArgs,
  resolveSlashAllowlist,
  routeAiiaSubcommand,
  isSlashUxDisabled,
} from "../src/slash-visibility.js";
import {
  clearAiiaHandlers,
  registerAiiaHandler,
  getAiiaHandler,
} from "../src/command-registry.js";
import slashUxExtension from "../extensions/slash-ux.js";

describe("slash visibility", () => {
  test("default allowlist and env override", () => {
    assert.ok(DEFAULT_SLASH_ALLOWLIST.includes("goal"));
    assert.ok(DEFAULT_SLASH_ALLOWLIST.includes("imp"));
    assert.ok(DEFAULT_SLASH_ALLOWLIST.includes("aiia"));
    const custom = resolveSlashAllowlist({ AIIA_SLASH_ALLOWLIST: "goal,vault" });
    assert.deepEqual(custom.sort(), ["aiia", "goal", "vault"].sort());
  });

  test("filter hides managed non-allowlisted and skill commands", () => {
    const items = [
      { value: "settings" },
      { value: "goal" },
      { value: "memory" },
      { value: "sync" },
      { value: "skill:foo" },
      { value: "aiia" },
    ];
    const filtered = filterSlashAutocompleteItems(items, [...DEFAULT_SLASH_ALLOWLIST]);
    const names = filtered.map((i) => i.value);
    assert.ok(names.includes("settings"));
    assert.ok(names.includes("goal"));
    assert.ok(names.includes("aiia"));
    assert.ok(!names.includes("memory"));
    assert.ok(!names.includes("sync"));
    assert.ok(!names.includes("skill:foo"));
  });

  test("parseAiiaArgs + routeAiiaSubcommand", async () => {
    assert.deepEqual(parseAiiaArgs(""), { subcommand: "help", rest: "" });
    assert.deepEqual(parseAiiaArgs("memory search x"), {
      subcommand: "memory",
      rest: "search x",
    });

    const notes = [];
    const ctx = { ui: { notify: (m) => notes.push(m) } };
    const calls = [];
    await routeAiiaSubcommand(
      "memory",
      "search foo",
      {
        memory: async (args) => {
          calls.push(args);
        },
      },
      ctx,
    );
    assert.deepEqual(calls, ["search foo"]);

    await routeAiiaSubcommand("help", "", { memory: async () => {} }, ctx);
    assert.ok(notes.some((n) => /AIIA command hub/.test(n)));

    const bad = await routeAiiaSubcommand("nope", "", {}, ctx);
    assert.equal(bad.ok, false);
  });

  test("slash-ux registers /aiia and autocomplete wrapper", async () => {
    clearAiiaHandlers();
    registerAiiaHandler("memory", async (args, ctx) => {
      ctx.ui.notify(`mem:${args}`);
    });

    const commands = {};
    let factory = null;
    const pi = {
      registerCommand: (n, o) => {
        commands[n] = o;
      },
      addAutocompleteProvider: (fn) => {
        factory = fn;
      },
    };
    slashUxExtension(pi);
    assert.equal(typeof commands.aiia?.handler, "function");
    assert.equal(typeof factory, "function");

    const notes = [];
    await commands.aiia.handler("memory search x", {
      ui: { notify: (m) => notes.push(m) },
    });
    assert.ok(notes.some((n) => n === "mem:search x"));
    assert.equal(typeof getAiiaHandler("memory"), "function");

    const inner = {
      async getSuggestions() {
        return {
          prefix: "/",
          items: [
            { value: "goal" },
            { value: "memory" },
            { value: "settings" },
            { value: "skill:x" },
          ],
        };
      },
      applyCompletion() {
        return { lines: [], cursorLine: 0, cursorCol: 0 };
      },
    };
    const wrapped = factory(inner);
    const sug = await wrapped.getSuggestions([""], 0, 0, { signal: AbortSignal.abort() });
    const vals = sug.items.map((i) => i.value);
    assert.ok(vals.includes("goal"));
    assert.ok(vals.includes("settings"));
    assert.ok(!vals.includes("memory"));
    assert.ok(!vals.includes("skill:x"));

    assert.equal(isSlashUxDisabled({ AIIA_SLASH_UX_DISABLED: "1" }), true);
  });
});
