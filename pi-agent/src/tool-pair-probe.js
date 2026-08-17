/**
 * Read-only probe for OpenAI Completions / Responses tool pairing.
 * Does not mutate the payload. Repair lives in tool-pair-repair.js.
 */
import {
  CALL_TYPES,
  OUTPUT_TYPES,
  collectToolCallIds,
  hasToolCalls,
  isToolRole,
  toolResultId,
} from './tool-pair-repair.js';

export function makeViolation(code, index, extra = {}) {
  return { code, index, ...extra };
}

/**
 * @param {any[]} messages
 * @returns {{ ok: boolean, violations: object[] }}
 */
export function probeCompletionsMessages(messages) {
  const violations = [];
  if (!Array.isArray(messages)) return { ok: true, violations };
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg?.role === 'assistant' && hasToolCalls(msg)) {
      const wanted = collectToolCallIds(msg);
      const seen = new Set();
      let j = i + 1;
      while (j < messages.length && isToolRole(messages[j])) {
        const id = toolResultId(messages[j]);
        if (!id) {
          violations.push(makeViolation('orphan_tool', j, { reason: 'missing_id' }));
        } else if (!wanted.has(id)) {
          violations.push(makeViolation('orphan_tool', j, { id, reason: 'unknown_id' }));
        } else if (seen.has(id)) {
          violations.push(makeViolation('duplicate_tool', j, { id }));
        } else {
          seen.add(id);
        }
        j += 1;
      }
      for (const id of wanted) {
        if (!seen.has(id)) {
          violations.push(makeViolation('unmatched_tool_call', i, { id }));
        }
      }
      i = j;
      continue;
    }
    if (isToolRole(msg)) {
      violations.push(
        makeViolation('orphan_tool', i, {
          id: toolResultId(msg) || undefined,
          reason: 'no_preceding_tool_calls',
        }),
      );
    }
    i += 1;
  }
  return { ok: violations.length === 0, violations };
}

/**
 * @param {any[]} input
 * @returns {{ ok: boolean, violations: object[] }}
 */
export function probeResponsesInput(input) {
  const violations = [];
  if (!Array.isArray(input)) return { ok: true, violations };
  const seen = new Set();
  const used = new Set();
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    const type = item?.type;
    const callId = item?.call_id == null ? '' : String(item.call_id);
    if (CALL_TYPES.has(type)) {
      if (callId) seen.add(callId);
      continue;
    }
    if (OUTPUT_TYPES.has(type)) {
      if (!callId || !seen.has(callId)) {
        violations.push(
          makeViolation('orphan_function_call_output', i, {
            id: callId || undefined,
            type,
          }),
        );
      } else if (used.has(callId)) {
        violations.push(makeViolation('duplicate_function_call_output', i, { id: callId, type }));
      } else {
        used.add(callId);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * @param {any} req
 * @returns {{ ok: boolean, violations: object[], completions?: object, responses?: object }}
 */
export function probeProviderPayload(req) {
  if (!req || typeof req !== 'object') return { ok: true, violations: [] };
  const completions = Array.isArray(req.messages) ? probeCompletionsMessages(req.messages) : null;
  const responses = Array.isArray(req.input) ? probeResponsesInput(req.input) : null;
  const violations = [];
  if (completions) {
    for (const v of completions.violations) violations.push({ protocol: 'completions', ...v });
  }
  if (responses) {
    for (const v of responses.violations) violations.push({ protocol: 'responses', ...v });
  }
  return { ok: violations.length === 0, violations, completions, responses };
}

/**
 * Pull LLM-facing messages out of a Pi session jsonl dump.
 * custom_message is treated as a user-like interrupt (convertToLlm does that).
 */
export function messagesFromSessionJsonl(text) {
  const messages = [];
  const raw = String(text || '');
  if (!raw.trim()) return messages;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry?.type === 'message' && entry.message) {
      messages.push(entry.message);
      continue;
    }
    if (entry?.type === 'custom_message') {
      messages.push({
        role: 'user',
        content: entry.content ?? '',
        customType: entry.customType,
      });
      continue;
    }
    if (entry?.role) messages.push(entry);
  }
  return messages;
}
