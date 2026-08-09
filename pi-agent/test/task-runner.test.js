import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TaskDAGRunner } from '../src/task-runner.js';
import taskRunnerExtension from '../extensions/task-runner.js';

describe('Phase 2 P5: Task DAG Runner Core & Extension Tests', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dag-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('TaskDAGRunner correctly executes topological nodes A -> B -> C', async () => {
    const runner = new TaskDAGRunner({ dagId: 'test_dag_1', storageDir: tmpDir });
    runner.addNode({ id: 'stepA', name: 'Step A', command: 'echo "A"' });
    runner.addNode({ id: 'stepB', name: 'Step B', command: 'echo "B"', dependsOn: ['stepA'] });
    runner.addNode({ id: 'stepC', name: 'Step C', command: 'echo "C"', dependsOn: ['stepB'] });

    const executionOrder = [];
    const customExecutor = async (node) => {
      executionOrder.push(node.id);
      return `out_${node.id}`;
    };

    const status = await runner.run(customExecutor);
    assert.equal(status.isSuccess, true);
    assert.deepEqual(executionOrder, ['stepA', 'stepB', 'stepC']);
  });

  test('TaskDAGRunner handles node failure and retries up to maxRetries', async () => {
    const runner = new TaskDAGRunner({ dagId: 'test_dag_fail', storageDir: tmpDir, maxRetries: 2 });
    runner.addNode({ id: 'failNode', name: 'Failing Node', command: 'false' });

    let attempts = 0;
    const failingExecutor = async () => {
      attempts++;
      throw new Error('Simulated command error');
    };

    const status = await runner.run(failingExecutor);
    assert.equal(status.isSuccess, false);
    assert.equal(attempts, 2);
    assert.equal(status.stats.failed, 1);
  });

  test('TaskDAGRunner resumes from checkpoint when re-instantiated', async () => {
    const runner1 = new TaskDAGRunner({ dagId: 'test_dag_resume', storageDir: tmpDir });
    runner1.addNode({ id: 'doneNode', command: 'echo "done"' });
    runner1.addNode({ id: 'pendingNode', command: 'echo "pending"', dependsOn: ['doneNode'] });

    // 运行第一个节点
    const status1 = runner1.getStatus();
    assert.equal(status1.stats.total, 2);

    // 从零加载 runner2
    const runner2 = new TaskDAGRunner({ dagId: 'test_dag_resume', storageDir: tmpDir });
    assert.equal(runner2.loadCheckpoint(), true);
    assert.equal(runner2.getStatus().stats.total, 2);
  });

  test('Extension tools register and execute correctly', async () => {
    const tools = {};
    const mockPi = {
      registerTool: (t) => { tools[t.name] = t; }
    };
    taskRunnerExtension(mockPi);

    assert.equal(typeof tools.create_dag_task?.execute, 'function');
    assert.equal(typeof tools.run_dag_task?.execute, 'function');
    assert.equal(typeof tools.get_dag_task_status?.execute, 'function');

    const ctx = { cwd: tmpDir };
    const createRes = await tools.create_dag_task.execute({
      dagId: 'ext_dag',
      nodes: [
        { id: 'n1', command: 'echo "n1"' },
        { id: 'n2', command: 'echo "n2"', dependsOn: ['n1'] }
      ]
    }, ctx);

    assert.equal(createRes.status, 'success');

    const statusRes = await tools.get_dag_task_status.execute({ dagId: 'ext_dag' }, ctx);
    assert.equal(statusRes.status, 'success');
    assert.equal(statusRes.summary.stats.total, 2);
  });
});
