/**
 * AIIA Todo-Sync Guard
 * Auto-checks at turn_end whether the reply's progress claims match the latest
 * update_todos list state. On mismatch: notify (interactive) + append log.
 * Kill: AIIA_VISUAL_DISABLED=1
 */

import fs from 'node:fs';
import path from 'node:path';
import { isExtensionEnabled } from '../src/extension-profile.js';
import { latestTodosFromEntries } from '../src/todo-progress.js';
import { checkTodoSync, extractReplyText } from '../src/todo-sync-guard.js';

function appendLog(cwd, entry) {
  try {
    const dir = path.join(cwd, '.agent', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'todo-sync-guard.log'),
      `${new Date().toISOString()} ${entry}\n`,
    );
  } catch {
    // Logging is best-effort.
  }
}

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function todoSyncGuardExtension(pi) {
  if (!isExtensionEnabled('todo-sync-guard')) return;

  pi.on('turn_end', (event, ctx) => {
    if (process.env.AIIA_DISABLE_TODO_SYNC_GUARD === '1') return;
    try {
      const todos = latestTodosFromEntries(ctx.sessionManager.getBranch());
      const reply = extractReplyText(event?.message);
      if (!reply.trim()) return; // no assistant text this turn

      const issues = checkTodoSync(todos, reply);
      if (issues.length === 0) return;

      const cwd = ctx?.cwd || process.cwd();
      for (const issue of issues) {
        appendLog(cwd, `[MISMATCH] ${issue}`);
        try {
          ctx?.ui?.notify?.(`⚠ 进度清单脱节: ${issue}`, 'warning');
        } catch {
          // UI may be torn down already.
        }
      }
    } catch (err) {
      appendLog(ctx?.cwd || process.cwd(), `[ERROR] ${err?.message || String(err)}`);
    }
  });
}
