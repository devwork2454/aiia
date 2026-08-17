import http from 'node:http';

function fetchModels(baseUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl);
      // fallback if /v1/chat/completions is in url
      const modelsUrl = baseUrl.replace(/\/chat\/completions$/, '').replace(/\/$/, '') + '/models';

      http
        .get(modelsUrl, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        })
        .on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function remoteConfigExtension(pi) {
  if (!isExtensionEnabled('remote-config')) return;
  pi.on('before_agent_start', async (event, ctx) => {
    if (!ctx || !ctx.model) return;

    const baseUrl = ctx.model.baseUrl;
    if (!baseUrl || (!baseUrl.includes('http://127.0.0.1') && !baseUrl.includes('localhost'))) {
      // For safety, only auto-fetch from local proxies unless configured otherwise
      if (process.env.AIIA_REMOTE_CONFIG_ENABLED !== '1') {
        return;
      }
    }

    const modelsData = await fetchModels(baseUrl);
    if (!modelsData || !Array.isArray(modelsData.data)) return;

    // Find current model (before router rewrites it, or after depending on timing)
    const targetId = ctx.model.id;
    const remoteModel = modelsData.data.find((m) => m.id === targetId || targetId.includes(m.id));

    if (remoteModel) {
      // Silent sync — no console chatter on happy path
      if (remoteModel.context_window) {
        ctx.model.contextWindow = remoteModel.context_window;
      }
      if (remoteModel.max_tokens) {
        ctx.model.maxTokens = remoteModel.max_tokens;
      }
    }
  });
}
