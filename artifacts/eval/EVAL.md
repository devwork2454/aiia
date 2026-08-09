# EVAL — Charon/Grok 扩展劫持扫描

日期: 2026-08-09
GOAL: 扫描并清除破坏 Charon→xAI 正常请求的 bug；verify 绿且无 Critical/Major。

## 维度评估

| 维度 | 评级 | 说明 |
|------|------|------|
| D1 功能正确性 | OK | `.harness/verify.sh` 退出 0；Charon 链路 `/usa`+toolResult(含 find) 最终 model 仍为 `grok-4.5` |
| D2 架构一致性 | OK | 直连 provider 不改写层级别名/`*-search`；本地反代行为保留 |
| D3 成本/安全闸门 | Minor | `~/.pi/agent/extensions/charon.ts` 仍明文写入 xAI API Key（本地配置，未入库）；建议改 env 引用 |
| D4 可维护性 | OK | PROGRESS/GOAL 已更新；router/web-search 门禁有单测与 `/usa` 回归 |
| D5 已知条件项 | OK | 未把「真实 TUI 已重启验证」伪装成完成；需用户重启 Pi 加载新 extension |

## 本轮发现与处置

| 问题 | 严重度 | 处置 |
|------|--------|------|
| router 无条件改 model→`high` | Critical（已修于前序） | 保留门禁 |
| web-search 直连追加 `-search` | Critical（已修于前序） | 保留门禁 |
| **toolResult 含 `find` 误触发搜索**（会话 `/usa` 实证） | Major | **本轮已修**：只扫最近 user 消息 |
| 关键词 `find`/`最新` 仍偏宽（user 侧） | Minor | 未改词表；user 侧误触概率可接受 |
| 历史 merge(subagent) 污染提交仍在 log | Minor | 测试已隔离，不再新增；未做 history rewrite |
| Charon API Key 明文在 extension | Minor | 记未尽，不在本 GOAL 强改用户密钥布局 |

## 结论

无明显问题（无 Critical/Major）。停机条件 1 满足。
