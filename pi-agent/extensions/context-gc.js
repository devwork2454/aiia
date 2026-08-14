/**
 * AIIA Context GC Extension (JVM Generational GC inspired)
 * Dynamically folds old process context into summarized Survivor memories.
 *
 * Quiet by default: no console noise on happy path.
 * Real failures are rate-limited to console.error + .agent/error.log.
 * Also repairs orphan tool / function_call_output pairs before the provider call.
 */

// Soft trigger: only compact when context is large (avoid every-turn folding).
const GC_TOKEN_THRESHOLD = 32000;
// Soft trigger by raw message count (pair-heavy tool loops).
const GC_MSG_THRESHOLD = 80;
// Hard emergency: ignore min-interval when tokens explode past this.
const GC_EMERGENCY_TOKEN_THRESHOLD = 96000;
// Keep a long recent tail so mid-task details survive between rare GCs.
const GC_KEEP_RECENT = 28;
// Do not run normal GC more often than this (per process).
const GC_MIN_INTERVAL_MS = 3 * 60 * 1000;
const GC_FAIL_COOLDOWN_MS = 5 * 60 * 1000; // Skip LLM summarize after repeated failures
const GC_ERROR_LOG_INTERVAL_MS = 60 * 1000; // At most one console/file error per minute

/** Keep full thinking only for the most recent N assistant turns that have thinking. */
const KEEP_FULL_THINKING = 2;
/** Older thinking blocks are stubbed to this many characters (DeepSeek still needs the field). */
const THINKING_STUB_CHARS = 240;
/** Collapse assistant text monologues longer than this when they look like planning loops. */
const MONOLOGUE_TEXT_CHARS = 1800;

import fs from "node:fs";
import path from "node:path";
import { probeProviderPayload } from "../src/tool-pair-probe.js";
import { hasToolCalls, isToolRole, repairProviderPayload } from "../src/tool-pair-repair.js";

/** @type {{ until: number, reason: string } | null} */
let llmCircuitOpen = null;
let lastErrorLogAt = 0;
/** @type {number} */
let lastGcAt = 0;

function ensureAgentDir(cwd) {
  const dir = path.join(cwd || process.cwd(), ".agent");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory may already exist or be unwritable; caller handles write failures.
  }
  return dir;
}

/**
 * Log only real anomalies, rate-limited. No debug/info spam.
 * @param {string | undefined} cwd
 * @param {string} message
 * @param {{ force?: boolean }} [opts]
 */
function logGcError(cwd, message, opts = {}) {
  const now = Date.now();
  if (!opts.force && now - lastErrorLogAt < GC_ERROR_LOG_INTERVAL_MS) return;
  lastErrorLogAt = now;
  const line = `[AIIA Context GC] ${message}`;
  console.error(line);
  try {
    const logPath = path.join(ensureAgentDir(cwd), "error.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // Logging must never break the agent loop.
  }
}

function estimateTokens(messages) {
  let totalLength = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalLength += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          totalLength += part.text.length;
        } else if (typeof part === "string") {
          totalLength += part.length;
        } else if (part?.text) {
          totalLength += String(part.text).length;
        }
        // OpenAI toolCall shape on assistant content parts
        if (part?.type === "toolCall" || part?.type === "tool_use") {
          totalLength += JSON.stringify(part).length;
        }
      }
    }
    if (msg.tool_calls) {
      totalLength += JSON.stringify(msg.tool_calls).length;
    }
  }
  return Math.ceil(totalLength / 4);
}

function findSafeCutoffIndex(messages, targetIndex) {
  // Never split a tool_calls group: skip mid-run tool results and the assistant
  // that still owns later sibling tools. The last tool in a consecutive run is
  // safe (the whole pair is summarized; the tail starts after it).
  for (let i = targetIndex; i > 1; i--) {
    const msg = messages[i];
    if (isToolRole(msg)) {
      if (isToolRole(messages[i + 1])) continue;
      return i;
    }
    if (msg.role === "user") return i;
    if (msg.role === "assistant" && !hasToolCalls(msg)) return i;
  }
  return -1;
}

/**
 * Resolve apiKey/baseUrl from Pi model registry (ctx.model never embeds the key).
 * @param {any} ctx
 * @returns {Promise<{ modelId: string, apiKey?: string, baseUrl: string, provider: string, headers?: Record<string, string> }>}
 */
