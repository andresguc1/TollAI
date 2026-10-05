/* Runs public/tollai-client.js in a browser-shaped sandbox against the live
 * server, so the real bootstrap path is exercised (this is where the
 * fetch-patching recursion used to deadlock).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const CLIENT = path.join(__dirname, '..', 'public', 'tollai-client.js');
const BASE = { hostname: 'localhost', port: 3000 };
const ORIGIN = 'http://localhost:3000';

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function nodeFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url, ORIGIN);
    const body = init.body;
    const headers = {
      'User-Agent': BROWSER_UA,
      Accept: init.headers && init.headers.Accept ? init.headers.Accept : '*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Sec-Fetch-Mode': init.mode === 'navigate' ? 'navigate' : 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Dest': init.mode === 'navigate' ? 'document' : 'empty',
      'Sec-CH-UA': '"Chromium";v="126", "Not:A-Brand";v="24"'
    };
    if (init.credentials === 'same-origin') headers.Cookie = process.env.__JAR__ || '';
    if (init.headers) Object.assign(headers, init.headers);
    if (body) headers['Content-Length'] = Buffer.byteLength(body);

    const req = http.request({ ...BASE, method: init.method || 'GET', path: u.pathname + u.search, headers }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) process.env.__JAR__ = setCookie.map(c => c.split(';')[0]).join('; ');
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: h => res.headers[h.toLowerCase()] },
          rawHeaders: res.headers,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data)
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Minimal DOM the client actually touches.
const html = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
const pill = { className: '', textContent: '', parentNode: null, style: { cssText: '' } };
const liveTimers = new Map();
let timerSeq = 0;
const sandbox = {
  console,
  setTimeout,
  clearInterval: h => { const t = liveTimers.get(h); if (t) { clearInterval(t); liveTimers.delete(h); } },
  setInterval: (fn, ms) => {
    const h = { id: ++timerSeq };
    liveTimers.set(h, setInterval(fn, ms));
    return h;
  },
  Math,
  Date,
  parseInt,
  Uint32Array,
  Promise,
  Error,
  JSON,
  document: {
    hidden: false,
    documentElement: html,
    body: { appendChild(el) { pill.parentNode = { removeChild() { pill.parentNode = null; } }; return el; } },
    getElementById: id => (id === 'tollai-pill' ? pill : null)
  }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.fetch = nodeFetch;
sandbox.location = { reload() { throw new Error('reload called'); }, href: ORIGIN + '/news' };

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: 'tollai-client.js' });

function solvePowLocal(challenge, difficulty) {
  const crypto = require('crypto');
  function lzb(hex) {
    let bits = 0;
    for (const ch of hex) {
      const n = parseInt(ch, 16);
      if (n === 0) { bits += 4; continue; }
      bits += Math.clz32(n) - 28;
      break;
    }
    return bits;
  }
  for (let n = 0; n < 4e9; n++) {
    if (lzb(crypto.createHash('sha256').update(`${challenge}:${n}`).digest('hex')) >= difficulty) return String(n);
  }
  throw new Error('pow exhausted');
}

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const watchdog = setTimeout(() => {
  console.error('\nWATCHDOG: suite exceeded 90s — a flow is hanging');
  process.exit(1);
}, 90000);
watchdog.unref();

(async () => {
  check('client loads and patches window.fetch', sandbox.window.fetch !== nodeFetch);
  check('exposes window.TollAI', !!(sandbox.TollAI && sandbox.TollAI.establish));

  // The bootstrap must complete instead of deadlocking on itself.
  const t0 = Date.now();
  let settled = 'pending';
  await Promise.race([
    sandbox.TollAI.establish().then(() => { settled = 'ok'; }, e => { settled = 'err:' + e.message; }),
    new Promise(r => setTimeout(r, 30000))
  ]);
  check('establish() resolves (no fetch-patch recursion)',
    settled === 'ok', `settled=${settled} in ${Date.now() - t0}ms`);

  // The nonce is luck-dependent, so assert the work is *valid*, not large.
  const crypto = require('crypto');
  const nonce = String(sandbox.__TOLLAI_NONCE__);
  const digest = crypto.createHash('sha256')
    .update(`${sandbox.__TOLLAI_CHALLENGE__}:${nonce}`).digest('hex');
  let zeros = 0;
  for (const ch of digest) { const n = parseInt(ch, 16); if (n === 0) { zeros += 4; continue; } zeros += Math.clz32(n) - 28; break; }
  check('client PoW solution really satisfies the difficulty',
    zeros >= 14, `${zeros} leading zero bits (need 14), ${sandbox.TollAI.attempts()} hashes, ${sandbox.TollAI.workMs()}ms`);

  check('session cookie was stored', /tollai_session/.test(process.env.__JAR__ || ''),
    (process.env.__JAR__ || '').slice(0, 40) + '…');

  check('document flagged as verified', html.attrs['data-tollai'] === 'verified', html.attrs['data-tollai']);

  // Patched fetch to a tolled endpoint must now pass through silently.
  const api = await sandbox.fetch('/api/news');
  const apiJson = await api.json();
  check('patched fetch to tolled API returns 200 transparently',
    api.status === 200 && apiJson.toll_metadata && apiJson.toll_metadata.transparent === true,
    `status ${api.status}`);

  // And must survive a wiped session by re-proving exactly once.
  process.env.__JAR__ = '';
  sandbox.TollAI.reset();
  const again = await sandbox.fetch('/api/news');
  check('patched fetch re-proves after session loss (single retry)',
    again.status === 200, `status ${again.status}`);

  /* ---------------- dwell ---------------- */
  // Reading is instant; acting requires accumulated time on the page.
  async function mintIsolatedSession() {
    const ch = await (await nodeFetch('/tollai/challenge')).json();
    const nonce = solvePowLocal(ch.challenge, ch.difficulty);
    const v = await nodeFetch('/tollai/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: ch.challenge, nonce })
    });
    const jar = (v.rawHeaders['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    return jar;
  }

  const isolated = await mintIsolatedSession();
  check('isolated proof mints a session for dwell testing', !!isolated);

  const tooSoon = await nodeFetch('/api/finance/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: isolated },
    body: JSON.stringify({ amount: 100, recipient: 'ACC-1' })
  });
  const tooSoonBody = await tooSoon.json();
  check('mutation with zero dwell is rejected (DWELL_REQUIRED)',
    tooSoon.status === 428 && tooSoonBody.code === 'DWELL_REQUIRED',
    `status ${tooSoon.status} code=${tooSoonBody.code} retry_after=${tooSoonBody.retry_after_ms}ms`);

  const readOk = await nodeFetch('/api/finance/balance', {
    headers: { Accept: '*/*', Cookie: isolated }
  });
  check('reads stay instant while dwell is still unpaid',
    readOk.status === 200, `status ${readOk.status}`);

  // Let the human actually look at the page.
  let dwellSettled = false;
  for (let i = 0; i < 6 && !dwellSettled; i++) {
    await new Promise(r => setTimeout(r, 400));
    const beat = await (await nodeFetch('/tollai/dwell', {
      method: 'POST', headers: { Cookie: isolated }
    })).json();
    dwellSettled = !!beat.settled;
  }
  check('dwell heartbeats accumulate until settled', dwellSettled);

  const afterDwell = await nodeFetch('/api/finance/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: isolated },
    body: JSON.stringify({ amount: 100, recipient: 'ACC-1' })
  });
  check('mutation succeeds once dwell is settled',
    afterDwell.status === 200, `status ${afterDwell.status}`);

  // And the client hides all of this from the user.
  const hidden = await sandbox.fetch('/api/finance/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 100, recipient: 'ACC-2' })
  });
  check('browser client waits out the dwell invisibly (no error surfaced)',
    hidden.status === 200, `status ${hidden.status}`);

  /* ---------------- no re-paying PoW per page load ---------------- */
  // The server tells the client the cookie is already good; a normal page load
  // must therefore cost zero CPU (this regressed once already).
  let rePays = 0;
  const realFetch = sandbox.fetch;
  sandbox.fetch = function (u, i) {
    if (String(u).indexOf('/tollai/') === 0) rePays++;
    return realFetch(u, i);
  };
  const freshCtx = { ...sandbox, TOLLAI_SESSION: true };
  sandbox.TOLLAI_SESSION = true;
  await sandbox.fetch('/api/news');
  sandbox.TOLLAI_SESSION = false;
  check('valid session means no new proof of work on a page load', rePays === 0,
    `${rePays} protocol calls`);

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} client checks passed`);
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
