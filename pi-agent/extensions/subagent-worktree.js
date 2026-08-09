/**
 * AIIA L6 Subagent Worktree Extension (Phase 2 P2)
 * 支持基于 Git Worktree 在后台并发拉起物理隔离的子工作区，
 * 提供子工作区状态监控、子任务并发进度追踪、安全代码 Merge 与垃圾清理。
 *
 * 注册工具:
 * - spawn_worktree_subagent: 在独立 Worktree 拉起并发子任务
 * - list_worktree_subagents: 扫描列出所有子工作区状态、任务与日志
 * - merge_worktree_subagent: 预检并合并子工作区代码至主分支
 * - cleanup_worktree_subagent: 清理与回收废弃/已合并的 Worktree
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/** 辅助函数：安全执行 Git 命令 */
function runGit(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(e.stderr ? e.stderr.trim() : e.message);
  }
}

/** 辅助函数：判断 PID 是否存活 */
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function subagentWorktreeExtension(pi) {
  // 1. spawn_worktree_subagent
  pi.registerTool({
    name: 'spawn_worktree_subagent',
    description: '在独立的 Git Worktree 工作区中拉起子 Agent 执行分支隔离开发或大重构任务',
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
      const baseWorktreeDir = path.join(ctx.cwd, '.agent', 'worktrees');
      const worktreeDir = path.join(baseWorktreeDir, branch);

      try {
        if (!fs.existsSync(baseWorktreeDir)) {
          fs.mkdirSync(baseWorktreeDir, { recursive: true });
        }

        let isNewWorktree = false;
        if (!fs.existsSync(worktreeDir)) {
          try {
            runGit(`git worktree add -b "${branch}" "${worktreeDir}"`, ctx.cwd);
          } catch {
            try {
              runGit(`git worktree add "${worktreeDir}" "${branch}"`, ctx.cwd);
            } catch (innerE) {
              if (innerE.message.includes('already checked out')) {
                throw new Error(`分支 '${branch}' 已在其他工作区检出，请先清理或更换分支名称。`);
              }
              throw innerE;
            }
          }
          isNewWorktree = true;
        }

        const logFile = path.join(worktreeDir, '.subagent.log');
        const taskInfoFile = path.join(worktreeDir, '.subagent_task.json');

        // 拉起后台子进程
        const outFd = fs.openSync(logFile, 'a');
        const subagent = spawn('pi', ['--mode', 'rpc', '--task', params.task], {
          cwd: worktreeDir,
          detached: true,
          stdio: ['ignore', outFd, outFd]
        });
        subagent.unref();

        const taskMeta = {
          task: params.task,
          branch,
          pid: subagent.pid,
          spawnedAt: new Date().toISOString(),
          status: 'running',
          worktreePath: worktreeDir
        };
        fs.writeFileSync(taskInfoFile, JSON.stringify(taskMeta, null, 2));

        const statusOutput = runGit('git status --short', worktreeDir);

        return {
          status: 'success',
          pid: subagent.pid,
          worktreePath: worktreeDir,
          branch,
          isNewWorktree,
          message: `✅ 子工作区已拉起并执行中: ${worktreeDir} (PID: ${subagent.pid}, 分支: ${branch})`,
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

  // 2. list_worktree_subagents
  pi.registerTool({
    name: 'list_worktree_subagents',
    description: '扫描并列出所有活动及历史 Git Worktree 子工作区、并发任务状态与日志摘要',
    parameters: {
      type: 'object',
      properties: {}
    },
    async execute(params, ctx) {
      const baseWorktreeDir = path.join(ctx.cwd, '.agent', 'worktrees');
      if (!fs.existsSync(baseWorktreeDir)) {
        return { status: 'success', worktrees: [], count: 0 };
      }

      const dirs = fs.readdirSync(baseWorktreeDir);
      const list = [];

      for (const dir of dirs) {
        const fullPath = path.join(baseWorktreeDir, dir);
        if (!fs.statSync(fullPath).isDirectory()) continue;

        const taskInfoFile = path.join(fullPath, '.subagent_task.json');
        const logFile = path.join(fullPath, '.subagent.log');

        let meta = {};
        if (fs.existsSync(taskInfoFile)) {
          try {
            meta = JSON.parse(fs.readFileSync(taskInfoFile, 'utf8'));
          } catch {}
        }

        let logTail = '';
        if (fs.existsSync(logFile)) {
          try {
            const logs = fs.readFileSync(logFile, 'utf8');
            logTail = logs.slice(-300).trim();
          } catch {}
        }

        let gitStatus = '';
        try {
          gitStatus = runGit('git status --short', fullPath);
        } catch {}

        const alive = isPidAlive(meta.pid);
        list.push({
          branch: meta.branch || dir,
          worktreePath: fullPath,
          pid: meta.pid,
          isAlive: alive,
          status: meta.status || (alive ? 'running' : 'idle'),
          task: meta.task || '未知任务',
          spawnedAt: meta.spawnedAt || null,
          gitStatus: gitStatus || 'clean',
          logTail: logTail || '(无日志输出)'
        });
      }

      return {
        status: 'success',
        count: list.length,
        worktrees: list
      };
    }
  });

  // 3. merge_worktree_subagent
  pi.registerTool({
    name: 'merge_worktree_subagent',
    description: '预检并尝试将指定 Git Worktree 子工作区的代码变更安全合并到当前主分支',
    parameters: {
      type: 'object',
      properties: {
        branchName: { type: 'string', description: '要合并的 Worktree 分支名称' },
        deleteAfterMerge: { type: 'boolean', description: '合并成功后是否自动删除 Worktree 及临时分支 (默认: true)' }
      },
      required: ['branchName']
    },
    async execute(params, ctx) {
      const branch = params.branchName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const worktreeDir = path.join(ctx.cwd, '.agent', 'worktrees', branch);
      const shouldDelete = params.deleteAfterMerge !== false;

      try {
        if (!fs.existsSync(worktreeDir)) {
          throw new Error(`找不到指定的 Worktree 目录: ${worktreeDir}`);
        }

        // 1. 确保 Worktree 工作区改动已提交 (若有未提交的改动自动进行 WIP commit)
        const uncommitted = runGit('git status --short --ignored=no', worktreeDir) || runGit('git status --short', worktreeDir);
        if (uncommitted) {
          runGit('git add -A -f', worktreeDir);
          runGit(`git commit -m "wip: subagent worktree auto commit for ${branch}"`, worktreeDir);
        }

        // 2. 在主工作区获取当前分支
        const currentBranch = runGit('git rev-parse --abbrev-ref HEAD', ctx.cwd);

        // 3. 预检是否存在冲突
        try {
          runGit(`git merge-tree $(git merge-base HEAD "${branch}") HEAD "${branch}"`, ctx.cwd);
        } catch {
          // 如果 merge-tree 失败或检测到冲突提示
        }

        // 执行合并
        let mergeResult = '';
        try {
          mergeResult = runGit(`git merge "${branch}" --no-ff -m "merge(subagent): merge worktree branch ${branch} into ${currentBranch}"`, ctx.cwd);
        } catch (mergeErr) {
          // 如果合并冲突退回
          runGit('git merge --abort', ctx.cwd);
          return {
            status: 'conflict',
            branch,
            message: `❌ 合并遇到代码冲突，已中断合并。请前往 ${worktreeDir} 手动解决冲突。`
          };
        }

        // 4. 更新 task meta
        const taskInfoFile = path.join(worktreeDir, '.subagent_task.json');
        if (fs.existsSync(taskInfoFile)) {
          try {
            const meta = JSON.parse(fs.readFileSync(taskInfoFile, 'utf8'));
            meta.status = 'merged';
            meta.mergedAt = new Date().toISOString();
            fs.writeFileSync(taskInfoFile, JSON.stringify(meta, null, 2));
          } catch {}
        }

        // 5. 若请求清理则回收资源
        if (shouldDelete) {
          try {
            runGit(`git worktree remove --force "${worktreeDir}"`, ctx.cwd);
            runGit(`git branch -D "${branch}"`, ctx.cwd);
          } catch {}
        }

        return {
          status: 'success',
          branch,
          targetBranch: currentBranch,
          message: `✅ 成功将分支 ${branch} 合并到 ${currentBranch}`,
          mergeLog: mergeResult
        };
      } catch (e) {
        return {
          status: 'error',
          branch,
          message: `❌ 合并 Worktree 失败: ${e.message}`
        };
      }
    }
  });

  // 4. cleanup_worktree_subagent
  pi.registerTool({
    name: 'cleanup_worktree_subagent',
    description: '强行清理删除指定的 Worktree 子工作区与对应临时分支',
    parameters: {
      type: 'object',
      properties: {
        branchName: { type: 'string', description: '要强行清理的 Worktree 分支名称' }
      },
      required: ['branchName']
    },
    async execute(params, ctx) {
      const branch = params.branchName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const worktreeDir = path.join(ctx.cwd, '.agent', 'worktrees', branch);

      try {
        if (fs.existsSync(worktreeDir)) {
          runGit(`git worktree remove --force "${worktreeDir}"`, ctx.cwd);
        } else {
          runGit('git worktree prune', ctx.cwd);
        }

        try {
          runGit(`git branch -D "${branch}"`, ctx.cwd);
        } catch {}

        return {
          status: 'success',
          branch,
          message: `✅ 已成功强行清理 Worktree 及分支 ${branch}`
        };
      } catch (e) {
        return {
          status: 'error',
          branch,
          message: `❌ 清理失败: ${e.message}`
        };
      }
    }
  });
}
