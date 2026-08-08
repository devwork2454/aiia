# 项目进度

## 当前任务

阶段 0 已通过 verifier 终审。下一阶段待用户拍板主入口后继续。

## 已完成
- harness 初始化（git / verify / PROGRESS / CLAUDE.md）
- 读取《AI Agent 开发需求调研.pdf》并并行调研 Pi 真源、网关、OS MVP
- 阶段 0 脚手架：`adapter/` + `host/` + SQLite + safety + `SPEC.md`
- `.harness/verify.sh` 全绿；独立 verifier：**PASS**

## 进行中
- （无）

## 未开始 / 已知问题
- 飞书验签与出站回写未接完（adapter 仅入站归一化 + 投递 host）
- `host/package.json` 尚未声明/安装 `@earendil-works/pi-coding-agent`（真会话需 `AIIA_MOCK=0` + `pi /login`）
- 安全策略仅为高危样例级（`rm -rf /`、`sudo`、`--force`）
- 延后：LanceDB、worktree subagent、LiteLLM、破甲、自进化、pi-server

## 规格摘要（代定）
| 项 | 决策 |
|---|---|
| 基座 | `@earendil-works/pi-coding-agent` 扩展优先，不 fork 核心 |
| 多模型 | Pi 原生 `/login` + models.json；不上 sidecar |
| Channel | Python 飞书 adapter 保留 |
| 记忆 | SQLite MVP |
| 明确不做 | 破甲；Cursor 当 LLM provider；LanceDB/worktree（阶段 0） |
