import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  randomHex,
  randomId,
  hmacHex,
  sha256Hex,
  signPayload,
  verifySignature,
  timingSafeEqual,
  b64urlEncode,
  b64urlDecode,
} from '../../core/crypto.js';

test('randomHex returns lowercase hex of requested byte length', () => {
  const a = randomHex(16);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.match(randomHex(4), /^[0-9a-f]{8}$/);
  assert.notEqual(randomHex(16), a);
});

test('randomId is unique across calls', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(randomId());
  assert.equal(ids.size, 100);
});

test('sha256Hex matches known test vector', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('hmacHex matches RFC 4231 test case 2', async () => {
  assert.equal(
    await hmacHex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
});

test('hmacHex accepts Uint8Array key and data deterministically', async () => {
  const key = new Uint8Array([1, 2, 3]);
  const a = await hmacHex(key, 'x');
  const b = await hmacHex(new Uint8Array([1, 2, 3]), 'x');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('signPayload produces payload.signature token and verifies back', async () => {
  const payload = { v: 1, ip: 'abcdef', exp: 123, pow: 1 };
  const token = await signPayload(payload, 'secret');
  assert.equal(typeof token, 'string');
  assert.equal(token.split('.').length, 2);
  const back = await verifySignature(token, 'secret');
  assert.deepEqual(back, payload);
});

test('verifySignature rejects tampering, wrong secret and garbage without throwing', async () => {
  const token = await signPayload({ v: 1 }, 'secret');
  const [encoded, signature] = token.split('.');

  assert.equal(await verifySignature(`${encoded}.${'0'.repeat(64)}`, 'secret'), null);
  assert.equal(await verifySignature(token, 'other-secret'), null);
  assert.equal(await verifySignature('', 'secret'), null);
  assert.equal(await verifySignature('no-dot', 'secret'), null);
  assert.equal(await verifySignature('.sig', 'secret'), null);
  assert.equal(await verifySignature('a.b.c', 'secret'), null);
  assert.equal(await verifySignature(null, 'secret'), null);
  assert.equal(await verifySignature(undefined, 'secret'), null);
  assert.equal(await verifySignature(42, 'secret'), null);
  assert.equal(await verifySignature({ token }, 'secret'), null);

  // payload tampering: re-encode different JSON under the original signature
  const forged = b64urlEncode(JSON.stringify({ v: 999 })) + '.' + signature;
  assert.equal(await verifySignature(forged, 'secret'), null);
});

test('verifySignature returns null for signed non-object payloads', async () => {
  const encoded = b64urlEncode('42');
  const sig = await hmacHex('secret', encoded);
  assert.equal(await verifySignature(`${encoded}.${sig}`, 'secret'), null);
});

test('verifySignature returns null for signed invalid JSON', async () => {
  const encoded = b64urlEncode('{not json');
  const sig = await hmacHex('secret', encoded);
  assert.equal(await verifySignature(`${encoded}.${sig}`, 'secret'), null);
});

test('timingSafeEqual compares exactly and never throws on length mismatch', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
  assert.equal(timingSafeEqual(null, 'abc'), false);
  assert.equal(timingSafeEqual('abc', null), false);
});

test('b64url encode/decode round trips unicode and stays url-safe', () => {
  const s = 'héllo → 🌍 {json:true}';
  const encoded = b64urlEncode(s);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(b64urlDecode(encoded), s);
  assert.equal(b64urlDecode(b64urlEncode('')), '');
});
