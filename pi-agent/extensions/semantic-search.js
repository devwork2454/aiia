import { SemanticStore } from '../src/semantic-store.js';
import path from 'node:path';
import fs from 'node:fs';

const stores = new Map();

function getStore(cwd) {
  const root = cwd || process.cwd();
  if (!stores.has(root)) {
    const dbPath = path.join(root, '.agent', 'semantic.db');
    const store = new SemanticStore(dbPath);
    store.init();
    stores.set(root, store);
  }
  return stores.get(root);
}

async function walkAndIndex(cwd, store, maxFiles, ctx) {
  let indexed = 0;

  async function walk(dir) {
    if (indexed >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      console.warn(`Failed to read ${dir}:`, e?.message || e);
      return;
    }
    for (const ent of entries) {
      if (indexed >= maxFiles) break;
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'venv') continue;
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(fullPath);
      } else if (ent.isFile() && /\.(js|ts|py|md|txt)$/i.test(ent.name)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.length > 50000) continue;
          const lines = content.split('\n');
          const chunkSize = 100;
          for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize).join('\n');
            await store.indexCodeNode(fullPath, 'text_chunk', chunk, ctx);
          }
          indexed++;
        } catch (e) {
          console.warn(`Failed to index ${fullPath}:`, e.message);
        }
      }
    }
  }

  await walk(cwd);
  return indexed;
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function semanticSearchExtension(pi) {
  if (!isExtensionEnabled('semantic-search')) return;
  pi.registerTool({
    name: 'semantic_index_workspace',
    description: 'Indexes the current workspace into the local semantic vector database.',
    parameters: {
      type: 'object',
      properties: {
        maxFiles: { type: 'number', description: 'Max files to index (default 500)' },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd || process.cwd();
      const store = getStore(cwd);
      const maxFiles = params?.maxFiles || 500;
      const indexed = await walkAndIndex(cwd, store, maxFiles, ctx);
      return {
        content: [{ type: 'text', text: `Indexed ${indexed} files into semantic database.` }],
      };
    },
  });

  pi.registerTool({
    name: 'semantic_search',
    description:
      'Searches the local semantic vector database for the given query using embedding similarities.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        topK: { type: 'number' },
      },
      required: ['query'],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd || process.cwd();
      const store = getStore(cwd);
      const results = await store.search(params.query, params.topK || 5, ctx);
      if (!results || results.length === 0) {
        return { content: [{ type: 'text', text: 'No semantic matches found.' }] };
      }
      const output = results
        .map((r) => {
          return `File: ${r.file_path}\nScore: ${r.score.toFixed(3)}\nContent:\n${r.content}\n---`;
        })
        .join('\n');
      return { content: [{ type: 'text', text: output }] };
    },
  });
}
