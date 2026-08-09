/**
 * Slash UX: autocomplete allowlist + /aiia hub.
 * Kill switch: AIIA_SLASH_UX_DISABLED=1
 * Allowlist override: AIIA_SLASH_ALLOWLIST=goal,reply,add-dir,vault,aiia
 */
import { getAiiaHandler, listAiiaHandlers } from "../src/command-registry.js";
import {
  filterSlashAutocompleteItems,
  isSlashUxDisabled,
  parseAiiaArgs,
  resolveSlashAllowlist,
  routeAiiaSubcommand,
} from "../src/slash-visibility.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function slashUxExtension(pi) {
  pi.registerCommand("aiia", {
    description:
      "AIIA command hub | /aiia help | /aiia memory|reply|goal|add-dir|vault|sync ...",
    handler: async (args, ctx) => {
      const { subcommand, rest } = parseAiiaArgs(args);
      /** @type {Record<string, Function>} */
      const handlers = {};
      for (const name of listAiiaHandlers()) {
        const h = getAiiaHandler(name);
        if (h) handlers[name] = h;
      }
      await routeAiiaSubcommand(subcommand, rest, handlers, ctx);
    },
  });

  if (typeof pi.addAutocompleteProvider === "function") {
    pi.addAutocompleteProvider((current) => {
      const wrap = {
        triggerCharacters: current.triggerCharacters,
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          const result = await current.getSuggestions(
            lines,
            cursorLine,
            cursorCol,
            options,
          );
          if (!result || isSlashUxDisabled()) return result;

          const prefix = String(result.prefix || "");
          // Only filter top-level slash command menus (no args yet)
          if (!prefix.startsWith("/") || prefix.includes(" ")) return result;

          const allowlist = resolveSlashAllowlist();
          const items = filterSlashAutocompleteItems(result.items, allowlist);
          if (items.length === 0) return null;
          return { ...result, items };
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          return current.applyCompletion(
            lines,
            cursorLine,
            cursorCol,
            item,
            prefix,
          );
        },
      };
      if (typeof current.shouldTriggerFileCompletion === "function") {
        wrap.shouldTriggerFileCompletion = (...args) =>
          current.shouldTriggerFileCompletion(...args);
      }
      return wrap;
    });
  }
}
