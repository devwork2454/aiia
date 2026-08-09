# 项目进度

## GOAL
用 harness 闭环完成第二期（Phase 2 P1–P7）开发交付收口：可复现安装、文档与阶段表一致、verify 绿、评估无 Critical/Major，并给出后续二期余项的可复制切片命令。
### 验收标准
- `.harness/verify.sh` 退出 0（含 Phase 2 单测 + link-pi-skills + 真会话 wiring）
- `install.sh` 新机路径能幂等链接默认 Pi skills（auto-harness）
- `PROGRESS.md` / `ARCHITECTURE.md` 阶段表与真实代码一致，不把延后项伪装为已交付
- 写入第二期 harness 切片清单（已交付 / 下一刀）与 `artifacts/eval/EVAL.md`，无 Critical/Major
### 状态
通过（2026-08-09）：S0 交付收口完成；verify 绿；EVAL 无 Critical/Major。
### 本轮计划
1. 锚定第二期定义（P1–P7 已实现）与交付缺口（安装打包 + 文档对齐）
2. 写入 harness 切片清单（S0 收口 → S1+ 余项）
3. 同步 ARCHITECTURE 阶段表；保留未提交的 install/scripts/verify 增强
4. 跑 verify → 多维评估 → 停机并给出下一刀命令


## 第二期 Harness 交付切片（机器可判定）

> 约定：每一刀 = 规格写入 PROGRESS → 增强/不弱化 `verify.sh` → 实现 → `bash .harness/verify.sh` → 独立终审 → commit。

| 切片 | 内容 | verify 门 | 状态 |
|---|---|---|---|
| **S0 交付收口** | P1–P7 已实现代码 + `scripts/link-pi-skills.sh` + `install.sh` Step 6 + 文档对齐 | verify 全绿；新机 skills 可链 | **本 GOAL** |
| **S1 quality-gate** | `edit` 后 lint/typecheck 回灌（ARCHITECTURE 待建项） | 坏编辑触发失败回灌可测 | 下一刀（推荐） |
| **S2 trajectory** | L7 仅轨迹采集 `trajectories.jsonl`（优化器仍延后） | hook 落盘 + 单测 | 待定 |
| **S3 Hybrid RAG** | LSP + LanceDB（记忆/文档上千才上） | 条件项；有语料门槛 | 条件项 |
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
- 下一刀默认 **S1 quality-gate**（可逆、无桌面依赖、补齐控制面缺口）
- verify 只增强（增加 link-pi-skills 检查），不弱化既有断言


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
