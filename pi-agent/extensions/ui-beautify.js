import boxen from 'boxen';
import { highlight } from 'cli-highlight';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { isExtensionEnabled } from '../src/extension-profile.js';

/**
 * AIIA Output Beautifier
 * Introduces rounded borders (card layout) and Markdown syntax highlighting
 * for assistant messages.
 */
export default function uiBeautifyExtension(pi) {
  if (!isExtensionEnabled('ui-beautify')) return;

  // Attempt to hook into standard text or markdown renderer
  if (typeof pi.registerMessageRenderer === 'function') {
    const renderCard = (msg) => {
      const content = msg.content || '';
      if (msg.role !== 'assistant' || msg.customType) return undefined;

      // Prevent heavy regex and syntax highlighting during streaming
      const isStreaming =
        msg.status === 'in_progress' || msg.status === 'streaming' || msg.final === false;
      if (isStreaming) {
        return undefined; // Fall back to fast default renderer during stream
      }

      return {
        render: (width) => {
          try {
            // 1. Fold <details> blocks to prevent screen flooding
            const processedContent = content.replace(
              /<details[^>]*>[\s\S]*?<summary[^>]*>(.*?)<\/summary>([\s\S]*?)<\/details>/gi,
              (_match, summary, body) => {
                const linesCount = body.trim().split('\n').length;
                return `\n▶ **${summary.trim()}** _(已折叠 ${linesCount} 行详情...)_\n`;
              },
            );

            // 2. Syntax Highlight
            const highlighted = highlight(processedContent, {
              language: 'markdown',
              ignoreIllegals: true,
            });

            // 3. Hard-truncate every line to the terminal width — long code lines /
            //    URLs must never crash the TUI renderer (Rendered line exceeds width).
            return highlighted.split('\n').map((line) => truncateToWidth(line, width));
          } catch (e) {
            return content.split('\n').map((line) => truncateToWidth(line, width));
          }
        },
      };
    };
    pi.registerMessageRenderer('text', renderCard);
    pi.registerMessageRenderer('markdown', renderCard);
    pi.registerMessageRenderer('assistant', renderCard);
  }
}
