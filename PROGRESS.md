# 项目进度

## 当前任务

**阶段 0：AIIA OS Agent 脚手架（Pi 二开基座 + 飞书 channel + SQLite 记忆）**

### 目标产出
基于开源 Pi（`@earendil-works/pi-coding-agent`）二次开发个人 OS 级 Agent 的可运行骨架：
飞书消息 → Python channel adapter → Node Pi 宿主 → 回复；本地 SQLite 存会话/偏好记忆；安全 Hook 拦截高危 shell。

### 验收标准（机器可判定）
1. `.harness/verify.sh` 退出码 0
2. `adapter → mock host` 一轮回环单测通过
3. 宿主 `GET /health` 在 mock 模式下可启动并返回 ok
4. SQLite schema 可初始化；记忆 CRUD 单测通过
5. Pi extension（safety）单元逻辑可测：危险命令 DENY、只读命令 ALLOW

### 边界（不做）
- 不做模型破甲/越狱/绕过 Provider 安全策略
- Cursor 订阅不接入为 LLM provider（可并行用 Cursor CLI，不进路由）
- 不上 LiteLLM/Bifrost sidecar（Pi 原生多 provider）
- 不上 LanceDB / LSP hybrid / Git worktree 多 subagent
- 不自研完整 Daemon+CBOR（不用 experimental `pi-server` 当主路径）
- 不把飞书整段重写为 Pi TS extension

### 技术选型（调研代定）
| 项 | 决策 | 理由 |
|---|---|---|
| Harness 基座 | npm `@earendil-works/pi-coding-agent`，扩展优先不 fork | 官方仓 earendil-works/pi；扩展入口非 pi-agent-core |
| 多模型 | Pi `/login` + `~/.pi/agent/models.json` | 已覆盖 xAI/Anthropic/OpenAI；个人单机无需网关 |
| Channel | 保留 Python FastAPI 飞书 webhook 做 adapter | 已有原型；与 OpenClaw 式 channel 分离一致 |
| 宿主 | Node HTTP 包装 `createAgentSession`；`AIIA_MOCK=1` 可离线验证 | SDK 官方嵌入路径 |
| 记忆 | SQLite（+ session JSONL 后续） | 个人量级够用；向量库延后 |
| 安全 | Pre-tool 策略：高危 shell DENY | 补齐 Pi YOLO 默认风险 |

### 必须拍板（推荐项已代定，可纠偏）
见对话中选择题；未回应则按推荐执行。

## 已完成
- harness 初始化（git / verify / PROGRESS / CLAUDE.md）
- 读取《AI Agent 开发需求调研.pdf》并并行调研 Pi 真源、网关、OS MVP

## 进行中
- 阶段 0 脚手架实现与 verify 闭环

## 未开始 / 已知问题
- 真实 Pi 会话需本机 `/login` 或多家 API Key（verify 用 mock）
- PDF 中部分包名/API 过时，以调研结论为准
