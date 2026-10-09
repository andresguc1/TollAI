import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { CLIENT_SOURCE } from '../../client/client-source.js';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const RAW_CLIENT = path.join(ROOT, 'client', 'tollai-client.js');

const DIFFICULTY = 14;
const DWELL_REQUIRED_MS = 1500;
const ORIGIN = 'http://localhost:3000';

const state = { jar: '', challenge: '', nonce: '', dwellMs: 0, verified: 0, issued: 0 };

function stubRes(status, data) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(data) });
}

function dwellNow() {
  if (state.verifyTime) state.dwellMs = Math.max(state.dwellMs, Date.now() - state.verifyTime);
  return state.dwellMs;
}

const fakeFetch = (input, init = {}) => {
  const u = new URL(String(input), ORIGIN);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : undefined;

  if (u.pathname === '/tollai/challenge') {
    state.challenge = 'challenge-' + Date.now() + '-' + state.issued++;
    return stubRes(200, { challenge: state.challenge, difficulty: DIFFICULTY, expires_in: 60000 });
  }
  if (u.pathname === '/tollai/verify') {
    state.verified += 1;
    state.jar = `tollai_session=session-${state.verified}`;
    state.verifyTime = Date.now();
    return stubRes(200, { verified: true, work_ms: 9, difficulty: DIFFICULTY });
  }
  if (u.pathname === '/tollai/dwell') {
    if (!state.jar) return stubRes(401, { ok: false, code: 'NO_SESSION' });
    const ms = dwellNow();
    return stubRes(200, { ok: true, dwell_ms: ms, required_ms: DWELL_REQUIRED_MS, settled: ms >= DWELL_REQUIRED_MS });
  }
  if (u.pathname === '/api/finance/transfer' && method === 'POST') {
    if (!state.jar) return stubRes(401, { code: 'ATTESTATION_REQUIRED' });
    const ms = dwellNow();
    if (ms < DWELL_REQUIRED_MS) {
      return stubRes(428, {
        code: 'DWELL_REQUIRED',
        dwell_ms: ms,
        required_ms: DWELL_REQUIRED_MS,
        retry_after_ms: DWELL_REQUIRED_MS - ms,
      });
    }
    return stubRes(200, { toll_metadata: { transparent: true } });
  }
  if (u.pathname === '/api/news') {
    if (state.jar) return stubRes(200, { toll_metadata: { transparent: true } });
    return stubRes(401, { code: 'ATTESTATION_REQUIRED' });
  }
  return stubRes(404, { error: 'not found' });
};

const html = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
const pill = { className: '', textContent: '', parentNode: null, style: { cssText: '' } };
const liveTimers = new Map();
let timerSeq = 0;

