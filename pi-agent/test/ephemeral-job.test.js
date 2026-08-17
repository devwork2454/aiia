import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { enableAllExtensions } from './with-all-extensions.js';
import ephemeralJobExtension from '../extensions/ephemeral-job.js';

describe('Phase 2 P8: Ephemeral Job Tests', () => {
  const tools = {};
  const mockContext = { cwd: process.cwd() };

  before(() => {
    enableAllExtensions();
    const mockPi = {
      registerTool: (tool) => {
        tools[tool.name] = tool;
      },
    };
    ephemeralJobExtension(mockPi);
  });

  test('Extension registers run_ephemeral_job tool', () => {
    assert.equal(typeof tools.run_ephemeral_job?.execute, 'function');
  });

  test('run_ephemeral_job executes successfully on initial tier', async () => {
    process.env.TEST_MODE = '1';
    process.env.SHOULD_FAIL_LOW = '0'; // Don't fail

    const res = await tools.run_ephemeral_job.execute(
      't1',
      {
        task: 'Mock Task',
        initialTier: 'low',
      },
      undefined,
      undefined,
      mockContext,
    );

    assert.equal(res.status, 'success');
    assert.equal(res.tier, 'low');
    assert.equal(res.output, 'Mock Job Success on tier low');
    assert.equal(res.escalationHistory.length, 1);
    assert.equal(res.escalationHistory[0].tier, 'low');
    assert.equal(res.escalationHistory[0].success, true);
  });

  test('run_ephemeral_job escalates when lower tier fails', async () => {
    process.env.TEST_MODE = '1';
    process.env.SHOULD_FAIL_LOW = '1'; // Force failure on low tier

    const res = await tools.run_ephemeral_job.execute(
      't2',
      {
        task: 'Mock Task',
        initialTier: 'low',
      },
      undefined,
      undefined,
      mockContext,
    );

    // Should fail on 'low' and succeed on 'medium'
    assert.equal(res.status, 'success');
    assert.equal(res.tier, 'medium');
    assert.equal(res.output, 'Mock Job Success on tier medium');
    assert.equal(res.escalationHistory.length, 2);
    assert.equal(res.escalationHistory[0].tier, 'low');
    assert.equal(res.escalationHistory[0].success, false);
    assert.equal(res.escalationHistory[1].tier, 'medium');
    assert.equal(res.escalationHistory[1].success, true);
  });
});
