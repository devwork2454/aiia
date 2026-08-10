import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeCard,
  mergeCards,
  loadMergedCard,
  saveUserCard,
  saveProjectCard,
  formatContextCardPrompt,
  isProfileDisabled,
  MAX_PROFILE_PROMPT_CHARS,
} from "../src/context-card.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aiia-card-"));
}

describe("context-card store", () => {
  test("normalize fills defaults and clamps confidence", () => {
    const c = normalizeCard({ intent: "x", confidence: 9, stack: "node" });
    assert.equal(c.version, 1);
    assert.equal(c.intent, "x");
    assert.deepEqual(c.stack, []); // non-array discarded
    assert.ok(c.confidence <= 1);
  });

  test("merge: project overrides scalars; empty project arrays keep user", () => {
    const user = normalizeCard({
      intent: "u",
      stack: ["python"],
      avoid_tools: ["kb_search"],
      user_tags: ["zh"],
    });
    const project = normalizeCard({
      intent: "p",
      stack: ["node"],
      avoid_tools: [],
      user_tags: ["concise"],
    });
    const m = mergeCards(user, project);
    assert.equal(m.intent, "p");
    assert.deepEqual(m.stack, ["node"]);
    assert.deepEqual(m.avoid_tools, ["kb_search"]); // project empty → keep user
    assert.deepEqual(m.user_tags, ["concise"]); // project non-empty → replace
  });

  test("save/load merged + prompt bounds", () => {
    const cwd = tmp();
    const env = { AIIA_USER_CARD_PATH: path.join(tmp(), "user.json") };
    saveUserCard(
      { intent: "life agent", user_tags: ["zh"], avoid_tools: ["spawn_worktree_subagent"] },
      env,
    );
    fs.mkdirSync(path.join(cwd, ".agent"), { recursive: true });
    saveProjectCard({ intent: "aiia", stack: ["node", "pi"] }, cwd);
    const m = loadMergedCard({ cwd, env });
    assert.equal(m.intent, "aiia");
    assert.deepEqual(m.stack, ["node", "pi"]);
    const prompt = formatContextCardPrompt(m);
    assert.match(prompt, /\[AIIA context card\]/);
    assert.match(prompt, /aiia/);
    assert.ok(prompt.length <= MAX_PROFILE_PROMPT_CHARS);
    assert.equal(formatContextCardPrompt(normalizeCard({})), "");
  });

  test("kill switch", () => {
    assert.equal(isProfileDisabled({ AIIA_PROFILE_DISABLED: "1" }), true);
  });
});
