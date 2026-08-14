/**
 * Pure helpers for compact progress bar rendering.
 * Used by extensions/compact-progress.js (and unit tests).
 */

export const BAR_WIDTH = 20;
export const TICK_MS = 120;
export const WIDGET_KEY = "compact-progress";
export const STATUS_KEY = "compact-progress";

/**
 * @param {number} pct 0–100
 * @param {number} [width]
 * @returns {string}
 */
export function renderBar(pct, width = BAR_WIDTH) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const w = Math.max(4, Math.floor(width));
  const filled = Math.round((p / 100) * w);
  return `${"█".repeat(filled)}${"░".repeat(w - filled)}`;
}

/**
 * Soft ease toward 90%, then gentle pulse while waiting on the LLM.
 * @param {number} pct
 * @param {number} nowMs
 * @returns {number}
 */
export function advancePct(pct, nowMs = Date.now()) {
  let next = Number(pct) || 0;
  if (next < 90) {
    next += Math.max(0.4, (90 - next) * 0.07);
    if (next > 90) next = 90;
  } else {
    next = 88 + Math.sin(nowMs / 420) * 2;
  }
  return next;
}

/**
 * @param {{
 *   pct: number,
 *   reason?: string,
 *   tokensBefore?: number,
 *   done?: boolean,
 *   width?: number,
 * }} opts
 * @returns {string}
 */
export function formatCompactProgressLine(opts) {
  const pct = opts.done ? 100 : Math.max(0, Math.min(100, opts.pct || 0));
  const bar = renderBar(pct, opts.width);
  const reason = opts.reason === "threshold" ? "auto" : opts.reason || "compact";
  const tok =
    typeof opts.tokensBefore === "number" && opts.tokensBefore > 0
      ? ` · ${Math.round(opts.tokensBefore).toLocaleString()} tok`
      : "";
  const label = opts.done ? "done" : reason;
  return `Compact [${bar}] ${Math.floor(pct)}%  ${label}${tok}`;
}
