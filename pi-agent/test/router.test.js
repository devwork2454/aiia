import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateModelRoute,
  shouldRewriteModel,
  resolveRoutedPayload,
} from '../extensions/router.js';

describe('Phase 2 P3: Dynamic Model Router Evaluator Tests', () => {
  test('Routes short simple query to low cost model', () => {
    const payload = {
      messages: [{ role: 'user', content: '你好，请问今天天气怎么样？' }],
    };
    assert.equal(evaluateModelRoute(payload), 'low');
  });

  test('Routes medium length query to medium cost model', () => {
    const mediumText = 'A'.repeat(600);
    const payload = {
      messages: [{ role: 'user', content: mediumText }],
    };
    assert.equal(evaluateModelRoute(payload), 'medium');
  });

  test('Routes complex keywords or long context to high model', () => {
    const complexPayload = {
      messages: [{ role: 'user', content: '请帮我重构整个系统架构并排查死锁问题' }],
    };
    assert.equal(evaluateModelRoute(complexPayload), 'high');

    const longPayload = {
      messages: [{ role: 'user', content: 'X'.repeat(4500) }],
    };
    assert.equal(evaluateModelRoute(longPayload), 'high');
  });

  test('Routes vision / multimodal input to high model', () => {
    const visionPayload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '分析图片' },
            { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
          ],
        },
      ],
    };
    assert.equal(evaluateModelRoute(visionPayload), 'high');
  });

  test('Routes formal reasoning keywords to reasoning model', () => {
    const reasoningPayload = {
      messages: [
        { role: 'user', content: '请对该系统定理进行 formal verification 与深度推导证明' },
      ],
    };
    assert.equal(evaluateModelRoute(reasoningPayload), 'reasoning');
  });

  test('Environment variable ROUTER_FORCE_MODEL overrides evaluation', () => {
    const payload = {
      messages: [{ role: 'user', content: '简单文本' }],
    };
    const env = { ROUTER_FORCE_MODEL: 'custom-locked-model' };
    assert.equal(evaluateModelRoute(payload, env), 'custom-locked-model');
  });
});

describe('Router rewrite gate (direct providers vs local proxy)', () => {
  test('Does not rewrite Charon/xAI direct provider models like grok-4.5', () => {
    const ctx = {
      model: {
        id: 'grok-4.5',
        provider: 'charon',
        baseUrl: 'https://api.x.ai/v1',
      },
    };
    assert.equal(shouldRewriteModel(ctx, {}), false);

    const payload = { model: 'grok-4.5', messages: [{ role: 'user', content: 'hi' }] };
    assert.equal(resolveRoutedPayload(payload, ctx, {}), undefined);
  });

  test('Does not rewrite DeepSeek direct models', () => {
    const ctx = {
      model: {
        id: 'deepseek-v4-pro',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
      },
    };
    assert.equal(shouldRewriteModel(ctx, {}), false);
  });

  test('Rewrites local-proxy tier models', () => {
    const ctx = {
      model: {
        id: 'high',
        provider: 'local-proxy',
        baseUrl: 'http://127.0.0.1:4000/v1',
      },
    };
    assert.equal(shouldRewriteModel(ctx, {}), true);

    const payload = {
      model: 'high',
      messages: [{ role: 'user', content: '你好' }],
    };
    const routed = resolveRoutedPayload(payload, ctx, {});
    assert.equal(routed.model, 'low');
  });

  test('ROUTER_FORCE_MODEL still rewrites even on direct providers', () => {
    const ctx = {
      model: {
        id: 'grok-4.5',
        provider: 'charon',
        baseUrl: 'https://api.x.ai/v1',
      },
    };
    const env = { ROUTER_FORCE_MODEL: 'grok-4.5' };
    assert.equal(shouldRewriteModel(ctx, env), true);
    const payload = { model: 'something-else', messages: [{ role: 'user', content: 'x' }] };
    assert.equal(resolveRoutedPayload(payload, ctx, env).model, 'grok-4.5');
  });

  test('ROUTER_ENABLED=true forces rewrite; false disables even for local-proxy', () => {
    const localCtx = {
      model: { id: 'high', provider: 'local-proxy', baseUrl: 'http://127.0.0.1:4000/v1' },
    };
    const charonCtx = {
      model: { id: 'grok-4.5', provider: 'charon', baseUrl: 'https://api.x.ai/v1' },
    };
    assert.equal(shouldRewriteModel(charonCtx, { ROUTER_ENABLED: 'true' }), true);
    assert.equal(shouldRewriteModel(localCtx, { ROUTER_ENABLED: 'false' }), false);
  });
});
