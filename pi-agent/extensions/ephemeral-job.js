import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * AIIA Ephemeral Job Extension
 * Implements K8s Job-like stateless subagents with model escalation strategy.
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
import { isExtensionEnabled } from "../src/extension-profile.js";

export default function ephemeralJobExtension(pi) {
  if (!isExtensionEnabled("ephemeral-job")) return;
  pi.registerTool({
    name: 'run_ephemeral_job',
    description: '分配一个无状态的短时临时子任务（不修改当前目录代码，在临时隔离环境执行）。常用于数据清洗、格式化、隔离查询、总结等“杂活”。失败时自动按梯队 (low->medium->high) 升级模型重试。任务执行完毕只返回核心成果。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务的具体指令' },
        initialTier: { type: 'string', description: '起始模型梯队', enum: ['low', 'medium', 'high', 'reasoning'] }
      },
      required: ['task']
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const envTiers = process.env.JOB_ESCALATION_TIERS || 'low,medium,high';
      const tiers = envTiers.split(',').map(s => s.trim()).filter(Boolean);
      let startIndex = tiers.indexOf(params.initialTier || 'low');
      if (startIndex === -1) startIndex = 0;

      const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-job-'));

      /** Best-effort cleanup; a leftover tmpdir is better than failing the job. */
      const rmDir = () => {
        try { fs.rmSync(workingDir, { recursive: true, force: true }); } catch { /* ignore */ }
      };
      /** Tool result carrying the payload plus its own JSON text (Pi tool_result contract). */
      const toolResult = (res) => ({ ...res, content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] });

      try {
        const escalationHistory = [];

        for (let i = startIndex; i < tiers.length; i++) {
          const tier = tiers[i];
          const outPath = path.join(workingDir, '.subagent_output.md');

          if (process.env.TEST_MODE === '1') {
            if (tier === 'low' && process.env.SHOULD_FAIL_LOW === '1') {
              escalationHistory.push({ tier, success: false, code: 1 });
              if (i === tiers.length - 1) {
                rmDir();
                return toolResult({
                  status: 'error',
                  message: `❌ 所有梯队重试完毕仍失败。最终阻断在梯队 [${tier}]。`,
                  escalationHistory
                });
              }
              continue;
            }
            const output = `Mock Job Success on tier ${tier}`;
            rmDir();
            return toolResult({ status: 'success', tier, output, escalationHistory: [...escalationHistory, { tier, success: true }] });
          }

          const jobResult = await new Promise((resolve) => {
            const prompt = `${params.task}\n\n(执行完毕请将最终结论写入文件: ${outPath})`;
            const proc = spawn('pi', ['-p', prompt], {
              cwd: workingDir,
              env: {
                ...process.env,
                ROUTER_FORCE_MODEL: tier,
                ROUTER_ENABLED: 'true',
                QUALITY_GATE_DISABLED: 'true',
                TRAJECTORY_DISABLED: 'true'
              }
            });

            let log = '';
            proc.stdout?.on('data', (d) => { log += d.toString(); });
            proc.stderr?.on('data', (d) => { log += d.toString(); });

            proc.on('close', (code) => {
              if (code === 0 && fs.existsSync(outPath)) {
                resolve({ success: true, tier, output: fs.readFileSync(outPath, 'utf8').trim(), log });
              } else {
                resolve({ success: false, tier, code, log });
              }
            });
            proc.on('error', (err) => {
              resolve({ success: false, tier, code: -1, log: err.message });
            });
          });

          escalationHistory.push({ tier, success: jobResult.success, code: jobResult.code });

          if (jobResult.success) {
            rmDir();
            return toolResult({
              status: 'success',
              tier: jobResult.tier,
              output: jobResult.output,
              escalationHistory
            });
          }

          if (i === tiers.length - 1) {
            rmDir();
            return toolResult({
              status: 'error',
              message: `❌ 所有梯队重试完毕仍失败。最终阻断在梯队 [${tier}]。`,
              lastLog: jobResult.log,
              escalationHistory
            });
          }
        }
      } catch (e) {
        rmDir();
        return toolResult({ status: 'error', message: e.message });
      }
    }
  });
}
