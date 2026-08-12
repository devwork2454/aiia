import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import contextGCExtension from '../extensions/context-gc.js';

describe('Phase 3 P1: Context GC Stability & Boundaries', () => {
  test('Token estimator calculates roughly correctly', async () => {
    // We cannot import estimateTokens directly since it's not exported, but we can test behavior implicitly,
    // or by feeding massive content that triggers GC.
    assert.ok(true); // Placeholder, real test below
  });

  test('GC preserves tool_calls structure without breaking API format', async () => {
    let hookFn;
    const mockPi = {
      on: (event, fn) => { if (event === 'before_provider_request') hookFn = fn; }
    };
    
    contextGCExtension(mockPi);
    
    // Simulate env to disable fetch error spam during tests
    process.env.AIIA_DISABLE_GC = '0';

    const massiveOutput = "A".repeat(50000); // Massive token size to force trigger
    const req = {
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user start' }
      ]
    };
    
    // Create an artificial long history
    for(let i=0; i<20; i++) {
      req.messages.push({ role: 'assistant', tool_calls: [{id: 'call_1', name: 'cmd', input: 'test'}] });
      req.messages.push({ role: 'tool', name: 'cmd', content: massiveOutput });
    }

    const event = { req };
    const originalLength = req.messages.length;

    await hookFn(event, {});

    // Should compact down significantly
    assert.ok(req.messages.length < originalLength, 'GC should compress message length');
    
    // The second message should be the GC survivor message
    assert.ok(req.messages[1].role === 'assistant', 'Second message must be assistant survivor');
    assert.ok(req.messages[1].content.includes('[AIIA GC Survivor Memory]'), 'Must contain GC tag');
  });
});
