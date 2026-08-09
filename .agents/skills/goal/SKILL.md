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
