export enum CaseStatus {
  CREATED = 'CREATED',
  FUNDED = 'FUNDED',
  DISPUTED = 'DISPUTED',
  DELIBERATING = 'DELIBERATING',
  ESCALATED = 'ESCALATED',
  RULED = 'RULED',
  SETTLED = 'SETTLED'
}

export enum LedgerEvent {
  FUND = 'FUND',
  DISPUTE = 'DISPUTE',
  RESOLVE = 'RESOLVE',
  RELEASE = 'RELEASE'
}

export enum CaseTimelineStage {
  INTAKE = 'INTAKE',
  BLIND = 'BLIND',
  JUDGES = 'JUDGES',
  CROSS_EXAM = 'CROSS_EXAM',
  SWAP_TEST = 'SWAP_TEST',
  AGGREGATE = 'AGGREGATE',
  PRESIDING = 'PRESIDING',
  PUBLISH = 'PUBLISH',
  SETTLE = 'SETTLE',
  ESCALATED = 'ESCALATED',
  FAILED = 'FAILED'
}

// DynamoDB Types
export interface CaseItem {
  caseId: string; // PK
  status: CaseStatus;
  claimantId: string;
  respondentId: string;
  amountCents: number;
  currency: string;
  contractKey?: string;
  evidenceDeadline?: string;
  executionArn?: string;
  createdAt: string;
}

export interface EvidenceItem {
  caseId: string; // PK
  evidenceId: string; // SK
  party: 'claimant' | 'respondent';
  type: 'contract' | 'chat' | 'invoice' | 'deliverable' | 'other';
  s3Key: string;
  sha256?: string;
  extractedTextKey?: string;
  guardrailFlags?: string[];
  uploadedAt: string;
}

export interface RulingItem {
  caseId: string; // PK
  panelOutputs?: string; // S3 pointers
  payeeShareBps?: number;
  spreadBps?: number;
  swapConsistent?: boolean;
  escalated: boolean;
  rulingKey?: string;
  rulingSha256?: string;
  publishedAt?: string;
  tokens?: number;
  costUsd?: number;
}

export interface LedgerItem {
  caseId: string; // PK
  seq: number; // SK
  event: LedgerEvent;
  amountCents: number;
  payeeBps?: number;
  prevHash: string;
  entryHash: string;
}

export interface BenchCaseItem {
  benchId: string; // PK
  archetype: string;
  goldPayeeBps: number;
  s3Prefix: string;
  difficulty: string;
  isAmbiguous: boolean;
}

export interface BenchRunItem {
  runId: string; // PK
  benchId: string; // SK
  payeeBps: number;
  swapBps: number;
  flipped: boolean;
  escalated: boolean;
  tokens: number;
  costUsd: number;
}
