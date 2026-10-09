import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToll } from '../../core/index.js';
import { solvePow } from '../../core/pow.js';
import { decodeChallenge } from '../../core/challenge.js';
import { createSession, issueToken, ipHashFor } from '../../core/session.js';

const SECRET = 'toll-secret';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Dest': 'document',
  'Sec-CH-UA': '"Chromium";v="126"',
};

const AGENT_HEADERS = {
  'User-Agent': 'axios/1.6.2',
  Accept: 'application/json',
};

async function H(toll, path, { method = 'GET', headers = {}, body, ip = '1.2.3.4', mode, ctx = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const request = new Request(`http://localhost${path}`, init);
  const response = await toll.handle(request, Object.assign(ctx, { ip, mode }));
  return { response, ctx };
}

function makeToll(overrides = {}) {
  const clock = { t: Date.now() };
  const events = { agents: [], sessions: [], decisions: [], dwell: [] };
  const toll = createToll({
    secret: SECRET,
    powDifficulty: 8,
    clientSource: '/* tollai client */',
    mode: 'api',
    protect: ['/api/**', '/news'],
    onAIAgentDetected: data => events.agents.push(data),
    onSessionIssued: data => events.sessions.push(data),
    onDecision: data => events.decisions.push(data),
    onDwellDeferred: () => events.dwell.push(1),
    now: () => clock.t,
    ...overrides,
  });
  return { toll, clock, events };
}

async function mintCookie(toll, clock, ip = '1.2.3.4') {
  const challenge = await toll.handle(new Request('http://localhost/tollai/challenge'), { ip });
  const body = await challenge.json();
  const nonce = await solvePow(body.challenge, body.difficulty, { maxIterations: 2e6 });
  const verify = await toll.handle(
    new Request('http://localhost/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: body.challenge, nonce }),
    }),
    { ip },
  );
  const cookies = verify.headers.getSetCookie();
  return cookies.map(c => c.split(';')[0]).join('; ');
}

const cookieHeader = name => ({ cookie: `${name}` });

test('untolled paths pass through untouched', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/');
  assert.equal(response, null);
});

test('a browser page navigation without session gets the attestation shell', async () => {
  const { toll } = makeToll();
  const { response, ctx } = await H(toll, '/news', { headers: BROWSER_HEADERS });
  assert.ok(response, 'shell should be returned');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const text = await response.text();
  assert.match(text, /TollAI/);
  assert.match(text, /\/tollai\/client\.js/);
  assert.equal(ctx.needsAttestation, true, 'ctx signals attestation needed');
});

test('a browser fetch without session gets 401 ATTESTATION_REQUIRED', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/api/news', {
    headers: { ...BROWSER_HEADERS, Accept: '*/*', 'Sec-Fetch-Mode': 'cors' },
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'ATTESTATION_REQUIRED');
});

test('an agent without session gets the 433 challenge with no plaintext', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/api/news', { headers: AGENT_HEADERS });
  assert.equal(response.status, 433);
  const body = await response.json();
  assert.equal(typeof body.challenge_id, 'string');
  assert.equal(typeof body.ciphertext, 'string');
  assert.equal(typeof body.meta, 'object');
  assert.ok(['math', 'logic', 'reasoning'].includes(body.challenge_type));
  assert.equal(body.scenario, 'generic');
  assert.ok(body.timestamp > 0);
  assert.ok(body.expires_in >= 0);
  assert.equal(body.challenge, undefined, 'no plaintext challenge leak');
  assert.equal(body.question, undefined, 'no plaintext question leak');
  assert.match(response.headers.get('x-tollai-decision'), /challenge-issued/i);
});

test('a full human flow mints a session and passes transparently', async () => {
  const { toll, clock, events } = makeToll();
  const cookie = await mintCookie(toll, clock);
  assert.ok(cookie);
  assert.equal(events.sessions.length, 1);

  const { response, ctx } = await H(toll, '/api/news', {
    headers: { ...BROWSER_HEADERS, Accept: '*/*', cookie },
  });
  assert.equal(response, null, 'valid session passes through');
  assert.equal(ctx.tollVerified, true);
  assert.equal(ctx.tollMetadata.transparent, true);
  assert.equal(typeof ctx.tollRequestId, 'string');
  assert.ok(ctx.out.setCookie.length >= 1, 'session cookie refreshed');
  assert.match(ctx.out.setCookie[0], /^tollai_session=/);
  assert.match(ctx.out.setCookie[0], /Max-Age=900/);
  assert.match(ctx.out.headers['x-tollai-decision'], /transparent/i);
});

