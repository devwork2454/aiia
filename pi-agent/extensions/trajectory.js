/**
 * AIIA Trajectory Logger extension (S2 / L7 collection only)
 * Writes JSONL on agent_end and session_shutdown. Optimizer is deferred.
 */
import {
  recordAgentEnd,
  recordSessionShutdown,
} from '../src/trajectory-store.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function trajectoryExtension(pi) {
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
    } catch (err) {
      console.error('[AIIA trajectory] session_shutdown write failed:', err?.message || err);
    }
  });
}
