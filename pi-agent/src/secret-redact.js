/**
 * Secret redaction for tool_result content.
 * Pi's tool_result event uses `content` (not `result`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SECRETS_FILE = path.join(os.homedir(), ".secrets", "env");

export function loadSecretPairs(filePath = DEFAULT_SECRETS_FILE) {
  if (!fs.existsSync(filePath)) return {};
  const pairs = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && val && val.length >= 8) {
      pairs[key] = val;
    }
  }
  return pairs;
}

export function redactText(text, secretPairs) {
  let resultStr = String(text ?? "");
  let redacted = false;
  for (const [key, val] of Object.entries(secretPairs || {})) {
    if (!val || val.length < 8) continue;
    if (resultStr.includes(val)) {
      resultStr = resultStr.split(val).join(`***REDACTED:${key}***`);
      redacted = true;
    }
    const escapedVal = JSON.stringify(val).slice(1, -1);
    if (escapedVal !== val && resultStr.includes(escapedVal)) {
      resultStr = resultStr.split(escapedVal).join(`***REDACTED:${key}***`);
      redacted = true;
    }
  }
  return { text: resultStr, redacted };
}

function mapContentParts(content, secretPairs) {
  if (typeof content === "string") {
    const { text, redacted } = redactText(content, secretPairs);
    return { content: text, redacted };
  }
  if (!Array.isArray(content)) {
    return { content, redacted: false };
  }
  let any = false;
  const next = content.map((part) => {
    if (typeof part === "string") {
      const { text, redacted } = redactText(part, secretPairs);
      any = any || redacted;
      return text;
    }
    if (part && typeof part === "object" && typeof part.text === "string") {
      const { text, redacted } = redactText(part.text, secretPairs);
      any = any || redacted;
      return { ...part, text };
    }
    return part;
  });
  return { content: next, redacted: any };
}

/**
 * Mutate a Pi tool_result-like event. Prefers `content`, falls back to `result`.
 * @returns {object | null} the event if anything changed
 */
export function redactToolResultEvent(event, secretPairs) {
  if (!event || !secretPairs || Object.keys(secretPairs).length === 0) return null;

  let changed = false;
  if (event.content != null) {
    const mapped = mapContentParts(event.content, secretPairs);
    if (mapped.redacted) {
      event.content = mapped.content;
      changed = true;
    }
  }
  if (event.result != null) {
    if (typeof event.result === "string") {
      const { text, redacted } = redactText(event.result, secretPairs);
      if (redacted) {
        event.result = text;
        changed = true;
      }
    } else {
      const raw = JSON.stringify(event.result);
      const { text, redacted } = redactText(raw, secretPairs);
      if (redacted) {
        try {
          event.result = JSON.parse(text);
        } catch {
          event.result = text; // keep redacted string if JSON shape broke
        }
        changed = true;
      }
    }
  }
  return changed ? event : null;
}
