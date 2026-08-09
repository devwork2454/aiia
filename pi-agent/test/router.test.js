import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModelRoute } from '../extensions/router.js';

describe('Phase 2 P3: Dynamic Model Router Evaluator Tests', () => {
  test('Routes short simple query to low cost model', () => {
    const payload = {
      messages: [{ role: 'user', content: '你好，请问今天天气怎么样？' }]
    };
    assert.equal(evaluateModelRoute(payload), 'low');
  });

  test('Routes medium length query to medium cost model', () => {
    const mediumText = 'A'.repeat(600);
    const payload = {
      messages: [{ role: 'user', content: mediumText }]
    };
    assert.equal(evaluateModelRoute(payload), 'medium');
  });

  test('Routes complex keywords or long context to high model', () => {
    const complexPayload = {
      messages: [{ role: 'user', content: '请帮我重构整个系统架构并排查死锁问题' }]
    };
    assert.equal(evaluateModelRoute(complexPayload), 'high');

    const longPayload = {
      messages: [{ role: 'user', content: 'X'.repeat(4500) }]
    };
    assert.equal(evaluateModelRoute(longPayload), 'high');
  });

  test('Routes vision / multimodal input to high model', () => {
    const visionPayload = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '分析图片' },
          { type: 'image_url', image_url: { url: 'http://example.com/img.png' } }
        ]
      }]
    };
    assert.equal(evaluateModelRoute(visionPayload), 'high');
  });

  test('Routes formal reasoning keywords to reasoning model', () => {
    const reasoningPayload = {
      messages: [{ role: 'user', content: '请对该系统定理进行 formal verification 与深度推导证明' }]
    };
    assert.equal(evaluateModelRoute(reasoningPayload), 'reasoning');
  });

  test('Environment variable ROUTER_FORCE_MODEL overrides evaluation', () => {
    const payload = {
      messages: [{ role: 'user', content: '简单文本' }]
    };
    const env = { ROUTER_FORCE_MODEL: 'custom-locked-model' };
    assert.equal(evaluateModelRoute(payload, env), 'custom-locked-model');
  });
});
