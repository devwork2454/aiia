# 项目进度

## GOAL
修复 Pi 400：`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`（及同类 Responses 孤儿 `function_call_output`）。
### 验收标准
- 根因：发出去的 Completions `role:tool` 没有紧挨着带 `tool_calls` 的 assistant；常见来源是 GC 从多 tool 对中间切断、Pi 丢掉 aborted assistant 却留下 toolResult
- 纯函数 `pi-agent/src/tool-pair-repair.js`：Completions 丢掉孤儿 tool / 拆掉未配对 tool_calls；Responses `input` 丢掉无对应 `function_call` 的 `function_call_output`
- `context-gc` 的 `before_provider_request` 在 hygiene/GC 之后始终跑修复（`AIIA_DISABLE_GC=1` 也修）；`AIIA_DISABLE_TOOL_PAIR_REPAIR=1` 可关
- `findSafeCutoffIndex` 不再把 cutoff 落在 tool 上（避免拆开同一组 tool 结果）
- 单测进 verify；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0（271 unit，含 tool-pair-repair）
### 代定决策
- 不改 Pi 源码；只在发请求前修 payload
- 不把孤儿 tool 改写成假 user 文本（丢配对结果，避免再引入非法 role 序列）
- 不新开 CORE 扩展：挂在已有 context-gc 钩子，保证 GC 折叠后再修一次

## GOAL（已完成）
`/aiia update` 必须有可见日志（会话消息 + 落盘）。
### 验收标准
- 根因：只 `ctx.ui.notify` 多行瞬时 toast，容易被盖掉或看不见
- `formatUpdateReport` / `writeManageLog` 纯函数；更新结果写入 `<AIIA_DIR>/.agent/aiia-update.log`
- 工厂用 `pi.sendMessage({ customType: "aiia-manage", display: true })` 把全文打进会话，并 notify 首行
- `/aiia status` 同一套送达；单测进 verify；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：单测 8/8 manage；全文走 sendMessage + `.agent/aiia-update.log`
### 代定决策
- 不改 Pi 源码；不依赖 toast 能显示多行
- 不在本刀改 `/aiia help` 的 notify（slash-ux）

## GOAL（已完成）
turn-status 状态栏加会话累计总 token（`Σ5.6k`）。
### 验收标准
- 需求：Pi 内置 footer 第 2 行只显示分项（`↑↓RW`），无总量；第 2 行是 Pi 内置（不改 Pi 源码），Σ 走 turn-status 扩展状态行
- `src/turn-status.js`：`state.totals` 跨 turn 累计（`message_end` 累加、`turn_start` 保留、`session_start` 重置）；`formatTotalTokens` 输出 `Σ500`/`Σ5.6k`/`Σ12k`/`Σ1.2M`；`formatTurnStatusLine` 末尾恒加 ` · Σ…`
- 单测：新增 `addUsageTotals`/`formatTotalTokens`/带 totals 格式/累计-保留-重置 4 条，更新 1 条带 usage 的既有断言；`.harness/verify.sh` 退出 0
- 单位进位优化：`compactTokens` 四舍五入后 ≥1000 自动进位 k→M→G，避免 `Σ1000k`/`Σ10000M`；边界 `9999→Σ10k`、`999999→Σ1.0M`、`9.9e9→Σ10G`
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0
### 代定决策
- 扩展拿不到 Pi 的 `usageTotals`，自己在 `message_end` 累加（避免 `turn_end` 对同一消息重复计）
- 不进 Pi 内置统计行：不碰 Pi 源码

## GOAL（已完成）
记忆注入改成 `convertToLlm` 能留下的 custom 消息（不并进快照）。
### 验收标准
- 纯函数 `pi-agent/src/memory-inject.js`：抽出用户 query（支持 text 块数组）、格式化、upsert `role:custom` / `aiia-memory`
- `extensions/memory.js` 不再写 `role: system`；空列表删除已有记忆条
- 不并进 `prompt-snapshot`（query 每轮会变）
- `convertToLlm` 后 JSON 仍含 `[AIIA active memories]` 与种子内容
- 真实 `emitContext` 测试同步断言；单测进 verify；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0（249 unit）；commit `23ed56e`
### 代定决策
- 与快照同款 custom 角色，记忆仍按本轮 query 独立注入
- 顺手修 last-user 只读 string 的 bug（Pi 真消息 content 常是 text 数组）

