import { spawn } from 'child_process';
import { registerAiiaHandler } from '../src/command-registry.js';
import { isExtensionEnabled } from '../src/extension-profile.js';

/**
 * 顶尖水准的自动 DAG 状态机引擎 (Auto DAG Executor)
 * 具备特性：
 * 1. 严格的异步并发控制 (Concurrency Throttling)
 * 2. 拓扑排序解析与微上下文无缝透传 (Micro-context Handoff)
 * 3. 基于事件循环的非阻塞回调
 * 4. 异常隔离与沙盒捕获
 */
class DagExecutor {
  constructor(nodes, concurrency = 3, cwd = process.cwd()) {
    this.nodes = nodes; // { id, task, deps: string[] }
    this.concurrency = concurrency;
    this.cwd = cwd;
    this.status = new Map(nodes.map((n) => [n.id, 'pending'])); // pending | running | done | error
    this.results = new Map();
    this.running = 0;
  }

  async execute() {
    return new Promise((resolve, reject) => {
      const checkAndRun = () => {
        // 1. 闭环检查：全部完成则返回
        if (Array.from(this.status.values()).every((s) => s === 'done')) {
          return resolve(Object.fromEntries(this.results));
        }
        // 若有任何节点 Error，立即抛出终止整图
        if (Array.from(this.status.values()).some((s) => s === 'error')) {
          return reject(new Error('DAG Execution failed due to a node error.'));
        }

        // 2. 状态机解析：找出所有入度依赖已完成的 Ready 节点
        const readyNodes = this.nodes.filter(
          (n) =>
            this.status.get(n.id) === 'pending' &&
            (n.deps || []).every((dep) => this.status.get(dep) === 'done'),
        );

        // 3. 并发控制与派发
        while (this.running < this.concurrency && readyNodes.length > 0) {
          const node = readyNodes.shift();
          this.status.set(node.id, 'running');
          this.running++;

          this.runNode(node).finally(() => {
            this.running--;
            // 被动回调驱动下一个 Tick
            checkAndRun();
          });
        }
      };

      checkAndRun();
    });
  }

  async runNode(node) {
    return new Promise((resolve, reject) => {
      try {
        // 构建严格裁剪的微上下文 (Micro-context)
        let microContext = '';
        if (node.deps && node.deps.length > 0) {
          microContext =
            '\n[前置依赖任务的输出上下文]:\n' +
            node.deps.map((d) => `--- 节点 ${d} 结果 ---\n${this.results.get(d)}\n`).join('\n');
        }

        const fullPrompt = `${node.task}${microContext}`;

        // 调用底层二进制沙盒运行子任务 (避免主进程内存泄漏)
        const sub = spawn('pi', ['-p', fullPrompt], {
          cwd: this.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        sub.stdout.on('data', (d) => (stdout += d.toString()));
        sub.stderr.on('data', (d) => (stderr += d.toString()));

        sub.on('close', (code) => {
          if (code === 0) {
            this.status.set(node.id, 'done');
            this.results.set(node.id, stdout.trim());
            resolve();
          } else {
            this.status.set(node.id, 'error');
            this.results.set(node.id, `Error Output: ${stderr}`);
            reject(new Error(`Node ${node.id} failed with exit code ${code}`));
          }
        });
      } catch (e) {
        this.status.set(node.id, 'error');
        reject(e);
      }
    });
  }
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function autoDagExtension(pi) {
  if (!isExtensionEnabled('auto-dag')) return;

  // 1. 注册主指令：将自然语言转换为严格的 JSON 依赖图 (Planner 挂载)
  const dagHandler = async (args, ctx) => {
    if (!args.trim()) {
      ctx?.ui?.notify?.('用法: /dag <复杂任务描述>', 'info');
      return;
    }

    // 注入底层 Prompt，强制 Agent 使用 execute_dag 工具
    const message = `[SYSTEM: 自动 DAG 编排模式]
User task: "${args}"

请将此宏大任务拆解为 DAG（有向无环图）。
分析哪些步骤可以并发执行，哪些必须等待前置完成。
规划完成后，必须立刻调用 \`execute_dag\` 工具并传入 \`nodes\` 数组。

规则：
1. 微上下文传递：每个节点的 task 必须精简具体。
2. 禁止死锁与环形依赖。
3. 尽最大可能提升并行度。`;

    pi.sendUserMessage(message, { deliverAs: 'followUp' });
    ctx?.ui?.notify?.(` /dag：已启动 DAG 解析引擎，正在进行拓扑拆解...`, 'info');
  };

  pi.registerCommand('dag', {
    description: '全自动并发编排 | 用法: /dag <复杂任务>，后台组装依赖图并极速并发',
    handler: dagHandler,
  });
  if (typeof registerAiiaHandler === 'function') {
    registerAiiaHandler('dag', dagHandler);
  }

  // 2. 注册底层执行器 Tool，供 LLM 解析出 JSON 后回调使用
  pi.registerTool({
    name: 'execute_dag',
    description: '在后台按照 DAG (有向无环图) 并发调度并执行一批关联子任务',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          description: '任务节点数组',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '唯一节点ID (如: fetch_db, build_ui)' },
              task: { type: 'string', description: '给到 Worker 的详细具体指令' },
              deps: {
                type: 'array',
                items: { type: 'string' },
                description: '该节点必须等待的前置节点 ID 数组，无依赖填空',
              },
            },
            required: ['id', 'task'],
          },
        },
        concurrency: { type: 'number', description: '最大并发线程数 (默认 3)' },
      },
      required: ['nodes'],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd || process.cwd();
      ctx?.ui?.notify?.(
        `引擎接收到包含 ${params.nodes.length} 个节点的并发调度图，开始执行...`,
        'info',
      );

      const executor = new DagExecutor(params.nodes, params.concurrency || 3, cwd);

      try {
        const results = await executor.execute();
        ctx?.ui?.notify?.(`🎉 DAG 图全链路并发闭环完成`, 'success');
        return (() => {
          const _res = {
            status: 'success',
            summary: '所有并发分支节点执行完毕。',
            nodeOutputs: results,
          };
          return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
        })();
      } catch (err) {
        ctx?.ui?.notify?.(`❌ DAG 并发图执行崩溃: ${err.message}`, 'error');
        return (() => {
          const _res = {
            status: 'error',
            message: err.message,
          };
          return { ..._res, content: [{ type: 'text', text: JSON.stringify(_res, null, 2) }] };
        })();
      }
    },
  });
}
