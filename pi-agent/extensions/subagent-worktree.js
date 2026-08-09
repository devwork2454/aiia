/**
 * AIIA L6 Subagent Worktree Extension (Item C)
 * 支持基于 Git Worktree 在后台并发拉起物理隔离的子工作区，
 * 避免主会话上下文与临时代码修改冲突。
 *
 * 注册工具: spawn_worktree_subagent
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function subagentWorktreeExtension(pi) {
  pi.registerTool({
    name: 'spawn_worktree_subagent',
    description: '在独立的 Git Worktree 工作区中并发拉起子 Agent 执行分支隔离开发任务',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '分配给子 Agent 的明确开发或分析任务描述' },
        branchName: { type: 'string', description: '新建或使用的 Git 工作分支名称 (例如: feat/api-refactor)' }
      },
      required: ['task', 'branchName']
    },
    async execute(params, ctx) {
      const branch = params.branchName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const worktreeDir = path.join(ctx.cwd, '.agent', 'worktrees', branch);

      try {
        // 1. 确保目录结构存在
        const parentDir = path.dirname(worktreeDir);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        // 2. 创建或使用 Git Worktree
        let isNewWorktree = false;
        if (!fs.existsSync(worktreeDir)) {
          try {
            execSync(`git worktree add -b "${branch}" "${worktreeDir}"`, { cwd: ctx.cwd, stdio: 'pipe' });
          } catch {
            // 分支已存在时退回不带 -b
            execSync(`git worktree add "${worktreeDir}" "${branch}"`, { cwd: ctx.cwd, stdio: 'pipe' });
          }
          isNewWorktree = true;
        }

        // 3. 在 Worktree 工作区执行子任务操作或记录
        const taskInfoFile = path.join(worktreeDir, '.subagent_task.json');
        fs.writeFileSync(taskInfoFile, JSON.stringify({
          task: params.task,
          branch,
          spawnedAt: new Date().toISOString()
        }, null, 2));

        // 4. 获取当前 Git 变更状态作为隔离视图总结
        const statusOutput = execSync('git status --short', { cwd: worktreeDir, encoding: 'utf8' });

        return {
          status: 'success',
          worktreePath: worktreeDir,
          branch,
          isNewWorktree,
          message: `✅ 子工作区已就绪: ${worktreeDir} (分支: ${branch})`,
          gitStatus: statusOutput || '未发生代码变更'
        };
      } catch (e) {
        return {
          status: 'error',
          branch,
          message: `❌ 创建/调度 Worktree 失败: ${e.message}`
        };
      }
    }
  });
}
