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


### 0.1 控制面通道：Slash / Tool / Skill

| 通道 | 给谁 | 约定 |
|---|---|---|
| **Slash** | 人 | 会话控制与高敏入口；默认补全白名单：`/goal` `/steer` `/config` `/vault` `/aiia`（`/reply` `/profile` `/add-dir` `/imp` 可手打或 `/aiia <sub>`） |
| **Tool** | 模型 | 业务能力（`remember`/`memory_search`/`kb_search`/…）；由 capability-catalog 短目录注入 |
| **Skill** | 模型（懒） | 长说明书可发现；推荐 `enableSkillCommands=false`，不进 `/` 菜单 |

冷门 slash（如 `/memory` `/sync`）过渡期仍可手打，或经 `/aiia <sub>`；勿把 skill 正文整页灌进 system prompt。

---

## 1. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ L7 自进化层  Trajectory JSONL + 关机只写 project-card draft     │  ← 人审 apply
├──────────────────────────────────────────────────────────────┤
│ L6 调度层    Task DAG / worktree / cron(会话内 tick)            │
├──────────────────────────────────────────────────────────────┤
│ L5 记忆知识层 MemoryStore(SQLite) + kb_search + context-card    │
│              + LSP / semantic（registerTool；非 LanceDB）       │
├──────────────────────────────────────────────────────────────┤
│ L4 控制面    safety / sandbox / quality-gate / router / GC      │
├──────────────────────────────────────────────────────────────┤
│ L3 模型层    Pi 原生 providers + before_provider_request 路由   │
├──────────────────────────────────────────────────────────────┤
│ L2 进程层    本机 `pi` CLI（旧 HTTP host 已进 legacy/）          │
├──────────────────────────────────────────────────────────────┤
│ L1 内核层    Pi Harness：agentic loop / read,bash,edit,write    │
└──────────────────────────────────────────────────────────────┘
        ▲ 接入层：cli ready；飞书 archived；web stub；cron 随会话 tick
