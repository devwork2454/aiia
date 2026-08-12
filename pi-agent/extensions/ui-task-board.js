import { VStack, HStack, Text } from '@earendil-works/pi-tui';

export default function uiTaskBoardExtension(pi) {
  // 注册名为 "checklist" 的自定义 UI 组件渲染器
  pi.registerMessageRenderer('checklist', (msg, options, theme) => {
    let tasks = [];
    try {
      // 尝试解析大模型吐出的 JSON 任务树
      tasks = JSON.parse(msg.content);
    } catch (e) {
      // 如果解析失败，回退给原生渲染
      return undefined;
    }

    const root = new VStack();
    
    // 渲染标题区
    root.addChild(new Text(theme.fg("customMessageLabel", "\x1b[1m🚀 [极客看板] AIIA 动态任务流\x1b[22m"), 0, 0));
    
    // 渲染任务列表区
    for (const t of tasks) {
      const row = new HStack();
      if (t.status === 'done') {
        row.addChild(new Text(theme.fg("success", "  [✓] "), 0, 0));
        row.addChild(new Text(theme.fg("success", t.task), 0, 0));
      } else if (t.status === 'doing') {
        row.addChild(new Text(theme.fg("warning", "  [⚙] "), 0, 0)); // 假装是个 spinner
        row.addChild(new Text(theme.fg("warning", "\x1b[1m" + t.task + "\x1b[22m"), 0, 0));
      } else {
        row.addChild(new Text(theme.fg("dim", "  [ ] "), 0, 0));
        row.addChild(new Text(theme.fg("dim", t.task), 0, 0));
      }
      root.addChild(row);
    }

    return root;
  });

  // 注册一个专用的演示命令，让产品经理一键预览 WOW 效果
  pi.registerCommand('demo-board', {
    description: '演示极客看板动态 UI 组件',
    handler: async (args, ctx) => {
      // 模拟多步任务状态
      const stages = [
        { task: "分析系统架构依赖", status: "done" },
        { task: "挂载 React/Ink 渲染引擎", status: "done" },
        { task: "编译并绑定原生终端画笔", status: "doing" },
        { task: "启动后台进程服务", status: "pending" }
      ];

      // 主动推送自定义 UI 组件到终端
      ctx.session.sendMessage({
        customType: 'checklist',
        content: JSON.stringify(stages),
        display: "show",
      });
    }
  });
}
