import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractTargetPath,
  isMutatingFileTool,
  evaluateFileQuality,
  evaluateToolResultQuality,
  formatQualityFeedback,
  buildQualityGatePatch,
  defaultPickRunners,
  resolveLocalBin,
  qualityGateChildTimeoutMs,
  isQualityGateRollbackEnabled,
  spawnQualityGateFixer,
} from '../src/quality-gate.js';
import qualityGateExtension from '../extensions/quality-gate.js';

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-qg-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { dir, file };
}

describe('S1 Quality Gate core', () => {
  test('detects mutating tools and extracts path', () => {
    assert.equal(isMutatingFileTool('edit'), true);
    assert.equal(isMutatingFileTool('write'), true);
    assert.equal(isMutatingFileTool('bash'), false);
    assert.equal(extractTargetPath({ path: 'a.js' }), 'a.js');
    assert.equal(extractTargetPath({}), null);
  });

  test('node --check passes on valid JS', async () => {
    const { file } = tmpFile('ok.js', 'const x = 1;\nexport default x;\n');
    const report = await evaluateFileQuality(file, {
      env: { ...process.env, QUALITY_GATE_DISABLED: undefined },
      pickRunners: (p) => [{ name: 'node --check', argv: ['node', '--check', p] }],
    });
    assert.ok(report);
    assert.equal(report.passed, true);
    assert.equal(report.failures.length, 0);
  });

  test('node --check fails on syntax error and formats feedback', async () => {
    const { file } = tmpFile('bad.js', 'const x = ;\n');
    const report = await evaluateFileQuality(file, {
      env: {},
      pickRunners: (p) => [{ name: 'node --check', argv: ['node', '--check', p] }],
    });
    assert.equal(report.passed, false);
    assert.ok(report.failures.length >= 1);
    const fb = formatQualityFeedback(report);
    assert.match(fb, /Quality Gate/);
    assert.match(fb, /FAILED/);
    assert.match(fb, /bad\.js/);
  });

  test('QUALITY_GATE_DISABLED skips', async () => {
    const { file } = tmpFile('bad.js', 'const x = ;\n');
    const report = await evaluateFileQuality(file, { env: { QUALITY_GATE_DISABLED: '1' } });
    assert.equal(report, null);
  });

  test('evaluateToolResultQuality patches edit failure with isError', async () => {
    const { file } = tmpFile('broken.js', 'function ( {\n');
    const event = {
      type: 'tool_result',
      toolName: 'edit',
      toolCallId: 't1',
      input: { path: file },
      content: [{ type: 'text', text: 'Edited broken.js' }],
      isError: false,
    };
    const patch = await evaluateToolResultQuality(event, {
      cwd: path.dirname(file),
      env: {},
      pickRunners: (p) => [{ name: 'node --check', argv: ['node', '--check', p] }],
    });
    assert.ok(patch);
    assert.equal(patch.isError, true);
    assert.equal(patch.content.length, 2);
    assert.match(patch.content[1].text, /Quality Gate/);
  });

  test('skips non-mutating tools and already-errored results', async () => {
    const event = {
      toolName: 'bash',
      input: { command: 'ls' },
      content: [],
      isError: false,
    };
    assert.equal(await evaluateToolResultQuality(event), null);

    const editErr = {
      toolName: 'edit',
      input: { path: 'x.js' },
      content: [],
      isError: true,
    };
    assert.equal(await evaluateToolResultQuality(editErr), null);
  });

  test('buildQualityGatePatch appends without dropping prior content', () => {
    const patch = buildQualityGatePatch(
      { content: [{ type: 'text', text: 'ok' }] },
      { path: '/tmp/x.js', passed: false, failures: [{ name: 'lint', exitCode: 1, output: 'boom' }] },
    );
    assert.equal(patch.content[0].text, 'ok');
    assert.match(patch.content[1].text, /boom/);
    assert.equal(patch.isError, true);
  });

  test('defaultPickRunners includes node --check and biome for JS', () => {
    const runners = defaultPickRunners('/tmp/sample.js', {});
    const names = runners.map((r) => r.name);
    assert.ok(names.includes('node --check'));
    const biome = resolveLocalBin('@biomejs/biome', 'biome');
    if (biome) {
      assert.ok(names.includes('biome lint'), `expected biome lint, got ${names.join(',')}`);
    }
  });

  test('defaultPickRunners includes py_compile and optional ruff for Python', () => {
    const runners = defaultPickRunners('/tmp/sample.py', {});
    const names = runners.map((r) => r.name);
    assert.ok(names.includes('py_compile'));
  });

  test('QUALITY_GATE_SKIP_BIOME drops biome runner', () => {
    const runners = defaultPickRunners('/tmp/sample.js', { QUALITY_GATE_SKIP_BIOME: '1' });
    assert.equal(runners.some((r) => r.name === 'biome lint'), false);
    assert.ok(runners.some((r) => r.name === 'node --check'));
  });

  test('S8 timeout and rollback flags', () => {
    assert.equal(qualityGateChildTimeoutMs({}), 60000);
    assert.equal(qualityGateChildTimeoutMs({ QUALITY_GATE_CHILD_TIMEOUT_MS: '12000' }), 12000);
    assert.equal(isQualityGateRollbackEnabled({}), false);
    assert.equal(isQualityGateRollbackEnabled({ QUALITY_GATE_ROLLBACK: '1' }), true);
  });

  test('spawnQualityGateFixer uses pi -p with timeout', async () => {
    let seen;
    await spawnQualityGateFixer({
      cwd: '/tmp',
      task: 'fix it',
      env: { QUALITY_GATE_CHILD_TIMEOUT_MS: '5000' },
      spawn: async (cmd, args, opts) => {
        seen = { cmd, args, opts };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(seen.cmd, 'pi');
    assert.deepEqual(seen.args, ['-p', 'fix it']);
    assert.equal(seen.opts.timeout, 5000);
  });
});

describe('S1 Quality Gate extension', () => {
  test('registers tool_result hook and returns failure patch', async () => {
    let hookFn;
    const mockPi = {
      on: (event, fn) => {
        if (event === 'tool_result') hookFn = fn;
      },
    };
    qualityGateExtension(mockPi);
    assert.equal(typeof hookFn, 'function');

    const { file } = tmpFile('ext-bad.js', 'const x = ;\n');
    process.env.QUALITY_GATE_MAX_RETRIES = '0'; // skip S8 retry loop in unit test
    const patch = await hookFn(
      {
        type: 'tool_result',
        toolName: 'write',
        toolCallId: 'w1',
        input: { path: file },
        content: [{ type: 'text', text: 'wrote' }],
        isError: false,
      },
      { cwd: path.dirname(file) },
    );
    // Extension uses real default runners; node --check should fail.
    assert.ok(patch);
    assert.equal(patch.isError, true);
    assert.match(patch.content.at(-1).text, /Quality Gate/);
  });

  test('hook returns undefined/null on clean JS write', async () => {
    let hookFn;
    qualityGateExtension({
      on: (event, fn) => {
        if (event === 'tool_result') hookFn = fn;
      },
    });
    const { file } = tmpFile('ext-ok.js', 'export const n = 42;\n');
    process.env.QUALITY_GATE_MAX_RETRIES = '0';
    const patch = await hookFn(
      {
        type: 'tool_result',
        toolName: 'write',
        toolCallId: 'w2',
        input: { path: file },
        content: [{ type: 'text', text: 'wrote' }],
        isError: false,
      },
      { cwd: path.dirname(file) },
    );
    assert.equal(patch ?? null, null);
  });
});
