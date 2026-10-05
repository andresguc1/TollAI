# TollAI Observability Documentation

## Telemetry Schema

### Event Types

| Kind | Decision | Description |
|------|----------|-------------|
| `request` | `transparent` | Valid session, no friction |
| `request` | `challenge-issued` | 433 cognitive challenge issued |
| `request` | `admitted` | Slow correct answer (≥1500ms) |
| `request` | `blocked` | Agent blocked (MACHINE_SPEED, WRONG_ANSWER, BURST_RATE, IP_MISMATCH, MAX_ATTEMPTS) |
| `request` | `dwell-deferred` | Mutation requires dwell time |
| `request` | `attestation-required` | Browser needs PoW (401) or page shell |
| `request` | `reproof` | Session quota exhausted |
| `request` | `bypassed` | Unprotected mode (x-tollai-mode: unprotected) |
| `proof` | `pow` | Proof of Work paid |
| `llm` | `llm` | LLM token consumption |
| `attack` | `attack` | Attack event from attacker dashboard |

### Event Fields

```json
{
  "id": 123,
  "at": "2026-10-05T14:30:00.000Z",
  "kind": "request",
  "decision": "transparent",
  "signal": "valid-session",
  "ip": "::1",
  "client": "browser",
  "userAgent": "Mozilla/5.0...",
  "method": "GET",
  "path": "/api/news",
  "mode": "protected",
  "scenario": "news-portal",
  "requestId": "uuid-v4",
  "latencyMs": 2,
  "sessionId": "abc123",
  "poWMs": 1500,
  "dwellMs": 500,
  "sessionRequests": 5,
  "challengeId": "hex",
  "responseTime": 2500,
  "threshold": 1500,
  "challengeType": "math",
  "question": "Calculate...",
  "detail": "human readable detail"
}
```

### LLM Event Fields

```json
{
  "kind": "llm",
  "decision": "llm",
  "ip": "::1",
  "client": "browser",
  "model": "gemma4:26b",
  "scenario": "corporate-chatbot",
  "promptTokens": 31,
  "completionTokens": 132,
  "measured": true,
  "durationMs": 1196,
  "error": null
}
```

### Attack Event Fields

```json
{
  "kind": "attack",
  "decision": "attack",
  "signal": "attack-event",
  "scenario": "news-portal",
  "client": "attacker",
  "ip": "192.168.1.1",
  "method": "POST",
  "path": "/api/news",
  "mode": "attack",
  "requestId": "uuid-v4",
  "latencyMs": 45,
  "attackData": { ... }
}
```

---

## API Endpoints

### GET /tollai/telemetry?limit=200
Returns snapshot: counters, totalTokens, clients[], scenarios[], events[]

### DELETE /tollai/telemetry
Clears all telemetry data

### POST /tollai/usage
Records LLM token usage
```json
{
  "promptTokens": 31,
  "completionTokens": 132,
  "model": "gemma4:26b",
  "scenario": "corporate-chatbot",
  "error": false
}
```

### POST /tollai/attack-events
Accepts attack events from attacker dashboard (requires TOLLAI_ATTACK_SECRET if set)
```json
[
  {
    "decision": "blocked",
    "signal": "AI_AGENT_DETECTED",
    "scenario": "news-portal",
    "latencyMs": 12,
    "attackData": { "challengeId": "...", "responseTimeMs": 12 }
  }
]
```

---

## Response Headers

All tolled responses include:
- `X-Request-Id`: UUID v4 correlation ID
- `X-TollAI-Decision`: One of `transparent`, `challenge-issued`, `admitted`, `blocked`, `dwell-deferred`, `attestation-required`, `reproof`, `bypassed`, `pow`, `llm`
- `X-TollAI-Latency-Ms`: Middleware processing time in ms

---

## Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEMETRY_PERSIST` | `none` | `none` \| `file` \| `redis` |
| `TELEMETRY_PATH` | `./telemetry.json` | File path for file persistence |
| `TELEMETRY_FLUSH_MS` | `30000` | Flush interval in ms |
| `TOLLAI_MODE_SECRET` | unset | HMAC secret for signed mode switching |
| `TOLLAI_ATTACK_SECRET` | unset | Shared secret for /tollai/attack-events |

### Signed Mode Switch (Production)

When `TOLLAI_MODE_SECRET` is set, mode switching requires:
- `x-tollai-mode`: `protected` or `unprotected`
- `x-tollai-timestamp`: Unix timestamp (within 60s)
- `x-tollai-signature`: HMAC-SHA256(mode + '.' + timestamp, secret)

Example:
```bash
TS=$(date +%s)
SIG=$(echo -n "unprotected.$TS" | openssl dgst -sha256 -hmac "$TOLLAI_MODE_SECRET" | awk '{print $2}')
curl -H "x-tollai-mode: unprotected" \
     -H "x-tollai-timestamp: $TS" \
     -H "x-tollai-signature: $SIG" \
     http://localhost:3000/api/news
```

---

## Persistence

### File Mode
```bash
TELEMETRY_PERSIST=file TELEMETRY_PATH=./telemetry.json npm start
```

### Redis Mode
```bash
TELEMETRY_PERSIST=redis TELEMETRY_REDIS_URL=redis://localhost:6379 npm start
```
Note: Requires `ioredis` package and `redisClient` passed to Telemetry constructor.

---

## Dashboard

- **Victim Dashboard**: http://localhost:3000/
- **Logs Dashboard**: http://localhost:3000/logs
- **Attacker Panel**: http://localhost:3001

### Logs Dashboard Features
- KPIs: requests, toll triggered, blocked, admitted, pow paid, dwell deferred, llm calls, total tokens
- Clients table: requests, LLM calls, toll triggered, blocked, tokens
- Scenarios table: requests, toll triggered, blocked, activity bar
- Events table: filterable by decision, mode, scenario, text
- Real-time polling (1.5s)
- Auto-scroll with pause/resume

---

## Counters

| Counter | Description |
|---------|-------------|
| `requests` | Total tolled requests |
| `tollTriggered` | Requests where TollAI intervened (excludes transparent/admitted/bypassed) |
| `blocked` | Agents blocked |
| `admitted` | Slow correct answers allowed through |
| `powPaid` | Proof of Work sessions minted |
| `dwellDeferred` | Mutations deferred for dwell |
| `reproofRequired` | Session quota exhausted |
| `promptTokens` | Sum of prompt tokens from LLM calls |
| `completionTokens` | Sum of completion tokens from LLM calls |
| `llmCalls` | Total LLM invocations |
| `llmErrors` | Failed LLM calls |

---

## Integration with Attacker Dashboard

1. Set `TOLLAI_ATTACK_SECRET` on victim server
2. Configure attacker panel to POST to `http://victim:3000/tollai/attack-events`
3. Attack events appear in victim telemetry with `kind: 'attack'`
4. Correlation via `requestId` links challenge → response → block