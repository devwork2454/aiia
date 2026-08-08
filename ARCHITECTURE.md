# AIIA 核心架构设计（基于 Pi 二次开发）

> 范围：本文只设计**最核心的功能架构**，暂不含飞书/IM channel（那属于接入层，见 §8 延后）。
> 参考《AI Agent 开发需求调研.pdf》，但所有 Pi 钩子/接口均以官方 `@earendil-works/pi-coding-agent`（v0.84.1）文档为准，已剔除 PDF 中过时/杜撰的 API 名。

---

## 0. 设计总原则

1. **内核不分叉**：Pi 作为 agentic loop 内核，通过 SDK 嵌入；一切自定义能力做成 **Extension / Hook / Tool / Command / Skill**，绝不改 Pi 源码。
2. **控制面即钩子**：安全、质量、记忆、路由、进化全部挂在 Pi 生命周期事件上，形成可插拔控制面。
3. **懒加载优先**：记忆/知识用 Lazy Skill（默认一行摘要），保住 Pi「system prompt 极小」的底座优势。
4. **合规红线**：**不做**模型破甲/越狱/绕过 Provider 安全策略（PDF 有，本方案剔除）。安全中间件只做「高危命令拦截 + 人审」。
5. **机器验收**：每层能力都要有 `.harness/verify.sh` 可判定的通过标准。

---

## 1. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ L7 自进化层  Trajectory Logger → 离线 Metaprompt（人审 gate）    │  ← 延后
├──────────────────────────────────────────────────────────────┤
│ L6 调度层    L0意图路由 / L1 Lead / L2 Worker(spawn_subagent)   │  ← 二期
│              + Git Worktree 隔离                                │
├──────────────────────────────────────────────────────────────┤
│ L5 记忆知识层 SQLite(艾宾浩斯记忆/轨迹) + Lazy Skill 注入        │  ← 核心
│              [预留] LSP / RAG / LanceDB                         │
├──────────────────────────────────────────────────────────────┤
│ L4 控制面    安全网关 / 质量门 / 上下文注入 / 模型路由（Hooks）  │  ← 核心
├──────────────────────────────────────────────────────────────┤
│ L3 模型层    Pi 原生 providers(/login + models.json)+scopedModels│  ← 核心
│              [可选] LiteLLM sidecar（多客户端共享 fallback 时）  │
├──────────────────────────────────────────────────────────────┤
│ L2 宿主层    Node 常驻宿主：SDK 嵌入 + 本地 API + 多会话生命周期 │  ← 核心
├──────────────────────────────────────────────────────────────┤
│ L1 内核层    Pi Harness：agentic loop / read,bash,edit,write /  │  ← 复用
│              session tree / compaction                          │
└──────────────────────────────────────────────────────────────┘
        ▲ 接入层（延后）：CLI / 飞书 / Web / Cron —— 只把请求归一化后投给 L2
