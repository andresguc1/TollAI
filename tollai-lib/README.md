# tollai

**npm package**: `npm i tollai`

## Cognitive Toll Protocol for Autonomous AI Agent Defense

A browserless, server-side proof-of-work + dwell-time defense that distinguishes humans from autonomous AI agents and automated bots.

### Core Concept

Any entity that solves a cognitive challenge faster than humanly possible is, by definition, not human.

- **Human**: ~2000-5000 ms to read + reason + type
- **Machine/LLM**: ~100-500 ms even for complex reasoning

### Four-Layer Cognitive Toll

| Layer | Mechanism | Cost |
|-------|-----------|------|
| **1. PoW** | SHA-256 hashes with leading zero bits | ~450 ms in browser (once per session) |
| **2. Session** | HttpOnly cookie bound to IP, 15-min TTL | Amortized over many requests |
| **3. Dwell** | Real time spent on page before POST mutations | 1500 ms minimum |
| **4. Anti-burst** | Rate limits: 30 req/10s, 120 req/session quota | Behavioral detection |

### Installation

```bash
npm i tollai
```

### Quick Start

```js
const { TollAI } = require('tollai');

const tollAI = new TollAI({
  minResponseTime: 1500,    // Block if faster than 1.5s
  powDifficulty: 14,        // PoW difficulty (14 ≈ 450ms in browser)
  onAIAgentDetected: (alert) => {
    // Send to SIEM, PagerDuty, etc.
    sendToSOC(alert);
  }
});

// In your request handler (framework-agnostic):
app.use((req, res, next) => {
  const result = tollAI.handleRequest({
    headers: req.headers,
    ip: req.ip || req.connection.remoteAddress,
    method: req.method,
    tollScenario: req.tollScenario  // optional
  });

  // Send HTTP response based on result
  res.status(result.status).json(result.body);
});
```

### API

#### `new TollAI(options)`

- `minResponseTime` — ms threshold for machine-speed detection (default: 1500)
- `powDifficulty` — PoW difficulty (default: 14, ≈450ms in browser)
- `sessionTTL` — session cookie TTL in ms (default: 15min)
- `rateLimit` — requests per 10s window (default: 30)
- `sessionQuota` — requests per session (default: 120)
- `onAIAgentDetected` — callback when AI agent is detected
- `onSessionIssued` — callback when a new session is minted
- `telemetry` — optional telemetry recorder object

#### `tollAI.handleRequest(req)`

**Framework-agnostic request handler**. Takes an object with at least:

- `headers` — request headers object
- `ip` — client IP address
- `method` — HTTP method (GET, POST, etc.)
- `tollScenario` — optional scenario name

**Returns** `{ status, body }` where:

- `status` is HTTP status code (200, 401, 428, 433, 403, 200)
- `body` is the response payload (see below)

**Possible return objects:**

| Status | Body summary |
|--------|-------------|
| `200` | `{ transparent: true, sessionId, workMs, ... }` — valid session, no friction |
| `401` | `{ error: 'Attestation Required', code: 'ATTESTATION_REQUIRED' }` — browser needs proof of work |
| `428` | `{ error: 'Dwell Required', retry_after_ms, code: 'DWELL_REQUIRED' }` — need to spend time on page |
| `433` | `{ challenge_id, ciphertext, meta, ... }` — cognitive challenge required |
| `403` | `{ error: 'AI Agent Detected', code: 'AI_AGENT_DETECTED', reason: 'MACHINE_SPEED' | 'BURST_RATE' | 'WRONG_ANSWER', ... }` — blocked |

### How It Works

1. **GET requests are never tolled** — reading is instant for humans
2. **POST/mutations require dwell** — human reading time must accumulate past 1500ms
3. **PoW is amortized** — one proof-of-work buys a session valid for 15 minutes
4. **Machine-speed answers are blocked** — responses in <1500ms are rejected even if correct
5. **Challenge IP binding** — `x-ai-proof` + `x-challenge-response` must match the IP that received the challenge
6. **3-attempt limit** per challenge; 4th failed attempt returns 403

### Challenge Format

- Ciphertext delivered via `ciphertext` + `meta` (reverse → base64 → substitution cipher)
- Plaintext answer stored server-side for validation
- Clients must decode the challenge, compute the answer, and submit via `x-challenge-response` header

### Testing

```js
const tollAI = new TollAI();

// Test PoW issuance
const pow = tollAI.issueProofChallenge();
console.log(pow); // { challenge: 'abc123...', difficulty: 14, expires_in: 30000 }

// Test session minting
const token = tollAI.mintSession('127.0.0.1', { scenario: 'news-portal' });

// Test session validation
const { ok } = tollAI.sessions.get(token, '127.0.0.1');

// Test handleRequest with different client types
const browserResult = tollAI.handleRequest({
  headers: { 'user-agent': 'Mozilla/5.0 Chrome/126', 'accept': 'text/html' },
  ip: '127.0.0.1',
  method: 'GET'
});

const agentResult = tollAI.handleRequest({
  headers: { 'user-agent': 'axios/1.6.2', 'content-type': 'application/json' },
  ip: '127.0.0.1',
  method: 'POST'
});
```

### License

MIT — Free for cybersecurity research and education.

### References

- [MITRE ATT&CK T1588.002](https://attack.mitre.org/techniques/T1588/002/) — Capabilities: Tool Acquisition
- RFC 7807 — Problem Details for HTTP APIs