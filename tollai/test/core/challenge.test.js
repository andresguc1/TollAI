import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateChallenge,
  validateResponse,
  decodeChallenge,
  reverse,
  encodeB64,
  decodeB64,
  generateCipherMap,
  substitute,
} from '../../core/challenge.js';

test('generateChallenge returns an obfuscated, decodable challenge', () => {
  const challenge = generateChallenge('news-portal');
  assert.equal(challenge.scenario, 'news-portal');
  assert.equal(typeof challenge.answer, 'string');
  assert.equal(typeof challenge.plaintext, 'string');
  assert.notEqual(challenge.ciphertext, challenge.plaintext);
  assert.deepEqual(challenge.meta.pipeline, ['reverse', 'base64', 'substitution']);
  assert.ok(challenge.meta.substitutionMap && typeof challenge.meta.substitutionMap === 'object');
  assert.ok(['math', 'logic', 'reasoning'].includes(challenge.type));
  assert.match(challenge.difficulty, /^(low|medium|high)$/);
});

test('ciphertext contains only printable ASCII', () => {
  const challenge = generateChallenge('news-portal');
  for (const ch of challenge.ciphertext) {
    assert.ok(ch.charCodeAt(0) >= 33 && ch.charCodeAt(0) <= 126, `bad char ${ch.charCodeAt(0)}`);
  }
});

test('decodeChallenge recovers the plaintext for every generator', () => {
  for (let i = 0; i < 60; i++) {
    const challenge = generateChallenge('git-repository');
    const decoded = decodeChallenge(challenge.ciphertext, challenge.meta);
    assert.equal(decoded, challenge.plaintext);
  }
});

test('ciphertext never leaks the question verbatim', () => {
  for (let i = 0; i < 20; i++) {
    const challenge = generateChallenge('news-portal');
    const words = challenge.plaintext.split(' ');
    assert.ok(
      !challenge.ciphertext.includes(challenge.plaintext),
      'ciphertext must not contain the plaintext question',
    );
    for (const word of words) {
      if (word.length > 3) {
        assert.ok(!challenge.ciphertext.includes(word), 'ciphertext leaks word: ' + word);
      }
    }
  }
});

test('every challenge carries a server-side answer', () => {
  for (let i = 0; i < 20; i++) {
    const challenge = generateChallenge('news-portal');
    assert.ok(challenge.answer.length > 0);
  }
});

test('validateResponse accepts only the exact answer', () => {
  const challenge = generateChallenge('social-forum');
  const result = validateResponse(challenge, challenge.answer);
  assert.equal(result, true);
  assert.equal(validateResponse(challenge, 'wrong-' + challenge.answer), false);
});

test('validateResponse is case-insensitive on trimmed input', () => {
  const challenge = { answer: '  Second ' };
  assert.equal(validateResponse(challenge, 'second'), true);
  assert.equal(validateResponse(challenge, '  second  '), true);
  assert.equal(validateResponse(challenge, 'SECOND'), true);
  assert.equal(validateResponse(challenge, 'third'), false);
  assert.equal(validateResponse(challenge, ''), false);
});

test('validateResponse rejects other options even when options are listed', () => {
  const challenge = {
    answer: 'yes',
    options: ['yes', 'no', 'cannot be determined'],
  };
  assert.equal(validateResponse(challenge, 'yes'), true);
  assert.equal(validateResponse(challenge, 'no'), false);
  assert.equal(validateResponse(challenge, 'cannot be determined'), false);
});

test('validateResponse is safe against nullish and non-string input', () => {
  assert.equal(validateResponse(null, 'yes'), false);
  assert.equal(validateResponse({}, 'yes'), false);
  assert.equal(validateResponse({ answer: '1' }, null), false);
  assert.equal(validateResponse({ answer: '1' }, undefined), false);
  assert.equal(validateResponse({ answer: '1' }, 1), true);
  assert.equal(validateResponse({ answer: null }, '1'), false);
});

test('substitute encodes and decodes round-trip through the cipher map', () => {
  const { encodeMap, decodeMap } = generateCipherMap();
  assert.equal(Object.keys(encodeMap).length, 94);
  assert.equal(Object.keys(decodeMap).length, 94);
  for (let i = 33; i <= 126; i++) {
    const ch = String.fromCharCode(i);
    assert.ok(encodeMap[ch] !== undefined, `encodeMap missing ${ch}`);
    assert.ok(decodeMap[encodeMap[ch]] === ch, `decodeMap not inverse for ${ch}`);
  }
  const text = 'Hello, World! 123';
  const encoded = substitute(text, encodeMap);
  assert.equal(substitute(encoded, decodeMap), text);
});

test('base64 helpers round-trip unicode', () => {
  const text = 'Sum: 42 + 7 → ✓';
  assert.equal(decodeB64(encodeB64(text)), text);
  assert.match(encodeB64(text), /^[A-Za-z0-9+/]+={0,2}$/);
});

test('reverse reverses any string', () => {
  assert.equal(reverse('abc-123'), '321-cba');
  assert.equal(reverse(''), '');
});

test('two challenges do not share a cipher map', () => {
  const a = generateChallenge('news-portal');
  const b = generateChallenge('news-portal');
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notDeepEqual(a.meta.substitutionMap, b.meta.substitutionMap);
});

test('decodeChallenge survives garbage meta without throwing', () => {
  assert.equal(decodeChallenge('garbage', { pipeline: [] }), 'garbage');
  assert.equal(decodeChallenge('garbage', {}), 'garbage');
  assert.doesNotThrow(() => decodeChallenge('garbage', { pipeline: ['reverse', 'base64'] }));
  assert.doesNotThrow(() =>
    decodeChallenge('garbage', { pipeline: ['substitution'], substitutionMap: {} }),
  );
});