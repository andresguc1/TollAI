export class MemoryStore {
  #entries = new Map();
  #max;

  constructor({ max = 10000 } = {}) {
    this.#max = Math.max(1, max);
  }

  has(key, now = Date.now()) {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return false;
    }
    return true;
  }

  mark(key, ttlMs, now = Date.now()) {
    this.#set(key, 1, ttlMs, now);
    return true;
  }

  incr(key, ttlMs, now = Date.now()) {
    const entry = this.#entries.get(key);
    if (entry && entry.expiresAt > now) {
      entry.value += 1;
      return entry.value;
    }
    this.#set(key, 1, ttlMs, now);
    return 1;
  }

  get(key, now = Date.now()) {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs, now = Date.now()) {
    this.#set(key, value, ttlMs, now);
    return true;
  }

  delete(key) {
    return this.#entries.delete(key);
  }

  expire(key, ttlMs, now = Date.now()) {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    entry.expiresAt = now + ttlMs;
    return true;
  }

  get size() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
    return this.#entries.size;
  }

  #set(key, value, ttlMs, now) {
    if (!this.#entries.has(key)) {
      this.#purgeExpired(now);
      while (this.#entries.size >= this.#max) {
        const oldest = this.#entries.keys().next().value;
        this.#entries.delete(oldest);
      }
    }
    this.#entries.set(key, { value, expiresAt: now + ttlMs });
  }

  #purgeExpired(now) {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}

export default MemoryStore;
