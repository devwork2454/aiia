/**
 * AIIA Project Router Extension
 * 注入项目路由表到 prompt snapshot（cache-safe），并提供 /projects 命令查看。
 * 语音/文本下达跨项目任务时，agent 上下文自带项目列表与路由规则，自动 cd 到目标项目执行。
 * Env: AIIA_PROJECTS_ROOT, AIIA_PROJECT_ROUTER_DISABLED=1
 */
import { isExtensionEnabled } from '../src/extension-profile.js';
import { registerSnapshotSection } from '../src/prompt-snapshot.js';
import {
  buildProjectRoutingSnapshot,
  buildProjectRoutingTable,
  isProjectRouterDisabled,
} from '../src/project-router.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function projectRouterExtension(pi) {
  if (!isExtensionEnabled('project-router')) return;

  registerSnapshotSection('project-routing', ({ cwd, env }) =>
    buildProjectRoutingSnapshot({ cwd, env }),
  );

  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand('projects', {
      description: '列出项目列表与路由表（AIIA Project Router）',
      handler: async (args, ctx) => {
        const env = ctx?.env || process.env;
        if (isProjectRouterDisabled(env))
          return '项目路由表已禁用（AIIA_PROJECT_ROUTER_DISABLED=1）';
        return buildProjectRoutingTable({ env }) || '未扫描到项目（检查 AIIA_PROJECTS_ROOT）';
      },
    });
  }
}
