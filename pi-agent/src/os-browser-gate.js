/**
 * L7.6 OS / browser capability gate (S4 minimum slice).
 *
 * Defaults: ALL OFF. Real ydotool / patchright execution is NOT required for verify.
 * When dry-run (default in tests) or backends missing, tools return simulated payloads.
 *
 * Env:
 *   AIIA_OS_ENABLED=1           allow OS tools (still dry-run unless backends present + dry-run off)
 *   AIIA_BROWSER_ENABLED=1      allow browser tools
 *   AIIA_OS_BROWSER_DRY_RUN=1   force simulation (default when unset in Node test; production default off)
 *   AIIA_OS_BROWSER_FORCE_LIVE=1  attempt live backends (still needs binaries)
 */
import { spawnSync } from "node:child_process";

export const OS_TOOLS = new Set(["os_screenshot", "os_click", "os_type"]);
export const BROWSER_TOOLS = new Set([
  "browser_open",
  "browser_attach",
  "browser_goto",
  "browser_click",
  "browser_type",
  "browser_screenshot",
  "browser_detach",
  "browser_close",
]);
export const HIGH_RISK_TOOLS = new Set([
  "os_click",
  "os_type",
  "browser_click",
  "browser_type",
  "browser_open",
  "browser_goto",
  "browser_close",
]);

export function isOsEnabled(env = process.env) {
  return env.AIIA_OS_ENABLED === "1" || env.AIIA_OS_ENABLED === "true";
}

export function isBrowserEnabled(env = process.env) {
  return env.AIIA_BROWSER_ENABLED === "1" || env.AIIA_BROWSER_ENABLED === "true";
}

export function isDryRun(env = process.env) {
  if (env.AIIA_OS_BROWSER_FORCE_LIVE === "1") return false;
  if (env.AIIA_OS_BROWSER_DRY_RUN === "0" || env.AIIA_OS_BROWSER_DRY_RUN === "false") return false;
  // Safe default: dry-run ON unless explicitly forced live.
  return true;
}

export function toolFamily(toolName) {
  const n = String(toolName || "");
  if (OS_TOOLS.has(n)) return "os";
  if (BROWSER_TOOLS.has(n)) return "browser";
  return null;
}

export function isHighRisk(toolName) {
  return HIGH_RISK_TOOLS.has(String(toolName || ""));
}

/**
 * @returns {{allowed:boolean, reason?:string, family?:string, dryRun?:boolean}}
 */
export function evaluateOsBrowserTool(toolName, _input = {}, env = process.env) {
  const family = toolFamily(toolName);
  if (!family) return { allowed: true };

  if (family === "os" && !isOsEnabled(env)) {
    return {
      allowed: false,
      family,
      reason: "AIIA OS automation disabled (set AIIA_OS_ENABLED=1; high-risk needs HITL/desktop)",
    };
  }
  if (family === "browser" && !isBrowserEnabled(env)) {
    return {
      allowed: false,
      family,
      reason: "AIIA browser automation disabled (set AIIA_BROWSER_ENABLED=1; desktop/HITL conditional)",
    };
  }
  return { allowed: true, family, dryRun: isDryRun(env) };
}

/** For tool_call hook: block gated tools when family disabled. */
export function evaluateOsBrowserToolCall(event, env = process.env) {
  const name = String(event?.toolName || event?.tool || event?.name || "");
  const input = event?.input ?? event?.args ?? {};
  const verdict = evaluateOsBrowserTool(name, input, env);
  if (!verdict.allowed) {
    return { block: true, reason: `[AIIA L7.6 Gate] ${verdict.reason}` };
  }
  return { block: false };
}

export function detectYdotool(spawn = spawnSync, env = process.env) {
  const bin = env.YDOTOOL_BIN || "ydotool";
  const res = spawn(bin, ["--version"], { encoding: "utf8", timeout: 2000, env });
  if (res.error || (res.status !== 0 && res.status !== null && !String(res.stdout || res.stderr || "").trim())) {
    // many builds exit non-zero on --version; treat ENOENT as missing
    if (res.error?.code === "ENOENT" || res.error) return { available: false, bin };
  }
  if (res.error?.code === "ENOENT") return { available: false, bin };
  if (res.error) return { available: false, bin };
  return { available: true, bin, detail: String(res.stdout || res.stderr || "").trim().slice(0, 120) };
}

export function detectPatchright(env = process.env) {
  // Soft detect: env override or require.resolve without hard dependency.
  if (env.PATCHRIGHT_AVAILABLE === "1") return { available: true, detail: "env" };
  try {
    // optional peer — may not be installed
    const resolved = requireResolveSafe("patchright");
    return { available: Boolean(resolved), detail: resolved || "" };
  } catch {
    return { available: false, detail: "" };
  }
}

function requireResolveSafe(mod) {
  try {
    // Use createRequire for ESM
    return null; // avoid static import; live path not needed for S4
  } catch {
    return null;
  }
}

export function getOsBrowserStatus(env = process.env, spawn = spawnSync) {
  const ydo = detectYdotool(spawn, env);
  const pr = detectPatchright(env);
  return {
    osEnabled: isOsEnabled(env),
    browserEnabled: isBrowserEnabled(env),
    dryRun: isDryRun(env),
    backends: {
      ydotool: ydo,
      patchright: pr,
    },
    note: "Real desktop/HITL backends remain conditional; default dry-run + disabled families.",
  };
}

/**
 * Simulate tool execution for verify / safe default.
 */
export function dryRunExecute(toolName, params = {}) {
  const name = String(toolName || "");
  return {
    mode: "dry-run",
    tool: name,
    ok: true,
    simulated: true,
    params: sanitizeParams(name, params),
    message: `Simulated ${name} (no ydotool/patchright side effects)`,
  };
}

function sanitizeParams(toolName, params) {
  const p = { ...(params || {}) };
  if (typeof p.text === "string" && p.text.length > 80) p.text = p.text.slice(0, 80) + "…";
  if (toolName === "os_type" || toolName === "browser_type") {
    // never echo huge secrets in logs
  }
  return p;
}

/**
 * Execute gated tool: deny / dry-run / refuse live without backend.
 */
export function executeGatedTool(toolName, params = {}, opts = {}) {
  const env = opts.env || process.env;
  const verdict = evaluateOsBrowserTool(toolName, params, env);
  if (!verdict.allowed) {
    return { ok: false, blocked: true, reason: verdict.reason, tool: toolName };
  }
  if (verdict.dryRun || isDryRun(env)) {
    return dryRunExecute(toolName, params);
  }
  // Live path intentionally minimal: refuse unless backends present (S4 does not ship full drivers).
  const status = getOsBrowserStatus(env, opts.spawn || spawnSync);
  const family = toolFamily(toolName);
  if (family === "os" && !status.backends.ydotool.available) {
    return {
      ok: false,
      blocked: true,
      reason: "ydotool not available; use dry-run or install ydotool + ydotoold (desktop conditional)",
      tool: toolName,
    };
  }
  if (family === "browser" && !status.backends.patchright.available) {
    return {
      ok: false,
      blocked: true,
      reason: "patchright not available; use dry-run or install patchright (desktop conditional)",
      tool: toolName,
    };
  }
  return {
    ok: false,
    blocked: true,
    reason: "Live L7.6 drivers not implemented in S4 minimum slice (interface + gate only)",
    tool: toolName,
  };
}
