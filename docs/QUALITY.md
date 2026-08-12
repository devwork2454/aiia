# AIIA 代码质量审查（用法）

> 确定性本地门禁：Biome（JS）+ Ruff（legacy Python）+ ast-grep（架构红线）+ quality-gate（写后自动检查）。  
> 对齐 `AGENTS.md`「本地确定性硬拦截」——不盲信模型一次生成，失败在局部闭环。

---

## 1. 工具矩阵

| 层 | 工具 | 范围 | 失败策略 |
|---|---|---|---|
| 写后自动 | `pi-agent` quality-gate | `edit`/`write` 目标文件 | 错误回灌 tool_result；可局域重试（S8） |
| 静态全量 | `scripts/quality-check.sh` | JS lint + Python F/B + ast-grep | exit ≠ 0 |
| 提交钩子 | `.pre-commit-config.yaml` | 按变更文件触发同上子集 | 拦 commit |
| 总验收 | `.harness/verify.sh` | 单测 + quality-check + smoke/e2e | exit ≠ 0 不得收工 |

**不采用**：SonarQube / 重型 ESLint 全家桶（与「轻 gate、拒重型框架」不一致）。

---

## 2. 日常命令

```bash
# 全量静态（推荐日常）
bash scripts/quality-check.sh

# 仅 pi-agent JS（error-level）
cd pi-agent && npm run lint

# 可选：Biome 自动修格式/可修问题（会改文件）
cd pi-agent && npm run lint:fix

# 总验收（PR / 切片收工）
bash .harness/verify.sh
```

`package.json` 快捷：

```bash
cd pi-agent && npm run quality   # = bash ../scripts/quality-check.sh
```

---

## 3. 写代码时（自动 quality-gate）

扩展：`pi-agent/extensions/quality-gate.js`  
核心：`pi-agent/src/quality-gate.js`

| 文件类型 | 默认 runner |
|---|---|
| `.js` / `.mjs` / `.cjs` | `node --check` + `biome lint`（error） |
| `.ts` / `.tsx` … | `tsc --noEmit`（若有）或 strip-types + biome |
| `.py` | `py_compile` + `ruff check`（PATH 上有 ruff 时） |

- Biome 单文件检查用 `pi-agent/biome.gate.json`（避免仓库 `includes` 把 `/tmp` 路径忽略）。
- `biome` / 部分 runner 标 `optional`：二进制缺失或「No files processed」→ **skip**，不误杀。
- 自定义整条命令：`QUALITY_GATE_CMD='ruff check {file}'`（`{file}` 占位）。

### 环境变量

| 变量 | 作用 |
|---|---|
| `QUALITY_GATE_DISABLED=1` | 关闭整门 |
| `QUALITY_GATE_SKIP_BIOME=1` | 跳过 Biome（仍保留 `node --check`） |
| `QUALITY_GATE_SKIP_RUFF=1` | 跳过 Ruff（仍保留 `py_compile`） |
| `QUALITY_GATE_TIMEOUT_MS` | 单 runner 超时，默认 15000 |
| `QUALITY_GATE_MAX_OUTPUT` | 回灌输出截断，默认 4096 |
| `QUALITY_GATE_MAX_RETRIES` | S8 局域重试次数（扩展内） |
| `QUALITY_GATE_CMD` | 覆盖默认 runners，shell + `{file}` |

---

## 4. 提交前 pre-commit

```bash
# 一次安装（venv 或用户级均可）
pip install pre-commit
pre-commit install

# 手动跑全部 hook
pre-commit run --all-files
```

Hooks（`local`）：

1. **biome lint** — `pi-agent` 下 error-level  
2. **ruff** — `legacy/` 仅 `F,B`（不含 E501 行宽债）  
3. **ast-grep** — 架构红线  
4. **quality-gate unit** — 改到 gate 相关文件时跑单测  

依赖：`pi-agent/node_modules` 已 `npm install`（含 `@biomejs/biome`、`@ast-grep/cli`）。

---

## 5. 架构红线（ast-grep）

- 配置：`sgconfig.yml`  
- 规则：`sg/rules/`  
  - `no-heavy-orchestrator` — 禁止 LangGraph / LangChain / Mastra  
  - `no-empty-catch` — 禁止空 `catch`  
  - `no-ts-ignore` — 禁止 `as any`  

```bash
# 必须用项目 bin（系统 `sg` 常是 Linux 用户组命令，不是 ast-grep）
./pi-agent/node_modules/.bin/ast-grep scan --config sgconfig.yml
```

---

## 6. 配置文件索引

| 路径 | 用途 |
|---|---|
| `pi-agent/biome.json` | 仓库 JS lint/format 默认 |
| `pi-agent/biome.gate.json` | quality-gate 单文件 lint（无 path includes 限制） |
| `pyproject.toml` | Ruff 全局（legacy Python） |
| `sgconfig.yml` + `sg/rules/*` | ast-grep |
| `.pre-commit-config.yaml` | 提交钩子 |
| `scripts/quality-check.sh` | 一键静态 |
| `.harness/verify.sh` | 总验收（已嵌入 quality-check） |

---

## 7. 建议节奏

```text
改代码  → quality-gate 自动拦
本地确认 → bash scripts/quality-check.sh
收工/PR → bash .harness/verify.sh
```

**原则**：gate 非绿不得宣告完成；自动修 + 重跑有上限（见 S8 / acceptance-gate 约定）。

---

## 8. 已知边界

- **legacy Python**：全量 `ruff check` 仍有 E501/I001 等风格债；门禁只强制 **F/B**，避免历史噪音挡交付。  
- **Biome format**：日常门禁用 `lint` error-level；`npm run lint:fix` 才改格式。  
- **勿把一次性脚本放进 `pi-agent/extensions/`**：会被 Pi 当 extension 加载导致 smoke 失败。  
