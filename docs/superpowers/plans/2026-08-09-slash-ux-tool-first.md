# Slash UX / Tool-First 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把「人背 slash」压到最少会话控制入口，让模型靠 tool + 短能力目录自动选用能力；`/` 补全菜单显著变短且可测。

**Architecture:** Slash = 人机会话控制面；Tool = 模型可调用能力；Skill = 懒加载说明书（默认可被发现，但不进 `/` 菜单）。用 `enableSkillCommands=false`、补全白名单、可选 `/aiia` 命名空间三层减负；用 `before_agent_start` 注入极短能力目录，替代靠人记忆命令。

**Tech Stack:** Pi `@earendil-works/pi-coding-agent` ≥0.84.1 extension API（`registerCommand` / `registerTool` / `addAutocompleteProvider` / `before_agent_start`）；Node test runner；`.harness/verify.sh`。

## Global Constraints

- 不改 Pi 源码；不依赖尚未上游化的 `registerCommand({hidden})`。
- 不弱化 `.harness/verify.sh` 既有断言；只增强。
- 能力目录注入必须短（建议 ≤25 行 / ≤1.5KB），禁止把全部 skill 正文灌进 system prompt。
- 敏感操作（vault/sync）仍须人显式触发，不得仅因自然语言就自动 dump 机密。
- 兼容：手打旧 slash（过渡期）可保留执行，但可不出现在补全。
- 完成判定以 `bash .harness/verify.sh` 为准。

---

## 设计决策（已收敛）

### 角色分工

| 通道 | 给谁 | 用途 |
|---|---|---|
| Slash | 人 | 会话控制 / 偏好 / 高敏入口 |
| Tool | 模型 | 业务能力（搜索、记忆写入、任务、OS gate…） |
| Skill | 模型（懒） | 长说明书；默认**不**进 `/` 补全 |

### 目标菜单（人可见补全白名单，建议）

**常显（≤4）：** `goal` · `reply` · `add-dir` · `vault`  
**可进命名空间或隐藏补全：** `rm-dir` · `list-dirs` · `memory` · `sync`  
**永不靠 slash 暴露（已是/应是 tool）：** `kb_search` · cron/task/sandbox/os-browser/subagent 等

### 分期（本计划三刀）

1. **S-UX-1 减负 + 能力目录**（最小可交付）
2. **S-UX-2 补全白名单 + `/aiia` 聚合**
3. **S-UX-3 tool-first 收口**（memory/dirs 等）

---

## File Map

| 文件 | 职责 |
|---|---|
| `pi-agent/src/capability-catalog.js` | 生成短能力目录文本（tools + when-to-use） |
| `pi-agent/extensions/capability-catalog.js` | `before_agent_start` 注入；可选关 env |
| `pi-agent/src/slash-visibility.js` | 白名单 / 命名空间解析；补全过滤策略 |
| `pi-agent/extensions/slash-ux.js` | `addAutocompleteProvider` 过滤；注册 `/aiia` |
| `pi-agent/extensions/{goal,reply-prefs,add-dir,memory,vault,sync}.js` | 逐步改为「注册命令 + 可见性元数据」或迁入 `/aiia` |
| `pi-agent/src/add-dir-store.js` / `memory` tools | S-UX-3：补齐 agent-callable tools |
| `pi-agent/test/capability-catalog.test.js` | 目录生成与扩展注册 |
| `pi-agent/test/slash-ux.test.js` | 白名单过滤、`/aiia` 路由 |
| `.harness/verify.sh` | 挂上新单测 |
| `PROGRESS.md` / `ARCHITECTURE.md` | 同步状态与原则 |
| `~/.pi/agent/settings.json`（本机）或 install 文档 | `enableSkillCommands: false` 指引（仓库可提供推荐片段，不强制改用户机） |

---

### Task 1: S-UX-1 — 关闭 skill slash 指引 + 能力目录注入

