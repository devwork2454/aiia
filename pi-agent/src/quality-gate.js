/**
 * AIIA quality-gate core — after edit/write, run lightweight lint/typecheck
 * and produce feedback for tool_result re-injection.
 *
 * Defaults (env overrides):
 *   QUALITY_GATE_DISABLED=1     skip entirely
 *   QUALITY_GATE_TIMEOUT_MS     default 15000
 *   QUALITY_GATE_CMD            custom shell with {file} placeholder
 *   QUALITY_GATE_MAX_OUTPUT     default 4096
 *   QUALITY_GATE_SKIP_BIOME=1   skip biome (still run node --check)
 *   QUALITY_GATE_SKIP_RUFF=1    skip ruff (still run py_compile)
 */
import { spawnSync, spawn as nativeSpawn } from 'node:child_process';

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = nativeSpawn(cmd, args, opts);
    
    let timer;
    if (opts.timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeout);
    }
    
    child.stdout?.on('data', d => stdout += d);
    child.stderr?.on('data', d => stderr += d);
    
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ error: err, status: null, stdout, stderr });
    });
    
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const err = new Error('ETIMEDOUT');
        err.code = 'ETIMEDOUT';
        return resolve({ error: err, status: code, stdout, stderr });
      }
      resolve({ status: code, stdout, stderr });
    });
  });
}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const MUTATING_TOOLS = new Set(['edit', 'write', 'patch_edit']);
const __qgDir = path.dirname(fileURLToPath(import.meta.url));
const __piAgentRoot = path.resolve(__qgDir, '..');
const requireFromPi = createRequire(path.join(__piAgentRoot, 'package.json'));

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
  const r = spawnSync('sh', ['-c', `command -v ${JSON.stringify(cmd)}`], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim() || null;
}

/** Resolve local package bin (pi-agent node_modules) then PATH. */
export function resolveLocalBin(pkgName, binName, env = process.env) {
  try {
    const pkgJson = requireFromPi.resolve(`${pkgName}/package.json`);
    const pkgDir = path.dirname(pkgJson);
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    let binRel = pkg.bin;
    if (binRel && typeof binRel === 'object') binRel = binRel[binName] || binRel[pkgName];
    if (typeof binRel === 'string') {
      const abs = path.join(pkgDir, binRel);
      if (fs.existsSync(abs)) return abs;
    }
  } catch {
    // fall through to PATH
  }
  const nmBin = path.join(__piAgentRoot, 'node_modules', '.bin', binName);
  if (fs.existsSync(nmBin)) return nmBin;
  return which(binName) || which(pkgName);
}

function truthyEnv(v) {
  return v === '1' || v === 'true';
}

function buildBiomeRunner(filePath, env = process.env) {
  const biome = resolveLocalBin('@biomejs/biome', 'biome', env);
  if (!biome) return null;
  const gateConfig = path.join(__piAgentRoot, 'biome.gate.json');
  const argv = [biome, 'lint', '--diagnostic-level=error', '--colors=off'];
  if (fs.existsSync(gateConfig)) {
    argv.push('--config-path', gateConfig);
  }
  argv.push(filePath);
  return {
    name: 'biome lint',
    argv,
    optional: true,
    // Run inside pi-agent so Biome resolves pi-agent/biome.json (or the gate
    // config) as the root config instead of clashing with the repo root cwd.
    cwd: __piAgentRoot,
  };
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
    if (!truthyEnv(env.QUALITY_GATE_SKIP_BIOME)) {
      const biomeRunner = buildBiomeRunner(filePath, env);
      if (biomeRunner) runners.push(biomeRunner);
    }
  }

  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
    const tsc = which('tsc');
    if (tsc) {
      runners.push({
        name: 'tsc --noEmit',
        argv: [tsc, '--noEmit', '--pretty', 'false', '--skipLibCheck', filePath],
      });
    } else {
      runners.push({
        name: 'node --check (strip-types)',
        argv: ['node', '--experimental-strip-types', '--check', filePath],
        optional: true,
      });
    }
    if (!truthyEnv(env.QUALITY_GATE_SKIP_BIOME)) {
      const biomeRunner = buildBiomeRunner(filePath, env);
      if (biomeRunner) runners.push(biomeRunner);
    }
  }

  if (ext === '.py') {
    const py = which('python3') || which('python');
    if (py) {
      runners.push({ name: 'py_compile', argv: [py, '-m', 'py_compile', filePath] });
    }
    if (!truthyEnv(env.QUALITY_GATE_SKIP_RUFF)) {
      const ruff = which('ruff');
      if (ruff) {
        runners.push({
          name: 'ruff check',
          argv: [ruff, 'check', '--quiet', filePath],
          optional: true,
        });
      }
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
export async function runRunner(runner, { timeoutMs = 15000, spawn = spawnAsync } = {}) {
  const spawnOpts = {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    ...(runner.cwd ? { cwd: runner.cwd } : {}),
  };
  let r;
  if (runner.shell) {
    r = await spawn('sh', ['-c', runner.shell], spawnOpts);
  } else {
    const [cmd, ...args] = runner.argv;
    r = await spawn(cmd, args, spawnOpts);
  }

  const output = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  const ok = !timedOut && r.status === 0;

  // optional runners: missing binary / unsupported / path ignored → skip, not fail
  if (!ok && runner.optional) {
    const msg = `${r.error?.message || ''}\n${output}`.toLowerCase();
    if (
      r.error?.code === 'ENOENT' ||
      msg.includes('bad option') ||
      msg.includes('unknown option') ||
      msg.includes('experimental-strip-types') ||
      msg.includes('no files were processed') ||
      msg.includes('not found')
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
 * @returns {Promise<null | { path, passed, failures: Array<{name,exitCode,output}> }>}
 */
export async function evaluateFileQuality(filePath, opts = {}) {
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
    const result = await runRunner(runner, { timeoutMs, spawn: opts.spawn });
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
export async function evaluateToolResultQuality(event, opts = {}) {
  if (!event || event.isError) return null;
  if (!isMutatingFileTool(event.toolName)) return null;

  const rel = extractTargetPath(event.input);
  const abs = resolveTargetPath(rel, opts.cwd || process.cwd());
  if (!abs) return null;

  const report = await evaluateFileQuality(abs, opts);
  if (!report || report.passed) return null;
  return buildQualityGatePatch(event, report);
}

export function qualityGateChildTimeoutMs(env = process.env) {
  const n = Number(env.QUALITY_GATE_CHILD_TIMEOUT_MS || 60000);
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

export function isQualityGateRollbackEnabled(env = process.env) {
  return env.QUALITY_GATE_ROLLBACK === '1' || env.QUALITY_GATE_ROLLBACK === 'true';
}

export function qualityGateMaxRetries(env = process.env) {
  if (env.QUALITY_GATE_MAX_RETRIES == null || env.QUALITY_GATE_MAX_RETRIES === '') return 3;
  const n = parseInt(env.QUALITY_GATE_MAX_RETRIES, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/**
 * Spawn the S8 fixer. Injectable spawn for tests.
 */
export async function spawnQualityGateFixer({
  cwd,
  task,
  env = process.env,
  spawn = spawnAsync,
} = {}) {
  const timeout = qualityGateChildTimeoutMs(env);
  return await spawn('pi', ['-p', task], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout,
    env,
  });
}
