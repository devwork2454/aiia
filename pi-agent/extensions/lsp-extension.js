import { LspClient } from '../src/lsp-client.js';
import path from 'node:path';
import fs from 'node:fs';

const clients = new Map();

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function lspExtension(pi) {
  pi.registerTool({
    name: 'lsp_start',
    description: "Starts a language server (e.g. 'npx', ['pyright-langserver', '--stdio']) for the given project root.",
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        languageId: { type: 'string', description: 'e.g. python, typescript' }
      },
      required: ['command', 'args', 'languageId']
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd || process.cwd();
      if (clients.has(params.languageId)) {
        return { content: [{ type: 'text', text: `LSP for ${params.languageId} is already running.` }] };
      }
      const client = new LspClient(params.command, params.args, cwd);
      await client.initialize(`file://${cwd}`);
      clients.set(params.languageId, client);
      return { content: [{ type: 'text', text: `Started LSP server for ${params.languageId}.` }] };
    }
  });

  pi.registerTool({
    name: 'lsp_goto_definition',
    description: 'Uses the active LSP to find the definition of a symbol at the given line and character (0-indexed).',
    parameters: {
      type: 'object',
      properties: {
        languageId: { type: 'string' },
        filePath: { type: 'string' },
        line: { type: 'number' },
        character: { type: 'number' }
      },
      required: ['languageId', 'filePath', 'line', 'character']
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const client = clients.get(params.languageId);
      if (!client) {
        return { content: [{ type: 'text', text: `Error: LSP for ${params.languageId} not started.` }], isError: true };
      }
      const fullPath = path.resolve(ctx?.cwd || process.cwd(), params.filePath);
      const uri = `file://${fullPath}`;
      try {
        const text = fs.readFileSync(fullPath, 'utf8');
        await client.openDocument(uri, params.languageId, text);
      } catch (e) {
        return { content: [{ type: 'text', text: `Error reading file: ${e.message}` }], isError: true };
      }
      try {
        const res = await client.gotoDefinition(uri, params.line, params.character);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `LSP Error: ${JSON.stringify(e)}` }], isError: true };
      }
    }
  });

  pi.registerTool({
    name: 'lsp_find_references',
    description: 'Uses the active LSP to find all references of a symbol at the given line and character (0-indexed).',
    parameters: {
      type: 'object',
      properties: {
        languageId: { type: 'string' },
        filePath: { type: 'string' },
        line: { type: 'number' },
        character: { type: 'number' }
      },
      required: ['languageId', 'filePath', 'line', 'character']
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const client = clients.get(params.languageId);
      if (!client) {
        return { content: [{ type: 'text', text: `Error: LSP for ${params.languageId} not started.` }], isError: true };
      }
      const fullPath = path.resolve(ctx?.cwd || process.cwd(), params.filePath);
      const uri = `file://${fullPath}`;
      try {
        const text = fs.readFileSync(fullPath, 'utf8');
        await client.openDocument(uri, params.languageId, text);
      } catch (e) {
        return { content: [{ type: 'text', text: `Error reading file: ${e.message}` }], isError: true };
      }
      try {
        const res = await client.findReferences(uri, params.line, params.character);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `LSP Error: ${JSON.stringify(e)}` }], isError: true };
      }
    }
  });
}
