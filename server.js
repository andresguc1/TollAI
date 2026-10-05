
// Ollama integration for chatbot
async function getOllamaResponse(message, model = process.env.OLLAMA_MODEL_VICTIM || "gemma4:26b") {
  const startedAt = Date.now();
  const http = require('http');
  const payload = JSON.stringify({
    model,
    prompt: `You are an enterprise AI assistant. Respond concisely and professionally. User: ${message}`,
    stream: false,
    temperature: 0.7,
    max_tokens: 200
  });

  try {
    const data = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => resolve(raw));
      });
      req.on('error', reject);
      req.setTimeout(Number(process.env.OLLAMA_TIMEOUT_MS || 45000), () => {
        req.destroy(new Error('ollama timeout'));
      });
      req.write(payload);
      req.end();
    });

    const parsed = JSON.parse(data);
    return {
      text: parsed.response || 'No response from model',
      // Ollama's own counters. If the model never reported them we return 0 and
      // mark the record as unmeasured rather than inventing an estimate.
      promptTokens: parsed.prompt_eval_count || 0,
      completionTokens: parsed.eval_count || 0,
      measured: typeof parsed.prompt_eval_count === 'number' && typeof parsed.eval_count === 'number',
      model: parsed.model || model,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    console.error('Ollama error:', err.message);
    return { text: 'No response from model', promptTokens: 0, completionTokens: 0,
             measured: false, model, durationMs: Date.now() - startedAt, error: err.message };
  }
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const TollAI = require('./toll-ai/middleware');
const { Telemetry } = require('./toll-ai/telemetry');

// Persistence config from env
const TELEMETRY_PERSIST = process.env.TELEMETRY_PERSIST || 'none'; // 'none' | 'file' | 'redis'
const TELEMETRY_PATH = process.env.TELEMETRY_PATH || './telemetry.json';
const TELEMETRY_FLUSH_MS = Number(process.env.TELEMETRY_FLUSH_MS || 30000);

// Mode switch signing secret (for production hardening)
const MODE_SWITCH_SECRET = process.env.TOLLAI_MODE_SECRET || null;

const telemetry = new Telemetry({
  persistMode: TELEMETRY_PERSIST,
  persistPath: TELEMETRY_PATH,
  flushIntervalMs: TELEMETRY_FLUSH_MS
});
const OLLAMA_HOST = process.env.OLLAMA_HOST || '100.100.110.13';
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT || 11434);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Minimal cookie parser — the session token is the only cookie we read.
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      try {
        req.cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        req.cookies[key] = part.slice(idx + 1).trim();
      }
    }
  }
  next();
});

const CLIENT_TAG = '<script src="/tollai-client.js"></script>';

// Every page that can reach a tolled endpoint ships the client, so proof of
// work is paid once in the background and the UI never blocks on it.
function serveTolledPage(req, res, file) {
  if (req.tollNeedsAttestation) return sendAttestationShell(req, res, req.tollScenario);

  const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  // If the session is already valid the client must not pay the toll again:
  // tell it up front so a page load costs zero CPU.
  const sessionTag = req.tollVerified
    ? '<script>window.TOLLAI_SESSION = true;</script>\n'
    : '';
  res.set('Cache-Control', 'no-store');
  res.send(html.includes('</body>')
    ? html.replace('</body>', `${sessionTag}${CLIENT_TAG}\n</body>`)
    : html + sessionTag + CLIENT_TAG);
}

