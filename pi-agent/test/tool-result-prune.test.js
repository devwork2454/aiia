import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_HEAD_CHARS,
  DEFAULT_MAX_CHARS,
  DEFAULT_TAIL_CHARS,
  SPILL_MARKER,
  applyToolResultPrune,
  contentToText,
  formatPrunedPreview,
  isPruneDisabled,
  rebuildContent,
  resolvePruneLimits,
  sanitizeSpillText,
  shouldPrune,
  spillFileName,
  writeSpillFile,
} from "../src/tool-result-prune.js";
import toolResultPruneExtension from "../extensions/tool-result-prune.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aiia-spill-"));
}

describe("tool-result-prune helpers", () => {
  it("resolvePruneLimits uses defaults and clamps head+tail", () => {
    assert.deepEqual(resolvePruneLimits({}), {
      maxChars: DEFAULT_MAX_CHARS,
      headChars: DEFAULT_HEAD_CHARS,
      tailChars: DEFAULT_TAIL_CHARS,
    });
    const clamped = resolvePruneLimits({
      AIIA_TOOL_RESULT_MAX_CHARS: "100",
      AIIA_TOOL_RESULT_HEAD_CHARS: "90",
      AIIA_TOOL_RESULT_TAIL_CHARS: "90",
    });
    assert.equal(clamped.maxChars, 100);
    assert.ok(clamped.headChars + clamped.tailChars <= 100);
  });

  it("shouldPrune skips short, already-spilled, and head+tail-or-smaller text", () => {
    const limits = { maxChars: 20, headChars: 8, tailChars: 4 };
    assert.equal(shouldPrune("short", limits), false);
    assert.equal(shouldPrune(`head ${SPILL_MARKER} tail`, limits), false);
    assert.equal(shouldPrune("x".repeat(21), limits), true);
  });

  it("formatPrunedPreview keeps head and tail with omitted count", () => {
    const text = `${"H".repeat(10)}${"M".repeat(20)}${"T".repeat(6)}`;
    const preview = formatPrunedPreview(text, ".agent/spill/x.txt", {
      headChars: 10,
      tailChars: 6,
    });
    assert.ok(preview.startsWith("H".repeat(10)));
    assert.ok(preview.endsWith("T".repeat(6)));
    assert.match(preview, /omitted 20 chars → \.agent\/spill\/x\.txt/);
  });

  it("contentToText joins string and text parts; rebuildContent keeps images", () => {
    assert.equal(contentToText("plain"), "plain");
    assert.equal(
      contentToText([
        { type: "text", text: "a" },
        { type: "image", data: "xx" },
        { type: "text", text: "b" },
      ]),
      "a\nb",
    );
    const rebuilt = rebuildContent(
      [
        { type: "text", text: "old" },
        { type: "image", data: "img" },
      ],
      "preview",
    );
    assert.equal(rebuilt[0].text, "preview");
    assert.equal(rebuilt[1].type, "image");
  });

  it("sanitizeSpillText redacts patterns and secret pairs", () => {
    const out = sanitizeSpillText("key=sk-abcdefghijklmnopqrstuv and leak-secret-value-9999", {
      MY_KEY: "leak-secret-value-9999",
    });
    assert.doesNotMatch(out, /sk-abcdefghijklmnopqrstuv/);
    assert.doesNotMatch(out, /leak-secret-value-9999/);
    assert.match(out, /REDACTED/);
  });

  it("spillFileName sanitizes ids", () => {
    const name = spillFileName({
      toolCallId: "call/1 with spaces",
      toolName: "bash",
      now: Date.parse("2026-08-14T12:30:45.000Z"),
    });
    assert.match(name, /^20260814T123045Z-bash-call_1_with_spaces\.txt$/);
  });

  it("writeSpillFile creates 0600 file under .agent/spill", () => {
    const cwd = tmpDir();
    const { abs, rel } = writeSpillFile({
      cwd,
      text: "hello",
      toolName: "bash",
      toolCallId: "c1",
      now: Date.parse("2026-08-14T12:30:45.000Z"),
      secretPairs: {},
    });
    assert.equal(rel, ".agent/spill/20260814T123045Z-bash-c1.txt");
    assert.equal(fs.readFileSync(abs, "utf8"), "hello");
    assert.equal(fs.statSync(abs).mode & 0o777, 0o600);
  });
});

