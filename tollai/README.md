# tollai

Universal, **zero-dependency** cognitive toll for Node and edge runtimes. It
distinguishes humans from autonomous agents with four layers — proof-of-work,
IP-bound sessions, dwell time and anti-burst — without ever showing a puzzle to
a real person.

- Framework-agnostic core (`createToll()`), adapters for **node:http**,
  **Express**, **Vercel**, **Cloudflare** and **Firebase**.
- ESM. Node **>= 20.19**. No runtime dependencies.
- Ships the browser client and TypeScript declarations.

## Install

```bash
npm install tollai
```

## Quick start (Express)

```js
const express = require('express');
const { createToll } = require('tollai');
const { tollaiMiddleware } = require('tollai/express');
const { CLIENT_SOURCE } = require('tollai/client');

const app = express();
app.use(express.json());

const toll = createToll({
  mode: 'gate',                 // 'gate' = protect everything mounted below
  powDifficulty: 14,            // ~450 ms in a browser
  minDwellMs: 1500,             // dwell required before POST mutations
  minResponseTime: 1500,        // answers faster than this are blocked
  clientSource: CLIENT_SOURCE,  // served by the core at /tollai/client.js
  onAIAgentDetected: (a) => console.warn('agent blocked:', a.reason, a.ip),
});

// Protect a mutating endpoint. The core also answers the protocol endpoints
// (/tollai/challenge, /tollai/verify, /tollai/dwell, /tollai/status and the
// client at clientPath) before any policy runs, so those are never tolled.
app.post('/api/data', tollaiMiddleware(toll), (req, res) => {
  res.json({ ok: true, data: req.body });
});
```

> To serve the browser client from a custom URL, set `clientPath` and add your
> own route that returns `CLIENT_SOURCE`.

## Plain node:http

```js
import http from 'node:http';
import { createToll } from 'tollai';
import { runNode } from 'tollai/node-http';

const toll = createToll({ mode: 'gate', powDifficulty: 14 });

http.createServer((req, res) => {
  runNode(req, res, () => {
    // Request passed the toll (human or valid session).
    res.end('ok');
  }, toll);
}).listen(3000);
```

## Adapters

| Runtime | Import | Entry points |
|---------|--------|--------------|
| Express | `tollai/express` | `tollaiMiddleware(toll)`, `createTollaiMiddleware(toll)` |
| node:http | `tollai/node-http` | `runNode(req, res, next, toll)`, `createTollaiMiddleware(toll)` |
| Vercel | `tollai/vercel` | `tollaiVercel(toll, downstream?)` |
| Cloudflare | `tollai/cloudflare` | `createCloudflareTollHandler(toll, origin?)` |
| Firebase | `tollai/firebase` | `tollaiOnRequest(toll, downstream)` |

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `mode` | `'api'` | `'api'` (only `protect` globs), `'gate'` (everything mounted), `'off'` (bypass) |
| `protect` | `['/api/*']` | Glob patterns to toll in `'api'` mode |
| `exclude` | `[]` | Globs never tolled |
| `powDifficulty` | `14` | SHA-256 leading zero bits for the proof of work |
| `powTTL` | `30000` | PoW challenge lifetime (ms) |
| `sessionTTL` | `900000` | Session cookie TTL (ms, sliding) |
| `cookieName` | `'tollai_session'` | Session cookie name |
| `secure` | auto | Force the `Secure` cookie flag |
| `minDwellMs` | `1500` | Dwell required before POST mutations (ms) |
| `minResponseTime` | `1500` | Fastest accepted challenge answer (ms) |
| `challengeTTL` | `60000` | Cognitive (433) challenge lifetime (ms) |
| `rateWindowMs` | `10000` | Anti-burst window (ms) |
| `rateLimit` | `30` | Max requests per window per session |
| `sessionQuota` | `120` | Requests per session before re-proof |
| `maxSessions` | `10000` | In-memory session cap |
| `clientSource` | `''` | The client script source served at `clientPath` |
| `clientPath` | `'/tollai/client.js'` | URL the attestation shell loads the client from |
| `secret` | auto | HMAC secret for tokens; **required** in production |

### Hook options

| Hook | Fires with |
|------|------------|
| `onDecision(payload)` | Every toll decision (`decision`, `signal`, `ip`, `path`, `scenario`, `latencyMs`, …) |
| `onAIAgentDetected(alert)` | Agent detection (`reason`: `MACHINE_SPEED` / `BURST_RATE`, `ip`, `userAgent`, …) |
| `onSessionIssued(event)` | A session was minted (`source`: `'pow'` / `'challenge'`, `ip`, `workMs`, …) |
| `onDwellDeferred(event)` | A mutation was deferred for dwell (`dwellMs`, `requiredMs`, `ip`) |

## How it behaves

- **GET is never tolled.** Reading is instant; only POST/mutations require dwell.
- A browser without a session navigating to a protected page receives a **200
  HTML shell** that pays the proof of work in the background, then reloads.
- A JavaScript-less agent receives a **433** with an obfuscated challenge. An
  answer faster than `minResponseTime` is blocked as `MACHINE_SPEED` even if
  correct. Three failures → the next attempt is `403`.
- A session that exceeds the burst window/quota gets `403 AI_AGENT_DETECTED`
  (`BURST_RATE`) or `428 REPROOF_REQUIRED`.

## TypeScript

Types ship with the package and resolve through the `exports` map:

```ts
import { createToll } from 'tollai';
import type { TollOptions, Toll } from 'tollai';
```

## License

MIT
