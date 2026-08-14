/**
 * AIIA management commands: /aiia status + /aiia update.
 * status  — repo branch/commit, remotes, upstream, pi skill linking state.
 * update  — git pull latest code, re-link pi skills (conflicts keep existing).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { registerAiiaHandler } from "../src/command-registry.js";
import {
  formatStatusReport,
  getRepoStatus,
  getSkillsState,
  resolveAiiDir,
} from "../src/manager.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function manageExtension(_pi) {
  const aiiaDir = resolveAiiDir();

  const notify = (ctx, text, type = "info") => {
    ctx?.ui?.notify?.(text, type);
  };

  const statusHandler = async (_args, ctx) => {
    notify(ctx, formatStatusReport(getRepoStatus(aiiaDir), getSkillsState(aiiaDir), aiiaDir));
  };

  const updateHandler = async (_args, ctx) => {
    const branch =
      getRepoStatus(aiiaDir).branch && getRepoStatus(aiiaDir).branch !== "HEAD"
        ? getRepoStatus(aiiaDir).branch
        : "main";
    notify(ctx, `Updating AIIA from origin/${branch} …`);

    const pull = spawnSync("git", ["-C", aiiaDir, "pull", "--ff-only", "origin", branch], {
      encoding: "utf8",
      timeout: 120000,
    });
    const pullOut = `${pull.stdout || ""}${pull.stderr || ""}`.trim();
    if (pull.status !== 0) {
      notify(ctx, `✖ git pull failed:\n${pullOut}`, "warning");
      return;
    }
    notify(ctx, `✔ git pull ok:\n${pullOut}`);

    const linkScript = path.join(aiiaDir, "scripts", "link-pi-skills.sh");
    const link = spawnSync("bash", [linkScript], {
      encoding: "utf8",
      timeout: 60000,
    });
    const linkOut = `${link.stdout || ""}${link.stderr || ""}`.trim();
    notify(
      ctx,
      link.status === 0 ? `✔ pi skills linked:\n${linkOut}` : `✖ skills link failed:\n${linkOut}`,
      link.status === 0 ? "info" : "warning",
    );

    notify(
      ctx,
      "Note: if package.json changed, run `cd <AIIA_DIR>/pi-agent && npm install`. Restart pi to reload.",
    );
  };

  registerAiiaHandler("status", statusHandler);
  registerAiiaHandler("update", updateHandler);
  registerAiiaHandler("manage", statusHandler);
}
