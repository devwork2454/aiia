import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enableAllExtensions } from './with-all-extensions.js';
import {
  isSelfReference,
  isSelfHealDisabled,
  resolveHealDir,
  resolveQueueDir,
  extractSelfErrors,
  scanCrashLog,
  slugFor,
  queueHealTask,
  listHealTasks,
  markHealDone,
  buildHealTaskCard,
} from '../src/self-heal-store.js';
import selfHealExtension from '../extensions/self-heal.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-heal-'));
}

describe('S-self-heal store', () => {
  test('isSelfReference 识别 aiia 自身 vs 业务代码', () => {
    const cwd = '/tmp/proj';
    assert.equal(isSelfReference('[AIIA trajectory] write failed: boom', { cwd }), true);
    assert.equal(isSelfReference('at /repo/pi-agent/extensions/quality-gate.js:12', { cwd }), true);
    assert.equal(isSelfReference('at /repo/pi-agent/src/store.js:10', { cwd }), true);
    assert.equal(isSelfReference('at src/extensions/foo.js:1', { cwd }), true);
    assert.equal(isSelfReference('TypeError in src/app.js at line 3', { cwd }), false);
    assert.equal(isSelfReference('Error: file not found /tmp/x.txt', { cwd }), false);
    assert.equal(isSelfReference('正常的业务报错', { cwd }), false);
  });

  test('extractSelfErrors 只提取 aiia 自身错误', () => {
    const cwd = tmpDir();
    const event = {
      messages: [
        { role: 'toolResult', toolName: 'write', isError: true, content: 'boom [AIIA quality-gate] failed' },
        { role: 'toolResult', toolName: 'bash', isError: true, content: 'Error: 业务逻辑失败' },
        { role: 'toolResult', toolName: 'bash', isError: false, content: 'ok' },
      ],
    };
    const errs = extractSelfErrors(event, { cwd });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].type, 'session-error');
    assert.match(errs[0].summary, /AIIA/);
  });

  test('queueHealTask 写卡 + 去重幂等', () => {
    const cwd = tmpDir();
    const task = {
      type: 'session-error',
      source: 'test',
      summary: 'TypeError: Cannot read properties of undefined',
      detail: 'at extensions/foo.js:1',
    };
    assert.equal(queueHealTask(cwd, task), true);
    assert.equal(queueHealTask(cwd, task), false); // 同 slug 去重
    const tasks = listHealTasks(cwd);
    assert.equal(tasks.length, 1);
    assert.match(tasks[0].content, /## 修复要求/);
    // mark done 后队列清空
    assert.equal(markHealDone(cwd, tasks[0].file), true);
    assert.equal(listHealTasks(cwd).length, 0);
  });

  test('scanCrashLog 只扫描游标之后的新增崩溃段', () => {
    const cwd = tmpDir();
    const crashLog = path.join(cwd, 'pi-crash.log');
    fs.writeFileSync(crashLog, 'line1\nTypeError: Cannot read properties of undefined (reading tiers)\n  at provider-composer.js:37\n');
    const blocks = scanCrashLog(cwd, { env: { PI_CRASH_LOG: crashLog } });
    assert.equal(blocks.length, 1);
    assert.match(blocks[0].summary, /TypeError/);
    // 再扫一次：无新增 → 空
    assert.equal(scanCrashLog(cwd, { env: { PI_CRASH_LOG: crashLog } }).length, 0);
    // 追加新错误 → 只返回新增
    fs.appendFileSync(crashLog, 'ReferenceError: x is not defined\n');
    const fresh = scanCrashLog(cwd, { env: { PI_CRASH_LOG: crashLog } });
    assert.equal(fresh.length, 1);
    assert.match(fresh[0].summary, /ReferenceError/);
  });

  test('buildHealTaskCard 模板包含硬门禁要求', () => {
    const card = buildHealTaskCard({ summary: 's', detail: 'd', files: ['pi-agent/x.js'] });
    assert.match(card, /verify\.sh/);
    assert.match(card, /最小 patch/);
    assert.match(card, /回滚/);
  });

  test('AIIA_DISABLE_SELF_HEAL=1 关闭采集', () => {
    const cwd = tmpDir();
    assert.equal(isSelfHealDisabled({ AIIA_DISABLE_SELF_HEAL: '1' }), true);
    assert.equal(
      queueHealTask(cwd, { summary: 'x' }, { env: { AIIA_DISABLE_SELF_HEAL: '1' } }),
      false,
    );
  });
});

describe('S-self-heal extension wiring', () => {
  let restore;
  before(() => {
    restore = enableAllExtensions();
  });
  after(() => restore());

  test('注册 agent_end 与 error hook（fake pi）', () => {
    const hooks = {};
    const fakePi = {
      on: (evt, fn) => {
        hooks[evt] = fn;
      },
    };
    selfHealExtension(fakePi);
    assert.equal(typeof hooks.agent_end, 'function');
    assert.equal(typeof hooks.error, 'function');
  });
});
