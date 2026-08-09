/**
 * AIIA Cron Scheduler Core Engine (Phase 2 P6)
 * 支持 5 段式 Cron 表达式解析（分 时 日 月 周）、定时触发判定与状态持久化。
 */
import fs from 'fs';
import path from 'path';

/**
 * 5 段式 Cron 表达式单字段匹配
 */
export function matchCronField(expr, val) {
  if (expr === '*') return true;
  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2), 10);
    return !isNaN(step) && step > 0 && val % step === 0;
  }
  if (expr.includes(',')) {
    const list = expr.split(',').map(s => parseInt(s.trim(), 10));
    return list.includes(val);
  }
  if (expr.includes('-')) {
    const [start, end] = expr.split('-').map(s => parseInt(s.trim(), 10));
    return val >= start && val <= end;
  }
  return parseInt(expr, 10) === val;
}

/**
 * 校验指定 Cron 表达式与 Date 是否匹配
 */
export function isCronMatching(cronExpr, date = new Date()) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, dayExpr, monthExpr, weekExpr] = parts;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const week = date.getDay();

  return (
    matchCronField(minExpr, minute) &&
    matchCronField(hourExpr, hour) &&
    matchCronField(dayExpr, day) &&
    matchCronField(monthExpr, month) &&
    matchCronField(weekExpr, week)
  );
}

export class CronScheduler {
  constructor({ storageDir } = {}) {
    this.storageDir = storageDir || path.join(process.cwd(), '.agent', 'cron_scheduler');
    this.tasksFile = path.join(this.storageDir, 'cron_tasks.json');
    this.tasks = new Map();

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.load();
  }

  load() {
    if (!fs.existsSync(this.tasksFile)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.tasksFile, 'utf8'));
      this.tasks.clear();
      for (const t of data) {
        this.tasks.set(t.id, t);
      }
    } catch {}
  }

  save() {
    const data = Array.from(this.tasks.values());
    fs.writeFileSync(this.tasksFile, JSON.stringify(data, null, 2));
  }

  register({ id, name, cronExpr, command, enabled = true }) {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid 5-field cron expression: ${cronExpr}`);
    }
    const task = {
      id,
      name: name || id,
      cronExpr,
      command: command || '',
      enabled: Boolean(enabled),
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      runCount: 0
    };
    this.tasks.set(id, task);
    this.save();
    return task;
  }

  unregister(id) {
    const ok = this.tasks.delete(id);
    if (ok) this.save();
    return ok;
  }

  list() {
    return Array.from(this.tasks.values());
  }

  /**
   * 针对指定时间评估到期应当运行的任务
   */
  evaluate(now = new Date()) {
    const dueTasks = [];
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      if (isCronMatching(task.cronExpr, now)) {
        if (task.lastRunAt) {
          const last = new Date(task.lastRunAt);
          if (now.getTime() - last.getTime() < 55000) continue;
        }
        task.lastRunAt = now.toISOString();
        task.runCount += 1;
        dueTasks.push(task);
      }
    }
    if (dueTasks.length > 0) this.save();
    return dueTasks;
  }
}
