import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

describe('AIIA Phase 1 Crypto & Vault Unit Tests', () => {
  const password = 'test-master-password-12345';
  const ALGORITHM = 'aes-256-gcm';
  const SALT_LENGTH = 16;
  const IV_LENGTH = 12;
  const ITERATIONS = 210000;
  const KEY_LENGTH = 32;
  const DIGEST = 'sha512';

  function deriveKey(pw, salt) {
    return crypto.pbkdf2Sync(pw, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  }

  function encrypt(plaintext, pw) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(pw, salt);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    return {
      ciphertext,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    };
  }

  function decrypt(encryptedObj, pw) {
    const salt = Buffer.from(encryptedObj.salt, 'hex');
    const iv = Buffer.from(encryptedObj.iv, 'hex');
    const authTag = Buffer.from(encryptedObj.authTag, 'hex');
    const key = deriveKey(pw, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(encryptedObj.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  }

  test('E2EE AES-256-GCM Encryption and Decryption works correctly', () => {
    const payload = JSON.stringify({ key: 'sk-1234567890abcdef', user: 'test' });
    const encrypted = encrypt(payload, password);

    assert.notEqual(encrypted.ciphertext, payload);
    assert.equal(typeof encrypted.salt, 'string');
    assert.equal(typeof encrypted.iv, 'string');
    assert.equal(typeof encrypted.authTag, 'string');

    const decrypted = decrypt(encrypted, password);
    assert.equal(decrypted, payload);
  });

  test('E2EE Decryption fails with wrong password', () => {
    const payload = JSON.stringify({ secret: 'super-secret' });
    const encrypted = encrypt(payload, password);

    assert.throws(() => {
      decrypt(encrypted, 'wrong-password-67890');
    });
  });
});
