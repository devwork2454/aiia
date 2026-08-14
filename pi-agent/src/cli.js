#!/usr/bin/env node
import {
  formatStatusReport,
  getRepoStatus,
  getSkillsState,
  resolveAiiDir,
  runAiiUpdate,
} from "./manager.js";

const cmd = process.argv[2];
const aiiaDir = resolveAiiDir();

if (cmd === "status") {
  const report = formatStatusReport(
    getRepoStatus(aiiaDir),
    getSkillsState(aiiaDir),
    aiiaDir
  );
  console.log(report);
} else if (cmd === "update") {
  console.log("Updating AIIA…");
  const result = runAiiUpdate(aiiaDir);
  console.log(result.report);
} else {
  console.error(`AIIA CLI Error: Unknown command '${cmd}'`);
  console.error("Available commands: update, status");
  process.exit(1);
}
