# Context Card（路线 A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AIIA 落地「通用模型 + 私有属性」最小闭环：结构化 UserCard/ProjectCard、短摘要注入、能力目录降噪、规则指纹刷新与 `/profile` 人控入口。

**Architecture:** 不改 Pi 内核。新增 `context-card` 存储层（全局 `~/.config/aiia/user-card.json` + 项目 `.agent/project-card.json` deep-merge，项目优先），经 `before_agent_start` 注入 ≤20 行摘要；用卡内 `avoid_tools` / `prefer_tools` 过滤 `capability-catalog`；用目录指纹触发规则草案 + `/profile apply|refresh` 人审生效。LLM 自动画像延后，本计划只留 hook 点。

**Tech Stack:** Pi `@earendil-works/pi-coding-agent` ≥0.84.1（`before_agent_start` / `registerCommand` / `registerAiiaHandler`）；Node 20+ `node:test`；`.harness/verify.sh`。

## Global Constraints

- 不改 Pi 源码；能力只做 Extension / Hook / Tool / Command。
- 不弱化 `.harness/verify.sh`；只增强断言与单测列表。
- 摘要注入硬上限：`MAX_PROFILE_PROMPT_CHARS = 900`（约 ≤20 行），禁止整卡 JSON 灌进 system prompt。
- Kill switch：`AIIA_PROFILE_DISABLED=1` 时不注入、不过滤目录。
- 刷新草案默认不自动生效：必须 `/profile apply` 或显式 `applyDraft=true` 写盘。
- 完成判定以 `bash .harness/verify.sh` 退出 0 为准；每完成一个 Task 即 commit 并同步 `PROGRESS.md`。
- 多租户隔离不在范围（个人单机：UserCard = 本机用户）。

---

## 设计决策（已收敛）

### 路线 A = Context Card

| 层 | 路径 | 职责 |
|---|---|---|
| UserCard | `~/.config/aiia/user-card.json`（可用 `AIIA_USER_CARD_PATH`） | 全局标签、沟通禁忌、默认 prefer/avoid |
| ProjectCard | `<cwd>/.agent/project-card.json` | 项目意图、技术栈、项目级噪声黑名单 |
| MergedCard | 运行时 merge | 项目字段覆盖同名数组/标量；数组类字段取「项目非空则用项目，否则用用户」 |

### 最小 Schema（v1，字段冻结）

```json
{
  "version": 1,
  "intent": "personal OS agent on Pi harness",
  "stack": ["node", "pi-extensions"],
  "user_tags": ["prefers-zh", "concise"],
  "prefer_tools": ["kb_search", "remember"],
  "avoid_tools": ["spawn_worktree_subagent"],
  "noise_deny": ["do not suggest feishu runtime"],
  "confidence": 0.7,
  "updated_at": "2026-08-10T00:00:00.000Z",
  "fingerprint": ""
}
```

说明：
- `prefer_tools` / `avoid_tools`：对照 `DEFAULT_CATALOG_ENTRIES` 的 tool `name`。
- `noise_deny`：自然语言硬约束行，进入摘要（不是工具名）。
- `fingerprint`：上次成功 apply 时的目录指纹；用于判断是否过期。

### 分期（本计划四刀）

1. **S-CARD-1** Schema + load/merge/save + 摘要格式化  
2. **S-CARD-2** Extension 注入 + catalog 降噪  
3. **S-CARD-3** 指纹 + 规则草案 + `/profile`  
4. **S-CARD-4** verify / 文档 / 集成加载收口  

延后（不在本计划）：LLM 草案生成、trajectory 反哺画像、跨项目标签图谱、L7 Metaprompt。

---

## File Map

