/**
 * Deterministic memory-injection test (NO model needed).
 *
 * Loads the REAL memory.js through Pi, seeds a memory, then drives the real
 * `context` event via ExtensionRunner.emitContext() and asserts the memory is
 * injected into the returned context messages.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  DefaultResourceLoader,
  ExtensionRunner,
  SessionManager,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { MemoryStore } from "../src/memory-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const memoryPath = join(here, "..", "extensions", "memory.js");

describe("memory.js loaded by Pi (real context injection)", () => {
  let runner, tmp, dbPath;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), "aiia-inj-"));
    dbPath = join(tmp, "aiia.db");
    process.env.AIIA_DB = dbPath;

    // Seed a memory the extension should inject.
    const store = new MemoryStore(dbPath);
    store.add({ content: "SENTINEL_PREFERENCE_XYZ" });
    store.close();

    const agentDir = mkdtempSync(join(tmpdir(), "aiia-mem-agent-"));
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      noSkills: true,
      noContextFiles: true,
      noExtensions: true,
      additionalExtensionPaths: [memoryPath],
    });
    await loader.reload();
    const res = loader.getExtensions();
    assert.equal(res.errors.length, 0, `load errors: ${JSON.stringify(res.errors)}`);
    assert.ok(res.extensions.length >= 1, "memory extension must load");

    runner = new ExtensionRunner(
      res.extensions,
      res.runtime,
      process.cwd(),
      SessionManager.inMemory(),
      new ModelRegistry(),
    );
    rmSync(agentDir, { recursive: true, force: true });
  });

  after(() => {
    delete process.env.AIIA_DB;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("injects seeded memory into context messages", async () => {
    const base = [{ role: "user", content: "hi" }];
    const out = await runner.emitContext(base);
    const joined = JSON.stringify(out);
    assert.match(joined, /SENTINEL_PREFERENCE_XYZ/, `memory not injected; got ${joined.slice(0, 300)}`);
  });
});
