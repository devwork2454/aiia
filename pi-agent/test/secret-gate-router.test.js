import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactToolResultEvent } from '../src/secret-redact.js';
import secretGateExtension from '../extensions/secret-gate.js';

describe('Secret Gate Redaction Unit Tests', () => {
  test('Redacts sensitive keys from tool_result text correctly', () => {
    const secrets = {
      OPENAI_API_KEY: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
      GEMINI_API_KEY: 'AIzaSyABC1234567890DEF'
    };

    const rawOutput = 'Running command with key: sk-1234567890abcdefghijklmnopqrstuvwxyz and AIzaSyABC1234567890DEF done';
    const { text: redacted, redacted: changed } = redactText(rawOutput, secrets);

    assert.equal(changed, true);
    assert.equal(redacted.includes('sk-1234567890abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(redacted.includes('AIzaSyABC1234567890DEF'), false);
    assert.equal(redacted.includes('***REDACTED:OPENAI_API_KEY***'), true);
    assert.equal(redacted.includes('***REDACTED:GEMINI_API_KEY***'), true);
  });

  test('Preserves non-secret text intact', () => {
    const secrets = {
      MY_KEY: 'secret-token-value-12345'
    };
    const normalText = 'This is normal text with no secret';
    const { text, redacted } = redactText(normalText, secrets);
    assert.equal(redacted, false);
    assert.equal(text, normalText);
  });

  test('redactToolResultEvent patches Pi content field', () => {
    const secrets = { TOKEN: 'secret-token-value-12345' };
    const event = {
      content: [{ type: 'text', text: 'leak secret-token-value-12345 here' }],
    };
    const out = redactToolResultEvent(event, secrets);
    assert.ok(out);
    assert.equal(event.content[0].text.includes('secret-token-value-12345'), false);
    assert.match(event.content[0].text, /REDACTED:TOKEN/);
  });

  test('extension tool_result hook redacts event.content', async () => {
    const hooks = {};
    secretGateExtension({
      on: (name, fn) => { hooks[name] = fn; },
    });
    assert.equal(typeof hooks.tool_result, 'function');
    const event = { content: [{ type: 'text', text: 'no secrets here' }] };
    await hooks.tool_result(event);
    assert.equal(event.content[0].text, 'no secrets here');
  });
});
