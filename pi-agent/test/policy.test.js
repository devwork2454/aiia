import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateToolCallEvent, extractCommand } from "../src/policy.js";

// Uses the REAL Pi event shape: { toolName, input: { command } }
const ev = (toolName, command) => ({ type: "tool_call", toolName, input: { command } });

describe("evaluateToolCallEvent (real event shape)", () => {
  it("extractCommand reads event.input.command", () => {
    assert.equal(extractCommand(ev("bash", "echo hi")), "echo hi");
  });
  it("allows read-ish shell", () => {
    assert.equal(evaluateToolCallEvent(ev("bash", "ls -la")).block, false);
  });
  it("blocks rm -rf /", () => {
    assert.equal(evaluateToolCallEvent(ev("bash", "rm -rf /")).block, true);
  });
  it("blocks rm -rf ~", () => {
    assert.equal(evaluateToolCallEvent(ev("bash", "rm -rf ~/")).block, true);
  });
  it("blocks sudo", () => {
    assert.equal(evaluateToolCallEvent(ev("bash", "sudo apt install x")).block, true);
  });
  it("blocks force push", () => {
    assert.equal(evaluateToolCallEvent(ev("shell", "git push --force origin main")).block, true);
  });
  it("blocks chmod -R 777 /", () => {
    assert.equal(evaluateToolCallEvent(ev("bash", "chmod -R 777 /")).block, true);
  });
  it("ignores non-shell tools", () => {
    assert.equal(evaluateToolCallEvent({ toolName: "read", input: { path: "/etc/passwd" } }).block, false);
  });
  it("still handles legacy args shape (robustness)", () => {
    assert.equal(evaluateToolCallEvent({ toolName: "bash", args: { command: "rm -rf /" } }).block, true);
  });
});
