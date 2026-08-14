import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearAiiaHandlers, listAiiaHandlers } from "../src/command-registry.js";
import {
  formatStatusReport,
  getRepoStatus,
  getSkillsState,
  resolveAiiDir,
} from "../src/manager.js";
import manageExtension from "../extensions/manage.js";

describe("manager", () => {
  test("resolveAiiDir points at the repo root", () => {
    const dir = resolveAiiDir();
    assert.ok(fs.existsSync(path.join(dir, "pi-agent")), "pi-agent exists");
    assert.ok(fs.existsSync(path.join(dir, "scripts")), "scripts exists");
    assert.ok(fs.existsSync(path.join(dir, ".agents", "skills")), ".agents/skills exists");
  });

  test("getRepoStatus reads branch + short commit from this git repo", () => {
    const s = getRepoStatus(resolveAiiDir());
    assert.equal(typeof s.branch, "string");
    assert.ok(s.commit, "commit is non-empty");
    assert.match(s.commit, /^[0-9a-f]+$/);
    assert.ok(Array.isArray(s.remotes));
  });

  test("getSkillsState: real dir under HOME is 'conflict', absent is 'not-linked'", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiia-manage-"));
    const skillsDir = path.join(tmp, ".pi", "agent", "skills");
    fs.mkdirSync(path.join(skillsDir, "auto-harness"), { recursive: true });
    const state = getSkillsState(resolveAiiDir(), tmp);
    const auto = state.find((s) => s.name === "auto-harness");
    const goal = state.find((s) => s.name === "goal");
    assert.equal(auto.state, "conflict");
    assert.equal(goal.state, "not-linked");
  });

  test("formatStatusReport renders expected lines", () => {
    const text = formatStatusReport(
      { branch: "main", commit: "abc1234", remotes: ["origin", "gitee"], behind: false },
      [
        { name: "goal", state: "linked" },
        { name: "imp", state: "conflict" },
      ],
      "/repo",
    );
    assert.match(text, /AIIA status/);
    assert.match(text, /dir: +\/repo/);
    assert.match(text, /up to date/);
    assert.match(text, /✔ goal: linked/);
    assert.match(text, /✖ imp: conflict/);
  });

  test("manage extension registers update/status in the /aiia hub", () => {
    clearAiiaHandlers();
    manageExtension({});
    const names = listAiiaHandlers();
    assert.ok(names.includes("update"), `has update, got ${names}`);
    assert.ok(names.includes("status"), `has status, got ${names}`);
  });
});
