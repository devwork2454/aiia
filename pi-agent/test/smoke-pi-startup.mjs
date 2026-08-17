/**
 * No-model smoke: catch Pi startup layout/load failures before real use.
 *
 * 1) Layout: reject repo-root `.pi/extensions` half-symlink (extensions only,
 *    no sibling `.pi/src`) — jiti resolves `../src/*` against the symlink path.
 * 2) Load: DefaultResourceLoader from repo root (package discovery path) must
 *    load every pi-agent extension with zero errors. No AgentSession / model.
 *
 * Exit 0 + `SMOKE_OK` on success; exit 1 otherwise.
 */
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const here = dirname(fileURLToPath(import.meta.url));
const piAgentRoot = join(here, '..');
const repoRoot = join(piAgentRoot, '..');
const extensionsDir = join(piAgentRoot, 'extensions');

/**
 * @param {string} root
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function detectHalfSymlinkExtensions(root) {
  const linkPath = join(root, '.pi', 'extensions');
  if (!existsSync(linkPath)) return { ok: true };
  let st;
  try {
    st = lstatSync(linkPath);
  } catch {
    return { ok: true };
  }
  if (!st.isSymbolicLink()) return { ok: true };
  const siblingSrc = join(root, '.pi', 'src');
  if (existsSync(siblingSrc)) return { ok: true };
  return {
    ok: false,
    reason:
      `${linkPath} is a symlink but ${siblingSrc} is missing. ` +
      `Pi/jiti resolves extension imports as <repo>/.pi/src/* and will fail. ` +
      `Remove the half-symlink; load AIIA via \`pi install pi-agent\` instead.`,
  };
}

/**
 * @param {string} root
 * @returns {Promise<{ errors: unknown[], loadedPaths: string[], expected: string[] }>}
 */
export async function loadAiiaExtensionsFromRepoRoot(root) {
  const expected = readdirSync(extensionsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(extensionsDir, f))
    .sort();

  // Hermetic agentDir: ignore ~/.pi packages (main + worktree dual-install
  // otherwise registers the same tools twice and fails with conflicts).
  const agentDir = mkdtempSync(join(tmpdir(), 'aiia-smoke-agent-'));
  try {
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      noSkills: true,
      noContextFiles: true,
      noExtensions: true,
      additionalExtensionPaths: expected,
    });
    await loader.reload();
    const res = loader.getExtensions();
    const loadedPaths = res.extensions
      .map((e) => e.resolvedPath || e.path || '')
      .filter(Boolean)
      .sort();
    return { errors: res.errors ?? [], loadedPaths, expected };
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function assertDetectorSelfCheck() {
  const tmp = mkdtempSync(join(tmpdir(), 'aiia-smoke-'));
  try {
    mkdirSync(join(tmp, '.pi'));
    symlinkSync(extensionsDir, join(tmp, '.pi', 'extensions'));
    const bad = detectHalfSymlinkExtensions(tmp);
    if (bad.ok) {
      throw new Error('detector self-check failed: half-symlink should be rejected');
    }
    mkdirSync(join(tmp, '.pi', 'src'));
    const good = detectHalfSymlinkExtensions(tmp);
    if (!good.ok) {
      throw new Error('detector self-check failed: sibling .pi/src should pass');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  assertDetectorSelfCheck();
  console.error('[smoke] detector self-check OK');

  const layout = detectHalfSymlinkExtensions(repoRoot);
  if (!layout.ok) {
    console.error(`[smoke] LAYOUT FAIL: ${layout.reason}`);
    process.exit(1);
  }
  console.error('[smoke] layout OK (no half-symlink .pi/extensions)');

  const { errors, loadedPaths, expected } = await loadAiiaExtensionsFromRepoRoot(repoRoot);
  if (errors.length > 0) {
    console.error(`[smoke] LOAD FAIL: ${errors.length} extension error(s)`);
    console.error(JSON.stringify(errors, null, 2).slice(0, 2000));
    process.exit(1);
  }

  const missing = expected.filter((p) => !loadedPaths.includes(p));
  if (missing.length > 0) {
    console.error(
      `[smoke] LOAD FAIL: missing ${missing.length}/${expected.length} pi-agent extensions`,
    );
    console.error(missing.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }

  console.error(`[smoke] load OK: ${expected.length} pi-agent extensions (isolated agentDir)`);
  console.log('SMOKE_OK');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[smoke] unexpected error:', err);
    process.exit(1);
  });
}
