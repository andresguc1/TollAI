# TollAI AGENTS.md

## Quickstart Commands

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Start victim server | `npm start` (port 3000) |
| Start attacker config | `npm run config` (port 3001) |
| Attack all scenarios | `npm run attack` |
| End-to-end human vs agent tests | `npm run test:flows` |
| Browser client sandbox tests | `npm run test:client` |
| Full attack campaign (12/12) | `npm test` |
| Run everything | `npm run test:all` |
| Kill servers | `npm run stop` |

## Architecture

TollAI uses a **4-layer cognitive toll** to distinguish humans from autonomous agents:

1. **PoW (Proof-of-Work)** — SHA-256 hashes; difficulty 14 ≈ 450ms in browser. One PoW amortizes across a session.
2. **Session** — HttpOnly cookie bound to IP, 15-min TTL, amortizes PoW over many requests.
3. **Dwell** — Real time spent on page; `minDwellMs=1500` required before POST mutations.
4. **Anti-burst** — Rate limits: 30 requests/10s per session, 120 requests/session quota.

**Server**: port 3000. **Attacker panel**: port 3001.

## Agent vs Browser Headers

| Category | User-Agent | Key Headers |
|---|---|---|
| **Browser** | `Mozilla/5.0 ... Chrome/126` | Sec-Fetch-Mode, Sec-Fetch-Site, Sec-CH-UA, accept: text/html |
| **Agent/axios** | `axios/1.6.2` | Content-Type: application/json, no Sec-Fetch headers |

## Test Suites

- `npm run test:flows` — 9 checks: human gets transparent pass, agent gets 433 challenge + 403 blocked
- `npm run test:client` — 15 checks: runs `public/tollai-client.js` in a `vm` sandbox; exercises fetch-patching, dwell, session reuse
- `npm test` (aka `npm run attack`) — 12 scenarios, must stay at 100% blocked (machine-speed agents)
- `USE_OLLAMA=true npm run attack` — enables LLM-backed agent (slower but still blocked by timing)

## Environment Variables

```bash
TOLLAI_POW_DIFFICULTY=14    # PoW difficulty (default 14 ≈ 450ms in browser)
MIN_RESPONSE_TIME=1500      # Machine-speed threshold in ms (default 1500)
CHALLENGE_TTL=60000         # Challenge expiry in ms (default 60000)
USE_OLLAMA=true             # Enable real LLM in attack simulator
OLLAMA_URL=http://host:11434  # Ollama endpoint
OLLAMA_MODEL=gemma4:e2b-it-qat  # Model name
PORT=3000                   # Server port (default 3000)
```

## Key Conventions

- **One PoW per session**, not per request. Server tells client cookie is already valid (`TOLLAI_SESSION`).
- **GET requests are never tolled** (reading is instant). Only POST/mutations require dwell.
- **Challenge format**: ciphertext + meta (reverse → base64 → substitution cipher). Plaintext answer stored server-side for validation.
- **Response time check**: answers submitted in <1500ms are automatically blocked as `MACHINE_SPEED`, even if correct.
- **Challenge IP binding**: `x-ai-proof` + `x-challenge-response` must match IP that received the challenge.
- **3-attempt limit** per challenge; 4th failed attempt returns 403.
- Server logs SOC alerts with MITRE ATT&CK mapping on AI agent detection.
- `attackers/agent-simulator.js` has 12 scenarios covering: news, social, git, chat, papers, images, video, finance, health, e-commerce, trading, podcast.

## Commands That Must Run in Order

```bash
# 1. Start server first
npm start

# 2. Then run tests (server must be running)
npm run test:flows
npm run test:client
npm test               # 12/12 attack campaign
```

## PoW Solving (if needed locally)

```js
const crypto = require('crypto');

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
```