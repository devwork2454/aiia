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
  computeProjectFingerprint,
  isCardStale,
  buildRuleBasedDraft,
  writeProjectDraft,
  applyProjectDraft,
  parseProfileArgs,
} from "../src/context-card.js";
import { clearAiiaHandlers, getAiiaHandler } from "../src/command-registry.js";
import contextCardExtension from "../extensions/context-card.js";
import { buildPromptSnapshot, clearSnapshotSections } from "../src/prompt-snapshot.js";

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

  test("fingerprint stable for same files; stale when missing fingerprint", () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, "package.json"), "{}");
    const fp1 = computeProjectFingerprint(cwd);
    const fp2 = computeProjectFingerprint(cwd);
    assert.equal(fp1, fp2);
    assert.equal(fp1.length, 16);
    const card = normalizeCard({ intent: "x" });
    assert.equal(isCardStale(card, cwd), true);
    card.fingerprint = fp1;
    assert.equal(isCardStale(card, cwd), false);
  });

  test("applyProjectDraft throws on corrupt draft without wiping project card", () => {
    const cwd = tmp();
    const agentDir = path.join(cwd, ".agent");
    fs.mkdirSync(agentDir, { recursive: true });
    const projectCard = path.join(agentDir, "project-card.json");
    const draftFile = path.join(agentDir, "project-card.draft.json");
    fs.writeFileSync(
      projectCard,
      JSON.stringify({ intent: "keep-me", stack: ["node"] }, null, 2) + "\n",
    );
    fs.writeFileSync(draftFile, "{not valid json");

    assert.throws(
      () => applyProjectDraft(cwd),
      /corrupt|invalid JSON/i,
    );
    const kept = JSON.parse(fs.readFileSync(projectCard, "utf8"));
    assert.equal(kept.intent, "keep-me");
    assert.deepEqual(kept.stack, ["node"]);
  });

  test("saveProjectCard stamps fingerprint so card is not stale", () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, "package.json"), "{}");
    const saved = saveProjectCard({ intent: "manual set", stack: ["node"] }, cwd);
    assert.equal(isCardStale(saved, cwd), false);
    assert.equal(saved.fingerprint, computeProjectFingerprint(cwd));
  });

  test("rule draft detects node+python and refresh/apply flow", () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"z"}');
    fs.writeFileSync(path.join(cwd, "pyproject.toml"), "[project]\nname='z'\n");
    fs.writeFileSync(path.join(cwd, "PROGRESS.md"), "## GOAL\nShip context cards\n");
    const draft = buildRuleBasedDraft(cwd);
    assert.ok(draft.stack.includes("node"));
    assert.ok(draft.stack.includes("python"));
    assert.match(draft.intent, /Ship context cards/);
    writeProjectDraft(cwd, draft);
    const applied = applyProjectDraft(cwd);
    assert.equal(applied.intent, draft.intent);
    assert.equal(applied.fingerprint, computeProjectFingerprint(cwd));
    assert.ok(!fs.existsSync(path.join(cwd, ".agent", "project-card.draft.json")));
  });

  test("parseProfileArgs", () => {
    assert.equal(parseProfileArgs("").action, "show");
    assert.equal(parseProfileArgs("refresh").action, "refresh");
    assert.equal(parseProfileArgs("apply").action, "apply");
    assert.deepEqual(parseProfileArgs("set intent hello"), {
      action: "set",
      scope: "project",
      field: "intent",
      value: "hello",
    });
    assert.equal(parseProfileArgs("set --user tags a,b").scope, "user");
  });

  test("extension registers /profile and off hints AIIA_PROFILE_DISABLED", async () => {
    clearAiiaHandlers();
    const cwd = tmp();
    const commands = {};
    const mockPi = {
      registerCommand: (n, o) => {
        commands[n] = o;
      },
      on() {},
    };
    contextCardExtension(mockPi);
    assert.equal(typeof commands.profile?.handler, "function");
    assert.equal(typeof getAiiaHandler("profile"), "function");

    const notes = [];
    const ctx = { cwd, ui: { notify: (m) => notes.push(m) } };
    await commands.profile.handler("off", ctx);
    assert.ok(notes.some((n) => /AIIA_PROFILE_DISABLED/.test(n)));
  });

  test("extension registers profile snapshot section", () => {
    const cwd = tmp();
    const envPath = path.join(tmp(), "user.json");
    const env = { AIIA_USER_CARD_PATH: envPath };
    saveUserCard({ intent: "inject-me", stack: ["node"] }, env);
    process.env.AIIA_USER_CARD_PATH = envPath;
    delete process.env.AIIA_PROFILE_DISABLED;

    clearSnapshotSections();
    contextCardExtension({
      registerCommand() {},
      on() {},
    });
    const text = buildPromptSnapshot({ cwd, env: process.env });
    assert.match(text, /inject-me/);

    process.env.AIIA_PROFILE_DISABLED = "1";
    assert.equal(buildPromptSnapshot({ cwd, env: process.env }), "");
    delete process.env.AIIA_PROFILE_DISABLED;
    clearSnapshotSections();
  });
});
