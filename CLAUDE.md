# AIIA

个人开发 / 办公 / 生活用的 OS 级 AI Agent（基于开源 Pi harness 二次开发）。

## 闭环工作协议
- 每个任务按 autonomy-harness:closed-loop 技能执行。
- 会话开始：先读 PROGRESS.md 和 git log 恢复状态。
- 完成判定以 .harness/verify.sh 为准，验证不过不得宣告完成。
- 每个可验证子目标完成即 git commit，并同步更新 PROGRESS.md。
