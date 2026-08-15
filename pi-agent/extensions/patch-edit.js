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

      // Fix missing spaces in context lines and recalculate hunk headers
      const lines = (args.udiff || '').split(/\r?\n/);
      const fixed = [];
      let currentHunk = null;

      for (const line of lines) {
        if (line.startsWith('@@ ')) {
          if (currentHunk) {
            fixed.push(`@@ -${currentHunk.oldStart},${currentHunk.oldCount} +${currentHunk.newStart},${currentHunk.newCount} @@`);
            fixed.push(...currentHunk.lines);
          }
          const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (m) {
            currentHunk = {
              oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10),
              oldCount: 0, newCount: 0, lines: []
            };
          } else {
            fixed.push(line);
          }
        } else if (currentHunk) {
          if (line.startsWith('-')) { currentHunk.oldCount++; currentHunk.lines.push(line); }
          else if (line.startsWith('+')) { currentHunk.newCount++; currentHunk.lines.push(line); }
          else if (line.startsWith(' ')) { currentHunk.oldCount++; currentHunk.newCount++; currentHunk.lines.push(line); }
          else if (line.startsWith('\\')) { currentHunk.lines.push(line); }
          else if (line === '') { currentHunk.oldCount++; currentHunk.newCount++; currentHunk.lines.push(' '); }
          else { currentHunk.oldCount++; currentHunk.newCount++; currentHunk.lines.push(' ' + line); }
        } else {
          fixed.push(line);
        }
      }
      if (currentHunk) {
        fixed.push(`@@ -${currentHunk.oldStart},${currentHunk.oldCount} +${currentHunk.newStart},${currentHunk.newCount} @@`);
        fixed.push(...currentHunk.lines);
      }
      
      const patchContent = fixed.join('\n') + '\n';
      const tmpPatch = path.join(ctx?.cwd || process.cwd(), '.agent', `patch-${Date.now()}.diff`);
      fs.mkdirSync(path.dirname(tmpPatch), { recursive: true });
      fs.writeFileSync(tmpPatch, patchContent, 'utf8');

      // Use GNU patch which has powerful --ignore-whitespace and --fuzz
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('patch', ['--batch', '--force', '--ignore-whitespace', '--fuzz=3', abs, tmpPatch], { encoding: 'utf8' });
      fs.rmSync(tmpPatch, { force: true });
      if (r.status !== 0) {
        return { 
          isError: true, 
          content: `Failed to apply diff patch.\nPatch Output:\n${r.stdout}\n${r.stderr}\nPlease verify your diff and try again, or use the regular edit tool.` 
        };
      }
      
      // Fire tool_result event to trigger quality gate
      if (typeof pi.emit === 'function') {
        pi.emit('tool_result', {
          toolName: 'patch_edit',
          input: args,
          content: [{ type: 'text', text: `Successfully patched ${rel}\n${r.stdout}` }],
          isError: false
        }, ctx);
      }

      return {
        content: `Successfully applied patch to ${rel}.\n${r.stdout}`
      };
    }
  });
}
