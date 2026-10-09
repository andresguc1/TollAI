import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tollaiVercel } from '../../adapters/vercel.js';
import { makeAgentToll } from './helpers.mjs';

function mockRes() {
  const res = {
    headers: {},
    statusCode: 200,
    writableEnded: false,
    setHeader(k, v) { this.headers[k] = v; },
    appendHeader(k, v) { (this.headers[k] ||= []).push(v); },
    end(b) { this.writableEnded = true; this.data = String(b || ''); },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.jsonBody = o; },
  };
  return res;
}

function mockReq(overrides = {}) {
  const req = {
    method: 'GET',
    url: '/api/news',
    headers: { host: 'app.vercel.test', 'user-agent': 'axios/1.6.2', accept: '*/*' },
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides,
  };
  return req;
}

test('vercel adapter: agent without session is answered by the toll (downstream untouched)', async () => {
  const { toll } = makeAgentToll();
  const downstream = async (req, res) => { res.statusCode = 200; res.end('downstream'); };
  const fn = tollaiVercel(toll, downstream);
  const req = mockReq();
  const res = mockRes();
  await fn(req, res);
  assert.equal(res.statusCode, 433);
  assert.equal(JSON.parse(res.data).scenario, 'generic');
  assert.equal(res.writableEnded, true);
});

test('vercel adapter: untolled request reaches the downstream handler', async () => {
  const { toll } = makeAgentToll();
  let seen = 0;
  const downstream = async (req, res) => { seen += 1; res.statusCode = 200; res.end('downstream'); };
  const fn = tollaiVercel(toll, downstream);
  const res = mockRes();
  await fn(mockReq({ url: '/robots.txt' }), res);
  assert.equal(seen, 1);
  assert.equal(res.data, 'downstream');
});

test('vercel adapter: mode off bypasses the toll entirely', async () => {
  const { toll } = makeAgentToll({ mode: 'gate' });
  let seen = 0;
  const fn = tollaiVercel(toll, async (req, res) => { seen += 1; res.statusCode = 200; res.end('ok'); });
  const res = mockRes();
  await fn(mockReq({ tollMode: 'unprotected' }), res);
  assert.equal(seen, 1);
});

test('vercel adapter: rejects a missing toll or bad downstream', () => {
  assert.throws(() => tollaiVercel(null, () => {}));
  assert.throws(() => tollaiVercel({ handle: () => null }, 'not-a-function'));
});