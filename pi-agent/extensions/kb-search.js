/**
 * AIIA Hybrid KB search extension (S3 minimum slice).
 * Registers `kb_search` — lexical hybrid over memories + Markdown knowledge roots.
 * Optional qmd backend when installed; LanceDB/LSP still deferred.
 *
 * Env: AIIA_DB, AIIA_KB_PATHS, KB_SEARCH_DISABLED, QMD_BIN
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory-store.js';
import { kbSearch, formatKbSearchResult } from '../src/kb-search.js';

function dbPath() {
  return process.env.AIIA_DB || join(homedir(), '.config', 'aiia', 'aiia.db');
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function kbSearchExtension(pi) {
  if (!isExtensionEnabled('kb-search')) return;
  let store = null;
  try {
    store = new MemoryStore(dbPath());
  } catch {
    store = null;
  }

  pi.registerTool({
    name: 'kb_search',
    label: 'KB Search',
    description:
      'Search AIIA knowledge base (memories + Markdown knowledge dirs). Returns path/title/snippet/score only — not full documents. Prefer for recall over reading whole files.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (keywords or short phrase)' },
        limit: { type: 'number', description: 'Max hits (default 8)' },
      },
      required: ['query'],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd || process.cwd();
      const limit = Math.min(50, Math.max(1, Number(params?.limit) || 8));
      const payload = kbSearch(String(params?.query || ''), {
        cwd,
        limit,
        memoryStore: store,
      });
      const text = formatKbSearchResult(payload);
      return {
        content: [{ type: 'text', text }],
        details: {
          backend: payload.backend,
          count: payload.results?.length || 0,
          results: (payload.results || []).map((r) => ({
            source: r.source,
            path: r.path,
            title: r.title,
            snippet: r.snippet,
            score: r.score,
          })),
        },
      };
    },
  });

  pi.on?.('session_shutdown', () => {
    try {
      store?.close?.();
    } catch {
      /* ignore */
    }
  });
}
