/**
 * AIIA L6 Micro-context Handoff Extension
 * 定义并拦截 `send_message` 工具，强制 Subagent 返回结构化的 Diff/Summary/JSON，杜绝上下文污染。
 */

import { isExtensionEnabled } from "../src/extension-profile.js";

export default function microContextExtension(pi) {
  if (!isExtensionEnabled("micro-context")) return;
  // 1. 注册微上下文通信工具（供 Subagent 调用以回传精简结果）
  pi.registerTool({
    name: 'send_message',
    description: '向主 Agent 发送微上下文精简报告。禁止发送聊天长文，必须返回标准化的 Summary、Diff 或 JSON。',
    parameters: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          description: '要发送给主 Agent 的结构化信息内容' 
        }
      },
      required: ['message']
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const msg = params.message;
      // 在独立的 worktree 子进程中，我们将消息写入共享的回调文件，供主 Agent 扫描读取
      const fs = await import('fs');
      const path = await import('path');
      const outPath = path.join(ctx.cwd, '.subagent_handoff.json');
      
      fs.writeFileSync(outPath, JSON.stringify({ 
        timestamp: new Date().toISOString(),
        payload: msg 
      }, null, 2), 'utf-8');

      return {
        status: 'success',
        result: 'Message successfully handed off to the main Agent via micro-context.'
      };
    }
  });

  // 2. 挂载 tool_call 安全拦截器：校验内容是否合规
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event?.toolName || event?.tool || event?.name || '';
    if (toolName !== "send_message") return;

    const input = event?.input || event?.args || {};
    const message = input.message || input.Message || '';

    // 规则 1：硬性字符长度限制
    const MAX_LENGTH = 2000;
    if (message.length > MAX_LENGTH) {
      return {
        block: true,
        reason: `[Micro-context Policy] Message exceeds ${MAX_LENGTH} characters (current: ${message.length}). Please condense your output into a short Summary, Diff, or JSON.`
      };
    }

    // 规则 2：结构化格式探测 (启发式)
    const hasDiff = message.includes("```diff");
    const hasJson = message.includes("```json") || message.trim().startsWith("{");
    const hasSummary = /summary[:：]|结论[:：]|汇总[:：]/i.test(message);

    if (!hasDiff && !hasJson && !hasSummary && message.length > 500) {
      if (ctx.hasUI) {
        const confirmed = await ctx.ui.confirm(
          "⚠ 微上下文规范警告",
          `子 Agent 尝试发送非结构化长文本（${message.length} 字符），可能会导致主循环上下文污染。\n是否强制允许发送？`
        );
        if (confirmed) return { block: false };
      }
      return {
        block: true,
        reason: `[Micro-context Policy] Message lacks standardized format. Subagent handoffs must use diff format, json format, or start with 'Summary:'. Do not send conversational text.`
      };
    }
  });
}
