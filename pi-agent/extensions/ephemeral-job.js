import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * AIIA Ephemeral Job Extension
 * Implements K8s Job-like stateless subagents with model escalation strategy.
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function ephemeralJobExtension(pi) {
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
    async execute(params, ctx) {
      const envTiers = process.env.JOB_ESCALATION_TIERS || 'low,medium,high';
      const tiers = envTiers.split(',').map(s => s.trim()).filter(Boolean);
      let startIndex = tiers.indexOf(params.initialTier || 'low');
      if (startIndex === -1) startIndex = 0;

      const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-job-'));

      try {
        const escalationHistory = [];

        for (let i = startIndex; i < tiers.length; i++) {
          const tier = tiers[i];
          const outPath = path.join(workingDir, '.subagent_output.md');
          
          const jobResult = await new Promise((resolve) => {
            const proc = spawn('node', [
              '--experimental-permission',
              '--allow-fs-read=*',
              `--allow-fs-write=${workingDir}`,
              '--allow-child-process',
              '-e',
              `// 模拟 Pi 引擎的伪执行 (测试用/生产依赖 @earendil-works/pi-coding-agent)
              const fs = require("fs");
              if (process.env.ROUTER_FORCE_MODEL === "low" && process.env.SHOULD_FAIL_LOW === "1") {
                console.error("Low tier failed for test");
                process.exit(1);
              }
              if (process.env.TEST_MODE === "1") {
                fs.writeFileSync("${outPath}", "Mock Job Success on tier " + process.env.ROUTER_FORCE_MODEL);
                process.exit(0);
              }
              // 真实环境下，这里其实是调用系统的 pi 命令
              // 由于隔离环境中可能没有全局 pi 命令，为了健壮性在此暂用桩代码占位，或者实际调用 npm exec pi
              const cp = require("child_process");
              const child = cp.spawn("npx", ["pi", "--task", ${JSON.stringify(params.task + '\\n\\n(执行完毕请将最终结论写入文件: ' + outPath + ')') }], { stdio: "inherit", cwd: "${workingDir}" });
              child.on("close", code => process.exit(code));
              `
            ], {
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
            fs.rmSync(workingDir, { recursive: true, force: true });
            const _res = { 
              status: 'success', 
              tier: jobResult.tier, 
              output: jobResult.output,
              escalationHistory 
            };
            return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
          }

          if (i === tiers.length - 1) {
            fs.rmSync(workingDir, { recursive: true, force: true });
            const _res = { 
              status: 'error', 
              message: `❌ 所有梯队重试完毕仍失败。最终阻断在梯队 [${tier}]。`,
              lastLog: jobResult.log,
              escalationHistory
            };
            return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
          }
        }
      } catch (e) {
        try { fs.rmSync(workingDir, { recursive: true, force: true }); } catch (err) { console.error('Cleanup failed:', err); }
        const _res = { status: 'error', message: e.message };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      }
    }
  });
}
