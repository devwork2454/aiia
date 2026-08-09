# 项目进度

## GOAL
实现 S3 Hybrid RAG 最小切片：`kb_search` 工具（记忆+Markdown 词法混合检索）+ 可测 verify；LanceDB/LSP 仍为条件项显式延后。
### 验收标准
- `pi-agent/src/kb-search.js` + `extensions/kb-search.js` 存在并注册 `kb_search`
- 检索结果仅含 path/title/snippet/score；builtin 可离线测通（不硬依赖 qmd/LanceDB）
- `.harness/verify.sh` 含 `kb-search.test.js` 且退出 0
- 未把 LanceDB/LSP 伪装为已完成；`artifacts/eval/EVAL.md` 无 Critical/Major
### 状态
通过（2026-08-09）：S3 kb_search 最小切片落地；verify 绿；终审 PASS。
### 本轮计划
1. 实现 kb-search 核心（memory+md 混合；可选 qmd）
2. extension 注册 kb_search
3. 单测 + 增强 verify/integration
4. 评估 → 终审 → commit


## 第二期 Harness 交付切片（机器可判定）

> 约定：每一刀 = 规格写入 PROGRESS → 增强/不弱化 `verify.sh` → 实现 → `bash .harness/verify.sh` → 独立终审 → commit。

| 切片 | 内容 | verify 门 | 状态 |
|---|---|---|---|
| **S0 交付收口** | P1–P7 已实现代码 + `scripts/link-pi-skills.sh` + `install.sh` Step 6 + 文档对齐 | verify 全绿；新机 skills 可链 | 已完成 |
| **S1 quality-gate** | `edit`/`write` 后 lint/typecheck 回灌 | 坏编辑触发失败回灌可测 | 已完成 |
| **S2 trajectory** | L7 仅轨迹采集 `trajectories.jsonl`（优化器仍延后） | hook 落盘 + 单测 | 已完成 |
| **S3 Hybrid RAG** | `kb_search` 最小切片（记忆+MD）；LSP+LanceDB 仍延后 | kb_search 单测 + verify | 已完成 |
| **S4 L7.6 OS/浏览器** | ydotool / patchright（高风险，默认关） | 条件项；需桌面/HITL | 条件项 |
| **S5 接入层** | 飞书/Web channel（曾砍自研，按需重开） | 条件项 | 条件项 |

### Phase 2 已交付能力（P1–P7，代码在 `pi-agent/`）
- **P1** `web-search-proxy.js`：搜索意图嗅探、指令注入；直连 Charon 不追加 `-search`
- **P2** `subagent-worktree.js`：spawn/list/merge/cleanup worktree 子代理
- **P3** `router.js`：low/medium/high/reasoning；直连 provider 默认不改写 model
- **P4** `memory-store.js` / `memory.js`：艾宾浩斯 + 关联度 + `/memory search`
- **P5** `task-runner.js`：DAG 拓扑、重试、断点续传
- **P6** `cron-scheduler.js`：5 段 cron + 持久化工具
- **P7** `sandbox-policy.js`：路径/高危 shell/白名单

### 代定决策
- 第二期「开发交付」= **P1–P7 + S0 打包收口**；ARCHITECTURE「4+ 二期」余项拆成 S1–S5，不在本 GOAL 内实现
- S1 默认 `node --check`（JS）；可选 tsc/py_compile；`QUALITY_GATE_DISABLED=1` 可关
- S2 默认落盘 `<cwd>/.agent/trajectories.jsonl`；`TRAJECTORY_DISABLED=1` 可关；优化器仍延后
- S3 最小切片 = builtin 混合检索（MemoryStore + knowledge Markdown）；qmd 可选；LanceDB/LSP 仍条件延后（语料门槛）
- `KB_SEARCH_DISABLED=1` 可关；默认根：`~/.config/aiia/knowledge` + `<cwd>/knowledge`（`AIIA_KB_PATHS` 可覆写）
- 下一刀默认跳过条件项 S4/S5，或用户指定
- verify 只增强（增加 kb-search.test.js），不弱化既有断言