test('a session is bound to the issuing IP', async () => {
  const { toll, clock } = makeToll();
  const cookie = await mintCookie(toll, clock, '1.1.1.1');
  const { response } = await H(toll, '/api/news', {
    headers: { ...BROWSER_HEADERS, Accept: '*/*', cookie },
    ip: '2.2.2.2',
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'IP_MISMATCH');
});

test('an expired session falls through to attestation', async () => {
  const { toll } = makeToll();
  const ipHash = await ipHashFor(SECRET, '1.2.3.4');
  const expired = createSession({ ipHash, difficulty: 8, workMs: 1, sessionTTL: 5000, now: Date.now() - 10000 });
  const token = await issueToken(expired, SECRET);
  const { response } = await H(toll, '/api/news', {
    headers: { ...AGENT_HEADERS, cookie: `tollai_session=${token}` },
  });
  assert.equal(response.status, 433);
});

test('a machine-speed answer is blocked as an AI agent', async () => {
  const { toll, events } = makeToll();
  const first = await H(toll, '/api/podcast/transcript', {
    method: 'POST', headers: AGENT_HEADERS, body: { episode_id: 'ALL' },
  });
  const body = await first.response.json();
  const plaintext = decodeChallenge(body.ciphertext, body.meta);
  const answer = extractAnswer(plaintext);

  const solved = await H(toll, '/api/podcast/transcript', {
    method: 'POST',
    headers: { ...AGENT_HEADERS, 'x-ai-proof': body.challenge_id, 'x-challenge-response': answer },
    body: { episode_id: 'ALL' },
  });
  assert.equal(solved.response.status, 403);
  const solvedBody = await solved.response.json();
  assert.equal(solvedBody.code, 'AI_AGENT_DETECTED');
  assert.equal(solvedBody.reason, 'MACHINE_SPEED');
  assert.equal(events.agents.length, 1);
  assert.equal(events.agents[0].reason, 'MACHINE_SPEED');
  assert.equal(events.agents[0].scenario, 'generic');
});

test('a slow correct answer is admitted without a session', async () => {
  const { toll, clock } = makeToll();
  const first = await H(toll, '/api/chat', {
    method: 'POST', headers: AGENT_HEADERS, body: { message: 'hi' },
  });
  const body = await first.response.json();
  const plaintext = decodeChallenge(body.ciphertext, body.meta);
  clock.t += 2000;
  const solved = await H(toll, '/api/chat', {
    method: 'POST',
    headers: { ...AGENT_HEADERS, 'x-ai-proof': body.challenge_id, 'x-challenge-response': extractAnswer(plaintext) },
    body: { message: 'hi' },
  });
  assert.equal(solved.response, null, 'correct human-speed answer passes');
  assert.equal(solved.ctx.tollVerified, true);
  assert.equal(solved.ctx.tollMetadata.transparent, false);
  assert.equal(solved.ctx.tollMetadata.challengeType, body.challenge_type);
});

test('wrong answers are rejected and exhausted after 3 attempts', async () => {
  const { toll, clock } = makeToll();
  const first = await H(toll, '/api/news', { headers: AGENT_HEADERS });
  const body = await first.response.json();
  const headers = { ...AGENT_HEADERS, 'x-ai-proof': body.challenge_id };
  for (const expected of [2, 1, 0]) {
    clock.t += 2000;
    const attempt = await H(toll, '/api/news', {
      headers: { ...headers, 'x-challenge-response': 'definitely-wrong' },
    });
    assert.equal(attempt.response.status, 403);
    const body = await attempt.response.json();
    assert.equal(body.code, 'WRONG_ANSWER');
    assert.equal(body.attempts_remaining, expected);
  }
  clock.t += 2000;
  const exhausted = await H(toll, '/api/news', {
    headers: { ...headers, 'x-challenge-response': 'definitely-wrong' },
  });
  assert.equal(exhausted.response.status, 403);
  assert.equal((await exhausted.response.json()).code, 'MAX_ATTEMPTS');
});

test('a mutation with zero dwell is deferred', async () => {
  const { toll, clock, events } = makeToll();
  const cookie = await mintCookie(toll, clock);
  const { response } = await H(toll, '/api/finance/transfer', {
    method: 'POST', headers: { ...AGENT_HEADERS, cookie }, body: { amount: 10 },
  });
  assert.equal(response.status, 428);
  const body = await response.json();
  assert.equal(body.code, 'DWELL_REQUIRED');
  assert.equal(body.required_ms, 1500);
  assert.equal(events.dwell.length, 1);
});

test('reads stay instant while dwell is unpaid, then mutations pass once settled', async () => {
  const { toll, clock } = makeToll();
  const cookie = await mintCookie(toll, clock);
  let sessionCookieVal = cookie;

  const read = await H(toll, '/api/finance/balance', {
    headers: { ...AGENT_HEADERS, Accept: '*/*', cookie },
  });
  assert.equal(read.response, null, 'GET is never dwell-gated');

  for (let i = 0; i < 4; i++) {
    clock.t += 500;
    const beat = await toll.handle(
      new Request('http://localhost/tollai/dwell', { method: 'POST', headers: { cookie: sessionCookieVal } }),
      { ip: '1.2.3.4' },
    );
    const beatBody = await beat.json();
    const setCookies = beat.headers.getSetCookie();
    if (setCookies.length) sessionCookieVal = setCookies.map(c => c.split(';')[0]).join('; ');
    if (beatBody.settled) break;
  }

  const transfer = await H(toll, '/api/finance/transfer', {
    method: 'POST', headers: { ...AGENT_HEADERS, cookie: sessionCookieVal }, body: { amount: 10 },
  });
  assert.equal(transfer.response, null, 'mutation passes once dwell settled');
});

test('a request burst trips the anti-burst gate', async () => {
  const { toll, clock, events } = makeToll();
  const cookie = await mintCookie(toll, clock);
  let blocked = null;
  for (let i = 0; i < 40 && !blocked; i++) {
    const { response } = await H(toll, '/api/news', {
      headers: { ...BROWSER_HEADERS, Accept: '*/*', cookie },
    });
    if (response) blocked = response;
  }
  assert.ok(blocked, 'burst must eventually block');
  assert.equal(blocked.status, 403);
  const body = await blocked.json();
  assert.equal(body.code, 'AI_AGENT_DETECTED');
  assert.equal(body.reason, 'BURST_RATE');
  assert.equal(events.agents.length, 1);
  assert.equal(events.agents[0].reason, 'BURST_RATE');
});

test('session quota exhaustion returns 428 REPROOF_REQUIRED', async () => {
  const { toll, clock } = makeToll({ sessionQuota: 3, rateLimit: 999 });
  const cookie = await mintCookie(toll, clock);
  for (let i = 0; i < 3; i++) {
    const { response } = await H(toll, '/api/news', {
      headers: { ...BROWSER_HEADERS, Accept: '*/*', cookie },
    });
    assert.equal(response, null, `request ${i + 1} within quota`);
  }
  const fourth = await H(toll, '/api/news', {
    headers: { ...BROWSER_HEADERS, Accept: '*/*', cookie },
  });
  assert.equal(fourth.response.status, 428);
  assert.equal((await fourth.response.json()).code, 'REPROOF_REQUIRED');
});

test('mode off bypasses the toll entirely', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/api/news', { headers: AGENT_HEADERS, mode: 'off' });
  assert.equal(response, null);
});

