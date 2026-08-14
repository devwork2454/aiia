/**
 * AIIA Secret Gate & Redaction Extension (Item B)
 * 1. 把可用 Secret Key 名称清单注册进 cache-safe 快照（零知识：只注入名字）。
 * 2. 在 tool_result 钩子中对工具输出脱敏（Pi 字段是 content）。
 */

import {
  formatSecretNamesPrompt,
  loadSecretPairs,
  redactToolResultEvent,
} from "../src/secret-redact.js";
import { registerSnapshotSection } from "../src/prompt-snapshot.js";

export default function secretGateExtension(pi) {
  const secretPairs = loadSecretPairs();
  const secretKeys = Object.keys(secretPairs);

  registerSnapshotSection("secret-names", () => formatSecretNamesPrompt(secretKeys));

  pi.on("tool_result", async (event) => {
    if (secretKeys.length === 0) return;
    redactToolResultEvent(event, secretPairs);
  });
}
