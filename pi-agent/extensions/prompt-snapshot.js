/**
 * AIIA Prompt Snapshot
 * Injects catalog/profile/reply/add-dir/secret-name blocks as one replaceable
 * context message. Rewrites only when the hash changes (cache-safe).
 * Kill: AIIA_PROMPT_SNAPSHOT_DISABLED=1
 */

import { isExtensionEnabled } from '../src/extension-profile.js';
import {
  applySnapshotToMessages,
  buildPromptSnapshot,
  isSnapshotDisabled,
} from '../src/prompt-snapshot.js';

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function promptSnapshotExtension(pi) {
  if (!isExtensionEnabled('prompt-snapshot')) return;

  pi.on('context', async (event, ctx) => {
    if (isSnapshotDisabled()) return;
    const cwd = ctx?.cwd || process.cwd();
    const body = buildPromptSnapshot({ cwd, env: process.env });
    return applySnapshotToMessages(event?.messages, body);
  });
}
