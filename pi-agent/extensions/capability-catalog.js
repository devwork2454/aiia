/**
 * Inject a short tool capability catalog each turn (tool-first UX).
 * Kill switch: AIIA_CAPABILITY_CATALOG_DISABLED=1
 */
import {
  buildCapabilityCatalog,
  formatCapabilityCatalogPrompt,
  isCatalogDisabled,
} from "../src/capability-catalog.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function capabilityCatalogExtension(pi) {
  pi.on("before_agent_start", async () => {
    if (isCatalogDisabled()) return;
    const catalog = buildCapabilityCatalog();
    const block = formatCapabilityCatalogPrompt(catalog);
    if (!block) return;
    return { appendSystemPrompt: "\n\n" + block };
  });
}
