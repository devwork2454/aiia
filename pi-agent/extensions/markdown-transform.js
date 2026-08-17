/**
 * AIIA Markdown Transform
 * Renders GitHub-style callouts (> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]) in
 * Pi's TUI. Pi already renders Markdown; this only enhances callout blocks
 * that pi-tui otherwise shows as raw text. Kill: AIIA_MARKDOWN_TRANSFORM_DISABLED=1
 */

import { isExtensionEnabled } from '../src/extension-profile.js';
import { createMarkdownTransformer } from '../src/markdown-transform.js';

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function markdownTransformExtension(pi) {
  if (!isExtensionEnabled('markdown-transform')) return;
  pi.registerMarkdownTransformer(createMarkdownTransformer());
}
