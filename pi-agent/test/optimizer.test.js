import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatchOptimization } from '../src/optimizer.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-opt-'));
}

describe('S9 L7 Optimizer Core', () => {
  test('skips if no trajectories.jsonl', () => {
    const cwd = tmpDir();
    const result = runBatchOptimization({ cwd });
    assert.equal(result.status, 'skipped');
    assert.match(result.message, /No trajectories/);
  });

  test('skips if trajectories.jsonl is empty', () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.agent'));
    fs.writeFileSync(path.join(cwd, '.agent', 'trajectories.jsonl'), '');
    
    const result = runBatchOptimization({ cwd });
    assert.equal(result.status, 'skipped');
    assert.match(result.message, /empty/);
  });

  test('spawns pi with correct task to optimize rules', () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.agent'));
    fs.writeFileSync(path.join(cwd, '.agent', 'trajectories.jsonl'), '{"foo":"bar"}\n');
    
    let spawnedCmd, spawnedArgs, spawnedOpts;
    const mockSpawn = (cmd, args, opts) => {
      spawnedCmd = cmd;
      spawnedArgs = args;
      spawnedOpts = opts;
      return { status: 0 };
    };

    const result = runBatchOptimization({ cwd, spawn: mockSpawn });
    
    assert.equal(result.status, 'success');
    assert.equal(result.exitCode, 0);
    assert.equal(spawnedCmd, 'npx');
    assert.equal(spawnedArgs[0], 'pi');
    assert.equal(spawnedArgs[1], '--mode');
    assert.equal(spawnedArgs[2], 'rpc');
    assert.equal(spawnedArgs[3], '--task');
    
    // Check if the prompt contains key directives
    const taskPrompt = spawnedArgs[4];
    assert.match(taskPrompt, /\[L7 Optimizer\]/);
    assert.match(taskPrompt, /trajectories\.jsonl/);
    assert.match(taskPrompt, /project-card\.json/);
    assert.match(taskPrompt, /learned_rules/);
  });
});