```

---

## 2. L1 内核层（复用 Pi，不改）

- **入口**：SDK `createAgentSession()` / `createAgentSessionRuntime()`（后者支持在同一进程内替换/续接/fork 会话，是内置 interactive/print/rpc 模式同一层）。
- **内置工具**：`read / bash / edit / write`（默认），可选 `grep / find / ls`。自定义工具与之合并。
- **会话能力**：消息树、`compact()` 压缩、`steer()/followUp()` 流中插话、`navigateTree()` 分支导航——**直接复用**，不重造。
- **资源发现**：`DefaultResourceLoader` 从 `~/.pi/agent/extensions|skills` 与项目 `.pi/extensions|skills`、`.agents/skills` 自动加载。AIIA 扩展经 `pi install <repo>/pi-agent` 注册（见 `install.sh` Step 5），由 package 路径加载 `pi-agent/extensions` + 旁路 `pi-agent/src`；**不要**在仓库根挂 `.pi/extensions → pi-agent/extensions` 半截软链，也**不要**把单个扩展软链进 `~/.pi/agent/extensions/`——jiti 会按软链所在目录解析 `../src` 并启动失败。`install.sh` 会清这两类残留。
- **默认全局 Skills**：仓库源在 `.agents/skills/`；新机由 `install.sh` Step 6 调用 `scripts/link-pi-skills.sh`，将 `auto-harness` / `goal` / `imp` 等幂等 symlink 到 `~/.pi/agent/skills`，任意 cwd 下的 Pi 均可加载。

## 3. L2 进程层（本机 Pi CLI，不自研 HTTP 宿主）

活入口是用户本机的 **`pi`**（`pi install <repo>/pi-agent` 加载扩展）。`package.json` 写明 *no self-hosted HTTP*。

**默认减面**：只启用核心（safety / sandbox / secret-gate / memory / card / catalog / prompt-snapshot / quality-gate / tool-result-prune / GC / router + slash 控制面）和视觉件（`ui-task-board` / `compact-progress` / `turn-status`）。其余工厂直接 return。`AIIA_EXTENSIONS=all` 全开；`AIIA_EXTRA_EXTENSIONS=cron-scheduler,web-search-proxy` 追加；`AIIA_VISUAL_DISABLED=1` 关掉看板、压缩条和 turn 状态行。

旧 mock HTTP 宿主（`host/src/server.js`、`scripts/aiia-host.sh`、systemd unit）已进 **`legacy/`**，不是当前路径。

### 3.1 后台与脱退

会话落在 `~/.pi/agent/sessions/`，不绑某个自研常驻进程。

| 形态 | 机制 | 适用 | 状态 |
|---|---|---|---|
| **A. 前台 `pi`** | 交互 TUI | 日常主路径 | ✅ |
| **B. `pi -p` / `pi --mode rpc`** | 无 TUI；子代理 / quality-gate 修文件 | L6 / S8 | ✅ |
| **C. tmux/screen** | `tmux new -d 'pi'` + attach | 关窗口保会话 | Pi 官方支持 |

**延后**：跨设备 attach、任务完成推送（实验性 `pi-server` 稳定后再上）。


## 4. L4 控制面（核心，全部是 Pi Hook）

按官方事件精确落位（return/ctx 语义已核对）：

| 能力 | Pi Hook | 机制 |
|---|---|---|
| **安全网关** | `pi.on("tool_call")` | 命中高危（`rm -rf /`、`sudo`、`git push --force`…）→ **返回 `{ block: true, reason, terminate? }`**（不是抛异常）；可选 `user_bash` 拦手动命令 |
| **质量门** | `tool_result`（edit/write 后） | 写后确定性检查：JS=`node --check`+Biome；PY=`py_compile`+Ruff；失败回灌；S8 局域重试。全量静态见 `scripts/quality-check.sh`（Biome+Ruff F/B+ast-grep），用法见 [docs/QUALITY.md](docs/QUALITY.md) |
| **结果截断** | `tool_result`（全部工具） | 超长输出无模型 head+tail；全文外溢 `.agent/spill/`（0600）；`AIIA_TOOL_RESULT_PRUNE_DISABLED=1` 可关 |
| **上下文注入** | `pi.on("context")` | 记忆仍按 query 注入；catalog/profile/reply/add-dir/secret 名字合成一份 hash 快照，变了才改写（不往 system 追加） |
| **模型路由** | `pi.on("before_provider_request")` | `router.js` 仅对 local-proxy / 层级别名改写 `payload.model`；直连 Charon/DeepSeek 不改；**没有注册 `model_select`** |
| **HITL 人审** | `tool_call` 返回 `{ block }` + Pi UI confirm | 高危 shell 由 `safety.js` 确认；sandbox 只硬拦、不再二次弹窗 |

分级安全策略（L0 只读放行 / L1 非破坏写放行 / L2 高危 HITL）在 `tool_call` 一处实现即可。

## 5. L3 模型层（核心）

- **默认**：Pi 原生多 provider——`pi /login`（xAI / Claude / Codex 订阅）或 API Key + `~/.pi/agent/models.json` 自定义 endpoint。**个人单机不需要 LiteLLM/Bifrost**。
- **分级切换**：`before_provider_request` 里 `evaluateModelRoute` → `low|medium|high|reasoning`；默认只改写本地分层反代。
- **Cursor**：仅作独立 CLI 使用，**不接入为 LLM provider**（无官方 OpenAI 兼容 API）。
- **可选二期**：仅当多个客户端要共享统一 fallback/限流/计费时，再上 LiteLLM sidecar，只用官方 Key。

## 6. L5 记忆与知识层（核心）

**数据模型（SQLite，实现在 `pi-agent/src/memory-store.js`，默认 `~/.config/aiia/aiia.db`）**
- `memories`：`content, category, tags, initial_strength S, access_count, last_accessed_at`（表由 MemoryStore 自建；根目录 `data/schema.sql` 是旧 host 遗物，运行时不读）。
- **艾宾浩斯权重**：`W(t) = S·e^(−Δt/τ) + log2(access_count+1)·0.2`。旧 Python `legacy/adapter/memory.py` 已归档。

**注入路径**：`context` hook 拉取 `active()` Top-N 注入；`/memory` + `remember` / `memory_search` / `memory_list`。
**S3**：`kb_search` 对 MemoryStore + Markdown knowledge 做词法混合检索，只回 path/title/snippet/score。
**LSP / 语义**：`lsp_*` 与 `semantic_*` 经 `pi.registerTool` 注册；向量是 SQLite + 余弦，**不是 LanceDB**。embedding 失败会退回随机向量，检索质量不保证。

**Context Card（路线 A，已落地 `extensions/context-card.js`）**
- **定位**：结构化私有属性（UserCard/ProjectCard），**非** LLM 微调；与 memory 边界——memory=软事实/经验；card=硬约束（intent/stack/tags）、工具偏好（`prefer_tools`/`avoid_tools`）、目录过滤（`noise_deny`）。
- **路径与 merge**：全局 `~/.config/aiia/user-card.json`（`AIIA_USER_CARD_PATH` 可覆写）+ 项目 `.agent/project-card.json` deep-merge，**项目优先**；`before_agent_start` 注入 ≤900 字符短摘要（`MAX_PROFILE_PROMPT_CHARS`），禁止整卡 JSON 灌进 system prompt。
- **catalog 过滤**：`capability-catalog` 读取 merged card 的 `avoid_tools`/`prefer_tools` 降噪工具目录；kill switch `AIIA_PROFILE_DISABLED=1` 时**不注入、不过滤**。
- **指纹与草案**：`/profile refresh` 按规则扫描项目文件生成 `.agent/project-card.draft.json`（**不自动写盘**）；`/profile apply` 人审后写入 `project-card.json` 并更新 `fingerprint`。指纹算法：对存在的探测文件按路径排序拼接——**`.agent/project-card.json` 用除 `fingerprint` 外字段的内容 hash**；其余探测文件（`package.json`、`pyproject.toml`、`requirements.txt`、`ARCHITECTURE.md`、`PROGRESS.md`、`Cargo.toml`、`go.mod`、`pom.xml`）仍用 `relpath:mtimeMs:size`；再 SHA256 取前 16 位。
- **关机画像**：`trajectory.js` 在 `session_shutdown` 最多写 `.agent/project-card.draft.json`，**必须** `/profile apply` 才落正式卡。详见 [docs/superpowers/plans/2026-08-10-context-card-route-a.md](docs/superpowers/plans/2026-08-10-context-card-route-a.md).


## 7. L6 调度层 + L7 自进化层

- **L6**：`subagent-worktree.js`（`pi -p` 拉起子进程）+ `task-runner.js`（DAG）+ `cron-scheduler.js`（**仅 Pi 会话存活时 tick**，`CRON_DISABLED=1` 可关）。
- **L7**：`trajectory.js` 写 JSONL；关机只写卡片 **draft**。`optimizer.js` / `metaprompt-optimizer.js` 可手工触发，不自动 apply。

## 8. 明确延后（非核心，按序解锁）

1. ~~L4 `quality-gate`~~：已落地 `pi-agent/extensions/quality-gate.js`（edit/write → lint/typecheck 回灌）；配套 Biome/Ruff/ast-grep/pre-commit + `scripts/quality-check.sh` 已进 verify，详见 [docs/QUALITY.md](docs/QUALITY.md)
2. ~~L7 轨迹采集~~ 已落地（S2）；自动 apply 卡片已关掉，只留 draft + 人审
3. ~~L5 `kb_search`~~ 已落地；LSP/semantic 已 `registerTool`（非 LanceDB）；真桌面驱动仍条件延后
4. ~~L7.6 接口闸门~~：已落地 `os-browser`（默认关+dry-run）；真 ydotool/patchright 桌面仍条件
5. ~~接入层最小切片~~：`channel-adapter`（cli ready；飞书 archived；web deferred/stub）
6. L3 LiteLLM 网关 sidecar
7. 跨设备 attach + 后台完成推送（实验性 `pi-server` 稳定后）

## 9. 目标仓库结构（A 路线：以 `pi-agent/` 为准）

```
aiia/
├── pi-agent/             # 真被 Pi 加载的 extension + 单测
│   ├── extensions/       # safety/memory/router/web-search/…（已落地）
│   ├── src/              # policy/memory-store/… 共用逻辑
│   └── test/             # 单元 + 真会话 wiring
├── scripts/              # install 辅助（如 link-pi-skills.sh）
├── .agents/skills/       # 仓库 skills 真源（install 链到 ~/.pi）
├── legacy/               # 已归档旧 host/adapter/飞书
├── docs/                 # CAPABILITIES 等补充设计
└── .harness/verify.sh    # 分层验收
```
控制面与切片 S0–S11 / Context Card / P0–P1 契约修复已收口。LanceDB 未采用；自研 HTTP 宿主已归档。

## 10. 分阶段路线（每阶段一个 verify 门）

| 阶段 | 交付 | verify 门 |
|---|---|---|
| **0（已完成）** | 宿主雏形 + SQLite + safety 样例 + mock 闭环 | ✅ 现有 verify 全绿 |
| **1 控制面核心** | `tool_call` 真拦截、`context` 记忆注入、edit/write 质量门 | 危险命令 block、记忆注入、坏编辑 quality-gate 回灌 |
| **2 模型分级** | `router.js` 四级路由 + 直连 provider 门禁 | router 单测 + Charon 不误改写 |
| **3 真实会话** | `@earendil-works/pi-coding-agent` 真加载 extension | integration `INTEGRATION_OK` |
| **4 Phase 2（已交付）** | P1–P7：搜索反代 / worktree / router / 记忆增强 / DAG / cron / sandbox | `.harness/verify.sh` 全绿 |
| **4+ 余项** | 真桌面驱动、LiteLLM、跨设备 attach | 非本表项 |

---

### 一句话总结
**Pi 当内核、控制面全用官方 Hook、记忆用同进程 SQLite；活宿主是本机 `pi` CLI。旧 HTTP host / 飞书 adapter 在 `legacy/`。**

> 能力扩展（机密/共享配置 · OS 键鼠 · 指纹浏览器）见 [docs/CAPABILITIES.md](docs/CAPABILITIES.md)（L5.5 核心 / L7.6 二期）。

---

> 实现路线已切换为 **A（Pi 原生 extension）**：见 `pi-agent/`（safety+memory extension，真被 Pi 加载）与 `legacy/`（已归档的旧 mock 宿主/adapter/飞书）。当前架构以 PROGRESS.md 为准。
