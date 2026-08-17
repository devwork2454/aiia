const MODES = ['normal', 'draft', 'auto'];
let currentModeIndex = 0;

export default function devModeSwitchExtension(pi) {
  process.env.AIIA_DEV_MODE = MODES[currentModeIndex];

  const toggleMode = (ctx) => {
    currentModeIndex = (currentModeIndex + 1) % MODES.length;
    const newMode = MODES[currentModeIndex];
    process.env.AIIA_DEV_MODE = newMode;

    let desc = '';
    if (newMode === 'normal') desc = '标准协作交互';
    if (newMode === 'draft') desc = '草稿/快速原型';
    if (newMode === 'auto') desc = '全自动托管 (执行分析+专家团投票，仅在遇阻时请求人工)';

    ctx?.ui?.notify?.(`🚀 开发模式已切换为：[ ${newMode.toUpperCase()} ] -> ${desc}`, 'info');
  };

  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand('mode', {
      description: '循环切换开发模式 (normal / draft / auto)',
      handler: async (args, ctx) => toggleMode(ctx),
    });
    pi.registerCommand('m', {
      description: '快捷切换开发模式 (同 /mode)',
      handler: async (args, ctx) => toggleMode(ctx),
    });
  }

  pi.on('before_provider_request', (event) => {
    const mode = process.env.AIIA_DEV_MODE || 'normal';
    if (mode === 'normal') return;

    const payload = event?.payload ?? event?.req ?? {};
    if (!payload.messages || !Array.isArray(payload.messages)) return;

    let instructions = '';
    if (mode === 'draft') {
      instructions =
        '[System: 草稿模式] 请以最快、最简洁的方式进行原型探索，不要求高标准的工程化或错误处理，先实现核心主链路功能为主。';
    } else if (mode === 'auto') {
      instructions =
        '[System: 全自动托管模式] 必须遵守：所有决策都执行分析，创建团队讨论投票决策。人工不参与，请自动编排任务、写代码并修复所有报错，直到目标达成。除非遇到完全无法解决的技术阻塞或重大安全问题，否则不要停下来询问用户。';
    }

    if (instructions) {
      // 在系统提示词最后附加我们的模式约束
      const msgs = [...payload.messages];
      const sysMsgIndex = msgs.findIndex((m) => m.role === 'system');
      if (sysMsgIndex !== -1) {
        msgs[sysMsgIndex] = {
          ...msgs[sysMsgIndex],
          content: msgs[sysMsgIndex].content + '\n\n' + instructions,
        };
      } else {
        msgs.unshift({ role: 'system', content: instructions });
      }
      return { ...payload, messages: msgs };
    }
  });
}
