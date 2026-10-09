import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProtocol } from '../../core/protocol.js';
import { ProofOfWork, solvePow } from '../../core/pow.js';
import { createSession, issueToken, ipHashFor } from '../../core/session.js';

const SECRET = 'protocol-secret';

function makeProtocol({ clientSource = '/* client source */', now, issued } = {}) {
  const pow = new ProofOfWork({ secret: SECRET, difficulty: 8, ttl: 60000 });
  const events = issued || [];
  const protocol = createProtocol({
    secret: SECRET,
    pow,
    options: { sessionTTL: 900000, cookieName: 'tollai_session', secure: false, minDwellMs: 1500 },
    clientSource,
    onSessionIssued: data => events.push(data),
    now,
  });
  return { protocol, pow, events };
}

const url = (path, init) => new Request(`http://localhost${path}`, init);

async function cookieFrom(response) {
  const cookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  return (cookies || []).map(c => c.split(';')[0]).join('; ');
}

async function mintSessionCookie(protocol, ip = '1.2.3.4') {
  const ch = await (await protocol(url('/tollai/challenge'), {}, { ip })).json();
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 1e6 });
  const verify = await protocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
    { ip },
  );
  return cookieFrom(verify);
}

test('GET /tollai/challenge issues a fresh proof-of-work challenge', async () => {
  const { protocol, pow } = makeProtocol();
  const res = await protocol(url('/tollai/challenge'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.challenge, 'string');
  assert.equal(body.difficulty, 8);
  assert.ok(body.expires_in >= 0);
  const issued = await pow.issue();
  assert.ok(issued.challenge);
});

test('POST /tollai/verify mints a session cookie', async () => {
  const issued = [];
  const { protocol, pow } = makeProtocol({ issued });
  const ch = await (await protocol(url('/tollai/challenge'))).json();
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 1e6 });
  const res = await protocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
    { ip: '9.9.9.9' },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verified, true);
  assert.equal(typeof body.work_ms, 'number');

  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('tollai_session=')));
  const sessionCookie = cookies.find(c => c.startsWith('tollai_session='));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /Max-Age=900/);
  assert.ok(!/Secure/.test(sessionCookie));

  assert.equal(issued.length, 1);
  assert.equal(issued[0].ipHash, await ipHashFor(SECRET, '9.9.9.9'));
  assert.equal(issued[0].difficulty, 8);
});

test('POST /tollai/verify rejects a failed proof', async () => {
  const { protocol } = makeProtocol();
  const ch = await (await protocol(url('/tollai/challenge'))).json();
  const res = await protocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce: '0' }),
    }),
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.verified, false);
  assert.equal(body.code, 'INSUFFICIENT_WORK');
});

test('POST /tollai/verify rejects a replayed proof', async () => {
  const { protocol, pow } = makeProtocol();
  const ch = await (await protocol(url('/tollai/challenge'))).json();
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 1e6 });
  await protocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
  );
  const replay = await protocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
  );
  assert.equal(replay.status, 403);
  assert.equal((await replay.json()).code, 'CHALLENGE_USED');
});

test('POST /tollai/verify copes with a non-JSON body', async () => {
  const { protocol } = makeProtocol();
  const res = await protocol(
    url('/tollai/verify', { method: 'POST', body: 'not-json', headers: { 'content-type': 'text/plain' } }),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'BAD_REQUEST');
});

test('POST /tollai/dwell requires a session', async () => {
  const { protocol } = makeProtocol();
  const res = await protocol(url('/tollai/dwell', { method: 'POST' }), { ip: '1.2.3.4' });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, code: 'NO_SESSION' });
});

