import { JudgeOutput, CrossExamOutput } from './schemas';
import { CaseItem, EvidenceItem } from './types';

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
}

// Task 7: Presiding
export interface PresidingInput extends AggregateOutput {
  blindedCaseFileS3Key: string;
  finalPanelOutputs: Record<string, JudgeOutput>;
}
export interface PresidingOutput {
  caseId: string;
  presidingRulingS3Key: string; // Final synthesized ruling
  // Passed through (PRESIDING is payloadResponseOnly) so PUBLISH/SETTLE keep their inputs.
  payeeShareBps?: number;
  spreadBps?: number;
  swapConsistent?: boolean;
  escalated?: boolean;
  blindedCaseFileS3Key?: string;
  finalPanelOutputs?: Record<string, JudgeOutput>;
}

// Task 8: Publish
export interface PublishInput extends PresidingOutput {
  payeeShareBps: number;
  spreadBps: number;
  swapConsistent: boolean;
  escalated: boolean;
  // True on the Catch -> FAILED fallback path, where a cached ruling already exists.
  fallback?: boolean;
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