test('mode gate tolls paths outside protect', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/robots.txt', { headers: AGENT_HEADERS, mode: 'gate' });
  assert.equal(response.status, 433);
});

test('protocol-adjacent routes pass through for the host application', async () => {
  const { toll } = makeToll();
  for (const path of ['/tollai/telemetry', '/tollai/usage', '/tollai/attack-events']) {
    const { response } = await H(toll, path);
    assert.equal(response, null, path);
  }
});

test('exclude patterns win over protect', async () => {
  const { toll } = makeToll({ exclude: ['/api/public/**'] });
  const blockedPath = await H(toll, '/api/public/x', { headers: AGENT_HEADERS });
  assert.equal(blockedPath.response, null, 'excluded path is not tolled');
  const tolled = await H(toll, '/api/private/x', { headers: AGENT_HEADERS });
  assert.equal(tolled.response.status, 433);
});

test('decisions are emitted for observability', async () => {
  const { toll, clock, events } = makeToll();
  await H(toll, '/api/news', { headers: AGENT_HEADERS });
  assert.ok(events.decisions.some(d => d.signal === 'NO_JS_CLIENT'));
  const cookie = await mintCookie(toll, clock);
  await H(toll, '/api/news', { headers: { ...BROWSER_HEADERS, Accept: '*/*', cookie } });
  assert.ok(events.decisions.some(d => d.signal === 'valid-session'));
});

