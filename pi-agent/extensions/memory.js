/**
 * AIIA memory extension — injects active memories into the real Pi context and
 * exposes /memory + agent tools. SQLite lives in this same Node process.
 *
 * Env: AIIA_DB (default ~/.config/aiia/aiia.db)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory-store.js';
import { registerAiiaHandler } from '../src/command-registry.js';
import { applyMemoryToMessages, extractUserQuery } from '../src/memory-inject.js';

function dbPath() {
  return process.env.AIIA_DB || join(homedir(), '.config', 'aiia', 'aiia.db');
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function memoryExtension(pi) {
  const store = new MemoryStore(dbPath());

  // Inject top-N active memories every turn (Ebbinghaus-ranked + Context Relevance).
  // Must be role=custom: Pi convertToLlm drops role=system. Keep this off the
  // cache-safe snapshot — the block changes with the user query.
  pi.on('context', async (event) => {
    const messages = event?.messages ?? [];
    const queryText = extractUserQuery(messages);
    const memories = store.active({ query: queryText, threshold: 0.15, limit: 10 });
    return applyMemoryToMessages(messages, memories);
  });

  async function memoryHandler(args, ctx) {
    const [sub, ...rest] = String(args || '')
      .trim()
      .split(/\s+/);
    if (sub === 'add') {
      const content = rest.join(' ');
      if (!content) return ctx?.ui?.notify?.('usage: /memory add <text>');
      const id = store.add({ content });
      return ctx?.ui?.notify?.(`memory #${id} saved`);
    }
    if (sub === 'search') {
      const query = rest.join(' ');
      if (!query) return ctx?.ui?.notify?.('usage: /memory search <query>');
      const items = store.search({ query, limit: 10 });
      return ctx?.ui?.notify?.(
        items.length
          ? items
              .map((m) => `#${m.id} [${m.category}] ${m.content} (score: ${m.score.toFixed(2)})`)
              .join('\n')
          : '(no match)',
      );
    }
    if (sub === 'rm') {
      const id = Number(rest[0]);
      if (Number.isNaN(id)) return ctx?.ui?.notify?.('usage: /memory rm <id>');
      const ok = store.remove(id);
      return ctx?.ui?.notify?.(ok ? 'removed' : 'not found');
    }
    const items = store.list({ limit: 20 });
    return ctx?.ui?.notify?.(
      items.length
        ? items.map((m) => `#${m.id} [${m.category}] ${m.content}`).join('\n')
        : '(empty)',
    );
  }

  // Slash command kept for humans (autocomplete may hide it); /aiia memory delegates here.
  pi.registerCommand('memory', {
    description: 'Manage AIIA long-term memories (add|list|search|rm)',
    handler: memoryHandler,
  });
  registerAiiaHandler('memory', memoryHandler);

  pi.registerTool({
    name: 'remember',
    label: 'Remember',
    description: 'Persist a durable user preference or fact to long-term memory.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact/preference to remember' },
        category: { type: 'string', description: 'coding_style|user_preference|build_info' },
        tags: { type: 'string', description: 'Comma separated keywords/tags' },
      },
      required: ['content'],
    },
    async execute(_id, params) {
      const memId = store.add({
        content: params.content,
        category: params.category || 'user_preference',
        tags: params.tags || '',
      });
      return { content: [{ type: 'text', text: `Saved memory #${memId}` }], details: { memId } };
    },
  });

  pi.registerTool({
    name: 'memory_search',
    label: 'Memory Search',
    description:
      'Search long-term memories by keywords. Prefer this over asking the user to run /memory.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
    async execute(_id, params) {
      const limit = Number(params.limit) > 0 ? Number(params.limit) : 10;
      const items = store.search({ query: String(params.query || ''), limit });
      const text = items.length
        ? items
            .map((m) => `#${m.id} [${m.category}] ${m.content} (score: ${m.score.toFixed(2)})`)
            .join('\n')
        : '(no match)';
      return { content: [{ type: 'text', text }], details: { count: items.length } };
    },
  });

  pi.registerTool({
    name: 'memory_list',
    label: 'Memory List',
    description: 'List recent long-term memories.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    async execute(_id, params) {
      const limit = Number(params?.limit) > 0 ? Number(params.limit) : 20;
      const items = store.list({ limit });
      const text = items.length
        ? items.map((m) => `#${m.id} [${m.category}] ${m.content}`).join('\n')
        : '(empty)';
      return { content: [{ type: 'text', text }], details: { count: items.length } };
    },
  });

  pi.on?.('session_shutdown', () => store.close());
}
