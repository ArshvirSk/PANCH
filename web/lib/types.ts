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