async function resolveSummarizeAuth(ctx) {
  const model = ctx?.model;
  const modelId = model?.id || "high";
  const provider = String(model?.provider || "");
  let apiKey = model?.apiKey || model?.key || process.env.OPENAI_API_KEY;
  let baseUrl = model?.baseUrl || process.env.OPENAI_BASE_URL || "http://127.0.0.1:4000/v1";
  let headers;

  const registry = ctx?.modelRegistry;
  if (registry && model && typeof registry.getApiKeyAndHeaders === "function") {
    try {
      const auth = await registry.getApiKeyAndHeaders(model);
      if (auth?.ok) {
        if (auth.apiKey) apiKey = auth.apiKey;
        if (auth.baseUrl) baseUrl = auth.baseUrl;
        if (auth.headers) headers = auth.headers;
      }
    } catch {
      // Fall through to env/model fields.
    }
  } else if (registry && model && typeof registry.getApiKeyForProvider === "function") {
    try {
      const key = await registry.getApiKeyForProvider(model.provider);
      if (key) apiKey = key;
    } catch {
      // ignore
    }
  }

  // Normalize OpenAI-compatible base (strip trailing slash; ensure /v1 when bare host)
  baseUrl = String(baseUrl || "").replace(/\/+$/, "");
  return { modelId, apiKey, baseUrl, provider, headers };
}

/**
 * Structural heuristic when LLM summarize is unavailable.
 * Keeps paths, errors, and short user/assistant snippets — not empty placeholders.
 */
function buildHeuristicSummary(messagesToSummarize) {
  const paths = new Set();
  const errors = [];
  const userSnips = [];
  const pathRe = /(?:\/[\w.-]+){2,}|[A-Za-z]:\\(?:[\w.-]+\\)+[\w.-]+/g;
  const errRe = /\b(Error|ERROR|FAILED|Exception|E\d{3,}|status\s+[45]\d\d)\b[^\n]{0,120}/g;

  for (const msg of messagesToSummarize) {
    let text = "";
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = msg.content
        .map((p) => (typeof p === "string" ? p : p?.text || p?.thinking || ""))
        .filter(Boolean)
        .join("\n");
    }
    if (!text) continue;

    for (const m of text.matchAll(pathRe)) {
      if (m[0].length < 200) paths.add(m[0]);
    }
    for (const m of text.matchAll(errRe)) {
      if (errors.length < 8) errors.push(m[0].trim());
    }
    if (msg.role === "user" && userSnips.length < 3) {
      userSnips.push(text.replace(/\s+/g, " ").slice(0, 160));
    }
  }

  const lines = [
    `Folded ${messagesToSummarize.length} intermediate messages (heuristic; LLM summarize unavailable).`,
  ];
  if (userSnips.length) lines.push(`Recent user intents: ${userSnips.join(" | ")}`);
  if (paths.size) {
    lines.push(`Paths: ${[...paths].slice(0, 20).join(", ")}`);
  }
  if (errors.length) {
    lines.push(`Errors: ${errors.slice(0, 5).join(" || ")}`);
  }
  return lines.join("\n");
}