## 当前架构（A 路线：Pi 原生 extension，砍掉自研宿主与双栈）

AIIA = **Pi harness + 一组真正被 Pi 加载的 Node extension**。不再自研 HTTP 宿主 / Python 双栈 / 飞书。
记忆的 SQLite 读写与 `context` 注入钩子在**同一个 Node 进程**（消除双栈记忆割裂）。

```
pi-agent/
  extensions/safety.js   # tool_call → {block}（真拦截，被 Pi 加载）
  extensions/memory.js   # context 注入 + /memory 命令 + remember 工具
  src/policy.js          # 高危 shell 策略（extension 与单测共用）
  src/memory-store.js    # better-sqlite3 记忆库（艾宾浩斯权重）
  test/                  # 单元 + 真会话集成
legacy/                  # 已归档：旧 mock host / adapter / 飞书 / systemd 脚本
```

## 已完成（真实路径，非 mock）
- 安装 `@earendil-works/pi-coding-agent@0.84.1`，**证实真会话可跑**（agent_start→turn→agent_end 生命周期触发）。
- `safety.js` / `memory.js` 真正通过 `DefaultResourceLoader` 被 Pi 加载（集成测试断言 0 load error、3 extensions）。
- `memory-store.js`（Node/better-sqlite3）取代旧 Python `memory.py`，**记忆读写与注入同进程**。
- `.harness/verify.sh` 改测真实路径：单元（policy+memory）+ 真会话 wiring；全绿。

## 已知限制（据实）
- `context` 注入的具体 API（appendSystemPrompt vs messages）按 SDK 版本做了多路兼容，待有可用模型时端到端确认注入生效。
- 多会话续接 / 常驻仍用 Pi 原生（pi / tmux / --mode rpc），未自研租约。

## 砍掉 / 降级（对单人自用去镀金）
- 删：自研 HTTP 宿主、Python adapter、飞书全套、extensions/safety.ts 孤儿文件 → 移入 legacy/。
- 降级：L5.5 机密先用 .env + sops exec-env（direnv/qmd 提前优化，推迟）。
- 推迟：L7 自进化 Metaprompt、L3 LiteLLM、L7.6 键鼠/浏览器（网关真拦截未端到端前不碰）；LSP+RAG 条件项。

## 阻塞
（无）

## 已完成
- **S3 kb_search**：记忆+Markdown 词法混合检索工具；可选 qmd；LanceDB/LSP 未做（条件延后）。
- **S2 trajectory**：`agent_end`/`session_shutdown` 追加 JSONL；截断+轻量脱敏；优化器未做。
- **S1 quality-gate**：`tool_result` 对 edit/write 跑质量门；失败回灌 `[AIIA Quality Gate]` + `isError:true`；`quality-gate.test.js` 进 verify。
- **Pi 默认集成 auto-harness（新机可用）**：新增 `scripts/link-pi-skills.sh`，`install.sh` Step 6 幂等链接到 `~/.pi/agent/skills`；本机已链接。验证：`link-pi-skills.test.sh` + `.harness/verify.sh` 绿。
- **修复 toolResult 误触发 web-search**：意图嗅探改为只看最近 user 消息，避免 bash 输出中的 `find` 把 Charon 打成 `grok-*-search`（`/usa` 回归）。verify 绿；`artifacts/eval/EVAL.md` 无 Critical/Major。
- **修复 Charon 搜索意图被改成 grok-*-search**：`web-search-proxy.js` 对直连 provider 只注入提示词、不追加 `-search` 模型后缀；本地反代行为不变。`agy-bridge` 对 EADDRINUSE 容错。
- **subagent-worktree 测试隔离**：单测改用临时 git 仓，避免 merge 污染主仓；`merge --abort` 容错。验证：`.harness/verify.sh` 绿，独立终审 PASS。
- **修复 Charon→xAI Grok 被 router 劫持**：`router.js` 默认仅对 `local-proxy` / `127.0.0.1:4000` / 层级别名（`low|medium|high|reasoning`）改写 model；直连 Charon/DeepSeek 等保留原 model（如 `grok-4.5`）。可用 `ROUTER_ENABLED` / `ROUTER_FORCE_MODEL` 覆盖。验证：router 单测 11/11 + `.harness/verify.sh` 绿。
- **优化 auto-harness skill 输出展现 (Output Style Guidelines)**：增加 4 阶段进度面板、专家视角对比矩阵、决策卡片与测试驱动闭环规范。
- **开发 B 项：机密零知识注入与敏感词脱敏网关 (`secret-gate.js`)**：
  - 在 `before_agent_start` 钩子中仅向 Agent 注入可用的 Secret Key 变量名清单。
  - 在 `tool_result` 阶段执行动态脱敏拦截，自动打码替换为 `***REDACTED:KEY_NAME***`。
