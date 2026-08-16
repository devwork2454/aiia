import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractImageData,
  describeImageWithGemini,
  buildVisionFallbackMessages,
  getGeminiKey,
} from '../extensions/vision-fallback.js';

const DATA_URL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('extractImageData', () => {
  test('parses OpenAI image_url data URL', () => {
    const r = extractImageData({ type: 'image_url', image_url: { url: DATA_URL_PNG } });
    assert.equal(r.base64.length > 0, true);
    assert.equal(r.mime, 'image/png');
  });

  test('parses remote image_url URL', () => {
    const r = extractImageData({ type: 'image_url', image_url: { url: 'https://x.com/a.png' } });
    assert.equal(r.url, 'https://x.com/a.png');
  });

  test('parses Anthropic style image source base64', () => {
    const r = extractImageData({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA=' },
    });
    assert.equal(r.base64, 'AAA=');
    assert.equal(r.mime, 'image/jpeg');
  });

  test('returns null for unsupported blocks', () => {
    assert.equal(extractImageData({ type: 'text', text: 'hi' }), null);
    assert.equal(extractImageData(null), null);
    assert.equal(extractImageData({ type: 'image_url', image_url: { url: 'not-a-url' } }), null);
  });
});

describe('getGeminiKey', () => {
  test('extracts first bare key', () => {
    assert.equal(getGeminiKey({ GEMINI_API_KEYS: 'aaa,bbb' }), 'aaa');
  });

  test('skips URL gateway entries', () => {
    assert.equal(
      getGeminiKey({ GEMINI_API_KEYS: 'https://gw.example.com/v1,real-key' }),
      'real-key',
    );
  });

  test('returns null when empty', () => {
    assert.equal(getGeminiKey({}), null);
  });
});

describe('describeImageWithGemini', () => {
  test('calls Gemini REST API and returns description', async () => {
    let calledUrl = '';
    const fakeFetch = async (url, init) => {
      // 远程图片下载分支
      if (url === 'https://x.com/img.png') {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from('QUJD', 'base64'),
        };
      }
      // Gemini generateContent 分支
      calledUrl = url;
      const body = JSON.parse(init.body);
      assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'image/png');
      assert.equal(body.contents[0].parts[1].inline_data.data, 'QUJD'); // base64 of remote img
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from('QUJD', 'base64'),
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '一张红色图片' }] } }],
        }),
      };
    };
    const r = await describeImageWithGemini(
      { type: 'image_url', image_url: { url: 'https://x.com/img.png' } },
      { apiKey: 'test-key', fetchImpl: fakeFetch },
    );
    assert.equal(r, '一张红色图片');
    assert.match(calledUrl, /gemini-2\.5-flash:generateContent/);
  });

  test('returns null when provider errors', async () => {
    const fakeFetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
    const r = await describeImageWithGemini(
      { type: 'image_url', image_url: { url: DATA_URL_PNG } },
      { apiKey: 'test-key', fetchImpl: fakeFetch },
    );
    assert.equal(r, null);
  });

  test('returns null without apiKey', async () => {
    const r = await describeImageWithGemini(
      { type: 'image_url', image_url: { url: DATA_URL_PNG } },
      { fetchImpl: async () => ({ ok: true }) },
    );
    assert.equal(r, null);
  });
});

describe('buildVisionFallbackMessages', () => {
  const describeFn = async () => '这是一张截图';

  test('replaces image blocks with description text', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '看看这个' },
          { type: 'image_url', image_url: { url: DATA_URL_PNG } },
        ],
      },
    ];
    const { replaced, failed } = await buildVisionFallbackMessages(messages, describeFn);
    assert.equal(replaced, 1);
    assert.equal(failed, 0);
    const content = messages[0].content;
    assert.equal(content.length, 2);
    assert.equal(content[1].type, 'text');
    assert.equal(content[1].text, '这是一张截图');
    assert.equal('image_url' in content[1], false);
  });

  test('handles multiple images concurrently', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: DATA_URL_PNG } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA=' } },
        ],
      },
    ];
    const { replaced } = await buildVisionFallbackMessages(messages, describeFn);
    assert.equal(replaced, 2);
  });

  test('failed description becomes placeholder without throwing', async () => {
    const messages = [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: DATA_URL_PNG } }] },
    ];
    const { replaced, failed } = await buildVisionFallbackMessages(messages, async () => null);
    assert.equal(replaced, 0);
    assert.equal(failed, 1);
    assert.match(messages[0].content[0].text, /自动识别失败/);
  });

  test('no images -> no change', async () => {
    const messages = [{ role: 'user', content: '纯文本' }];
    const r = await buildVisionFallbackMessages(messages, describeFn);
    assert.deepEqual(r, { replaced: 0, failed: 0, missingKey: false });
    assert.equal(messages[0].content, '纯文本');
  });

  test('string content messages are untouched', async () => {
    const messages = [{ role: 'system', content: 'system prompt' }];
    await buildVisionFallbackMessages(messages, describeFn);
    assert.equal(messages[0].content, 'system prompt');
  });
});
