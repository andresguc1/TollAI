import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCloudflareTollHandler } from '../../adapters/cloudflare.js';
import { solvePow } from '../../core/pow.js';
import { makeAgentToll } from './helpers.mjs';

const AGENT_REQUEST = () =>
  new Request('http://app.cf.test/api/news', {
    headers: { 'user-agent': 'axios/1.6.2', accept: '*/*', 'cf-connecting-ip': '198.51.100.7' },
  });

test('cloudflare adapter: agent without session gets the 433 challenge', async () => {
  const { toll } = makeAgentToll();
  let originCalls = 0;
  const handler = createCloudflareTollHandler(toll, async () => { originCalls += 1; return new Response('origin'); });
  const res = await handler(AGENT_REQUEST(), {}, {});
  assert.equal(res.status, 433);
  const body = await res.json();
  assert.equal(typeof body.ciphertext, 'string');
  assert.equal(originCalls, 0);
});

test('cloudflare adapter: browser navigation gets the attestation shell', async () => {
  const { toll } = makeAgentToll();
  let originCalls = 0;
  const handler = createCloudflareTollHandler(toll, async () => { originCalls += 1; return new Response('origin'); });
  const res = await handler(
    new Request('http://app.cf.test/api/news', {
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': '198.51.100.7',
      },
    }),
    {}, {},
  );
  assert.equal(res.status, 200);
  assert.match(await res.text(), /TollAI/);
  assert.equal(originCalls, 0);
});

test('cloudflare adapter: protocol routes are answered with session cookies', async () => {
  const { toll } = makeAgentToll();
  const handler = createCloudflareTollHandler(toll, async () => new Response('origin', { status: 200 }));

  const challengeRes = await handler(new Request('http://app.cf.test/tollai/challenge'), {}, {});
  assert.equal(challengeRes.status, 200);
  const ch = await challengeRes.json();
  assert.equal(typeof ch.challenge, 'string');

  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 2e6 });
  const verifyRes = await handler(
    new Request('http://app.cf.test/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
    {}, {},
  );
  assert.ok(verifyRes.headers.getSetCookie().some((c) => c.startsWith('tollai_session=')));
});

test('cloudflare adapter: valid session passes through and the origin response keeps the refresh cookie', async () => {
  const { toll, sessions } = makeAgentToll();
  const handler = createCloudflareTollHandler(toll, async () => new Response('origin-ok', { status: 200 }));

  const challengeRes = await handler(new Request('http://app.cf.test/tollai/challenge'), {}, {});
  const ch = await challengeRes.json();
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 2e6 });
  const verifyRes = await handler(
    new Request('http://app.cf.test/tollai/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce }),
    }),
    {}, {},
  );
  const cookie = verifyRes.headers.getSetCookie()[0].split(';')[0];
  assert.equal(sessions.length, 1);

  const res = await handler(
    new Request('http://app.cf.test/api/news', {
      headers: { cookie, 'user-agent': 'axios/1.6.2', accept: '*/*' },
    }),
    {}, {},
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'origin-ok');
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('tollai_session=')));
});

test('cloudflare adapter: rejects a missing toll or origin', () => {
  assert.throws(() => createCloudflareTollHandler(null, async () => undefined));
  assert.throws(() => createCloudflareTollHandler({ handle: () => null }, 'not-a-function'));
});