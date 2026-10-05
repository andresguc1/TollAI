const crypto = require('crypto');

// Proof-of-Work over SHA-256 leading zero bits.
// Cost is denominated in CPU, not in "answer this question", because a bot
// can always sleep for a requested duration but it cannot avoid paying hashes.
class ProofOfWork {
  constructor(options = {}) {
    this.difficulty = options.difficulty || 16;
    this.ttl = options.ttl || 30000;
    this.pending = new Map();
  }

  issue() {
    this._cleanup();
    const challenge = crypto.randomBytes(16).toString('hex');
    this.pending.set(challenge, { issuedAt: Date.now() });
    return { challenge, difficulty: this.difficulty, expires_in: this.ttl };
  }

  // Returns { ok: true, workMs } or { ok: false, reason }
  verify(challenge, nonce) {
    const record = this.pending.get(challenge);
    if (!record) return { ok: false, reason: 'CHALLENGE_UNKNOWN' };
    if (Date.now() - record.issuedAt > this.ttl) {
      this.pending.delete(challenge);
      return { ok: false, reason: 'CHALLENGE_EXPIRED' };
    }
    if (nonce === undefined || nonce === null || !/^\d{1,12}$/.test(String(nonce))) {
      return { ok: false, reason: 'NONCE_MALFORMED' };
    }

    const started = Date.now();
    const digest = crypto
      .createHash('sha256')
      .update(`${challenge}:${nonce}`)
      .digest('hex');

    let bits = 0;
    for (let i = 0; i < digest.length && bits < 64; i++) {
      const nibble = parseInt(digest[i], 16);
      if (nibble === 0) { bits += 4; continue; }
      bits += Math.clz32(nibble) - 28;
      break;
    }

    if (bits < this.difficulty) {
      return { ok: false, reason: 'INSUFFICIENT_WORK', difficulty: this.difficulty, achieved: bits };
    }

    // Single use: a solved challenge cannot be replayed to mint extra sessions.
    this.pending.delete(challenge);
    return { ok: true, workMs: Date.now() - started, difficulty: this.difficulty };
  }

  _cleanup() {
    const cutoff = Date.now() - this.ttl;
    for (const [challenge, record] of this.pending) {
      if (record.issuedAt < cutoff) this.pending.delete(challenge);
    }
  }

  destroy() {
    this.pending.clear();
  }
}

// Session = proof of human-like client capability, amortised over many requests.
// A browser pays one PoW and browses; a scraper must repay it constantly.
class SessionStore {
  constructor(options = {}) {
    this.ttl = options.ttl || 15 * 60 * 1000;
    this.rateWindowMs = options.rateWindowMs || 10000;
    this.rateLimit = options.rateLimit || 30;
    this.quota = options.quota || 120;
    this.sessions = new Map();
  }

  mint(clientIP, meta = {}) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    this.sessions.set(token, {
      clientIP,
      issuedAt: now,
      lastSeen: now,
      requests: 0,
      windowStart: now,
      windowCount: 0,
      powCount: 0,
      dwellMs: 0,
      lastHeartbeat: 0,
      ...meta
    });
    return token;
  }

  get(token, clientIP) {
    const s = this.sessions.get(token);
    if (!s) return { ok: false, reason: 'SESSION_UNKNOWN' };
    // Sliding expiry: an actively browsing human is never logged out mid-read.
    if (Date.now() - s.lastSeen > this.ttl) {
      this.sessions.delete(token);
      return { ok: false, reason: 'SESSION_EXPIRED' };
    }
    if (s.clientIP !== clientIP) {
      this.sessions.delete(token);
      return { ok: false, reason: 'IP_MISMATCH' };
    }
    return { ok: true, session: s };
  }

  touch(token, session) {
    session.lastSeen = Date.now();
    this.sessions.set(token, session);
  }

  revoke(token) {
    if (token) this.sessions.delete(token);
  }

  // Bursty request chains are the HFT/scraping signature that survives PoW.
  registerRequest(session) {
    const now = Date.now();
    if (now - session.windowStart > this.rateWindowMs) {
      session.windowStart = now;
      session.windowCount = 0;
    }
    session.windowCount += 1;
    session.requests += 1;
    return {
      burst: session.windowCount > this.rateLimit,
      quotaExceeded: session.requests > this.quota
    };
  }

  // Dwell = time the human actually spent looking at the page. Heartbeats are
  // capped per call so a client cannot claim dwell it never spent.
  markDwell(session, capMs = 1000) {
    const now = Date.now();
    const since = session.lastHeartbeat ? now - session.lastHeartbeat : 0;
    session.lastHeartbeat = now;
    session.dwellMs += Math.max(0, Math.min(since, capMs));
    return session.dwellMs;
  }

  _cleanup() {
    const cutoff = Date.now() - this.ttl;
    for (const [token, s] of this.sessions) {
      if (s.lastSeen < cutoff) this.sessions.delete(token);
    }
  }

  get size() {
    return this.sessions.size;
  }

  destroy() {
    this.sessions.clear();
  }
}

module.exports = { ProofOfWork, SessionStore };
