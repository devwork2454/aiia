import { truncateToWidth } from '@earendil-works/pi-tui';
import { isExtensionEnabled } from '../src/extension-profile.js';

/**
 * AIIA Tool Inline Renderer
 * Intercepts toolCall and toolResult to render them as lightweight,
 * Antigravity CLI-style inline indented text instead of bulky Boxes.
 * Limits tool output preview to 5 lines.
 */
export default function uiToolInlineExtension(pi) {
  if (typeof pi.registerMessageRenderer !== 'function') return;

  const renderToolCall = (msg, options, theme) => {
    return {
      render: (width) => {
        const title = msg.name || 'Tool';
        const prefix = theme.fg('yellow', `● ${title}`);
        let args = '';
        try {
          if (msg.details && typeof msg.details === 'object') {
            args = JSON.stringify(msg.details);
            if (args.length > 50) args = args.slice(0, 47) + '...';
          }
        } catch (e) {
          console.debug('[ui-tool-inline] JSON stringify ignored:', e.message);
        }
        const text = `${prefix}${theme.fg('dim', `(${args})`)}`;
        return [truncateToWidth(text, width, theme.fg('dim', '...'))];
      },
    };
  };

  const renderToolResult = (msg, options, theme) => {
    return {
      render: (width) => {
        if (!msg.content) return [];
        const lines = msg.content.split('\n');
        if (lines.length === 0) return [];
        const header = theme.fg('dim', `▸ Output (${lines.length} lines)`);
        const out = [header];
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
          out.push(truncateToWidth(theme.fg('dim', `  ${lines[i]}`), width));
        }
        if (lines.length > 5) {
          out.push(theme.fg('dim', `  ... (${lines.length - 5} more lines)`));
        }
        return out;
      },
    };
  };

  pi.registerMessageRenderer('toolCall', renderToolCall);
  pi.registerMessageRenderer('toolResult', renderToolResult);
}
