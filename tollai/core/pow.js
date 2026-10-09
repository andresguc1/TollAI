import { sha256Hex, signPayload, verifySignature, randomHex } from './crypto.js';
import { MemoryStore } from './memory-store.js';

export function leadingZeroBits(hexDigest) {
  let bits = 0;
  for (let i = 0; i < hexDigest.length && bits < 64; i++) {
    const nibble = parseInt(hexDigest[i], 16);
    if (Number.isNaN(nibble)) break;
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}

export async function solvePow(challenge, difficulty, options = {}) {
  const hash = options.hash || sha256Hex;
  const maxIterations = options.maxIterations || 4e9;
  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const digest = await hash(`${challenge}:${nonce}`);
    if (leadingZeroBits(digest) >= difficulty) return String(nonce);
  }
  throw new Error('pow exhausted');
}

export class ProofOfWork {
  constructor({ secret, difficulty = 14, ttl = 30000, store } = {}) {
    if (!secret) throw new Error('tollai: ProofOfWork requires a secret');
    this.secret = secret;
    this.difficulty = difficulty;
    this.ttl = ttl;
    this.store = store || new MemoryStore({ max: 10000 });
  }

  async issue(now = Date.now()) {
    const id = randomHex(16);
    const challenge = await signPayload({ k: 'p', id, iat: now }, this.secret);
    return { challenge, difficulty: this.difficulty, expires_in: this.ttl };
  }

  // Verify order matters: signature, format, expiration, nonce, work, single-use.
  async verify(challenge, nonce, now = Date.now()) {
    const payload = await verifySignature(challenge, this.secret);
    if (
      !payload ||
      payload.k !== 'p' ||
      typeof payload.id !== 'string' ||
      !Number.isFinite(payload.iat)
    ) {
      return { ok: false, reason: 'CHALLENGE_UNKNOWN' };
    }

    if (now - payload.iat > this.ttl) {
      return { ok: false, reason: 'CHALLENGE_EXPIRED' };
    }

    if (nonce === undefined || nonce === null || !/^\d{1,12}$/.test(String(nonce))) {
      return { ok: false, reason: 'NONCE_MALFORMED' };
    }

    const started = Date.now();
    const digest = await sha256Hex(`${challenge}:${nonce}`);
    const achieved = leadingZeroBits(digest);
    if (achieved < this.difficulty) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_WORK',
        difficulty: this.difficulty,
        achieved,
      };
    }

    // Single use: a solved challenge cannot be replayed to mint extra sessions.
    if (this.store.has(payload.id, now)) {
      return { ok: false, reason: 'CHALLENGE_USED' };
    }
    this.store.mark(payload.id, Math.max(1, payload.iat + this.ttl - now), now);

    return { ok: true, workMs: Date.now() - started, difficulty: this.difficulty };
  }
}
