import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import subagentWorktreeExtension from '../extensions/subagent-worktree.js';

describe('Phase 2 P2: Subagent Worktree Orchestration Tests', () => {
  const tools = {};
  const mockContext = { cwd: process.cwd() };
  const testBranch = 'test_feat_subagent_orch';
  let gitRoot = process.cwd();

  before(() => {
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {}
    const mockPi = {
      registerTool: (tool) => {
        tools[tool.name] = tool;
      }
    };
    subagentWorktreeExtension(mockPi);
  });

  test('Tool registration asserts all 4 worktree tools present', () => {
    assert.equal(typeof tools.spawn_worktree_subagent?.execute, 'function');
    assert.equal(typeof tools.list_worktree_subagents?.execute, 'function');
    assert.equal(typeof tools.merge_worktree_subagent?.execute, 'function');
    assert.equal(typeof tools.cleanup_worktree_subagent?.execute, 'function');
  });

  test('spawn_worktree_subagent creates worktree and task metadata', async () => {
    const res = await tools.spawn_worktree_subagent.execute({
      task: '开发单元测试示例组件',
      branchName: testBranch
    }, mockContext);

    assert.equal(res.status, 'success');
    assert.equal(res.branch, testBranch);
    assert.equal(fs.existsSync(res.worktreePath), true);
  });

  test('list_worktree_subagents scans active worktrees correctly', async () => {
    const res = await tools.list_worktree_subagents.execute({}, mockContext);
    assert.equal(res.status, 'success');
    assert.equal(res.count >= 1, true);

    const found = res.worktrees.find(w => w.branch === testBranch);
    assert.equal(Boolean(found), true);
    assert.equal(found.task, '开发单元测试示例组件');
  });

  test('merge_worktree_subagent commits changes and merges cleanly into main', async () => {
    const worktreePath = path.join(mockContext.cwd, '.agent', 'worktrees', testBranch);
    const dummyInWorktree = path.join(worktreePath, 'test_dummy_subagent_file.txt');
    const dummyInGitRoot = path.join(gitRoot, 'test_dummy_subagent_file.txt');

    fs.writeFileSync(dummyInWorktree, 'subagent worktree output content');

    const mergeRes = await tools.merge_worktree_subagent.execute({
      branchName: testBranch,
      deleteAfterMerge: true
    }, mockContext);

    assert.equal(mergeRes.status, 'success');
    assert.equal(fs.existsSync(dummyInGitRoot), true); // Merged file in git repo root
    if (fs.existsSync(dummyInGitRoot)) {
      fs.unlinkSync(dummyInGitRoot); // Clean up from git root
    }
  });

  test('cleanup_worktree_subagent cleans up remaining worktree artifacts', async () => {
    const cleanupRes = await tools.cleanup_worktree_subagent.execute({
      branchName: testBranch
    }, mockContext);

    assert.equal(cleanupRes.status, 'success');
  });
});
