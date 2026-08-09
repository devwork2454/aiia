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
- **开发 router.js 静态规则路由**：将简单请求分发给便宜模型以降低 API 成本。
- **开发 L5.5 机密与多端配置同步层 (`sync.js` & `vault.js`)**：
  - 实现 GitHub Device Flow 点链接授权登录 (`/sync login`)。
  - 实现本地 AES-256-GCM 强加密与 GitHub Private Gist 零知识云端账号同步 (`/sync push`/`/sync pull`)。
  - 实现本地加密保险箱 (`/vault`)，支持账号密码、身份、地址、银行卡、SSH 等结构化敏感数据管理。
  - 覆盖同步范围：`~/.secrets/env`、Pi Settings、AIIA Config、`aiia.db` 跨项目记忆库、Pi Skills 目录以及各类 MCP 配置文件。
- **自动化安装与 Private 仓库上线**：
  - 编写并测试通过 `install.sh` 新系统一键全自动安装脚本。
  - 创建 GitHub 私有仓库 `devwork2454/aiia` 并成功提交推送全部最新代码。