**Files:**
- Create: `pi-agent/src/capability-catalog.js`
- Create: `pi-agent/extensions/capability-catalog.js`
- Create: `pi-agent/test/capability-catalog.test.js`
- Modify: `pi-agent/test/integration-real-session.mjs`（扩展计数 + 加载）
- Modify: `.harness/verify.sh`
- Modify: `PROGRESS.md`、`ARCHITECTURE.md`（原则：slash vs tool vs skill）
- Optional doc: `docs/pi-settings-recommended.json` 或 `install.sh` 注释片段含 `"enableSkillCommands": false`

**Interfaces:**
- Produces:
  - `buildCapabilityCatalog({ tools, env } = {}) => string`
  - `formatCapabilityCatalogPrompt(catalogText) => string`（带稳定 fence/标题，便于测试）
  - Extension env kill switch: `AIIA_CAPABILITY_CATALOG_DISABLED=1`
- Consumes: 已注册工具名的静态清单（本阶段硬编码白名单即可，避免运行时探测不稳）

**验收标准:**
- 目录含 `kb_search` / `remember`（或 memory 等价 tool）等关键 tool 的「何时用」一行说明
- 注入文本长度硬上限（测试断言 `length <= 2048`）
- verify 绿；集成测试加载新扩展无 error

- [x] **Step 1: 写失败单测**（目录非空、含关键 tool、超长裁剪/拒绝、disabled 不注入）
- [x] **Step 2: 实现 `capability-catalog.js` + extension**
- [x] **Step 3: 挂 verify + 更新 integration 扩展期望**
- [x] **Step 4: 文档写明推荐 `enableSkillCommands: false`（settings / install）**
- [x] **Step 5: `bash .harness/verify.sh` → commit**

**本机可选（非 verify 门）：** 在 `~/.pi/agent/settings.json` 写入 `"enableSkillCommands": false` 并 `/reload`，目视 `/` 不再刷 `/skill:*`。

---

### Task 2: S-UX-2 — 补全白名单 + `/aiia` 聚合命令

**Files:**
- Create: `pi-agent/src/slash-visibility.js`
- Create: `pi-agent/extensions/slash-ux.js`
- Create: `pi-agent/test/slash-ux.test.js`
- Modify: 现有 command extensions（仅挂元数据或改为委托 `/aiia`，见下）
- Modify: `.harness/verify.sh`、`PROGRESS.md`

**Interfaces:**
- Produces:
  - `DEFAULT_SLASH_ALLOWLIST = ["goal","reply","add-dir","vault"]`
  - `parseAiiaArgs(args) => { subcommand, rest }`
  - `filterSlashAutocompleteItems(items, allowlist) => items`
  - `routeAiiaSubcommand(sub, rest, handlers) => Promise<void>`
- `/aiia` 子命令映射（首版）:
  - `memory|reply|dirs|add-dir|rm-dir|list-dirs|sync|vault|goal|help`
- Env: `AIIA_SLASH_ALLOWLIST=goal,reply,add-dir,vault`（可覆写）；`AIIA_SLASH_UX_DISABLED=1` 关闭过滤

**行为:**
1. `addAutocompleteProvider`：只保留 allowlist + 必要 builtin（不删 Pi 内置，只滤 AIIA/extension/skill 噪点；若 provider API 只能包一层，则过滤 `name` 属于「已注册但非白名单的 AIIA 命令」）。
2. 保留旧命令 **handler 可执行**（手打 `/memory` 仍可用），但补全不可见。
3. 新增 `/aiia <sub> ...` 作为发现入口；`/aiia help` 打印子命令。

**验收标准:**
- 单测：过滤后不含 `memory`/`sync`/`rm-dir`（默认）；含 `goal`/`reply`
- `/aiia help` 与 `/aiia memory search x` 路由可测（mock ctx）
- verify 绿

- [x] **Step 1: 写 slash-visibility / `/aiia` 失败单测**
- [x] **Step 2: 实现过滤 provider + `/aiia` 路由**
- [x] **Step 3: 接线现有 handlers（复用，不复制业务逻辑）**
- [x] **Step 4: verify → commit**