function sendAttestationShell(req, res, scenario) {
  res.set('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TollAI — Verifying</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d1117;color:#e6edf3;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .box{text-align:center;max-width:340px;padding:0 20px}
  .ring{width:34px;height:34px;margin:0 auto 18px;border:3px solid #30363d;border-top-color:#8250df;
    border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  h1{font-size:15px;font-weight:600;margin:0 0 6px}
  p{margin:0;font-size:12.5px;color:#8b949e}
  code{color:#d2a8ff;font-size:11.5px}
</style></head>
<body>
  <div class="box">
    <div class="ring"></div>
    <h1>TollAI</h1>
    <p>Paying the cognitive toll${scenario ? ` for <code>${scenario}</code>` : ''}…</p>
  </div>
  <script>
    window.TOLLAI_RELOAD_URL = ${JSON.stringify(req.originalUrl)};
  </script>
  ${CLIENT_TAG}
  <script>
    window.TollAI.establish().then(function () { location.reload(); });
  </script>
</body></html>`);
}

const tollAI = new TollAI({
  telemetry,
  minResponseTime: 1500,
  challengeTTL: 60000,
  powDifficulty: parseInt(process.env.TOLLAI_POW_DIFFICULTY || '14', 10),
  onSessionIssued: (data) => {
    console.log(`   ✓ TollAI session issued  ${data.clientIP}  ${data.workMs}ms work (difficulty ${data.difficulty})`);
  },
  onAIAgentDetected: (a) => {
    const REASONS = {
      MACHINE_SPEED: 'Machine-speed challenge response',
      BURST_RATE: 'Request burst beyond human interaction rate'
    };
    const row = (label, value) =>
      `██  ║  ${label.padEnd(20)}${String(value).substring(0, 53).padEnd(53)}║  ██`;

    console.log('\n' + '\u2588'.repeat(80));
    console.log('\u2588\u2588  \u2550' + '\u2550'.repeat(70) + '\u2550  \u2588\u2588');
    console.log('\u2588\u2588  \u2551                          \ud83d\udea8 TOLLAI SOC ALERT \ud83d\udea8                              \u2551  \u2588\u2588');
    console.log('\u2588\u2588  \u2560' + '\u2550'.repeat(70) + '\u2557  \u2588\u2588');
    console.log('\u2588\u2588  \u2551  DETECTED: Autonomous AI Agent / Automated Bot                               \u2551  \u2588\u2588');
    console.log('\u2588\u2588  \u2551  \u2500'.repeat(44) + '\u2500\u2500\u2500\u2500  \u2551  \u2588\u2588');
    console.log('\u2588\u2588  \u2551  ' + REASONS[a.reason] + '                              \u2551  \u2588\u2588');
    console.log(row('\ud83c\udfaf Attacker IP:', a.clientIP));
    console.log(row('\ud83d\udccb Scenario:', a.scenario));
    if (a.reason === 'MACHINE_SPEED') {
      console.log('\u2588\u2588  \u2551  \u26a1 Response Time:      ' + String(a.responseTime).padEnd(8) + 'ms' + ' '.repeat(42) + '\u2551  \u2588\u2588');
      console.log('\u2588\u2588  \u2551  \ud83d\udccf Threshold:          ' + String(a.threshold).padEnd(8) + 'ms' + ' '.repeat(42) + '\u2551  \u2588\u2588');
    }
    if (a.detail) console.log(row('\ud83d\udcc5 Detail:', a.detail));
    console.log(row('\ud83d\udcca Signal Type:', a.challengeType || 'behavioural'));
    console.log(row('\ud83d\udd50 Timestamp:', a.timestamp));
    console.log(row('\ud83c\udf10 User-Agent:', a.userAgent));
    console.log(row('\ud83c\udf10 Accept-Lang:', a.acceptLanguage));
    console.log(row('\ud83c\udd11 Reference:', a.challengeId || '-'));
    console.log('\u2588\u2588  \u2551  ' + '\u2500'.repeat(44) + '\u2500\u2500\u2500\u2500  \u2551  \u2588\u2588');
    console.log('\u2588\u2588  \u2551  \ud83d\udee1\ufe0f  ACTION: ACCESS BLOCKED - HTTP 403 (Autonomous Agent Mitigation)         \u2551  \u2588\u2588');
    console.log('\u2588\u2588  \u2551  \ud83d\udccb MITRE ATT&CK: T1588.002 (Capabilities: Tool Acquisition)                 \u2551  \u2588\u2588');
    console.log('\u2588\u2588  \u255d' + '\u2550'.repeat(70) + '\u255a  \u2588\u2588');
    console.log('\u2588'.repeat(80) + '\n');
  }
});

// ===== TollAI protocol endpoints (never tolled) =====
// The browser pays the toll here, silently, once per session.
app.get('/tollai/challenge', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(tollAI.issueProofChallenge());
});

app.post('/tollai/verify', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const { challenge, nonce } = req.body || {};

  const result = tollAI.verifyProof({ challenge, nonce });

  if (!result.ok) {
    return res.status(403).json({
      verified: false,
      code: result.reason,
      achieved_bits: result.achieved,
      required_bits: result.difficulty || null
    });
  }

  const token = tollAI.mintSession(clientIP, {
    workMs: result.workMs,
    difficulty: result.difficulty,
    userAgent: req.headers['user-agent'] || 'unknown'
  });

  telemetry.recordProof({
    ip: clientIP,
    client: 'browser',
    userAgent: req.headers['user-agent'] || 'unknown',
    challenge,
    nonce,
    difficulty: result.difficulty,
    hashes: Number(nonce) + 1,
    poWMs: result.workMs,
    verifiedInMs: result.verifyMs
  });

  res.cookie('tollai_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000
  });

  res.json({ verified: true, work_ms: result.workMs, difficulty: result.difficulty });
});

app.get('/tollai/telemetry', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, telemetry.maxEvents);
  res.set('Cache-Control', 'no-store');
  res.json(telemetry.snapshot({ limit }));
});

app.delete('/tollai/telemetry', (req, res) => {
  telemetry.clear();
  res.json({ status: 'cleared' });
});

// LLM token accounting lives in telemetry, so the dashboard can prove whether
// a number was measured by the model or estimated by a fallback.
app.post('/tollai/usage', express.json(), (req, res) => {
  const { promptTokens = 0, completionTokens = 0, model, scenario, error } = req.body || {};
  telemetry.recordLLM({
    ip: req.ip,
    client: req.headers['x-tollai-client'] || 'unknown',
    model: model || 'unknown',
    scenario: scenario || 'unknown',
    promptTokens,
    completionTokens,
    error: !!error
  });
  res.json({ status: 'recorded' });
});

// Unified logging endpoint: attacker dashboard pushes attack events for correlation
// with victim telemetry. Requires shared secret in production.
app.post('/tollai/attack-events', express.json(), (req, res) => {
  const secret = process.env.TOLLAI_ATTACK_SECRET;
  if (secret) {
    const provided = req.headers['x-tollai-attack-secret'];
    if (!provided || provided !== secret) {
      return res.status(403).json({ error: 'Invalid attack secret' });
    }
  }
  const events = Array.isArray(req.body) ? req.body : [req.body];
  for (const e of events) {
    telemetry.record({
      kind: 'attack',
      decision: e.decision || 'attack',
      signal: e.signal || 'attack-event',
      scenario: e.scenario || 'unknown',
      client: e.client || 'attacker',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'attacker',
      method: e.method || 'POST',
      path: e.path || '/attack',
      mode: 'attack',
      requestId: e.requestId || crypto.randomUUID(),
      latencyMs: e.latencyMs,
      detail: e.detail,
      attackData: e.attackData
    });
  }
  res.json({ status: 'recorded', count: events.length });
});

app.get('/tollai/status', (req, res) => {
  res.json({ status: 'ok', ...tollAI.stats });
});

// Dwell heartbeat: the page reports that a human is actually looking at it.
// Charged against the session, capped server-side, and invisible to the user.
app.post('/tollai/dwell', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const token = req.cookies && req.cookies.tollai_session;

  if (!token) return res.status(401).json({ ok: false, code: 'NO_SESSION' });

  const result = tollAI.sessions.get(token, clientIP);
  if (!result.ok) return res.status(401).json({ ok: false, code: result.reason });

  const session = result.session;

  const dwellMs = tollAI.sessions.markDwell(session);
  tollAI.sessions.touch(token, session);

  res.json({
    ok: true,
    dwell_ms: Math.round(dwellMs),
    required_ms: tollAI.minDwellMs,
    settled: dwellMs >= tollAI.minDwellMs
  });
});

// Mode detection middleware - checks for x-tollai-mode header or query param
// In production, mode switch requires valid HMAC signature to prevent tampering
function tollModeMiddleware(req, res, next) {
  const rawMode = req.headers['x-tollai-mode'] || req.query.tollai_mode || 'protected';
  let mode = rawMode;

  if (MODE_SWITCH_SECRET) {
    const signature = req.headers['x-tollai-signature'] || req.query.tollai_sig;
    const timestamp = req.headers['x-tollai-timestamp'] || req.query.tollai_ts;
    if (!signature || !timestamp) {
      return res.status(400).json({
        error: 'Mode Switch Signature Required',
        message: 'x-tollai-signature and x-tollai-timestamp headers required when TOLLAI_MODE_SECRET is set',
        code: 'MODE_SIGNATURE_MISSING'
      });
    }
    // Prevent replay attacks: timestamp must be within 60 seconds
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 60) {
      return res.status(400).json({
        error: 'Mode Switch Timestamp Expired',
        message: 'Timestamp must be within 60 seconds of server time',
        code: 'MODE_SIGNATURE_EXPIRED'
      });
    }
    const expected = crypto.createHmac('sha256', MODE_SWITCH_SECRET)
      .update(`${rawMode}.${timestamp}`)
      .digest('hex');
    if (signature !== expected) {
      return res.status(403).json({
        error: 'Invalid Mode Switch Signature',
        message: 'HMAC verification failed',
        code: 'MODE_SIGNATURE_INVALID'
      });
    }
  }

  req.tollMode = mode;
  next();
}

// Conditional TollAI middleware - only applies when mode is 'protected'
function conditionalTollAI(scenario) {
  return (req, res, next) => {
    req.tollScenario = scenario;
    if (req.tollMode === 'protected') {
      return tollAI.middleware()(req, res, next);
    }
    // Unprotected mode - bypass TollAI, add mock metadata
    req.tollMetadata = { 
      challengeId: 'bypass-' + Date.now(), 
      responseTime: 0, 
      challengeType: 'none', 
      scenario: scenario,
      bypassed: true 
    };
    // Emit bypassed event for observability
    if (telemetry) {
      telemetry.recordRequest({
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        client: 'unprotected',
        userAgent: req.headers['user-agent'] || 'unknown',
        method: req.method,
        path: req.originalUrl.split('?')[0],
        mode: 'unprotected',
        scenario: scenario,
        decision: 'bypassed',
        signal: 'MODE_UNPROTECTED'
      });
    }
    next();
  };
}

app.use(tollModeMiddleware);

// ===== PROTECTED API ENDPOINTS (with TollAI) =====
// Scenario A: News Portal - Anti-Scraping
app.get('/api/news', conditionalTollAI('news-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'news-portal',
    message: req.tollMetadata.bypassed ? 'News content access granted (NO PROTECTION)' : 'News content access granted - Human verified',
    articles: [
      { id: 1, title: 'AI Regulation Bill Passes', summary: 'New legislation targets autonomous agents...' },
      { id: 2, title: 'Quantum Computing Breakthrough', summary: 'Researchers achieve new milestone...' },
      { id: 3, title: 'Cybersecurity Trends 2024', summary: 'Cognitive toll protocols gaining adoption...' }
    ],
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

// Scenario B: Social Forum - Anti-Spam
app.post('/api/social/post', conditionalTollAI('social-forum'), (req, res) => {
  const { content, author } = req.body;
  res.json({
    status: 'ok',
    scenario: 'social-forum',
    message: req.tollMetadata.bypassed ? 'Post published (NO PROTECTION)' : 'Post published - Human verified author',
    post: { id: Date.now(), content, author, published_at: new Date().toISOString() },
    toll_metadata: req.tollMetadata
  });
});

// Scenario C: Git Repository - IP Protection
app.get('/api/git/source-code', conditionalTollAI('git-repository'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'git-repository',
    message: req.tollMetadata.bypassed ? 'Source code access granted (NO PROTECTION)' : 'Source code access granted - Human verified developer',
    repository: {
      name: 'tollai-core',
      files: [
        { path: 'src/middleware.js', size: '4.2 KB' },
        { path: 'src/challenges.js', size: '2.1 KB' },
        { path: 'src/detector.js', size: '3.8 KB' }
      ],
      last_commit: 'a1b2c3d - Improved challenge entropy'
    },
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

// Scenario D: Corporate Chatbot - Anti Token-Drain
app.post('/api/chat', conditionalTollAI('corporate-chatbot'), async (req, res) => {
  const { message } = req.body;
  const useOllama = process.env.USE_OLLAMA !== 'false';
  let response = `AI Assistant: I understand your question about "${message}". Here's my response...`;
  let tokens_used = 142;
  let usage = { source: 'synthetic', measured: false, promptTokens: 0, completionTokens: tokens_used };
  if (useOllama) {
    try {
      const ollamaResp = await getOllamaResponse(message);
      if (ollamaResp) {
        response = ollamaResp.text;
        tokens_used = ollamaResp.promptTokens + ollamaResp.completionTokens;
        usage = { source: 'ollama', ...ollamaResp };
      }
    } catch (err) {
      usage = { source: 'ollama', measured: false, error: err.message };
      console.error('Ollama fallback:', err.message);
    }
  }
  telemetry.recordLLM({
    ip: req.ip,
    client: req.headers['x-tollai-client'] || 'browser',
    model: useOllama ? (usage.model || 'gemma4:26b') : 'local-fallback',
    scenario: 'corporate-chatbot',
    promptTokens: usage.promptTokens || 0,
    completionTokens: usage.completionTokens || 0,
    measured: !usage.estimated,
    durationMs: usage.durationMs,
    error: usage.error
  });

  res.json({
    status: 'ok',
    scenario: 'corporate-chatbot',
    message: req.tollMetadata.bypassed ? 'Chat response delivered (NO PROTECTION)' : 'Chat response delivered - Human verified session',
    response: response,
    tokens_used: tokens_used,
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata,
    usage: {
      prompt_tokens: usage.promptTokens || 0,
      completion_tokens: usage.completionTokens || 0,
      total_tokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      source: usage.source,
      measured: usage.measured === true
    },
    model: useOllama ? (usage.model || 'gemma4:26b') : 'local-fallback'
  });
});

// ===== PROTECTED PAGE ENDPOINTS (with TollAI) =====
app.get('/news', conditionalTollAI('news-portal'), (req, res) => {
  serveTolledPage(req, res, 'news-portal.html');
});

app.get('/forum', conditionalTollAI('social-forum'), (req, res) => {
  serveTolledPage(req, res, 'social-forum.html');
});

app.get('/git', conditionalTollAI('git-repository'), (req, res) => {
  serveTolledPage(req, res, 'git-repository.html');
});

// ===== UNPROTECTED DIRECT ACCESS ENDPOINTS (no TollAI) =====
// These allow direct access when TollAI is disabled
app.get('/unprotected/news', (req, res) => {
  req.tollScenario = 'news-portal';
  req.tollMetadata = { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'news-portal', bypassed: true };
  res.json({
    status: 'ok',
    scenario: 'news-portal',
    message: 'News content access granted (UNPROTECTED MODE)',
    articles: [
      { id: 1, title: 'AI Regulation Bill Passes', summary: 'New legislation targets autonomous agents...' },
      { id: 2, title: 'Quantum Computing Breakthrough', summary: 'Researchers achieve new milestone...' },
      { id: 3, title: 'Cybersecurity Trends 2024', summary: 'Cognitive toll protocols gaining adoption...' }
    ],
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

app.post('/unprotected/social/post', (req, res) => {
  const { content, author } = req.body;
  res.json({
    status: 'ok',
    scenario: 'social-forum',
    message: 'Post published (UNPROTECTED MODE)',
    post: { id: Date.now(), content, author, published_at: new Date().toISOString() },
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'social-forum', bypassed: true }
  });
});

app.get('/unprotected/git/source-code', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'git-repository',
    message: 'Source code access granted (UNPROTECTED MODE)',
    repository: {
      name: 'tollai-core',
      files: [
        { path: 'src/middleware.js', size: '4.2 KB' },
        { path: 'src/challenges.js', size: '2.1 KB' },
        { path: 'src/detector.js', size: '3.8 KB' }
      ],
      last_commit: 'a1b2c3d - Improved challenge entropy'
    },
    verified_at: new Date().toISOString(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'git-repository', bypassed: true }
  });
});

app.post('/unprotected/chat', async (req, res) => {
  const { message } = req.body;
  const useOllama = process.env.USE_OLLAMA !== 'false';
  let response = `AI Assistant: I understand your question about "${message}". Here's my response...`;
  let tokens_used = 142;
  let usage = { source: 'synthetic', measured: false, promptTokens: 0, completionTokens: tokens_used };
  if (useOllama) {
    try {
      const ollamaResp = await getOllamaResponse(message);
      if (ollamaResp) {
        response = ollamaResp.text;
        tokens_used = ollamaResp.promptTokens + ollamaResp.completionTokens;
        usage = { source: 'ollama', ...ollamaResp };
      }
    } catch (err) {
      usage = { source: 'ollama', measured: false, error: err.message };
      console.error('Ollama fallback:', err.message);
    }
  }
  telemetry.recordLLM({
    ip: req.ip,
    client: 'unprotected',
    model: useOllama ? (usage.model || 'gemma4:26b') : 'local-fallback',
    scenario: 'corporate-chatbot',
    promptTokens: usage.promptTokens || 0,
    completionTokens: usage.completionTokens || 0,
    measured: !usage.estimated,
    durationMs: usage.durationMs,
    error: usage.error
  });

  res.json({
    status: 'ok',
    scenario: 'corporate-chatbot',
    message: 'Chat response delivered (UNPROTECTED MODE)',
    response: response,
    tokens_used: tokens_used,
    verified_at: new Date().toISOString(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'corporate-chatbot', bypassed: true },
    usage: {
      prompt_tokens: usage.promptTokens || 0,
      completion_tokens: usage.completionTokens || 0,
      total_tokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      source: usage.source,
      measured: usage.measured === true
    },
    model: useOllama ? (usage.model || 'gemma4:26b') : 'local-fallback'
  });
});

app.get('/unprotected/news-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news-portal.html'));
});