const sandbox = {
  console,
  setTimeout,
  clearInterval: h => { const t = liveTimers.get(h); if (t) { clearInterval(t); liveTimers.delete(h); } },
  setInterval: (fn, ms) => { const h = { id: ++timerSeq }; liveTimers.set(h, setInterval(fn, ms)); return h; },
  Math,
  Date,
  parseInt,
  Uint32Array,
  Promise,
  Error,
  JSON,
  URL,
  document: {
    hidden: false,
    readyState: 'complete',
    documentElement: html,
    body: { appendChild(el) { pill.parentNode = { removeChild() { pill.parentNode = null; } }; return el; } },
    getElementById: id => (id === 'tollai-pill' ? pill : null),
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.location = { reload() { throw new Error('reload called'); }, href: ORIGIN + '/news' };
sandbox.fetch = fakeFetch;

vm.createContext(sandbox);

function runClient(source) {
  return vm.runInContext(source, sandbox, { filename: 'tollai-client.js' });
}

function leadingZeroBits(hex) {
  let bits = 0;
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    if (n === 0) { bits += 4; continue; }
    bits += Math.clz32(n) - 28;
    break;
  }
  return bits;
}

test('client-source.js is the shipped raw client script', () => {
  const raw = fs.readFileSync(RAW_CLIENT, 'utf8');
  assert.equal(CLIENT_SOURCE, raw);
});

test('client-source.js is a parsable module and valid script', () => {
  assert.equal(typeof CLIENT_SOURCE, 'string');
  assert.match(CLIENT_SOURCE, /window\.fetch\s*=/);
  assert.match(CLIENT_SOURCE, /window\.TollAI\s*=/);
  new vm.Script(CLIENT_SOURCE);
});

test('build-client.mjs regenerates client-source.js to parity', () => {
  const modulePath = path.join(ROOT, 'client', 'client-source.js');
  const before = fs.readFileSync(modulePath, 'utf8');
  const script = path.join(ROOT, 'scripts', 'build-client.mjs');
  execFileSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  const after = fs.readFileSync(modulePath, 'utf8');
  assert.equal(after, before, 'regeneration must be byte-identical');
  assert.ok(after.includes(CLIENT_SOURCE), 'regenerated module embeds the same client script');
});

test('client loads, patches fetch and exposes window.TollAI', async (t) => {
  t.test('patches window.fetch and matches PoC surface', () => {
    runClient(CLIENT_SOURCE);
    assert.notEqual(sandbox.window.fetch, fakeFetch);
    assert.equal(typeof sandbox.TollAI.establish, 'function');
    assert.equal(typeof sandbox.TollAI.reset, 'function');
    assert.equal(typeof sandbox.TollAI.solvePow, 'function');
    assert.equal(typeof sandbox.TollAI.sha256, 'function');
    assert.equal(typeof sandbox.TollAI.workMs, 'function');
    assert.equal(typeof sandbox.TollAI.attempts, 'function');
  });
});

test('establish() solves a valid proof of work without deadlocking', { timeout: 30000 }, async () => {
  const t0 = Date.now();
  await sandbox.TollAI.establish();
  assert.ok(Date.now() - t0 < 25000);

  const nonce = String(sandbox.__TOLLAI_NONCE__);
  const digest = crypto.createHash('sha256').update(`${sandbox.__TOLLAI_CHALLENGE__}:${nonce}`).digest('hex');
  const zeros = leadingZeroBits(digest);
  assert.ok(zeros >= DIFFICULTY, `${zeros} leading zero bits (need ${DIFFICULTY})`);

  assert.match(state.jar, /^tollai_session=/);
  assert.equal(html.attrs['data-tollai'], 'verified');
  assert.ok(sandbox.TollAI.workMs() >= 0);
  assert.ok(sandbox.TollAI.attempts() >= 1);
});

test('patched fetch to a tolled API passes transparently once attested', async () => {
  const res = await sandbox.fetch('/api/news');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.toll_metadata.transparent, true);
});

test('patched fetch re-proves exactly once after session loss', async () => {
  state.jar = '';
  sandbox.TollAI.reset();
  const before = state.verified;
  const res = await sandbox.fetch('/api/news');
  assert.equal(res.status, 200);
  assert.equal(state.verified, before + 1, 'exactly one re-proof');
});

test('browser client waits out the dwell invisibly before mutating', { timeout: 20000 }, async () => {
  if (sandbox.__TOLLAI_DWELL_TIMER__) sandbox.clearInterval(sandbox.__TOLLAI_DWELL_TIMER__);
  state.jar = '';
  sandbox.TollAI.reset();

  const res = await sandbox.fetch('/api/finance/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 100, recipient: 'ACC-1' }),
  });
  assert.equal(res.status, 200, 'retries must eventually succeed without surfacing an error');
});

test('a valid session never re-pays proof of work on a page load', async () => {
  if (sandbox.__TOLLAI_DWELL_TIMER__) sandbox.clearInterval(sandbox.__TOLLAI_DWELL_TIMER__);
  const established = state.verified;
  sandbox.window.TOLLAI_SESSION = true;
  await sandbox.fetch('/api/news');
  sandbox.window.TOLLAI_SESSION = false;
  assert.equal(state.verified, established, 'no new proof of work when session is valid');
});