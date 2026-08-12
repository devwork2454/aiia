import { SemanticStore } from '../src/semantic-store.js';
import path from 'node:path';
import fs from 'node:fs';

let semanticStore = null;

function getStore(cwd) {
  if (!semanticStore) {
    const dbPath = path.join(cwd, '.agent', 'semantic.db');
    semanticStore = new SemanticStore(dbPath);
    semanticStore.init();
  }
  return semanticStore;
}

export default function semanticSearchExtension(pi) {
  return {
    name: "semantic_search",
    description: "Advanced semantic search and vector database tools for super-large codebases.",
    tools: {
      semantic_index_workspace: {
        description: "Indexes the current workspace into the local semantic vector database. This reads all JS/TS/PY files and computes their embeddings for later semantic search.",
        parameters: {
          type: "object",
          properties: {
            maxFiles: { type: "number", description: "Max files to index (default 500)" }
          }
        },
        execute: async (args, ctx) => {
          const cwd = ctx.cwd || process.cwd();
          const store = getStore(cwd);
          const maxFiles = args.maxFiles || 500;
          
          let indexed = 0;
          
          async function walk(dir) {
            if (indexed >= maxFiles) return;
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const ent of entries) {
              if (indexed >= maxFiles) break;
              if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'venv') continue;
              const fullPath = path.join(dir, ent.name);
              if (ent.isDirectory()) {
                await walk(fullPath);
              } else if (ent.isFile() && /\.(js|ts|py|md|txt)$/i.test(ent.name)) {
                try {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  if (content.length > 50000) continue; // Skip very large files
                  // Simple chunking by 100 lines
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
          return {
            text: `Indexed ${indexed} files into semantic database.`
          };
        }
      },
      semantic_search: {
        description: "Searches the local semantic vector database for the given query using embedding similarities.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            topK: { type: "number" }
          },
          required: ["query"]
        },
        execute: async (args, ctx) => {
          const cwd = ctx.cwd || process.cwd();
          const store = getStore(cwd);
          const results = await store.search(args.query, args.topK || 5, ctx);
          
          if (!results || results.length === 0) {
            return { text: "No semantic matches found." };
          }
          
          const output = results.map(r => {
            return `File: ${r.file_path}\nScore: ${r.score.toFixed(3)}\nContent:\n${r.content}\n---`;
          }).join('\n');
          
          return { text: output };
        }
      }
    }
  };
}
