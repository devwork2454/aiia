/**
 * AIIA /add-dir — Claude Code-style additional workspace directories for Pi.
 *
 * Commands:
 *   /add-dir <path>       add directory
 *   /add-dir list         list (also bare /add-dir)
 *   /add-dir rm <path>    remove
 *   /rm-dir <path>        alias for remove
 *   /list-dirs            alias for list
 *
 * Effects:
 *   - Persist under <cwd>/.agent/additional-dirs.json
 *   - Inject path list into the cache-safe context snapshot
 *   - resources_discover: skill roots under added dirs
 */
import {
  addDirectory,
  removeDirectory,
  listDirectories,
  collectSkillPaths,
  formatAdditionalDirsPrompt,
  parseAddDirArgs,
} from '../src/add-dir-store.js';
import { registerAiiaHandler } from '../src/command-registry.js';
import { registerSnapshotSection } from '../src/prompt-snapshot.js';

function loadSkillsEnabled(env = process.env) {
  return env.AIIA_ADD_DIR_LOAD_SKILLS !== '0' && env.AIIA_ADD_DIR_LOAD_SKILLS !== 'false';
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function addDirExtension(pi) {
  async function handleAddDir(args, ctx) {
    const cwd = ctx?.cwd || process.cwd();
    const parsed = parseAddDirArgs(args);

    if (parsed.action === 'help') {
      ctx?.ui?.notify?.('Usage: /add-dir <path> | /add-dir list | /add-dir rm <path>', 'info');
      return;
    }

    if (parsed.action === 'list') {
      const dirs = listDirectories(cwd);
      const msg = dirs.length
        ? `Additional dirs (${dirs.length}):\n` + dirs.map((d, i) => `  ${i + 1}. ${d}`).join('\n')
        : 'No additional directories. Usage: /add-dir <path>';
      ctx?.ui?.notify?.(msg, 'info');
      return;
    }

    if (parsed.action === 'rm') {
      if (!parsed.path) {
        ctx?.ui?.notify?.('Usage: /add-dir rm <path>', 'warning');
        return;
      }
      const res = removeDirectory(parsed.path, cwd);
      if (!res.ok) {
        ctx?.ui?.notify?.(res.error, 'error');
        return;
      }
      ctx?.ui?.notify?.(`Removed additional dir: ${res.path}`, 'info');
      if (typeof ctx?.reload === 'function') {
        try {
          await ctx.reload();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // add
    if (!parsed.path) {
      ctx?.ui?.notify?.('Usage: /add-dir <path>', 'warning');
      return;
    }
    const res = addDirectory(parsed.path, cwd);
    if (!res.ok) {
      ctx?.ui?.notify?.(res.error, 'error');
      return;
    }
    ctx?.ui?.notify?.(
      res.added ? `Added additional dir: ${res.path}` : `Already registered: ${res.path}`,
      'info',
    );

    // Refresh skill discovery when possible
    if (typeof ctx?.reload === 'function') {
      try {
        await ctx.reload();
      } catch {
        /* ignore */
      }
    }

    // Nudge agent awareness without requiring user to retype
    const note = [
      `[AIIA /add-dir] Additional workspace directory is now available:`,
      res.path,
      `Primary cwd remains: ${cwd}`,
      `Current additional dirs:`,
      ...res.dirs.map((d) => `- ${d}`),
      `Prefer absolute paths when reading/editing outside primary cwd.`,
    ].join('\n');

    try {
      if (typeof ctx?.isIdle === 'function' && !ctx.isIdle()) {
        pi.sendUserMessage?.(note, { deliverAs: 'followUp' });
      } else {
        // Silent inject via custom message if available; else skip auto-turn
        pi.sendMessage?.(
          { role: 'user', content: [{ type: 'text', text: note }], timestamp: Date.now() },
          { triggerTurn: false },
        );
      }
    } catch {
      /* notify-only is enough */
    }
  }

  const handleRmDir = async (args, ctx) => handleAddDir(`rm ${args || ''}`, ctx);
  const handleListDirs = async (_args, ctx) => handleAddDir('list', ctx);

  pi.registerCommand('add-dir', {
    description:
      'Add extra workspace directory (Claude-style) | /add-dir <path> | list | rm <path>',
    handler: handleAddDir,
  });

  pi.registerCommand('rm-dir', {
    description: 'Remove an additional workspace directory | /rm-dir <path>',
    handler: handleRmDir,
  });

  pi.registerCommand('list-dirs', {
    description: 'List additional workspace directories | /list-dirs',
    handler: handleListDirs,
  });

  registerAiiaHandler('add-dir', handleAddDir);
  registerAiiaHandler('rm-dir', handleRmDir);
  registerAiiaHandler('list-dirs', handleListDirs);

  pi.registerTool({
    name: 'list_additional_dirs',
    label: 'List Additional Dirs',
    description: 'List extra workspace directories registered with /add-dir for this session/cwd.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const cwd = process.cwd();
      const dirs = listDirectories(cwd);
      const text = dirs.length
        ? `Additional dirs (${dirs.length}):\n` + dirs.map((d, i) => `${i + 1}. ${d}`).join('\n')
        : 'No additional directories.';
      return { content: [{ type: 'text', text }], details: { dirs, cwd } };
    },
  });

  pi.on('resources_discover', async (event) => {
    if (!loadSkillsEnabled()) return;
    const cwd = event?.cwd || process.cwd();
    const dirs = listDirectories(cwd);
    const skillPaths = collectSkillPaths(dirs);
    if (skillPaths.length === 0) return;
    return { skillPaths };
  });

  registerSnapshotSection('add-dir', ({ cwd }) => {
    const root = cwd || process.cwd();
    return formatAdditionalDirsPrompt(listDirectories(root), root);
  });
}
