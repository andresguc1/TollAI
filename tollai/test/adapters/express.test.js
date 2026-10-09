import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

import { tollaiMiddleware } from '../../adapters/express.js';
import { decodeChallenge } from '../../core/challenge.js';
import { doRequest, extractAnswer, makeAgentToll, mint, withLiveServer } from './helpers.mjs';

function makeApp(toll) {
  const app = express();
  app.use(express.json());
  app.use(tollaiMiddleware(toll));
  app.get('/api/news', (req, res) =>
    res.json({ source: 'news', toll_metadata: req.tollMetadata || {}, locals: res.locals.tollai }),
  );
  app.post('/api/finance/transfer', (req, res) => res.json({ ok: true, amount: req.body && req.body.amount }));
  app.post('/tollai/events', (req, res) => res.json({ ingested: true, got: req.body }));
  app.get('/bye', (req, res) => res.json({ path: 'bye' }));
  return app;
}

async function withApp(toll, run) {
  const server = createServer(makeApp(toll));
  await withLiveServer(server, run);
}

test('express adapter: agent without session gets the 433 challenge', async () => {
  const { toll } = makeAgentToll();
  await withApp(toll, async (base) => {
    const r = await doRequest(base, '/api/news', { ua: 'axios/1.6.2' });
    assert.equal(r.res.statusCode, 433);
    const body = JSON.parse(r.data);
    assert.equal(typeof body.ciphertext, 'string');
    assert.ok(!('challenge' in body));
  });
});

test('express adapter: browser navigation without session gets the attestation shell', async () => {
  const { toll } = makeAgentToll();
  await withApp(toll, async (base) => {
    const r = await doRequest(base, '/api/news', { accept: 'text/html' });
    assert.equal(r.res.statusCode, 200);
    assert.match(r.data, /TollAI/);
    assert.match(r.data, /tollai\/client\.js/);
  });
});

test('express adapter: minted session reaches the route with req metadata + res.locals', async () => {
  const { toll, sessions } = makeAgentToll();
  await withApp(toll, async (base) => {
    const jar = await mint(base, (p, o) => doRequest(base, p, o));
    assert.equal(sessions.length, 1);
    const r = await doRequest(base, '/api/news', { jar, accept: 'application/json' });
    assert.equal(r.res.statusCode, 200);
    const body = JSON.parse(r.data);
    assert.equal(body.toll_metadata.transparent, true);
    assert.equal(body.locals.verified, true);
    assert.equal(typeof body.locals.requestId, 'string');
    assert.ok(r.res.rawHeaders.some((h) => h.toLowerCase() === 'x-request-id'));
  });
});

test('express adapter: pass-through preserves the parsed body for host routes', async () => {
  const { toll } = makeAgentToll({ mode: 'off' });
  await withApp(toll, async (base) => {
    const r = await doRequest(base, '/api/finance/transfer', {
      method: 'POST', body: { amount: 77 },
    });
    assert.equal(r.res.statusCode, 200);
    assert.equal(JSON.parse(r.data).amount, 77);
  });
});

test('express adapter: mutation with zero dwell is deferred', async () => {
  const { toll } = makeAgentToll();
  await withApp(toll, async (base) => {
    const jar = await mint(base, (p, o) => doRequest(base, p, o));
    const r = await doRequest(base, '/api/finance/transfer', { method: 'POST', jar, body: { amount: 10 } });
    assert.equal(r.res.statusCode, 428);
    assert.equal(JSON.parse(r.data).code, 'DWELL_REQUIRED');
  });
});

test('express adapter: untolled routes pass through; host /tollai/* kept', async () => {
  const { toll } = makeAgentToll();
  await withApp(toll, async (base) => {
    const bye = await doRequest(base, '/bye', { ua: 'axios/1.6.2' });
    assert.equal(bye.res.statusCode, 200);
    const events = await doRequest(base, '/tollai/events', {
      method: 'POST', ua: 'axios/1.6.2', body: { e: 'k' },
    });
    assert.equal(events.res.statusCode, 200);
    assert.equal(JSON.parse(events.data).got.e, 'k');
  });
});

test('express adapter: a slow correct answer is admitted', async () => {
  const { toll } = makeAgentToll();
  await withApp(toll, async (base) => {
    const first = JSON.parse((await doRequest(base, '/api/news', { ua: 'axios/1.6.2' })).data);
    const plaintext = decodeChallenge(first.ciphertext, first.meta);
    const second = await doRequest(base, '/api/news', {
      ua: 'axios/1.6.2',
      headers: { 'x-ai-proof': first.challenge_id, 'x-challenge-response': extractAnswer(plaintext) },
      delayMs: 1600,
    });
    assert.equal(second.res.statusCode, 200);
  });
});
test('express adapter: req.tollScenario pins the scenario before the core runs', async () => {
  const { toll } = makeAgentToll();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.tollScenario = 'finance-portal';
    next();
  });
  app.use(tollaiMiddleware(toll));
  app.get('/api/news', (req, res) => res.json({ meta: req.tollMetadata || {} }));
  await withLiveServer(createServer(app), async (base) => {
    const r = await doRequest(base, '/api/news', { ua: 'axios/1.6.2' });
    assert.equal(r.res.statusCode, 433);
    assert.equal(JSON.parse(r.data).scenario, 'finance-portal');
  });
});
