import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import contextGCExtension, { _test } from "../extensions/context-gc.js";

function loadHook() {
  let hookFn;
  const mockPi = {
    on: (event, fn) => {
      if (event === "before_provider_request") hookFn = fn;
    },
  };
  contextGCExtension(mockPi);
  return hookFn;
}

function buildBloatedReq() {
  const massiveOutput = "A".repeat(50000);
  const req = {
    model: "deepseek-v4-flash-0731",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user start /home/zakza/project/aiia/README.md" },
    ],
  };
  for (let i = 0; i < 20; i++) {
    req.messages.push({
      role: "assistant",
      tool_calls: [{ id: `call_${i}`, name: "cmd", input: "test" }],
    });
    req.messages.push({
      role: "tool",
      name: "cmd",
      content: `${massiveOutput}\nError: boom status 500 at /tmp/fail.log`,
    });
  }
  return req;
}

describe("Context GC", () => {
  beforeEach(() => {
    process.env.AIIA_DISABLE_GC = "0";
    _test.clearCircuit();
    _test.setLastErrorLogAt(0);
    // Allow GC immediately in tests (no min-interval wait).
    _test.setLastGcAt(0);
  });

  test("estimateTokens grows with large tool payloads", () => {
    const n = _test.estimateTokens([
      { role: "user", content: "x".repeat(400) },
    ]);
    assert.ok(n >= 100);
  });

  test("findSafeCutoffIndex does not land inside tool_call pairs", () => {
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      { role: "assistant", tool_calls: [{ id: "1" }] },
      { role: "tool", content: "out" },
      { role: "user", content: "next" },
    ];
    const cut = _test.findSafeCutoffIndex(messages, 3);
    assert.ok(cut === 3 || cut === 1);
  });

  test("buildHeuristicSummary retains paths and errors", () => {
    const summary = _test.buildHeuristicSummary([
      { role: "user", content: "edit /home/zakza/project/aiia/foo.js" },
      { role: "tool", content: "Error: FAILED to compile status 500" },
    ]);
    assert.match(summary, /\/home\/zakza\/project\/aiia\/foo\.js/);
    assert.match(summary, /Error|FAILED|status 500/i);
  });

  test("resolveSummarizeAuth uses modelRegistry.getApiKeyAndHeaders", async () => {
    const ctx = {
      model: { id: "m1", provider: "1api", baseUrl: "https://api.example.com/v1" },
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({
          ok: true,
          apiKey: "secret-key",
          baseUrl: "https://api.example.com/v1",
        }),
      },
    };
    const auth = await _test.resolveSummarizeAuth(ctx);
    assert.equal(auth.apiKey, "secret-key");
    assert.equal(auth.modelId, "m1");
    assert.match(auth.baseUrl, /api\.example\.com/);
  });

  test("GC preserves structure and injects survivor without spam", async () => {
    const hookFn = loadHook();
    const req = buildBloatedReq();
    const originalLength = req.messages.length;

    // Auth available but fetch forced to fail → heuristic path, circuit opens once
    const ctx = {
      cwd: process.cwd(),
      model: { id: "m1", provider: "openai", baseUrl: "http://127.0.0.1:9/v1" },
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", baseUrl: "http://127.0.0.1:9/v1" }),
      },
    };

    const event = { type: "before_provider_request", payload: req };
    const returned = await hookFn(event, ctx);

    assert.ok(returned === req || returned?.messages);
    assert.ok(req.messages.length < originalLength, "GC should compress message length");
    assert.equal(req.messages[0].role, "system");
    // Survivor is folded into system prompt (not a fake assistant turn)
    assert.match(req.messages[0].content, /\[AIIA GC Survivor Memory\]/);
    assert.match(req.messages[0].content, /path|Error|Folded|intent/i);
  });

  test("circuit breaker skips repeated LLM attempts after failure", async () => {
    const hookFn = loadHook();
    let authCalls = 0;
    const ctx = {
      cwd: process.cwd(),
      model: { id: "m1", provider: "openai", baseUrl: "http://127.0.0.1:9/v1" },
      modelRegistry: {
        getApiKeyAndHeaders: async () => {
          authCalls += 1;
          return { ok: true, apiKey: "k", baseUrl: "http://127.0.0.1:9/v1" };
        },
      },
    };

    const req1 = buildBloatedReq();
    await hookFn({ payload: req1 }, ctx);
    const callsAfterFirst = authCalls;

    const req2 = buildBloatedReq();
    await hookFn({ payload: req2 }, ctx);
    // Second GC should short-circuit LLM path (no extra auth resolve while circuit open)
    // resolveSummarizeAuth is only called when circuit is closed
    assert.equal(authCalls, callsAfterFirst, "should not re-resolve auth while circuit open");
  });

  test("AIIA_DISABLE_GC=1 is a hard kill switch", async () => {
    process.env.AIIA_DISABLE_GC = "1";
    const hookFn = loadHook();
    const req = buildBloatedReq();
    const len = req.messages.length;
    await hookFn({ payload: req }, { model: { id: "x" } });
    assert.equal(req.messages.length, len);
  });

  test("source has no console.debug / happy-path console.log for GC", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, "../extensions/context-gc.js"),
      "utf8",
    );
    assert.equal(/console\.debug/.test(src), false);
    assert.equal(/console\.log\(/.test(src), false);
  });

  test("sanitizeMessages stubs old thinking and collapses planning monologues", () => {
    const monologue = Array.from({ length: 40 }, (_, i) =>
      `Let me batch greps and also check read path ${i} and look at providerFactory.`,
    ).join(" ");
    assert.ok(_test.isPlanningMonologue(monologue));

    const messages = [
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "OLD_THINKING_" + "x".repeat(800) },
          { type: "text", text: "ok" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "MID_THINKING_" + "y".repeat(800) },
          { type: "toolCall", id: "1", name: "bash", arguments: {} },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "NEW_THINKING_" + "z".repeat(100) },
          { type: "text", text: monologue },
        ],
      },
    ];

    const stats = _test.sanitizeMessages(messages);
    assert.ok(stats.thinkingStubbed >= 1);
    assert.ok(stats.monologueCollapsed >= 1);
    // Oldest thinking truncated
    assert.match(messages[1].content[0].thinking, /truncated/);
    // Newest thinking kept full
    assert.equal(messages[3].content[0].thinking.startsWith("NEW_THINKING_"), true);
    // Monologue collapsed
    assert.match(messages[3].content[1].text, /planning monologue collapsed/i);
  });

  test("hygiene runs even when AIIA_DISABLE_GC=1", async () => {
    process.env.AIIA_DISABLE_GC = "1";
    const hookFn = loadHook();
    const monologue = Array.from({ length: 40 }, (_, i) =>
      `Let me batch greps and also check read path ${i} and look at manager.`,
    ).join(" ");
    const req = {
      messages: [
        { role: "system", content: "s" },
        {
          role: "assistant",
          content: [{ type: "text", text: monologue }],
        },
      ],
    };
    await hookFn({ payload: req }, { model: { id: "x" } });
    assert.match(req.messages[1].content[0].text, /planning monologue collapsed/i);
  });

  test("min interval skips soft GC; emergency tokens still compact", async () => {
    const hookFn = loadHook();
    const ctx = {
      cwd: process.cwd(),
      model: { id: "m1", provider: "openai", baseUrl: "http://127.0.0.1:9/v1" },
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({
          ok: true,
          apiKey: "k",
          baseUrl: "http://127.0.0.1:9/v1",
        }),
      },
    };

    // First GC at soft+emergency size
    const req1 = buildBloatedReq();
    const len1 = req1.messages.length;
    await hookFn({ payload: req1 }, ctx);
    assert.ok(req1.messages.length < len1, "first GC should compact");

    // Immediately after: soft-over but within min interval → skip
    _test.setLastGcAt(Date.now());
    const req2 = buildBloatedReq();
    // shrink payload so tokens are above soft (32k) but below emergency (96k)
    // 50k chars * 4 tool msgs ≈ enough for soft; use fewer loops
    req2.messages = req2.messages.slice(0, 8); // system+user+3 pairs with 50k each ≈ high
    // Actually 3 * 50k/4 ≈ 37k tokens soft; need under 96k — fine with 8 msgs of 50k
    const len2 = req2.messages.length;
    await hookFn({ payload: req2 }, ctx);
    assert.equal(req2.messages.length, len2, "soft GC blocked by min interval");

    // Emergency: force lastGc recent but tokens huge (full bloated)
    _test.setLastGcAt(Date.now());
    const req3 = buildBloatedReq();
    const len3 = req3.messages.length;
    // 20 * 50k / 4 ≈ 250k tokens >> emergency 96k
    await hookFn({ payload: req3 }, ctx);
    assert.ok(req3.messages.length < len3, "emergency GC bypasses min interval");
  });

  test("thresholds are intentionally high (infrequent GC)", () => {
    assert.ok(_test.GC_TOKEN_THRESHOLD >= 32000);
    assert.ok(_test.GC_MSG_THRESHOLD >= 80);
    assert.ok(_test.GC_KEEP_RECENT >= 24);
    assert.ok(_test.GC_MIN_INTERVAL_MS >= 3 * 60 * 1000);
  });
});
