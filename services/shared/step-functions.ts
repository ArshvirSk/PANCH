import { JudgeOutput, CrossExamOutput } from './schemas';
import { CaseItem, EvidenceItem } from './types';
import { CaseUsage } from './cost';

// Task 1: Intake
export interface IntakeInput {
  caseId: string;
}
export interface IntakeOutput {
  caseId: string;
  evidenceItems: EvidenceItem[]; // Includes extractedTextKey from OCR
}

// Task 2: Blind
export interface BlindInput extends IntakeOutput {}
export interface BlindOutput {
  caseId: string;
  blindedCaseFileS3Key: string; // S3 pointer to the blinded text
}

// Task 3: Judge
export interface JudgeInput {
  caseId: string;
  judgeName: 'judge-1' | 'judge-2' | 'judge-3';
  blindedCaseFileS3Key: string;
  isSwapTest?: boolean;
}
export interface JudgeTaskOutput {
  judgeName: string;
  output: JudgeOutput;
  isSwapTest?: boolean;
  // The SSM-resolved model actually called and its real Converse token usage,
  // threaded through the payload for per-case cost tracking (PRD cost logging).
  modelId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

// Task 4: CrossExam
export interface CrossExamInput {
  caseId: string;
  judgeName: string;
  blindedCaseFileS3Key: string;
  peerRulings: Record<string, JudgeOutput>;
}
export interface CrossExamTaskOutput {
  judgeName: string;
  output: CrossExamOutput;
}

// Task 5: SwapTest (Reuses JudgeInput/Output with isSwapTest=true)

// Task 6: Aggregate
export interface AggregateInput {
  caseId: string;
  finalPanelOutputs: Record<string, JudgeOutput>;
  swapOutputs?: Record<string, JudgeOutput>;
  // Real token usage from the judges' original Bedrock calls, gathered by the
  // state machine's PrepareAggregate pass from $.judges[N] (usage.$ threading).
  // (crossExam is a pass-through today: no model call, no usage to thread.)
  judgesUsage?: Record<string, { modelId?: string; usage?: CaseUsage['perModel'][string] }>;
  swapUsage?: Record<string, { modelId?: string; usage?: CaseUsage['perModel'][string] }>;
  // Set by the state machine's PrepareAggregate pass (threaded to PRESIDING/PUBLISH).
  blindedCaseFileS3Key?: string;
}
export interface AggregateOutput {
  caseId: string;
  medianPayeeShareBps: number;
  spreadBps: number;
  swapConsistent: boolean;
  escalated: boolean;
  escalationReason?: string;
  // Carried through AGGREGATE (payloadResponseOnly) so PRESIDING/PUBLISH/SETTLE
  // still receive the panel outputs and the blinded case file pointer.
  blindedCaseFileS3Key?: string;
  finalPanelOutputs?: Record<string, JudgeOutput>;
  // Real per-model token totals for the case (PRD cost logging).
  usage?: CaseUsage;
  // USD cost computed from the SSM price table (/panch/pricing/bedrock/*).
  // Null when a model has no price entry — tokens stay real, cost unknown.
  // Null (not undefined) so the state machine's '$.costUsd' path always resolves.
  costUsd?: number | null;
}

// Task 7: Presiding
export interface PresidingInput extends AggregateOutput {
  blindedCaseFileS3Key: string;
  finalPanelOutputs: Record<string, JudgeOutput>;
}
export interface PresidingOutput {
  caseId: string;
  presidingRulingS3Key: string; // Final synthesized ruling
  // The presiding arbitrator's synthesized ruling body (same shape as JudgeOutput).
  // When present, PUBLISH publishes this instead of the median judge's output.
  ruling?: JudgeOutput;
  // Passed through (PRESIDING is payloadResponseOnly) so PUBLISH/SETTLE keep their inputs.
  payeeShareBps?: number;
  spreadBps?: number;
  swapConsistent?: boolean;
  escalated?: boolean;
  blindedCaseFileS3Key?: string;
  finalPanelOutputs?: Record<string, JudgeOutput>;
  // Threaded by the PRESIDING resultPath (WorkflowStack), not by the handler:
  // the pass-through presiding.ts stays untouched (Rutu's lane).
  usage?: CaseUsage;
  costUsd?: number | null;
}

// Task 8: Publish
export interface PublishInput extends PresidingOutput {
  payeeShareBps: number;
  spreadBps: number;
  swapConsistent: boolean;
  escalated: boolean;
  // True on the Catch -> FAILED fallback path, where a cached ruling already exists.
  fallback?: boolean;
  // Real per-case token usage + SSM-priced cost, written to the Rulings table.
  usage?: CaseUsage;
  costUsd?: number | null;
}
export interface PublishOutput {
  caseId: string;
  publishedUrl: string;
}

// Task 9: Settle
export interface SettleInput extends PublishOutput {
  payeeShareBps: number;
}
export interface SettleOutput {
  caseId: string;
  settled: boolean;
}

// Task 10: Notify
export interface NotifyInput extends SettleOutput {}
export interface NotifyOutput {
  success: boolean;
}

// Master State Machine Input
export interface TribunalExecutionInput {
  caseId: string;
}
