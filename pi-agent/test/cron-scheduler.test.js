import { test, describe, before, after } from 'node:test';
import { enableAllExtensions } from './with-all-extensions.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CronScheduler, isCronMatching, isCronDisabled, runDueCommands, startCronTicker } from '../src/cron-scheduler.js';
import cronSchedulerExtension from '../extensions/cron-scheduler.js';

describe('Phase 2 P6: Cron Scheduler Tests', () => {
  let tmpDir;
  let restoreExt;

  before(() => {
    restoreExt = enableAllExtensions();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'cron-test-'));
  });

  after(() => {
    restoreExt?.();
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
    const mockPi = { registerTool: (t) => { tools[t.name] = t; }, on: () => {} };
    cronSchedulerExtension(mockPi);

    const ctx = { cwd: tmpDir };
    const regRes = await tools.register_cron_task.execute('t1', {
      id: 'ext_cron',
      cronExpr: '*/5 * * * *',
      command: 'echo "test"'
    }, undefined, undefined, ctx);

    assert.equal(regRes.status, 'success');

    const listRes = await tools.list_cron_tasks.execute('t2', {}, undefined, undefined, ctx);
    assert.equal(listRes.status, 'success');
    assert.equal(listRes.count, 1);

    const rmRes = await tools.remove_cron_task.execute('t3', { id: 'ext_cron' }, undefined, undefined, ctx);
    assert.equal(rmRes.status, 'success');
  });

  test('runDueCommands executes due task command', () => {
    const dir = path.join(tmpDir, 'due');
    const scheduler = new CronScheduler({ storageDir: dir });
    scheduler.register({ id: 'echo1', cronExpr: '* * * * *', command: 'echo hi' });
    const ran = [];
    const results = runDueCommands(scheduler, new Date(), {
      exec: (cmd) => { ran.push(cmd); return 'ok'; },
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.deepEqual(ran, ['echo hi']);
  });

  test('startCronTicker tick runs evaluate via injected clock', () => {
    const dir = path.join(tmpDir, 'tick');
    const scheduler = new CronScheduler({ storageDir: dir });
    scheduler.register({ id: 'tick1', cronExpr: '* * * * *', command: 'true' });
    let ticks = 0;
    const handle = startCronTicker({
      storageDir: dir,
      intervalMs: 60_000,
      exec: () => { ticks += 1; return ''; },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    const results = handle.tick();
    assert.equal(results.length, 1);
    assert.equal(ticks, 1);
    handle.stop();
  });

  test('isCronDisabled honors CRON_DISABLED', () => {
    assert.equal(isCronDisabled({}), false);
    assert.equal(isCronDisabled({ CRON_DISABLED: '1' }), true);
  });
});
