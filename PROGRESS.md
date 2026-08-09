# 项目进度

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
- 推迟：L6 subagent/worktree、L7 自进化 Metaprompt、L3 LiteLLM、L7.6 键鼠/浏览器（网关真拦截未端到端前不碰）。

## 下一步迭代计划候选
1. **反代 Bridge 原生联网搜索触发 (Web Search Proxy)**：
   - 调研并适配本地反代 Bridge (如 `cursor-openai-api` / `litellm-cpa`) 的原生搜索触发机制（例如自动注入 `@web` 标识或切换 `-search` 模型），直接复用反代自带的搜索额度。
2. **机密零知识注入与敏感词全局脱敏网关 (Redaction Gate)**：
   - 在 `before_agent_start` 钩子中，仅向 Agent 注入可用的 Secret 键名清单（不给明文值）。
   - 在 `tool_result` 及 SQLite 消息存盘前，执行内存级敏感词正则打码（`***REDACTED***`），防止 API Key 泄露进日志。
3. **L6 级多智能体 Worktree 并发协作 (Subagent Worktree)**：
   - 实现 `spawn_subagent` 工具，利用 `git worktree` 为子任务创建物理隔离的临时代码空间，并发执行大重构或多模块开发。

## 已完成
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
  - **闭环质量**：全量 43 个单元与端到端测试 100% 绿色通过（43/43 passed），全套代码已同步至私有仓库。







