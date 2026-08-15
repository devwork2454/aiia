import fs from 'node:fs';
import path from 'node:path';
import * as diff from 'diff';
import { extractTargetPath, resolveTargetPath } from '../src/quality-gate.js';

/**
 * AIIA Unified Diff Patch Editor
 * Registers `patch_edit` tool. Replaces the brittle exact-string-match 'edit' tool 
 * with a fuzzy-matching udiff algorithm, drastically reducing indentation/whitespace 
 * hallucinations from breaking the development workflow.
 * 
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi 
 */
export default function patchEditExtension(pi) {
  pi.registerTool({
    name: 'patch_edit',
    description: 'Edit a file using Unified Diff (udiff) format with fuzzy matching. Highly recommended over pure text replacement for resilience against indentation/whitespace hallucinations. Pass the standard diff output in the udiff field.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file to edit.',
        },
        udiff: {
          type: 'string',
          description: 'The Unified Diff string (starting with --- and +++ lines, followed by @@ hunks).',
        },
        description: {
          type: 'string',
          description: 'A brief description of what this patch does.',
        }
      },
      required: ['path', 'udiff', 'description'],
    },
    handler: async (args, ctx) => {
      const rel = extractTargetPath(args);
      const abs = resolveTargetPath(rel, ctx?.cwd || process.cwd());
      if (!abs) return { isError: true, content: 'Invalid path' };
      if (!fs.existsSync(abs)) return { isError: true, content: 'File not found' };

      const currentContent = fs.readFileSync(abs, 'utf8');

      const patched = diff.applyPatch(currentContent, args.udiff, { fuzzFactor: 2 });
      if (patched === false) {
        return { 
          isError: true, 
          content: 'Failed to apply diff patch. The fuzzy matcher could not locate the context lines. Please verify your diff and try again, or use the regular edit tool if the diff is too complex.' 
        };
      }

      fs.writeFileSync(abs, patched, 'utf8');
      
      // Fire tool_result event to trigger quality gate
      if (typeof pi.emit === 'function') {
        pi.emit('tool_result', {
          toolName: 'patch_edit',
          input: args,
          content: [{ type: 'text', text: `Successfully patched ${rel}` }],
          isError: false
        }, ctx);
      }

      return {
        content: `Successfully applied patch to ${rel}.`
      };
    }
  });
}
