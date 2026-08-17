/**
 * Register the tool capability catalog as a cache-safe snapshot section.
 * Kill switch: AIIA_CAPABILITY_CATALOG_DISABLED=1
 */
import {
  buildCapabilityCatalog,
  formatCapabilityCatalogPrompt,
  isCatalogDisabled,
} from '../src/capability-catalog.js';
import { loadMergedCard, isProfileDisabled } from '../src/context-card.js';
import { registerSnapshotSection } from '../src/prompt-snapshot.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function capabilityCatalogExtension(pi) {
  registerSnapshotSection('catalog', ({ cwd, env }) => {
    if (isCatalogDisabled(env)) return '';
    const card = isProfileDisabled(env) ? null : loadMergedCard({ cwd, env });
    const catalog = buildCapabilityCatalog({ card: card || undefined, env });
    return formatCapabilityCatalogPrompt(catalog);
  });
}