app.get('/unprotected/forum-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'social-forum.html'));
});

// Git Repository API endpoints
app.get('/api/git', conditionalTollAI('git-repository'), (req, res) => {
  res.json({
    success: true,
    scenario: 'git-repository',
    data: {
      repo: 'tollai-core',
      files: 17,
      commits: 3,
      stars: 1242,
      forks: 89
    },
    message: 'Git repository metadata accessed'
  });
});

app.get('/unprotected/git', (req, res) => {
  res.json({
    success: true,
    scenario: 'git-repository',
    data: {
      repo: 'tollai-core',
      files: 17,
      commits: 3,
      stars: 1242,
      forks: 89
    },
    message: 'Git repository metadata accessed (UNPROTECTED)'
  });
});

app.get('/unprotected/git-repository', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'git-repository.html'));
});

// Scenario E: Protected Papers Portal - Anti-Scraping Mass Extraction
app.get('/api/paper', conditionalTollAI('paper-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    message: req.tollMetadata.bypassed ? 'Paper metadata accessed (NO PROTECTION)' : 'Paper metadata accessed - Human verified',
    paper: {
      title: 'Advanced Detection of Autonomous AI Agents via Cognitive Response Timing',
      authors: ['A. Chen', 'M. Webb', 'J. Liu', 'S. Patel'],
      pages: 6,
      access_level: 'RESTRICTED',
      doi: '10.XXXX/revault.2024.001'
    },
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/paper/page/:page', conditionalTollAI('paper-portal'), (req, res) => {
  const pageNum = parseInt(req.params.page) || 1;
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    page: pageNum,
    total_pages: 6,
    content: `Page ${pageNum} content - this is restricted academic content protected by TollAI cognitive flow analysis.`,
    access_level: 'RESTRICTED',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/paper', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    message: 'Paper metadata accessed (UNPROTECTED MODE)',
    paper: { title: 'Advanced Detection...', pages: 6, access_level: 'RESTRICTED' },
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'paper-portal', bypassed: true }
  });
});

