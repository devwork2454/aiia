import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectToolCallIds,
  hasToolCalls,
  isToolPairRepairDisabled,
  isToolRole,
  repairCompletionsMessages,
  repairProviderPayload,
  repairResponsesInput,
  toolResultId,
} from '../src/tool-pair-repair.js';
import contextGCExtension from '../extensions/context-gc.js';

function loadHook() {
  let hookFn;
  contextGCExtension({
    on: (event, fn) => {
      if (event === 'before_provider_request') hookFn = fn;
    },
  });
  return hookFn;
}

describe('tool-pair-repair helpers', () => {
  it('detects tool roles and call ids', () => {
    assert.equal(isToolRole({ role: 'tool' }), true);
    assert.equal(isToolRole({ role: 'toolResult' }), true);
    assert.equal(isToolRole({ role: 'user' }), false);
    assert.equal(toolResultId({ tool_call_id: 'c1' }), 'c1');
    assert.equal(toolResultId({ toolCallId: 'c2' }), 'c2');
    assert.deepEqual(
      [...collectToolCallIds({ role: 'assistant', tool_calls: [{ id: 'a' }] })],
      ['a'],
    );
    assert.equal(
      hasToolCalls({
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'x' }],
      }),
      true,
    );
  });

  it('isToolPairRepairDisabled honors env', () => {
    assert.equal(isToolPairRepairDisabled({}), false);
    assert.equal(isToolPairRepairDisabled({ AIIA_DISABLE_TOOL_PAIR_REPAIR: '1' }), true);
  });
});

describe('repairCompletionsMessages', () => {
  it('keeps a valid assistant + tool pair', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ];
    const out = repairCompletionsMessages(messages);
    assert.equal(out.dropped, 0);
    assert.equal(out.messages, messages);
  });

  it('drops a tool with no preceding tool_calls (the 400)', () => {
    const out = repairCompletionsMessages([
      { role: 'user', content: 'hi' },
      { role: 'tool', tool_call_id: 'orphan', content: 'left behind' },
    ]);
    assert.equal(out.dropped, 1);
    assert.deepEqual(
      out.messages.map((m) => m.role),
      ['user'],
    );
  });

  it('drops a leftover sibling tool after a split pair', () => {
    const out = repairCompletionsMessages([
      { role: 'system', content: 's' },
      { role: 'tool', tool_call_id: 'b', content: 'second result only' },
      { role: 'user', content: 'next' },
    ]);
    assert.equal(out.dropped, 1);
    assert.equal(out.messages.length, 2);
    assert.equal(out.messages[1].role, 'user');
  });

  it('strips unmatched tool_calls and keeps the matched tool', () => {
    const out = repairCompletionsMessages([
      {
        role: 'assistant',
        content: 'calling',
        tool_calls: [{ id: 'a' }, { id: 'b' }],
      },
      { role: 'tool', tool_call_id: 'a', content: 'only a' },
    ]);
    assert.ok(out.dropped >= 1);
    assert.deepEqual(
      out.messages[0].tool_calls.map((c) => c.id),
      ['a'],
    );
    assert.equal(out.messages[1].tool_call_id, 'a');
  });

  it('drops tools interrupted by a user message between call and result', () => {
    const out = repairCompletionsMessages([
      { role: 'assistant', tool_calls: [{ id: 'a' }] },
      { role: 'user', content: 'injected' },
      { role: 'tool', tool_call_id: 'a', content: 'late' },
    ]);
    assert.ok(out.dropped >= 1);
    assert.equal(
      out.messages.some((m) => m.role === 'tool'),
      false,
    );
  });

  it('accepts Pi-native toolResult + content toolCall parts', () => {
    const out = repairCompletionsMessages([
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'fc1', name: 'bash' }],
      },
      { role: 'toolResult', toolCallId: 'fc1', content: 'ls' },
    ]);
    assert.equal(out.dropped, 0);
    assert.equal(out.messages.length, 2);
  });
});

describe('repairResponsesInput', () => {
  it('drops function_call_output without a preceding function_call', () => {
    const out = repairResponsesInput([
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'function_call_output', call_id: 'fc_orphan', output: 'x' },
    ]);
    assert.equal(out.dropped, 1);
    assert.equal(out.input.length, 1);
  });

  it('keeps a matched function_call + output pair', () => {
    const input = [
      { type: 'function_call', call_id: 'fc_1', name: 'bash', arguments: '{}' },
      { type: 'function_call_output', call_id: 'fc_1', output: 'ok' },
    ];
    const out = repairResponsesInput(input);
    assert.equal(out.dropped, 0);
    assert.equal(out.input, input);
  });
});

describe('repairProviderPayload + context-gc hook', () => {
  beforeEach(() => {
    delete process.env.AIIA_DISABLE_TOOL_PAIR_REPAIR;
    process.env.AIIA_DISABLE_GC = '1';
    process.env.AIIA_DISABLE_CONTEXT_HYGIENE = '1';
  });

  it('repairs Completions messages in place', () => {
    const req = {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'tool', tool_call_id: 'x', content: 'orphan' },
      ],
    };
    const stats = repairProviderPayload(req);
    assert.equal(stats.dropped, 1);
    assert.equal(req.messages.length, 1);
  });

  it('repairs Responses input in place', () => {
    const req = {
      input: [{ type: 'function_call_output', call_id: 'fc_x', output: 'z' }],
    };
    const stats = repairProviderPayload(req);
    assert.equal(stats.dropped, 1);
    assert.equal(req.input.length, 0);
  });

  it('kill switch leaves orphans alone', () => {
    const req = {
      messages: [{ role: 'tool', tool_call_id: 'x', content: 'keep' }],
    };
    const stats = repairProviderPayload(req, { AIIA_DISABLE_TOOL_PAIR_REPAIR: '1' });
    assert.equal(stats.dropped, 0);
    assert.equal(req.messages.length, 1);
  });

  it('hook drops orphan tool even when GC is disabled', async () => {
    const hook = loadHook();
    const req = {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'tool', tool_call_id: 'orphan', content: 'no call' },
      ],
    };
    const returned = await hook({ payload: req }, {});
    assert.equal(returned.messages.length, 1);
    assert.equal(returned.messages[0].role, 'user');
  });

  it('hook repairs Responses input when there are no messages', async () => {
    const hook = loadHook();
    const req = {
      input: [{ type: 'function_call_output', call_id: 'fc_missing', output: 'x' }],
    };
    const returned = await hook({ payload: req }, {});
    assert.equal(returned.input.length, 0);
  });
});
