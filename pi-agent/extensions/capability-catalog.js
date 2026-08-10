/**
 * Inject a short tool capability catalog each turn (tool-first UX).
 * Kill switch: AIIA_CAPABILITY_CATALOG_DISABLED=1
 */
import {
  buildCapabilityCatalog,
  formatCapabilityCatalogPrompt,
  isCatalogDisabled,
} from "../src/capability-catalog.js";
import { loadMergedCard, isProfileDisabled } from "../src/context-card.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function capabilityCatalogExtension(pi) {
  pi.on("before_agent_start", async (_event, ctx) => {
    if (isCatalogDisabled()) return;
    const cwd = ctx?.cwd || process.cwd();
    const card = isProfileDisabled() ? null : loadMergedCard({ cwd });
    const catalog = buildCapabilityCatalog({ card: card || undefined });
    const block = formatCapabilityCatalogPrompt(catalog);
    if (!block) return;
    return { appendSystemPrompt: "\n\n" + block };
  });
}
