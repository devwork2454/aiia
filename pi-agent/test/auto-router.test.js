import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { enableAllExtensions } from './with-all-extensions.js';
import autoRouterExtension from '../extensions/auto-router.js';

describe('Phase 3 P2: Auto-Router Architecture Tests', () => {
  before(() => {
    enableAllExtensions();
  });

  test('Auto-Router injects directive into system prompt without destroying existing context', async () => {
    let hookFn;
    const mockPi = {
      on: (event, fn) => {
        if (event === 'context') hookFn = fn;
      },
    };

    autoRouterExtension(mockPi);

    const event = {
      messages: [
        { role: 'system', content: 'Original base prompt.' },
        { role: 'user', content: 'Do something complex.' },
      ],
    };

    const res = await hookFn(event);

    assert.ok(res.messages[0].content.includes('Original base prompt.'));
    assert.ok(res.messages[0].content.includes('[AIIA Autonomous Router Engine Active]'));
    assert.ok(res.messages[0].content.includes('execute_dag'));
  });

  test('Auto-Router handles missing system prompt by prepending one', async () => {
    let hookFn;
    const mockPi = {
      on: (event, fn) => {
        if (event === 'context') hookFn = fn;
      },
    };

    autoRouterExtension(mockPi);

    const event = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const res = await hookFn(event);

    assert.ok(res.messages.length === 2);
    assert.ok(res.messages[0].role === 'system');
    assert.ok(res.messages[0].content.includes('[AIIA Autonomous Router Engine Active]'));
  });
});
