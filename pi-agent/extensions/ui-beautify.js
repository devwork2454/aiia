import boxen from 'boxen';
import { highlight } from 'cli-highlight';
import { isExtensionEnabled } from "../src/extension-profile.js";

/**
 * AIIA Output Beautifier
 * Introduces rounded borders (card layout) and Markdown syntax highlighting 
 * for assistant messages.
 */
export default function uiBeautifyExtension(pi) {
  if (!isExtensionEnabled("ui-beautify")) return;

  // Attempt to hook into standard text or markdown renderer
  if (typeof pi.registerMessageRenderer === "function") {
    const renderCard = (msg) => {
      const content = msg.content || "";
      if (msg.role !== "assistant" || msg.customType) return undefined;
      
      return {
        render: (width) => {
          try {
            // 1. Syntax Highlight
            const highlighted = highlight(content, { language: 'markdown', ignoreIllegals: true });
            
            // 2. Card Layout (Rounded Borders)
            const boxed = boxen(highlighted, {
              width: width ? Math.max(width - 2, 10) : undefined,
              padding: { top: 0, bottom: 0, left: 1, right: 1 },
              borderStyle: 'round',
              borderColor: 'cyan', // Geek aesthetic accent
              dimBorder: true
            });
            return boxed.split('\n');
          } catch (e) {
            return content.split('\n');
          }
        }
      };
    };
    pi.registerMessageRenderer("text", renderCard);
    pi.registerMessageRenderer("markdown", renderCard);
    pi.registerMessageRenderer("assistant", renderCard);
  }
}
