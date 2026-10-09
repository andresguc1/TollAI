import { hmacHex, signPayload, verifySignature, randomHex } from './crypto.js';

export const TOKEN_VERSION = 1;

export async function ipHashFor(secret, ip) {
  const hash = await hmacHex(secret, String(ip));
  return hash.slice(0, 32);
}

export function createSession({ ipHash, difficulty, workMs, sessionTTL, now = Date.now() } = {}) {
  if (!ipHash) throw new Error('tollai: createSession requires an ipHash');
  return {
    v: TOKEN_VERSION,
    sid: randomHex(16),
    ip: ipHash,
    iat: now,
    exp: now + sessionTTL,
    pow: 1,
    d: difficulty,
    w: workMs,
    dw: 0,
    hb: 0,
    ws: now,
    wc: 0,
    n: 0,
  };
}

export async function issueToken(session, secret) {
  return signPayload(session, secret);
}

// Order matters: signature + format, then expiry, then IP binding.
export async function parseSession(token, secret, { now = Date.now(), ipHash } = {}) {
  const payload = await verifySignature(token, secret);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'SESSION_INVALID' };
  }
  if (
    payload.v !== TOKEN_VERSION ||
    typeof payload.sid !== 'string' ||
    typeof payload.ip !== 'string' ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    !Number.isFinite(payload.dw) ||
    !Number.isFinite(payload.wc)
  ) {
    return { ok: false, reason: 'SESSION_INVALID' };
  }
  if (payload.exp <= now) {
    return { ok: false, reason: 'SESSION_EXPIRED' };
  }
  if (ipHash !== undefined && payload.ip !== ipHash) {
    return { ok: false, reason: 'IP_MISMATCH' };
  }
  return { ok: true, session: payload };
}

// Sliding expiry: an actively browsing human is never logged out mid-read.
export function refreshSession(session, { now = Date.now() } = {}) {
  const ttl = session.exp - session.iat;
  return { ...session, exp: Math.max(now + ttl, session.exp) };
}

export function registerRequest(session, { rateWindowMs, rateLimit, now = Date.now() } = {}) {
  let windowStart = session.ws;
  let windowCount = session.wc;
  if (now - windowStart > rateWindowMs) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  const updated = {
    ...session,
    ws: windowStart,
    wc: windowCount,
    n: (session.n || 0) + 1,
  };
  return { session: updated, burst: windowCount > rateLimit };
}

// Dwell = time the human actually spent looking at the page. Heartbeats are
// capped per call so a client cannot claim dwell it never spent.
export function accumulateDwell(session, { capMs = 1000, now = Date.now() } = {}) {
  const since = session.hb ? now - session.hb : 0;
  return {
    ...session,
    hb: now,
    dw: session.dw + Math.max(0, Math.min(since, capMs)),
  };
}