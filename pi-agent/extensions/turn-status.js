/**
 * AIIA Turn Status
 * Footer line for live turn elapsed time, running tool, and last cache hit.
 * Kill: AIIA_VISUAL_DISABLED=1 or AIIA_DISABLE_TURN_STATUS=1
 */

import { isExtensionEnabled } from "../src/extension-profile.js";
import {
  STATUS_KEY,
  TICK_MS,
  applyTurnStatusEvent,
  createTurnStatusState,
  formatTurnStatusLine,
  formatWorkingMessage,
} from "../src/turn-status.js";

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function turnStatusExtension(pi) {
  if (!isExtensionEnabled("turn-status")) return;

  let state = createTurnStatusState();
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  /** @type {any} */
  let activeCtx;
  let lastWorking;

  function clearTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function paint(ctx, opts = {}) {
    const ui = ctx?.ui || activeCtx?.ui;
    if (!ui) return;
    const line = opts.clear ? undefined : formatTurnStatusLine(state);
    const working = opts.clear ? undefined : formatWorkingMessage(state);
    try {
      ui.setStatus?.(STATUS_KEY, line);
      if (opts.clear) {
        if (lastWorking !== undefined) ui.setWorkingMessage?.();
        lastWorking = undefined;
        return;
      }
      if (working !== lastWorking) {
        lastWorking = working;
        if (working) ui.setWorkingMessage?.(working);
        else ui.setWorkingMessage?.();
      }
    } catch {
      // UI may already be torn down.
    }
  }

  function startTick(ctx) {
    clearTimer();
    timer = setInterval(() => {
      state = { ...state, now: Date.now(), tickIndex: (state.tickIndex || 0) + 1 };
      paint(activeCtx || ctx);
    }, TICK_MS);
  }

  function apply(event, ctx) {
    if (process.env.AIIA_DISABLE_TURN_STATUS === "1") return;
    activeCtx = ctx || activeCtx;
    const now = Number(event?.timestamp) || Date.now();
    state = applyTurnStatusEvent(state, event, now);
    if (event?.type === "session_shutdown") {
      clearTimer();
      paint(ctx, { clear: true });
      return;
    }
    paint(ctx);
    if (state.phase === "thinking" || state.phase === "tool") startTick(ctx);
    else clearTimer();
  }

  pi.on("session_start", (event, ctx) => apply({ ...event, type: "session_start" }, ctx));
  pi.on("agent_start", (event, ctx) => apply({ ...event, type: "agent_start" }, ctx));
  pi.on("turn_start", (event, ctx) => apply({ ...event, type: "turn_start" }, ctx));
  pi.on("tool_execution_start", (event, ctx) =>
    apply({ ...event, type: "tool_execution_start" }, ctx),
  );
  pi.on("tool_execution_end", (event, ctx) => apply({ ...event, type: "tool_execution_end" }, ctx));
  pi.on("message_end", (event, ctx) => apply({ ...event, type: "message_end" }, ctx));
  pi.on("turn_end", (event, ctx) => apply({ ...event, type: "turn_end" }, ctx));
  pi.on("agent_end", (event, ctx) => apply({ ...event, type: "agent_end" }, ctx));
  pi.on("session_shutdown", (event, ctx) => apply({ ...event, type: "session_shutdown" }, ctx));
}
