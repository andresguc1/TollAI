import { randomHex } from './crypto.js';
import { createProtocol } from './protocol.js';
import { createPolicy } from './policy.js';
import { generateChallenge, validateResponse } from './challenge.js';
import { generateChallenge as generateChallengeEnhanced } from './challenge-enhanced.js';
import {
  headerGet,
  looksLikeBrowser,
  wantsHtml,
  parseCookies,
  sessionCookie,
  json,
  html,
} from './http.js';
import { createStore } from './store/index.js';
import { MemoryStore } from './store/memory-store.js';
import { ProofOfWork } from './pow.js';
import {
  createSession,
  issueToken,
  parseSession,
  refreshSession,
  registerRequest,
  ipHashFor,
} from './session.js';
import { createShell } from './shell.js';
import { RiskEngine } from './scoring/risk-engine.js';
import { createTimer } from './timings.js';

export const DEFAULT_OPTIONS = {
  mode: 'api',
  protect: ['/api/*'],
  exclude: [],
  powDifficulty: 14,
  powTTL: 30000,
  sessionTTL: 900000,
  cookieName: 'tollai_session',
  secure: undefined,
  minDwellMs: 1500,
  minResponseTime: 1500,
  challengeTTL: 60000,
  rateWindowMs: 10000,
  rateLimit: 30,
  sessionQuota: 120,
  maxSessions: 10000,
  preSessionLimit: 10,
  preSessionWindowMs: 60000,
  failOpen: true,
  clientSource: '',
  clientPath: '/tollai/client.js',
  timeProfile: {},
  autoCalibrate: true,
  maxConcurrentSessionsPerIp: 0,
  exempt: undefined,
  store: undefined,
  storeType: 'memory',
  scoring: { enabled: true },
  enhancedChallenges: true,
  trace: true,
};

const FOREVER = () => false;

