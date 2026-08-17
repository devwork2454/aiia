/**
 * Drop orphan tool results so OpenAI-compatible providers do not 400.
 *
 * Completions: "Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'".
 * Responses: "No tool call found for function call output with call_id …".
 *
 * Kill: AIIA_DISABLE_TOOL_PAIR_REPAIR=1
 */

export function isToolPairRepairDisabled(env = process.env) {
  const v = env.AIIA_DISABLE_TOOL_PAIR_REPAIR;
  return v === '1' || v === 'true';
}

export function isToolRole(msg) {
  const role = msg?.role;
  return role === 'tool' || role === 'toolResult' || role === 'function';
}

export function toolResultId(msg) {
  if (!msg || typeof msg !== 'object') return '';
  const raw = msg.tool_call_id || msg.toolCallId || msg.id;
  return raw == null ? '' : String(raw);
}

export function collectToolCallIds(msg) {
  const ids = new Set();
  if (!msg || typeof msg !== 'object') return ids;
  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      if (call?.id) ids.add(String(call.id));
    }
  }
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (
        part &&
        (part.type === 'toolCall' || part.type === 'tool_use' || part.type === 'functionCall') &&
        part.id
      ) {
        ids.add(String(part.id));
      }
    }
  }
  return ids;
}

export function hasToolCalls(msg) {
  return collectToolCallIds(msg).size > 0;
}

function hasVisibleContent(content) {
  if (typeof content === 'string') return content.length > 0;
  if (!Array.isArray(content)) return Boolean(content);
  return content.some((part) => {
    if (!part || typeof part !== 'object') return Boolean(part);
    if (part.type === 'text') return Boolean(part.text);
    if (part.type === 'toolCall' || part.type === 'tool_use' || part.type === 'functionCall') {
      return false;
    }
    return true;
  });
}

function filterAssistantToIds(msg, keepIds) {
  const next = { ...msg };
  if (Array.isArray(msg.tool_calls)) {
    const kept = msg.tool_calls.filter((call) => call?.id && keepIds.has(String(call.id)));
    if (kept.length) next.tool_calls = kept;
    else delete next.tool_calls;
  }
  if (Array.isArray(msg.content)) {
    next.content = msg.content.filter((part) => {
      if (!part || typeof part !== 'object') return true;
      if (part.type === 'toolCall' || part.type === 'tool_use' || part.type === 'functionCall') {
        return Boolean(part.id) && keepIds.has(String(part.id));
      }
      return true;
    });
  }
  if (!hasToolCalls(next) && !hasVisibleContent(next.content)) return null;
  return next;
}

/**
 * Keep only tool results that immediately follow a matching assistant tool_calls.
 * Unmatched tool_calls on that assistant are stripped.
 *
 * @param {any[]} messages
 * @returns {{ messages: any[], dropped: number }}
 */
export function repairCompletionsMessages(messages) {
  if (!Array.isArray(messages)) return { messages, dropped: 0 };
  const out = [];
  let dropped = 0;
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg?.role === 'assistant' && hasToolCalls(msg)) {
      const wanted = collectToolCallIds(msg);
      const keptTools = [];
      const keptIds = new Set();
      let j = i + 1;
      while (j < messages.length && isToolRole(messages[j])) {
        const id = toolResultId(messages[j]);
        if (id && wanted.has(id) && !keptIds.has(id)) {
          keptTools.push(messages[j]);
          keptIds.add(id);
        } else {
          dropped += 1;
        }
        j += 1;
      }
      dropped += wanted.size - keptIds.size;
      const assistant = filterAssistantToIds(msg, keptIds);
      if (assistant) out.push(assistant);
      else dropped += 1;
      out.push(...keptTools);
      i = j;
      continue;
    }
    if (isToolRole(msg)) {
      dropped += 1;
      i += 1;
      continue;
    }
    out.push(msg);
    i += 1;
  }
  return { messages: dropped ? out : messages, dropped };
}

export const CALL_TYPES = new Set(['function_call', 'custom_tool_call']);
export const OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output']);

/**
 * Drop Responses items whose call_id has no preceding function_call.
 *
 * @param {any[]} input
 * @returns {{ input: any[], dropped: number }}
 */
export function repairResponsesInput(input) {
  if (!Array.isArray(input)) return { input, dropped: 0 };
  const seen = new Set();
  const used = new Set();
  const out = [];
  let dropped = 0;
  for (const item of input) {
    const type = item?.type;
    const callId = item?.call_id == null ? '' : String(item.call_id);
    if (CALL_TYPES.has(type)) {
      if (callId) seen.add(callId);
      out.push(item);
      continue;
    }
    if (OUTPUT_TYPES.has(type)) {
      if (callId && seen.has(callId) && !used.has(callId)) {
        used.add(callId);
        out.push(item);
      } else {
        dropped += 1;
      }
      continue;
    }
    out.push(item);
  }
  return { input: dropped ? out : input, dropped };
}

/**
 * Mutate a provider payload (Completions `messages` and/or Responses `input`).
 * @returns {{ dropped: number }}
 */
export function repairProviderPayload(req, env = process.env) {
  if (!req || typeof req !== 'object') return { dropped: 0 };
  if (isToolPairRepairDisabled(env)) return { dropped: 0 };
  let dropped = 0;
  if (Array.isArray(req.messages)) {
    const repaired = repairCompletionsMessages(req.messages);
    req.messages = repaired.messages;
    dropped += repaired.dropped;
  }
  if (Array.isArray(req.input)) {
    const repaired = repairResponsesInput(req.input);
    req.input = repaired.input;
    dropped += repaired.dropped;
  }
  return { dropped };
}
