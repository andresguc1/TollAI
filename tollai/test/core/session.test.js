import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOKEN_VERSION,
  ipHashFor,
  createSession,
  parseSession,
  issueToken,
  refreshSession,
  registerRequest,
  accumulateDwell,
} from '../../core/session.js';

const SECRET = 'session-secret';

test('ipHashFor derives a stable 32-hex binding hash per IP', async () => {
  const a = await ipHashFor(SECRET, '1.2.3.4');
  const b = await ipHashFor(SECRET, '1.2.3.4');
  const c = await ipHashFor(SECRET, '5.6.7.8');
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(!a.includes('1.2.3.4'), 'raw IP must not appear in the hash');
});

test('createSession builds the full token payload with defaults', () => {
  const now = 1_000_000;
  const session = createSession({
    ipHash: 'iphash',
    difficulty: 14,
    workMs: 42,
    sessionTTL: 900000,
    now,
  });
  assert.equal(session.v, TOKEN_VERSION);
  assert.equal(session.ip, 'iphash');
  assert.equal(session.iat, now);
  assert.equal(session.exp, now + 900000);
  assert.equal(session.pow, 1);
  assert.equal(session.d, 14);
  assert.equal(session.w, 42);
  assert.equal(session.dw, 0);
  assert.equal(session.hb, 0);
  assert.equal(session.ws, now);
  assert.equal(session.wc, 0);
  assert.equal(session.n, 0);
  assert.equal(typeof session.sid, 'string');
  assert.ok(session.sid.length >= 16);
});

test('issueToken then parseSession round-trips', async () => {
  const session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000 });
  const token = await issueToken(session, SECRET);
  const parsed = await parseSession(token, SECRET, { ipHash: 'x' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.session.sid, session.sid);
  assert.equal(parsed.session.dw, 0);
});

test('parseSession never throws and treats garbage as SESSION_INVALID', async () => {
  const session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000 });
  const token = await issueToken(session, SECRET);
  const [encoded, sig] = token.split('.');

  for (const bad of ['', 'no-dot', 'a.b.c', null, undefined, 42, {}, 'garbage']) {
    const result = await parseSession(bad, SECRET, { ipHash: 'x' });
    assert.equal(result.ok, false, String(bad));
    assert.equal(result.reason, 'SESSION_INVALID', String(bad));
  }

  const tampered = `${encoded}.${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`;
  assert.equal((await parseSession(tampered, SECRET, { ipHash: 'x' })).reason, 'SESSION_INVALID');

  const wrongSecret = await issueToken(session, 'other-secret');
  assert.equal((await parseSession(wrongSecret, SECRET, { ipHash: 'x' })).reason, 'SESSION_INVALID');
});

test('parseSession rejects an expired token', async () => {
  const past = Date.now() - 100000;
  const session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000, now: past });
  const token = await issueToken(session, SECRET);
  const result = await parseSession(token, SECRET, { ipHash: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SESSION_EXPIRED');
});

test('parseSession enforces IP binding', async () => {
  const session = createSession({ ipHash: 'hash-a', difficulty: 12, workMs: 1, sessionTTL: 90000 });
  const token = await issueToken(session, SECRET);
  const mismatch = await parseSession(token, SECRET, { ipHash: 'hash-b' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'IP_MISMATCH');
  const ok = await parseSession(token, SECRET, { ipHash: 'hash-a' });
  assert.equal(ok.ok, true);
});

test('parseSession requires the token version', async () => {
  const session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000 });
  const token = await issueToken(session, SECRET);
  const result = await parseSession(token, SECRET, { ipHash: 'x' });
  assert.equal(result.ok, true);
  const tampered = { ...result.session, v: 999 };
  const { signPayload } = await import('../../core/crypto.js');
  const wrongVersion = await signPayload(tampered, SECRET);
  assert.equal((await parseSession(wrongVersion, SECRET, { ipHash: 'x' })).reason, 'SESSION_INVALID');
});

test('refreshSession slides the expiry and preserves the rest', () => {
  const now = 1_000_000;
  const session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 60000, now });
  const later = now + 30000;
  const refreshed = refreshSession(session, { now: later });
  assert.equal(refreshed.exp, later + 60000);
  assert.equal(refreshed.iat, now);
  assert.equal(refreshed.sid, session.sid);
  assert.equal(refreshed.dw, 0);
});

test('registerRequest counts requests and trips burst beyond the rate limit', () => {
  const now = 1_000_000;
  let session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 60000, now });

  let burst = false;
  for (let i = 0; i < 30; i++) {
    ({ session, burst } = registerRequest(session, { rateWindowMs: 10000, rateLimit: 30, now }));
    assert.equal(burst, false);
  }
  ({ session, burst } = registerRequest(session, { rateWindowMs: 10000, rateLimit: 30, now }));
  assert.equal(burst, true);
  assert.equal(session.n, 31);
  assert.equal(session.wc, 31);
});

test('registerRequest resets the window once it elapses', () => {
  const t0 = 1_000_000;
  let session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000, now: t0 });
  let burst;
  ({ session, burst } = registerRequest(session, { rateWindowMs: 10000, rateLimit: 30, now: t0 + 1 }));
  assert.equal(burst, false);
  ({ session, burst } = registerRequest(session, { rateWindowMs: 10000, rateLimit: 30, now: t0 + 20_000 }));
  assert.equal(session.wc, 1);
  assert.equal(session.ws, t0 + 20_000);
  assert.equal(burst, false);
});

test('accumulateDwell adds elapsed time capped per call', () => {
  const t0 = 1_000_000;
  let session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000, now: t0 });
  session = accumulateDwell(session, { now: t0 + 500 });
  assert.equal(session.dw, 0, 'first heartbeat has no prior reference');
  session = accumulateDwell(session, { now: t0 + 1500, capMs: 1000 });
  assert.equal(session.dw, 1000, 'elapsed since hb is capped at capMs');
  session = accumulateDwell(session, { now: t0 + 1700, capMs: 1000 });
  assert.equal(session.dw, 1200);
  assert.equal(session.hb, t0 + 1700);
});

test('accumulateDwell never goes backwards', () => {
  const t0 = 1_000_000;
  let session = createSession({ ipHash: 'x', difficulty: 12, workMs: 1, sessionTTL: 90000, now: t0 });
  session = accumulateDwell(session, { now: t0 + 500 });
  session = accumulateDwell(session, { now: t0 + 100, capMs: 1000 });
  assert.equal(session.dw, 0);
});