export function createToll(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let secret = opts.secret;
  if (!secret) {
    const production =
      globalThis.process && globalThis.process.env && globalThis.process.env.NODE_ENV === 'production';
    if (production) {
      throw new Error('tollai: TOLLAI_SECRET is required in production');
    }
    secret = randomHex(32);
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        'tollai: no TOLLAI_SECRET provided; signing sessions with an ephemeral key (dev mode)',
      );
    }
  }

  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const store = opts.store || createStore({ type: opts.storeType, max: opts.maxSessions });
  const riskEngine = new RiskEngine({ enabled: opts.scoring && opts.scoring.enabled !== false, weights: opts.scoring && opts.scoring.weights });
  const records = new Map();
  let sweepCounter = 0;

  const getScenario = typeof opts.scenario === 'function' ? opts.scenario : () => 'generic';

  const protocol = createProtocol({
    secret,
    pow: new ProofOfWork({
      secret,
      difficulty: opts.powDifficulty,
      ttl: opts.powTTL,
      store,
    }),
    clientSource: opts.clientSource,
    now,
    onSessionIssued: opts.onSessionIssued || FOREVER,
    options: {
      sessionTTL: opts.sessionTTL,
      cookieName: opts.cookieName,
      secure: opts.secure === true,
      minDwellMs: opts.minDwellMs,
      minResponseTime: opts.minResponseTime,
      preSessionLimit: opts.preSessionLimit,
      preSessionWindowMs: opts.preSessionWindowMs,
    },
  });

  function sweep() {
    sweepCounter += 1;
    if (sweepCounter % 64 !== 0) return;
    const cutoff = now();
    for (const [key, record] of records) {
      if (cutoff - record.issuedAt > opts.challengeTTL) records.delete(key);
    }
  }

  // Pre-session rate limit: a share of the shared counter store keyed by ipHash.
  // Guards both the protocol endpoints and the 433 one-shot path from burst
  // bots, so maxSessions/records can't be exhausted by challenge farming.
  function preSessionExceeded(ipHashVal) {
    const count = store.incr(`pre:${ipHashVal}`, opts.preSessionWindowMs, now());
    return count > opts.preSessionLimit;
  }

  // Track concurrent sessions per IP. When maxConcurrentSessionsPerIp > 0, the
  // IP is temporarily blocked from starting new sessions once the threshold is
  // reached. The counter is keyed by ipHash and expires after a short window.
  function checkMaxConcurrentSessions(ipHashVal) {
    if (opts.maxConcurrentSessionsPerIp <= 0) return false;
    const key = `concurrent:${ipHashVal}`;
    const count = store.incr(key, 60000, now());
    return count > opts.maxConcurrentSessionsPerIp;
  }

  async function toll(request, ctx = {}) {
    const timer = opts.trace !== false ? createTimer() : null;
    timer && timer.mark('ingress');
    const start = now();
    const url = new URL(request.url);
    const method = String(request.method || 'GET').toUpperCase();
    const ip = ctx.ip || headerGet(request.headers, 'x-forwarded-for') || 'unknown';
    const ipHash = await ipHashFor(secret, ip);

    const requestId = ctx.tollRequestId || randomHex(8);
    ctx.tollRequestId = requestId;
    ctx.out = ctx.out || { headers: {}, setCookie: [] };
    ctx.tollMetadata = ctx.tollMetadata || {};

    // Host applications may pin the scenario per route (req.tollScenario in
    // node adapters) before invoking the toll; it wins over the path table.
    const userAgent = headerGet(request.headers, 'user-agent') || '';
    const acceptLanguage = headerGet(request.headers, 'accept-language') || '';
    const requestScenario =
      typeof ctx.tollScenario === 'string' && ctx.tollScenario
        ? ctx.tollScenario
        : getScenario(request);

    // mode 'off' is an explicit, complete bypass (controlled via the secret
    // protocol for surge traffic, debugging, or feature-flag rollouts).
    const mode = ctx.mode || opts.mode;
    if (mode === 'off') return null;

    // Check max concurrent sessions per IP (Fase 1.4).
    if (checkMaxConcurrentSessions(ipHash)) {
      ctx.tollMetadata = { transparent: false, reason: 'max-concurrent' };
      ctx.out.headers['x-tollai-decision'] = 'bypass';
      return null;
    }

    // Apply time profile thresholds from autoCalibrate if enabled.
    const timeProfile = opts.timeProfile || {};
    const autoCalibrate = opts.autoCalibrate !== false;
    let responseTimeThreshold = opts.minResponseTime; // fallback
    if (autoCalibrate && timeProfile[requestScenario]) {
      const profile = timeProfile[requestScenario];
      if (profile && profile.p95 !== undefined) {
        responseTimeThreshold = profile.p95 * (profile.margin ?? 1.2);
      }
    }

    // Check exempt patterns/callbacks (Fase 1.5).
    const exempt = opts.exempt;
    if (exempt) {
      const exemptResult = typeof exempt === 'function'
        ? exempt({ request, ctx, ip, ipHash, scenario: requestScenario, mode })
        : false;
      if (exemptResult) {
        ctx.tollMetadata = { transparent: false, reason: 'exempt' };
        ctx.out.headers['x-tollai-decision'] = 'bypass';
        return null;
      }
    }

    function finalize(response, decision, extra = {}) {
      timer && timer.mark('response_prep');
      const risk = extra.riskScore !== undefined ? { score: extra.riskScore, factors: extra.riskFactors } : undefined;
      const payload = {
        signal: extra.signal || decision,
        decision,
        path: url.pathname,
        method,
        ip,
        requestId,
        scenario: requestScenario,
        userAgent,
        mode,
        timestamp: now(),
        latencyMs: Math.max(0, Math.round(now() - start)),
        ...(risk ? { riskScore: risk.score, riskFactors: risk.factors } : {}),
        ...(timer ? { timings: timer.getTimings() } : {})
      };
      if (extra) Object.assign(payload, extra);
      if (opts.onDecision) opts.onDecision(payload);

      ctx.out.headers['x-tollai-decision'] = decision;
      ctx.out.headers['x-request-id'] = requestId;
      ctx.out.headers['x-tollai-latency-ms'] = String(payload.latencyMs);

      // Shadow mode: every decision is computed and recorded (X-TollAI-Decision
      // stays truthful) but nothing is ever enforced and no cookies are minted.
      // Protocol endpoints still respond so the browser client can keep working.
      if (opts.mode === 'observe' && decision !== 'protocol') {
        ctx.out.setCookie = [];
        return null;
      }

      if (response === null) return null;

      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(ctx.out.headers)) headers.set(name, String(value));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    function reportAgent(reason, extra = {}) {
      if (opts.onAIAgentDetected) {
        opts.onAIAgentDetected({
          type: 'ai_agent',
          reason,
          scenario: requestScenario,
          ip,
          path: url.pathname,
          requestId,
          userAgent,
          acceptLanguage,
          timestamp: new Date(now()).toISOString(),
          ...extra,
        });
      }
    }

    function setSessionCookie(token, ttlMs) {
      ctx.out.setCookie.push(
        sessionCookie(token, {
          ttlMs,
          secure: opts.secure === true,
          cookieName: opts.cookieName,
        }),
      );
    }

    // ---- protocol endpoints are never tolled ----
    timer && timer.mark('evaluation');
    const protocolResponse = await protocol(request, { ip, now: now() });
    if (protocolResponse) {
      timer && timer.mark('response');
      return finalize(protocolResponse, 'protocol', { signal: 'PROTOCOL' });
    }

    // ---- policy: should this request carry the toll? ----
    const policy = createPolicy({ mode, protect: opts.protect, exclude: opts.exclude });
    if (!policy.shouldToll(url.pathname)) {
      timer && timer.mark('response');
      return finalize(null, 'bypass', { reason: 'not-protected' });
    }

    const cookies = parseCookies(headerGet(request.headers, 'cookie'));
    const token = cookies[opts.cookieName];
    const sessionOutcome = token
      ? await parseSession(token, secret, { ipHash, now: now() })
      : null;

    if (sessionOutcome && sessionOutcome.reason === 'IP_MISMATCH') {
      ctx.tollMetadata = { transparent: false, reason: 'ip-mismatch' };
      timer && timer.mark('response');
      return finalize(json({ code: 'IP_MISMATCH' }, { status: 403 }), 'ip-mismatch', {
        signal: 'IP_MISMATCH',
      });
    }

    if (sessionOutcome && sessionOutcome.ok) {
      timer && timer.mark('session_handling');
      return await handleSession(sessionOutcome.session);
    }

    return await handleFresh();

    // ---- valid session: gates + transparent pass-through ----
    async function handleSession(session) {
      const mutating = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
      const dwellMs = Math.round(session.dw || 0);
      const riskCtx = riskEngine.evaluate({ headers: request.headers, ipHash, scenario: requestScenario, session });
      ctx.tollMetadata = ctx.tollMetadata || {};
      ctx.tollMetadata.riskScore = riskCtx.score;
      ctx.tollMetadata.riskFactors = riskCtx.factors;

      if (mutating && dwellMs < opts.minDwellMs) {
        if (opts.onDwellDeferred) opts.onDwellDeferred({ dwellMs, requiredMs: opts.minDwellMs, ip });
        ctx.tollMetadata = { transparent: false, reason: 'dwell', ...ctx.tollMetadata };
        timer && timer.mark('response');
        return finalize(
          json(
            {
              code: 'DWELL_REQUIRED',
              message: 'Stay on the page before submitting actions',
              dwell_ms: dwellMs,
              required_ms: opts.minDwellMs,
              retry_after_ms: opts.minDwellMs - dwellMs,
              scenario: requestScenario,
            },
            { status: 428 },
          ),
          'dwell-deferred',
          { signal: 'DWELL_REQUIRED', dwellMs, requiredMs: opts.minDwellMs, riskScore: riskCtx.score, riskFactors: riskCtx.factors },
        );
      }

      const burstKey = `b:${session.sid}`;
      const quotaKey = `q:${session.sid}`;
      const burstCount = store.incr(burstKey, opts.rateWindowMs, now());
      if (burstCount > opts.rateLimit || riskCtx.score >= 75) {
        reportAgent('BURST_RATE', { limit: opts.rateLimit, windowMs: opts.rateWindowMs, riskScore: riskCtx.score });
        ctx.tollMetadata = { transparent: false, reason: 'burst-rate', ...ctx.tollMetadata };
        timer && timer.mark('response');
        return finalize(
          json(
            {
              code: 'AI_AGENT_DETECTED',
              message: 'Request burst exceeds human interaction rate - Autonomous agent blocked',
              reason: 'BURST_RATE',
              limit: opts.rateLimit,
            },
            { status: 403 },
          ),
          'ai-agent-detected',
          { signal: 'AI_AGENT_DETECTED', reason: 'BURST_RATE', riskScore: riskCtx.score, riskFactors: riskCtx.factors },
        );
      }

      const quotaCount = store.incr(quotaKey, opts.sessionTTL, now());
      if (quotaCount > opts.sessionQuota) {
        ctx.tollMetadata = { transparent: false, reason: 'quota-exhausted', ...ctx.tollMetadata };
        timer && timer.mark('response');
        return finalize(
          json(
            {
              code: 'REPROOF_REQUIRED',
              message: 'Session quota exhausted - new proof of work required',
              requests: quotaCount,
              limit: opts.sessionQuota,
            },
            { status: 428 },
          ),
          'reproof-required',
          { signal: 'REPROOF_REQUIRED', riskScore: riskCtx.score },
        );
      }

      const reg = registerRequest(session, {
        rateWindowMs: opts.rateWindowMs,
        rateLimit: opts.rateLimit,
        now: now(),
      });
      if (reg.burst) {
        reportAgent('BURST_RATE', { source: 'token', limit: opts.rateLimit, riskScore: riskCtx.score });
        ctx.tollMetadata = { transparent: false, reason: 'token-burst', ...ctx.tollMetadata };
        timer && timer.mark('response');
        return finalize(
          json(
            {
              code: 'AI_AGENT_DETECTED',
              message: 'Request burst exceeds human interaction rate - Autonomous agent blocked',
              reason: 'BURST_RATE',
              limit: opts.rateLimit,
            },
            { status: 403 },
          ),
          'ai-agent-detected',
          { signal: 'AI_AGENT_DETECTED', reason: 'BURST_RATE', source: 'token', riskScore: riskCtx.score },
        );
      }

      const refreshed = refreshSession(reg.session, { now: now() });
      const nextToken = await issueToken(refreshed, secret);
      setSessionCookie(nextToken, refreshed.exp - refreshed.iat);

      const scenario = requestScenario;
      ctx.tollVerified = true;
      ctx.tollMetadata = {
        transparent: true,
        dwellMs: Math.round(refreshed.dw || 0),
        scenario,
        riskScore: riskCtx.score,
        riskFactors: riskCtx.factors,
      };
      timer && timer.mark('response');
      return finalize(null, 'transparent', { signal: 'valid-session', scenario, dwellMs: Math.round(refreshed.dw || 0), riskScore: riskCtx.score, riskFactors: riskCtx.factors });
    }

    // ---- no session: browser shell/401 or agent challenge ----
    async function handleFresh() {
      const preCount = (typeof store.get === 'function') ? (store.get(`pre:${ipHash}`) || 0) : 0;
      const riskCtx = riskEngine.evaluate({ headers: request.headers, ipHash, scenario: requestScenario, preSessionCount: preCount });
      ctx.tollMetadata = ctx.tollMetadata || {};
      ctx.tollMetadata.riskScore = riskCtx.score;
      ctx.tollMetadata.riskFactors = riskCtx.factors;

      if (looksLikeBrowser(request.headers)) {
        ctx.tollMetadata = { transparent: false, reason: 'missing-session', ...ctx.tollMetadata };
        if (wantsHtml(request.headers) && ['GET', 'HEAD'].includes(method)) {
          ctx.needsAttestation = true;
          const shell = createShell({
            scenario: requestScenario,
            reloadUrl: url.pathname + (url.search || ''),
            clientPath: opts.clientPath,
          });
          timer && timer.mark('response');
          return finalize(html(shell, { headers: { 'cache-control': 'no-store' } }), 'attestation-required', {
            signal: 'ATTESTATION_REQUIRED',
            reason: 'missing-session',
            riskScore: riskCtx.score,
            riskFactors: riskCtx.factors,
          });
        }
        ctx.needsAttestation = true;
        timer && timer.mark('response');
        return finalize(json({ code: 'ATTESTATION_REQUIRED' }, { status: 401 }), 'attestation-required', {
          signal: 'ATTESTATION_REQUIRED',
          reason: 'missing-session',
          riskScore: riskCtx.score,
          riskFactors: riskCtx.factors,
        });
      }

      const proofId = headerGet(request.headers, 'x-ai-proof');
      timer && timer.mark('challenge_issued');
      return proofId ? await verifyChallenge(proofId) : issueChallenge();
    }

    function issueChallenge() {
      if (preSessionExceeded(ipHash)) {
        ctx.tollMetadata = { transparent: false, reason: 'rate-limited' };
        timer && timer.mark('response');
        return finalize(json({ code: 'CHALLENGE_RATE_LIMITED' }, { status: 429 }), 'challenge-failed', {
          signal: 'CHALLENGE_RATE_LIMITED',
        });
      }
      const scenario = requestScenario;
      const preCount = (typeof store.get === 'function') ? (store.get(`pre:${ipHash}`) || 0) : 0;
      const riskCtx = riskEngine.evaluate({ headers: request.headers, ipHash, scenario, preSessionCount: preCount });
      const challenge = opts.enhancedChallenges !== false ? generateChallengeEnhanced(scenario, { riskScore: riskCtx.score }) : generateChallenge(scenario);
      const record = {
        id: randomHex(8),
        scenario,
        type: challenge.type,
        ipHash,
        issuedAt: now(),
        attempts: 0,
        answer: challenge.answer,
        plaintext: challenge.plaintext,
        ciphertext: challenge.ciphertext,
        meta: challenge.meta,
        options: challenge.options,
        responseTimeMs: 0, // will be set on verification
        riskScore: riskCtx.score,
      };
      records.set(record.id, record);
      sweep();
      ctx.tollMetadata = { transparent: false, reason: 'challenge-issued', scenario, riskScore: riskCtx.score, riskFactors: riskCtx.factors };
      timer && timer.mark('response');
      return finalize(
        json(
          {
            challenge_id: record.id,
            message: 'Cognitive toll required for autonomous agent detection',
            ciphertext: record.ciphertext,
            meta: record.meta,
            challenge_type: record.type,
            scenario,
            timestamp: record.issuedAt,
            expires_in: Math.max(0, opts.challengeTTL - (now() - record.issuedAt)),
          },
          { status: 433 },
        ),
        'challenge-issued',
        { signal: 'NO_JS_CLIENT', scenario, riskScore: riskCtx.score, riskFactors: riskCtx.factors },
      );
    }

    async function verifyChallenge(challengeId) {
      timer && timer.mark('challenge_resolution');
      if (preSessionExceeded(ipHash)) {
        ctx.tollMetadata = { transparent: false, reason: 'rate-limited' };
        timer && timer.mark('response');
        return finalize(json({ code: 'CHALLENGE_RATE_LIMITED' }, { status: 429 }), 'challenge-failed', {
          signal: 'CHALLENGE_RATE_LIMITED',
        });
      }
      const record = records.get(challengeId);
      if (!record) {
        ctx.tollMetadata = { transparent: false, reason: 'challenge-unknown' };
        timer && timer.mark('response');
        return finalize(json({ code: 'CHALLENGE_UNKNOWN' }, { status: 403 }), 'challenge-failed', {
          signal: 'CHALLENGE_UNKNOWN',
        });
      }
      if (record.ipHash !== ipHash) {
        records.delete(challengeId);
        ctx.tollMetadata = { transparent: false, reason: 'ip-mismatch' };
        timer && timer.mark('response');
        return finalize(json({ code: 'IP_MISMATCH' }, { status: 403 }), 'challenge-failed', {
          signal: 'IP_MISMATCH',
        });
      }
      if (now() - record.issuedAt > opts.challengeTTL) {
        records.delete(challengeId);
        ctx.tollMetadata = { transparent: false, reason: 'challenge-expired' };
        timer && timer.mark('response');
        return finalize(json({ code: 'CHALLENGE_EXPIRED' }, { status: 403 }), 'challenge-failed', {
          signal: 'CHALLENGE_EXPIRED',
        });
      }

      record.attempts += 1;
      const responseTime = now() - record.issuedAt;
      const preCount = (typeof store.get === 'function') ? (store.get(`pre:${ipHash}`) || 0) : 0;
      const riskCtx = riskEngine.evaluate({ headers: request.headers, ipHash, scenario: record.scenario, preSessionCount: preCount, responseTimeMs: responseTime, attempts: record.attempts });
      const timeProfile = opts.timeProfile || {};
      const autoCalibrate = opts.autoCalibrate !== false;
      let effectiveMinResponseTime = opts.minResponseTime;
      if (autoCalibrate && timeProfile[record.type]) {
        const profile = timeProfile[record.type];
        if (profile && profile.p95 !== undefined) {
          effectiveMinResponseTime = profile.p95 * (profile.margin ?? 1.2);
        }
      }
      if (riskCtx.score >= 60) effectiveMinResponseTime = Math.max(effectiveMinResponseTime, 1600);
      record.effectiveMinResponseTime = effectiveMinResponseTime;

      if (responseTime < effectiveMinResponseTime) {
        records.delete(challengeId);
        const detail = { response_time_ms: responseTime, minimum_required_ms: effectiveMinResponseTime };
        reportAgent('MACHINE_SPEED', { ...detail, challengeType: record.type, riskScore: riskCtx.score });
        ctx.tollMetadata = { transparent: false, reason: 'machine-speed', riskScore: riskCtx.score, riskFactors: riskCtx.factors };
        timer && timer.mark('response');
        return finalize(
          json(
            {
              code: 'AI_AGENT_DETECTED',
              message: 'Response speed incompatible with human processing - Autonomous agent blocked',
              reason: 'MACHINE_SPEED',
              scenario: record.scenario,
              ...detail,
            },
            { status: 403 },
          ),
          'ai-agent-detected',
          { signal: 'AI_AGENT_DETECTED', reason: 'MACHINE_SPEED', ...detail, challengeType: record.type, responseTimeMs: responseTime, riskScore: riskCtx.score, riskFactors: riskCtx.factors },
        );
      }

      if (record.attempts > 3 || riskCtx.score >= 80) {
        records.delete(challengeId);
        ctx.tollMetadata = { transparent: false, reason: 'max-attempts', riskScore: riskCtx.score };
        timer && timer.mark('response');
        return finalize(
          json({ code: 'MAX_ATTEMPTS', attempts_used: record.attempts }, { status: 403 }),
          'challenge-failed',
          { signal: 'MAX_ATTEMPTS', challengeType: record.type, responseTimeMs: responseTime, riskScore: riskCtx.score },
        );
      }

      const answer = headerGet(request.headers, 'x-challenge-response');
      if (!validateResponse(record, answer)) {
        ctx.tollMetadata = { transparent: false, reason: 'wrong-answer', riskScore: riskCtx.score };
        timer && timer.mark('response');
        return finalize(
          json(
            { code: 'WRONG_ANSWER', attempts_remaining: 3 - record.attempts, attempts_used: record.attempts },
            { status: 403 },
          ),
          'challenge-failed',
          { signal: 'WRONG_ANSWER', challengeType: record.type, responseTimeMs: responseTime, riskScore: riskCtx.score },
        );
      }

      records.delete(challengeId);
      const session = createSession({
        ipHash,
        difficulty: opts.powDifficulty,
        workMs: responseTime,
        sessionTTL: opts.sessionTTL,
        now: now(),
      });
      const nextToken = await issueToken(session, secret);
      setSessionCookie(nextToken, opts.sessionTTL);
      if (opts.onSessionIssued) {
        opts.onSessionIssued({
          ipHash,
          ip,
          userAgent,
          difficulty: opts.powDifficulty,
          workMs: responseTime,
          now: now(),
          scenario: record.scenario,
          source: 'challenge',
        });
      }
      ctx.tollVerified = true;
      ctx.tollMetadata = {
        transparent: false,
        challengeType: record.type,
        scenario: record.scenario,
        dwellMs: 0,
        riskScore: riskCtx.score,
        riskFactors: riskCtx.factors,
      };
      timer && timer.mark('response');
      return finalize(null, 'challenge-validated', {
        signal: 'CHALLENGE_VALIDATED',
        challengeType: record.type,
        scenario: record.scenario,
        responseTimeMs: responseTime,
        riskScore: riskCtx.score,
        riskFactors: riskCtx.factors,
      });
    }
  }

  // Fail-open wrapper: an unexpected error in the toll pipeline never takes the
  // host application down. With failOpen (default) the request passes through,
  // flagged, instead of failing closed with a 500.
  async function handle(request, ctx = {}) {
    try {
      const res = await toll(request, ctx);
      if (res && ctx && ctx.out) {
        if (!ctx.out.headers['x-request-id'] && ctx.tollRequestId) {
          ctx.out.headers['x-request-id'] = ctx.tollRequestId;
        }
      }
      return res;
    } catch (err) {
      if (opts.onError) opts.onError(err, { request, ctx });
      if (opts.failOpen !== false) {
        ctx.out = ctx.out || { headers: {}, setCookie: [] };
        ctx.out.headers['x-tollai-decision'] = 'bypass';
        ctx.out.headers['x-tollai-error'] = 'fail-open';
        if (ctx.tollRequestId && !ctx.out.headers['x-request-id']) ctx.out.headers['x-request-id'] = ctx.tollRequestId;
        ctx.out.setCookie = [];
        return null;
      }
      throw err;
    }
  }

  return {
    name: 'tollai',
    handle,
  };
}

export default createToll;