```

---

## 2. L1 内核层（复用 Pi，不改）

- **入口**：SDK `createAgentSession()` / `createAgentSessionRuntime()`（后者支持在同一进程内替换/续接/fork 会话，是内置 interactive/print/rpc 模式同一层）。
- **内置工具**：`read / bash / edit / write`（默认），可选 `grep / find / ls`。自定义工具与之合并。
- **会话能力**：消息树、`compact()` 压缩、`steer()/followUp()` 流中插话、`navigateTree()` 分支导航——**直接复用**，不重造。
- **资源发现**：`DefaultResourceLoader` 从 `~/.pi/agent/extensions|skills` 与项目 `.pi/extensions|skills`、`.agents/skills` 自动加载。AIIA 的扩展就落在这些目录。

## 3. L2 宿主层（AIIA 自研，stage-0 已有雏形）

一个常驻 Node 进程，职责：
- 用 SDK 包装 Pi，暴露本地 API（当前 HTTP `/v1/chat` + `/health`；后续可加 `--mode rpc` 或 Unix socket）。
- **多会话管理**：`session_key → AgentSession` 映射；用 `createAgentSessionRuntime` 做续接/fork。
- **生命周期**：systemd 常驻（`deploy/aiia-host.service`）、健康检查、优雅退出。
- **降级**：`AIIA_MOCK=1` 离线可测，无 Key 也能跑 verify。

> 对应现有代码：`host/src/{server,agent,safety}.js`。

### 3.1 后台运行与脱退重连（Background / detach-reattach）

**为什么天然支持**：会话状态持久化在磁盘（`~/.pi/agent/sessions/`），不绑终端；宿主是独立常驻进程，客户端断开不影响任务。

三种形态（按推荐度）：

| 形态 | 机制 | 适用 | 状态 |
|---|---|---|---|
| **A. 常驻宿主（推荐）** | systemd user service 常驻 + `Restart=on-failure`；或 `scripts/aiia-host.sh` 用 `nohup`+PID 文件脱离终端 | 个人 OS 级主路径 | ✅ 已实现 |
| **B. `pi --mode rpc` 子进程** | 宿主起 headless Pi，stdin/stdout JSONL，无 TUI | subagent / 后台派发 | 预留（L6） |
| **C. tmux/screen 兜底** | `tmux new -d 'pi'` + `tmux attach` | 临时最省事 | Pi 官方支持 |

**脱退重连语义**：
- 关终端 → 宿主继续（A 已保证）。
- 重新连上 → 客户端按 `session_key` 请求，宿主用 `createAgentSessionRuntime` 续接同一会话历史，不丢上下文。
- 日志视图 → `scripts/aiia-host.sh logs -f` 或 `journalctl --user -u aiia-host -f`。

**运维入口**：
- 无 systemd：`scripts/aiia-host.sh {start|stop|restart|status|logs|attach}`
- 有 systemd：`systemctl --user enable --now aiia-host` + `loginctl enable-linger` 保证登出后仍活

**延后**：跨设备 attach、后台任务完成主动推送——等实验性 `pi-server`/`pi-client`（Unix socket + CBOR，多 client 租约 attach）稳定后再上（见 §8）。


## 4. L4 控制面（核心，全部是 Pi Hook）

按官方事件精确落位（return/ctx 语义已核对）：

| 能力 | Pi Hook | 机制 |
|---|---|---|
| **安全网关** | `pi.on("tool_call")` | 命中高危（`rm -rf /`、`sudo`、`git push --force`…）→ **返回 `{ block: true, reason, terminate? }`**（不是抛异常）；可选 `user_bash` 拦手动命令 |
| **质量门** | `tool_call`/`tool_result`（edit/write 后） | 文件写入后自动 lint/typecheck；失败把错误回灌下一轮 |
| **上下文注入** | `pi.on("context")` | 把「活跃记忆 + 相关 skill 摘要」注入本轮上下文（对应 PDF 的记忆注入，真实钩子名是 `context`） |
| **模型路由** | `pi.on("model_select")` / `before_provider_request` | 按任务分级选模型、header 注入、限流；**只做合法路由，不改写以绕过安全策略** |
| **HITL 人审** | `tool_call` 返回 block + 宿主通知 | 高危操作挂起等待人工确认（接入层回来后接 IM/终端） |

分级安全策略（L0 只读放行 / L1 非破坏写放行 / L2 高危 HITL）在 `tool_call` 一处实现即可。

## 5. L3 模型层（核心）

- **默认**：Pi 原生多 provider——`pi /login`（xAI / Claude / Codex 订阅）或 API Key + `~/.pi/agent/models.json` 自定义 endpoint。**个人单机不需要 LiteLLM/Bifrost**。
- **分级切换**：用 `scopedModels`（会话内 cycle）+ `model_select` hook 把「便宜模型做路由/贵模型做架构」策略化。
- **Cursor**：仅作独立 CLI 使用，**不接入为 LLM provider**（无官方 OpenAI 兼容 API）。
- **可选二期**：仅当多个客户端要共享统一 fallback/限流/计费时，再上 LiteLLM sidecar，只用官方 Key。

## 6. L5 记忆与知识层（核心）

**数据模型（SQLite，已落地 `data/schema.sql`）**
- `sessions` / `messages`：会话与消息轨迹。
- `memories`：`content, category, tags, initial_strength S, access_count, last_accessed_at`。
- **艾宾浩斯权重**：`W(t) = S·e^(−Δt/τ) + log2(access_count+1)·0.2`，低于阈值归档/剪枝（`adapter/memory.py` 已实现）。

**注入路径**：`context` hook 拉取 `active_memories()` Top-N 注入；`/memory` 自定义命令做增删查。
**Lazy Skill**：知识条目以 skill 形式存在，平时一行摘要，触发意图才展开完整内容与工具 schema。
**预留（延后）**：LSP client（精确符号跳转，0 向量 token）+ LanceDB（语义 RAG），组成 Hybrid Context Engine——**记忆/文档上千或需代码库语义检索时才上**。

## 7. L6 调度层 + L7 自进化层（二期，接口先预留）

- **L6 分级调度**：`pi.registerTool("spawn_subagent")` → 为子任务 `git worktree add` 建隔离工作区 → 用 SDK 起 headless 子会话（或 `pi --mode rpc`）→ 完成后 `git merge --squash` 回收。Lead/Worker 分级避免主上下文污染。
- **L7 自进化**：`agent_end`/`session_shutdown` hook 落 `trajectories.jsonl`；离线 LLM-as-Judge 识别高频失败 → 生成 skill/规则候选 → **回归测试胜率达标 + 人审**后才写入 `.agents/skills`。**先只做轨迹采集**，优化器延后。

## 8. 明确延后（非核心，按序解锁）

1. 接入层：飞书 adapter / Web / Cron（channel 归一化后投 L2）
2. L6 subagent + worktree 并发
3. L5 LSP + LanceDB Hybrid RAG
4. L7 Metaprompt 自进化优化器
5. L3 LiteLLM 网关 sidecar
6. 跨设备 attach + 后台完成推送（实验性 `pi-server` 稳定后；基础后台常驻已在 §3.1 落地）

## 9. 目标仓库结构

```
aiia/
├── host/                 # L2 宿主：SDK 嵌入 + 本地 API + 会话管理
│   └── src/{server,agent,safety}.js
├── extensions/           # L4 控制面（挂 Pi hooks）
│   ├── safety.ts         #   tool_call → {block}
│   ├── quality-gate.ts   #   edit 后 lint/typecheck（待建）
│   ├── memory.ts         #   context 注入 + /memory 命令（待建）
│   └── router.ts         #   model_select 分级路由（待建）
├── memory/               # L5 记忆（Python 现有；后续可并入 host）
│   └── (adapter/memory.py, data/schema.sql)
├── skills/               # Lazy Skills（知识库条目）
├── .pi/                  # 项目级 Pi 资源发现目录
└── .harness/verify.sh    # 分层验收
```

## 10. 分阶段路线（每阶段一个 verify 门）

| 阶段 | 交付 | verify 门 |
|---|---|---|
| **0（已完成）** | 宿主雏形 + SQLite + safety 样例 + mock 闭环 | ✅ 现有 verify 全绿 |
| **1 控制面核心** | `tool_call` 真拦截（block API）、`context` 记忆注入、edit 后质量门 | 危险命令 block、记忆被注入上下文、坏编辑触发 lint 失败回灌 |
| **2 模型分级** | `scopedModels` + `model_select` 分级路由 + fallback | 指定任务命中预期模型；主模型不可用时 fallback 生效 |
| **3 真实会话** | 装 `@earendil-works/pi-coding-agent`，`AIIA_MOCK=0` 打通一轮真 Agent | 真实 prompt 有响应；工具受控 |
| **4+ 二期** | subagent/worktree、LSP+RAG、自进化、接入层 | 各自独立验收 |

---

### 一句话总结
**Pi 当内核、Node 宿主常驻、控制面全用官方 Hook（安全/质量/记忆/路由）、记忆用 SQLite+艾宾浩斯+Lazy Skill；subagent、向量 RAG、自进化、飞书全部延后并预留接口。**

> 能力扩展（机密/共享配置 · OS 键鼠 · 指纹浏览器）见 [docs/CAPABILITIES.md](docs/CAPABILITIES.md)（L5.5 核心 / L7.6 二期）。
