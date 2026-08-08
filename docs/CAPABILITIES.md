# AIIA 能力扩展设计：机密/共享配置 · OS 键鼠 · 指纹浏览器

> 本文是 `ARCHITECTURE.md` 的补充层设计（L5.5 机密与共享配置、L7.6 工具能力），基于三路并行调研收敛。纯设计产出，不改 `.harness/verify.sh`。
> 合规框定：工具能力仅限**用户自有账号/自有环境的合法自动化运维**。

---

## L5.5 机密与共享配置层（核心，跨目录共享）

目标：密码/API Key、环境变量、通用配置（工具命令/服务器/SSH/连接串）、知识库——**在任意 cwd 的会话里共享公共信息，同时允许项目目录覆盖**。

### 选型（各域单一推荐）
| 域 | 推荐 | 理由 |
|---|---|---|
| 机密 | **SOPS + age** | 本地优先、加密文件可进 Git、`sops exec-env` 注入 env、无 server；私钥 `~/.config/sops/age/keys.txt` |
| env / 目录覆盖 | **direnv** | 全局 `direnvrc` 做公共层，目录 `.envrc` 用 `source_up` 继承 + 覆盖 |
| 知识库 | **qmd**（Markdown + SQLite FTS5/BM25） | 轻量、CLI+JSON、自带 agent skill 后端，与 skills 范式对齐；语义检索延后 |

被淘汰：Vault/Infisical（需 server，适合动态短时凭据/团队合规，个人单机 wrong fit）；pass（背 GPG keyring 包袱）；Bitwarden/1Password/doppler（依赖账号/云，非「加密文件进 Git」核心）。

### 目录布局（全局在 `~`，项目可覆盖）
```
~/.config/aiia/
  config.yaml            # 通用配置：工具命令、服务器/SSH host、连接串（非机密）
  secrets.enc.yaml       # SOPS+age 加密机密（可提交私有 dotfiles git）
  knowledge/             # Markdown 知识库真源
  .qmd/index.sqlite      # qmd 索引（派生物，.gitignore）
~/.config/direnv/direnvrc          # 全局 env 公共层
~/.config/sops/age/keys.txt        # age 私钥（chmod 600，永不进 git）

<项目>/.envrc                       # source_up 继承全局 + 本地覆盖
<项目>/.pi/                         # 项目级 Pi 资源（覆盖全局）
<项目>/aiia.config.yaml (可选)      # 目录级通用配置 deep-merge 覆盖
```

### 共享 + 覆盖机制（两条并行通道）
- **通道 A（shell/env）**：全局 `~/.config/direnv/direnvrc` 导出公共变量 / `dotenv_if_exists`；各目录 `.envrc` 首行 `source_up_if_exists` 继承父级后覆写。任意目录 `cd` 进去、direnv 生效后，Pi 进程继承合并后的 env。
  - 注意方向：direnv 只能「全局默认 + 目录追加/覆写」，全局层压不住目录层，别设计成反向。
- **通道 B（Pi extension，放 `~/.pi/agent/`）**：
  - `before_agent_start`：按 `ctx.cwd` deep-merge 全局 + 目录 `config.yaml`（目录优先），把「通用配置摘要 + 机密**名字清单**（如 `OPENAI_API_KEY, GH_TOKEN`）」注入 `event.systemPrompt`；**只注入名字，不注入值**。
  - `resources_discover`：注册全局 `~/.config/aiia/knowledge` 与项目 `knowledge/` 为 skill/context 来源。

### Pi 落点（tool / hook）
- `registerTool("kb_search")` → `spawn qmd search --json`，只回 `{path,title,snippet,score}`，不整篇回灌。
- `registerTool("secret_exec")` → **不返回明文**，内部 `sops exec-env ~/.config/aiia/secrets.enc.yaml -- <params.command>`，机密只注入该子进程 env；结果 redaction 后回模型。
- 复用官方 `tool-override.ts` 覆盖 `read`/`bash`，阻断读 `secrets.enc.yaml`（解密后落盘）、`keys.txt`、`.env`。

