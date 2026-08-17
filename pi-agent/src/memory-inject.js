/**
 * Query-dependent memory injection for the Pi context hook.
 * Uses role=custom so convertToLlm keeps the block (system is dropped).
 */

export const MEMORY_START = '[AIIA active memories]';
export const MEMORY_CUSTOM_TYPE = 'aiia-memory';

export function messageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  const parts = [];
  for (const part of msg.content) {
    if (typeof part === 'string') parts.push(part);
    else if (part && typeof part === 'object' && typeof part.text === 'string')
      parts.push(part.text);
  }
  return parts.join('\n');
}

export function extractUserQuery(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role !== 'user') continue;
    return messageText(list[i]).trim();
  }
  return '';
}

export function formatActiveMemories(memories) {
  const lines = (memories || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (lines.length === 0) return '';
  return `${MEMORY_START}\n- ${lines.join('\n- ')}`;
}

export function isMemoryMessage(msg) {
  if (!msg) return false;
  if (msg.role === 'custom' && msg.customType === MEMORY_CUSTOM_TYPE) return true;
  return messageText(msg).includes(MEMORY_START);
}

export function makeMemoryMessage(body) {
  return {
    role: 'custom',
    customType: MEMORY_CUSTOM_TYPE,
    content: String(body || '').trim(),
    display: false,
    timestamp: 0,
  };
}

export function upsertMemoryMessages(messages, body) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const text = String(body || '').trim();
  const idx = list.findIndex(isMemoryMessage);
  if (!text) {
    if (idx >= 0) list.splice(idx, 1);
    return list;
  }
  const msg = makeMemoryMessage(text);
  if (idx >= 0) {
    list[idx] = msg;
    return list;
  }
  const after =
    list.findIndex((item) => item?.role === 'custom' && item.customType === 'aiia-snapshot') + 1;
  if (after > 0) {
    list.splice(after, 0, msg);
    return list;
  }
  if (list[0]?.role === 'system') list.splice(1, 0, msg);
  else list.unshift(msg);
  return list;
}

/**
 * @returns {null | { messages: object[] }}
 */
export function applyMemoryToMessages(messages, memories) {
  const list = Array.isArray(messages) ? messages : [];
  const body = formatActiveMemories(memories);
  const idx = list.findIndex(isMemoryMessage);
  if (!body) {
    if (idx < 0) return null;
    return { messages: list.filter((msg) => !isMemoryMessage(msg)) };
  }
  const msg = makeMemoryMessage(body);
  if (idx >= 0 && messageText(list[idx]) === msg.content) return null;
  return { messages: upsertMemoryMessages(list, body) };
}
