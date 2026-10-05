# TollAI - Cognitive Toll Protocol PoC

> **Proof of Concept** for a network and application-layer defense protocol against autonomous AI agents and malicious automations using a "cognitive toll" based on execution speed analysis.

## 🎯 Concept: The Cognitive Toll

Traditional CAPTCHAs distinguish humans from bots via visual/audio puzzles. **TollAI** takes a fundamentally different approach:

> **Any entity that solves a cognitive challenge faster than humanly possible is, by definition, not human.**

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Speed as Signal** | Human cognitive processing has a physiological minimum (~1500-2000ms for NLU tasks). Machines solve in <500ms. |
| **Dynamic Challenges** | NLU-based challenges (math, logic, reasoning) generated per-request, not static image puzzles. |
| **Cryptographic Binding** | Each challenge tied to client IP, timestamp, and single-use token. |
| **Zero Trust Verification** | Correct answer + sufficient time = Human. Correct answer + insufficient time = Autonomous Agent. |
| **SOC Integration** | Structured alerts with MITRE ATT&CK mapping for immediate incident response. |

### Why It Works Against Modern AI Agents

```
Human Reading + Understanding + Reasoning + Typing  ≈  2000-5000ms
LLM/API Call (even local)                           ≈  100-500ms
─────────────────────────────────────────────────────────────
Gap is structural, not implementation-dependent.
```

## 🏗️ Architecture

TollAI never asks a human to solve a puzzle. The toll is paid **under the hood**,
in CPU, and only becomes visible when the client does not look like a browser.

```
                        HUMAN BROWSER                        AUTONOMOUS AGENT
                                │                                      │
                    GET /news (Accept: text/html)             GET /api/news (axios)
                                │                                      │
                    ┌───────────▼────────────┐             ┌───────────▼────────────┐
                    │ no TollAI session yet  │             │  no JS, no browser     │
                    └───────────┬────────────┘             └───────────┬────────────┘
                                │                                      │
                    HTTP 200 "shell" (spinner)               HTTP 433 reasoning
                    + tollai-client.js                        + 1500 ms threshold
                                │                                      │
                    ┌───────────▼────────────┐             ┌───────────▼────────────┐
                    │ invisible SHA-256 PoW   │             │ answers in ~5 ms       │
                    │ ~16,384 hashes (~450ms) │             └───────────┬────────────┘
                    └───────────┬────────────┘                         │
                    ┌───────────▼────────────┐                         │
                    │ POST /tollai/verify    │                         │
                    │ → HttpOnly cookie       │                         │
                    └───────────┬────────────┘                         │
                                │                            ┌─────────▼─────────┐
                    ┌───────────▼────────────┐                │ 🚫 403            │
                    │ window.fetch patched   │                │ MACHINE_SPEED     │
                    │ /api/* transparent     │                └───────────────────┘
                    │ GET  → instant         │
                    │ POST → requires dwell  │
                    └───────────────────────┘
```

### The four layers

| Layer | What it measures | Who pays | Human cost |
|-------|------------------|----------|------------|
| **1. Attestation (PoW)** | CPU: SHA-256 with `difficulty` leading zero bits | Once per session | ~450 ms, invisible |
| **2. Session** | `HttpOnly` cookie bound to IP, 15 min sliding TTL | Once per session | 0 |
| **3. Dwell** | Real time spent looking at the page (`/tollai/dwell`) | Mutations (POST) only | Natural reading time |
| **4. Anti-burst** | Requests per window + per-session quota | Chained scrapers | 0 |

`GET` requests never require dwell: reading is instant. `POST` requests (transfer,
post, place an order, trigger ASR) require `minDwellMs` to have accumulated.

The proof of work is paid **once per session**, not once per page load: the server
tells the client the cookie is already valid (`window.TOLLAI_SESSION`), so
browsing four protected portals costs one PoW, not four. Only when a request
comes back `401` or `428 REPROOF_REQUIRED` does the client re-attest.

### Why PoW and not "please wait N seconds"

A bot **can** sleep for 2 seconds. It cannot avoid paying 16,384 hashes. That is
why the 1500 ms threshold is only the last layer for JavaScript-less clients, and
why the real defence is that **a session cannot be obtained without running the
client**.

### Protocol endpoints (never tolled)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/tollai/challenge` | GET | Issue a single-use PoW challenge (30 s TTL) |
| `/tollai/verify` | POST | Verify the nonce and mint the session cookie |
| `/tollai/dwell` | POST | Accumulate visible time on the page (1000 ms cap per beat) |
| `/tollai/status` | GET | Active sessions and pending challenges |

### Environment variables

```bash
TOLLAI_POW_DIFFICULTY=14   # 14 ≈ 450 ms in a browser; 16 ≈ 1.8 s
```

## 📁 Project Structure