## GOAL（已完成）
利用 Pi 的 `markdownTransformer` 口子，新增 `markdown-transform` 扩展：TUI 渲染 GitHub callout。
### 验收标准
- 根因：Pi 已内置 Markdown 渲染（pi-tui `Markdown` 组件 + highlight.js），但 GitHub callout（`> [!NOTE]`）不处理，原样显示在斜体引用里
- 纯函数 `src/markdown-transform.js`：`transformGitHubCallouts` 把 `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` 转成 `**📝 NOTE**` 前缀；跳过 fenced code block 内部；kill `AIIA_MARKDOWN_TRANSFORM_DISABLED=1`
- 工厂 `extensions/markdown-transform.js` 经 `pi.registerMarkdownTransformer` 注册；Pi 的 `getMarkdownTransformers()=[mermaid, ...扩展]` 应用于 assistant+user 消息渲染；文件名=门禁 id；进 `CORE_EXTENSIONS`
- 单测 `test/markdown-transform.test.js` 进 verify；`docs/EXTENSIONS.md` 同步；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0
### 代定决策
- 只增强 callout，不改 Pi 渲染本身；transformer 是渲染前纯文本改写，增量安全
- 进 CORE 默认启用（渲染增强非行为改变），kill switch 可关
- 不做完整 Markdown 重写：Pi 已渲染标题/代码/列表，mermaid 已有内置 transformer

## GOAL（已完成）
把 catalog/profile（及 reply、add-dir、secret 名字）从每轮无效的 system 追加，改成 cache-safe 快照。
### 验收标准
- 纯函数 `pi-agent/src/prompt-snapshot.js`：分段注册、hash、`upsertSnapshotMessages`（变了才换、空则删、相同返回 null）
- 工厂 `extensions/prompt-snapshot.js` 挂 `context`，把一份 system 快照插在首条 system 之后；文件名 = 门禁 id；进 CORE
- catalog / context-card / reply-prefs / add-dir / secret-gate **不再** `return { appendSystemPrompt }`（Pi 不认这个字段）
- 各扩展改为 `registerSnapshotSection`；原有 kill switch 仍生效
- 不改 memory 的 query 相关注入；不调用 LLM
- 单测进 verify；docs-check 过；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0（238 unit）；commit `1a63312` + `c823518`（custom 角色，convertToLlm 可送达）
### 代定决策
- 走 `context` 回写 messages，不走 `before_agent_start.systemPrompt`：快照变了不重写整段 system 前缀
- 一份合订快照（带 hash 头），不是每段一条消息
- secret 只快照**名字**，不写值
- `AIIA_PROMPT_SNAPSHOT_DISABLED=1` 关闭注入（分段仍可注册）

## GOAL（已完成）
给 `tool_result` 加无模型截断和外溢（prune + spill）。
### 验收标准
- 纯函数 `pi-agent/src/tool-result-prune.js`：超长文本 head+省略标记+tail；短文本 / 已带 spill 标记不改
- 溢出全文写入 `<cwd>/.agent/spill/<name>.txt`（`0600`）；写入前走 secret 对 + 形态脱敏；预览带相对路径，模型可 `read`
- 工厂 `extensions/tool-result-prune.js` 挂 `tool_result`，返回 `{ content }`（Pi 官方回写）；文件名 = 门禁 id
- 进 `CORE_EXTENSIONS`；`AIIA_TOOL_RESULT_PRUNE_DISABLED=1` 不改写
- 默认预算：触发 8192 / 头 4096 / 尾 1024；env 可覆写；不碰 `QUALITY_GATE_MAX_OUTPUT`（那是 runner 日志）
- 保留 image 块；不调用 LLM 做摘要
- 单测进 verify；`docs/EXTENSIONS.md` 同步；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0（230 unit）；commit `bf9abd4`
### 代定决策
- 新 CORE 扩展，不塞进 quality-gate：要对 bash/read 等全部工具结果生效
- 文件名 `tool-result-prune.js` 排在 quality-gate 之后，质量回灌先落地再截断
- 字符预算而非 token（Pi usage 不稳定）；spill 目录 gitignore
- 不在本刀做 system 分段 / cache-safe snapshot

