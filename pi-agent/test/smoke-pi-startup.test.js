/**
 * Unit coverage for smoke layout detector (temp dirs; no Pi loader / no model).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectHalfSymlinkExtensions } from "./smoke-pi-startup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extensionsDir = join(here, "..", "extensions");

describe("smoke layout detector", () => {
  it("passes when .pi/extensions is absent", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aiia-smoke-unit-"));
    try {
      assert.equal(detectHalfSymlinkExtensions(tmp).ok, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes when .pi/extensions is a real directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aiia-smoke-unit-"));
    try {
      mkdirSync(join(tmp, ".pi", "extensions"), { recursive: true });
      writeFileSync(join(tmp, ".pi", "extensions", "noop.js"), "export default () => {};\n");
      assert.equal(detectHalfSymlinkExtensions(tmp).ok, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails on half-symlink without sibling .pi/src", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aiia-smoke-unit-"));
    try {
      mkdirSync(join(tmp, ".pi"));
      symlinkSync(extensionsDir, join(tmp, ".pi", "extensions"));
      const res = detectHalfSymlinkExtensions(tmp);
      assert.equal(res.ok, false);
      assert.match(res.reason, /half-symlink|sibling|\.pi\/src/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes when symlink has sibling .pi/src", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aiia-smoke-unit-"));
    try {
      mkdirSync(join(tmp, ".pi", "src"), { recursive: true });
      symlinkSync(extensionsDir, join(tmp, ".pi", "extensions"));
      assert.equal(detectHalfSymlinkExtensions(tmp).ok, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
