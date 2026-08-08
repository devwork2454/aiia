import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateToolCall } from "../src/policy.js";

describe("evaluateToolCall", () => {
  it("allows read-ish shell", () => {
    assert.equal(evaluateToolCall("bash", { command: "ls -la" }).block, false);
  });
  it("blocks rm -rf /", () => {
    assert.equal(evaluateToolCall("bash", { command: "rm -rf /" }).block, true);
  });
  it("blocks rm -rf ~", () => {
    assert.equal(evaluateToolCall("bash", { command: "rm -rf ~/" }).block, true);
  });
  it("blocks sudo", () => {
    assert.equal(evaluateToolCall("bash", { command: "sudo apt install x" }).block, true);
  });
  it("blocks force push", () => {
    assert.equal(evaluateToolCall("shell", { command: "git push --force origin main" }).block, true);
  });
  it("blocks chmod -R 777 /", () => {
    assert.equal(evaluateToolCall("bash", { command: "chmod -R 777 /" }).block, true);
  });
  it("ignores non-shell tools", () => {
    assert.equal(evaluateToolCall("read", { path: "/etc/passwd" }).block, false);
  });
});
