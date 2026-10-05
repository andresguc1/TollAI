const crypto = require('crypto');
const { ProofOfWork, SessionStore } = require('./pow');

const BROWSER_UA = /Mozilla|Chrome|Safari|Firefox|Edg|OPR\//i;

function generateRequestId() {
  return crypto.randomUUID();
}

class TollAI {
  constructor(options = {}) {
    this.minResponseTime = options.minResponseTime || 1500;
    this.minDwellMs = options.minDwellMs === undefined ? 1500 : options.minDwellMs;
    this.challengeTTL = options.challengeTTL || 60000;
    this.onAIAgentDetected = options.onAIAgentDetected || (() => {});
    this.onSessionIssued = options.onSessionIssued || (() => {});
    this.telemetry = options.telemetry || null;

    // The toll is priced in CPU, not in "answer this question": a bot can
    // always sleep for a requested delay, but it cannot avoid paying hashes.
    this.pow = new ProofOfWork({
      difficulty: options.powDifficulty || 14,
      ttl: options.powTTL || 30000
    });

    // One PoW buys a session. Humans browse inside it; scrapers must repay it.
    this.sessions = new SessionStore({
      ttl: options.sessionTTL || 15 * 60 * 1000,
      rateWindowMs: options.rateWindowMs || 10000,
      rateLimit: options.rateLimit || 30,
      quota: options.sessionQuota || 120
    });

    this.challengeStore = new Map();
    this.cleanupInterval = setInterval(() => this._cleanup(), 30000);
  }

  /* ---------- challenge generation (fallback path) ---------- */

  _generateChallenge(scenario) {
    const challengeTypes = [
      () => this._mathChallenge(),
      () => this._logicChallenge(),
      () => this._nestedReasoningChallenge()
    ];
    const randomType = challengeTypes[Math.floor(Math.random() * challengeTypes.length)];
    const challenge = randomType();
    challenge.scenario = scenario;
    return challenge;
  }

  _mathChallenge() {
    const a = Math.floor(Math.random() * 50) + 1;
    const b = Math.floor(Math.random() * 50) + 1;
    const c = Math.floor(Math.random() * 10) + 1;
    const operators = ['+', '-', '*'];
    const op1 = operators[Math.floor(Math.random() * operators.length)];
    const op2 = operators[Math.floor(Math.random() * operators.length)];

    let expression, answer;
    if (op1 === '*' && op2 === '*') {
      expression = `(${a} * ${b}) + ${c}`;
      answer = a * b + c;
    } else if (op1 === '*') {
      expression = `${a} * (${b} + ${c})`;
      answer = a * (b + c);
    } else if (op2 === '*') {
      expression = `(${a} + ${b}) * ${c}`;
      answer = (a + b) * c;
    } else {
      expression = `${a} ${op1} ${b} ${op2} ${c}`;
      answer = eval(expression);
    }

    return {
      type: 'math',
      question: `Calculate the result of: ${expression}`,
      answer: String(answer),
      difficulty: 'medium'
    };
  }

  _logicChallenge() {
    const scenarios = [
      {
        question: "If all blocks are cubes and some cubes are red, can you conclude that some blocks are red?",
        answer: "yes",
        options: ["yes", "no", "cannot be determined"]
      },
      {
        question: "Ana is taller than Bruno. Bruno is taller than Carlos. Who is the tallest?",
        answer: "ana",
        options: ["ana", "bruno", "carlos"]
      },
      {
        question: "In a race, you overtake the second place. What position are you in?",
        answer: "second",
        options: ["first", "second", "third"]
      },
      {
        question: "You have 3 apples, eat 1 and give 1 to a friend. How many do you have left?",
        answer: "1",
        options: ["0", "1", "2", "3"]
      }
    ];
    return scenarios[Math.floor(Math.random() * scenarios.length)];
  }

