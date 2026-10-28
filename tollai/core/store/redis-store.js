// Redis-backed store (optional). Requires a redis client passed in options.
export class RedisStore {
  constructor({ client, prefix = 'tollai:' } = {}) {
    if (!client) throw new Error('tollai: RedisStore requires a redis client');
    this.client = client;
    this.prefix = prefix;
  }

  key(k) {
    return this.prefix + k;
  }

  async has(key, now) {
    const res = await this.client.get(this.key(key));
    return res !== null && res !== undefined;
  }

  async mark(key, ttlMs) {
    const k = this.key(key);
    if (this.client.set) {
      const res = await this.client.set(k, '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    }
    if (this.client.setnx && this.client.pexpire) {
      const ok = await this.client.setnx(k, '1');
      if (ok) await this.client.pexpire(k, ttlMs);
      return ok === 1 || ok === true;
    }
    return false;
  }

  async incr(key, ttlMs) {
    const k = this.key(key);
    if (this.client.incr) {
      const val = await this.client.incr(k);
      if (val === 1 && this.client.pexpire) await this.client.pexpire(k, ttlMs);
      return val;
    }
    // Fallback
    const cur = parseInt((await this.client.get(k)) || '0', 10);
    const next = cur + 1;
    if (this.client.set) await this.client.set(k, String(next), 'PX', ttlMs);
    else if (this.client.setex) await this.client.setex(k, Math.ceil(ttlMs/1000), String(next));
    return next;
  }

  async get(key) {
    const res = await this.client.get(this.key(key));
    if (res === null || res === undefined) return null;
    try { return JSON.parse(res); } catch { return res; }
  }

  async set(key, value, ttlMs) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    const k = this.key(key);
    if (this.client.set) {
      await this.client.set(k, v, 'PX', ttlMs);
      return true;
    }
    if (this.client.psetex) {
      await this.client.psetex(k, ttlMs, v);
      return true;
    }
    return false;
  }

  async delete(key) {
    const res = await this.client.del ? await this.client.del(this.key(key)) : 0;
    return res > 0;
  }

  async expire(key, ttlMs) {
    if (this.client.pexpire) {
      const res = await this.client.pexpire(this.key(key), ttlMs);
      return res === 1;
    }
    return false;
  }
}

export default RedisStore;
