/**
 * AIIA Quality Gate extension (S1 & S8)
 * After edit/write succeeds, run lint/typecheck.
 * S8: If fails, spawns a child agent to fix it locally before returning to main loop.
 */
import {
  evaluateToolResultQuality,
  extractTargetPath,
  resolveTargetPath,
  evaluateFileQuality,
  formatQualityFeedback,
  buildQualityGatePatch,
  isMutatingFileTool
} from '../src/quality-gate.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function qualityGateExtension(pi) {
  pi.on('tool_result', async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    
    if (!event || event.isError) return null;
    if (!isMutatingFileTool(event.toolName)) return null;

    const rel = extractTargetPath(event.input);
    const abs = resolveTargetPath(rel, cwd);
    if (!abs) return null;

    let report = evaluateFileQuality(abs, { cwd });
    if (!report || report.passed) return null;

    // S8: Local auto-retry loop
    const MAX_RETRIES = process.env.QUALITY_GATE_MAX_RETRIES ? parseInt(process.env.QUALITY_GATE_MAX_RETRIES, 10) : 3;
    let attempt = 0;
    
    while (!report.passed && attempt < MAX_RETRIES) {
      attempt++;
      const feedback = formatQualityFeedback(report);
      
      const fixTask = `[AIIA Quality Gate] File ${rel} failed verification:\n${feedback}\nPlease fix these errors immediately using edit tool. DO NOT output conversational text, just fix the file.`;
      
      const args = ['--mode', 'rpc', '-p', fixTask];
      
      // We log the subagent's output to a file for debugging, instead of ignore
      const logFile = path.join(cwd, '.agent', 'quality-gate.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `\n\n--- Quality Gate Retry Attempt ${attempt}/${MAX_RETRIES} for ${rel} ---\n`);
      
      try {
        // Run child pi process synchronously to block the tool_result hook
        const child = spawnSync('npx', ['pi', ...args], {
          cwd,
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        fs.appendFileSync(logFile, `Child Exit Code: ${child.status}\nStdout:\n${child.stdout}\nStderr:\n${child.stderr}\n`);
      } catch (err) {
        fs.appendFileSync(logFile, `Execution Error: ${err.message}\n`);
      }
      
      report = evaluateFileQuality(abs, { cwd });
    }
    
    // If still failing after retries, we must not throw this to the user as a chat loop.
    // We will rollback the file to prevent broken code from polluting the context, 
    // and return a clear instruction to the main loop to try a different architectural approach.
    if (!report.passed) {
      spawnSync('git', ['checkout', '--', rel], { cwd, encoding: 'utf8' });
      
      // Inject a structured block message to the main loop, telling it that local micro-fixes failed.
      return {
        content: [
          ...(Array.isArray(event?.content) ? event.content : []),
          { 
            type: 'text', 
            text: `\n[AIIA Quality Gate] CRITICAL: File ${rel} failed verification and auto-retry exhausted (${MAX_RETRIES} attempts). The file has been rolled back to its previous state.\nDo not try the exact same small edit again. You must rethink your approach or use a different library/method.\nOriginal Error:\n${formatQualityFeedback(report)}\n` 
          }
        ],
        isError: true
      };
    }
    
    // If fixed, return null to let the main loop continue as if it was correct the first time!
    return null;
  });
}
