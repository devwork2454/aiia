import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseGoalArgs,
  buildGoalKickoffMessage,
  resolveGoalDelivery,
  GOAL_SKILL_HINT,
} from "../src/goal-command.js";
import goalExtension from "../extensions/goal.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Pi /goal support", () => {
  test("skill file exists in repo", () => {
    const skill = path.join(root, ".agents/skills/goal/SKILL.md");
    assert.ok(fs.existsSync(skill), "missing .agents/skills/goal/SKILL.md");
    const body = fs.readFileSync(skill, "utf8");
    assert.match(body, /停机条件/);
    assert.match(body, /verify\.sh/);
  });

  test("parseGoalArgs empty falls back to PROGRESS", () => {
    const a = parseGoalArgs("");
    assert.equal(a.fromProgress, true);
    assert.match(a.goalText, /PROGRESS/);
    const b = parseGoalArgs("  实现 foo  ");
    assert.equal(b.fromProgress, false);
    assert.equal(b.goalText, "实现 foo");
  });

  test("buildGoalKickoffMessage includes protocol hard constraints", () => {
    const msg = buildGoalKickoffMessage("修好 verify");
    assert.match(msg, /\[AIIA \/goal\]/);
    assert.match(msg, /修好 verify/);
    assert.match(msg, /bash \.harness\/verify\.sh/);
    assert.match(msg, /EVAL\.md/);
    assert.ok(msg.includes(GOAL_SKILL_HINT));
  });

  test("resolveGoalDelivery idle vs busy", () => {
    assert.deepEqual(resolveGoalDelivery({ isIdle: true }), { action: "send" });
    const busy = resolveGoalDelivery({ isIdle: false });
    assert.equal(busy.deliverAs, "steer");
  });

  test("extension registers /goal and sendUserMessage on invoke", async () => {
    const commands = {};
    let sent = null;
    const mockPi = {
      registerCommand: (name, opts) => {
        commands[name] = opts;
      },
      sendUserMessage: (msg, opts) => {
        sent = { msg, opts };
      },
    };
    goalExtension(mockPi);
    assert.equal(typeof commands.goal?.handler, "function");

    const notes = [];
    await commands.goal.handler("切片 X", {
      isIdle: () => true,
      ui: { notify: (m) => notes.push(m) },
    });
    assert.ok(sent?.msg);
    assert.match(sent.msg, /切片 X/);
    assert.match(sent.msg, /verify\.sh/);
    assert.ok(notes.length >= 1);
  });

  test("busy agent uses steer delivery", async () => {
    let sent = null;
    const mockPi = {
      registerCommand: (_n, opts) => {
        mockPi._cmd = opts;
      },
      sendUserMessage: (msg, opts) => {
        sent = { msg, opts };
      },
    };
    goalExtension(mockPi);
    await mockPi._cmd.handler("busy goal", {
      isIdle: () => false,
      ui: { notify: () => {} },
    });
    assert.equal(sent?.opts?.deliverAs, "steer");
  });
});
