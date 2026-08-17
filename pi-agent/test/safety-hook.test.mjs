/**
 * Deterministic real-hook test (NO model needed, cannot be skipped).
 *
 * Loads the REAL safety.js through Pi's DefaultResourceLoader, builds a real
 * ExtensionRunner, and drives real-shape tool_call events through it.
 * Asserts the actually-registered hook blocks dangerous commands and allows safe ones.
 *
 * This closes the gap the verifier found: if the extension fails to load, the
 * hook name is wrong, or the event field is misread, THIS test fails.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DefaultResourceLoader,
  ExtensionRunner,
  SessionManager,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

const here = dirname(fileURLToPath(import.meta.url));
const safetyPath = join(here, '..', 'extensions', 'safety.js');

const toolCall = (toolName, command) => ({
  type: 'tool_call',
  toolCallId: 'tc_test',
  toolName,
  input: { command },
});

describe('safety.js loaded by Pi (real hook, real event shape)', () => {
  let runner;
  let loadedNames;

  before(async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'aiia-safety-agent-'));
    try {
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir,
        noSkills: true,
        noContextFiles: true,
        noExtensions: true,
        additionalExtensionPaths: [safetyPath],
      });
      await loader.reload();
      const res = loader.getExtensions();
      assert.equal(res.errors.length, 0, `extension load errors: ${JSON.stringify(res.errors)}`);
      loadedNames = res.extensions.map((e) => e.name || e.id || '?');
      assert.ok(res.extensions.length >= 1, 'safety extension must actually load');

      runner = new ExtensionRunner(
        res.extensions,
        res.runtime,
        process.cwd(),
        SessionManager.inMemory(),
        new ModelRegistry(),
      );
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it('the registered hook BLOCKS rm -rf /', async () => {
    const result = await runner.emitToolCall(toolCall('bash', 'rm -rf /'));
    assert.ok(result, 'hook must return a result for dangerous command');
    assert.equal(result.block, true, `expected block=true, got ${JSON.stringify(result)}`);
  });

  it('the registered hook BLOCKS sudo', async () => {
    const result = await runner.emitToolCall(toolCall('bash', 'sudo rm x'));
    assert.equal(result?.block, true);
  });

  it('the registered hook ALLOWS a safe command', async () => {
    const result = await runner.emitToolCall(toolCall('bash', 'ls -la'));
    // allow => either undefined or block!==true
    assert.notEqual(
      result?.block,
      true,
      `safe command should not be blocked: ${JSON.stringify(result)}`,
    );
  });
});
