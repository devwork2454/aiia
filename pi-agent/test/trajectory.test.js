import { test, describe, before } from 'node:test';
import { enableAllExtensions } from './with-all-extensions.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveTrajectoryPath,
  isTrajectoryDisabled,
  redactText,
  summarizeMessage,
  buildAgentEndRecord,
  buildSessionShutdownRecord,
  appendTrajectoryRecord,
  recordAgentEnd,
  recordSessionShutdown,
} from '../src/trajectory-store.js';
import trajectoryExtension from '../extensions/trajectory.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-traj-'));
}

describe('S2 Trajectory store', () => {
  test('resolveTrajectoryPath defaults to .agent/trajectories.jsonl', () => {
    const cwd = '/tmp/proj';
    assert.equal(resolveTrajectoryPath(cwd, {}), path.resolve(cwd, '.agent', 'trajectories.jsonl'));
    assert.equal(
      resolveTrajectoryPath(cwd, { TRAJECTORY_PATH: 'logs/t.jsonl' }),
      path.resolve(cwd, 'logs/t.jsonl'),
    );
  });

  test('redactText masks common secret shapes', () => {
    const s = redactText(
      'key=sk-abcdefghijklmnopqrstuv wx Bearer abcdefghijklmnop qr api_key=supersecretvalue',
    );
    assert.match(s, /\*\*\*REDACTED\*\*\*/);
    assert.doesNotMatch(s, /sk-abcdefghijklmnopqrstuv/);
    assert.doesNotMatch(s, /supersecretvalue/);
  });

  test('summarizeMessage truncates and keeps tool metadata', () => {
    const long = 'x'.repeat(100);
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: long },
        { type: 'toolCall', name: 'bash', id: 'c1' },
      ],
    };
    const s = summarizeMessage(msg, { maxChars: 40 });
    assert.equal(s.role, 'assistant');
    assert.ok(s.text.length <= 80);
    assert.match(s.text, /truncated/);
    assert.deepEqual(s.toolCalls, [{ name: 'bash', id: 'c1' }]);
  });

  test('appendTrajectoryRecord writes JSONL agent_end and session_shutdown', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'trajectories.jsonl');
    const agentRec = buildAgentEndRecord(
      {
        type: 'agent_end',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello sk-abcdefghijklmnopqrstuv' }] },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'ok' },
              { type: 'toolCall', name: 'edit', id: 'e1' },
            ],
          },
          {
            role: 'toolResult',
            toolName: 'edit',
            toolCallId: 'e1',
            isError: true,
            content: [{ type: 'text', text: 'boom' }],
          },
        ],
      },
      { cwd: dir, now: '2026-08-09T12:00:00.000Z', hostname: 'test-host' },
    );
    assert.equal(agentRec.kind, 'agent_end');
    assert.equal(agentRec.summary.errorTools, 1);
    assert.ok(agentRec.summary.toolNames.includes('edit'));
    assert.match(agentRec.messages[0].text, /REDACTED/);

    const w1 = appendTrajectoryRecord(agentRec, { path: file, env: {} });
    assert.equal(w1.skipped, false);
    assert.ok(fs.existsSync(file));

    const shut = buildSessionShutdownRecord(
      { type: 'session_shutdown', reason: 'quit' },
      { cwd: dir, now: '2026-08-09T12:00:01.000Z', hostname: 'test-host' },
    );
    appendTrajectoryRecord(shut, { path: file, env: {} });

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    assert.equal(a.kind, 'agent_end');
    assert.equal(b.kind, 'session_shutdown');
    assert.equal(b.reason, 'quit');
  });

  test('TRAJECTORY_DISABLED skips writes', () => {
    assert.equal(isTrajectoryDisabled({ TRAJECTORY_DISABLED: '1' }), true);
    const dir = tmpDir();
    const file = path.join(dir, 't.jsonl');
    const r = appendTrajectoryRecord(
      { kind: 'agent_end', ts: 'x' },
      { path: file, env: { TRAJECTORY_DISABLED: '1' } },
    );
    assert.equal(r.skipped, true);
    assert.equal(fs.existsSync(file), false);
  });

  test('recordAgentEnd / recordSessionShutdown convenience wrappers', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'wrap.jsonl');
    recordAgentEnd(
      { messages: [{ role: 'user', content: 'hi' }] },
      { cwd: dir, path: file, env: {}, hostname: 'h' },
    );
    recordSessionShutdown({ reason: 'reload' }, { cwd: dir, path: file, env: {}, hostname: 'h' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).reason, 'reload');
  });
});

describe('S2 Trajectory extension', () => {
  before(() => {
    enableAllExtensions();
  });

  test('registers agent_end and session_shutdown hooks that write JSONL', async () => {
    const hooks = {};
    trajectoryExtension({
      on: (event, fn) => {
        hooks[event] = fn;
      },
    });
    assert.equal(typeof hooks.agent_end, 'function');
    assert.equal(typeof hooks.session_shutdown, 'function');

    const dir = tmpDir();
    const file = path.join(dir, 'ext.jsonl');
    const prev = process.env.TRAJECTORY_PATH;
    const prevDis = process.env.TRAJECTORY_DISABLED;
    const prevAuto = process.env.AIIA_DISABLE_AUTO_PROFILE;
    process.env.TRAJECTORY_PATH = file;
    delete process.env.TRAJECTORY_DISABLED;
    process.env.AIIA_DISABLE_AUTO_PROFILE = '1';
    try {
      await hooks.agent_end(
        {
          type: 'agent_end',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        },
        { cwd: dir },
      );
      await hooks.session_shutdown({ type: 'session_shutdown', reason: 'quit' }, { cwd: dir });
    } finally {
      if (prev === undefined) delete process.env.TRAJECTORY_PATH;
      else process.env.TRAJECTORY_PATH = prev;
      if (prevDis === undefined) delete process.env.TRAJECTORY_DISABLED;
      else process.env.TRAJECTORY_DISABLED = prevDis;
      if (prevAuto === undefined) delete process.env.AIIA_DISABLE_AUTO_PROFILE;
      else process.env.AIIA_DISABLE_AUTO_PROFILE = prevAuto;
    }

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).kind, 'agent_end');
    assert.equal(JSON.parse(lines[1]).kind, 'session_shutdown');
  });

  test('session_shutdown writes project-card draft only (no apply)', async () => {
    const hooks = {};
    trajectoryExtension({
      on: (event, fn) => {
        hooks[event] = fn;
      },
    });
    const dir = tmpDir();
    const prev = process.env.AIIA_DISABLE_AUTO_PROFILE;
    const prevTraj = process.env.TRAJECTORY_DISABLED;
    delete process.env.AIIA_DISABLE_AUTO_PROFILE;
    process.env.TRAJECTORY_DISABLED = '1';
    try {
      await hooks.session_shutdown(
        { type: 'session_shutdown', reason: 'quit' },
        { cwd: dir, model: {} },
      );
    } finally {
      if (prev === undefined) delete process.env.AIIA_DISABLE_AUTO_PROFILE;
      else process.env.AIIA_DISABLE_AUTO_PROFILE = prev;
      if (prevTraj === undefined) delete process.env.TRAJECTORY_DISABLED;
      else process.env.TRAJECTORY_DISABLED = prevTraj;
    }
    const draft = path.join(dir, '.agent', 'project-card.draft.json');
    const card = path.join(dir, '.agent', 'project-card.json');
    assert.equal(fs.existsSync(draft), true);
    assert.equal(fs.existsSync(card), false);
  });
});
