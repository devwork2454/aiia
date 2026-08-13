import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { enableAllExtensions } from './with-all-extensions.js';
import remoteConfigExtension from '../extensions/remote-config.js';

describe('Option C: Remote Config Extension', () => {
  before(() => {
    enableAllExtensions();
  });

  test('fetches /v1/models and overrides ctx.model contextWindow', async () => {
    // 1. Setup mock server
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'test-model-400k', context_window: 400000, max_tokens: 16000 }
          ]
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    // 2. Mock Pi extension API
    let hookFn = null;
    const mockPi = {
      on: (event, fn) => {
        if (event === 'before_agent_start') {
          hookFn = fn;
        }
      }
    };

    remoteConfigExtension(mockPi);
    assert.ok(hookFn);

    // 3. Trigger hook
    const mockCtx = {
      model: {
        id: 'test-model-400k',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        contextWindow: 128000,
        maxTokens: 4096
      }
    };

    await hookFn({}, mockCtx);

    // 4. Assert changes
    assert.equal(mockCtx.model.contextWindow, 400000);
    assert.equal(mockCtx.model.maxTokens, 16000);

    // cleanup
    server.close();
  });
});
