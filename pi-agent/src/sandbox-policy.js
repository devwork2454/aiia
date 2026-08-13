/**
 * AIIA MCP / Skill Security Sandbox Policy Engine (Phase 2 P7)
 * Shell rules delegate to policy.js; path checks use real path fields (not JSON substring).
 */
import os from 'node:os';
import path from 'node:path';
import { evaluateToolCallEvent } from './policy.js';

const SHELL_TOOLS = new Set(['bash', 'shell', 'run_shell_command']);
const PATH_TOOLS = new Set(['write', 'edit', 'read', 'read_file', 'write_to_file']);
const DENIED_PATHS = ['/etc/passwd', '/etc/shadow', '/root/.ssh', path.join(os.homedir(), '.ssh')];

export function isPermissiveAllowed(env = process.env) {
  return env.SANDBOX_ALLOW_PERMISSIVE === '1' || env.SANDBOX_ALLOW_PERMISSIVE === 'true';
}

export function normalizeSandboxMode(mode, env = process.env) {
  const m = String(mode || 'sandbox');
  if (m === 'permissive' && !isPermissiveAllowed(env)) {
    throw new Error('permissive sandbox mode is disabled; set SANDBOX_ALLOW_PERMISSIVE=1 to allow');
  }
  if (!['sandbox', 'strict', 'permissive'].includes(m)) {
    throw new Error(`Invalid sandbox mode '${m}'. Allowed: sandbox | strict`);
  }
  return m;
}

function expandHome(p) {
  const s = String(p || '');
  if (s === '~') return os.homedir();
  if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
  return s;
}

export function extractInputPaths(input = {}) {
  const raw = [input.path, input.file, input.filename, input.target].filter(
    (v) => typeof v === 'string' && v.trim(),
  );
  return raw.map((v) => expandHome(v.trim()));
}

export function pathIsDenied(candidate, blockedPaths) {
  const resolved = path.resolve(expandHome(candidate));
  for (const b of blockedPaths) {
    const br = path.resolve(expandHome(b));
    if (resolved === br || resolved.startsWith(`${br}${path.sep}`)) return b;
  }
  return null;
}

export class SandboxPolicy {
  /**
   * @param {{ mode?: 'strict' | 'permissive' | 'sandbox', allowedTools?: string[], blockedPaths?: string[], env?: NodeJS.ProcessEnv }} opts
   */
  constructor({ mode = 'sandbox', allowedTools = [], blockedPaths = [], env = process.env } = {}) {
    this.mode = normalizeSandboxMode(mode, env);
    this.allowedTools = new Set(allowedTools);
    this.blockedPaths = [...DENIED_PATHS, ...blockedPaths];
  }

  /**
   * @param {string} toolName
   * @param {object} input
   * @returns {{ allowed: boolean, reason?: string, family?: 'shell' | 'path' | 'strict' }}
   */
  evaluate(toolName, input = {}) {
    if (this.mode === 'permissive') {
      return { allowed: true };
    }

    const name = String(toolName || '');

    if (this.mode === 'strict' && this.allowedTools.size > 0) {
      if (!this.allowedTools.has(name)) {
        return { allowed: false, family: 'strict', reason: `Tool '${name}' is not in strict whitelist.` };
      }
    }

    if (SHELL_TOOLS.has(name.toLowerCase())) {
      const verdict = evaluateToolCallEvent({ toolName: name, input });
      if (verdict.block) {
        return { allowed: false, family: 'shell', reason: verdict.reason };
      }
    }

    if (PATH_TOOLS.has(name.toLowerCase()) || extractInputPaths(input).length > 0) {
      for (const p of extractInputPaths(input)) {
        const hit = pathIsDenied(p, this.blockedPaths);
        if (hit) {
          return { allowed: false, family: 'path', reason: `Access to restricted path '${hit}' blocked by Sandbox Policy.` };
        }
      }
    }

    return { allowed: true };
  }
}
