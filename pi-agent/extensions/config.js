/**
 * AIIA /config command — unified configuration hub.
 * Merges the UI of /profile and /reply.
 */
import { getAiiaHandler } from "../src/command-registry.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function configExtension(pi) {
  const configHandler = async (args, ctx) => {
    const trimmed = String(args || "").trim();
    if (!trimmed || trimmed === "help") {
      ctx?.ui?.notify?.(
        [
          "AIIA Config Hub:",
          "  /config profile ...   — Manage project intent, stack, and context cards",
          "  /config reply ...     — Manage reply language and style",
          "",
          "Shortcuts:",
          "  /config profile set intent <text>",
          "  /config reply lang zh-CN",
          "  /config reply style concise",
        ].join("\n"),
        "info"
      );
      return;
    }

    const sp = trimmed.indexOf(" ");
    const sub = sp === -1 ? trimmed.toLowerCase() : trimmed.slice(0, sp).toLowerCase();
    const rest = sp === -1 ? "" : trimmed.slice(sp + 1).trim();

    if (sub === "profile") {
      const handler = getAiiaHandler("profile");
      if (handler) return handler(rest, ctx);
    } else if (sub === "reply") {
      const handler = getAiiaHandler("reply");
      if (handler) return handler(rest, ctx);
    }

    ctx?.ui?.notify?.(`Unknown config sub-command: ${sub}. Try /config help`, "warning");
  };

  pi.registerCommand("config", {
    description: "Unified config for profile & reply | /config help",
    handler: configHandler,
  });
}