## GOAL（已完成）
消除 Pi 启动的 `[Skill conflicts]` 警告：user 级与 project 级同名 skill 冲突（langfuse 案例）。
### 验收标准
- 根因：Pi 从 `~/.agents/skills`(user) 与 `{cwd}/.agents/skills`(project) 发现 skill，同名时 project 优先、user 被跳过并刷警告；Pi 无配置开关可关闭
- 关键机制：指向**同一真实文件**的软链被 Pi 静默去重（`realPathSet`），不产生冲突
- `scripts/fix-skill-conflicts.sh`：扫描重名 skill，内容相同则软链化为单一真源（默认 `--keep=project`，user 级软链化并备份 `.bak` 可逆；`--keep=user` 反向），内容不同则提示跳过绝不自动改；`--dry-run` 预览；幂等
- `scripts/fix-skill-conflicts.test.sh` 覆盖：默认软链化+备份、幂等二次 no-op、内容不同跳过、dry-run 不修改、keep=user 反向、无冲突退出 0；进 verify
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0
### 代定决策
- 默认 keep=project：不改动项目仓库（可能是 git 交付物），只改 user 级 `~/.agents/skills`
- 软链去重而非删除：可逆（`.bak` 备份），Pi 静默去重后警告消失、功能保留
- 内容不同绝不自动改：避免破坏用户定制 skill
- install.sh 不自动调用：删改用户文件有风险，作为独立工具按需运行（`bash scripts/fix-skill-conflicts.sh --project-dir=<cwd> --dry-run`）

## GOAL（已完成）
对照 deepseek-harness 做架构取舍，并给 Pi TUI 加 turn 耗时 / 缓存命中 / 命令执行中状态。
### 验收标准
- 调研结论写入本条：dsh 是 Cordis「一切皆插件」+ ReAct 自由循环，不引入 Cordis、不换 Pi 内核、不搬 Web UI
- 新视觉扩展 `turn-status`（文件名=门禁 id）：footer `setStatus` 显示 `◐ Ns · thinking|bash …` / `✓ Ns · cache N% · N tools`
- 纯函数：`formatDuration` / `summarizeTool` / `extractUsage` / `cacheHitPct` / `formatTurnStatusLine` / `applyTurnStatusEvent` 产出与单测一致
- 钩子：`turn_start` / `tool_execution_start|end` / `message_end` / `turn_end` / `session_shutdown`；工具执行中同步 `setWorkingMessage`
- 默认随视觉件开启；`AIIA_VISUAL_DISABLED=1` 或 `AIIA_DISABLE_TURN_STATUS=1` 不注册
- 单测进 verify；`node scripts/generate-api-docs.mjs` 后 docs-check 过；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0（217 unit）；commit `845e388`
### 代定决策
- 只抄 dsh 的 4 个展示信号（相位+耗时、缓存%、工具运行态、压缩进度已有），不抄 StatsLine/TTFT/tok/s/OTel
- 展示走 footer，不加 widget，避免和 To-do / compact 条抢编辑器上方
- 不在本刀做 tool-result prune+spill / system 分段（调研排序靠前，但是架构改动，另开目标）
- 不进 CORE：视觉件，杀手沿用 `AIIA_VISUAL_DISABLED=1`

## GOAL（已完成）
修复远程新机 `pi` 启动即崩：undici 8.9.0 在加载时调用 `node:worker_threads.markAsUncloneable`（仅 Node ≥ 22.10），install.sh 门限只查 `NODE_MAJOR<20`，Node 20.20.1 被放行导致 TypeError。
### 验收标准
- Step 1 门限改为语义探测 `node_has_mark_uncloneable`（node 探测 worker_threads API，失败即升级 Node 22），不再硬编码版本号
- Step 9 冒烟自愈识别 undici 特征错误（日志含 `markAsUncloneable`），与 SIGSEGV(139) 共用 `retry_pi_on_node22` 抽出的「切 Node 22 + 重装 pi + 重试」逻辑
- `bash -n install.sh` 通过；本机 node 24 探测返回 0；模拟旧 Node 探测失败与特征日志分支符合预期
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0；commit 9c27915 已 push GitHub+Gitee 双源
### 代定决策
- 用语义探测而非版本号区间：未来 undici 要求再变无需改门限
- 不强制在升级 Node 后重装 pi（undici 为纯 JS，Node 22 下可直接复用），Step 9 仅在冒烟异常时才重装
- install.sh 无独立单测惯例，验证以 bash -n + 逻辑模拟 + verify.sh 为准