  _nestedReasoningChallenge() {
    const templates = [
      {
        question: "A train leaves Madrid at 100 km/h. Another leaves Barcelona at 120 km/h. The distance is 620 km. At what distance from Madrid do they meet? (Round to integer)",
        answer: "282",
        difficulty: "high"
      },
      {
        question: "If you multiply my age by 3, subtract 6, and divide by 3, you get 18. What is my age?",
        answer: "20",
        difficulty: "medium"
      },
      {
        question: "Complete the series: 2, 6, 12, 20, 30, ?",
        answer: "42",
        difficulty: "medium"
      },
      {
        question: "In a group of 30 people, 18 drink coffee, 15 drink tea, and 8 drink both. How many drink neither?",
        answer: "5",
        difficulty: "high"
      }
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  _validateResponse(challenge, response) {
    const normalizedResponse = response.toString().trim().toLowerCase();
    const normalizedAnswer = challenge.answer.toString().trim().toLowerCase();

    if (challenge.options) {
      return challenge.options.some(opt => opt.toLowerCase() === normalizedResponse);
    }

    return normalizedResponse === normalizedAnswer;
  }

  /* ---------- attestation ---------- */

  // Can this client execute JavaScript and hold state? Browsers can; HTTP
  // libraries cannot. This is the only question the human never has to answer.
  _looksLikeBrowser(req) {
    const h = req.headers;
    const signals = {
      ua: BROWSER_UA.test(h['user-agent'] || ''),
      acceptLanguage: /\S/.test(h['accept-language'] || ''),
      secFetch: !!(h['sec-fetch-mode'] || h['sec-fetch-site'] || h['sec-fetch-dest']),
      secChUa: !!h['sec-ch-ua'],
      acceptHtml: /\btext\/html\b/.test(h['accept'] || '')
    };
    const score = Object.values(signals).filter(Boolean).length;
    return signals.ua && score >= 3;
  }

  _wantsHtml(req) {
    return /\btext\/html\b/.test(req.headers.accept || '') && !/\bapplication\/json\b/.test(req.headers.accept || '');
  }

  /* ---------- core ---------- */

  _createChallengeToken(challenge, clientIP) {
    const challengeId = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();

    this.challengeStore.set(challengeId, {
      challenge,
      timestamp,
      clientIP,
      attempts: 0,
      solved: false
    });

    return { challengeId, timestamp };
  }

  issueProofChallenge() {
    return this.pow.issue();
  }

  verifyProof({ challenge, nonce }) {
    return this.pow.verify(challenge, nonce);
  }

  mintSession(clientIP, meta) {
    const token = this.sessions.mint(clientIP, meta);
    this.onSessionIssued({ clientIP, ...meta });
    return token;
  }

  _alert(req, scenario, clientIP, detail) {
    this.onAIAgentDetected({
      clientIP,
      scenario,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'] || 'unknown',
      acceptLanguage: req.headers['accept-language'] || 'none',
      ...detail
    });
  }

  // "Who is this?" — one label reused by every telemetry row.
  _identify(req) {
    const agent = (req.headers['user-agent'] || 'unknown').toLowerCase();
    let client = 'browser';
    if (/headless|phantom|puppeteer|playwright/.test(agent)) client = 'headless';
    // Agents often spoof a browser UA, so look for the tell-tale markers too.
    else if (/axios|node-fetch|got|requests|python|curl|wget|go-http|httpclient|bot|crawler|spider|scrap|ai-agent|autonomous|tollai-poc/.test(agent)) client = 'agent';
    else if (/python-requests|httpx|scrapy/.test(agent)) client = 'agent';
    if (req.tollMode === 'unprotected') client += '/unprotected';
    return { client, userAgent: req.headers['user-agent'] || 'unknown' };
  }

  _emit(req, detail) {
    if (!this.telemetry) return;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const latencyMs = req.tollStart ? Date.now() - req.tollStart : undefined;
    this.telemetry.recordRequest({
      ip,
      client: this._identify(req).client,
      userAgent: req.headers['user-agent'] || 'unknown',
      method: req.method,
      path: req.originalUrl.split('?')[0],
      mode: req.tollMode || 'protected',
      scenario: req.tollScenario || 'generic',
      requestId: req.tollRequestId,
      latencyMs,
      ...detail
    });
  }

  _setResponseHeaders(res, decision, requestId, latencyMs) {
    if (requestId) res.set('X-Request-Id', requestId);
    if (decision) res.set('X-TollAI-Decision', decision);
    if (latencyMs !== undefined) res.set('X-TollAI-Latency-Ms', String(latencyMs));
  }

  middleware() {
    return (req, res, next) => {
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      const scenario = req.tollScenario || 'generic';
      const token = req.cookies && req.cookies.tollai_session;

      // Generate correlation ID and start latency timer
      req.tollRequestId = generateRequestId();
      req.tollStart = Date.now();

      // 1. Valid session -> transparent pass, no puzzle, no friction.
      if (token) {
        const { ok, session } = this.sessions.get(token, clientIP);

        if (ok) {
          const { burst, quotaExceeded } = this.sessions.registerRequest(session);

          if (burst) {
            this.sessions.revoke(token);
            this._alert(req, scenario, clientIP, {
              reason: 'BURST_RATE',
              responseTime: 0,
              threshold: this.sessions.rateLimit,
              challengeType: 'behavioural',
              challengeId: token.slice(0, 16),
              detail: `${this.sessions.rateLimit}+ requests within ${this.sessions.rateWindowMs}ms`
            });
            this._emit(req, {
              decision: 'blocked',
              signal: 'BURST_RATE',
              scenario,
              detail: `${this.sessions.rateLimit}+ requests in ${this.sessions.rateWindowMs}ms`
            });
            this._setResponseHeaders(res, 'blocked', req.tollRequestId, Date.now() - req.tollStart);
            return res.status(403).json({
              error: 'AI Agent Detected',
              message: 'Request burst exceeds human interaction rate - Autonomous agent blocked',
              code: 'AI_AGENT_DETECTED',
              reason: 'BURST_RATE',
              scenario
            });
          }

          if (quotaExceeded) {
            this._emit(req, { decision: 'reproof', signal: 'QUOTA_EXHAUSTED', scenario,
              detail: `${session.requests} requests this session` });
            this._setResponseHeaders(res, 'reproof', req.tollRequestId, Date.now() - req.tollStart);
            return res.status(428).json({
              error: 'Proof of Work Required',
              message: 'Session quota exhausted - new proof of work required',
              code: 'REPROOF_REQUIRED',
              scenario
            });
          }

          // 2b. Dwell: reading is instant, acting requires having been here.
          // A bot that solves PoW and immediately fires mutations never dwells.
          const mutating = req.method !== 'GET' && req.method !== 'HEAD';
          if (mutating && session.dwellMs < this.minDwellMs) {
            const remaining = this.minDwellMs - session.dwellMs;
            if (this.telemetry) this.telemetry.noteDwellDeferred();
            this._emit(req, {
              decision: 'dwell-deferred',
              signal: 'DWELL_REQUIRED',
              scenario,
              dwellMs: Math.round(session.dwellMs),
              requiredMs: this.minDwellMs
            });
            this._setResponseHeaders(res, 'dwell-deferred', req.tollRequestId, Date.now() - req.tollStart);
            return res.status(428).json({
              error: 'Dwell Required',
              message: 'Stay on the page before submitting actions',
              code: 'DWELL_REQUIRED',
              retry_after_ms: Math.min(remaining, 1000),
              dwell_ms: Math.round(session.dwellMs),
              required_ms: this.minDwellMs,
              scenario
            });
          }

          this.sessions.touch(token, session);
          req.tollVerified = true;
          req.tollMetadata = {
            transparent: true,
            sessionId: token.slice(0, 12),
            workMs: session.workMs,
            difficulty: session.difficulty,
            requests: session.requests,
            scenario,
            requestId: req.tollRequestId
          };
          this._emit(req, {
            decision: 'transparent',
            signal: 'valid-session',
            sessionId: token.slice(0, 12),
            poWMs: session.workMs,
            dwellMs: Math.round(session.dwellMs || 0),
            sessionRequests: session.requests
          });
          this._setResponseHeaders(res, 'transparent', req.tollRequestId, Date.now() - req.tollStart);
          return next();
        }

        // Expired or rebound session: fall through and re-attest silently.
      }

      // 2. Browser without a session -> invisible proof of work, then reload.
      //    The human never sees a challenge.
      if (this._looksLikeBrowser(req)) {
        // Programmatic callers (fetch/XHR) get a machine-readable signal the
        // client library answers by proving work and retrying.
        if (!this._wantsHtml(req)) {
          this._emit(req, {
            decision: 'attestation-required',
            signal: 'NO_SESSION',
            scenario,
            detail: 'browser without a TollAI cookie'
          });
          this._setResponseHeaders(res, 'attestation-required', req.tollRequestId, Date.now() - req.tollStart);
          return res.status(401).json({
            error: 'Attestation Required',
            message: 'Browser proof of work pending',
            code: 'ATTESTATION_REQUIRED',
            scenario
          });
        }

        // Top-level navigation: let the page route render the shell.
        req.tollNeedsAttestation = true;
        this._emit(req, {
          decision: 'attestation-required',
          signal: 'PAGE_SHELL',
          scenario,
          detail: 'browser navigation, shell served'
        });
        this._setResponseHeaders(res, 'attestation-required', req.tollRequestId, Date.now() - req.tollStart);
        return next();
      }

      // 3. Anything that cannot execute JS -> cognitive challenge fallback.
      return this._challengeFlow(req, res, next, scenario, clientIP);
    };
  }

  // Fallback for non-browser clients: the reasoning challenge plus the
  // response-time check. A machine answers in 0ms; a person does not.
  _challengeFlow(req, res, next, scenario, clientIP) {
    const challengeToken = req.headers['x-ai-proof'];
    const challengeResponse = req.headers['x-challenge-response'];

    if (!challengeToken) {
      const challengeData = this._generateChallenge(scenario);
      const { challengeId, timestamp } = this._createChallengeToken(challengeData, clientIP);

      this._emit(req, {
        decision: 'challenge-issued',
        signal: 'NO_JS_CLIENT',
        scenario,
        challengeId,
        challengeType: challengeData.type || 'reasoning',
        question: challengeData.question
      });
      this._setResponseHeaders(res, 'challenge-issued', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(433).json({
        error: 'Challenge Required',
        message: 'Cognitive toll required for autonomous agent detection',
        challenge_id: challengeId,
        challenge: challengeData.question,
        challenge_type: challengeData.type || 'reasoning',
        scenario,
        timestamp,
        expires_in: this.challengeTTL
      });
    }

    const stored = this.challengeStore.get(challengeToken);

    if (!stored) {
      this._setResponseHeaders(res, 'challenge-expired', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(433).json({
        error: 'Invalid Challenge',
        message: 'Invalid or expired challenge token',
        code: 'CHALLENGE_EXPIRED'
      });
    }

    if (stored.clientIP !== clientIP) {
      this.challengeStore.delete(challengeToken);
      this._setResponseHeaders(res, 'ip-mismatch', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'IP mismatch in challenge validation',
        code: 'IP_MISMATCH'
      });
    }

    if (stored.solved) {
      this.challengeStore.delete(challengeToken);
      this._setResponseHeaders(res, 'challenge-used', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(433).json({
        error: 'Challenge Used',
        message: 'This challenge has already been solved',
        code: 'CHALLENGE_USED'
      });
    }

    stored.attempts++;

    if (stored.attempts > 3) {
      this.challengeStore.delete(challengeToken);
      this._setResponseHeaders(res, 'max-attempts', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(403).json({
        error: 'Too Many Attempts',
        message: 'Too many failed attempts',
        code: 'MAX_ATTEMPTS'
      });
    }

    if (!challengeResponse) {
      this._setResponseHeaders(res, 'missing-response', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing x-challenge-response header',
        code: 'MISSING_RESPONSE'
      });
    }

    const responseTime = Date.now() - stored.timestamp;
    const isCorrect = this._validateResponse(stored.challenge, challengeResponse);

    if (!isCorrect) {
      this._emit(req, {
        decision: 'blocked',
        signal: 'WRONG_ANSWER',
        scenario,
        challengeId: challengeToken,
        responseTime
      });
      this._setResponseHeaders(res, 'blocked', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(403).json({
        error: 'Incorrect Answer',
        message: 'Incorrect answer to cognitive challenge',
        code: 'WRONG_ANSWER',
        attempts_remaining: 3 - stored.attempts
      });
    }

    stored.solved = true;

    if (responseTime < this.minResponseTime) {
      this._emit(req, {
        decision: 'blocked',
        signal: 'MACHINE_SPEED',
        scenario,
        challengeId: challengeToken,
        responseTime,
        threshold: this.minResponseTime
      });
      this._alert(req, scenario, clientIP, {
        reason: 'MACHINE_SPEED',
        challengeId: challengeToken,
        responseTime,
        threshold: this.minResponseTime,
        challengeType: stored.challenge.type || 'reasoning'
      });

      this.challengeStore.delete(challengeToken);

      this._setResponseHeaders(res, 'blocked', req.tollRequestId, Date.now() - req.tollStart);
      return res.status(403).json({
        error: 'AI Agent Detected',
        message: 'Response speed incompatible with human processing - Autonomous agent blocked',
        code: 'AI_AGENT_DETECTED',
        reason: 'MACHINE_SPEED',
        response_time_ms: responseTime,
        minimum_required_ms: this.minResponseTime,
        scenario
      });
    }

    this.challengeStore.delete(challengeToken);
    req.tollVerified = true;
    req.tollMetadata = {
      transparent: false,
      challengeId: challengeToken,
      responseTime,
      challengeType: stored.challenge.type || 'reasoning',
      scenario,
      requestId: req.tollRequestId
    };
    this._emit(req, {
      decision: 'admitted',
      signal: 'SLOW_CORRECT_ANSWER',
      scenario,
      challengeId: challengeToken,
      responseTime,
      threshold: this.minResponseTime
    });
    this._setResponseHeaders(res, 'admitted', req.tollRequestId, Date.now() - req.tollStart);

    next();
  }

  _cleanup() {
    const now = Date.now();

    for (const [id, data] of this.challengeStore.entries()) {
      if (now - data.timestamp > this.challengeTTL || data.solved) {
        this.challengeStore.delete(id);
      }
    }

    this.pow._cleanup();
    this.sessions._cleanup();
  }

  get stats() {
    return {
      activeSessions: this.sessions.size,
      pendingProofs: this.pow.pending.size,
      openChallenges: this.challengeStore.size
    };
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.challengeStore.clear();
    this.pow.destroy();
    this.sessions.destroy();
  }
}

module.exports = TollAI;
module.exports.ProofOfWork = ProofOfWork;
module.exports.SessionStore = SessionStore;