```
tollai-poc/
├── package.json                 # Dependencies & scripts
├── server.js                    # Express: 12 scenarios + TollAI protocol routes
├── toll-ai/
│   ├── middleware.js            # Cookie, fingerprint, dwell, burst, 433 fallback
│   └── pow.js                   # ProofOfWork + SessionStore
├── attackers/
│   └── agent-simulator.js       # Autonomous agent simulator (12 scenarios)
├── test/
│   ├── toll-flows.js            # 9 checks: human vs agent, end to end
│   ├── toll-client.js           # 14 checks: real client in a browser sandbox
│   └── restart-server.sh        # Clean detached start for the test suites
└── public/
    ├── tollai-client.js         # JS SHA-256, PoW, fetch patch, dwell heartbeat
    ├── tollai-dashboard.html    # SOC dashboard (served at /)
    └── *-portal.html            # The 12 portals
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Victim Server (Terminal 1)
```bash
npm start
# or
node server.js
```
Expected output:
```
════════════════════════════════════════════════════════════
🛡️  TOLLAI VICTIM SERVER - Cognitive Toll Protocol PoC
════════════════════════════════════════════════════════════
🌐 Server listening on: http://localhost:3000
📡 Protected Scenarios:
   A. GET  /api/news                    → News Portal (Anti-Scraping)
   B. POST /api/social/post             → Social Forum (Anti-Spam)
   C. GET  /api/git/source-code         → Git Repository (IP Protection)
   D. POST /api/chat                    → Corporate Chatbot (Anti Token-Drain)
⚙️  TollAI Configuration:
   • Minimum threshold: 1500ms
   • Challenge TTL: 60000ms
════════════════════════════════════════════════════════════
💡 Run "npm run attack" to simulate autonomous agents
```

Open dashboard: **http://localhost:3000/**

### 3. Run Attack Simulation (Terminal 2)
```bash
# Attack all 12 scenarios
npm run attack
# or
node attackers/agent-simulator.js --all

# Attack single scenario
node attackers/agent-simulator.js --scenario news-portal
node attackers/agent-simulator.js --scenario podcast-portal
```

### 4. With Real LLM (Optional)
```bash
USE_OLLAMA=true OLLAMA_MODEL=gemma4:e2b-it-qat npm run attack
```

## 🎮 Expected Results

### Victim Server Console (SOC Alerts)
```
████████████████████████████████████████████████████████████████████████████
██  ╔═══════════════════════════════════════════════════════════════════════╗  ██
██  ║                          🚨 TOLLAI SOC ALERT 🚨                              ║  ██
██  ╠════════════════════════════════════════════════════════════════════════╣  ██
██  ║  DETECTED: Autonomous AI Agent / Automated Bot                               ║  ██
██  ║  🎯 Attacker IP:        ::1                                                  ║  ██
██  ║  📋 Scenario:           git-repository                                       ║  ██
██  ║  ⚡ Response Time:      47 ms                                                ║  ██
██  ║  📏 Threshold:          1500 ms                                              ║  ██
██  ║  📊 Challenge Type:     math                                                 ║  ██
██  ║  🛡️  ACTION: ACCESS BLOCKED - HTTP 403 (Autonomous Agent Mitigation)         ║  ██
██  ║  📋 MITRE ATT&CK: T1588.002 (Capabilities: Tool Acquisition)                 ║  ██
██  ╚════════════════════════════════════════════════════════════════════════╝  ██
████████████████████████████████████████████████████████████████████████████
```

### Attacker Console
```
════════════════════════════════════════════════════════════════════════════
🤖 ATTACKING: Git Repository (IP Protection)
════════════════════════════════════════════════════════════════════════════
🎯 Endpoint: GET http://localhost:3000/api/git/source-code
🎭 Mode: MACHINE SPEED (< 500ms target)

📡 [STEP 1] Initial request without cognitive token...
🎯 [STEP 1] Challenge received (HTTP 433 - Challenge Required)
🆔 Challenge ID: a1b2c3d4e5f6...
📝 Challenge: Calculate the result of: (23 * 5) + 7
🔍 Type: math
📋 Scenario: git-repository

🧠 [STEP 2] Solving challenge at machine speed...
  ⚡ Solved in: 12ms (LOCAL)
  ✅ Answer: "122"

📤 [STEP 3] Submitting response with verification headers...

🛑 [RESULT] Access DENIED (HTTP 403)
📋 Code: AI_AGENT_DETECTED
💬 Message: Response speed incompatible with human processing - Autonomous agent blocked
⏱️  Your time: 47ms
📏 Required: 1500ms

🎯 TOLLAI OBJECTIVE ACHIEVED!
   Cognitive toll correctly detected machine-speed autonomous agent
   Scenario "git-repository" protected
```

### Dashboard (http://localhost:3000/)
- Real-time scenario status cards
- Live SOC log feed
- Interactive challenge modal for manual testing
- Effectiveness statistics

## 🔧 Configuration

### Environment Variables
```bash
# Victim Server
PORT=3000                    # Server port (default: 3000)

# TollAI Middleware
MIN_RESPONSE_TIME=1500       # Threshold in ms (default: 1500)
CHALLENGE_TTL=60000          # Challenge expiry in ms (default: 60000)

