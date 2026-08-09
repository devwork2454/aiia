/**
 * AIIA quality-gate core — after edit/write, run lightweight lint/typecheck
 * and produce feedback for tool_result re-injection.
 *
 * Defaults (env overrides):
 *   QUALITY_GATE_DISABLED=1     skip entirely
 *   QUALITY_GATE_TIMEOUT_MS     default 15000
 *   QUALITY_GATE_CMD            custom shell with {file} placeholder
 *   QUALITY_GATE_MAX_OUTPUT     default 4096
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MUTATING_TOOLS = new Set(['edit', 'write']);

export function isMutatingFileTool(toolName) {
  return MUTATING_TOOLS.has(String(toolName || ''));
}

export function extractTargetPath(input) {
  if (!input || typeof input !== 'object') return null;
  const p = input.path ?? input.file ?? input.filename;
  if (typeof p !== 'string' || !p.trim()) return null;
  return p.trim();
}

export function resolveTargetPath(filePath, cwd = process.cwd()) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function extOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim() || null;
}

/**
 * Pick runners for a file. Each runner: { name, argv: string[] } or { name, shell: string }.
 * Injectable via opts.pickRunners for tests.
 */
export function defaultPickRunners(filePath, env = process.env) {
  if (env.QUALITY_GATE_CMD) {
    return [{ name: 'custom', shell: String(env.QUALITY_GATE_CMD).replaceAll('{file}', filePath) }];
  }

  const ext = extOf(filePath);
  const runners = [];

  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    runners.push({ name: 'node --check', argv: ['node', '--check', filePath] });
  }

  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
    const tsc = which('tsc');
    if (tsc) {
      runners.push({
        name: 'tsc --noEmit',
        argv: [tsc, '--noEmit', '--pretty', 'false', '--skipLibCheck', filePath],
      });
    } else {
      // Node 22+ can syntax-check TS via strip-types; ignore if unsupported.
      runners.push({
        name: 'node --check (strip-types)',
        argv: ['node', '--experimental-strip-types', '--check', filePath],
        optional: true,
      });
    }
  }

  if (ext === '.py') {
    const py = which('python3') || which('python');
    if (py) {
      runners.push({ name: 'py_compile', argv: [py, '-m', 'py_compile', filePath] });
    }
  }

  return runners;
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

/**
 * Execute one runner. Returns { ok, name, exitCode, output }.
 */
export function runRunner(runner, { timeoutMs = 15000, spawn = spawnSync } = {}) {
  let r;
  if (runner.shell) {
    r = spawn('sh', ['-c', runner.shell], {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
    });
  } else {
    const [cmd, ...args] = runner.argv;
    r = spawn(cmd, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
    });
  }

  const output = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  const ok = !timedOut && r.status === 0;

  // optional runners: missing binary / unsupported flag → treat as skip, not fail
  if (!ok && runner.optional) {
    const msg = `${r.error?.message || ''}\n${output}`.toLowerCase();
    if (
      r.error?.code === 'ENOENT' ||
      msg.includes('bad option') ||
      msg.includes('unknown option') ||
      msg.includes('experimental-strip-types')
    ) {
      return { ok: true, skipped: true, name: runner.name, exitCode: r.status ?? 1, output };
    }
  }

  return {
    ok,
    skipped: false,
    name: runner.name,
    exitCode: timedOut ? 124 : (r.status ?? 1),
    output: timedOut ? `timeout after ${timeoutMs}ms\n${output}` : output,
  };
}

/**
 * @returns {null | { path, passed, failures: Array<{name,exitCode,output}> }}
 */
export function evaluateFileQuality(filePath, opts = {}) {
  const env = opts.env || process.env;
  if (env.QUALITY_GATE_DISABLED === '1' || env.QUALITY_GATE_DISABLED === 'true') {
    return null;
  }
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const pickRunners = opts.pickRunners || defaultPickRunners;
  const runners = pickRunners(filePath, env);
  if (!runners.length) return null;

  const timeoutMs = Number(env.QUALITY_GATE_TIMEOUT_MS || opts.timeoutMs || 15000);
  const maxOutput = Number(env.QUALITY_GATE_MAX_OUTPUT || opts.maxOutput || 4096);
  const failures = [];

  for (const runner of runners) {
    const result = runRunner(runner, { timeoutMs, spawn: opts.spawn });
    if (result.skipped) continue;
    if (!result.ok) {
      failures.push({
        name: result.name,
        exitCode: result.exitCode,
        output: truncate(result.output || '(no output)', maxOutput),
      });
    }
  }

  return { path: filePath, passed: failures.length === 0, failures };
}

export function formatQualityFeedback(report) {
  if (!report || report.passed) return null;
  const lines = [
    '[AIIA Quality Gate] FAILED — fix before continuing',
    `file: ${report.path}`,
  ];
  for (const f of report.failures) {
    lines.push(`--- ${f.name} (exit ${f.exitCode}) ---`);
    lines.push(f.output || '(no output)');
  }
  return lines.join('\n');
}

/**
 * Build tool_result patch from current event + quality report.
 * @returns {null | { content, isError }}
 */
export function buildQualityGatePatch(event, report) {
  const feedback = formatQualityFeedback(report);
  if (!feedback) return null;

  const prev = Array.isArray(event?.content) ? event.content : [];
  const content = [
    ...prev,
    { type: 'text', text: `\n${feedback}\n` },
  ];
  return { content, isError: true };
}

/**
 * High-level: from a tool_result-like event, maybe produce a patch.
 */
export function evaluateToolResultQuality(event, opts = {}) {
  if (!event || event.isError) return null;
  if (!isMutatingFileTool(event.toolName)) return null;

  const rel = extractTargetPath(event.input);
  const abs = resolveTargetPath(rel, opts.cwd || process.cwd());
  if (!abs) return null;

  const report = evaluateFileQuality(abs, opts);
  if (!report || report.passed) return null;
  return buildQualityGatePatch(event, report);
}
