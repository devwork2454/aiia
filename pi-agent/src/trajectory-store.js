/**
 * AIIA trajectory store (S2) — append-only JSONL for L7 collection (no optimizer).
 *
 * Env:
 *   TRAJECTORY_DISABLED=1
 *   TRAJECTORY_PATH=/abs/or/relative.jsonl   (default: <cwd>/.agent/trajectories.jsonl)
 *   TRAJECTORY_MAX_CHARS=8000               per text field
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_MAX_CHARS = 8000;

export function isTrajectoryDisabled(env = process.env) {
  return env.TRAJECTORY_DISABLED === '1' || env.TRAJECTORY_DISABLED === 'true';
}

export function resolveTrajectoryPath(cwd = process.cwd(), env = process.env) {
  if (env.TRAJECTORY_PATH) {
    const p = env.TRAJECTORY_PATH;
    return path.isAbsolute(p) ? p : path.resolve(cwd, p);
  }
  return path.resolve(cwd, '.agent', 'trajectories.jsonl');
}

export function redactText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '***REDACTED***');
  out = out.replace(/\b(xai-[A-Za-z0-9_-]{16,})\b/g, '***REDACTED***');
  out = out.replace(/\b(ghp_[A-Za-z0-9]{20,})\b/g, '***REDACTED***');
  out = out.replace(/\bBearer\s+[A-Za-z0-9._\-+=/]{16,}/gi, 'Bearer ***REDACTED***');
  out = out.replace(
    /((?:api[_-]?key|token|secret|password)\s*[=:]\s*)(["']?)([^\s"']{8,})\2/gi,
    '$1$2***REDACTED***',
  );
  return out;
}

export function truncateText(text, maxChars = DEFAULT_MAX_CHARS) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'image' || block.type === 'image_url') {
      parts.push('[image]');
    } else if (typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * Compact a Pi AgentMessage into a JSON-serializable summary (no huge payloads).
 */
export function summarizeMessage(msg, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!msg || typeof msg !== 'object') return { role: 'unknown' };
  const role = msg.role || 'unknown';
  const out = { role };

  if (role === 'assistant' && Array.isArray(msg.content)) {
    const texts = [];
    const toolCalls = [];
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && block.text) texts.push(block.text);
      if (block.type === 'toolCall' || block.type === 'tool_use' || block.type === 'functionCall') {
        toolCalls.push({
          name: block.name || block.toolName || block.function?.name || 'unknown',
          id: block.id || block.toolCallId,
        });
      }
    }
    if (texts.length) out.text = truncateText(redactText(texts.join('\n')), maxChars);
    if (toolCalls.length) out.toolCalls = toolCalls;
    if (msg.stopReason) out.stopReason = msg.stopReason;
    return out;
  }

  if (role === 'toolResult' || role === 'tool') {
    out.toolName = msg.toolName || msg.name;
    out.toolCallId = msg.toolCallId || msg.id;
    out.isError = Boolean(msg.isError);
    out.text = truncateText(redactText(contentToText(msg.content ?? msg.result ?? '')), maxChars);
    return out;
  }

  // user / system / other
  out.text = truncateText(redactText(contentToText(msg.content ?? msg.text ?? '')), maxChars);
  return out;
}

export function buildAgentEndRecord(event, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const maxChars = Number(opts.maxChars || opts.env?.TRAJECTORY_MAX_CHARS || DEFAULT_MAX_CHARS);
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  const summarized = messages.map((m) => summarizeMessage(m, { maxChars }));

  const roleCounts = {};
  const toolNames = new Set();
  let errorTools = 0;
  for (const m of summarized) {
    roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
    if (m.toolCalls) {
      for (const t of m.toolCalls) toolNames.add(t.name);
    }
    if (m.toolName) toolNames.add(m.toolName);
    if (m.isError) errorTools += 1;
  }

  return {
    ts: opts.now || new Date().toISOString(),
    kind: 'agent_end',
    cwd,
    hostname: opts.hostname || os.hostname(),
    messageCount: summarized.length,
    summary: {
      roleCounts,
      toolNames: [...toolNames],
      errorTools,
    },
    messages: summarized,
  };
}

export function buildSessionShutdownRecord(event, opts = {}) {
  return {
    ts: opts.now || new Date().toISOString(),
    kind: 'session_shutdown',
    cwd: opts.cwd || process.cwd(),
    hostname: opts.hostname || os.hostname(),
    reason: event?.reason || 'unknown',
    targetSessionFile: event?.targetSessionFile,
  };
}

/**
 * Append one JSON object as a line. Creates parent dirs.
 * @returns {{ path: string, bytes: number }}
 */
export function appendTrajectoryRecord(record, opts = {}) {
  const env = opts.env || process.env;
  if (isTrajectoryDisabled(env)) {
    return { path: null, bytes: 0, skipped: true };
  }
  const filePath = opts.path || resolveTrajectoryPath(opts.cwd || process.cwd(), env);
  const dir = path.dirname(filePath);
  const mkdir = opts.mkdirSync || ((d) => fs.mkdirSync(d, { recursive: true }));
  const append = opts.appendFileSync || ((p, data) => fs.appendFileSync(p, data, 'utf8'));

  mkdir(dir);
  const line = `${JSON.stringify(record)}\n`;
  append(filePath, line);
  return { path: filePath, bytes: Buffer.byteLength(line, 'utf8'), skipped: false };
}

/** Convenience used by the extension */
export function recordAgentEnd(event, opts = {}) {
  const record = buildAgentEndRecord(event, opts);
  return { record, write: appendTrajectoryRecord(record, opts) };
}

export function recordSessionShutdown(event, opts = {}) {
  const record = buildSessionShutdownRecord(event, opts);
  return { record, write: appendTrajectoryRecord(record, opts) };
}
