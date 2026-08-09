/**
 * AIIA Task DAG Runner Extension (Phase 2 P5)
 * 注册工具:
 * - create_dag_task: 创建由依赖节点构成的任务 DAG 图
 * - run_dag_task: 调度运行或断点恢复执行 DAG 任务图
 * - get_dag_task_status: 查看 DAG 调度状态、进度与节点详情
 */

import path from 'path';
import { TaskDAGRunner } from '../src/task-runner.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function taskRunnerExtension(pi) {
  // 1. create_dag_task
  pi.registerTool({
    name: 'create_dag_task',
    description: '创建包含依赖关系的复杂任务 DAG 图（支持指定各节点执行命令与依赖关系）',
    parameters: {
      type: 'object',
      properties: {
        dagId: { type: 'string', description: '任务图唯一标识ID (例如: build_release_dag)' },
        nodes: {
          type: 'array',
          description: '任务节点数组，每个节点包含 id, name, command, dependsOn',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              command: { type: 'string' },
              dependsOn: { type: 'array', items: { type: 'string' } }
            },
            required: ['id']
          }
        }
      },
      required: ['dagId', 'nodes']
    },
    async execute(params, ctx) {
      try {
        const runner = new TaskDAGRunner({ dagId: params.dagId, storageDir: path.join(ctx.cwd, '.agent', 'dag_runner') });
        for (const n of params.nodes) {
          runner.addNode(n);
        }
        return {
          status: 'success',
          dagId: params.dagId,
          message: `✅ 已成功创建任务 DAG 图 #${params.dagId} (包含 ${params.nodes.length} 个节点)`,
          summary: runner.getStatus()
        };
      } catch (e) {
        return {
          status: 'error',
          message: `❌ 创建 DAG 图失败: ${e.message}`
        };
      }
    }
  });

  // 2. run_dag_task
  pi.registerTool({
    name: 'run_dag_task',
    description: '运行或断点恢复执行指定 DAG 任务图（自动按拓扑依赖层级调度）',
    parameters: {
      type: 'object',
      properties: {
        dagId: { type: 'string', description: '要调度的 DAG 任务图 ID' }
      },
      required: ['dagId']
    },
    async execute(params, ctx) {
      try {
        const runner = new TaskDAGRunner({ dagId: params.dagId, storageDir: path.join(ctx.cwd, '.agent', 'dag_runner') });
        if (!runner.loadCheckpoint()) {
          return { status: 'error', message: `未找到 DAG 图 #${params.dagId} 的检查点文件，请先通过 create_dag_task 创建` };
        }

        const finalStatus = await runner.run();
        return {
          status: 'success',
          dagId: params.dagId,
          message: finalStatus.isSuccess ? `✅ DAG 图 #${params.dagId} 全量节点顺利完成` : `⚠️ DAG 图 #${params.dagId} 执行结束 (进度 ${finalStatus.progress}%)`,
          summary: finalStatus
        };
      } catch (e) {
        return {
          status: 'error',
          message: `❌ 调度 DAG 任务失败: ${e.message}`
        };
      }
    }
  });

  // 3. get_dag_task_status
  pi.registerTool({
    name: 'get_dag_task_status',
    description: '查看指定 DAG 任务图的运行进度、节点状态与输出日志',
    parameters: {
      type: 'object',
      properties: {
        dagId: { type: 'string', description: 'DAG 任务图 ID' }
      },
      required: ['dagId']
    },
    async execute(params, ctx) {
      try {
        const runner = new TaskDAGRunner({ dagId: params.dagId, storageDir: path.join(ctx.cwd, '.agent', 'dag_runner') });
        if (!runner.loadCheckpoint()) {
          return { status: 'error', message: `未找到 DAG 图 #${params.dagId} 的信息` };
        }
        return {
          status: 'success',
          summary: runner.getStatus()
        };
      } catch (e) {
        return {
          status: 'error',
          message: `❌ 获取 DAG 状态失败: ${e.message}`
        };
      }
    }
  });
}
