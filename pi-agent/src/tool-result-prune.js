/**
 * Model-free tool_result prune + spill.
 *
 * Env:
 *   AIIA_TOOL_RESULT_PRUNE_DISABLED=1
 *   AIIA_TOOL_RESULT_MAX_CHARS=8192
 *   AIIA_TOOL_RESULT_HEAD_CHARS=4096
 *   AIIA_TOOL_RESULT_TAIL_CHARS=1024
 */
import fs from "node:fs";
import path from "node:path";
import { loadSecretPairs, redactText as redactSecrets } from "./secret-redact.js";
import { redactText as redactPatterns } from "./trajectory-store.js";

export const SPILL_MARKER = "[AIIA tool-result spill";
export const DEFAULT_MAX_CHARS = 8192;
export const DEFAULT_HEAD_CHARS = 4096;
export const DEFAULT_TAIL_CHARS = 1024;
export const SPILL_DIRNAME = path.join(".agent", "spill");

export function isPruneDisabled(env = process.env) {
  const v = env.AIIA_TOOL_RESULT_PRUNE_DISABLED;
  return v === "1" || v === "true";
}

function positiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolvePruneLimits(env = process.env) {
  const maxChars = positiveInt(env.AIIA_TOOL_RESULT_MAX_CHARS, DEFAULT_MAX_CHARS);
  let headChars = positiveInt(env.AIIA_TOOL_RESULT_HEAD_CHARS, DEFAULT_HEAD_CHARS);
  let tailChars = positiveInt(env.AIIA_TOOL_RESULT_TAIL_CHARS, DEFAULT_TAIL_CHARS);
  if (headChars + tailChars > maxChars) {
    tailChars = Math.min(tailChars, Math.max(1, Math.floor(maxChars / 4)));
    headChars = Math.max(1, maxChars - tailChars);
  }
  return { maxChars, headChars, tailChars };
}

export function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n");
}

export function shouldPrune(text, limits) {
  if (typeof text !== "string" || !text) return false;
  if (text.includes(SPILL_MARKER)) return false;
  const maxChars = limits?.maxChars ?? DEFAULT_MAX_CHARS;
  const headChars = limits?.headChars ?? DEFAULT_HEAD_CHARS;
  const tailChars = limits?.tailChars ?? DEFAULT_TAIL_CHARS;
  if (text.length <= maxChars) return false;
  return text.length > headChars + tailChars;
}

export function formatSpillMarker(omitted, relPath) {
  return `\n…${SPILL_MARKER}: omitted ${omitted} chars → ${relPath}]\n`;
}

export function formatPrunedPreview(text, relPath, limits) {
  const headChars = limits?.headChars ?? DEFAULT_HEAD_CHARS;
  const tailChars = limits?.tailChars ?? DEFAULT_TAIL_CHARS;
  const omitted = Math.max(0, text.length - headChars - tailChars);
  const marker = formatSpillMarker(omitted, relPath);
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

export function rebuildContent(content, previewText) {
  const images = [];
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && part.type === "image") images.push(part);
    }
  }
  return [{ type: "text", text: previewText }, ...images];
}

export function sanitizeSpillText(text, secretPairs) {
  const patterned = redactPatterns(String(text ?? ""));
  return redactSecrets(patterned, secretPairs || {}).text;
}

export function spillFileName({ toolCallId, toolName, now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const id = String(toolCallId || "unknown")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 40);
  const name = String(toolName || "tool")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 24);
  return `${stamp}-${name}-${id}.txt`;
}

export function writeSpillFile(opts) {
  const cwd = opts.cwd || process.cwd();
  const dir = path.join(cwd, SPILL_DIRNAME);
  const mkdir = opts.mkdir || ((d, o) => fs.mkdirSync(d, o));
  const writeFile = opts.writeFile || ((p, data, o) => fs.writeFileSync(p, data, o));
  const chmod = opts.chmod || ((p, mode) => fs.chmodSync(p, mode));
  mkdir(dir, { recursive: true });
  const base = spillFileName({
    toolCallId: opts.toolCallId,
    toolName: opts.toolName,
    now: opts.now,
  });
  const abs = path.join(dir, base);
  const body = sanitizeSpillText(opts.text, opts.secretPairs);
  writeFile(abs, body, { encoding: "utf8", mode: 0o600 });
  try {
    chmod(abs, 0o600);
    // GC old spills to prevent disk exhaustion (keep last 15)
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.txt'))
      .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length > 15) {
      for (let i = 15; i < files.length; i++) {
        fs.unlinkSync(path.join(dir, files[i].name));
      }
    }
  } catch {
    // best-effort on platforms that ignore writeFile mode or fs operations
  }
  return { abs, rel: path.join(SPILL_DIRNAME, base), bytes: body.length };
}

/**
 * @returns {null | { content: Array<{type:string,text?:string}> }}
 */
export function applyToolResultPrune(event, opts = {}) {
  const env = opts.env || process.env;
  if (isPruneDisabled(env)) return null;
  if (!event) return null;

  const limits = resolvePruneLimits(env);
  const text = contentToText(event.content);
  if (!shouldPrune(text, limits)) return null;

  const secretPairs = opts.secretPairs !== undefined ? opts.secretPairs : loadSecretPairs();
  const written = writeSpillFile({
    cwd: opts.cwd || process.cwd(),
    text,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    now: opts.now,
    mkdir: opts.mkdir,
    writeFile: opts.writeFile,
    chmod: opts.chmod,
    secretPairs,
  });
  const preview = formatPrunedPreview(text, written.rel, limits);
  return { content: rebuildContent(event.content, preview) };
}
