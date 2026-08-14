import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  STYLE_PRESETS,
  loadPrefs,
  saveGlobalPrefs,
  resetGlobalPrefs,
  formatReplyPrefsPrompt,
  parseReplyArgs,
  resolveLanguageDirective,
  resolveStyleDirective,
  globalPrefsPath,
} from "../src/reply-prefs.js";
import replyPrefsExtension from "../extensions/reply-prefs.js";
import { buildPromptSnapshot, clearSnapshotSections } from "../src/prompt-snapshot.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aiia-reply-"));
}

describe("Pi reply preferences", () => {
  test("parseReplyArgs", () => {
    assert.equal(parseReplyArgs("").action, "show");
    assert.deepEqual(parseReplyArgs("lang zh-CN"), { action: "lang", value: "zh-CN" });
    assert.deepEqual(parseReplyArgs("style concise"), { action: "style", value: "concise" });
    assert.equal(parseReplyArgs("off").action, "enable");
    assert.equal(parseReplyArgs("bogus").action, "error");
  });

  test("language and style directives", () => {
    assert.match(resolveLanguageDirective("zh-CN"), /Simplified Chinese/);
    assert.match(resolveLanguageDirective("en"), /English/);
    assert.match(resolveStyleDirective("concise"), /Concise/);
    assert.match(resolveStyleDirective("custom:短句"), /短句/);
    assert.ok(STYLE_PRESETS.technical);
  });

  test("save/load global prefs and format prompt", () => {
    const dir = tmp();
    const file = path.join(dir, "reply-prefs.json");
    const env = { AIIA_REPLY_PREFS_PATH: file };
    const saved = saveGlobalPrefs({ language: "zh-CN", style: "concise" }, env);
    assert.equal(saved.language, "zh-CN");
    assert.equal(globalPrefsPath(env), file);
    const prefs = loadPrefs({ cwd: dir, env });
    assert.equal(prefs.language, "zh-CN");
    assert.equal(prefs.style, "concise");
    const prompt = formatReplyPrefsPrompt(prefs);
    assert.match(prompt, /Reply Preferences/);
    assert.match(prompt, /Simplified Chinese/);
    assert.match(prompt, /Concise/);
    resetGlobalPrefs(env);
    const empty = formatReplyPrefsPrompt(loadPrefs({ cwd: dir, env }));
    assert.equal(empty, "");
  });

  test("project override and env disable", () => {
    const cwd = tmp();
    const g = path.join(tmp(), "g.json");
    saveGlobalPrefs({ language: "en", style: "detailed" }, { AIIA_REPLY_PREFS_PATH: g });
    fs.mkdirSync(path.join(cwd, ".agent"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".agent", "reply-prefs.json"),
      JSON.stringify({ language: "zh-CN" }),
    );
    const prefs = loadPrefs({ cwd, env: { AIIA_REPLY_PREFS_PATH: g } });
    assert.equal(prefs.language, "zh-CN");
    assert.equal(prefs.style, "detailed");
    const off = loadPrefs({
      cwd,
      env: { AIIA_REPLY_PREFS_PATH: g, AIIA_REPLY_DISABLED: "1" },
    });
    assert.equal(off.enabled, false);
    assert.equal(formatReplyPrefsPrompt(off), "");
  });

  test("extension registers /reply and injects prompt", async () => {
    const dir = tmp();
    const file = path.join(dir, "reply-prefs.json");
    process.env.AIIA_REPLY_PREFS_PATH = file;
    saveGlobalPrefs({ language: "zh-CN", style: "concise" }, process.env);

    const commands = {};
    const notes = [];
    const mockPi = {
      registerCommand: (n, o) => {
        commands[n] = o;
      },
      on() {},
    };
    clearSnapshotSections();
    replyPrefsExtension(mockPi);
    assert.equal(typeof commands.reply?.handler, "function");
    await commands.reply.handler("lang en", {
      cwd: dir,
      ui: { notify: (m) => notes.push(m) },
    });
    assert.ok(notes.some((n) => /English|en/i.test(n)));
    const text = buildPromptSnapshot({ cwd: dir, env: process.env });
    assert.match(text, /Reply Preferences|English/i);
    clearSnapshotSections();
    delete process.env.AIIA_REPLY_PREFS_PATH;
  });
});