| 文件 | 职责 |
|---|---|
| `pi-agent/src/context-card.js` | schema normalize、路径、load/merge/save、摘要、指纹、规则草案、args 解析 |
| `pi-agent/extensions/context-card.js` | `/profile` + `registerAiiaHandler("profile")` + `before_agent_start` 注入 |
| `pi-agent/src/capability-catalog.js` | 增加 `filterCatalogEntries(entries, card)`；`buildCapabilityCatalog` 接受 card |
| `pi-agent/extensions/capability-catalog.js` | 加载 MergedCard 后过滤再注入 |
| `pi-agent/src/slash-visibility.js` | allowlist 增加 `profile`（可选常显） |
| `pi-agent/test/context-card.test.js` | store / 摘要 / 指纹 / slash / extension |
| `pi-agent/test/capability-catalog.test.js` | avoid/prefer 过滤断言 |
| `pi-agent/test/slash-ux.test.js` | allowlist 含 `profile`（若默认加入） |
| `pi-agent/test/integration-real-session.mjs` | 加载 `context-card` 扩展 |
| `pi-agent/test/smoke-pi-startup.mjs` | 无额外逻辑则依赖自动扫 extensions |
| `.harness/verify.sh` | 挂上 `context-card.test.js` |
| `PROGRESS.md` / `ARCHITECTURE.md` | L5 Context Card 原则与切片状态 |

---

### Task 1: S-CARD-1 — Schema + merge + 摘要格式化

**Files:**
- Create: `pi-agent/src/context-card.js`
- Create: `pi-agent/test/context-card.test.js`

**Interfaces:**
- Produces:
  - `EMPTY_CARD` / `CARD_VERSION = 1`
  - `userCardPath(env) => string`
  - `projectCardPath(cwd) => string`
  - `normalizeCard(raw) => Card`
  - `loadUserCard({ env }) => Card`
  - `loadProjectCard({ cwd }) => Card`
  - `mergeCards(user, project) => Card`
  - `loadMergedCard({ cwd, env }) => Card`
  - `saveUserCard(patch, env) => Card`
  - `saveProjectCard(patch, cwd) => Card`
  - `formatContextCardPrompt(card, { maxChars }?) => string`（空卡返回 `""`）
  - `isProfileDisabled(env) => boolean`
  - `MAX_PROFILE_PROMPT_CHARS = 900`
- Consumes: 无

**Card 类型（约定，JSDoc）：**

```js
/**
 * @typedef {{
 *   version: number,
 *   intent: string,
 *   stack: string[],
 *   user_tags: string[],
 *   prefer_tools: string[],
 *   avoid_tools: string[],
 *   noise_deny: string[],
 *   confidence: number,
 *   updated_at: string,
 *   fingerprint: string,
 * }} Card
 */
```

- [ ] **Step 1: 写失败单测**

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeCard,
  mergeCards,
  loadMergedCard,
  saveUserCard,
  saveProjectCard,
  formatContextCardPrompt,
  isProfileDisabled,
  MAX_PROFILE_PROMPT_CHARS,
} from "../src/context-card.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aiia-card-"));
}

