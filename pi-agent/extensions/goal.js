/**
 * AIIA /goal command — kicks the agent into the goal-driven closed loop.
 * Skill text lives in `.agents/skills/goal` (linked to ~/.pi/agent/skills/goal).
 */
import {
  buildGoalKickoffMessage,
  parseGoalArgs,
  resolveGoalDelivery,
} from "../src/goal-command.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function goalExtension(pi) {
  pi.registerCommand("goal", {
    description:
      "目标驱动自治闭环 | 用法: /goal <目标>；省略目标则沿用 PROGRESS.md 未完成项",
    handler: async (args, ctx) => {
      const message = buildGoalKickoffMessage(args);
      const { goalText, fromProgress } = parseGoalArgs(args);
      const idle =
        typeof ctx?.isIdle === "function" ? ctx.isIdle() : true;
      const delivery = resolveGoalDelivery({ isIdle: idle });

      try {
        if (delivery.deliverAs) {
          pi.sendUserMessage(message, { deliverAs: delivery.deliverAs });
        } else {
          pi.sendUserMessage(message);
        }
      } catch (err) {
        // Fallback if streaming API rejects without deliverAs
        try {
          pi.sendUserMessage(message, { deliverAs: "followUp" });
          ctx?.ui?.notify?.("Goal queued as follow-up", "info");
        } catch (err2) {
          ctx?.ui?.notify?.(
            ` /goal failed: ${err2?.message || err?.message || err}`,
            "error",
          );
          return;
        }
      }

      if (delivery.notify) {
        ctx?.ui?.notify?.(delivery.notify, "info");
      } else {
        ctx?.ui?.notify?.(
          fromProgress
            ? " /goal：沿用 PROGRESS.md，已注入闭环协议"
            : ` /goal：已启动 — ${goalText.slice(0, 60)}`,
          "info",
        );
      }
    },
  });
}