## GOAL（已完成）
`/simplify` 质量审查：清理 feature/aiia-cli 改动代码的重复/冗余/热路径浪费。
### 验收标准
- 四个角度（复用/简化/效率/抽象层次）并行审查 diff（排除 lock/文档/legacy）
- 修复 11 处：`mergeTodos` 冗余 Map、`extractInputPaths` 重复计算、reason 三元链、`ui-task-board` 字形切片、`lsp-extension` 复制粘贴抽 `runSymbolLookup`、`ephemeral-job` 抽 `rmDir`/`toolResult`、`estimateTokens`/`sanitizeMessages` 双遍遍历、`secret-redact` 变体合并、`latestTodosFromEntries` 反向短路、`ctx||activeCtx` 重复
- 新测试锁定「扩展文件名 = 工厂门禁 id」映射，防重命名静默启用
- 跳过：cron 异步化、provider 调用泛化、TEST_MODE 依赖注入、双层 env 开关等（超范围/改行为/设计决策）
- `.harness/verify.sh` 退出 0（205 unit，+1 新测试）
### 状态
通过（2026-08-14）：`.harness/verify.sh` 退出 0（205 unit）

## GOAL
修复 Pi 启动失败：清掉 `~/.pi/agent/extensions` 里指向仓库的半截软链。
### 验收标准
- 复现路径：`remote-config.js -> pi-agent/extensions/...` 会导致 `Cannot find module '../src/extension-profile.js'`
- 本机已删除该软链；`pi list` 无 Failed to load；`pi -p` 可启动
- `scripts/clean-stray-pi-extensions.sh` 只删指向 `$AIIA_DIR/pi-agent/extensions` 的软链，保留用户自有扩展
- 单测脚本进 verify；`install.sh` Step 5 调用清理
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-13）：半截软链已删，pi -p 可启动；清理脚本进 verify
### 代定决策
- 不改扩展 import 路径（正确加载仍是 `pi install pi-agent`）
- 顺手从 settings 去掉已不存在的 worktree package（本机配置，不进仓库）

## GOAL（已完成）
Pi 界面增加常驻 To-do 进度面板（✔ / ◐ / ○）。
### 验收标准
- 纯函数：`normalizeTodos` / `applyTodoUpdate` / `formatTodoWidgetLines` 产出与样本一致的标题与字形（`To-do Working on N to-dos • M done` + `✔` `◐` `○`）
- 扩展注册 `update_todos` 工具；调用后 `ctx.ui.setWidget` 写入 `todo-progress`（空列表清除）
- `/demo-board` 用样本 9 项（2 完成 / 1 进行中）并同时推 checklist + widget
- 视觉件默认开；`AIIA_VISUAL_DISABLED=1` 不注册工具/渲染器
- capability-catalog 默认列出 `update_todos`；视觉关则隐藏
- 单测 `test/todo-progress.test.js` 进 verify；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-13）：常驻 To-do 面板已落地；`.harness/verify.sh` 退出 0（204 unit）
### 代定决策
- 挂在现有 `ui-task-board`（已是默认视觉件），不新开扩展文件、不改 Pi 源码
- 工具名 `update_todos`（replace 默认；`merge:true` 按 id 合并）
- 主展示是编辑器上方 widget，不是再做一套 Ink
- 不把看板接到 `/goal` 自动拆任务（模型自己调工具）

## GOAL（已完成）
默认打开现成视觉件：看板 + `/compact` 进度条。
### 验收标准
- 空环境下 `ui-task-board`、`compact-progress` 视为启用（无需 `AIIA_EXTRA_EXTENSIONS`）
- 不把它们并进 `CORE_EXTENSIONS`；cron / 搜索 / worktree 等仍默认关
- `AIIA_VISUAL_DISABLED=1` 时两扩展工厂直接 return（不注册 renderer / compact 钩子）
- 单测：profile 默认开视觉件、杀手关、看板与进度条在空 env 下能注册；进 verify
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-13）：默认打开看板+压缩条；`.harness/verify.sh` 退出 0（199 unit）
### 代定决策
- 代码默认开，不靠本机环境变量（避免每开一个 shell 忘 export）
- 不进 CORE：视觉不是安全/记忆，单独杀手 `AIIA_VISUAL_DISABLED=1`
- 不把 `/demo-board` 塞进 slash 白名单（它不在 managed 列表，加载后本来就出现）
- 不改 Pi 源码、不重做 TUI、不把看板接到 `/goal` 真进度

