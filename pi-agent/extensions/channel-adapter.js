/**
 * AIIA channel adapter extension (S5 minimum slice).
 * Exposes channel status + inbound normalization. No Feishu runtime.
 */
import { listChannels, normalizeInbound } from '../src/channel-adapter.js';

function toolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    details: payload,
    isError: isError || payload?.ok === false,
  };
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function channelAdapterExtension(pi) {
  if (!isExtensionEnabled('channel-adapter')) return;
  pi.registerTool({
    name: 'list_channels',
    description:
      'List AIIA inbound channels and their state (cli ready; feishu archived; web deferred/stub).',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return toolResult({ ok: true, channels: listChannels() });
    },
  });

  pi.registerTool({
    name: 'normalize_channel_message',
    description:
      'Normalize an inbound channel message into a Pi-ready envelope. Feishu archived; web needs stub flag.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'cli | feishu | web' },
        text: { type: 'string' },
        userId: { type: 'string' },
        messageId: { type: 'string' },
      },
      required: ['text'],
    },
    async execute(_id, params) {
      const res = normalizeInbound({
        channel: params?.channel || 'cli',
        text: params?.text,
        userId: params?.userId,
        messageId: params?.messageId,
      });
      return toolResult(res, !res.ok);
    },
  });
}