describe("context-card store", () => {
  test("normalize fills defaults and clamps confidence", () => {
    const c = normalizeCard({ intent: "x", confidence: 9, stack: "node" });
    assert.equal(c.version, 1);
    assert.equal(c.intent, "x");
    assert.deepEqual(c.stack, []); // non-array discarded
    assert.ok(c.confidence <= 1);
  });

  test("merge: project overrides scalars; empty project arrays keep user", () => {
    const user = normalizeCard({
      intent: "u",
      stack: ["python"],
      avoid_tools: ["kb_search"],
      user_tags: ["zh"],
    });
    const project = normalizeCard({
      intent: "p",
      stack: ["node"],
      avoid_tools: [],
      user_tags: ["concise"],
    });
    const m = mergeCards(user, project);
    assert.equal(m.intent, "p");
    assert.deepEqual(m.stack, ["node"]);
    assert.deepEqual(m.avoid_tools, ["kb_search"]); // project empty → keep user
    assert.deepEqual(m.user_tags, ["concise"]); // project non-empty → replace
  });

  test("save/load merged + prompt bounds", () => {
    const cwd = tmp();
    const env = { AIIA_USER_CARD_PATH: path.join(tmp(), "user.json") };
    saveUserCard(
      { intent: "life agent", user_tags: ["zh"], avoid_tools: ["spawn_worktree_subagent"] },
      env,
    );
    fs.mkdirSync(path.join(cwd, ".agent"), { recursive: true });
    saveProjectCard({ intent: "aiia", stack: ["node", "pi"] }, cwd);
    const m = loadMergedCard({ cwd, env });
    assert.equal(m.intent, "aiia");
    assert.deepEqual(m.stack, ["node", "pi"]);
    const prompt = formatContextCardPrompt(m);
    assert.match(prompt, /\[AIIA context card\]/);
    assert.match(prompt, /aiia/);
    assert.ok(prompt.length <= MAX_PROFILE_PROMPT_CHARS);
    assert.equal(formatContextCardPrompt(normalizeCard({})), "");
  });

  test("kill switch", () => {
    assert.equal(isProfileDisabled({ AIIA_PROFILE_DISABLED: "1" }), true);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd pi-agent && node --test test/context-card.test.js`  
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 `pi-agent/src/context-card.js`**

要点（必须实现，勿省略）：
- `normalizeCard`：缺省空串/空数组；`confidence` clamp 到 `[0,1]`；`stack` 等仅接受 `string[]`，否则 `[]`；`updated_at` 缺省 `new Date(0).toISOString()`。
- `mergeCards` 数组规则：`pickArr(project, user) = project.length ? project : user`；标量：`project.intent || user.intent`（intent 空串视为未设，回退 user）；`confidence = max(user, project)` 或项目显式有值则用项目——**采用：若 project.updated_at > epoch 且 project 文件存在语义由调用方保证，本函数对 confidence 取 `project.confidence` 若 project 有任意非空业务字段，否则 user**。实现简化为：

```js
function hasSignal(card) {
  return Boolean(
    card.intent ||
      card.stack.length ||
      card.user_tags.length ||
      card.prefer_tools.length ||
      card.avoid_tools.length ||
      card.noise_deny.length,
  );
}

export function mergeCards(user, project) {
  const u = normalizeCard(user);
  const p = normalizeCard(project);
  return normalizeCard({
    version: CARD_VERSION,
    intent: p.intent || u.intent,
    stack: p.stack.length ? p.stack : u.stack,
    user_tags: p.user_tags.length ? p.user_tags : u.user_tags,
    prefer_tools: p.prefer_tools.length ? p.prefer_tools : u.prefer_tools,
    avoid_tools: p.avoid_tools.length ? p.avoid_tools : u.avoid_tools,
    noise_deny: p.noise_deny.length ? p.noise_deny : u.noise_deny,
    confidence: hasSignal(p) ? p.confidence : u.confidence,
    updated_at: p.updated_at > u.updated_at ? p.updated_at : u.updated_at,
    fingerprint: p.fingerprint || u.fingerprint,
  });
}
```

- `formatContextCardPrompt`：无任何 signal 返回 `""`；有则输出：

```
[AIIA context card]
intent: ...
stack: a, b
tags: ...
prefer_tools: ...
avoid_tools: ...
constraints:
- ...
```

超长按 `maxChars` 截断并加 `…`。

- `save*Card`：读-改-写 JSON，写时刷新 `updated_at`；确保父目录 `mkdirSync(..., { recursive: true })`。

- [ ] **Step 4: 跑测确认通过**

Run: `cd pi-agent && node --test test/context-card.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pi-agent/src/context-card.js pi-agent/test/context-card.test.js
git commit -m "$(cat <<'EOF'
feat(context-card): add User/Project card schema, merge, and prompt formatter

EOF
)"
```

---

### Task 2: S-CARD-2 — 注入扩展 + capability-catalog 降噪

**Files:**
- Create: `pi-agent/extensions/context-card.js`（本 Task 先只挂注入；slash 在 Task 3 补全）
- Modify: `pi-agent/src/capability-catalog.js`
- Modify: `pi-agent/extensions/capability-catalog.js`
- Modify: `pi-agent/test/capability-catalog.test.js`
- Modify: `pi-agent/test/context-card.test.js`（扩展注入用例）

**Interfaces:**
- Produces:
  - `filterCatalogEntries(entries, card) => CatalogEntry[]`  
    规则：去掉 `name ∈ avoid_tools`；若 `prefer_tools` 非空，将 prefer 条目稳定排序到列表前部（不删除未列出的工具，避免误伤）。
  - `buildCapabilityCatalog({ tools, env, card, maxChars })` 在 disabled 时仍返回 `""`；否则先 filter 再渲染。
  - Extension `context-card.js`：`before_agent_start` → `{ appendSystemPrompt }`；disabled 或空摘要则 no-op。
- Consumes: Task 1 的 `loadMergedCard` / `formatContextCardPrompt` / `isProfileDisabled`

- [ ] **Step 1: 写失败单测（catalog 过滤 + 注入）**

追加到 `capability-catalog.test.js`：

```js
import { filterCatalogEntries, buildCapabilityCatalog, DEFAULT_CATALOG_ENTRIES } from "../src/capability-catalog.js";
import { normalizeCard } from "../src/context-card.js";

test("filterCatalogEntries drops avoid_tools and fronts prefer_tools", () => {
  const card = normalizeCard({
    avoid_tools: ["spawn_worktree_subagent"],
    prefer_tools: ["kb_search"],
  });
  const filtered = filterCatalogEntries(DEFAULT_CATALOG_ENTRIES, card);
  assert.ok(!filtered.some((e) => e.name === "spawn_worktree_subagent"));
  assert.equal(filtered[0].name, "kb_search");
});

test("buildCapabilityCatalog respects card avoid list", () => {
  const card = normalizeCard({ avoid_tools: ["remember"] });
  const text = buildCapabilityCatalog({ card });
  assert.ok(!text.includes("- remember:"));
  assert.ok(text.includes("kb_search"));
});
```

追加到 `context-card.test.js`：

```js
import contextCardExtension from "../extensions/context-card.js";

test("extension injects summary on before_agent_start", async () => {
  const cwd = tmp();
  const envPath = path.join(tmp(), "user.json");
  const env = { AIIA_USER_CARD_PATH: envPath };
  saveUserCard({ intent: "inject-me", stack: ["node"] }, env);
  process.env.AIIA_USER_CARD_PATH = envPath;
  delete process.env.AIIA_PROFILE_DISABLED;

  let hook;
  const mockPi = {
    registerCommand() {},
    on(ev, fn) {
      if (ev === "before_agent_start") hook = fn;
    },
  };
  contextCardExtension(mockPi);
  const res = await hook({}, { cwd });
  assert.match(res.appendSystemPrompt, /inject-me/);

  process.env.AIIA_PROFILE_DISABLED = "1";
  const res2 = await hook({}, { cwd });
  assert.equal(res2, undefined);
  delete process.env.AIIA_PROFILE_DISABLED;
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd pi-agent && node --test test/capability-catalog.test.js test/context-card.test.js`  
Expected: FAIL（`filterCatalogEntries` / extension 缺失）

- [ ] **Step 3: 实现过滤 + 扩展注入**

`capability-catalog.js` 增加：

```js
export function filterCatalogEntries(entries, card) {
  const avoid = new Set((card?.avoid_tools || []).map(String));
  const prefer = (card?.prefer_tools || []).map(String);
  const base = entries.filter((e) => e?.name && !avoid.has(e.name));
  if (!prefer.length) return base;
  const rank = new Map(prefer.map((n, i) => [n, i]));
  return [...base].sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name) : 1000;
    const rb = rank.has(b.name) ? rank.get(b.name) : 1000;
    return ra - rb || a.name.localeCompare(b.name);
  });
}
```

并改 `buildCapabilityCatalog`：在 `isCatalogDisabled` 之后，若传入 `card` 则 `tools = filterCatalogEntries(tools, card)`。

`extensions/capability-catalog.js`：

```js
import { loadMergedCard, isProfileDisabled } from "../src/context-card.js";

pi.on("before_agent_start", async (_event, ctx) => {
  if (isCatalogDisabled()) return;
  const cwd = ctx?.cwd || process.cwd();
  const card = isProfileDisabled() ? null : loadMergedCard({ cwd });
  const catalog = buildCapabilityCatalog({ card: card || undefined });
  // ...
});
```

`extensions/context-card.js`（最小）：

```js
import {
  formatContextCardPrompt,
  isProfileDisabled,
  loadMergedCard,
} from "../src/context-card.js";

export default function contextCardExtension(pi) {
  pi.on("before_agent_start", async (_event, ctx) => {
    if (isProfileDisabled()) return;
    const cwd = ctx?.cwd || process.cwd();
    const card = loadMergedCard({ cwd });
    const block = formatContextCardPrompt(card);
    if (!block) return;
    return { appendSystemPrompt: "\n\n" + block };
  });
}
```

- [ ] **Step 4: 跑测确认通过**

Run: `cd pi-agent && node --test test/capability-catalog.test.js test/context-card.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pi-agent/src/capability-catalog.js pi-agent/extensions/capability-catalog.js \
  pi-agent/extensions/context-card.js pi-agent/test/capability-catalog.test.js \
  pi-agent/test/context-card.test.js
git commit -m "$(cat <<'EOF'
feat(context-card): inject profile summary and filter capability catalog

EOF
)"
```

---

### Task 3: S-CARD-3 — 指纹、规则草案、`/profile` 人控

**Files:**
- Modify: `pi-agent/src/context-card.js`（fingerprint / draft / parseProfileArgs / apply）
- Modify: `pi-agent/extensions/context-card.js`（registerCommand + aiia handler）
- Modify: `pi-agent/src/slash-visibility.js`（`DEFAULT_SLASH_ALLOWLIST` 加入 `profile`）
- Modify: `pi-agent/src/capability-catalog.js`（slash 提示行加入 `/profile`）
- Modify: `pi-agent/test/context-card.test.js`
- Modify: `pi-agent/test/slash-ux.test.js`（若断言默认白名单列表）

**Interfaces:**
- Produces:
  - `computeProjectFingerprint(cwd) => string`  
    对存在的文件按路径排序后拼接 `relpath:mtimeMs:size`，再 `createHash("sha256").update(...).digest("hex").slice(0, 16)`。  
    探测文件（存在才计入）：`package.json`、`pyproject.toml`、`requirements.txt`、`ARCHITECTURE.md`、`PROGRESS.md`、`Cargo.toml`、`go.mod`、`pom.xml`、`.agent/project-card.json`。
  - `isCardStale(card, cwd) => boolean`：`!card.fingerprint || card.fingerprint !== computeProjectFingerprint(cwd)`
  - `buildRuleBasedDraft(cwd) => Partial<Card>`：  
    - 见 `package.json` → stack 加 `node`；见 `pyproject.toml`/`requirements.txt` → `python`；见 `ARCHITECTURE.md` 含 `Pi` → tags/intent 启发  
    - `intent`：若存在 `PROGRESS.md` 首个 `## GOAL` 下第一行非空文本（截断 120 字），否则 `"unspecified project"`  
    - `confidence`: `0.4`  
    - **不写盘**
  - `writeProjectDraft(cwd, draft) => path`：写入 `.agent/project-card.draft.json`
  - `applyProjectDraft(cwd) => Card`：draft → `project-card.json`，写入当前 fingerprint，删 draft；无 draft 则抛错信息给 UI
  - `parseProfileArgs(args) => { action, scope?, patch? }`  
    支持：`show|status|refresh|apply|set|on|off|help`  
    - `set intent <text>` / `set stack a,b` / `set avoid_tools a,b`（scope 默认 project；`set --user ...` 写 UserCard）
  - Slash 帮助文案含上述子命令

- [ ] **Step 1: 写失败单测**

```js
test("fingerprint stable for same files; stale when missing fingerprint", () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, "package.json"), "{}");
  const fp1 = computeProjectFingerprint(cwd);
  const fp2 = computeProjectFingerprint(cwd);
  assert.equal(fp1, fp2);
  assert.equal(fp1.length, 16);
  const card = normalizeCard({ intent: "x" });
  assert.equal(isCardStale(card, cwd), true);
  card.fingerprint = fp1;
  assert.equal(isCardStale(card, cwd), false);
});

test("rule draft detects node+python and refresh/apply flow", () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, "package.json"), "{\"name\":\"z\"}");
  fs.writeFileSync(path.join(cwd, "pyproject.toml"), "[project]\nname='z'\n");
  fs.writeFileSync(path.join(cwd, "PROGRESS.md"), "## GOAL\nShip context cards\n");
  const draft = buildRuleBasedDraft(cwd);
  assert.ok(draft.stack.includes("node"));
  assert.ok(draft.stack.includes("python"));
  assert.match(draft.intent, /Ship context cards/);
  writeProjectDraft(cwd, draft);
  const applied = applyProjectDraft(cwd);
  assert.equal(applied.intent, draft.intent);
  assert.equal(applied.fingerprint, computeProjectFingerprint(cwd));
  assert.ok(!fs.existsSync(path.join(cwd, ".agent", "project-card.draft.json")));
});

test("parseProfileArgs", () => {
  assert.equal(parseProfileArgs("").action, "show");
  assert.equal(parseProfileArgs("refresh").action, "refresh");
  assert.equal(parseProfileArgs("apply").action, "apply");
  assert.deepEqual(parseProfileArgs("set intent hello"), {
    action: "set",
    scope: "project",
    field: "intent",
    value: "hello",
  });
  assert.equal(parseProfileArgs("set --user tags a,b").scope, "user");
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd pi-agent && node --test test/context-card.test.js`  
Expected: FAIL（符号未导出）

- [ ] **Step 3: 实现指纹/草案/slash**

`extensions/context-card.js` 注册：

```js
pi.registerCommand("profile", {
  description: "Show/refresh/apply project+user context cards",
  handler: profileHandler,
});
registerAiiaHandler("profile", profileHandler);
```

`profileHandler` 行为：
- `show|status`：打印 merged 摘要 + stale? + draft 是否存在  
- `refresh`：`buildRuleBasedDraft` → `writeProjectDraft`，notify「draft ready; /profile apply」  
- `apply`：`applyProjectDraft`  
- `set ...`：写 project 或 user card  
- `on`/`off`：仅 notify「用环境变量 AIIA_PROFILE_DISABLED」（与 reply 不同，v1 不持久化 enabled 字段，避免第三份状态；测试断言 off 提示含 `AIIA_PROFILE_DISABLED`）

`slash-visibility.js`：

```js
export const DEFAULT_SLASH_ALLOWLIST = Object.freeze([
  "goal",
  "imp",
  "reply",
  "add-dir",
  "vault",
  "profile",
  "aiia",
]);
```

- [ ] **Step 4: 跑测确认通过**

Run: `cd pi-agent && node --test test/context-card.test.js test/slash-ux.test.js test/capability-catalog.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pi-agent/src/context-card.js pi-agent/extensions/context-card.js \
  pi-agent/src/slash-visibility.js pi-agent/src/capability-catalog.js \
  pi-agent/test/context-card.test.js pi-agent/test/slash-ux.test.js \
  pi-agent/test/capability-catalog.test.js
git commit -m "$(cat <<'EOF'
feat(context-card): add fingerprint refresh draft and /profile command

EOF
)"
```

---

### Task 4: S-CARD-4 — verify / 集成 / 文档收口

**Files:**
- Modify: `.harness/verify.sh`（unit 列表加入 `test/context-card.test.js`）
- Modify: `pi-agent/test/integration-real-session.mjs`（显式 load `extensions/context-card.js`，扩展计数/路径断言按文件现状调整）
- Modify: `ARCHITECTURE.md`（L5 增加 Context Card：全局/项目覆盖、摘要注入、catalog 过滤；标明 LLM 画像延后）
- Modify: `PROGRESS.md`（新 GOAL 或「已完成」条目：S-CARD-1..4；代定决策记下 kill switch 与 draft/apply）
- Optional: `docs/pi-settings-recommended.json` 无需改；若有 CAPABILITIES 交叉链接可在 ARCHITECTURE 一句话指向本计划

**Interfaces:**
- Produces: verify 绿；文档与实现一致
- Consumes: Tasks 1–3

- [ ] **Step 1: 更新 `verify.sh`**

在 unit 那行 `node --test ...` 列表中加入 `test/context-card.test.js`（紧挨 `reply-prefs` 之后）。

- [ ] **Step 2: 更新 integration 加载列表**

打开 `pi-agent/test/integration-real-session.mjs`，在现有 `join(extDir, "reply-prefs.js")` 旁增加 `join(extDir, "context-card.js")`，并按该文件现有断言更新期望加载数量（若有硬编码 count）。

- [ ] **Step 3: 跑全量 verify**

Run: `bash .harness/verify.sh`  
Expected: 退出码 0，输出含 `[verify] OK`

- [ ] **Step 4: 更新 ARCHITECTURE + PROGRESS**

ARCHITECTURE L5 增补要点：
- Context Card = 结构化私有属性（非微调）
- 路径与 merge 规则
- 与 memory 的边界：memory=软事实；card=硬约束/目录过滤
- 延后：LLM refresh、trajectory 反哺

PROGRESS：
- GOAL 可写「Context Card 路线 A 最小闭环」及验收标准勾选
- 已完成条记录 S-CARD-1..4

- [ ] **Step 5: Commit**

```bash
git add .harness/verify.sh pi-agent/test/integration-real-session.mjs \
  ARCHITECTURE.md PROGRESS.md
git commit -m "$(cat <<'EOF'
docs(context-card): wire verify/integration and document route A

EOF
)"
```

---

## Self-Review（写计划后）

| 规格点 | 对应 Task |
|---|---|
| UserCard + ProjectCard 分层覆盖 | Task 1 |
| 短摘要注入（非整卡） | Task 1 格式化 + Task 2 扩展 |
| avoid/prefer 降噪 | Task 2 |
| Kill switch | Task 1/2 |
| 前置分析（规则指纹草案） | Task 3 |
| 人审 apply | Task 3 |
| `/profile` + allowlist | Task 3 |
| verify 门 | Task 4 |
| LLM 画像 / 预测动作剧本 | **明确延后**，本计划不实现 |

无 TBD 占位；符号名跨 Task 一致（`loadMergedCard`、`filterCatalogEntries`、`buildRuleBasedDraft`、`applyProjectDraft`）。

---

## 风险与非目标

- **风险：** 多段 `before_agent_start` 同时 `appendSystemPrompt`——依赖 Pi 合并语义；若冲突，context-card 与 catalog 保持各自返回，与 `reply-prefs` 现状一致。
- **风险：** 规则草案 intent 从 PROGRESS 解析脆弱——confidence 固定 0.4 + 必须 apply，可接受。
- **非目标：** 多用户租户、云同步卡片（可后续进 sync 清单）、自动改 skill 文件、私有微调。
