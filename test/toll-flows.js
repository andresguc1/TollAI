/* End-to-end check of the two client populations TollAI must tell apart.
 *
 * HUMAN   -> browser fingerprint, pays proof of work once, then transparent
 * AGENT   -> axios fingerprint, gets the reasoning challenge, answers in 0ms
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
  'Sec-CH-UA': '"Chromium";v="126", "Not:A-Brand";v="24"',
  'Upgrade-Insecure-Requests': '1'
};

const AGENT_HEADERS = {
  'User-Agent': 'axios/1.6.2',
  'Content-Type': 'application/json'
};

function request(method, path, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body === undefined ? null : JSON.stringify(body);
    const hdrs = { ...headers };
    if (payload) hdrs['Content-Length'] = Buffer.byteLength(payload);
    if (cookie) hdrs.Cookie = cookie;

    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: hdrs
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* html */ }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function leadingZeroBits(hex) {
  let bits = 0;
  for (let i = 0; i < hex.length && bits < 64; i++) {
    const nib = parseInt(hex[i], 16);
    if (nib === 0) { bits += 4; continue; }
    bits += Math.clz32(nib) - 28;
    break;
  }
  return bits;
}

function solvePow(challenge, difficulty) {
  for (let nonce = 0; nonce < 4e9; nonce++) {
    const d = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest('hex');
    if (leadingZeroBits(d) >= difficulty) return String(nonce);
  }
  throw new Error('pow exhausted');
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  /* ---------------- HUMAN: browser ---------------- */
  console.log('\n── HUMAN (browser) ──────────────────────────────');

  const nav = await request('GET', '/news', { headers: BROWSER_HEADERS });
  check('page nav without session returns attestation shell (200, not a puzzle)',
    nav.status === 200 && /TollAI/.test(nav.body) && /tollai-client\.js/.test(nav.body),
    `status ${nav.status}`);

  const ch = await request('GET', '/tollai/challenge');
  const nonce = solvePow(ch.json.challenge, ch.json.difficulty);
  const t0 = Date.now();
  const verify = await request('POST', '/tollai/verify', {
    headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json' },
    body: { challenge: ch.json.challenge, nonce }
  });
  const setCookie = (verify.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  check('proof of work verifies and mints a session',
    verify.json && verify.json.verified === true && !!setCookie,
    `${Date.now() - t0}ms wall, server measured ${verify.json && verify.json.work_ms}ms`);

  const api = await request('GET', '/api/news', {
    headers: { ...BROWSER_HEADERS, Accept: '*/*', 'Sec-Fetch-Mode': 'cors' },
    cookie: setCookie
  });
  check('tolled API passes transparently with a session',
    api.status === 200 && api.json && api.json.toll_metadata && api.json.toll_metadata.transparent === true,
    `status ${api.status}, transparent=${api.json && api.json.toll_metadata && api.json.toll_metadata.transparent}`);

  const page = await request('GET', '/news', { headers: BROWSER_HEADERS, cookie: setCookie });
  check('tolled page serves real content with session',
    page.status === 200 && /TechDaily/.test(page.body),
    `status ${page.status}`);

  const pageNoInject = !/tollai-client\.js/.test(page.body);
  check('page injects the toll client', !pageNoInject, pageNoInject ? 'client tag missing' : 'present');

  /* ---------------- AGENT: axios ---------------- */
  console.log('\n── AGENT (axios, no JS) ──────────────────────────');

  const agentFirst = await request('POST', '/api/podcast/transcript', {
    headers: AGENT_HEADERS, body: { episode_id: 'ALL', asr: true }
  });
  check('agent gets the reasoning challenge (433)',
    agentFirst.status === 433 && agentFirst.json && !!agentFirst.json.challenge,
    `status ${agentFirst.status}`);

  const agentNoSession = await request('GET', '/api/news', { headers: AGENT_HEADERS });
  check('agent cannot obtain a session by skipping JS',
    agentFirst.status === 433 && agentNoSession.status === 433,
    `status ${agentNoSession.status}`);

  // Solve at machine speed using the same solver logic as the simulator.
  const fs = require('fs');
  const path = require('path');
  const simPath = path.join(__dirname, '..', 'attackers', 'agent-simulator.js');
  const src = fs.readFileSync(simPath, 'utf8');
  const start = src.indexOf('_solveLocal(challenge) {');
  let depth = 0, end = src.indexOf('{', start);
  for (let i = end; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const solveLocal = eval('({' + src.slice(start, end + 1) + '})._solveLocal');

  const answer = solveLocal({ question: agentFirst.json.challenge }).value;
  const solved = await request('POST', '/api/podcast/transcript', {
    headers: {
      ...AGENT_HEADERS,
      'x-ai-proof': agentFirst.json.challenge_id,
      'x-challenge-response': String(answer)
    },
    body: { episode_id: 'ALL', asr: true }
  });
  check('machine-speed answer is blocked (403 AI_AGENT_DETECTED)',
    solved.status === 403 && solved.json && solved.json.code === 'AI_AGENT_DETECTED',
    `status ${solved.status}, reason=${solved.json && solved.json.reason}, ${solved.json && solved.json.response_time_ms}ms`);

  /* ---------------- BURST ---------------- */
  console.log('\n── AGENT (burst on a valid session) ───────────────');

  const cookie = setCookie;
  let burstStatus = null, burstBody = null;
  // Fire in parallel batches so the whole chain lands inside one 10s window.
  outer:
  for (let batch = 0; batch < 8; batch++) {
    const rs = await Promise.all(Array.from({ length: 10 }, () =>
      request('GET', '/api/news', { headers: { ...BROWSER_HEADERS, Accept: '*/*' }, cookie })));
    const hit = rs.find(r => r.status === 403);
    if (hit) { burstStatus = hit.status; burstBody = hit.json; break outer; }
  }
  check('request burst inside a session is blocked (BURST_RATE)',
    burstStatus === 403 && burstBody && burstBody.reason === 'BURST_RATE',
    burstBody ? `reason=${burstBody.reason}` : 'never tripped in 45 requests');

  const summary = results.filter(r => r.pass).length;
  console.log(`\n${summary}/${results.length} checks passed`);
  process.exit(summary === results.length ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
