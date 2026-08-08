/**
 * Pi agent runner. Uses createAgentSession when available and AIIA_MOCK!=1.
 * Mock mode keeps verify/offline loops green without API keys.
 */

import { preToolCheck } from "./safety.js";

/**
 * @param {{ session_key: string, text: string, channel?: string }} payload
 * @returns {Promise<{ ok: boolean, text: string, session_key: string, mock: boolean }>}
 */
export async function runAgent(payload) {
  const sessionKey = payload.session_key || "default";
  const text = (payload.text || "").trim();
  if (!text) {
    return { ok: false, text: "empty prompt", session_key: sessionKey, mock: true };
  }

  const mock = process.env.AIIA_MOCK === "1" || process.env.AIIA_MOCK === "true";
  if (mock) {
    // Simulate a tool-policy gate that would wrap bash later
    const probe = preToolCheck("bash", { command: text });
    if (probe.status === "DENY") {
      return {
        ok: true,
        text: `[AIIA mock] policy DENY: ${probe.reason}`,
        session_key: sessionKey,
        mock: true,
      };
    }
    return {
      ok: true,
      text: `[AIIA mock] received (${payload.channel || "cli"}): ${text}`,
      session_key: sessionKey,
      mock: true,
    };
  }

  try {
    const mod = await import("@earendil-works/pi-coding-agent");
    const { createAgentSession, SessionManager, ModelRuntime } = mod;
    const modelRuntime = await ModelRuntime.create();
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      modelRuntime,
      cwd: process.env.AIIA_CWD || process.cwd(),
    });

    let out = "";
    const unsub = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        out += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(text);
    unsub();
    session.dispose?.();

    return {
      ok: true,
      text: out.trim() || "(no text response)",
      session_key: sessionKey,
      mock: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      text: `Pi session failed: ${message}. Hint: run with AIIA_MOCK=1 or pi /login.`,
      session_key: sessionKey,
      mock: false,
    };
  }
}
