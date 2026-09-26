import { IntakeInput, IntakeOutput } from '../../shared/step-functions';

export const handler = async (event: IntakeInput): Promise<IntakeOutput> => {
  return {
    caseId: event.caseId,
    evidenceItems: [
      {
        caseId: event.caseId,
        evidenceId: 'e-1',
        party: 'claimant',
        type: 'contract',
        s3Key: `panch-evidence/${event.caseId}/e-1`,
        uploadedAt: new Date().toISOString(),
        extractedTextKey: `panch-evidence/${event.caseId}/extracted/e-1.txt`,
      }
    ]
  };
};
