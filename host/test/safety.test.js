import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preToolCheck } from "../src/safety.js";

describe("preToolCheck", () => {
  it("allows read-ish shell", () => {
    const r = preToolCheck("bash", { command: "ls -la" });
    assert.equal(r.status, "ALLOW");
  });

  it("denies rm -rf /", () => {
    const r = preToolCheck("bash", { command: "rm -rf /" });
    assert.equal(r.status, "DENY");
  });

  it("denies force push", () => {
    const r = preToolCheck("bash", { command: "git push --force origin main" });
    assert.equal(r.status, "DENY");
  });

  it("ignores non-shell tools", () => {
    const r = preToolCheck("read", { path: "/etc/passwd" });
    assert.equal(r.status, "ALLOW");
  });
});