### 安全红线（硬约束）
1. **机密绝不进 system prompt / 日志 / git 明文**：system prompt 只放名字；git 里只有 SOPS 加密文件；age 私钥 600 + `.gitignore`。
2. **只用 exec-time 注入 + 按名引用**：一律 `sops exec-env … -- <cmd>`；禁止 `get_secret → value`，禁止 `sops -d > 明文.yaml` 落盘。
3. **状态文件不落密**：核查 Pi/AIIA 的 session/settings 持久化不捕获 env（Knostic 2026 泄露教训）；SQLite 记忆写入前 redaction（值 → `***REDACTED:<name>***`）。
4. **redaction 实践**：维护机密值集合，对所有工具输出/日志/入库前替换；bash 禁 `set -x`；deny 敏感路径读取作为第二道墙。

### 延后
动态/短时凭据与合规审计（Vault/OpenBao）；知识库语义检索（`sqlite-vec` 混合）；机密轮转自动化；多设备同步（私有 git + chezmoi 分发 age 私钥/加密文件）。

---

## L7.6 工具能力层（OS 自动化 / 浏览器，二期能力，接口先定）

> 均为**高风险**能力，受 L4 `tool_call` 安全网关分级管控（默认关闭 → 显式 enable → HITL 确认 → 审计 → kill switch）。

### 7.6.1 OS 级键鼠（对应 `~/chat/os` 系统操作工具）
**推荐栈（单一）**：
- 键鼠 **`ydotool`**（内核 uinput 注入，位于显示服务器之下，**X11 + Wayland + tty 通吃**，唯一不挑桌面环境）。
  - 淘汰：`nut.js`（Linux 仅 X11、Wayland 不支持）、`RobotJS`（停维）、`xdotool`/`wtype`（单栈）。
- 截屏**会话感知双后端**：X11 → `mss`（XCB+XShm 极快，直出 numpy）；wlroots(Sway/Hyprland) → `grim`；**GNOME/KDE Wayland 是坑**（Mutter 无 `wlr-screencopy`，grim/scrot 全废，portal 会闪屏）→ 走 `Mutter.ScreenCast`/PipeWire（需一次授权，无闪屏）。
- 找图定位 **OpenCV `matchTemplate(TM_CCOEFF_NORMED)`**。

**权限（非 root）**：`usermod -aG input $USER` + `/etc/udev/rules.d/60-uinput.rules`（`KERNEL=="uinput",GROUP="input",MODE="0660",OPTIONS+="static_node=uinput"`）+ `systemctl --user enable --now ydotoold`，`YDOTOOL_SOCKET` 指向 `$XDG_RUNTIME_DIR`。

**集成（Node/TS tool 接口 + 底层子进程）**：
- `os_screenshot`（低-中风险，只读）：运行时探测 `$XDG_SESSION_TYPE` 选后端；返回图 + 分辨率/坐标系元数据。默认放行 + 审计。
- `os_click` `{x,y,button,double?}` / `os_type` `{text,key?}`（**高风险，写**）：调 `ydotool mousemove --absolute` / `click` / `type`。
  - 分级策略：默认关闭；HITL 确认（可选「批准后 N 秒同类免确认」窗口）；速率/坐标围栏 + 窗口白名单；`os_type` 前先 `os_screenshot`+模板匹配确认焦点，防误注入密码框/终端；全局 kill switch = 停 `ydotoold`。

**不做**：nut.js/RobotJS；Xvfb 假桌面（本需求操作**真实**桌面，无登录态）；libei/EIS 原生栈（正确未来但生态未熟）→ 记为 v2。

