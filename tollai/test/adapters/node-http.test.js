import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createTollaiMiddleware } from '../../adapters/node-http.js';
import { createToll } from '../../core/index.js';
import { decodeChallenge } from '../../core/challenge.js';
import { BROWSER_UA, doRequest, extractAnswer, makeAgentToll, mint, withLiveServer } from './helpers.mjs';

function gw(body, { status = 200, headers = {} } = {}) {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

async function withServer(toll, run) {
  const handler = createTollaiMiddleware(toll);
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const route = {
      '/': () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<title>news</title>' }),
      '/api/news': () => gw({ source: 'news', toll_metadata: req.tollMetadata || {} }),
      '/api/finance/balance': () => gw({ balance: 42 }),
      '/api/finance/transfer': () => gw({ ok: true }),
      '/tollai/events': () => gw({ ingested: true }),
    }[path];
    handler(req, res, (err) => {
      if (err) { res.statusCode = 500; res.end(String((err && err.stack) || err)); return; }
      if (route) {
        const r = route();
        res.statusCode = r.status;
        Object.entries(r.headers).forEach(([k, v]) => res.setHeader(k, v));
        res.end(r.body);
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await withLiveServer(server, run);
}


test('node-http adapter: untolled GET passes through to the host route', async () => {
  const { toll } = makeAgentToll();
  await withServer(toll, async (base) => {
    const r = await doRequest(base, '/');
    assert.equal(r.res.statusCode, 200);
    assert.match(r.data, /<title>news<\/title>/);
    assert.ok(r.res.rawHeaders.some((h) => h.toLowerCase() === 'x-request-id'));
  });
});

test('node-http adapter: agent without session gets the 433 challenge', async () => {
  const { toll } = makeAgentToll();
  await withServer(toll, async (base) => {
    const r = await doRequest(base, '/api/news', { ua: 'axios/1.6.2' });
    assert.equal(r.res.statusCode, 433);
    const body = JSON.parse(r.data);
    assert.equal(typeof body.challenge_id, 'string');
    assert.equal(typeof body.ciphertext, 'string');
    assert.ok(!('challenge' in body) && !('question' in body));
  });
});

test('node-http adapter: browser navigation without session gets the attestation shell', async () => {
  const { toll } = makeAgentToll();
  await withServer(toll, async (base) => {
    const r = await doRequest(base, '/api/news', { accept: 'text/html' });
    assert.equal(r.res.statusCode, 200);
    assert.match(r.data, /TollAI/);
    assert.match(r.data, /\/tollai\/client\.js/);
  });
});

test('node-http adapter: a slow correct answer is admitted without a session', async () => {
  const { toll } = makeAgentToll();
  await withServer(toll, async (base) => {
    const first = JSON.parse((await doRequest(base, '/api/news', { ua: 'axios/1.6.2' })).data);
    const plaintext = decodeChallenge(first.ciphertext, first.meta);
    const second = await doRequest(base, '/api/news', {
      ua: 'axios/1.6.2',
      headers: {
        'x-ai-proof': first.challenge_id,
        'x-challenge-response': extractAnswer(plaintext),
      },
      delayMs: 1600,
    });
    assert.equal(second.res.statusCode, 200);
  });
});

test('node-http adapter: a fast answer is blocked as machine-speed', async () => {
  const { toll, agents } = makeAgentToll();
  await withServer(toll, async (base) => {
    const first = JSON.parse((await doRequest(base, '/api/news', { ua: 'axios/1.6.2' })).data);
    const plaintext = decodeChallenge(first.ciphertext, first.meta);
    const second = await doRequest(base, '/api/news', {
      ua: 'axios/1.6.2',
      headers: {
        'x-ai-proof': first.challenge_id,
        'x-challenge-response': extractAnswer(plaintext),
      },
    });
    assert.equal(second.res.statusCode, 403);
    const err = JSON.parse(second.data);
    assert.equal(err.code, 'AI_AGENT_DETECTED');
    assert.equal(err.reason, 'MACHINE_SPEED');
    assert.equal(agents.length, 1);
    assert.equal(agents[0].reason, 'MACHINE_SPEED');
  });
});

test('node-http adapter: challenge -> verify mints a session for transparent access', async () => {
  const { toll, sessions } = makeAgentToll();
  await withServer(toll, async (base) => {
    const jar = await mint(base, (p, o) => doRequest(base, p, o));
    assert.equal(sessions.length, 1);
    assert.ok(jar.startsWith('tollai_session='));
    const news = await doRequest(base, '/api/news', { jar, accept: 'application/json' });
    assert.equal(news.res.statusCode, 200);
    assert.equal(JSON.parse(news.data).toll_metadata.transparent, true);
  });
});

test('node-http adapter: mutations require dwell, then pass once settled', async () => {
  const { toll } = makeAgentToll();
  await withServer(toll, async (base) => {
    let jar = await mint(base, (p, o) => doRequest(base, p, o));

    const tooSoon = await doRequest(base, '/api/finance/transfer', { method: 'POST', jar, body: { amount: 1 } });
    assert.equal(tooSoon.res.statusCode, 428);
    assert.equal(JSON.parse(tooSoon.data).code, 'DWELL_REQUIRED');

    const fastRead = await doRequest(base, '/api/finance/balance', { jar, accept: 'application/json' });
    assert.equal(fastRead.res.statusCode, 200);

    let settled = false;
    for (let i = 0; i < 6 && !settled; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const beat = await doRequest(base, '/tollai/dwell', { method: 'POST', jar });
      if (beat.setCookie.length) jar = beat.setCookie.map((c) => c.split(';')[0]).join('; ');
      settled = JSON.parse(beat.data).settled;
    }

    const after = await doRequest(base, '/api/finance/transfer', { method: 'POST', jar, body: { amount: 1 } });
    assert.equal(after.res.statusCode, 200);
  });
});

test('node-http adapter: a request burst trips the anti-burst gate', async () => {
  const { toll, agents } = makeAgentToll();
  await withServer(toll, async (base) => {
    const jar = await mint(base, (p, o) => doRequest(base, p, o));
    let blocked = null;
    for (let i = 0; i < 40 && !blocked; i++) {
      const r = await doRequest(base, '/api/news', { jar, accept: 'application/json' });
      if (r.res.statusCode === 403) blocked = r;
    }
    assert.ok(blocked, 'burst must eventually trip');
    const body = JSON.parse(blocked.data);
    assert.equal(body.code, 'AI_AGENT_DETECTED');
    assert.equal(body.reason, 'BURST_RATE');
    assert.equal(agents[agents.length - 1].reason, 'BURST_RATE');
  });
});

test('node-http adapter: host routes under /tollai/* still pass through', async () => {
  const { toll } = makeAgentToll();
  await withServer(toll, async (base) => {
    const r = await doRequest(base, '/tollai/events', { method: 'POST', ua: 'axios/1.6.2', body: { e: 1 } });
    assert.equal(r.res.statusCode, 200);
    assert.equal(JSON.parse(r.data).ingested, true);
  });
});

test('node-http adapter: mode off bypasses the toll', async () => {
  const toll = createTollaiMiddlewareable({ mode: 'off' });
  await withServer(toll.toll, async (base) => {
    const r = await doRequest(base, '/api/news', { ua: 'axios/1.6.2' });
    assert.equal(r.res.statusCode, 200);
    assert.equal(JSON.parse(r.data).source, 'news');
  });
});

function createTollaiMiddlewareable({ mode }) {
  return {
    toll: createToll({ secret: 's2', powDifficulty: 8, clientSource: 'c', mode, protect: ['/api/**'] }),
  };
}