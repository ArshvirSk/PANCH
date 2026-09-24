import { z } from 'zod';

// Models
export const judgeOutputSchema = z.object({
  findingsOfFact: z.array(z.object({
    fact: z.string(),
    evidenceIds: z.array(z.string())
  })),
  clausesRelied: z.array(z.object({
    clauseRef: z.string(),
    interpretation: z.string()
  })),
  payeeShareBps: z.number().int().min(0).max(10000),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string())
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

export const crossExamOutputSchema = z.object({
  critiques: z.array(z.object({
    targetJudge: z.string(),
    type: z.enum(['factual', 'clause_misreading', 'unsupported_inference']),
    claim: z.string(),
    evidenceIds: z.array(z.string())
  })),
  revisedRuling: judgeOutputSchema,
  changed: z.boolean()
});
export type CrossExamOutput = z.infer<typeof crossExamOutputSchema>;

// API routes request/responses
export const CreateDealRequestSchema = z.object({
  claimantEmail: z.string().email(),
  respondentEmail: z.string().email(),
  amountCents: z.number().int().positive(),
  currency: z.string()
});
export type CreateDealRequest = z.infer<typeof CreateDealRequestSchema>;

export const CreateDealResponseSchema = z.object({
  caseId: z.string(),
  status: z.string()
});
export type CreateDealResponse = z.infer<typeof CreateDealResponseSchema>;

export const EvidenceUploadRequestSchema = z.object({
  party: z.enum(['claimant', 'respondent']),
  type: z.enum(['contract', 'chat', 'invoice', 'deliverable', 'other']),
  contentType: z.string()
});
export type EvidenceUploadRequest = z.infer<typeof EvidenceUploadRequestSchema>;

export const EvidenceUploadResponseSchema = z.object({
  evidenceId: z.string(),
  uploadUrl: z.string()
});
export type EvidenceUploadResponse = z.infer<typeof EvidenceUploadResponseSchema>;