### 7.6.2 指纹浏览器 + 持久化 CDP（对应 `~/project/hack/anti-bot`、`~/project/tmp/grok-register`）
**主栈（单一）**：**patchright（Node）** —— drop-in 替换 Playwright，引擎级消除 `Runtime.enable` CDP 泄漏，2026 年仍随 Playwright 跟版，实测过 Cloudflare/DataDome/Akamai/Kasada。
- **备胎**：`camoufox-js`（Firefox，引擎级指纹伪装 + OS 指纹），仅当目标对 Chromium 收紧或需 Linux→Windows 指纹时切。
- 淘汰：nodriver（Python-only，不支持持久 profile+CDP attach 复用）、undetected-chromedriver（被继任）、puppeteer/playwright-stealth（停维/JS 注入易被守卫）。

**持久化 CDP + profile 复用（关键姿势）**：
- `launchPersistentContext(userDataDir, { args:['--remote-debugging-port=PORT'] })` —— 既落盘 profile 又暴露 CDP。
- 其他进程 `connectOverCDP('http://127.0.0.1:PORT')` attach，**取 `browser.contexts()[0]`**（persistent 默认上下文，带登录态）；**不要** `newContext()`（会开隐身丢登录态）。endpoint 从 `/json/version` 的 `webSocketDebuggerUrl` 取。
- **不要**指向系统主 Chrome 的 `User Data`（新策略会导致页面不加载）；必须独立空目录。

**目录约定（采用用户给的目录）**：
- `~/project/hack/anti-bot/profiles/<account>/` 持久 profile；`~/project/hack/anti-bot/cdp/<account>.json` 存 `{port, wsEndpoint, state}` 做 attach 索引。
- `~/project/tmp/grok-register/` 注册类临时 profile 池（跑完即弃）+ `CAMOUFOX_INSTALL_DIR`。

**browser daemon（复用后台常驻宿主 §3.1）**：Node 长驻，管理 `account → {userDataDir, port, wsEndpoint, state}` 落盘到 cdp 索引；对外本地 IPC；对每 account 起 persistent context（各占一 port），agent 只发「attach account X」。
- 可复用原语（daemon 内实现，Pi custom tool 薄封装）：`browser.open / attach / goto / click / type / eval / screenshot / persist / detach（只关 context 保 warm）/ close`。

**成本 / 效率 / 隐蔽性权衡**：
- 本地 patchright 免费开源为默认，**不上商业指纹浏览器**（套壳 + 云 profile，无收益且数据外流）。
- 代理按账号绑定**固定粘性出口**；非必要不上住宅代理；绝不多账号共享数据中心 IP。
- headful（`headless:false`）隐蔽性优于 headless → daemon 配 **Xvfb 虚拟显示**跑 headful。
- 每实例数百 MB 内存 → warm 实例设上限，空闲 `context.close()` 保进程；注册类用临时 profile 池。
- 最大杠杆：**attach 复用（免冷启）+ persistent profile（免重复登录）**；高安全档补人类化 delay/鼠标轨迹。

**合规 not-do**：
- 不对非自有 / 未授权账号做任何自动化或登录。
- 不越权抓取他方受保护 / 非公开数据；不绕过授权边界。
- 不用于绕过 ToS 批量薅羊毛、刷量、虚假注册牟利、规避封禁滥用。
- 不破解付费墙 / DRM；不冒充他人 / 欺诈 / 规避实名风控作违法用途。
- 不发起压测式高频请求损害服务可用性（尊重速率）。
- 不采集 / 存储 / 外传第三方隐私；日志与 profile 仅存自有账号最小信息。

---

## 与主架构的关系
- L5.5 属**核心**（跨目录共享是刚需），可在阶段 1–2 落地：先 direnv + SOPS env 注入 + `kb_search`/`secret_exec` 两个 tool。
- L7.6 属**二期**（高风险、依赖桌面/浏览器环境），接口先定、实现延后；两者都复用 §3.1 后台常驻宿主与 §4 安全网关。
