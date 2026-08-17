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
    this.smRulesFile = path.join(process.cwd(), '.agent', 'state_machine.json');
    this.smRules = this.loadStateMachineRules();

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  loadStateMachineRules() {
    const defaultRules = {
      transitions: {
        PLANNING: ['EXECUTION', 'PLANNING'],
        EXECUTION: ['EXECUTION', 'ASSERTION'],
        ASSERTION: ['ASSERTION', 'MERGE', 'ROLLBACK'],
        MERGE: ['MERGE'],
        ROLLBACK: ['ROLLBACK'],
      },
      maxAssertionRetries: 3,
    };
    if (fs.existsSync(this.smRulesFile)) {
      try {
        const custom = JSON.parse(fs.readFileSync(this.smRulesFile, 'utf8'));
        return { ...defaultRules, ...custom };
      } catch (e) {
        return defaultRules;
      }
    }
    return defaultRules;
  }

  /**
   * 添加任务节点
   * @param {{ id: string, name?: string, command?: string, dependsOn?: string[] }} node
   */
  addNode({ id, name, command, dependsOn = [], type = 'EXECUTION' }) {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id '${id}' already exists.`);
    }

    if (this.smRules) {
      if (!Object.keys(this.smRules.transitions).includes(type)) {
        throw new Error(
          `Invalid node type '${type}'. Allowed types: ${Object.keys(this.smRules.transitions).join(', ')}`,
        );
      }
      for (const depId of Array.isArray(dependsOn) ? dependsOn : []) {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          const allowedNext = this.smRules.transitions[depNode.type] || [];
          if (!allowedNext.includes(type)) {
            throw new Error(
              `State machine transition error: cannot transition from ${depNode.type} to ${type}`,
            );
          }
        }
      }
    }

    this.nodes.set(id, {
      id,
      name: name || id,
      command: command || '',
      dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
      type,
      status: 'pending',
      retryAttempts: 0,
      output: null,
      error: null,
      updatedAt: new Date().toISOString(),
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
      nodes: Array.from(this.nodes.values()),
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

      let nodeMaxRetries = this.maxRetries;
      if (
        node.type === 'ASSERTION' &&
        this.smRules &&
        this.smRules.maxAssertionRetries !== undefined
      ) {
        nodeMaxRetries = this.smRules.maxAssertionRetries;
      }

      if (node.status === 'failed' && node.retryAttempts >= nodeMaxRetries) continue;

      let depsOk = true;
      let depsFailed = false;
      let shouldRollback = false;

      for (const depId of node.dependsOn) {
        const depNode = this.nodes.get(depId);
        if (!depNode) continue;

        let depMaxRetries = this.maxRetries;
        if (
          depNode.type === 'ASSERTION' &&
          this.smRules &&
          this.smRules.maxAssertionRetries !== undefined
        ) {
          depMaxRetries = this.smRules.maxAssertionRetries;
        }

        const isDepFailedForever =
          depNode.status === 'skipped' ||
          (depNode.status === 'failed' && depNode.retryAttempts >= depMaxRetries);
        const isDepCompleted = depNode.status === 'completed';

        if (node.type === 'MERGE' && depNode.type === 'ASSERTION') {
          const hasPass =
            isDepCompleted && typeof depNode.output === 'string' && depNode.output.includes('PASS');
          if (!hasPass && isDepCompleted) {
            depsFailed = true;
          } else if (!isDepCompleted) {
            depsOk = false;
          }
          if (isDepFailedForever) depsFailed = true;
        } else if (node.type === 'ROLLBACK' && depNode.type === 'ASSERTION') {
          const hasPass =
            isDepCompleted && typeof depNode.output === 'string' && depNode.output.includes('PASS');
          if (isDepFailedForever || (isDepCompleted && !hasPass)) {
            shouldRollback = true;
          } else if (!isDepCompleted) {
            depsOk = false;
          }
        } else {
          if (!isDepCompleted) depsOk = false;
          if (isDepFailedForever) depsFailed = true;
        }
      }

      if (node.type === 'ROLLBACK') {
        if (shouldRollback) {
          ready.push(node);
        } else if (depsFailed) {
          node.status = 'skipped';
          node.updatedAt = new Date().toISOString();
          this.saveCheckpoint();
        } else if (depsOk && node.dependsOn.length > 0) {
          node.status = 'skipped';
          node.updatedAt = new Date().toISOString();
          this.saveCheckpoint();
        } else if (depsOk && node.dependsOn.length === 0) {
          ready.push(node);
        }
      } else {
        if (depsFailed) {
          node.status = 'skipped';
          node.updatedAt = new Date().toISOString();
          this.saveCheckpoint();
        } else if (depsOk) {
          ready.push(node);
        }
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
    const completed = nodes.filter((n) => n.status === 'completed').length;
    const failed = nodes.filter((n) => n.status === 'failed').length;
    const skipped = nodes.filter((n) => n.status === 'skipped').length;
    const running = nodes.filter((n) => n.status === 'running').length;
    const pending = nodes.filter((n) => n.status === 'pending').length;

    const isDone = completed + failed + skipped === total;
    const isSuccess = completed === total;

    return {
      dagId: this.dagId,
      isDone,
      isSuccess,
      progress: total > 0 ? Math.round(((completed + skipped + failed) / total) * 100) : 100,
      stats: { total, completed, failed, skipped, running, pending },
      nodes,
    };
  }
}
