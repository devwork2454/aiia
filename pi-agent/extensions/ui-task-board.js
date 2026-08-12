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

    // theme.fg 仅接受 dark/light 主题已定义的色键（无 primary/secondary）
    const frame = (s) => theme.fg("muted", s);
    const active = (s) => theme.fg("accent", s);

    const root = new VStack();

    // 渲染标题区 (独立对比色，不与普通文本混淆)
    root.addChild(new Text(frame("┌── Task Pipeline"), 0, 0));

    // 渲染任务列表区
    for (const t of tasks) {
      const row = new HStack();
      if (t.status === 'done') {
        row.addChild(new Text(frame("│ ") + theme.fg("success", "✓ "), 0, 0));
        row.addChild(new Text(theme.fg("dim", t.task), 0, 0));
      } else if (t.status === 'doing') {
        row.addChild(new Text(frame("│ ") + active("⟳ "), 0, 0));
        row.addChild(new Text(active("\x1b[1m" + t.task + "\x1b[22m"), 0, 0));
      } else {
        row.addChild(new Text(frame("│ ") + theme.fg("dim", "· "), 0, 0));
        row.addChild(new Text(theme.fg("dim", t.task), 0, 0));
      }
      root.addChild(row);
    }

    root.addChild(new Text(frame("└──"), 0, 0));

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
      pi.sendMessage({
        customType: 'checklist',
        content: JSON.stringify(stages),
        display: true,
      });
    }
  });
}
