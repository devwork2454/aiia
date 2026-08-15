/**
 * /goal slash-command helpers (Pi).
 * Builds the kickoff user message that instructs the agent to follow the goal skill.
 */

export const GOAL_SKILL_HINT =
  "Read and follow skill `goal` (`.agents/skills/goal/SKILL.md` or `~/.pi/agent/skills/goal/SKILL.md`).";

/**
 * @param {string} args raw args after `/goal`
 * @returns {{goalText:string, fromProgress:boolean}}
 */
export function parseGoalArgs(args = "") {
  const goalText = String(args || "").trim();
  if (!goalText) {
    return {
      goalText: "沿用 PROGRESS.md 中未完成项（代定为可验证切片）",
      fromProgress: true,
    };
  }
  return { goalText, fromProgress: false };
}

/**
 * @param {string} args
 * @returns {string} message to send via pi.sendUserMessage
 */
export function buildGoalKickoffMessage(args = "") {
  const { goalText, fromProgress } = parseGoalArgs(args);
  return [
    "[AIIA /goal] 启动目标驱动自治闭环。",
    "",
    GOAL_SKILL_HINT,
    "",
    `GOAL: ${goalText}`,
    fromProgress ? "（未提供显式目标：先读 PROGRESS.md 锚定）" : "",
    "",
    "硬约束：",
    "0. 启动时必须立即调用 update_todos 工具创建 5 个阶段节点：需求分析、资源检索、编码执行、本地验证、验收。并随着进展实时更新状态。",
    "1. 更新 PROGRESS.md 的 GOAL / 验收标准 / 本轮计划",
    "2. 实现后必须亲自运行：bash .harness/verify.sh（非 0 不得报通过）",
    "3. 写 artifacts/eval/EVAL.md（D1–D5）；无 Critical/Major 才可停机「通过」",
    "4. verify.sh 只增强不弱化；条件项不得伪装完成",
    "5. 最多 3 轮实现→评估；阻塞写入 PROGRESS「阻塞」节后停止",
    "6. 按 skill 汇报格式收尾（含下一步建议；无则写「无」）",
    "",
    "请立即开始：先调用 update_todos 初始化阶段进度条，然后读 PROGRESS.md 与 git log 锚定 GOAL 执行。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Decide how to deliver the kickoff given idle state.
 * @returns {{action:'send'|'steer'|'busy', deliverAs?:string, notify?:string}}
 */
export function resolveGoalDelivery({ isIdle = true, forceFollowUp = false } = {}) {
  if (forceFollowUp) {
    return { action: "send", deliverAs: "followUp", notify: "Goal queued as follow-up" };
  }
  if (isIdle) {
    return { action: "send" };
  }
  return {
    action: "send",
    deliverAs: "steer",
    notify: "Agent busy — steering /goal kickoff",
  };
}
