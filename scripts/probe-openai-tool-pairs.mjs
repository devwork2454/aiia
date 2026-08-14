#!/usr/bin/env node
/**
 * Local OpenAI Completions / Responses tool-pair probe.
 * Default: run shared fixtures (no network).
 * Optional: --session <file.jsonl> to scan a Pi session dump.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_PAIR_FIXTURES } from "../pi-agent/src/tool-pair-fixtures.js";
import {
  messagesFromSessionJsonl,
  probeCompletionsMessages,
  probeResponsesInput,
} from "../pi-agent/src/tool-pair-probe.js";
import {
  repairCompletionsMessages,
  repairResponsesInput,
} from "../pi-agent/src/tool-pair-repair.js";

function probeOf(fixture) {
  return fixture.protocol === "responses"
    ? probeResponsesInput(fixture.payload)
    : probeCompletionsMessages(fixture.payload);
}

function repairOf(fixture) {
  return fixture.protocol === "responses"
    ? repairResponsesInput(fixture.payload)
    : repairCompletionsMessages(fixture.payload);
}

function repairedList(fixture, repaired) {
  return fixture.protocol === "responses" ? repaired.input : repaired.messages;
}

function runFixtures() {
  let failed = 0;
  for (const fixture of TOOL_PAIR_FIXTURES) {
    const before = probeOf(fixture);
    if (fixture.legal) {
      const repaired = repairOf(fixture);
      if (!before.ok || repaired.dropped !== 0 || repairedList(fixture, repaired) !== fixture.payload) {
        console.error(`FAIL ${fixture.id}: legal fixture was rewritten or dirty`);
        failed += 1;
      } else {
        console.log(`PASS ${fixture.id}`);
      }
      continue;
    }
    const repaired = repairOf(fixture);
    const after = fixture.protocol === "responses"
      ? probeResponsesInput(repaired.input)
      : probeCompletionsMessages(repaired.messages);
    if (before.ok || repaired.dropped < 1 || !after.ok) {
      console.error(`FAIL ${fixture.id}: illegal fixture not cleaned`, after.violations);
      failed += 1;
    } else {
      console.log(`PASS ${fixture.id} (cleaned ${repaired.dropped})`);
    }
  }
  return failed;
}

function runSession(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const messages = messagesFromSessionJsonl(text);
  const probe = probeCompletionsMessages(messages);
  const repaired = repairCompletionsMessages(messages);
  console.log(`SESSION ${filePath} messages=${messages.length} ok=${probe.ok} violations=${probe.violations.length} repairDropped=${repaired.dropped}`);
  if (!probe.ok) {
    for (const v of probe.violations.slice(0, 20)) {
      console.log(`  ${v.code} @${v.index}${v.id ? ` id=${v.id}` : ""}`);
    }
  }
  const after = probeCompletionsMessages(repaired.messages);
  if (!after.ok) {
    console.error("SESSION still dirty after repair");
    return 1;
  }
  return 0;
}

const args = process.argv.slice(2);
let sessionPath = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session" && args[i + 1]) {
    sessionPath = args[i + 1];
    i += 1;
  }
}

let failed = runFixtures();
if (sessionPath) {
  failed += runSession(path.resolve(sessionPath));
}

const here = path.dirname(fileURLToPath(import.meta.url));
console.log(`[probe-openai-tool-pairs] fixtures=${TOOL_PAIR_FIXTURES.length} from ${here}`);
if (failed) {
  console.error(`[probe-openai-tool-pairs] FAILED ${failed}`);
  process.exit(1);
}
console.log("[probe-openai-tool-pairs] OK");
