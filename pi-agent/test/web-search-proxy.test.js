import { test, describe, afterEach, before } from 'node:test';
import { enableAllExtensions } from './with-all-extensions.js';
import assert from 'node:assert/strict';
import { startAgyBridgeServer } from '../src/agy-bridge.js';
import webSearchProxyExtension, {
  isSearchIntent,
  injectSearchDirective,
  shouldRewriteSearchModel,
  extractSearchIntentText,
} from '../extensions/web-search-proxy.js';

describe('Phase 2 P1: Web Search Proxy & AGY Bridge Tests', () => {
  before(() => {
    enableAllExtensions();
  });
  let server;

  afterEach(() => {
    delete process.env.SEARCH_MODEL_OVERRIDE;
    delete process.env.SEARCH_PROXY_URL;
    delete process.env.AIIA_SKIP_AGY_BRIDGE;
  });

  test('AGY Bridge Server starts and responds to /v1/models', async () => {
    server = startAgyBridgeServer(8789); // 使用测试端口 8789
    await new Promise(r => setTimeout(r, 200));

    const res = await fetch('http://127.0.0.1:8789/v1/models');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.object, 'list');
    assert.equal(Array.isArray(data.data), true);
    assert.equal(data.data[0].id, 'agy-deepmind');

    server.close();
  });

  test('isSearchIntent correctly detects search keywords', () => {
    assert.equal(isSearchIntent('请帮我搜索 2026 最新开源库'), true);
    assert.equal(isSearchIntent('使用 @web 查找相关资料'), true);
    assert.equal(isSearchIntent('排查当前系统错误'), true);
    assert.equal(isSearchIntent('请帮我写一个快速排序算法'), false);
  });

  test('injectSearchDirective correctly injects active prompt into string and array content', () => {
    const stringMessages = [{ role: 'user', content: '查询最新版本' }];
    assert.equal(injectSearchDirective(stringMessages), true);
    assert.equal(stringMessages[0].content.includes('[Web Search Active'), true);

    const arrayMessages = [{ role: 'user', content: [{ type: 'text', text: '查找最新库' }] }];
    assert.equal(injectSearchDirective(arrayMessages), true);
    assert.equal(arrayMessages[0].content[0].text.includes('[Web Search Active'), true);
  });

  test('before_provider_request hook redirects model and proxy url when search intent is present', async () => {
    let handler;
    const mockPi = {
      on: (event, fn) => { if (event === 'before_provider_request') handler = fn; }
    };

    process.env.AIIA_SKIP_AGY_BRIDGE = '1';
    webSearchProxyExtension(mockPi);
    assert.equal(typeof handler, 'function');

    const req = {
      model: 'gpt-4o',
      baseUrl: 'http://127.0.0.1:4000/v1',
      messages: [{ role: 'user', content: '搜索最新 AI 动态' }]
    };

    process.env.SEARCH_MODEL_OVERRIDE = 'custom-search-model';
    process.env.SEARCH_PROXY_URL = 'http://127.0.0.1:8080/v1';

    await handler({ req }, { model: { provider: 'local-proxy', id: 'high', baseUrl: req.baseUrl } });

    assert.equal(req.model, 'custom-search-model');
    assert.equal(req.baseUrl, 'http://127.0.0.1:8080/v1');
    assert.equal(req.messages[0].content.includes('[Web Search Active'), true);
  });

  test('shouldRewriteSearchModel is false for Charon/xAI direct providers', () => {
    const ctx = { model: { id: 'grok-4.5', provider: 'charon', baseUrl: 'https://api.x.ai/v1' } };
    const req = { model: 'grok-4.5', baseUrl: 'https://api.x.ai/v1' };
    assert.equal(shouldRewriteSearchModel(req, ctx, {}), false);
  });

  test('Charon/xAI search intent injects directive but keeps grok-4.5 model', async () => {
    let handler;
    const mockPi = {
      on: (event, fn) => { if (event === 'before_provider_request') handler = fn; }
    };
    process.env.AIIA_SKIP_AGY_BRIDGE = '1';
    webSearchProxyExtension(mockPi);

    const payload = {
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1',
      messages: [{ role: 'user', content: '搜索最新 AI 动态' }]
    };
    const ctx = { model: { id: 'grok-4.5', provider: 'charon', baseUrl: 'https://api.x.ai/v1' } };

    await handler({ payload }, ctx);

    assert.equal(payload.model, 'grok-4.5');
    assert.equal(payload.model.endsWith('-search'), false);
    assert.equal(payload.messages[0].content.includes('[Web Search Active'), true);
  });

  test('local-proxy search intent still appends -search model suffix', async () => {
    let handler;
    const mockPi = {
      on: (event, fn) => { if (event === 'before_provider_request') handler = fn; }
    };
    process.env.AIIA_SKIP_AGY_BRIDGE = '1';
    webSearchProxyExtension(mockPi);

    const payload = {
      model: 'high',
      baseUrl: 'http://127.0.0.1:4000/v1',
      messages: [{ role: 'user', content: '搜索最新 AI 动态' }]
    };
    const ctx = { model: { id: 'high', provider: 'local-proxy', baseUrl: payload.baseUrl } };

    await handler({ payload }, ctx);
    assert.equal(payload.model, 'high-search');
  });

  test('toolResult containing find does not trigger search rewrite (regression /usa)', () => {
    const messages = [
      { role: 'user', content: '/usa' },
      { role: 'assistant', content: 'checking' },
      {
        role: 'toolResult',
        content: 'drwx skills\n-rw- find-something.txt\nfind /tmp -name x',
      },
    ];
    assert.equal(extractSearchIntentText(messages), '/usa');
    assert.equal(isSearchIntent(extractSearchIntentText(messages)), false);
  });

  test('bare find in tool output must not rewrite Charon model after tool turn', async () => {
    let handler;
    const mockPi = {
      on: (event, fn) => { if (event === 'before_provider_request') handler = fn; }
    };
    process.env.AIIA_SKIP_AGY_BRIDGE = '1';
    webSearchProxyExtension(mockPi);

    const payload = {
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1',
      messages: [
        { role: 'user', content: '/usa' },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }] },
        { role: 'toolResult', content: 'ls output mentioning find and skills' },
      ],
    };
    const ctx = { model: { id: 'grok-4.5', provider: 'charon', baseUrl: 'https://api.x.ai/v1' } };
    await handler({ payload }, ctx);
    assert.equal(payload.model, 'grok-4.5');
    assert.equal(String(payload.messages[2].content).includes('[Web Search Active'), false);
  });
});
