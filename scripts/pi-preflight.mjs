#!/usr/bin/env node
/**
 * AIIA pre-flight CLI — pi 启动前自检（由 ~/.local/bin/pi 包装器调用）。
 *
 * 用法：node scripts/pi-preflight.mjs [--root <repo-root>] [--force] [--quiet]
 * 退出码：0 = 干净或已自愈（坏扩展已隔离）；2 = src 有语法错误（AIIA 降级，pi 仍可启动）
 *
 * Env: AIIA_SKIP_PREFLIGHT=1 跳过（包装器尊重此开关）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreflight } from '../pi-agent/src/pi-preflight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, force: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') opts.root = path.resolve(argv[++i] || DEFAULT_ROOT);
    else if (a === '--force') opts.force = true;
    else if (a === '--quiet') opts.quiet = true;
  }
  return opts;
}

function main() {
  if (process.env.AIIA_SKIP_PREFLIGHT === '1') {
    if (!process.env.AIIA_SKIP_PREFLIGHT_SILENT) console.log('[AIIA pre-flight] skipped (AIIA_SKIP_PREFLIGHT=1)');
    process.exit(0);
  }
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(opts.root, 'pi-agent', 'package.json'))) {
    console.error(`[AIIA pre-flight] not a repo root: ${opts.root}`);
    process.exit(2);
  }

  const started = Date.now();
  const report = runPreflight(opts.root, { force: opts.force });

  if (report.ok) {
    if (!opts.quiet) {
      const detail = report.skipped ? 'no changes since last check' : 'all checks passed';
      console.log(`[AIIA pre-flight] OK (${detail}, ${Date.now() - started}ms)`);
    }
    process.exit(0);
  }

  // 坏扩展已被隔离 → pi 仍可启动，降级提示
  if (report.quarantined.length) {
    console.warn(`[AIIA pre-flight] ⚠️ 隔离 ${report.quarantined.length} 个坏扩展（已移至 .agent/heal/quarantine/，修复后移回即可）：`);
    const errByFile = new Map(report.probeErrors.map((e) => [e.file, e.error]));
    for (const q of report.quarantined) {
      console.warn(`  - ${q.extensionId}  ←  ${errByFile.get(q.file) || q.error || 'module load failed'}`);
    }
  }
  if (report.probeErrors.length && !report.quarantined.length) {
    console.warn(`[AIIA pre-flight] ⚠️ 探测到 ${report.probeErrors.length} 个扩展加载失败（无法自动隔离）：`);
    for (const e of report.probeErrors) console.warn(`  - ${e.file}: ${e.error}`);
  }
  if (report.srcErrors.length) {
    console.error(`[AIIA pre-flight] 🔴 src 模块错误 ${report.srcErrors.length} 个（AIIA 扩展将整体降级，请修复）：`);
    for (const e of report.srcErrors) console.error(`  - ${e.file}: ${e.error}`);
  }
  if (report.extErrors.length) {
    console.warn(`[AIIA pre-flight] ⚠️ 扩展模块错误 ${report.extErrors.length} 个（已隔离请修复）：`);
    for (const e of report.extErrors) console.warn(`  - ${e.file}: ${e.error}`);
  }
  process.exit(report.srcErrors.length ? 2 : 0);
}

main();
