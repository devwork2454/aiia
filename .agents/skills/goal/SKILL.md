---
name: goal
description: >-
  Goal-driven autonomous loop for Pi: self-plan, verify, evaluate, improve until
  pass/block. Trigger: /goal, 目标驱动, 自治做到完成.
---

# /goal — 目标驱动自治闭环（Pi）

用户给出一个目标（或默认沿用 `PROGRESS.md` 未完成项）。你负责**自助规划 → 执行 → 验证 → 多维评估 → 改进**，循环直到停机。

在 Pi 中也可输入斜杠命令：`/goal <目标>`（由 `extensions/goal.js` 注入本协议）。

## 停机条件（命中任一即停）

1. **通过**：多维评估无 Critical/Major；`.harness/verify.sh` 退出 0；目标验收标准全部满足。
2. **阻塞**：外部依赖不可得、架构条件项无法消除且目标硬依赖它、连续两轮同一 Major 无法下降。
3. **预算**：默认最多 **3** 轮「实现→评估」大循环（用户另有说明除外）。

阻塞时必须写入 `PROGRESS.md`「阻塞」节，然后停止——禁止空转或假装完成。

## 主执行路径（一次只选一条）

| 场景 | 路径 |
|------|------|
| 路由不清 | 先读 PROGRESS / ARCHITECTURE，代定最小可验证切片 |
| 规格清晰的实现 | closed-loop：实现 → verify → 修到绿 |
| 技术路线不明 | 先短调研再定规格（可逆默认） |
| 部署 | 仅用户明确要求时再 ship |

## 流程

### 0. 锚定目标

写入/更新 `PROGRESS.md`：

```markdown
## GOAL
<一句话>
### 验收标准
- ...
### 本轮计划
1. ...
```

无用户目标时：取 `PROGRESS.md` 第一条未开始/条件项可收口切片。

### 1–3. 规划 → 执行 → 验证

- 短计划 ≤7 步；代定可逆默认。
- `verify.sh` **只增强不弱化**。
- 必须亲自跑：`bash .harness/verify.sh`（非 0 不得报通过）。

### 4. 多维评估

写入 `artifacts/eval/EVAL.md`，维度 D1–D5（功能 / 架构 / 成本安全 / 可维护 / 条件项诚实）。  
无明显问题 = 无 Critical、无 Major。

### 4.5 自省与自愈（方案 B：aiia 迭代更新自身）

除业务目标外，**每次 goal 循环必须自检 aiia 自身健康**（D6 维度）：

1. **检查修复队列**：读 `.agent/heal/queue/`，若有 `self-heal` 任务卡，先消费（优先级高于业务目标）：
   - 任务卡内已写明：错误摘要 → 详情 → 修复要求。
   - 执行修复要求：定位根因 → 最小 patch → 亲自跑 `bash .harness/verify.sh`。
   - 退出码非 0 = 修复失败：回滚 patch，保留任务卡，在 `PROGRESS.md` 记录分析；同一任务卡最多重试 2 轮，仍失败则标记阻塞并汇报。
   - 修复成功：`git commit`，删除任务卡（移入 `.agent/heal/done/`），更新 `PROGRESS.md`。
2. **自检自身缺陷**（本次执行是否暴露）：扩展报错 / 规则缺失 / 文档过时 / 配置错误 / 流程缺陷。
   - 发现 → 若可在当轮闭环内小步修复（≤30 行、过 verify.sh），立即修；否则写入修复队列（等价于给后续循环留一张任务卡）。
3. **禁止失控自改**：对 aiia 自身（`pi-agent/`、`.agents/`、`.harness/`、`scripts/`、`docs/`）的修改必须过 `verify.sh`；重大方向变更仍需用户确认。

### 5. 汇报格式

```
## GOAL 结果
（通过 / 阻塞）
## 执行了什么
## 评估摘要
## 阻塞或未尽
## 下一步建议（单条可复制命令；若无则写「无」）
```

## 示例

```
/goal 把架构 v1 最小切片做到评估无明显问题
/goal 消除可行性报告里所有 Major
```
