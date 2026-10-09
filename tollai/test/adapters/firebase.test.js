import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tollaiOnRequest } from '../../adapters/firebase.js';
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

function mockReq(url = '/api/news', overrides = {}) {
  return {
    method: 'GET',
    url,
    headers: { host: 'meduza.firebase.test', 'user-agent': 'axios/1.6.2', accept: '*/*' },
    socket: { remoteAddress: '10.0.0.2' },
    ...overrides,
  };
}

test('firebase adapter: agent without session is answered by the toll (downstream untouched)', async () => {
  const { toll } = makeAgentToll();
  let seen = 0;
  const fn = tollaiOnRequest(toll, async (req, res) => { seen += 1; res.end('downstream'); });
  const res = mockRes();
  await fn(mockReq(), res);
  assert.equal(res.statusCode, 433);
  assert.equal(JSON.parse(res.data).scenario, 'generic');
  assert.equal(seen, 0);
});

test('firebase adapter: untolled request reaches the downstream handler', async () => {
  const { toll } = makeAgentToll();
  let seen = 0;
  const fn = tollaiOnRequest(toll, async (req, res) => { seen += 1; res.statusCode = 200; res.end('exchange'); });
  const res = mockRes();
  await fn(mockReq('/tollai/events', { method: 'POST' }), res);
  assert.equal(seen, 1);
  assert.equal(res.data, 'exchange');
});

test('firebase adapter: throws when downstream is missing', () => {
  assert.throws(() => tollaiOnRequest({ handle: () => null }, undefined));
  assert.throws(() => tollaiOnRequest(null, async () => undefined));
});