# AIIA

个人开发 / 办公 / 生活用的 OS 级 AI Agent（基于开源 Pi harness 二次开发）。

## 闭环工作协议
- 每个任务按 autonomy-harness:closed-loop 技能执行。
- 会话开始：先读 PROGRESS.md 和 git log 恢复状态。
- 完成判定以 .harness/verify.sh 为准，验证不过不得宣告完成。
- 每个可验证子目标完成即 git commit，并同步更新 PROGRESS.md。

## 发布与远程安装
- 双源发布：GitHub=`devwork2454/aiia`，Gitee=`wbff/aiia`（owner 不同）。改完 main 需同时 push 两端。
- 推 Gitee：本机无凭据缓存，`GITEE_TOKEN` 在环境变量；用 `git push "https://oauth2:${GITEE_TOKEN}@gitee.com/wbff/aiia.git" main`
- 远程一键安装(国内)：`curl -fsSL https://gitee.com/wbff/aiia/raw/main/install.sh | bash`；install.sh 自动探测网络选源
- install.sh 装 Node 22（Node 20 / 22.0-22.9 缺 `markAsUncloneable` 致 undici 加载即崩；20.20.x 另有 SIGSEGV）；Step 9 冒烟自愈：段错误或 undici 版本错误自动切 Node 22 重装
- `AIIA_REPO`(GitHub)≠ Gitee owner，靠 `AIIA_GITEE_OWNER=wbff` 映射；`AIIA_MIRROR=gitee|github` 可强制

## 工程约定
- docs-check：新增/改扩展后跑 `node scripts/generate-api-docs.mjs` 重生成 `docs/EXTENSIONS.md` 并 commit，否则 verify 失败
- 扩展：纯函数放 `pi-agent/src/`，工厂在 `pi-agent/extensions/`，/aiia 子命令用 `registerAiiaHandler`；新扩展加进 `CORE_EXTENSIONS` 默认启用
- link-pi-skills：`~/.pi/agent/skills/<name>` 非软链冲突默认保留跳过（不失败）；`AIIA_LINK_FORCE=1` 备份后覆盖
- 防漂移测试锁定「扩展文件名 = 工厂门禁 id」，重命名扩展需同步
- 管理命令：`/aiia status` 查看状态、`/aiia update` 一键更新（pi 内）
