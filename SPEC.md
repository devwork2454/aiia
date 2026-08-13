# AIIA — 个人 OS 级 Agent

## 一句话
站在 Pi harness 上，用 **官方 Extension** 做开发 / 办公 / 生活 Agent：记忆、安全、质量门、路由、调度。活入口是本机 `pi`，不是自研 HTTP 宿主。

## 活架构

```
用户 ↔ pi CLI
        → pi-agent/extensions（safety / memory / quality-gate / …）
        → pi-agent/src（policy / memory-store / …）
        → ~/.config/aiia/aiia.db（MemoryStore 自建表）
```

飞书 IM、Python adapter、Node HTTP `host/` 已进 `legacy/`。接入层现状：cli ready，飞书 archived，web stub。

## 目录
- `pi-agent/` — 真被 Pi 加载的扩展、共用逻辑、单测
- `.agents/skills/` — skill 真源（install 链到 `~/.pi/agent/skills`）
- `.harness/verify.sh` — 验收门
- `legacy/` — 旧 host / adapter / 飞书 / Ink CLI / 悬空 systemd unit
- `ARCHITECTURE.md` — 分层说明（以实码为准）

## 明确不做 / 已归档
- 不自研常驻 HTTP 宿主（`host/src/server.js` 只存在于 legacy）
- 不重开飞书运行时
- 不上 LangGraph / Mastra
