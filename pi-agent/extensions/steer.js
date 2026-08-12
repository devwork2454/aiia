/**
 * AIIA /steer command — side-channel steering during execution.
 * Includes XML attention enhancement, active tool interruption, and subagent broadcasting.
 */
import { registerAiiaHandler } from "../src/command-registry.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function steerExtension(pi) {
  const steerHandler = async (args, ctx) => {
    if (!args || args.trim().length === 0) {
      ctx?.ui?.notify?.("Usage: /steer <your correction or context>", "warning");
      return;
    }

    // 优化 3: 提示词 XML 强化注入 (Attention 霸占)
    const steerMessage = `
<CRITICAL_USER_OVERRIDE>
[⚠️ 旁路纠偏/Steer 指令] 用户在观察你的执行时发现严重偏离，强行打断并提出了最新要求：
"${args.trim()}"
请立即放弃原本计划中与此冲突的部分，在下一次行动时必须完全按照此要求执行！
</CRITICAL_USER_OVERRIDE>
`.trim();

    // 优化 1: 暴力打断底层阻塞命令 (SIGINT / 取消当前工具调用)
    let toolsCancelled = false;
    if (typeof pi.cancelActiveTasks === "function") {
      pi.cancelActiveTasks();
      toolsCancelled = true;
    } else if (ctx?.session && typeof ctx.session.cancelActiveToolCalls === "function") {
      ctx.session.cancelActiveToolCalls();
      toolsCancelled = true;
    }
    
    // 优化 2: 子智能体（Subagent）穿透广播
    let sentToSubagent = false;
    if (typeof pi.broadcastToSubagents === "function") {
      pi.broadcastToSubagents(steerMessage, { deliverAs: "interrupt" });
      sentToSubagent = true;
    } else if (ctx?.activeSubagents && Array.isArray(ctx.activeSubagents)) {
      for (const sub of ctx.activeSubagents) {
        if (typeof sub.sendUserMessage === "function") {
          sub.sendUserMessage(steerMessage, { deliverAs: "interrupt" });
          sentToSubagent = true;
        }
      }
    }

    // 主会话注入
    try {
      pi.sendUserMessage(steerMessage, { deliverAs: "interrupt" });
      
      // 聚合反馈
      const notices = ["/steer: 纠偏指令已套用 XML 强制注入"];
      if (toolsCancelled) notices.push("已发送 SIGINT 截断当前工具等待");
      if (sentToSubagent) notices.push("已穿透空投至子 Agent");
      
      ctx?.ui?.notify?.(notices.join(" | "), "info");
    } catch (err) {
      try {
        pi.sendUserMessage(steerMessage, { deliverAs: "followUp" });
        ctx?.ui?.notify?.(" /steer: 主线程高度阻塞，已降级为高优队列插入", "warning");
      } catch (fallbackErr) {
        ctx?.ui?.notify?.(
          ` /steer 注入失败: ${fallbackErr?.message || err?.message}`,
          "error"
        );
      }
    }
  };

  pi.registerCommand("steer", {
    description: "运行期强纠偏 (支持中断与穿透) | 用法: /steer <调整说明>",
    handler: steerHandler,
  });
  
  registerAiiaHandler("steer", steerHandler);
}
