import { LspClient } from '../src/lsp-client.js';
import path from 'node:path';
import fs from 'node:fs';

const clients = new Map();

export default function lspExtension(pi) {
  return {
    name: "lsp_integration",
    description: "Language Server Protocol (LSP) tools for precise code navigation.",
    tools: {
      lsp_start: {
        description: "Starts a language server (e.g. 'npx', ['pyright-langserver', '--stdio']) for the given project root.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            args: { type: "array", items: { type: "string" } },
            languageId: { type: "string", description: "e.g. python, typescript" }
          },
          required: ["command", "args", "languageId"]
        },
        execute: async (args, ctx) => {
          const cwd = ctx.cwd || process.cwd();
          if (clients.has(args.languageId)) {
             return { text: `LSP for ${args.languageId} is already running.` };
          }
          const client = new LspClient(args.command, args.args, cwd);
          await client.initialize(`file://${cwd}`);
          clients.set(args.languageId, client);
          return { text: `Started LSP server for ${args.languageId}.` };
        }
      },
      lsp_goto_definition: {
        description: "Uses the active LSP to find the definition of a symbol at the given line and character (0-indexed).",
        parameters: {
          type: "object",
          properties: {
            languageId: { type: "string" },
            filePath: { type: "string" },
            line: { type: "number" },
            character: { type: "number" }
          },
          required: ["languageId", "filePath", "line", "character"]
        },
        execute: async (args, ctx) => {
          const client = clients.get(args.languageId);
          if (!client) return { text: `Error: LSP for ${args.languageId} not started.` };
          
          const fullPath = path.resolve(ctx.cwd || process.cwd(), args.filePath);
          const uri = `file://${fullPath}`;
          
          try {
             const text = fs.readFileSync(fullPath, 'utf8');
             await client.openDocument(uri, args.languageId, text);
          } catch(e) {
             return { text: `Error reading file: ${e.message}` };
          }
          
          try {
             const res = await client.gotoDefinition(uri, args.line, args.character);
             return { text: JSON.stringify(res, null, 2) };
          } catch(e) {
             return { text: `LSP Error: ${JSON.stringify(e)}` };
          }
        }
      },
      lsp_find_references: {
        description: "Uses the active LSP to find all references of a symbol at the given line and character (0-indexed).",
        parameters: {
          type: "object",
          properties: {
            languageId: { type: "string" },
            filePath: { type: "string" },
            line: { type: "number" },
            character: { type: "number" }
          },
          required: ["languageId", "filePath", "line", "character"]
        },
        execute: async (args, ctx) => {
          const client = clients.get(args.languageId);
          if (!client) return { text: `Error: LSP for ${args.languageId} not started.` };
          
          const fullPath = path.resolve(ctx.cwd || process.cwd(), args.filePath);
          const uri = `file://${fullPath}`;
          
          try {
             const text = fs.readFileSync(fullPath, 'utf8');
             await client.openDocument(uri, args.languageId, text);
          } catch(e) {
             return { text: `Error reading file: ${e.message}` };
          }
          
          try {
             const res = await client.findReferences(uri, args.line, args.character);
             return { text: JSON.stringify(res, null, 2) };
          } catch(e) {
             return { text: `LSP Error: ${JSON.stringify(e)}` };
          }
        }
      }
    }
  };
}
