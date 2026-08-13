# AIIA 功能架构与代码质量评估

日期: 2026-08-13  
范围: 活路径 `pi-agent/`（37 扩展 + 24 个 `src/` 模块 + 测试门）对照 `ARCHITECTURE.md` / `PROGRESS.md` / `SPEC.md`  
方法: 读源码与 Pi SDK 契约、跑静态门与核心单测、对照文档。**不改功能代码。**

## 总评

| 维度 | 分 ( /10 ) | 一句话 |
|---|---:|---|
| 架构方向 | 8.0 | A 路线正确：Pi 当内核、扩展当控制面，拒绝重型编排框架 |
| 分层一致性 | 5.0 | 文档仍画 L2 HTTP 宿主；代码已砍宿主；L7/LSP 文档写延后、代码已半落地 |
| 核心实现 | 7.5 | policy / memory-store / context-card / quality-gate 核心 / context-gc 扎实 |
| 扩展壳实现 | 3.5 | 多处「装了等于没装」或测的不是生产路径 |
| 安全控制面 | 4.0 | 正则面窄、双策略不一致、沙箱可被模型关掉、脱敏很可能打空 |
| 测试诚实度 | 6.0 | 核心纯函数测得好；secret-gate / vault 复写逻辑；S8 / cron tick / execute 签名未测 |
| 可维护性 | 5.5 | extension/src 分离好，但 37 扩展全量加载、钩子无显式顺序、env 开关膨胀 |
| **综合** | **5.8** | 内核与几块控制面够用；外围能力面过大、契约漂移、部分能力是假交付 |

**结论先行：** 项目作为「Pi 原生扩展包」的方向是对的，记忆/安全/质量门/上下文 GC 的核心库质量明显高于 Phase 2 工具壳。当前最大风险不是缺功能，而是 **文档宣称已完成的能力有若干在真 Pi 会话里不会按文档工作**，且 **`.harness/verify.sh` 此刻因 ast-grep 空 catch 会红**。

---

## 1. 实际架构（以代码为准）

活入口：`pi-agent/package.json` 的 `"pi": { "extensions": ["./extensions"] }`，经 `pi install <repo>/pi-agent` 被 Pi `DefaultResourceLoader` 加载。根目录无 `host/`。真宿主是本机 `pi` CLI。

```
用户 / pi CLI
    │
    ▼
L1  Pi harness（不改源码）
    agentic loop · read/bash/edit/write · session/compact
    │
    ▼
L4  控制面 hooks（同一进程，按文件名字母序加载）
    tool_call / tool_result / context / before_agent_start / before_provider_request
    │
    ├─ L5  MemoryStore + kb_search + context-card
    ├─ L5.5 vault / sync / secret-gate
    ├─ L6  worktree / DAG / cron(无 tick) / micro-context
    └─ L7  trajectory + 关机自动写卡 + 半残 optimizer
```

规模：extensions ≈ 4644 行，src ≈ 3490 行，测试 ≈ 3883 行。扩展 37、src 24。

### 1.1 设计优点

1. **内核不分叉** 落实到位：无 LangGraph/Mastra；ast-grep 红线 `no-heavy-orchestrator` 在守。
2. **extension / src 分离** 对核心模块有效：policy、memory-store、quality-gate、context-card、task-runner 可单测，不绑 TUI。
3. **控制面即钩子** 与 Pi 官方契约对齐的部分（safety `event.input.command`、memory `context` 替换 messages、quality-gate 回灌 `isError`）经过真会话 wiring 测试。
4. **懒加载原则** 在 Context Card（≤900 字）、capability-catalog（≤2048 字）、slash 白名单上有落实。
5. **Kill switch 文化** 普遍：GC / profile / catalog / quality-gate / OS / trajectory 均可关。

### 1.2 设计债务

1. **能力面远超单人可维护宽度。** 37 个扩展默认全开，每轮同时往 system prompt 塞 memory + catalog + profile + reply + secret 名单 + auto-router 长指令。与「system prompt 极小」原则冲突。
2. **无扩展分层/档位。** 评测原型（docker-exec-proxy）、桌面闸门、LSP、语义检索、cron、DAG 与 safety 同级加载。
3. **钩子顺序靠文件系统枚举。** `readdirSync` 无显式 `sort()`，常见实现接近字母序但不是契约。`before_provider_request` 在本机常见顺序是 context-gc → router → web-search-proxy。没有清单或测试锁住这个顺序。
4. **两套安全策略并行**（`policy.js` + `sandbox-policy.js`），工具名、正则、HITL 都不一致。
5. **L2 宿主文档未删。** A 路线已砍 HTTP 宿主，但 `ARCHITECTURE.md` §3、`SPEC.md`、`deploy/aiia-host.service` 仍指向不存在的 `host/src/server.js`。

