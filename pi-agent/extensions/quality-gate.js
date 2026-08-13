/**
 * AIIA Quality Gate extension (S1 & S8)
 * After edit/write succeeds, run lint/typecheck.
 * S8: If fails, spawns a child agent to fix it locally before returning to main loop.
 */
import {
  extractTargetPath,
  resolveTargetPath,
  evaluateFileQuality,
  formatQualityFeedback,
  buildQualityGatePatch,
  isMutatingFileTool,
  qualityGateMaxRetries,
  isQualityGateRollbackEnabled,
  spawnQualityGateFixer,
} from '../src/quality-gate.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function qualityGateExtension(pi) {
  pi.on('tool_result', async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    const env = process.env;

    if (!event || event.isError) return null;
    if (!isMutatingFileTool(event.toolName)) return null;

    const rel = extractTargetPath(event.input);
    const abs = resolveTargetPath(rel, cwd);
    if (!abs) return null;

    let report = evaluateFileQuality(abs, { cwd, env });
    if (!report || report.passed) return null;

    const MAX_RETRIES = qualityGateMaxRetries(env);
    let attempt = 0;

    while (!report.passed && attempt < MAX_RETRIES) {
      attempt++;
      const feedback = formatQualityFeedback(report);
      const fixTask = `[AIIA Quality Gate] File ${rel} failed verification:\n${feedback}\nPlease fix these errors immediately using edit tool. DO NOT output conversational text, just fix the file.`;

      const logFile = path.join(cwd, '.agent', 'quality-gate.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `\n\n--- Quality Gate Retry Attempt ${attempt}/${MAX_RETRIES} for ${rel} ---\n`);

      try {
        const child = spawnQualityGateFixer({ cwd, task: fixTask, env });
        fs.appendFileSync(logFile, `Child Exit Code: ${child.status}\nStdout:\n${child.stdout}\nStderr:\n${child.stderr}\n`);
      } catch (err) {
        fs.appendFileSync(logFile, `Execution Error: ${err.message}\n`);
      }

      report = evaluateFileQuality(abs, { cwd, env });
    }

    if (!report.passed) {
      let rolledBack = false;
      if (isQualityGateRollbackEnabled(env)) {
        spawnSync('git', ['checkout', '--', rel], { cwd, encoding: 'utf8', timeout: 15000 });
        rolledBack = true;
      }

      const rollbackNote = rolledBack
        ? 'The file has been rolled back to its previous state.'
        : 'The file was left as-is (set QUALITY_GATE_ROLLBACK=1 to auto-checkout).';
      const patch = buildQualityGatePatch(event, report);
      const extra = `\n[AIIA Quality Gate] CRITICAL: File ${rel} failed verification and auto-retry exhausted (${MAX_RETRIES} attempts). ${rollbackNote}\nDo not try the exact same small edit again. You must rethink your approach or use a different library/method.\n`;
      return {
        content: [
          ...(patch?.content || []),
          { type: 'text', text: extra },
        ],
        isError: true,
      };
    }

    return null;
  });
}
