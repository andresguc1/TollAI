// Type declarations for the TollAI core (`tollai` package root).

export interface TollDecision {
  signal: string;
  decision: string;
  path: string;
  method: string;
  ip: string;
  requestId: string;
  scenario: string;
  userAgent: string;
  mode: string;
  timestamp: number;
  latencyMs: number;
  [key: string]: unknown;
}

export interface AIAgentAlert {
  type: 'ai_agent';
  reason: string;
  scenario: string;
  ip: string;
  path: string;
  requestId: string;
  userAgent: string;
  acceptLanguage: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface SessionIssuedEvent {
  ipHash: string;
  ip?: string;
  userAgent?: string;
  difficulty?: number;
  workMs: number;
  verifyMs?: number;
  challenge?: string;
  nonce?: string | null;
  hashes?: number | null;
  now: number;
  source?: 'pow' | 'challenge';
  scenario?: string;
}

export interface DwellDeferredEvent {
  dwellMs: number;
  requiredMs: number;
  ip: string;
}

export interface TollOptions {
  mode?: 'api' | 'gate' | 'off';
  protect?: string[];
  exclude?: string[];
  powDifficulty?: number;
  powTTL?: number;
  sessionTTL?: number;
  cookieName?: string;
  secure?: boolean;
  minDwellMs?: number;
  minResponseTime?: number;
  challengeTTL?: number;
  rateWindowMs?: number;
  rateLimit?: number;
  sessionQuota?: number;
  maxSessions?: number;
  clientSource?: string;
  clientPath?: string;
  secret?: string;
  scenario?: (request: Request) => string;
  now?: () => number;
  onDecision?: (decision: TollDecision) => void;
  onAIAgentDetected?: (alert: AIAgentAlert) => void;
  onSessionIssued?: (session: SessionIssuedEvent) => void;
  onDwellDeferred?: (deferred: DwellDeferredEvent) => void;
}

export interface TollContext {
  ip?: string;
  mode?: string;
  tollScenario?: string;
  tollRequestId?: string;
  tollMetadata?: Record<string, unknown>;
  tollVerified?: boolean;
  needsAttestation?: boolean;
  out?: { headers: Record<string, string>; setCookie: string[] };
  [key: string]: unknown;
}

export interface Toll {
  name: string;
  handle(request: Request, ctx?: TollContext): Promise<Response | null>;
}

type DefaultableOptions = Omit<
  TollOptions,
  | 'secret'
  | 'scenario'
  | 'now'
  | 'onDecision'
  | 'onAIAgentDetected'
  | 'onSessionIssued'
  | 'onDwellDeferred'
>;

export const DEFAULT_OPTIONS: Required<DefaultableOptions>;

export function createToll(options?: TollOptions): Toll;

export default createToll;