---

## 2. 功能地图与实现状态

| 能力 | 文档状态 | 代码状态 | 真机可用性 |
|---|---|---|---|
| safety 高危 shell 拦截 | 已交付 | 真 hook，正则面窄 | **可用（覆盖有限）** |
| 记忆注入 + /memory | 已交付 | 同进程 SQLite + 真 context 测试 | **可用** |
| quality-gate 写后检查 | 已交付 | 核心扎实；S8 子进程无超时 | **检查可用；自动修危险** |
| Context Card /profile | 已交付，人审 apply | 存储层好；关机路径会自动 apply | **半违约** |
| router 分级 | 已交付 | 只改 local-proxy / 层级别名 | **按门禁可用** |
| web-search 意图 | 已交付 | 只看最近 user；直连不改模型 | **可用** |
| worktree 子代理 | 已交付 | `pi --mode rpc --task`——Pi **无 `--task`** | **拉起路径可疑** |
| DAG task-runner | 已交付 | 拓扑/检查点可用；默认 `execSync` 无超时 | **引擎可用，执行器粗** |
| cron | 已交付 | 只有 CRUD；**无 setInterval / idle tick** | **假交付：永不跑** |
| sandbox | 已交付 | 子串拦路径；模型可设 permissive | **弱，可自关** |
| secret-gate 脱敏 | 已交付 | 改 `event.result`；Pi 真字段是 `content` | **很可能从不脱敏** |
| kb_search | 已交付 | 词法混合，有单测 | **可用** |
| os-browser | 接口+默认关 | 闸门真实；无 ydotool/patchright | **按规格可用** |
| channel-adapter | cli ready | 归一化/状态枚举 | **按规格可用** |
| context-gc | 已交付 | 阈值高、熔断、启发式保路径 | **可用** |
| LSP / semantic | 文档写延后 | 代码在；`return { tools }` **不调用 `pi.registerTool`** | **装了没注册** |
| L7 优化器 | 文档写延后 / PROGRESS 写完成 | trajectory 关机自动写卡；metaprompt 扩展签名错 | **行为与人审约定冲突** |
| ephemeral-job | 已交付 | 生产 `npx pi --task`；单测当前失败 | **不可靠** |
| L2 HTTP 宿主 | ARCHITECTURE 仍写核心 | 已进 `legacy/` | **已砍** |

---

## 3. 钩子冲突（按字母序 = 加载序）

### `before_agent_start`

add-dir → capability-catalog → context-card → **metaprompt-optimizer** → remote-config → reply-prefs → secret-gate

- 前三个与 reply-prefs 返回 `{ appendSystemPrompt }`，Pi 会链式合并。
- `secret-gate` 调 `event.appendSystemPrompt()` 或 `event.systemPrompt +=`，与官方 return 形态不一致。
- `metaprompt-optimizer` 把 **event 当成 ctx**（`async (ctx)`），`/optimize` 基本挂不上。

### `context`

auto-router → memory。两者都 `return { messages }`。后跑的 memory 若读原始 `event.messages`，会丢掉 dispatcher 指令。

### `before_provider_request`

本机常见顺序 context-gc → router → web-search-proxy（文件系统枚举，非官方保证）。官方：return 非 undefined 则替换后续 payload。搜意图 + 本地反代时，router 的档位可能再被改成 `*-search`（有意叠加，但未文档化）。

### `tool_call`

docker-exec-proxy → micro-context → os-browser → safety → sandbox-policy。safety 与 sandbox 可能对同一条命令弹两次「强制执行？」。

### `tool_result`

quality-gate → secret-gate。quality-gate 按 `content`/`isError` 回补丁；secret-gate 改 `event.result`，**打不到 Pi 真结果字段**。

### `session_shutdown`

trajectory 在 `AIIA_DISABLE_AUTO_PROFILE` 未设时：`buildLLMDraft` → `writeProjectDraft` → **`applyProjectDraft`**。这与「必须 `/profile apply` 才写盘」的人审约定直接冲突。

---

## 4. 核心实现质量

### 4.1 值得保留的部分

**`src/policy.js` + `extensions/safety.js`**  
薄、无副作用，认 `event.input.command`。`safety-hook.test.mjs` 真加载 Pi 并 `emitToolCall`。正则只拦 `rm -rf /|~`、`sudo`、`git push --force`、`mkfs`、`dd if=`、fork bomb、`chmod -R 777 /`。不拦 `rm -rf .`、`$HOME`、换行拆分、`write` 写敏感路径。

**`src/memory-store.js` + `extensions/memory.js`**  
同进程 better-sqlite3、WAL、去重加强度、艾宾浩斯 + 词块相关。`memory-inject.test.mjs` 是仓库最好的扩展集成测之一。弱点：每轮 `SELECT * LIMIT 5000` 进 JS 打分；user content 为数组时 query 恒为空；无淘汰。

