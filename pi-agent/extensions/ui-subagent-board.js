/**
 * AIIA Subagent Concurrent Board
 * Displays a real-time TUI panel for background Git Worktree Subagents.
 */
import fs from 'fs';
import path from 'path';
import { isExtensionEnabled } from "../src/extension-profile.js";

const WIDGET_KEY = "subagent-board";
const POLL_INTERVAL = 1000;

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function scanWorktrees(cwd) {
  const baseDir = path.join(cwd, '.agent', 'worktrees');
  if (!fs.existsSync(baseDir)) return [];
  const dirs = fs.readdirSync(baseDir);
  const tasks = [];
  
  for (const dir of dirs) {
    const fullPath = path.join(baseDir, dir);
    if (!fs.statSync(fullPath).isDirectory()) continue;
    
    const taskInfoFile = path.join(fullPath, '.subagent_task.json');
    if (!fs.existsSync(taskInfoFile)) continue;
    
    try {
      const meta = JSON.parse(fs.readFileSync(taskInfoFile, 'utf8'));
      tasks.push(meta);
    } catch {}
  }
  return tasks;
}

export default function uiSubagentBoardExtension(pi) {
  if (!isExtensionEnabled("ui-subagent-board")) return;

  let timer = null;
  let activeCtx = null;

  let tickIndex = 0;
  const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  function paint() {
    if (!activeCtx || !activeCtx.ui || !activeCtx.ui.setWidget) return;
    
    const cwd = activeCtx.cwd || process.cwd();
    const tasks = scanWorktrees(cwd);
    
    if (tasks.length === 0) {
      activeCtx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }

    const now = Date.now();
    let running = 0;
    
    const lines = [];
    const spinner = BRAILLE_SPINNER[tickIndex % BRAILLE_SPINNER.length];

    for (const task of tasks) {
      const isAlive = task.pid ? (() => {
        try { process.kill(task.pid, 0); return true; } catch { return false; }
      })() : false;
      
      const status = task.status === 'merged' ? 'merged' : (isAlive ? 'running' : 'idle');
      if (status === 'running') running++;
      
      const elapsed = task.spawnedAt ? formatDuration(now - new Date(task.spawnedAt).getTime()) : '0s';
      const branchName = task.branch || 'unknown';
      const taskDesc = (task.task || '').slice(0, 30).replace(/\n/g, ' ');
      
      let glyph = '○';
      if (status === 'running') glyph = spinner;
      else if (status === 'merged') glyph = '✔';
      else if (status === 'idle') glyph = '⚠';
      
      lines.push(`    ${glyph} [${branchName}] ${elapsed} | ${taskDesc}`);
    }
    
    if (lines.length > 0) {
      lines.unshift(`Subagents Working on ${running} active tasks • ${tasks.length - running} other`);
      activeCtx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
    } else {
      activeCtx.ui.setWidget(WIDGET_KEY, undefined);
    }
  }

  pi.on("session_start", (event, ctx) => {
    activeCtx = ctx;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      tickIndex++;
      paint();
    }, 80); // use 80ms to match turn-status smooth animation
    paint();
  });

  pi.on("turn_start", (event, ctx) => {
    activeCtx = ctx;
    paint();
  });

  pi.on("session_shutdown", () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (activeCtx && activeCtx.ui && activeCtx.ui.setWidget) {
      activeCtx.ui.setWidget(WIDGET_KEY, undefined);
    }
    activeCtx = null;
  });
}