async function summarizeWithLLM(messagesToSummarize, ctx) {
  if (llmCircuitOpen && Date.now() < llmCircuitOpen.until) {
    return null;
  }

  const { modelId, apiKey, baseUrl, provider, headers } = await resolveSummarizeAuth(ctx);
  if (!apiKey) {
    openCircuit("no API key for summarization");
    logGcError(ctx?.cwd, "Summarization skipped: no API key (using heuristic). Resolve auth via modelRegistry.");
    return null;
  }

  const systemPrompt =
    "You are an AI Context GC module. Summarize the following execution process, tool calls, and results into a condensed state update. \nCRITICAL RULE (Lossless Entity Extraction): You MUST extract and retain all absolute file paths, configuration keys, environment variables, git commits, and precise error codes/messages. \nDo NOT output markdown formatting like JSON blocks, just pure text, but ensure technical entities are preserved perfectly.";
  const userText = JSON.stringify(messagesToSummarize);

  try {
    let res;
    // 1. Google Gemini (Native)
    if (
      baseUrl.includes("generativelanguage.googleapis.com") ||
      provider === "google" ||
      (apiKey && apiKey.startsWith("AIza"))
    ) {
      const geminiModel = modelId.replace("models/", "");
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(headers || {}) },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userText }] }],
            generationConfig: { maxOutputTokens: 800, temperature: 0.1 },
          }),
        },
      );
      if (res.ok) {
        clearCircuit();
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || "[GC Summarization empty]";
      }
    }
    // 2. Anthropic Claude (Native)
    else if (
      baseUrl.includes("api.anthropic.com") ||
      provider === "anthropic" ||
      (apiKey && apiKey.startsWith("sk-ant-"))
    ) {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(headers || {}),
        },
        body: JSON.stringify({
          model: modelId,
          system: systemPrompt,
          messages: [{ role: "user", content: userText }],
          max_tokens: 800,
          temperature: 0.1,
        }),
      });
      if (res.ok) {
        clearCircuit();
        const data = await res.json();
        return data?.content?.[0]?.text || "[GC Summarization empty]";
      }
    }
    // 3. OpenAI / Charon / 1api / LiteLLM
    else {
      const url = baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl}/chat/completions`;
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(headers || {}),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userText },
          ],
          max_tokens: 800,
          temperature: 0.1,
        }),
      });
      if (res.ok) {
        clearCircuit();
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || "[GC Summarization empty]";
      }
    }

    if (res && !res.ok) {
      const errMessage = `status ${res.status}`;
      openCircuit(errMessage);
      logGcError(
        ctx?.cwd,
        `Summarization API failed (${errMessage}); using heuristic for ${Math.round(GC_FAIL_COOLDOWN_MS / 60000)}m.`,
      );
      return null;
    }
  } catch (err) {
    openCircuit(err.message);
    logGcError(ctx?.cwd, `Summarization fetch failed (${err.message}); using heuristic.`);
    return null;
  }
  return null;
}

function openCircuit(reason) {
  llmCircuitOpen = { until: Date.now() + GC_FAIL_COOLDOWN_MS, reason: String(reason || "") };
}

function clearCircuit() {
  llmCircuitOpen = null;
}

/**
 * Get the mutable OpenAI-style request payload.
 * Pi fires before_provider_request with { type, payload } only (no event.req).
 */
function getRequestPayload(event) {
  if (event?.payload && typeof event.payload === "object") return event.payload;
  if (event?.req && typeof event.req === "object") return event.req;
  return null;
}

function isPlanningMonologue(text) {
  if (!text || text.length < MONOLOGUE_TEXT_CHARS) return false;
  const letMe = (text.match(/\bLet me\b/gi) || []).length;
  const planish =
    (text.match(/\b(batch|grep|read|check|look at|also check)\b/gi) || []).length;
  // Real cliproxyapi incident: ~10k chars of "Let me batch/grep/read" with 0 tool calls.
  return letMe >= 6 || (letMe >= 3 && planish >= 8);
}

/**
 * Shrink historical thinking + collapse planning monologues so flash/reasoning
 * models do not keep amplifying "Let me plan forever" text into the next turn.
 * Always runs (even when GC compaction is disabled).
 *
 * @param {any[]} messages
 * @returns {{ thinkingStubbed: number, monologueCollapsed: number }}
 */
function sanitizeMessages(messages) {
  let thinkingStubbed = 0;
  let monologueCollapsed = 0;
  if (!Array.isArray(messages)) return { thinkingStubbed, monologueCollapsed };

  // Walk newest → oldest for thinking budget.
  let fullThinkingLeft = KEEP_FULL_THINKING;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;

    if (Array.isArray(msg.content)) {
      const parts = msg.content;
      const hasToolCall = parts.some(
        (p) =>
          p?.type === "toolCall" ||
          p?.type === "tool_use" ||
          p?.type === "functionCall",
      );
      let changed = false;
      let next = parts;
      for (let k = 0; k < parts.length; k++) {
        const part = parts[k];
        if (!part || typeof part !== "object") continue;
        let replacement = null;

        if (part.type === "thinking" && typeof part.thinking === "string") {
          if (fullThinkingLeft > 0) {
            fullThinkingLeft -= 1;
          } else if (part.thinking.length > THINKING_STUB_CHARS) {
            thinkingStubbed += 1;
            replacement = {
              ...part,
              thinking: `${part.thinking.slice(0, THINKING_STUB_CHARS)}\n…[thinking truncated]`,
            };
          }
        } else if (
          part.type === "text" &&
          typeof part.text === "string" &&
          !hasToolCall &&
          isPlanningMonologue(part.text)
        ) {
          monologueCollapsed += 1;
          replacement = {
            ...part,
            text:
              "[AIIA] Prior planning monologue collapsed (no tool calls). " +
              "Continue by calling tools; do not re-narrate investigation plans.",
          };
        }
        if (replacement) {
          if (!changed) {
            changed = true;
            next = parts.slice();
          }
          next[k] = replacement;
        }
      }
      if (changed) msg.content = next;
    } else if (
      typeof msg.content === "string" &&
      !msg.tool_calls?.length &&
      isPlanningMonologue(msg.content)
    ) {
      monologueCollapsed += 1;
      msg.content =
        "[AIIA] Prior planning monologue collapsed (no tool calls). " +
        "Continue by calling tools; do not re-narrate investigation plans.";
    }
  }

  return { thinkingStubbed, monologueCollapsed };
}

function applyToolPairRepair(req, cwd) {
  const { dropped } = repairProviderPayload(req);
  if (dropped > 0) {
    logGcError(cwd, `Dropped ${dropped} orphan tool result(s) (unpaired tool_calls).`);
  }
  const probe = probeProviderPayload(req);
  if (!probe.ok) {
    const codes = probe.violations.map((v) => v.code).join(",");
    logGcError(cwd, `tool-pair probe still dirty after repair: ${codes}`);
  }
}

export default function contextGCExtension(pi) {
  pi.on("before_provider_request", async (event, ctx) => {
    const req = getRequestPayload(event);
    if (!req) return;

    const hasMessages = Array.isArray(req.messages);

    // Hygiene always on: cut thinking bloat + planning monologues (UI noise + loop fuel).
    if (hasMessages && process.env.AIIA_DISABLE_CONTEXT_HYGIENE !== "1") {
      sanitizeMessages(req.messages);
    }

    if (hasMessages && process.env.AIIA_DISABLE_GC !== "1") {
      const currentTokens = estimateTokens(req.messages);
      const overSoft =
        currentTokens > GC_TOKEN_THRESHOLD || req.messages.length > GC_MSG_THRESHOLD;
      const emergency = currentTokens > GC_EMERGENCY_TOKEN_THRESHOLD;
      const intervalOk = Date.now() - lastGcAt >= GC_MIN_INTERVAL_MS;

      // Rare compaction: soft threshold + min interval; emergency bypasses interval only.
      if (overSoft && (intervalOk || emergency)) {
        const targetIndex = Math.max(1, req.messages.length - GC_KEEP_RECENT);
        const cutoff = findSafeCutoffIndex(req.messages, targetIndex);

        if (cutoff > 1) {
          const messagesToSummarize = req.messages.slice(1, cutoff + 1);
          let summaryText = await summarizeWithLLM(messagesToSummarize, ctx);

          if (!summaryText) {
            summaryText = buildHeuristicSummary(messagesToSummarize);
          }

          // Fold summary into system prompt when possible (no fake assistant/user turns).
          const systemMsg = req.messages[0];
          const survivorBlock = `[AIIA GC Survivor Memory]\n${summaryText}`;
          const tail = req.messages.slice(cutoff + 1);
          if (systemMsg?.role === "system" && typeof systemMsg.content === "string") {
            req.messages = [
              { ...systemMsg, content: `${systemMsg.content}\n\n${survivorBlock}` },
              ...tail,
            ];
          } else {
            req.messages = [
              systemMsg,
              { role: "user", content: survivorBlock },
              ...tail,
            ];
          }
          lastGcAt = Date.now();
        }
      }
    }

    // Completions + Responses: drop orphan tool results even when GC is off.
    applyToolPairRepair(req, ctx?.cwd);

    // Return mutated payload so handler chain always sees the compacted request.
    return req;
  });
}

// Test-only helpers (not used by Pi)
export const _test = {
  estimateTokens,
  findSafeCutoffIndex,
  buildHeuristicSummary,
  resolveSummarizeAuth,
  sanitizeMessages,
  isPlanningMonologue,
  openCircuit,
  clearCircuit,
  getCircuit: () => llmCircuitOpen,
  setLastErrorLogAt: (t) => {
    lastErrorLogAt = t;
  },
  setLastGcAt: (t) => {
    lastGcAt = t;
  },
  getLastGcAt: () => lastGcAt,
  GC_FAIL_COOLDOWN_MS,
  GC_TOKEN_THRESHOLD,
  GC_MSG_THRESHOLD,
  GC_EMERGENCY_TOKEN_THRESHOLD,
  GC_MIN_INTERVAL_MS,
  GC_KEEP_RECENT,
  MONOLOGUE_TEXT_CHARS,
  KEEP_FULL_THINKING,
  THINKING_STUB_CHARS,
};
