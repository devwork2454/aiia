/**
 * AIIA management commands: /aiia status + /aiia update.
 * status  — repo branch/commit, remotes, upstream, pi skill linking state.
 * update  — git pull latest code, re-link pi skills (conflicts keep existing).
 * Feedback: toast first line + persistent chat message + .agent/aiia-update.log
 */
import { registerAiiaHandler } from "../src/command-registry.js";
import {
  formatStatusReport,
  getRepoStatus,
  getSkillsState,
  resolveAiiDir,
  runAiiUpdate,
  writeManageLog,
} from "../src/manager.js";

const MANAGE_TYPE = "aiia-manage";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function manageExtension(pi) {
  const aiiaDir = resolveAiiDir();

  function deliver(ctx, text, type = "info") {
    const body = String(text || "").trim();
    let logPath = "";
    try {
      logPath = writeManageLog(body, aiiaDir);
    } catch {
      // still try UI even if disk write fails
    }
    const shown = logPath ? `${body}\n  log: ${logPath}` : body;
    try {
      ctx?.ui?.notify?.(shown.split("\n")[0], type);
    } catch {
      // toast is best-effort
    }
    try {
      pi.sendMessage?.({
        customType: MANAGE_TYPE,
        content: shown,
        display: true,
      });
    } catch {
      // session message is best-effort
    }
  }

  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer(MANAGE_TYPE, (msg, _options, theme) => {
      const lines = String(msg.content || "").split("\n");
      return {
        render: (width) =>
          lines.map((line) => (theme?.fg ? theme.fg("muted", line) : line).slice(0, width)),
      };
    });
  }

  const statusHandler = async (_args, ctx) => {
    deliver(ctx, formatStatusReport(getRepoStatus(aiiaDir), getSkillsState(aiiaDir), aiiaDir));
  };

  const updateHandler = async (_args, ctx) => {
    try {
      ctx?.ui?.notify?.("Updating AIIA…", "info");
    } catch {
      // ignore
    }
    try {
      const result = runAiiUpdate(aiiaDir);
      deliver(ctx, result.report, result.pullOk && result.linkOk ? "info" : "warning");
    } catch (err) {
      deliver(ctx, `AIIA update crashed: ${err?.message || err}`, "error");
    }
  };

  registerAiiaHandler("status", statusHandler);
  registerAiiaHandler("update", updateHandler);
  registerAiiaHandler("manage", statusHandler);
}
