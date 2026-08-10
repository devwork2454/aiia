/**
 * Inject merged UserCard/ProjectCard summary each turn.
 * Kill switch: AIIA_PROFILE_DISABLED=1
 */
import {
  formatContextCardPrompt,
  isProfileDisabled,
  loadMergedCard,
} from "../src/context-card.js";

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function contextCardExtension(pi) {
  pi.on("before_agent_start", async (_event, ctx) => {
    if (isProfileDisabled()) return;
    const cwd = ctx?.cwd || process.cwd();
    const card = loadMergedCard({ cwd });
    const block = formatContextCardPrompt(card);
    if (!block) return;
    return { appendSystemPrompt: "\n\n" + block };
  });
}
