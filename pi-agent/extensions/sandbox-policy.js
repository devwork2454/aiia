/**
 * AIIA MCP & Skill Sandbox Policy Extension (Phase 2 P7)
 * 1. 监听 tool_call 钩子，对所有工具/MCP 调用执行沙箱安全审计。
 * 2. 注册工具 set_sandbox_policy 与 get_sandbox_policy_status。
 * Shell HITL 交给 safety.js；此处只硬拦截，避免双确认。
 */

import { SandboxPolicy, normalizeSandboxMode } from '../src/sandbox-policy.js';

let currentPolicy = new SandboxPolicy({ mode: 'sandbox' });

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function sandboxPolicyExtension(pi) {
  pi.on('tool_call', async (event) => {
    const toolName = event?.toolName || event?.tool || event?.name || '';
    const input = event?.input || event?.args || {};

    const evalRes = currentPolicy.evaluate(toolName, input);
    if (!evalRes.allowed) {
      return {
        block: true,
        reason: `[Sandbox Policy Blocked]: ${evalRes.reason}`
      };
    }
  });

  pi.registerTool({
    name: 'set_sandbox_policy',
    description: 'Set sandbox mode to sandbox or strict (permissive requires SANDBOX_ALLOW_PERMISSIVE=1).',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'sandbox | strict' },
        allowedTools: { type: 'array', items: { type: 'string' }, description: 'strict 模式下的白名单工具' }
      },
      required: ['mode']
    },
    async execute(_id, params) {
      try {
        const mode = normalizeSandboxMode(params.mode);
        currentPolicy = new SandboxPolicy({
          mode,
          allowedTools: params.allowedTools || []
        });
        const _res = { status: 'success',
          message: `✅ 沙箱策略模式已成功设置为 ${mode}`,
          policy: {
            mode: currentPolicy.mode,
            allowedTools: Array.from(currentPolicy.allowedTools)
          }
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      } catch (e) {
        const _res = { status: 'error',
          message: `❌ ${e.message}`,
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      }
    }
  });

  pi.registerTool({
    name: 'get_sandbox_policy_status',
    description: '获取当前 MCP 工具与技能的沙箱管控状态与白名单规则',
    parameters: {
      type: 'object',
      properties: {}
    },
    async execute() {
      const _res = { status: 'success',
        policy: {
          mode: currentPolicy.mode,
          allowedTools: Array.from(currentPolicy.allowedTools),
          blockedPaths: currentPolicy.blockedPaths
        }
      };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
    }
  });
}
