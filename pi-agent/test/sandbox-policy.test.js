import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { SandboxPolicy, normalizeSandboxMode } from '../src/sandbox-policy.js';
import sandboxPolicyExtension from '../extensions/sandbox-policy.js';

describe('Phase 2 P7: MCP & Skill Sandbox Policy Tests', () => {
  test('SandboxPolicy evaluates path traversal and high risk commands', () => {
    const policy = new SandboxPolicy({ mode: 'sandbox' });

    assert.equal(policy.evaluate('read_file', { path: '/etc/passwd' }).allowed, false);
    assert.equal(policy.evaluate('write', { path: path.join(os.homedir(), '.ssh', 'id_rsa') }).allowed, false);
    assert.equal(policy.evaluate('bash', { command: 'rm -rf /' }).allowed, false);
    assert.equal(policy.evaluate('bash', { command: 'sudo apt update' }).allowed, false);
    assert.equal(policy.evaluate('bash', { command: 'ls -la' }).allowed, true);
    assert.equal(policy.evaluate('bash', { command: 'echo notes about /etc/passwd' }).allowed, true);
  });

  test('SandboxPolicy strict mode respects allowedTools whitelist', () => {
    const strictPolicy = new SandboxPolicy({ mode: 'strict', allowedTools: ['allowed_tool'] });

    assert.equal(strictPolicy.evaluate('allowed_tool', {}).allowed, true);
    assert.equal(strictPolicy.evaluate('forbidden_tool', {}).allowed, false);
  });

  test('SandboxPolicy extension registers tool_call hook and policy tools', async () => {
    let hookFn;
    const tools = {};
    const mockPi = {
      on: (event, fn) => { if (event === 'tool_call') hookFn = fn; },
      registerTool: (t) => { tools[t.name] = t; }
    };

    sandboxPolicyExtension(mockPi);
    assert.equal(typeof hookFn, 'function');

    const blockedRes = await hookFn({ tool: 'bash', input: { command: 'rm -rf /' } });
    assert.equal(blockedRes?.block, true);

    const setRes = await tools.set_sandbox_policy.execute('t1', { mode: 'strict', allowedTools: ['safe_tool'] });
    assert.equal(setRes.status, 'success');

    const statusRes = await tools.get_sandbox_policy_status.execute();
    assert.equal(statusRes.policy.mode, 'strict');

    const denied = await tools.set_sandbox_policy.execute('t2', { mode: 'permissive' });
    assert.equal(denied.status, 'error');
    assert.match(denied.message, /SANDBOX_ALLOW_PERMISSIVE/);
  });

  test('normalizeSandboxMode rejects permissive without env', () => {
    assert.throws(() => normalizeSandboxMode('permissive', {}), /SANDBOX_ALLOW_PERMISSIVE/);
    assert.equal(normalizeSandboxMode('permissive', { SANDBOX_ALLOW_PERMISSIVE: '1' }), 'permissive');
  });
});
