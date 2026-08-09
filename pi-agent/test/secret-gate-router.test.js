import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Secret Gate Redaction Unit Tests', () => {
  function redactText(text, secretPairs) {
    let resultStr = text;
    for (const [key, val] of Object.entries(secretPairs)) {
      if (val && val.length >= 8 && resultStr.includes(val)) {
        resultStr = resultStr.split(val).join(`***REDACTED:${key}***`);
      }
    }
    return resultStr;
  }

  test('Redacts sensitive keys from tool_result text correctly', () => {
    const secrets = {
      OPENAI_API_KEY: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
      GEMINI_API_KEY: 'AIzaSyABC1234567890DEF'
    };

    const rawOutput = 'Running command with key: sk-1234567890abcdefghijklmnopqrstuvwxyz and AIzaSyABC1234567890DEF done';
    const redacted = redactText(rawOutput, secrets);

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
    const result = redactText(normalText, secrets);
    assert.equal(result, normalText);
  });
});
