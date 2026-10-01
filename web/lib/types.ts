/**
 * Web-facing types. They derive from the frozen contracts in `services/shared`
 * (type-only imports, so no backend code is bundled into the browser).
 */
import type {
  CaseItem,
  CaseStatus,
  CaseTimelineStage,
  EvidenceItem,
} from '../../services/shared/types';
import type { JudgeOutput } from '../../services/shared/schemas';

/** String union of the shared CaseStatus enum values, e.g. 'CREATED' | 'FUNDED' | ... */
export type Status = `${CaseStatus}`;
export type TimelineStage = `${CaseTimelineStage}`;

export type Case = Omit<CaseItem, 'status'> & { status: Status };
export type Party = EvidenceItem['party'];
export type EvidenceType = EvidenceItem['type'];
/**
 * A published ruling is a judge output. `humanReviewed` marks one settled from the review queue;
 * `fallback` marks the cached body a failed demo run serves instead of an award.
 */
export type Ruling = JudgeOutput & { humanReviewed?: boolean; fallback?: boolean };

/**
 * GET /rulings — one row per published ruling, straight from the Rulings table
 * (services/api/rulings.ts getRulings), newest first. The gallery lists these;
 * the ruling page fetches the full body separately. Rows carry no party
 * identifiers, by design: published rulings are public and blind.
 */
export interface RulingSummary {
  caseId: string;
  publishedAt?: string;
  /** Claimant's share of the award in basis points (10000 = 100%). */
  payeeShareBps: number;
  /** Panel spread in basis points; 0 when the three judges agreed exactly. */
  spreadBps?: number;
  /** True when a human reviewer settled the escalated case, not the panel. */
  humanReviewed?: boolean;
  /** Cost record written at publish time, present when the run used Bedrock. */
  costUsd?: number;
  tokens?: number;
}

/** GET /cases/{id}. The timeline fields arrive once the tribunal workflow is wired. */
export interface CaseView {
  case: Case;
  timeline: TimelineStage[];
  /** Step Functions status of the case's run (RUNNING, SUCCEEDED, FAILED, ...), when there is one. */
  executionStatus?: string;
}

export interface LedgerReceipt {
  event: 'FUND' | 'DISPUTE';
  newStatus: Status;
  entryHash: string;
}

export interface EvidenceUploadTicket {
  evidenceId: string;
  uploadUrl: string;
  key?: string;
}

export interface DemoRunResult {
  message: string;
  caseId?: string;
  executionArn?: string;
}

export interface HealthResult {
  ok: boolean;
  timestamp?: string;
}

export interface CreateCaseInput {
  respondentEmail: string;
  amountCents: number;
  currency: string;
}

export interface EvidenceUploadRequest {
  party: Party;
  type: EvidenceType;
  contentType: string;
  contentLength: number;
}

/** One judge's seat in the panel record. `output` is null when it could not be read. */
export interface PanelJudge {
  name: string;
  output: Ruling | null;
}

/** An ESCALATED case as the review queue shows it (GET /reviews, TEAM_PLAN section H). */
export interface ReviewCase {
  caseId: string;
  status: Status;
  amountCents: number;
  currency: string;
  createdAt?: string;
  /** Party identifiers, used only to warn a reviewer who is a party. Never displayed. */
  claimantId?: string;
  respondentId?: string;
  summary?: string;
  escalationReason?: string;
  judges: PanelJudge[];
  /** Swap-test runs, keyed like `judges`. Empty when the API sent none. */
  swapJudges: PanelJudge[];
  spreadBps?: number;
  /** True when the API sent no spread and it was worked out from the judges' awards. */
  spreadComputed: boolean;
  medianBps?: number;
  swapConsistent?: boolean;
}

/** POST /reviews/{caseId}. */
export interface ReviewDecision {
  payeeShareBps: number;
  note: string;
}

export interface ReviewResult {
  caseId: string;
  status: string;
}

/** GET /rulings/{id}/verify (services/api/rulings.ts verifyRuling). */
export interface RulingVerification {
  match: boolean;
  reason: string;
  content: { computedHash: string; storedHash: string | null; match: boolean | null; verified: boolean };
  ledger: { entries: { seq: number; event: string; entryHash: string; valid: boolean }[]; chainValid: boolean; terminalOk: boolean; lastEvent: string | null };
  verifiedAt?: string;
}
