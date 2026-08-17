/**
 * Cache-safe prompt snapshot: dynamic facts live in one replaceable
 * context message, rewritten only when the hash changes.
 */
import { createHash } from 'node:crypto';

export const SNAPSHOT_START = '[AIIA context snapshot]';
export const SNAPSHOT_CUSTOM_TYPE = 'aiia-snapshot';
export const MAX_SNAPSHOT_CHARS = 4096;

/** @type {Map<string, (ctx: {cwd?: string, env?: NodeJS.ProcessEnv}) => string>} */
const sections = new Map();

export function registerSnapshotSection(id, builder) {
  const key = String(id || '').trim();
  if (!key || typeof builder !== 'function') return false;
  sections.set(key, builder);
  return true;
}

export function clearSnapshotSections() {
  sections.clear();
}

export function listSnapshotSectionIds() {
  return [...sections.keys()];
}

export function isSnapshotDisabled(env = process.env) {
  const v = env.AIIA_PROMPT_SNAPSHOT_DISABLED;
  return v === '1' || v === 'true';
}

export function hashSnapshot(body) {
  return createHash('sha256')
    .update(String(body || ''), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

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

export function isSnapshotMessage(msg) {
  if (!msg) return false;
  if (msg.role === 'custom' && msg.customType === SNAPSHOT_CUSTOM_TYPE) return true;
  return messageText(msg).includes(SNAPSHOT_START);
}

export function buildPromptSnapshot({ cwd = process.cwd(), env = process.env } = {}) {
  const parts = [];
  for (const builder of sections.values()) {
    let text = '';
    try {
      text = builder({ cwd, env }) || '';
    } catch {
      text = '';
    }
    text = String(text).trim();
    if (text) parts.push(text);
  }
  let body = parts.join('\n\n');
  if (body.length > MAX_SNAPSHOT_CHARS) {
    body = `${body.slice(0, MAX_SNAPSHOT_CHARS - 1).trimEnd()}…`;
  }
  return body;
}

export function makeSnapshotMessage(body) {
  const text = String(body || '').trim();
  const hash = hashSnapshot(text);
  return {
    role: 'custom',
    customType: SNAPSHOT_CUSTOM_TYPE,
    content: `${SNAPSHOT_START}\nhash:${hash}\n${text}`,
    display: false,
    timestamp: 0,
  };
}

export function upsertSnapshotMessages(messages, body) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const text = String(body || '').trim();
  const idx = list.findIndex(isSnapshotMessage);
  if (!text) {
    if (idx >= 0) list.splice(idx, 1);
    return list;
  }
  const snap = makeSnapshotMessage(text);
  if (idx >= 0) {
    list[idx] = snap;
    return list;
  }
  if (list[0]?.role === 'system') list.splice(1, 0, snap);
  else list.unshift(snap);
  return list;
}

/**
 * @returns {null | { messages: object[] }}
 */
export function applySnapshotToMessages(messages, body) {
  const list = Array.isArray(messages) ? messages : [];
  const text = String(body || '').trim();
  const idx = list.findIndex(isSnapshotMessage);
  if (!text) {
    if (idx < 0) return null;
    return { messages: list.filter((msg) => !isSnapshotMessage(msg)) };
  }
  const snap = makeSnapshotMessage(text);
  if (idx >= 0 && messageText(list[idx]) === snap.content) return null;
  return { messages: upsertSnapshotMessages(list, text) };
}
