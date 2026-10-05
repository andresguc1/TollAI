// Bounded in-memory telemetry for the observability dashboard.
// Supports optional persistence to file or Redis.
const MAX_EVENTS = 1000;
const DEFAULT_FLUSH_INTERVAL_MS = 30000;

class Telemetry {
  constructor(options = {}) {
    this.maxEvents = options.maxEvents || MAX_EVENTS;
    this.events = [];
    this.counters = {
      requests: 0,
      tollTriggered: 0,
      blocked: 0,
      admitted: 0,
      powPaid: 0,
      dwellDeferred: 0,
      reproofRequired: 0,
      promptTokens: 0,
      completionTokens: 0,
      llmCalls: 0,
      llmErrors: 0
    };

    // Persistence configuration
    this.persistMode = options.persistMode || 'none'; // 'none' | 'file' | 'redis'
    this.persistPath = options.persistPath || './telemetry.json';
    this.flushIntervalMs = options.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;
    this.redisClient = options.redisClient || null;
    this._flushTimer = null;
    this._dirty = false;

    if (this.persistMode !== 'none') {
      this._load().then(() => this._startFlushTimer());
    }
  }

  async _load() {
    try {
      if (this.persistMode === 'file') {
        const fs = require('fs').promises;
        const data = await fs.readFile(this.persistPath, 'utf8');
        const parsed = JSON.parse(data);
        this.events = parsed.events || [];
        this.counters = parsed.counters || this.counters;
        // Rebuild derived fields
        this.events.forEach((e, i) => { e.id = i + 1; });
      } else if (this.persistMode === 'redis' && this.redisClient) {
        const data = await this.redisClient.get('tollai:telemetry');
        if (data) {
          const parsed = JSON.parse(data);
          this.events = parsed.events || [];
          this.counters = parsed.counters || this.counters;
          this.events.forEach((e, i) => { e.id = i + 1; });
        }
      }
    } catch (err) {
      console.warn(`Telemetry load failed (${this.persistMode}):`, err.message);
    }
  }

  _startFlushTimer() {
    if (this._flushTimer) return;
    this._flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    this._flushTimer.unref();
  }

  _markDirty() {
    this._dirty = true;
  }

  async flush() {
    if (!this._dirty) return;
    try {
      const payload = {
        events: this.events,
        counters: this.counters,
        savedAt: new Date().toISOString()
      };
      if (this.persistMode === 'file') {
        const fs = require('fs').promises;
        await fs.writeFile(this.persistPath, JSON.stringify(payload));
      } else if (this.persistMode === 'redis' && this.redisClient) {
        await this.redisClient.set('tollai:telemetry', JSON.stringify(payload));
      }
      this._dirty = false;
    } catch (err) {
      console.error('Telemetry flush failed:', err.message);
    }
  }

  record(event) {
    this._markDirty();
    const entry = { id: this.events.length + 1, at: new Date().toISOString(), ...event };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) this.events.shift();
    return entry;
  }

  // Called by the middleware for every tolled request.
  recordRequest(detail) {
    this.counters.requests += 1;
    // tollTriggered counts only decisions where TollAI actively intervened:
    // challenge-issued, blocked, dwell-deferred, attestation-required, reproof
    // NOT: transparent (no friction), admitted (human passed), bypassed (mode off)
    if (detail.decision && !['transparent', 'admitted', 'bypassed'].includes(detail.decision)) {
      this.counters.tollTriggered += 1;
    }
    if (detail.decision === 'blocked') this.counters.blocked += 1;
    if (detail.decision === 'admitted') this.counters.admitted += 1;
    return this.record(detail);
  }

  recordProof(detail) {
    this.counters.powPaid += 1;
    return this.record({ kind: 'proof', decision: 'pow', ...detail });
  }

  recordLLM(detail) {
    this.counters.llmCalls += 1;
    if (detail.error) this.counters.llmErrors += 1;
    this.counters.promptTokens += detail.promptTokens || 0;
    this.counters.completionTokens += detail.completionTokens || 0;
    return this.record({ kind: 'llm', decision: 'llm', ...detail });
  }

  noteDwellDeferred() {
    this.counters.dwellDeferred += 1;
  }

  noteReproofRequired() {
    this.counters.reproofRequired += 1;
  }

  // Aggregate per client so the dashboard can answer "who is this?".
  byClient(limit = 25) {
    const map = new Map();
    for (const e of this.events) {
      if (e.kind === 'proof') continue;
      const key = e.client || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          client: key,
          userAgent: e.userAgent,
          scenario: e.scenario,
          requests: 0,
          blocked: 0,
          triggered: 0,
          llmCalls: 0,
          promptTokens: 0,
          completionTokens: 0,
          lastSeen: e.at
        });
      }
      const row = map.get(key);
      if (e.kind !== 'llm') {
        row.requests += 1;
        if (e.decision === 'blocked') row.blocked += 1;
        if (e.decision && !['transparent', 'admitted', 'bypassed'].includes(e.decision)) row.triggered += 1;
      } else {
        row.llmCalls += 1;
      }
      row.promptTokens += e.promptTokens || 0;
      row.completionTokens += e.completionTokens || 0;
      if (e.at > row.lastSeen) row.lastSeen = e.at;
    }
    return [...map.values()]
      .sort((a, b) => b.blocked - a.blocked || b.requests - a.requests)
      .slice(0, limit);
  }

  byScenario() {
    const map = new Map();
    for (const e of this.events) {
      if (e.kind === 'proof') continue;
      const key = e.scenario || 'unknown';
      if (!map.has(key)) map.set(key, {
        scenario: key, requests: 0, blocked: 0, triggered: 0,
        promptTokens: 0, completionTokens: 0
      });
      const row = map.get(key);
      if (e.kind !== 'llm') {
        row.requests += 1;
        if (e.decision === 'blocked') row.blocked += 1;
        if (e.decision && !['transparent', 'admitted', 'bypassed'].includes(e.decision)) row.triggered += 1;
      }
      row.promptTokens += e.promptTokens || 0;
      row.completionTokens += e.completionTokens || 0;
    }
    return [...map.values()].sort((a, b) => b.requests - a.requests);
  }

  snapshot({ limit = 200 } = {}) {
    return {
      counters: { ...this.counters },
      totalTokens: this.counters.promptTokens + this.counters.completionTokens,
      clients: this.byClient(),
      scenarios: this.byScenario(),
      events: this.events.slice(-limit).reverse()
    };
  }

  clear() {
    this.events = [];
    for (const k of Object.keys(this.counters)) this.counters[k] = 0;
  }

  destroy() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    return this.flush();
  }
}

module.exports = { Telemetry };