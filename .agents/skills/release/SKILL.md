---
name: release
description: Automates the CI/CD pipeline (quality checks, tests, verification, and git push). Triggered by /release.
---

# /release — 自动化测试与发布流水线 (CI/CD)

当用户输入 `/release` 或提到“自动发布”、“运行验证并发布”时，请立即触发本技能，担任自动化 DevOps 角色执行完整的验证与推送闭环。

## 执行步骤与规范

为了确保代码质量与安全，发布流程**必须**严格遵循以下顺序串行执行。遇到任何一步失败，必须立刻终止流程并汇报给用户，**严禁**跳过验证强行推送代码。在开始前，记得用 `update_todos` 初始化发布任务清单。

### 阶段一：本地质量门禁 (Quality Gates)
1. 运行 `bash scripts/quality-check.sh` （执行 Biome, Ruff, ast-grep 等多维架构防腐扫描）。
2. 如果发生报错退出码不为 0，停止流程，按标准 L1/L2 格式输出错误日志。

### 阶段二：综合功能验收 (Test & Verify)
1. 运行 `bash .harness/verify.sh` 进行项目的最终集成与状态验收。
2. 同样，任何非 0 的退出码都视为发布阻断，向用户报告根因。

### 阶段三：自动化提交与发布 (Commit & Push)
若以上所有门禁均以 Exit 0 绿灯通过，自动执行以下 Git 动作完成发布：
1. `git add -A`
2. `git commit -m "chore(release): automated testing and release via /release"`（如果用户在 `/release` 后面附加了特定的发布说明文字，请将其作为 commit message）。
3. `git push`
4. 如果遇到 Git 冲突或网络断开导致推送失败，停止并汇报。

### 阶段四：汇报闭环 (Feedback)
在成功执行完 Git Push 后，按照 `AGENTS.md` 规范的“三层信息流模型”输出终态：
- **L1 核心视图**：首行带上进度标记，如 `[发布完成 3/3]`，并告知发布闭环已成功。
- **L2 下钻视图**：通过引用块 `>` 展示跑过的命令日志摘要及 Git Push 的成功结果。
- **末句总结**：一句话精炼总结所有测试已绿灯通过，代码已安全推送至远程。
