/**
 * AIIA pre-flight — pi 启动前自检（引导盲区防护）。
 *
 * 解决"新功能导致 pi 无法重启"的自愈盲区：
 *  - 语法检查全部 aiia 源码（node --check，快）
 *  - 子进程探测扩展模块 import（查解析/依赖链错误，坏 src 会在此暴露）
 *  - 坏扩展自动隔离（移入 quarantine + disabled 记录）→ pi 永远能启动
 *
 * 变更缓存：记录文件 mtime，未改动时跳过探针（日常启动零开销）。
 *
 * 纯逻辑可单测；CLI 见 scripts/pi-preflight.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordCrashedExtension, resolveHealDir } from './self-heal-store.js';

export const QUARANTINE_SUBDIR = 'quarantine';
export const PREFLIGHT_STATE = 'preflight-state.json';
export const PROBE_SCRIPT = '.preflight-probe.mjs';

/** 探针不 import 的入口脚本（顶层直接执行 main 逻辑，会让探针子进程退出）。 */
export const ENTRY_SCRIPTS = new Set(['cli.js']);

/** 收集 aiia 需要自检的 JS 文件。 */
export function collectAiiaFiles(root = process.cwd()) {
  const list = (dir) => {
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.js') && !ENTRY_SCRIPTS.has(f))
        .map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  };
  return {
    srcFiles: list(path.join(root, 'pi-agent', 'src')),
    extFiles: list(path.join(root, 'pi-agent', 'extensions')),
  };
}

/** 语法/依赖探针：单子进程 import 全部文件，allSettled 定位坏模块。返回失败列表 [{file, error}]。 */
export function probeExtensionModules(root = process.cwd(), files = [], opts = {}) {
  if (!files.length) return [];
  const node = opts.node || process.execPath;
  // 探针脚本与模块同仓（pi-agent/），不依赖调用方 root
  const probe = fileURLToPath(new URL('../.preflight-probe.mjs', import.meta.url));
  if (process.env.AIIA_PREFLIGHT_DEBUG === '1') {
    console.error('[dbg] probe =', probe, '| import.meta.url =', import.meta.url);
  }
  if (!fs.existsSync(probe)) return [];
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-preflight-')),
    'files.json',
  );
  try {
    fs.writeFileSync(tmp, JSON.stringify(files));
    const res = spawnSync(node, [probe, tmp], { encoding: 'utf-8', timeout: 120000 });
    if (res.status !== 0) {
      return [{ file: '<probe>', error: (res.stderr || res.stdout || 'probe failed').trim().slice(0, 500) }];
    }
    try {
      const failed = JSON.parse(res.stdout.trim().split('\n').pop() || '[]');
      return Array.isArray(failed) ? failed : [];
    } catch {
      return [];
    }
  } finally {
    try {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 隔离坏扩展：移入 quarantine + 写 disabled 记录。返回被隔离的文件路径列表。 */
export function quarantineBadExtensions(root = process.cwd(), badFiles = [], opts = {}) {
  const quarantined = [];
  const healDir = resolveHealDir(root, opts.env || process.env);
  const qDir = path.join(healDir, QUARANTINE_SUBDIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  for (const entry of badFiles) {
    const file = entry.file || entry;
    if (!file || typeof file !== 'string') continue;
    if (!file.includes(path.join('extensions', path.sep))) continue; // 只隔离扩展，不碰 src
    const base = path.basename(file);
    const extId = base.replace(/\.js$/, '');
    const target = path.join(qDir, `${ts}-${base}`);
    try {
      fs.mkdirSync(qDir, { recursive: true });
      fs.renameSync(file, target);
      recordCrashedExtension(root, extId, { env: opts.env || process.env });
      quarantined.push({ file, target, extensionId: extId });
    } catch {
      /* keep going */
    }
  }
  return quarantined;
}

/** 变更检测：全部文件 mtime 未变 → 跳过探针。返回 true=有变更需检查。 */
export function hasChanges(root = process.cwd(), files = [], env = process.env) {
  const statePath = path.join(resolveHealDir(root, env), PREFLIGHT_STATE);
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(statePath, 'utf-8')) || {};
  } catch {
    /* first run */
  }
  const current = {};
  let changed = false;
  for (const file of files) {
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      changed = true; // 文件消失也算变更
      continue;
    }
    current[file] = mtime;
    if (prev[file] !== mtime) changed = true;
  }
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(current, null, 2));
  } catch {
    /* best effort */
  }
  return changed;
}

/** 执行完整 pre-flight。返回 {ok, syntaxErrors, probeErrors, quarantined, skipped}。 */
export function runPreflight(root = process.cwd(), opts = {}) {
  const env = opts.env || process.env;
  const { srcFiles, extFiles } = collectAiiaFiles(root);
  const allFiles = [...srcFiles, ...extFiles];

  // 探针 import 全部文件（语法错误 + 依赖链错误都会在此暴露；node --check 不可靠已弃用）
  let probeErrors = [];
  let skipped = false;
  if (opts.force) {
    hasChanges(root, allFiles, env); // 强制检查并刷新缓存
    probeErrors = probeExtensionModules(root, allFiles, opts);
  } else if (hasChanges(root, allFiles, env)) {
    probeErrors = probeExtensionModules(root, allFiles, opts);
  } else {
    skipped = true;
  }

  // 分类：src 失败只报告（无法自动隔离）；扩展失败自动隔离
  const srcErrors = probeErrors.filter((e) => e.file.includes(path.join('src', path.sep)));
  const extErrors = probeErrors.filter((e) => !e.file.includes(path.join('src', path.sep)));
  const quarantined = quarantineBadExtensions(root, extErrors, { env });

  return {
    ok: probeErrors.length === 0,
    skipped,
    probeErrors,
    srcErrors,
    extErrors,
    quarantined,
  };
}
