/**
 * AIIA self-heal store — 错误采集 → 修复任务队列（方案 B：goal 自省消费）。
 *
 * 三层自愈分工：
 *   L0 崩溃隔离：坏扩展不拖垮整个 pi（clean-stray-pi-extensions 已覆盖半链接场景）
 *   L1 报错即修复：本模块采集 aiia 自身报错 → 写修复任务卡 → goal 循环消费
 *   L2 持续进化：goal skill 的 D6 自省维度（见 .agents/skills/goal/SKILL.md）
 *
 * 本文件只含纯逻辑（便于单测）；hook 见 extensions/self-heal.js。
 *
 * Env:
 *   AIIA_DISABLE_SELF_HEAL=1            关闭采集
 *   AIIA_HEAL_DIR=/abs/path             覆盖修复队列根目录（默认 <cwd>/.agent/heal）
 *   PI_CRASH_LOG=/abs/path              覆盖 pi 崩溃日志路径（默认 ~/.pi/agent/pi-crash.log）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { redactText } from './trajectory-store.js';

export const SELF_HEAL_DIR = '.agent/heal';
export const QUEUE_SUBDIR = 'queue';
export const DONE_SUBDIR = 'done';
export const CRASH_CURSOR = 'crash-cursor';

/** 判断一段文本是否涉及 aiia 自身（扩展 / 配置 / 规则 / 文档 / 脚本）。 */
export function isSelfReference(text, opts = {}) {
  if (typeof text !== 'string' || !text) return false;
  const cwd = opts.cwd || process.cwd();
  const patterns = [
    /\[AIIA[^\]]*\]/i, // AIIA 扩展日志前缀
    /pi-agent[/\\](?:extensions|src|test|scripts)/,
    /(?:^|[/\\])(?:extensions|src)[/\\][A-Za-z0-9_.-]+\.(?:js|mjs|ts)/,
    /\.agents[/\\]skills/,
    /\.harness[/\\]/,
    /(?:^|[/\\])scripts[/\\]/,
  ];
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  // 当前项目内 aiia 相关目录（pi-agent / .agents / .harness / scripts / docs）
  for (const dir of ['pi-agent', '.agents', '.harness', 'scripts', 'docs']) {
    const abs = path.resolve(cwd, dir);
    if (text.includes(abs)) return true;
  }
  return false;
}

export function isSelfHealDisabled(env = process.env) {
  return env.AIIA_DISABLE_SELF_HEAL === '1' || env.AIIA_DISABLE_SELF_HEAL === 'true';
}

export function resolveHealDir(cwd = process.cwd(), env = process.env) {
  if (env.AIIA_HEAL_DIR) {
    const p = env.AIIA_HEAL_DIR;
    return path.isAbsolute(p) ? p : path.resolve(cwd, p);
  }
  return path.resolve(cwd, SELF_HEAL_DIR);
}

export function resolveQueueDir(cwd = process.cwd(), env = process.env) {
  return path.join(resolveHealDir(cwd, env), QUEUE_SUBDIR);
}

export function resolveDoneDir(cwd = process.cwd(), env = process.env) {
  return path.join(resolveHealDir(cwd, env), DONE_SUBDIR);
}

export function resolveCrashLog(env = process.env) {
  if (env.PI_CRASH_LOG) return env.PI_CRASH_LOG;
  return path.join(os.homedir(), '.pi', 'agent', 'pi-crash.log');
}

/** 从消息文本中提取"可修复的错误"（isError 的 toolResult / 含 Error 的文本）。 */
export function extractSelfErrors(event, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const isError = Boolean(m.isError) || m.role === 'toolResult' && Boolean(m.isError);
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      text = m.content
        .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
        .join('\n');
    } else if (typeof m.result === 'string') text = m.result;
    else if (typeof m.text === 'string') text = m.text;
    if (!text) continue;
    if (!isError && !/Error:|TypeError:|ReferenceError:|Cannot read|Unhandled|failed:/i.test(text)) {
      continue;
    }
    const sanitized = redactText(text);
    if (!isSelfReference(sanitized, { cwd })) continue;
    out.push({
      type: 'session-error',
      toolName: m.toolName || m.name || 'unknown',
      summary: firstLine(sanitized),
      detail: truncate(sanitized, 4000),
    });
  }
  return out;
}