test('POST /tollai/dwell rejects garbage and mismatched sessions without throwing', async () => {
  const { protocol } = makeProtocol();
  const garbage = await protocol(
    url('/tollai/dwell', { method: 'POST', headers: { cookie: 'tollai_session=garbage.invalid' } }),
    { ip: '1.2.3.4' },
  );
  assert.equal(garbage.status, 401);
  assert.equal((await garbage.json()).code, 'SESSION_INVALID');

  const cookie = await mintSessionCookie(protocol, '5.5.5.5');
  const mismatch = await protocol(
    url('/tollai/dwell', { method: 'POST', headers: { cookie } }),
    { ip: '6.6.6.6' },
  );
  assert.equal(mismatch.status, 401);
  assert.equal((await mismatch.json()).code, 'IP_MISMATCH');
});

test('POST /tollai/dwell reports initial dwell state and refreshes the cookie', async () => {
  const { protocol } = makeProtocol();
  const cookie = await mintSessionCookie(protocol);
  const res = await protocol(url('/tollai/dwell', { method: 'POST', headers: { cookie } }), { ip: '1.2.3.4' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.dwell_ms, 0);
  assert.equal(body.required_ms, 1500);
  assert.equal(body.settled, false);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('tollai_session=')));
});

test('POST /tollai/dwell rejects an expired session token', async () => {
  const { protocol } = makeProtocol();
  const ipHash = await ipHashFor(SECRET, '1.2.3.4');
  const past = Date.now() - 100000;
  const expired = createSession({ ipHash, difficulty: 8, workMs: 1, sessionTTL: 30000, now: past });
  const token = await issueToken(expired, SECRET);
  const res = await protocol(
    url('/tollai/dwell', { method: 'POST', headers: { cookie: `tollai_session=${token}` } }),
    { ip: '1.2.3.4' },
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'SESSION_EXPIRED');
});

test('GET /tollai/client.js serves the client source as JavaScript', async () => {
  const { protocol } = makeProtocol({ clientSource: '/* tower */' });
  const res = await protocol(url('/tollai/client.js'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.equal(await res.text(), '/* tower */');
});

test('GET /tollai/status reports the toll configuration', async () => {
  const { protocol } = makeProtocol();
  const res = await protocol(url('/tollai/status'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.difficulty, 8);
  assert.equal(body.sessionTTL, 900000);
  assert.equal(body.minDwellMs, 1500);
});

test('non-protocol /tollai/* routes pass through as null', async () => {
  const { protocol } = makeProtocol();
  for (const path of ['/tollai/telemetry', '/tollai/usage', '/tollai/attack-events']) {
    const res = await protocol(url(path));
    assert.equal(res, null, path);
  }
});

test('Set-Cookie uses Secure on secure endpoints', async () => {
  const issued = [];
  const { protocol, pow } = makeProtocol({ issued });
  const ch = await (await protocol(url('/tollai/challenge'))).json();
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 1e6 });
  const services = {
    secret: SECRET,
    pow,
    options: { sessionTTL: 900000, cookieName: 'tollai_session', secure: true, minDwellMs: 1500 },
    clientSource: '',
    onSessionIssued: data => issued.push(data),
  };
  const secureProtocol = createProtocol(services);
  const res = await secureProtocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
    { ip: '1.2.3.4' },
  );
  const sessionCookie = res.headers.getSetCookie().find(c => c.startsWith('tollai_session='));
  assert.match(sessionCookie, /Secure/);
});
test('verify emits a pow session-issued event with proof details', async () => {
  const issued = [];
  const { protocol } = makeProtocol({ issued });
  const ch = await (await protocol(url('/tollai/challenge'))).json();
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 1e6 });
  const res = await protocol(
    url('/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'axios/1.6.2' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
    { ip: '9.9.9.9' },
  );
  assert.equal(res.status, 200);
  assert.equal(issued.length, 1);
  const ev = issued[0];
  assert.equal(ev.source, 'pow');
  assert.equal(ev.ip, '9.9.9.9');
  assert.equal(ev.userAgent, 'axios/1.6.2');
  assert.equal(ev.challenge, ch.challenge);
  assert.equal(ev.nonce, String(nonce));
  assert.equal(ev.hashes, Number(nonce) + 1);
  assert.ok(ev.workMs >= 0);
  assert.ok(ev.verifyMs >= 0);
});