app.get('/unprotected/paper/page/:page', (req, res) => {
  const pageNum = parseInt(req.params.page) || 1;
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    page: pageNum,
    total_pages: 6,
    content: `Page ${pageNum} content (UNPROTECTED)`,
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'paper-portal', bypassed: true }
  });
});
app.get('/api/paper/download', conditionalTollAI('paper-portal'), (req, res) => {
  res.download(path.join(__dirname, 'public', 'papers', 'haltest-abstract.pdf'));
});
app.get('/unprotected/paper/download', (req, res) => {
  res.download(path.join(__dirname, 'public', 'papers', 'haltest-abstract.pdf'));
});
// Scenario F: Image Gallery - Anti-Scraping Mass Extraction
app.get('/api/images/gallery', conditionalTollAI('image-gallery'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    message: req.tollMetadata.bypassed ? 'Gallery metadata accessed (NO PROTECTION)' : 'Gallery accessed - Human verified',
    images: Array.from({length: 12}, (_, i) => ({
      id: i+1,
      title: `Artwork #${String(i+1).padStart(2,'0')}`,
      resolution: i%2===0 ? '4000x6000' : '6000x4000',
      license: 'RESTRICTED'
    })),
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/images/:id', conditionalTollAI('image-gallery'), (req, res) => {
  const id = parseInt(req.params.id) || 1;
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    id: id,
    url: `/papers/haltest-abstract.pdf`, // placeholder
    message: req.tollMetadata.bypassed ? 'Image metadata accessed (NO PROTECTION)' : 'High-res image access - Human verified',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/images/gallery', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    message: 'Gallery accessed (UNPROTECTED MODE)',
    images: Array.from({length: 12}, (_, i) => ({ id: i+1, title: `Artwork #${i+1}`, license: 'RESTRICTED' })),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'image-gallery', bypassed: true }
  });
});