## GOAL（已完成）
默认少加载扩展（评估「减面」）：核心常开，其余 opt-in。
### 验收标准
- 默认只启用核心：safety / sandbox-policy / secret-gate / memory / context-card / capability-catalog / quality-gate / context-gc / router / slash-ux / goal / imp / reply-prefs / config / add-dir / vault / steer
- 其余扩展工厂在默认环境下直接 return，不注册工具/钩子
- `AIIA_EXTENSIONS=all` 全开；`AIIA_EXTRA_EXTENSIONS=a,b` 在核心上追加
- capability-catalog 只列出当前启用扩展对应的工具
- 单测 `test/extension-profile.test.js` 进 verify；可选扩展单测自行 `AIIA_EXTENSIONS=all`
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-13）：默认减面已落地；`.harness/verify.sh` 退出 0（195 unit）
### 代定决策
- 核心比评估原文的 7 个多：加上 sandbox/secret（安全）和 slash 控制面（`/goal` `/imp` 等），避免日常命令消失
- 不把文件移出 `extensions/`（`pi install` 仍扫目录）；用工厂入口开关
- 不改 Pi 源码

## GOAL（已完成）
按评估报告收口 P2 文档漂移：ARCHITECTURE/SPEC 对齐 A 路线实码。
### 验收标准
- `ARCHITECTURE.md` 不再把自研 HTTP `host/` 写成活 L2；L2 = 本机 `pi` CLI
- 路由钩子写成 `before_provider_request`（无活 `model_select`）
- 记忆实现指向 `pi-agent/src/memory-store.js`（非 `adapter/memory.py`）
- slash 默认白名单与代码一致：`goal` / `steer` / `config` / `vault` / `aiia`
- LSP/semantic 与 L7 按现状描述（已注册工具；关机只写 draft）
- `SPEC.md` 改为一页 A 路线入口，不画飞书+host 栈
- `deploy/aiia-host.service` 移入 `legacy/`，不再指向活入口
- `scripts/quality-docs-check.sh` 拦截活文档里未标注归档的 `host/src/server.js` / `adapter/memory.py`
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-13）：P2 文档对齐完成；`.harness/verify.sh` 退出 0
### 代定决策
- 不删评估报告里的历史描述（那是当时快照）
- `docs/AIIA_CLI_SPEC.md` 只加归档横幅，不重写整份设计稿
- 不减默认扩展面

## GOAL（已完成）
按评估报告收口 P1 安全与质量门（合并 safety/sandbox + S8 超时/可选回滚）。
### 验收标准
- `SandboxPolicy` 用 `policy.js` 判 shell；工具名含 `bash|shell|run_shell_command` 与 `write|edit`
- `set_sandbox_policy({mode:'permissive'})` 默认拒绝；仅 `SANDBOX_ALLOW_PERMISSIVE=1` 可开
- sandbox `tool_call` 对 shell **不再二次 HITL**（交给 safety）
- 路径拦截看 `path/file/filename` 并展开 `~`，不再 `JSON.stringify.includes`
- quality-gate S8：`spawnSync` 有 timeout（`QUALITY_GATE_CHILD_TIMEOUT_MS`，默认 60s）；`QUALITY_GATE_ROLLBACK=1` 才 `git checkout`
- `src/optimizer.js` 用 `pi -p`，去掉 `--task`
- catalog 工具名改为 `create_dag_task` / `run_dag_task`
- 单测覆盖上述行为；`.harness/verify.sh` 退出 0
### 状态
通过（2026-08-13）：P1 安全/质量门已收口；`.harness/verify.sh` 退出 0（190 unit + quality + smoke + e2e）
### 代定决策
- 不删 sandbox 扩展，只把策略引擎对齐 safety（少一次双 confirm）
- 回滚默认关：避免未提交合法编辑被 checkout 丢掉
- 不改 ARCHITECTURE/SPEC 大文档

## GOAL（已完成）
按评估报告收口 P0 契约与假交付（评估建议项 1）。
### 验收标准
- 自定义工具 `execute` 对齐 Pi：`(toolCallId, params, signal, onUpdate, ctx)`；单测按此 arity 调用
- cron：会话内有 tick 调 `evaluate()` 并执行到期 command；`CRON_DISABLED=1` 可关；catalog 文案不谎称守护进程
- secret-gate 脱敏 `event.content`（兼容 `event.result`）；测试 import 生产函数
- lsp / semantic 用 `pi.registerTool`，不再 `return { tools }`
- `src/metaprompt-optimizer.js` 无空 catch；`quality-check` 绿
- trajectory `session_shutdown` 只写 draft，不 `applyProjectDraft`
- worktree 子进程改为 `pi -p`（去掉不存在的 `--task`）
- `.harness/verify.sh` 退出 0；新增/改写的单测进 verify
### 状态
通过（2026-08-13）：P0 契约/假交付已收口；`.harness/verify.sh` 退出 0（184 unit + quality + smoke + e2e）
### 代定决策
- cron 不做独立守护：只在 Pi 会话存活时 `setInterval` 轮询（个人单机会话即宿主）
- 不合并 safety/sandbox、不加 S8 timeout（P1，本刀不做）
- verify 只增强：把 secret-gate 真函数测、cron tick 测、lsp/semantic 注册测挂进现有 node --test 清单
### 边界
- 不改 ARCHITECTURE/SPEC 大文档（P2）
- 不减默认扩展面（P2）