**`src/context-card.js`**  
merge / 指纹 / 草稿 / 900 字裁剪清晰；单测覆盖 store + 命令 + 注入。`/profile on|off` 只 notify 不改 env；`prefer_tools` 的 set 未接线。

**`src/quality-gate.js`**  
可注入 runner/spawn，超时与 optional skip 清楚。核心单测扎实。扩展层另写一套循环，闲置已测过的 `evaluateToolResultQuality`。

**`extensions/context-gc.js`**  
静默默认、5 分钟熔断、启发式保路径/错误、survivor 进 system。阈值（32k / 80 条 / 3 分钟 / 紧急 96k）与近期「不要压太勤」一致。`fetch` 无 timeout；进程级 `lastGcAt` 多会话互抢。

**`extensions/router.js`**  
直连 Charon/DeepSeek 不改写，有回归。`input.length > 3` 就升 medium，工具循环会持续升档。

### 4.2 高风险缺陷（证据）

#### P0 — 工具 `execute` 签名与 Pi 契约不一致

Pi 官方：`execute(toolCallId, params, signal, onUpdate, ctx)`。

正确：`memory.js` 用 `execute(_id, params)`。

错误（生产里第一个参数是 id 字符串，`params.task` / `ctx.cwd` 会是 undefined）：

- `subagent-worktree.js` `execute(params, ctx)`
- `task-runner.js` / `cron-scheduler.js` / `ephemeral-job.js`
- `kb-search.js` / `sandbox-policy.js` / `micro-context.js` / `optimizer.js`

单测全部按错误签名调用 `tool.execute({...}, mockCtx)`，所以绿测不能证明真会话能跑。

#### P0 — cron 永不触发

`CronScheduler.evaluate()` 只在单测里被调用。扩展只注册 CRUD，没有任何 `setInterval` / idle hook。catalog 仍写「到期自动触发」。

#### P0 — secret-gate 很可能从不脱敏

扩展改 `event.result`。Pi `tool_result` 与 quality-gate 用的是 `event.content`。`secret-gate-router.test.js` **复制了一份 `redactText`，不 import 扩展**。

#### P0 — LSP / semantic 未注册到 Pi

两者 `export default function (pi) { return { tools: {...} } }`。官方扩展必须 `pi.registerTool()`。Smoke 只断言「文件能 load、无 throw」，不断言工具出现在会话里。

#### P0 — 静态质量门当前红

`scripts/quality-check.sh` → ast-grep `no-empty-catch`：

```
pi-agent/src/metaprompt-optimizer.js:6-10  catch (e) {}
```

`.harness/verify.sh` 会跑 quality-check，**此刻 verify 不能绿**。PROGRESS 仍写历史切片「verify 绿」。

#### P1 — quality-gate S8

`spawnSync('npx', ['pi', ...])` **无 timeout**，会卡住 `tool_result`。失败后 `git checkout -- rel` 丢掉未提交改动。`QUALITY_GATE_MAX_RETRIES=0` 仍走回滚。单测故意关掉重试，生产最危险路径无覆盖。

#### P1 — worktree 子进程参数非法

`spawn('pi', ['--mode', 'rpc', '--task', params.task])`。Pi 0.84.1 文档无 `--task`。RPC 要 stdin JSON。子代理大概率立刻退出。

#### P1 — 关机自动写 ProjectCard

`trajectory.js` `session_shutdown` 默认 `applyProjectDraft`，绕过人审。`buildLLMDraft` 仍用 `dummy` key 兜底（context-gc 修过的同类 401 问题）。

#### P1 — 沙箱可被模型关掉

`set_sandbox_policy({ mode: 'permissive' })` 对 LLM 开放。路径检查是 `JSON.stringify(input).includes(p)`：文档里的 `/etc/passwd` 会误拦；展开后的 `/home/x/.ssh/id_rsa` 拦不住。`HIGH_RISK_TOOLS` 含 `write_to_file`，Pi 真名是 `write`。

#### P1 — ephemeral-job 单测失败且生产是桩

`node --experimental-permission` + 内嵌 `npx pi --task`。本机跑 `ephemeral-job.test.js`：`actual: 'error' !== 'success'`。未进 verify 清单，所以总门看不到。

#### P2 — 其它

- capability-catalog 写 `create_task_dag` / `run_task_dag`，注册名是 `create_dag_task` / `run_dag_task`。
- slash 白名单实为 `goal, steer, config, vault, aiia`；ARCHITECTURE 写 `/goal /reply /profile /add-dir /vault /aiia`。
- `agy-bridge.js` 默认二进制路径写死为本机 `/home/zakza/.local/bin/agy`（可用 `AGY_BIN_PATH` 覆盖）。
- `sync.js` 默认写死 GitHub OAuth Client ID（可用 `AIIA_GITHUB_CLIENT_ID` 覆盖）。
- semantic `getEmbedding` 失败返回 **随机 768 维向量**，索引不可复现。
- memory / auto-router 每轮改写 system，指令可能叠层。
- 环境变量 30+ 个开关，无总表。

