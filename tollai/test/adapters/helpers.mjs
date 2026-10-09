import { request as httpRequest } from 'node:http';
import { createToll } from '../../core/index.js';
import { solvePow } from '../../core/pow.js';

export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

export function makeAgentToll(overrides = {}) {
  const agents = [];
  const sessions = [];
  return {
    toll: createToll({
      secret: 'test-secret',
      powDifficulty: 8,
      clientSource: '/* client */',
      mode: 'api',
      protect: ['/api/**'],
      minDwellMs: 1500,
      onAIAgentDetected: (d) => agents.push(d),
      onSessionIssued: () => sessions.push(1),
      ...overrides,
    }),
    agents,
    sessions,
  };
}

export function extractAnswer(plaintext) {
  if (plaintext.includes('Calculate the result')) {
    const expr = plaintext.match(/Calculate the result of:\s*(.+)/)[1];
    return String(Function(`"use strict"; return (${expr});`)());
  }
  if (plaintext.includes('2, 6, 12, 20, 30')) return '42';
  if (plaintext.includes('multiply my age')) {
    const [, mult, sub, div, result] = plaintext
      .match(/multiply my age by (\d+), subtract (\d+), and divide by (\d+), you get (\d+)/)
      .map(Number);
    return String((result * div + sub) / mult);
  }
  if (plaintext.includes('Madrid')) return '282';
  if (plaintext.includes('30 people')) return '5';
  if (plaintext.includes('snail climbs')) return '8';
  if (plaintext.includes('overtake the second')) return 'second';
  if (plaintext.includes('3 apples')) return '1';
  if (plaintext.includes('Ana is taller')) return 'ana';
  if (plaintext.includes('all blocks are cubes')) return 'yes';
  if (plaintext.includes('rains, the ground gets wet')) return 'cannot be determined';
  if (plaintext.includes('All roses')) return 'no';
  if (plaintext.includes('two ropes')) {
    return 'Light both ends of rope 1 and one end of rope 2. When rope 1 finishes (30 min), light the other end of rope 2. It burns for 15 more min.';
  }
  if (plaintext.includes('Sum:')) return String(Function(`"use strict"; return ${plaintext.replace('Sum:', '')};`)());
  if (plaintext.includes('Product:')) return String(Function(`"use strict"; return ${plaintext.replace('Product:', '')};`)());
  throw new Error('unhandled challenge: ' + plaintext);
}

export function doRequest(base, path, { method = 'GET', ua = BROWSER_UA, accept = '*/*', headers = {}, body, jar = '', delayMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const h = {
      'User-Agent': ua,
      Accept: accept,
      'Accept-Language': 'es-ES,es;q=0.9',
      'Sec-Fetch-Mode': method === 'GET' ? 'navigate' : 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Dest': method === 'GET' ? 'document' : 'empty',
      'Sec-CH-UA': '"Chromium";v="126"',
      ...headers,
    };
    if (jar) h.Cookie = jar;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    setTimeout(() => {
      const req = httpRequest(new URL(path, base), { method, headers: h }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const setCookie = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            if (res.rawHeaders[i].toLowerCase() === 'set-cookie') setCookie.push(res.rawHeaders[i + 1]);
          }
          resolve({ res, data, setCookie });
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    }, delayMs);
  });
}

export async function mint(base, doReq) {
  const ch = JSON.parse((await doReq('/tollai/challenge')).data);
  const nonce = await solvePow(ch.challenge, ch.difficulty, { maxIterations: 2e6 });
  const ver = await doReq('/tollai/verify', { method: 'POST', body: { challenge: ch.challenge, nonce } });
  return ver.setCookie.map((c) => c.split(';')[0]).join('; ');
}

export async function withLiveServer(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}