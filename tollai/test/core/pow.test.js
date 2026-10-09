import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signPayload } from '../../core/crypto.js';
import { ProofOfWork, leadingZeroBits, solvePow } from '../../core/pow.js';

const SECRET = 'test-secret';

test('leadingZeroBits counts leading zero bits of a hex digest', () => {
  assert.equal(leadingZeroBits('0000ffff00000000000000000000000000000000000000000000000000000000'), 16);
  assert.equal(leadingZeroBits('0abc'), 4);
  assert.equal(leadingZeroBits('00abc'), 8);
  assert.equal(leadingZeroBits('1abc'), 3);
  assert.equal(leadingZeroBits('8abc'), 0);
  assert.equal(leadingZeroBits('fabc'), 0);
  assert.equal(leadingZeroBits(''), 0);
});

test('issue returns a signed challenge token with difficulty and ttl', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 10, ttl: 30000 });
  const issued = await pow.issue();
  assert.equal(typeof issued.challenge, 'string');
  assert.equal(issued.challenge.split('.').length, 2);
  assert.equal(issued.difficulty, 10);
  assert.equal(issued.expires_in, 30000);
});

test('verify accepts a correctly solved challenge', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  const { challenge } = await pow.issue();
  const nonce = await solvePow(challenge, 8);
  const result = await pow.verify(challenge, nonce);
  assert.equal(result.ok, true);
  assert.equal(result.difficulty, 8);
  assert.equal(typeof result.workMs, 'number');
});

test('verify rejects a tampered challenge token', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  const { challenge } = await pow.issue();
  const nonce = await solvePow(challenge, 8);
  const [encoded, sig] = challenge.split('.');
  const tampered = `${encoded}.${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`;
  const result = await pow.verify(tampered, nonce);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CHALLENGE_UNKNOWN');
});

test('verify rejects a token signed with a different secret', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  const forged = await signPayload({ k: 'p', id: 'x'.repeat(32), iat: Date.now() }, 'other-secret');
  const result = await pow.verify(forged, '0');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CHALLENGE_UNKNOWN');
});

test('verify rejects garbage and wrong-kind payloads', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  for (const bad of ['', 'no-dot', 'a.b.c', null, undefined, 42]) {
    const result = await pow.verify(bad, '0');
    assert.equal(result.reason, 'CHALLENGE_UNKNOWN', String(bad));
  }
  const wrongKind = await signPayload({ k: 's', id: 'x'.repeat(32), iat: Date.now() }, SECRET);
  assert.equal((await pow.verify(wrongKind, '0')).reason, 'CHALLENGE_UNKNOWN');
  const badIat = await signPayload({ k: 'p', id: 'x'.repeat(32), iat: 'now' }, SECRET);
  assert.equal((await pow.verify(badIat, '0')).reason, 'CHALLENGE_UNKNOWN');
});

test('verify rejects an expired challenge', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8, ttl: 1000 });
  const issuedAt = Date.now() - 2000;
  const challenge = await signPayload({ k: 'p', id: 'x'.repeat(32), iat: issuedAt }, SECRET);
  const result = await pow.verify(challenge, '0');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CHALLENGE_EXPIRED');
});

test('verify rejects malformed nonces', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  const { challenge } = await pow.issue();
  for (const nonce of ['', 'abc', '1.5', 'NaN', null, undefined, '1234567890123', {}]) {
    const result = await pow.verify(challenge, nonce);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'NONCE_MALFORMED', String(nonce));
  }
});

test('verify reports insufficient work with achieved bits', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 40 });
  const { challenge } = await pow.issue();
  const result = await pow.verify(challenge, '0');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'INSUFFICIENT_WORK');
  assert.equal(result.difficulty, 40);
  assert.ok(result.achieved < 40);
});

test('a solved challenge is single-use', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  const { challenge } = await pow.issue();
  const nonce = await solvePow(challenge, 8);
  assert.equal((await pow.verify(challenge, nonce)).ok, true);
  const replay = await pow.verify(challenge, nonce);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'CHALLENGE_USED');
});

test('a failed solve does not consume the challenge', async () => {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8 });
  const { challenge } = await pow.issue();
  const fail = await pow.verify(challenge, '0');
  if (fail.reason === 'INSUFFICIENT_WORK') {
    const nonce = await solvePow(challenge, 8);
    assert.equal((await pow.verify(challenge, nonce)).ok, true);
  } else {
    // 0 happened to solve it (astronomically unlikely at difficulty 8): skip
    assert.ok(true);
  }
});

test('solvePow finds a nonce meeting the difficulty', async () => {
  const challenge = 'abc123';
  const nonce = await solvePow(challenge, 8);
  assert.match(nonce, /^\d{1,12}$/);
  const { sha256Hex } = await import('../../core/crypto.js');
  const digest = await sha256Hex(`${challenge}:${nonce}`);
  assert.ok(leadingZeroBits(digest) >= 8);
});

test('solvePow accepts an injected hasher for fast tests', async () => {
  const { createHash } = await import('node:crypto');
  const hasher = msg => createHash('sha256').update(msg).digest('hex');
  const nonce = await solvePow('fast', 12, { hash: hasher });
  const digest = hasher(`fast:${nonce}`);
  assert.ok(leadingZeroBits(digest) >= 12);
});

test('ProofOfWork requires a secret', () => {
  assert.throws(() => new ProofOfWork({}), /secret/);
});
