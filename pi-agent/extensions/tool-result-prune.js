/**
 * AIIA Tool Result Prune
 * Model-free head+tail truncation for oversized tool_result text.
 * Overflow is written to .agent/spill/ (0600) with a locator in the preview.
 * Kill: AIIA_TOOL_RESULT_PRUNE_DISABLED=1
 */

import { isExtensionEnabled } from "../src/extension-profile.js";
import { applyToolResultPrune } from "../src/tool-result-prune.js";

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function toolResultPruneExtension(pi) {
  if (!isExtensionEnabled("tool-result-prune")) return;

  pi.on("tool_result", async (event, ctx) => {
    return applyToolResultPrune(event, {
      cwd: ctx?.cwd || process.cwd(),
      env: process.env,
    });
  });
}