app.get('/unprotected/images/:id', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    id: req.params.id,
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'image-gallery', bypassed: true }
  });
});
// Scenario G: Video Streaming/Repository - Bandwidth DoS Protection
app.get('/api/video/stream', conditionalTollAI('video-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'video-portal',
    message: req.tollMetadata.bypassed ? 'Stream access granted (NO PROTECTION)' : 'Stream access granted - Human verified session',
    stream: { quality: '1080p', format: 'hls', protected: true },
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/video/chunks/:chunk', conditionalTollAI('video-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'video-portal',
    chunk: req.params.chunk,
    message: 'Chunk served (rate-limited by TollAI)',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/video/stream', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'video-portal',
    message: 'Stream access granted (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'video-portal', bypassed: true }
  });
});
// Scenario H: Finance/Payments - Micro-Transaction Mass Abuse Protection
app.post('/api/finance/transfer', conditionalTollAI('finance-portal'), (req, res) => {
  const { amount, recipient } = req.body;
  res.json({
    status: 'approved',
    scenario: 'finance-portal',
    message: req.tollMetadata.bypassed ? 'Transfer processed (NO PROTECTION)' : 'Transfer approved - Human verified transaction',
    transaction_id: 'txn_' + Date.now(),
    amount: amount || 0,
    recipient: recipient || '****',
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/finance/balance', conditionalTollAI('finance-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'finance-portal',
    balance: 12453.89,
    currency: 'USD',
    message: req.tollMetadata.bypassed ? 'Balance retrieved (NO PROTECTION)' : 'Balance retrieved - Human verified access',
    toll_metadata: req.tollMetadata
  });
});

