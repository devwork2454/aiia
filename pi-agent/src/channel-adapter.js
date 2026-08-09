/**
 * Inbound channel adapter (S5 minimum slice).
 *
 * Normalizes channel messages into a Pi-ready envelope.
 * Built-in: `cli` (ready). Feishu remains archived in legacy/; Web deferred.
 * Does NOT reintroduce a Feishu runtime.
 *
 * Env:
 *   AIIA_CHANNEL_FEISHU=1  — still returns archived (cannot enable runtime here)
 *   AIIA_CHANNEL_WEB=1     — marks web as "stub" only (no HTTP server in S5)
 */
export const CHANNEL_STATUS = {
  cli: { id: "cli", state: "ready", note: "Local CLI / Pi session (default)" },
  feishu: {
    id: "feishu",
    state: "archived",
    note: "Self-hosted Feishu adapter moved to legacy/; not reopened in A-route",
  },
  web: {
    id: "web",
    state: "deferred",
    note: "Web channel deferred; enable later as thin webhook → normalizeInbound",
  },
};

export function listChannels(env = process.env) {
  const channels = {
    cli: { ...CHANNEL_STATUS.cli },
    feishu: { ...CHANNEL_STATUS.feishu },
    web: { ...CHANNEL_STATUS.web },
  };
  // Explicit env cannot resurrect Feishu runtime in this slice — keep honest.
  if (env.AIIA_CHANNEL_FEISHU === "1") {
    channels.feishu = {
      ...channels.feishu,
      state: "archived",
      note: "AIIA_CHANNEL_FEISHU ignored: Feishu runtime stays archived (S5 honesty)",
    };
  }
  if (env.AIIA_CHANNEL_WEB === "1") {
    channels.web = {
      ...channels.web,
      state: "stub",
      note: "Web flag on: normalizeInbound accepts channel=web; no HTTP listener in S5",
    };
  }
  return channels;
}

/**
 * @param {{channel?:string, text?:string, content?:string, userId?:string, messageId?:string, meta?:object}} raw
 * @returns {{ok:boolean, envelope?:object, error?:string}}
 */
export function normalizeInbound(raw = {}, env = process.env) {
  const channel = String(raw.channel || "cli").toLowerCase();
  const channels = listChannels(env);
  const info = channels[channel];
  if (!info) {
    return { ok: false, error: `unknown channel: ${channel}` };
  }
  if (info.state === "archived") {
    return {
      ok: false,
      error: `channel ${channel} is archived (see legacy/); not available in A-route`,
    };
  }
  if (info.state === "deferred") {
    return {
      ok: false,
      error: `channel ${channel} is deferred; set AIIA_CHANNEL_WEB=1 for stub normalize only`,
    };
  }
  // ready | stub
  const text = String(raw.text ?? raw.content ?? "").trim();
  if (!text) {
    return { ok: false, error: "empty message text" };
  }
  return {
    ok: true,
    envelope: {
      channel,
      role: "user",
      content: text,
      userId: raw.userId ? String(raw.userId) : undefined,
      messageId: raw.messageId ? String(raw.messageId) : undefined,
      meta: { ...(raw.meta || {}), channelState: info.state },
      receivedAt: Date.now(),
    },
  };
}

/** Reject accidental Feishu runtime imports from pi-agent path (documentation helper). */
export function assertNoFeishuRuntime(modulePaths = []) {
  const bad = modulePaths.filter((p) => /feishu|lark/i.test(String(p)) && !/legacy\//i.test(String(p)));
  return { ok: bad.length === 0, bad };
}
