/**
 * AIIA SWE-bench Docker Exec Proxy (Phase 2 P8 Prototype)
 * 允许 Agent 宿主脱离评测容器运行，但执行的任何 Bash 命令
 * 都会被自动代理转发进指定的 Docker 容器。
 */

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function dockerExecProxyExtension(pi) {
  if (!isExtensionEnabled('docker-exec-proxy')) return;
  pi.on('tool_call', (event, ctx) => {
    const targetContainer = process.env.SWE_DOCKER_CONTAINER;
    if (!targetContainer) {
      return; // 未启用外挂模式
    }

    const toolName = event.toolName || event.tool || event.name;
    // 仅拦截运行 shell 命令的工具
    if (toolName === 'run_command' || toolName === 'bash') {
      const originalCmd = event?.input?.command || event?.input?.CommandLine;
      if (originalCmd) {
        // 逃逸原有引号避免注入破坏
        const escapedCmd = originalCmd.replace(/'/g, "'\\''");

        // 提取执行目录 (如果有)
        const cwdStr = event?.input?.cwd ? `-w ${event.input.cwd} ` : '';

        // 代理替换为 docker exec
        const dockerCmd = `docker exec -i ${cwdStr}${targetContainer} bash -c '${escapedCmd}'`;

        // 覆盖原有命令，劫持底层执行
        if (event.input?.command) event.input.command = dockerCmd;
        if (event.input?.CommandLine) event.input.CommandLine = dockerCmd;
      }
    }
  });
}
