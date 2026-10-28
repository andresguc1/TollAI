import { MemoryStore } from './memory-store.js';

export function createStore(options = {}) {
  const type = options.type || options.kind || process.env.TOLLAI_STORE_TYPE || 'memory';
  if (type === 'memory' || type === 'inmemory' || !type) {
    return new MemoryStore(options.memory || options);
  }
  if (type === 'redis') {
    // Redis store is opt-in; fall back to memory if not available/configured
    try {
      const mod = require ? null : null;
    } catch {}
    // Try dynamic import path if implemented elsewhere
    if (options.redisStore) return options.redisStore;
    console.warn('tollai: redis store requested but not implemented, falling back to memory');
    return new MemoryStore(options.memory || options);
  }
  return new MemoryStore(options);
}

export { MemoryStore } from './memory-store.js';
export { RedisStore } from './redis-store.js';
export default createStore;
