import { test, describe, before } from "node:test";
import { enableAllExtensions } from "./with-all-extensions.js";
import assert from "node:assert/strict";
import {
  isOsEnabled,
  isBrowserEnabled,
  isDryRun,
  evaluateOsBrowserTool,
  evaluateOsBrowserToolCall,
  executeGatedTool,
  getOsBrowserStatus,
  dryRunExecute,
} from "../src/os-browser-gate.js";
import osBrowserExtension from "../extensions/os-browser.js";

describe("S4 L7.6 OS/browser gate", () => {
  before(() => {
    enableAllExtensions();
  });

  test("defaults: OS/browser disabled, dry-run true", () => {
    const env = {};
    assert.equal(isOsEnabled(env), false);
    assert.equal(isBrowserEnabled(env), false);
    assert.equal(isDryRun(env), true);
  });

  test("evaluate blocks when family disabled", () => {
    const env = {};
    const click = evaluateOsBrowserTool("os_click", { x: 1, y: 2 }, env);
    assert.equal(click.allowed, false);
    assert.match(click.reason, /OS automation disabled/);
    const br = evaluateOsBrowserTool("browser_goto", { url: "https://x" }, env);
    assert.equal(br.allowed, false);
  });

  test("tool_call hook shape blocks high-risk when disabled", () => {
    const v = evaluateOsBrowserToolCall(
      { toolName: "os_type", input: { text: "hi" } },
      {},
    );
    assert.equal(v.block, true);
    assert.match(v.reason, /L7\.6 Gate/);
  });

  test("enabled + dry-run simulates without backends", () => {
    const env = {
      AIIA_OS_ENABLED: "1",
      AIIA_BROWSER_ENABLED: "1",
      AIIA_OS_BROWSER_DRY_RUN: "1",
    };
    const shot = executeGatedTool("os_screenshot", {}, { env });
    assert.equal(shot.mode, "dry-run");
    assert.equal(shot.simulated, true);
    const click = executeGatedTool("os_click", { x: 10, y: 20 }, { env });
    assert.equal(click.ok, true);
    assert.equal(click.simulated, true);
    const open = executeGatedTool("browser_open", { url: "https://example.com" }, { env });
    assert.equal(open.simulated, true);
  });

  test("live without backend refuses honestly", () => {
    const env = {
      AIIA_OS_ENABLED: "1",
      AIIA_OS_BROWSER_FORCE_LIVE: "1",
      AIIA_OS_BROWSER_DRY_RUN: "0",
    };
    const fakeSpawn = () => ({ error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) });
    const res = executeGatedTool("os_click", { x: 1, y: 1 }, { env, spawn: fakeSpawn });
    assert.equal(res.ok, false);
    assert.match(res.reason, /ydotool not available|not implemented/i);
  });

  test("getOsBrowserStatus and dryRunExecute", () => {
    const st = getOsBrowserStatus({ AIIA_OS_ENABLED: "1" }, () => ({
      error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    }));
    assert.equal(st.osEnabled, true);
    assert.equal(st.browserEnabled, false);
    assert.equal(st.dryRun, true);
    assert.equal(dryRunExecute("os_type", { text: "x" }).simulated, true);
  });

  test("extension registers tools and default gate blocks via hook", async () => {
    const tools = {};
    let hook;
    const mockPi = {
      registerTool: (t) => {
        tools[t.name] = t;
      },
      on: (ev, fn) => {
        if (ev === "tool_call") hook = fn;
      },
    };
    osBrowserExtension(mockPi);
    assert.equal(typeof tools.os_click?.execute, "function");
    assert.equal(typeof tools.browser_goto?.execute, "function");
    assert.equal(typeof tools.get_os_browser_status?.execute, "function");

    const blocked = await hook({ toolName: "os_click", input: { x: 0, y: 0 } });
    assert.equal(blocked.block, true);

    // status tool always works
    const status = await tools.get_os_browser_status.execute({});
    assert.equal(status.details.ok, true);

    // with env enabled, execute dry-runs
    process.env.AIIA_OS_ENABLED = "1";
    process.env.AIIA_OS_BROWSER_DRY_RUN = "1";
    const res = await tools.os_screenshot.execute('t1', {});
    assert.equal(res.details.simulated, true);
    delete process.env.AIIA_OS_ENABLED;
    delete process.env.AIIA_OS_BROWSER_DRY_RUN;
  });
});