**风险说明:** Pi autocomplete wrap API 若无法看到「完整 slash 列表」而只能追加，则降级为：**不再 register 冷门命令，仅通过 `/aiia` 暴露**（仍达菜单变短目标）。实现时以实测 API 为准，单测锁定最终策略。

---

### Task 3: S-UX-3 — tool-first 收口（memory / dirs）

**Files:**
- Modify: `pi-agent/extensions/memory.js`（确保 search/list/rm 有 tool 或统一 `memory_ops`）
- Modify: `pi-agent/extensions/add-dir.js`（`list_additional_dirs` / `add_additional_dir` tools；高敏 `add` 可要求确认或仅 slash）
- Modify: `pi-agent/src/capability-catalog.js`（补条目）
- Modify: `pi-agent/test/*` + verify + `ARCHITECTURE.md`

**原则:**
- **读多写慎：** `memory_search` / `list_dirs` → tool 默认开
- **改工作区边界：** `add_dir` 默认仍建议人 slash（或 tool + 明确确认策略）；计划默认：**list=tool，add/rm=保留 slash/`/aiia`**
- `remember` 已存在则复用，不平行造轮子

**验收标准:**
- 模型无需 `/memory` 即可 search（tool 单测 + catalog 含 when-to-use）
- 旧 `/memory` 仍可用（兼容）
- verify 绿；PROGRESS 标记 S-UX-1..3 完成，无强制下一刀

- [x] **Step 1: 盘点 memory/add-dir 已有 tool 缺口，补失败单测**
- [x] **Step 2: 最小 tool 补齐 + catalog 更新**
- [x] **Step 3: verify → commit**

---

### Task 4: 文档收口与停机条件

**Files:**
- `PROGRESS.md`：增加「Slash UX」切片行或附录状态
- `ARCHITECTURE.md`：增加「控制面通道：Slash / Tool / Skill」一小段
- 本 plan 勾选完成

**停机 / 不做:**
- 不 fork Pi 做 category UI（可另开上游 issue）
- 不把 lark 二十多个 skill 全文注入 prompt
- 不实现 `/rewind` `/btw`（与本目标无关）
- 不对 vault 做「模型自动读取明文」类 tool

- [x] **Step 1: 文档与 PROGRESS 对齐**
- [x] **Step 2: 全量 `bash .harness/verify.sh`**
- [x] **Step 3: 终审（无 Critical/Major）→ 收口 commit**

---

## 建议实施顺序与耗时

| 顺序 | 切片 | 预估 | 用户可感知收益 |
|---|---|---|---|
| 1 | S-UX-1 | 小 | skill 菜单消肿 + 模型开始「看目录用工具」 |
| 2 | S-UX-2 | 中 | `/` 只剩少数 AIIA 入口 |
| 3 | S-UX-3 | 小-中 | 少打 `/memory`，自然语言即可检索 |

## 验证矩阵

| 检查 | 命令/方式 |
|---|---|
| 单测 | `bash .harness/verify.sh` |
| 菜单（人工） | Pi 中输入 `/`，AIIA 项 ≤ allowlist；无大量 `/skill:` |
| 模型路径（人工抽检） | 「查一下我之前关于 X 的偏好」→ 应走 memory/kb tool，而非让用户去打 slash |

## 回滚

- `AIIA_CAPABILITY_CATALOG_DISABLED=1`
- `AIIA_SLASH_UX_DISABLED=1`
- settings 恢复 `enableSkillCommands: true`
- git revert 对应 commit

---

## 待用户确认后开写

确认以下默认即可开工（可改）：

1. 白名单默认：`goal, reply, add-dir, vault`
2. 先做 S-UX-1，merge 后再 S-UX-2 / S-UX-3
3. 本机 settings 写入 `enableSkillCommands:false` 作为 install/推荐，不强制进仓库密钥区