## GOAL（已完成）
分析当前项目功能架构设计与代码实现，给出质量评估报告。
### 验收标准
- 报告覆盖：分层架构（文档 vs 实码）、扩展清单与钩子冲突、核心模块实现质量、静态门/单测实测、P0–P2 风险与建议
- 落盘 `artifacts/eval/ARCHITECTURE-QUALITY-2026-08-13.md`
- 独立终审核对关键结论（至少抽核：cron 无 tick、secret-gate 字段、execute 签名、LSP 未 registerTool、quality-check 空 catch）
### 状态
通过（2026-08-13）：报告已落盘；独立终审 PASS（P0 源码抽核成立；终审员无 shell 未复跑单测，本会话已跑核心 72/72 + quality-check 红）
### 代定决策
- 本任务只评估、不修功能（避免分析做成半吊子重构）
- 不改 `.harness/verify.sh`
- 评分按「真 Pi 会话能否兑现文档」，不按单测绿条
### 关键结论
- 综合 **5.8/10**：A 路线对；核心库（policy/memory/card/qg/gc）明显好于 Phase 2 工具壳
- P0：`execute(params, ctx)` 与 Pi `execute(id, params, …)` 不一致；cron 无调度循环；secret-gate 打 `event.result` 而非 `content`；LSP/semantic 未 `registerTool`；quality-check 红
- 文档漂移：ARCHITECTURE/SPEC 仍写已砍的 L2 宿主；trajectory 关机自动 `applyProjectDraft` 违背人审约定

## GOAL（已完成）
Context Card 路线 A 最小闭环（S-CARD-1..4）。
### 验收标准
- UserCard + ProjectCard schema/merge + 短摘要注入（≤900 字符）
- capability-catalog 按 avoid/prefer 过滤；kill switch `AIIA_PROFILE_DISABLED=1`
- `/profile refresh|apply|set` 规则指纹草案 + 人审写盘
- `test/context-card.test.js` 进 verify；integration 加载 `context-card.js`
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-10）：S-CARD-1..4 完成；verify 绿
### 代定决策
- Kill switch：`AIIA_PROFILE_DISABLED=1` 时不注入摘要、不过滤 catalog（v1 不持久化 enabled 字段）
- 草案流程：`/profile refresh` 写 `.agent/project-card.draft.json`；**必须** `/profile apply` 才写入 `project-card.json` 并更新 fingerprint
- 指纹：`.agent/project-card.json` 用除 `fingerprint` 外字段的内容 hash；其余探测文件仍用 `relpath:mtimeMs:size`
- LLM 自动画像 / trajectory 反哺卡片：**延后**

## GOAL（已完成）
将 Pi 向 `/imp` 内置为默认 skill + slash，与 `/goal` 分工清晰。
### 验收标准
- `.agents/skills/imp/SKILL.md` 存在且无 Cursor `/next`/OhMy 依赖
- `link-pi-skills` 默认清单含 `imp`；测试断言链接
- `extensions/imp.js` + `imp-command` 单测；slash 白名单含 `imp`
- `.harness/verify.sh` 退出 0
### 状态
通过（2026-08-10）：/imp 内置；verify 绿；本机已 link；终审 PASS
### 本轮计划
1. skill + slash + link 链
2. 单测与 verify
3. 终审

## 第二期 Harness 交付切片（机器可判定）

> 约定：每一刀 = 规格写入 PROGRESS → 增强/不弱化 `verify.sh` → 实现 → `bash .harness/verify.sh` → 独立终审 → commit。

