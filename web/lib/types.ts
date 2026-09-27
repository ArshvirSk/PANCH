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
export type Ruling = JudgeOutput;

/** GET /cases/{id}. The timeline fields arrive once the tribunal workflow is wired. */
export interface CaseView {
  case: Case;
  timeline: TimelineStage[];
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
