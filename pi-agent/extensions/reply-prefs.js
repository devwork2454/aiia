/**
 * AIIA global reply language + style.
 * Commands: /reply, /reply lang <...>, /reply style <...>, /reply on|off|reset
 * Injects via the cache-safe context snapshot.
 */
import {
  STYLE_PRESETS,
  loadPrefs,
  saveGlobalPrefs,
  resetGlobalPrefs,
  formatReplyPrefsPrompt,
  parseReplyArgs,
  formatStatus,
  globalPrefsPath,
  projectPrefsPath,
} from "../src/reply-prefs.js";
import { registerAiiaHandler } from "../src/command-registry.js";
import { registerSnapshotSection } from "../src/prompt-snapshot.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function replyPrefsExtension(pi) {
  const replyHandler = async (args, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    const parsed = parseReplyArgs(args);

    if (parsed.action === "help") {
      ctx?.ui?.notify?.(
        [
          "Usage:",
          "  /reply                         show settings",
          "  /reply lang zh-CN|en|<lang>    set reply language (global)",
          `  /reply style <${Object.keys(STYLE_PRESETS).join("|")}>`,
          "  /reply style custom:<text>     custom style",
          "  /reply on|off                  enable/disable injection",
          "  /reply reset                   clear global prefs",
        ].join("\n"),
        "info",
      );
      return;
    }

    if (parsed.action === "error") {
      ctx?.ui?.notify?.(parsed.error, "warning");
      return;
    }

    if (parsed.action === "reset") {
      const prefs = resetGlobalPrefs();
      ctx?.ui?.notify?.(formatStatus(prefs, {
        globalPath: globalPrefsPath(),
        projectPath: projectPrefsPath(cwd),
      }), "info");
      return;
    }

    if (parsed.action === "enable") {
      const prefs = saveGlobalPrefs({ enabled: parsed.value === "1" });
      ctx?.ui?.notify?.(
        prefs.enabled ? "Reply prefs injection ON" : "Reply prefs injection OFF",
        "info",
      );
      return;
    }

    if (parsed.action === "lang") {
      const prefs = saveGlobalPrefs({ language: parsed.value });
      ctx?.ui?.notify?.(`Reply language → ${prefs.language}`, "info");
      return;
    }

    if (parsed.action === "style") {
      const prefs = saveGlobalPrefs({ style: parsed.value });
      ctx?.ui?.notify?.(`Reply style → ${prefs.style}`, "info");
      return;
    }

    // show
    const prefs = loadPrefs({ cwd });
    ctx?.ui?.notify?.(
      formatStatus(prefs, {
        globalPath: globalPrefsPath(),
        projectPath: projectPrefsPath(cwd),
      }),
      "info",
    );
  };

  pi.registerCommand("reply", {
    description:
      "Global reply language/style | /reply | /reply lang zh-CN | /reply style concise | /reply on|off|reset",
    handler: replyHandler,
  });
  registerAiiaHandler("reply", replyHandler);

  registerSnapshotSection("reply", ({ cwd, env }) => {
    return formatReplyPrefsPrompt(loadPrefs({ cwd, env }));
  });
}