| 切片 | 内容 | verify 门 | 状态 |
|---|---|---|---|
| **S0 交付收口** | P1–P7 已实现代码 + `scripts/link-pi-skills.sh` + `install.sh` Step 6 + 文档对齐 | verify 全绿；新机 skills 可链 | 已完成 |
| **S1 quality-gate** | `edit`/`write` 后 lint/typecheck 回灌 | 坏编辑触发失败回灌可测 | 已完成 |
| **S2 trajectory** | L7 仅轨迹采集 `trajectories.jsonl`（优化器仍延后） | hook 落盘 + 单测 | 已完成 |
| **S3 Hybrid RAG** | `kb_search` 最小切片（记忆+MD）；LSP+LanceDB 仍延后 | kb_search 单测 + verify | 已完成 |
| **S4 L7.6 OS/浏览器** | 接口+默认关+dry-run（真桌面仍条件） | os-browser 单测 + verify | 已完成 |
| **S5 接入层** | 入站归一化；cli 就绪；飞书 archived | channel 单测 + verify | 已完成 |
| **S6 确定性状态机** | `task-runner` 引入状态机（State Machine）控制流，减少无意义 Chat Loop | DAG 节点验证 + 单测 + verify | 已完成 |
| **S7 微上下文 Handoff** | `subagent-worktree` 子任务派发与结果回收时进行上下文严格剪裁 (Input/Output Handoff) | Handoff 剪裁验证 + verify | 已完成 |

## 第四期 Harness 交付切片（Phase 4: 自愈与自我进化）

| 切片 | 内容 | verify 门 | 状态 |
|---|---|---|---|
| **S8 质量门局域重试** | `quality-gate` 实现本地编译/Lint失败时的内部自动重试闭环。**[优化]** 已修复子节点调用逻辑、增设 fallback rollback 保护与硬阻断注入，100% 内部收口，绝不透传冗余报错 | 重试拦截单测 + verify | 已完成 (优化版) |
| **S9 L7 优化器反哺** | 基于 Trajectory 轨迹提取经验，优化系统 Prompt 与规则指纹 | 反思提纯流程 + verify | 已完成 |
| **S10 向量检索(纯JS平替)** | 更换纯净版“平替”向量引擎，基于 better-sqlite3 + node-fetch 实现本地零编译的混合向量与语义索引库，提供 `semantic_index_workspace` 和 `semantic_search` 工具 | 烟雾测试 + verify | 已完成 |
| **S11 LSP 底层代码协议** | 实现基于 JSON-RPC 2.0 (stdio) 的轻量级、零依赖 LSP 客户端，提供 `lsp_start`, `lsp_goto_definition`, `lsp_find_references` 等精准代码跳转能力 | 质量门 + verify | 已完成 |

### Phase 2 已交付能力（P1–P7，代码在 `pi-agent/`）
- **P1** `web-search-proxy.js`：搜索意图嗅探、指令注入；直连 Charon 不追加 `-search`
- **P2** `subagent-worktree.js`：spawn/list/merge/cleanup worktree 子代理
- **P3** `router.js`：low/medium/high/reasoning；直连 provider 默认不改写 model
- **P4** `memory-store.js` / `memory.js`：艾宾浩斯 + 关联度 + `/memory search`
- **P5** `task-runner.js`：DAG 拓扑、重试、断点续传
- **P6** `cron-scheduler.js`：5 段 cron + 持久化工具
- **P7** `sandbox-policy.js`：路径/高危 shell/白名单

### 代定决策
- 第一/二期「开发交付」= **P1–P7 + S0 打包收口**；S1–S5 作为二期补充扩展已完成验证。
- **第三期（Phase 3: 深度控制）= S6–S7**：彻底根治自由对话，向确定性状态机与极简微上下文（Handoff）演进（已全量收官）。
- **第四期（Phase 4: 自愈与进化）= S8–S9**：局域自动纠错重试（S8）与基于轨迹的经验反哺（S9）。
- S1 quality-gate：JS=`node --check`+Biome error；PY=`py_compile`+Ruff；全量 `scripts/quality-check.sh`（+ast-grep 架构红线）已挂 `.harness/verify.sh`；pre-commit 见 `.pre-commit-config.yaml`；用法 [docs/QUALITY.md](docs/QUALITY.md)；`QUALITY_GATE_DISABLED=1` / `QUALITY_GATE_SKIP_BIOME=1` / `QUALITY_GATE_SKIP_RUFF=1` 可关
- S2 默认落盘 `<cwd>/.agent/trajectories.jsonl`；`TRAJECTORY_DISABLED=1` 可关；优化器仍延后
- S3 最小切片 = builtin 混合检索（MemoryStore + knowledge Markdown）；qmd 可选；LanceDB/LSP 仍条件延后（语料门槛）
- `KB_SEARCH_DISABLED=1` 可关；默认根：`~/.config/aiia/knowledge` + `<cwd>/knowledge`（`AIIA_KB_PATHS` 可覆写）
- S4 默认全关；`AIIA_OS_ENABLED`/`AIIA_BROWSER_ENABLED` 显式开启；`AIIA_OS_BROWSER_DRY_RUN=1`（测试默认）不调用真实 ydotool/patchright
- S5 不重开飞书运行时：仅 channel 归一化 + 状态枚举；飞书保持 legacy 归档
- **第三期切片 S6–S7 已全部完成并收官**；后续重点将转入 Phase 4（S8/S9）的规划与执行。表外延后项见「推迟」。


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
- 降级（环境自愈）：LanceDB 向量引擎原生编译失败，**自动降级替换** 为基于 `better-sqlite3` + 原生 JS 内存余弦相似度计算的混合搜索方案，`Tree-sitter` 使用 WASM 版保证零 C++ 依赖。
- 推迟（非切片表）：L7 Metaprompt 优化器、L3 LiteLLM、真 ydotool/patchright 桌面驱动。

