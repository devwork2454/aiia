/**
 * /imp slash-command helpers (Pi).
 * Builds the kickoff user message that instructs the agent to follow the imp skill.
 */

export const IMP_SKILL_HINT =
  'Read and follow skill `imp` (`.agents/skills/imp/SKILL.md` or `~/.pi/agent/skills/imp/SKILL.md`).';

/**
 * @param {string} args raw args after `/imp`
 * @returns {{taskText:string, empty:boolean}}
 */
export function parseImpArgs(args = '') {
  const taskText = String(args || '').trim();
  if (!taskText) {
    return { taskText: '', empty: true };
  }
  return { taskText, empty: false };
}

/**
 * @param {string} args
 * @returns {string} message to send via pi.sendUserMessage (or usage text when empty)
 */
export function buildImpKickoffMessage(args = '') {
  const { taskText, empty } = parseImpArgs(args);
  if (empty) {
    return [
      '[AIIA /imp] 缺少任务描述。',
      '',
      '用法：/imp "你的任务描述"',
      '示例：/imp "重构认证模块"',
      '',
      IMP_SKILL_HINT,
    ].join('\n');
  }

  return [
    '[AIIA /imp] 优化并执行（先整形，再动手）。',
    '',
    IMP_SKILL_HINT,
    '',
    `RAW_TASK: ${taskText}`,
    '',
    '硬约束：',
    '1. 先输出简短 <scratchpad> 与 <optimized_prompt>，再立即按优化提示词执行',
    '2. 纯提问则跳过优化仪式，直接回答',
    '3. 多步闭环优先衔接 skill `goal` / `/goal`；本仓库改代码须可验证时跑 bash .harness/verify.sh',
    '4. 工具优先；最小改动；验收未满足不得假装完成',
    '',
    '请立即开始第一阶段（分析与优化），然后进入第二阶段执行。',
  ].join('\n');
}

/**
 * Decide how to deliver the kickoff given idle state.
 * @returns {{action:'send'|'steer'|'busy', deliverAs?:string, notify?:string}}
 */
export function resolveImpDelivery({ isIdle = true, forceFollowUp = false } = {}) {
  if (forceFollowUp) {
    return { action: 'send', deliverAs: 'followUp', notify: 'Imp queued as follow-up' };
  }
  if (isIdle) {
    return { action: 'send' };
  }
  return {
    action: 'send',
    deliverAs: 'steer',
    notify: 'Agent busy — steering /imp kickoff',
  };
}