- **开发 C 项：L6 级多智能体 Git Worktree 并发协作 (`subagent-worktree.js`)**：
  - 注册 `spawn_worktree_subagent` 工具，支持基于 `git worktree` 自动创建物理隔离子工作区。
- **开发 router.js 静态规则路由**：将简单请求分发给便宜模型以降低 API 成本。
- **开发 L5.5 机密与多端配置同步层 (`sync.js` & `vault.js`)**：
  - 实现 GitHub Device Flow 点链接授权登录 (`/sync login`)。
  - 实现本地 AES-256-GCM 强加密与 GitHub Private Gist 零知识云端账号同步 (`/sync push`/`/sync pull`)。
  - 实现本地加密保险箱 (`/vault`)，支持账号密码、身份、地址、银行卡、SSH 等结构化敏感数据管理。
  - 覆盖同步范围：`~/.secrets/env`、Pi Settings、AIIA Config、`aiia.db` 跨项目记忆库、Pi Skills 目录以及各类 MCP 配置文件。
- **自动化安装与 Private 仓库上线**：
  - 编写并测试通过 `install.sh` 新系统一键全自动安装脚本。
  - 创建 GitHub 私有仓库 `devwork2454/aiia` 并成功提交推送全部最新代码。
- **Phase 2 全量核心扩展与高级能力打通 (Phase 2 Full Completion P1 ~ P7)**：
  - **P1 联网搜索反代适配 (`web-search-proxy.js`)**：意图嗅探、多模态 Prompt 指令注入、`SEARCH_MODEL_OVERRIDE` 与反代 URL 自动重定向。
  - **P2 Subagent Worktree 隔离编排 (`subagent-worktree.js`)**：注册 `spawn_worktree_subagent` / `list_worktree_subagents` / `merge_worktree_subagent` / `cleanup_worktree_subagent` 4 大编排工具。
  - **P3 动态模型路由评估器 (`router.js`)**：`evaluateModelRoute` 实现 `low`/`medium`/`high`/`reasoning` 4 阶分级与 Vision/推理意图自动分流。
  - **P4 艾宾浩斯记忆与关联度增强 (`memory-store.js` & `memory.js`)**：自动物理查重加强、词块重合度加权 ($W_{\text{total}} = W_{\text{ebbinghaus}} + W_{\text{relevance}}$)、`/memory search` 命令。
  - **P5 任务依赖 DAG 调度器 (`task-runner.js`)**：`TaskDAGRunner` 拓扑依赖计算、入度队列调度、失败重试与 `.agent/dag_runner` 断点续传存盘。
  - **P6 后台 Cron 定时任务系统 (`cron-scheduler.js`)**：5 段式 Cron 表达式匹配引擎、到期判定轮询与状态持久化 (`register_cron_task` / `list_cron_tasks` / `remove_cron_task`)。
  - **P7 MCP & Skill 沙箱安全策略 (`sandbox-policy.js`)**：资源访问控制、敏感路径屏蔽、二重危险 Shell 拦截与白名单模式 (`set_sandbox_policy` / `get_sandbox_policy_status`)。
  - **闭环质量**：全量单元与端到端测试经 `.harness/verify.sh` 绿色通过。
