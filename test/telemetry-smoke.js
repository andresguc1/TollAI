/* Drives one agent request and one full human session so the observability
 * dashboard has both populations plus real LLM token usage to display.
 */
const http = require('http');
const crypto = require('crypto');

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

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Sec-Fetch-Mode': 'cors',
      'Sec-CH-UA': '"Chromium";v="126"'
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cookie) headers.Cookie = cookie;

    const r = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ s: res.statusCode, h: res.headers, d }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  console.log('— agente —');
  const agent = await req('GET', '/api/health/records');
  console.log('  GET /api/health/records ->', agent.s, JSON.parse(agent.d).code);

  console.log('— humano —');
  const ch = JSON.parse((await req('GET', '/tollai/challenge')).d);
  let n = 0;
  for (;; n++) {
    if (lzb(crypto.createHash('sha256').update(`${ch.challenge}:${n}`).digest('hex')) >= ch.difficulty) break;
  }
  const v = await req('POST', '/tollai/verify', { challenge: ch.challenge, nonce: String(n) });
  const jar = v.h['set-cookie'][0].split(';')[0];
  console.log('  PoW pagado, sesión', jar.slice(0, 22) + '…');

  const read = await req('GET', '/api/news', undefined, jar);
  console.log('  GET  /api/news  ->', read.s, JSON.parse(read.d).toll_metadata.transparent ? 'transparente' : '?');

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 400));
    await req('POST', '/tollai/dwell', {}, jar);
  }

  const chat = JSON.parse((await req('POST', '/api/chat', { message: 'resume TollAI en dos frases' }, jar)).d);
  console.log('  POST /api/chat  ->', 'usage:', JSON.stringify(chat.usage), 'model:', chat.model);

  const un = JSON.parse((await req('POST', '/unprotected/chat', { message: 'hola' })).d);
  console.log('  POST /unprotected/chat -> usage:', JSON.stringify(un.usage));

  const snap = await req('GET', '/tollai/telemetry?limit=300');
  const d = JSON.parse(snap.d);
  console.log('\n— telemetría —');
  console.log('  clients:', d.clients.map(c => `${c.client}(req ${c.requests}, toll ${c.triggered}, bloq ${c.blocked}, tok ${c.promptTokens + c.completionTokens})`).join('  '));
  console.log('  counters:', JSON.stringify(d.counters));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });