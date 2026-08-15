/**
 * Pure helpers for the turn status footer (elapsed, cache, running tool).
 */

export const STATUS_KEY = "turn-status";
export const TICK_MS = 80;
export const TOOL_SUMMARY_MAX = 40;

export function createTurnStatusState() {
  return {
    phase: "idle",
    startedAt: 0,
    now: 0,
    tickIndex: 0,
    turnIndex: 0,
    toolName: "",
    toolSummary: "",
    toolCount: 0,
    runningTools: 0,
    usage: null,
    totals: null,
  };
}

/** Session-cumulative token totals across turns (input+output+cache). */
export function addUsageTotals(prev, usage) {
  if (!usage) return prev;
  const base = prev || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    input: base.input + usage.input,
    output: base.output + usage.output,
    cacheRead: base.cacheRead + usage.cacheRead,
    cacheWrite: base.cacheWrite + usage.cacheWrite,
  };
}

/** Compact label for a raw token count: <10 → 1 decimal, else integer; auto-carries k→M→G. */
function compactTokens(n, base, suffix) {
  const v = n / base;
  if (v < 9.95) return `${v.toFixed(1)}${suffix}`;
  const rounded = Math.round(v);
  return rounded >= 1000 ? null : `${rounded}${suffix}`;
}

/**
 * `Σ5.6k` / `Σ12k` / `Σ1.0M` / `Σ100M` / `Σ10G` — compact total-token label,
 * or null when empty. k→M→G auto-carry avoids ugly `Σ1000k` / `Σ10000M`.
 */
export function formatTotalTokens(totals) {
  const n =
    (Number(totals?.input) || 0) +
    (Number(totals?.output) || 0) +
    (Number(totals?.cacheRead) || 0) +
    (Number(totals?.cacheWrite) || 0);
  if (n <= 0) return null;
  if (n < 1000) return `Σ${n}`;
  const label =
    compactTokens(n, 1_000, "k") ||
    compactTokens(n, 1_000_000, "M") ||
    compactTokens(n, 1_000_000_000, "G");
  return `Σ${label}`;
}

export function formatDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}s`;
  if (n < 60_000) return `${Math.round(n / 1000)}s`;
  const minutes = Math.floor(n / 60_000);
  const seconds = Math.round((n % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function collapseWs(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

export function summarizeTool(toolName, args) {
  const name = String(toolName || "tool").trim() || "tool";
  const input = args && typeof args === "object" ? args : {};
  const cmd = input.command ?? input.cmd;
  if (typeof cmd === "string" && cmd.trim()) {
    const clipped = collapseWs(cmd).slice(0, TOOL_SUMMARY_MAX);
    return `${name} ${clipped}`;
  }
  const file = input.path ?? input.file ?? input.filename ?? input.target;
  if (typeof file === "string" && file.trim()) {
    const normalized = file.replace(/\\/g, "/");
    const base = normalized.split("/").pop() || file;
    return `${name} ${base}`;
  }
  return name;
}

export function extractUsage(message) {
  const raw = message?.usage || message?.message?.usage;
  if (!raw || typeof raw !== "object") return null;
  const input = Number(raw.input ?? raw.input_tokens ?? 0) || 0;
  const output = Number(raw.output ?? raw.output_tokens ?? 0) || 0;
  const cacheRead =
    Number(raw.cacheRead ?? raw.cache_read_input_tokens ?? raw.cached_tokens ?? 0) || 0;
  const cacheWrite = Number(raw.cacheWrite ?? raw.cache_creation_input_tokens ?? 0) || 0;
  if (input + output + cacheRead + cacheWrite <= 0) return null;
  return { input, output, cacheRead, cacheWrite };
}

export function cacheHitPct(usage) {
  if (!usage) return null;
  const denom = usage.input + usage.cacheRead + usage.cacheWrite;
  if (denom <= 0) return null;
  return Math.round((usage.cacheRead / denom) * 100);
}

export const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function formatTurnStatusLine(state) {
  const totalSuffix = formatTotalTokens(state?.totals);
  const suffix = totalSuffix ? ` | 消耗: ${totalSuffix}` : "";
  const phase = state?.phase || "idle";
  
  const draftPrefix = process.env.AIIA_DRAFT_MODE === '1' ? '[DRAFT] ' : '';

  if (phase === "idle") return `${draftPrefix}[Ready]${suffix}`;
  
  const spinner = BRAILLE_SPINNER[(state?.tickIndex || 0) % BRAILLE_SPINNER.length];
  const elapsed = formatDuration((Number(state.now) || 0) - (Number(state.startedAt) || 0));
  
  if (phase === "thinking" || phase === "responding") {
    return `${draftPrefix}${spinner} [${elapsed}] 正在思考...${suffix}`;
  }
  if (phase === "tool") {
    const tool = state.toolSummary || state.toolName || "tool";
    const extra = Number(state.toolCount) > 1 ? ` | 累计执行: ${state.toolCount} 个工具` : "";
    return `${draftPrefix}${spinner} [${elapsed}] 运行中: ${tool}${extra}${suffix}`;
  }
  const bits = [`✓ [${elapsed}] 完成`];
  const hit = cacheHitPct(state.usage);
  if (hit != null) bits.push(`缓存: ${hit}%`);
  const tools = Number(state.toolCount) || 0;
  if (tools > 0) bits.push(`共调用 ${tools} 次工具`);
  
  return `${draftPrefix}${bits.join(" | ")}${suffix}`;
}

export function formatWorkingMessage(state) {
  if (state?.phase !== "tool") return undefined;
  return state.toolSummary || state.toolName || "tool";
}

export function applyTurnStatusEvent(state, event, now = Date.now()) {
  const prev = state && typeof state === "object" ? state : createTurnStatusState();
  const type = event?.type;
  if (type === "session_start" || type === "session_shutdown") {
    return { ...createTurnStatusState(), now };
  }
  if (type === "turn_start" || type === "agent_start") {
    const startedAt = Number(event?.timestamp) || now;
    return {
      ...createTurnStatusState(),
      totals: prev.totals, // keep session totals across turns
      phase: "thinking",
      startedAt,
      now,
      turnIndex: Number(event?.turnIndex) || prev.turnIndex + 1,
    };
  }
  if (type === "tool_execution_start") {
    return {
      ...prev,
      now,
      phase: "tool",
      startedAt: prev.startedAt || now,
      toolName: event?.toolName || "tool",
      toolSummary: summarizeTool(event?.toolName, event?.args),
      runningTools: (Number(prev.runningTools) || 0) + 1,
      toolCount: (Number(prev.toolCount) || 0) + 1,
    };
  }
  if (type === "tool_execution_end") {
    const running = Math.max(0, (Number(prev.runningTools) || 0) - 1);
    return {
      ...prev,
      now,
      runningTools: running,
      phase: running > 0 ? "tool" : "thinking",
      toolName: running > 0 ? prev.toolName : "",
      toolSummary: running > 0 ? prev.toolSummary : "",
    };
  }
  if (type === "message_end") {
    const usage = extractUsage(event?.message);
    return {
      ...prev,
      now,
      usage: usage || prev.usage,
      totals: addUsageTotals(prev.totals, usage),
    };
  }
  if (type === "turn_end" || type === "agent_end") {
    return {
      ...prev,
      now,
      phase: prev.startedAt ? "done" : "idle",
      runningTools: 0,
      toolName: "",
      toolSummary: "",
      usage: extractUsage(event?.message) || prev.usage,
    };
  }
  return { ...prev, now };
}
