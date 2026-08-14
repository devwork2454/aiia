/**
 * AIIA management helpers: repo status, pi-skill linking state, report text.
 * Pure functions (no side effects) so /aiia status|update stays testable.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Skills AIIA links into ~/.pi/agent/skills (kept in sync with scripts/link-pi-skills.sh). */
export const DEFAULT_PI_SKILLS = ["auto-harness", "goal", "imp"];

/** Repo root = two levels above pi-agent/src (src -> pi-agent -> repo root). */
export function resolveAiiDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function runGit(aiiaDir, args) {
  try {
    const out = execFileSync("git", ["-C", aiiaDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** @returns {{ branch: string|null, commit: string|null, remotes: string[], behind: boolean }} */
export function getRepoStatus(aiiaDir = resolveAiiDir()) {
  const branch = runGit(aiiaDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = runGit(aiiaDir, ["rev-parse", "--short", "HEAD"]);
  const remotesRaw = runGit(aiiaDir, ["remote"]);
  const remotes = remotesRaw ? remotesRaw.split("\n").filter(Boolean) : [];
  let behind = false;
  if (branch && branch !== "HEAD") {
    const counts = runGit(aiiaDir, ["rev-list", "--left-right", "--count", `${branch}...@{upstream}`]);
    if (counts) {
      const right = Number(counts.split(/\s+/)[1]);
      behind = Number.isFinite(right) && right > 0;
    }
  }
  return { branch, commit, remotes, behind };
}

/** @returns {{ name: string, state: "linked"|"stale"|"conflict"|"not-linked"|"missing-source" }[]} */
export function getSkillsState(aiiaDir = resolveAiiDir(), home = os.homedir()) {
  const skillsDir = path.join(home, ".pi", "agent", "skills");
  return DEFAULT_PI_SKILLS.map((name) => {
    const src = path.join(aiiaDir, ".agents", "skills", name);
    const dst = path.join(skillsDir, name);
    if (!fs.existsSync(src)) return { name, state: "missing-source" };
    if (!fs.existsSync(dst)) return { name, state: "not-linked" };
    if (fs.lstatSync(dst).isSymbolicLink()) {
      try {
        return {
          name,
          state: fs.realpathSync(dst) === fs.realpathSync(src) ? "linked" : "stale",
        };
      } catch {
        return { name, state: "stale" };
      }
    }
    return { name, state: "conflict" };
  });
}

/** @returns {string} multi-line status report for /aiia status */
export function formatStatusReport(status, skills, aiiaDir = resolveAiiDir()) {
  const up = status.behind ? "behind — run /aiia update" : "up to date";
  const lines = [
    "AIIA status:",
    `  dir:      ${aiiaDir}`,
    `  branch:   ${status.branch || "?"} @ ${status.commit || "?"}`,
    `  remotes:  ${status.remotes.length ? status.remotes.join(", ") : "none"}`,
    `  upstream: ${up}`,
    "",
    "Pi skills:",
    ...skills.map((s) => {
      const mark = s.state === "linked" ? "✔" : "✖";
      return `  ${mark} ${s.name}: ${s.state}`;
    }),
  ];
  return lines.join("\n");
}
