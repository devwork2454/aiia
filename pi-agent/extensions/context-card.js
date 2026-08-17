/**
 * Inject merged UserCard/ProjectCard summary each turn.
 * Commands: /profile show|refresh|apply|set ...
 * Kill switch: AIIA_PROFILE_DISABLED=1
 */
import {
  applyProjectDraft,
  buildRuleBasedDraft,
  formatContextCardPrompt,
  formatProfileStatus,
  isProfileDisabled,
  loadMergedCard,
  parseProfileArgs,
  saveProjectCard,
  saveUserCard,
  writeProjectDraft,
} from '../src/context-card.js';
import { buildLLMDraft } from '../src/metaprompt-optimizer.js';
import { registerAiiaHandler } from '../src/command-registry.js';
import { registerSnapshotSection } from '../src/prompt-snapshot.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function contextCardExtension(pi) {
  const profileHandler = async (args, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    const parsed = parseProfileArgs(args);

    if (parsed.action === 'help') {
      ctx?.ui?.notify?.(
        [
          'Usage:',
          '  /profile                         show merged card + stale/draft status',
          '  /profile refresh                 build rule-based draft (not auto-applied)',
          '  /profile optimize                build LLM profile from trajectories (not auto-applied)',
          '  /profile apply                   apply draft to project-card.json',
          '  /profile set intent <text>       set project intent',
          '  /profile set stack a,b           set project stack',
          '  /profile set avoid_tools a,b     set project avoid_tools',
          '  /profile set --user tags a,b     set user tags',
          '  /profile on|off                  hint: use env AIIA_PROFILE_DISABLED',
        ].join('\n'),
        'info',
      );
      return;
    }

    if (parsed.action === 'error') {
      ctx?.ui?.notify?.(parsed.error || 'Invalid /profile command', 'warning');
      return;
    }

    if (parsed.action === 'on') {
      ctx?.ui?.notify?.('Profile injection ON — unset AIIA_PROFILE_DISABLED (or set to 0)', 'info');
      return;
    }

    if (parsed.action === 'off') {
      ctx?.ui?.notify?.('Profile injection OFF — set env AIIA_PROFILE_DISABLED=1', 'info');
      return;
    }

    if (parsed.action === 'refresh') {
      const draft = buildRuleBasedDraft(cwd);
      writeProjectDraft(cwd, draft);
      ctx?.ui?.notify?.('draft ready; /profile apply', 'info');
      return;
    }

    if (parsed.action === 'optimize') {
      ctx?.ui?.notify?.('Generating LLM profile from trajectories...', 'info');
      try {
        const draft = await buildLLMDraft(cwd, ctx);
        writeProjectDraft(cwd, draft);
        ctx?.ui?.notify?.('LLM draft ready; /profile apply', 'info');
      } catch (err) {
        ctx?.ui?.notify?.('Optimize failed: ' + err.message, 'warning');
      }
      return;
    }

    if (parsed.action === 'apply') {
      try {
        const applied = applyProjectDraft(cwd);
        ctx?.ui?.notify?.(`Applied project card (intent: ${applied.intent || '(empty)'})`, 'info');
      } catch (err) {
        ctx?.ui?.notify?.(err?.message || String(err), 'warning');
      }
      return;
    }

    if (parsed.action === 'set') {
      const fieldMap = { tags: 'user_tags' };
      const key = fieldMap[parsed.field] || parsed.field;
      /** @type {Record<string, unknown>} */
      const patch = {};
      if (key === 'intent') {
        patch.intent = parsed.value;
      } else if (key === 'stack' || key === 'avoid_tools' || key === 'user_tags') {
        patch[key] = String(parsed.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        ctx?.ui?.notify?.(`Unknown field: ${parsed.field}`, 'warning');
        return;
      }

      if (parsed.scope === 'user') {
        saveUserCard(patch);
        ctx?.ui?.notify?.(`Updated user card (${parsed.field})`, 'info');
      } else {
        saveProjectCard(patch, cwd);
        ctx?.ui?.notify?.(`Updated project card (${parsed.field})`, 'info');
      }
      return;
    }

    // show / status
    ctx?.ui?.notify?.(formatProfileStatus({ cwd }), 'info');
  };

  pi.registerCommand('profile', {
    description: 'Show/refresh/apply project+user context cards',
    handler: profileHandler,
  });
  registerAiiaHandler('profile', profileHandler);

  registerSnapshotSection('profile', ({ cwd, env }) => {
    if (isProfileDisabled(env)) return '';
    return formatContextCardPrompt(loadMergedCard({ cwd, env }));
  });
}
