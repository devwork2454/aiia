import { test, describe, before } from "node:test";
import { enableAllExtensions } from "./with-all-extensions.js";
import assert from "node:assert/strict";
import {
  listChannels,
  normalizeInbound,
  assertNoFeishuRuntime,
} from "../src/channel-adapter.js";
import channelAdapterExtension from "../extensions/channel-adapter.js";

describe("S5 channel adapter", () => {
  before(() => {
    enableAllExtensions();
  });

  test("listChannels marks cli ready, feishu archived, web deferred", () => {
    const ch = listChannels({});
    assert.equal(ch.cli.state, "ready");
    assert.equal(ch.feishu.state, "archived");
    assert.equal(ch.web.state, "deferred");
  });

  test("normalizeInbound cli success", () => {
    const res = normalizeInbound({ channel: "cli", text: "hello", userId: "u1" }, {});
    assert.equal(res.ok, true);
    assert.equal(res.envelope.role, "user");
    assert.equal(res.envelope.content, "hello");
    assert.equal(res.envelope.channel, "cli");
  });

  test("normalizeInbound rejects feishu archived even if env set", () => {
    const res = normalizeInbound(
      { channel: "feishu", text: "hi" },
      { AIIA_CHANNEL_FEISHU: "1" },
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /archived/);
    const listed = listChannels({ AIIA_CHANNEL_FEISHU: "1" });
    assert.equal(listed.feishu.state, "archived");
  });

  test("web deferred until stub flag", () => {
    const denied = normalizeInbound({ channel: "web", text: "x" }, {});
    assert.equal(denied.ok, false);
    const ok = normalizeInbound(
      { channel: "web", text: "x" },
      { AIIA_CHANNEL_WEB: "1" },
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.envelope.meta.channelState, "stub");
  });

  test("assertNoFeishuRuntime flags pi-agent paths", () => {
    const a = assertNoFeishuRuntime([
      "pi-agent/extensions/channel-adapter.js",
      "legacy/adapter/feishu.py",
    ]);
    assert.equal(a.ok, true);
    const b = assertNoFeishuRuntime(["pi-agent/extensions/feishu.js"]);
    assert.equal(b.ok, false);
  });

  test("extension registers list_channels and normalize tools", async () => {
    const tools = {};
    const mockPi = {
      registerTool: (t) => {
        tools[t.name] = t;
      },
    };
    channelAdapterExtension(mockPi);
    const list = await tools.list_channels.execute({});
    assert.equal(list.details.channels.cli.state, "ready");
    assert.equal(list.details.channels.feishu.state, "archived");
    const norm = await tools.normalize_channel_message.execute("t1", {
      channel: "cli",
      text: "ping",
    });
    assert.equal(norm.details.ok, true);
    const bad = await tools.normalize_channel_message.execute("t2", {
      channel: "feishu",
      text: "ping",
    });
    assert.equal(bad.isError, true);
  });
});