describe("applyToolResultPrune", () => {
  it("returns null for short content", () => {
    const patch = applyToolResultPrune(
      { content: [{ type: "text", text: "ok" }], toolName: "bash" },
      { cwd: tmpDir(), env: {}, secretPairs: {} },
    );
    assert.equal(patch, null);
  });

  it("prunes long content and writes locator + spill file", () => {
    const cwd = tmpDir();
    const body = `${"A".repeat(30)}${"B".repeat(40)}${"C".repeat(10)}`;
    const event = {
      toolName: "bash",
      toolCallId: "call1",
      content: [{ type: "text", text: body }],
    };
    const patch = applyToolResultPrune(event, {
      cwd,
      now: Date.parse("2026-08-14T12:30:45.000Z"),
      env: {
        AIIA_TOOL_RESULT_MAX_CHARS: "20",
        AIIA_TOOL_RESULT_HEAD_CHARS: "8",
        AIIA_TOOL_RESULT_TAIL_CHARS: "4",
      },
      secretPairs: {},
    });
    assert.ok(patch?.content);
    const preview = patch.content[0].text;
    assert.ok(preview.startsWith("A".repeat(8)));
    assert.ok(preview.endsWith("C".repeat(4)));
    assert.match(preview, /omitted 68 chars → \.agent\/spill\//);
    const files = fs.readdirSync(path.join(cwd, ".agent", "spill"));
    assert.equal(files.length, 1);
    const spilled = fs.readFileSync(path.join(cwd, ".agent", "spill", files[0]), "utf8");
    assert.equal(spilled, body);
  });

  it("is idempotent when spill marker already present", () => {
    const text = `head ${SPILL_MARKER}: omitted 9 chars → .agent/spill/x.txt]\ntail`;
    const patch = applyToolResultPrune(
      { content: [{ type: "text", text }], toolName: "bash" },
      {
        cwd: tmpDir(),
        env: { AIIA_TOOL_RESULT_MAX_CHARS: "5" },
        secretPairs: {},
      },
    );
    assert.equal(patch, null);
  });

  it("kill switch skips prune", () => {
    assert.equal(isPruneDisabled({ AIIA_TOOL_RESULT_PRUNE_DISABLED: "1" }), true);
    const patch = applyToolResultPrune(
      { content: [{ type: "text", text: "x".repeat(100) }] },
      {
        cwd: tmpDir(),
        env: {
          AIIA_TOOL_RESULT_PRUNE_DISABLED: "1",
          AIIA_TOOL_RESULT_MAX_CHARS: "10",
        },
        secretPairs: {},
      },
    );
    assert.equal(patch, null);
  });
});

describe("tool-result-prune extension", () => {
  before(() => {
    delete process.env.AIIA_TOOL_RESULT_PRUNE_DISABLED;
    delete process.env.AIIA_EXTENSIONS;
  });

  it("registers tool_result and returns a content patch", async () => {
    const hooks = {};
    toolResultPruneExtension({
      on(event, fn) {
        hooks[event] = fn;
      },
    });
    assert.equal(typeof hooks.tool_result, "function");
    const cwd = tmpDir();
    const result = await hooks.tool_result(
      {
        type: "tool_result",
        toolName: "bash",
        toolCallId: "e1",
        content: [{ type: "text", text: "z".repeat(9000) }],
      },
      { cwd },
    );
    assert.ok(result?.content?.[0]?.text.includes(SPILL_MARKER));
    assert.ok(fs.existsSync(path.join(cwd, ".agent", "spill")));
  });

  it("disabled env still registers but returns no patch", async () => {
    const hooks = {};
    toolResultPruneExtension({
      on(event, fn) {
        hooks[event] = fn;
      },
    });
    const prev = process.env.AIIA_TOOL_RESULT_PRUNE_DISABLED;
    process.env.AIIA_TOOL_RESULT_PRUNE_DISABLED = "1";
    try {
      const result = await hooks.tool_result(
        {
          type: "tool_result",
          toolName: "bash",
          content: [{ type: "text", text: "z".repeat(9000) }],
        },
        { cwd: tmpDir() },
      );
      assert.equal(result, null);
    } finally {
      if (prev === undefined) delete process.env.AIIA_TOOL_RESULT_PRUNE_DISABLED;
      else process.env.AIIA_TOOL_RESULT_PRUNE_DISABLED = prev;
    }
  });
});
