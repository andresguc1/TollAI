#!/usr/bin/env node
/* Load test for TollAI — mixed traffic simulation.
 *
 * Usage:
 *   node test/load-test.js [requests] [concurrency]
 *   node test/load-test.js 1000 50
 *
 * Environment:
 *   TARGET_URL=http://localhost:3000
 *   USE_OLLAMA=false
 */

const http = require('http');
const crypto = require('crypto');

const TARGET = process.env.TARGET_URL || 'http://localhost:3000';
const TOTAL = parseInt(process.argv[2] || '1000', 10);
const CONCURRENCY = parseInt(process.argv[3] || '50', 10);

const AGENT_HEADERS = {
  'User-Agent': 'axios/1.6.2',
  'Content-Type': 'application/json'
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
  'Sec-CH-UA': '"Chromium";v="126"'
};

const SCENARIOS = [
  { method: 'GET', path: '/api/news', headers: AGENT_HEADERS },
  { method: 'GET', path: '/api/git/source-code', headers: AGENT_HEADERS },
  { method: 'GET', path: '/api/health/records', headers: AGENT_HEADERS },
  { method: 'POST', path: '/api/social/post', headers: AGENT_HEADERS, body: { content: 'test', author: 'bot' } },
  { method: 'POST', path: '/api/finance/transfer', headers: AGENT_HEADERS, body: { amount: 100, recipient: 'test' } },
  { method: 'GET', path: '/api/news', headers: BROWSER_HEADERS },
  { method: 'GET', path: '/unprotected/news', headers: { ...AGENT_HEADERS, 'x-tollai-mode': 'unprotected' } },
];

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, TARGET);
    const payload = body === undefined ? null : JSON.stringify(body);
    const hdrs = { ...headers };
    if (payload) hdrs['Content-Length'] = Buffer.byteLength(payload);

    const start = Date.now();
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: hdrs
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          latency: Date.now() - start,
          decision: res.headers['x-tollai-decision'] || 'unknown',
          requestId: res.headers['x-request-id'] || null
        });
      });
    });
    req.on('error', err => resolve({ status: 0, latency: Date.now() - start, error: err.message }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, latency: Date.now() - start, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function lzb(hex) {
  let bits = 0;
  for (const c of hex) {
    const n = parseInt(c, 16);
    if (n === 0) { bits += 4; continue; }
    bits += Math.clz32(n) - 28;
    break;
  }
  return bits;
}

function solvePow(challenge, difficulty) {
  for (let n = 0; n < 4e9; n++) {
    const d = crypto.createHash('sha256').update(`${challenge}:${n}`).digest('hex');
    if (lzb(d) >= difficulty) return String(n);
  }
  throw new Error('pow exhausted');
}

async function run() {
  console.log(`🚀 Load test: ${TOTAL} requests, concurrency ${CONCURRENCY}`);
  console.log(`   Target: ${TARGET}`);
  console.log(`   Scenarios: ${SCENARIOS.length} mixed`);
  console.log('');

  const results = [];
  const semaphore = Array(CONCURRENCY).fill(Promise.resolve());

  async function worker() {
    while (results.length < TOTAL) {
      const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
      const r = await request(scenario.method, scenario.path, {
        headers: scenario.headers,
        body: scenario.body
      });
      results.push(r);
      if (results.length % 100 === 0) {
        console.log(`  ${results.length}/${TOTAL}...`);
      }
    }
  }

  const start = Date.now();
  await Promise.all(semaphore.map(worker));
  const elapsed = Date.now() - start;

  // Stats
  const byStatus = {};
  const byDecision = {};
  let totalLatency = 0;
  let errors = 0;

  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byDecision[r.decision] = (byDecision[r.decision] || 0) + 1;
    totalLatency += r.latency;
    if (r.status === 0 || r.status >= 500) errors++;
  }

  console.log('\n📊 Results:');
  console.log(`  Total time:     ${elapsed}ms`);
  console.log(`  Throughput:     ${(TOTAL / elapsed * 1000).toFixed(1)} req/s`);
  console.log(`  Avg latency:    ${(totalLatency / TOTAL).toFixed(1)}ms`);
  console.log(`  Errors:         ${errors}`);
  console.log('\n  By status:');
  for (const [s, c] of Object.entries(byStatus).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${s}: ${c}`);
  }
  console.log('\n  By TollAI decision:');
  for (const [d, c] of Object.entries(byDecision).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${d}: ${c}`);
  }
}

run().catch(console.error);