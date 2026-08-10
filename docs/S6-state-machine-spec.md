# Phase 3 S6: 确定性状态机设计草案 (Task DAG Runner)

## 1. 目标
在 `pi-agent/extensions/task-runner.js` 中引入强类型的状态机（State Machine）控制流，取代 Agent 自由发散的 Chat Loop，确保任务流转的幂等性与可预测性。

## 2. 状态节点 (State Nodes) 定义
每个 Task 将被拆解为严格的节点，包含：
- `PLANNING`: 意图拆解与依赖分析
- `EXECUTION`: 隔离执行（触发 Worktree Worker）
- `ASSERTION`: 断言验证（触发 Quality Gate）
- `MERGE/ROLLBACK`: 成功合并或失败回滚

## 3. 流转约束 (Transitions)
- Agent **不可**自发跳跃状态。
- 只有在 `ASSERTION` 节点返回 `PASS` 时，才允许进入 `MERGE`。
- 如果 `ASSERTION` 连续失败超过 3 次（对接 S8），强制进入 `ROLLBACK`。

## 4. 交付切片验收标准
- [ ] `task-runner.js` 支持加载 `.agent/state_machine.json` 规则。
- [ ] 单元测试覆盖节点失败与状态机回滚机制。
- [ ] 接入 `.harness/verify.sh`。
