import fs from 'node:fs';
import path from 'node:path';

/**
 * L7 Metaprompt Optimizer Extension
 * Reads trajectory logs and extracts learnings to update project guidelines.
 * 
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi 
 */
import { isExtensionEnabled } from "../src/extension-profile.js";

export default function metapromptOptimizer(pi) {
  if (!isExtensionEnabled("metaprompt-optimizer")) return;
  pi.on('before_agent_start', async (ctx) => {
    // Register the /optimize command to manually trigger reflection
    if (ctx.registerCommand) {
      ctx.registerCommand({
        name: 'optimize',
        description: 'Analyze recent trajectories and extract metaprompt learnings.',
        action: async (args) => {
          const cwd = ctx.cwd || process.cwd();
          const trajPath = path.join(cwd, '.agent', 'trajectories.jsonl');
          
          if (!fs.existsSync(trajPath)) {
            return {
              output: `[Optimizer] No trajectories found at ${trajPath}. Run some tasks first.`,
              exit: true
            };
          }

          // Read the last few kilobytes of trajectory to find errors and corrections
          // (In a real scenario, this would be passed to an LLM to analyze)
          const content = fs.readFileSync(trajPath, 'utf8');
          const lines = content.split('\n').filter(Boolean);
          
          let errorCount = 0;
          for (const line of lines) {
            if (line.includes('isError":true') || line.includes('FAILED')) {
              errorCount++;
            }
          }

          const report = `[L7 Optimizer] Analyzed ${lines.length} trajectory events.\nFound ${errorCount} error/recovery instances.\n\n-> In a full LLM pass, these would be summarized into AGENTS.md rules to prevent future regressions.`;
          
          return {
            output: report,
            exit: true // Prevent standard chat from taking over
          };
        }
      });
    }
  });

  // 自动触发：在整个会话结束或系统空闲时，自动在后台静默执行反思提纯
  pi.on('session_shutdown', async (ctx) => {
    const cwd = ctx.cwd || process.cwd();
    const trajPath = path.join(cwd, '.agent', 'trajectories.jsonl');
    if (!fs.existsSync(trajPath)) return;

    try {
      const content = fs.readFileSync(trajPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      let errorCount = 0;
      for (const line of lines) {
        if (line.includes('isError":true') || line.includes('FAILED')) {
          errorCount++;
        }
      }

      // 如果本次积攒了足够多的错题（比如 > 2次），就自动执行提纯
      if (errorCount > 0) {
        // Background reflection path (silent on success; errors go through catch below)
        // 这里对接真正的大模型写回逻辑
      }
    } catch (e) {
      console.error('[L7 Auto-Optimizer] session_shutdown reflection failed:', e?.message || e);
    }
  });
}
