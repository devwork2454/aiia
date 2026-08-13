import { test, describe, before, after } from 'node:test';
import { enableAllExtensions } from './with-all-extensions.js';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import subagentWorktreeExtension from '../extensions/subagent-worktree.js';

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('Phase 2 P2: Subagent Worktree Orchestration Tests', { concurrency: false }, () => {
  const tools = {};
  const testBranch = 'test_feat_subagent_orch';
  let repoRoot;
  let mockContext;

  let restoreExt;
  before(() => {
    restoreExt = enableAllExtensions();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-worktree-test-'));
    run('git init -b main', repoRoot);
    run('git config user.email "test@example.com"', repoRoot);
    run('git config user.name "AIIA Test"', repoRoot);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# worktree test fixture\n');
    run('git add README.md', repoRoot);
    run('git commit -m "init"', repoRoot);

    mockContext = { cwd: repoRoot };

    const mockPi = {
      registerTool: (tool) => {
        tools[tool.name] = tool;
      }
    };
    subagentWorktreeExtension(mockPi);
  });

  after(() => {
    restoreExt?.();
    try {
      run(`git worktree prune`, repoRoot);
    } catch {}
    try {
      run(`git branch -D ${testBranch}`, repoRoot);
    } catch {}
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('Tool registration asserts all 4 worktree tools present', () => {
    assert.equal(typeof tools.spawn_worktree_subagent?.execute, 'function');
    assert.equal(typeof tools.list_worktree_subagents?.execute, 'function');
    assert.equal(typeof tools.merge_worktree_subagent?.execute, 'function');
    assert.equal(typeof tools.cleanup_worktree_subagent?.execute, 'function');
  });

  test('spawn_worktree_subagent creates worktree and task metadata', async () => {
    const res = await tools.spawn_worktree_subagent.execute('t1', {
      task: '开发单元测试示例组件',
      branchName: testBranch
    }, undefined, undefined, mockContext);

    assert.equal(res.status, 'success');
    assert.equal(res.branch, testBranch);
    assert.equal(fs.existsSync(res.worktreePath), true);
  });

  test('list_worktree_subagents scans active worktrees correctly', async () => {
    const res = await tools.list_worktree_subagents.execute('t2', {}, undefined, undefined, mockContext);
    assert.equal(res.status, 'success');
    assert.equal(res.count >= 1, true);

    const found = res.worktrees.find(w => w.branch === testBranch);
    assert.equal(Boolean(found), true);
    assert.equal(found.task, '开发单元测试示例组件');
  });

  test('merge_worktree_subagent commits changes and merges cleanly into main', async () => {
    const worktreePath = path.join(mockContext.cwd, '.agent', 'worktrees', testBranch);
    const dummyInWorktree = path.join(worktreePath, 'test_dummy_subagent_file.txt');
    const dummyInGitRoot = path.join(repoRoot, 'test_dummy_subagent_file.txt');

    fs.writeFileSync(dummyInWorktree, 'subagent worktree output content');

    const mergeRes = await tools.merge_worktree_subagent.execute('t3', {
      branchName: testBranch,
      deleteAfterMerge: true
    }, undefined, undefined, mockContext);

    assert.equal(mergeRes.status, 'success', mergeRes.message || '');
    assert.equal(fs.existsSync(dummyInGitRoot), true);
  });

  test('cleanup_worktree_subagent cleans up remaining worktree artifacts', async () => {
    const cleanupRes = await tools.cleanup_worktree_subagent.execute('t4', {
      branchName: testBranch
    }, undefined, undefined, mockContext);

    assert.equal(cleanupRes.status, 'success');
  });
  test('S7 Micro-context Handoff: outputs are read from .subagent_output.md', async () => {
    const branch = 's7_handoff_test';
    
    // Spawn worktree
    await tools.spawn_worktree_subagent.execute('t5', {
      task: 'Test S7 Handoff',
      branchName: branch,
      handoffInput: 'Strict context input',
      handoffFiles: []
    }, undefined, undefined, mockContext);

    const worktreePath = path.join(mockContext.cwd, '.agent', 'worktrees', branch);
    
    // Simulate subagent generating the output handoff file
    fs.writeFileSync(path.join(worktreePath, '.subagent_output.md'), 'STRICT HANDOFF OUTPUT PAYLOAD');

    // List should return the handoffOutput
    const listRes = await tools.list_worktree_subagents.execute('t6', {}, undefined, undefined, mockContext);
    const listed = listRes.worktrees.find(w => w.branch === branch);
    assert.equal(listed.handoffOutput, 'STRICT HANDOFF OUTPUT PAYLOAD');

    // Merge should return the handoffOutput
    const mergeRes = await tools.merge_worktree_subagent.execute('t7', {
      branchName: branch,
      deleteAfterMerge: true
    }, undefined, undefined, mockContext);
    assert.equal(mergeRes.status, 'success');
    assert.equal(mergeRes.handoffOutput, 'STRICT HANDOFF OUTPUT PAYLOAD');
  });
});
