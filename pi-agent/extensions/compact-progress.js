/**
 * AIIA Compact Progress Bar
 * Shows an animated progress bar while /compact (or auto-compaction) runs.
 *
 * Pi already shows a spinner ("Compacting context…"); this adds a visible
 * percentage bar via footer status + above-editor widget.
 */

import {
  advancePct,
  formatCompactProgressLine,
  STATUS_KEY,
  TICK_MS,
  WIDGET_KEY,
} from '../src/compact-progress.js';

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function compactProgressExtension(pi) {
  if (!isExtensionEnabled('compact-progress')) return;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let pct = 0;
  /** @type {string | undefined} */
  let reason;
  /** @type {number | undefined} */
  let tokensBefore;
  /** @type {any} */
  let activeCtx;
  /** @type {(() => void) | null} */
  let abortUnsub = null;

  function clearUi(ctx) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (abortUnsub) {
      abortUnsub();
      abortUnsub = null;
    }
    const ui = ctx?.ui || activeCtx?.ui;
    try {
      ui?.setWidget?.(WIDGET_KEY, undefined);
      ui?.setStatus?.(STATUS_KEY, undefined);
    } catch {
      // UI may already be torn down.
    }
    activeCtx = undefined;
    pct = 0;
    reason = undefined;
    tokensBefore = undefined;
  }

  function paint(ctx, done = false) {
    const ui = ctx?.ui;
    if (!ui) return;
    const line = formatCompactProgressLine({
      pct,
      reason,
      tokensBefore,
      done,
    });
    try {
      ui.setStatus?.(STATUS_KEY, line);
      ui.setWidget?.(WIDGET_KEY, [line], { placement: 'aboveEditor' });
    } catch {
      // ignore
    }
  }

  function start(ctx, event) {
    clearUi(ctx);
    activeCtx = ctx;
    pct = 6;
    reason = event?.reason || 'manual';
    tokensBefore = event?.preparation?.tokensBefore;
    paint(ctx, false);

    timer = setInterval(() => {
      pct = advancePct(pct);
      paint(activeCtx || ctx, false);
    }, TICK_MS);

    const signal = event?.signal;
    if (signal && typeof signal.addEventListener === 'function') {
      const onAbort = () => clearUi(ctx);
      signal.addEventListener('abort', onAbort, { once: true });
      abortUnsub = () => {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch {
          // ignore
        }
      };
    }
  }

  function finish(ctx) {
    if (!timer && pct === 0) return;
    pct = 100;
    const snap = ctx || activeCtx;
    paint(snap, true);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Brief 100% flash then clear
    setTimeout(() => clearUi(snap), 450);
  }

  pi.on('session_before_compact', async (event, ctx) => {
    if (process.env.AIIA_DISABLE_COMPACT_PROGRESS === '1') return;
    if (!ctx?.ui) return;
    start(ctx, event);
    // Do not return compaction result — leave default Pi compact to run.
  });

  pi.on('session_compact', (_event, ctx) => {
    if (process.env.AIIA_DISABLE_COMPACT_PROGRESS === '1') return;
    finish(ctx);
  });

  pi.on('session_shutdown', (_event, ctx) => {
    clearUi(ctx);
  });
}