---

## 5. 质量门与测试诚实度

### 5.1 本轮实测

| 检查 | 结果 |
|---|---|
| Biome lint（98 files, error-level） | **通过** |
| Ruff F/B（legacy Python） | **通过** |
| ast-grep 架构红线 | **失败**（`metaprompt-optimizer.js` 空 catch） |
| 核心单测 72（policy/memory/qg/sandbox/router/gc/card/secret-副本/dag） | **72/72 通过**（218ms） |
| `ephemeral-job.test.js`（不在 verify 清单） | **失败** |
| `.harness/verify.sh` 全量 | **未跑完**（quality-check 已红，继续跑无意义） |

### 5.2 覆盖对照

打到 shipped 函数：policy、memory-store、memory 真注入、quality-gate 核心+hook、sandbox、context-card、context-gc、router 纯函数、web-search、task-runner 引擎、worktree（真 git / 假 pi）、kb-search、os-browser、slash/add-dir/reply/catalog。

**未打到 shipped 函数：**

| 测试文件 | 问题 |
|---|---|
| `secret-gate-router.test.js` | 复写 redact，不 import 扩展 |
| `vault-sync-crypto.test.js` | 复写加解密，不 import vault.js / sync.js |
| `quality-gate.test.js` | `MAX_RETRIES=0` 避开 S8 |
| `cron-scheduler.test.js` | 测 evaluate，生产无调用方 |
| 无 | lsp / semantic / metaprompt `buildLLMDraft` / micro-context / steer |

verify 清单外还有：`auto-router`、`docker-exec-proxy`、`ephemeral-job`、`optimizer`、`remote-config`（`memory-inject` / `safety-hook` 在 verify 后半段单独跑）。

---

## 6. 文档漂移

1. `ARCHITECTURE.md` §3 仍把 L2 HTTP 宿主写成核心；`package.json` 写 *no self-hosted HTTP*。
2. `SPEC.md` 整份停在阶段 0（飞书 + host + `data/aiia.db`）。
3. `deploy/aiia-host.service` 指向不存在的 `host/src/server.js`。
4. `data/schema.sql` 不被 `MemoryStore` 读取（自带 SCHEMA）。
5. LanceDB/LSP「仍延后」vs 已有 `lsp-extension.js` + `semantic-search.js`（且未按 Pi API 注册）。
6. Metaprompt「仍延后」vs PROGRESS S9「已完成」vs trajectory **关机自动 apply**。
7. ARCHITECTURE 写 router 用 `model_select`；实现只有 `before_provider_request`。
8. 艾宾浩斯实现指向 `adapter/memory.py`；真实现是 `pi-agent/src/memory-store.js`。

---

## 7. 建议优先级（给产品经理的单选题预备）

不做大重构。按「先让已宣称能力变真」收口：

1. **P0 契约**：统一 `execute(toolCallId, params, …, ctx)`；LSP/semantic 改为 `pi.registerTool` 或移出 `extensions/`。
2. **P0 诚实**：cron 接 tick 或从 catalog 删除；secret-gate 改打 `event.content` 并 import 真函数测试。
3. **P0 门禁**：修空 catch，让 `quality-check` / verify 恢复可绿。
4. **P1 安全**：合并 safety/sandbox；禁止模型设 permissive；S8 加 timeout、回滚改可选。
5. **P1 人审**：trajectory 关机只写 draft，禁止自动 `applyProjectDraft`。
6. **P2 文档**：删/改 ARCHITECTURE L2、SPEC、悬空 systemd；catalog 工具名对齐。
7. **P2 减面**：默认只加载 safety / memory / quality-gate / context-gc / router / catalog / card；其余 opt-in。

---

## 8. 代定决策（本报告）

- 本任务只出评估，不修功能代码（避免把分析做成半吊子重构）。
- 报告落盘 `artifacts/eval/ARCHITECTURE-QUALITY-2026-08-13.md`。
- 不改 `.harness/verify.sh`（调研类；且当前红是既有空 catch，不是本报告引入）。
- 评分按「真 Pi 会话能否兑现文档」而不是按单测绿条。

## 9. 未尽

- 未跑全量 `.harness/verify.sh`（quality-check 已失败）。
- 未开真实模型会话逐个点工具（execute 签名问题用 SDK 文档 + 源码对照，未 live 复现）。
- 未审计 `legacy/` 与 `legacy/cli` 大体积残留是否应从工作树剔除。