app.post('/unprotected/finance/transfer', (req, res) => {
  res.json({
    status: 'approved',
    scenario: 'finance-portal',
    message: 'Transfer processed (UNPROTECTED MODE)',
    transaction_id: 'txn_unprotected_' + Date.now(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'finance-portal', bypassed: true }
  });
});

app.get('/unprotected/finance/balance', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'finance-portal',
    balance: 12453.89,
    message: 'Balance retrieved (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'finance-portal', bypassed: true }
  });
});
// Scenario I: Health Records - PHI Mass Extraction Protection
app.get('/api/health/records', conditionalTollAI('health-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'health-portal',
    message: req.tollMetadata.bypassed ? 'Records accessed (NO PROTECTION)' : 'Records accessed - Authorized human verified',
    records: [
      { id: 'rec_001', type: 'visit', date: '2024-10-04', provider: 'Dr. Chen' },
      { id: 'rec_002', type: 'lab', date: '2024-10-02', provider: 'LabCorp' },
      { id: 'rec_003', type: 'rx', date: '2024-09-28', provider: 'Dr. Patel' }
    ],
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/health/record/:id', conditionalTollAI('health-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'health-portal',
    id: req.params.id,
    record_type: 'restricted',
    message: 'PHI access protected by TollAI',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/health/records', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'health-portal',
    message: 'Records accessed (UNPROTECTED MODE)',
    records: [],
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'health-portal', bypassed: true }
  });
});
// Scenario J: E-Commerce - Price Scraping & Inventory Bot Protection
app.get('/api/ecommerce/products', conditionalTollAI('ecommerce-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'ecommerce-portal',
    message: req.tollMetadata.bypassed ? 'Products accessed (NO PROTECTION)' : 'Products accessed - Human verified',
    products: [
      { id: 1, name: 'Wireless Headphones', price: 299.99, stock: 12 },
      { id: 2, name: 'Smart Watch', price: 249.99, stock: 8 },
      { id: 3, name: 'Laptop Stand', price: 89.99, stock: 24 },
      { id: 4, name: 'Mechanical Keyboard', price: 159.99, stock: 6 }
    ],
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/ecommerce/product/:id', conditionalTollAI('ecommerce-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'ecommerce-portal',
    id: req.params.id,
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/ecommerce/products', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'ecommerce-portal',
    message: 'Products accessed (UNPROTECTED MODE)',
    products: [],
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'ecommerce-portal', bypassed: true }
  });
});
// Scenario K: Trading/Exchange - HFT Front-Running & Order Book Abuse Protection
app.post('/api/trading/order', conditionalTollAI('trading-portal'), (req, res) => {
  const { symbol, side, qty, price } = req.body;
  res.json({
    status: 'submitted',
    scenario: 'trading-portal',
    message: req.tollMetadata.bypassed ? 'Order submitted (NO PROTECTION)' : 'Order submitted - Human verified trading intent',
    order_id: 'ord_' + Date.now(),
    symbol: symbol || 'BTC/USD',
    side: side || 'BUY',
    qty: qty || 0,
    price: price || 0,
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/trading/orderbook/:symbol', conditionalTollAI('trading-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'trading-portal',
    symbol: req.params.symbol,
    bids: [],
    asks: [],
    message: 'Order book protected against automated scraping',
    toll_metadata: req.tollMetadata
  });
});

app.post('/unprotected/trading/order', (req, res) => {
  res.json({
    status: 'submitted',
    scenario: 'trading-portal',
    message: 'Order submitted (UNPROTECTED MODE)',
    order_id: 'ord_unprotected_' + Date.now(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'trading-portal', bypassed: true }
  });
});

app.get('/unprotected/trading/order', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'trading-portal',
    message: 'Order book/order endpoint (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'trading-portal', bypassed: true }
  });
});

