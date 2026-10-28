import { looksLikeBrowser } from '../http.js';

export const DEFAULT_WEIGHTS = {
  browser_fingerprint: 18,
  user_agent: 10,
  request_velocity: 18,
  ip_reputation: 12,
  dwell_behavior: 8,
  challenge_timing: 12,
  path_sensitivity: 10,
  session_state: 12
};

export function evaluateRisk(context = {}) {
  const {
    request = {},
    headers = {},
    ipHash,
    scenario = 'generic',
    session,
    preSessionCount = 0,
    burstCount = 0,
    responseTimeMs,
    challengeType,
    attempts = 0,
    now = Date.now()
  } = context;

  const signals = {};
  let score = 0;

  // Browser fingerprint
  const browserLike = looksLikeBrowser(headers);
  signals.browser_fingerprint = browserLike ? 0 : 25;
  score += (signals.browser_fingerprint / 100) * DEFAULT_WEIGHTS.browser_fingerprint;

  // User agent patterns
  const ua = String(headers['user-agent'] || headers['User-Agent'] || '').toLowerCase();
  if (/axios|node-fetch|got|python|curl|wget|httpclient/.test(ua)) {
    signals.user_agent = 20;
  } else if (/headless|puppeteer|playwright/.test(ua)) {
    signals.user_agent = 15;
  } else {
    signals.user_agent = 0;
  }
  score += (signals.user_agent / 100) * DEFAULT_WEIGHTS.user_agent;

  // Request velocity
  if (preSessionCount > 5 || burstCount > 10) {
    signals.request_velocity = 25;
  } else if (preSessionCount > 2 || burstCount > 5) {
    signals.request_velocity = 15;
  } else {
    signals.request_velocity = 0;
  }
  score += (signals.request_velocity / 100) * DEFAULT_WEIGHTS.request_velocity;

  // IP reputation (basic)
  signals.ip_reputation = ipHash ? 0 : 10;
  score += (signals.ip_reputation / 100) * DEFAULT_WEIGHTS.ip_reputation;

  // Dwell behavior
  if (session) {
    const dwell = session.dw || 0;
    signals.dwell_behavior = dwell >= 1500 ? 0 : 10;
  } else {
    signals.dwell_behavior = 5;
  }
  score += (signals.dwell_behavior / 100) * DEFAULT_WEIGHTS.dwell_behavior;

  // Challenge timing
  if (responseTimeMs !== undefined) {
    if (responseTimeMs < 500) signals.challenge_timing = 30;
    else if (responseTimeMs < 1000) signals.challenge_timing = 20;
    else if (responseTimeMs < 1500) signals.challenge_timing = 10;
    else signals.challenge_timing = 0;
  } else {
    signals.challenge_timing = 0;
  }
  score += (signals.challenge_timing / 100) * DEFAULT_WEIGHTS.challenge_timing;

  // Path sensitivity
  const sensitive = /finance|health|trading|git|chat|podcast/.test(scenario);
  signals.path_sensitivity = sensitive ? 5 : 0;
  score += (signals.path_sensitivity / 100) * DEFAULT_WEIGHTS.path_sensitivity;

  // Session state
  if (session) {
    signals.session_state = (session.wc || 0) > 20 ? 15 : 0;
  } else {
    signals.session_state = 5;
  }
  score += (signals.session_state / 100) * DEFAULT_WEIGHTS.session_state;

  if (attempts > 1) {
    signals.attempts_penalty = attempts * 5;
    score += signals.attempts_penalty;
  }

  // Normalize to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  let decision = 'allow';
  if (score >= 75) decision = 'block';
  else if (score >= 50) decision = 'challenge';
  else if (score >= 30) decision = 'require_dwell';

  return {
    score,
    decision,
    signals,
    factors: Object.entries(signals).map(([k, v]) => ({ signal: k, value: v }))
  };
}

export class RiskEngine {
  constructor(options = {}) {
    this.weights = options.weights || DEFAULT_WEIGHTS;
    this.enabled = options.enabled !== false;
  }

  evaluate(context = {}) {
    if (!this.enabled) {
      return { score: 0, decision: 'allow', signals: {}, factors: [] };
    }
    return evaluateRisk({ ...context, weights: this.weights });
  }
}

export default RiskEngine;