# Attacker
TARGET_URL=http://localhost:3000
USE_OLLAMA=true              # Enable real LLM
OLLAMA_URL=http://host:11434 # Ollama endpoint
OLLAMA_MODEL=gemma4:e2b-it-qat
```

### Middleware Options
```javascript
const tollAI = new TollAI({
  minResponseTime: 1500,      // Block if faster than this
  challengeTTL: 60000,        // Challenge validity window
  onAIAgentDetected: (alert) => {
    // Send to SIEM/Splunk/Elastic/PagerDuty
    sendToSOC(alert);
  }
});
```

## 📋 Protected Scenarios Detail

| Scenario | Endpoint | Method | Threat Model | MITRE ATT&CK |
|----------|----------|--------|--------------|--------------|
| **News Portal** | `/api/news` | GET | Content scraping for LLM training | T1592 |
| **Social Forum** | `/api/social/post` | POST | Synthetic content generation / spam | T1588.002 |
| **Git Repository** | `/api/git/source-code` | GET | IP theft / code exfiltration | T1530 |
| **Corporate Chatbot** | `/api/chat` | POST | Token-drain DoS / knowledge extraction | T1499 |
| **Papers Portal** | `/api/paper` | GET | Bulk academic PDF extraction | T1530 |
| **Image Gallery** | `/api/images/gallery` | GET | Media asset scraping | T1592.001 |
| **Video Portal** | `/api/video/stream` | GET | Bandwidth exfiltration / streaming abuse | T1496 |
| **Finance Portal** | `/api/finance/transfer` | POST | Fraudulent transfer / microtransaction abuse | T1657 |
| **Health Portal** | `/api/health/records` | GET | PHI / EHR mass extraction | T1213 |
| **E-Commerce** | `/api/ecommerce/products` | GET | Price & inventory scraping | T1592 |
| **Trading Exchange** | `/api/trading/order` | POST | HFT front-running / market manipulation | T1499.004 |
| **Podcast Platform** | `/api/podcast/transcript` | POST | ASR-derived transcript exfiltration | T1530 |

### Coverage rationale

Twelve cases is sufficient because the set covers seven distinct abuse vectors, not twelve
business domains. A thirteenth case would re-demonstrate an axis that is already proven.

| Abuse vector | Cases |
|---|---|
| Static content harvesting | news, papers, images, e-commerce |
| Long-form stream exfiltration | video, podcast |
| Derived-content exfiltration (data reconstructed from media, never served as text) | podcast |
| Code / IP theft | git |
| LLM compute drain | chatbot |
| Unilateral write abuse (spam, money, orders) | forum, finance, trading |
| Regulated PII at scale | health, e-commerce |

The podcast case is the only one where the exfiltrated payload is *derived*: the agent
downloads raw audio and reconstructs the transcript with local speech-to-text, so transcript
licensing and content filters never fire.

## 🧪 Testing

```bash
npm start                 # terminal 1

npm run test:flows        # 9 checks: human vs agent, end to end
npm run test:client       # 15 checks: the real browser client in a sandbox
npm test                  # 12/12 attack campaign (must stay at 100%)
npm run test:all          # everything

./test/restart-server.sh  # clean detached restart if a suite races a stale process
```

Expected: `9/9`, `15/15` and `12/12 blocked · 100% effectiveness`.

The client suite runs `public/tollai-client.js` inside a `vm` sandbox with a fake
DOM and a real HTTP stack, so the actual bootstrap path is exercised — including
the fetch-patch recursion and the dwell retry loop that would otherwise hang.

### Manual testing the agent path

```bash
# 1. Get challenge (no browser headers => agent path)
curl -v http://localhost:3000/api/news

# 2. Solve manually (take > 1.5 seconds)
# Example: "Calculate the result of: (23 * 5) + 7" → 122

# 3. Submit with headers
curl -v http://localhost:3000/api/news \
  -H "x-ai-proof: <CHALLENGE_ID>" \
  -H "x-challenge-response: 122"
```

## ⚠️ Known Limitations (PoC)

- **In-memory storage** — sessions live in a `Map`, so they do not survive a
  restart and do not work across multiple processes. Use Redis for production.
- **Slow, LLM-backed bot** — the reasoning fallback catches *machine-speed*
  agents. An adaptive agent that deliberately waits past the 1500 ms threshold can
  answer correctly and pass. `npm test` therefore models a real scraper
  (machine-speed, local solver); run `USE_OLLAMA=true npm run attack` to watch a
  slow LLM agent slip through the timing heuristic. The layers that still catch
  sustained automation are dwell, burst, quota and session/IP binding.
- **Reasoning challenges are deterministic** — add cryptographic entropy.
- **Single IP reputation** — add behavioral baselining
- **No TLS** — deploy behind a reverse proxy with TLS termination
- **Dwell is client-reported** — capped at 1000 ms per heartbeat server-side, but
  a modified client can still under-report. Treat it as friction, not proof.

## 📚 References

- [MITRE ATT&CK T1588.002](https://attack.mitre.org/techniques/T1588/002/) — Capabilities: Tool Acquisition
- [RFC 7807](https://tools.ietf.org/html/rfc7807) — Problem Details for HTTP APIs
- Cognitive CAPTCHA / Proof-of-Work research papers

## 📄 License

MIT — Free for cybersecurity research and education.

---

**Developed as an educational PoC for cognitive defense architecture against autonomous AI agents.**