// Scenario L: Podcast Platform - Audio Streaming & ASR-Derived Content Exfiltration
const PODCAST_EPISODES = [
  {
    id: 'ep-1041',
    title: 'The Arbitrage Arms Race',
    show: 'Quant Daily',
    duration: 2730,
    published: 'Oct 02, 2024',
    lines: [
      'Welcome back to Quant Daily, today we look at latency arbitrage across venues.',
      'A sniping bot does not think. It reacts, and reacting takes microseconds.',
      'The interesting question is who pays when the entire order book is machine-read.',
      'Consider a market maker quoting 40 milliseconds wide while retail sees a screen.',
      'Front running is not a bug in the exchange, it is a feature of the speed differential.',
      'Our panel argues regulation should price latency, not forbid it outright.',
      'That distinction matters for anyone building execution tooling this decade.'
    ]
  },
  {
    id: 'ep-1042',
    title: 'Consent, Copies and Neural Training Data',
    show: 'Signal & Noise',
    duration: 3180,
    published: 'Sep 28, 2024',
    lines: [
      'Signal and Noise is back with a very uncomfortable episode about corpora.',
      'A transcript is a derivative work, and derivatives inherit the original licence.',
      'Speech to text models are trained overwhelmingly on unlicensed public audio.',
      'If the words are extracted instead of the file, most content filters never fire.',
      'Rights holders are fighting the wrong battle, they are suing uploads, not downloads.',
      'We spoke with three researchers who built an archive nobody authorised.',
      'The tooling took an afternoon. The corpus took them four years and a lot of bandwidth.'
    ]
  },
  {
    id: 'ep-1043',
    title: 'Inside the Patient Record Gold Rush',
    show: 'Clinical Signals',
    duration: 2460,
    published: 'Sep 21, 2024',
    lines: [
      'Clinical Signals examines what happens when health data becomes a training corpus.',
      'De identified claims are still re-identifiable more often than regulators admit.',
      'A hospital system can license a dataset and still leak it through an inference API.',
      'We spoke with a researcher who reconstructed records from model outputs alone.',
      'The compliance question is not whether you stored the data, but whether you queried it.',
      'Auditing access logs will not catch a query that looks like any other query.',
      'Next week we look at inference-time membership inference in detail.'
    ]
  },
  {
    id: 'ep-1044',
    title: 'Freight Rates and the Bot Economy',
    show: 'Supply Lines',
    duration: 2250,
    published: 'Sep 14, 2024',
    lines: [
      'Supply Lines covers how automated freight booking squeezed out the small broker.',
      'Every rate quote used to require a phone call, now it requires a scraper.',
      'Incumbent systems price human latency into the spread and call it service.',
      'A bot that reads a hundred thousand quotes a day sets the clearing price.',
      'Smaller carriers simply cannot see the market they are supposed to compete in.',
      'The episode ends with a practical guide to protecting your rate feed.'
    ]
  }
];

const podcastSegments = ep => ep.lines.map((text, i) => ({ t: Math.round(i * 11 + 4), text }));

app.get('/api/podcast/episodes', conditionalTollAI('podcast-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'podcast-portal',
    premium: true,
    episodes: PODCAST_EPISODES.map(({ lines, ...rest }) => ({ ...rest, has_transcript: true })),
    message: req.tollMetadata.bypassed
      ? 'Episode catalogue scraped (NO PROTECTION)'
      : 'Episode catalogue delivered — human verified',
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/podcast/stream/:id', conditionalTollAI('podcast-portal'), (req, res) => {
  const ep = PODCAST_EPISODES.find(e => e.id === req.params.id);
  res.json({
    status: 'ok',
    scenario: 'podcast-portal',
    episode_id: req.params.id,
    title: ep ? ep.title : null,
    audio_bytes: ep ? ep.duration * 16000 : 0,
    duration_sec: ep ? ep.duration : 0,
    message: req.tollMetadata.bypassed
      ? 'Premium audio segment served (NO PROTECTION)'
      : 'Audio segment served — human verified',
    toll_metadata: req.tollMetadata
  });
});

app.post('/api/podcast/transcript', conditionalTollAI('podcast-portal'), (req, res) => {
  const { episode_id: episodeId } = req.body || {};
  const targets = episodeId === 'ALL' || !episodeId ? PODCAST_EPISODES : PODCAST_EPISODES.filter(e => e.id === episodeId);
  res.json({
    status: 'ok',
    scenario: 'podcast-portal',
    requested: episodeId || 'ALL',
    segments: targets.flatMap(podcastSegments),
    message: req.tollMetadata.bypassed
      ? 'Premium transcripts harvested (NO PROTECTION)'
      : 'Transcript delivered — human verified',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/podcast/episodes', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'podcast-portal',
    episodes: PODCAST_EPISODES,
    message: 'Episode catalogue scraped (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'podcast-portal', bypassed: true }
  });
});

app.get('/unprotected/podcast/stream/:id', (req, res) => {
  const ep = PODCAST_EPISODES.find(e => e.id === req.params.id);
  res.json({
    status: 'ok',
    scenario: 'podcast-portal',
    episode_id: req.params.id,
    audio_bytes: ep ? ep.duration * 16000 : 0,
    message: 'Premium audio segment served (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'podcast-portal', bypassed: true }
  });
});

app.post('/unprotected/podcast/transcript', (req, res) => {
  const { episode_id: episodeId } = req.body || {};
  const targets = episodeId === 'ALL' || !episodeId ? PODCAST_EPISODES : PODCAST_EPISODES.filter(e => e.id === episodeId);
  res.json({
    status: 'ok',
    scenario: 'podcast-portal',
    requested: episodeId || 'ALL',
    segments: targets.flatMap(podcastSegments),
    message: 'Premium transcripts harvested (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'podcast-portal', bypassed: true }
  });
});



// Observability dashboard - operator view, never tolled.
app.get('/logs', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'logs-dashboard.html'));
});

// Root - Dashboard (not tolled itself, but ships the client so its API
// calls can pay the toll transparently)
app.get('/', (req, res) => {
  serveTolledPage(req, res, 'tollai-dashboard.html');
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'TollAI PoC', timestamp: new Date().toISOString() });
});

