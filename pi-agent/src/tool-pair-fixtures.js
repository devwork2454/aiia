/**
 * Shared Completions / Responses tool-pair fixtures for probe + repair.
 * legal:true fixtures must stay byte-identical after repair (same array ref).
 */

export const TOOL_PAIR_FIXTURES = [
  {
    id: "cmp.legal.text-only",
    protocol: "completions",
    legal: true,
    payload: [{ role: "system", content: "s" }, { role: "user", content: "hi" }],
  },
  {
    id: "cmp.legal.one-pair",
    protocol: "completions",
    legal: true,
    payload: [
      { role: "user", content: "hi" },
      { role: "assistant", tool_calls: [{ id: "c1", type: "function" }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ],
  },
  {
    id: "cmp.legal.two-tools",
    protocol: "completions",
    legal: true,
    payload: [
      { role: "assistant", tool_calls: [{ id: "a" }, { id: "b" }] },
      { role: "tool", tool_call_id: "a", content: "A" },
      { role: "tool", tool_call_id: "b", content: "B" },
    ],
  },
  {
    id: "cmp.legal.two-pairs",
    protocol: "completions",
    legal: true,
    payload: [
      { role: "assistant", tool_calls: [{ id: "a" }] },
      { role: "tool", tool_call_id: "a", content: "A" },
      { role: "assistant", content: "next", tool_calls: [{ id: "b" }] },
      { role: "tool", tool_call_id: "b", content: "B" },
      { role: "user", content: "go" },
    ],
  },
  {
    id: "cmp.legal.pi-native",
    protocol: "completions",
    legal: true,
    payload: [
      { role: "assistant", content: [{ type: "toolCall", id: "fc1", name: "bash" }] },
      { role: "toolResult", toolCallId: "fc1", content: "ls" },
    ],
  },
  {
    id: "cmp.legal.function-role",
    protocol: "completions",
    legal: true,
    payload: [
      { role: "assistant", tool_calls: [{ id: "fn1" }] },
      { role: "function", id: "fn1", content: "legacy" },
    ],
  },
  {
    id: "cmp.legal.thinking-parts",
    protocol: "completions",
    legal: true,
    payload: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "toolCall", id: "t1", name: "read" },
        ],
      },
      { role: "tool", tool_call_id: "t1", content: "file" },
    ],
  },
  {
    id: "cmp.illegal.lone-tool",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "orphan", content: "left" },
    ],
  },
  {
    id: "cmp.illegal.tool-after-user",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "assistant", tool_calls: [{ id: "a" }] },
      { role: "user", content: "injected" },
      { role: "tool", tool_call_id: "a", content: "late" },
    ],
  },
  {
    id: "cmp.illegal.leftover-sibling",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "system", content: "s" },
      { role: "tool", tool_call_id: "b", content: "second only" },
      { role: "user", content: "next" },
    ],
  },
  {
    id: "cmp.illegal.wrong-id",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "assistant", tool_calls: [{ id: "a" }] },
      { role: "tool", tool_call_id: "zzz", content: "nope" },
    ],
  },
  {
    id: "cmp.illegal.duplicate-tool",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "assistant", tool_calls: [{ id: "a" }] },
      { role: "tool", tool_call_id: "a", content: "one" },
      { role: "tool", tool_call_id: "a", content: "two" },
    ],
  },
  {
    id: "cmp.illegal.missing-id",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "assistant", tool_calls: [{ id: "a" }] },
      { role: "tool", content: "no id" },
    ],
  },
  {
    id: "cmp.illegal.abort-leftover",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "user", content: "run" },
      { role: "tool", tool_call_id: "aborted", content: "result after drop" },
    ],
  },
  {
    id: "cmp.illegal.gc-tail",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "system", content: "[AIIA GC Survivor Memory]\nfolded" },
      { role: "tool", tool_call_id: "left", content: "orphan after fold" },
      { role: "user", content: "continue" },
    ],
  },
  {
    id: "cmp.illegal.unmatched-call",
    protocol: "completions",
    legal: false,
    payload: [
      { role: "assistant", content: "calling", tool_calls: [{ id: "a" }, { id: "b" }] },
      { role: "tool", tool_call_id: "a", content: "only a" },
    ],
  },
  {
    id: "rsp.legal.function-pair",
    protocol: "responses",
    legal: true,
    payload: [
      { type: "message", role: "user", content: "hi" },
      { type: "function_call", call_id: "fc_1", name: "bash", arguments: "{}" },
      { type: "function_call_output", call_id: "fc_1", output: "ok" },
    ],
  },
  {
    id: "rsp.legal.custom-pair",
    protocol: "responses",
    legal: true,
    payload: [
      { type: "custom_tool_call", call_id: "ctc_1", name: "grammar", input: "x" },
      { type: "custom_tool_call_output", call_id: "ctc_1", output: "y" },
    ],
  },
  {
    id: "rsp.legal.two-calls",
    protocol: "responses",
    legal: true,
    payload: [
      { type: "function_call", call_id: "fc_a", name: "a", arguments: "{}" },
      { type: "function_call_output", call_id: "fc_a", output: "A" },
      { type: "function_call", call_id: "fc_b", name: "b", arguments: "{}" },
      { type: "function_call_output", call_id: "fc_b", output: "B" },
    ],
  },
  {
    id: "rsp.illegal.output-first",
    protocol: "responses",
    legal: false,
    payload: [
      { type: "function_call_output", call_id: "fc_1", output: "early" },
      { type: "function_call", call_id: "fc_1", name: "bash", arguments: "{}" },
    ],
  },
  {
    id: "rsp.illegal.orphan-output",
    protocol: "responses",
    legal: false,
    payload: [
      { type: "message", role: "user", content: "hi" },
      { type: "function_call_output", call_id: "fc_orphan", output: "x" },
    ],
  },
  {
    id: "rsp.illegal.wrong-id",
    protocol: "responses",
    legal: false,
    payload: [
      { type: "function_call", call_id: "fc_1", name: "bash", arguments: "{}" },
      { type: "function_call_output", call_id: "fc_other", output: "x" },
    ],
  },
  {
    id: "rsp.illegal.custom-output-no-call",
    protocol: "responses",
    legal: false,
    payload: [{ type: "custom_tool_call_output", call_id: "ctc_x", output: "z" }],
  },
  {
    id: "rsp.illegal.duplicate-output",
    protocol: "responses",
    legal: false,
    payload: [
      { type: "function_call", call_id: "fc_1", name: "bash", arguments: "{}" },
      { type: "function_call_output", call_id: "fc_1", output: "one" },
      { type: "function_call_output", call_id: "fc_1", output: "two" },
    ],
  },
];

export function fixturesByProtocol(protocol) {
  return TOOL_PAIR_FIXTURES.filter((f) => f.protocol === protocol);
}
