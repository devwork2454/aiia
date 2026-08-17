/**
 * AIIA Project Router — 项目列表 + 项目路由表
 * 扫描 PROJECTS_ROOT（默认 ~/project）下所有项目目录，提取描述/技术栈/git 远端，
 * 生成紧凑路由表注入 prompt snapshot，供语音/文本任务自动路由到正确项目目录。
 * Env: AIIA_PROJECTS_ROOT（项目根，默认 ~/project）, AIIA_PROJECT_ROUTER_DISABLED=1
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROJECTS_ROOT = join(homedir(), 'project');
export const MAX_ROUTING_CHARS = 3500;

/** @typedef {{ name: string, path: string, desc: string, stack: string[], git: string }} Project */

function firstLine(file) {
  try {
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim().replace(/^#+\s*/, '');
      if (t.length >= 4 && !t.startsWith('[') && !t.startsWith('<')) return t.slice(0, 90);
    }
  } catch {
    /* ignore */
  }
  return '';
}

function readJsonField(pkgPath, field) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const v = pkg[field];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

function readTomlDescription(pyPath) {
  try {
    const raw = readFileSync(pyPath, 'utf8');
    const m = raw.match(/^description\s*=\s*"([^"]+)"/m);
    return m ? m[1].slice(0, 90) : '';
  } catch {
    return '';
  }
}

function readProjectDesc(dir) {
  const desc =
    readJsonField(join(dir, 'package.json'), 'description') ||
    readTomlDescription(join(dir, 'pyproject.toml')) ||
    firstLine(join(dir, 'README.md')) ||
    firstLine(join(dir, 'README.MD')) ||
    '';
  return desc.trim();
}

function readProjectStack(dir) {
  const stack = new Set();
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const key of Object.keys(pkg.dependencies || {}).slice(0, 4))
      stack.add(key.split('/').pop());
  } catch {
    /* ignore */
  }
  if (existsSync(join(dir, 'pyproject.toml'))) stack.add('python');
  if (existsSync(join(dir, 'requirements.txt'))) stack.add('python');
  if (existsSync(join(dir, 'Cargo.toml'))) stack.add('rust');
  return [...stack].slice(0, 4);
}

function readGitRemote(dir) {
  try {
    if (!existsSync(join(dir, '.git'))) return '';
    const out = execSync('git remote get-url origin', {
      cwd: dir,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  } catch {
    return '';
  }
}

/** 扫描项目根目录，返回项目元数据数组（跳过隐藏目录） */
export function scanProjects({ root = PROJECTS_ROOT } = {}) {
  let names = [];
  try {
    names = readdirSync(root).filter(
      (n) => !n.startsWith('.') && statSync(join(root, n)).isDirectory(),
    );
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const path = join(root, name);
      return {
        name,
        path,
        desc: readProjectDesc(path),
        stack: readProjectStack(path),
        git: readGitRemote(path),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isProjectRouterDisabled(env = process.env) {
  const v = env.AIIA_PROJECT_ROUTER_DISABLED;
  return v === '1' || v === 'true';
}

/** 生成紧凑路由表文本 */
export function buildProjectRoutingTable({ root = PROJECTS_ROOT, env = process.env } = {}) {
  const projects = scanProjects({ root });
  if (projects.length === 0) return '';

  const lines = [`项目根: ${root}（共 ${projects.length} 个）`];
  for (const p of projects) {
    const meta = [
      p.stack.length ? `[${p.stack.join(',')}]` : '',
      p.git ? `git:${p.git}` : '',
      p.desc ? `· ${p.desc}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`- ${p.name} → ${p.path} ${meta}`.trim());
  }
  return lines.join('\n');
}

/** 注入格式：路由表 + 路由指令 */
export function formatProjectRoutingPrompt(table) {
  if (!table) return '';
  return `[AIIA 项目路由表]\n${table}\n\n【路由规则】任务涉及上述项目时，先 cd 到对应项目目录再执行；模糊任务按描述/关键词匹配最相关项目，不确定时用 ls/搜索确认。`;
}

export function buildProjectRoutingSnapshot({ root = PROJECTS_ROOT, env = process.env } = {}) {
  if (isProjectRouterDisabled(env)) return '';
  const table = buildProjectRoutingTable({ root, env });
  if (!table) return '';
  let body = formatProjectRoutingPrompt(table);
  if (body.length > MAX_ROUTING_CHARS) {
    body = `${body.slice(0, MAX_ROUTING_CHARS - 1).trimEnd()}…`;
  }
  return body;
}
