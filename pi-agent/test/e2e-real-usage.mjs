/**
 * Real usage E2E verification for AGY Bridge & Web Search Proxy
 */
import { startAgyBridgeServer } from '../src/agy-bridge.js';
import webSearchProxyExtension from '../extensions/web-search-proxy.js';
import assert from 'node:assert/strict';

process.env.AIIA_EXTENSIONS = process.env.AIIA_EXTENSIONS || 'all';

console.log('[E2E Test] 1. Starting AGY Bridge Server on port 8790...');
const server = startAgyBridgeServer(8790);

await new Promise(r => setTimeout(r, 300));

console.log('[E2E Test] 2. Sending GET /v1/models...');
const modelsRes = await fetch('http://127.0.0.1:8790/v1/models');
assert.equal(modelsRes.status, 200);
const modelsData = await modelsRes.json();
console.log('[E2E Test] Models response OK:', modelsData.data.map(m => m.id).join(', '));

console.log('[E2E Test] 3. Testing Web Search Proxy Extension hook dispatch...');
let registeredHandler = null;
const mockPi = {
  on: (event, handler) => {
    if (event === 'before_provider_request') registeredHandler = handler;
  }
};

webSearchProxyExtension(mockPi);
assert.equal(typeof registeredHandler, 'function');

const eventPayload = {
  req: {
    model: 'gpt-4o',
    baseUrl: 'http://127.0.0.1:4000/v1',
    messages: [
      { role: 'user', content: '请帮我搜索 2026 年开源 AI Agent 框架最新进展' }
    ]
  }
};

process.env.SEARCH_MODEL_OVERRIDE = 'high-search';
process.env.SEARCH_PROXY_URL = 'http://127.0.0.1:8790/v1';

await registeredHandler(eventPayload);

console.log('[E2E Test] Modified req model:', eventPayload.req.model);
console.log('[E2E Test] Modified req baseUrl:', eventPayload.req.baseUrl);
console.log('[E2E Test] Modified prompt:', eventPayload.req.messages[0].content.split('\n')[0]);

assert.equal(eventPayload.req.model, 'high-search');
assert.equal(eventPayload.req.baseUrl, 'http://127.0.0.1:8790/v1');
assert.equal(eventPayload.req.messages[0].content.includes('[Web Search Active'), true);

delete process.env.SEARCH_MODEL_OVERRIDE;
delete process.env.SEARCH_PROXY_URL;

server.close();
console.log('[E2E Test] SUCCESS: All real usage E2E assertions passed cleanly!');
