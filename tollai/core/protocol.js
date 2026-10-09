import { parseCookies, sessionCookie, json, html, headerGet } from './http.js';
import { ipHashFor, createSession, issueToken, parseSession, accumulateDwell } from './session.js';

const DEFAULT_OPTIONS = {
  sessionTTL: 900000,
  cookieName: 'tollai_session',
  secure: false,
  minDwellMs: 1500,
};

// The protocol endpoints are never tolled. Anything a server reserves under
// /tollai/* that is not one of these routes (telemetry, usage, attack events)
// passes through untouched so existing dashboards keep working.
export function createProtocol(services) {
  const {
    secret,
    pow,
    clientSource = '',
    onSessionIssued = () => {},
    now: nowFn,
  } = services;
  const options = { ...DEFAULT_OPTIONS, ...(services.options || {}) };

  function now() {
    return nowFn ? nowFn() : Date.now();
  }

  return async function handleProtocol(request, { ip = '', now: requestNow = now() } = {}) {
    const url = new URL(request.url);

    if (url.pathname === '/tollai/challenge') {
      const issued = await pow.issue(now());
      return json(
        { challenge: issued.challenge, difficulty: issued.difficulty, expires_in: issued.expires_in },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (url.pathname === '/tollai/verify') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ verified: false, code: 'BAD_REQUEST' }, { status: 400 });
      }
      const { challenge, nonce } = body || {};
      const verifyStart = Date.now();
      const result = await pow.verify(challenge, nonce, requestNow);
      const verifyMs = Date.now() - verifyStart;
      if (!result.ok) {
        return json(
          {
            verified: false,
            code: result.reason,
            achieved_bits: result.achieved,
            required_bits: result.difficulty || null,
          },
          { status: 403 },
        );
      }

      const ipHash = await ipHashFor(secret, ip);
      const session = createSession({
        ipHash,
        difficulty: result.difficulty,
        workMs: result.workMs,
        sessionTTL: options.sessionTTL,
        now: requestNow,
      });
      const token = await issueToken(session, secret);
      onSessionIssued({
        ipHash,
        ip,
        userAgent: headerGet(request.headers, 'user-agent') || '',
        difficulty: result.difficulty,
        workMs: result.workMs,
        verifyMs,
        challenge,
        nonce: nonce === undefined || nonce === null ? null : String(nonce),
        hashes: Number.isFinite(Number(nonce)) ? Number(nonce) + 1 : null,
        now: requestNow,
        source: 'pow',
      });

      const setCookie = sessionCookie(token, {
        ttlMs: options.sessionTTL,
        secure: options.secure,
        cookieName: options.cookieName,
      });
      const response = json(
        { verified: true, work_ms: result.workMs, difficulty: result.difficulty },
        { headers: { 'cache-control': 'no-store' } },
      );
      response.headers.append('set-cookie', setCookie);
      return response;
    }

    if (url.pathname === '/tollai/dwell') {
      const cookies = parseCookies(headerGet(request.headers, 'cookie'));
      const token = cookies[options.cookieName];
      if (!token) {
        return json({ ok: false, code: 'NO_SESSION' }, { status: 401 });
      }
      const ipHash = await ipHashFor(secret, ip);
      const parsed = await parseSession(token, secret, { ipHash, now: requestNow });
      if (!parsed.ok) {
        return json({ ok: false, code: parsed.reason }, { status: 401 });
      }
      const dwelled = accumulateDwell(parsed.session, { now: requestNow });
      const refreshed = await issueToken(dwelled, secret);
      const setCookie = sessionCookie(refreshed, {
        ttlMs: dwelled.exp - dwelled.iat,
        secure: options.secure,
        cookieName: options.cookieName,
      });
      const response = json({
        ok: true,
        dwell_ms: Math.round(dwelled.dw || 0),
        required_ms: options.minDwellMs,
        settled: (dwelled.dw || 0) >= options.minDwellMs,
      });
      response.headers.append('set-cookie', setCookie);
      return response;
    }

    if (url.pathname === '/tollai/client.js') {
      return html(clientSource, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    if (url.pathname === '/tollai/status') {
      return json({
        status: 'ok',
        difficulty: pow.difficulty,
        sessionTTL: options.sessionTTL,
        minDwellMs: options.minDwellMs,
        minResponseTime: options.minResponseTime || 1500,
      });
    }

    // Everything else under /tollai/* is reserved by the host application.
    return null;
  };
}