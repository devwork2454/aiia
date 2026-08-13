/**
 * AIIA MCP & Skill Sandbox Policy Extension (Phase 2 P7)
 * 1. 监听 tool_call 钩子，对所有工具/MCP 调用执行沙箱安全审计。
 * 2. 注册工具 set_sandbox_policy 与 get_sandbox_policy_status。
 */

import { SandboxPolicy } from '../src/sandbox-policy.js';

let currentPolicy = new SandboxPolicy({ mode: 'sandbox' });

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function sandboxPolicyExtension(pi) {
  // 1. 挂载 tool_call 安全过滤钩子
  pi.on('tool_call', async (event, ctx) => {
    const toolName = event?.toolName || event?.tool || event?.name || '';
    const input = event?.input || event?.args || {};

    const evalRes = currentPolicy.evaluate(toolName, input);
    if (!evalRes.allowed) {
      if (ctx?.hasUI) {
        const cmdStr = input?.command || input?.code || input?.CodeContent || JSON.stringify(input);
        const confirmed = await ctx?.ui.confirm(
          "⚠ 沙箱拦截警告",
          `该命令被沙箱策略标记为高危：\n${evalRes.reason}\n\n指令内容：\n${cmdStr}\n\n是否仍要强制执行？`
        );
        if (confirmed) {
          return { block: false };
        }
      }
      return {
        block: true,
        reason: `[Sandbox Policy Blocked]: ${evalRes.reason}`
      };
    }
  });

  // 2. set_sandbox_policy
  pi.registerTool({
    name: 'set_sandbox_policy',
    description: '动态设置 MCP 工具与 Skill 调用沙箱策略模式与白名单',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'sandbox | strict | permissive' },
        allowedTools: { type: 'array', items: { type: 'string' }, description: 'strict 模式下的白名单工具' }
      },
      required: ['mode']
    },
    async execute(_id, params) {
      currentPolicy = new SandboxPolicy({
        mode: params.mode,
        allowedTools: params.allowedTools || []
      });
      return {
        status: 'success',
        message: `✅ 沙箱策略模式已成功设置为 ${params.mode}`,
        policy: {
          mode: currentPolicy.mode,
          allowedTools: Array.from(currentPolicy.allowedTools)
        }
      };
    }
  });

  // 3. get_sandbox_policy_status
  pi.registerTool({
    name: 'get_sandbox_policy_status',
    description: '获取当前 MCP 工具与技能的沙箱管控状态与白名单规则',
    parameters: {
      type: 'object',
      properties: {}
    },
    async execute() {
      return {
        status: 'success',
        policy: {
          mode: currentPolicy.mode,
          allowedTools: Array.from(currentPolicy.allowedTools),
          blockedPaths: currentPolicy.blockedPaths
        }
      };
    }
  });
}
