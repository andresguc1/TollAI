import { randomHex } from './crypto.js';
import { createProtocol } from './protocol.js';
import { createPolicy } from './policy.js';
import { generateChallenge, validateResponse } from './challenge.js';
import {
  headerGet,
  looksLikeBrowser,
  wantsHtml,
  parseCookies,
  sessionCookie,
  json,
  html,
} from './http.js';
import { MemoryStore } from './memory-store.js';
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
  clientSource: '',
  clientPath: '/tollai/client.js',
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
  const store = new MemoryStore({ max: opts.maxSessions });
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

  async function handle(request, ctx = {}) {
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

    function finalize(response, decision, extra = {}) {
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
      };
      if (extra) Object.assign(payload, extra);
      if (opts.onDecision) opts.onDecision(payload);

      ctx.out.headers['x-tollai-decision'] = decision;
      ctx.out.headers['x-request-id'] = requestId;
      ctx.out.headers['x-tollai-latency-ms'] = String(payload.latencyMs);

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
    const protocolResponse = await protocol(request, { ip, now: now() });
    if (protocolResponse) {
      return finalize(protocolResponse, 'protocol', { signal: 'PROTOCOL' });
    }

    // ---- policy: should this request carry the toll? ----
    const policy = createPolicy({ mode, protect: opts.protect, exclude: opts.exclude });
    if (!policy.shouldToll(url.pathname)) {
      return finalize(null, 'bypass', { reason: 'not-protected' });
    }

    const cookies = parseCookies(headerGet(request.headers, 'cookie'));
    const token = cookies[opts.cookieName];
    const sessionOutcome = token
      ? await parseSession(token, secret, { ipHash, now: now() })
      : null;

    if (sessionOutcome && sessionOutcome.reason === 'IP_MISMATCH') {
      ctx.tollMetadata = { transparent: false, reason: 'ip-mismatch' };
      return finalize(json({ code: 'IP_MISMATCH' }, { status: 403 }), 'ip-mismatch', {
        signal: 'IP_MISMATCH',
      });
    }

    if (sessionOutcome && sessionOutcome.ok) {
      return await handleSession(sessionOutcome.session);
    }

    return await handleFresh();

    // ---- valid session: gates + transparent pass-through ----
    async function handleSession(session) {
      const mutating = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
      const dwellMs = Math.round(session.dw || 0);

      if (mutating && dwellMs < opts.minDwellMs) {
        if (opts.onDwellDeferred) opts.onDwellDeferred({ dwellMs, requiredMs: opts.minDwellMs, ip });
        ctx.tollMetadata = { transparent: false, reason: 'dwell' };
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
          { signal: 'DWELL_REQUIRED', dwellMs, requiredMs: opts.minDwellMs },
        );
      }

      const burstKey = `b:${session.sid}`;
      const quotaKey = `q:${session.sid}`;
      const burstCount = store.incr(burstKey, opts.rateWindowMs, now());
      if (burstCount > opts.rateLimit) {
        reportAgent('BURST_RATE', { limit: opts.rateLimit, windowMs: opts.rateWindowMs });
        ctx.tollMetadata = { transparent: false, reason: 'burst-rate' };
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
          { signal: 'AI_AGENT_DETECTED', reason: 'BURST_RATE' },
        );
      }

      const quotaCount = store.incr(quotaKey, opts.sessionTTL, now());
      if (quotaCount > opts.sessionQuota) {
        ctx.tollMetadata = { transparent: false, reason: 'quota-exhausted' };
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
          { signal: 'REPROOF_REQUIRED' },
        );
      }

      const reg = registerRequest(session, {
        rateWindowMs: opts.rateWindowMs,
        rateLimit: opts.rateLimit,
        now: now(),
      });
      if (reg.burst) {
        reportAgent('BURST_RATE', { source: 'token', limit: opts.rateLimit });
        ctx.tollMetadata = { transparent: false, reason: 'token-burst' };
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
          { signal: 'AI_AGENT_DETECTED', reason: 'BURST_RATE', source: 'token' },
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
      };
      return finalize(null, 'transparent', { signal: 'valid-session', scenario, dwellMs: Math.round(refreshed.dw || 0) });
    }

    // ---- no session: browser shell/401 or agent challenge ----
    async function handleFresh() {
      if (looksLikeBrowser(request.headers)) {
        ctx.tollMetadata = { transparent: false, reason: 'missing-session' };
        if (wantsHtml(request.headers) && ['GET', 'HEAD'].includes(method)) {
          ctx.needsAttestation = true;
          const shell = createShell({
            scenario: requestScenario,
            reloadUrl: url.pathname + (url.search || ''),
            clientPath: opts.clientPath,
          });
          return finalize(html(shell, { headers: { 'cache-control': 'no-store' } }), 'attestation-required', {
            signal: 'ATTESTATION_REQUIRED',
            reason: 'missing-session',
          });
        }
        ctx.needsAttestation = true;
        return finalize(json({ code: 'ATTESTATION_REQUIRED' }, { status: 401 }), 'attestation-required', {
          signal: 'ATTESTATION_REQUIRED',
          reason: 'missing-session',
        });
      }

      const proofId = headerGet(request.headers, 'x-ai-proof');
      return proofId ? await verifyChallenge(proofId) : issueChallenge();
    }

    function issueChallenge() {
      const scenario = requestScenario;
      const challenge = generateChallenge(scenario);
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
      };
      records.set(record.id, record);
      sweep();
      ctx.tollMetadata = { transparent: false, reason: 'challenge-issued', scenario };
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
        { signal: 'NO_JS_CLIENT', scenario },
      );
    }

    async function verifyChallenge(challengeId) {
      const record = records.get(challengeId);
      if (!record) {
        ctx.tollMetadata = { transparent: false, reason: 'challenge-unknown' };
        return finalize(json({ code: 'CHALLENGE_UNKNOWN' }, { status: 403 }), 'challenge-failed', {
          signal: 'CHALLENGE_UNKNOWN',
        });
      }
      if (record.ipHash !== ipHash) {
        records.delete(challengeId);
        ctx.tollMetadata = { transparent: false, reason: 'ip-mismatch' };
        return finalize(json({ code: 'IP_MISMATCH' }, { status: 403 }), 'challenge-failed', {
          signal: 'IP_MISMATCH',
        });
      }
      if (now() - record.issuedAt > opts.challengeTTL) {
        records.delete(challengeId);
        ctx.tollMetadata = { transparent: false, reason: 'challenge-expired' };
        return finalize(json({ code: 'CHALLENGE_EXPIRED' }, { status: 403 }), 'challenge-failed', {
          signal: 'CHALLENGE_EXPIRED',
        });
      }

      record.attempts += 1;
      const responseTime = now() - record.issuedAt;
      if (responseTime < opts.minResponseTime) {
        records.delete(challengeId);
        const detail = { response_time_ms: responseTime, minimum_required_ms: opts.minResponseTime };
        reportAgent('MACHINE_SPEED', { ...detail, challengeType: record.type });
        ctx.tollMetadata = { transparent: false, reason: 'machine-speed' };
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
          { signal: 'AI_AGENT_DETECTED', reason: 'MACHINE_SPEED', ...detail },
        );
      }

      if (record.attempts > 3) {
        records.delete(challengeId);
        ctx.tollMetadata = { transparent: false, reason: 'max-attempts' };
        return finalize(
          json({ code: 'MAX_ATTEMPTS', attempts_used: record.attempts }, { status: 403 }),
          'challenge-failed',
          { signal: 'MAX_ATTEMPTS' },
        );
      }

      const answer = headerGet(request.headers, 'x-challenge-response');
      if (!validateResponse(record, answer)) {
        ctx.tollMetadata = { transparent: false, reason: 'wrong-answer' };
        return finalize(
          json(
            { code: 'WRONG_ANSWER', attempts_remaining: 3 - record.attempts, attempts_used: record.attempts },
            { status: 403 },
          ),
          'challenge-failed',
          { signal: 'WRONG_ANSWER' },
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
      };
      return finalize(null, 'challenge-validated', {
        signal: 'CHALLENGE_VALIDATED',
        challengeType: record.type,
        scenario: record.scenario,
      });
    }
  }

  return {
    name: 'tollai',
    handle,
  };
}

export default createToll;