## 阻塞
（无）

## 已完成
- **`/compact` 进度条**：`extensions/compact-progress.js` 在 `session_before_compact` 显示 `Compact [████░░] %`（footer + 编辑器上方），完成/中止清除；推荐 `showTerminalProgress=true`。
- **Context 卫生：压住 flash 规划独白刷屏**：cliproxy 会话实测模型把 ~10k「Let me batch/grep」规划写成 assistant **text**（非 thinking）后 aborted；`sanitizeMessages` 折叠历史 monologue、截断旧 thinking；推荐 settings 默认 `hideThinkingBlock=true` + `defaultThinkingLevel=low`（install 仅补缺）。
- **Context GC 静默 + 401 熔断修复**：根因是 `ctx.model` 不含 apiKey，GC 用 dummy 反复 401 刷屏；现经 `modelRegistry.getApiKeyAndHeaders` 取钥、5 分钟熔断、仅异常限流 `console.error`、启发式摘要保留路径/错误、Survivor 折入 system；顺带去掉 trajectory/remote-config/metaprompt 成功路径 console.log；`test/context-gc.test.js` 进 verify。
- **修复 `/demo-board` 看板回退为 `[checklist]` 原文**：根因是 `theme.fg("primary"/"secondary")` 非 dark 主题合法色键，渲染抛错被 Pi 静默吞掉；已改为 `accent`/`muted`，`display: true`；`test/ui-task-board.test.js` 进 verify。
- **Context Card 路线 A（S-CARD-1..4）**：`context-card.js` 存储层 + 扩展注入；UserCard/ProjectCard merge；capability-catalog 降噪；规则指纹草案 + `/profile` 人控；verify/integration/ARCHITECTURE 收口。
- **Slash UX / Tool-First**：`capability-catalog` 短目录注入；`slash-ux` 白名单+`/aiia`；`memory_search`/`memory_list`/`list_additional_dirs`；推荐 `enableSkillCommands=false`（`docs/pi-settings-recommended.json` + install 补缺）。
- **Pi /reply**：全局回复语言/风格（`~/.config/aiia/reply-prefs.json`）；`/reply lang|style|on|off|reset`；before_agent_start 注入。
- **Pi /add-dir**：会话附加工作目录；持久化 `.agent/additional-dirs.json`；system prompt 注入 + skills 发现。
- **Pi /imp 内置**：Pi 向 skill + `/imp` slash + `link-pi-skills` 默认链；与 `/goal` 分工（整形 vs 闭环）。
- **Pi 启动冒烟（无模型）**：`smoke-pi-startup.mjs` 查半截 `.pi/extensions` + 从仓库根加载全部扩展；进 `verify.sh`。
- **修复 Pi 启动扩展加载失败**：根因是 gitignored 的 `.pi/extensions` 半截软链；jiti 不按 realpath 解析 `../src`。已移除坏链，`install.sh` Step 5 增加清理，ARCHITECTURE 标明应走 `pi install`。
- **Pi /goal**：`extensions/goal.js` 注册 `/goal`；skill `.agents/skills/goal` 链到 `~/.pi/agent/skills/goal`。
- **S5 channel-adapter**：cli 归一化就绪；飞书 archived；web deferred/stub；不重开飞书运行时。
- **S4 os-browser**：L7.6 工具接口+默认关+tool_call 闸门+dry-run；真桌面驱动未做。
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
  - **P8 无状态临时子代理与模型自动升级 (`ephemeral-job.js`)**：注册 `run_ephemeral_job` 杂活任务接口，支持按梯队 `low` -> `medium` -> `high` 错误自动升级降级试错重试，独立隔离容器运行，主会话零污染。
  - **闭环质量**：全量单元与端到端测试经 `.harness/verify.sh` 绿色通过。
