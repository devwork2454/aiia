# AIIA CLI 接入层技术规格 (SPEC)

> **归档（2026-08）**：自研 Ink CLI + L2 HTTP 宿主已放弃。活入口是本机 `pi`（`pi-agent/` 扩展）。下文是历史设计稿，代码在 `legacy/cli/` 与 `legacy/host/`，不要按第 5 节去接 `host/src/server.js`。

## 1. 定位与目标
AIIA CLI 曾是基于自研 L2 HTTP 宿主之上的前端外壳（已归档）。历史目标是：**提供极致顺滑的人机交互体验，屏蔽 Pi 原生终端的限制。**

**核心价值**：
- 实现包含 `@文件路径` 的智能自动补全。
- 实现安全的“断线重连”（Detach/Reattach），关闭窗口任务不中断。
- 将终端逻辑与核心 Agent 逻辑完全解耦，贯彻“防腐层”原则。

## 2. 架构设计 (C/S 模式)
- **Client (AIIA CLI)**：负责所有按键监听、颜色高亮、多行输入与联想补全。
- **Server (L2 Host)**：负责加载 Pi AgentSession，与 LLM 交互，执行文件和工具。
- **通信协议**：初期采用本地 HTTP API (`http://127.0.0.1:端口/v1/chat`)；支持 SSE (Server-Sent Events) 流式返回打字机效果。未来可升级为 Unix Socket。

## 3. 核心功能拆解
### Phase 1: 基础闭环 (MVP)
1. **通信打通**：CLI 能接收用户输入，组装 JSON 发送至 L2 宿主。
2. **流式渲染**：CLI 能接收并漂亮地打印后端返回的 Markdown 与工具调用进度。
3. **Session 绑定**：启动 CLI 时可传入 `session_key` 恢复历史会话。

### Phase 2: 交互增强 (重点)
1. **智能补全 (Completer)**：
   - 侦测到输入 `@` 时，触发本地文件系统的深度补全与过滤。
   - 侦测到 `/` 时，触发可用 Slash Command 的下拉菜单补全。
2. **快捷键绑定**：支持 Vim/Emacs 基本快捷键，多行输入支持。

## 4. 技术选型建议
- **终端交互库**：推荐使用 `@clack/prompts` 或 `enquirer`。如果需要极高的底层定制自由度（如动态内嵌补全列表），可直接封装原生 `readline` 或使用 `ink` (React for CLI)。
- **网络通信**：Node 原生 `fetch` (带流处理)。
- **开发位置**：新建目录 `cli/` 或并入现有的 `scripts/`，独立打包。

## 5. 下一步行动 (Action Items)
- [ ] 1. 在项目中建立 `cli/` 模块骨架。
- [ ] 2. 验证与现有 `host/src/server.js` (L2宿主) 的 HTTP 连通性。
- [ ] 3. 实现一个带有自定义 Completer 功能的基础 Prompt。
