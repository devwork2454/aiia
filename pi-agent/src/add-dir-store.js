/**
 * Session additional directories (Pi analogue of Claude Code /add-dir).
 * Tracks extra workspace roots, persists under <cwd>/.agent/additional-dirs.json,
 * and contributes skill discovery paths.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const STORE_REL = join('.agent', 'additional-dirs.json');

/** Paths that must never be added as workspace roots. */
const BLOCKED_ROOTS = new Set([
  '/',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
]);

export function storePathForCwd(cwd = process.cwd()) {
  return resolve(cwd, STORE_REL);
}

export function resolveDirPath(raw, cwd = process.cwd()) {
  const input = String(raw || '').trim();
  if (!input) return null;
  const expanded = input.startsWith('~/')
    ? join(process.env.HOME || '', input.slice(2))
    : input === '~'
      ? process.env.HOME || ''
      : input;
  const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * @returns {{ok:true, path:string}|{ok:false, error:string}}
 */
export function validateDirectory(absPath) {
  if (!absPath) return { ok: false, error: 'empty path' };
  if (BLOCKED_ROOTS.has(absPath)) {
    return { ok: false, error: `refusing blocked root: ${absPath}` };
  }
  if (!existsSync(absPath)) {
    return { ok: false, error: `not found: ${absPath}` };
  }
  let st;
  try {
    st = statSync(absPath);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!st.isDirectory()) {
    return { ok: false, error: `not a directory: ${absPath}` };
  }
  return { ok: true, path: absPath };
}

export function loadDirs(cwd = process.cwd()) {
  const file = storePathForCwd(cwd);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(raw?.dirs) ? raw.dirs : Array.isArray(raw) ? raw : [];
    return [...new Set(list.map((d) => String(d)).filter(Boolean))];
  } catch {
    return [];
  }
}

export function saveDirs(dirs, cwd = process.cwd()) {
  const file = storePathForCwd(cwd);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const uniq = [...new Set((dirs || []).map((d) => String(d)).filter(Boolean))];
  writeFileSync(file, JSON.stringify({ dirs: uniq, updatedAt: Date.now() }, null, 2) + '\n');
  return uniq;
}

/**
 * @returns {{ok:boolean, path?:string, dirs?:string[], error?:string, added?:boolean}}
 */
export function addDirectory(rawPath, cwd = process.cwd()) {
  const resolved = resolveDirPath(rawPath, cwd);
  const v = validateDirectory(resolved);
  if (!v.ok) return { ok: false, error: v.error };
  const dirs = loadDirs(cwd);
  if (dirs.includes(v.path)) {
    return { ok: true, path: v.path, dirs, added: false };
  }
  dirs.push(v.path);
  return { ok: true, path: v.path, dirs: saveDirs(dirs, cwd), added: true };
}

export function removeDirectory(rawPath, cwd = process.cwd()) {
  const resolved = resolveDirPath(rawPath, cwd);
  const dirs = loadDirs(cwd);
  const next = dirs.filter((d) => d !== resolved && resolveDirPath(d, cwd) !== resolved);
  if (next.length === dirs.length) {
    return { ok: false, error: `not in list: ${resolved}`, dirs };
  }
  return { ok: true, path: resolved, dirs: saveDirs(next, cwd) };
}

export function listDirectories(cwd = process.cwd()) {
  return loadDirs(cwd);
}

/** Candidate skill roots under an added directory. */
export function skillRootsForDir(dirPath) {
  const candidates = [
    join(dirPath, '.agents', 'skills'),
    join(dirPath, '.pi', 'agent', 'skills'),
    join(dirPath, 'skills'),
  ];
  return candidates.filter((p) => {
    try {
      return existsSync(p) && statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

export function collectSkillPaths(dirs = []) {
  const out = [];
  for (const d of dirs) {
    out.push(...skillRootsForDir(d));
  }
  return [...new Set(out)];
}

/** Compact prompt block for before_agent_start / context. */
export function formatAdditionalDirsPrompt(dirs, primaryCwd) {
  if (!dirs?.length) return '';
  const lines = dirs.map((d, i) => `${i + 1}. ${d}`);
  return [
    '[AIIA additional directories — /add-dir]',
    `Primary cwd: ${primaryCwd}`,
    'You may read/edit/search these directories in this session (same tools; prefer absolute paths):',
    ...lines,
    'Use absolute paths when operating outside primary cwd. Do not assume files are auto-loaded; read as needed.',
  ].join('\n');
}

/**
 * Parse `/add-dir` args.
 * @returns {{action:'add'|'rm'|'list'|'help', path?:string}}
 */
export function parseAddDirArgs(args = '') {
  const parts = String(args || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { action: 'list' };
  const head = parts[0].toLowerCase();
  if (head === 'list' || head === 'ls' || head === '--list') return { action: 'list' };
  if (head === 'help' || head === '-h' || head === '--help') return { action: 'help' };
  if (head === 'rm' || head === 'remove' || head === '--rm' || head === '-r') {
    return { action: 'rm', path: parts.slice(1).join(' ') };
  }
  if (head === 'add' || head === '--add') {
    return { action: 'add', path: parts.slice(1).join(' ') };
  }
  return { action: 'add', path: parts.join(' ') };
}
