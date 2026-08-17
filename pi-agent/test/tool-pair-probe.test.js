import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_PAIR_FIXTURES } from '../src/tool-pair-fixtures.js';
import {
  messagesFromSessionJsonl,
  probeCompletionsMessages,
  probeProviderPayload,
  probeResponsesInput,
} from '../src/tool-pair-probe.js';
import {
  repairCompletionsMessages,
  repairProviderPayload,
  repairResponsesInput,
} from '../src/tool-pair-repair.js';
import contextGCExtension from '../extensions/context-gc.js';

function probeOf(fixture) {
  return fixture.protocol === 'responses'
    ? probeResponsesInput(fixture.payload)
    : probeCompletionsMessages(fixture.payload);
}

function repairOf(fixture) {
  return fixture.protocol === 'responses'
    ? repairResponsesInput(fixture.payload)
    : repairCompletionsMessages(fixture.payload);
}

function repairedList(fixture, repaired) {
  return fixture.protocol === 'responses' ? repaired.input : repaired.messages;
}

describe('tool-pair fixtures: legal traffic is untouched', () => {
  for (const fixture of TOOL_PAIR_FIXTURES.filter((f) => f.legal)) {
    it(`${fixture.id} probes clean and repair is identity`, () => {
      const before = probeOf(fixture);
      assert.equal(before.ok, true, JSON.stringify(before.violations));
      const repaired = repairOf(fixture);
      assert.equal(repaired.dropped, 0);
      assert.equal(repairedList(fixture, repaired), fixture.payload);
    });
  }
});

describe('tool-pair fixtures: illegal traffic is found then cleaned', () => {
  for (const fixture of TOOL_PAIR_FIXTURES.filter((f) => !f.legal)) {
    it(`${fixture.id} probes dirty, repair then clean`, () => {
      const before = probeOf(fixture);
      assert.equal(before.ok, false, `${fixture.id} should be illegal`);
      const repaired = repairOf(fixture);
      assert.ok(repaired.dropped >= 1);
      const after =
        fixture.protocol === 'responses'
          ? probeResponsesInput(repaired.input)
          : probeCompletionsMessages(repaired.messages);
      assert.equal(after.ok, true, JSON.stringify(after.violations));
    });
  }
});

describe('probeProviderPayload + session jsonl', () => {
  it('combines messages and input violations', () => {
    const out = probeProviderPayload({
      messages: [{ role: 'tool', tool_call_id: 'x', content: 'o' }],
      input: [{ type: 'function_call_output', call_id: 'fc_x', output: 'z' }],
    });
    assert.equal(out.ok, false);
    assert.ok(out.violations.some((v) => v.protocol === 'completions'));
    assert.ok(out.violations.some((v) => v.protocol === 'responses'));
  });

  it('parses Pi session jsonl including custom_message as interrupt', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        message: { role: 'assistant', tool_calls: [{ id: 'a' }] },
      }),
      JSON.stringify({ type: 'custom_message', customType: 'aiia-snapshot', content: 'facts' }),
      JSON.stringify({
        type: 'message',
        message: { role: 'tool', tool_call_id: 'a', content: 'late' },
      }),
    ].join('\n');
    const messages = messagesFromSessionJsonl(jsonl);
    assert.equal(messages.length, 3);
    const probe = probeCompletionsMessages(messages);
    assert.equal(probe.ok, false);
    assert.ok(probe.violations.some((v) => v.code === 'orphan_tool'));
  });
});

describe('hook does not rewrite a legal Completions pair', () => {
  beforeEach(() => {
    delete process.env.AIIA_DISABLE_TOOL_PAIR_REPAIR;
    process.env.AIIA_DISABLE_GC = '1';
    process.env.AIIA_DISABLE_CONTEXT_HYGIENE = '1';
  });

  it('keeps a valid pair identical', async () => {
    let hookFn;
    contextGCExtension({
      on: (event, fn) => {
        if (event === 'before_provider_request') hookFn = fn;
      },
    });
    const pair = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ];
    const req = { messages: pair };
    const returned = await hookFn({ payload: req }, {});
    assert.equal(returned.messages, pair);
    assert.equal(probeCompletionsMessages(returned.messages).ok, true);
  });

  it('repairProviderPayload on a legal Responses pair is identity', () => {
    const input = [
      { type: 'function_call', call_id: 'fc_1', name: 'bash', arguments: '{}' },
      { type: 'function_call_output', call_id: 'fc_1', output: 'ok' },
    ];
    const req = { input };
    const stats = repairProviderPayload(req);
    assert.equal(stats.dropped, 0);
    assert.equal(req.input, input);
  });
});
