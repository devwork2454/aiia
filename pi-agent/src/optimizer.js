import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function runBatchOptimization(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const spawnFn = opts.spawn || spawnSync;
  
  const trajFile = path.join(cwd, '.agent', 'trajectories.jsonl');
  if (!fs.existsSync(trajFile)) {
    return { status: 'skipped', message: 'No trajectories found' };
  }

  const stat = fs.statSync(trajFile);
  if (stat.size === 0) {
    return { status: 'skipped', message: 'Trajectory file is empty' };
  }

  const task = `[L7 Optimizer]
Read the trajectory file at ${trajFile}.
Analyze the recent executions, tool errors, and successes.
Extract systemic rules or prompt tuning advice to avoid repeating past mistakes.
Modify .agent/project-card.json to append these insights into a "learned_rules" array.
After successfully updating the project-card.json, clear the contents of ${trajFile}.
Do not explain, just execute the file modifications.`;

  // spawn Pi to do the reflection autonomously
  const res = spawnFn('npx', ['pi', '--mode', 'rpc', '--task', task], {
    cwd,
    encoding: 'utf8',
    stdio: 'ignore'
  });

  return { 
    status: 'success', 
    exitCode: res.status,
    message: 'Batch optimization triggered'
  };
}
