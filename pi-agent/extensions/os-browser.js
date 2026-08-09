/**
 * AIIA L7.6 OS / browser extension (S4 minimum slice).
 * Registers gated tools; default OFF; dry-run simulation; no hard desktop deps.
 */
import {
  evaluateOsBrowserToolCall,
  executeGatedTool,
  getOsBrowserStatus,
  OS_TOOLS,
  BROWSER_TOOLS,
} from "../src/os-browser-gate.js";

function toolResult(payload) {
  const text =
    typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 0);
  return {
    content: [{ type: "text", text }],
    details: typeof payload === "object" ? payload : { text },
    isError: payload?.ok === false || payload?.blocked === true,
  };
}

function registerGated(pi, name, description, properties, required = []) {
  pi.registerTool({
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
    },
    async execute(params) {
      return toolResult(executeGatedTool(name, params || {}));
    },
  });
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function osBrowserExtension(pi) {
  pi.on("tool_call", async (event) => {
    const verdict = evaluateOsBrowserToolCall(event);
    if (verdict.block) {
      return { block: true, reason: verdict.reason };
    }
  });

  pi.registerTool({
    name: "get_os_browser_status",
    description: "Inspect AIIA L7.6 OS/browser gate status (enabled flags, dry-run, backends).",
    parameters: { type: "object", properties: {} },
    async execute() {
      return toolResult({ ok: true, ...getOsBrowserStatus() });
    },
  });

  registerGated(
    pi,
    "os_screenshot",
    "Capture OS screenshot (gated; default disabled; dry-run simulates).",
    {},
  );
  registerGated(
    pi,
    "os_click",
    "OS mouse click via ydotool (HIGH RISK; default disabled).",
    {
      x: { type: "number" },
      y: { type: "number" },
      button: { type: "string", description: "left|right|middle" },
      double: { type: "boolean" },
    },
    ["x", "y"],
  );
  registerGated(
    pi,
    "os_type",
    "OS keyboard type via ydotool (HIGH RISK; default disabled).",
    {
      text: { type: "string" },
      key: { type: "string" },
    },
  );

  registerGated(
    pi,
    "browser_open",
    "Open/attach fingerprint browser context (HIGH RISK; default disabled).",
    {
      account: { type: "string" },
      url: { type: "string" },
    },
  );
  registerGated(
    pi,
    "browser_attach",
    "Attach to existing browser CDP session (gated; default disabled).",
    { account: { type: "string" } },
    ["account"],
  );
  registerGated(
    pi,
    "browser_goto",
    "Navigate browser to URL (HIGH RISK; default disabled).",
    { url: { type: "string" } },
    ["url"],
  );
  registerGated(
    pi,
    "browser_click",
    "Click in browser page (HIGH RISK; default disabled).",
    {
      selector: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
    },
  );
  registerGated(
    pi,
    "browser_type",
    "Type into browser page (HIGH RISK; default disabled).",
    {
      text: { type: "string" },
      selector: { type: "string" },
    },
    ["text"],
  );
  registerGated(
    pi,
    "browser_screenshot",
    "Browser screenshot (gated; default disabled; dry-run simulates).",
    {},
  );
  registerGated(
    pi,
    "browser_detach",
    "Detach browser context keeping process warm (gated).",
    { account: { type: "string" } },
  );
  registerGated(
    pi,
    "browser_close",
    "Close browser context (HIGH RISK; default disabled).",
    { account: { type: "string" } },
  );

  // Expose sets for tests / introspection without executing.
  pi.registerTool({
    name: "list_os_browser_tools",
    description: "List registered L7.6 tool names and risk families.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return toolResult({
        ok: true,
        os: [...OS_TOOLS],
        browser: [...BROWSER_TOOLS],
      });
    },
  });
}