/** 扫描 pi-crash.log 中"游标之后"新增的崩溃段，返回错误块列表。 */
export function scanCrashLog(cwd = process.cwd(), opts = {}) {
  const env = opts.env || process.env;
  const crashLog = resolveCrashLog(env);
  let content = '';
  try {
    content = fs.readFileSync(crashLog, 'utf-8');
  } catch {
    return []; // 无崩溃日志 = 无崩溃
  }
  const cursorPath = path.join(resolveHealDir(cwd, env), CRASH_CURSOR);
  let offset = 0;
  try {
    offset = Number(fs.readFileSync(cursorPath, 'utf-8')) || 0;
  } catch {
    /* first run */
  }
  if (content.length <= offset) return [];
  const fresh = content.slice(offset);
  // 保存游标（含当前已扫描段，避免重复入队）
  try {
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.writeFileSync(cursorPath, String(content.length));
  } catch {
    /* best effort */
  }
  const blocks = [];
  const re = /(?:^|\n)([^\n]*(?:Error|TypeError|ReferenceError|Unhandled|Cannot read)[^\n]*)((?:\n[ \t].*)*)/g;
  let match = re.exec(fresh);
  while (match !== null) {
    const detail = redactText(truncate(`${match[1]}\n${match[2] || ''}`.trim(), 3000));
    blocks.push({
      type: 'crash-log',
      source: crashLog,
      summary: firstLine(match[1].trim()),
      detail,
    });
    match = re.exec(fresh);
  }
  return blocks;
}

/** 生成稳定 slug（同错误去重 key）。 */
export function slugFor(task) {
  const seed = `${task.type}|${task.toolName || ''}|${task.summary || ''}`.slice(0, 120);
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

function taskFileName(task, slug) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${slug}.md`;
}

/** 写一条修复任务卡（去重：queue/done 已有同 slug 则跳过）。返回 true=写入 / false=重复。 */
export function queueHealTask(cwd = process.cwd(), task = {}, opts = {}) {
  const env = opts.env || process.env;
  if (isSelfHealDisabled(env)) return false;
  if (!task.summary) return false;
  const slug = slugFor(task);
  const queueDir = resolveQueueDir(cwd, env);
  const doneDir = resolveDoneDir(cwd, env);
  const dup =
    [...listFiles(queueDir), ...listFiles(doneDir)].some((f) => f.includes(`-${slug}.md`));
  if (dup) return false;
  const card = buildHealTaskCard({ ...task, slug });
  try {
    fs.mkdirSync(queueDir, { recursive: true });
    fs.writeFileSync(path.join(queueDir, taskFileName(task, slug)), card);
    return true;
  } catch {
    return false;
  }
}

/** 构建修复任务卡 markdown（goal 循环按此执行闭环）。 */
export function buildHealTaskCard(task = {}) {
  const files = Array.isArray(task.files) && task.files.length
    ? task.files.join(', ')
    : '（待定位，见详情）';
  return `---
type: self-heal
source: ${task.source || task.type || 'unknown'}
created: ${new Date().toISOString()}
slug: ${task.slug || slugFor(task)}
files: ${files}
---
## 错误摘要
${task.summary || '（无摘要）'}

## 详情
${task.detail || '（无详情）'}

## 修复要求（goal 循环强制执行）
1. 先读相关文件定位根因，禁止盲改。
2. 最小 patch，禁止无关重构。
3. 必须亲自跑 \`bash .harness/verify.sh\`，退出码非 0 = 修复失败。
4. 绿 → git commit 并更新 PROGRESS.md；红 → 回滚 patch，保留本卡继续分析。
5. 修复完成后删除本任务卡（等价于 markHealDone）。
`;
}

/** 读取队列中未处理的修复任务卡。 */
export function listHealTasks(cwd = process.cwd(), env = process.env) {
  const queueDir = resolveQueueDir(cwd, env);
  return listFiles(queueDir).map((f) => {
    let content = '';
    try {
      content = fs.readFileSync(path.join(queueDir, f), 'utf-8');
    } catch {
      /* ignore */
    }
    return { file: f, content };
  });
}

/** 标记任务完成：queue → done。 */
export function markHealDone(cwd = process.cwd(), file, env = process.env) {
  const queueDir = resolveQueueDir(cwd, env);
  const doneDir = resolveDoneDir(cwd, env);
  const src = path.join(queueDir, file);
  try {
    fs.mkdirSync(doneDir, { recursive: true });
    fs.renameSync(src, path.join(doneDir, file));
    return true;
  } catch {
    return false;
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

function firstLine(text) {
  const line = String(text).split('\n')[0]?.trim() || '';
  return truncate(line, 300);
}

function truncate(text, max) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}
