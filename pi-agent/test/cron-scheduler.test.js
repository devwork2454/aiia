import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CronScheduler, isCronMatching } from '../src/cron-scheduler.js';
import cronSchedulerExtension from '../extensions/cron-scheduler.js';

describe('Phase 2 P6: Cron Scheduler Tests', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'cron-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('isCronMatching correctly evaluates cron expressions', () => {
    const date = new Date(2026, 7, 9, 16, 0, 0);
    assert.equal(isCronMatching('* * * * *', date), true);
    assert.equal(isCronMatching('0 16 * * *', date), true);
    assert.equal(isCronMatching('5 16 * * *', date), false);
  });

  test('CronScheduler registers, evaluates and unregisters tasks', () => {
    const scheduler = new CronScheduler({ storageDir: tmpDir });
    const task = scheduler.register({
      id: 'task1',
      cronExpr: '* * * * *',
      command: 'echo "hello"'
    });

    assert.equal(task.id, 'task1');
    assert.equal(scheduler.list().length, 1);

    const due = scheduler.evaluate(new Date());
    assert.equal(due.length, 1);
    assert.equal(due[0].id, 'task1');

    assert.equal(scheduler.unregister('task1'), true);
    assert.equal(scheduler.list().length, 0);
  });

  test('Cron extension tools register and execute correctly', async () => {
    const tools = {};
    const mockPi = { registerTool: (t) => { tools[t.name] = t; } };
    cronSchedulerExtension(mockPi);

    const ctx = { cwd: tmpDir };
    const regRes = await tools.register_cron_task.execute({
      id: 'ext_cron',
      cronExpr: '*/5 * * * *',
      command: 'echo "test"'
    }, ctx);

    assert.equal(regRes.status, 'success');

    const listRes = await tools.list_cron_tasks.execute({}, ctx);
    assert.equal(listRes.status, 'success');
    assert.equal(listRes.count, 1);

    const rmRes = await tools.remove_cron_task.execute({ id: 'ext_cron' }, ctx);
    assert.equal(rmRes.status, 'success');
  });
});