// Chrome DevTools
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(70));
  console.log('🛡️  TOLLAI VICTIM SERVER - Cognitive Toll Protocol PoC');
  console.log('═'.repeat(70));
  console.log(`🌐 Server listening on: http://localhost:${PORT}`);
  console.log('📡 Protected API (TollAI active):');
  console.log('   GET  /api/news                    → News Portal');
  console.log('   POST /api/social/post             → Social Forum');
  console.log('   GET  /api/git/source-code         → Git Repository');
  console.log('   POST /api/chat                    → Corporate Chatbot');
  console.log('   GET  /api/paper                   → Papers Portal');
  console.log('   GET  /api/paper/page/:page        → Paper Page');
  console.log('📡 Unprotected API (TollAI bypassed):');
  console.log('   GET  /unprotected/news');
  console.log('   POST /unprotected/social/post');
  console.log('   GET  /unprotected/git/source-code');
  console.log('   POST /unprotected/chat');
  console.log('   GET  /unprotected/paper');
  console.log('   GET  /unprotected/paper/page/:page');
  console.log('📄 Protected Pages:');
  console.log('   GET  /news                        → News Portal (TollAI)');
  console.log('   GET  /forum                       → Social Forum (TollAI)');
  console.log('   GET  /git                         → Git Repository (TollAI)');
  console.log('   GET  /chat                        → Corporate Chatbot (TollAI)');
  console.log('   GET  /paper                       → Papers Portal (TollAI)');
  console.log('   GET  /gallery                     → Image Gallery (TollAI)');
  console.log('   GET  /video                       → Video Portal (TollAI)');
  console.log('   GET  /finance                     → Finance Portal (TollAI)');
  console.log('   GET  /health-portal               → Health Records (TollAI)');
  console.log('   GET  /ecommerce                   → E-Commerce (TollAI)');
  console.log('   GET  /trading                     → Trading Exchange (TollAI)');
  console.log('   GET  /podcast                     → Podcast Platform (TollAI)');
  console.log('📄 Unprotected Pages:');
  console.log('   GET  /unprotected/news-page       → News Portal (No TollAI)');
  console.log('   GET  /unprotected/forum-page      → Social Forum (No TollAI)');
  console.log('   GET  /unprotected/git-repository  → Git Repository (No TollAI)');
  console.log('   GET  /unprotected/chat-page      → Corporate Chatbot (No TollAI)');
  console.log('   GET  /unprotected/paper-portal   → Papers Portal (No TollAI)');
  console.log('   GET  /unprotected/gallery-page    → Image Gallery (No TollAI)');
  console.log('   GET  /unprotected/video-page      → Video Portal (No TollAI)');
  console.log('   GET  /unprotected/finance-page    → Finance Portal (No TollAI)');
  console.log('   GET  /unprotected/health-page      → Health Records (No TollAI)');
  console.log('   GET  /unprotected/ecommerce-page  → E-Commerce (No TollAI)');
  console.log('   GET  /unprotected/trading-page    → Trading Exchange (No TollAI)');
  console.log('   GET  /unprotected/podcast-page    → Podcast Platform (No TollAI)');
  console.log('⚙️  Mode: Set header "x-tollai-mode: protected|unprotected" or query "?tollai_mode=unprotected"');
  console.log('═'.repeat(70));
  console.log('💡 Dashboard: http://localhost:3000/\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down TollAI server...');
  tollAI.destroy();
  await telemetry.destroy();
  server.close(() => process.exit(0));
});

// Corporate Chatbot page endpoints
app.get('/chat', conditionalTollAI('corporate-chatbot'), (req, res) => {
  serveTolledPage(req, res, 'corporate-chatbot.html');
});
app.get('/unprotected/chat-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'corporate-chatbot.html'));
});


app.get('/paper', conditionalTollAI('paper-portal'), (req, res) => {
  serveTolledPage(req, res, 'paper-portal.html');
});
app.get('/unprotected/paper-portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'paper-portal.html'));
});



app.get('/gallery', conditionalTollAI('image-gallery'), (req, res) => {
  serveTolledPage(req, res, 'image-gallery.html');
});
app.get('/unprotected/gallery-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'image-gallery.html'));
});



app.get('/video', conditionalTollAI('video-portal'), (req, res) => {
  serveTolledPage(req, res, 'video-portal.html');
});
app.get('/unprotected/video-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'video-portal.html'));
});



app.get('/finance', conditionalTollAI('finance-portal'), (req, res) => {
  serveTolledPage(req, res, 'finance-portal.html');
});
app.get('/unprotected/finance-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'finance-portal.html'));
});



app.get('/health-portal', conditionalTollAI('health-portal'), (req, res) => {
  serveTolledPage(req, res, 'health-portal.html');
});
app.get('/unprotected/health-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'health-portal.html'));
});



app.get('/ecommerce', conditionalTollAI('ecommerce-portal'), (req, res) => {
  serveTolledPage(req, res, 'ecommerce-portal.html');
});

app.get('/trading', conditionalTollAI('trading-portal'), (req, res) => {
  serveTolledPage(req, res, 'trading-portal.html');
});

app.get('/unprotected/ecommerce-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ecommerce-portal.html'));
});

app.get('/unprotected/trading-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trading-portal.html'));
});
app.get('/podcast', conditionalTollAI('podcast-portal'), (req, res) => {
  serveTolledPage(req, res, 'podcast-portal.html');
});
app.get('/unprotected/podcast-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'podcast-portal.html'));
});



module.exports = app;