test('createToll throws in production without a secret', () => {
  const previous = globalThis.process?.env?.NODE_ENV;
  try {
    if (globalThis.process && globalThis.process.env) {
      globalThis.process.env.NODE_ENV = 'production';
    }
    assert.throws(() => createToll({}), /TOLLAI_SECRET/);
  } finally {
    if (globalThis.process && globalThis.process.env) {
      globalThis.process.env.NODE_ENV = previous;
    }
  }
});

// Extract a correct answer for any generated challenge (mirrors the simulator).
function extractAnswer(plaintext) {
  const text = plaintext;
  if (text.includes('Calculate the result')) {
    const expr = text.match(/Calculate the result of:\s*(.+)/)[1];
    return String(Function(`"use strict"; return (${expr});`)());
  }
  if (text.includes('2, 6, 12, 20, 30')) return '42';
  if (text.includes('multiply my age')) {
    const [, mult, sub, div, result] = text.match(/multiply my age by (\d+), subtract (\d+), and divide by (\d+), you get (\d+)/).map(Number);
    return String((result * div + sub) / mult);
  }
  if (text.includes('Madrid')) return '282';
  if (text.includes('30 people')) return '5';
  if (text.includes('snail climbs')) return '8';
  if (text.includes('overtake the second')) return 'second';
  if (text.includes('3 apples')) return '1';
  if (text.includes('Ana is taller')) return 'ana';
  if (text.includes('all blocks are cubes')) return 'yes';
  if (text.includes('rains, the ground gets wet')) return 'cannot be determined';
  if (text.includes('All roses')) return 'no';
  if (text.includes('two ropes')) {
    return 'Light both ends of rope 1 and one end of rope 2. When rope 1 finishes (30 min), light the other end of rope 2. It burns for 15 more min.';
  }
  if (text.includes('Sum:')) return String(Function(`"use strict"; return ${text.replace('Sum:', '')};`)());
  if (text.includes('Product:')) return String(Function(`"use strict"; return ${text.replace('Product:', '')};`)());
  throw new Error('unhandled challenge: ' + text);
}
test('host-pinned scenario (ctx.tollScenario) wins over the path matcher', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/api/news', {
    headers: AGENT_HEADERS,
    ctx: { tollScenario: 'news-portal' },
  });
  assert.equal(response.status, 433);
  assert.equal((await response.json()).scenario, 'news-portal');
});

test('the 433 challenge carries a human-readable message', async () => {
  const { toll } = makeToll();
  const { response } = await H(toll, '/api/news', { headers: AGENT_HEADERS });
  assert.equal(response.status, 433);
  assert.match((await response.json()).message, /Cognitive toll required/);
});

test('observability payloads identify who triggered the decision', async () => {
  const { toll, events } = makeToll();
  await H(toll, '/api/news', { headers: AGENT_HEADERS });
  const issued = events.decisions.find(d => d.signal === 'NO_JS_CLIENT');
  assert.ok(issued, 'challenge-issued decision emitted');
  assert.equal(issued.userAgent, 'axios/1.6.2');
  assert.equal(issued.scenario, 'generic');
  assert.equal(issued.mode, 'api');

  const first = await H(toll, '/api/podcast/transcript', {
    method: 'POST', headers: AGENT_HEADERS, body: { episode_id: 'ALL' },
  });
  const body = await first.response.json();
  const solved = await H(toll, '/api/podcast/transcript', {
    method: 'POST',
    headers: { ...AGENT_HEADERS, 'x-ai-proof': body.challenge_id, 'x-challenge-response': 'x' },
    body: { episode_id: 'ALL' },
  });
  assert.equal(solved.response.status, 403);
  assert.match((await solved.response.json()).message, /Response speed incompatible/);
  const alert = events.agents.find(a => a.reason === 'MACHINE_SPEED');
  assert.equal(alert.userAgent, 'axios/1.6.2');
  assert.equal(alert.scenario, 'generic');
  assert.ok(!Number.isNaN(Date.parse(alert.timestamp)), 'alert carries an ISO timestamp');
});
