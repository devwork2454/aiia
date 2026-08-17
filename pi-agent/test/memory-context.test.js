import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertToLlm } from '@earendil-works/pi-coding-agent';
import {
  MEMORY_CUSTOM_TYPE,
  MEMORY_START,
  applyMemoryToMessages,
  extractUserQuery,
  formatActiveMemories,
  isMemoryMessage,
  upsertMemoryMessages,
} from '../src/memory-inject.js';

describe('memory-inject helpers', () => {
  it('extractUserQuery reads string and text-block user content', () => {
    assert.equal(extractUserQuery([{ role: 'user', content: 'plain hi' }]), 'plain hi');
    assert.equal(
      extractUserQuery([
        { role: 'custom', customType: 'aiia-snapshot', content: 'skip me' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'prefers' },
            { type: 'text', text: 'chinese' },
          ],
        },
      ]),
      'prefers\nchinese',
    );
    assert.equal(extractUserQuery([{ role: 'assistant', content: 'no' }]), '');
  });

  it('upserts custom memory after a snapshot and replaces in place', () => {
    const body = formatActiveMemories(['like tea']);
    const first = upsertMemoryMessages([{ role: 'user', content: 'hi' }], body);
    assert.equal(first[0].role, 'custom');
    assert.equal(first[0].customType, MEMORY_CUSTOM_TYPE);
    assert.match(first[0].content, /like tea/);

    const withSnap = upsertMemoryMessages(
      [
        { role: 'custom', customType: 'aiia-snapshot', content: 'snap' },
        { role: 'user', content: 'hi' },
      ],
      body,
    );
    assert.equal(withSnap[0].customType, 'aiia-snapshot');
    assert.equal(isMemoryMessage(withSnap[1]), true);

    const replaced = upsertMemoryMessages(withSnap, formatActiveMemories(['like coffee']));
    assert.match(replaced[1].content, /like coffee/);
    assert.equal(replaced.filter(isMemoryMessage).length, 1);
  });

  it('applyMemoryToMessages no-ops when unchanged and drops empties', () => {
    const first = applyMemoryToMessages([{ role: 'user', content: 'hi' }], ['keep']);
    assert.ok(first?.messages);
    assert.equal(applyMemoryToMessages(first.messages, ['keep']), null);
    const gone = applyMemoryToMessages(first.messages, []);
    assert.equal(gone.messages.some(isMemoryMessage), false);
    assert.equal(applyMemoryToMessages([{ role: 'user', content: 'hi' }], []), null);
  });

  it('convertToLlm keeps the custom memory block', () => {
    const applied = applyMemoryToMessages(
      [{ role: 'user', content: 'hi', timestamp: 1 }],
      ['SENTINEL_PREFERENCE_XYZ'],
    );
    const llm = convertToLlm(applied.messages.map((m) => ({ ...m, timestamp: m.timestamp || 1 })));
    const json = JSON.stringify(llm);
    assert.match(json, new RegExp(MEMORY_START.replace(/[[\]]/g, '\\$&')));
    assert.match(json, /SENTINEL_PREFERENCE_XYZ/);
    assert.doesNotMatch(json, /"role":"system"/);
  });
});
