/**
 * AIIA Cron Scheduler Extension (Phase 2 P6)
 * 注册工具:
 * - register_cron_task: 注册 5 段式 Cron 周期性自动化任务
 * - list_cron_tasks: 列表显示当前全部 Cron 定时任务与运行状态
 * - remove_cron_task: 注销/移除指定 Cron 任务
 */

import path from 'path';
import { CronScheduler } from '../src/cron-scheduler.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function cronSchedulerExtension(pi) {
  // 1. register_cron_task
  pi.registerTool({
    name: 'register_cron_task',
    description: '注册一个周期性运行的 5 段式 Cron 定时任务（例如: */5 * * * * 自动检查）',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Cron 任务唯一标识' },
        name: { type: 'string', description: '任务简短名称' },
        cronExpr: { type: 'string', description: '5段式标准 Cron 表达式 (分 时 日 月 周)' },
        command: { type: 'string', description: '到期自动触发运行的 Shell 命令' }
      },
      required: ['id', 'cronExpr', 'command']
    },
    async execute(params, ctx) {
      try {
        const scheduler = new CronScheduler({ storageDir: path.join(ctx.cwd, '.agent', 'cron_scheduler') });
        const task = scheduler.register(params);
        const _res = {
          status: 'success',
          id: task.id,
          message: `✅ 已成功注册 Cron 定时任务 #${task.id} (${task.cronExpr})`,
          task
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      } catch (e) {
        const _res = {
          status: 'error',
          message: `❌ 注册 Cron 任务失败: ${e.message}`
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      }
    }
  });

  // 2. list_cron_tasks
  pi.registerTool({
    name: 'list_cron_tasks',
    description: '列出所有已注册的 Cron 周期任务、运行频次与最近运行时间',
    parameters: {
      type: 'object',
      properties: {}
    },
    async execute(params, ctx) {
      try {
        const scheduler = new CronScheduler({ storageDir: path.join(ctx.cwd, '.agent', 'cron_scheduler') });
        const tasks = scheduler.list();
        const _res = {
          status: 'success',
          count: tasks.length,
          tasks
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      } catch (e) {
        const _res = {
          status: 'error',
          message: `❌ 获取 Cron 任务列表失败: ${e.message}`
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      }
    }
  });

  // 3. remove_cron_task
  pi.registerTool({
    name: 'remove_cron_task',
    description: '注销与移除指定 Cron 定时任务',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要移除的 Cron 任务 ID' }
      },
      required: ['id']
    },
    async execute(params, ctx) {
      try {
        const scheduler = new CronScheduler({ storageDir: path.join(ctx.cwd, '.agent', 'cron_scheduler') });
        const ok = scheduler.unregister(params.id);
        const _res = {
          status: ok ? 'success' : 'not_found',
          id: params.id,
          message: ok ? `✅ 已成功移除 Cron 任务 #${params.id}` : `⚠️ 未找到 Cron 任务 #${params.id}`
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      } catch (e) {
        const _res = {
          status: 'error',
          message: `❌ 移除 Cron 任务失败: ${e.message}`
        };
        return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
      }
    }
  });
}
