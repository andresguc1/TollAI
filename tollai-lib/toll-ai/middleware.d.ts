/**
 * TollAI - Cognitive Toll Protocol Type Definitions
 */

declare namespace TollAI {
  interface Options {
    minResponseTime?: number;          // Machine-speed threshold in ms (default: 1500)
    minDwellMs?: number;               // Dwell threshold in ms (default: 1500)
    challengeTTL?: number;             // Challenge expiry in ms (default: 60000)
    powDifficulty?: number;            // PoW difficulty (default: 14)
    powTTL?: number;                   // PoW TTL in ms (default: 30000)
    sessionTTL?: number;               // Session TTL in ms (default: 15min)
    rateWindowMs?: number;             // Rate limit window in ms (default: 10000)
    rateLimit?: number;                // Requests per window (default: 30)
    sessionQuota?: number;             // Quota per session (default: 120)
    onAIAgentDetected?: (alert: any) => void;
    onSessionIssued?: (meta: any) => void;
    telemetry?: any;
    mode?: 'protected' | 'unprotected';
  }

  interface ChallengeData {
    challenge_id: string;
    ciphertext: string;
    meta: any;
    plaintext: string;
    question: string;
    challenge_type: string;
    scenario: string;
    timestamp: number;
    expires_in: number;
  }

  interface VerifyResult {
    verified: boolean;
    work_ms: number;
    nonce: string;
  }

  interface SessionMeta {
    sessionId: string;
    workMs: number;
    difficulty: number;
    requests: number;
    scenario: string;
    requestId: string;
    transparent: boolean;
    dwellMs?: number;
    challengeId?: string;
    responseTime?: number;
  }
}

declare class TollAI {
  constructor(options?: TollAI.Options);

  // Core request handler - returns { status, body } instead of using Express res
  handleRequest(req: { headers: any; ip?: string; cookies?: { tollai_session?: string }; method: string; tollScenario?: string }): { status: number; body: any };

  // Proof of Work
  issueProofChallenge(): { challenge: string; difficulty: number; expires_in: number };
  verifyProof({ challenge, nonce }: { challenge: string; nonce: string }): VerifyResult;

  // Session management
  mintSession(clientIP: string, meta?: any): string;
  getSession(token: string, clientIP: string): { ok: boolean; session: any } | { ok: boolean; reason: string };

  // Statistics
  get stats(): { activeSessions: number; pendingProofs: number; openChallenges: number };

  // Life cycle
  destroy(): void;
}

export = TollAI;
export as namespace TollAI;