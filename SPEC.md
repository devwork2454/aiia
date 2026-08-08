# AIIA — 个人 OS 级 Agent（阶段 0）

## 一句话
站在 Pi harness 上，做「开发 / 办公 / 生活」个人 Agent：飞书进、本地常驻宿主跑、SQLite 记、高危命令拦。

## 架构

```
飞书 IM
  → adapter/ (Python FastAPI：验签、归一化、回写)
  → host/    (Node：HTTP + Pi createAgentSession；mock 可测)
  → extensions/ (safety + memory hooks)
  → data/aiia.db (SQLite：sessions / messages / memories)
```

## 目录
- `adapter/` — 飞书 channel adapter
- `host/` — Pi 宿主服务
- `extensions/` — Pi 扩展（随宿主加载）
- `data/schema.sql` — 记忆与会话表
- `tests/` — 闭环验证

## 延后
LanceDB、worktree subagent、LiteLLM、破甲、自进化 Metaprompt、pi-server daemon。
