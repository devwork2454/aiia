/**
 * AIIA Task DAG Runner Core Engine (Phase 2 P5)
 * 支持多节点依赖拓扑排序、自动重试、检查点存盘与断点续传。
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export class TaskDAGRunner {
  /**
   * @param {{ dagId: string, storageDir?: string, maxRetries?: number }} opts
   */
  constructor({ dagId, storageDir, maxRetries = 2 }) {
    this.dagId = dagId;
    this.storageDir = storageDir || path.join(process.cwd(), '.agent', 'dag_runner');
    this.maxRetries = maxRetries;
    this.nodes = new Map();
    this.checkpointFile = path.join(this.storageDir, `${this.dagId}.json`);

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * 添加任务节点
   * @param {{ id: string, name?: string, command?: string, dependsOn?: string[] }} node
   */
  addNode({ id, name, command, dependsOn = [] }) {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id '${id}' already exists.`);
    }
    this.nodes.set(id, {
      id,
      name: name || id,
      command: command || '',
      dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
      status: 'pending',
      retryAttempts: 0,
      output: null,
      error: null,
      updatedAt: new Date().toISOString()
    });
    this.saveCheckpoint();
  }

  /**
   * 保存 DAG 状态到检查点文件
   */
  saveCheckpoint() {
    const data = {
      dagId: this.dagId,
      updatedAt: new Date().toISOString(),
      nodes: Array.from(this.nodes.values())
    };
    fs.writeFileSync(this.checkpointFile, JSON.stringify(data, null, 2));
  }

  /**
   * 从检查点文件加载状态
   */
  loadCheckpoint() {
    if (!fs.existsSync(this.checkpointFile)) {
      return false;
    }
    try {
      const content = fs.readFileSync(this.checkpointFile, 'utf8');
      const data = JSON.parse(content);
      this.nodes.clear();
      for (const node of data.nodes) {
        this.nodes.set(node.id, node);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取可以被调度的就绪节点列表
   */
  getReadyNodes() {
    const ready = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending' && node.status !== 'failed') continue;
      if (node.status === 'failed' && node.retryAttempts >= this.maxRetries) continue;

      const depsOk = node.dependsOn.every(depId => {
        const depNode = this.nodes.get(depId);
        return depNode && depNode.status === 'completed';
      });

      const depsFailed = node.dependsOn.some(depId => {
        const depNode = this.nodes.get(depId);
        return depNode && (depNode.status === 'skipped' || (depNode.status === 'failed' && depNode.retryAttempts >= this.maxRetries));
      });

      if (depsFailed) {
        node.status = 'skipped';
        node.updatedAt = new Date().toISOString();
        this.saveCheckpoint();
        continue;
      }

      if (depsOk) {
        ready.push(node);
      }
    }
    return ready;
  }

  /**
   * 执行完整的 DAG 图拓扑调度
   * @param {(node: object) => Promise<string>} executor
   */
  async run(executor) {
    this.loadCheckpoint();

    const defaultExecutor = async (node) => {
      if (!node.command) return 'noop';
      return execSync(node.command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    };

    const execFn = executor || defaultExecutor;

    let progressMade = true;
    while (progressMade) {
      const readyNodes = this.getReadyNodes();
      if (readyNodes.length === 0) {
        progressMade = false;
        break;
      }

      for (const node of readyNodes) {
        node.status = 'running';
        node.updatedAt = new Date().toISOString();
        this.saveCheckpoint();

        try {
          const out = await execFn(node);
          node.status = 'completed';
          node.output = out;
          node.error = null;
        } catch (err) {
          node.retryAttempts += 1;
          node.error = err.message;
          if (node.retryAttempts < this.maxRetries) {
            node.status = 'pending';
          } else {
            node.status = 'failed';
          }
        }
        node.updatedAt = new Date().toISOString();
        this.saveCheckpoint();
      }
    }

    return this.getStatus();
  }

  /**
   * 获取当前 DAG 调度运行状态
   */
  getStatus() {
    const nodes = Array.from(this.nodes.values());
    const total = nodes.length;
    const completed = nodes.filter(n => n.status === 'completed').length;
    const failed = nodes.filter(n => n.status === 'failed').length;
    const skipped = nodes.filter(n => n.status === 'skipped').length;
    const running = nodes.filter(n => n.status === 'running').length;
    const pending = nodes.filter(n => n.status === 'pending').length;

    let isDone = completed + failed + skipped === total;
    let isSuccess = completed === total;

    return {
      dagId: this.dagId,
      isDone,
      isSuccess,
      progress: total > 0 ? Math.round(((completed + skipped + failed) / total) * 100) : 100,
      stats: { total, completed, failed, skipped, running, pending },
      nodes
    };
  }
}
