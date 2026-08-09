import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startAgyBridgeServer } from '../src/agy-bridge.js';

describe('Phase 2 P0: Web Search Proxy & AGY Bridge Tests', () => {
  let server;

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

  test('Search keyword detection in prompt works correctly', () => {
    const SEARCH_KEYWORDS = ['@web', '搜索', '最新', '实时'];
    const prompt1 = '请帮我搜索 2026 最新开源库';
    const prompt2 = '请帮我写一个快速排序算法';

    const hasSearch1 = SEARCH_KEYWORDS.some(kw => prompt1.includes(kw));
    const hasSearch2 = SEARCH_KEYWORDS.some(kw => prompt2.includes(kw));

    assert.equal(hasSearch1, true);
    assert.equal(hasSearch2, false);
  });
});
