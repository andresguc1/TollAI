// Bounded in-memory telemetry for the observability dashboard.
//
// It answers three questions the SOC actually asks:
//   1. who is hitting us          -> client, user agent, ip
//   2. what did TollAI do about it-> decision + signal that produced it
//   3. what did it cost us        -> real LLM token counts, never estimates
//
// Deliberately not persisted: this is a PoC, and a log that silently loses
// events is worse than one that is obviously ephemeral.
const MAX_EVENTS = 1000;

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
  }

  record(event) {
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
}

module.exports = { Telemetry };