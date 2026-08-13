/**
 * AIIA Trajectory Logger extension (S2 / L7 collection only)
 * Writes JSONL on agent_end and session_shutdown. Optimizer is deferred.
 */
import {
  recordAgentEnd,
  recordSessionShutdown,
} from '../src/trajectory-store.js';
import { buildLLMDraft } from '../src/metaprompt-optimizer.js';
import { writeProjectDraft } from '../src/context-card.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from "../src/extension-profile.js";

export default function trajectoryExtension(pi) {
  if (!isExtensionEnabled("trajectory")) return;
  pi.on('agent_end', async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    try {
      recordAgentEnd(event, { cwd });
    } catch (err) {
      // Never break the agent loop for logging failures.
      console.error('[AIIA trajectory] agent_end write failed:', err?.message || err);
    }
  });

  pi.on('session_shutdown', async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    try {
      recordSessionShutdown(event, { cwd });
      
      // Auto-Profile Update: Trigger L7 Metaprompt Optimizer silently (no console noise)
      if (process.env.AIIA_DISABLE_AUTO_PROFILE !== '1') {
        const draft = await buildLLMDraft(cwd, ctx);
        writeProjectDraft(cwd, draft);
      }
    } catch (err) {
      console.error('[AIIA trajectory] session_shutdown write or profile optimization failed:', err?.message || err);
    }
  });
}
