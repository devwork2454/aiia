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

  test('node --check passes on valid JS', () => {
    const { file } = tmpFile('ok.js', 'const x = 1;\nexport default x;\n');
    const report = evaluateFileQuality(file, {
      env: { ...process.env, QUALITY_GATE_DISABLED: undefined },
      pickRunners: (p) => [{ name: 'node --check', argv: ['node', '--check', p] }],
    });
    assert.ok(report);
    assert.equal(report.passed, true);
    assert.equal(report.failures.length, 0);
  });

  test('node --check fails on syntax error and formats feedback', () => {
    const { file } = tmpFile('bad.js', 'const x = ;\n');
    const report = evaluateFileQuality(file, {
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

  test('QUALITY_GATE_DISABLED skips', () => {
    const { file } = tmpFile('bad.js', 'const x = ;\n');
    const report = evaluateFileQuality(file, { env: { QUALITY_GATE_DISABLED: '1' } });
    assert.equal(report, null);
  });

  test('evaluateToolResultQuality patches edit failure with isError', () => {
    const { file } = tmpFile('broken.js', 'function ( {\n');
    const event = {
      type: 'tool_result',
      toolName: 'edit',
      toolCallId: 't1',
      input: { path: file },
      content: [{ type: 'text', text: 'Edited broken.js' }],
      isError: false,
    };
    const patch = evaluateToolResultQuality(event, {
      cwd: path.dirname(file),
      env: {},
      pickRunners: (p) => [{ name: 'node --check', argv: ['node', '--check', p] }],
    });
    assert.ok(patch);
    assert.equal(patch.isError, true);
    assert.equal(patch.content.length, 2);
    assert.match(patch.content[1].text, /Quality Gate/);
  });

  test('skips non-mutating tools and already-errored results', () => {
    const event = {
      toolName: 'bash',
      input: { command: 'ls' },
      content: [],
      isError: false,
    };
    assert.equal(evaluateToolResultQuality(event), null);

    const editErr = {
      toolName: 'edit',
      input: { path: 'x.js' },
      content: [],
      isError: true,
    };
    assert.equal(evaluateToolResultQuality(editErr), null);
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
