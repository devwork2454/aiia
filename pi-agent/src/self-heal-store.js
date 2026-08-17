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
export const DISABLED_EXTENSIONS_FILE = 'disabled-extensions.json';
export const LAST_SESSION_FILE = 'last-session.json';
export const RECOVERY_INJECTED_FILE = 'recovery-injected.json';

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

// ---------------------------------------------------------------------------
// 坏扩展禁用隔离（崩溃后持久化禁用，下次启动降级运行）
// ---------------------------------------------------------------------------

export function resolveDisabledExtensionsPath(cwd = process.cwd(), env = process.env) {
  return path.join(resolveHealDir(cwd, env), DISABLED_EXTENSIONS_FILE);
}

/** 读取崩溃禁用的扩展 id 列表（幂等）。 */
export function loadDisabledExtensions(cwd = process.cwd(), env = process.env) {
  try {
    const raw = fs.readFileSync(resolveDisabledExtensionsPath(cwd, env), 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 记录一个崩溃扩展（去重追加）。返回 true=本次新增。 */
export function recordCrashedExtension(cwd = process.cwd(), extensionId, opts = {}) {
  const env = opts.env || process.env;
  if (!extensionId) return false;
  const list = loadDisabledExtensions(cwd, env);
  if (list.includes(extensionId)) return false;
  list.push(extensionId);
  try {
    fs.mkdirSync(resolveHealDir(cwd, env), { recursive: true });
    fs.writeFileSync(resolveDisabledExtensionsPath(cwd, env), JSON.stringify(list, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** 从堆栈文本提取崩溃扩展 id（pi-agent/extensions/xxx.js）。 */
export function extensionIdFromStack(stack, cwd = process.cwd()) {
  if (typeof stack !== 'string' || !stack) return null;
  const re = /[/\\]extensions[/\\]([A-Za-z0-9_-]+)\.js/g;
  let m = re.exec(stack);
  const hits = [];
  while (m !== null) {
    hits.push(m[1]);
    m = re.exec(stack);
  }
  // 优先不在 cwd 业务路径下的（aiia 自己的扩展）；否则取第一个
  return hits[0] || null;
}

// ---------------------------------------------------------------------------
// 会话健康标记 + 崩溃后上下文恢复
// ---------------------------------------------------------------------------

export function resolveLastSessionPath(cwd = process.cwd(), env = process.env) {
  return path.join(resolveHealDir(cwd, env), LAST_SESSION_FILE);
}

export function resolveRecoveryInjectedPath(cwd = process.cwd(), env = process.env) {
  return path.join(resolveHealDir(cwd, env), RECOVERY_INJECTED_FILE);
}

function writeJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** 会话正常结束标记（shutdown 时写）。 */
export function markSessionHealthy(cwd = process.cwd(), reason = 'shutdown', opts = {}) {
  const env = opts.env || process.env;
  if (isSelfHealDisabled(env)) return false;
  return writeJson(resolveLastSessionPath(cwd, env), {
    ts: new Date().toISOString(),
    healthy: true,
    reason,
  });
}

/** 会话异常退出标记（uncaughtException 时写，崩溃前尽力）。 */
export function markSessionCrashed(cwd = process.cwd(), reason = 'uncaughtException', opts = {}) {
  const env = opts.env || process.env;
  if (isSelfHealDisabled(env)) return false;
  return writeJson(resolveLastSessionPath(cwd, env), {
    ts: new Date().toISOString(),
    healthy: false,
    reason: String(reason || 'unknown').slice(0, 500),
  });
}

/** 读取上次会话健康状态。返回 {healthy, reason, ts} 或 null。 */
export function readLastSession(cwd = process.cwd(), env = process.env) {
  try {
    const raw = fs.readFileSync(resolveLastSessionPath(cwd, env), 'utf-8');
    const data = JSON.parse(raw);
    return {
      healthy: data.healthy !== false,
      reason: data.reason || 'unknown',
      ts: data.ts || '',
    };
  } catch {
    return null;
  }
}

/** 标记某次崩溃的恢复摘要已注入（避免每次 context 重复注入）。 */
export function markRecoveryInjected(cwd = process.cwd(), crashTs = '', opts = {}) {
  const env = opts.env || process.env;
  return writeJson(resolveRecoveryInjectedPath(cwd, env), { crashTs });
}

export function isRecoveryInjected(cwd = process.cwd(), crashTs = '', env = process.env) {
  try {
    const data = JSON.parse(fs.readFileSync(resolveRecoveryInjectedPath(cwd, env), 'utf-8'));
    return data.crashTs === crashTs;
  } catch {
    return false;
  }
}

/** 构建崩溃恢复摘要（注入新会话上下文）。无崩溃时返回空串。 */
export function buildRecoverySummary(cwd = process.cwd(), opts = {}) {
  const env = opts.env || process.env;
  const last = readLastSession(cwd, env);
  if (!last || last.healthy) return '';
  const crashTs = last.ts || '';
  if (isRecoveryInjected(cwd, crashTs, env)) return '';
  const lines = [
    '[AIIA 自愈恢复] 上次会话异常退出，以下为自动恢复上下文：',
    `- 崩溃时间：${crashTs || '未知'}，原因：${last.reason || '未知'}`,
  ];
  const disabled = loadDisabledExtensions(cwd, env);
  if (disabled.length) {
    lines.push(`- 已崩溃隔离禁用扩展：${disabled.join(', ')}（修复 verify 通过后可手动移除禁用）`);
  }
  const queue = listHealTasks(cwd, env);
  if (queue.length) {
    lines.push(`- 待修复任务 ${queue.length} 个：${queue.map((t) => t.file).join(', ')}`);
    lines.push('- 建议先执行 /goal 消费修复队列（D6 自省），再继续原任务');
  }
  // 上次轨迹尾部摘要（errorTools / 最后工具）
  const traj = readLastTrajectorySummary(cwd, env);
  if (traj) lines.push(`- 上次会话轨迹：${traj}`);
  // PROGRESS.md 当前目标
  const goal = readProgressGoal(cwd);
  if (goal) lines.push(`- PROGRESS.md 目标：${goal}`);
  return lines.join('\n');
}

function readLastTrajectorySummary(cwd, env) {
  try {
    const p = path.join(cwd, '.agent', 'trajectories.jsonl');
    const raw = fs.readFileSync(p, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (!lines.length) return '';
    const last = JSON.parse(lines[lines.length - 1]);
    const s = last.summary || {};
    const tools = Array.isArray(s.toolNames) ? s.toolNames.slice(0, 8).join(',') : '';
    return `kind=${last.kind || '?'} msg=${last.messageCount ?? '?'} errorTools=${s.errorTools ?? 0}${tools ? ` tools=[${tools}]` : ''}`;
  } catch {
    return '';
  }
}

function readProgressGoal(cwd) {
  try {
    const p = path.join(cwd, 'PROGRESS.md');
    const raw = fs.readFileSync(p, 'utf-8');
    const m = raw.match(/##\s*GOAL\s*\n([^#\n][^\n]*)/);
    return m ? m[1].trim().slice(0, 200) : '';
  } catch {
    return '';
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
