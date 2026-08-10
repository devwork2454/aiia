import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildImpKickoffMessage,
  parseImpArgs,
  resolveImpDelivery,
  IMP_SKILL_HINT,
} from "../src/imp-command.js";
import impExtension from "../extensions/imp.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Pi /imp support", () => {
  it("skill file exists in repo", () => {
    const skill = path.join(root, ".agents/skills/imp/SKILL.md");
    assert.ok(fs.existsSync(skill), "missing .agents/skills/imp/SKILL.md");
    const body = fs.readFileSync(skill, "utf8");
    assert.match(body, /name:\s*imp/);
    assert.match(body, /\/goal/);
    assert.doesNotMatch(body, /OhMy|Sisyphus|\/next/);
  });

  it("parseImpArgs empty vs task", () => {
    assert.deepEqual(parseImpArgs(""), { taskText: "", empty: true });
    assert.deepEqual(parseImpArgs("  重构模块  "), {
      taskText: "重构模块",
      empty: false,
    });
  });

  it("buildImpKickoffMessage empty shows usage", () => {
    const msg = buildImpKickoffMessage("");
    assert.match(msg, /用法：\/imp/);
    assert.match(msg, /skill `imp`/);
    assert.ok(msg.includes(IMP_SKILL_HINT));
  });

  it("buildImpKickoffMessage includes protocol hard constraints", () => {
    const msg = buildImpKickoffMessage("修登录 bug");
    assert.match(msg, /RAW_TASK: 修登录 bug/);
    assert.match(msg, /scratchpad/);
    assert.match(msg, /optimized_prompt/);
    assert.match(msg, /verify\.sh/);
    assert.match(msg, /skill `imp`/);
  });

  it("resolveImpDelivery idle vs busy", () => {
    assert.deepEqual(resolveImpDelivery({ isIdle: true }), { action: "send" });
    const busy = resolveImpDelivery({ isIdle: false });
    assert.equal(busy.deliverAs, "steer");
  });

  it("extension registers /imp and sendUserMessage on invoke", async () => {
    const commands = new Map();
    const sent = [];
    const pi = {
      registerCommand(name, def) {
        commands.set(name, def);
      },
      sendUserMessage(msg, opts) {
        sent.push({ msg, opts });
      },
    };
    impExtension(pi);
    assert.ok(commands.has("imp"));
    await commands.get("imp").handler("重构认证", {
      isIdle: () => true,
      ui: { notify() {} },
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].msg, /RAW_TASK: 重构认证/);
  });

  it("empty args notify usage without sendUserMessage", async () => {
    const commands = new Map();
    const sent = [];
    const notes = [];
    const pi = {
      registerCommand(name, def) {
        commands.set(name, def);
      },
      sendUserMessage(msg) {
        sent.push(msg);
      },
    };
    impExtension(pi);
    await commands.get("imp").handler("", {
      isIdle: () => true,
      ui: { notify(m) { notes.push(m); } },
    });
    assert.equal(sent.length, 0);
    assert.ok(notes.some((n) => /用法：\/imp/.test(n)));
  });

  it("busy agent uses steer delivery", async () => {
    const commands = new Map();
    const sent = [];
    const pi = {
      registerCommand(name, def) {
        commands.set(name, def);
      },
      sendUserMessage(msg, opts) {
        sent.push({ msg, opts });
      },
    };
    impExtension(pi);
    await commands.get("imp").handler("任务", {
      isIdle: () => false,
      ui: { notify() {} },
    });
    assert.equal(sent[0].opts?.deliverAs, "steer");
  });
});
